import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";

/**
 * Page animation tests — verify that all page components
 * include the kairos-page-enter animation class.
 */

const pagesDir = path.resolve(__dirname, "../../src/app");

const pageFiles = [
  "(app)/create/page.tsx",
  "(app)/projects/page.tsx",
  "(app)/progress/page.tsx",
  "(app)/publish/page.tsx",
  "(app)/orgs/page.tsx",
  "(app)/chat/page.tsx",
  "not-found.tsx",
];

describe("Page animations", () => {
  for (const pageFile of pageFiles) {
    const fullPath = path.join(pagesDir, pageFile);

    it(`${pageFile} includes kairos-page-enter class`, () => {
      const content = fs.readFileSync(fullPath, "utf-8");
      expect(content).toContain("kairos-page-enter");
    });
  }

  it("the landing page marks elements for scroll reveal", () => {
    const homeClientPath = path.resolve(
      __dirname,
      "../../src/components/homepage/HomeClient.tsx",
    );
    const content = fs.readFileSync(homeClientPath, "utf-8");
    expect(content).toContain("useLandingReveals");
  });

  it("landing reveals run on gsap + ScrollTrigger", () => {
    const revealsPath = path.resolve(
      __dirname,
      "../../src/components/homepage/useLandingReveals.ts",
    );
    const content = fs.readFileSync(revealsPath, "utf-8");
    expect(content).toContain("import { gsap }");
    expect(content).toContain("import { ScrollTrigger }");
    expect(content).toContain("data-reveal");
  });

});
