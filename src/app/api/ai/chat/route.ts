/**
 * POST /api/ai/chat — one AI turn, streamed as Server-Sent Events.
 *
 * The chat previously ran as a tRPC mutation: one request, up to a minute of
 * silence, then everything at once. With a reasoning model doing tool lookups
 * that silence gets longer, and the "thinking" dots said nothing about what was
 * happening.
 *
 * What streams here is *progress*, not answer tokens. A1's contract is a single
 * JSON object — it carries the handoff decision and the draft id that renders the
 * Apply button — and half of a JSON object is not something the UI can display.
 * So the events report which tool is running and which sub-agent took over, and
 * the finished object arrives in one `result` event.
 *
 * Confirm and apply stay on tRPC: they never call the model, so they have
 * nothing to stream.
 */

import { after } from "next/server";

import { auth } from "~/server/auth";
import { db } from "~/server/db";
import type { TRPCContext } from "~/server/api/trpc";
import { createLogger } from "~/server/logger";
import { consumeRateLimit } from "~/server/security/rateLimit";
import { runAgentTurn } from "~/server/llm/orchestrator/handoff";
import {
  appendMessage,
  ensureConversation,
  loadHistory,
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

  // Same door as the tRPC procedures: one AI request off the caller's daily
  // budget, refused before any model call.
  try {
    await consumeRateLimit(userId);
  } catch (err) {
    const detail =
      err instanceof Error ? err.message : "Rate limit exceeded";
    return Response.json({ error: detail, code: "TOO_MANY_REQUESTS" }, { status: 429 });
  }

  const ctx: TRPCContext = { db, session, headers: request.headers };

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
          conversationHistory: history,
          signal: request.signal,
          onToolCall: (name) => send("tool_call", { name }),
          onSubAgent: (agent) => send("sub_agent", { agent }),
        });

        const latencyMs = Date.now() - startedAt;
        send("result", { ...result, conversationId, latencyMs });

        // Persist after the response is on its way — the user should not wait on
        // a write they cannot see.
        after(async () => {
          try {
            await appendMessage(ctx, {
              conversationId,
              role: "assistant",
              // Store the structured output, which is what the model produced
              // and what the next turn should see — not the rendered bubble.
              content: JSON.stringify(result.a1),
              agentId: "workspace_concierge",
              draftId: result.plan?.draftId ?? null,
              latencyMs,
            });
          } catch (err) {
            log.error("failed to persist assistant message", { err });
          }
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
