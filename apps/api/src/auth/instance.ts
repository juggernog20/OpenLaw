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
import { admin, magicLink } from "better-auth/plugins";
import { userAc } from "better-auth/plugins/admin/access";
import { APIError, createAuthMiddleware } from "better-auth/api";
import { drizzleAdapter } from "@better-auth/drizzle-adapter";
import { hash, verify } from "@node-rs/argon2";
import { uuidv7 } from "uuidv7";
import { eq, schema, users, type Db } from "@openlaw/db";
import type { Mailer } from "../lib/mailer.js";
import { getOrgSettings, isEmailDomainAllowed } from "../lib/org-settings.js";

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
      // A reset only completes through a token from the account's inbox,
      // so it proves email ownership — for invite activation and ordinary
      // forgotten-password resets alike. Recording that here keeps
      // magic-link verification from treating the account as unproven
      // and stripping its password credential (the plugin's
      // anti-pre-hijack measure, aimed at public-sign-up apps — OpenLaw
      // has no public sign-up, so every credential is legitimate).
      onPasswordReset: async ({ user }) => {
        await db.update(users).set({ emailVerified: true }).where(eq(users.id, user.id));
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
      // the plugin DD-013's vocabulary; every role gets zero admin-surface
      // permissions, keeping better-auth's /api/auth/admin/* endpoints
      // closed until the Settings management surface ships. Invites are
      // unaffected: the server-side createUser call carries no session, so
      // these permissions are never consulted — authorization is our
      // requireRole guard.
      admin({
        roles: {
          administrator: userAc,
          legal_team_member: userAc,
          contributor: userAc,
          business_user: userAc,
        },
        adminRoles: ["administrator"],
        defaultRole: "business_user",
      }),
      // The DD-010/INT-001 portal floor: passwordless sign-in for
      // requesters. Tokens are single-use, short-lived, and hashed at
      // rest; issuance policy (toggle + domain allowlist) is enforced in
      // the hooks below and in the typed issuance route.
      magicLink({
        expiresIn: 5 * 60,
        storeToken: "hashed",
        sendMagicLink: async ({ email, url }) => {
          await mailer.send({
            to: email,
            subject: "Sign in to OpenLaw",
            text: [
              "Hello,",
              "",
              "Sign in to OpenLaw using the link below:",
              "",
              url,
              "",
              "The link expires in five minutes and can be used once. " +
                "If you did not request it, you can ignore this email.",
            ].join("\n"),
          });
        },
      }),
    ],
    hooks: {
      // Policy holds on better-auth's own magic-link paths, not just our
      // typed route — direct calls meet the same rules. Guarding verify
      // as well as issuance means flipping the toggle off takes effect
      // immediately, including for links already in flight; domains are
      // not re-checked at verify because a redeemable token can only have
      // been issued through the allowlist, moments earlier (5-min TTL) —
      // JIT creation re-checks in the databaseHook below regardless. The
      // denied branch mirrors the endpoint's success shape so responses
      // never reveal whether a domain is allowlisted.
      before: createAuthMiddleware(async (ctx) => {
        if (ctx.path !== "/sign-in/magic-link" && ctx.path !== "/magic-link/verify") return;
        const settings = await getOrgSettings(db);
        if (!settings.magicLinkEnabled) {
          throw new APIError("FORBIDDEN", { message: "Magic-link sign-in is disabled." });
        }
        if (ctx.path !== "/sign-in/magic-link") return;
        const email = typeof ctx.body?.email === "string" ? ctx.body.email : "";
        if (!isEmailDomainAllowed(email, settings.allowedEmailDomains)) {
          return ctx.json({ status: true });
        }
      }),
    },
    databaseHooks: {
      user: {
        create: {
          // JIT provisioning (DD-010): a user born from magic-link
          // redemption is a Business User on an allowed domain — checked
          // again here because policy may have changed since issuance.
          // Other creation paths (setup, invites) are untouched.
          before: async (user, ctx) => {
            if (ctx?.path !== "/magic-link/verify") return;
            const settings = await getOrgSettings(db);
            if (
              !settings.magicLinkEnabled ||
              !isEmailDomainAllowed(user.email, settings.allowedEmailDomains)
            ) {
              throw new APIError("FORBIDDEN", {
                message: "This email address is not eligible for portal access.",
              });
            }
            return { data: { ...user, name: user.name || user.email, role: "business_user" } };
          },
        },
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
  // Verified from birth: the only caller is first-run setup, where the
  // installer asserts their own address on an empty install — there is no
  // one to hijack and no public sign-up to squat through. Leaving it
  // false would make a later magic-link redemption strip this password
  // credential as "unproven" (see onPasswordReset above).
  const created = await ctx.internalAdapter.createUser({
    email: user.email.toLowerCase(),
    name: user.displayName,
    emailVerified: true,
  });
  await ctx.internalAdapter.linkAccount({
    userId: created.id,
    providerId: "credential",
    accountId: created.id,
    password: passwordHash,
  });
  return { id: created.id };
}
