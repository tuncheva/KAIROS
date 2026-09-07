import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

/**
 * Archiving a project, and finding it again afterwards.
 *
 * `project.archiveProject` and `project.reopenProject` shipped with no UI at
 * all. The trap in wiring them is that `getMyProjects` already excludes
 * archived rows, so an archive button on its own is a one-way door: the project
 * vanishes from the only list that renders it and the owner can never reach
 * `reopenProject`. These cover both halves.
 */

const archiveMutate = vi.fn();
const reopenMutate = vi.fn();

const OWNER = "user-owner";

const LIVE = [
  {
    id: 1,
    title: "Autumn Festival",
    description: "The live one",
    createdById: OWNER,
    createdAt: new Date("2026-01-01"),
    updatedAt: new Date("2026-01-02"),
    organizationId: null,
    status: "active",
    shareStatus: "private",
    createdByUser: { id: OWNER, name: "Teodora", email: "t@x.test", image: null },
    tasks: [],
    collaborators: [],
  },
];

const ARCHIVED = [
  {
    id: 2,
    title: "Spring Showcase",
    description: "Finished last year",
    createdById: OWNER,
    createdAt: new Date("2025-01-01"),
    updatedAt: new Date("2025-06-02"),
    organizationId: null,
    status: "archived",
    shareStatus: "private",
    createdByUser: { id: OWNER, name: "Teodora", email: "t@x.test", image: null },
    tasks: [],
    collaborators: [],
  },
];

/** Swapped per test so the empty-workspace case can be exercised. */
let liveRows: unknown[] = LIVE;
let archivedRows: unknown[] = ARCHIVED;

vi.mock("~/trpc/react", () => {
  const query = (get: () => unknown) => ({
    useQuery: () => ({
      data: get(),
      isLoading: false,
      error: null,
      refetch: vi.fn(),
    }),
  });
  const invalidate = (): unknown =>
    new Proxy(() => Promise.resolve(), {
      get: () => invalidate(),
      apply: () => Promise.resolve(),
    });
  const noop = { useMutation: () => ({ mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false }) };

  return {
    api: {
      useUtils: () => new Proxy({}, { get: () => invalidate() }),
      project: {
        getMyProjects: query(() => liveRows),
        getArchivedProjects: query(() => archivedRows),
        getById: query(() => null),
        archiveProject: {
          useMutation: () => ({ mutate: archiveMutate, isPending: false }),
        },
        reopenProject: {
          useMutation: () => ({ mutate: reopenMutate, isPending: false }),
        },
        delete: noop,
        create: noop,
        addCollaborator: noop,
        removeCollaborator: noop,
        updateCollaboratorPermission: noop,
      },
      task: {
        getByProject: query(() => []),
        getProjectActivity: query(() => []),
        create: noop,
        update: noop,
        updateStatus: noop,
        adminDiscard: noop,
        delete: noop,
        getActivityLog: query(() => []),
        setCompletionNote: noop,
      },
      organization: { getMembers: query(() => []) },
      agent: { generateTaskDrafts: noop, extractTasksFromPdf: noop },
    },
  };
});

const { ProjectsWorkspace } = await import(
  "~/components/projects/ProjectsWorkspace"
);

function setup() {
  return render(<ProjectsWorkspace userId={OWNER} />);
}

describe("the project archive", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    liveRows = LIVE;
    archivedRows = ARCHIVED;
  });

  it("keeps archived projects out of the live list", () => {
    setup();
    expect(screen.getByText("Autumn Festival")).toBeInTheDocument();
    expect(screen.queryByText("Spring Showcase")).not.toBeInTheDocument();
  });

  it("offers a way into the archive, counted", async () => {
    const user = userEvent.setup();
    setup();

    const toggle = screen.getByRole("button", { name: /Archived/ });
    expect(toggle).toHaveAttribute("aria-expanded", "false");

    await user.click(toggle);

    // Only once opened does the archived project appear.
    expect(await screen.findByText("Spring Showcase")).toBeInTheDocument();
  });

  it("reopens a project from the archive", async () => {
    const user = userEvent.setup();
    setup();

    await user.click(screen.getByRole("button", { name: /Archived/ }));
    await user.click(await screen.findByRole("button", { name: "Reopen" }));

    expect(reopenMutate).toHaveBeenCalledWith({ projectId: 2 });
  });

  it("does not pitch first-run to someone whose only project is archived", () => {
    // The trap: `getMyProjects` is empty, but the workspace is not new.
    liveRows = [];
    setup();

    expect(
      screen.getByRole("button", { name: /Archived/ }),
    ).toBeInTheDocument();
  });

  it("still shows first-run when there is genuinely nothing", () => {
    liveRows = [];
    archivedRows = [];
    setup();

    expect(
      screen.queryByRole("button", { name: /Archived/ }),
    ).not.toBeInTheDocument();
  });

  it("asks before archiving, and only then fires the mutation", async () => {
    const user = userEvent.setup();
    setup();

    // The title span is inert; the overlay button carries the click.
    await user.click(screen.getByRole("button", { name: "Autumn Festival" }));
    await user.click(
      await screen.findByRole("button", { name: "Archive project" }),
    );

    // The dialog stands between the button and the write.
    expect(archiveMutate).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "Archive" }));
    expect(archiveMutate).toHaveBeenCalledWith({ projectId: 1 });
  });
});
