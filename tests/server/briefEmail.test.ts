/**
 * The brief email: escaping, because its body is not our text.
 *
 * Every other template in `email.ts` interpolates values the application itself
 * produced — a reset URL, a verification token. This one interpolates model prose
 * assembled from task and project titles, which is arbitrary user input on its
 * way into an HTML document that lands in somebody's inbox. A task named
 * `<img src=x onerror=...>` would otherwise write markup into that inbox, and the
 * recipient may not even be the person who named the task.
 *
 * `escapeHtml` is module-private, so it is exercised through the rendered
 * template — which is the right level anyway: what matters is that the output is
 * safe, not that a particular helper was called.
 */

import { describe, expect, it } from "vitest";

import { renderBriefEmailForTest } from "~/server/email/email";

const BASE = {
  userName: "Mira",
  heading: "Your daily brief",
  body: "Two tasks are due today.",
  appUrl: "https://kairos.example",
};

describe("brief email — escaping", () => {
  it("neutralises markup in the body", () => {
    const html = renderBriefEmailForTest({
      ...BASE,
      body: '<img src=x onerror="alert(1)">',
    });

    expect(html).not.toContain("<img");
    expect(html).toContain("&lt;img");
  });

  it("neutralises markup in the name", () => {
    // The name comes from the user's own profile, but the email may be read by
    // someone else on a shared mailbox, and it is the same interpolation risk.
    const html = renderBriefEmailForTest({
      ...BASE,
      userName: "<script>alert(1)</script>",
    });

    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
  });

  it("escapes ampersands without double-escaping the entities it creates", () => {
    // Order dependency: escaping `<` before `&` turns `&lt;` into `&amp;lt;` and
    // the reader sees the escape rather than the character.
    const html = renderBriefEmailForTest({ ...BASE, body: "R&D <plan>" });

    expect(html).toContain("R&amp;D &lt;plan&gt;");
    expect(html).not.toContain("&amp;lt;");
  });

  it("escapes quotes, which would otherwise break out of an attribute", () => {
    const html = renderBriefEmailForTest({
      ...BASE,
      body: '" onmouseover="alert(1)',
    });

    expect(html).toContain("&quot;");
    expect(html).not.toContain('" onmouseover="');
  });

  it("keeps ordinary prose readable", () => {
    // Over-escaping is its own bug: a brief full of entities is a brief nobody
    // reads.
    const html = renderBriefEmailForTest({
      ...BASE,
      body: "Two tasks are due today, and one slipped.",
    });

    expect(html).toContain("Two tasks are due today, and one slipped.");
  });
});

describe("brief email — content", () => {
  it("uses the heading as the visible title", () => {
    // Two voices share this sender — a morning brief and a weekly review — so the
    // heading has to travel rather than being a fixed string.
    const html = renderBriefEmailForTest({
      ...BASE,
      heading: "Your week in review",
    });

    expect(html).toContain("Your week in review");
  });

  it("links to the assistant rather than the marketing site", () => {
    const html = renderBriefEmailForTest(BASE);
    expect(html).toContain("https://kairos.example/chat/ai");
  });

  it("preserves line breaks in the body", () => {
    // The agent writes prose, sometimes across paragraphs. Without this the email
    // renders as one run-on block.
    const html = renderBriefEmailForTest({ ...BASE, body: "One.\nTwo." });
    expect(html).toContain("white-space:pre-wrap");
  });
});
