-- better-auth 1.7 identifies an account by (issuer, account_id) rather
-- than by its provider id. The column is required, and the library's own
-- credential lookups filter on it, so every existing row has to carry a
-- truthful value before the constraint goes on. Add it nullable, fill it,
-- refuse to continue if anything is left unresolved, then make it real.
--
-- Nothing here is best-effort on purpose. Migrations run on container
-- start (TECH-005), so a failure stops the upgrade with the old image's
-- data intact. A half-filled column would instead start an install whose
-- users cannot sign in and whose next SSO sign-in writes a second,
-- conflicting identity.
--
-- The index is built plainly rather than CONCURRENTLY, and the column is
-- set NOT NULL in the same breath, because both have to be inside this
-- transaction. CREATE INDEX CONCURRENTLY cannot be, and taking it out
-- would trade the property that makes a refusal safe — the whole thing
-- rolls back, so a stopped upgrade leaves the previous release's schema
-- untouched — for a lock this table does not feel. `accounts` holds one
-- row per person plus one per IdP link; the scan and the exclusive lock
-- are milliseconds on any install this product is deployed to.
ALTER TABLE "accounts" ADD COLUMN "issuer" text;--> statement-breakpoint

-- A password row. The synthetic issuer better-auth builds for a method
-- that has none of its own is `local:` plus the provider id; it is the
-- literal `findCredentialAccount` and `updatePassword` filter on, and it
-- is mirrored by CREDENTIAL_ISSUER in apps/api/src/auth/instance.ts.
UPDATE "accounts" SET "issuer" = 'local:credential' WHERE "provider_id" = 'credential';--> statement-breakpoint

-- An OIDC row. Its issuer is the IdP's own, which is what a verified
-- id_token's `iss` claim carries and what the provider registration
-- stored. Only generic OIDC providers exist here: the SSO plugin writes
-- provider_id = sso_providers.provider_id and account_id = the subject.
UPDATE "accounts" AS a
SET "issuer" = p."issuer"
FROM "sso_providers" AS p
WHERE a."provider_id" = p."provider_id" AND a."issuer" IS NULL;--> statement-breakpoint

-- Anything still unresolved is an account this migration cannot speak
-- for: a provider row deleted while its accounts survived, or a provider
-- id no release of this app ever wrote. Stop, and say which.
DO $$
DECLARE
  stranded text;
BEGIN
  SELECT string_agg(DISTINCT "provider_id", ', ' ORDER BY "provider_id")
    INTO stranded
    FROM "accounts"
   WHERE "issuer" IS NULL;
  IF stranded IS NOT NULL THEN
    RAISE EXCEPTION
      'Cannot resolve an issuer for accounts under provider(s): %. '
      'Every account needs one before better-auth 1.7 can identify it. '
      'Re-register the missing SSO provider, or delete the orphaned '
      'account rows, then run this migration again.', stranded;
  END IF;
END $$;--> statement-breakpoint

-- The pair better-auth looks an account up by must not name two of them.
-- It cannot here — (provider_id, account_id) is already unique and each
-- provider id maps to one issuer — but the index below would fail with
-- nothing said about which rows collided, and this is the one place that
-- knows how to say it.
DO $$
DECLARE
  clashing text;
BEGIN
  SELECT string_agg(format('(%s, %s)', "issuer", "account_id"), '; ')
    INTO clashing
    FROM (
      SELECT "issuer", "account_id"
        FROM "accounts"
       GROUP BY "issuer", "account_id"
      HAVING count(*) > 1
    ) AS duplicates;
  IF clashing IS NOT NULL THEN
    RAISE EXCEPTION
      'Two accounts share one 1.7 identity: %. Merge or delete the '
      'duplicates before upgrading — better-auth cannot tell them '
      'apart.', clashing;
  END IF;
END $$;--> statement-breakpoint

ALTER TABLE "accounts" ALTER COLUMN "issuer" SET NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "accounts_issuer_account_unique" ON "accounts" USING btree ("issuer","account_id");
