import { A1OutputSchema } from "~/server/llm/schemas/a1WorkspaceConciergeSchemas";
import type { A1ReadToolName } from "~/server/llm/tools/a1/readTools";

export interface AgentProfile {
  id: string;
  name: string;
  description: string;
  outputSchema: typeof A1OutputSchema;
  /** Read tools allowed during draft phase */
  draftToolAllowlist: readonly A1ReadToolName[];
  /** Routing rules — which intents route to which agents */
  routingRules: Record<string, string>;
}

export const a1WorkspaceConciergeProfile: AgentProfile = {
  id: "workspace_concierge",
  name: "Workspace Concierge",
  description:
    "A read-first front door agent that answers workspace questions, analyzes project descriptions to draft task plans, and produces handoffs for write operations — no side effects without approval.",
  outputSchema: A1OutputSchema,
  // Every read tool, plus the two memory tools. A1 holds no tool that can change
  // workspace data, so the allowlist exists to bound what it *looks at* rather
  // than to bound damage — but "no write tools at all" overstates it:
  // `rememberFact` and `forgetFact` at the end of this list write to and delete
  // from the caller's own preference rows. Harmless in an interactive turn, where
  // the user just asked; not harmless unattended, which is why
  // `scheduled/customSchedules.ts` subtracts them before running a saved question
  // on a timer.
  //
  // Ordered roughly as the model should reach for them: search first, then the
  // cross-project views, then drill-down.
  draftToolAllowlist: [
    "searchWorkspace",
    "getSessionContext",
    "listProjects",
    "listMyWork",
    "getCalendarRange",
    "getProjectDetail",
    "getProjectHealth",
    "getWorkloadByAssignee",
    "listTasks",
    "getTaskDetail",
    "listTaskComments",
    "getTaskActivity",
    "listProjectCollaborators",
    "listOrganizations",
    "listOrgMembers",
    "listNotesMetadata",
    "listNotifications",
    "listEventsPublic",
    "listEventRsvps",
    "rememberFact",
    "forgetFact",
  ],
  routingRules: {
    modify_tasks: "task_planner",
    notes_ops: "notes_vault",
    events_ops: "events_publisher",
    membership_ops: "org_admin",
  },
};
