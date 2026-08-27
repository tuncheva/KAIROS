import { type InferInsertModel, type InferSelectModel, sql } from "drizzle-orm";
import {
  index,
  primaryKey,
  text,
  timestamp,
  varchar,
  integer,
  boolean,
} from "drizzle-orm/pg-core";
import type { AdapterAccount } from "next-auth/adapters";
import crypto from "node:crypto";
import {
  createTable,
  usageModeEnum,
  languageEnum,
  dateFormatEnum,
  themeEnum,
  profileAudienceEnum,
  verificationCodePurposeEnum,
} from "./enums";

export const users = createTable("user", (d) => ({
    id: d
      .varchar({ length: 255 })
      .notNull()
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    name: d.varchar({ length: 255 }),
    // Unique because every auth path resolves a user by email: signup does a
    // check-then-insert with nothing to make it atomic, credentials login does a
    // `findFirst`, and the OAuth adapter can create a second row for an address
    // that already has a credentials account. Without the constraint, concurrent
    // signups produce duplicate accounts and login then resolves to whichever row
    // Postgres returns first.
    //
    // The constraint already exists in the deployed database as
    // `user_email_unique` — it was applied out-of-band and was missing here, so a
    // database provisioned from the migrations would not have had it.
    email: d.varchar({ length: 255 }).notNull().unique(),
    /**
     * When the address was proven to belong to this user, or null if it has not
     * been.
     *
     * This used to default to `new Date()`, so every row was born verified and
     * the column carried no information. Combined with OAuth account linking,
     * that was an account-takeover path: register `victim@company.com` with a
     * password you choose, wait for the real owner to sign in with Google, and the
     * provider identity attaches to your row. Credentials signup now leaves this
     * null until a token is redeemed, and OAuth linking refuses unverified rows.
     */
    emailVerified: d.timestamp({
      mode: "date",
      withTimezone: true,
    }),
    image: d.text(),
    usageMode: usageModeEnum("usage_mode"),
    activeOrganizationId: integer("active_organization_id"),
    password: varchar("password", { length: 255 }),

    resetPinHash: varchar("reset_pin_hash", { length: 255 }),
    resetPinHint: text("reset_pin_hint"),

    resetPinFailedAttempts: integer("reset_pin_failed_attempts").notNull().default(0),
    resetPinLockedUntil: timestamp("reset_pin_locked_until", { mode: "date", withTimezone: true }),
    resetPinLastFailedAt: timestamp("reset_pin_last_failed_at", { mode: "date", withTimezone: true }),

    /**
     * Durable failed-sign-in state, mirroring the reset-PIN lockout above.
     *
     * The sliding-window limiter is the first line of defence, but it lives in
     * process memory unless `REDIS_NATIVE_URL` is configured — so a deploy, a
     * restart, or a second instance hands an attacker a fresh budget. These columns
     * survive all three, which is what makes the lockout real rather than
     * advisory.
     */
    loginFailedAttempts: integer("login_failed_attempts").notNull().default(0),
    loginLockedUntil: timestamp("login_locked_until", { mode: "date", withTimezone: true }),
    loginLastFailedAt: timestamp("login_last_failed_at", { mode: "date", withTimezone: true }),

    bio: text("bio"),

    /**
     * Notification preferences.
     *
     * These columns existed long before anything consulted them: the settings
     * screen wrote all five and no notification-producing code read any of them.
     * They are now the single gate every notification passes through — see
     * `~/server/notifications/dispatch`, which maps a category to the column
     * below and drops the notification when it is false.
     *
     * `inAppNotifications` is the master switch for the bell. It does not
     * silence `category: "security"`, which is deliberately ungateable: an
     * account-security notice a user cannot receive is worse than a noisy one.
     */
    inAppNotifications: boolean("in_app_notifications").default(true).notNull(),
    directMessageNotifications: boolean("direct_message_notifications").default(true).notNull(),
    projectUpdatesNotifications: boolean("project_updates_notifications").default(true).notNull(),
    taskAssignmentNotifications: boolean("task_assignment_notifications").default(true).notNull(),
    taskDueRemindersNotifications: boolean("task_due_reminders_notifications").default(true).notNull(),
    /**
     * Default flipped to `true`. It was `false`, which meant the reminder a user
     * explicitly asked for when they subscribed to an event — by picking a
     * "remind me N minutes before" — was silently discarded by a preference they
     * never touched. Opting into a specific reminder is the clearer signal.
     */
    eventRemindersNotifications: boolean("event_reminders_notifications").default(true).notNull(),
    eventUpdatesNotifications: boolean("event_updates_notifications").default(true).notNull(),
    eventRsvpNotifications: boolean("event_rsvp_notifications").default(true).notNull(),
    socialNotifications: boolean("social_notifications").default(true).notNull(),
    inviteNotifications: boolean("invite_notifications").default(true).notNull(),
    workspaceNotifications: boolean("workspace_notifications").default(true).notNull(),

    /** Email channel. Separate from the in-app switches above. */
    emailNotifications: boolean("email_notifications").default(true).notNull(),
    /**
     * Consent record, not yet a gate — there is no marketing email to gate.
     *
     * Every other column here is read by `~/server/notifications/dispatch` or by
     * the brief delivery path. This one has no reader because nothing in the
     * codebase sends promotional mail. It defaults to `false`, so the stored
     * value is a genuine opt-in rather than an assumed one, and whoever adds the
     * first campaign must check it. Called out explicitly because a preference
     * that merely *looks* enforced is the exact defect this file's other comments
     * describe.
     */
    marketingEmailsNotifications: boolean("marketing_emails_notifications").default(false).notNull(),

    language: languageEnum("language").default("en").notNull(),
    timezone: varchar("timezone", { length: 100 }).default("UTC").notNull(),
    dateFormat: dateFormatEnum("date_format").default("MM/DD/YYYY").notNull(),

    theme: themeEnum("theme").default("dark").notNull(),
    accentColor: varchar("accent_color", { length: 20 }).default("purple").notNull(),

    notesKeepUnlockedUntilClose: boolean("notes_keep_unlocked_until_close").default(false).notNull(),

    /**
     * Master switch. False hides you from everyone regardless of
     * `profileAudience` — see `~/server/profile/visibility`.
     */
    profileVisibility: boolean("profile_visibility").default(true).notNull(),
    /**
     * Which audience the master switch admits. Defaults to `organization`
     * rather than `everyone`: the people who can already see your name in a
     * member list are the ones a profile tells nothing new to.
     */
    profileAudience: profileAudienceEnum("profile_audience")
      .default("organization")
      .notNull(),
    showOnlineStatus: boolean("show_online_status").default(true).notNull(),
    /** Whether other people may follow you at all. */
    allowFollowers: boolean("allow_followers").default(true).notNull(),
    /** Whether the drawer's Activity tab renders anything to other viewers. */
    showActivityFeed: boolean("show_activity_feed").default(true).notNull(),
    /** Last time this user was seen; drives the online dot. */
    lastSeenAt: timestamp("last_seen_at", { mode: "date", withTimezone: true }),
    activityTracking: boolean("activity_tracking").default(false).notNull(),
    dataCollection: boolean("data_collection").default(false).notNull(),

    twoFactorEnabled: boolean("two_factor_enabled").default(false).notNull(),
    twoFactorSecret: varchar("two_factor_secret", { length: 255 }),

    createdAt: timestamp("created_at")
      .default(sql`CURRENT_TIMESTAMP`)
      .notNull(),
    updatedAt: timestamp("updated_at")
      .default(sql`CURRENT_TIMESTAMP`)
      .notNull(),
}));

