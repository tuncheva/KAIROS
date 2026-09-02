import { describe, it, expect, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

/**
 * The dashboard, rendered.
 *
 * `tests/setup.tsx` mocks every tRPC query to `null`, which is the first-run
 * path — useful, but it never exercises the four blocks the page is actually
 * made of. This file overrides that mock with real-shaped data so the redesign
 * is checked as a rendered page: the stat row, the radar cards, the project
 * status table and the aside's ring, momentum and team panels.
 */

const HOUR = 3_600_000;
const DAY = 86_400_000;
const now = Date.now();
/** Local midnight, so a "due today" fixture cannot drift into yesterday. */
const today = new Date(new Date().setHours(12, 0, 0, 0));
const daysFromToday = (n: number) => new Date(today.getTime() + n * DAY);

const done = { status: "completed" as const };
const todo = { status: "pending" as const };

const PROJECTS = [
  {
    id: 1,
    title: "Redesign sprint",
    description: null,
    createdById: "me",
    createdByUser: { id: "me", name: "Teodora", email: null, image: null },
    collaborators: [
      { id: "u1", name: "Ivan", image: null, permission: "write" },
      { id: "u2", name: "Mira", image: null, permission: "read" },
      { id: "u3", name: "Nadia", image: null, permission: "read" },
    ],
    tasks: [
      { id: 1, ...todo, dueDate: daysFromToday(-4) },
      { id: 2, ...todo, dueDate: daysFromToday(-1) },
      { id: 3, ...todo, dueDate: daysFromToday(3) },
      { id: 4, ...done, dueDate: daysFromToday(-6) },
    ],
  },
  {
    id: 2,
    title: "Docs refresh",
    description: null,
    createdById: "u2",
    createdByUser: { id: "u2", name: "Mira", email: null, image: null },
    collaborators: [],
    tasks: [
      { id: 5, ...done, dueDate: daysFromToday(-2) },
      { id: 6, ...done, dueDate: daysFromToday(-2) },
      { id: 7, ...done, dueDate: daysFromToday(-1) },
      { id: 8, ...todo, dueDate: daysFromToday(2) },
    ],
  },
];

const CALENDAR = {
  tasks: [
    {
      id: 1,
      title: "Audit the empty states",
      status: "pending",
      dueDate: daysFromToday(-4),
      projectId: 1,
      projectTitle: "Redesign sprint",
    },
    {
      id: 9,
      title: "Ship the token pass",
      status: "completed",
      dueDate: today,
      projectId: 1,
      projectTitle: "Redesign sprint",
    },
  ],
};

const ACTIVITY = {
  rows: [
    {
      id: 11,
      action: "status_changed",
      oldValue: "in_progress",
      newValue: "completed",
      createdAt: new Date(now - 12 * 60_000),
      taskTitle: "Wire the settings rail",
      projectId: 1,
      projectTitle: "Redesign sprint",
      user: { id: "u1", name: "Ivan", email: null },
    },
    {
      id: 12,
      action: "created",
      oldValue: null,
      newValue: null,
      createdAt: new Date(now - 2 * HOUR),
      taskTitle: "Invoice PDF template",
      projectId: 2,
      projectTitle: "Docs refresh",
      user: { id: "u3", name: "Nadia", email: null },
    },
  ],
};

const PULSE = {
  scope: "organization",
  days: 21,
  // Four finished today, two yesterday — a two-day streak.
  completions: [
    new Date(now - HOUR),
    new Date(now - 2 * HOUR),
    new Date(now - 3 * HOUR),
    new Date(now - 4 * HOUR),
    daysFromToday(-1),
    daysFromToday(-1),
  ],
  team: [
    {
      id: "u1",
      name: "Ivan Petrov",
      email: null,
      image: null,
      isSelf: false,
      open: 9,
      overdue: 2,
      lastActiveAt: new Date(now - 20 * 60_000),
    },
    {
      id: "me",
      name: "Teodora",
      email: null,
      image: null,
      isSelf: true,
      open: 3,
      overdue: 0,
      lastActiveAt: new Date(now - HOUR),
    },
    {
      id: "u4",
      name: "Stefan Dimov",
      email: null,
      image: null,
      isSelf: false,
      open: 0,
      overdue: 0,
      lastActiveAt: null,
    },
  ],
};

const FINDINGS = [
  {
    id: 101,
    projectId: 1,
    severity: "critical",
    title: "Four days behind on the sprint",
    detail: "Six tasks are due before Friday and none have been started.",
    createdAt: new Date(now - 14 * 60_000),
    suggestedFix: { label: "Draft a rebalance", prompt: "Rebalance the redesign sprint" },
  },
  {
    id: 102,
    projectId: null,
    severity: "info",
    title: "Reviews are the bottleneck",
    detail: "Review tasks wait 3.4 days on average.",
    createdAt: new Date(now - 3 * HOUR),
    suggestedFix: null,
  },
];

const dismissMutate = vi.fn();

vi.mock("~/trpc/react", () => {
  const query = (data: unknown) => ({
    useQuery: () => ({ data, isLoading: false, error: null, refetch: vi.fn() }),
  });
  const invalidate = (): unknown =>
    new Proxy(() => Promise.resolve(), {
      get: () => invalidate(),
      apply: () => Promise.resolve(),
    });

  return {
    api: {
      useUtils: () => new Proxy({}, { get: () => invalidate() }),
      project: { getMyProjects: query(PROJECTS) },
      task: { getOrgActivity: query(ACTIVITY), getForCalendar: query(CALENDAR) },
      progress: { getPulse: query(PULSE) },
      agent: {
        findings: query(FINDINGS),
        dismissFinding: { useMutation: () => ({ mutate: dismissMutate, isPending: false }) },
      },
      organization: { join: { useMutation: () => ({ mutate: vi.fn(), isPending: false }) } },
    },
  };
});

const { DashboardClient } = await import("~/components/dashboard/DashboardClient");

const setup = () => render(<DashboardClient userName="Teodora Tuncheva" />);

describe("the dashboard headline", () => {
  it("greets by first name and says what the day holds", () => {
    setup();
    expect(screen.getByRole("heading", { level: 1 }).textContent).toMatch(/Teodora$/);
    expect(screen.getByText(/tasks are due today|task is due today|Nothing is due today/)).toBeInTheDocument();
  });

  it("carries the four stats with their footnotes", () => {
    setup();
    for (const label of ["Due today", "Open this week", "Completed"]) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }
    // "Overdue" is also a column heading further down the page.
    expect(screen.getAllByText("Overdue").length).toBeGreaterThan(0);
    // Two tasks are late, the oldest by four days; one of today's is finished.
    expect(screen.getByText("oldest 4d")).toBeInTheDocument();
    expect(screen.getByText("1 done")).toBeInTheDocument();
    expect(screen.getByText("across 2")).toBeInTheDocument();
  });
});

