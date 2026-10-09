import { describe, expect, it } from "vitest";

import type { A1ContextPack } from "~/server/llm/context/a1ContextBuilder";
import type { A2ContextPack } from "~/server/llm/context/a2ContextBuilder";
import { getA1SystemPrompt } from "~/server/llm/prompts/a1Prompts";
import { getA2SystemPrompt } from "~/server/llm/prompts/a2Prompts";

/** The agents introduce themselves by the names the workspace chose. */

const a1: A1ContextPack = {
  session: { userId: "u1", email: null, name: null, activeOrganizationId: 1 },
  projects: [],
  scopedProjectId: null,
  locale: "en",
  memory: [],
  now: new Date().toISOString(),
};

const a2: A2ContextPack = {
  session: { userId: "u1", activeOrganizationId: 1 },
  scope: {},
  collaborators: [],
  locale: "en",
  memory: [],
} as unknown as A2ContextPack;

describe("agent names in prompts", () => {
  it("uses the Greek defaults when the workspace has not renamed anyone", () => {
    const prompt = getA1SystemPrompt(a1);
    expect(prompt).toMatch(/^You are Mentor,/);
    expect(prompt).toContain("Odysseus (`task_planner`)");
    expect(prompt).not.toContain("chose some of these names itself");
  });

  it("puts a renamed concierge and renamed specialists into A1's prompt", () => {
    const prompt = getA1SystemPrompt({
      ...a1,
      agentNames: { workspace_concierge: "Sage", task_planner: "Ody" },
    });
    expect(prompt).toMatch(/^You are Sage,/);
    expect(prompt).toContain("Ody (`task_planner`)");
    expect(prompt).toContain('"I will pass this to Ody"');
    // Untouched agents keep their defaults.
    expect(prompt).toContain("Mnemosyne (`notes_vault`)");
    expect(prompt).toContain("write those exactly as given");
  });

  it("names the specialist by its workspace name, without leaking the map into the context dump", () => {
    const prompt = getA2SystemPrompt({ ...a2, agentNames: { task_planner: "Ody" } });
    expect(prompt).toMatch(/^You are Ody,/);
    expect(prompt).not.toContain('"agentNames"');
  });
});
