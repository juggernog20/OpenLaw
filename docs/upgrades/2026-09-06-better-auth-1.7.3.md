# better-auth 1.7.2 → 1.7.3 — upgrade spec

**Status:** approved and built (go given 2026-09-06); the PR carrying it is
the one this file arrives in. Classified **Breaking (medium effort)** on the
routine-sweep rubric — it needs a schema migration and touches the
credential/SSO path, so it is not a drop-in bump — but it is the light end
of medium: one PR, three work items that land together.

The precedent is #340, the 1.6 → 1.7 spec. This is that change's mirror
image: upstream has un-shipped the account-identity scoping that #340
shipped, and this spec takes the reversal.

## 1. What upstream did

Routine dependency check (2026-09-06) found three outdated packages, all one
coordinated release, and `1.7.3` is the current `latest` tag:

| Package                        | Current | Latest |
| ------------------------------ | ------- | ------ |
| `better-auth`                  | 1.7.2   | 1.7.3  |
| `@better-auth/sso`             | 1.7.2   | 1.7.3  |
| `@better-auth/drizzle-adapter` | 1.7.2   | 1.7.3  |

By version number it reads as a patch. It is not. From the v1.7.3 release
notes and PR better-auth/better-auth#11153 ("Restored 1.6 account schema
compatibility"), verified against a diff of the published `1.7.2` and
`1.7.3` tarballs:

- **The `issuer` column is gone from the account schema.** Account identity
  reverts to `(providerId, accountId)`, "as in 1.6". `linkAccount`,
  `findAccountByKey`, `findAccountOwnerByKey`, `findCredentialAccount` and
  `updatePassword` all filter on `providerId` again and never write
  `issuer`. The sso plugin stops persisting the issuer into the account
  key (it still verifies it during sign-in). `account.identityStrategy`
  is removed (we never set it).
- **A duplicate `(providerId, accountId)` is now a hard error** rather than
  an arbitrary pick: lookups use `limit: 2` and throw "Multiple accounts
  match the same accountId for provider …".
