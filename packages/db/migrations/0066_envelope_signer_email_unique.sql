-- One address, one signer on one envelope (CTR-013's #391 addendum).
-- The table was unique on `(envelope_id, signing_order)` and on nothing
-- else, so the position was protected and the person was not.
--
-- No install should have a row that violates this. The send route has
-- refused a repeated address since the day it shipped ("Each signer
-- needs their own email address", #246), in the same commit that
-- created the table, and it is the only writer — the erasure path
-- deletes signer rows and never adds one. So this index is a backstop
-- for a rule the write path already keeps, which is the shape every
-- other constraint in this schema takes.
--
-- The guard below is here for the same reason 0060's second one is: a
-- clash cannot happen, and if one somehow has, the raw index build
-- would fail with nothing said about which rows collided. This is the
-- one place that knows how to say it. A refusal is the right answer
-- here where it was the wrong one for a duplicate group name in 0065 —
-- there the migration knew what an Administrator would have done, and
-- here it does not. Deleting one of two signer rows would make the
-- record say the sender asked one person when they asked two, and an
-- envelope's signer list is the record of what went to the provider.
-- An operator settles that, not a migration.
--
-- The file opens its own transaction (TECH-006's 2026-08-21 addendum),
-- so the guard and the index are one act on every upgrade path — an
-- install crossing 0054's literal `COMMIT;` on the way here arrives in
-- autocommit.
COMMIT;--> statement-breakpoint
BEGIN;--> statement-breakpoint

DO $$
DECLARE
  clashing text;
BEGIN
  -- Ordered so a refusal reads the same on every attempt.
  SELECT string_agg(
           format('envelope %s: %s', "envelope_id", "address"),
           '; ' ORDER BY "envelope_id", "address"
         )
    INTO clashing
    FROM (
      SELECT "envelope_id", lower("email") AS "address"
        FROM "contract_envelope_signers"
       GROUP BY "envelope_id", lower("email")
      HAVING count(*) > 1
    ) AS duplicates;
  IF clashing IS NOT NULL THEN
    RAISE EXCEPTION
      'One address is on the same envelope twice: %. An envelope''s signer '
      'list is the record of who was asked, so this migration will not pick '
      'which row to drop. Delete the duplicate contract_envelope_signers '
      'rows you do not want kept, then run this migration again.', clashing;
  END IF;
END $$;--> statement-breakpoint

CREATE UNIQUE INDEX "contract_envelope_signers_email_idx" ON "contract_envelope_signers" USING btree ("envelope_id",lower("email"));--> statement-breakpoint

-- Closes the transaction the BEGIN above opened, on 0060's pattern.
COMMIT;
