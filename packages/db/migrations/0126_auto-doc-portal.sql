-- SPDX-License-Identifier: AGPL-3.0-only

CREATE TABLE "auto_doc_acknowledgements" (
	"id" text PRIMARY KEY NOT NULL,
	"auto_doc_id" text,
	"user_id" text NOT NULL,
	"frequency" text NOT NULL,
	"text_hash" text NOT NULL,
	"acknowledged_at" timestamp with time zone DEFAULT now() NOT NULL,
	"consumed_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	CONSTRAINT "auto_doc_acknowledgements_frequency_check" CHECK ("auto_doc_acknowledgements"."frequency" in ('every_use', 'once_per_auto_doc', 'once')),
	CONSTRAINT "auto_doc_acknowledgements_scope_check" CHECK (("auto_doc_acknowledgements"."auto_doc_id" is null) = ("auto_doc_acknowledgements"."frequency" = 'once')),
	CONSTRAINT "auto_doc_acknowledgements_hash_check" CHECK ("auto_doc_acknowledgements"."text_hash" ~ '^[a-f0-9]{64}$'),
	CONSTRAINT "auto_doc_acknowledgements_consumed_check" CHECK ("auto_doc_acknowledgements"."consumed_at" is null or "auto_doc_acknowledgements"."frequency" = 'every_use')
);
--> statement-breakpoint
CREATE TABLE "auto_doc_audience_departments" (
	"auto_doc_id" text NOT NULL,
	"department_id" text NOT NULL,
	CONSTRAINT "auto_doc_audience_departments_auto_doc_id_department_id_pk" PRIMARY KEY("auto_doc_id","department_id")
);
--> statement-breakpoint
CREATE TABLE "auto_doc_audience_users" (
	"auto_doc_id" text NOT NULL,
	"user_id" text NOT NULL,
	CONSTRAINT "auto_doc_audience_users_auto_doc_id_user_id_pk" PRIMARY KEY("auto_doc_id","user_id")
);
--> statement-breakpoint
ALTER TABLE "auto_docs" ADD COLUMN "acknowledgement_text" text;--> statement-breakpoint
ALTER TABLE "auto_docs" ADD COLUMN "acknowledgement_frequency" text DEFAULT 'once_per_auto_doc' NOT NULL;--> statement-breakpoint
ALTER TABLE "org_settings" ADD COLUMN "auto_doc_acknowledgement_text" text DEFAULT 'I agree not to edit the generated document. I will contact Legal if changes are needed.' NOT NULL;--> statement-breakpoint
ALTER TABLE "auto_doc_acknowledgements" ADD CONSTRAINT "auto_doc_acknowledgements_auto_doc_id_auto_docs_id_fk" FOREIGN KEY ("auto_doc_id") REFERENCES "public"."auto_docs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "auto_doc_acknowledgements" ADD CONSTRAINT "auto_doc_acknowledgements_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "auto_doc_audience_departments" ADD CONSTRAINT "auto_doc_audience_departments_auto_doc_id_auto_docs_id_fk" FOREIGN KEY ("auto_doc_id") REFERENCES "public"."auto_docs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "auto_doc_audience_departments" ADD CONSTRAINT "auto_doc_audience_departments_department_id_departments_id_fk" FOREIGN KEY ("department_id") REFERENCES "public"."departments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "auto_doc_audience_users" ADD CONSTRAINT "auto_doc_audience_users_auto_doc_id_auto_docs_id_fk" FOREIGN KEY ("auto_doc_id") REFERENCES "public"."auto_docs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "auto_doc_audience_users" ADD CONSTRAINT "auto_doc_audience_users_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "auto_doc_acknowledgements_person_idx" ON "auto_doc_acknowledgements" USING btree ("user_id","auto_doc_id","text_hash");--> statement-breakpoint
CREATE INDEX "auto_doc_acknowledgements_text_idx" ON "auto_doc_acknowledgements" USING btree ("text_hash") WHERE "auto_doc_acknowledgements"."revoked_at" is null;--> statement-breakpoint
ALTER TABLE "auto_docs" ADD CONSTRAINT "auto_docs_acknowledgement_frequency_check" CHECK ("auto_docs"."acknowledgement_frequency" in ('none', 'every_use', 'once_per_auto_doc', 'once'));
