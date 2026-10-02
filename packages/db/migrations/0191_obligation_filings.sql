CREATE TABLE "entity_obligation_filings" (
	"id" text PRIMARY KEY NOT NULL,
	"obligation_id" text NOT NULL,
	"filed_on" date NOT NULL,
	"note" text,
	"filed_by" text NOT NULL,
	"document_id" text,
	"version_id" text,
	"document_filed" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "entity_obligation_filings_document_pair_check" CHECK (("entity_obligation_filings"."document_id" is null and "entity_obligation_filings"."version_id" is null) or ("entity_obligation_filings"."document_id" is not null and "entity_obligation_filings"."version_id" is not null)),
	CONSTRAINT "entity_obligation_filings_document_filed_check" CHECK ("entity_obligation_filings"."document_id" is null or "entity_obligation_filings"."document_filed")
);
--> statement-breakpoint
ALTER TABLE "entity_obligation_filings" ADD CONSTRAINT "entity_obligation_filings_obligation_id_entity_obligations_id_fk" FOREIGN KEY ("obligation_id") REFERENCES "public"."entity_obligations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entity_obligation_filings" ADD CONSTRAINT "entity_obligation_filings_filed_by_users_id_fk" FOREIGN KEY ("filed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entity_obligation_filings" ADD CONSTRAINT "entity_obligation_filings_document_version_fk" FOREIGN KEY ("document_id","version_id") REFERENCES "public"."document_versions"("document_id","id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "entity_obligation_filings_obligation_idx" ON "entity_obligation_filings" USING btree ("obligation_id","filed_on","created_at");--> statement-breakpoint
CREATE INDEX "entity_obligation_filings_document_idx" ON "entity_obligation_filings" USING btree ("document_id","version_id");