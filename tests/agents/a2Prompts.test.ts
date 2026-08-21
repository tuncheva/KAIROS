import { describe, it, expect } from "vitest";
import { getA2SystemPrompt } from "~/server/llm/prompts/a2Prompts";
import type { A2ContextPack } from "~/server/llm/context/a2ContextBuilder";

const mockContext: A2ContextPack = {
  memory: [],
  session: {
    userId: "user-1",
    activeOrganizationId: 1,
  },
  scope: { orgId: 1, projectId: 10 },
  project: {
    id: 10,
    title: "Project Beta",
    description: "A sample project",
    createdById: "user-1",
  },
  collaborators: [
    { id: "user-1", name: "Alice" },
    { id: "user-2", name: "Bob" },
  ],
  existingTasks: [
    {
      id: 1,
      title: "Scaffold API",
      description: "Set up routes",
      status: "todo",
      priority: "high",
      assignedToId: "user-1",
      orderIndex: 0,
      dueDate: null,
    },
  ],
};

describe("A2 System Prompt — enhanced", () => {
  it("returns a non-empty string", () => {
    const prompt = getA2SystemPrompt(mockContext);
    expect(typeof prompt).toBe("string");
    expect(prompt.length).toBeGreaterThan(100);
  });

  it("includes Task Planner identity", () => {
    const prompt = getA2SystemPrompt(mockContext);
    expect(prompt.toLowerCase()).toContain("task planner");
  });

  it("includes identity & personality section", () => {
    const prompt = getA2SystemPrompt(mockContext);
    // Should contain methodical or personality-related terms
    expect(prompt.toLowerCase()).toMatch(/methodical|personality|identity/);
  });

  it("includes response quality guidelines", () => {
    const prompt = getA2SystemPrompt(mockContext);
    expect(prompt.toLowerCase()).toContain("quality");
  });

  it("includes action-verb or specific title guidance", () => {
    const prompt = getA2SystemPrompt(mockContext);
    expect(prompt.toLowerCase()).toMatch(/action.verb|specific.*title|title/);
  });

  it("includes acceptance criteria guidance", () => {
    const prompt = getA2SystemPrompt(mockContext);
    expect(prompt.toLowerCase()).toContain("acceptance");
  });

  it("includes JSON output instruction", () => {
    const prompt = getA2SystemPrompt(mockContext);
    expect(prompt.toLowerCase()).toContain("json");
  });

  it("includes project context", () => {
    const prompt = getA2SystemPrompt(mockContext);
    expect(prompt).toContain("Project Beta");
  });

  it("includes collaborator names", () => {
    const prompt = getA2SystemPrompt(mockContext);
    expect(prompt).toContain("Alice");
    expect(prompt).toContain("Bob");
  });

  it("handles missing project gracefully", () => {
    const noProject: A2ContextPack = {
      ...mockContext,
      project: undefined,
      existingTasks: [],
      collaborators: [],
    };
    const prompt = getA2SystemPrompt(noProject);
    expect(typeof prompt).toBe("string");
    expect(prompt.length).toBeGreaterThan(50);
  });
});
