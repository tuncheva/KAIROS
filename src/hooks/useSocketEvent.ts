"use client";

import { useEffect, useRef } from "react";
import { useSocket } from "~/components/providers/SocketProvider";

/**
 * Subscribe to a Socket.IO event for the lifetime of the calling component.
 *
 * @example
 * useSocketEvent<{ messageId: number }>("message:new", (data) => {
 *   console.log("New message:", data.messageId);
 * });
 */
export function useSocketEvent<T = unknown>(
  event: string,
  handler: (data: T) => void,
) {
  const socket = useSocket();
  // Keep a stable reference to the latest handler to avoid re-subscribing on
  // every render while still calling the most recent closure.
  const handlerRef = useRef(handler);
  handlerRef.current = handler;

  useEffect(() => {
    if (!socket) return;
    const listener = (data: T) => handlerRef.current(data);
    socket.on(event, listener as (...args: unknown[]) => void);
    return () => {
      socket.off(event, listener as (...args: unknown[]) => void);
    };
  }, [socket, event]);
}
