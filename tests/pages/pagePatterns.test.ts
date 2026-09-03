import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";

/**
 * Page-level tests — verify all app pages use proper patterns:
 * - Server components use auth guards
 * - Client components use "use client" directive
 * - Pages render required layout components
 */

const appDir = path.resolve(__dirname, "../../src/app");

function readPage(pagePath: string): string {
  return fs.readFileSync(path.resolve(appDir, pagePath), "utf-8");
}

/**
 * The file with its comments removed.
 *
 * The "no page renders SideNav" check below is a substring search, so a page
 * that merely *mentions* the rail while explaining something else failed it.
 * A comment is documentation, not a render, and a guard that punishes writing
 * one teaches people to stop writing them.
 */
function readCode(pagePath: string): string {
  return readPage(pagePath)
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
}

describe("Root Layout", () => {
  const layout = readPage("layout.tsx");

  it("imports fonts", () => {
    expect(layout).toMatch(/Nunito_Sans|font/i);
  });

  it("sets html lang attribute", () => {
    expect(layout).toContain("<html");
  });

  it("applies body classes", () => {
    expect(layout).toContain("<body");
  });

  it("wraps with providers", () => {
    expect(layout).toMatch(/Provider|provider/);
  });
});

/**
 * The signed-in shell.
 *
 * The rail used to be rendered by each page, which put it inside the page
 * segment — so every navigation threw it away and built a new one, and the
 * pinned width it reads from localStorage after mount dragged the whole page
 * sideways each time. It now lives in the `(app)` layout, which is what lets
 * React keep the same DOM across a navigation.
 *
 * Both halves are asserted: that the layout renders it, and that no page does.
 * The second is the one that stops the regression, because putting `<SideNav />`
 * back into a page is a change that looks harmless and reads fine in review.
 */
describe("App shell layout", () => {
  const layout = readPage("(app)/layout.tsx");

  it("renders SideNav once, for every signed-in page", () => {
    expect(layout).toContain("SideNav");
  });

  it("is the only place SideNav is rendered", () => {
    const pages = fs
      .readdirSync(path.resolve(appDir, "(app)"), { recursive: true })
      .filter((f): f is string => typeof f === "string" && f.endsWith("page.tsx"));

    expect(pages.length).toBeGreaterThan(0);

    const offenders = pages.filter((f) =>
      readCode(path.join("(app)", f)).includes("SideNav"),
    );

    expect(offenders).toEqual([]);
  });
});

describe("Calendar Page", () => {
  const page = readPage("(app)/calendar/page.tsx");

  it("has authentication guard", () => {
    expect(page).toMatch(/auth|session|redirect/i);
  });


  it("renders CalendarClient", () => {
    expect(page).toContain("CalendarClient");
  });
});

describe("Notes Page", () => {
  const page = readPage("(app)/notes/page.tsx");

  it("has authentication guard", () => {
    expect(page).toMatch(/auth|session|redirect/i);
  });

});

describe("Projects Page", () => {
  const page = readPage("(app)/projects/page.tsx");

  it("has authentication guard", () => {
    expect(page).toMatch(/auth|session|redirect/i);
  });

});

describe("Progress Page", () => {
  const page = readPage("(app)/progress/page.tsx");

  it("has authentication guard", () => {
    expect(page).toMatch(/auth|session|redirect/i);
  });

});

describe("Settings Page", () => {
  const page = readPage("(app)/settings/page.tsx");

  it("has authentication guard", () => {
    expect(page).toMatch(/auth|session|redirect/i);
  });

  it("is a server component that delegates to the client workspace", () => {
    expect(page).toContain("SettingsWorkspace");
  });


  it("validates the section query parameter", () => {
    expect(page).toContain("isSettingsSection");
  });
});

describe("Publish Page", () => {
  const page = readPage("(app)/publish/page.tsx");

  it("uses bg-bg-primary background", () => {
    expect(page).toContain("bg-bg-primary");
  });

  it("does not use gradient backgrounds", () => {
    expect(page).not.toContain("bg-gradient-to-br");
  });
});

describe("Orgs Page", () => {
  const page = readPage("(app)/orgs/page.tsx");

  it("has authentication guard", () => {
    expect(page).toMatch(/auth|session|redirect/i);
  });

});

describe("Not Found Page", () => {
  const page = readPage("not-found.tsx");

  it("displays 404 content", () => {
    expect(page).toMatch(/404|not.found/i);
  });

  it("has a link back to home", () => {
    expect(page).toMatch(/href.*\/|home/i);
  });
});

describe("All Protected Pages — Auth Guard Consistency", () => {
  const protectedPages = [
    "(app)/calendar/page.tsx",
    "(app)/notes/page.tsx",
    "(app)/projects/page.tsx",
    "(app)/progress/page.tsx",
    "(app)/orgs/page.tsx",
    "(app)/chat/page.tsx",
  ];

  for (const pagePath of protectedPages) {
    it(`${pagePath} requires authentication`, () => {
      const page = readPage(pagePath);
      expect(page).toMatch(/auth\(\)|redirect|session/);
    });
  }
});
