/**
 * What each plan grants — the definitions, with no server binding.
 *
 * Deliberately not `server-only`. The client needs the same answer the server
 * has: which flag set corresponds to Free, so a component can fail closed while
 * the entitlements query is in flight without inventing a second definition of
 * "free" in the UI that will drift from this one. Mirrors how `lib/permissions`
 * holds the pure role logic that both `server/api/authz` and
 * `hooks/useRolePermissions` read.
 *
 * Resolving *which* plan a given caller is on stays on the server, in
 * `server/billing/entitlements.ts`. Nothing here reads a session, and nothing
 * here is authoritative: these flags decide which controls to render, and every
 * gated operation is checked again server-side.
 *
 * Two kinds of flag live here, and the distinction is deliberate:
 *
 * - **Shipped.** The feature exists and is currently ungated. Reading its flag
 *   at the call site costs nothing today and is the entire change on the day the
 *   tier goes live.
 * - **Roadmap.** The feature does not exist yet. The flag is written now anyway,
 *   because a flag added ahead of its feature costs one line, whereas retrofitting
 *   one means reopening the paywall argument inside the feature's own PR — which
 *   is where it gets decided badly, under deadline, by whoever happens to be
 *   writing it. See `docs/pro-features-implementation-plan.md`.
 */

export type PlanId = "free" | "pro";

/**
 * Bulk export formats.
 *
 * Not a boolean, because the decision already taken is that Free exports its
 * tasks as CSV and Pro exports everything. A boolean would force that nuance
 * into a call site later and lose the reasoning behind it: an export path that
 * is entirely paywalled reads as hostage-taking, while a partial one reads as a
 * feature.
 */
export type ExportFormat = "csv" | "markdown" | "ics";

export interface Entitlements {
  plan: PlanId;

  // ---- shipped, currently ungated -----------------------------------------

  /** The Daily Brief and the Risk Radar — the agents that run unprompted. */
  scheduledAgents: boolean;
  /** Address a sub-agent directly instead of letting A1 route the turn. */
  agentPinning: boolean;
  /** Reverse an applied plan inside the undo window. */
  undoApply: boolean;
  /** See which lookups an answer was built from. */
  toolInspector: boolean;
  /** Register tools of the user's own — an HTTP endpoint or an MCP server. */
  customTools: boolean;
  /** Facts scoped to a single agent, rather than one shared global set. */
  perAgentMemory: boolean;
  /**
   * Interactive AI turns per 24-hour sliding window.
   *
   * Read by the rate limiter instead of its `AI_RATE_LIMIT` constant once
   * per-plan ceilings land. Proactive spend is a separate budget and is not
   * metered here — see `AI_SYSTEM_RATE_LIMIT`.
   */
  aiRequestsPerDay: number;

  // ---- roadmap — nothing reads these yet -----------------------------------

  /** Days of chat history retained. `null` means indefinitely. */
  historyDays: number | null;
  /** How many schedules of the user's own devising may exist. */
  maxSchedules: number;
  /** Standing directives the agents follow, distinct from remembered facts. */
  standingInstructions: boolean;
  /** Upload documents the agents can search and cite. */
  documents: boolean;
  /** Deliver the brief to email rather than only in-app. */
  emailDelivery: boolean;
  /** Two-way sync with an external calendar. */
  calendarSync: boolean;
  /** API keys and outbound webhooks. */
  apiAccess: boolean;
  /** Field-level preview of what a plan will change, before confirming it. */
  planDiff: boolean;
  /** Which bulk export formats are offered. */
  exportFormats: readonly ExportFormat[];
}

/**
 * Every flag whose value is a plain yes/no.
 *
 * Exists so {@link Entitlements}' numeric and list-valued flags cannot be asked
 * for as booleans — `useEntitlement("aiRequestsPerDay")` would otherwise compile
 * and always answer "yes, they have some number of requests", which is the kind
 * of gate that silently never blocks anything.
 */
export type BooleanEntitlement = {
  [K in keyof Entitlements]: Entitlements[K] extends boolean ? K : never;
}[keyof Entitlements];

export const FREE_ENTITLEMENTS: Entitlements = {
  plan: "free",

  scheduledAgents: false,
  agentPinning: false,
  undoApply: false,
  toolInspector: false,
  customTools: false,
  perAgentMemory: false,
  aiRequestsPerDay: 15,

  historyDays: 30,
  maxSchedules: 0,
  standingInstructions: false,
  documents: false,
  emailDelivery: false,
  calendarSync: false,
  apiAccess: false,
  planDiff: false,
  exportFormats: ["csv"],
};

export const PRO_ENTITLEMENTS: Entitlements = {
  plan: "pro",

  scheduledAgents: true,
  agentPinning: true,
  undoApply: true,
  toolInspector: true,
  customTools: true,
  perAgentMemory: true,
  aiRequestsPerDay: 200,

  historyDays: null,
  maxSchedules: 3,
  standingInstructions: true,
  documents: true,
  emailDelivery: true,
  calendarSync: true,
  apiAccess: true,
  planDiff: true,
  exportFormats: ["csv", "markdown", "ics"],
};

const BY_PLAN: Record<PlanId, Entitlements> = {
  free: FREE_ENTITLEMENTS,
  pro: PRO_ENTITLEMENTS,
};

/** The flag set for a named plan. */
export function entitlementsForPlan(plan: PlanId): Entitlements {
  return BY_PLAN[plan];
}
