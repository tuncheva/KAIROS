/**
 * Tool identity and shape, shared by every A1 read-tool module.
 *
 * These lived in `readTools.ts` when there were eight tools in one file. The
 * surface is now spread across `readTools.ts`, `searchTools.ts` and
 * `workspaceTools.ts`, and each of those needs the name union — so it lives here
 * rather than in whichever file happened to be first. `readTools.ts` re-exports
 * both names, because the profile and the tool definitions already import from
 * there.
 */

import type { z } from "zod";

import type { TRPCContext } from "~/server/api/trpc";

export type A1ReadToolName =
  // Identity and structure
  | "getSessionContext"
  | "listOrganizations"
  | "listOrgMembers"
  | "listProjects"
  | "getProjectDetail"
  | "getProjectHealth"
  | "listProjectCollaborators"
  // Tasks
  | "listTasks"
  | "getTaskDetail"
  | "listTaskComments"
  | "getTaskActivity"
  | "listMyWork"
  | "getWorkloadByAssignee"
  // Time
  | "getCalendarRange"
  // Other domains
  | "listNotifications"
  | "listEventsPublic"
  | "listEventRsvps"
  | "listNotesMetadata"
  // Retrieval
  | "searchWorkspace"
  // Assistant memory (writes only the caller's own preference row — see memory.ts)
  | "rememberFact"
  | "forgetFact";

export interface A1Tool<TName extends A1ReadToolName, TInput, TOutput> {
  name: TName;
  inputSchema: z.ZodType<TInput>;
  execute: (ctx: TRPCContext, input: TInput) => Promise<TOutput>;
  outputSchema: z.ZodType<TOutput>;
}
