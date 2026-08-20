/**
 * useWebSocket — master hook for Socket.IO connection + event listeners.
 *
 * Creates a singleton Socket.IO client authenticated with HMAC tickets.
 * Reconnections automatically use the latest token.  On reconnect,
 * notification queries are invalidated to catch up on missed events.
 */

"use client";

import { useEffect, useRef } from "react";
import { io, type Socket } from "socket.io-client";
import { useQueryClient } from "@tanstack/react-query";
import { useWsToken } from "./useWsToken";

const WS_URL = process.env.NEXT_PUBLIC_WS_URL ?? "http://localhost:3001";

// Module-level singleton — shared across all hook instances
let globalSocket: Socket | null = null;
let listenerCount = 0;

interface UseWebSocketOptions {
  enabled?: boolean;
  /** Current workspace/org ID to auto-join on connect */
  orgId?: string | null;
}

export function useWebSocket(options: UseWebSocketOptions = {}) {
  const { enabled = true, orgId } = options;
  const queryClient = useQueryClient();
  const { data: tokenData } = useWsToken(enabled);
  const hasToken = !!tokenData?.token;

  // Keep a ref to the latest token so the auth callback always reads fresh
  const tokenRef = useRef<string | null>(null);
  if (tokenData?.token) {
    tokenRef.current = tokenData.token;
  }

  // Track whether we were previously connected for reconnect catch-up
  const wasConnectedRef = useRef(false);
  const orgIdRef = useRef(orgId);
  orgIdRef.current = orgId;

  useEffect(() => {
    if (!enabled || !hasToken) return;

    listenerCount++;

    // Only create the socket once
    if (!globalSocket) {
      const socket = io(WS_URL, {
        // Auth as a function → reconnections always use the latest token
        auth: (cb) => {
          cb({ token: tokenRef.current });
        },
        transports: ["websocket", "polling"],
        reconnection: true,
        reconnectionAttempts: Infinity,
        reconnectionDelay: 1_000,
        reconnectionDelayMax: 10_000,
      });

      // ─── Connection lifecycle ──────────────────────────────────

      socket.on("connect", () => {
        console.log("[ws] connected:", socket.id);

        // Auto-join org room on connect
        if (orgIdRef.current) {
          socket.emit("join:org", orgIdRef.current);
        }

        // The public events feed. Joined here rather than on the feed page because
        // this hook owns the `event:updated` / `event:deleted` listeners below, and
        // they are what keep `getPublicEvents` fresh anywhere it is rendered.
        socket.emit("join:events");

        // Reconnect catch-up: invalidate notification queries
        if (wasConnectedRef.current) {
          console.log("[ws] reconnected — invalidating queries for catch-up");
          void queryClient.invalidateQueries({
            queryKey: [["notification"]],
          });
          void queryClient.invalidateQueries({
            queryKey: [["chat"]],
          });
        }
        wasConnectedRef.current = true;
      });

      socket.on("disconnect", (reason: string) => {
        console.log("[ws] disconnected:", reason);
      });

      socket.on("connect_error", (err: Error) => {
        console.warn("[ws] connect_error:", err.message);
      });

      // ─── Event listeners (React Query invalidation) ────────────

      // Universal notification bell refresh
      socket.on("notification:new", () => {
        void queryClient.invalidateQueries({
          queryKey: [["notification", "getAll"]],
        });
        void queryClient.invalidateQueries({
          queryKey: [["notification", "getUnreadCount"]],
        });
      });

      // Chat events
      socket.on("message:new", () => {
        void queryClient.invalidateQueries({
          queryKey: [["chat", "listMessages"]],
        });
      });

      socket.on("conversation:updated", () => {
        void queryClient.invalidateQueries({
          queryKey: [["chat", "listAllConversations"]],
        });
      });

      // Event feed events
      socket.on("event:deleted", () => {
        void queryClient.invalidateQueries({
          queryKey: [["event", "getPublicEvents"]],
        });
      });

      socket.on("event:updated", () => {
        void queryClient.invalidateQueries({
          queryKey: [["event", "getPublicEvents"]],
        });
      });

      // Organization events
      socket.on("org:member_joined", () => {
        void queryClient.invalidateQueries({
          queryKey: [["organization"]],
        });
      });

      // Task events
      socket.on("task:created", () => {
        void queryClient.invalidateQueries({ queryKey: [["task"]] });
      });
      socket.on("task:updated", () => {
        void queryClient.invalidateQueries({ queryKey: [["task"]] });
      });
      socket.on("task:deleted", () => {
        void queryClient.invalidateQueries({ queryKey: [["task"]] });
      });
      socket.on("task:assigned", () => {
        void queryClient.invalidateQueries({ queryKey: [["task"]] });
      });

      // Agent events
      socket.on("agent:thinking", () => {
        // These are forwarded directly — consumers use useSocketEvent
      });
      socket.on("agent:result", () => {
        // These are forwarded directly — consumers use useSocketEvent
      });

      globalSocket = socket;
    }

    return () => {
      listenerCount--;
      // Only disconnect if no more consumers
      if (listenerCount <= 0 && globalSocket) {
        globalSocket.disconnect();
        globalSocket = null;
        listenerCount = 0;
        wasConnectedRef.current = false;
      }
    };
  }, [enabled, hasToken, queryClient]);

  // Re-join org room when orgId changes
  useEffect(() => {
    if (!globalSocket?.connected || !orgId) return;
    globalSocket.emit("join:org", orgId);
  }, [orgId]);

  return globalSocket;
}

/**
 * useProjectRoom — join/leave a project room for project-scoped events.
 */
export function useProjectRoom(projectId: string | number | null | undefined) {
  useEffect(() => {
    if (!globalSocket?.connected || !projectId) return;
    globalSocket.emit("join:project", projectId);
    return () => {
      globalSocket?.emit("leave:project", projectId);
    };
  }, [projectId]);
}

/**
 * Get the global socket instance (for components that need direct access).
 */
export function getGlobalSocket(): Socket | null {
  return globalSocket;
}
