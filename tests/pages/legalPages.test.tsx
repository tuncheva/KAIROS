import { describe, it, expect, vi } from "vitest";
import fs from "fs";
import path from "path";
import { render } from "@testing-library/react";

/**
 * Covers the legal/marketing pages, which had no tests at all.
 *
 * `next-intl/server` is not mocked in tests/setup.tsx (only the client
 * `next-intl` is), so it is mocked here for the one string LegalPage translates.
 */
vi.mock("next-intl/server", () => ({
  getTranslations: async () => (key: string) =>
    key === "backHome" ? "Back to home" : key,
}));

const srcDir = path.resolve(__dirname, "../../src");

function readSrc(relativePath: string): string {
  return fs.readFileSync(path.resolve(srcDir, relativePath), "utf-8");
}

describe("marketing routes are publicly reachable", () => {
  // The footer and the consent line under the sign-up button link to these. If
  // they fall behind the cookie gate in proxy.ts, a signed-out visitor is
  // redirected to `/?callbackUrl=...` and can never read what they are agreeing
  // to — which is exactly the bug this guards against.
  const proxy = readSrc("proxy.ts");
  const publicPaths = /const PUBLIC_PATHS = new Set\(\[([\s\S]*?)\]\)/.exec(proxy)?.[1] ?? "";

  it.each(["/privacy", "/terms", "/security", "/about", "/contact", "/careers"])(
    "%s is in PUBLIC_PATHS",
    (route) => {
      expect(publicPaths).toContain(`"${route}"`);
    },
  );
});

describe("Privacy page", () => {
  const page = readSrc("app/(marketing)/privacy/page.tsx");

  it("exports page metadata with a title", () => {
    expect(page).toMatch(/export const metadata/);
    expect(page).toMatch(/title:\s*"Privacy Policy · KAIROS"/);
  });

  it("renders through the LegalPage shell", () => {
    expect(page).toContain("LegalPage");
    expect(page).toContain("privacyPolicy");
  });
});

describe("privacy policy content", () => {
  it("has a last-updated date and sections", async () => {
    const { privacyPolicy } = await import("~/content/legal/privacy");
    expect(privacyPolicy.lastUpdated).toBeTruthy();
    expect(privacyPolicy.sections.length).toBeGreaterThan(0);
  });

  it("gives every section a unique, non-empty id", async () => {
    const { privacyPolicy } = await import("~/content/legal/privacy");
    const ids = privacyPolicy.sections.map((s) => s.id);
    expect(ids.every((id) => id.length > 0)).toBe(true);
    // Duplicate ids would silently break the table of contents: two anchors,
    // one destination.
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("covers the subjects a privacy policy has to cover", async () => {
    const { privacyPolicy } = await import("~/content/legal/privacy");
    const ids = privacyPolicy.sections.map((s) => s.id);
    for (const required of ["retention", "your-rights", "cookies", "processors", "transfers"]) {
      expect(ids).toContain(required);
    }
  });
});

const { LegalPage } = await import("~/components/marketing/LegalPage");

describe("LegalPage", () => {
  const sections = [
    { id: "first-thing", heading: "First thing", body: <p>Body of the first thing.</p> },
    { id: "second-thing", heading: "Second thing", body: <p>Body of the second thing.</p> },
  ];

  /* Imported once at module scope rather than inside the helper. Resolving this
     module pulls in the marketing tree, which under a full-suite run took
     longer than the 5s per-test budget — so whichever test happened to go first
     paid for it and timed out, while the file passed in isolation. Top-level
     await is collection time, not test time. */
  async function renderLegalPage() {
    return render(
      await LegalPage({ title: "Test Policy", lastUpdated: "1 January 2026", sections }),
    );
  }

  it("renders the title as the h1", async () => {
    const { container } = await renderLegalPage();
    expect(container.querySelector("h1")?.textContent).toBe("Test Policy");
  });

  it("shows the last-updated date", async () => {
    const { getByText } = await renderLegalPage();
    expect(getByText(/1 January 2026/)).toBeInTheDocument();
  });

  it("gives each section a heading anchored to its id", async () => {
    const { container } = await renderLegalPage();
    for (const section of sections) {
      const el = container.querySelector(`#${section.id}`);
      expect(el).not.toBeNull();
      expect(el?.textContent).toContain(section.heading);
    }
  });

  it("builds a table-of-contents link per section", async () => {
    const { container } = await renderLegalPage();
    const toc = container.querySelector("nav");
    expect(toc).not.toBeNull();
    for (const section of sections) {
      expect(toc?.querySelector(`a[href="#${section.id}"]`)).not.toBeNull();
    }
  });

  it("renders each section body", async () => {
    const { getByText } = await renderLegalPage();
    expect(getByText("Body of the first thing.")).toBeInTheDocument();
    expect(getByText("Body of the second thing.")).toBeInTheDocument();
  });

  it("links back to the home page", async () => {
    const { container } = await renderLegalPage();
    expect(container.querySelector('a[href="/"]')).not.toBeNull();
  });
});
