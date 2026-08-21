/**
 * useWebSocket — room membership + React Query invalidation for the app socket.
 *
 * The connection itself belongs to `SocketProvider`; this hook only attaches to
 * it. It used to create a second `io()` client of its own, which meant every
 * authenticated user held two sockets and only one of them was ever in the org
 * and events rooms — see the comment in `SocketProvider` for why that silently
 * dropped room-scoped events.
 *
 * On reconnect, notification and chat queries are invalidated to catch up on
 * anything missed while the socket was down.
 */

"use client";

import { useEffect, useRef } from "react";
import type { Socket } from "socket.io-client";
import { useQueryClient } from "@tanstack/react-query";

import { useSocket } from "~/components/providers/SocketProvider";

export { getGlobalSocket } from "~/components/providers/SocketProvider";

interface UseWebSocketOptions {
  enabled?: boolean;
  /** Current workspace/org ID to auto-join on connect */
  orgId?: string | number | null;
}

export function useWebSocket(options: UseWebSocketOptions = {}): Socket | null {
  const { enabled = true, orgId } = options;
  const queryClient = useQueryClient();
  const socket = useSocket();

  // Track whether we were previously connected for reconnect catch-up
  const wasConnectedRef = useRef(false);

  useEffect(() => {
    if (!enabled || !socket) return;

    const invalidate = (key: string[]) =>
      void queryClient.invalidateQueries({ queryKey: [key] });

    const onConnect = () => {
      // The public events feed. Joined here rather than on the feed page because
      // this hook owns the `event:updated` / `event:deleted` listeners below, and
      // they are what keep `getPublicEvents` fresh anywhere it is rendered.
      socket.emit("join:events");

      // Reconnect catch-up: the socket missed whatever happened while it was down.
      if (wasConnectedRef.current) {
        invalidate(["notification"]);
        invalidate(["chat"]);
      }
      wasConnectedRef.current = true;
    };

    // ─── Event listeners (React Query invalidation) ────────────
    const listeners: Array<[string, () => void]> = [
      // Universal notification bell refresh
      ["notification:new", () => {
        invalidate(["notification", "getAll"]);
        invalidate(["notification", "getUnreadCount"]);
      }],

      // Chat events
      ["message:new", () => invalidate(["chat", "listMessages"])],
      ["conversation:updated", () => invalidate(["chat", "listAllConversations"])],

      // Event feed events
      ["event:deleted", () => invalidate(["event", "getPublicEvents"])],
      ["event:updated", () => invalidate(["event", "getPublicEvents"])],

      // Organization events
      ["org:member_joined", () => invalidate(["organization"])],

      // Task events
      ["task:created", () => invalidate(["task"])],
      ["task:updated", () => invalidate(["task"])],
      ["task:deleted", () => invalidate(["task"])],
      ["task:assigned", () => invalidate(["task"])],
    ];

    socket.on("connect", onConnect);
    for (const [event, handler] of listeners) socket.on(event, handler);

    // A socket handed over already connected never fires `connect` for us.
    if (socket.connected) onConnect();

    return () => {
      socket.off("connect", onConnect);
      for (const [event, handler] of listeners) socket.off(event, handler);
    };
  }, [enabled, socket, queryClient]);

  // Org room, followed across workspace switches and reconnects.
  //
  // The cleanup is the important half: without it a workspace switch joined the
  // new organisation's room while staying in the old one, so the socket kept
  // receiving events for a workspace the user had left. Re-joining on `connect`
  // matters too — room membership lives on the server and does not survive a
  // dropped connection.
  useEffect(() => {
    if (!enabled || !socket || !orgId) return;

    const join = () => socket.emit("join:org", orgId);
    socket.on("connect", join);
    if (socket.connected) join();

    return () => {
      socket.off("connect", join);
      if (socket.connected) socket.emit("leave:org", orgId);
    };
  }, [enabled, socket, orgId]);

  return socket;
}

/**
 * useProjectRoom — join/leave a project room for project-scoped events.
 */
export function useProjectRoom(projectId: string | number | null | undefined) {
  const socket = useSocket();

  useEffect(() => {
    if (!socket || !projectId) return;

    const join = () => socket.emit("join:project", projectId);
    socket.on("connect", join);
    if (socket.connected) join();

    return () => {
      socket.off("connect", join);
      if (socket.connected) socket.emit("leave:project", projectId);
    };
  }, [socket, projectId]);
}
