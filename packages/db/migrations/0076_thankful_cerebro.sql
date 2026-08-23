-- MTR-007 is nullable by design: adding this column changes no existing
-- Contract and does not rewrite the table; every existing row remains
-- standalone. The foreign key is installed NOT VALID first so the
-- existing-table check takes the lighter validation lock in its own
-- statement. Migrations run before readiness, so the plain index build
-- keeps the whole change transactional and safely retryable.
ALTER TABLE "contracts" ADD COLUMN "matter_id" text;--> statement-breakpoint
ALTER TABLE "contracts" ADD CONSTRAINT "contracts_matter_id_matters_id_fk" FOREIGN KEY ("matter_id") REFERENCES "public"."matters"("id") ON DELETE no action ON UPDATE no action NOT VALID;--> statement-breakpoint
CREATE INDEX "contracts_matter_idx" ON "contracts" USING btree ("matter_id");--> statement-breakpoint
ALTER TABLE "contracts" VALIDATE CONSTRAINT "contracts_matter_id_matters_id_fk";
