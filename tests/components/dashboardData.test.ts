import { describe, it, expect } from "vitest";

import {
  daysLate,
  headlineStats,
  nextRunAt,
  nextUp,
  projectStatusRows,
  relativeShort,
  weekOutput,
  weekStrip,
  type CalendarTask,
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

describe("pace", () => {
  it("measures time gone from the project's start to its last due date", () => {
    // Started 09:00 on the 10th, last open task due 09:00 on the 30th: at
    // 09:00 on the 20th exactly half the span is gone.
    const [row] = projectStatusRows(
      [
        {
          id: 9,
          title: "Paced",
          createdAt: day(10, 9),
          tasks: [{ id: 1, status: "pending", dueDate: day(30, 9) }],
        },
      ],
      NOW,
    );
    expect(row?.elapsed).toBe(50);
  });

  it("has no pace without a start or an end", () => {
    const rows = projectStatusRows(
      [
        { id: 1, title: "No start", tasks: [{ id: 1, status: "pending", dueDate: day(30) }] },
        { id: 2, title: "No end", createdAt: day(1), tasks: [] },
      ],
      NOW,
    );
    expect(rows.every((row) => row.elapsed === null)).toBe(true);
  });
});

const task = (
  id: number,
  dueDate: Date | null,
  extra: Partial<CalendarTask> = {},
): CalendarTask => ({
  id,
  title: `Task ${id}`,
  status: "pending",
  dueDate,
  projectId: 1,
  projectTitle: "Project one",
  priority: "medium",
  assignedToId: "me",
  ...extra,
});

describe("nextUp", () => {
  it("puts the oldest due first, then priority within a day", () => {
    const queue = nextUp(
      [
        task(1, day(22)),
        task(2, day(20), { priority: "low" }),
        task(3, day(18)),
        task(4, day(20), { priority: "urgent" }),
      ],
      "me",
    );
    expect(queue.map((t) => t.id)).toEqual([3, 4, 2]);
  });

  it("skips finished, undated and other people's tasks", () => {
    const queue = nextUp(
      [
        task(1, day(20), { status: "completed" }),
        task(2, null),
        task(3, day(20), { assignedToId: "someone-else" }),
        task(4, day(25)),
      ],
      "me",
    );
    expect(queue.map((t) => t.id)).toEqual([4]);
  });

  it("fills up with unassigned work once the reader's own runs out", () => {
    const queue = nextUp(
      [task(1, day(18), { assignedToId: null }), task(2, day(25))],
      "me",
    );
    // Mine first even though the unassigned one is older.
    expect(queue.map((t) => t.id)).toEqual([2, 1]);
  });
});

describe("weekStrip", () => {
  const week = weekStrip(
    [
      task(1, day(17)),
      task(2, day(17), { status: "completed" }),
      task(3, day(20)),
      task(4, day(24)), // next Monday — outside the week
    ],
    [{ id: 1, title: "Stand-up", eventDate: day(20, 14) }],
    NOW,
  );

  it("runs Monday to Sunday around today", () => {
    expect(week).toHaveLength(7);
    expect(week[0]?.date.getDate()).toBe(17);
    expect(week[6]?.date.getDate()).toBe(23);
    expect(week.findIndex((d) => d.isToday)).toBe(3);
    expect(week.filter((d) => d.isPast)).toHaveLength(3);
  });

  it("counts tasks due, open ones and events per day", () => {
    expect(week[0]).toMatchObject({ total: 2, open: 1, events: 0 });
    expect(week[3]).toMatchObject({ total: 1, open: 1, events: 1 });
    expect(week.reduce((n, d) => n + d.total, 0)).toBe(3);
  });
});

describe("weekOutput", () => {
  it("compares the last seven days with the seven before", () => {
    const output = weekOutput(
      [day(20), day(17), day(14), day(13), day(12), day(5)],
      NOW,
    );
    // 14th–20th is this week; 7th–13th last week; the 5th is older.
    expect(output).toEqual({ thisWeek: 3, lastWeek: 2 });
  });
});

describe("daysLate", () => {
  it("counts whole days past due and nothing for today or later", () => {
    expect(daysLate(day(16), NOW)).toBe(4);
    expect(daysLate(day(20, 23), NOW)).toBe(0);
    expect(daysLate(day(25), NOW)).toBe(0);
    expect(daysLate(null, NOW)).toBe(0);
  });
});

describe("nextRunAt", () => {
  it("is later today when the hour has not come yet", () => {
    const at = nextRunAt(13, null, NOW);
    expect([at.getDate(), at.getHours()]).toEqual([20, 13]);
  });

  it("rolls to tomorrow once the hour has passed", () => {
    const at = nextRunAt(7, null, NOW);
    expect([at.getDate(), at.getHours()]).toEqual([21, 7]);
  });

  it("waits for its weekday", () => {
    // Friday 16:00, the retrospective's default.
    const at = nextRunAt(16, 5, NOW);
    expect([at.getDate(), at.getDay(), at.getHours()]).toEqual([21, 5, 16]);
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
