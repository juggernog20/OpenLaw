CREATE TABLE "knowledge_folders" (
	"id" text PRIMARY KEY NOT NULL,
	"parent_id" text,
	"name" text NOT NULL,
	"display_order" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "knowledge_items" (
	"id" text PRIMARY KEY NOT NULL,
	"title" text NOT NULL,
	"knowledge_type_id" text NOT NULL,
	"body" text,
	"folder_id" text,
	"state" text DEFAULT 'draft' NOT NULL,
	"audience" text DEFAULT 'legal_only' NOT NULL,
	"primary_document_id" text,
	"replaced_by_id" text,
	"published_at" timestamp with time zone,
	"created_by" text NOT NULL,
	"updated_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	"search_vector" "tsvector" GENERATED ALWAYS AS (
      setweight(to_tsvector('english', coalesce("title", '')), 'A') ||
      setweight(to_tsvector('english', coalesce("body", '')), 'B')
    ) STORED,
	CONSTRAINT "knowledge_items_state_check" CHECK ("knowledge_items"."state" in ('draft', 'published')),
	CONSTRAINT "knowledge_items_audience_check" CHECK ("knowledge_items"."audience" in ('legal_only', 'everyone'))
);
--> statement-breakpoint
CREATE TABLE "knowledge_types" (
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
-- KNW-001's four starting types. The migration journal makes this run
-- once per install; stable ids keep a replay deterministic.
INSERT INTO "knowledge_types"
  ("id", "slug", "display_name", "display_order", "is_system_default")
VALUES
  ('01a08a5d-0b86-7000-8000-000000000001', 'template', 'Template', 1, true),
  ('01a08a5d-0b86-7000-8000-000000000002', 'precedent', 'Precedent', 2, true),
  ('01a08a5d-0b86-7000-8000-000000000003', 'playbook', 'Playbook', 3, true),
  ('01a08a5d-0b86-7000-8000-000000000004', 'article', 'Article', 4, true);
--> statement-breakpoint
ALTER TABLE "activity_log" DROP CONSTRAINT "activity_log_entity_type_check";--> statement-breakpoint
ALTER TABLE "documents" DROP CONSTRAINT "documents_owner_check";--> statement-breakpoint
ALTER TABLE "notification_preferences" DROP CONSTRAINT "notification_preferences_group_check";--> statement-breakpoint
ALTER TABLE "notifications" DROP CONSTRAINT "notifications_entity_type_check";--> statement-breakpoint
ALTER TABLE "intake_links" ALTER COLUMN "url" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN "knowledge_item_id" text;--> statement-breakpoint
ALTER TABLE "intake_links" ADD COLUMN "knowledge_item_id" text;--> statement-breakpoint
ALTER TABLE "knowledge_folders" ADD CONSTRAINT "knowledge_folders_parent_id_knowledge_folders_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."knowledge_folders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge_items" ADD CONSTRAINT "knowledge_items_knowledge_type_id_knowledge_types_id_fk" FOREIGN KEY ("knowledge_type_id") REFERENCES "public"."knowledge_types"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge_items" ADD CONSTRAINT "knowledge_items_folder_id_knowledge_folders_id_fk" FOREIGN KEY ("folder_id") REFERENCES "public"."knowledge_folders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge_items" ADD CONSTRAINT "knowledge_items_primary_document_id_documents_id_fk" FOREIGN KEY ("primary_document_id") REFERENCES "public"."documents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge_items" ADD CONSTRAINT "knowledge_items_replaced_by_id_knowledge_items_id_fk" FOREIGN KEY ("replaced_by_id") REFERENCES "public"."knowledge_items"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge_items" ADD CONSTRAINT "knowledge_items_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge_items" ADD CONSTRAINT "knowledge_items_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "knowledge_folders_parent_idx" ON "knowledge_folders" USING btree ("parent_id","display_order","id");--> statement-breakpoint
CREATE UNIQUE INDEX "knowledge_folders_root_name_idx" ON "knowledge_folders" USING btree ("name") WHERE "knowledge_folders"."parent_id" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "knowledge_folders_sibling_name_idx" ON "knowledge_folders" USING btree ("parent_id","name") WHERE "knowledge_folders"."parent_id" is not null;--> statement-breakpoint
CREATE INDEX "knowledge_items_type_idx" ON "knowledge_items" USING btree ("knowledge_type_id");--> statement-breakpoint
CREATE INDEX "knowledge_items_folder_idx" ON "knowledge_items" USING btree ("folder_id","created_at","id");--> statement-breakpoint
CREATE INDEX "knowledge_items_primary_document_idx" ON "knowledge_items" USING btree ("primary_document_id");--> statement-breakpoint
CREATE INDEX "knowledge_items_replaced_by_idx" ON "knowledge_items" USING btree ("replaced_by_id");--> statement-breakpoint
CREATE INDEX "knowledge_items_created_by_idx" ON "knowledge_items" USING btree ("created_by");--> statement-breakpoint
CREATE INDEX "knowledge_items_search_vector_idx" ON "knowledge_items" USING gin ("search_vector");--> statement-breakpoint
CREATE UNIQUE INDEX "knowledge_types_slug_unique" ON "knowledge_types" USING btree ("slug");--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_knowledge_item_id_knowledge_items_id_fk" FOREIGN KEY ("knowledge_item_id") REFERENCES "public"."knowledge_items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "intake_links" ADD CONSTRAINT "intake_links_knowledge_item_id_knowledge_items_id_fk" FOREIGN KEY ("knowledge_item_id") REFERENCES "public"."knowledge_items"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "documents_knowledge_item_idx" ON "documents" USING btree ("knowledge_item_id","created_at","id");--> statement-breakpoint
CREATE INDEX "intake_links_knowledge_item_id_idx" ON "intake_links" USING btree ("knowledge_item_id");--> statement-breakpoint
ALTER TABLE "activity_log" ADD CONSTRAINT "activity_log_entity_type_check" CHECK ("activity_log"."entity_type" in ('matter', 'contract', 'document', 'request', 'user', 'entity', 'knowledge_item', 'system'));--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_owner_check" CHECK (num_nonnulls("documents"."matter_id", "documents"."contract_id", "documents"."entity_id", "documents"."knowledge_item_id") = 1);--> statement-breakpoint
ALTER TABLE "intake_links" ADD CONSTRAINT "intake_links_target_check" CHECK (num_nonnulls("intake_links"."url", "intake_links"."knowledge_item_id") = 1);--> statement-breakpoint
ALTER TABLE "notification_preferences" ADD CONSTRAINT "notification_preferences_group_check" CHECK ("notification_preferences"."event_group" in ('assigned_to_you', 'activity_on_your_records', 'dates_approaching', 'new_requests', 'knowledge', 'requester_events'));--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_entity_type_check" CHECK ("notifications"."entity_type" in ('matter', 'contract', 'document', 'request', 'entity', 'knowledge_item'));
