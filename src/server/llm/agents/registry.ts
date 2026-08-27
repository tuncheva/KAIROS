/**
 * Every agent KAIROS runs, in one list.
 *
 * Agent identity was spread across four places that had to be kept in step by
 * hand: the `AgentId` union in `orchestrator/shared.ts`, the `AgentProfile`
 * objects under `profiles/` (which existed for A1, A2 and A4 but not A3 or A5),
 * the dispatch switch in `orchestrator/handoff.ts`, and A1's `routingRules`. A
 * picker needs a single list it can render, and an inspector needs a single list
 * it can describe, so this is that list.
 *
 * **What this is not.** It does not replace the profiles. `a1WorkspaceConcierge`
 * still owns the allowlist A1 actually runs with — see the note on `tools` below.
 * This is the description layer: what exists, what it is called, what it can do.
 *
 * On the split between `tools` and `operations`: only A1 calls tools. The write
 * agents receive a pre-built context pack from their `context/aNContextBuilder`
 * and emit a plan in one model call, so "which tools does the Task Planner have"
 * has no honest answer — it has *operations* it can put in a plan instead. The
 * two fields keep that distinction visible rather than flattening both into a
 * "tools" list that would be half fiction.
 */

import "server-only";

import { TargetAgentSchema } from "~/server/llm/schemas/a1WorkspaceConciergeSchemas";
import { a1WorkspaceConciergeProfile } from "~/server/llm/profiles/a1WorkspaceConcierge";
import type { A1ReadToolName } from "~/server/llm/tools/a1/readTools";

/**
 * Conversational agents take a message and answer or draft. Scheduled agents run
 * on the clock with no chat surface at all, so they are listed but never
 * pinnable — see {@link isPinnable}.
 */
export type AgentKind = "conversational" | "scheduled";

export interface AgentDescriptor {
  id: string;
  /** Untranslated fallback. The UI prefers `agents.<id>.name` from the message files. */
  name: string;
  description: string;
  kind: AgentKind;
  /**
   * Tools the agent calls live, through `runToolLoop`.
   *
   * Only A1 has any. Sourced from its profile rather than restated, so the list
   * the inspector shows is the list the model was actually given.
   */
  tools: readonly A1ReadToolName[];
  /** What this agent can put in a plan. Empty for agents that never write. */
  operations: readonly string[];
  /** Whether applying this agent's plan changes data a teammate could see. */
  writes: boolean;
}

/**
 * The sub-agents A1 can hand off to.
 *
 * Derived from the schema A1's own output is validated against, so a new target
 * agent cannot be added to the model's contract without appearing here too.
 */
export const HANDOFF_TARGETS = TargetAgentSchema.options;

export const AGENTS: readonly AgentDescriptor[] = [
  {
    id: "workspace_concierge",
    name: a1WorkspaceConciergeProfile.name,
    description:
      "Answers questions about your workspace and routes anything that needs a change to the right specialist. Reads only — it cannot alter workspace data.",
    kind: "conversational",
    tools: a1WorkspaceConciergeProfile.draftToolAllowlist,
    operations: [],
    writes: false,
  },
  {
    id: "task_planner",
    name: "Task Planner",
    description:
      "Turns a goal into a backlog, and revises a plan already on screen. Every change is drafted for your approval before anything is written.",
    kind: "conversational",
    tools: [],
    operations: ["create task", "update task", "change task status", "delete task"],
    writes: true,
  },
  {
    id: "notes_vault",
    name: "Notes Vault",
    description:
      "Creates, edits and deletes notes. Locked notes are excluded before their content is ever loaded.",
    kind: "conversational",
    tools: [],
    operations: ["create note", "update note", "delete note"],
    writes: true,
  },
  {
    id: "events_publisher",
    name: "Events Publisher",
    description:
      "Manages public events end to end: the event itself, its comments, RSVPs and likes.",
    kind: "conversational",
    tools: [],
    operations: [
      "create event",
      "update event",
      "delete event",
      "comment on event",
      "delete comment",
      "set RSVP",
      "like event",
    ],
    writes: true,
  },
  {
    id: "org_admin",
    name: "Organization Admin",
    description:
      "Changes membership, roles and permissions. Each operation is authorized on its own against your live membership, so a plan never rides in on one strong permission.",
    kind: "conversational",
    tools: [],
    operations: [
      "change member role",
      "grant or revoke permission",
      "remove member",
      "invite member",
    ],
    writes: true,
  },
  {
    id: "daily_brief",
    name: "Daily Brief",
    description:
      "Runs on a schedule you set and summarises what needs your attention. Nothing fires until you opt in under Settings → AI assistant.",
    kind: "scheduled",
    tools: [],
    operations: [],
    writes: false,
  },
  {
    id: "risk_radar",
    name: "Risk Radar",
    description:
      "Watches for overdue work and stalled projects on a schedule. Detection is a database count, not a model call, so a finding is reproducible and still appears when your AI budget is spent.",
    kind: "scheduled",
    tools: [],
    operations: [],
    writes: false,
  },
] as const;

const BY_ID = new Map(AGENTS.map((a) => [a.id, a] as const));

export function getAgent(id: string): AgentDescriptor | undefined {
  return BY_ID.get(id);
}

/**
 * Whether a client may pin this agent for a conversation.
 *
 * A1 is excluded deliberately: pinning it is the same as Auto, which the caller
 * expresses by sending no agent at all. Scheduled agents are excluded because
 * there is nothing to talk to. What remains is exactly {@link HANDOFF_TARGETS},
 * which is what `runHandoff` can dispatch — so a pinned id is always a value that
 * switch already handles.
 */
export function isPinnable(id: string): boolean {
  return (HANDOFF_TARGETS as readonly string[]).includes(id);
}
