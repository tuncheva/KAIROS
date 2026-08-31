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
 * Quarantine, not permission.
 *
 * These nine are what this check found the first time it ran — roughly 55 KB
 * of components with no caller anywhere in `src`. They are listed rather than
 * deleted because at least one of them was clearly *meant* to be live:
 * `AiTaskPlannerPanel` (16 KB) is named in the UX plan's own list of surfaces
 * whose placeholders need translating, which means it was understood to be
 * part of the product. Whether each is wired up or removed is a decision, and
 * a decision should not be made silently by a test file.
 *
 * `RegionMapPicker` and `AiTaskPlannerPanel` do appear in the suite, but only
 * in tests that read them as text and assert on their design tokens — so those
 * blocks are testing components nothing renders.
 *
 * Every entry here should be resolved. A growing list means the check has
 * stopped meaning anything.
 */
const ALLOWED = new Set<string>([
  "src/components/agents/AgentWorkspace.tsx",
  "src/components/events/RegionMapPicker.tsx",
  "src/components/homepage/ScrollFloat.tsx",
  "src/components/homepage/SplitText.tsx",
  "src/components/layout/Toggle.tsx",
  "src/components/projects/AiTaskDraftPanel.tsx",
  "src/components/projects/AiTaskPlannerPanel.tsx",
  "src/components/projects/CollaboratorItem.tsx",
  "src/components/projects/ProjectsIntelligencePageChat.tsx",
]);

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
