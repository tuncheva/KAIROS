import { describe, expect, it } from "vitest";
import fs from "fs";
import path from "path";

const root = path.resolve(__dirname, "../..");

/**
 * The README promised "full-text search across the workspace" and there was no
 * procedure behind it — while the identical capability already existed as the
 * `searchWorkspace` A1 tool, reachable only by the AI agent.
 *
 * The risk in closing that gap is a *second* implementation. Search that
 * computes visibility even slightly differently from the rest of the app is a
 * cross-tenant leak, so these assert the wrapper stays a wrapper.
 */
describe("search.workspace", () => {
  const src = fs.readFileSync(
    path.join(root, "src/server/api/routers/search.ts"),
    "utf-8",
  );

  it("is registered on the app router", () => {
    const rootSrc = fs.readFileSync(
      path.join(root, "src/server/api/root.ts"),
      "utf-8",
    );
    expect(rootSrc).toContain("search: searchRouter");
  });

  it("requires a session", () => {
    expect(src).toContain("protectedProcedure");
    expect(src).not.toContain("publicProcedure");
  });

  it("delegates to the shared tool rather than querying the tables itself", () => {
    expect(src).toContain("searchWorkspaceTool.execute(ctx, input)");
    // A second copy of the visibility rule is the failure mode being guarded.
    expect(src).not.toContain("ctx.db");
  });
});

describe("the palette links search hits through the shared helpers", () => {
  const src = fs.readFileSync(
    path.join(root, "src/components/layout/CommandPalette.tsx"),
    "utf-8",
  );

  it("uses a helper for every kind that has one", () => {
    for (const helper of ["noteHref(", "eventHref(", "projectHref(", "projectTasksHref("]) {
      expect(src).toContain(helper);
    }
  });

  it("does not search until there is something worth searching for", () => {
    // `searchWorkspace` refuses a query under two characters anyway; firing it
    // on the first keystroke would just be a guaranteed round trip to an error.
    expect(src).toContain("debounced.length >= 2");
  });
});
