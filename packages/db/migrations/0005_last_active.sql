ALTER TABLE "users" ADD COLUMN "last_active_at" timestamp with time zone;--> statement-breakpoint
-- Backfill from surviving sessions so an install that predates the
-- column does not show every signed-in user as "never active"; users
-- with no session history keep NULL, which is what it means.
UPDATE "users"
SET "last_active_at" = "latest"."at"
FROM (
  SELECT "user_id", max("updated_at") AS "at" FROM "sessions" GROUP BY "user_id"
) AS "latest"
WHERE "latest"."user_id" = "users"."id";