- **Schema validation runs at initialisation by default, in every
  environment** (#11178, #11179). The Drizzle adapter introspects the
  schema object we pass it and compares it with the tables better-auth
  writes. A mismatch is logged at boot and **thrown on every auth request**
  until fixed. Opt-out is `advanced.database.validateSchema: false`.
- Upstream's stated reason: "restored the 1.6 account core schema to avoid
  requiring a disruptive backfill for existing users", with a commitment to
  keep the core schema stable across v1.

Upstream's cleanup instruction for anyone who applied the 1.7.0–1.7.2
schema (1.7 upgrade guide, Postgres): drop the `(issuer, accountId)` unique
index and relax `issuer`'s NOT NULL; skipping it means "sign-ups fail because
the NOT NULL constraint rejects new accounts".

Other 1.7.3 changes that touch code we run, none needing action: TOTP
re-enrolment no longer replaces an active authenticator (#11037); trusted
-origin parsing hardened against control characters (our
`withTrustedIssuerOrigin` and async `trustedOrigins` are unaffected);
`getSession` with cookie caching disabled (we do not disable it);
`isPasswordCompromised` / Have I Been Pwned (an outbound call to a third
party; not enabling). Not used by us at all: generic-oauth, Cloudflare
provider, Nuxt/Vue/Expo clients, `@better-auth/test-utils`.

## 2. What it does to OpenLaw as it stands

Bumping the three packages on `dev` and building:

```
apps/api:build: src/auth/instance.ts(642,5): error TS2353: Object literal may
only specify known properties, and 'issuer' does not exist in type '...'
```

Running 1.7.3's own Drizzle schema check against `packages/db`'s schema
object, exactly as the adapter does at boot (probe run in this sandbox,
`usePlural: true`, all six tables better-auth writes — `users`, `sessions`,
`accounts`, `verifications`, `ssoProviders`, `twoFactors`):

```
findings: 1
 - Column "issuer" on table "accounts" is required but Better Auth never
   writes it, so every insert into "accounts" fails.
```

So `accounts.issuer` is the whole blast radius on the schema side. Every
other column of every better-auth table already satisfies the new check.

What we built on the 1.7 issuer, and what happens to each:

| Where                                                    | What it does today                                                                              | Under 1.7.3                                                                                                                                                        |
| -------------------------------------------------------- | ----------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `packages/db/src/schema/auth.ts` `accounts`              | `issuer text NOT NULL`; unique `(issuer, account_id)` beside unique `(provider_id, account_id)` | Trips the boot check; every account insert fails NOT NULL. Must be relaxed or dropped.                                                                             |
| `packages/db/migrations/0060_account_issuer.sql`         | Backfills `issuer` on a 1.6 install, refuses if unresolvable, then NOT NULL + index             | Stays as it is — history. A new migration retires what it built.                                                                                                   |
| `apps/api/src/auth/instance.ts` `provisionUser`          | Passes `issuer: CREDENTIAL_ISSUER` to `linkAccount`                                             | Type error; the field is dropped.                                                                                                                                  |
| `apps/api/src/auth/instance.ts` `CREDENTIAL_ISSUER`      | The `local:credential` literal 1.7 filtered credential rows by                                  | Nothing reads it any more. Retired; the migration test keeps the literal for what 0060 wrote.                                                                      |
| `apps/api/src/account-issuer-migration.test.ts`          | Rehearses 0060 on a 1.6 install: backfill values, refusals, sign-in after                       | Backfill and refusal cases still describe 0060 truthfully. The sign-in case now proves the whole chain (0060 → retirement) leaves a pre-1.7 password row signable. |
| `apps/api/src/modules/auth/sso.test.ts`                  | Reads `accounts` by `(user_id, provider_id)`; token columns by `account_id`                     | Unchanged.                                                                                                                                                         |
| `docs/decision-records/SCHEMA.md` `accounts`             | Documents `issuer`, the second unique index, and the 1.7 rationale                              | Rewritten: the column goes, the index paragraph goes, the 1.7 paragraph becomes history.                                                                           |
| `docs/decision-records/DECISIONS-TECH-STACK.md` TECH-008 | "Version pin: better-auth pinned to 1.6.x … currently 1.6.26" — already stale since #340        | Addendum: 1.7.3, the reversal, and how the routine sweep treats `@better-auth/*` from now on.                                                                      |
| web (`apps/web`)                                         | `better-auth` React client + `@better-auth/sso` client plugin; no account-issuer usage          | Version bump only.                                                                                                                                                 |

## 3. The decision: take the reversal, drop the column

**Take upstream's schema back.** The alternatives — stay pinned at 1.7.2,
or keep our own `issuer` enforcement on top of 1.7.3 — are both worse, and
the argument for keeping the stricter key turns out not to hold.

`SCHEMA.md` gives one reason the `(issuer, account_id)` index exists: two
provider registrations may name the same IdP, so one person's subject can
reach `accounts` twice under two `provider_id`s. Read against what
better-auth actually does in that case (verified in the 1.7.2 dist: the
sso plugin only asks for exact account binding when a `resolveUser` hook is
configured, which we do not), the index guards nothing a person would
notice. On 1.7.2 the second sign-in finds the first registration's row by
`(issuer, account_id)` and quietly reuses it — one row, filed under the
first `provider_id`, its tokens overwritten by the second IdP exchange. On
1.6 and 1.7.3 the second sign-in links a second account row to the same
user by email (the provider is `domain_verified`, so linking is allowed).
Either way the person signs in as one user; 1.7.3's shape is the more
truthful record of what happened, and its new duplicate check
(`limit: 2`, throw) covers the one case that would actually be ambiguous.
The stricter index bought a tidier table, not a guarantee. Upstream reached
the same reading, which is why they reverted.

Staying on 1.7.2 means carrying an orphaned point release of a library that
moves this much, and re-litigating this on every sweep. Keeping our own
issuer logic means owning a divergence on the credential path that TECH-008
deliberately keeps inside the library's "swappable implementation detail"
boundary.

**Drop the column, do not just relax it.** Upstream's minimal Postgres
cleanup keeps `issuer` nullable. For us that leaves a column nothing reads or
writes: NULL on every row created after the upgrade, a stale value on every
row before it, and a line in `SCHEMA.md` describing data that means nothing.
Dropping it is one more statement in the same migration. What dropping
costs is a rollback to a 1.7.2 image, and that rollback is not real either
way: 1.7.2 filters credential and SSO lookups on `issuer`, so against a
relaxed column every account created after the upgrade is a person who
cannot sign in. Migrations run on container start and go one way
(TECH-005); this one is no exception.

**Keep 0060 exactly as it is.** Migrations that have shipped are history.
Its refusals still fire for an install that never crossed it and holds an
account no provider can speak for — a real residue, since the column it is
protecting is about to be dropped. Accepted: no install predates 0060 on any
path this product supports, and the upgrade-fidelity gate's baseline is
`dev`, which already carries it.

**Keep schema validation on, and make it stop the boot.** The default
behaviour — log an error at boot, then throw on every auth request — is the
worst of both: the process reports ready and every sign-in 500s. Awaiting
the check once in `apps/api/src/index.ts`, beside the migration and rewrap
steps, turns a schema drift into the refusal-to-start the rest of the boot
already practises. The check reads the Drizzle schema object, not the
database, so it is deterministic and costs no round trip.

## 4. Work items (one PR to `dev`, landed together)

The three cannot ship separately: 1.7.3 code against the NOT NULL column
fails every account insert; the migration against 1.7.2 code breaks every
sign-in. Same shape as #340's "coordinated deploy sequencing".

### A. Code — bump and take the new account key

- `apps/api/package.json`, `apps/web/package.json`: the three packages to
  `~1.7.3` (keep `@better-auth/sso` in `api` exact, as it is today).
  `pnpm install`; lockfile diff is the three packages and their `@better-auth/core` transitive.
- `apps/api/src/auth/instance.ts`: `provisionUser` stops passing `issuer`;
  the `CREDENTIAL_ISSUER` export and its doc block go; the `1.7 keys an
account on (issuer, accountId)` comments go.
- `apps/api/src/index.ts`: after `createApp`, await the schema check once
  and exit 1 on a `SchemaMismatchError` with its message — same treatment
  the journal guard gets. (`(await app.auth.$context).checkSchema?.()`.)
- `pnpm typecheck`, `pnpm lint`, `pnpm --filter @openlaw/api test` (Docker).

### B. Schema — retire the column

- `packages/db/src/schema/auth.ts`: remove `issuer` and
  `accounts_issuer_account_unique`; rewrite the two comments so the
  `(provider_id, account_id)` index is the one key again.
- `pnpm --filter @openlaw/db generate --name account_issuer_retired` →
  `0091_account_issuer_retired.sql`. Expected SQL: `DROP INDEX
"accounts_issuer_account_unique"; ALTER TABLE "accounts" DROP COLUMN
"issuer";`. Two plain statements, each atomic on its own and safe in
  autocommit, so no `COMMIT;/BEGIN;` header is needed. Add a header comment
  naming 0060, #11153, and why the column is dropped rather than relaxed.
- `pnpm lint:migrations`.
- `apps/api/src/account-issuer-migration.test.ts`: `CREDENTIAL_ISSUER`
  becomes a local literal (it is what 0060 wrote, not what the app uses);
  the "upgraded install" case asserts the column is gone after the full
  chain and the pre-1.7 password row still signs in; the file comment
  says what 0060 is now — a migration an install passes through, whose
  work a later one retires.

### C. Docs and the rehearsal

- `SCHEMA.md` `accounts`: drop the `issuer` row; the unique-index paragraph
  names `(provider_id, account_id)` alone; the "`issuer` arrived with 1.7"
  paragraph becomes two sentences of history ending in 0091.
- `DECISIONS-TECH-STACK.md` TECH-008: an addendum dated with the PR
  recording 1.7.3, the reversal and the reasoning in §3, the boot-time
  check, and this rule for the routine sweep: **`@better-auth/*` is never a
  drop-in bump at any semver level** — 1.7.0 broke as a minor and 1.7.3
  broke as a patch — so the sweep diffs the published tarball's `dist/db/`
  and `dist/api/` before classifying, as this note did.
- `pnpm upgrade-fidelity` with `BASELINE=origin/dev`: a filled 1.7.2
  install (rows carrying `issuer` values, 0060 applied) upgraded to the PR
  head. This is the migration rehearsal on real data; it and the harness
  suites need Docker, so they run in CI, not here.

Post-upgrade checks, from the upgrade guide's list, cut to what we run:
password sign-in, magic link, first-run setup (`provisionUser`), SSO sign-in
against the mock IdP, a second SSO sign-in for an already-linked user,
password change, TOTP enrol / re-enrol / disable.

## 5. Out of scope, on purpose

- The 1.6 → 1.7 items the guide still lists (two-factor response shape,
  sso option names, `experimental.joins`): already taken in #340.
- Pinning strategy beyond the tilde ranges we have: unchanged.
- `isPasswordCompromised`: a product question about calling a third party
  on every password set; not this PR.
- The pre-existing peer warning (`better-auth` wants `vitest` 2–4, we run
  5): unchanged by this bump.
