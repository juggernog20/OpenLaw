-- Default Fields (SET-004, Start blank addendum). The taxonomy tables
-- carry `is_system_default` through the shared helper; `fields` did not.
-- The column arrives false everywhere, then the three CTR-008 core
-- fields seeded by 0010 are marked. Start blank keeps default Fields by
-- this flag, so a later seed migration that adds a Field is covered
-- without a code change.
--
-- Two statements that must land together: a column with the flag on
-- nothing would let Start blank remove the core fields. So this file
-- opens its own transaction rather than inheriting one (TECH-006
-- addendum, 2026-08-21); 0060 is the worked example.
COMMIT;--> statement-breakpoint
BEGIN;--> statement-breakpoint

ALTER TABLE "fields" ADD COLUMN "is_system_default" boolean DEFAULT false NOT NULL;--> statement-breakpoint

-- Only the three 0010 seeds. The 0143 intake rows carry `built_in_key`
-- and are protected by that column, not by this flag.
UPDATE "fields" SET "is_system_default" = true
WHERE "slug" IN ('governing_law', 'jurisdiction', 'our_position');--> statement-breakpoint

-- Closes the transaction the BEGIN above opened.
COMMIT;
