import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

/**
 * The projects page, rendered.
 *
 * `tests/setup.tsx` mocks every tRPC query to `null`, which is the first-run
 * path — useful, but it never exercises the list, the grid or the timeline. This
 * file overrides that mock with real-shaped data so the redesign is checked as
 * a rendered page rather than as a source string.
 */

const HOUR = 3_600_000;
const DAY = 86_400_000;
const now = Date.now();

const project = (over: Record<string, unknown>) => ({
  description: null,
  createdById: "me",
  collaborators: [],
  tasks: [],
  ...over,
});

const done = { status: "completed" };
const doing = { status: "in_progress" };
const todo = { status: "pending" };

const PROJECTS = [
  project({
    id: 1,
    title: "Дипломна работа",
    description: "Chapters, sources and defense prep",
    updatedAt: new Date(now - 2 * HOUR),
    tasks: [done, done, done, doing, todo],
    collaborators: [{ id: "u1", name: "Мартин", image: null }],
  }),
  project({
    id: 2,
    title: "Apartment move",
    description: "Contracts, movers, utilities transfer",
    updatedAt: new Date(now - 3 * DAY),
    tasks: [done, todo, todo, todo],
  }),
  project({
    id: 3,
    title: "Team onboarding kit",
    createdById: "someone-else",
    updatedAt: new Date(now - 9 * DAY),
    tasks: [done, done],
  }),
  project({ id: 4, title: "Reading list", updatedAt: new Date(now - DAY), tasks: [] }),
];

const ACTIVITY = [
  {
    id: 11,
    action: "status_changed",
    oldValue: "in_progress",
    newValue: "completed",
    createdAt: new Date(now - HOUR),
    taskTitle: "Draft the methodology section",
    user: { id: "u0", name: "Теодора", email: null },
  },
  {
    id: 12,
    action: "created",
    oldValue: null,
    newValue: null,
    createdAt: new Date(now - 5 * DAY),
    taskTitle: "Book the defense room",
    user: { id: "u1", name: "Мартин", email: null },
  },
];

const TASKS = [
  {
    id: 21,
    title: "Chapter 2 review",
    status: "pending",
    dueDate: new Date(now + 3 * DAY),
    assignee: { name: "Мартин" },
  },
];

/** `project.getById` is what the task board and the team panel read. */
const DETAIL = {
  id: 1,
  title: "Дипломна работа",
  description: "Chapters, sources and defense prep",
  createdById: "me",
  createdBy: { id: "me", name: "Теодора", email: "me@kairos.dev", image: null },
  userHasWriteAccess: true,
  collaborators: [
    {
      collaboratorId: "u1",
      permission: "read",
      collaborator: { id: "u1", name: "Мартин", email: "m@kairos.dev", image: null },
    },
  ],
  tasks: [
    {
      id: 21,
      title: "Chapter 2 review",
      description: "Sources and footnotes",
      status: "pending",
      priority: "high",
      dueDate: new Date(now + 3 * DAY),
      completedAt: null,
      completionNote: null,
      assignedTo: { id: "u1", name: "Мартин", image: null },
      completedBy: null,
    },
    {
      id: 22,
      title: "Draft the methodology section",
      description: null,
      status: "completed",
      priority: "medium",
      dueDate: null,
      completedAt: new Date(now - HOUR),
      completionNote: null,
      assignedTo: null,
      completedBy: { id: "me", name: "Теодора", image: null },
    },
  ],
};

const deleteMutate = vi.fn();
const createTaskMutate = vi.fn().mockResolvedValue({ id: 99 });
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
      project: {
        getMyProjects: query(PROJECTS),
        getById: query(DETAIL),
        delete: { useMutation: () => ({ mutate: deleteMutate, isPending: false }) },
        addCollaborator: { useMutation: () => ({ mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false }) },
        removeCollaborator: { useMutation: () => ({ mutate: vi.fn(), isPending: false }) },
        updateCollaboratorPermission: {
          useMutation: () => ({ mutate: vi.fn(), isPending: false }),
        },
        create: { useMutation: () => ({ mutate: vi.fn(), isPending: false }) },
      },
      task: {
        getProjectActivity: query(ACTIVITY),
        getByProject: query(TASKS),
        create: {
          useMutation: () => ({ mutate: createTaskMutate, mutateAsync: createTaskMutate, isPending: false }),
        },
        update: { useMutation: () => ({ mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false }) },
        updateStatus: {
          useMutation: () => ({ mutate: statusMutate, mutateAsync: statusMutate, isPending: false }),
        },
        adminDiscard: { useMutation: () => ({ mutate: vi.fn(), isPending: false }) },
        setCompletionNote: { useMutation: () => ({ mutate: vi.fn(), isPending: false }) },
      },
      agent: {
        generateTaskDrafts: { useMutation: () => ({ mutate: vi.fn(), isPending: false }) },
      },
    },
  };
});

// Imported after the mock so the component picks up the override.
const { ProjectsWorkspace } = await import("~/components/projects/ProjectsWorkspace");

const setup = () => {
  const user = userEvent.setup();
  render(<ProjectsWorkspace userId="me" />);
  return user;
};

