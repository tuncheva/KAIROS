"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { io, type Socket } from "socket.io-client";
import { useSession } from "next-auth/react";

const WS_URL = process.env.NEXT_PUBLIC_WS_URL ?? "http://localhost:3001";

interface SocketContextValue {
  socket: Socket | null;
  connected: boolean;
}

const SocketContext = createContext<SocketContextValue>({ socket: null, connected: false });

export function SocketProvider({ children }: { children: ReactNode }) {
  const [socket, setSocket] = useState<Socket | null>(null);
  const [connected, setConnected] = useState(false);
  const { status, data: session } = useSession();

  // Token ref for HMAC ticket auth — reconnections always use the latest
  const tokenRef = useRef<string | null>(null);
  const tokenTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Fetch WS ticket from the API
  const fetchToken = useCallback(async (): Promise<string | null> => {
    try {
      const res = await fetch("/api/ws/token");
      if (!res.ok) return null;
      const data = (await res.json()) as { token: string; expiresAt: number };
      tokenRef.current = data.token;

      // Schedule refresh before expiry (90s of 120s TTL)
      if (tokenTimerRef.current) clearTimeout(tokenTimerRef.current);
      tokenTimerRef.current = setTimeout(() => {
        void fetchToken();
      }, 90_000);

      return data.token;
    } catch {
      return null;
    }
  }, []);

  useEffect(() => {
    if (status !== "authenticated") return;
    if (!session?.user?.id) return;

    let cancelled = false;

    const start = async () => {
      const token = await fetchToken();
      if (cancelled || !token) return;

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
        console.log("[Socket.IO] connected:", s.id);
        setConnected(true);
      });

      s.on("disconnect", (reason: string) => {
        console.log("[Socket.IO] disconnected:", reason);
        setConnected(false);
      });

      s.on("reconnect", (attempt: number) => {
        console.log("[Socket.IO] reconnected after", attempt, "attempts");
        setConnected(true);
      });

      s.on("connect_error", (err: Error) => {
        console.error("[Socket.IO] connection error:", err.message);
        setConnected(false);
      });

      setSocket(s);
    };

    void start();

    return () => {
      cancelled = true;
      if (tokenTimerRef.current) clearTimeout(tokenTimerRef.current);
      setSocket((prev: Socket | null) => {
        prev?.disconnect();
        return null;
      });
      setConnected(false);
    };
  }, [status, session?.user?.id, fetchToken]);

  return (
    <SocketContext.Provider value={{ socket, connected }}>{children}</SocketContext.Provider>
  );
}

/**
 * Returns the Socket.IO client instance (or `null` if not yet connected).
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
