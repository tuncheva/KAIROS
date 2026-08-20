/**
 * OpenAI function definitions for the A1 read tools.
 *
 * Hand-written rather than derived from the Zod input schemas. They are eight
 * small, stable shapes, and a generator would pull in a dependency to produce
 * JSON Schema that still needs hand-tuning: the `description` text is the only
 * thing the model reads to decide *when* to call a tool, and that guidance has
 * no counterpart in a Zod type.
 *
 * The Zod schema stays authoritative for validation — {@link runToolLoop} parses
 * the model's arguments with it before any query runs. If the two ever disagree,
 * the model gets a validation error back and retries.
 */

import type { ToolDefinition } from "~/server/llm/core/modelClient";
import type { A1ReadToolName } from "./readTools";

const DEFINITIONS: Record<A1ReadToolName, ToolDefinition> = {
  getSessionContext: {
    name: "getSessionContext",
    description:
      "Get the signed-in user's identity: user id, name, email and active organization. Call this only when you need to know who the user is.",
    parameters: { type: "object", properties: {}, additionalProperties: false },
  },

  listOrganizations: {
    name: "listOrganizations",
    description:
      "List the organizations the user belongs to, with their role and member count. Use for questions about teams, workspaces or org membership.",
    parameters: { type: "object", properties: {}, additionalProperties: false },
  },

  listProjects: {
    name: "listProjects",
    description:
      "List the user's projects (owned, organization, and collaborated), newest first. Start here when a question mentions a project by name and you need its id.",
    parameters: {
      type: "object",
      properties: {
        limit: {
          type: "number",
          description: "Maximum projects to return, 1-50. Defaults to 20.",
        },
      },
      additionalProperties: false,
    },
  },

  getProjectDetail: {
    name: "getProjectDetail",
    description:
      "Get one project in full: description, status, per-status task counts, overdue count and collaborators. Use this for progress, health or 'how far along' questions instead of counting tasks yourself.",
    parameters: {
      type: "object",
      properties: {
        projectId: {
          type: "number",
          description: "Numeric project id, from listProjects.",
        },
      },
      required: ["projectId"],
      additionalProperties: false,
    },
  },

  listTasks: {
    name: "listTasks",
    description:
      "List tasks in one project, most recently updated first. Optionally filter by status.",
    parameters: {
      type: "object",
      properties: {
        projectId: {
          type: "number",
          description: "Numeric project id, from listProjects.",
        },
        limit: {
          type: "number",
          description: "Maximum tasks to return, 1-50. Defaults to 20.",
        },
        status: {
          type: "string",
          enum: ["pending", "in_progress", "completed", "blocked"],
          description: "Return only tasks in this status.",
        },
      },
      required: ["projectId"],
      additionalProperties: false,
    },
  },

  getTaskDetail: {
    name: "getTaskDetail",
    description:
      "Get one task in full: description, assignee, due date and recent activity. Use when the user asks about a specific task rather than a list.",
    parameters: {
      type: "object",
      properties: {
        taskId: {
          type: "number",
          description: "Numeric task id, from listTasks.",
        },
      },
      required: ["taskId"],
      additionalProperties: false,
    },
  },

  listNotifications: {
    name: "listNotifications",
    description:
      "List the user's notifications, newest first, including whether each is read.",
    parameters: {
      type: "object",
      properties: {
        limit: {
          type: "number",
          description: "Maximum notifications to return, 1-50. Defaults to 20.",
        },
      },
      additionalProperties: false,
    },
  },

  listEventsPublic: {
    name: "listEventsPublic",
    description:
      "List events on the public feed, soonest first, flagging which the user owns. Use for questions about upcoming events, schedules or meetups.",
    parameters: {
      type: "object",
      properties: {
        limit: {
          type: "number",
          description: "Maximum events to return, 1-50. Defaults to 20.",
        },
      },
      additionalProperties: false,
    },
  },
};

/**
 * The tool definitions an agent is allowed to use.
 *
 * Driven by the profile's `draftToolAllowlist` so the list the model sees and the
 * list the loop will execute come from one source.
 */
export function toolDefinitionsFor(
  allowlist: readonly A1ReadToolName[],
): ToolDefinition[] {
  return allowlist.map((name) => DEFINITIONS[name]);
}
