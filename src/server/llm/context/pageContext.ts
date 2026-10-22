/**
 * Turn the page a request claims into what the agent may be told about it.
 *
 * The client sends ids only. Everything said about the page — its title, a
 * note's text — is read here, after the same access rule the agent's own tools
 * apply, so a hand-written request naming somebody else's note learns nothing
 * from the answer.
 *
 * A page the caller cannot see falls back to its section ("their notes list")
 * rather than to nothing: where the user is stays true even when what they
 * pointed at turned out not to be theirs, and it costs nothing to keep.
 */

import { and, eq } from "drizzle-orm";

import type { TRPCContext } from "~/server/api/trpc";
import { assertProjectAccess } from "~/server/api/authz";
import { stickyNotes } from "~/server/db/schema";
import { createLogger } from "~/server/logger";
import type { PageContext } from "~/lib/pageContext";
import {
  PAGE_NOTE_MAX_CHARS,
  type ResolvedPageContext,
} from "~/server/llm/prompts/pageContext";

const log = createLogger("llm.pageContext");

export async function resolvePageContext(
  ctx: TRPCContext,
  page: PageContext | undefined,
): Promise<ResolvedPageContext | null> {
  if (!page) return null;
  const userId = ctx.session?.user?.id;
  if (!userId) return null;

  try {
    switch (page.kind) {
      case "note": {
        // Owner only — the same rule as `listNotesMetadata` and the Notes Vault.
        // By whichever id the URL carried; the agent is always told the numeric
        // one, which is what its tools and citations use.
        const [note] = await ctx.db
          .select({
            id: stickyNotes.id,
            title: stickyNotes.title,
            content: stickyNotes.content,
            passwordHash: stickyNotes.passwordHash,
          })
          .from(stickyNotes)
          .where(
            and(
              "publicId" in page
                ? eq(stickyNotes.publicId, page.publicId)
                : eq(stickyNotes.id, page.id),
              eq(stickyNotes.createdById, userId),
            ),
          )
          .limit(1);

        if (!note) return { kind: "notes" };

        const locked = note.passwordHash !== null;
        return {
          kind: "note",
          id: note.id,
          title: note.title ?? undefined,
          ...(locked
            ? { locked: true }
            : { content: note.content.slice(0, PAGE_NOTE_MAX_CHARS) }),
        };
      }

      case "project": {
        const project = await assertProjectAccess(ctx, page.id, "read");
        return { kind: "project", id: page.id, title: project.title };
      }

      default:
        return { kind: page.kind };
    }
  } catch (err) {
    // `assertProjectAccess` throws for a project that is missing or not the
    // caller's. Either way the hint is dropped to its section, not the turn.
    log.debug("page context not resolvable, using its section", {
      kind: page.kind,
      err,
    });
    return page.kind === "project" ? { kind: "projects" } : null;
  }
}
