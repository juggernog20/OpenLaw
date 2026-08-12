CREATE TABLE "contract_statuses" (
	"id" text PRIMARY KEY NOT NULL,
	"slug" text NOT NULL,
	"display_name" text NOT NULL,
	"stage" text NOT NULL,
	"display_order" integer NOT NULL,
	"is_system_default" boolean DEFAULT false NOT NULL,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "contract_statuses_stage_check" CHECK ("contract_statuses"."stage" in ('draft', 'review', 'approval', 'signature', 'active', 'ended'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX "contract_statuses_slug_unique" ON "contract_statuses" USING btree ("slug");--> statement-breakpoint
-- Seed the eight CTR-001 contract statuses (TECH-014: the feature that
-- reads them lands in this same change). Application code keeps at least
-- one unarchived status per stage, and the `draft`, `active`, and
-- `expired` rows are system-protected — no archive, no hard delete.
INSERT INTO "contract_statuses" ("id", "slug", "display_name", "stage", "display_order", "is_system_default") VALUES
('019ff261-75cb-7e4a-aa54-112a7a91ec4f', 'draft', 'Draft', 'draft', 1, true),
('019ff261-75cc-7db6-a965-a31d51b78b02', 'internal_review', 'Internal review', 'review', 2, true),
('019ff261-75cc-7db6-a965-a31e106fe6e4', 'redlining', 'Redlining with counterparty', 'review', 3, true),
('019ff261-75cc-7db6-a965-a31fe09d26cb', 'awaiting_approval', 'Awaiting approval', 'approval', 4, true),
('019ff261-75cc-7db6-a965-a320bf8e03ba', 'out_for_signature', 'Out for signature', 'signature', 5, true),
('019ff261-75cc-7db6-a965-a32109f746df', 'active', 'Active', 'active', 6, true),
('019ff261-75cc-7db6-a965-a322c379f7c6', 'expired', 'Expired', 'ended', 7, true),
('019ff261-75cc-7db6-a965-a323d0f58014', 'terminated', 'Terminated', 'ended', 8, true);