export type UserSettings = {
  name: string | null;
  bio: string | null;
  image: string | null;

  inAppNotifications: boolean;
  directMessageNotifications: boolean;
  projectUpdatesNotifications: boolean;
  taskAssignmentNotifications: boolean;
  taskDueRemindersNotifications: boolean;
  eventRemindersNotifications: boolean;
  eventUpdatesNotifications: boolean;
  eventRsvpNotifications: boolean;
  socialNotifications: boolean;
  inviteNotifications: boolean;
  workspaceNotifications: boolean;
  emailNotifications: boolean;
  marketingEmailsNotifications: boolean;

  language: "en" | "bg" | "es" | "fr" | "de";
  timezone: string;
  dateFormat: "MM/DD/YYYY" | "DD/MM/YYYY" | "YYYY-MM-DD";

  theme: "light" | "dark" | "system";
  accentColor: string;

  profileVisibility: boolean;
  profileAudience: "everyone" | "organization" | "shared";
  showOnlineStatus: boolean;
  allowFollowers: boolean;
  showActivityFeed: boolean;
  activityTracking: boolean;
  dataCollection: boolean;

  twoFactorEnabled: boolean;

  notesKeepUnlockedUntilClose: boolean;
};

export const accounts = createTable(
  "account",
  (d) => ({
    userId: d
      .varchar({ length: 255 })
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    type: d.varchar({ length: 255 }).$type<AdapterAccount["type"]>().notNull(),
    provider: d.varchar({ length: 255 }).notNull(),
    providerAccountId: d.varchar({ length: 255 }).notNull(),
    refresh_token: d.text(),
    access_token: d.text(),
    expires_at: d.integer(),
    token_type: d.varchar({ length: 255 }),
    scope: d.varchar({ length: 255 }),
    id_token: d.text(),
    session_state: d.varchar({ length: 255 }),
  }),
  (t) => [
    primaryKey({ columns: [t.provider, t.providerAccountId] }),
    index("account_user_id_idx").on(t.userId),
  ],
);

