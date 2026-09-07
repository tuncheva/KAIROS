import { readFileSync } from "node:fs";
import path from "node:path";

import { beforeAll, afterAll, it, expect } from "vitest";

import {
  createHarness,
  describeIntegration,
  makeUser,
  makeProject,
  type Harness,
} from "./harness";

/**
 * `agent.extractTasksFromPdf` end to end, against the real LLM endpoint.
 *
 * The procedure, its schema and the pdfjs-based extractor all shipped without a
 * caller — nothing in the client reached it, so the whole path from base64 to
 * drafted tasks had never run outside of whoever wrote it. `TaskDrawerPdf.test.tsx`
 * covers the browser half (size guard, base64 shape); this covers the server
 * half, including that pdfjs actually resolves its worker at runtime, which a
 * mocked test cannot tell you.
 *
 * The fixture is a real one-page PDF checked in beside this file. It is small
 * and text-based on purpose: this asserts the pipeline works, not that the model
 * is clever.
 */
const hasLlm = Boolean(
  (process.env.LLM_API_KEY ?? process.env.LLM_API_KEY_NVIDIA ?? "").trim(),
);

/**
 * Generous, because the endpoint is the slow part and its latency is not steady.
 *
 * A draft has been observed at 14s and at over 180s against the same model on
 * the same day. A tight bound here does not catch a regression; it just fails
 * the build on a slow afternoon, which teaches everyone to re-run rather than
 * to read.
 */
const LIVE_TIMEOUT_MS = 300_000;

const PDF_BASE64 = readFileSync(
  path.resolve(__dirname, "fixtures-brief.pdf"),
).toString("base64");

describeIntegration("PDF task extraction — live", () => {
  let h: Harness;
  let ownerId: string;
  let projectId: number;

  beforeAll(async () => {
    h = await createHarness("pdftasks");
    const owner = await makeUser(h.db, { name: "Teodora Owner" });
    ownerId = owner.id;
    const project = await makeProject(h.db, ownerId, null);
    projectId = project.id;
  }, 180_000);

  afterAll(async () => {
    await h?.cleanup();
  });

  it.runIf(hasLlm)(
    "turns a PDF brief into task drafts",
    async () => {
      const result = await h.caller(ownerId).agent.extractTasksFromPdf({
        projectId,
        pdfBase64: PDF_BASE64,
        fileName: "brief.pdf",
      });

      expect(result.draftId).toBeTruthy();
      expect(result.tasks.length).toBeGreaterThan(0);

      // The contract the drawer relies on: every draft can populate the form
      // and be created as a task without further massaging.
      for (const task of result.tasks) {
        expect(task.title.length).toBeGreaterThan(0);
        expect(["low", "medium", "high", "urgent"]).toContain(task.priority);
      }

      // The extractor really read the document rather than inventing plausible
      // project tasks: something from the brief has to survive into the drafts.
      const haystack = result.tasks
        .map((t) => `${t.title} ${t.description}`)
        .join(" ")
        .toLowerCase();
      expect(haystack).toMatch(
        /venue|lighting|programme|program|press|invitation/,
      );
    },
    LIVE_TIMEOUT_MS,
  );

  it.runIf(hasLlm)(
    "refuses a project the caller has no access to",
    async () => {
      const stranger = await makeUser(h.db, { name: "Somebody Else" });

      await expect(
        h.caller(stranger.id).agent.extractTasksFromPdf({
          projectId,
          pdfBase64: PDF_BASE64,
          fileName: "brief.pdf",
        }),
      ).rejects.toThrow();
    },
    LIVE_TIMEOUT_MS,
  );

  it.runIf(hasLlm)(
    "rejects a file that is not a PDF",
    async () => {
      await expect(
        h.caller(ownerId).agent.extractTasksFromPdf({
          projectId,
          pdfBase64: Buffer.from("this is plainly not a pdf").toString("base64"),
          fileName: "nope.pdf",
        }),
      ).rejects.toThrow();
    },
    LIVE_TIMEOUT_MS,
  );
});
