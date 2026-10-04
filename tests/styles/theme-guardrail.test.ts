import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";

import { findThemeViolations } from "../../scripts/check-theme";

/**
 * The guardrail, run by the test gate as well as by `pnpm check`.
 *
 * `pnpm check` is not what most people run before pushing; `pnpm test` is. The
 * same checker therefore reports here, so a reintroduced `slate-200` or a
 * hardcoded `#16151A` fails in both places rather than only in the one nobody
 * remembered to run.
 */
describe("the design system's three prohibitions", () => {
  it("holds across src/", () => {
    const violations = findThemeViolations();
    const report = violations
      .map((v) => `${v.file}:${v.line} [${v.rule}] ${v.text}`)
      .join("\n");
    expect(report, report).toBe("");
  });

  it("is written down where someone will find it", () => {
    const docs = fs.readFileSync(
      path.resolve(__dirname, "../../docs/theme.md"),
      "utf-8",
    );
    for (const heading of [
      "--status-danger-ink",
      "--radius-lg",
      "control-md",
      "no-raw-hex-surface",
      "no-slate-or-gray",
      "no-tailwind-status",
    ]) {
      expect(docs, heading).toContain(heading);
    }
  });
});
