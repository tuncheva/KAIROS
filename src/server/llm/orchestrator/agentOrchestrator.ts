/**
 * The agent orchestrator's public surface.
 *
 * This file was 1,647 lines: four unrelated agents plus task generation in a single
 * object literal, which is where the missing authorization in audit finding #1
 * lived. It now composes modules split along the A1/A2/A3/A4 seams the file already
 * had as comment banners:
 *
 *   shared.ts             draft ids, plan hashing, confirmation tokens, guards
 *   a1Concierge.ts        answers questions about the workspace
 *   a2TaskPlanner.ts      draft / confirm / apply a plan of task changes
 *   a3NotesVault.ts       draft / confirm / apply note changes
 *   a4EventsPublisher.ts  draft / confirm / apply event changes
 *   a5OrgAdmin.ts         draft / confirm / apply membership and role changes
 *   taskGeneration.ts     prompt or PDF -> candidate tasks
 *
 * The exported shape is deliberately identical, so `routers/agent.ts` and the tests
 * did not change. Import a specific module directly when you only need one agent.
 */

import { a1Concierge } from "./a1Concierge";
import { a2TaskPlanner } from "./a2TaskPlanner";
import { a3NotesVault } from "./a3NotesVault";
import { a4EventsPublisher } from "./a4EventsPublisher";
import { a5OrgAdmin } from "./a5OrgAdmin";
import { taskGeneration } from "./taskGeneration";
export type {
  AgentId,
  AgentDraftInput,
  AgentDraftResult,
  TaskDraftInput,
  PdfTaskInput,
} from "./shared";

export const agentOrchestrator = {
  ...a3NotesVault,
  ...a2TaskPlanner,
  ...a1Concierge,
  ...taskGeneration,
  ...a4EventsPublisher,
  ...a5OrgAdmin,
};