/** The four project titles in the fixture, as the rows are named. */
const PROJECT_TITLES = new Set([
  "Дипломна работа",
  "Apartment move",
  "Team onboarding kit",
  "Reading list",
]);

/**
 * The project rows in the order they are rendered.
 *
 * Each row's accessible name lives on an empty overlay button, so the rows
 * cannot be read by their text. Filtering every button down to the ones named
 * after a project skips the filter, sort and view controls.
 */
const rowOrder = () =>
  screen
    .getAllByRole("button")
    .map((node) => node.getAttribute("aria-label") ?? "")
    .filter((label) => PROJECT_TITLES.has(label));

beforeEach(() => {
  deleteMutate.mockClear();
  createTaskMutate.mockClear();
  statusMutate.mockClear();
});

describe("ProjectsWorkspace — browse", () => {
  it("leads with the heading and a summary of what is shown", () => {
    setup();
    expect(screen.getByRole("heading", { level: 1, name: "Your projects" })).toBeInTheDocument();
    expect(screen.getByText("4 of 4 projects · 6 of 11 tasks done")).toBeInTheDocument();
  });

  it("lists every project with its completion", () => {
    setup();
    expect(screen.getByText("Дипломна работа")).toBeInTheDocument();
    expect(screen.getByText("60%")).toBeInTheDocument();
    expect(screen.getByText("25%")).toBeInTheDocument();
    // A project with no tasks reads as a dash, not as 0% — as does an empty
    // avatar stack, so there is more than one on the page.
    expect(screen.getAllByText("—").length).toBeGreaterThan(0);
    expect(screen.queryByText("0%")).not.toBeInTheDocument();
  });

  it("orders by recency of update by default", () => {
    setup();
    // A row is a div with a full-bleed overlay button over it — the collaborator
    // faces inside have to be buttons themselves and a button cannot nest. So
    // the row's accessible name is on that empty overlay, and reading rows by
    // `textContent` finds nothing. `rowOrder` reads the labels instead, which
    // is both what a screen reader hears and DOM order.
    expect(rowOrder()[0]).toBe("Дипломна работа");
  });

  it("falls back to a placeholder when a project has no description", () => {
    setup();
    expect(screen.getAllByText("No description").length).toBeGreaterThan(0);
  });

  it("counts each filter bucket on its own pill", () => {
    setup();
    expect(screen.getByRole("button", { name: /^All ?4$/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^On track ?1$/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^Needs attention ?2$/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^Complete ?1$/ })).toBeInTheDocument();
  });

  it("narrows the list to the chosen filter", async () => {
    const user = setup();
    await user.click(screen.getByRole("button", { name: /^Complete ?1$/ }));
    expect(screen.getByText("Team onboarding kit")).toBeInTheDocument();
    expect(screen.queryByText("Дипломна работа")).not.toBeInTheDocument();
  });

  it("searches across title and description", async () => {
    const user = setup();
    await user.type(screen.getByRole("textbox", { name: "Search projects" }), "movers");
    expect(screen.getByText("Apartment move")).toBeInTheDocument();
    expect(screen.queryByText("Reading list")).not.toBeInTheDocument();
  });

  it("says so when a search matches nothing", async () => {
    const user = setup();
    await user.type(screen.getByRole("textbox", { name: "Search projects" }), "zzz");
    expect(screen.getByText("Nothing matches “zzz”.")).toBeInTheDocument();
  });

  it("reorders on the sort control", async () => {
    const user = setup();
    const name = screen.getByRole("button", { name: "Name" });
    await user.click(name);
    expect(name).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "Updated" })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
  });

  it("switches between list and grid, and the grid shows a health badge", async () => {
    const user = setup();
    expect(screen.getByRole("button", { name: "List" })).toHaveAttribute("aria-pressed", "true");
    await user.click(screen.getByRole("button", { name: "Grid" }));
    expect(screen.getByRole("button", { name: "Grid" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getAllByText("On track").length).toBeGreaterThan(0);
    expect(screen.getByText("No tasks")).toBeInTheDocument();
  });

  it("totals the workspace in the stats strip", () => {
    setup();
    // Two projects have tasks and are unfinished; 6 of 11 tasks done is 55%.
    expect(screen.getByText("Active").nextSibling).toHaveTextContent("2");
    expect(screen.getByText("Tasks").nextSibling).toHaveTextContent("11");
    expect(screen.getByText("Overall").nextSibling).toHaveTextContent("55%");
  });
});

