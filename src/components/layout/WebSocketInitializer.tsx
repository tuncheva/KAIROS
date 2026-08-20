/**
 * WebSocketInitializer — client component that bootstraps the WS
 * connection once the user is authenticated.
 *
 * Mounted in the root layout via dynamic() with ssr: false to avoid
 * any server-side rendering issues with Socket.IO.
 */

"use client";

import dynamic from "next/dynamic";
import { useSession } from "next-auth/react";
import { useWebSocket } from "~/hooks/useWebSocket";

function WebSocketInitializerInner() {
  const { status, data: session } = useSession();
  const isAuthenticated = status === "authenticated" && !!session?.user?.id;

  // Find the user's active organization for auto-join
  const activeOrgId = (session?.user as { activeOrganizationId?: string } | undefined)
    ?.activeOrganizationId ?? null;

  useWebSocket({
    enabled: isAuthenticated,
    orgId: activeOrgId,
  });

  return null; // Render nothing — this component is purely for side effects
}

// Export with ssr: false to prevent Socket.IO from running on the server
const WebSocketInitializer = dynamic(
  () => Promise.resolve(WebSocketInitializerInner),
  { ssr: false },
);

export default WebSocketInitializer;
