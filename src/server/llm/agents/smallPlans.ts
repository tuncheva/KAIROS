/**
 * What counts as a "small" plan — one a user may let apply without asking.
 *
 * Pure and free of database imports, so the rules are testable on their own;
 * `orchestrator/autoApply.ts` is where they are acted on.
 */

import type { NotesVaultDraft } from "~/server/llm/schemas/a3NotesVaultSchemas";
import type { TaskPlanDraft } from "~/server/llm/schemas/a2TaskPlannerSchemas";

/** The most changes a plan may carry and still apply without asking. */
export const AUTO_APPLY_MAX_CHANGES = 3;

/**
 * Whether a task plan is small enough to apply without asking.
 *
 * At most three changes, counting every kind; no deletes, since undo cannot
 * bring a deleted task back; nothing handed to someone else, since that lands
 * on another person's list before anyone looked; and no open question, since a
 * plan that asks is not finished.
 */
export function isSmallTaskPlan(plan: TaskPlanDraft, requesterId: string): boolean {
  if (plan.deletes.length > 0) return false;
  if (plan.questionsForUser.length > 0) return false;

  const changes =
    plan.creates.length +
    plan.updates.length +
    plan.statusChanges.length +
    plan.comments.length +
    plan.dependencies.length;
  if (changes === 0 || changes > AUTO_APPLY_MAX_CHANGES) return false;

  const assignsSomeoneElse =
    plan.creates.some((c) => c.assignedToId !== undefined && c.assignedToId !== requesterId) ||
    plan.updates.some(
      // `null` takes a task off whoever has it, which is their list too.
      (u) => u.patch.assignedToId !== undefined && u.patch.assignedToId !== requesterId,
    );
  return !assignsSomeoneElse;
}

/**
 * Whether a notes plan is small enough to apply without asking.
 *
 * At most three changes and no deletes, as for tasks; nothing blocked, and no
 * edit to a locked note, which needs its password in the confirm step.
 */
export function isSmallNotesPlan(plan: NotesVaultDraft): boolean {
  if (plan.blocked.length > 0) return false;
  const ops = plan.operations;
  if (ops.length === 0 || ops.length > AUTO_APPLY_MAX_CHANGES) return false;
  return ops.every(
    (op) => op.type !== "delete" && !(op.type === "update" && op.requiresUnlocked),
  );
}
