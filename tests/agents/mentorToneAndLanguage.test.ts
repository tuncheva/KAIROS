/**
 * Mentor's "Tone" and "Reply language" settings.
 *
 * Tone is the concierge's voice only. A pinned reply language holds for every
 * conversational agent, because the reply language is decided in one place so
 * that a handoff cannot change it.
 */

import { describe, expect, it } from "vitest";

import { defaultAgentSettings, type ResolvedAgentSettings } from "~/lib/agentSettings";
import type { A1ContextPack } from "~/server/llm/context/a1ContextBuilder";
import type { A2ContextPack } from "~/server/llm/context/a2ContextBuilder";
import { getA1SystemPrompt } from "~/server/llm/prompts/a1Prompts";
import { getA2SystemPrompt } from "~/server/llm/prompts/a2Prompts";
import { fixedReplyLanguage, languageRule } from "~/server/llm/prompts/languageRules";
import { replyLanguageMessages } from "~/server/llm/prompts/replyLanguage";

const settings = (patch: Partial<ResolvedAgentSettings>): ResolvedAgentSettings => ({
  ...defaultAgentSettings(),
  ...patch,
});

const a1: A1ContextPack = {
  session: { userId: "u1", email: null, name: null, activeOrganizationId: null },
  projects: [],
  scopedProjectId: null,
  locale: "en",
  memory: [],
  now: new Date().toISOString(),
};

const a2 = {
  session: { userId: "u1", activeOrganizationId: null },
  scope: {},
  collaborators: [],
  locale: "en",
  memory: [],
} as unknown as A2ContextPack;

const CYRILLIC = /[Ѐ-ӿ]/;

describe("fixedReplyLanguage", () => {
  it("is unset when the user left it on matching their message", () => {
    expect(fixedReplyLanguage(undefined)).toBeUndefined();
    expect(fixedReplyLanguage(defaultAgentSettings())).toBeUndefined();
  });

  it("is the pinned language otherwise", () => {
    expect(fixedReplyLanguage(settings({ "workspace_concierge.replyLanguage": "bg" }))).toBe("bg");
  });
});

describe("a pinned reply language", () => {
  it("replaces detection and the handoff anchor with one directive", () => {
    const messages = replyLanguageMessages({
      locale: "en",
      message: "Plan the launch",
      originalMessage: "Планирай пускането",
      fixed: "de",
    });
    expect(messages).toHaveLength(1);
    expect(messages[0]!.content).toContain("Write this response in German");
    expect(messages[0]!.content).not.toContain("rephrased by another agent");
  });

  it("tells the system prompt to stop mirroring the message", () => {
    const rule = languageRule({ locale: "bg", fields: ["summary"], fixedLanguage: "en" });
    expect(rule).toContain("Always reply in English");
    expect(rule).not.toContain("Reply in the language of the user's latest message");
    // Pinned to English: no Cyrillic for the model to read as a hint.
    expect(rule).not.toMatch(CYRILLIC);
  });

  it("keeps the Bulgarian guidance when Bulgarian is the pinned language", () => {
    const rule = languageRule({
      locale: "en",
      fields: ["summary"],
      fixedLanguage: "bg",
      bulgarianGuidance: false,
    });
    expect(rule).toContain("Bulgarian is not Russian");
  });

  it("reaches the specialists, not only the concierge", () => {
    const pinned = settings({ "workspace_concierge.replyLanguage": "fr" });
    expect(getA1SystemPrompt({ ...a1, agentSettings: pinned })).toContain("Always reply in French");
    expect(getA2SystemPrompt({ ...a2, agentSettings: pinned })).toContain("Always reply in French");
  });

  it("leaves the prompts mirroring the message by default", () => {
    expect(getA1SystemPrompt(a1)).toContain("Reply in the language of the user's latest message");
  });
});

describe("Mentor's tone", () => {
  it("keeps the original voice on the default setting", () => {
    const prompt = getA1SystemPrompt(a1);
    expect(prompt).toContain("a warm, concise assistant");
    expect(prompt).toContain("Be warm and conversational, not a corporate bot.");
  });

  it("drops the pleasantries when set to direct", () => {
    const prompt = getA1SystemPrompt({
      ...a1,
      agentSettings: settings({ "workspace_concierge.tone": "direct" }),
    });
    expect(prompt).toContain("a direct, concise assistant");
    expect(prompt).toContain("No greetings");
    expect(prompt).not.toContain("Emojis are fine occasionally");
  });

  it("asks for reasoning and context when set to detailed", () => {
    const prompt = getA1SystemPrompt({
      ...a1,
      agentSettings: settings({ "workspace_concierge.tone": "detailed" }),
    });
    expect(prompt).toContain("explain the reasoning");
  });

  it("does not touch a specialist's prompt", () => {
    const base = getA2SystemPrompt(a2);
    const toned = getA2SystemPrompt({
      ...a2,
      agentSettings: settings({ "workspace_concierge.tone": "direct" }),
    });
    expect(toned).toBe(base);
  });
});
