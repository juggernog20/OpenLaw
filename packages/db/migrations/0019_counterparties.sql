CREATE TABLE "contract_counterparties" (
	"contract_id" text NOT NULL,
	"counterparty_id" text NOT NULL,
	"is_primary" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "contract_counterparties_pkey" PRIMARY KEY("contract_id","counterparty_id")
);
--> statement-breakpoint
CREATE TABLE "counterparties" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"jurisdiction" text,
	"primary_contact_name" text,
	"primary_contact_email" text,
	"address" text,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "contract_counterparties" ADD CONSTRAINT "contract_counterparties_contract_id_contracts_id_fk" FOREIGN KEY ("contract_id") REFERENCES "public"."contracts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contract_counterparties" ADD CONSTRAINT "contract_counterparties_counterparty_id_counterparties_id_fk" FOREIGN KEY ("counterparty_id") REFERENCES "public"."counterparties"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "contract_counterparties_one_primary" ON "contract_counterparties" USING btree ("contract_id") WHERE "contract_counterparties"."is_primary";--> statement-breakpoint
CREATE INDEX "counterparties_name_idx" ON "counterparties" USING btree (lower("name"),"created_at");