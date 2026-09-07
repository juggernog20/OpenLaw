-- SPDX-License-Identifier: AGPL-3.0-only
-- The Home branch applied Request assignment before joining dev. Its later
-- migration timestamps can skip dev's onboarding and account changes.
-- The journal guard reconciles those first. Keep any existing assignments.
ALTER TABLE "requests" ADD COLUMN IF NOT EXISTS "assignee_id" text;--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.requests'::regclass
      AND conname = 'requests_assignee_id_users_id_fk'
  ) THEN
    ALTER TABLE "requests" ADD CONSTRAINT "requests_assignee_id_users_id_fk"
      FOREIGN KEY ("assignee_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
  END IF;
END $$;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "requests_assignee_idx" ON "requests" USING btree ("assignee_id");
