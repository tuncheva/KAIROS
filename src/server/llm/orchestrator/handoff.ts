/**
 * One user message, one server-side turn.
 *
 * A1 decides whether it can answer or needs a sub-agent, and when it hands off,
 * that sub-agent runs here — in the same request — so the caller gets a single
 * result to render.
 *
 * The client used to do this: read A1's `handoff.targetAgent`, then fire a second
 * tRPC mutation, then reconstruct state from the rendered bubble text. It also
 * second-guessed A1 entirely, routing any message containing "note" or "event"
 * straight to a write agent on a substring match — so "what events are coming
 * up?" reached the events *publisher* rather than a read-only answer, and only in
 * English. Routing belongs to the agent that was built for it.
 *
 * E-2: a turn may now run up to three sub-agents. "Break down Alpha, note the
 * risks, and schedule the kickoff" is one sentence and three domains, and the
 * single-handoff version silently delivered whichever third A1 picked. They run
 * sequentially — the sub-agents each cost a model call, and running them in
 * parallel would multiply the peak load for a turn the user is already waiting
 * on — and each one's failure is contained to itself.
 */

import { TRPCError } from "@trpc/server";

import { createLogger } from "~/server/logger";
import type {
  A1Output,
  HandoffPlan,
} from "~/server/llm/schemas/a1WorkspaceConciergeSchemas";
import type { TaskPlanDraft } from "~/server/llm/schemas/a2TaskPlannerSchemas";
import type { NotesVaultDraft } from "~/server/llm/schemas/a3NotesVaultSchemas";
import type { EventsPublisherDraft } from "~/server/llm/schemas/a4EventsPublisherSchemas";
import type { OrgAdminDraft } from "~/server/llm/schemas/a5OrgAdminSchemas";

import { a1Concierge } from "./a1Concierge";
import { a2TaskPlanner } from "./a2TaskPlanner";
import { a3NotesVault } from "./a3NotesVault";
import { a4EventsPublisher } from "./a4EventsPublisher";
import { a5OrgAdmin } from "./a5OrgAdmin";
import type { AgentDraftInput } from "./shared";

const log = createLogger("agent.handoff");

/** Hard ceiling on sub-agents per turn, independent of what the schema allowed. */
const MAX_SUB_AGENTS = 3;

export type AgentPlan =
  | { kind: "tasks"; draftId: string; plan: TaskPlanDraft }
  | { kind: "notes"; draftId: string; plan: NotesVaultDraft }
  | { kind: "events"; draftId: string; plan: EventsPublisherDraft }
  | { kind: "org"; draftId: string; plan: OrgAdminDraft };

export type AgentTurnResult = {
  /** A1's own draft id, always present. */
  draftId: string;
  /** Whatever A1 produced, including its handoff decisions. */
  a1: A1Output;
  /** Every plan produced this turn, in the order A1 asked for them. */
  plans: AgentPlan[];
  /**
   * The first plan, for callers that only ever render one.
   *
   * Kept so the existing chat UI keeps working unchanged while `plans` becomes
   * the thing to read.
   */
  plan?: AgentPlan;
  /** One entry per handoff that failed, so the UI can say which and why. */
  handoffErrors: string[];
};

export interface AgentTurnInput extends Omit<AgentDraftInput, "agentId"> {
  /** Fires when a sub-agent starts, so a streaming caller can show progress. */
  onSubAgent?: (agent: string) => void;
  /**
   * E-3 — the task plan currently on screen, if the user is refining it.
   *
   * The client sends this whenever an unapplied plan is still rendered, so
   * "actually, make the third one urgent" revises that plan instead of drafting
   * a second one beside it.
   */
  priorTaskDraftId?: string;
}

function errorText(err: unknown): string {
  if (err instanceof TRPCError) return err.message;
  if (err instanceof Error) return err.message;
  return "The sub-agent failed to produce a plan.";
}

/**
 * Run one handoff.
 *
 * Returns a plan or throws; the caller decides what a failure means for the turn
 * as a whole.
 */
async function runHandoff(
  input: AgentTurnInput,
  handoff: HandoffPlan,
  fallbackMessage: string,
): Promise<AgentPlan> {
  const message = handoff.userIntent || fallbackMessage;
  const handoffContext = handoff.context;

  switch (handoff.targetAgent) {
    case "task_planner": {
      input.onSubAgent?.("task_planner");
      const res = await a2TaskPlanner.taskPlannerDraft({
        ctx: input.ctx,
        message,
        scope: {
          orgId: input.scope?.orgId,
          projectId:
            typeof input.scope?.projectId === "number"
              ? input.scope.projectId
              : undefined,
        },
        handoffContext,
        priorDraftId: input.priorTaskDraftId,
      });
      return { kind: "tasks", draftId: res.draftId, plan: res.plan };
    }

    case "notes_vault": {
      input.onSubAgent?.("notes_vault");
      const res = await a3NotesVault.notesVaultDraft({
        ctx: input.ctx,
        message,
        handoffContext,
      });
      return { kind: "notes", draftId: res.draftId, plan: res.plan };
    }

    case "events_publisher": {
      input.onSubAgent?.("events_publisher");
      const res = await a4EventsPublisher.eventsPublisherDraft({
        ctx: input.ctx,
        message,
        handoffContext,
      });
      return { kind: "events", draftId: res.draftId, plan: res.plan };
    }

    case "org_admin": {
      input.onSubAgent?.("org_admin");
      const res = await a5OrgAdmin.orgAdminDraft({
        ctx: input.ctx,
        message,
        handoffContext,
      });
      return { kind: "org", draftId: res.draftId, plan: res.plan };
    }
  }
}

/**
 * Run A1, then whichever sub-agents it hands off to.
 *
 * A failing sub-agent does not fail the turn: A1's answer is already useful, and
 * "I couldn't draft that" beats a 500 that discards both. With several handoffs,
 * one failing does not stop the others either — two plans and one apology is a
 * better turn than nothing.
 */
export async function runAgentTurn(
  input: AgentTurnInput,
): Promise<AgentTurnResult> {
  const { draftId, outputJson } = await a1Concierge.draft({
    ...input,
    agentId: "workspace_concierge",
  });

  const a1 = outputJson;
  const handoffs = a1.handoffs.slice(0, MAX_SUB_AGENTS);

  if (a1.intent.type !== "handoff" || handoffs.length === 0) {
    return { draftId, a1, plans: [], handoffErrors: [] };
  }

  const plans: AgentPlan[] = [];
  const handoffErrors: string[] = [];

  for (const handoff of handoffs) {
    try {
      plans.push(await runHandoff(input, handoff, input.message));
    } catch (err) {
      log.error("handoff sub-agent failed", {
        targetAgent: handoff.targetAgent,
        err,
      });
      handoffErrors.push(errorText(err));
    }
  }

  return { draftId, a1, plans, plan: plans[0], handoffErrors };
}
