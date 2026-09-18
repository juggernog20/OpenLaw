ALTER TABLE "requests" ADD COLUMN "intake_counterparties" jsonb DEFAULT '[]'::jsonb NOT NULL;
--> statement-breakpoint
UPDATE fields SET description = 'Search for existing counterparties or add a new name. The first selected counterparty is primary.' WHERE built_in_key = 'counterparties';
