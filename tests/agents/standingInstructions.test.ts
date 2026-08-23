/**
 * Standing instructions: rules the user set, that the model must not rewrite.
 *
 * Two properties are worth testing, and they pull in opposite directions.
 *
 * The first is that instructions actually reach the model, framed as rules
 * rather than as trivia — an instruction the agent treats as a preference is an
 * instruction it will trade away against a competing consideration.
 *
 * The second is that the model cannot author or remove them. `rememberFact` takes
 * a free-text `scope`, deliberately, so that an unknown scope stores an inert row
 * instead of failing a turn. `INSTRUCTION_SCOPE` is the one value that is not
 * inert: rows there are injected into every later system prompt as overrides. If
 * the model can write that scope, then "remember to always skip the estimate"
 * silently becomes a standing rule, and the model has edited its own prompt.
 *
 * The prompt-shape assertions are string-matching, which is normally a poor way
 * to test a prompt. It is the right way here: the exact framing is the feature.
 */

import { describe, expect, it } from "vitest";

import {
  GLOBAL_SCOPE,
  INSTRUCTION_SCOPE,
  MAX_INSTRUCTIONS,
  formatMemoryForPrompt,
  rememberFactTool,
  type MemoryFact,
} from "~/server/llm/memory";

function fact(
  key: string,
  value: string,
  scope: string = GLOBAL_SCOPE,
): MemoryFact {
  return { id: 1, key, value, scope, updatedAt: new Date("2026-01-01") };
}

/**
 * A context whose database would throw if touched.
 *
 * The refusal must happen before any query. Using a proxy that explodes on
 * access makes "it refused" and "it refused *without* reaching the database"
 * the same assertion, rather than trusting that a stub returning nothing means
 * nothing was attempted.
 */
function explodingCtx() {
  return {
    db: new Proxy(
      {},
      {
        get() {
          throw new Error("the database must not be reached");
        },
      },
    ),
    session: { user: { id: "user_1" } },
  } as never;
}

describe("instructions in the prompt", () => {
  it("renders them as rules, under their own heading", () => {
    const out = formatMemoryForPrompt([
      fact("estimates", "Never create a task without an estimate", INSTRUCTION_SCOPE),
    ]);

    expect(out).toContain("Rules this user has set");
    expect(out).toContain("Never create a task without an estimate");
  });

  it("tells the model the rules win over everything else", () => {
    // The framing is the feature. Without a precedence statement the model has
    // no basis for choosing a rule over a fact that contradicts it.
    const out = formatMemoryForPrompt([
      fact("estimates", "Always add an estimate", INSTRUCTION_SCOPE),
    ]);

    expect(out).toMatch(/override/i);
  });

  it("states the rules before the facts", () => {
    // Order is the cheap half of precedence: later instructions in a prompt
    // routinely lose to earlier framing, so a rule listed after the facts it
    // overrides is fighting its own position.
    const out = formatMemoryForPrompt([
      fact("cadence", "The sprint runs Monday to Friday", GLOBAL_SCOPE),
      fact("estimates", "Always add an estimate", INSTRUCTION_SCOPE),
    ]);

    expect(out.indexOf("Always add an estimate")).toBeLessThan(
      out.indexOf("The sprint runs Monday to Friday"),
    );
  });

  it("keeps rules, facts and per-agent facts in three separate blocks", () => {
    const out = formatMemoryForPrompt([
      fact("estimates", "Always add an estimate", INSTRUCTION_SCOPE),
      fact("cadence", "The sprint runs Monday to Friday", GLOBAL_SCOPE),
      fact("tone", "Write notes in Bulgarian", "notes_vault"),
    ]);

    expect(out).toContain("Rules this user has set");
    expect(out).toContain("What you know about this user");
    expect(out).toContain("for you in particular");
  });

  it("omits the facts heading when there are only rules", () => {
    // Previously the global heading was unconditional, so a user with rules and
    // no remembered facts would have got an empty "what you know" section.
    const out = formatMemoryForPrompt([
      fact("estimates", "Always add an estimate", INSTRUCTION_SCOPE),
    ]);

    expect(out).not.toContain("What you know about this user");
  });

  it("omits the rules heading when there are only facts", () => {
    const out = formatMemoryForPrompt([
      fact("cadence", "The sprint runs Monday to Friday", GLOBAL_SCOPE),
    ]);

    expect(out).not.toContain("Rules this user has set");
    expect(out).toContain("What you know about this user");
  });

  it("still says nothing at all when there is nothing", () => {
    expect(formatMemoryForPrompt([])).toBe("");
  });
});

describe("the model cannot write its own rules", () => {
  it("refuses rememberFact in the instruction scope", async () => {
    const result = await rememberFactTool.execute(explodingCtx(), {
      key: "estimates",
      value: "Never require an estimate",
      scope: INSTRUCTION_SCOPE,
    });

    expect(result.stored).toBe(false);
  });

  it("refuses before touching the database", async () => {
    // `explodingCtx` throws on any db access, so completing without throwing is
    // the assertion. A refusal that still wrote a row would be no refusal.
    await expect(
      rememberFactTool.execute(explodingCtx(), {
        key: "estimates",
        value: "Never require an estimate",
        scope: INSTRUCTION_SCOPE,
      }),
    ).resolves.toBeDefined();
  });

  it("says where rules are set rather than failing opaquely", async () => {
    // The user asked for something reasonable and got a no; the reply has to
    // explain where the thing they wanted actually lives.
    const result = await rememberFactTool.execute(explodingCtx(), {
      key: "estimates",
      value: "Never require an estimate",
      scope: INSTRUCTION_SCOPE,
    });

    expect(result.message).toMatch(/settings/i);
  });

  it("is not fooled by surrounding whitespace", async () => {
    // `upsertFact` trims the scope before using it, so the guard has to trim too
    // or " instruction" writes a row that then loads as an instruction.
    const result = await rememberFactTool.execute(explodingCtx(), {
      key: "estimates",
      value: "Never require an estimate",
      scope: `  ${INSTRUCTION_SCOPE}  `,
    });

    expect(result.stored).toBe(false);
  });

  it("declares the scope it refuses, so the value cannot drift", () => {
    // Guard and loader must agree on the literal. If someone renames the scope
    // constant and misses one site, instructions become writable again — silently.
    expect(INSTRUCTION_SCOPE).toBe("instruction");
  });
});

describe("MAX_INSTRUCTIONS", () => {
  it("is bounded, because rules load on every turn for every agent", () => {
    // Unlike agent-scoped facts, instructions are never mutually exclusive: the
    // cap is the number that actually appears in each request.
    expect(MAX_INSTRUCTIONS).toBeGreaterThan(0);
    expect(MAX_INSTRUCTIONS).toBeLessThanOrEqual(10);
  });
});
