import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";

/**
 * Every destination the command palette offers has to be a page that exists.
 *
 * The palette shipped with `/tasks` and `/events` in its static list and
 * `/projects/{id}` on every project row. None of the three were routes, so the
 * app's fastest way to navigate was also its most reliable way to reach a 404.
 * Nothing in the type system objects to a wrong string, so this file walks the
 * hrefs out of the source and checks each one against the App Router tree.
 */

const root = path.resolve(__dirname, "../..");
const appDir = path.join(root, "src/app");

/** Route-group segments — `(app)`, `(marketing)` — are invisible in the URL. */
const isGroup = (segment: string) => segment.startsWith("(") && segment.endsWith(")");
/** `[id]`, `[...slug]` — matches any single concrete segment. */
const isDynamic = (segment: string) => segment.startsWith("[");

/** Every URL path under `src/app` that has a `page.tsx`, as segment arrays. */
function routeSegments(): string[][] {
  const found: string[][] = [];
  const walk = (dir: string, segments: string[]) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        walk(path.join(dir, entry.name), isGroup(entry.name) ? segments : [...segments, entry.name]);
      } else if (entry.name === "page.tsx") {
        found.push(segments);
      }
    }
  };
  walk(appDir, []);
  return found;
}

const ROUTES = routeSegments();

function resolves(href: string): boolean {
  // The palette's hrefs carry query strings (`/projects?projectId=1`); the
  // route tree does not care about them.
  const pathname = href.split("?")[0]!.split("#")[0]!;
  const wanted = pathname.split("/").filter(Boolean);
  return ROUTES.some(
    (route) =>
      route.length === wanted.length &&
      route.every((segment, i) => isDynamic(segment) || segment === wanted[i]),
  );
}

describe("command palette destinations", () => {
  const source = fs.readFileSync(path.join(root, "src/components/layout/CommandPalette.tsx"), "utf-8");

  /** `href: "/dashboard"` — the static destination list. */
  const staticHrefs = [...source.matchAll(/href:\s*"([^"]+)"/g)].map((m) => m[1]!);

  it("finds the static destination list", () => {
    // Guards the regex itself: a refactor that renames `href` would otherwise
    // make this file pass by checking nothing at all.
    expect(staticHrefs.length).toBeGreaterThanOrEqual(8);
  });

  it.each(staticHrefs)("%s resolves to a page under src/app", (href) => {
    expect(resolves(href)).toBe(true);
  });

  it("routes project rows through the shared helper, not a hand-built string", () => {
    // `/projects/{id}` is not a route. The helper is the single place that
    // knows this, so the palette must not rebuild the href itself.
    expect(source).toContain("projectHref(");
    expect(source).not.toMatch(/href:\s*`\/projects\/\$\{/);
  });
});

describe("shared route helpers", () => {
  it("point at pages that exist", async () => {
    const { projectHref } = await import("~/lib/routes");
    expect(resolves(projectHref(1))).toBe(true);
  });
});
