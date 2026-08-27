/**
 * The client-side shape of the agent roster.
 *
 * Inferred from the router rather than restated, so a change to what
 * `agent.agents` returns is a compile error here rather than a field that
 * silently renders as `undefined`.
 */

import type { inferRouterOutputs } from "@trpc/server";

import type { AppRouter } from "~/server/api/root";

type RouterOutputs = inferRouterOutputs<AppRouter>;

export type AgentSummary = RouterOutputs["agent"]["agents"][number];
export type AgentTool = AgentSummary["tools"][number];
export type MemoryFactRow = RouterOutputs["agent"]["memory"][number];
