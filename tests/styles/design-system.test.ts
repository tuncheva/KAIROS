import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";

/**
 * CSS Design System tests — verify the futuristic design tokens
 * and utility classes exist in globals.css.
 */

const cssPath = path.resolve(__dirname, "../../src/styles/globals.css");
const css = fs.readFileSync(cssPath, "utf-8");

describe("Design System – globals.css", () => {
  /* ─── design token variables ─── */
  it("defines --bg-primary CSS variable", () => {
    expect(css).toContain("--bg-primary");
  });

  it("defines --fg-primary CSS variable", () => {
    expect(css).toContain("--fg-primary");
  });

  it("defines --accent-primary CSS variable", () => {
    expect(css).toContain("--accent-primary");
  });

  it("defines --border-light CSS variable", () => {
    expect(css).toContain("--border-light");
  });

  it("defines --shadow-xs CSS variable", () => {
    expect(css).toContain("--shadow-xs");
  });

  /* ─── kairos utility classes ─── */
  it("defines .kairos-page-enter animation class", () => {
    expect(css).toContain(".kairos-page-enter");
  });

  it("defines .kairos-stagger class for staggered children", () => {
    expect(css).toContain(".kairos-stagger");
  });

  it("defines .kairos-glass glassmorphism class", () => {
    expect(css).toContain(".kairos-glass");
  });

  it("defines .kairos-card class with hover effects", () => {
    expect(css).toContain(".kairos-card");
  });

  it("defines .kairos-btn micro-interaction class", () => {
    expect(css).toContain(".kairos-btn");
  });

  it("defines .kairos-input class", () => {
    expect(css).toContain(".kairos-input");
  });

  it("defines .kairos-modal-overlay class", () => {
    expect(css).toContain(".kairos-modal-overlay");
  });

  it("defines .kairos-modal-content class", () => {
    expect(css).toContain(".kairos-modal-content");
  });

  it("defines .kairos-chat-response class", () => {
    expect(css).toContain(".kairos-chat-response");
  });

  it("defines .kairos-transition utility", () => {
    expect(css).toContain(".kairos-transition");
  });

  /* ─── reduced motion support ─── */
  it("includes prefers-reduced-motion media query", () => {
    expect(css).toContain("prefers-reduced-motion");
  });

  /* ─── accent theme variants ─── */
  it("defines accent theme for purple", () => {
    expect(css).toContain('data-accent="purple"');
  });

  it("defines accent theme for pink", () => {
    expect(css).toContain('data-accent="pink"');
  });

  it("defines accent theme for caramel", () => {
    expect(css).toContain('data-accent="caramel"');
  });

  it("defines accent theme for mint", () => {
    expect(css).toContain('data-accent="mint"');
  });

  /* ─── dark mode ─── */
  it("includes .dark selector for dark mode", () => {
    expect(css).toContain(".dark");
  });

  /* ─── page-enter animation keyframe ─── */
  it("defines @keyframes for page enter animation", () => {
    expect(css).toMatch(/@keyframes\s+kairos-page-enter/);
  });

  /* ─── general structure checks ─── */
  it("CSS file is non-empty", () => {
    expect(css.length).toBeGreaterThan(500);
  });

  it("contains @import or @tailwind directives", () => {
    expect(css).toMatch(/@import|@tailwind/);
  });
});

describe("Search inputs – one clear button, not two", () => {
  /**
   * WebKit draws its own clear button inside `input[type="search"]`, it takes
   * no colour, and it lands beside the themed one every search box in this app
   * supplies. Two crosses, one of them off-palette.
   */
  it("suppresses the browser's own clear button", () => {
    expect(css).toContain("::-webkit-search-cancel-button");
    const rule = css.slice(
      css.indexOf('input[type="search"]::-webkit-search-cancel-button'),
      css.indexOf('input[type="search"]::-webkit-search-cancel-button') + 400,
    );
    expect(rule).toContain("-webkit-appearance: none");
    expect(rule).toContain("appearance: none");
  });

  it("every search input still offers a clear of its own", () => {
    // Suppressing the native button is only safe while each box has one.
    const files = [
      "src/components/publish/PublishWorkspace.tsx",
      "src/components/notes/NotesRail.tsx",
      "src/components/chat/ConversationRail.tsx",
      "src/components/chat/ConversationsRail.tsx",
    ];

    for (const file of files) {
      const source = fs.readFileSync(
        path.resolve(__dirname, "../../", file),
        "utf-8",
      );
      expect(source, file).toContain('type="search"');
      expect(source, file).toMatch(/clearSearch/);
    }
  });
});
