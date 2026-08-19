-- Renames the seeded `redlining` status to "With counterparty" (#325).
--
-- A display name only: `0009` seeded the label as "Redlining with
-- counterparty", which names the act rather than where the contract is.
-- A status says where the contract sits, so the label says who holds it.
-- The id, the slug, the stage, and the order do not move, so nothing that
-- points at this status notices — the pill reads as the team says it and
-- every branch still reads `review`.
--
-- Guarded on the old text. An install that has already renamed this row
-- keeps its own name — a correction to a seed may not overwrite a
-- decision somebody made — and the guard makes the statement safe to
-- re-run.
UPDATE "contract_statuses"
SET "display_name" = 'With counterparty', "updated_at" = now()
WHERE "slug" = 'redlining' AND "display_name" = 'Redlining with counterparty';
