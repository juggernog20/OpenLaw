CREATE TABLE "request_types" (
	"id" text PRIMARY KEY NOT NULL,
	"slug" text NOT NULL,
	"display_name" text NOT NULL,
	"description" text,
	"display_order" integer NOT NULL,
	"is_system_default" boolean DEFAULT false NOT NULL,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"target_module" text,
	"target_matter_type_id" text,
	"target_contract_type_id" text,
	CONSTRAINT "request_types_target_check" CHECK ((
        ("request_types"."target_module" is null and "request_types"."target_matter_type_id" is null and "request_types"."target_contract_type_id" is null)
        or ("request_types"."target_module" is not distinct from 'matter' and "request_types"."target_contract_type_id" is null)
        or ("request_types"."target_module" is not distinct from 'contract' and "request_types"."target_matter_type_id" is null)
      ))
);
--> statement-breakpoint
ALTER TABLE "request_types" ADD CONSTRAINT "request_types_target_matter_type_id_matter_types_id_fk" FOREIGN KEY ("target_matter_type_id") REFERENCES "public"."matter_types"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "request_types" ADD CONSTRAINT "request_types_target_contract_type_id_contract_types_id_fk" FOREIGN KEY ("target_contract_type_id") REFERENCES "public"."contract_types"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "request_types_slug_unique" ON "request_types" USING btree ("slug");--> statement-breakpoint
-- Seed the three INT-002 request types ST12 draws (TECH-014: the
-- feature that reads them lands in this same change), marked system
-- defaults. None is system-protected: no record needs a non-null
-- request type once conversion is done, so an Administrator may
-- archive or delete any of them.
INSERT INTO "request_types" ("id", "slug", "display_name", "description", "display_order", "is_system_default", "target_module") VALUES
('01a01b9d-aaba-7404-9c47-1a667d22eddd', 'nda_request', 'NDA request', 'Mutual or one-way NDA with a counterparty.', 1, true, 'contract'),
('01a01b9d-aabb-70d4-a098-784763327ff0', 'contract_review', 'Contract review', 'Review of a counterparty contract or redline.', 2, true, 'contract'),
('01a01b9d-aabb-70d4-a098-784857481634', 'legal_question', 'Legal question', 'One-off question — no record is created up front.', 3, true, NULL);--> statement-breakpoint
-- "NDA request" names the NDA contract type; "Contract review" leaves
-- the type to the reviewer at conversion. Read by slug rather than by
-- the seeded id, so an install whose NDA row was already hard-deleted
-- lands on the module-only state the model already has instead of
-- failing the migration.
UPDATE "request_types" SET "target_contract_type_id" = (SELECT "id" FROM "contract_types" WHERE "slug" = 'nda') WHERE "slug" = 'nda_request';