describe("what the radar found", () => {
  it("shows each finding with its severity, and dates the check", () => {
    setup();
    expect(screen.getByText("What the radar found")).toBeInTheDocument();
    expect(screen.getByText("2 findings")).toBeInTheDocument();
    expect(screen.getByText("Checked 14m ago")).toBeInTheDocument();
    expect(screen.getByText("Critical")).toBeInTheDocument();
    expect(screen.getByText("Four days behind on the sprint")).toBeInTheDocument();
  });

  it("names the project a finding is about, or says it is workspace-wide", () => {
    setup();
    const card = screen.getByText("Reviews are the bottleneck").closest("article")!;
    expect(within(card).getByText("Across the workspace")).toBeInTheDocument();
  });

  it("offers the drafted fix, and a dismissal beside it", async () => {
    setup();
    expect(screen.getByRole("button", { name: /Draft a rebalance/ })).toBeInTheDocument();

    const card = screen.getByText("Four days behind on the sprint").closest("article")!;
    await userEvent.click(within(card).getByRole("button", { name: "Dismiss" }));
    expect(dismissMutate).toHaveBeenCalledWith({ findingId: 101 });
  });
});

/**
 * The status row a project's title link sits in — the link no longer wraps the
 * row, and the same title also appears in the activity feed below.
 */
const rowFor = (title: RegExp) =>
  screen
    .getAllByRole("link", { name: title })
    .map((link) => link.closest("div.group"))
    .find((row): row is HTMLElement => row !== null)!;

