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
import { admin } from "better-auth/plugins";
import { adminAc, userAc } from "better-auth/plugins/admin/access";
import { drizzleAdapter } from "@better-auth/drizzle-adapter";
import { hash, verify } from "@node-rs/argon2";
import { uuidv7 } from "uuidv7";
import { schema, type Db } from "@openlaw/db";
import type { Mailer } from "../lib/mailer.js";

export interface AuthConfig {
  secret: string;
  baseUrl: string;
}

/** OWASP-recommended Argon2id parameters (19 MiB, t=2, p=1). */
const ARGON2 = { memoryCost: 19456, timeCost: 2, parallelism: 1 };

export function createAuth(db: Db, config: AuthConfig, mailer: Mailer) {
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
      // Set-password links for invites *and* ordinary forgotten-password
      // resets both ride this flow; the copy covers both. The link targets
      // our web page, which posts the token to /api/auth/reset-password.
      sendResetPassword: async ({ user, token }) => {
        await mailer.send({
          to: user.email,
          subject: "Set your OpenLaw password",
          text: [
            `Hello ${user.name},`,
            "",
            "Set your OpenLaw password using the link below:",
            "",
            `${config.baseUrl}/auth/set-password?token=${token}`,
            "",
            "The link expires in one hour. If you did not expect this email, you can ignore it.",
          ].join("\n"),
        });
      },
      password: {
        hash: (password) => hash(password, ARGON2),
        verify: ({ password, hash: digest }) => verify(digest, password),
      },
    },
    // Set-password and magic-link tokens are at-rest secrets: store their
    // identifiers hashed (lookup hashes symmetrically).
    verification: {
      storeIdentifier: "hashed",
    },
    plugins: [
      // Owns the users.role column plus ban/impersonation columns. Bans
      // carry no product semantics yet; adminRoles shields administrators
      // from ban/impersonation targeting. The roles map exists to teach
      // the plugin DD-013's vocabulary — its statements are better-auth's
      // admin-surface permissions, not OpenLaw's authorization model,
      // which lives in our guards.
      admin({
        roles: {
          administrator: adminAc,
          legal_team_member: userAc,
          contributor: userAc,
          business_user: userAc,
        },
        adminRoles: ["administrator"],
        defaultRole: "business_user",
      }),
    ],
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
