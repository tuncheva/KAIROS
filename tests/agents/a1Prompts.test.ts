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

  it("states the scope guard", () => {
    const prompt = getA1SystemPrompt(mockContext);
    expect(prompt).toContain(
      "Sorry, I am not designed for these type of questions.",
    );
  });

  /**
   * The prompt used to enumerate the five locales with message files and imply
   * the reply language was chosen from that list. It is not a list any more:
   * the model mirrors whatever it was written to in, and the shipped locales
   * only decide the fallback.
   */
  it("tells the model to mirror the message language rather than pick from a list", () => {
    const prompt = getA1SystemPrompt(mockContext);
    expect(prompt).toContain("Reply in the language of the user's latest message");
    expect(prompt).toContain(
      "including languages KAIROS has no interface translation for",
    );
    expect(prompt).toContain("Never refuse, defer or shorten a request because of the language");
  });

  /**
   * The fallback exists for a message with nothing to detect from — "ok", an id,
   * a button press — not as a whitelist. It is the user's saved preference so a
   * Spanish speaker is not answered in English by default.
   */
  it("names the user's saved locale as the fallback reply language", () => {
    const spanish = getA1SystemPrompt({ ...mockContext, locale: "es" });
    expect(spanish).toContain("Fall back to Spanish (español)");

    const bulgarian = getA1SystemPrompt({ ...mockContext, locale: "bg" });
    expect(bulgarian).toContain("Fall back to Bulgarian (български)");
  });

  /**
   * A1 is the only agent that sees what the user typed. If it translates the
   * request on the way to a sub-agent, the sub-agent drafts in the wrong
   * language and there is nothing downstream that can tell.
   */
  it("tells A1 to keep the handoff intent in the user's language", () => {
    const prompt = getA1SystemPrompt(mockContext);
    expect(prompt).toContain("written in the language the user used");
    expect(prompt).toContain("Do not translate their request into English");
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
          scope: "global",
          updatedAt: new Date(),
        },
      ],
    });
    expect(prompt).toContain("What you know about this user");
    expect(prompt).toContain("Sprints run Monday to Friday.");
  });

  /**
   * A fact set for one agent must not read as a general truth: the model has to
   * be able to tell "they always want Bulgarian" from "when *you* draft tasks,
   * use Bulgarian", or it will apply the second everywhere.
   */
  it("separates agent-scoped facts from global ones", () => {
    const prompt = getA1SystemPrompt({
      ...mockContext,
      memory: [
        {
          id: 1,
          key: "sprint_cadence",
          value: "Sprints run Monday to Friday.",
          scope: "global",
          updatedAt: new Date(),
        },
        {
          id: 2,
          key: "task_language",
          value: "Write task titles in Bulgarian.",
          scope: "task_planner",
          updatedAt: new Date(),
        },
      ],
    });
    expect(prompt).toContain("They set these for you in particular");
    expect(prompt).toContain("Write task titles in Bulgarian.");
    // The global fact must not have migrated under the scoped heading.
    const scopedHeadingAt = prompt.indexOf("They set these for you in particular");
    expect(prompt.indexOf("Sprints run Monday to Friday.")).toBeLessThan(
      scopedHeadingAt,
    );
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
