import { z } from "zod";

import { createTRPCRouter, protectedProcedure } from "~/server/api/trpc";
import { searchWorkspaceTool, type SearchHit } from "~/server/llm/tools/a1/searchTools";

/**
 * Full-text search across the workspace.
 *
 * The README has promised this since the beginning and there was no procedure
 * behind it — while the identical capability already existed, reachable only
 * by the AI agent, as the `searchWorkspace` A1 tool. It matches by lexeme and
 * by substring across tasks, projects, notes, events and comments, and scopes
 * every arm through `loadVisibleScope`, which is the same visibility rule
 * `assertProjectAccess` enforces for reads.
 *
 * So this is deliberately a thin wrapper rather than a second implementation.
 * A search that computes visibility even slightly differently from the rest of
 * the app is a cross-tenant leak, and two copies of that rule is how one ends
 * up drifting from the other.
 *
 * The A1 tools take a `TRPCContext` already, which is what makes the wrapper
 * three lines rather than a port.
 */
export const searchRouter = createTRPCRouter({
  workspace: protectedProcedure
    .input(
      z.object({
        query: z.string().min(2).max(200),
        kinds: z
          .array(z.enum(["task", "project", "note", "event", "comment"]))
          .min(1)
          .max(5)
          .optional(),
        /** The palette shows a handful per group; it does not need forty. */
        limit: z.number().int().min(1).max(40).optional(),
      }),
    )
    .query(async ({ ctx, input }): Promise<SearchHit[]> => {
      return searchWorkspaceTool.execute(ctx, input);
    }),
});
