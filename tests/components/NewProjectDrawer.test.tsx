import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

/** Captures what the drawer actually sends to `project.create`. */
const createMutate = vi.fn();

vi.mock("~/trpc/react", () => {
  const invalidate = (): unknown =>
    new Proxy(() => Promise.resolve(), {
      get: () => invalidate(),
      apply: () => Promise.resolve(),
    });

  return {
    api: {
      useUtils: () => new Proxy({}, { get: () => invalidate() }),
      project: {
        create: { useMutation: () => ({ mutate: createMutate, isPending: false }) },
        addCollaborator: { useMutation: () => ({ mutateAsync: vi.fn(), isPending: false }) },
      },
    },
  };
});

const { NewProjectDrawer } = await import("~/components/projects/NewProjectDrawer");

const setup = () => {
  const user = userEvent.setup();
  const view = render(<NewProjectDrawer />);
  return { user, container: view.container };
};

beforeEach(() => {
  createMutate.mockClear();
});

describe("NewProjectDrawer", () => {
  it("starts closed, showing only its trigger", () => {
    setup();
    expect(screen.getByRole("button", { name: "New project" })).toBeInTheDocument();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("opens on the trigger and focuses the name field", async () => {
    const { user } = setup();
    await user.click(screen.getByRole("button", { name: "New project" }));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(await screen.findByPlaceholderText(/Thesis, Q4 launch/)).toHaveFocus();
  });

  it("closes on Escape", async () => {
    const { user } = setup();
    await user.click(screen.getByRole("button", { name: "New project" }));
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("labels the two identically-worded pill sets apart", async () => {
    const { user } = setup();
    await user.click(screen.getByRole("button", { name: "New project" }));
    // "Can view" / "Can edit" appear in both sets; the radiogroup label is what
    // tells a screen reader which control it is reading.
    const visibility = screen.getByRole("radiogroup", { name: "Visibility" });
    const permission = screen.getByRole("radiogroup", { name: "Their permission" });
    expect(within(visibility).getAllByRole("radio")).toHaveLength(3);
    expect(within(permission).getAllByRole("radio")).toHaveLength(2);
  });

  it("portals the drawer to the body, out of the page shell", async () => {
    // The app shell wears `.kairos-page-enter`, whose `forwards` end frame keeps
    // a transform and a `blur(0px)` filter. Either one makes the shell a
    // containing block, so an overlay rendered inside it measures `fixed
    // inset-0` against the shell instead of the viewport — the drawer slid in
    // from the wrong origin and could not be composited. The portal is the fix.
    const { user, container } = setup();
    await user.click(screen.getByRole("button", { name: "New project" }));

    const dialog = screen.getByRole("dialog");
    expect(container).not.toContainElement(dialog);
    expect(dialog.parentElement).toBe(document.body);
  });

  it("will not submit without a name", async () => {
    const { user } = setup();
    await user.click(screen.getByRole("button", { name: "New project" }));
    expect(screen.getByRole("button", { name: "Create project" })).toBeDisabled();
  });

  it("sends the trimmed name, the description and the chosen visibility", async () => {
    const { user } = setup();
    await user.click(screen.getByRole("button", { name: "New project" }));
    await user.type(screen.getByPlaceholderText(/Thesis, Q4 launch/), "  Q4 launch  ");
    await user.type(screen.getByPlaceholderText("What is this project for?"), "Landing and sign-in");
    const visibility = screen.getByRole("radiogroup", { name: "Visibility" });
    await user.click(within(visibility).getByRole("radio", { name: "Can edit" }));
    await user.click(screen.getByRole("button", { name: "Create project" }));

    expect(createMutate).toHaveBeenCalledWith({
      title: "Q4 launch",
      description: "Landing and sign-in",
      shareStatus: "shared_write",
    });
  });

  it("omits an empty description rather than sending a blank string", async () => {
    const { user } = setup();
    await user.click(screen.getByRole("button", { name: "New project" }));
    await user.type(screen.getByPlaceholderText(/Thesis, Q4 launch/), "Thesis");
    await user.click(screen.getByRole("button", { name: "Create project" }));

    expect(createMutate).toHaveBeenCalledWith({
      title: "Thesis",
      description: undefined,
      shareStatus: "private",
    });
  });

  it("defaults to private, and forgets the draft after cancelling", async () => {
    const { user } = setup();
    await user.click(screen.getByRole("button", { name: "New project" }));
    const visibility = screen.getByRole("radiogroup", { name: "Visibility" });
    expect(within(visibility).getByRole("radio", { name: "Private" })).toBeChecked();

    await user.type(screen.getByPlaceholderText(/Thesis, Q4 launch/), "Abandoned");
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    await user.click(screen.getByRole("button", { name: "New project" }));
    expect(screen.getByPlaceholderText(/Thesis, Q4 launch/)).toHaveValue("");
  });
});
