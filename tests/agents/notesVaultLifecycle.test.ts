import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("~/env", () => ({
  env: {
    LLM_BASE_URL: "https://llm.test/api/v1",
    LLM_API_KEY: "sk-test",
    LLM_MODEL: "primary-model",
    AUTH_SECRET: "x".repeat(32),
  },
}));

const completeJson = vi.fn();
vi.mock("~/server/llm/core/jsonRepair", () => ({ completeJson }));

const buildA3Context = vi.fn();
vi.mock("~/server/llm/context/a3ContextBuilder", () => ({ buildA3Context }));

vi.mock("~/server/llm/prompts/a3Prompts", () => ({
  getA3SystemPrompt: () => "system",
}));

const { a3NotesVault } = await import("~/server/llm/orchestrator/a3NotesVault");
const { computePlanHash } = await import("~/server/llm/orchestrator/shared");

/**
 * A drizzle-shaped stub covering only the chains this orchestrator uses.
 *
 * The point of these tests is the draft → confirm → apply contract — hashes,
 * tokens and status transitions — so the store is a single row rather than a
 * real database.
 */
interface DraftRow {
  id: string;
  userId: string;
  planJson: string;
  planHash: string;
  status: string;
  confirmationToken: string | null;
}

function makeDb(draft: DraftRow | null) {
  const state = {
    draft,
    inserts: [] as Array<Record<string, unknown>>,
    deletes: 0,
  };

  const thenableWithReturning = (rows: unknown[]) => ({
    returning: () => Promise.resolve(rows),
    then: (resolve: (v: unknown) => unknown) => Promise.resolve(rows).then(resolve),
  });

  const db = {
    select: () => ({
      from: () => ({
        where: () => ({
          limit: () => Promise.resolve(state.draft ? [state.draft] : []),
        }),
      }),
    }),
    insert: () => ({
      values: (values: Record<string, unknown>) => {
        state.inserts.push(values);
        if (typeof values.planJson === "string") {
          state.draft = {
            id: values.id as string,
            userId: values.userId as string,
            planJson: values.planJson,
            planHash: values.planHash as string,
            status: (values.status as string) ?? "draft",
            confirmationToken: null,
          };
        }
        return thenableWithReturning([{ id: 101 }]);
      },
    }),
    update: () => ({
      set: (values: Record<string, unknown>) => ({
        where: () => {
          if (state.draft) state.draft = { ...state.draft, ...values } as DraftRow;
          return Promise.resolve();
        },
      }),
    }),
    delete: () => ({
      where: () => {
        state.deletes++;
        return Promise.resolve();
      },
    }),
  };

  return { db, state };
}

function makeCtx(draft: DraftRow | null) {
  const { db, state } = makeDb(draft);
  return {
    ctx: { db, session: { user: { id: "user-1" } } } as never,
    state,
  };
}

const PLAN = {
  agentId: "notes_vault" as const,
  operations: [{ type: "create" as const, content: "Original note" }],
  blocked: [],
  summary: "Create one note.",
};

beforeEach(() => {
  vi.clearAllMocks();
  buildA3Context.mockResolvedValue({ notes: [] });
});

