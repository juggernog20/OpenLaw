CREATE TABLE "contract_envelope_signers" (
	"id" text PRIMARY KEY NOT NULL,
	"envelope_id" text NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"signing_order" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "contract_envelope_signers_order_check" CHECK (signing_order >= 1)
);
--> statement-breakpoint
CREATE TABLE "contract_envelopes" (
	"id" text PRIMARY KEY NOT NULL,
	"contract_id" text NOT NULL,
	"provider" text NOT NULL,
	"provider_envelope_id" text NOT NULL,
	"status" text DEFAULT 'sent' NOT NULL,
	"document_version_id" text,
	"sent_by" text NOT NULL,
	"reason" text,
	"executed_fetch" text DEFAULT 'pending' NOT NULL,
	"sent_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "contract_envelopes_provider_check" CHECK (provider in ('docusign')),
	CONSTRAINT "contract_envelopes_status_check" CHECK (status in ('sent', 'signed', 'declined', 'voided')),
	CONSTRAINT "contract_envelopes_executed_fetch_check" CHECK (executed_fetch in ('pending', 'ready', 'failed')),
	CONSTRAINT "contract_envelopes_completed_at" CHECK ((status = 'sent') = (completed_at is null)),
	CONSTRAINT "contract_envelopes_reason_status" CHECK (reason is null or status in ('declined', 'voided'))
);
--> statement-breakpoint
ALTER TABLE "contract_envelope_signers" ADD CONSTRAINT "contract_envelope_signers_envelope_id_contract_envelopes_id_fk" FOREIGN KEY ("envelope_id") REFERENCES "public"."contract_envelopes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contract_envelopes" ADD CONSTRAINT "contract_envelopes_contract_id_contracts_id_fk" FOREIGN KEY ("contract_id") REFERENCES "public"."contracts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contract_envelopes" ADD CONSTRAINT "contract_envelopes_document_version_id_document_versions_id_fk" FOREIGN KEY ("document_version_id") REFERENCES "public"."document_versions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contract_envelopes" ADD CONSTRAINT "contract_envelopes_sent_by_users_id_fk" FOREIGN KEY ("sent_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "contract_envelope_signers_envelope_idx" ON "contract_envelope_signers" USING btree ("envelope_id");--> statement-breakpoint
CREATE UNIQUE INDEX "contract_envelope_signers_order_idx" ON "contract_envelope_signers" USING btree ("envelope_id","signing_order");--> statement-breakpoint
CREATE INDEX "contract_envelopes_contract_idx" ON "contract_envelopes" USING btree ("contract_id");--> statement-breakpoint
CREATE UNIQUE INDEX "contract_envelopes_provider_id_idx" ON "contract_envelopes" USING btree ("provider","provider_envelope_id");--> statement-breakpoint
CREATE UNIQUE INDEX "contract_envelopes_live_idx" ON "contract_envelopes" USING btree ("contract_id") WHERE status = 'sent';