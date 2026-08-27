import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";

/**
 * tRPC Router — Schema & Procedure completeness tests.
 * Verifies each router exports the expected procedures by checking
 * the source code for procedure declarations.
 */

const routerDir = path.resolve(__dirname, "../../src/server/api/routers");

function readRouter(name: string): string {
  return fs.readFileSync(path.join(routerDir, name), "utf-8");
}

describe("Auth Router — Procedure Completeness", () => {
  const src = readRouter("auth.ts");

  for (const proc of ["signup", "requestPasswordReset", "verifyResetCode", "resetPassword"]) {
    it(`exports "${proc}" procedure`, () => {
      expect(src).toContain(`${proc}:`);
    });
  }
});

describe("Task Router — Procedure Completeness", () => {
  const src = readRouter("task.ts");

  for (const proc of [
    "create", "updateStatus", "update", "delete", "adminDiscard",
    "setCompletionNote", "getActivityLog", "getProjectActivity",
    "getOrgActivity", "getForCalendar",
  ]) {
    it(`exports "${proc}" procedure`, () => {
      expect(src).toContain(`${proc}:`);
    });
  }
});

describe("Note Router — Procedure Completeness", () => {
  const src = readRouter("note.ts");

  for (const proc of [
    "create", "getAll", "getSharedWithMe", "shareNote", "unshareNote",
    "getNoteShares", "getNotebooks", "createNotebook", "updateNotebook",
    "deleteNotebook", "moveToNotebook", "getOne", "update", "delete",
    "verifyPassword", "resetPasswordWithPin",
  ]) {
    it(`exports "${proc}" procedure`, () => {
      expect(src).toContain(`${proc}:`);
    });
  }
});

describe("Project Router — Procedure Completeness", () => {
  const src = readRouter("project.ts");

  for (const proc of [
    "create", "getMyProjects", "getAllProjectsAcrossOrgs", "getById",
    "addCollaborator", "removeCollaborator", "updateCollaboratorPermission",
    "delete", "archiveProject", "reopenProject",
  ]) {
    it(`exports "${proc}" procedure`, () => {
      expect(src).toContain(`${proc}:`);
    });
  }
});

describe("Organization Router — Procedure Completeness", () => {
  const src = readRouter("organization.ts");

  for (const proc of [
    "listMine", "getActive", "setActive", "create", "join", "getMy",
    "getMembers", "leave", "updateMemberPermissions", "updateMemberRole",
    "removeMember", "getRoles", "createRole", "deleteRole",
    "inviteMember", "getInvites", "cancelInvite",
  ]) {
    it(`exports "${proc}" procedure`, () => {
      expect(src).toContain(`${proc}:`);
    });
  }
});

describe("Notification Router — Procedure Completeness", () => {
  const src = readRouter("notification.ts");

  for (const proc of [
    "getAll", "getUnreadCount", "markAsRead", "markAllAsRead",
    "delete", "deleteAll", "create",
  ]) {
    it(`exports "${proc}" procedure`, () => {
      expect(src).toContain(`${proc}:`);
    });
  }
});

describe("Settings Router — Procedure Completeness", () => {
  const src = readRouter("settings.ts");

  for (const proc of [
    "get", "updateProfile", "updateNotifications", "updateLanguageRegion",
    "updateSecurity", "updateResetPin", "updateAppearance", "updatePrivacy",
    // `requestDataExport` was removed, not renamed. It returned "you'll receive
    // an email when it's ready" and then did nothing — no job, no email, no
    // file — and it had no callers. Export is now `GET /api/export/{format}`,
    // which is a route handler because a file download is not a tRPC shape.
    "deleteAllData",
  ]) {
    it(`exports "${proc}" procedure`, () => {
      expect(src).toContain(`${proc}:`);
    });
  }
});

describe("Event Router — Procedure Completeness", () => {
  const src = readRouter("event.ts");

  for (const proc of [
    // `getPublicEvents` became `getFeed` when the feed learned about the
    // follow graph: same rows, but the source, view, region, topic and search
    // are `where` clauses now rather than a filter running in the browser.
    "createEvent", "getFeed", "getFacets", "getById", "getComments",
    "getAttendees", "addComment", "toggleLike", "toggleSave",
    "updateRsvp", "deleteEvent", "sendEventReminders", "getHostStats",
  ]) {
    it(`exports "${proc}" procedure`, () => {
      expect(src).toContain(`${proc}:`);
    });
  }
});

describe("User Router — Procedure Completeness", () => {
  const src = readRouter("user.ts");

  for (const proc of [
    "getCurrentUser", "setPersonalMode", "getProfile",
    "checkOnboardingStatus", "uploadProfileImage", "searchByEmail",
  ]) {
    it(`exports "${proc}" procedure`, () => {
      expect(src).toContain(`${proc}:`);
    });
  }
});

describe("Chat Router — Procedure Completeness", () => {
  const src = readRouter("chat.ts");

  for (const proc of [
    "listProjectUsers", "getOrCreateProjectConversation", "listMessages",
    "sendMessage", "listProjectConversations", "listAllConversations",
    "getOrCreateDirectConversation",
  ]) {
    it(`exports "${proc}" procedure`, () => {
      expect(src).toContain(`${proc}:`);
    });
  }
});
