import { describe, it, expect } from "vitest";
import { getA1SystemPrompt } from "~/server/llm/prompts/a1Prompts";
import type { A1ContextPack } from "~/server/llm/context/a1ContextBuilder";

const mockContext: A1ContextPack = {
  session: {
    userId: "user-1",
    email: "alice@example.com",
    name: "Alice",
    activeOrganizationId: 1,
  },
  projects: [{ id: 1, title: "Project Alpha", status: "active" }],
  scopedProjectId: null,
  locale: "en",
  memory: [],
  now: new Date().toISOString(),
};

describe("A1 System Prompt", () => {
  it("returns a non-empty string", () => {
    const prompt = getA1SystemPrompt(mockContext);
    expect(typeof prompt).toBe("string");
    expect(prompt.length).toBeGreaterThan(100);
  });

  it("includes Workspace Concierge identity", () => {
    const prompt = getA1SystemPrompt(mockContext);
    expect(prompt.toLowerCase()).toContain("concierge");
  });

  it("seeds the project list so the model can resolve ids", () => {
    const prompt = getA1SystemPrompt(mockContext);
    expect(prompt).toContain("Project Alpha");
    expect(prompt).toContain('"id": 1');
  });

  it("tells the model to fetch rather than guess", () => {
    const prompt = getA1SystemPrompt(mockContext);
    expect(prompt).toContain("only see what you fetch");
    expect(prompt).toContain("getProjectDetail");
  });

  it("names a handoff target for each write agent", () => {
    const prompt = getA1SystemPrompt(mockContext);
    for (const agent of ["task_planner", "notes_vault", "events_publisher"]) {
      expect(prompt).toContain(agent);
    }
  });

  it("states the scope guard and the language rule", () => {
    const prompt = getA1SystemPrompt(mockContext);
    expect(prompt).toContain(
      "Sorry, I am not designed for these type of questions.",
    );
    // Five locales ship message files, so five are offered. The prompt used to
    // hardcode "English or Bulgarian" and refuse the other three outright.
    for (const language of ["English", "Bulgarian", "Spanish", "French", "German"]) {
      expect(prompt).toContain(language);
    }
  });

  /**
   * The reply language falls back to the user's saved preference rather than
   * being guessed from the message, which is what made the other three locales
   * unreachable: a Spanish speaker writing a project name in English got English.
   */
  it("names the user's saved locale as the fallback reply language", () => {
    const spanish = getA1SystemPrompt({ ...mockContext, locale: "es" });
    expect(spanish).toContain("Otherwise reply in Spanish");

    const bulgarian = getA1SystemPrompt({ ...mockContext, locale: "bg" });
    expect(bulgarian).toContain("Otherwise reply in Bulgarian");
  });

  it("offers search before drill-down", () => {
    const prompt = getA1SystemPrompt(mockContext);
    expect(prompt).toContain("searchWorkspace");
  });

  it("names org_admin as a handoff target now that A5 exists", () => {
    const prompt = getA1SystemPrompt(mockContext);
    expect(prompt).toContain("org_admin");
  });

  it("omits the memory block entirely when there is nothing remembered", () => {
    const prompt = getA1SystemPrompt(mockContext);
    expect(prompt).not.toContain("What you know about this user");
  });

  it("includes remembered facts when there are any", () => {
    const prompt = getA1SystemPrompt({
      ...mockContext,
      memory: [
        {
          id: 1,
          key: "sprint_cadence",
          value: "Sprints run Monday to Friday.",
          updatedAt: new Date(),
        },
      ],
    });
    expect(prompt).toContain("What you know about this user");
    expect(prompt).toContain("Sprints run Monday to Friday.");
  });

  /**
   * The workspace snapshot used to be pasted into the prompt on every turn, so
   * the prefix changed with the data and could never be cached. Tools replaced
   * it; a task list reappearing here means that regressed.
   */
  it("does not embed task or notification data", () => {
    const prompt = getA1SystemPrompt(mockContext);
    expect(prompt).not.toContain('"tasks"');
    expect(prompt).not.toContain('"notifications"');
  });

  it("points at the scoped project when the UI has one open", () => {
    const scoped = getA1SystemPrompt({ ...mockContext, scopedProjectId: 7 });
    expect(scoped).toContain("currently viewing project 7");

    const unscoped = getA1SystemPrompt(mockContext);
    expect(unscoped).toContain("No project is currently in view");
  });

  it("handles an empty workspace gracefully", () => {
    const prompt = getA1SystemPrompt({ ...mockContext, projects: [] });
    expect(typeof prompt).toBe("string");
    expect(prompt.length).toBeGreaterThan(50);
  });
});
