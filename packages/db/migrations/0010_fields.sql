CREATE TABLE "fields" (
	"id" text PRIMARY KEY NOT NULL,
	"slug" text NOT NULL,
	"display_name" text NOT NULL,
	"description" text,
	"module_scope" text NOT NULL,
	"field_type" text NOT NULL,
	"options" jsonb,
	"field_tag" text NOT NULL,
	"ai_prompt" text,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "fields_module_scope_check" CHECK ("fields"."module_scope" in ('matter', 'contract', 'entity', 'global')),
	CONSTRAINT "fields_field_type_check" CHECK ("fields"."field_type" in ('text', 'long_text', 'number', 'date', 'boolean', 'single_select', 'multi_select', 'user', 'entity')),
	CONSTRAINT "fields_field_tag_check" CHECK ("fields"."field_tag" in ('business', 'legal'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX "fields_slug_unique" ON "fields" USING btree ("slug");--> statement-breakpoint
-- Seed the three CTR-008 contract core fields (TECH-014: the feature
-- that reads them lands in this same change), each with a default,
-- editable AI extraction prompt. Slugs and field types are immutable;
-- everything else is Administrator-editable from Contracts → Fields.
INSERT INTO "fields" ("id", "slug", "display_name", "description", "module_scope", "field_type", "options", "field_tag", "ai_prompt") VALUES
('019ff281-3719-7824-bea2-a7dc7559b354', 'governing_law', 'Governing law', 'The law that governs the contract.', 'contract', 'text', NULL, 'legal', 'Find the governing-law clause and extract the jurisdiction whose law governs the contract, exactly as the clause names it — for example "England and Wales" or "State of Delaware".'),
('019ff281-371a-72bd-98cd-9f84963d6c4a', 'jurisdiction', 'Jurisdiction', 'Where disputes are heard — the forum or venue.', 'contract', 'text', NULL, 'legal', 'Find the forum or venue clause and extract where disputes are heard — the courts or the arbitration seat — exactly as the clause names it.'),
('019ff281-371a-72bd-98cd-9f8513868094', 'our_position', 'Our position', 'Our side of the deal.', 'contract', 'single_select', '["Customer", "Provider", "Other"]', 'business', 'Decide our side''s role in this contract. Answer Customer if we receive the goods or services, Provider if we supply them, and Other for anything else.');