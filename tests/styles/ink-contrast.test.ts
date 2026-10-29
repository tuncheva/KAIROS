import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";

/**
 * The faint inks clear their contrast floor on every ground they sit on.
 *
 * `--tui-ink3` is the faintest text on the refined screens (meta, stamps,
 * eyebrows, placeholders): 4.5:1 against the page, the pane and the hover /
 * selected wash, in both modes. `--fg-quaternary` inside the editions is for
 * icons, checkbox edges and disabled states only, so its floor is 3:1. See
 * docs/theme.md, Ink.
 */

const css = fs.readFileSync(
  path.resolve(__dirname, "../../src/styles/globals.css"),
  "utf-8",
);

/** The body of the first `selector {` rule that defines `--token`. */
function block(selector: string, token = "tui-bg"): string {
  let from = 0;
  for (;;) {
    const start = css.indexOf(`\n${selector} {`, from);
    if (start < 0) throw new Error(`no ${selector} rule defining --${token}`);
    const body = css.slice(start, css.indexOf("\n}", start));
    if (body.includes(`--${token}:`)) return body;
    from = start + 1;
  }
}

function rgb(body: string, token: string): [number, number, number] {
  const m = new RegExp(`--${token}:\\s*(\\d+) (\\d+) (\\d+);`).exec(body);
  if (!m) throw new Error(`no --${token}`);
  return [Number(m[1]), Number(m[2]), Number(m[3])];
}

function luminance([r, g, b]: [number, number, number]): number {
  const lin = (v: number) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

function contrast(
  a: [number, number, number],
  b: [number, number, number],
): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [
    number,
    number,
  ];
  return (hi + 0.05) / (lo + 0.05);
}

const light = block(":root");
const dark = block(".dark");
const refinedLight = block(".calendar-refined,\n.tui-refined", "fg-quaternary");
const refinedDark = block(
  ".dark .calendar-refined,\n.calendar-refined.dark,\n.dark .tui-refined,\n.tui-refined.dark",
  "fg-quaternary",
);

const grounds = {
  light: [
    rgb(light, "tui-bg"),
    rgb(light, "tui-pane"),
    rgb(refinedLight, "bg-tertiary"),
  ],
  dark: [
    rgb(dark, "tui-bg"),
    rgb(dark, "tui-pane"),
    rgb(refinedDark, "bg-tertiary"),
  ],
};

describe("Ink contrast", () => {
  it("keeps --tui-ink3 at 4.5:1 on every refined ground, light", () => {
    for (const g of grounds.light)
      expect(contrast(rgb(light, "tui-ink3"), g)).toBeGreaterThanOrEqual(4.5);
  });

  it("keeps --tui-ink3 at 4.5:1 on every refined ground, dark", () => {
    for (const g of grounds.dark)
      expect(contrast(rgb(dark, "tui-ink3"), g)).toBeGreaterThanOrEqual(4.5);
  });

  it("keeps the refined --fg-quaternary at 3:1 for icons and edges", () => {
    for (const g of grounds.light)
      expect(
        contrast(rgb(refinedLight, "fg-quaternary"), g),
      ).toBeGreaterThanOrEqual(3);
    for (const g of grounds.dark)
      expect(
        contrast(rgb(refinedDark, "fg-quaternary"), g),
      ).toBeGreaterThanOrEqual(3);
  });
});
