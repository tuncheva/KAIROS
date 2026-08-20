import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";

/**
 * Tests for globals.css — verify floating circles/gradients are removed
 * from the body and only design-token backgrounds remain.
 */

const cssPath = path.resolve(__dirname, "../../src/styles/globals.css");
const css = fs.readFileSync(cssPath, "utf-8");

const createPagePath = path.resolve(__dirname, "../../src/app/(app)/create/page.tsx");
const createPageSource = fs.readFileSync(createPagePath, "utf-8");

const publishPagePath = path.resolve(__dirname, "../../src/app/(app)/publish/page.tsx");
const publishPageSource = fs.readFileSync(publishPagePath, "utf-8");

describe("Globals CSS – No Floating Circles", () => {
  it("body does not have background-image with radial-gradient", () => {
    // Extract the body { ... } block
    const bodyRegex = /body\s*\{[^}]*\}/s;
    const bodyMatch = bodyRegex.exec(css);
    expect(bodyMatch).not.toBeNull();
    const bodyBlock = bodyMatch![0];
    expect(bodyBlock).not.toContain("background-image");
    expect(bodyBlock).not.toContain("radial-gradient");
  });

  it("body does not have background-attachment: fixed", () => {
    const bodyRegex = /body\s*\{[^}]*\}/s;
    const bodyMatch = bodyRegex.exec(css);
    expect(bodyMatch).not.toBeNull();
    const bodyBlock = bodyMatch![0];
    expect(bodyBlock).not.toContain("background-attachment");
  });

  it("body has background-color defined", () => {
    const bodyRegex = /body\s*\{[^}]*\}/s;
    const bodyMatch = bodyRegex.exec(css);
    expect(bodyMatch).not.toBeNull();
    const bodyBlock = bodyMatch![0];
    expect(bodyBlock).toContain("background-color");
  });
});

describe("Create Page – No Floating Circles", () => {
  it("does not contain radial-gradient inline div", () => {
    expect(createPageSource).not.toContain("radial-gradient");
  });

  it("does not contain floating circle overlay div", () => {
    expect(createPageSource).not.toContain("fixed inset-0 pointer-events-none z-0");
  });
});

describe("Publish Page – No Gradient Background", () => {
  it("does not use bg-gradient-to-br", () => {
    expect(publishPageSource).not.toContain("bg-gradient-to-br");
  });

  it("uses bg-bg-primary for background", () => {
    expect(publishPageSource).toContain("bg-bg-primary");
  });

  it("does not use legacy header class", () => {
    expect(publishPageSource).not.toContain("ios-header");
  });

  it("uses max-w-7xl for responsive width constraint", () => {
    expect(publishPageSource).toContain("max-w-7xl");
  });

  it("header uses dark:border-white/5 separator", () => {
    expect(publishPageSource).toContain("dark:border-white/5");
  });
});
