CREATE TABLE "entity_partnership_entries" (
	"id" text PRIMARY KEY NOT NULL,
	"entity_id" text NOT NULL,
	"entry_no" integer NOT NULL,
	"kind" text NOT NULL,
	"effective_on" date NOT NULL,
	"party_id" text,
	"from_party_id" text,
	"to_party_id" text,
	"capacity" text,
	"transferee_status" text,
	"units" bigint,
	"stated_percent" numeric(5, 2),
	"amount" bigint,
	"currency" text,
	"form_of_contribution" text,
	"consideration" text,
	"reference" text,
	"note" text,
	"recorded_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "entity_partnership_entries_entry_no_positive" CHECK ("entity_partnership_entries"."entry_no">0),
	CONSTRAINT "entity_partnership_entries_capacity" CHECK ("entity_partnership_entries"."capacity" is null or "entity_partnership_entries"."capacity" in ('general','limited')),
	CONSTRAINT "entity_partnership_entries_ranges" CHECK (("entity_partnership_entries"."units" is null or "entity_partnership_entries"."units" between 0 and 9007199254740991) and ("entity_partnership_entries"."stated_percent" is null or "entity_partnership_entries"."stated_percent" between 0 and 100) and ("entity_partnership_entries"."amount" is null or "entity_partnership_entries"."amount" between 1 and 9007199254740991)),
	CONSTRAINT "entity_partnership_entries_currency" CHECK (("entity_partnership_entries"."amount" is null and "entity_partnership_entries"."currency" is null) or ("entity_partnership_entries"."amount" is not null and "entity_partnership_entries"."currency" is not null and "entity_partnership_entries"."currency" ~ '^[A-Z]{3}$')),
	CONSTRAINT "entity_partnership_entries_parties" CHECK (case when "entity_partnership_entries"."kind"='transfer' then "entity_partnership_entries"."party_id" is null and "entity_partnership_entries"."from_party_id" is not null and "entity_partnership_entries"."to_party_id" is not null and "entity_partnership_entries"."from_party_id"<>"entity_partnership_entries"."to_party_id" else "entity_partnership_entries"."party_id" is not null and "entity_partnership_entries"."from_party_id" is null and "entity_partnership_entries"."to_party_id" is null end),
	CONSTRAINT "entity_partnership_entries_kind_shape" CHECK (case
    when "entity_partnership_entries"."kind"='admission' then "entity_partnership_entries"."capacity" is not null and "entity_partnership_entries"."amount" is null and "entity_partnership_entries"."transferee_status" is null
    when "entity_partnership_entries"."kind" in ('commitment','contribution','return') then "entity_partnership_entries"."capacity" is null and "entity_partnership_entries"."amount" is not null and "entity_partnership_entries"."units" is null and "entity_partnership_entries"."stated_percent" is null and "entity_partnership_entries"."transferee_status" is null
    when "entity_partnership_entries"."kind"='transfer' then (coalesce("entity_partnership_entries"."units",0)>0 or coalesce("entity_partnership_entries"."stated_percent",0)>0 or "entity_partnership_entries"."amount" is not null) and ("entity_partnership_entries"."transferee_status" is null or "entity_partnership_entries"."transferee_status" in ('admitted','assignee')) and case when "entity_partnership_entries"."transferee_status"='admitted' then "entity_partnership_entries"."capacity" is not null else "entity_partnership_entries"."capacity" is null end
    when "entity_partnership_entries"."kind"='capacity_change' then "entity_partnership_entries"."capacity" is not null and "entity_partnership_entries"."units" is null and "entity_partnership_entries"."stated_percent" is null and "entity_partnership_entries"."amount" is null and "entity_partnership_entries"."transferee_status" is null
    when "entity_partnership_entries"."kind"='withdrawal' then "entity_partnership_entries"."capacity" is null and "entity_partnership_entries"."units" is null and "entity_partnership_entries"."stated_percent" is null and "entity_partnership_entries"."amount" is null and "entity_partnership_entries"."transferee_status" is null
    else false end),
	CONSTRAINT "entity_partnership_entries_text" CHECK (("entity_partnership_entries"."form_of_contribution" is null or ("entity_partnership_entries"."kind"='contribution' and length(trim("entity_partnership_entries"."form_of_contribution")) between 1 and 2000)) and ("entity_partnership_entries"."consideration" is null or ("entity_partnership_entries"."kind"='transfer' and length(trim("entity_partnership_entries"."consideration")) between 1 and 2000)) and ("entity_partnership_entries"."reference" is null or length("entity_partnership_entries"."reference")<=200) and ("entity_partnership_entries"."note" is null or length("entity_partnership_entries"."note")<=2000))
);
--> statement-breakpoint
ALTER TABLE "individual_holdings" ALTER COLUMN "shareholder_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "entities" ADD COLUMN "partnership_basis" text DEFAULT 'capital' NOT NULL;--> statement-breakpoint
ALTER TABLE "individual_holdings" ADD COLUMN "register_party_id" text;--> statement-breakpoint
ALTER TABLE "entity_partnership_entries" ADD CONSTRAINT "entity_partnership_entries_entity_id_entities_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."entities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entity_partnership_entries" ADD CONSTRAINT "entity_partnership_entries_recorded_by_users_id_fk" FOREIGN KEY ("recorded_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entity_partnership_entries" ADD CONSTRAINT "entity_partnership_entries_party_0_fk" FOREIGN KEY ("entity_id","party_id") REFERENCES "public"."entity_register_parties"("entity_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entity_partnership_entries" ADD CONSTRAINT "entity_partnership_entries_party_1_fk" FOREIGN KEY ("entity_id","from_party_id") REFERENCES "public"."entity_register_parties"("entity_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entity_partnership_entries" ADD CONSTRAINT "entity_partnership_entries_party_2_fk" FOREIGN KEY ("entity_id","to_party_id") REFERENCES "public"."entity_register_parties"("entity_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "entity_partnership_entries_entity_no_idx" ON "entity_partnership_entries" USING btree ("entity_id","entry_no");--> statement-breakpoint
CREATE INDEX "entity_partnership_entries_entity_date_idx" ON "entity_partnership_entries" USING btree ("entity_id","effective_on");--> statement-breakpoint
ALTER TABLE "individual_holdings" ADD CONSTRAINT "individual_holdings_register_party_fk" FOREIGN KEY ("owned_entity_id","register_party_id") REFERENCES "public"."entity_register_parties"("entity_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "individual_holdings_register_party_idx" ON "individual_holdings" USING btree ("register_party_id") WHERE "individual_holdings"."register_party_id" is not null;--> statement-breakpoint
ALTER TABLE "entities" ADD CONSTRAINT "entities_partnership_basis" CHECK ("entities"."partnership_basis" in ('capital', 'units', 'stated', 'equal'));--> statement-breakpoint
ALTER TABLE "individual_holdings" ADD CONSTRAINT "individual_holdings_register_identity" CHECK (num_nonnulls("individual_holdings"."shareholder_id", "individual_holdings"."register_party_id") = 1);