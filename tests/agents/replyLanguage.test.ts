/**
 * The reply language is decided by this server, not by the model.
 *
 * The bug these tests are written against: a user whose saved interface
 * language is Bulgarian typed in English and got Bulgarian back. Every fix so
 * far had been a prompt rewrite, and every one of them was defeated the same
 * way — Bulgarian text sitting in the prompt unconditionally, and a `||
 * context.locale === "bg"` at each call site that wired the "no Bulgarian on
 * Latin turns" gate permanently open.
 *
 * So the assertions here are about two things: the detector gets the language
 * right from the user's own words, and no prompt built for a Latin-script turn
 * contains a single Cyrillic character.
 */

import { describe, it, expect } from "vitest";

import {
  detectReplyLanguage,
  replyLanguageDirective,
  replyLanguageMessages,
} from "~/server/llm/prompts/replyLanguage";
import { getA1SystemPrompt } from "~/server/llm/prompts/a1Prompts";
import { getA2SystemPrompt } from "~/server/llm/prompts/a2Prompts";
import { getA3SystemPrompt } from "~/server/llm/prompts/a3Prompts";
import { getA4SystemPrompt } from "~/server/llm/prompts/a4Prompts";
import { getA5SystemPrompt } from "~/server/llm/prompts/a5Prompts";

const CYRILLIC = /\p{Script=Cyrillic}/u;

describe("detectReplyLanguage", () => {
  it("reads the language off the message, not off the saved locale", () => {
    // The reported bug, as a single assertion.
    const detected = detectReplyLanguage("bg", "What is the status of my tasks?");
    expect(detected.code).toBe("en");
    expect(detected.script).toBe("latin");
    expect(detected.source).toBe("message");
  });

  it("names Bulgarian for Cyrillic", () => {
    expect(detectReplyLanguage("en", "Какъв е статусът на задачите ми?")).toMatchObject({
      code: "bg",
      script: "cyrillic",
    });
  });

  it("separates Russian from Bulgarian on the letters they do not share", () => {
    expect(detectReplyLanguage("bg", "Что это за проект?").code).toBe("ru");
    expect(detectReplyLanguage("bg", "Кой отговаря за този проект?").code).toBe("bg");
  });

  it("handles the short messages that used to flip to Bulgarian", () => {
    for (const message of ["hi", "hellloooo how are you", "thanks!", "hey"]) {
      const detected = detectReplyLanguage("bg", message);
      expect(detected.script).toBe("latin");
      expect(detected.code).toBe("en");
    }
  });

  it("recognises the other interface languages", () => {
    expect(detectReplyLanguage("bg", "¿Cuál es el estado de mis tareas?").code).toBe("es");
    expect(detectReplyLanguage("bg", "Quel est le statut de mes tâches ?").code).toBe("fr");
    expect(detectReplyLanguage("bg", "Wie ist der Status meiner Aufgaben?").code).toBe("de");
  });

  it("stays Latin-but-unnamed rather than guessing on unknown languages", () => {
    const detected = detectReplyLanguage("bg", "Kokia yra mano uzduociu busena");
    expect(detected.script).toBe("latin");
    expect(detected.code).toBeNull();
  });

  it("is not thrown by a project name in the other script", () => {
    expect(detectReplyLanguage("bg", "What is the status of Проект Алфа?").code).toBe("en");
    expect(detectReplyLanguage("en", "Какъв е статусът на Project Alpha?").code).toBe("bg");
  });

  it("ignores urls, ids and code when reading the language", () => {
    const detected = detectReplyLanguage(
      "bg",
      "check https://example.com/de/der/das and `const die = 1` please",
    );
    expect(detected.code).toBe("en");
  });

  it("falls back to the saved locale only when there is nothing to read", () => {
    for (const message of ["42", "👍", "   ", "#17"]) {
      const detected = detectReplyLanguage("bg", message);
      expect(detected.source).toBe("saved-locale");
      expect(detected.code).toBe("bg");
    }
  });

  it("keeps Cyrillic out of the saved-locale name it puts in the prompt", () => {
    // `LOCALE_NAMES.bg` is "Bulgarian (български)". That parenthetical in the
    // prompt is the contamination this whole module exists to avoid.
    const detected = detectReplyLanguage("bg", "👍");
    expect(detected.name).toBe("Bulgarian");
    expect(CYRILLIC.test(replyLanguageDirective(detected).content)).toBe(false);
  });
});

