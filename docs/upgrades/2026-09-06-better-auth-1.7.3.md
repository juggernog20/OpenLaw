# better-auth 1.7.2 → 1.7.3 — research note (needs a grill-me)

**Status:** research only, no go/no-go decision made. Not a decision record —
lives here until a grill-me session settles it, then the outcome (and any
schema change) belongs in `SCHEMA.md` / `DECISIONS-TECH-STACK.md`.

## What triggered this

Routine dependency check (2026-09-06) found three outdated packages, all
part of one coordinated release:

| Package | Current | Latest |
| --- | --- | --- |
| `better-auth` | 1.7.2 | 1.7.3 |
| `@better-auth/sso` | 1.7.2 | 1.7.3 |
| `@better-auth/drizzle-adapter` | 1.7.2 | 1.7.3 |

`1.7.3` is the package's current `latest` dist-tag — there is no newer release
to wait for.

By version number this reads as a patch release, safe to fold into the
routine patch/minor sweep. It is not. Bumping the three packages and
reinstalling breaks the `apps/api` build immediately:

```
apps/api:build: src/auth/instance.ts(642,5): error TS2353: Object literal may
only specify known properties, and 'issuer' does not exist in type '...'
```

## What actually changed upstream

Diffing the published `1.7.2` and `1.7.3` tarballs: `1.7.3` removes the
`issuer` field from the `Account` schema type and reverts account lookup
from `(issuer, accountId)` back to `(providerId, accountId)` everywhere
(`link-account.mjs`, `internal-adapter.mjs`, the sso plugin's account
matching). The upstream release notes confirm this is deliberate: **v1.7.3
reverts the account-identification change introduced across v1.7.0–1.7.2**,
restoring the pre-1.7 (`1.6`-era) schema "to avoid requiring a disruptive
backfill for existing users."

In other words: better-auth's own 1.7.x line shipped a breaking schema
change, then un-shipped it two patch releases later, without a minor or
major version bump either time.

## Why this isn't a drop-in bump for OpenLaw

We didn't just passively receive the 1.7 `issuer` schema — we deliberately
adopted it and built on it:

- **`SCHEMA.md`** (accounts table) documents `issuer` as arriving with
  better-auth 1.7 (#340) specifically because it "identifies an account by
  who asserted the subject rather than by which provider row we filed it
  under," and calls out the exact case it exists to fix: **two provider
  registrations may name the same IdP**, in which case one person's subject
  reaches the accounts table twice under two different `providerId`s that a
  `(providerId, accountId)` unique index alone can't tell apart. The
  `(issuer, accountId)` index is described as "the stricter of the two."
- **Migration `0060_account_issuer.sql`** backfilled `issuer` for every
  existing row and is written to refuse an upgrade it can't resolve, "because
  a row with the wrong issuer is a person who cannot sign in." It's also the
  worked example `DECISIONS-TECH-STACK.md` cites for the
  `COMMIT; BEGIN;` atomic-migration pattern — i.e. it's treated as load-bearing
  infrastructure, not incidental.
- **`apps/api/src/auth/instance.ts`** (`provisionUser`) sets a synthetic
  `issuer: CREDENTIAL_ISSUER` on every password account specifically because
  "better-auth's own credential lookups — `findCredentialAccount` and
  `updatePassword` — filter on exactly this value, so a row without it can
  never sign in or change its password."
- There's a dedicated regression test, `account-issuer-migration.test.ts`,
  and SSO coverage in `sso.test.ts` that exercises issuer-keyed lookups.

Downgrading (from our schema's perspective) to `(providerId, accountId)`
keying would silently reopen the exact ambiguity `SCHEMA.md` names — two SSO
provider registrations pointed at the same IdP colliding on one person's
subject — and, per `instance.ts`'s own comment, would break local
credential accounts unless every `issuer`-dependent call site is reworked in
lockstep with whatever 1.7.3 now expects.

## Options

1. **Stay pinned at 1.7.2.** Zero-cost today. Risk: 1.7.2 is no longer a
   maintained line (1.7.3 superseded it on the `latest` tag), so we'd be
   carrying an unpatched version indefinitely and re-litigating this on
   every future dependency sweep. Also means dropping the `@better-auth/*`
   family from patch/minor auto-upgrades until this is resolved.
2. **Upgrade to 1.7.3 and drop our issuer-keying**, reverting migration 0060
   or leaving the column as dead data. Matches upstream's own schema again.
   Cost: gives up the two-IdPs-same-issuer disambiguation `SCHEMA.md`
   documents as the reason the column exists, needs a migration plan for
   existing installs (self-hosted — we don't control when they upgrade),
   and touches `instance.ts`, the sso plugin config, and both test suites.
3. **Upgrade to 1.7.3 but keep our own `issuer` column and enforcement**,
   layering our own uniqueness/lookup logic on top rather than relying on
   better-auth's internals for it. Keeps the guarantee `SCHEMA.md` wants;
   costs more code now living outside the "implementation detail, swappable"
   boundary `DECISIONS-TECH-STACK.md` sets for better-auth (TECH-008's
   stated preference is typed routes only where our model diverges — this
   would be exactly that kind of divergence, on a security-sensitive path).
4. **Fork/patch `@better-auth/*`** to restore issuer-keying under 1.7.3.
   Most surface area to maintain long-term; means tracking a diff against
   upstream indefinitely.

No option here is a "just bump the version" fix, which is why this is
flagged as a major-refactor-tier item rather than folded into the
patch/minor upgrade PR.

## Recommendation

Don't self-merge any of the above. This sits on the credential/SSO
correctness path `DECISIONS-TECH-STACK.md` and `SCHEMA.md` both treat as
deliberate, so the tradeoff (keep the stricter guarantee vs. stay current
with upstream) is a product/security call, not an engineering default.
Needs a grill-me session to decide go/no-go and, if go, which option above.

Until then: `better-auth`, `@better-auth/sso`, and
`@better-auth/drizzle-adapter` stay pinned at `1.7.2` and are excluded from
routine dependency-update sweeps (tracked back to this note).
