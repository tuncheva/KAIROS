/**
 * useWsToken — fetches and caches a short-lived WS auth ticket.
 *
 * Uses React Query with staleTime < ticket TTL so the token refreshes
 * before the server's 120s expiry.
 */

"use client";

import { useQuery } from "@tanstack/react-query";

interface WsTokenResponse {
  token: string;
  expiresAt: number;
}

async function fetchWsToken(): Promise<WsTokenResponse> {
  const res = await fetch("/api/ws/token");
  if (!res.ok) {
    throw new Error(`WS token fetch failed: ${res.status}`);
  }
  return res.json() as Promise<WsTokenResponse>;
}

export function useWsToken(enabled = true) {
  return useQuery<WsTokenResponse>({
    queryKey: ["ws-token"],
    queryFn: fetchWsToken,
    enabled,
    staleTime: 90_000, // Refresh before 120s server TTL
    gcTime: 120_000,
    refetchOnWindowFocus: false,
    retry: 2,
  });
}
