-- Clears the required flag from `user` and `entity` fields on request
-- forms (#400, the INT-002 M20/11 addendum).
--
-- The portal draws those two controls as an empty picker on purpose: a
-- requester reads neither the staff directory nor the Entity registry
-- (DD-013, DD-016). A required one is therefore a question nobody can
-- answer, and every submission of that request type is refused forever.
-- The editor now refuses the flag by name, so no new row can reach this
-- state — this statement clears the rows an install could already hold,
-- because a rule that is not true of the data is not a rule.
--
-- The field stays attached and the form keeps collecting it. Only the
-- requirement goes, which is the one part nobody could satisfy.
--
-- Request forms only. Staff pick a user or an entity from a list that
-- has rows, so `contract_type_fields` and `matter_type_fields` are not
-- touched.
UPDATE "request_type_fields"
SET "is_required" = false
WHERE "is_required"
  AND "field_id" IN (
    SELECT "id" FROM "fields" WHERE "field_type" IN ('user', 'entity')
  );
