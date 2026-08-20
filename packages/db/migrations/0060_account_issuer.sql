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
--
-- The transaction is opened here rather than taken on trust. Drizzle
-- does wrap a batch of migrations in one, but 0054 opens with a literal
-- `COMMIT;` so its CONCURRENTLY statements can run — and an install
-- upgrading from a release before 0054 crosses it on the way to this
-- file, arriving with no transaction open at all. In autocommit the
-- ALTER above the refusal would already be committed when the refusal
-- fired: the column would sit half-filled, and re-running the upgrade
-- after the fix would die on the duplicate column. The COMMIT closes
-- whichever transaction is open (drizzle's own, empty at this point, or
-- none — a warning, not an error), and the BEGIN makes this migration
-- one transaction on every path. Migrations that ran earlier in the
-- same batch stay applied either way; each records its journal row as
-- it goes, so the journal stays truthful about them.
COMMIT;--> statement-breakpoint
BEGIN;--> statement-breakpoint

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
  -- Ordered so a refusal reads the same on every attempt. Without it the
  -- list follows whatever order the scan returned, and an operator
  -- comparing the message across two upgrade runs would see it move.
  SELECT string_agg(
           format('(%s, %s)', "issuer", "account_id"),
           '; ' ORDER BY "issuer", "account_id"
         )
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
CREATE UNIQUE INDEX "accounts_issuer_account_unique" ON "accounts" USING btree ("issuer","account_id");--> statement-breakpoint

-- Closes the transaction the BEGIN above opened. Drizzle's own commit
-- lands after its journal insert; on the crossed-0054 path that pair is
-- autocommit and a warning, which is already how every batch containing
-- 0054 ends today.
COMMIT;
