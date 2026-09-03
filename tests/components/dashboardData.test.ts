import { describe, it, expect } from "vitest";

import {
  dayFraction,
  headlineStats,
  momentum,
  projectStatusRows,
  relativeShort,
  type DashboardProject,
  type ProjectWithPeople,
} from "~/components/dashboard/dashboardData";

/** Thursday 20 August 2026, 09:00 local — the day the design is drawn against. */
const NOW = new Date(2026, 7, 20, 9, 0, 0);
const day = (d: number, hour = 12) => new Date(2026, 7, d, hour, 0, 0);

const projects: DashboardProject[] = [
  {
    id: 1,
    title: "Project one",
    tasks: [
      { id: 1, status: "in_progress", dueDate: day(20) },
      { id: 2, status: "pending", dueDate: day(21) },
      { id: 3, status: "completed", dueDate: day(18) },
      { id: 4, status: "completed", dueDate: null },
    ],
  },
  {
    id: 2,
    title: "Project two",
    tasks: [
      { id: 5, status: "pending", dueDate: day(19) }, // overdue
      { id: 6, status: "pending", dueDate: day(20) },
      { id: 7, status: "pending", dueDate: day(30) }, // beyond the week
      { id: 8, status: "blocked", dueDate: null },
    ],
  },
  { id: 3, title: "Project three", tasks: [] },
];

describe("headlineStats", () => {
  const stats = headlineStats(projects, NOW);

  it("counts tasks due today, ignoring completed ones", () => {
    expect(stats.dueToday).toBe(2);
  });

  it("counts anything past due that is still open", () => {
    expect(stats.overdue).toBe(1);
  });

  it("counts open work inside the next seven days only", () => {
    // due today (2) + tomorrow (1); the 30th falls outside the window.
    expect(stats.openThisWeek).toBe(3);
  });

  it("reports completion across every project", () => {
    expect(stats.completed).toBe(2);
    expect(stats.totalTasks).toBe(8);
    expect(stats.percent).toBe(25);
  });

  it("splits the remaining work into active and to-do", () => {
    expect(stats.inProgress).toBe(1);
    expect(stats.todo).toBe(5);
    expect(stats.projectCount).toBe(3);
  });

  it("does not divide by zero on an empty workspace", () => {
    expect(headlineStats([], NOW).percent).toBe(0);
  });
});

describe("projectStatusRows", () => {
  const withPeople: ProjectWithPeople[] = [
    {
      ...projects[0]!,
      createdByUser: { id: "u1", name: "Ivan", image: null },
      collaborators: [
        { id: "u2", name: "Mira", image: null },
        // The creator collaborating on their own project must not appear twice.
        { id: "u1", name: "Ivan", image: null },
      ],
    },
    { ...projects[1]!, createdByUser: { id: "u2", name: "Mira", image: null } },
    { ...projects[2]!, createdByUser: null, collaborators: [] },
  ];

  const rows = projectStatusRows(withPeople, NOW);

  it("puts at-risk projects first and empty ones last", () => {
    expect(rows.map((r) => r.health)).toEqual(["atRisk", "inProgress", "empty"]);
    expect(rows[0]?.id).toBe(2);
    expect(rows.at(-1)?.id).toBe(3);
  });

  it("counts open and overdue work per project", () => {
    const one = rows.find((r) => r.id === 1);
    expect(one?.open).toBe(2);
    expect(one?.overdue).toBe(0);

    const two = rows.find((r) => r.id === 2);
    expect(two?.open).toBe(4);
    expect(two?.overdue).toBe(1);
  });

  it("reports completion as a percentage, zero for an empty project", () => {
    expect(rows.find((r) => r.id === 1)?.percent).toBe(50);
    expect(rows.find((r) => r.id === 3)?.percent).toBe(0);
  });

  it("dates a project by the last of its open tasks", () => {
    expect(rows.find((r) => r.id === 1)?.endsAt).toEqual(day(21));
    expect(rows.find((r) => r.id === 2)?.endsAt).toEqual(day(30));
  });

  it("leaves a project with no dated open work undated", () => {
    const [row] = projectStatusRows(
      [{ id: 9, title: "Undated", tasks: [{ id: 1, status: "pending", dueDate: null }] }],
      NOW,
    );
    expect(row?.endsAt).toBeNull();
  });

  it("lists the creator first, then collaborators, each once", () => {
    const one = rows.find((r) => r.id === 1);
    expect(one?.owners.map((o) => o.id)).toEqual(["u1", "u2"]);
  });

  it("flags a project on track once most of its work is closed", () => {
    const [row] = projectStatusRows(
      [
        {
          id: 10,
          title: "Nearly done",
          tasks: [
            { id: 1, status: "completed", dueDate: day(18) },
            { id: 2, status: "completed", dueDate: day(18) },
            { id: 3, status: "completed", dueDate: day(18) },
            { id: 4, status: "pending", dueDate: day(25) },
          ],
        },
      ],
      NOW,
    );
    expect(row?.health).toBe("onTrack");
    expect(row?.percent).toBe(75);
  });
});

