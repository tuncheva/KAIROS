import { type InferInsertModel, type InferSelectModel, sql } from "drizzle-orm";
import { index, timestamp, varchar, integer, boolean, text, uniqueIndex } from "drizzle-orm/pg-core";
import { createTable, orgRoleEnum } from "./enums";
import { users } from "./users";

export const organizations = createTable(
  "organizations",
  (_d) => ({
    id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
    name: varchar("name", { length: 256 }).notNull(),
    accessCode: varchar("access_code", { length: 14 }).notNull().unique(),
    /** Org logo/pfp URL. Null falls back to the same gradient monogram profiles use. */
    image: text("image"),
    createdById: varchar("created_by_id", { length: 255 })
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at")
      .default(sql`CURRENT_TIMESTAMP`)
      .notNull(),
    updatedAt: timestamp("updated_at")
      .default(sql`CURRENT_TIMESTAMP`)
      .notNull(),
  }),
  (t) => [
    index("org_created_by_idx").on(t.createdById),
    index("org_access_code_idx").on(t.accessCode),
  ]
);

export const organizationMembers = createTable(
  "organization_members",
  (_d) => ({
    id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
    organizationId: integer("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    userId: varchar("user_id", { length: 255 })
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    role: orgRoleEnum("role").notNull(),
    canAddMembers: boolean("can_add_members").default(false).notNull(),
    canAssignTasks: boolean("can_assign_tasks").default(false).notNull(),
    canCreateProjects: boolean("can_create_projects").default(false).notNull(),
    canDeleteTasks: boolean("can_delete_tasks").default(false).notNull(),
    canKickMembers: boolean("can_kick_members").default(false).notNull(),
    canManageRoles: boolean("can_manage_roles").default(false).notNull(),
    canEditProjects: boolean("can_edit_projects").default(false).notNull(),
    canViewAnalytics: boolean("can_view_analytics").default(false).notNull(),
    joinedAt: timestamp("joined_at")
      .default(sql`CURRENT_TIMESTAMP`)
      .notNull(),
  }),
  (t) => [
    index("org_member_org_idx").on(t.organizationId),
    index("org_member_user_idx").on(t.userId),
    // One membership per person per organization. There was no constraint, so the
    // check-then-insert in `join` and `acceptInvite` could race into two rows for
    // the same user — and with the permission columns now authoritative, two rows
    // means two different answers to "what may this person do here".
    uniqueIndex("org_member_unique").on(t.organizationId, t.userId),
  ]
);

export const organizationRoles = createTable(
  "organization_roles",
  (_d) => ({
    id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
    organizationId: integer("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    name: varchar("name", { length: 100 }).notNull(),
    canAddMembers: boolean("can_add_members").default(false).notNull(),
    canAssignTasks: boolean("can_assign_tasks").default(false).notNull(),
    canCreateProjects: boolean("can_create_projects").default(false).notNull(),
    canDeleteTasks: boolean("can_delete_tasks").default(false).notNull(),
    canKickMembers: boolean("can_kick_members").default(false).notNull(),
    canManageRoles: boolean("can_manage_roles").default(false).notNull(),
    canEditProjects: boolean("can_edit_projects").default(false).notNull(),
    canViewAnalytics: boolean("can_view_analytics").default(false).notNull(),
    isTemplate: boolean("is_template").default(false).notNull(),
    createdAt: timestamp("created_at")
      .default(sql`CURRENT_TIMESTAMP`)
      .notNull(),
  }),
  (t) => [
    index("org_role_org_idx").on(t.organizationId),
  ]
);

export const organizationInvites = createTable(
  "organization_invites",
  (_d) => ({
    id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
    organizationId: integer("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    email: varchar("email", { length: 255 }).notNull(),
    role: orgRoleEnum("role").notNull().default("member"),
    displayRole: varchar("display_role", { length: 100 }),
    invitedById: varchar("invited_by_id", { length: 255 })
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    status: varchar("status", { length: 20 }).notNull().default("pending"),
    createdAt: timestamp("created_at")
      .default(sql`CURRENT_TIMESTAMP`)
      .notNull(),
    expiresAt: timestamp("expires_at", { mode: "date", withTimezone: true }),
  }),
  (t) => [
    index("org_invite_org_idx").on(t.organizationId),
    index("org_invite_email_idx").on(t.email),
  ]
);

/**
 * Short-lived invite tokens behind the join QR code.
 *
 * The organisation's `accessCode` is a permanent bearer credential: once it is
 * on a whiteboard photo or in a group chat it grants access forever. These rows
 * replace it as the way in — one token per QR, valid for minutes, single-use by
 * default, and revocable. The token is the QR payload, so it is generated with
 * the same CSPRNG treatment the access code got.
 */
export const organizationJoinCodes = createTable(
  "organization_join_codes",
  (_d) => ({
    id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
    organizationId: integer("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    code: varchar("code", { length: 64 }).notNull().unique(),
    role: orgRoleEnum("role").notNull().default("worker"),
    createdById: varchar("created_by_id", { length: 255 })
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { mode: "date", withTimezone: true })
      .default(sql`CURRENT_TIMESTAMP`)
      .notNull(),
    expiresAt: timestamp("expires_at", { mode: "date", withTimezone: true }).notNull(),
    // Null means "never revoked". Rotating a QR revokes the previous token
    // rather than deleting it, so an admin can still tell a stale scan from a
    // token that was never issued.
    revokedAt: timestamp("revoked_at", { mode: "date", withTimezone: true }),
    maxUses: integer("max_uses").notNull().default(1),
    usedCount: integer("used_count").notNull().default(0),
  }),
  (t) => [
    index("org_join_code_org_idx").on(t.organizationId),
    index("org_join_code_expires_idx").on(t.expiresAt),
  ]
);

export type Organization = InferSelectModel<typeof organizations>;
export type OrganizationJoinCode = InferSelectModel<typeof organizationJoinCodes>;
export type NewOrganization = InferInsertModel<typeof organizations>;
export type OrganizationMember = InferSelectModel<typeof organizationMembers>;
export type NewOrganizationMember = InferInsertModel<typeof organizationMembers>;
