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
 */

import { TRPCError } from "@trpc/server";

import { createLogger } from "~/server/logger";
import type { A1Output } from "~/server/llm/schemas/a1WorkspaceConciergeSchemas";
import type { TaskPlanDraft } from "~/server/llm/schemas/a2TaskPlannerSchemas";
import type { NotesVaultDraft } from "~/server/llm/schemas/a3NotesVaultSchemas";
import type { EventsPublisherDraft } from "~/server/llm/schemas/a4EventsPublisherSchemas";

import { a1Concierge } from "./a1Concierge";
import { a2TaskPlanner } from "./a2TaskPlanner";
import { a3NotesVault } from "./a3NotesVault";
import { a4EventsPublisher } from "./a4EventsPublisher";
import type { AgentDraftInput } from "./shared";

const log = createLogger("agent.handoff");

export type AgentTurnResult = {
  /** A1's own draft id, always present. */
  draftId: string;
  /** Whatever A1 produced, including its handoff decision. */
  a1: A1Output;
  /** Set when A1 handed off and the sub-agent produced a plan. */
  plan?:
    | { kind: "tasks"; draftId: string; plan: TaskPlanDraft }
    | { kind: "notes"; draftId: string; plan: NotesVaultDraft }
    | { kind: "events"; draftId: string; plan: EventsPublisherDraft };
  /** Set when the handoff itself failed, so the UI can say why. */
  handoffError?: string;
};

export interface AgentTurnInput extends Omit<AgentDraftInput, "agentId"> {
  /** Fires when a sub-agent starts, so a streaming caller can show progress. */
  onSubAgent?: (agent: string) => void;
}

/**
 * Run A1, then whichever sub-agent it hands off to.
 *
 * A failing sub-agent does not fail the turn: A1's answer is already useful, and
 * "I couldn't draft that" beats a 500 that discards both.
 */
export async function runAgentTurn(
  input: AgentTurnInput,
): Promise<AgentTurnResult> {
  const { draftId, outputJson } = await a1Concierge.draft({
    ...input,
    agentId: "workspace_concierge",
  });

  const a1 = outputJson;
  const handoff = a1.handoff;

  if (a1.intent.type !== "handoff" || !handoff) {
    return { draftId, a1 };
  }

  const message = handoff.userIntent || input.message;
  const handoffContext = handoff.context;

  try {
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
        });
        return {
          draftId,
          a1,
          plan: { kind: "tasks", draftId: res.draftId, plan: res.plan },
        };
      }

      case "notes_vault": {
        input.onSubAgent?.("notes_vault");
        const res = await a3NotesVault.notesVaultDraft({
          ctx: input.ctx,
          message,
          handoffContext,
        });
        return {
          draftId,
          a1,
          plan: { kind: "notes", draftId: res.draftId, plan: res.plan },
        };
      }

      case "events_publisher": {
        input.onSubAgent?.("events_publisher");
        const res = await a4EventsPublisher.eventsPublisherDraft({
          ctx: input.ctx,
          message,
          handoffContext,
        });
        return {
          draftId,
          a1,
          plan: { kind: "events", draftId: res.draftId, plan: res.plan },
        };
      }

      // `org_admin` is in the schema's target list but has no agent behind it.
      // Say so rather than silently dropping the request.
      default:
        return {
          draftId,
          a1,
          handoffError: `The ${handoff.targetAgent} agent is not available yet.`,
        };
    }
  } catch (err) {
    log.error("handoff sub-agent failed", {
      targetAgent: handoff.targetAgent,
      err,
    });
    return {
      draftId,
      a1,
      handoffError:
        err instanceof TRPCError
          ? err.message
          : err instanceof Error
            ? err.message
            : "The sub-agent failed to produce a plan.",
    };
  }
}
