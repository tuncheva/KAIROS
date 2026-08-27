/**
 * Plan diff and before-images.
 *
 * Two features rest on this module, and they fail in opposite directions.
 *
 * The **preview** fails by being unreadable. A plan's patch routinely restates a
 * field at its current value — the model echoing what it read — so a diff that
 * lists every field in the patch shows twelve "changes" where two are real. A
 * reviewer who has to find the two will skim, which defeats the point of
 * previewing at all.
 *
 * The **rollback** fails by lying. If the before-image was truncated or missing,
 * restoring the half that was stored and reporting success is worse than
 * refusing: the user believes they are back where they started. So the
 * truncation flag is asserted directly, and so is the rule that a malformed
 * image reads as *absent* rather than as empty — "nothing changed" and "we do not
 * know what changed" must not collapse into the same answer.
 */

import { describe, expect, it } from "vitest";

import {
  MAX_SNAPSHOT_ROWS,
  buildBeforeImage,
  diffTaskPlan,
  diffUpdate,
  parseBeforeImage,
} from "~/server/llm/beforeImage";

function current(overrides: Record<string, unknown> = {}) {
  return {
    id: 1,
    title: "Ship the invoice export",
    description: "Original description",
    status: "pending",
    priority: "medium",
    assignedToId: "user_1",
    dueDate: new Date("2026-09-04T00:00:00Z"),
    orderIndex: 0,
    ...overrides,
  };
}

describe("diffUpdate — only real changes", () => {
  it("reports a field that actually changes", () => {
    const changes = diffUpdate({
      current: current(),
      patch: { priority: "high" },
    });

    expect(changes).toEqual([
      { field: "priority", before: "medium", after: "high" },
    ]);
  });

  it("ignores a field restated at its current value", () => {
    // The common case, and the one that makes a naive diff useless.
    const changes = diffUpdate({
      current: current(),
      patch: { priority: "medium", title: "Ship the invoice export" },
    });

    expect(changes).toEqual([]);
  });

  it("ignores a field the patch does not carry", () => {
    // `undefined` means "not part of this change" and must not read as "clear it".
    const changes = diffUpdate({
      current: current(),
      patch: { priority: undefined },
    });

    expect(changes).toEqual([]);
  });

  it("reports clearing a field as a change", () => {
    // `null` does mean "clear it", which is a real change a reviewer must see.
    const changes = diffUpdate({
      current: current(),
      patch: { assignedToId: null },
    });

    expect(changes).toEqual([
      { field: "assignedToId", before: "user_1", after: null },
    ]);
  });

  it("treats an already-empty field set to null as no change", () => {
    const changes = diffUpdate({
      current: current({ assignedToId: null }),
      patch: { assignedToId: null },
    });

    expect(changes).toEqual([]);
  });

  it("compares dates as instants, not as text", () => {
    // The row holds a `Date`; the plan holds an ISO string. The same moment in two
    // representations is not a change, and reporting it would put a spurious row
    // in nearly every diff.
    const changes = diffUpdate({
      current: current(),
      patch: { dueDate: "2026-09-04T00:00:00.000Z" },
    });

    expect(changes).toEqual([]);
  });

  it("reports a genuine date move", () => {
    const changes = diffUpdate({
      current: current(),
      patch: { dueDate: "2026-09-18T00:00:00.000Z" },
    });

    expect(changes).toHaveLength(1);
    expect(changes[0]?.field).toBe("dueDate");
    expect(changes[0]?.after).toContain("2026-09-18");
  });

  it("distinguishes two different objects", () => {
    // `String(obj)` gives "[object Object]" for both, which would hide the change.
    // No planner field is an object today; this is what stops the next one being a
    // silent diff bug.
    const changes = diffUpdate({
      current: { meta: { a: 1 } },
      patch: { meta: { a: 2 } },
    });

    expect(changes).toHaveLength(1);
  });
});

