-- The seeded Legal question description told a Business User that "no
-- record is created up front", but every question gets a Request (#1302).
-- The Portal home prints this text under the type name. Change it only
-- while it still equals the 0057 text, so an Administrator's own edit stays.
UPDATE "request_types" SET "description" = 'Ask Legal a one-off question. You get a request number, and Legal replies on the request.' WHERE "slug" = 'legal_question' AND "description" = 'One-off question — no record is created up front.';
