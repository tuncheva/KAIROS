/**
 * POST /api/ai/chat — one AI turn, streamed as Server-Sent Events.
 *
 * The chat previously ran as a tRPC mutation: one request, up to a minute of
 * silence, then everything at once. With a reasoning model doing tool lookups
 * that silence gets longer, and the "thinking" dots said nothing about what was
 * happening.
 *
 * Events, in the order they arrive:
 *
 *   start        the conversation id
 *   tool_call    a lookup began, by name
 *   answer_delta a run of answer text (G-1)
 *   sub_agent    a write agent took over
 *   result       the complete, validated object
 *
 * `answer_delta` deserves a note. A1's contract is a single JSON object — it
 * carries the handoff decision and the draft id that renders the Apply button —
 * so half an object is not something the UI can display, and for a long time
 * only *progress* streamed while the answer itself landed in one piece after up
 * to ninety seconds. The deltas are produced by scanning the model's JSON as it
 * arrives and decoding `answer.summary` out of it, so the text appears while the
 * structure is still being written. `result` remains authoritative: a client may
 * ignore the deltas entirely and behave exactly as before.
 *
 * Confirm and apply stay on tRPC: they never call the model, so they have
 * nothing to stream.
 */

import { after } from "next/server";

import { auth } from "~/server/auth";
import { db } from "~/server/db";
import type { TRPCContext } from "~/server/api/trpc";
import { createLogger } from "~/server/logger";
import { entitlementsFor } from "~/server/billing/entitlements";
import { consumeRateLimit } from "~/server/security/rateLimit";
import { runAgentTurn } from "~/server/llm/orchestrator/handoff";
import { isPinnable } from "~/server/llm/agents/registry";
import type { TargetAgent } from "~/server/llm/schemas/a1WorkspaceConciergeSchemas";
import {
  appendMessage,
  ensureConversation,
  ensureTitle,
  loadHistory,
  maybeSummarize,
} from "~/server/llm/conversations";

// The custom Node server in server.ts keeps connections open for as long as the
// turn needs; this route must not be pushed onto an edge runtime.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const log = createLogger("api.ai.chat");

const MAX_MESSAGE_CHARS = 20_000;

interface ChatRequestBody {
  message?: unknown;
  conversationId?: unknown;
  projectId?: unknown;
  /** E-3: the unapplied task plan still on screen, if any. */
  priorTaskDraftId?: unknown;
  /** A sub-agent the user pinned in the picker. Omit for Auto. */
  agentId?: unknown;
}

function sse(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

export async function POST(request: Request) {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: ChatRequestBody;
  try {
    body = (await request.json()) as ChatRequestBody;
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const message =
    typeof body.message === "string" ? body.message.trim() : "";
  if (!message) {
    return Response.json({ error: "message is required" }, { status: 400 });
  }
  if (message.length > MAX_MESSAGE_CHARS) {
    return Response.json({ error: "message is too long" }, { status: 413 });
  }

  const projectId =
    typeof body.projectId === "number" && Number.isFinite(body.projectId)
      ? body.projectId
      : null;
  const requestedConversationId =
    typeof body.conversationId === "string" ? body.conversationId : undefined;
  const priorTaskDraftId =
    typeof body.priorTaskDraftId === "string" ? body.priorTaskDraftId : undefined;

  // An unrecognised agent id falls back to Auto rather than 400-ing. The id is a
  // routing preference, not a request the turn depends on, and a stale pin from
  // an older client should degrade to the default rather than break the chat.
  // `isPinnable` is what guarantees the value reaching `runHandoff`'s exhaustive
  // switch is one that switch handles.
  const pinnedAgent =
    typeof body.agentId === "string" && isPinnable(body.agentId)
      ? (body.agentId as TargetAgent)
      : undefined;

  // Built before the rate-limit gate rather than after: the ceiling is now the
  // caller's plan ceiling, and resolving entitlements needs a context.
  const ctx: TRPCContext = { db, session, headers: request.headers };

  // Same door as the tRPC procedures: one AI request off the caller's daily
  // budget, refused before any model call.
  try {
    await consumeRateLimit(userId, entitlementsFor(ctx).aiRequestsPerDay);
  } catch (err) {
    const detail =
      err instanceof Error ? err.message : "Rate limit exceeded";
    return Response.json({ error: detail, code: "TOO_MANY_REQUESTS" }, { status: 429 });
  }

  const conversationId = await ensureConversation(ctx, {
    conversationId: requestedConversationId,
    userId,
    projectId,
  });
  const history = await loadHistory(ctx, conversationId, userId);

  await appendMessage(ctx, {
    conversationId,
    role: "user",
    content: message,
  });

  const encoder = new TextEncoder();
  const startedAt = Date.now();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let closed = false;
      const send = (event: string, data: unknown) => {
        if (closed) return;
        controller.enqueue(encoder.encode(sse(event, data)));
      };

      try {
        send("start", { conversationId });

        const result = await runAgentTurn({
          ctx,
          message,
          scope: projectId ? { projectId } : undefined,
          conversationHistory: history.messages,
          conversationSummary: history.summary,
          priorTaskDraftId,
          pinnedAgent,
          signal: request.signal,
          onToolCall: (name) => send("tool_call", { name }),
          onSubAgent: (agent) => send("sub_agent", { agent }),
          // G-1: the answer arrives as text while the rest of the object is
          // still being generated. The `result` event still carries the whole
          // validated object — this is the same bytes, seen earlier.
          onAnswerDelta: (text) => send("answer_delta", { text }),
        });

        const latencyMs = Date.now() - startedAt;
        send("result", { ...result, conversationId, latencyMs });

        // Persist after the response is on its way — the user should not wait on
        // a write they cannot see. The title and the rolling summary are model
        // calls of their own, so they especially belong here.
        after(async () => {
          try {
            await appendMessage(ctx, {
              conversationId,
              role: "assistant",
              // Store the structured output, which is what the model produced
              // and what the next turn should see — not the rendered bubble.
              content: JSON.stringify(result.a1),
              // On a pinned turn A1 never ran, so attributing the message to it
              // would make the history claim a model call that did not happen.
              agentId: pinnedAgent ?? "workspace_concierge",
              draftId: result.plans[0]?.draftId ?? null,
              latencyMs,
            });
          } catch (err) {
            log.error("failed to persist assistant message", { err });
          }

          // Independent of each other and of the write above: one failing must
          // not skip the other.
          await Promise.allSettled([
            history.messages.length === 0
              ? ensureTitle(ctx, conversationId, message)
              : Promise.resolve(),
            maybeSummarize(ctx, conversationId),
          ]);
        });
      } catch (err) {
        log.error("agent turn failed", { err });
        send("error", {
          message:
            err instanceof Error
              ? err.message
              : "The assistant failed to answer.",
        });
      } finally {
        closed = true;
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      // Stops nginx and similar proxies buffering the stream into one blob.
      "X-Accel-Buffering": "no",
    },
  });
}