describe("replyLanguageDirective", () => {
  it("names the language and rules out Cyrillic on a Latin turn", () => {
    const content = replyLanguageDirective(
      detectReplyLanguage("bg", "What is the status of my tasks?"),
    ).content;
    expect(content).toContain("Write this response in English");
    expect(content).toContain("Do not answer in Cyrillic");
    expect(CYRILLIC.test(content)).toBe(false);
  });

  it("asks the model to mirror when it could not name the language", () => {
    const content = replyLanguageDirective(
      detectReplyLanguage("en", "Kokia yra mano uzduociu busena"),
    ).content;
    expect(content).toContain("same language as the user's message");
  });

  it("tells the model the prompt's own examples are not a language signal", () => {
    const content = replyLanguageDirective(detectReplyLanguage("en", "hi")).content;
    expect(content).toContain("reference material");
  });
});

describe("replyLanguageMessages", () => {
  it("puts the directive last, after the handoff anchor", () => {
    const messages = replyLanguageMessages({
      locale: "bg",
      message: "Create three tasks for the payments work",
      originalMessage: "Създай три задачи за плащанията",
    });

    expect(messages).toHaveLength(2);
    expect(messages[0]!.content).toContain("rephrased by another agent");
    // Detected from the user's own words, not from A1's paraphrase.
    expect(messages[1]!.content).toContain("Write this response in Bulgarian");
  });

  it("is directive-only on the direct path", () => {
    const messages = replyLanguageMessages({
      locale: "bg",
      message: "Create three tasks for the payments work",
    });

    expect(messages).toHaveLength(1);
    expect(messages[0]!.content).toContain("Write this response in English");
  });
});

const PROMPTS: Array<[string, (message: string) => string]> = [
  [
    "A1",
    (message) =>
      getA1SystemPrompt(
        {
          session: {
            userId: "u1",
            email: "a@example.com",
            name: "Alice",
            activeOrganizationId: 1,
          },
          projects: [],
          scopedProjectId: null,
          locale: "bg",
          memory: [],
          now: "2026-01-01T00:00:00.000Z",
        },
        message,
      ),
  ],
  [
    "A2",
    (message) =>
      getA2SystemPrompt(
        {
          session: { userId: "u1", activeOrganizationId: 1 },
          scope: { projectId: 1 },
          project: { id: 1, title: "Alpha", description: null, createdById: "u1" },
          collaborators: [],
          existingTasks: [],
          locale: "bg",
          memory: [],
        },
        message,
      ),
  ],
  [
    "A3",
    (message) =>
      getA3SystemPrompt({ userId: "u1", notes: [], locale: "bg", memory: [] }, message),
  ],
  [
    "A4",
    (message) =>
      getA4SystemPrompt({ userId: "u1", events: [], locale: "bg", memory: [] }, message),
  ],
  [
    "A5",
    (message) =>
      getA5SystemPrompt(
        {
          userId: "u1",
          organizations: [],
          now: "2026-01-01T00:00:00.000Z",
          locale: "bg",
          memory: [],
        },
        message,
      ),
  ],
];

describe("no Cyrillic leaks into a Latin-script turn", () => {
  // Regression: every call site read `wantsBulgarianGuidance(...userText) ||
  // context.locale === "bg"`, so these prompts — built for a bg-locale user who
  // is writing English — carried the whole Bulgarian block, Cyrillic examples
  // and a `CRITICAL: you MUST answer entirely in Bulgarian` line included.
  for (const [name, build] of PROMPTS) {
    it(`${name} is Cyrillic-free for an English message from a bg-locale user`, () => {
      expect(CYRILLIC.test(build("What is the status of my tasks?"))).toBe(false);
    });

    it(`${name} still carries the Bulgarian guidance for a Bulgarian message`, () => {
      expect(CYRILLIC.test(build("Какъв е статусът на задачите ми?"))).toBe(true);
    });
  }
});
