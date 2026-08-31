import { describe, expect, it } from "vitest";
import fs from "fs";
import path from "path";

/**
 * No component file may sit in the tree with nothing importing it.
 *
 * This is the check that was missing. `ProjectChat.tsx` (14 KB) implemented
 * project chat and had zero importers, so the feature looked built and was
 * unreachable; `NotesList.tsx` (32 KB) was a second, older notes product
 * reachable only through a query param nobody linked; `ProjectsListWorkspace`
 * and `A1ChatFloating` were dead weight in the bundle. Each was found by
 * reading the codebase, which is not a strategy.
 *
 * An orphan is not always a bug — but it is always a question, and the answer
 * belongs in `ALLOWED` with a reason rather than in someone's memory.
 */

const root = path.resolve(__dirname, "../..");
const componentsDir = path.join(root, "src/components");

/**
 * Files that are deliberately not imported by anything.
 *
 * Empty, and it should stay that way. The first run of this check found nine
 * orphans totalling about 55 KB — two of them AI panels the UX plan itself
 * assumed were live — and all nine were deleted rather than listed. An entry
 * here is a standing exception, and a growing list means the check has stopped
 * meaning anything.
 */
const ALLOWED = new Set<string>([]);

function walk(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return walk(full);
    return entry.name.endsWith(".tsx") ? [full] : [];
  });
}

/** Every `.ts`/`.tsx` file that could import something. */
function sources(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return sources(full);
    return /\.tsx?$/.test(entry.name) ? [full] : [];
  });
}

const allSource = [
  ...sources(path.join(root, "src")),
  ...sources(path.join(root, "tests")),
]
  .map((file) => ({ file, text: fs.readFileSync(file, "utf-8") }));

describe("component files have a caller", () => {
  const components = walk(componentsDir);

  it("finds components to check", () => {
    expect(components.length).toBeGreaterThan(50);
  });

  it("has no orphans", () => {
    const orphans: string[] = [];

    for (const component of components) {
      const relative = path.relative(root, component).split(path.sep).join("/");
      if (ALLOWED.has(relative)) continue;

      /* Match the module specifier rather than the whole path: imports are
         written `~/components/chat/ChatShell` and `./ChatShell`, and a
         re-export in an index barrel counts as a caller too. */
      const base = path.basename(component, ".tsx");
      const referenced = allSource.some(
        ({ file, text }) =>
          file !== component &&
          new RegExp(`["'\`][^"'\`]*/${base}["'\`]`).test(text),
      );

      if (!referenced) orphans.push(relative);
    }

    expect(
      orphans,
      `these components are in the bundle with nothing importing them:\n${orphans.join(
        "\n",
      )}`,
    ).toEqual([]);
  });
});
