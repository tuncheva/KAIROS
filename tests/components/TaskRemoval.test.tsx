import { describe, it, expect, vi, beforeEach } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";

/**
 * Which delete a task offers, and to whom.
 *
 * `task.delete` had no caller: the panel painted one trash button on
 * `userHasWriteAccess` and pointed it at `task.adminDiscard`, which only a
 * project owner or org admin may call. So a write collaborator was shown a
 * control the server always refused, and the flag-gated route was unreachable.
 *
 * The two procedures do the same thing to the same row; only the authorization
 * differs. So there is one control, and it takes whichever route the caller
 * actually holds.
 */

const deleteMutate = vi.fn();
const discardMutate = vi.fn();

const USER = "user-me";

/** Rewritten per test — this is the whole subject of the file. */
let caps = {
  createdById: USER,
  userHasWriteAccess: true,
  userCanDeleteTasks: false,
  userCanDiscardTasks: false,
};

const TASK = {
  id: 42,
  title: "Book the venue",
  description: "",
  status: "pending",
  priority: "medium",
  dueDate: null,
  completedAt: null,
  completionNote: null,
  orderIndex: 0,
  createdAt: new Date("2026-02-01"),
  lastEditedAt: null,
  assignedTo: null,
  createdBy: null,
  completedBy: null,
  lastEditedBy: null,
};

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
  const noop = {
    useMutation: () => ({ mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false }),
  };

  return {
    api: {
      useUtils: () => new Proxy({}, { get: () => invalidate() }),
      project: {
        getById: query(() => ({ ...caps, id: 7, title: "P", tasks: [TASK], collaborators: [] })),
      },
      task: {
        getByProject: query(() => [TASK]),
        getProjectActivity: query(() => []),
        getActivityLog: query(() => []),
        delete: { useMutation: () => ({ mutate: deleteMutate, isPending: false }) },
        adminDiscard: {
          useMutation: () => ({ mutate: discardMutate, isPending: false }),
        },
        create: noop,
        update: noop,
        updateStatus: noop,
        setCompletionNote: noop,
      },
      organization: { getMembers: query(() => []) },
      settings: { get: query(() => null) },
      agent: { generateTaskDrafts: noop, extractTasksFromPdf: noop },
    },
  };
});

const { ProjectTasksPanel } = await import(
  "~/components/projects/ProjectTasksPanel"
);

function setup() {
  return render(<ProjectTasksPanel projectId={7} userId={USER} />);
}

/** The trash control, whichever route it takes. */
function removeButton() {
  return screen.queryByRole("button", { name: "Discard task" });
}

describe("removing a task", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    caps = {
      createdById: USER,
      userHasWriteAccess: true,
      userCanDeleteTasks: false,
      userCanDiscardTasks: false,
    };
  });

  it("hides the control from a contributor who can write but not delete", () => {
    caps = {
      createdById: "someone-else",
      userHasWriteAccess: true,
      userCanDeleteTasks: false,
      userCanDiscardTasks: false,
    };
    setup();

    // Write access alone is not permission to delete — the old bug.
    expect(screen.getByText("Book the venue")).toBeInTheDocument();
    expect(removeButton()).not.toBeInTheDocument();
  });

  it("takes the ordinary route when the caller holds the delete flag", async () => {
    caps = {
      createdById: "someone-else",
      userHasWriteAccess: true,
      userCanDeleteTasks: true,
      userCanDiscardTasks: false,
    };
    setup();

    // Arm, then confirm. fireEvent rather than userEvent: the control resets
    // itself on blur, and userEvent moves focus around each click.
    fireEvent.click(removeButton()!);
    fireEvent.click(removeButton()!);

    expect(deleteMutate).toHaveBeenCalledWith({ taskId: 42 });
    expect(discardMutate).not.toHaveBeenCalled();
  });

  it("falls back to the admin override when only that is held", async () => {
    caps = {
      createdById: USER,
      userHasWriteAccess: true,
      userCanDeleteTasks: false,
      userCanDiscardTasks: true,
    };
    setup();

    fireEvent.click(removeButton()!);
    fireEvent.click(removeButton()!);

    expect(discardMutate).toHaveBeenCalledWith({ taskId: 42 });
    expect(deleteMutate).not.toHaveBeenCalled();
  });

  it("prefers the ordinary route when the caller holds both", async () => {
    caps = {
      createdById: USER,
      userHasWriteAccess: true,
      userCanDeleteTasks: true,
      userCanDiscardTasks: true,
    };
    setup();

    fireEvent.click(removeButton()!);
    fireEvent.click(removeButton()!);

    // `adminDiscard` stays the override, not the default path for an owner.
    expect(deleteMutate).toHaveBeenCalledWith({ taskId: 42 });
    expect(discardMutate).not.toHaveBeenCalled();
  });

  it("still asks before removing", async () => {
    caps = {
      createdById: USER,
      userHasWriteAccess: true,
      userCanDeleteTasks: true,
      userCanDiscardTasks: true,
    };
    setup();

    fireEvent.click(removeButton()!);
    expect(deleteMutate).not.toHaveBeenCalled();
  });
});