describe("diffTaskPlan", () => {
  const rows = new Map([[1, current()]]);

  it("lists creates without changes, since there is no prior row", () => {
    const diff = diffTaskPlan({
      creates: [{ title: "Write the migration" }],
      updates: [],
      statusChanges: [],
      deletes: [],
      current: rows,
    });

    expect(diff.counts.creates).toBe(1);
    expect(diff.rows[0]).toMatchObject({ kind: "create", id: null, changes: [] });
  });

  it("folds a status change in as an ordinary update", () => {
    // To a reviewer "status: pending → completed" is the same kind of statement as
    // "priority: low → high"; a separate section would just be more to read.
    const diff = diffTaskPlan({
      creates: [],
      updates: [],
      statusChanges: [{ taskId: 1, status: "completed" }],
      deletes: [],
      current: rows,
    });

    expect(diff.counts.updates).toBe(1);
    expect(diff.rows[0]?.changes).toEqual([
      { field: "status", before: "pending", after: "completed" },
    ]);
  });

  it("drops an update that would change nothing", () => {
    // A no-op update must not inflate the count the user is asked to approve.
    const diff = diffTaskPlan({
      creates: [],
      updates: [{ taskId: 1, patch: { priority: "medium" } }],
      statusChanges: [],
      deletes: [],
      current: rows,
    });

    expect(diff.rows).toHaveLength(0);
    expect(diff.counts.updates).toBe(0);
  });

  it("reports a referenced row that no longer exists", () => {
    // A plan drafted two minutes ago can name a task a colleague just deleted.
    // Silently skipping it would show a card that does less than it claims.
    const diff = diffTaskPlan({
      creates: [],
      updates: [{ taskId: 99, patch: { priority: "high" } }],
      statusChanges: [],
      deletes: [],
      current: rows,
    });

    expect(diff.missing).toEqual([99]);
    expect(diff.rows).toHaveLength(0);
  });

  it("labels rows by title so the diff reads on its own", () => {
    const diff = diffTaskPlan({
      creates: [],
      updates: [{ taskId: 1, patch: { priority: "high" } }],
      statusChanges: [],
      deletes: [],
      current: rows,
    });

    expect(diff.rows[0]?.label).toBe("Ship the invoice export");
  });

  it("counts each kind separately", () => {
    const diff = diffTaskPlan({
      creates: [{ title: "New" }],
      updates: [{ taskId: 1, patch: { priority: "high" } }],
      statusChanges: [],
      deletes: [{ taskId: 1 }],
      current: rows,
    });

    expect(diff.counts).toEqual({ creates: 1, updates: 1, deletes: 1 });
  });
});

describe("buildBeforeImage", () => {
  function tasks(n: number) {
    return Array.from({ length: n }, (_, i) => ({ id: i + 1, title: `T${String(i)}` }));
  }

  it("stores everything when under the cap", () => {
    const image = buildBeforeImage({ tasks: tasks(3) });

    expect(image.truncated).toBe(false);
    expect(image.tasks).toHaveLength(3);
    expect(image.affected).toBe(3);
  });

  it("truncates past the cap and says so", () => {
    // Storing hundreds of full rows on every large apply would make these tables
    // the biggest in the database, for data useful for ten minutes.
    const image = buildBeforeImage({ tasks: tasks(MAX_SNAPSHOT_ROWS + 10) });

    expect(image.truncated).toBe(true);
    expect(image.tasks).toHaveLength(MAX_SNAPSHOT_ROWS);
  });

  it("reports the true affected count even when truncated", () => {
    // The count is what makes the truncation honest. Undo refuses on this flag, so
    // an understated total would turn a refusal into a partial restore.
    const image = buildBeforeImage({ tasks: tasks(MAX_SNAPSHOT_ROWS + 10) });

    expect(image.affected).toBe(MAX_SNAPSHOT_ROWS + 10);
  });

  it("omits empty collections rather than storing empty arrays", () => {
    const image = buildBeforeImage({ tasks: tasks(1) });

    expect(image.tasks).toBeDefined();
    expect(image.notes).toBeUndefined();
  });

  it("handles an apply that touched nothing", () => {
    const image = buildBeforeImage({});

    expect(image.affected).toBe(0);
    expect(image.truncated).toBe(false);
  });
});

describe("parseBeforeImage", () => {
  it("round-trips an image", () => {
    const image = buildBeforeImage({ tasks: [{ id: 1, title: "A" }] });
    const parsed = parseBeforeImage(JSON.stringify(image));

    expect(parsed?.tasks).toHaveLength(1);
    expect(parsed?.truncated).toBe(false);
  });

  it("reads a missing column as absent, not as empty", () => {
    // Applies written before this column existed. "We do not know what changed"
    // must not be reported as "nothing changed", or undo would claim success.
    expect(parseBeforeImage(null)).toBeNull();
  });

  it("reads malformed JSON as absent", () => {
    expect(parseBeforeImage("{not json")).toBeNull();
  });

  it("preserves the truncation flag through storage", () => {
    const image = buildBeforeImage({
      tasks: Array.from({ length: MAX_SNAPSHOT_ROWS + 1 }, (_, i) => ({
        id: i + 1,
        title: "x",
      })),
    });

    expect(parseBeforeImage(JSON.stringify(image))?.truncated).toBe(true);
  });
});
