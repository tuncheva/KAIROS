import { describe, it, expect, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

/**
 * The dashboard, rendered.
 *
 * `tests/setup.tsx` mocks every tRPC query to `null`, which is the first-run
 * path — useful, but it never exercises the blocks the page is actually made
 * of. This file overrides that mock with real-shaped data so the redesign is
 * checked as a rendered page: the brief, the figures, next up, the radar, the
 * project pace lines, the week, the team and the crew line.
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
    createdAt: daysFromToday(-7),
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
  events: [],
};

const BRIEF = {
  message: "Two tasks on the redesign sprint are late; start with the audit.",
  createdAt: new Date(new Date().setHours(7, 2, 0, 0)),
};

const SCHEDULES = [
  { kind: "daily_brief", enabled: true, hourLocal: 7, dayOfWeek: null },
  { kind: "risk_radar", enabled: false, hourLocal: 7, dayOfWeek: null },
  { kind: "weekly_retro", enabled: false, hourLocal: 16, dayOfWeek: 5 },
  { kind: "meeting_prep", enabled: true, hourLocal: 0, dayOfWeek: null },
];

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
    suggestedFix: {
      label: "Draft a rebalance",
      prompt: "Rebalance the redesign sprint",
    },
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
const statusMutate = vi.fn();

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
      task: {
        getOrgActivity: query(ACTIVITY),
        getForCalendar: query(CALENDAR),
        updateStatus: {
          useMutation: () => ({ mutate: statusMutate, isPending: false }),
        },
      },
      progress: { getPulse: query(PULSE) },
      agent: {
        latestBrief: query(BRIEF),
        schedules: query(SCHEDULES),
        names: query({ overrides: {} }),
        findings: query(FINDINGS),
        dismissFinding: {
          useMutation: () => ({ mutate: dismissMutate, isPending: false }),
        },
      },
      organization: {
        join: { useMutation: () => ({ mutate: vi.fn(), isPending: false }) },
      },
    },
  };
});

const { DashboardClient } = await import(
  "~/components/dashboard/DashboardClient"
);

const setup = () => render(<DashboardClient userName="Teodora Tuncheva" />);

describe("the dashboard headline", () => {
  it("greets by first name and sets the morning brief under it, signed", () => {
    setup();
    // The name is set in italic accent and closes with a full stop.
    expect(screen.getByRole("heading", { level: 1 }).textContent).toMatch(
      /Teodora\.$/,
    );
    expect(screen.getByText(BRIEF.message)).toBeInTheDocument();
    expect(screen.getByText(/, your morning brief · /)).toBeInTheDocument();
  });

  it("hands off to the crew from the headline", () => {
    setup();
    expect(
      screen.getByRole("button", { name: "Ask Kairos AI" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "Plan my week" }).getAttribute("href"),
    ).toMatch(/^\/chat\/ai\?prefill=/);
  });

  it("carries the four figures with their footnotes", () => {
    setup();
    for (const label of [
      "Due today",
      "Overdue",
      "Open this week",
      "Done this week",
    ]) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }
    // Today's one task is finished; two are late, the oldest by four days.
    expect(screen.getByText("all done")).toBeInTheDocument();
    expect(screen.getByText("oldest 4 days late")).toBeInTheDocument();
    expect(screen.getByText("across 2 projects")).toBeInTheDocument();
    // Six completions this week, none the week before.
    expect(screen.getByText("6 more than last week")).toBeInTheDocument();
  });

  it("no longer reports how much of the day has gone", () => {
    setup();
    expect(screen.queryByText(/of today gone|day gone/)).not.toBeInTheDocument();
  });
});

describe("next up", () => {
  it("lists the oldest open task first, with how late it is", () => {
    setup();
    const card = screen
      .getByRole("heading", { name: "Next up" })
      .closest("section")!;
    expect(within(card).getByText("Audit the empty states")).toBeInTheDocument();
    expect(within(card).getByText("4 days overdue")).toBeInTheDocument();
  });

  it("completes a task in place", async () => {
    setup();
    await userEvent.click(
      screen.getByRole("button", { name: "Mark “Audit the empty states” done" }),
    );
    expect(statusMutate).toHaveBeenCalledWith({
      taskId: 1,
      status: "completed",
    });
  });
});

describe("what the radar found", () => {
  it("shows each finding with its severity, and dates the check", () => {
    setup();
    expect(screen.getByText("From the radar")).toBeInTheDocument();
    expect(screen.getByText("2 findings")).toBeInTheDocument();
    expect(screen.getByText(/Checked 14m ago/)).toBeInTheDocument();
    expect(screen.getByText("Critical")).toBeInTheDocument();
    expect(
      screen.getByText("Four days behind on the sprint"),
    ).toBeInTheDocument();
  });

  it("names the project a finding is about, or says it is workspace-wide", () => {
    setup();
    const card = screen
      .getByText("Reviews are the bottleneck")
      .closest("article")!;
    expect(within(card).getByText(/Across the workspace/)).toBeInTheDocument();
  });

  it("offers the drafted fix, and a dismissal beside it", async () => {
    setup();
    expect(
      screen.getByRole("button", { name: /Draft a rebalance/ }),
    ).toBeInTheDocument();

    const card = screen
      .getByText("Four days behind on the sprint")
      .closest("article")!;
    await userEvent.click(
      within(card).getByRole("button", { name: "Dismiss" }),
    );
    expect(dismissMutate).toHaveBeenCalledWith({ findingId: 101 });
  });
});

/**
 * The row a project's title link sits in — the same title also appears in the
 * activity feed and next up, outside any row.
 */
const rowFor = (title: RegExp) =>
  screen
    .getAllByRole("link", { name: title })
    .map((link) => link.closest("div.group"))
    .find((row): row is HTMLElement => row !== null)!;

describe("the project list", () => {
  it("puts the at-risk project first and links each row to the project", () => {
    setup();
    const titles = screen
      .getAllByRole("link", { name: /Redesign sprint|Docs refresh/ })
      .filter((link) => link.closest("div.group"));
    expect(titles[0]).toHaveAttribute("href", "/projects?projectId=1");
    expect(
      within(rowFor(/Redesign sprint/)).getByText("At risk"),
    ).toBeInTheDocument();
  });

  it("reads open work, completion and time gone off the project", () => {
    setup();
    const row = rowFor(/Redesign sprint/);
    expect(within(row).getByText(/· 3 open$/)).toBeInTheDocument();
    // The line sweeps up from zero over the entrance, so the figure this early
    // is the start of that sweep rather than the total.
    expect(within(row).getByText(/^\d+% done$/)).toBeInTheDocument();
    // Started a week ago, last open task due in three days: about 70% of the
    // span, give or take the hour the test runs at.
    expect(within(row).getByText(/^(6|7)\d% of time$/)).toBeInTheDocument();
  });

  it("dates a project by the last of its open tasks", () => {
    setup();
    const row = rowFor(/Docs refresh/);
    expect(within(row).getByText(/^Ends /)).toBeInTheDocument();
    expect(within(row).getByText("On track")).toBeInTheDocument();
  });
});

describe("the week", () => {
  it("lays out seven days and reads today's load", () => {
    setup();
    const card = screen
      .getByRole("heading", { name: "This week" })
      .closest("section")!;
    expect(within(card).getAllByRole("listitem")).toHaveLength(7);
    expect(
      within(card).getByLabelText(/, one task, no events$/),
    ).toBeInTheDocument();
  });
});

describe("team activity", () => {
  it("lists what happened and in which project", () => {
    setup();
    expect(screen.getByText(/Ivan completed/)).toBeInTheDocument();
    expect(screen.getByText(/Nadia created/)).toBeInTheDocument();
  });
});

describe("the team", () => {
  it("lists the team by load, marking the reader and the quiet ones", () => {
    setup();
    expect(screen.getByRole("heading", { name: "Team" })).toBeInTheDocument();
    expect(screen.getByText("Ivan Petrov")).toBeInTheDocument();
    expect(screen.getByLabelText("9 open")).toBeInTheDocument();
    expect(screen.getByText("Active 20m ago")).toBeInTheDocument();
    expect(screen.getByText("Teodora (you)")).toBeInTheDocument();
    expect(screen.getByText("No activity yet")).toBeInTheDocument();
  });
});

describe("the crew line", () => {
  it("names each scheduled agent that is on, and when it next runs", () => {
    setup();
    const footer = screen.getByText("The crew").closest("footer")!;
    expect(within(footer).getByText(/^(today|tomorrow) at /)).toBeInTheDocument();
    expect(within(footer).getByText("before each meeting")).toBeInTheDocument();
    // Schedules that are off stay off the line.
    expect(
      within(footer).getAllByText(/ at |before each meeting/),
    ).toHaveLength(2);
  });
});

describe("first run", () => {
  it("is what an empty workspace gets instead of a page of zeroes", async () => {
    vi.resetModules();
    vi.doMock("~/trpc/react", () => {
      const query = (data: unknown) => ({
        useQuery: () => ({
          data,
          isLoading: false,
          error: null,
          refetch: vi.fn(),
        }),
      });
      return {
        api: {
          useUtils: () => new Proxy({}, { get: () => () => Promise.resolve() }),
          project: { getMyProjects: query([]) },
          task: {
            getOrgActivity: query({ rows: [] }),
            getForCalendar: query({ tasks: [] }),
          },
          progress: { getPulse: query(null) },
          agent: {
            latestBrief: query(null),
            schedules: query([]),
            names: query({ overrides: {} }),
            findings: query([]),
            dismissFinding: {
              useMutation: () => ({ mutate: vi.fn(), isPending: false }),
            },
          },
          organization: {
            join: {
              useMutation: () => ({ mutate: vi.fn(), isPending: false }),
            },
          },
        },
      };
    });

    const { DashboardClient: Empty } = await import(
      "~/components/dashboard/DashboardClient"
    );
    render(<Empty userName="Teodora" />);

    expect(screen.getByText(/Nothing on the board yet/)).toBeInTheDocument();
    // Creating is left to the top bar's button; joining by code is offered here.
    expect(
      screen.queryByRole("link", { name: /Create a project/ }),
    ).not.toBeInTheDocument();
    expect(screen.getByLabelText("Access code")).toBeInTheDocument();
    vi.doUnmock("~/trpc/react");
  });
});
