/**
 * G-5 — undo an applied plan.
 *
 * The confidence to press **Apply** comes from knowing you can take it back. That
 * is the whole argument for this module: the draft/confirm/apply lifecycle makes
 * a plan *reviewable*, but reviewing thirty proposed tasks properly is real work,
 * and most people will skim. Undo is what makes skimming safe.
 *
 * What it can and cannot reverse, stated plainly because the UI must not promise
 * more than this:
 *
 * - **Creates are reversible.** The apply row records exactly which ids were
 *   inserted, and deleting those ids restores the previous state exactly.
 * - **Updates and deletes are not.** The applies table records *which* rows were
 *   touched, never their prior contents, so there is nothing to restore them
 *   from. Reconstructing that would mean a full before-image in every apply row —
 *   worth doing, but it is a schema change and a migration, not something to fake
 *   here by guessing.
 *
 * So undo removes what was created and reports honestly about the rest, rather
 * than claiming a rollback it cannot perform.
 */

import "server-only";

import { TRPCError } from "@trpc/server";
import { and, eq, inArray } from "drizzle-orm";

import type { TRPCContext } from "~/server/api/trpc";
import { assertProjectAccess } from "~/server/api/authz";
import {
  agentTaskPlannerApplies,
  agentNotesVaultApplies,
  stickyNotes,
  tasks,
} from "~/server/db/schema";
import { createLogger } from "~/server/logger";

const log = createLogger("llm.undo");

/**
 * How long an apply stays undoable.
 *
 * Ten minutes matches the confirmation token's lifetime. Longer would mean
 * undoing work colleagues have since built on; shorter would not survive someone
 * being interrupted right after clicking Apply, which is exactly when they
 * notice the mistake.
 */
export const UNDO_WINDOW_MS = 10 * 60 * 1000;

export interface UndoResult {
  undone: {
    tasksDeleted: number;
    notesDeleted: number;
  };
  /** Operations that cannot be reversed, phrased for the user. */
  notReversed: string[];
}

interface TaskApplyResults {
  createdTaskIds?: number[];
  updatedTaskIds?: number[];
  statusChangedTaskIds?: number[];
  deletedTaskIds?: number[];
}

interface NoteApplyResults {
  createdNoteIds?: number[];
  updatedNoteIds?: number[];
  deletedNoteIds?: number[];
}

function withinWindow(createdAt: Date): boolean {
  return Date.now() - createdAt.getTime() <= UNDO_WINDOW_MS;
}

function describeIrreversible(
  updated: number,
  deleted: number,
  noun: string,
): string[] {
  const out: string[] = [];
  if (updated > 0) {
    out.push(
      `${String(updated)} ${noun} were edited. I can't restore their previous contents — that isn't recorded.`,
    );
  }
  if (deleted > 0) {
    out.push(
      `${String(deleted)} ${noun} were deleted. Deletions can't be undone from here.`,
    );
  }
  return out;
}

/**
 * Undo a task-planner apply.
 *
 * Deletes are scoped by project as well as by id, and every project is
 * re-authorized: an apply row is a record of what happened, not a licence to
 * touch those rows again later.
 */
