CREATE TYPE "public"."agent_notes_vault_draft_status" AS ENUM('draft', 'confirmed', 'applied', 'expired');--> statement-breakpoint
CREATE TYPE "public"."agent_task_planner_draft_status" AS ENUM('draft', 'confirmed', 'applied', 'expired');--> statement-breakpoint
CREATE TYPE "public"."date_format" AS ENUM('MM/DD/YYYY', 'DD/MM/YYYY', 'YYYY-MM-DD');--> statement-breakpoint
CREATE TYPE "public"."language" AS ENUM('en', 'bg', 'es', 'fr', 'de');--> statement-breakpoint
CREATE TYPE "public"."notification_type" AS ENUM('event', 'task', 'project', 'system', 'like', 'comment', 'reply');--> statement-breakpoint
CREATE TYPE "public"."org_role" AS ENUM('admin', 'member', 'guest', 'worker', 'mentor');--> statement-breakpoint
CREATE TYPE "public"."permission" AS ENUM('read', 'write');--> statement-breakpoint
CREATE TYPE "public"."project_status" AS ENUM('active', 'archived');--> statement-breakpoint
CREATE TYPE "public"."region" AS ENUM('sofia', 'plovdiv', 'varna', 'burgas', 'ruse', 'stara_zagora', 'pleven', 'sliven', 'dobrich', 'shumen');--> statement-breakpoint
CREATE TYPE "public"."rsvp_status" AS ENUM('going', 'maybe', 'not_going');--> statement-breakpoint
CREATE TYPE "public"."share_status" AS ENUM('private', 'shared_read', 'shared_write');--> statement-breakpoint
CREATE TYPE "public"."task_priority" AS ENUM('low', 'medium', 'high', 'urgent');--> statement-breakpoint
CREATE TYPE "public"."task_status" AS ENUM('pending', 'in_progress', 'completed', 'blocked');--> statement-breakpoint
CREATE TYPE "public"."theme" AS ENUM('light', 'dark', 'system');--> statement-breakpoint
CREATE TYPE "public"."usage_mode" AS ENUM('personal', 'organization');--> statement-breakpoint
CREATE TABLE "account" (
	"userId" varchar(255) NOT NULL,
	"type" varchar(255) NOT NULL,
	"provider" varchar(255) NOT NULL,
	"providerAccountId" varchar(255) NOT NULL,
	"refresh_token" text,
	"access_token" text,
	"expires_at" integer,
	"token_type" varchar(255),
	"scope" varchar(255),
	"id_token" text,
	"session_state" varchar(255),
	CONSTRAINT "account_provider_providerAccountId_pk" PRIMARY KEY("provider","providerAccountId")
);
--> statement-breakpoint
CREATE TABLE "password_reset_code" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "password_reset_code_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"email" varchar(255) NOT NULL,
	"code" varchar(8) NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE "session" (
	"sessionToken" varchar(255) PRIMARY KEY NOT NULL,
	"userId" varchar(255) NOT NULL,
	"expires" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user" (
	"id" varchar(255) PRIMARY KEY NOT NULL,
	"name" varchar(255),
	"email" varchar(255) NOT NULL,
	"emailVerified" timestamp with time zone,
	"image" text,
	"usage_mode" "usage_mode",
	"active_organization_id" integer,
	"password" varchar(255),
	"reset_pin_hash" varchar(255),
	"reset_pin_hint" text,
	"reset_pin_failed_attempts" integer DEFAULT 0 NOT NULL,
	"reset_pin_locked_until" timestamp with time zone,
	"reset_pin_last_failed_at" timestamp with time zone,
	"login_failed_attempts" integer DEFAULT 0 NOT NULL,
	"login_locked_until" timestamp with time zone,
	"login_last_failed_at" timestamp with time zone,
	"bio" text,
	"email_notifications" boolean DEFAULT true NOT NULL,
	"project_updates_notifications" boolean DEFAULT true NOT NULL,
	"event_reminders_notifications" boolean DEFAULT false NOT NULL,
	"task_due_reminders_notifications" boolean DEFAULT true NOT NULL,
	"marketing_emails_notifications" boolean DEFAULT false NOT NULL,
	"language" "language" DEFAULT 'en' NOT NULL,
	"timezone" varchar(100) DEFAULT 'UTC' NOT NULL,
	"date_format" date_format DEFAULT 'MM/DD/YYYY' NOT NULL,
	"theme" "theme" DEFAULT 'dark' NOT NULL,
	"accent_color" varchar(20) DEFAULT 'purple' NOT NULL,
	"notes_keep_unlocked_until_close" boolean DEFAULT false NOT NULL,
	"profile_visibility" boolean DEFAULT true NOT NULL,
	"show_online_status" boolean DEFAULT true NOT NULL,
	"activity_tracking" boolean DEFAULT false NOT NULL,
	"data_collection" boolean DEFAULT false NOT NULL,
	"two_factor_enabled" boolean DEFAULT false NOT NULL,
	"two_factor_secret" varchar(255),
	"created_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"updated_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL,
	CONSTRAINT "user_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "verification_token" (
	"identifier" varchar(255) NOT NULL,
	"token" varchar(255) NOT NULL,
	"expires" timestamp with time zone NOT NULL,
	CONSTRAINT "verification_token_identifier_token_pk" PRIMARY KEY("identifier","token")
);
--> statement-breakpoint
CREATE TABLE "organization_invites" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "organization_invites_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"organization_id" integer NOT NULL,
	"email" varchar(255) NOT NULL,
	"role" "org_role" DEFAULT 'member' NOT NULL,
	"display_role" varchar(100),
	"invited_by_id" varchar(255) NOT NULL,
	"status" varchar(20) DEFAULT 'pending' NOT NULL,
	"created_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"expires_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "organization_members" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "organization_members_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"organization_id" integer NOT NULL,
	"user_id" varchar(255) NOT NULL,
	"role" "org_role" NOT NULL,
	"can_add_members" boolean DEFAULT false NOT NULL,
	"can_assign_tasks" boolean DEFAULT false NOT NULL,
	"can_create_projects" boolean DEFAULT false NOT NULL,
	"can_delete_tasks" boolean DEFAULT false NOT NULL,
	"can_kick_members" boolean DEFAULT false NOT NULL,
	"can_manage_roles" boolean DEFAULT false NOT NULL,
	"can_edit_projects" boolean DEFAULT false NOT NULL,
	"can_view_analytics" boolean DEFAULT false NOT NULL,
	"joined_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE "organization_roles" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "organization_roles_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"organization_id" integer NOT NULL,
	"name" varchar(100) NOT NULL,
	"can_add_members" boolean DEFAULT false NOT NULL,
	"can_assign_tasks" boolean DEFAULT false NOT NULL,
	"can_create_projects" boolean DEFAULT false NOT NULL,
	"can_delete_tasks" boolean DEFAULT false NOT NULL,
	"can_kick_members" boolean DEFAULT false NOT NULL,
	"can_manage_roles" boolean DEFAULT false NOT NULL,
	"can_edit_projects" boolean DEFAULT false NOT NULL,
	"can_view_analytics" boolean DEFAULT false NOT NULL,
	"is_template" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE "organizations" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "organizations_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"name" varchar(256) NOT NULL,
	"access_code" varchar(14) NOT NULL,
	"created_by_id" varchar(255) NOT NULL,
	"created_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"updated_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL,
	CONSTRAINT "organizations_access_code_unique" UNIQUE("access_code")
);
--> statement-breakpoint
CREATE TABLE "project_collaborators" (
	"project_id" integer NOT NULL,
	"collaboratorId" varchar(255) NOT NULL,
	"permission" "permission" NOT NULL,
	"joined_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL,
	CONSTRAINT "project_collaborators_project_id_collaboratorId_pk" PRIMARY KEY("project_id","collaboratorId")
);
--> statement-breakpoint
CREATE TABLE "projects" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "projects_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"title" varchar(256) NOT NULL,
	"description" text,
	"image_url" varchar(512),
	"status" "project_status" DEFAULT 'active' NOT NULL,
	"createdById" varchar(255) NOT NULL,
	"share_status" "share_status" DEFAULT 'private' NOT NULL,
	"created_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"updated_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"organization_id" integer
);
--> statement-breakpoint
CREATE TABLE "task_activity_log" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "task_activity_log_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"task_id" integer NOT NULL,
	"userId" varchar(255) NOT NULL,
	"action" varchar(100) NOT NULL,
	"old_value" text,
	"new_value" text,
	"created_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE "task_comments" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "task_comments_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"content" text NOT NULL,
	"task_id" integer NOT NULL,
	"createdById" varchar(255) NOT NULL,
	"created_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tasks" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "tasks_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"title" varchar(256) NOT NULL,
	"description" text,
	"project_id" integer NOT NULL,
	"assignedToId" varchar(255),
	"status" "task_status" DEFAULT 'pending' NOT NULL,
	"priority" "task_priority" DEFAULT 'medium' NOT NULL,
	"due_date" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"completed_by_id" varchar(255),
	"completion_note" text,
	"createdById" varchar(255) NOT NULL,
	"last_edited_by_id" varchar(255),
	"last_edited_at" timestamp with time zone,
	"created_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"updated_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"order_index" integer DEFAULT 0 NOT NULL,
	"client_request_id" varchar(128)
);
--> statement-breakpoint
CREATE TABLE "note_shares" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "note_shares_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"note_id" integer NOT NULL,
	"shared_with_id" varchar(255) NOT NULL,
	"permission" "permission" DEFAULT 'read' NOT NULL,
	"shared_by_id" varchar(255) NOT NULL,
	"created_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notebooks" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "notebooks_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"name" varchar(256) NOT NULL,
	"description" text,
	"createdById" varchar(255) NOT NULL,
	"created_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"updated_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sticky_notes" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "sticky_notes_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"title" varchar(256),
	"content" text NOT NULL,
	"createdById" varchar(255) NOT NULL,
	"notebook_id" integer,
	"calendar_date" timestamp,
	"created_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"updated_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"password_hash" varchar(256),
	"password_salt" varchar(256),
	"share_status" "share_status" NOT NULL
);
--> statement-breakpoint
CREATE TABLE "event_comment" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "event_comment_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"text" text NOT NULL,
	"image_url" text,
	"event_id" integer NOT NULL,
	"createdById" varchar(255) NOT NULL,
	"createdAt" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "event_like" (
	"event_id" integer NOT NULL,
	"createdById" varchar(255) NOT NULL,
	"createdAt" timestamp with time zone NOT NULL,
	CONSTRAINT "event_like_event_id_createdById_pk" PRIMARY KEY("event_id","createdById")
);
--> statement-breakpoint
CREATE TABLE "event_rsvp" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "event_rsvp_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"event_id" integer NOT NULL,
	"user_id" varchar(255) NOT NULL,
	"status" "rsvp_status" NOT NULL,
	"reminder_minutes_before" integer,
	"reminder_sent" boolean DEFAULT false NOT NULL,
	"createdAt" timestamp with time zone NOT NULL,
	"updatedAt" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "event" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "event_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"title" varchar(256) NOT NULL,
	"description" text NOT NULL,
	"image_url" text,
	"event_date" timestamp with time zone NOT NULL,
	"region" "region" NOT NULL,
	"createdById" varchar(255) NOT NULL,
	"enable_rsvp" boolean DEFAULT false NOT NULL,
	"send_reminders" boolean DEFAULT false NOT NULL,
	"reminder_sent" boolean DEFAULT false NOT NULL,
	"createdAt" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "direct_conversations" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "direct_conversations_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"project_id" integer,
	"organization_id" integer,
	"user_one_id" varchar(255) NOT NULL,
	"user_two_id" varchar(255) NOT NULL,
	"last_message_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"created_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"updated_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE "direct_messages" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "direct_messages_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"conversation_id" integer NOT NULL,
	"sender_id" varchar(255) NOT NULL,
	"body" text NOT NULL,
	"created_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notifications" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "notifications_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"user_id" varchar(255) NOT NULL,
	"type" "notification_type" NOT NULL,
	"title" varchar(256) NOT NULL,
	"message" text NOT NULL,
	"link" varchar(512),
	"read" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "agent_notes_vault_applies" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "agent_notes_vault_applies_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"draft_id" varchar(80) NOT NULL,
	"user_id" varchar(255) NOT NULL,
	"plan_hash" varchar(64) NOT NULL,
	"result_json" text NOT NULL,
	"created_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE "agent_notes_vault_drafts" (
	"id" varchar(80) PRIMARY KEY NOT NULL,
	"user_id" varchar(255) NOT NULL,
	"message" text NOT NULL,
	"plan_json" text NOT NULL,
	"plan_hash" varchar(64) NOT NULL,
	"status" "agent_notes_vault_draft_status" DEFAULT 'draft' NOT NULL,
	"confirmation_token" text,
	"confirmed_at" timestamp with time zone,
	"applied_at" timestamp with time zone,
	"created_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"updated_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"expires_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "agent_task_planner_applies" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "agent_task_planner_applies_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"draft_id" varchar(80) NOT NULL,
	"user_id" varchar(255) NOT NULL,
	"project_id" integer NOT NULL,
	"plan_hash" varchar(64) NOT NULL,
	"result_json" text NOT NULL,
	"created_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE "agent_task_planner_drafts" (
	"id" varchar(80) PRIMARY KEY NOT NULL,
	"user_id" varchar(255) NOT NULL,
	"project_id" integer NOT NULL,
	"message" text NOT NULL,
	"plan_json" text NOT NULL,
	"plan_hash" varchar(64) NOT NULL,
	"status" "agent_task_planner_draft_status" DEFAULT 'draft' NOT NULL,
	"confirmation_token" text,
	"confirmed_at" timestamp with time zone,
	"applied_at" timestamp with time zone,
	"created_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"updated_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"expires_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "account" ADD CONSTRAINT "account_userId_user_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session" ADD CONSTRAINT "session_userId_user_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organization_invites" ADD CONSTRAINT "organization_invites_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organization_invites" ADD CONSTRAINT "organization_invites_invited_by_id_user_id_fk" FOREIGN KEY ("invited_by_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organization_members" ADD CONSTRAINT "organization_members_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organization_members" ADD CONSTRAINT "organization_members_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organization_roles" ADD CONSTRAINT "organization_roles_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organizations" ADD CONSTRAINT "organizations_created_by_id_user_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_collaborators" ADD CONSTRAINT "project_collaborators_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_collaborators" ADD CONSTRAINT "project_collaborators_collaboratorId_user_id_fk" FOREIGN KEY ("collaboratorId") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_createdById_user_id_fk" FOREIGN KEY ("createdById") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_activity_log" ADD CONSTRAINT "task_activity_log_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_activity_log" ADD CONSTRAINT "task_activity_log_userId_user_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_comments" ADD CONSTRAINT "task_comments_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_comments" ADD CONSTRAINT "task_comments_createdById_user_id_fk" FOREIGN KEY ("createdById") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_assignedToId_user_id_fk" FOREIGN KEY ("assignedToId") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_completed_by_id_user_id_fk" FOREIGN KEY ("completed_by_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_createdById_user_id_fk" FOREIGN KEY ("createdById") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_last_edited_by_id_user_id_fk" FOREIGN KEY ("last_edited_by_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "note_shares" ADD CONSTRAINT "note_shares_note_id_sticky_notes_id_fk" FOREIGN KEY ("note_id") REFERENCES "public"."sticky_notes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "note_shares" ADD CONSTRAINT "note_shares_shared_with_id_user_id_fk" FOREIGN KEY ("shared_with_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "note_shares" ADD CONSTRAINT "note_shares_shared_by_id_user_id_fk" FOREIGN KEY ("shared_by_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notebooks" ADD CONSTRAINT "notebooks_createdById_user_id_fk" FOREIGN KEY ("createdById") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sticky_notes" ADD CONSTRAINT "sticky_notes_createdById_user_id_fk" FOREIGN KEY ("createdById") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sticky_notes" ADD CONSTRAINT "sticky_notes_notebook_id_notebooks_id_fk" FOREIGN KEY ("notebook_id") REFERENCES "public"."notebooks"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_comment" ADD CONSTRAINT "event_comment_event_id_event_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."event"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_comment" ADD CONSTRAINT "event_comment_createdById_user_id_fk" FOREIGN KEY ("createdById") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_like" ADD CONSTRAINT "event_like_event_id_event_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."event"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_like" ADD CONSTRAINT "event_like_createdById_user_id_fk" FOREIGN KEY ("createdById") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_rsvp" ADD CONSTRAINT "event_rsvp_event_id_event_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."event"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_rsvp" ADD CONSTRAINT "event_rsvp_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event" ADD CONSTRAINT "event_createdById_user_id_fk" FOREIGN KEY ("createdById") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "direct_conversations" ADD CONSTRAINT "direct_conversations_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "direct_conversations" ADD CONSTRAINT "direct_conversations_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "direct_conversations" ADD CONSTRAINT "direct_conversations_user_one_id_user_id_fk" FOREIGN KEY ("user_one_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "direct_conversations" ADD CONSTRAINT "direct_conversations_user_two_id_user_id_fk" FOREIGN KEY ("user_two_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "direct_messages" ADD CONSTRAINT "direct_messages_conversation_id_direct_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."direct_conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "direct_messages" ADD CONSTRAINT "direct_messages_sender_id_user_id_fk" FOREIGN KEY ("sender_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_notes_vault_applies" ADD CONSTRAINT "agent_notes_vault_applies_draft_id_agent_notes_vault_drafts_id_fk" FOREIGN KEY ("draft_id") REFERENCES "public"."agent_notes_vault_drafts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_notes_vault_applies" ADD CONSTRAINT "agent_notes_vault_applies_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_notes_vault_drafts" ADD CONSTRAINT "agent_notes_vault_drafts_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_task_planner_applies" ADD CONSTRAINT "agent_task_planner_applies_draft_id_agent_task_planner_drafts_id_fk" FOREIGN KEY ("draft_id") REFERENCES "public"."agent_task_planner_drafts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_task_planner_applies" ADD CONSTRAINT "agent_task_planner_applies_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_task_planner_applies" ADD CONSTRAINT "agent_task_planner_applies_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_task_planner_drafts" ADD CONSTRAINT "agent_task_planner_drafts_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_task_planner_drafts" ADD CONSTRAINT "agent_task_planner_drafts_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "account_user_id_idx" ON "account" USING btree ("userId");--> statement-breakpoint
CREATE INDEX "session_user_idx" ON "session" USING btree ("userId");--> statement-breakpoint
CREATE INDEX "org_invite_org_idx" ON "organization_invites" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "org_invite_email_idx" ON "organization_invites" USING btree ("email");--> statement-breakpoint
CREATE INDEX "org_member_org_idx" ON "organization_members" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "org_member_user_idx" ON "organization_members" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "org_member_unique" ON "organization_members" USING btree ("organization_id","user_id");--> statement-breakpoint
CREATE INDEX "org_role_org_idx" ON "organization_roles" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "org_created_by_idx" ON "organizations" USING btree ("created_by_id");--> statement-breakpoint
CREATE INDEX "org_access_code_idx" ON "organizations" USING btree ("access_code");--> statement-breakpoint
CREATE INDEX "project_collaborator_user_idx" ON "project_collaborators" USING btree ("collaboratorId");--> statement-breakpoint
CREATE INDEX "project_created_by_idx" ON "projects" USING btree ("createdById");--> statement-breakpoint
CREATE INDEX "project_org_idx" ON "projects" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "activity_task_idx" ON "task_activity_log" USING btree ("task_id");--> statement-breakpoint
CREATE INDEX "activity_user_idx" ON "task_activity_log" USING btree ("userId");--> statement-breakpoint
CREATE INDEX "task_comment_task_idx" ON "task_comments" USING btree ("task_id");--> statement-breakpoint
CREATE INDEX "task_comment_user_idx" ON "task_comments" USING btree ("createdById");--> statement-breakpoint
CREATE INDEX "task_project_idx" ON "tasks" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "task_assigned_to_idx" ON "tasks" USING btree ("assignedToId");--> statement-breakpoint
CREATE INDEX "task_created_by_idx" ON "tasks" USING btree ("createdById");--> statement-breakpoint
CREATE INDEX "task_completed_by_idx" ON "tasks" USING btree ("completed_by_id");--> statement-breakpoint
CREATE INDEX "task_last_edited_by_idx" ON "tasks" USING btree ("last_edited_by_id");--> statement-breakpoint
CREATE INDEX "task_client_request_id_idx" ON "tasks" USING btree ("client_request_id");--> statement-breakpoint
CREATE INDEX "note_share_note_idx" ON "note_shares" USING btree ("note_id");--> statement-breakpoint
CREATE INDEX "note_share_user_idx" ON "note_shares" USING btree ("shared_with_id");--> statement-breakpoint
CREATE INDEX "notebook_created_by_idx" ON "notebooks" USING btree ("createdById");--> statement-breakpoint
CREATE INDEX "note_created_by_idx" ON "sticky_notes" USING btree ("createdById");--> statement-breakpoint
CREATE INDEX "note_notebook_idx" ON "sticky_notes" USING btree ("notebook_id");--> statement-breakpoint
CREATE INDEX "note_calendar_date_idx" ON "sticky_notes" USING btree ("calendar_date");--> statement-breakpoint
CREATE INDEX "comment_event_id_idx" ON "event_comment" USING btree ("event_id");--> statement-breakpoint
CREATE INDEX "comment_created_by_idx" ON "event_comment" USING btree ("createdById");--> statement-breakpoint
CREATE INDEX "like_event_id_idx" ON "event_like" USING btree ("event_id");--> statement-breakpoint
CREATE INDEX "rsvp_event_idx" ON "event_rsvp" USING btree ("event_id");--> statement-breakpoint
CREATE INDEX "rsvp_user_idx" ON "event_rsvp" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "rsvp_unique" ON "event_rsvp" USING btree ("event_id","user_id");--> statement-breakpoint
CREATE INDEX "event_created_by_idx" ON "event" USING btree ("createdById");--> statement-breakpoint
CREATE INDEX "event_date_idx" ON "event" USING btree ("event_date");--> statement-breakpoint
CREATE INDEX "event_region_idx" ON "event" USING btree ("region");--> statement-breakpoint
CREATE INDEX "direct_convo_project_idx" ON "direct_conversations" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "direct_convo_org_idx" ON "direct_conversations" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "direct_convo_user_one_idx" ON "direct_conversations" USING btree ("user_one_id");--> statement-breakpoint
CREATE INDEX "direct_convo_user_two_idx" ON "direct_conversations" USING btree ("user_two_id");--> statement-breakpoint
CREATE INDEX "direct_msg_conversation_idx" ON "direct_messages" USING btree ("conversation_id");--> statement-breakpoint
CREATE INDEX "direct_msg_sender_idx" ON "direct_messages" USING btree ("sender_id");--> statement-breakpoint
CREATE INDEX "direct_msg_created_idx" ON "direct_messages" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "notification_user_idx" ON "notifications" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "notification_read_idx" ON "notifications" USING btree ("read");--> statement-breakpoint
CREATE INDEX "notification_created_idx" ON "notifications" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "a3_apply_draft_idx" ON "agent_notes_vault_applies" USING btree ("draft_id");--> statement-breakpoint
CREATE INDEX "a3_apply_user_idx" ON "agent_notes_vault_applies" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "a3_apply_plan_hash_idx" ON "agent_notes_vault_applies" USING btree ("plan_hash");--> statement-breakpoint
CREATE INDEX "a3_draft_user_idx" ON "agent_notes_vault_drafts" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "a3_draft_status_idx" ON "agent_notes_vault_drafts" USING btree ("status");--> statement-breakpoint
CREATE INDEX "a3_draft_plan_hash_idx" ON "agent_notes_vault_drafts" USING btree ("plan_hash");--> statement-breakpoint
CREATE INDEX "a2_apply_draft_idx" ON "agent_task_planner_applies" USING btree ("draft_id");--> statement-breakpoint
CREATE INDEX "a2_apply_user_idx" ON "agent_task_planner_applies" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "a2_apply_project_idx" ON "agent_task_planner_applies" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "a2_apply_plan_hash_idx" ON "agent_task_planner_applies" USING btree ("plan_hash");--> statement-breakpoint
CREATE INDEX "a2_draft_user_idx" ON "agent_task_planner_drafts" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "a2_draft_project_idx" ON "agent_task_planner_drafts" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "a2_draft_status_idx" ON "agent_task_planner_drafts" USING btree ("status");--> statement-breakpoint
CREATE INDEX "a2_draft_plan_hash_idx" ON "agent_task_planner_drafts" USING btree ("plan_hash");