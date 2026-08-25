"use client";

/**
 * Who is online, as far as this tab knows.
 *
 * The WS server owns the truth (see `ws-server/presence.ts`); this hook keeps a
 * local mirror of it. Two halves, and both are needed:
 *
 *  - **The snapshot.** A client that has just connected missed every broadcast
 *    that came before it. It asks once, on connect, rather than starting empty
 *    and only learning about people as they happen to come and go.
 *  - **The deltas.** `presence:update` frames keep the mirror current after
 *    that.
 *
 * The snapshot request is re-sent on every `connect`, not just the first: room
 * and connection state do not survive a reconnect, so a tab that dropped and
 * came back would otherwise hold whatever picture it had before the blip.
 */

import { useCallback, useEffect, useState } from "react";

import { useSocket } from "~/components/providers/SocketProvider";
import { useSocketEvent } from "~/hooks/useSocketEvent";

export function usePresence(): {
  onlineUserIds: Set<string>;
  isOnline: (userId: string | null | undefined) => boolean;
} {
  const socket = useSocket();
  const [online, setOnline] = useState<Set<string>>(() => new Set());

  useEffect(() => {
    if (!socket) return;

    const request = () => socket.emit("presence:query");
    socket.on("connect", request);
    if (socket.connected) request();

    return () => {
      socket.off("connect", request);
    };
  }, [socket]);

  useSocketEvent<{ userIds: string[] }>(
    "presence:snapshot",
    useCallback((data) => {
      setOnline(new Set(data.userIds));
    }, []),
  );

  useSocketEvent<{ userId: string; online: boolean }>(
    "presence:update",
    useCallback((data) => {
      setOnline((prev) => {
        /* Bail out when nothing changed — the frame is broadcast to every
           client, so most of them are hearing about someone they do not have
           on screen, and a new Set each time would rerender the whole rail. */
        if (prev.has(data.userId) === data.online) return prev;
        const next = new Set(prev);
        if (data.online) next.add(data.userId);
        else next.delete(data.userId);
        return next;
      });
    }, []),
  );

  const isOnline = useCallback(
    (userId: string | null | undefined) => (userId ? online.has(userId) : false),
    [online],
  );

  return { onlineUserIds: online, isOnline };
}
