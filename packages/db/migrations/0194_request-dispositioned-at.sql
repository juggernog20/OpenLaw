-- SPDX-License-Identifier: AGPL-3.0-only
-- INT-007: a Request records when Convert, Resolve or Decline closed it.
ALTER TABLE "requests" ADD COLUMN "dispositioned_at" timestamp with time zone;--> statement-breakpoint
-- The close time already exists as the earliest disposition Activity entry,
-- the same lookup the staff detail uses for "Converted by". A closed Request
-- with no entry takes updated_at, so the check below holds for every row.
UPDATE "requests" r SET "dispositioned_at" = coalesce(
  (
    SELECT min(a."created_at") FROM "activity_log" a
    WHERE a."entity_type" = 'request'
      AND a."entity_id" = r."id"
      AND a."action" IN ('request.converted', 'request.resolved', 'request.declined')
  ),
  r."updated_at"
)
WHERE r."status" IN ('converted', 'resolved', 'declined');--> statement-breakpoint
ALTER TABLE "requests" ADD CONSTRAINT "requests_dispositioned_at_check" CHECK (("requests"."status" in ('converted', 'resolved', 'declined')) = ("requests"."dispositioned_at" is not null));
