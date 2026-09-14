-- SPDX-License-Identifier: AGPL-3.0-only

CREATE TABLE "auto_doc_assignment_rules" (
	"id" text PRIMARY KEY NOT NULL,
	"auto_doc_id" text NOT NULL,
	"display_order" integer NOT NULL,
	"field_slug" text NOT NULL,
	"operator" text NOT NULL,
	"value" jsonb,
	"legal_owner_id" text NOT NULL,
	CONSTRAINT "auto_doc_assignment_rules_order_check" CHECK ("auto_doc_assignment_rules"."display_order" >= 0),
	CONSTRAINT "auto_doc_assignment_rules_operator_check" CHECK ("auto_doc_assignment_rules"."operator" in ('equals', 'is_one_of', 'is_set', 'is_not'))
);
--> statement-breakpoint
ALTER TABLE "auto_docs" ADD COLUMN "default_legal_owner_id" text;--> statement-breakpoint
ALTER TABLE "auto_doc_assignment_rules" ADD CONSTRAINT "auto_doc_assignment_rules_auto_doc_id_auto_docs_id_fk" FOREIGN KEY ("auto_doc_id") REFERENCES "public"."auto_docs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "auto_doc_assignment_rules" ADD CONSTRAINT "auto_doc_assignment_rules_legal_owner_id_users_id_fk" FOREIGN KEY ("legal_owner_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "auto_doc_assignment_rules_order_idx" ON "auto_doc_assignment_rules" USING btree ("auto_doc_id","display_order");--> statement-breakpoint
ALTER TABLE "auto_docs" ADD CONSTRAINT "auto_docs_default_legal_owner_id_users_id_fk" FOREIGN KEY ("default_legal_owner_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