describe("ProjectsWorkspace — detail", () => {
  const open = async (user: ReturnType<typeof userEvent.setup>) => {
    // The title span is inert; the overlay button carries the click.
    await user.click(screen.getByRole("button", { name: "Дипломна работа" }));
  };

  /* A project opens on its tasks — the timeline is one tab over. */
  const openTimeline = async (user: ReturnType<typeof userEvent.setup>) => {
    await open(user);
    await user.click(screen.getByRole("button", { name: "Timeline" }));
  };

  it("opens a project in place and can go back", async () => {
    const user = setup();
    await open(user);
    expect(screen.getByRole("heading", { level: 1, name: "Дипломна работа" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "All projects" }));
    expect(screen.getByRole("heading", { level: 1, name: "Your projects" })).toBeInTheDocument();
  });

  it("breaks the project down by task state", async () => {
    const user = setup();
    await open(user);
    // The task filters below use the same words, so the strip's own labels are
    // the divs, not the buttons.
    const stat = (label: string) =>
      screen.getAllByText(label).find((node) => node.tagName === "DIV");
    expect(screen.getByText("Progress").nextSibling).toHaveTextContent("60%");
    expect(stat("Done")?.nextSibling).toHaveTextContent("3");
    expect(stat("In progress")?.nextSibling).toHaveTextContent("1");
    expect(stat("To do")?.nextSibling).toHaveTextContent("1");
  });

  it("reads an activity row as who did what to which task", async () => {
    const user = setup();
    await openTimeline(user);
    expect(screen.getByText("Теодора")).toBeInTheDocument();
    expect(screen.getByText("Draft the methodology section")).toBeInTheDocument();
  });

  it("puts a future deadline above the now marker and the past below it", async () => {
    const user = setup();
    await openTimeline(user);
    expect(screen.getAllByText("Chapter 2 review").length).toBeGreaterThan(0);
    expect(screen.getByText("NOW")).toBeInTheDocument();
    expect(screen.getByText("is due")).toBeInTheDocument();
  });

  it("collapses older activity behind a toggle and counts it", async () => {
    const user = setup();
    await openTimeline(user);
    // The five-day-old row is in the tail, not the recent head.
    expect(screen.queryByText("Book the defense room")).not.toBeInTheDocument();
    const toggle = screen.getByRole("button", { name: /Show earlier activity/ });
    expect(toggle).toHaveTextContent("1");
    await user.click(toggle);
    expect(screen.getByText("Book the defense room")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /Hide earlier activity/ }));
    expect(screen.queryByText("Book the defense room")).not.toBeInTheDocument();
  });

  it("filters the timeline by kind", async () => {
    const user = setup();
    await openTimeline(user);
    await user.click(screen.getByRole("button", { name: "Notes" }));
    expect(screen.getByText("Nothing recorded on this project yet.")).toBeInTheDocument();
  });

  it("offers delete only to the project owner", async () => {
    const user = setup();
    await open(user);
    expect(screen.getByRole("button", { name: "Delete project" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "All projects" }));
    await user.click(screen.getByText("Team onboarding kit"));
    expect(screen.queryByRole("button", { name: "Delete project" })).not.toBeInTheDocument();
  });

  it("asks before deleting, and only then fires the mutation", async () => {
    const user = setup();
    await open(user);
    await user.click(screen.getByRole("button", { name: "Delete project" }));

    /* `alertdialog`, since the shared ConfirmDialog took over from the
       bespoke overlay this surface used to draw. */
    const dialog = screen.getByRole("alertdialog");
    expect(deleteMutate).not.toHaveBeenCalled();
    await user.click(within(dialog).getByRole("button", { name: "Delete" }));
    expect(deleteMutate).toHaveBeenCalledWith({ id: 1 });
  });
});

describe("ProjectsWorkspace — tasks", () => {
  const open = async (user: ReturnType<typeof userEvent.setup>) => {
    // The title span is inert; the overlay button carries the click.
    await user.click(screen.getByRole("button", { name: "Дипломна работа" }));
  };

  it("opens a project on its task board", async () => {
    const user = setup();
    await open(user);
    expect(screen.getByRole("button", { name: "Tasks" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByText("Chapter 2 review")).toBeInTheDocument();
    expect(screen.getByText("Sources and footnotes")).toBeInTheDocument();
  });

  it("counts each task state on its filter and narrows to it", async () => {
    const user = setup();
    await open(user);
    await user.click(screen.getByRole("button", { name: /^Done ?1$/ }));
    expect(screen.getByText("Draft the methodology section")).toBeInTheDocument();
    expect(screen.queryByText("Chapter 2 review")).not.toBeInTheDocument();
  });

  it("advances a task to the next status from its marker", async () => {
    const user = setup();
    await open(user);
    await user.click(screen.getAllByRole("button", { name: "Move to next status" })[0]!);
    expect(statusMutate).toHaveBeenCalledWith({ taskId: 21, status: "in_progress" });
  });

  it("creates a task from the drawer", async () => {
    const user = setup();
    await open(user);
    await user.click(screen.getByRole("button", { name: "New task" }));

    const drawer = screen.getByRole("dialog");
    await user.type(within(drawer).getByRole("textbox", { name: /Task/ }), "Print the binding");
    await user.click(within(drawer).getByRole("button", { name: "Create task" }));

    expect(createTaskMutate).toHaveBeenCalledWith(
      expect.objectContaining({ projectId: 1, title: "Print the binding", priority: "medium" }),
    );
  });

  it("lists the team and who owns the project", async () => {
    const user = setup();
    await open(user);
    await user.click(screen.getByRole("button", { name: "Team" }));
    expect(screen.getByText("OWNER")).toBeInTheDocument();
    expect(screen.getByText("Мартин")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Invite" })).toBeInTheDocument();
  });
});
