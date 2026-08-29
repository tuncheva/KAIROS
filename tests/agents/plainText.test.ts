/**
 * The chat renders model strings verbatim, so the Markdown comes off here.
 *
 * The reported case: `**Component Systems Night**` rendered with the asterisks
 * visible, in an answer whose prompt already said twice to keep formatting out
 * of the JSON strings. Instructions were never going to hold this — emphasis is
 * what prose written for a human looks like — so it is stripped on the way out
 * instead.
 */

import { describe, it, expect } from "vitest";
import { z } from "zod";

import {
  createPlainTextFilter,
  plainString,
  toPlainText,
} from "~/server/llm/core/plainText";
import { A1OutputSchema } from "~/server/llm/schemas/a1WorkspaceConciergeSchemas";

describe("toPlainText", () => {
  it("strips the emphasis that started this", () => {
    expect(
      toPlainText(
        "You have one scheduled event: **Component Systems Night** on 30 Aug.",
      ),
    ).toBe("You have one scheduled event: Component Systems Night on 30 Aug.");
  });

  it("strips italics, strikethrough and inline code", () => {
    expect(toPlainText("*urgent* and _soon_ and ~~later~~ and `getProjectHealth`")).toBe(
      "urgent and soon and later and getProjectHealth",
    );
  });

  it("keeps the words out of a link and drops the url", () => {
    expect(toPlainText("See [Project Alpha](https://kairos.app/p/7) for details")).toBe(
      "See Project Alpha for details",
    );
  });

  it("removes a leading bullet, which the client draws itself", () => {
    expect(toPlainText("- No tasks are due")).toBe("No tasks are due");
    expect(toPlainText("• No tasks are due")).toBe("No tasks are due");
    expect(toPlainText("1. No tasks are due")).toBe("No tasks are due");
  });

  it("removes headings, quotes and rules", () => {
    expect(toPlainText("## This week\n\n> nothing due\n\n---\n\nAll clear")).toBe(
      "This week\n\nnothing due\n\nAll clear",
    );
  });

  it("keeps the code inside a fence", () => {
    expect(toPlainText("```json\n{ \"id\": 7 }\n```")).toBe('{ "id": 7 }');
  });

  it("leaves identifiers with underscores alone", () => {
    expect(toPlainText("project_id and created_at are unchanged")).toBe(
      "project_id and created_at are unchanged",
    );
  });

  it("leaves arithmetic and prose asterisks alone", () => {
    expect(toPlainText("3 * 4 tasks")).toBe("3 * 4 tasks");
  });

  it("is idempotent", () => {
    const once = toPlainText("**Bold** and [a link](http://x.y)");
    expect(toPlainText(once)).toBe(once);
  });
});

describe("plainString", () => {
  it("strips before it validates, so the length caps count visible characters", () => {
    const schema = plainString(z.string().min(1).max(10));
    expect(schema.parse("**exactly10**")).toBe("exactly10");
  });

  it("leaves non-strings for the inner schema to reject", () => {
    expect(() => plainString(z.string()).parse(42)).toThrow();
  });
});

describe("A1 output", () => {
  it("comes out of validation clean", () => {
    const parsed = A1OutputSchema.parse({
      intent: { type: "answer" },
      answer: {
        summary: "Here's your week — **Component Systems Night** is on 30 Aug.",
        details: ["- No tasks are due", "• Last done: *create an overview*"],
      },
      citations: [{ label: "**Component Systems Night**", ref: "event:5" }],
      followUps: ["Who's overloaded **this week**?"],
    });

    expect(parsed.answer?.summary).toBe(
      "Here's your week — Component Systems Night is on 30 Aug.",
    );
    expect(parsed.answer?.details).toEqual([
      "No tasks are due",
      "Last done: create an overview",
    ]);
    expect(parsed.citations?.[0]?.label).toBe("Component Systems Night");
    expect(parsed.followUps).toEqual(["Who's overloaded this week?"]);
  });
});

describe("createPlainTextFilter", () => {
  const run = (chunks: string[]) => {
    const seen: string[] = [];
    const filter = createPlainTextFilter((text) => seen.push(text));
    for (const chunk of chunks) filter.push(chunk);
    filter.end();
    return seen.join("");
  };

  it("never lets an asterisk through, however the deltas fall", () => {
    const source = "Your event **Component Systems Night** is on 30 Aug.";
    const expected = "Your event Component Systems Night is on 30 Aug.";

    // One character at a time is the worst case: every partial state of every
    // delimiter is visited.
    expect(run([...source])).toBe(expected);
    expect(run([source])).toBe(expected);
    expect(run(["Your event **Comp", "onent Systems", " Night** is on 30 Aug."])).toBe(
      expected,
    );
  });

  it("holds a bullet back until it knows whether it is a list marker", () => {
    expect(run(["Due soon:\n", "- ", "one task"])).toBe("Due soon:\none task");
  });

  it("emits nothing twice", () => {
    const seen: string[] = [];
    const filter = createPlainTextFilter((text) => seen.push(text));
    for (const char of "**bold** then plain") filter.push(char);
    filter.end();
    expect(seen.join("")).toBe("bold then plain");
    // Every delta is new text, never a correction of what was already sent.
    expect(seen.every((delta) => delta.length > 0)).toBe(true);
  });

  it("flushes an unclosed delimiter at the end rather than eating the text", () => {
    expect(run(["The plan is **half writt"])).toBe("The plan is **half writt");
  });
});
