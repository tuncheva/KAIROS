/**
 * Deadline watch: does it escalate, and does it stay quiet?
 *
 * Two failures matter here and they are opposites.
 *
 * The first is silent non-escalation. Findings are deduped on their fingerprint,
 * so a fingerprint of `deadline:{taskId}` alone raises a task once — a week out —
 * and then never again as it slides into "due tomorrow, still untouched". That
 * bug looks like a working feature: findings appear, they are correctly worded,
 * and the escalation simply never happens. The band-in-fingerprint assertions
 * exist for exactly that.
 *
 * The second is the notification storm. Every other detector in the radar is a
 * per-project aggregate and therefore self-bounding; this one is per-task, and a
 * user with twenty deadlines must not receive twenty findings.
 */

import { describe, expect, it } from "vitest";

import {
  DEADLINE_HORIZON_DAYS,
  MAX_DEADLINE_FINDINGS,
  deadlineFindings,
  gradeDeadline,
  type DeadlineTask,
} from "~/server/llm/scheduled/deadlines";

const NOW = new Date("2026-08-23T09:00:00Z");
const USER = "user_1";

function task(overrides: Partial<DeadlineTask> = {}): DeadlineTask {
  return {
    id: 1,
    title: "Ship the invoice export",
    projectId: 7,
    status: "pending",
    dueDate: new Date("2026-08-24T09:00:00Z"), // tomorrow
    assignedToId: USER,
    ...overrides,
  };
}

function run(tasks: DeadlineTask[]) {
  return deadlineFindings({
    tasks,
    projectNames: new Map([[7, "Delta"]]),
    userId: USER,
    now: NOW,
  });
}

/** Days from NOW as a due date. */
function inDays(days: number): Date {
  return new Date(NOW.getTime() + days * 86_400_000 + 3_600_000);
}

describe("gradeDeadline — state, not just date", () => {
  it("treats untouched-and-imminent as critical", () => {
    expect(gradeDeadline("pending", "imminent")).toBe("critical");
  });

  it("treats in-progress-and-imminent as merely a warning", () => {
    // The whole reason this detector reads status. Same date, different message.
    expect(gradeDeadline("in_progress", "imminent")).toBe("warning");
  });

  it("treats blocked as critical even when the date is not close", () => {
    // A blocked task does not unblock itself, so distance from the deadline is
    // not reassuring the way it is for work in progress.
    expect(gradeDeadline("blocked", "soon")).toBe("critical");
    expect(gradeDeadline("blocked", "upcoming")).toBe("warning");
  });

  it("says nothing about a completed task", () => {
    expect(gradeDeadline("completed", "imminent")).toBeNull();
  });

  it("errs gentle on an unrecognised status", () => {
    // A future status enum value should not start emitting criticals on its own.
    expect(gradeDeadline("in_review", "imminent")).toBe("warning");
    expect(gradeDeadline("in_review", "upcoming")).toBe("info");
  });
});

describe("escalation", () => {
  it("changes fingerprint when a task crosses into a nearer band", () => {
    // The load-bearing assertion. Identical fingerprints here would mean the
    // finding is deduped against the one raised days earlier and the user is
    // never told it got urgent.
    const soon = run([task({ dueDate: inDays(3) })]).findings[0];
    const imminent = run([task({ dueDate: inDays(1) })]).findings[0];

    expect(soon?.fingerprint).toBeDefined();
    expect(imminent?.fingerprint).toBeDefined();
    expect(soon?.fingerprint).not.toBe(imminent?.fingerprint);
  });

  it("raises severity as the band tightens", () => {
    expect(run([task({ dueDate: inDays(3) })]).findings[0]?.severity).toBe(
      "warning",
    );
    expect(run([task({ dueDate: inDays(1) })]).findings[0]?.severity).toBe(
      "critical",
    );
  });

  it("keeps one fingerprint while a task sits still inside a band", () => {
    // The other half: banding is what stops a daily re-raise. Two and three days
    // out are the same situation and must not interrupt twice.
    const a = run([task({ dueDate: inDays(2) })]).findings[0];
    const b = run([task({ dueDate: inDays(3) })]).findings[0];

    expect(a?.fingerprint).toBe(b?.fingerprint);
  });

  it("includes the task id so two tasks never share a fingerprint", () => {
    const out = run([
      task({ id: 41, dueDate: inDays(1) }),
      task({ id: 42, dueDate: inDays(1) }),
    ]);

    const prints = out.findings.map((f) => f.fingerprint);
    expect(new Set(prints).size).toBe(prints.length);
  });
});

