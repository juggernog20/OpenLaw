-- SPDX-License-Identifier: AGPL-3.0-only

-- DD-021's two Portal access mechanisms: a nullable Business Owner on
-- the contract, and an explicit stakeholder link beside it. The backfill
-- seeds the Business Owner from the Requester whose Request converted
-- into the contract; a directly created contract stays unassigned.
--
-- **Every statement here is idempotent, and none of them leaves this
-- migration's transaction.** Drizzle runs all pending migrations and
-- their journal rows inside one transaction, so a `COMMIT` in the middle
-- of a file ends that transaction early: the DDL before it lands with no
-- journal row behind it, and the next boot re-runs the file from the top
-- and fails on `CREATE TABLE`. The upgrade then cannot proceed without
-- hand-written SQL — the failure mode `migration-journal.ts` exists to
-- keep out of an operator's way. An interrupted run must roll back
-- whole, so nothing here commits and everything here can be re-run.
--
-- The guards are not only for this file's own retries. An install
-- stranded by the earlier shipped revision — which did commit early —
-- boots into this one holding some of these objects already, including
-- a constraint left `NOT VALID` and possibly an invalid index from a
-- concurrent build that never finished. Each step below heals that
-- state rather than tripping over it.
--
-- The indexes are plain `CREATE INDEX`, as 0080 and 0089 settled:
-- TECH-005 runs migrations on container start, before the API accepts a
-- request, so nothing is writing while they build and `CONCURRENTLY`
-- would buy nothing — while costing the atomicity above, because a
-- concurrent build cannot run inside a transaction.

CREATE TABLE IF NOT EXISTS "contract_stakeholders" (
	"contract_id" text NOT NULL,
	"user_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "contract_stakeholders_pkey" PRIMARY KEY("contract_id","user_id")
);
--> statement-breakpoint
ALTER TABLE "contracts" ADD COLUMN IF NOT EXISTS "business_owner_id" text;--> statement-breakpoint
-- PostgreSQL has no `ADD CONSTRAINT IF NOT EXISTS`, so each one asks
-- `pg_constraint` for itself first.
DO $$
BEGIN
	IF NOT EXISTS (
		SELECT 1 FROM pg_constraint
		WHERE conrelid = 'public.contract_stakeholders'::regclass
			AND conname = 'contract_stakeholders_contract_id_contracts_id_fk'
	) THEN
		ALTER TABLE "contract_stakeholders" ADD CONSTRAINT "contract_stakeholders_contract_id_contracts_id_fk" FOREIGN KEY ("contract_id") REFERENCES "public"."contracts"("id") ON DELETE cascade ON UPDATE no action;
	END IF;
	IF NOT EXISTS (
		SELECT 1 FROM pg_constraint
		WHERE conrelid = 'public.contract_stakeholders'::regclass
			AND conname = 'contract_stakeholders_user_id_users_id_fk'
	) THEN
		ALTER TABLE "contract_stakeholders" ADD CONSTRAINT "contract_stakeholders_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
	END IF;
	IF NOT EXISTS (
		SELECT 1 FROM pg_constraint
		WHERE conrelid = 'public.contracts'::regclass
			AND conname = 'contracts_business_owner_id_users_id_fk'
	) THEN
		ALTER TABLE "contracts" ADD CONSTRAINT "contracts_business_owner_id_users_id_fk" FOREIGN KEY ("business_owner_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action NOT VALID;
	END IF;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "contract_stakeholders_user_idx" ON "contract_stakeholders" USING btree ("user_id");--> statement-breakpoint
-- The Requester of the Request that became this contract, for the
-- contracts that converted before DD-021. `IS NULL` keeps it from
-- overwriting an owner a person has since set, so a re-run after a
-- stranded upgrade seeds only what is still unseeded.
UPDATE "contracts" SET "business_owner_id" = "requests"."requester_id"
FROM "requests" WHERE "requests"."converted_contract_id" = "contracts"."id"
AND "contracts"."business_owner_id" IS NULL;
--> statement-breakpoint
-- Runs whether the constraint was added above or found already there:
-- validating a valid constraint is a no-op, and one left `NOT VALID` by
-- the stranded earlier revision is what this heals.
ALTER TABLE "contracts" VALIDATE CONSTRAINT "contracts_business_owner_id_users_id_fk";
--> statement-breakpoint
-- A concurrent build that failed under the earlier revision leaves an
-- index that exists and can never be used. `IF NOT EXISTS` below would
-- see the name and skip it for ever, so the dead one goes first.
DO $$
BEGIN
	IF EXISTS (
		SELECT 1 FROM pg_class c
		JOIN pg_namespace n ON n.oid = c.relnamespace
		JOIN pg_index i ON i.indexrelid = c.oid
		WHERE n.nspname = 'public'
			AND c.relname = 'contracts_business_owner_idx'
			AND NOT i.indisvalid
	) THEN
		DROP INDEX "public"."contracts_business_owner_idx";
	END IF;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "contracts_business_owner_idx" ON "contracts" USING btree ("business_owner_id");
