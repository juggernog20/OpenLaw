-- SPDX-License-Identifier: AGPL-3.0-only
-- Preserve groups already configured on the former UX branch.
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'matter_statuses'
      AND column_name = 'progression_group'
  ) THEN
    ALTER TABLE "matter_statuses" ADD COLUMN "progression_group" text DEFAULT 'in_progress' NOT NULL;
    UPDATE "matter_statuses" SET "progression_group" = CASE
      WHEN "slug" IN ('open', 'on_hold') THEN 'open'
      WHEN "slug" ~ '^(with_|awaiting_|waiting_)' THEN 'waiting'
      ELSE 'in_progress'
    END;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.matter_statuses'::regclass
      AND conname = 'matter_statuses_progression_group_check'
  ) THEN
    ALTER TABLE "matter_statuses" ADD CONSTRAINT "matter_statuses_progression_group_check"
      CHECK ("progression_group" in ('open', 'in_progress', 'waiting'));
  END IF;
END $$;--> statement-breakpoint
ALTER TABLE "document_versions" DROP CONSTRAINT "document_versions_kind_check";--> statement-breakpoint
ALTER TABLE "document_versions" ADD CONSTRAINT "document_versions_kind_check"
  CHECK ("kind" in ('general', 'draft_ours', 'draft_theirs', 'redline_theirs', 'redline_ours', 'executed', 'amendment', 'generated_redline'));
