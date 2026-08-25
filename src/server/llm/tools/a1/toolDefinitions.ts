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

  // -------------------------------------------------------------------------
  // Retrieval
  // -------------------------------------------------------------------------

  searchDocuments: {
    name: "searchDocuments",
    description:
      "Search inside documents the user has uploaded — specs, contracts, meeting notes. Use this when a question sounds like it is answered by a file rather than by workspace records: 'what does the contract say about renewal', 'what did we agree on in the spec'. IMPORTANT: this is a keyword search, not a semantic one — it matches the words in the document, so search using the terms the document itself would use rather than the user's paraphrase. Returns passages with the filename and page to cite. Only documents that finished indexing are searched.",
    parameters: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description:
            "Words likely to appear in the document itself. 2-200 characters.",
        },
        limit: {
          type: "number",
          description: "Maximum passages to return. Defaults to 5, maximum 10.",
        },
      },
      required: ["query"],
      additionalProperties: false,
    },
  },

  searchWorkspace: {
    name: "searchWorkspace",
    description:
      "Search across the whole workspace by keyword: tasks, projects, notes, events and task comments. Use this FIRST whenever the user refers to something by topic or wording rather than by project name or id — 'the payment work', 'where did we discuss X', 'anything about onboarding'. Returns matching records with a short snippet and the ids needed to look them up in full. Locked notes never appear.",
    parameters: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "Keywords to search for. 2-200 characters.",
        },
        kinds: {
          type: "array",
          items: {
            type: "string",
            enum: ["task", "project", "note", "event", "comment"],
          },
          description:
            "Restrict the search to these record types. Omit to search everything.",
        },
        limit: {
          type: "number",
          description: "Maximum hits to return, 1-40. Defaults to 15.",
        },
      },
      required: ["query"],
      additionalProperties: false,
    },
  },

  // -------------------------------------------------------------------------
  // Cross-project views
  // -------------------------------------------------------------------------

  listMyWork: {
    name: "listMyWork",
    description:
      "List tasks assigned to the signed-in user across every project, soonest due first, flagging which are overdue. Use for 'what's on my plate', 'what should I do next', 'what's due this week' — do not call listTasks once per project for this.",
    parameters: {
      type: "object",
      properties: {
        withinDays: {
          type: "number",
          description:
            "Only tasks due within this many days, 1-90. Omit for all assigned work.",
        },
        limit: {
          type: "number",
          description: "Maximum tasks to return, 1-50. Defaults to 25.",
        },
      },
      additionalProperties: false,
    },
  },

  getWorkloadByAssignee: {
    name: "getWorkloadByAssignee",
    description:
      "Break the task load down per person: open, in progress, overdue and completed counts, heaviest first. Unassigned work is included as its own row. Use for 'who is overloaded', 'how is work distributed', 'who has capacity'.",
    parameters: {
      type: "object",
      properties: {
        projectId: {
          type: "number",
          description:
            "Limit to one project. Omit to cover every project the user can see.",
        },
      },
      additionalProperties: false,
    },
  },

  getCalendarRange: {
    name: "getCalendarRange",
    description:
      "Everything landing between two dates: task due dates, calendar-scheduled notes and events, merged and sorted by time. Use for 'what's happening this week', 'what's due between Monday and Friday', 'what's coming up before the deadline'.",
    parameters: {
      type: "object",
      properties: {
        from: {
          type: "string",
          description: "Start of the range, ISO date, e.g. 2026-08-24.",
        },
        to: {
          type: "string",
          description: "End of the range, ISO date, e.g. 2026-08-31.",
        },
      },
      required: ["from", "to"],
      additionalProperties: false,
    },
  },

  // -------------------------------------------------------------------------
  // Detail
  // -------------------------------------------------------------------------

  getProjectHealth: {
    name: "getProjectHealth",
    description:
      "Computed health for one project: completion rate, overdue and blocked counts, unassigned and undated work, recent completions, and a plain-language list of risks. Prefer this over counting tasks yourself for any 'how is it going', 'is it at risk', 'what's wrong with this project' question.",
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

  listProjectCollaborators: {
    name: "listProjectCollaborators",
    description:
      "List who collaborates on one project and whether they have read or write permission. Use for 'who is on this project', 'who can edit this'.",
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

  listOrgMembers: {
    name: "listOrgMembers",
    description:
      "List the members of one organization with their role and join date. Requires the user to be a member of that organization. Use for 'who is in this team', 'who is an admin here'.",
    parameters: {
      type: "object",
      properties: {
        organizationId: {
          type: "number",
          description: "Numeric organization id, from listOrganizations.",
        },
      },
      required: ["organizationId"],
      additionalProperties: false,
    },
  },

  listTaskComments: {
    name: "listTaskComments",
    description:
      "Read the discussion on one task, newest first, with author names. Use when the user asks what the team said, what was decided, or why something changed on a task.",
    parameters: {
      type: "object",
      properties: {
        taskId: {
          type: "number",
          description: "Numeric task id, from listTasks or searchWorkspace.",
        },
        limit: {
          type: "number",
          description: "Maximum comments to return, 1-50. Defaults to 20.",
        },
      },
      required: ["taskId"],
      additionalProperties: false,
    },
  },

  getTaskActivity: {
    name: "getTaskActivity",
    description:
      "The change history of one task — what field changed, from what to what, by whom and when. Use for 'what changed', 'who moved this', 'when was this reassigned'.",
    parameters: {
      type: "object",
      properties: {
        taskId: {
          type: "number",
          description: "Numeric task id, from listTasks or searchWorkspace.",
        },
        limit: {
          type: "number",
          description: "Maximum entries to return, 1-50. Defaults to 20.",
        },
      },
      required: ["taskId"],
      additionalProperties: false,
    },
  },

  listNotesMetadata: {
    name: "listNotesMetadata",
    description:
      "List the user's sticky notes: title, whether the note is locked, and a short preview for unlocked ones. Locked notes return no preview at all — say the note exists and is locked rather than guessing its contents.",
    parameters: {
      type: "object",
      properties: {
        limit: {
          type: "number",
          description: "Maximum notes to return, 1-50. Defaults to 25.",
        },
      },
      additionalProperties: false,
    },
  },

  listEventRsvps: {
    name: "listEventRsvps",
    description:
      "Who replied to one event and how — going, maybe, not going — with totals. Only works for events the user organizes; it fails for anyone else's event.",
    parameters: {
      type: "object",
      properties: {
        eventId: {
          type: "number",
          description: "Numeric event id, from listEventsPublic.",
        },
      },
      required: ["eventId"],
      additionalProperties: false,
    },
  },

  // -------------------------------------------------------------------------
  // Assistant memory
  // -------------------------------------------------------------------------

  rememberFact: {
    name: "rememberFact",
    description:
      "Store one durable fact about how this user works, so it survives into future conversations. Call this ONLY when the user explicitly asks you to remember something, or states a standing preference about how they want you to behave (\"always write tasks in Bulgarian\", \"our sprint runs Monday to Friday\", \"treat urgent as within 48 hours\"). Never store something you merely inferred, and never store workspace data — projects and tasks are looked up with the other tools, not memorised.",
    parameters: {
      type: "object",
      properties: {
        key: {
          type: "string",
          description:
            "Short lower_snake_case handle for the fact, e.g. sprint_cadence or task_language. Reusing a key replaces the old value.",
        },
        value: {
          type: "string",
          description:
            "The fact itself, one sentence, phrased as it will be shown back to the user. Max 200 characters.",
        },
      },
      required: ["key", "value"],
      additionalProperties: false,
    },
  },

  forgetFact: {
    name: "forgetFact",
    description:
      "Delete one stored fact by its key. Call this when the user asks you to forget something or corrects a standing preference into no preference.",
    parameters: {
      type: "object",
      properties: {
        key: {
          type: "string",
          description: "The key of the fact to remove.",
        },
      },
      required: ["key"],
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
