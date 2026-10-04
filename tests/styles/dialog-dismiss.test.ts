import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";

/**
 * docs/theme.md §6: a dialog closes with the mono `ESC` affordance, not a
 * glyph cross. A key name says how to dismiss from the keyboard, which the
 * cross never did.
 *
 * Eleven dialogs each carried their own icon close button before this rule was
 * enforced, and two files carried their own copy of the ESC markup. Both are
 * the same drift: a primitive that exists in `ui/Modal` being re-implemented
 * locally. This test is the sweep that keeps it from coming back.
 *
 * Scope is anything modal — `role="dialog"`, `aria-modal`, or a consumer of
 * `useModalBehavior` / `MODAL_SHELL`. A non-modal rail, panel or inline peek is
 * not a dialog and keeps its icon close control.
 */

const componentsDir = path.resolve(__dirname, "../../src/components");

function walk(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) return walk(p);
    return e.isFile() && p.endsWith(".tsx") ? [p] : [];
  });
}

const files = walk(componentsDir).map((p) => ({
  path: path.relative(componentsDir, p).split(path.sep).join("/"),
  source: fs.readFileSync(p, "utf-8"),
}));

const isModal = (src: string) =>
  src.includes('role="dialog"') ||
  src.includes("aria-modal") ||
  src.includes("useModalBehavior") ||
  src.includes("MODAL_SHELL");

describe("dialogs dismiss with ESC, not a glyph cross", () => {
  it("finds the dialogs it is meant to be checking", () => {
    // Guards against the walk silently matching nothing and the suite passing
    // for the wrong reason.
    expect(files.filter((f) => isModal(f.source)).length).toBeGreaterThan(5);
  });

  it.each(files.filter((f) => isModal(f.source)))(
    "$path closes without an icon button",
    ({ source }) => {
      const lines = source.split("\n");
      const offenders = lines.flatMap((line, i) => {
        if (!line.includes("aria-label") || !/close/i.test(line)) return [];
        const context = lines.slice(Math.max(0, i - 6), i + 4).join("\n");
        return /<X\b/.test(context) ? [i + 1] : [];
      });
      expect(offenders).toEqual([]);
    },
  );

  it("keeps exactly one copy of the ESC markup", () => {
    const withEscMarkup = files.filter((f) => /^\s*ESC$/m.test(f.source));
    expect(withEscMarkup.map((f) => f.path)).toEqual(["ui/Modal.tsx"]);
  });
});
