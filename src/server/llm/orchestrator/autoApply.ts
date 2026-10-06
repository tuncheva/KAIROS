/**
 * Phase 5: small task and note changes that save without asking.
 *
 * A user can choose, per agent, to let a *small* plan apply as soon as it is
 * drafted instead of waiting for Confirm. The chat then shows what changed with
 * an Undo button where the confirm card would have been.
 *
 * Four conditions, all required:
 *
 * 1. **They opted in** — the personal "Approval" setting is "autoSmall".
 * 2. **The workspace allows it** — an admin can switch it off for everyone.
 * 3. **It can be undone** — undo is an entitlement (`undoApply`). A change that
 *    saved itself with no way back would be the one case this feature must not
 *    produce, so without undo the plan waits for Confirm as before.
 * 4. **The plan is small** — see `agents/smallPlans.ts`.
 *
 * Anything that goes wrong on the way — a setting that cannot be read, a
 * confirm or apply that throws — leaves the plan exactly as drafted, waiting
 * for Confirm. Auto-apply is a shortcut; its failure mode is the normal path.
 */

import "server-only";

import type { TRPCContext } from "~/server/api/trpc";
import { entitlementsFor } from "~/server/billing/entitlements";
import { createLogger } from "~/server/logger";
import { loadAgentConfigSource } from "~/server/llm/agents/config";
import { isSmallNotesPlan, isSmallTaskPlan } from "~/server/llm/agents/smallPlans";
import type { NotesVaultDraft } from "~/server/llm/schemas/a3NotesVaultSchemas";
import type { TaskPlanDraft } from "~/server/llm/schemas/a2TaskPlannerSchemas";

import { a2TaskPlanner } from "./a2TaskPlanner";
import { a3NotesVault } from "./a3NotesVault";

const log = createLogger("agent.autoApply");

/** How many things an auto-applied plan changed, for the chat's one-line receipt. */
export interface AutoApplied {
  changed: number;
}

async function optedIn(
  ctx: TRPCContext,
  userId: string,
  agent: "task_planner" | "notes_vault",
): Promise<boolean> {
  const { settings } = await loadAgentConfigSource(ctx, userId);
  const personal =
    agent === "task_planner"
      ? settings["task_planner.approval"]
      : settings["notes_vault.approval"];
  const allowed =
    agent === "task_planner"
      ? settings["task_planner.allowAutoApply"]
      : settings["notes_vault.allowAutoApply"];
  return personal === "autoSmall" && allowed && (await entitlementsFor(ctx)).undoApply;
}

/** Apply a small task plan now, or return null to leave it for Confirm. */
export async function autoApplyTaskPlan(
  ctx: TRPCContext,
  draftId: string,
  plan: TaskPlanDraft,
): Promise<AutoApplied | null> {
  const userId = ctx.session?.user?.id;
  if (!userId || !isSmallTaskPlan(plan, userId)) return null;

  try {
    if (!(await optedIn(ctx, userId, "task_planner"))) return null;
    const { confirmationToken } = await a2TaskPlanner.taskPlannerConfirm({ ctx, draftId });
    const { results } = await a2TaskPlanner.taskPlannerApply({ ctx, draftId, confirmationToken });
    return {
      changed:
        results.createdTaskIds.length +
        results.updatedTaskIds.length +
        results.statusChangedTaskIds.length,
    };
  } catch (err) {
    log.warn("auto-apply skipped, plan left for confirmation", {
      draftId,
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}

/** Apply a small notes plan now, or return null to leave it for Confirm. */
export async function autoApplyNotesPlan(
  ctx: TRPCContext,
  draftId: string,
  plan: NotesVaultDraft,
): Promise<AutoApplied | null> {
  const userId = ctx.session?.user?.id;
  if (!userId || !isSmallNotesPlan(plan)) return null;

  try {
    if (!(await optedIn(ctx, userId, "notes_vault"))) return null;
    const { confirmationToken } = await a3NotesVault.notesVaultConfirm({ ctx, draftId });
    const { results } = await a3NotesVault.notesVaultApply({ ctx, draftId, confirmationToken });
    return { changed: results.createdNoteIds.length + results.updatedNoteIds.length };
  } catch (err) {
    log.warn("auto-apply skipped, plan left for confirmation", {
      draftId,
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}
