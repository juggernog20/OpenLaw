// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Database-backed counters for the sign-in surfaces (TECH-032).
 *
 * Three things are counted here, all in the `verifications` table so the
 * count is shared by every API replica and needs no extra service:
 *
 *   - the request budget on the addresses that send email to anyone who
 *     asks (password setup, magic links): 3 per email address and 30 per
 *     client address in 15 minutes;
 *   - the same client-address budget on password-setup completion, which
 *     costs an Argon2 hash per live token;
 *   - the failure count on password sign-in: 10 wrong passwords for one
 *     email address in 15 minutes close the password door for that
 *     address until the window ends, whether or not an account exists.
 *
 * Every counter is keyed on a hash of the value it counts, so the table
 * never holds an email address or a client address in the clear.
 */

import { createHash } from "node:crypto";
import type { FastifyRequest } from "fastify";
import { eq, sql, verifications, type Db, type Executor } from "@openlaw/db";

export const FIFTEEN_MINUTES_MS = 15 * 60_000;

/** The request budget on the email-sending sign-in addresses. */
export const AUTH_REQUEST_BUDGET = { perEmail: 3, perAddress: 30, windowMs: FIFTEEN_MINUTES_MS };

/** The password sign-in lockout. The numbers match the TOTP lockout in
 * `instance.ts`, so one sentence in the docs covers both. */
export const PASSWORD_LOCKOUT = { maxFailures: 10, windowMs: FIFTEEN_MINUTES_MS };

const digest = (value: string) => createHash("sha256").update(value).digest("hex");

/**
 * Locks the counter row for the rest of the transaction and reads it.
 * A row whose window has ended reads as zero; the next hit reuses it.
 */
async function lockedCount(tx: Executor, identifier: string, now: Date) {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${identifier}))`);
  const [row] = await tx
    .select({
      id: verifications.id,
      value: verifications.value,
      expiresAt: verifications.expiresAt,
    })
    .from(verifications)
    .where(eq(verifications.identifier, identifier))
    .limit(1);
  const live = row !== undefined && row.expiresAt > now;
  return { row, count: live ? Number(row.value) : 0, live };
}

async function writeCount(
  tx: Executor,
  identifier: string,
  counted: Awaited<ReturnType<typeof lockedCount>>,
  windowMs: number,
  now: Date,
) {
  const expiresAt = counted.live ? counted.row!.expiresAt : new Date(now.getTime() + windowMs);
  if (counted.row)
    await tx
      .update(verifications)
      .set({ value: String(counted.count + 1), expiresAt })
      .where(eq(verifications.id, counted.row.id));
  else await tx.insert(verifications).values({ identifier, value: "1", expiresAt });
}

/**
 * Counts one hit against the identifier's window. Answers false, and
 * counts nothing, when the window already holds `max` hits.
 */
export async function countHit(
  db: Db,
  identifier: string,
  limit: { max: number; windowMs: number },
): Promise<boolean> {
  const now = new Date();
  return db.transaction(async (tx) => {
    const counted = await lockedCount(tx, identifier, now);
    if (counted.count >= limit.max) return false;
    await writeCount(tx, identifier, counted, limit.windowMs, now);
    return true;
  });
}

/** The hits in the identifier's live window; zero when the window has ended. */
export async function hitsWithin(db: Db, identifier: string): Promise<number> {
  const now = new Date();
  const [row] = await db
    .select({ value: verifications.value, expiresAt: verifications.expiresAt })
    .from(verifications)
    .where(eq(verifications.identifier, identifier))
    .limit(1);
  return row && row.expiresAt > now ? Number(row.value) : 0;
}

export async function forgetHits(db: Db, identifier: string): Promise<void> {
  await db.delete(verifications).where(eq(verifications.identifier, identifier));
}

/**
 * The address one request is counted under, or null when it must not be
 * counted by address at all.
 *
 * `request.ip` is right whenever the deployment named its proxies
 * (`TRUSTED_PROXIES`, Fastify's `trustProxy`). It is the proxy's own
 * address when the proxy forwarded no client address, and then the
 * whole org would share one bucket; that case answers null so the
 * per-email scope is the only one that applies. With no trusted proxy
 * the socket address is the only thing believed, and a spoofed
 * `X-Forwarded-For` changes nothing.
 */
export function clientAddress(
  request: FastifyRequest,
  trustedProxies: readonly string[],
): string | null {
  if (trustedProxies.length > 0 && request.headers["x-forwarded-for"] === undefined) return null;
  return request.ip;
}

export interface AuthRequestScopes {
  /** Which door is asking; each door has a budget of its own. */
  route: "password-setup" | "password-setup-complete" | "magic-link";
  email?: string;
  address: string | null;
}

/**
 * Spends one request from the budgets that apply. Every scope that is
 * present must have room, and each is counted; a refused request counts
 * against nothing, so a refused caller cannot spend the budget of a scope
 * that had room.
 */
export async function consumeAuthRequestBudget(
  db: Db,
  scopes: AuthRequestScopes,
): Promise<boolean> {
  const now = new Date();
  const wanted: Array<{ identifier: string; max: number }> = [];
  if (scopes.email !== undefined)
    wanted.push({
      identifier: `auth-request-rate:${scopes.route}:email:${digest(scopes.email.toLowerCase())}`,
      max: AUTH_REQUEST_BUDGET.perEmail,
    });
  if (scopes.address !== null)
    wanted.push({
      identifier: `auth-request-rate:${scopes.route}:address:${digest(scopes.address)}`,
      max: AUTH_REQUEST_BUDGET.perAddress,
    });
  return db.transaction(async (tx) => {
    const counted = [];
    for (const scope of wanted) {
      const current = await lockedCount(tx, scope.identifier, now);
      if (current.count >= scope.max) return false;
      counted.push({ scope, current });
    }
    for (const { scope, current } of counted)
      await writeCount(tx, scope.identifier, current, AUTH_REQUEST_BUDGET.windowMs, now);
    return true;
  });
}

const lockoutIdentifier = (email: string) =>
  `password-sign-in-failures:${digest(email.toLowerCase())}`;

/** True while the address has spent its password failures for the window. */
export async function passwordSignInLocked(db: Db, email: string): Promise<boolean> {
  return (await hitsWithin(db, lockoutIdentifier(email))) >= PASSWORD_LOCKOUT.maxFailures;
}

/** Counts one wrong password. The window starts at the first failure and
 * does not move, so the lock always ends 15 minutes after that. */
export async function recordPasswordSignInFailure(db: Db, email: string): Promise<void> {
  await countHit(db, lockoutIdentifier(email), {
    max: Number.POSITIVE_INFINITY,
    windowMs: PASSWORD_LOCKOUT.windowMs,
  });
}

export async function clearPasswordSignInFailures(db: Db, email: string): Promise<void> {
  await forgetHits(db, lockoutIdentifier(email));
}
