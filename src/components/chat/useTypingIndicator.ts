"use client";

/**
 * Typing indicators over the conversation room.
 *
 * The WS server has always relayed `message:typing` — `registerRoomHandlers`
 * forwards it to the rest of the room, and only for rooms the socket was
 * actually authorized into. Nothing on the client emitted or listened for it,
 * so the relay sat there as dead code. This hook is the missing half.
 *
 * Two details the relay depends on:
 *
 *  - It uses `socket.to(room)`, so a sender never receives its own frame and
 *    the state here always describes the *other* participant.
 *  - Membership is per socket id and is lost on reconnect. The join (and its
 *    re-join on `connect`) is owned by the calling component; this hook only
 *    speaks into whatever room the socket is currently in.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import type { Socket } from "socket.io-client";

/** How long a "still typing" ping stays valid before it is re-sent. */
const PING_INTERVAL_MS = 2_000;
/** Idle time after the last keystroke before the sender declares itself done. */
const IDLE_STOP_MS = 3_000;
/**
 * How long a received indicator survives without a refresh.
 *
 * Strictly longer than the sender's ping interval, so an indicator never
 * flickers between pings — but short enough that a peer who closes the tab
 * (their "stopped" frame never arrives) does not appear to type forever.
 */
const RECEIVE_TIMEOUT_MS = 6_000;

export function useTypingIndicator(
  socket: Socket | null,
  conversationId: number | null,
) {
  const [peerTyping, setPeerTyping] = useState(false);

  /** When the last "typing" ping went out, so pings are throttled. */
  const lastPingAt = useRef(0);
  const idleTimer = useRef<number | null>(null);
  const expiryTimer = useRef<number | null>(null);

  const clearTimer = (ref: React.MutableRefObject<number | null>) => {
    if (ref.current !== null) {
      window.clearTimeout(ref.current);
      ref.current = null;
    }
  };

  // ── receiving ──────────────────────────────────────────────────────
  useEffect(() => {
    setPeerTyping(false);
    if (!socket || conversationId === null) return;

    const onTyping = (data: { userId: string; isTyping: boolean }) => {
      if (!data?.isTyping) {
        clearTimer(expiryTimer);
        setPeerTyping(false);
        return;
      }
      setPeerTyping(true);
      clearTimer(expiryTimer);
      expiryTimer.current = window.setTimeout(
        () => setPeerTyping(false),
        RECEIVE_TIMEOUT_MS,
      );
    };

    socket.on("message:typing", onTyping);
    return () => {
      socket.off("message:typing", onTyping);
      clearTimer(expiryTimer);
      setPeerTyping(false);
    };
  }, [socket, conversationId]);

  // ── sending ────────────────────────────────────────────────────────

  const stopTyping = useCallback(() => {
    clearTimer(idleTimer);
    if (!socket || conversationId === null) return;
    if (lastPingAt.current === 0) return; // never announced; nothing to retract
    lastPingAt.current = 0;
    socket.emit("message:typing", { conversationId, isTyping: false });
  }, [socket, conversationId]);

  /** Call on each keystroke. Throttles the wire traffic to one ping per interval. */
  const notifyTyping = useCallback(() => {
    if (!socket || conversationId === null) return;

    const now = Date.now();
    if (now - lastPingAt.current > PING_INTERVAL_MS) {
      lastPingAt.current = now;
      socket.emit("message:typing", { conversationId, isTyping: true });
    }

    clearTimer(idleTimer);
    idleTimer.current = window.setTimeout(stopTyping, IDLE_STOP_MS);
  }, [socket, conversationId, stopTyping]);

  /* Switching conversation or unmounting mid-sentence must retract the
     indicator, or the peer is left watching a permanent "typing…". */
  useEffect(() => {
    return () => {
      clearTimer(idleTimer);
      if (socket && conversationId !== null && lastPingAt.current !== 0) {
        lastPingAt.current = 0;
        socket.emit("message:typing", { conversationId, isTyping: false });
      }
    };
  }, [socket, conversationId]);

  return { peerTyping, notifyTyping, stopTyping };
}