export const sessions = createTable(
  "session",
  (d) => ({
    sessionToken: d.varchar({ length: 255 }).notNull().primaryKey(),
    userId: d
      .varchar({ length: 255 })
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    expires: d.timestamp({ mode: "date", withTimezone: true }).notNull(),
  }),
  (t) => [index("session_user_idx").on(t.userId)],
);

export const verificationTokens = createTable(
  "verification_token",
  (d) => ({
    identifier: d.varchar({ length: 255 }).notNull(),
    token: d.varchar({ length: 255 }).notNull(),
    expires: d.timestamp({ mode: "date", withTimezone: true }).notNull(),
  }),
  (t) => [primaryKey({ columns: [t.identifier, t.token] })],
);

export const passwordResetCodes = createTable("password_reset_code", (d) => ({
  id: d
    .integer()
    .primaryKey()
    .generatedAlwaysAsIdentity(),
  email: d.varchar({ length: 255 }).notNull(),
  code: d.varchar({ length: 8 }).notNull(),
  expiresAt: d
    .timestamp("expires_at", { mode: "date", withTimezone: true })
    .notNull(),
  used: d.boolean().default(false).notNull(),
  createdAt: d
    .timestamp("created_at", { mode: "date", withTimezone: true })
    .default(sql`CURRENT_TIMESTAMP`)
    .notNull(),
}));

/**
 * Short numeric codes emailed to prove control of an address.
 *
 * Supersedes `password_reset_code`, which stored its codes in plaintext — a
 * read of the database yielded a live credential for every outstanding reset.
 * Only a SHA-256 of the code is kept here, for the same reason
 * `verification_token` keeps only a hash of its link tokens.
 *
 * Three things this table does that its predecessor did not:
 *
 * - `purpose` lets one mechanism serve both confirming an address and
 *   authorising a password reset, instead of two implementations that drifted.
 * - `attempts` caps guessing at the row rather than at the rate limiter alone.
 *   An eight-digit code survives a shared-IP limiter for a long time; it does
 *   not survive five wrong answers.
 * - `consumedAt` records *when* rather than a bare boolean, which is what makes
 *   "was this code already used, and how long ago" answerable during an
 *   incident.
 */
export const verificationCodes = createTable(
  "verification_code",
  (d) => ({
    id: d.integer().primaryKey().generatedAlwaysAsIdentity(),
    purpose: verificationCodePurposeEnum("purpose").notNull(),
    /** Lowercased address. Not a user reference: a code may be issued before
     *  the row exists, and must keep working if the account is renamed. */
    email: d.varchar({ length: 255 }).notNull(),
    codeHash: d.varchar("code_hash", { length: 64 }).notNull(),
    expiresAt: d
      .timestamp("expires_at", { mode: "date", withTimezone: true })
      .notNull(),
    consumedAt: d.timestamp("consumed_at", { mode: "date", withTimezone: true }),
    attempts: d.integer().default(0).notNull(),
    createdAt: d
      .timestamp("created_at", { mode: "date", withTimezone: true })
      .default(sql`CURRENT_TIMESTAMP`)
      .notNull(),
  }),
  (t) => [
    // Every lookup is "the live code for this address and purpose".
    index("verification_code_lookup_idx").on(t.email, t.purpose),
  ],
);

/**
 * The follow graph.
 *
 * Directed and unreciprocated: following someone is a subscription, not a
 * mutual link, so there is no accept step and no pending state. The composite
 * primary key is what makes a double-tap on Follow a no-op rather than a
 * duplicate row, and the reverse index is what makes "who follows me" a lookup
 * rather than a scan.
 */
export const userFollows = createTable(
  "user_follow",
  (d) => ({
    followerId: d
      .varchar({ length: 255 })
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    followingId: d
      .varchar({ length: 255 })
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    createdAt: d
      .timestamp("created_at", { mode: "date", withTimezone: true })
      .default(sql`CURRENT_TIMESTAMP`)
      .notNull(),
  }),
  (t) => [
    primaryKey({ columns: [t.followerId, t.followingId] }),
    index("user_follow_following_idx").on(t.followingId),
  ],
);

export type UserFollow = InferSelectModel<typeof userFollows>;

export type User = InferSelectModel<typeof users>;
export type NewUser = InferInsertModel<typeof users>;
