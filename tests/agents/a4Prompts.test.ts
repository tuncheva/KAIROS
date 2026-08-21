import { describe, it, expect } from "vitest";
import { getA4SystemPrompt } from "~/server/llm/prompts/a4Prompts";
import type { A4ContextPack } from "~/server/llm/context/a4ContextBuilder";

describe("A4 System Prompt", () => {
  const mockContext: A4ContextPack = {
    memory: [],
    events: [
      {
        id: 1,
        title: "Test Event",
        description: "A test",
        eventDate: "2025-08-01T18:00:00.000Z",
        region: "sofia",
        imageUrl: null,
        enableRsvp: true,
        isOwner: true,
        likeCount: 5,
        commentCount: 2,
        authorName: "Alice",
        createdAt: "2025-07-01T12:00:00.000Z",
      },
    ],
    userId: "user-123",
  };

  it("returns a non-empty string", () => {
    const prompt = getA4SystemPrompt(mockContext);
    expect(typeof prompt).toBe("string");
    expect(prompt.length).toBeGreaterThan(100);
  });

  it("includes the agent identity", () => {
    const prompt = getA4SystemPrompt(mockContext);
    expect(prompt).toContain("Events Publisher");
  });

  it("includes JSON-only output instruction", () => {
    const prompt = getA4SystemPrompt(mockContext);
    expect(prompt.toLowerCase()).toContain("json");
  });

  it("includes region enum values", () => {
    const prompt = getA4SystemPrompt(mockContext);
    expect(prompt).toContain("sofia");
    expect(prompt).toContain("plovdiv");
  });

  it("includes clientRequestId instruction", () => {
    const prompt = getA4SystemPrompt(mockContext);
    expect(prompt).toContain("clientRequestId");
  });

  it("includes dangerous flag instruction", () => {
    const prompt = getA4SystemPrompt(mockContext);
    expect(prompt).toContain("dangerous");
  });

  it("includes ISO-8601 date format instruction", () => {
    const prompt = getA4SystemPrompt(mockContext);
    expect(prompt).toContain("ISO-8601");
  });

  it("includes current events context", () => {
    const prompt = getA4SystemPrompt(mockContext);
    expect(prompt).toContain("Test Event");
  });

  it("includes user context", () => {
    const prompt = getA4SystemPrompt(mockContext);
    expect(prompt).toContain("Alice");
  });

  it("handles empty events array", () => {
    const prompt = getA4SystemPrompt({
      ...mockContext,
      events: [],
    });
    expect(typeof prompt).toBe("string");
    expect(prompt.length).toBeGreaterThan(50);
  });

  /* ── Enhanced prompt sections ── */
  it("includes identity & personality section", () => {
    const prompt = getA4SystemPrompt(mockContext);
    expect(prompt.toLowerCase()).toMatch(/identity|personality/);
  });

  it("includes response quality guidelines", () => {
    const prompt = getA4SystemPrompt(mockContext);
    expect(prompt.toLowerCase()).toContain("quality");
  });

  it("includes enthusiastic / community guidance", () => {
    const prompt = getA4SystemPrompt(mockContext);
    expect(prompt.toLowerCase()).toMatch(/enthusiast|community/);
  });
});
