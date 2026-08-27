import type { TRPCContext } from "~/server/api/trpc";
import { stickyNotes } from "~/server/db/schema";
import { eq } from "drizzle-orm";
import { resolveUserLocale, type SupportedLocale } from "~/server/llm/locale";
import { loadUserMemory, type MemoryFact } from "~/server/llm/memory";

export type NotesVaultHandoffContext = {
  unlockedNotes?: Array<{ noteId: number; content: string }>;
};

export type NotesVaultContextPack = {
  userId: string;
  notes: Array<{
    id: number;
    createdAt: string;
    shareStatus: string;
    isLocked: boolean;
    /**
     * Plaintext content only when allowed:
     * - note is unlocked (no passwordHash), OR
     * - note is locked but was provided by UI via handoffContext.unlockedNotes
     */
    unlockedContent?: string;
  }>;
  /**
   * The user's saved interface language — the fallback reply language when the
   * message itself gives nothing to detect from.
   */
  locale: SupportedLocale;
  /** Global facts plus any the user set for the Notes Vault specifically. */
  memory: MemoryFact[];
};

function normalizeHandoff(handoffContext?: Record<string, unknown>): NotesVaultHandoffContext {
  if (!handoffContext || typeof handoffContext !== "object") return {};

  const unlockedNotesRaw = (handoffContext).unlockedNotes;
  if (!Array.isArray(unlockedNotesRaw)) return {};

  const unlockedNotes: Array<{ noteId: number; content: string }> = [];
  for (const item of unlockedNotesRaw) {
    if (!item || typeof item !== "object") continue;
    const noteId = (item as Record<string, unknown>).noteId;
    const content = (item as Record<string, unknown>).content;
    if (typeof noteId === "number" && Number.isInteger(noteId) && noteId > 0 && typeof content === "string" && content.length > 0) {
      unlockedNotes.push({ noteId, content });
    }
  }

  return { unlockedNotes };
}

export async function buildA3Context(input: {
  ctx: TRPCContext;
  handoffContext?: Record<string, unknown>;
}): Promise<NotesVaultContextPack> {
  const userId = input.ctx.session?.user?.id;
  if (!userId) {
    // should be protectedProcedure, but keep this builder safe
    throw new Error("UNAUTHORIZED");
  }

  const handoff = normalizeHandoff(input.handoffContext);
  const unlockedMap = new Map<number, string>((handoff.unlockedNotes ?? []).map((n) => [n.noteId, n.content]));

  const notes = await input.ctx.db.query.stickyNotes.findMany({
    where: eq(stickyNotes.createdById, userId),
    orderBy: (n, { desc }) => [desc(n.createdAt)],
    columns: {
      id: true,
      createdAt: true,
      shareStatus: true,
      passwordHash: true,
      // Only include content in the builder so we can pass it for unlocked notes.
      // This does not change the API behavior of `noteRouter.getAll`.
      content: true,
    },
  });

  const [memory, locale] = await Promise.all([
    loadUserMemory(input.ctx, userId, "notes_vault"),
    resolveUserLocale(input.ctx, userId),
  ]);

  return {
    userId,
    locale,
    memory,
    notes: notes.map((n) => {
      const isLocked = Boolean(n.passwordHash);
      if (!isLocked) {
        return {
          id: n.id,
          createdAt: n.createdAt.toISOString(),
          shareStatus: n.shareStatus,
          isLocked: false,
          unlockedContent: n.content,
        };
      }

      const unlockedContent = unlockedMap.get(n.id);
      return {
        id: n.id,
        createdAt: n.createdAt.toISOString(),
        shareStatus: n.shareStatus,
        isLocked: true,
        ...(unlockedContent ? { unlockedContent } : {}),
      };
    }),
  };
}
