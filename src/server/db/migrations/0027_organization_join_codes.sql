CREATE TABLE "organization_join_codes" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "organization_join_codes_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"organization_id" integer NOT NULL,
	"code" varchar(64) NOT NULL,
	"role" "org_role" DEFAULT 'worker' NOT NULL,
	"created_by_id" varchar(255) NOT NULL,
	"created_at" timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"max_uses" integer DEFAULT 1 NOT NULL,
	"used_count" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "organization_join_codes_code_unique" UNIQUE("code")
);
--> statement-breakpoint
ALTER TABLE "organization_join_codes" ADD CONSTRAINT "organization_join_codes_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organization_join_codes" ADD CONSTRAINT "organization_join_codes_created_by_id_user_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "org_join_code_org_idx" ON "organization_join_codes" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "org_join_code_expires_idx" ON "organization_join_codes" USING btree ("expires_at");
