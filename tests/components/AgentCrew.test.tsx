import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

/**
 * Settings → AI → Your crew: every agent is reachable, picking one shows what
 * it does, and renaming is validated before it is sent and gated on admin.
 */

const state = vi.hoisted(() => ({
  names: { overrides: {} as Record<string, string>, scope: "workspace", canEdit: true },
  setName: vi.fn(async (input: unknown) => input),
}));

vi.mock("~/trpc/react", () => {
  const query = (data: unknown) => ({ useQuery: () => ({ data, isLoading: false, error: null }) });
  const invalidate = new Proxy(() => Promise.resolve(), {
    get: (): unknown => invalidate,
    apply: () => Promise.resolve(),
  });
  return {
    api: {
      useUtils: () => new Proxy({}, { get: () => invalidate }),
      agent: {
        names: { useQuery: () => ({ data: state.names }) },
        memory: query([{ id: 1, scope: "task_planner", key: "k", value: "v" }]),
        schedules: query([
          { kind: "daily_brief", enabled: true, hourLocal: 8, dayOfWeek: null, channel: "app" },
        ]),
        setName: {
          useMutation: () => ({ mutateAsync: state.setName, isPending: false }),
        },
      },
    },
  };
});

import { AgentCrew } from "~/components/settings/AgentCrew";

describe("AgentCrew", () => {
  beforeEach(() => {
    state.names = { overrides: {}, scope: "workspace", canEdit: true };
    state.setName.mockClear();
  });

  it("draws all ten agents as buttons, starting on the concierge", () => {
    render(<AgentCrew />);
    expect(screen.getAllByRole("button", { pressed: false })).toHaveLength(9);
    expect(screen.getByRole("button", { pressed: true })).toHaveAccessibleName(
      "Mentor, Workspace Concierge",
    );
    expect(screen.getByRole("heading", { name: "Mentor" })).toBeInTheDocument();
  });

  it("shows the picked agent's role and its settings", () => {
    render(<AgentCrew />);
    fireEvent.click(screen.getByRole("button", { name: "Odysseus, Task Planner" }));
    expect(screen.getByRole("heading", { name: "Odysseus" })).toBeInTheDocument();
    expect(screen.getByText("Task defaults")).toBeInTheDocument();
    expect(screen.getByText("1 fact")).toBeInTheDocument();
  });

  it("uses the workspace's name for a renamed agent", () => {
    state.names = { overrides: { task_planner: "Ody" }, scope: "workspace", canEdit: true };
    render(<AgentCrew />);
    expect(screen.getByRole("button", { name: "Ody, Task Planner" })).toBeInTheDocument();
  });

  it("refuses a name another agent already has, without calling the server", () => {
    render(<AgentCrew />);
    fireEvent.click(screen.getByRole("button", { name: "Odysseus, Task Planner" }));
    const input = screen.getByRole("textbox", { name: /Task Planner/ });
    fireEvent.change(input, { target: { value: "mentor" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(screen.getByText("Another agent already goes by that name.")).toBeInTheDocument();
    expect(state.setName).not.toHaveBeenCalled();
  });

  it("saves a valid name for the agent being edited", async () => {
    render(<AgentCrew />);
    fireEvent.click(screen.getByRole("button", { name: "Odysseus, Task Planner" }));
    const input = screen.getByRole("textbox", { name: /Task Planner/ });
    fireEvent.change(input, { target: { value: "  Ody  " } });
    fireEvent.keyDown(input, { key: "Enter" });
    await waitFor(() =>
      expect(state.setName).toHaveBeenCalledWith({ agentId: "task_planner", name: "Ody" }),
    );
  });

  it("locks the name for someone who is not a workspace admin", () => {
    state.names = { overrides: {}, scope: "workspace", canEdit: false };
    render(<AgentCrew />);
    expect(screen.getByRole("textbox", { name: /Workspace Concierge/ })).toBeDisabled();
    expect(screen.getByText("Only a workspace admin can rename agents.")).toBeInTheDocument();
  });
});
