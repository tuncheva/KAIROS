import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";

/**
 * Tests for chat component changes — verify topbar opacity, 
 * full-width bubbles, and design token usage.
 */

const chatPath = path.resolve(__dirname, "../../src/components/projects/ProjectIntelligenceChat.tsx");
const chatSource = fs.readFileSync(chatPath, "utf-8");

const widgetPath = path.resolve(__dirname, "../../src/components/chat/A1ChatWidgetOverlay.tsx");
const widgetSource = fs.readFileSync(widgetPath, "utf-8");

describe("ProjectIntelligenceChat – Layout", () => {
  it("does not use max-w-3xl constraint on messages", () => {
    // Messages should fill full width, not be constrained to max-w-3xl
    expect(chatSource).not.toContain("max-w-3xl");
  });

  it("does not use bg-zinc-900 hardcoded background", () => {
    expect(chatSource).not.toContain("bg-zinc-900");
  });

  it("does not use bg-zinc-800 hardcoded background", () => {
    expect(chatSource).not.toContain("bg-zinc-800");
  });

  it("uses bg-primary design token for main background (inline or class)", () => {
    expect(chatSource).toMatch(/bg-bg-primary|--bg-primary/);
  });

  it("uses bg-secondary design token for elevated surfaces (inline or class)", () => {
    expect(chatSource).toMatch(/bg-bg-secondary|bg-bg-elevated|--bg-secondary|--bg-elevated/);
  });

  it("message container uses w-full for full width", () => {
    expect(chatSource).toContain("w-full space-y-4");
  });
});

describe("A1ChatWidgetOverlay – Topbar", () => {
  it("topbar is fully opaque (no /70 opacity suffix)", () => {
    // Should use bg-bg-elevated, not bg-bg-elevated/70
    expect(widgetSource).not.toContain("bg-bg-elevated/70");
  });

  it("takes its surface from a design-system class, not a literal", () => {
    // `kairos-menu-surface` supplies the background, the hairline and both
    // theme shadows, which is why the panel no longer names a background of
    // its own.
    expect(widgetSource).toMatch(
      /kairos-menu-surface|bg-bg-elevated|bg-bg-secondary|--bg-elevated|--bg-secondary/,
    );
    expect(widgetSource).not.toContain("rgba(0,0,0,.5)");
  });
});