describe("the project status table", () => {
  it("heads every column the design lists", () => {
    setup();
    const header = screen.getByText("Project").parentElement!;
    for (const column of ["Project", "Team", "Open", "Overdue", "Completion", "Health"]) {
      expect(within(header).getByText(column)).toBeInTheDocument();
    }
  });

  it("puts the at-risk project first and links each row to the project", () => {
    setup();
    const titles = screen
      .getAllByRole("link", { name: /Redesign sprint|Docs refresh/ })
      .filter((link) => link.closest("div.group"));
    expect(titles[0]).toHaveAttribute("href", "/projects?projectId=1");
    expect(within(rowFor(/Redesign sprint/)).getByText("At risk")).toBeInTheDocument();
  });

  it("reads open, overdue and completion off the tasks", () => {
    setup();
    const row = rowFor(/Redesign sprint/);
    expect(within(row).getByText("3")).toBeInTheDocument(); // open
    expect(within(row).getByText("2")).toBeInTheDocument(); // overdue
    // The bar and its figure sweep up from zero over the entrance, so the
    // number this early is the start of that sweep rather than the total.
    expect(within(row).getByText(/^\d+%$/)).toBeInTheDocument();
  });

  it("dates a project by the last of its open tasks", () => {
    setup();
    const row = rowFor(/Docs refresh/);
    expect(within(row).getByText(/^Ends /)).toBeInTheDocument();
    expect(within(row).getByText("On track")).toBeInTheDocument();
  });
});

describe("a person's face", () => {
  it("is its own control in a project row and in an activity row", () => {
    setup();
    // Three owners on the sprint, plus the two people in the activity feed and
    // the three in the team panel.
    expect(screen.getAllByRole("button", { name: /View .*'s profile/ }).length).toBeGreaterThanOrEqual(8);
  });

  it("sits above the row's own link so the two clicks do not collide", () => {
    setup();
    const face = screen.getAllByRole("button", { name: "View Ivan's profile" })[0]!;
    expect(face.closest("span")?.className).toMatch(/z-10/);
  });
});

describe("team activity", () => {
  it("lists what happened, in which project, and how long ago", () => {
    setup();
    expect(screen.getByText(/Ivan completed/)).toBeInTheDocument();
    expect(screen.getByText("12M")).toBeInTheDocument();
    expect(screen.getByText(/Nadia created/)).toBeInTheDocument();
  });
});

describe("the aside", () => {
  it("reports workspace completion on the ring", () => {
    setup();
    expect(screen.getByText("Workspace progress")).toBeInTheDocument();
    expect(screen.getByText("4 / 8")).toBeInTheDocument();
    expect(screen.getByText("of tasks done")).toBeInTheDocument();
  });

  it("shows the streak, the pace and what the fortnight came to", () => {
    setup();
    expect(screen.getByText("Your momentum")).toBeInTheDocument();
    expect(screen.getByText("2-day streak")).toBeInTheDocument();
    expect(screen.getByText(/You finished 6 tasks in the last fortnight, 4 of them today\./)).toBeInTheDocument();
  });

  it("lists the team by load, marking the reader and the quiet ones", () => {
    setup();
    expect(screen.getByText("Team today")).toBeInTheDocument();
    expect(screen.getByText("Ivan Petrov")).toBeInTheDocument();
    expect(screen.getByText("9 open")).toBeInTheDocument();
    expect(screen.getByText("Active 20m ago")).toBeInTheDocument();
    expect(screen.getByText("Teodora (you)")).toBeInTheDocument();
    expect(screen.getByText("No activity yet")).toBeInTheDocument();
  });
});

describe("first run", () => {
  it("is what an empty workspace gets instead of a page of zeroes", async () => {
    vi.resetModules();
    vi.doMock("~/trpc/react", () => {
      const query = (data: unknown) => ({
        useQuery: () => ({ data, isLoading: false, error: null, refetch: vi.fn() }),
      });
      return {
        api: {
          useUtils: () => new Proxy({}, { get: () => () => Promise.resolve() }),
          project: { getMyProjects: query([]) },
          task: { getOrgActivity: query({ rows: [] }), getForCalendar: query({ tasks: [] }) },
          progress: { getPulse: query(null) },
          agent: {
            findings: query([]),
            dismissFinding: { useMutation: () => ({ mutate: vi.fn(), isPending: false }) },
          },
          organization: { join: { useMutation: () => ({ mutate: vi.fn(), isPending: false }) } },
        },
      };
    });

    const { DashboardClient: Empty } = await import(
      "~/components/dashboard/DashboardClient"
    );
    render(<Empty userName="Teodora" />);

    expect(screen.getByText("First run")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Create a project/ })).toHaveAttribute(
      "href",
      "/projects?new=1",
    );
    vi.doUnmock("~/trpc/react");
  });
});
