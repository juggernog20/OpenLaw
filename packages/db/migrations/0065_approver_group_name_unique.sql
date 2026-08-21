-- Two live approver groups may not share a name (CTR-012's #391
-- addendum). The name is the only identity the table has — no slug, no
-- display order — so two "Commercial sign-off" rows are two
-- indistinguishable entries in the apply picker.
--
-- Nothing stopped them until now, so an install really can have them.
-- This is the difference between this file and 0060: an unresolvable
-- account left nobody able to sign in, and refusing the upgrade was the
-- safe answer. A duplicate group name is a cosmetic clash between two
-- rows that both work, and stopping a self-hoster's upgrade over one
-- would be the worse answer. So the clash is resolved rather than
-- refused.
--
-- The rule is the one an Administrator would apply by hand. Within a
-- set of live rows that read as the same name, the **oldest keeps it**
-- — that is the row the picker's entries were most likely chosen from —
-- and every later one takes the first free " (2)", " (3)" … suffix.
-- Ordering is `(created_at, id)`, so the outcome is the same on every
-- install and on a re-run.
--
-- **A rename here has no blast radius beyond the picker's label.**
-- Applying a group snapshots its members into the approval requests at
-- apply time (CTR-012), so no request that already exists reads this
-- column. What the rename does not do is write an activity entry:
-- DD-017 covers settings mutations made by a person, and this one has
-- no actor. The NOTICE below is the record instead, and it lands in the
-- container-start log where the operator is already watching the
-- upgrade.
--
-- The suffix can push a name past the 100 characters the API accepts.
-- Such a row still reads and still applies; renaming it through
-- Settings needs a shorter name first. Truncating on the operator's
-- behalf would lose the end of a name nobody asked us to edit.
--
-- The file opens its own transaction (TECH-006's 2026-08-21 addendum):
-- the rename and the index must land together, and an install crossing
-- 0054's literal `COMMIT;` on the way here arrives in autocommit, where
-- a failed index build would leave the renames applied on their own.
COMMIT;--> statement-breakpoint
BEGIN;--> statement-breakpoint

DO $$
DECLARE
  clash record;
  candidate text;
  suffix int;
  renames text[] := '{}';
BEGIN
  FOR clash IN
    SELECT id, name
      FROM (
        SELECT id,
               name,
               created_at,
               row_number() OVER (
                 PARTITION BY lower(name) ORDER BY created_at, id
               ) AS duplicate_rank
          FROM "approver_groups"
         WHERE archived_at IS NULL
      ) AS ranked
     WHERE duplicate_rank > 1
     -- Ordered so a re-run and a second install report the same list.
     ORDER BY lower(name), created_at, id
  LOOP
    -- The first free suffix, asked of the table as it stands: an
    -- earlier iteration may already have taken " (2)", and a live row
    -- may have been called "Commercial sign-off (2)" all along.
    suffix := 2;
    LOOP
      candidate := clash.name || ' (' || suffix::text || ')';
      EXIT WHEN NOT EXISTS (
        SELECT 1
          FROM "approver_groups"
         WHERE archived_at IS NULL
           AND lower(name) = lower(candidate)
      );
      suffix := suffix + 1;
    END LOOP;

    UPDATE "approver_groups" SET name = candidate WHERE id = clash.id;
    renames := renames || format('%L -> %L', clash.name, candidate);
  END LOOP;

  IF array_length(renames, 1) IS NOT NULL THEN
    RAISE NOTICE
      'Renamed % approver group(s) so that no two live groups share a name: %. '
      'The oldest group kept its name. Rename any of them in Settings -> '
      'Contracts -> Approver groups.',
      array_length(renames, 1), array_to_string(renames, '; ');
  END IF;
END $$;--> statement-breakpoint

CREATE UNIQUE INDEX "approver_groups_name_idx" ON "approver_groups" USING btree (lower("name")) WHERE "approver_groups"."archived_at" is null;--> statement-breakpoint

-- Closes the transaction the BEGIN above opened, on 0060's pattern.
COMMIT;
