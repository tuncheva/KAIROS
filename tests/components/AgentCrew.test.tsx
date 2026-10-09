import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

/**
 * Settings → AI → Your crew: every agent is reachable, picking one shows what
 * it does, and renaming is validated before it is sent and gated on admin.
 */

const state = vi.hoisted(() => ({
  names: { overrides: {} as Record<string, string>, scope: "workspace", canEdit: true },
  setName: vi.fn(async (input: unknown) => input),
  settings: {
    values: {} as Record<string, unknown>,
    scope: "workspace",
    canEditWorkspace: true,
    canAutoApply: true,
  },
  setSetting: vi.fn(async (input: unknown) => input),
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
      project: {
        getMyProjects: query([
          { id: 11, title: "Website" },
          { id: 12, title: "Mobile app" },
        ]),
      },
      agent: {
        names: { useQuery: () => ({ data: state.names }) },
        memory: query([{ id: 1, scope: "task_planner", key: "k", value: "v" }]),
        schedules: query([
          { kind: "daily_brief", enabled: true, hourLocal: 8, dayOfWeek: null, channel: "app" },
        ]),
        setName: {
          useMutation: () => ({ mutateAsync: state.setName, isPending: false }),
        },
        settings: { useQuery: () => ({ data: state.settings }) },
        setSetting: {
          useMutation: () => ({ mutateAsync: state.setSetting, isPending: false }),
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
    state.settings = { values: {}, scope: "workspace", canEditWorkspace: true, canAutoApply: true };
    state.setSetting.mockClear();
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

  it("has nothing left marked as coming: every setting shown is real", () => {
    render(<AgentCrew />);
    const agents = screen.getAllByRole("button", { pressed: false }).map((b) => b.getAttribute("aria-label")!);
    for (const name of ["Mentor, Workspace Concierge", ...agents]) {
      fireEvent.click(screen.getByRole("button", { name }));
      expect(screen.queryByText("Soon"), name).not.toBeInTheDocument();
    }
  });

  it("saves Mentor's tone and pins a reply language", async () => {
    render(<AgentCrew />);
    fireEvent.change(screen.getByRole("combobox", { name: "Tone" }), { target: { value: "direct" } });
    await waitFor(() =>
      expect(state.setSetting).toHaveBeenCalledWith({ id: "workspace_concierge.tone", value: "direct" }),
    );
    const language = screen.getByRole("combobox", { name: "Reply language" });
    expect(language).toHaveDisplayValue("Match my message");
    fireEvent.change(language, { target: { value: "bg" } });
    await waitFor(() =>
      expect(state.setSetting).toHaveBeenCalledWith({
        id: "workspace_concierge.replyLanguage",
        value: "bg",
      }),
    );
  });

  it("saves a meeting lead time", async () => {
    render(<AgentCrew />);
    fireEvent.click(screen.getByRole("button", { name: "Nestor, Meeting Prep" }));
    fireEvent.change(screen.getByRole("combobox", { name: "Lead time" }), { target: { value: "15" } });
    await waitFor(() =>
      expect(state.setSetting).toHaveBeenCalledWith({ id: "meeting_prep.leadMinutes", value: 15 }),
    );
  });

  it("toggles brief sections but never lets the last one go", async () => {
    state.settings.values = { "daily_brief.sections": ["dueToday", "risks"] };
    render(<AgentCrew />);
    fireEvent.click(screen.getByRole("button", { name: "Hemera, Daily Brief" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Events" }));
    await waitFor(() =>
      expect(state.setSetting).toHaveBeenCalledWith({
        id: "daily_brief.sections",
        value: ["dueToday", "risks", "events"],
      }),
    );

    state.setSetting.mockClear();
    state.settings.values = { "daily_brief.sections": ["risks"] };
    fireEvent.click(screen.getByRole("button", { name: "Argus, Risk Radar" }));
    fireEvent.click(screen.getByRole("button", { name: "Hemera, Daily Brief" }));
    expect(screen.getByRole("checkbox", { name: "Risks" })).toBeDisabled();
    expect(screen.getByRole("checkbox", { name: "Events" })).toBeEnabled();
  });

  it("saves a live setting as its typed value", async () => {
    state.settings.values = { "risk_radar.stalledAfterDays": 14 };
    render(<AgentCrew />);
    fireEvent.click(screen.getByRole("button", { name: "Argus, Risk Radar" }));
    const select = screen.getByRole("combobox", { name: "Stalled after" });
    expect(select).toHaveValue("14");
    fireEvent.change(select, { target: { value: "30" } });
    await waitFor(() =>
      expect(state.setSetting).toHaveBeenCalledWith({ id: "risk_radar.stalledAfterDays", value: 30 }),
    );
  });

  it("lets anyone change a personal setting, admin or not", () => {
    state.settings.canEditWorkspace = false;
    render(<AgentCrew />);
    fireEvent.click(screen.getByRole("button", { name: "Argus, Risk Radar" }));
    expect(screen.getByRole("combobox", { name: "Stalled after" })).toBeEnabled();
  });

  it("groups the task defaults under one row, each with its own label", async () => {
    render(<AgentCrew />);
    fireEvent.click(screen.getByRole("button", { name: "Odysseus, Task Planner" }));
    expect(screen.getByRole("combobox", { name: "Priority" })).toHaveValue("medium");
    expect(screen.getByRole("combobox", { name: "Due" })).toHaveValue("none");
    fireEvent.change(screen.getByRole("combobox", { name: "Assignee" }), {
      target: { value: "requester" },
    });
    await waitFor(() =>
      expect(state.setSetting).toHaveBeenCalledWith({
        id: "task_planner.assignee",
        value: "requester",
      }),
    );
  });

  it("locks workspace defaults for someone who is not an admin", () => {
    state.settings.canEditWorkspace = false;
    render(<AgentCrew />);
    fireEvent.click(screen.getByRole("button", { name: "Iris, Events Publisher" }));
    expect(screen.getByRole("combobox", { name: "Length" })).toBeDisabled();
    expect(screen.getByRole("switch", { name: "RSVP" })).toBeDisabled();
    expect(screen.getByText("Only a workspace admin can change this.")).toBeInTheDocument();
  });

  it("saves a naming pattern on Enter, not on every keystroke", async () => {
    render(<AgentCrew />);
    fireEvent.click(screen.getByRole("button", { name: "Daedalus, Project Manager" }));
    expect(screen.getByText(/Placeholders: \{client\}, \{topic\}/)).toBeInTheDocument();
    const field = screen.getByRole("textbox", { name: "Naming pattern" });
    fireEvent.change(field, { target: { value: "{client} · {year} " } });
    expect(state.setSetting).not.toHaveBeenCalled();
    fireEvent.keyDown(field, { key: "Enter" });
    await waitFor(() =>
      expect(state.setSetting).toHaveBeenCalledWith({
        id: "project_manager.namingPattern",
        value: "{client} · {year}",
      }),
    );
  });

  it("offers scope only to agents that work inside projects", () => {
    render(<AgentCrew />);
    for (const name of ["Mnemosyne, Notes Vault", "Iris, Events Publisher", "Solon, Organization Admin"]) {
      fireEvent.click(screen.getByRole("button", { name }));
      expect(screen.queryByText("Scope")).not.toBeInTheDocument();
    }
    fireEvent.click(screen.getByRole("button", { name: "Daedalus, Project Manager" }));
    expect(screen.getByRole("combobox", { name: "Scope" })).toHaveValue("all");
  });

  it("narrows a scope to chosen projects, saving only once one is ticked", async () => {
    render(<AgentCrew />);
    fireEvent.click(screen.getByRole("button", { name: "Odysseus, Task Planner" }));
    fireEvent.change(screen.getByRole("combobox", { name: "Scope" }), { target: { value: "only" } });
    expect(state.setSetting).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("checkbox", { name: "Mobile app" }));
    await waitFor(() =>
      expect(state.setSetting).toHaveBeenCalledWith({
        id: "task_planner.scope",
        value: { mode: "only", projectIds: [12] },
      }),
    );
  });

  it("keeps the last chosen project ticked, and widens back to all", async () => {
    state.settings.values = { "task_planner.scope": { mode: "only", projectIds: [11] } };
    render(<AgentCrew />);
    fireEvent.click(screen.getByRole("button", { name: "Odysseus, Task Planner" }));
    expect(screen.getByRole("checkbox", { name: "Website" })).toBeDisabled();
    fireEvent.change(screen.getByRole("combobox", { name: "Scope" }), { target: { value: "all" } });
    await waitFor(() =>
      expect(state.setSetting).toHaveBeenCalledWith({ id: "task_planner.scope", value: { mode: "all" } }),
    );
  });

  it("offers approval only for tasks and notes, the changes that can be undone", () => {
    render(<AgentCrew />);
    for (const name of ["Iris, Events Publisher", "Solon, Organization Admin", "Daedalus, Project Manager"]) {
      fireEvent.click(screen.getByRole("button", { name }));
      expect(screen.queryByText("Approval")).not.toBeInTheDocument();
    }
    fireEvent.click(screen.getByRole("button", { name: "Mnemosyne, Notes Vault" }));
    expect(screen.getByRole("combobox", { name: "You" })).toHaveValue("ask");
  });

  it("lets a member choose for themselves while the workspace switch stays the admin's", async () => {
    state.settings.canEditWorkspace = false;
    render(<AgentCrew />);
    fireEvent.click(screen.getByRole("button", { name: "Odysseus, Task Planner" }));
    expect(screen.getByRole("switch", { name: "Allowed in workspace" })).toBeDisabled();
    fireEvent.change(screen.getByRole("combobox", { name: "You" }), { target: { value: "autoSmall" } });
    await waitFor(() =>
      expect(state.setSetting).toHaveBeenCalledWith({ id: "task_planner.approval", value: "autoSmall" }),
    );
  });

  it("locks the choice, and says why, without undo", () => {
    state.settings.canAutoApply = false;
    render(<AgentCrew />);
    fireEvent.click(screen.getByRole("button", { name: "Odysseus, Task Planner" }));
    expect(screen.getByRole("combobox", { name: "You" })).toBeDisabled();
    expect(screen.getByText("Needs Undo, which comes with Pro.")).toBeInTheDocument();
  });
});

