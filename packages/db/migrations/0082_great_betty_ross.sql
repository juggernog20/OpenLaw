CREATE TABLE "entity_grants" (
	"entity_id" text NOT NULL,
	"user_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "entity_grants_entity_id_user_id_pk" PRIMARY KEY("entity_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "entity_holdings" (
	"owner_entity_id" text NOT NULL,
	"owned_entity_id" text NOT NULL,
	"ownership_percent" numeric(5, 2) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "entity_holdings_owner_entity_id_owned_entity_id_pk" PRIMARY KEY("owner_entity_id","owned_entity_id"),
	CONSTRAINT "entity_holdings_percent_range" CHECK ("entity_holdings"."ownership_percent" >= 0 and "entity_holdings"."ownership_percent" <= 100),
	CONSTRAINT "entity_holdings_distinct_entities" CHECK ("entity_holdings"."owner_entity_id" <> "entity_holdings"."owned_entity_id")
);
--> statement-breakpoint
CREATE TABLE "entity_obligations" (
	"id" text PRIMARY KEY NOT NULL,
	"entity_id" text NOT NULL,
	"label" text NOT NULL,
	"registration_id" text,
	"recurrence_months" integer,
	"next_due_on" date NOT NULL,
	"assignee_id" text,
	"note" text,
	"matter_id" text,
	"completed_on" date,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "entity_obligations_recurrence_months_check" CHECK ("entity_obligations"."recurrence_months" is null or "entity_obligations"."recurrence_months" > 0)
);
--> statement-breakpoint
CREATE TABLE "entity_officers" (
	"id" text PRIMARY KEY NOT NULL,
	"entity_id" text NOT NULL,
	"name" text NOT NULL,
	"officer_role_id" text NOT NULL,
	"appointed_on" date,
	"resigned_on" date,
	"user_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "entity_registrations" (
	"id" text PRIMARY KEY NOT NULL,
	"entity_id" text NOT NULL,
	"jurisdiction" text NOT NULL,
	"registration_number" text,
	"registered_agent" text,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "entity_registrations_status_check" CHECK ("entity_registrations"."status" in ('active', 'lapsed', 'withdrawn'))
);
--> statement-breakpoint
CREATE TABLE "entity_type_fields" (
	"entity_type_id" text NOT NULL,
	"field_id" text NOT NULL,
	"display_order" integer NOT NULL,
	"is_required" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "entity_type_fields_entity_type_id_field_id_pk" PRIMARY KEY("entity_type_id","field_id")
);
--> statement-breakpoint
CREATE TABLE "officer_roles" (
	"id" text PRIMARY KEY NOT NULL,
	"slug" text NOT NULL,
	"display_name" text NOT NULL,
	"description" text,
	"display_order" integer NOT NULL,
	"is_system_default" boolean DEFAULT false NOT NULL,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "document_folders" DROP CONSTRAINT "document_folders_owner_check";--> statement-breakpoint
ALTER TABLE "documents" DROP CONSTRAINT "documents_owner_check";--> statement-breakpoint
ALTER TABLE "notifications" DROP CONSTRAINT "notifications_entity_type_check";--> statement-breakpoint
ALTER TABLE "document_folders" ADD COLUMN "entity_id" text;--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN "entity_id" text;--> statement-breakpoint
ALTER TABLE "entities" ADD COLUMN "shares_authorized" bigint;--> statement-breakpoint
ALTER TABLE "entities" ADD COLUMN "shares_issued" bigint;--> statement-breakpoint
ALTER TABLE "entities" ADD COLUMN "par_value" bigint;--> statement-breakpoint
ALTER TABLE "entities" ADD COLUMN "custom_fields" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "entities" ADD COLUMN "is_confidential" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "entity_grants" ADD CONSTRAINT "entity_grants_entity_id_entities_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."entities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entity_grants" ADD CONSTRAINT "entity_grants_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entity_holdings" ADD CONSTRAINT "entity_holdings_owner_entity_id_entities_id_fk" FOREIGN KEY ("owner_entity_id") REFERENCES "public"."entities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entity_holdings" ADD CONSTRAINT "entity_holdings_owned_entity_id_entities_id_fk" FOREIGN KEY ("owned_entity_id") REFERENCES "public"."entities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entity_obligations" ADD CONSTRAINT "entity_obligations_entity_id_entities_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."entities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entity_obligations" ADD CONSTRAINT "entity_obligations_registration_id_entity_registrations_id_fk" FOREIGN KEY ("registration_id") REFERENCES "public"."entity_registrations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entity_obligations" ADD CONSTRAINT "entity_obligations_assignee_id_users_id_fk" FOREIGN KEY ("assignee_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entity_obligations" ADD CONSTRAINT "entity_obligations_matter_id_matters_id_fk" FOREIGN KEY ("matter_id") REFERENCES "public"."matters"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entity_officers" ADD CONSTRAINT "entity_officers_entity_id_entities_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."entities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entity_officers" ADD CONSTRAINT "entity_officers_officer_role_id_officer_roles_id_fk" FOREIGN KEY ("officer_role_id") REFERENCES "public"."officer_roles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entity_officers" ADD CONSTRAINT "entity_officers_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entity_registrations" ADD CONSTRAINT "entity_registrations_entity_id_entities_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."entities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entity_type_fields" ADD CONSTRAINT "entity_type_fields_entity_type_id_entity_types_id_fk" FOREIGN KEY ("entity_type_id") REFERENCES "public"."entity_types"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entity_type_fields" ADD CONSTRAINT "entity_type_fields_field_id_fields_id_fk" FOREIGN KEY ("field_id") REFERENCES "public"."fields"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "entity_grants_user_idx" ON "entity_grants" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "entity_holdings_owned_idx" ON "entity_holdings" USING btree ("owned_entity_id");--> statement-breakpoint
CREATE INDEX "entity_obligations_entity_due_idx" ON "entity_obligations" USING btree ("entity_id","next_due_on","id");--> statement-breakpoint
CREATE INDEX "entity_obligations_registration_idx" ON "entity_obligations" USING btree ("registration_id");--> statement-breakpoint
CREATE INDEX "entity_obligations_assignee_due_idx" ON "entity_obligations" USING btree ("assignee_id","next_due_on");--> statement-breakpoint
CREATE INDEX "entity_obligations_matter_idx" ON "entity_obligations" USING btree ("matter_id");--> statement-breakpoint
CREATE INDEX "entity_officers_entity_idx" ON "entity_officers" USING btree ("entity_id","resigned_on","created_at");--> statement-breakpoint
CREATE INDEX "entity_officers_role_idx" ON "entity_officers" USING btree ("officer_role_id");--> statement-breakpoint
CREATE INDEX "entity_officers_user_idx" ON "entity_officers" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "entity_registrations_entity_idx" ON "entity_registrations" USING btree ("entity_id","created_at");--> statement-breakpoint
CREATE INDEX "entity_type_fields_field_id_idx" ON "entity_type_fields" USING btree ("field_id");--> statement-breakpoint
CREATE UNIQUE INDEX "officer_roles_slug_unique" ON "officer_roles" USING btree ("slug");--> statement-breakpoint
-- Seed the five ENT-001 officer roles in the migration that creates the
-- taxonomy. `other` is system-protected by the officer-role route mount.
INSERT INTO "officer_roles" ("id", "slug", "display_name", "display_order", "is_system_default") VALUES
('01a04ee8-5ba2-740f-b000-224b06a9107b', 'director', 'Director', 1, true),
('01a04ee8-5ba2-740f-b000-224c4dd10a13', 'ceo', 'CEO', 2, true),
('01a04ee8-5ba2-740f-b000-224d68c92e2a', 'cfo', 'CFO', 3, true),
('01a04ee8-5ba2-740f-b000-224ef52ed40b', 'secretary', 'Secretary', 4, true),
('01a04ee8-5ba2-740f-b000-224f85400a3e', 'other', 'Other', 5, true);--> statement-breakpoint
ALTER TABLE "document_folders" ADD CONSTRAINT "document_folders_entity_id_entities_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."entities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_entity_id_entities_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."entities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "document_folders_entity_idx" ON "document_folders" USING btree ("entity_id");--> statement-breakpoint
CREATE UNIQUE INDEX "document_folders_entity_root_name_idx" ON "document_folders" USING btree ("entity_id",lower("name")) WHERE "document_folders"."parent_id" is null and "document_folders"."entity_id" is not null;--> statement-breakpoint
CREATE INDEX "documents_entity_idx" ON "documents" USING btree ("entity_id","created_at","id");--> statement-breakpoint
ALTER TABLE "document_folders" ADD CONSTRAINT "document_folders_owner_check" CHECK (num_nonnulls("document_folders"."matter_id", "document_folders"."contract_id", "document_folders"."entity_id") = 1);--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_owner_check" CHECK (num_nonnulls("documents"."matter_id", "documents"."contract_id", "documents"."entity_id") = 1);--> statement-breakpoint
ALTER TABLE "entities" ADD CONSTRAINT "entities_custom_fields_object" CHECK (jsonb_typeof("entities"."custom_fields") = 'object');--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_entity_type_check" CHECK ("notifications"."entity_type" in ('matter', 'contract', 'document', 'request', 'entity'));
