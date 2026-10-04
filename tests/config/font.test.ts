import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";

/**
 * Font configuration tests.
 *
 * Fonts are self-hosted through Fontsource rather than next/font/google: the
 * Google variant fetches CSS at build time, and an extensionless URL in Google's
 * response failed a production deploy (vercel/next.js#99114). These tests keep
 * the build free of that network dependency and the theme variables wired.
 */

const read = (rel: string) => fs.readFileSync(path.resolve(__dirname, "../..", rel), "utf-8");

function walk(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) return walk(full);
    return /\.(ts|tsx)$/.test(e.name) ? [full] : [];
  });
}

describe("Font configuration", () => {
  it("nothing imports next/font/google", () => {
    const offenders = walk(path.resolve(__dirname, "../../src")).filter((f) =>
      /from ["']next\/font\/google["']/.test(fs.readFileSync(f, "utf-8")),
    );
    expect(offenders).toEqual([]);
  });

  it("layout.tsx loads Nunito Sans from Fontsource", () => {
    expect(read("src/app/layout.tsx")).toContain('import "@fontsource-variable/nunito-sans/wght.css"');
  });

  it("layout.tsx no longer imports Space_Grotesk", () => {
    expect(read("src/app/layout.tsx")).not.toContain("Space_Grotesk");
  });

  it("layout.tsx applies the font variable classes to <html>", () => {
    const layout = read("src/app/layout.tsx");
    expect(layout).toContain('import "~/styles/fonts.css"');
    expect(layout).toContain("font-vars");
    expect(layout).toContain("font-display-cyrillic");
    expect(layout).toContain("font-display-latin");
  });

  it("fonts.css binds every variable the theme reads", () => {
    const css = read("src/styles/fonts.css");
    for (const v of [
      "--font-geist-sans",
      "--font-mono",
      "--font-source-serif",
      "--font-display",
      "--font-newsreader",
      "--font-hanken",
      "--font-settings-mono",
    ]) {
      expect(css).toContain(`${v}:`);
    }
  });

  it("every Fontsource import resolves to an installed file", () => {
    for (const file of ["src/app/layout.tsx", "src/app/(app)/settings/page.tsx"]) {
      for (const [, spec] of read(file).matchAll(/import "(@fontsource[^"]+)"/g)) {
        expect(fs.existsSync(path.resolve(__dirname, "../../node_modules", spec!)), spec).toBe(true);
      }
    }
  });

  it("globals.css references the font variable", () => {
    expect(read("src/styles/globals.css")).toContain("--font-geist-sans");
  });
});
