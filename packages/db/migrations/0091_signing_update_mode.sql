ALTER TABLE "contract_envelopes" ADD COLUMN "next_reconcile_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "signing_connectors" ADD COLUMN "update_mode" text DEFAULT 'webhook' NOT NULL;--> statement-breakpoint
ALTER TABLE "signing_connectors" ALTER COLUMN "update_mode" SET DEFAULT 'polling';--> statement-breakpoint
ALTER TABLE "signing_connectors" ADD COLUMN "webhook_url" text;--> statement-breakpoint
ALTER TABLE "signing_connectors" ADD CONSTRAINT "signing_connectors_update_mode_check" CHECK ("signing_connectors"."update_mode" in ('polling', 'webhook')) NOT VALID;--> statement-breakpoint
ALTER TABLE "signing_connectors" VALIDATE CONSTRAINT "signing_connectors_update_mode_check";