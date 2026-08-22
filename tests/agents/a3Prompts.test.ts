import { describe, it, expect } from "vitest";
import { getA3SystemPrompt } from "~/server/llm/prompts/a3Prompts";

const mockContext = {
  userId: "user-1",
  memory: [],
  locale: "en" as const,
  notes: [
    {
      id: 1,
      createdAt: "2025-06-01T10:00:00.000Z",
      shareStatus: "private",
      isLocked: false,
      unlockedContent: "Shopping list",
    },
    {
      id: 2,
      createdAt: "2025-06-02T12:00:00.000Z",
      shareStatus: "shared",
      isLocked: true,
    },
  ],
};

describe("A3 System Prompt — enhanced", () => {
  it("returns a non-empty string", () => {
    const prompt = getA3SystemPrompt(mockContext);
    expect(typeof prompt).toBe("string");
    expect(prompt.length).toBeGreaterThan(100);
  });

  it("includes Notes Vault identity", () => {
    const prompt = getA3SystemPrompt(mockContext);
    expect(prompt.toLowerCase()).toContain("notes vault");
  });

  it("includes identity & personality section", () => {
    const prompt = getA3SystemPrompt(mockContext);
    expect(prompt.toLowerCase()).toMatch(/identity|personality/);
  });

  it("includes response quality guidelines", () => {
    const prompt = getA3SystemPrompt(mockContext);
    expect(prompt.toLowerCase()).toContain("quality");
  });

  it("includes JSON output instruction", () => {
    const prompt = getA3SystemPrompt(mockContext);
    expect(prompt.toLowerCase()).toContain("json");
  });

  it("includes safety rules", () => {
    const prompt = getA3SystemPrompt(mockContext);
    expect(prompt.toLowerCase()).toContain("safety");
  });

  it("includes note context metadata", () => {
    const prompt = getA3SystemPrompt(mockContext);
    // Should contain note ids and metadata like locked status
    expect(prompt).toContain("id=1");
    expect(prompt).toContain("id=2");
    expect(prompt).toContain("isLocked=false");
    expect(prompt).toContain("isLocked=true");
  });

  it("handles locked notes without leaking content", () => {
    const lockedOnly = {
      userId: "user-1",
      memory: [],
      locale: "en" as const,
      notes: [
        {
          id: 2,
          createdAt: "2025-06-02T12:00:00.000Z",
          shareStatus: "shared",
          isLocked: true,
          // no unlockedContent
        },
      ],
    };
    const prompt = getA3SystemPrompt(lockedOnly);
    expect(typeof prompt).toBe("string");
    // Should not contain any random content since it's locked
    expect(prompt).not.toContain("Shopping list");
  });

  it("handles empty notes array", () => {
    const prompt = getA3SystemPrompt({ userId: "user-1", notes: [], memory: [], locale: "en" });
    expect(typeof prompt).toBe("string");
    expect(prompt.length).toBeGreaterThan(50);
  });
});
