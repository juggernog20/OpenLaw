-- ENT-012: the share register is the one source of a Holding. The rows a
-- person typed go first, while `source` can still name them; the column and
-- its checks go after. A register row always carries its holder, so
-- `shareholder_id` is required from here on.
DELETE FROM "individual_holdings" WHERE "source" = 'manual';--> statement-breakpoint
DELETE FROM "entity_holdings" WHERE "source" = 'manual';--> statement-breakpoint
ALTER TABLE "entity_holdings" DROP CONSTRAINT "entity_holdings_source_known";--> statement-breakpoint
ALTER TABLE "individual_holdings" DROP CONSTRAINT "individual_holdings_source_known";--> statement-breakpoint
ALTER TABLE "individual_holdings" DROP CONSTRAINT "individual_holdings_source_shape";--> statement-breakpoint
DROP INDEX "individual_holdings_shareholder_idx";--> statement-breakpoint
ALTER TABLE "individual_holdings" ALTER COLUMN "shareholder_id" SET NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "individual_holdings_shareholder_idx" ON "individual_holdings" USING btree ("shareholder_id");--> statement-breakpoint
ALTER TABLE "entity_holdings" DROP COLUMN "source";--> statement-breakpoint
ALTER TABLE "individual_holdings" DROP COLUMN "source";