describe("what it declines to report", () => {
  it("ignores tasks assigned to someone else", () => {
    // Per-task nudges are about your own week. The aggregate detectors already
    // cover the team's work.
    expect(run([task({ assignedToId: "user_2" })]).findings).toHaveLength(0);
  });

  it("ignores unassigned tasks", () => {
    expect(run([task({ assignedToId: null })]).findings).toHaveLength(0);
  });

  it("ignores tasks with no due date", () => {
    expect(run([task({ dueDate: null })]).findings).toHaveLength(0);
  });

  it("leaves overdue tasks to the overdue detector", () => {
    // Reporting both would name the same task twice under two headings.
    expect(run([task({ dueDate: inDays(-2) })]).findings).toHaveLength(0);
  });

  it("ignores anything beyond the horizon", () => {
    expect(
      run([task({ dueDate: inDays(DEADLINE_HORIZON_DAYS + 2) })]).findings,
    ).toHaveLength(0);
  });

  it("stays quiet about a normal working week", () => {
    // In progress, due Friday. Nothing is wrong, and recording it would inflate
    // the retrospective's "risks raised" count with non-risks.
    expect(
      run([task({ status: "in_progress", dueDate: inDays(5) })]).findings,
    ).toHaveLength(0);
  });

  it("says nothing about completed work, however close the date", () => {
    expect(
      run([task({ status: "completed", dueDate: inDays(0) })]).findings,
    ).toHaveLength(0);
  });
});

describe("the cap", () => {
  it("never raises more findings than the cap", () => {
    const many = Array.from({ length: 20 }, (_, i) =>
      task({ id: i + 1, dueDate: inDays(1) }),
    );

    expect(run(many).findings.length).toBe(MAX_DEADLINE_FINDINGS);
  });

  it("reports how many it left out rather than hiding the truncation", () => {
    const many = Array.from({ length: 20 }, (_, i) =>
      task({ id: i + 1, dueDate: inDays(1) }),
    );

    expect(run(many).omitted).toBe(20 - MAX_DEADLINE_FINDINGS);
  });

  it("keeps the most urgent when it has to choose", () => {
    // A critical must never be dropped in favour of a warning.
    const tasks = [
      ...Array.from({ length: 6 }, (_, i) =>
        task({ id: 100 + i, status: "in_progress", dueDate: inDays(1) }),
      ),
      task({ id: 1, status: "pending", dueDate: inDays(1) }),
    ];

    const out = run(tasks);
    expect(out.findings.every((f) => f.severity === "critical")).toBe(false);
    expect(out.findings[0]?.severity).toBe("critical");
    expect(out.findings[0]?.taskIds).toEqual([1]);
  });

  it("orders by nearest deadline within the same severity", () => {
    const out = run([
      task({ id: 1, dueDate: inDays(3) }),
      task({ id: 2, dueDate: inDays(2) }),
    ]);

    // Both `pending`/`soon` → both warnings; the nearer one leads.
    expect(out.findings[0]?.taskIds).toEqual([2]);
  });

  it("reports nothing omitted when under the cap", () => {
    expect(run([task()]).omitted).toBe(0);
  });
});

describe("wording", () => {
  it("says today and tomorrow rather than a day count", () => {
    expect(run([task({ dueDate: inDays(0) })]).findings[0]?.title).toMatch(
      /due today/,
    );
    expect(run([task({ dueDate: inDays(1) })]).findings[0]?.title).toMatch(
      /due tomorrow/,
    );
  });

  it("names the project so a finding is actionable out of context", () => {
    expect(run([task()]).findings[0]?.detail).toContain("Delta");
  });

  it("says why it matters, not only when it is due", () => {
    const detail = run([task({ status: "blocked", dueDate: inDays(1) })])
      .findings[0]?.detail;

    expect(detail).toMatch(/blocked/);
  });
});
