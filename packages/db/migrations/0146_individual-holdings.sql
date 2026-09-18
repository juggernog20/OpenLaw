CREATE TABLE "individual_holdings" (
	"id" text PRIMARY KEY NOT NULL,
	"owned_entity_id" text NOT NULL,
	"name" text NOT NULL,
	"ownership_percent" numeric(5, 2) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "individual_holdings_percent_range" CHECK ("individual_holdings"."ownership_percent" >= 0 and "individual_holdings"."ownership_percent" <= 100),
	CONSTRAINT "individual_holdings_name_length" CHECK (length(trim("individual_holdings"."name")) between 1 and 200)
);
--> statement-breakpoint
ALTER TABLE "individual_holdings" ADD CONSTRAINT "individual_holdings_owned_entity_id_entities_id_fk" FOREIGN KEY ("owned_entity_id") REFERENCES "public"."entities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "individual_holdings_owned_idx" ON "individual_holdings" USING btree ("owned_entity_id");