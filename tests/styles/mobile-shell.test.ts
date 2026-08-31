import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";

/**
 * The phone shell, guarded from the outside.
 *
 * Three things below `lg` have to agree with each other, and nothing in the
 * type system makes them:
 *
 *  1. `SideNav` paints two fixed bars — a top bar and a bottom nav.
 *  2. Every page pads itself out from under those bars.
 *  3. Both the bars and the padding have to add the safe-area insets, or the
 *     bar sits under the notch and the page sits under the bar.
 *
 * They used to agree by coincidence: pages hard-coded `pt-16` because the bar
 * happened to be 64px tall on a flat-topped phone. This file asserts the
 * agreement instead, so moving one of the three breaks a test rather than a
 * phone.
 */

const root = path.resolve(__dirname, "../..");
const read = (rel: string) => fs.readFileSync(path.join(root, rel), "utf-8");

/** Every `.tsx` under `src`, as paths relative to the repo root. */
function componentFiles(dir = "src"): string[] {
  return fs.readdirSync(path.join(root, dir), { withFileTypes: true }).flatMap((entry) => {
    const rel = `${dir}/${entry.name}`;
    if (entry.isDirectory()) return componentFiles(rel);
    return entry.name.endsWith(".tsx") ? [rel] : [];
  });
}

const css = read("src/styles/globals.css");
const rootLayout = read("src/app/layout.tsx");
const sideNav = read("src/components/layout/SideNav.tsx");

/**
 * Returns the body of a rule block by selector.
 *
 * The sheet declares the same selector many times over — `:root` alone carries
 * one block per accent colour — so `needle` picks the block being asserted
 * about rather than whichever one happens to come first in the file.
 */
function ruleFor(selector: string, needle?: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(`(?:^|[};])[^{};]*?${escaped}\\s*\\{([^}]*)\\}`, "gm");
  const bodies = [...css.matchAll(pattern)].map((match) => match[1]!);
  expect(bodies.length, `expected a \`${selector}\` rule in globals.css`).toBeGreaterThan(0);
  if (!needle) return bodies[0]!;
  const body = bodies.find((candidate) => candidate.includes(needle));
  expect(body, `expected a \`${selector}\` rule containing \`${needle}\``).toBeDefined();
  return body!;
}

