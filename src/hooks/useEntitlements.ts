"use client";

import { api } from "~/trpc/react";
import {
  FREE_ENTITLEMENTS,
  type BooleanEntitlement,
  type Entitlements,
} from "~/lib/entitlements";

/**
 * What the current user's plan grants.
 *
 * Presentation only. This decides which controls to render and whether to show
 * an upgrade affordance; every gated operation is checked again on the server
 * against `entitlementsFor(ctx)`, so a client that lies to itself here gains
 * nothing.
 *
 * **It fails closed.** Until the query lands, the answer is the Free set, not
 * the Pro one. Guessing generously is the more tempting default — nothing is
 * blocked today, so it would look right — but it is the bug `useRolePermissions`
 * documents having already had: a control that renders and then vanishes is
 * worse than one that appears a beat late, and it produces support reports about
 * features that "disappear". Read `isLoading` if a skeleton is better than a
 * disabled control.
 *
 * The fallback is the real `FREE_ENTITLEMENTS` rather than an all-false object,
 * so the loading state matches what a free user actually sees rather than a
 * third, stricter tier that exists nowhere.
 *
 * Cached with `staleTime: Infinity`. A plan does not change while the app is
 * open; when checkout lands it should invalidate this query explicitly rather
 * than have every consumer poll for a transition that happens once.
 */
export function useEntitlements(): {
  entitlements: Entitlements;
  isLoading: boolean;
} {
  const { data, isLoading } = api.billing.entitlements.useQuery(undefined, {
    staleTime: Infinity,
    refetchOnWindowFocus: false,
  });

  return { entitlements: data ?? FREE_ENTITLEMENTS, isLoading };
}

/**
 * One yes/no flag, for the common case of gating a single control.
 *
 * Only boolean flags are addressable — see {@link BooleanEntitlement}. Numeric
 * and list-valued flags (`aiRequestsPerDay`, `exportFormats`) carry a limit
 * rather than a permission, so read them from {@link useEntitlements} and
 * compare against something.
 */
export function useEntitlement(flag: BooleanEntitlement): boolean {
  return useEntitlements().entitlements[flag];
}
