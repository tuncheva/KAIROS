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
import { api } from "~/trpc/react";

function WebSocketInitializerInner() {
  const { status, data: session } = useSession();
  const isAuthenticated = status === "authenticated" && !!session?.user?.id;

  // The active organisation is read from tRPC, not from the session.
  //
  // This used to reach for `session.user.activeOrganizationId`, which nothing
  // ever writes: `authConfig` runs `strategy: "jwt"` and its `jwt` callback sets
  // only id, name, email and image. So the value was always `undefined`, the
  // socket never joined an organisation room, and every org-wide event was
  // silently dropped. Putting it in the token would not have worked either — a
  // JWT is only rewritten at sign-in and on `update()`, so it would go stale the
  // moment somebody switched workspace.
  //
  // `getActive` is the same query the workspace switcher invalidates, so the
  // socket now follows a switch for free.
  const { data: active } = api.organization.getActive.useQuery(undefined, {
    enabled: isAuthenticated,
  });

  useWebSocket({
    enabled: isAuthenticated,
    // Only ever an id the server has already confirmed membership for: the WS
    // server hard-disconnects a socket that asks to join an org it does not
    // belong to.
    orgId: active?.organization?.id ?? null,
  });

  return null; // Render nothing — this component is purely for side effects
}

// Export with ssr: false to prevent Socket.IO from running on the server
const WebSocketInitializer = dynamic(
  () => Promise.resolve(WebSocketInitializerInner),
  { ssr: false },
);

export default WebSocketInitializer;
