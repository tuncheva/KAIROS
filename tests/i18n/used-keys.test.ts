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
const locales = ["en", "bg", "de", "es", "fr"] as const;

/** Directories whose components are covered. */
const SCANNED = ["src/components/orgs", "src/app/(app)/join"];

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
  const bindings = new Map<string, string>();
  const bindingRe =
    /const\s+(\w+)\s*=\s*(?:await\s+)?(?:use|get)Translations\(\s*"([^"]+)"\s*\)/g;
  for (const m of source.matchAll(bindingRe)) bindings.set(m[1]!, m[2]!);

  const found: { namespace: string; key: string }[] = [];
  for (const [binding, namespace] of bindings) {
    const callRe = new RegExp(`\\b${binding}\\(\\s*"([^"]+)"`, "g");
    for (const m of source.matchAll(callRe)) {
      found.push({ namespace, key: m[1]! });
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
