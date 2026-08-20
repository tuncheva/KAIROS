"use client";

import { useCallback, useRef, useState } from "react";

/**
 * Client for `POST /api/ai/chat`.
 *
 * The chat used to be a tRPC mutation with no feedback until the whole turn
 * finished — with a reasoning model doing lookups that is a long stare at three
 * dots. This surfaces what the server is actually doing: which tool is running,
 * which sub-agent took over, and finally the result.
 *
 * Only progress streams, not answer tokens: A1 returns one JSON object carrying
 * the handoff decision and the draft id behind the Apply button, and a partial
 * JSON object is not renderable.
 */

export interface AgentPlan {
  kind: "tasks" | "notes" | "events";
  draftId: string;
  plan: Record<string, unknown>;
}

export interface AgentTurnPayload {
  draftId: string;
  a1: {
    intent: { type: string; scope?: { projectId?: string | number } };
    answer?: { summary: string; details?: string[] };
    handoff?: { targetAgent: string; userIntent: string };
  };
  plan?: AgentPlan;
  handoffError?: string;
  conversationId: string;
  latencyMs: number;
}

export interface AgentStreamHandlers {
  onToolCall?: (name: string) => void;
  onSubAgent?: (agent: string) => void;
  onResult: (payload: AgentTurnPayload) => void;
  onError: (message: string, isRateLimit: boolean) => void;
}

interface SendOptions {
  message: string;
  projectId?: number;
  conversationId?: string;
}

/** Split an SSE buffer into complete `event:`/`data:` frames. */
function parseFrames(buffer: string): {
  frames: Array<{ event: string; data: string }>;
  rest: string;
} {
  const frames: Array<{ event: string; data: string }> = [];
  const chunks = buffer.split("\n\n");
  // The trailing chunk may be incomplete; hold it back for the next read.
  const rest = chunks.pop() ?? "";

  for (const chunk of chunks) {
    let event = "message";
    const dataLines: string[] = [];
    for (const line of chunk.split("\n")) {
      if (line.startsWith("event:")) event = line.slice(6).trim();
      else if (line.startsWith("data:")) dataLines.push(line.slice(5).trim());
    }
    if (dataLines.length > 0) frames.push({ event, data: dataLines.join("\n") });
  }

  return { frames, rest };
}

export function useAgentStream(handlers: AgentStreamHandlers) {
  const [isStreaming, setIsStreaming] = useState(false);
  const [conversationId, setConversationId] = useState<string | undefined>();
  const abortRef = useRef<AbortController | null>(null);

  // Handlers are re-created on every render by callers; read them through a ref
  // so `send` stays stable and effects depending on it do not re-fire.
  const handlersRef = useRef(handlers);
  handlersRef.current = handlers;

  const cancel = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    setIsStreaming(false);
  }, []);

  const send = useCallback(async (opts: SendOptions) => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setIsStreaming(true);

    try {
      const response = await fetch("/api/ai/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: opts.message,
          projectId: opts.projectId,
          conversationId: opts.conversationId,
        }),
        signal: controller.signal,
      });

      if (!response.ok || !response.body) {
        const detail = (await response
          .json()
          .catch(() => null)) as { error?: string; code?: string } | null;
        handlersRef.current.onError(
          detail?.error ?? `Request failed (${String(response.status)})`,
          response.status === 429,
        );
        return;
      }

      // An expired session is redirected to the sign-in page by the proxy, so a
      // successful-looking response can still be HTML. Without this check the
      // parser finds no frames and reports a dropped connection, which sends the
      // user looking for a network problem they do not have.
      if (
        !response.headers.get("content-type")?.includes("text/event-stream")
      ) {
        handlersRef.current.onError(
          "Your session has expired. Please sign in again.",
          false,
        );
        return;
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let sawResult = false;

      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const { frames, rest } = parseFrames(buffer);
        buffer = rest;

        for (const frame of frames) {
          let payload: unknown;
          try {
            payload = JSON.parse(frame.data);
          } catch {
            continue;
          }

          switch (frame.event) {
            case "start":
              setConversationId(
                (payload as { conversationId: string }).conversationId,
              );
              break;
            case "tool_call":
              handlersRef.current.onToolCall?.(
                (payload as { name: string }).name,
              );
              break;
            case "sub_agent":
              handlersRef.current.onSubAgent?.(
                (payload as { agent: string }).agent,
              );
              break;
            case "result":
              sawResult = true;
              handlersRef.current.onResult(payload as AgentTurnPayload);
              break;
            case "error":
              sawResult = true;
              handlersRef.current.onError(
                (payload as { message: string }).message,
                false,
              );
              break;
          }
        }
      }

      // A stream that ends without a terminal event means the connection dropped
      // mid-turn; say so rather than leaving the thinking indicator forever.
      if (!sawResult) {
        handlersRef.current.onError("The connection closed before the assistant finished.", false);
      }
    } catch (err) {
      // An abort is the user's own doing (new message, unmounted) — not an error.
      if (err instanceof Error && err.name === "AbortError") return;
      handlersRef.current.onError(
        err instanceof Error ? err.message : "Request failed",
        false,
      );
    } finally {
      setIsStreaming(false);
      abortRef.current = null;
    }
  }, []);

  return { send, cancel, isStreaming, conversationId, setConversationId };
}
