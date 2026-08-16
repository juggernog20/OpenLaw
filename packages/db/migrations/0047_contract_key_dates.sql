CREATE TABLE "contract_key_dates" (
	"id" text PRIMARY KEY NOT NULL,
	"contract_id" text NOT NULL,
	"date" date NOT NULL,
	"label" text NOT NULL,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "contract_key_dates_label_check" CHECK (length(btrim("contract_key_dates"."label")) between 1 and 200),
	CONSTRAINT "contract_key_dates_note_check" CHECK ("contract_key_dates"."note" is null or length(btrim("contract_key_dates"."note")) between 1 and 2000)
);
--> statement-breakpoint
ALTER TABLE "contract_key_dates" ADD CONSTRAINT "contract_key_dates_contract_id_contracts_id_fk" FOREIGN KEY ("contract_id") REFERENCES "public"."contracts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "contract_key_dates_contract_date_idx" ON "contract_key_dates" USING btree ("contract_id","date");