export async function undoTaskApply(
  ctx: TRPCContext,
  userId: string,
  draftId: string,
): Promise<UndoResult> {
  const [applyRow] = await ctx.db
    .select({
      id: agentTaskPlannerApplies.id,
      userId: agentTaskPlannerApplies.userId,
      projectId: agentTaskPlannerApplies.projectId,
      resultJson: agentTaskPlannerApplies.resultJson,
      createdAt: agentTaskPlannerApplies.createdAt,
    })
    .from(agentTaskPlannerApplies)
    .where(eq(agentTaskPlannerApplies.draftId, draftId))
    .limit(1);

  if (!applyRow) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Nothing was applied for that plan." });
  }
  if (applyRow.userId !== userId) {
    throw new TRPCError({ code: "FORBIDDEN" });
  }
  if (!withinWindow(applyRow.createdAt)) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "That change is older than the undo window. Edit or delete the tasks directly instead.",
    });
  }

  await assertProjectAccess(ctx, applyRow.projectId, "write");

  const results = JSON.parse(applyRow.resultJson) as TaskApplyResults;
  const created = results.createdTaskIds ?? [];

  let tasksDeleted = 0;
  if (created.length) {
    const removed = await ctx.db
      .delete(tasks)
      .where(
        and(inArray(tasks.id, created), eq(tasks.projectId, applyRow.projectId)),
      )
      .returning({ id: tasks.id });
    tasksDeleted = removed.length;
  }

  log.info("undid a task apply", { draftId, tasksDeleted });

  return {
    undone: { tasksDeleted, notesDeleted: 0 },
    notReversed: describeIrreversible(
      (results.updatedTaskIds?.length ?? 0) +
        (results.statusChangedTaskIds?.length ?? 0),
      results.deletedTaskIds?.length ?? 0,
      "tasks",
    ),
  };
}

/** Undo a notes-vault apply. Own notes only, which is all A3 can create. */
export async function undoNoteApply(
  ctx: TRPCContext,
  userId: string,
  draftId: string,
): Promise<UndoResult> {
  const [applyRow] = await ctx.db
    .select({
      userId: agentNotesVaultApplies.userId,
      resultJson: agentNotesVaultApplies.resultJson,
      createdAt: agentNotesVaultApplies.createdAt,
    })
    .from(agentNotesVaultApplies)
    .where(eq(agentNotesVaultApplies.draftId, draftId))
    .limit(1);

  if (!applyRow) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Nothing was applied for that plan." });
  }
  if (applyRow.userId !== userId) throw new TRPCError({ code: "FORBIDDEN" });
  if (!withinWindow(applyRow.createdAt)) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "That change is older than the undo window. Delete the notes directly instead.",
    });
  }

  const results = JSON.parse(applyRow.resultJson) as NoteApplyResults;
  const created = results.createdNoteIds ?? [];

  let notesDeleted = 0;
  if (created.length) {
    const removed = await ctx.db
      .delete(stickyNotes)
      .where(
        and(
          inArray(stickyNotes.id, created),
          // Ownership in the same statement — no read-then-delete window.
          eq(stickyNotes.createdById, userId),
        ),
      )
      .returning({ id: stickyNotes.id });
    notesDeleted = removed.length;
  }

  return {
    undone: { tasksDeleted: 0, notesDeleted },
    notReversed: describeIrreversible(
      results.updatedNoteIds?.length ?? 0,
      results.deletedNoteIds?.length ?? 0,
      "notes",
    ),
  };
}

/**
 * Whether an apply is still undoable, for rendering the button.
 *
 * Returns the deadline too, so the UI can count down rather than offering a
 * button that fails when pressed.
 */
export async function undoAvailability(
  ctx: TRPCContext,
  userId: string,
  draftId: string,
): Promise<{ available: boolean; expiresAt: Date | null }> {
  const [taskApply] = await ctx.db
    .select({
      userId: agentTaskPlannerApplies.userId,
      createdAt: agentTaskPlannerApplies.createdAt,
    })
    .from(agentTaskPlannerApplies)
    .where(eq(agentTaskPlannerApplies.draftId, draftId))
    .limit(1);

  const [noteApply] = taskApply
    ? [undefined]
    : await ctx.db
        .select({
          userId: agentNotesVaultApplies.userId,
          createdAt: agentNotesVaultApplies.createdAt,
        })
        .from(agentNotesVaultApplies)
        .where(eq(agentNotesVaultApplies.draftId, draftId))
        .limit(1);

  const row = taskApply ?? noteApply;
  if (row?.userId !== userId) return { available: false, expiresAt: null };

  const expiresAt = new Date(row.createdAt.getTime() + UNDO_WINDOW_MS);
  return { available: expiresAt.getTime() > Date.now(), expiresAt };
}
