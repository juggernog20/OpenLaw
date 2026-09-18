CREATE TABLE "entity_share_certificates" (
	"id" text PRIMARY KEY NOT NULL,
	"entity_id" text NOT NULL,
	"number" text NOT NULL,
	"holder_id" text NOT NULL,
	"share_class_id" text NOT NULL,
	"quantity" bigint NOT NULL,
	"distinctive_numbers" text,
	"issued_by_entry_id" text NOT NULL,
	"cancelled_by_entry_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "entity_share_certificates_number_length" CHECK (length(trim("entity_share_certificates"."number")) between 1 and 50),
	CONSTRAINT "entity_share_certificates_quantity_positive" CHECK ("entity_share_certificates"."quantity" > 0 and "entity_share_certificates"."quantity" <= 9007199254740991),
	CONSTRAINT "entity_share_certificates_distinctive_length" CHECK ("entity_share_certificates"."distinctive_numbers" is null or length("entity_share_certificates"."distinctive_numbers") <= 200)
);
--> statement-breakpoint
CREATE TABLE "entity_share_classes" (
	"id" text PRIMARY KEY NOT NULL,
	"entity_id" text NOT NULL,
	"name" text NOT NULL,
	"authorized" bigint,
	"par_value" bigint,
	"par_value_currency" text,
	"votes_per_share" numeric(10, 4) DEFAULT '1' NOT NULL,
	"rights" text,
	"position" integer DEFAULT 0 NOT NULL,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "entity_share_classes_entity_id_id_key" UNIQUE("entity_id","id"),
	CONSTRAINT "entity_share_classes_name_length" CHECK (length(trim("entity_share_classes"."name")) between 1 and 100),
	CONSTRAINT "entity_share_classes_authorized_range" CHECK ("entity_share_classes"."authorized" is null or ("entity_share_classes"."authorized" >= 0 and "entity_share_classes"."authorized" <= 9007199254740991)),
	CONSTRAINT "entity_share_classes_par_value_range" CHECK ("entity_share_classes"."par_value" is null or ("entity_share_classes"."par_value" >= 0 and "entity_share_classes"."par_value" <= 9007199254740991)),
	CONSTRAINT "entity_share_classes_votes_range" CHECK ("entity_share_classes"."votes_per_share" >= 0),
	CONSTRAINT "entity_share_classes_rights_length" CHECK ("entity_share_classes"."rights" is null or length("entity_share_classes"."rights") <= 500)
);
--> statement-breakpoint
CREATE TABLE "entity_share_entries" (
	"id" text PRIMARY KEY NOT NULL,
	"entity_id" text NOT NULL,
	"entry_no" integer NOT NULL,
	"kind" text NOT NULL,
	"effective_on" date NOT NULL,
	"share_class_id" text NOT NULL,
	"to_share_class_id" text,
	"quantity" bigint NOT NULL,
	"from_holder_id" text,
	"to_holder_id" text,
	"price_per_share" bigint,
	"price_currency" text,
	"consideration" text,
	"distinctive_numbers" text,
	"resolution_ref" text,
	"note" text,
	"recorded_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "entity_share_entries_entity_id_id_key" UNIQUE("entity_id","id"),
	CONSTRAINT "entity_share_entries_entry_no_positive" CHECK ("entity_share_entries"."entry_no" > 0),
	CONSTRAINT "entity_share_entries_quantity_positive" CHECK ("entity_share_entries"."quantity" > 0 and "entity_share_entries"."quantity" <= 9007199254740991),
	CONSTRAINT "entity_share_entries_kind_shape" CHECK (case "entity_share_entries"."kind"
        when 'allotment' then "entity_share_entries"."from_holder_id" is null and "entity_share_entries"."to_holder_id" is not null and "entity_share_entries"."to_share_class_id" is null
        when 'transfer' then "entity_share_entries"."from_holder_id" is not null and "entity_share_entries"."to_holder_id" is not null and "entity_share_entries"."from_holder_id" <> "entity_share_entries"."to_holder_id" and "entity_share_entries"."to_share_class_id" is null
        when 'buyback' then "entity_share_entries"."from_holder_id" is not null and "entity_share_entries"."to_holder_id" is null and "entity_share_entries"."to_share_class_id" is null
        when 'cancellation' then "entity_share_entries"."to_holder_id" is null and "entity_share_entries"."to_share_class_id" is null
        when 'conversion' then "entity_share_entries"."from_holder_id" is not null and "entity_share_entries"."to_holder_id" = "entity_share_entries"."from_holder_id" and "entity_share_entries"."to_share_class_id" is not null and "entity_share_entries"."to_share_class_id" <> "entity_share_entries"."share_class_id"
        else false end),
	CONSTRAINT "entity_share_entries_price_range" CHECK ("entity_share_entries"."price_per_share" is null or ("entity_share_entries"."price_per_share" >= 0 and "entity_share_entries"."price_per_share" <= 9007199254740991)),
	CONSTRAINT "entity_share_entries_text_lengths" CHECK (("entity_share_entries"."consideration" is null or length("entity_share_entries"."consideration") <= 500)
      and ("entity_share_entries"."distinctive_numbers" is null or length("entity_share_entries"."distinctive_numbers") <= 200)
      and ("entity_share_entries"."resolution_ref" is null or length("entity_share_entries"."resolution_ref") <= 200)
      and ("entity_share_entries"."note" is null or length("entity_share_entries"."note") <= 2000))
);
--> statement-breakpoint
CREATE TABLE "entity_share_entry_counters" (
	"entity_id" text PRIMARY KEY NOT NULL,
	"last_entry_no" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "entity_share_entry_counters_non_negative" CHECK ("entity_share_entry_counters"."last_entry_no" >= 0)
);
--> statement-breakpoint
CREATE TABLE "entity_shareholders" (
	"id" text PRIMARY KEY NOT NULL,
	"entity_id" text NOT NULL,
	"kind" text NOT NULL,
	"holder_entity_id" text,
	"name" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "entity_shareholders_entity_id_id_key" UNIQUE("entity_id","id"),
	CONSTRAINT "entity_shareholders_kind_shape" CHECK (("entity_shareholders"."kind" = 'entity' and "entity_shareholders"."holder_entity_id" is not null and "entity_shareholders"."name" is null)
        or ("entity_shareholders"."kind" = 'individual' and "entity_shareholders"."holder_entity_id" is null and length(trim("entity_shareholders"."name")) between 1 and 200)),
	CONSTRAINT "entity_shareholders_not_self" CHECK ("entity_shareholders"."holder_entity_id" is null or "entity_shareholders"."holder_entity_id" <> "entity_shareholders"."entity_id")
);
--> statement-breakpoint
ALTER TABLE "entity_holdings" ADD COLUMN "source" text DEFAULT 'manual' NOT NULL;--> statement-breakpoint
ALTER TABLE "individual_holdings" ADD COLUMN "source" text DEFAULT 'manual' NOT NULL;--> statement-breakpoint
ALTER TABLE "individual_holdings" ADD COLUMN "shareholder_id" text;--> statement-breakpoint
ALTER TABLE "entity_share_certificates" ADD CONSTRAINT "entity_share_certificates_entity_id_entities_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."entities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entity_share_certificates" ADD CONSTRAINT "entity_share_certificates_holder_fk" FOREIGN KEY ("entity_id","holder_id") REFERENCES "public"."entity_shareholders"("entity_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entity_share_certificates" ADD CONSTRAINT "entity_share_certificates_class_fk" FOREIGN KEY ("entity_id","share_class_id") REFERENCES "public"."entity_share_classes"("entity_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entity_share_certificates" ADD CONSTRAINT "entity_share_certificates_issued_fk" FOREIGN KEY ("entity_id","issued_by_entry_id") REFERENCES "public"."entity_share_entries"("entity_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entity_share_certificates" ADD CONSTRAINT "entity_share_certificates_cancelled_fk" FOREIGN KEY ("entity_id","cancelled_by_entry_id") REFERENCES "public"."entity_share_entries"("entity_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entity_share_classes" ADD CONSTRAINT "entity_share_classes_entity_id_entities_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."entities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entity_share_entries" ADD CONSTRAINT "entity_share_entries_entity_id_entities_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."entities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entity_share_entries" ADD CONSTRAINT "entity_share_entries_recorded_by_users_id_fk" FOREIGN KEY ("recorded_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entity_share_entries" ADD CONSTRAINT "entity_share_entries_class_fk" FOREIGN KEY ("entity_id","share_class_id") REFERENCES "public"."entity_share_classes"("entity_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entity_share_entries" ADD CONSTRAINT "entity_share_entries_to_class_fk" FOREIGN KEY ("entity_id","to_share_class_id") REFERENCES "public"."entity_share_classes"("entity_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entity_share_entries" ADD CONSTRAINT "entity_share_entries_from_holder_fk" FOREIGN KEY ("entity_id","from_holder_id") REFERENCES "public"."entity_shareholders"("entity_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entity_share_entries" ADD CONSTRAINT "entity_share_entries_to_holder_fk" FOREIGN KEY ("entity_id","to_holder_id") REFERENCES "public"."entity_shareholders"("entity_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entity_share_entry_counters" ADD CONSTRAINT "entity_share_entry_counters_entity_id_entities_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."entities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entity_shareholders" ADD CONSTRAINT "entity_shareholders_entity_id_entities_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."entities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entity_shareholders" ADD CONSTRAINT "entity_shareholders_holder_entity_id_entities_id_fk" FOREIGN KEY ("holder_entity_id") REFERENCES "public"."entities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "entity_share_certificates_entity_number_idx" ON "entity_share_certificates" USING btree ("entity_id","number");--> statement-breakpoint
CREATE INDEX "entity_share_certificates_issued_idx" ON "entity_share_certificates" USING btree ("issued_by_entry_id");--> statement-breakpoint
CREATE INDEX "entity_share_certificates_cancelled_idx" ON "entity_share_certificates" USING btree ("cancelled_by_entry_id");--> statement-breakpoint
CREATE INDEX "entity_share_classes_entity_idx" ON "entity_share_classes" USING btree ("entity_id");--> statement-breakpoint
CREATE UNIQUE INDEX "entity_share_classes_live_name_idx" ON "entity_share_classes" USING btree ("entity_id",lower("name")) WHERE "entity_share_classes"."archived_at" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "entity_share_entries_entity_no_idx" ON "entity_share_entries" USING btree ("entity_id","entry_no");--> statement-breakpoint
CREATE INDEX "entity_share_entries_entity_date_idx" ON "entity_share_entries" USING btree ("entity_id","effective_on");--> statement-breakpoint
CREATE INDEX "entity_shareholders_entity_idx" ON "entity_shareholders" USING btree ("entity_id");--> statement-breakpoint
CREATE UNIQUE INDEX "entity_shareholders_entity_holder_idx" ON "entity_shareholders" USING btree ("entity_id","holder_entity_id") WHERE "entity_shareholders"."kind" = 'entity';--> statement-breakpoint
ALTER TABLE "individual_holdings" ADD CONSTRAINT "individual_holdings_shareholder_id_entity_shareholders_id_fk" FOREIGN KEY ("shareholder_id") REFERENCES "public"."entity_shareholders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "individual_holdings_shareholder_idx" ON "individual_holdings" USING btree ("shareholder_id") WHERE "individual_holdings"."shareholder_id" is not null;--> statement-breakpoint
ALTER TABLE "entity_holdings" ADD CONSTRAINT "entity_holdings_source_known" CHECK ("entity_holdings"."source" in ('manual', 'register'));--> statement-breakpoint
ALTER TABLE "individual_holdings" ADD CONSTRAINT "individual_holdings_source_known" CHECK ("individual_holdings"."source" in ('manual', 'register'));--> statement-breakpoint
ALTER TABLE "individual_holdings" ADD CONSTRAINT "individual_holdings_source_shape" CHECK (("individual_holdings"."source" = 'register') = ("individual_holdings"."shareholder_id" is not null));