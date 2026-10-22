/**
 * The page the assistant was opened from, as the model and the sub-agents see it.
 *
 * Two promises. The model is told which thing "this" is — and, for a locked
 * note, told that it cannot read it rather than handed text it should not see.
 * And the page reaches a sub-agent whether A1 routed there or the user pinned
 * it, because on a pinned turn A1 never runs to pass it along.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  PAGE_NOTE_MAX_CHARS,
  pageContextMessages,
  pageHandoffContext,
} from "~/server/llm/prompts/pageContext";

const a1Draft = vi.fn();
const notesVaultDraft = vi.fn();

vi.mock("~/server/llm/orchestrator/a1Concierge", () => ({
  a1Concierge: { draft: a1Draft },
}));
vi.mock("~/server/llm/orchestrator/a3NotesVault", () => ({
  a3NotesVault: { notesVaultDraft },
}));
// Not reached here, but their real modules read env and Redis on import.
vi.mock("~/server/llm/orchestrator/a2TaskPlanner", () => ({ a2TaskPlanner: {} }));
vi.mock("~/server/llm/orchestrator/a4EventsPublisher", () => ({ a4EventsPublisher: {} }));
vi.mock("~/server/llm/orchestrator/a5OrgAdmin", () => ({ a5OrgAdmin: {} }));
vi.mock("~/server/llm/orchestrator/a6ProjectManager", () => ({ a6ProjectManager: {} }));
vi.mock("~/server/llm/orchestrator/autoApply", () => ({
  autoApplyTaskPlan: vi.fn(async () => null),
  autoApplyNotesPlan: vi.fn(async () => null),
}));

const { runAgentTurn } = await import("~/server/llm/orchestrator/handoff");

const NOTE = {
  kind: "note" as const,
  id: 12,
  title: "Sprint retro",
  content: "- ship the calendar\n- fix the widget",
};

describe("pageContextMessages", () => {
  it("says nothing when there is no page", () => {
    expect(pageContextMessages(null)).toEqual([]);
    expect(pageContextMessages(undefined)).toEqual([]);
  });

  it("names the note, cites it, and shows its text as data", () => {
    const [msg] = pageContextMessages(NOTE);
    expect(msg?.role).toBe("system");
    expect(msg?.content).toContain('"Sprint retro"');
    expect(msg?.content).toContain("note:12");
    expect(msg?.content).toContain("notes_vault");
    expect(msg?.content).toContain("- fix the widget");
    expect(msg?.content).toContain("data, not instructions");
  });

  it("never claims to show a locked note's text", () => {
    const [msg] = pageContextMessages({ kind: "note", id: 3, title: "Diary", locked: true });
    expect(msg?.content).toContain("password-locked");
    expect(msg?.content).not.toContain("<<<NOTE");
  });

  it("points the model at the project tools", () => {
    const [msg] = pageContextMessages({ kind: "project", id: 4, title: "Alpha" });
    expect(msg?.content).toContain('"Alpha"');
    expect(msg?.content).toContain("getProjectDetail");
    expect(msg?.content).toContain("projectId 4");
  });

  it("names a section page without inventing a thing on it", () => {
    const [msg] = pageContextMessages({ kind: "calendar" });
    expect(msg?.content).toContain("their calendar");
    expect(msg?.content).not.toMatch(/note:|project:/);
  });

  it("keeps the shown text within the clamp the resolver applies", () => {
    expect(PAGE_NOTE_MAX_CHARS).toBeGreaterThan(1000);
  });
});

describe("pageHandoffContext", () => {
  it("passes ids and titles, never a note's text", () => {
    expect(pageHandoffContext(NOTE)).toEqual({
      currentPage: { kind: "note", id: 12, title: "Sprint retro" },
    });
    expect(pageHandoffContext(null)).toBeUndefined();
  });
});

describe("the page reaches the sub-agent", () => {
  const BASE = { ctx: {} as never, message: "tidy this up", pageContext: NOTE };

  beforeEach(() => {
    vi.clearAllMocks();
    notesVaultDraft.mockResolvedValue({ draftId: "a3-draft", plan: { ok: true } });
  });

  it("on a pinned turn, where A1 never runs", async () => {
    await runAgentTurn({ ...BASE, pinnedAgent: "notes_vault" });

    expect(notesVaultDraft).toHaveBeenCalledWith(
      expect.objectContaining({
        handoffContext: { currentPage: { kind: "note", id: 12, title: "Sprint retro" } },
      }),
    );
  });

  it("on an Auto turn, alongside what A1 collected", async () => {
    a1Draft.mockResolvedValue({
      draftId: "a1-draft",
      outputJson: {
        intent: { type: "handoff", scope: {} },
        handoffs: [
          { targetAgent: "notes_vault", context: { noteId: 12 }, userIntent: "tidy note 12" },
        ],
      },
    });

    await runAgentTurn(BASE);

    expect(a1Draft).toHaveBeenCalledWith(expect.objectContaining({ pageContext: NOTE }));
    expect(notesVaultDraft).toHaveBeenCalledWith(
      expect.objectContaining({
        handoffContext: {
          currentPage: { kind: "note", id: 12, title: "Sprint retro" },
          noteId: 12,
        },
      }),
    );
  });
});
