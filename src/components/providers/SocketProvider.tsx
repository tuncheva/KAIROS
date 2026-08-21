"use client";

import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { io, type Socket } from "socket.io-client";
import { useSession } from "next-auth/react";

import { useWsToken } from "~/hooks/useWsToken";

const WS_URL = process.env.NEXT_PUBLIC_WS_URL ?? "http://localhost:3001";

interface SocketContextValue {
  socket: Socket | null;
  connected: boolean;
}

const SocketContext = createContext<SocketContextValue>({
  socket: null,
  connected: false,
});

/**
 * Module-level mirror of the provider's socket.
 *
 * Only for the handful of non-React callers that need the connection outside a
 * component (see `getGlobalSocket`). It is written and cleared by the provider
 * effect below, so it is never a second connection — just another way to reach
 * the one the provider owns.
 */
let currentSocket: Socket | null = null;

/**
 * The single Socket.IO connection for the app.
 *
 * There used to be two: this provider created one, and `useWebSocket` created
 * another module-level singleton of its own. Every authenticated page therefore
 * opened two sockets, which is what filled the server log with paired
 * connect/disconnect lines — but the real damage was that the two had different
 * room membership. `useWebSocket` was the only one emitting `join:org` and
 * `join:events`, while `useSocketEvent` listened on *this* one, so every
 * room-scoped event (`event:updated`, `org:member_joined`, project chat) arrived
 * on a socket with no listeners and the components that cared never saw it.
 *
 * The connection is created here and nowhere else. `useWebSocket` now attaches
 * its room joins and query invalidations to this socket, so listeners and
 * membership always live on the same wire.
 */
export function SocketProvider({ children }: { children: ReactNode }) {
  const { status, data: session } = useSession();
  const userId = session?.user?.id;
  const authenticated = status === "authenticated" && !!userId;

  // One token source too: `useWsToken` already caches and refreshes the ticket
  // ahead of the server's 120s TTL, so the provider no longer runs its own
  // fetch-and-setTimeout loop against `/api/ws/token`.
  const { data: tokenData } = useWsToken(authenticated);
  const hasToken = !!tokenData?.token;

  // The auth callback reads this on every (re)connect, so a refreshed ticket is
  // picked up without tearing the socket down.
  const tokenRef = useRef<string | null>(null);
  if (tokenData?.token) {
    tokenRef.current = tokenData.token;
  }

  const [socket, setSocket] = useState<Socket | null>(null);
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    if (!authenticated || !hasToken) return;

    const s = io(WS_URL, {
      // Auth as a function so reconnections always use the latest token
      auth: (cb) => {
        cb({ token: tokenRef.current });
      },
      transports: ["websocket", "polling"],
      reconnection: true,
      reconnectionAttempts: Infinity,
      reconnectionDelay: 1_000,
      reconnectionDelayMax: 10_000,
    });

    s.on("connect", () => {
      setConnected(true);
    });

    s.on("disconnect", () => {
      setConnected(false);
    });

    s.on("connect_error", (err: Error) => {
      console.warn("[ws] connect_error:", err.message);
      setConnected(false);
    });

    currentSocket = s;
    setSocket(s);

    return () => {
      s.removeAllListeners();
      s.disconnect();
      if (currentSocket === s) currentSocket = null;
      setSocket(null);
      setConnected(false);
    };
    // `userId` is in the deps so signing in as somebody else replaces the
    // socket rather than keeping one authenticated as the previous user.
  }, [authenticated, hasToken, userId]);

  return (
    <SocketContext.Provider value={{ socket, connected }}>
      {children}
    </SocketContext.Provider>
  );
}

/**
 * Returns the Socket.IO client instance (or `null` if not yet created).
 */
export function useSocket(): Socket | null {
  return useContext(SocketContext).socket;
}

/**
 * Returns whether the Socket.IO client is currently connected.
 */
export function useSocketConnected(): boolean {
  return useContext(SocketContext).connected;
}

/**
 * The provider's socket, for callers that are not inside a component.
 *
 * Prefer `useSocket()` anywhere React context is available — this is a snapshot
 * and will not re-render when the connection is replaced.
 */
export function getGlobalSocket(): Socket | null {
  return currentSocket;
}
