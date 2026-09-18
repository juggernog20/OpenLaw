ALTER TABLE "entity_holdings" ADD COLUMN "source" text DEFAULT 'manual' NOT NULL;--> statement-breakpoint
ALTER TABLE "individual_holdings" ADD COLUMN "source" text DEFAULT 'manual' NOT NULL;--> statement-breakpoint
ALTER TABLE "individual_holdings" ADD COLUMN "shareholder_id" text;--> statement-breakpoint
ALTER TABLE "individual_holdings" ADD CONSTRAINT "individual_holdings_shareholder_id_entity_shareholders_id_fk" FOREIGN KEY ("shareholder_id") REFERENCES "public"."entity_shareholders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "individual_holdings_shareholder_idx" ON "individual_holdings" USING btree ("shareholder_id") WHERE "individual_holdings"."shareholder_id" is not null;--> statement-breakpoint
ALTER TABLE "entity_holdings" ADD CONSTRAINT "entity_holdings_source_known" CHECK ("entity_holdings"."source" in ('manual', 'register'));--> statement-breakpoint
ALTER TABLE "individual_holdings" ADD CONSTRAINT "individual_holdings_source_known" CHECK ("individual_holdings"."source" in ('manual', 'register'));--> statement-breakpoint
ALTER TABLE "individual_holdings" ADD CONSTRAINT "individual_holdings_source_shape" CHECK (("individual_holdings"."source" = 'register') = ("individual_holdings"."shareholder_id" is not null));