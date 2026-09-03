import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";

/**
 * Every `t("...")` a component actually calls must resolve in every locale.
 *
 * The hand-written key lists in the sibling files only check keys somebody
 * remembered to add to the list, which is exactly how `org.loadingOrgs` shipped:
 * the component called it, no list mentioned it, and the first anyone knew was a
 * MISSING_MESSAGE overlay in the browser. This derives the expectation from the
 * source instead, so adding a `t("newKey")` without a translation fails here.
 */

const root = path.resolve(__dirname, "../..");
const localesDir = path.join(root, "src/i18n/messages");
/**
 * The offered locales only.
 *
 * `de`, `es` and `fr` have message files but are not on the switcher — see
 * `~/i18n/locales`. Holding a scan of the whole app to them would fail on
 * hundreds of keys that were never translated, which is a fact
 * `translations.test.ts` already reports on rather than something this file
 * can usefully assert.
 */
const locales = ["en", "bg"] as const;

/**
 * Directories whose components are covered.
 *
 * Widened from two directories to everything that renders. `chat.direct.send`
 * shipped missing — the composer's send button called it, no list mentioned
 * it, and the first anyone knew was a MISSING_MESSAGE overlay in the browser.
 * That is exactly the failure this file exists to prevent; it simply was not
 * looking anywhere near the chat.
 */
const SCANNED = ["src/components", "src/app"];

function walk(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return walk(full);
    return entry.name.endsWith(".tsx") || entry.name.endsWith(".ts") ? [full] : [];
  });
}

/**
 * Pull `t("key")` calls out of a file, resolved against the namespace their
 * binding was created with.
 *
 * Deliberately literal-only: a computed key (`t(\`roles.${x}\`)`) cannot be
 * checked statically, and guessing at one would produce false failures.
 */
function usedKeys(source: string): { namespace: string; key: string }[] {
  const bindingRe =
    /const\s+(\w+)\s*=\s*(?:await\s+)?(?:use|get)Translations\(\s*"([^"]+)"\s*\)/g;

  /* Scoped by position, not by name. One file routinely holds several
     components that each call their local translator `t` against a different
     namespace — `ProjectTasksPanel` has `projects.tasks` and `projects.team`,
     `ProjectIntelligenceChat` has three. A name-keyed map keeps only the last
     of them and then reports every key of the others as missing. Each binding
     therefore owns the source from where it appears until the next binding of
     the same name: close enough to lexical scope for a regex, and it errs
     toward the right namespace rather than an arbitrary one. */
  const bindings = [...source.matchAll(bindingRe)].map((m) => ({
    name: m[1]!,
    namespace: m[2]!,
    at: m.index,
  }));

  const found: { namespace: string; key: string }[] = [];
  for (const [i, binding] of bindings.entries()) {
    const next = bindings.slice(i + 1).find((b) => b.name === binding.name);
    const region = source.slice(binding.at, next?.at ?? source.length);

    /* The closing `)` is part of the match on purpose. `t("sources." + x)` is
       a computed key with a literal prefix, and treating that prefix as the
       whole key reports `publish.sources.` as missing forever. Only a call
       whose argument ends right after the string is checkable. */
    const callRe = new RegExp(
      `\\b${binding.name}\\(\\s*"([^"]+)"\\s*[,)]`,
      "g",
    );
    for (const m of region.matchAll(callRe)) {
      found.push({ namespace: binding.namespace, key: m[1]! });
    }
  }
  return found;
}

function lookup(
  messages: Record<string, unknown>,
  dotted: string,
): unknown {
  return dotted
    .split(".")
    .reduce<unknown>(
      (node, part) =>
        node && typeof node === "object"
          ? (node as Record<string, unknown>)[part]
          : undefined,
      messages,
    );
}

const files = SCANNED.flatMap((dir) => walk(path.join(root, dir)));

describe("i18n keys used by the workspace and invite components", () => {
  it("finds components to scan", () => {
    expect(files.length).toBeGreaterThan(0);
  });

  for (const locale of locales) {
    it(`resolves every used key in ${locale}`, () => {
      const messages = JSON.parse(
        fs.readFileSync(path.join(localesDir, `${locale}.json`), "utf-8"),
      ) as Record<string, unknown>;

      const missing: string[] = [];
      for (const file of files) {
        const source = fs.readFileSync(file, "utf-8");
        for (const { namespace, key } of usedKeys(source)) {
          const value = lookup(messages, `${namespace}.${key}`);
          if (typeof value !== "string" || value.length === 0) {
            missing.push(`${path.relative(root, file)} → ${namespace}.${key}`);
          }
        }
      }

      expect(missing).toEqual([]);
    });
  }
});
