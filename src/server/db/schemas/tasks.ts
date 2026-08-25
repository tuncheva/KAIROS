import { type InferInsertModel, type InferSelectModel, sql } from "drizzle-orm";
import { index, text, timestamp, varchar, integer } from "drizzle-orm/pg-core";
import { createTable, taskStatusEnum, taskPriorityEnum } from "./enums";
import { users } from "./users";
import { projects } from "./projects";

export const tasks = createTable(
  "tasks",
  (d) => ({
    id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
    title: varchar("title", { length: 256 }).notNull(),
    description: text("description"),
    projectId: integer("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    assignedToId: d
      .varchar({ length: 255 })
      .references(() => users.id, { onDelete: "set null" }),
    status: taskStatusEnum("status").notNull().default("pending"),
    priority: taskPriorityEnum("priority").notNull().default("medium"),
    dueDate: timestamp("due_date", { mode: "date", withTimezone: true }),
    completedAt: timestamp("completed_at", { mode: "date", withTimezone: true }),
    completedById: d
      .varchar("completed_by_id", { length: 255 })
      .references(() => users.id, { onDelete: "set null" }),
    completionNote: text("completion_note"),
    /**
     * When the "your task is due" reminder went out, so it goes out once.
     *
     * The `taskDueRemindersNotifications` preference has been on the settings
     * screen — promising "get notified when tasks are due" — with nothing behind
     * it. Nothing in the codebase ever read `dueDate` to send a reminder. This
     * column is what lets the sweep be idempotent; cleared when the due date
     * moves, so a rescheduled task reminds again.
     */
    dueReminderSentAt: timestamp("due_reminder_sent_at", { mode: "date", withTimezone: true }),
    createdById: d
      .varchar({ length: 255 })
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    lastEditedById: d
      .varchar("last_edited_by_id", { length: 255 })
      .references(() => users.id, { onDelete: "set null" }),
    lastEditedAt: timestamp("last_edited_at", { mode: "date", withTimezone: true }),
    createdAt: timestamp("created_at")
      .default(sql`CURRENT_TIMESTAMP`)
      .notNull(),
    updatedAt: timestamp("updated_at")
      .default(sql`CURRENT_TIMESTAMP`)
      .notNull(),
    orderIndex: integer("order_index").notNull().default(0),
    clientRequestId: varchar("client_request_id", { length: 128 }),
  }),
  (t) => [
    index("task_project_idx").on(t.projectId),
    index("task_assigned_to_idx").on(t.assignedToId),
    index("task_created_by_idx").on(t.createdById),
    index("task_completed_by_idx").on(t.completedById),
    index("task_last_edited_by_idx").on(t.lastEditedById),
    index("task_client_request_id_idx").on(t.clientRequestId),
    // The due-reminder sweep filters on (due_date, due_reminder_sent_at) every
    // tick; without this it is a full scan of every task in the system.
    index("task_due_reminder_idx").on(t.dueDate, t.dueReminderSentAt),
  ]
);

export const taskComments = createTable(
  "task_comments",
  (d) => ({
    id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
    content: text("content").notNull(),
    taskId: integer("task_id")
      .notNull()
      .references(() => tasks.id, { onDelete: "cascade" }),
    createdById: d
      .varchar({ length: 255 })
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at")
      .default(sql`CURRENT_TIMESTAMP`)
      .notNull(),
  }),
  (t) => [
    index("task_comment_task_idx").on(t.taskId),
    index("task_comment_user_idx").on(t.createdById),
  ]
);

export const taskActivityLog = createTable(
  "task_activity_log",
  (d) => ({
    id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
    taskId: integer("task_id")
      .notNull()
      .references(() => tasks.id, { onDelete: "cascade" }),
    userId: d
      .varchar({ length: 255 })
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    action: varchar("action", { length: 100 }).notNull(),
    oldValue: text("old_value"),
    newValue: text("new_value"),
    createdAt: timestamp("created_at")
      .default(sql`CURRENT_TIMESTAMP`)
      .notNull(),
  }),
  (t) => [
    index("activity_task_idx").on(t.taskId),
    index("activity_user_idx").on(t.userId),
  ]
);

export type Task = InferSelectModel<typeof tasks>;
export type NewTask = InferInsertModel<typeof tasks>;
export type TaskComment = InferSelectModel<typeof taskComments>;
export type NewTaskComment = InferInsertModel<typeof taskComments>;