describe("phone shell – viewport", () => {
  /**
   * The single highest-leverage line for phone support. Without it the page is
   * laid out inside the safe rectangle and every `env(safe-area-inset-*)` in
   * the sheet resolves to `0px`, which silently turns the whole safe-area
   * system below into dead code.
   */
  it("opts into the full display so safe-area insets carry real values", () => {
    expect(rootLayout).toMatch(/export const viewport\s*:\s*Viewport/);
    expect(rootLayout).toMatch(/viewportFit:\s*["']cover["']/);
    expect(rootLayout).toMatch(/width:\s*["']device-width["']/);
    expect(rootLayout).toMatch(/initialScale:\s*1/);
  });

  /**
   * Pinch-zoom is an accessibility affordance, not a layout bug to be patched
   * out. The iOS focus-zoom problem it is usually sacrificed for is handled by
   * the 16px field floor asserted further down.
   */
  it("does not disable pinch-zoom", () => {
    expect(rootLayout).not.toMatch(/userScalable:\s*false/);
    expect(rootLayout).not.toMatch(/maximumScale:\s*1/);
  });
});

describe("phone shell – bar heights and page gaps", () => {
  it("declares both bar heights as variables", () => {
    const vars = ruleFor(":root", "--kairos-topbar-h");
    expect(vars).toContain("--kairos-topbar-h");
    expect(vars).toContain("--kairos-bottomnav-h");
  });

  it("aliases every safe-area inset with a 0px fallback for older WebViews", () => {
    const vars = ruleFor(":root", "--kairos-safe-top");
    for (const side of ["top", "right", "bottom", "left"]) {
      expect(vars).toMatch(
        new RegExp(`--kairos-safe-${side}:\\s*env\\(safe-area-inset-${side},\\s*0px\\)`),
      );
    }
  });

  /**
   * The gap has to be the bar's height *plus* the inset, because the bar grows
   * by the inset too. A gap that reads only `--kairos-topbar-h` would put the
   * page title under the notch on every phone with one.
   */
  it("clears each bar by its height plus the matching inset", () => {
    const top = ruleFor(".kairos-topbar-gap");
    expect(top).toContain("--kairos-topbar-h");
    expect(top).toContain("--kairos-safe-top");

    const bottom = ruleFor(".kairos-bottomnav-gap");
    expect(bottom).toContain("--kairos-bottomnav-h");
    expect(bottom).toContain("--kairos-safe-bottom");
  });

  /** The bars are `lg:hidden`, so their gaps have to disappear with them. */
  it("drops both gaps at the breakpoint where the bars stop being painted", () => {
    const desktop = /@media \(min-width: 1024px\) \{\s*\.kairos-topbar-gap \{[^}]*\}\s*\.kairos-bottomnav-gap \{[^}]*\}\s*\}/.exec(
      css,
    );
    expect(desktop, "expected both gaps to be zeroed in one min-width:1024px block").not.toBeNull();
    expect(desktop![0].match(/padding-(top|bottom):\s*0/g)).toHaveLength(2);
  });

  it("pads the bars themselves out of the notch and the home indicator", () => {
    const topbar = ruleFor(".kairos-mobile-topbar");
    expect(topbar).toContain("--kairos-safe-top");
    // Landscape moves the notch to one side, so the bar needs the x insets too.
    expect(topbar).toContain("--kairos-safe-left");
    expect(topbar).toContain("--kairos-safe-right");

    expect(ruleFor(".kairos-mobile-bottomnav")).toContain("--kairos-safe-bottom");
  });
});

describe("phone shell – SideNav wears the utilities", () => {
  it("paints its two bars with the safe-area classes", () => {
    expect(sideNav).toContain("kairos-mobile-topbar");
    expect(sideNav).toContain("kairos-mobile-bottomnav");
  });

  /**
   * `w-72` is 288px — on a 320px phone that leaves a 32px strip of page, which
   * is too narrow to aim a thumb at to dismiss the sheet.
   */
  it("caps the nav sheet at a share of the viewport rather than a flat width", () => {
    expect(sideNav).toMatch(/w-\[min\(18rem,85vw\)\]/);
  });

  it("locks the page behind the open sheet", () => {
    // `position: fixed` is the only lock iOS Safari honours; anything less and
    // a drag on the backdrop scrolls the page or fires pull-to-refresh.
    expect(sideNav).toMatch(/body\.style\.position = "fixed"/);
    expect(sideNav).toMatch(/window\.scrollTo\(0, scrollY\)/);
  });

  /**
   * Every bottom-nav target is at least 44px, the smallest reliable tap.
   *
   * `min-h-11` rather than `h-11`: the items carry a visible text label under
   * the icon now, and a fixed 44px height would clip it. The floor is the point
   * of the assertion, not the exact utility.
   */
  it("keeps the bottom-nav targets at thumb size", () => {
    expect(sideNav).toMatch(/min-h-11 min-w-11/);
  });
});

describe("phone shell – iOS field zoom", () => {
  /**
   * Mobile Safari zooms the page in when a field under 16px takes focus, and
   * never zooms back out. The app's fields are 13–15px by design, so the floor
   * is applied on coarse pointers only and via `max()`, leaving desktop sizes
   * and any already-larger field alone.
   */
  it("floors field text at 16px on touch screens", () => {
    const block =
      /@media \(pointer: coarse\) \{[\s\S]*?font-size:\s*max\(16px,\s*1em\);[\s\S]*?\}/.exec(css);
    expect(block, "expected a coarse-pointer 16px field floor").not.toBeNull();
    expect(block![0]).toContain("textarea");
    expect(block![0]).toContain("select");
    expect(block![0]).toContain("contenteditable");
  });
});

describe("phone shell – no page-level sideways scroll", () => {
  /**
   * A phone has no horizontal scrollbar to warn you with, so one over-wide
   * child just makes the page rubber-band under the fixed bars. `clip` rather
   * than `hidden`: `hidden` on <body> would make it a scroll container and
   * break every sticky header in the app.
   */
  it("clips horizontal overflow on the document without breaking sticky", () => {
    expect(ruleFor("html")).toContain("overflow-x: clip");
    const body = ruleFor("body");
    expect(body).toContain("overflow-x: clip");
    expect(body).not.toContain("overflow-x: hidden");
    // Safari inflates text on rotation to landscape unless told not to.
    expect(body).toContain("-webkit-text-size-adjust: 100%");
  });
});

describe("phone shell – heights follow the visible viewport", () => {
  /**
   * `100vh` on a phone is the viewport with the browser chrome *hidden*, so a
   * `min-h-screen` page is always taller than what you can see and the last
   * ~60px hide behind the URL bar. `dvh` tracks the chrome as it collapses.
   *
   * Desktop-only utilities (`lg:`/`xl:` prefixed) are exempt — the rail's own
   * sticky panels never render at a phone width.
   */
  it("uses dvh, not vh, in everything a phone renders", () => {
    const offenders: string[] = [];
    for (const file of componentFiles()) {
      const source = fs.readFileSync(path.join(root, file), "utf-8");
      source.split("\n").forEach((line, index) => {
        // `h-screen`/`min-h-screen` are Tailwind's 100vh; arbitrary values spell
        // it out. Either way, a `lg:`/`xl:` prefix means desktop only.
        const matches = line.match(/(?:^|[\s"'`{])((?:[a-z]+:)*)(min-h-screen|h-screen|[a-z-]*\[[^\]]*\d+vh[^\]]*\])/g);
        matches?.forEach((match) => {
          if (/\b(lg|xl|2xl):/.test(match)) return;
          offenders.push(`${file}:${index + 1} → ${match.trim()}`);
        });
      });
    }
    expect(offenders).toEqual([]);
  });
});
