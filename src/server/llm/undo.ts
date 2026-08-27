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
 * - **Edits are now reversible too.** The before-image the apply stores
 *   (`beforeJson`, see `beforeImage.ts`) holds the affected rows as they were, so
 *   an update or a status change can be written back. This is what the comment
 *   here used to describe as impossible; the schema change it called for is done.
 * - **Deletes are still not reversible.** A deleted row's *contents* are in the
 *   before-image, but its id is gone and re-inserting under a new one would
 *   silently break every reference to it — task comments, activity log,
 *   findings. Reported rather than faked.
 * - **A truncated image restores nothing.** Past the snapshot cap the image holds
 *   a count instead of rows. Restoring the stored half and reporting success
 *   would be the worst available outcome, so it refuses and says why.
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

import { parseBeforeImage } from "./beforeImage";

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
    /** Rows written back to their previous contents. */
    tasksRestored: number;
    notesRestored: number;
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

/**
 * What could not be put back, in the user's terms.
 *
 * `unrestoredEdits` is non-zero only when the before-image was missing or
 * truncated — an apply from before the column existed, or a plan too large to
 * snapshot. Distinguished from deletes because the two have different remedies:
 * an unrestorable edit can be fixed by hand, where a deleted row is gone.
 */
function describeIrreversible(input: {
  unrestoredEdits: number;
  deleted: number;
  truncated: boolean;
  noun: string;
}): string[] {
  const out: string[] = [];

  if (input.truncated) {
    out.push(
      `This plan changed too many ${input.noun} to record their previous contents, so the edits can't be rolled back.`,
    );
  } else if (input.unrestoredEdits > 0) {
    out.push(
      `${String(input.unrestoredEdits)} ${input.noun} were edited before change history was kept, so I can't restore them.`,
    );
  }

  if (input.deleted > 0) {
    out.push(
      `${String(input.deleted)} ${input.noun} were deleted. I have their contents but not their identity, so re-creating them would break anything that referred to them.`,
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
      beforeJson: agentTaskPlannerApplies.beforeJson,
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

  // Put edited rows back.
  //
  // Deleted rows are deliberately excluded even though the image holds them: the
  // row is gone and re-inserting it would take a new id, silently orphaning every
  // comment, activity-log entry and finding that pointed at the old one.
  const editedIds = new Set([
    ...(results.updatedTaskIds ?? []),
    ...(results.statusChangedTaskIds ?? []),
  ]);
  const deletedIds = new Set(results.deletedTaskIds ?? []);
  for (const id of deletedIds) editedIds.delete(id);

  const before = parseBeforeImage(applyRow.beforeJson);
  let tasksRestored = 0;

  if (before && !before.truncated) {
    for (const snapshot of before.tasks ?? []) {
      if (!editedIds.has(snapshot.id)) continue;

      const restored = await ctx.db
        .update(tasks)
        .set({
          title: snapshot.title ? String(snapshot.title) : undefined,
          description: snapshot.description as string | null,
          status: snapshot.status as never,
          priority: snapshot.priority as never,
          assignedToId: (snapshot.assignedToId as string | null) ?? null,
          dueDate: snapshot.dueDate ? new Date(String(snapshot.dueDate)) : null,
          orderIndex:
            typeof snapshot.orderIndex === "number"
              ? snapshot.orderIndex
              : undefined,
          completedAt: snapshot.completedAt
            ? new Date(String(snapshot.completedAt))
            : null,
          completedById: (snapshot.completedById as string | null) ?? null,
          completionNote: (snapshot.completionNote as string | null) ?? null,
          lastEditedById: userId,
          lastEditedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(tasks.id, snapshot.id),
            // Re-scoped, like the delete above. The apply row is a record of what
            // happened, not a licence to write to those ids later.
            eq(tasks.projectId, applyRow.projectId),
          ),
        )
        .returning({ id: tasks.id });

      tasksRestored += restored.length;
    }
  }

  log.info("undid a task apply", { draftId, tasksDeleted, tasksRestored });

  return {
    undone: { tasksDeleted, notesDeleted: 0, tasksRestored, notesRestored: 0 },
    notReversed: describeIrreversible({
      // Only edits that were *not* restored are reported as lost.
      unrestoredEdits: editedIds.size - tasksRestored,
      deleted: deletedIds.size,
      truncated: Boolean(before?.truncated),
      noun: "tasks",
    }),
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
      beforeJson: agentNotesVaultApplies.beforeJson,
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

  // Notes follow the same rule as tasks: edits are restorable from the image,
  // deletes are not, because the id is what other rows point at.
  const editedNoteIds = new Set(results.updatedNoteIds ?? []);
  const deletedNoteIds = new Set(results.deletedNoteIds ?? []);
  for (const id of deletedNoteIds) editedNoteIds.delete(id);

  const before = parseBeforeImage(applyRow.beforeJson);
  let notesRestored = 0;

  if (before && !before.truncated) {
    for (const snapshot of before.notes ?? []) {
      if (!editedNoteIds.has(snapshot.id)) continue;

      const restored = await ctx.db
        .update(stickyNotes)
        .set({
          title: snapshot.title,
          content: snapshot.content ?? "",
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(stickyNotes.id, snapshot.id),
            eq(stickyNotes.createdById, userId),
          ),
        )
        .returning({ id: stickyNotes.id });

      notesRestored += restored.length;
    }
  }

  return {
    undone: { tasksDeleted: 0, notesDeleted, tasksRestored: 0, notesRestored },
    notReversed: describeIrreversible({
      unrestoredEdits: editedNoteIds.size - notesRestored,
      deleted: deletedNoteIds.size,
      truncated: Boolean(before?.truncated),
      noun: "notes",
    }),
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
