import { pgTableCreator, pgEnum } from "drizzle-orm/pg-core";

export const createTable = pgTableCreator((name) => name);

export const shareStatusEnum = pgEnum("share_status", ['private', 'shared_read', 'shared_write']);
export const permissionEnum = pgEnum("permission", ['read', 'write']);
export const taskStatusEnum = pgEnum("task_status", ['pending', 'in_progress', 'completed', 'blocked']);
export const taskPriorityEnum = pgEnum("task_priority", ['low', 'medium', 'high', 'urgent']);
export const usageModeEnum = pgEnum("usage_mode", ["personal", "organization"]);
export const orgRoleEnum = pgEnum("org_role", ["admin", "member", "guest", "worker", "mentor"]);
export const projectStatusEnum = pgEnum("project_status", ["active", "archived"]);
export const themeEnum = pgEnum("theme", ["light", "dark", "system"]);
/**
 * Only locales that have a message file.
 *
 * `it`, `pt`, `ja`, `ko`, `zh` and `ar` were persistable but had no translations
 * at all, so a user could store a preference the application could never honour —
 * `~/i18n/config` would fail the import, fall back to English, and still report the
 * stored locale to next-intl. Verified before narrowing: only `en` and `bg` were in
 * use in the database.
 *
 * `es`, `fr` and `de` remain valid values because their files exist; whether they
 * are *offered* is a separate decision made by `locales` in `~/i18n/locales`.
 */
export const languageEnum = pgEnum("language", ["en", "bg", "es", "fr", "de"]);
/**
 * Who may open your profile drawer.
 *
 * This replaces the yes/no that `profileVisibility` used to carry on its own.
 * That boolean is still the master switch — off means nobody, whatever is
 * selected here — because turning yourself invisible is a different decision
 * from choosing an audience, and collapsing the two would have silently widened
 * the audience of anyone who had it switched off.
 */
export const profileAudienceEnum = pgEnum("profile_audience", [
  /** Any signed-in Kairos user. */
  "everyone",
  /** Anyone who shares an organisation with you. */
  "organization",
  /** Only people you share a project, event or conversation with. */
  "shared",
] as const);
export const dateFormatEnum

 = pgEnum("date_format", ["MM/DD/YYYY", "DD/MM/YYYY", "YYYY-MM-DD"]);
// "message" (a direct message) and "event_reminder" (a subscribed event about to
// start) are new. Both were previously filed as "system", which is how the bell
// ended up showing a generic gear beside "New message" and why a user could not
// tell an account notice from a chat ping.
export const notificationTypeEnum = pgEnum("notification_type", ["event", "task", "project", "system", "like", "comment", "reply", "message", "event_reminder"]);
export const rsvpStatusEnum = pgEnum("rsvp_status", ["going", "maybe", "not_going"]);
export const regionEnum = pgEnum("region", [
  "sofia",
  "plovdiv",
  "varna",
  "burgas",
  "ruse",
  "stara_zagora",
  "pleven",
  "sliven",
  "dobrich",
  "shumen"
]);
export const agentTaskPlannerDraftStatusEnum = pgEnum(
  "agent_task_planner_draft_status",
  ["draft", "confirmed", "applied", "expired"] as const,
);
export const agentNotesVaultDraftStatusEnum = pgEnum(
  "agent_notes_vault_draft_status",
  ["draft", "confirmed", "applied", "expired"] as const,
);
export const agentEventsPublisherDraftStatusEnum = pgEnum(
  "agent_events_publisher_draft_status",
  ["draft", "confirmed", "applied", "expired"] as const,
);
export const agentOrgAdminDraftStatusEnum = pgEnum(
  "agent_org_admin_draft_status",
  ["draft", "confirmed", "applied", "expired"] as const,
);

/**
 * Roles an AI message can have.
 *
 * `system` is here because the type already existed in the database from an
 * earlier, abandoned AI schema — attached to no column, but with this shape.
 * Declaring three values while the type had four would have shown up as drift on
 * every `db:generate`, so the schema matches what is actually there. Nothing
 * writes `system`: system prompts are rebuilt per turn, not stored.
 */
export const aiMessageRoleEnum = pgEnum("ai_message_role", [
  "user",
  "assistant",
  "tool",
  "system",
] as const);

/**
 * What a short emailed code proves.
 *
 * One table serves both flows because the mechanics are identical — issue,
 * hash, expire, consume once — and the only thing that differs is what the
 * application does after a code checks out. Keeping them apart meant two
 * near-identical implementations, of which only one hashed anything.
 */
export const verificationCodePurposeEnum = pgEnum("verification_code_purpose", [
  /** Prove the address belongs to you, so credentials sign-in is allowed. */
  "email_verify",
  /** Authorise setting a new account password without being signed in. */
  "password_reset",
]);
