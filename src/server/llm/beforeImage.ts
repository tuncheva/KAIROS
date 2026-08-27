/**
 * What the rows looked like before a plan touched them.
 *
 * One column, `*_applies.beforeJson`, unblocks two features that were both
 * described as impossible in `undo.ts`:
 *
 * - **A real rollback.** Undo could delete what a plan created and nothing else,
 *   because the apply row recorded *which* rows were edited and never their prior
 *   contents. With a before-image, an edit is reversible.
 * - **A field-level preview.** "This will change 12 tasks" is not a review. "Due
 *   date: 4 Sep → 18 Sep" is. The same stored shape answers both, which is why it
 *   is one column rather than two.
 *
 * The module is deliberately mechanical: capture, cap, diff, restore-shape. It
 * holds no policy about *when* to do any of that, so the decision logic can be
 * tested without a database and the storage format has exactly one definition.
 */

import "server-only";

/**
 * Fields worth remembering for a task.
 *
 * An explicit list, not the whole row. Two reasons: a before-image should not
 * quietly become a second copy of the table, and restoring a column the planner
 * never touches — `createdById`, `clientRequestId` — would turn undo into a
 * vector for corrupting provenance.
 */
export const TASK_BEFORE_FIELDS = [
  "title",
  "description",
  "status",
  "priority",
  "assignedToId",
  "dueDate",
  "orderIndex",
  "completedAt",
  "completedById",
  "completionNote",
] as const;

export type TaskBeforeField = (typeof TASK_BEFORE_FIELDS)[number];

/** A task as it was, keyed by id. Values are JSON-safe. */
export type TaskSnapshot = {
  id: number;
} & Partial<Record<TaskBeforeField, string | number | null>>;

export interface NoteSnapshot {
  id: number;
  title: string | null;
  content: string | null;
}

/**
 * How many rows a before-image will hold.
 *
 * A plan that rewrites four hundred tasks is legitimate, and storing four hundred
 * full rows on every such apply would make these tables the largest in the
 * database for data that is only useful for ten minutes. Past the cap the image
 * records the count and stops, and `truncated` says so — which is what stops undo
 * silently restoring the first fifty and reporting success.
 */
export const MAX_SNAPSHOT_ROWS = 50;

export interface BeforeImage {
  tasks?: TaskSnapshot[];
  notes?: NoteSnapshot[];
  /** True when more rows were affected than the image holds. */
  truncated: boolean;
  /** How many were affected in total, including any not stored. */
  affected: number;
}

/**
 * Build a stored image from rows already read.
 *
 * Takes rows rather than fetching them, so the caller controls the query and the
 * scoping — a before-image must never be the place that decides which rows a user
 * may see.
 */
export function buildBeforeImage(input: {
  tasks?: TaskSnapshot[];
  notes?: NoteSnapshot[];
}): BeforeImage {
  const tasks = input.tasks ?? [];
  const notes = input.notes ?? [];
  const affected = tasks.length + notes.length;

  if (affected <= MAX_SNAPSHOT_ROWS) {
    return {
      ...(tasks.length ? { tasks } : {}),
      ...(notes.length ? { notes } : {}),
      truncated: false,
      affected,
    };
  }

  // Tasks first, then notes, filling the budget. Arbitrary but stable: what
  // matters is that the count is honest, not which half survived.
  const keptTasks = tasks.slice(0, MAX_SNAPSHOT_ROWS);
  const keptNotes = notes.slice(0, Math.max(0, MAX_SNAPSHOT_ROWS - keptTasks.length));

  return {
    ...(keptTasks.length ? { tasks: keptTasks } : {}),
    ...(keptNotes.length ? { notes: keptNotes } : {}),
    truncated: true,
    affected,
  };
}