describe("notesVault draft → confirm → apply", () => {
  it("stores a draft whose hash matches its plan", async () => {
    completeJson.mockResolvedValueOnce({ success: true, data: PLAN });
    const { ctx, state } = makeCtx(null);

    const { draftId, plan } = await a3NotesVault.notesVaultDraft({
      ctx,
      message: "make a note",
    });

    expect(draftId).toMatch(/^draft_/);
    expect(state.draft?.planHash).toBe(plan.planHash);
  });

  it("applies an unedited plan", async () => {
    completeJson.mockResolvedValueOnce({ success: true, data: PLAN });
    const { ctx, state } = makeCtx(null);

    const { draftId } = await a3NotesVault.notesVaultDraft({
      ctx,
      message: "make a note",
    });
    const { confirmationToken } = await a3NotesVault.notesVaultConfirm({
      ctx,
      draftId,
    });
    const result = await a3NotesVault.notesVaultApply({
      ctx,
      draftId,
      confirmationToken,
    });

    expect(result.applied).toBe(true);
    expect(result.results.createdNoteIds).toEqual([101]);
    expect(state.draft?.status).toBe("applied");
  });

  /**
   * The regression this suite exists for.
   *
   * `notesVaultConfirm` recomputed the hash for an edited plan with a different
   * algorithm and wrote it to the row, but minted the confirmation token from
   * the *stale* hash it had selected a moment earlier. Apply compares the two,
   * so every edited plan failed with "Plan hash mismatch" — and the primary
   * button in the chat UI always sends edits.
   */
  it("applies a plan the user edited", async () => {
    completeJson.mockResolvedValueOnce({ success: true, data: PLAN });
    const { ctx, state } = makeCtx(null);

    const { draftId } = await a3NotesVault.notesVaultDraft({
      ctx,
      message: "make a note",
    });

    const { confirmationToken } = await a3NotesVault.notesVaultConfirm({
      ctx,
      draftId,
      edits: [{ index: 0, content: "Edited note" }],
    });

    await expect(
      a3NotesVault.notesVaultApply({ ctx, draftId, confirmationToken }),
    ).resolves.toMatchObject({ applied: true });

    // The edit is what gets written, not the model's original text.
    const stored = JSON.parse(state.draft!.planJson) as typeof PLAN;
    expect(stored.operations[0]).toMatchObject({ content: "Edited note" });
  });

  it("hashes an edited plan with the shared hash function", async () => {
    completeJson.mockResolvedValueOnce({ success: true, data: PLAN });
    const { ctx, state } = makeCtx(null);

    const { draftId } = await a3NotesVault.notesVaultDraft({
      ctx,
      message: "make a note",
    });
    await a3NotesVault.notesVaultConfirm({
      ctx,
      draftId,
      edits: [{ index: 0, content: "Edited note" }],
    });

    const stored = JSON.parse(state.draft!.planJson) as Record<string, unknown>;
    const { planHash: _embedded, ...withoutHash } = stored;

    expect(state.draft!.planHash).toBe(computePlanHash(withoutHash));
    // Full sha256, not the truncated 16-char digest the old code wrote.
    expect(state.draft!.planHash).toHaveLength(64);
  });

  /* ---- Refusals ---- */

  it("refuses a draft belonging to someone else", async () => {
    const { ctx } = makeCtx({
      id: "draft_x",
      userId: "someone-else",
      planJson: JSON.stringify(PLAN),
      planHash: "a".repeat(64),
      status: "draft",
      confirmationToken: null,
    });

    await expect(
      a3NotesVault.notesVaultConfirm({ ctx, draftId: "draft_x" }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("refuses a token minted for a different draft", async () => {
    completeJson.mockResolvedValueOnce({ success: true, data: PLAN });
    const { ctx } = makeCtx(null);

    const { draftId } = await a3NotesVault.notesVaultDraft({
      ctx,
      message: "make a note",
    });
    const { confirmationToken } = await a3NotesVault.notesVaultConfirm({
      ctx,
      draftId,
    });

    await expect(
      a3NotesVault.notesVaultApply({
        ctx,
        draftId: "draft_other",
        confirmationToken,
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("refuses a tampered confirmation token", async () => {
    completeJson.mockResolvedValueOnce({ success: true, data: PLAN });
    const { ctx } = makeCtx(null);

    const { draftId } = await a3NotesVault.notesVaultDraft({
      ctx,
      message: "make a note",
    });
    const { confirmationToken } = await a3NotesVault.notesVaultConfirm({
      ctx,
      draftId,
    });

    const [payload] = confirmationToken.split(".");
    await expect(
      a3NotesVault.notesVaultApply({
        ctx,
        draftId,
        confirmationToken: `${payload}.forged`,
      }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("refuses to apply a draft that was never confirmed", async () => {
    completeJson.mockResolvedValueOnce({ success: true, data: PLAN });
    const { ctx, state } = makeCtx(null);

    const { draftId } = await a3NotesVault.notesVaultDraft({
      ctx,
      message: "make a note",
    });
    const { confirmationToken } = await a3NotesVault.notesVaultConfirm({
      ctx,
      draftId,
    });

    // Roll the row back to `draft` while keeping a valid token.
    state.draft = { ...state.draft!, status: "draft" };

    await expect(
      a3NotesVault.notesVaultApply({ ctx, draftId, confirmationToken }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("propagates a schema failure as a bad request", async () => {
    completeJson.mockResolvedValueOnce({
      success: false,
      error: "operations: Required",
      repairCount: 2,
    });
    const { ctx } = makeCtx(null);

    await expect(
      a3NotesVault.notesVaultDraft({ ctx, message: "make a note" }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });
});
