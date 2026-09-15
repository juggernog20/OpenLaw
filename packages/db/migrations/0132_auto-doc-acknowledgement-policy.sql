-- SPDX-License-Identifier: AGPL-3.0-only

BEGIN;--> statement-breakpoint
ALTER TABLE "auto_docs" DROP CONSTRAINT "auto_docs_acknowledgement_frequency_check";--> statement-breakpoint
ALTER TABLE "org_settings" ADD COLUMN "auto_doc_acknowledgement_frequency" text DEFAULT 'once_per_auto_doc' NOT NULL;--> statement-breakpoint
ALTER TABLE "auto_docs" DROP COLUMN "acknowledgement_frequency";--> statement-breakpoint
ALTER TABLE "org_settings" ADD CONSTRAINT "org_settings_auto_doc_acknowledgement_frequency_check" CHECK ("org_settings"."auto_doc_acknowledgement_frequency" in ('none', 'every_use', 'once_per_auto_doc', 'once'));
--> statement-breakpoint
COMMIT;
