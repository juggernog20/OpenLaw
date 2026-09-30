CREATE TABLE "entity_register_entry_counters" (
	"entity_id" text NOT NULL,
	"register" text NOT NULL,
	"last_entry_no" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "entity_register_entry_counters_entity_id_register_pk" PRIMARY KEY("entity_id","register"),
	CONSTRAINT "entity_register_entry_counters_register_check" CHECK ("entity_register_entry_counters"."register" in ('trust', 'partnership')),
	CONSTRAINT "entity_register_entry_counters_nonnegative" CHECK ("entity_register_entry_counters"."last_entry_no" >= 0)
);
--> statement-breakpoint
CREATE TABLE "entity_register_parties" (
	"id" text PRIMARY KEY NOT NULL,
	"entity_id" text NOT NULL,
	"kind" text NOT NULL,
	"party_entity_id" text,
	"name" text,
	"description" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "entity_register_parties_entity_id_id_key" UNIQUE("entity_id","id"),
	CONSTRAINT "entity_register_parties_kind_shape" CHECK (case "entity_register_parties"."kind"
    when 'entity' then "entity_register_parties"."party_entity_id" is not null and "entity_register_parties"."name" is null and "entity_register_parties"."description" is null
    when 'individual' then "entity_register_parties"."party_entity_id" is null and "entity_register_parties"."name" is not null and length(trim("entity_register_parties"."name")) between 1 and 200 and "entity_register_parties"."description" is null
    when 'class' then "entity_register_parties"."party_entity_id" is null and "entity_register_parties"."name" is null and "entity_register_parties"."description" is not null and length(trim("entity_register_parties"."description")) between 1 and 2000
    else false end)
);
--> statement-breakpoint
CREATE TABLE "entity_trust_entries" (
	"id" text PRIMARY KEY NOT NULL,
	"entity_id" text NOT NULL,
	"entry_no" integer NOT NULL,
	"kind" text NOT NULL,
	"effective_on" date NOT NULL,
	"party_id" text NOT NULL,
	"role" text,
	"role_label" text,
	"interest" text,
	"amount" bigint,
	"currency" text,
	"property" text,
	"reference" text,
	"note" text,
	"recorded_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "entity_trust_entries_entity_id_id_key" UNIQUE("entity_id","id"),
	CONSTRAINT "entity_trust_entries_entry_no_positive" CHECK ("entity_trust_entries"."entry_no" > 0),
	CONSTRAINT "entity_trust_entries_role_check" CHECK ("entity_trust_entries"."role" is null or "entity_trust_entries"."role" in ('settlor', 'trustee', 'protector', 'enforcer', 'beneficiary', 'other')),
	CONSTRAINT "entity_trust_entries_role_label" CHECK (case when "entity_trust_entries"."role" = 'other' then "entity_trust_entries"."role_label" is not null and length(trim("entity_trust_entries"."role_label")) between 1 and 200 else "entity_trust_entries"."role_label" is null end),
	CONSTRAINT "entity_trust_entries_kind_shape" CHECK (case
    when "entity_trust_entries"."kind" in ('appointment', 'cessation') then "entity_trust_entries"."role" is not null and "entity_trust_entries"."amount" is null and "entity_trust_entries"."currency" is null and "entity_trust_entries"."property" is null
    when "entity_trust_entries"."kind" in ('settlement', 'distribution') then "entity_trust_entries"."role" is null and (
      ("entity_trust_entries"."amount" is not null and "entity_trust_entries"."currency" is not null and "entity_trust_entries"."property" is null) or
      ("entity_trust_entries"."amount" is null and "entity_trust_entries"."currency" is null and "entity_trust_entries"."property" is not null and length(trim("entity_trust_entries"."property")) between 1 and 2000))
    else false end),
	CONSTRAINT "entity_trust_entries_amount_range" CHECK ("entity_trust_entries"."amount" is null or ("entity_trust_entries"."amount" > 0 and "entity_trust_entries"."amount" <= 9007199254740991)),
	CONSTRAINT "entity_trust_entries_currency_check" CHECK ("entity_trust_entries"."currency" is null or "entity_trust_entries"."currency" ~ '^[A-Z]{3}$'),
	CONSTRAINT "entity_trust_entries_text_lengths" CHECK (("entity_trust_entries"."interest" is null or length("entity_trust_entries"."interest") <= 2000) and ("entity_trust_entries"."reference" is null or length("entity_trust_entries"."reference") <= 200) and ("entity_trust_entries"."note" is null or length("entity_trust_entries"."note") <= 2000))
);
--> statement-breakpoint
ALTER TABLE "entity_register_entry_counters" ADD CONSTRAINT "entity_register_entry_counters_entity_id_entities_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."entities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entity_register_parties" ADD CONSTRAINT "entity_register_parties_entity_id_entities_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."entities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entity_register_parties" ADD CONSTRAINT "entity_register_parties_party_entity_id_entities_id_fk" FOREIGN KEY ("party_entity_id") REFERENCES "public"."entities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entity_trust_entries" ADD CONSTRAINT "entity_trust_entries_entity_id_entities_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."entities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entity_trust_entries" ADD CONSTRAINT "entity_trust_entries_recorded_by_users_id_fk" FOREIGN KEY ("recorded_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entity_trust_entries" ADD CONSTRAINT "entity_trust_entries_party_fk" FOREIGN KEY ("entity_id","party_id") REFERENCES "public"."entity_register_parties"("entity_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "entity_register_parties_entity_party_idx" ON "entity_register_parties" USING btree ("entity_id","party_entity_id") WHERE "entity_register_parties"."party_entity_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "entity_trust_entries_entity_no_idx" ON "entity_trust_entries" USING btree ("entity_id","entry_no");--> statement-breakpoint
CREATE INDEX "entity_trust_entries_entity_date_idx" ON "entity_trust_entries" USING btree ("entity_id","effective_on");