describe("momentum", () => {
  /* Completions on the 20th (today, twice), the 19th and the 14th. */
  const completions = [day(20, 8), day(20, 9), day(19, 17), day(14, 11)];
  const data = momentum(completions, NOW);

  it("returns one bar per day, oldest first, ending today", () => {
    expect(data.bars).toHaveLength(14);
    expect(data.bars.at(-1)?.date.getDate()).toBe(20);
    expect(data.bars[0]?.date.getDate()).toBe(7);
  });

  it("buckets completions into local days", () => {
    expect(data.bars.at(-1)?.count).toBe(2);
    expect(data.bars.at(-2)?.count).toBe(1);
    expect(data.today).toBe(2);
    expect(data.total).toBe(4);
  });

  it("counts the streak back from today", () => {
    expect(data.streak).toBe(2);
  });

  it("does not break a streak on a day that is not over yet", () => {
    // Nothing done today, but yesterday and the day before were both worked.
    const quiet = momentum([day(19, 12), day(18, 12)], NOW);
    expect(quiet.today).toBe(0);
    expect(quiet.streak).toBe(2);
  });

  it("reads pace as this week against the one before", () => {
    // Four last week, two the week before.
    const paced = momentum(
      [day(20), day(19), day(18), day(17), day(12), day(11)],
      NOW,
    );
    expect(paced.pace).toBe(100);
  });

  it("has no pace to report when the earlier week was empty", () => {
    expect(momentum([day(20)], NOW).pace).toBeNull();
  });

  it("survives an empty history", () => {
    const none = momentum([], NOW);
    expect(none.total).toBe(0);
    expect(none.streak).toBe(0);
    expect(none.bars.every((bar) => bar.count === 0)).toBe(true);
  });
});

describe("relativeShort", () => {
  it("prints minutes, hours and days", () => {
    expect(relativeShort(new Date(NOW.getTime() - 20 * 60_000), NOW)).toBe("20m");
    expect(relativeShort(new Date(NOW.getTime() - 3 * 3_600_000), NOW)).toBe("3h");
    expect(relativeShort(new Date(NOW.getTime() - 2 * 86_400_000), NOW)).toBe("2d");
  });

  it("says now for anything inside the minute, and nothing for no date", () => {
    expect(relativeShort(NOW, NOW)).toBe("now");
    expect(relativeShort(null, NOW)).toBe("");
  });
});

describe("dayFraction", () => {
  it("reads the local clock, clamped to the day", () => {
    expect(dayFraction(new Date(2026, 7, 20, 12, 0, 0))).toBeCloseTo(0.5, 3);
    expect(dayFraction(new Date(2026, 7, 20, 0, 0, 0))).toBe(0);
  });
});
