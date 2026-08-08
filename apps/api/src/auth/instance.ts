// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The configured better-auth instance (TECH-008). better-auth is an
 * implementation detail behind our session model: it maps onto the
 * packages/db tables (never its own CLI schema), generates our UUID v7
 * ids, and hashes with Argon2id. Account creation is closed at the
 * config level here rather than gated per-request, so no entry path —
 * browser, plugin, or our own server code — can open registration.
 */

import { betterAuth } from "better-auth";
import { drizzleAdapter } from "@better-auth/drizzle-adapter";
import { hash, verify } from "@node-rs/argon2";
import { uuidv7 } from "uuidv7";
import { schema, type Db } from "@openlaw/db";

export interface AuthConfig {
  secret: string;
  baseUrl: string;
}

/** OWASP-recommended Argon2id parameters (19 MiB, t=2, p=1). */
const ARGON2 = { memoryCost: 19456, timeCost: 2, parallelism: 1 };

export function createAuth(db: Db, config: AuthConfig) {
  return betterAuth({
    baseURL: config.baseUrl,
    secret: config.secret,
    database: drizzleAdapter(db, { provider: "pg", usePlural: true, schema }),
    user: {
      fields: { name: "displayName" },
    },
    emailAndPassword: {
      enabled: true,
      // OpenLaw has no public registration in either auth mode: accounts
      // arrive by invite, SSO, or the first-run setup below, which
      // provisions through the adapter rather than this endpoint. Nothing
      // reaches /sign-up/email — not a browser, not our own server code.
      disableSignUp: true,
      password: {
        hash: (password) => hash(password, ARGON2),
        verify: ({ password, hash: digest }) => verify(digest, password),
      },
    },
    advanced: {
      database: { generateId: () => uuidv7() },
    },
  });
}

export type Auth = ReturnType<typeof createAuth>;

export interface ProvisionedUser {
  email: string;
  displayName: string;
  password: string;
}

/**
 * Creates a user and its credential account through better-auth's trusted
 * adapter, bypassing the (disabled) public sign-up endpoint. Password
 * hashing, id generation and field mapping still go through better-auth,
 * so the row is indistinguishable from one it made itself.
 *
 * Callers own the authorization decision — this function makes none. It
 * is only safe under whatever invariant the caller holds (for setup, the
 * `firstRunSetup` advisory lock).
 */
export async function provisionUser(auth: Auth, user: ProvisionedUser): Promise<{ id: string }> {
  const ctx = await auth.$context;
  const passwordHash = await ctx.password.hash(user.password);
  const created = await ctx.internalAdapter.createUser({
    email: user.email.toLowerCase(),
    name: user.displayName,
    emailVerified: false,
  });
  await ctx.internalAdapter.linkAccount({
    userId: created.id,
    providerId: "credential",
    accountId: created.id,
    password: passwordHash,
  });
  return { id: created.id };
}