/** Parse a stored image, tolerating rows written before the column existed. */
export function parseBeforeImage(json: string | null): BeforeImage | null {
  if (!json) return null;

  try {
    const parsed = JSON.parse(json) as BeforeImage;
    // A malformed image must read as absent rather than as empty: "nothing was
    // changed" and "we do not know what was changed" are different answers.
    if (typeof parsed !== "object") return null;
    return {
      tasks: parsed.tasks,
      notes: parsed.notes,
      truncated: Boolean(parsed.truncated),
      affected: typeof parsed.affected === "number" ? parsed.affected : 0,
    };
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Diffing, for the preview
// ---------------------------------------------------------------------------

export interface FieldChange {
  field: string;
  before: string | number | null;
  after: string | number | null;
}

export interface RowDiff {
  kind: "create" | "update" | "delete";
  /** Null for a create, which has no row yet. */
  id: number | null;
  /** A human label — the task title — so the diff reads without a second lookup. */
  label: string;
  changes: FieldChange[];
}

/**
 * Render a value as text for comparison and display.
 *
 * Objects go through `JSON.stringify` rather than `String`, which would make
 * every object `"[object Object]"` — and therefore make two *different* objects
 * compare as equal, silently hiding a real change from the person reviewing it.
 * No planner field is an object today; this is what stops the next one being a
 * quiet diff bug.
 */
function textOf(value: string | number | boolean | object): string {
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "object") {
    try {
      return JSON.stringify(value);
    } catch {
      // Circular, which nothing from a plan or a row should be. Treated as
      // "cannot compare" rather than as equal to anything else.
      return "[unserialisable]";
    }
  }
  return String(value);
}

/** Compare two JSON-safe values the way a reviewer would. */
function sameValue(a: unknown, b: unknown): boolean {
  // Null and undefined both mean "not set" here. A patch that omits a field and
  // a row whose field is null are not a change, and showing one would fill every
  // diff with noise.
  if (a === null || a === undefined) return b === null || b === undefined;
  if (b === null || b === undefined) return false;

  // Dates arrive as `Date` from the database and as ISO strings from a plan, so
  // the same instant has two representations. Compared as instants.
  if (a instanceof Date || b instanceof Date) {
    const at = a instanceof Date ? a.getTime() : Date.parse(textOf(a as string));
    const bt = b instanceof Date ? b.getTime() : Date.parse(textOf(b as string));
    // An unparseable side falls through to text comparison rather than being
    // declared equal by two NaNs.
    if (!Number.isNaN(at) && !Number.isNaN(bt)) return at === bt;
  }

  return textOf(a as string | number | boolean | object) ===
    textOf(b as string | number | boolean | object);
}

function display(value: unknown): string | number | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "number") return value;
  return textOf(value as string | boolean | object);
}

/**
 * The field-level changes an update would make.
 *
 * Only fields that actually differ are reported. A plan's patch routinely carries
 * a field at its existing value — the model restating what it read — and a diff
 * that lists those is a diff nobody reads to the end.
 */
export function diffUpdate(input: {
  current: Record<string, unknown>;
  patch: Record<string, unknown>;
}): FieldChange[] {
  const changes: FieldChange[] = [];

  for (const [field, next] of Object.entries(input.patch)) {
    // `undefined` in a patch means "not part of this change", which is distinct
    // from `null` meaning "clear it".
    if (next === undefined) continue;

    const current = input.current[field];
    if (sameValue(current, next)) continue;

    changes.push({
      field,
      before: display(current),
      after: display(next),
    });
  }

  return changes;
}

export interface PlanDiff {
  rows: RowDiff[];
  /** Rows the plan references that no longer exist, by id. */
  missing: number[];
  counts: { creates: number; updates: number; deletes: number };
}

/**
 * Build the whole preview for a task plan.
 *
 * Rows the plan references that have since disappeared are reported rather than
 * skipped. A plan drafted two minutes ago can name a task a colleague has just
 * deleted, and the honest preview says so — silently dropping it would show a
 * confirmation card that does less than it claims.
 */
export function diffTaskPlan(input: {
  creates: Array<{ title: string }>;
  updates: Array<{ taskId: number; patch: Record<string, unknown> }>;
  statusChanges: Array<{ taskId: number; status: string }>;
  deletes: Array<{ taskId: number }>;
  current: Map<number, Record<string, unknown> & { title?: string }>;
}): PlanDiff {
  const rows: RowDiff[] = [];
  const missing: number[] = [];

  for (const create of input.creates) {
    rows.push({
      kind: "create",
      id: null,
      label: create.title,
      changes: [],
    });
  }

  const pushUpdate = (
    taskId: number,
    patch: Record<string, unknown>,
  ): void => {
    const current = input.current.get(taskId);
    if (!current) {
      missing.push(taskId);
      return;
    }

    const changes = diffUpdate({ current, patch });
    // An update whose every field already matches is a no-op. Listing it would
    // inflate the count the user is asked to approve.
    if (!changes.length) return;

    rows.push({
      kind: "update",
      id: taskId,
      label: String(current.title ?? `Task ${String(taskId)}`),
      changes,
    });
  };

  for (const update of input.updates) pushUpdate(update.taskId, update.patch);
  // Status changes are updates with one field. Folded in rather than shown
  // separately, because to a reviewer "status: pending → completed" is the same
  // kind of statement as "priority: low → high".
  for (const change of input.statusChanges) {
    pushUpdate(change.taskId, { status: change.status });
  }

  for (const del of input.deletes) {
    const current = input.current.get(del.taskId);
    if (!current) {
      missing.push(del.taskId);
      continue;
    }
    rows.push({
      kind: "delete",
      id: del.taskId,
      label: String(current.title ?? `Task ${String(del.taskId)}`),
      changes: [],
    });
  }

  return {
    rows,
    missing,
    counts: {
      creates: rows.filter((r) => r.kind === "create").length,
      updates: rows.filter((r) => r.kind === "update").length,
      deletes: rows.filter((r) => r.kind === "delete").length,
    },
  };
}
