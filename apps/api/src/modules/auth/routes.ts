// SPDX-License-Identifier: AGPL-3.0-only

/**
 * App-level auth routes (TECH-008). Only surfaces where OpenLaw's
 * authorization model diverges from better-auth live here; browser
 * auth flows are better-auth's own handler under /api/auth/*.
 */

import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { fromNodeHeaders } from "better-auth/node";
import { isAPIError } from "better-auth/api";
import { z } from "zod";
import {
  accounts,
  ADVISORY_LOCK,
  and,
  AUTH_MODES,
  eq,
  orgSettings,
  ssoProviders,
  tryWithAdvisoryLock,
  users,
  USER_ROLES,
} from "@openlaw/db";
import { provisionUser, withTrustedIssuerOrigin } from "../../auth/instance.js";
import { requireAuth, requireRole, userColumns } from "../../auth/guards.js";
import { getOrgSettings, isEmailDomainAllowed } from "../../lib/org-settings.js";
import { httpError, problemResponse } from "../../lib/problem.js";

const UserSchema = z.object({
  id: z.string(),
  email: z.string(),
  displayName: z.string(),
  role: z.enum(USER_ROLES),
});

const UserEnvelope = z.object({ user: UserSchema });

/**
 * Invitable roles: everyone but Business Users, who are JIT-provisioned
 * (DD-010) — invites are the only way these accounts come to exist.
 */
const INVITABLE_ROLES = ["administrator", "legal_team_member", "contributor"] as const;

const SessionSchema = z.object({
  id: z.string(),
  expiresAt: z.iso.datetime(),
});

/** Translates a better-auth APIError into our problem envelope. */
function relayAuthError(error: unknown): never {
  if (isAPIError(error)) {
    throw httpError(error.statusCode >= 400 ? error.statusCode : 500, error.message);
  }
  throw error;
}

export const authRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get(
    "/me",
    {
      preHandler: requireAuth,
      schema: {
        operationId: "getMe",
        summary: "The signed-in user, with their live role and session",
        tags: ["auth"],
        response: {
          200: z.object({ user: UserSchema, session: SessionSchema }),
          default: problemResponse,
        },
      },
    },
    async (request) => ({
      user: request.user,
      session: {
        id: request.session.id,
        expiresAt: request.session.expiresAt.toISOString(),
      },
    }),
  );

  app.get(
    "/auth/setup",
    {
      schema: {
        operationId: "getSetupStatus",
        summary: "Whether first-run setup (initial Administrator) is still required",
        tags: ["auth"],
        response: { 200: z.object({ needsSetup: z.boolean() }), default: problemResponse },
      },
    },
    async () => {
      const anyUser = await app.db.select({ id: users.id }).from(users).limit(1);
      return { needsSetup: anyUser.length === 0 };
    },
  );

  app.post(
    "/auth/setup",
    {
      schema: {
        operationId: "runSetup",
        summary: "First-run setup: create the initial Administrator",
        tags: ["auth"],
        body: z.object({
          email: z.email(),
          displayName: z.string().min(1),
          password: z.string().min(8),
        }),
        response: { 201: UserEnvelope, default: problemResponse },
      },
    },
    async (request, reply) => {
      const { email, displayName, password } = request.body;

      // "No user exists yet" only holds if nobody else can create one while
      // we act on it. An advisory lock makes the check and the create one
      // critical section across every API process, so exactly one caller
      // becomes the Administrator and the losers never create a user they
      // would then have to delete. Setup happens once, so a caller that
      // cannot take the lock has already lost: it answers 409 rather than
      // parking a connection behind the winner.
      const outcome = await tryWithAdvisoryLock(app.db, ADVISORY_LOCK.firstRunSetup, async () => {
        const anyUser = await app.db.select({ id: users.id }).from(users).limit(1);
        if (anyUser.length > 0) throw httpError(409, "Setup has already been completed.");

        const created = await provisionUser(app.auth, { email, displayName, password });
        const [row] = await app.db
          .update(users)
          .set({ role: "administrator" })
          .where(eq(users.id, created.id))
          .returning(userColumns);
        return row;
      });
      if (!outcome.acquired) throw httpError(409, "Setup has already been completed.");
      const admin = outcome.result;
      if (!admin) throw httpError(500, "Setup could not create the initial Administrator.");

      // Sign in to mint the session the way every later login does; the
      // account already exists, so this cannot resurrect public sign-up.
      let setCookies: string[];
      try {
        const { headers } = await app.auth.api.signInEmail({
          returnHeaders: true,
          body: { email, password },
          headers: fromNodeHeaders(request.headers),
        });
        setCookies = headers.getSetCookie();
      } catch (error) {
        relayAuthError(error);
      }

      for (const cookie of setCookies) void reply.header("set-cookie", cookie);
      return reply.status(201).send({ user: admin });
    },
  );

  app.post(
    "/auth/invites",
    {
      preHandler: requireRole("administrator"),
      schema: {
        operationId: "inviteUser",
        summary:
          "Invite a user (Administrator, Legal Team Member, or Contributor); " +
          "re-sends the set-password email if they have not activated",
        tags: ["auth"],
        body: z.object({
          email: z.email(),
          displayName: z.string().min(1),
          role: z.enum(INVITABLE_ROLES),
        }),
        response: {
          200: UserEnvelope,
          201: UserEnvelope,
          default: problemResponse,
        },
      },
    },
    async (request, reply) => {
      const { displayName, role } = request.body;
      const email = request.body.email.toLowerCase();

      const existing = await app.db
        .select(userColumns)
        .from(users)
        .where(eq(users.email, email))
        .limit(1);

      if (existing.length > 0) {
        const user = existing[0]!;
        // A credential row means they activated; there is nothing to
        // re-send and the invite must not touch the account.
        const credential = await app.db
          .select({ id: accounts.id })
          .from(accounts)
          .where(and(eq(accounts.userId, user.id), eq(accounts.providerId, "credential")))
          .limit(1);
        if (credential.length > 0) {
          throw httpError(409, "This user has already activated their account.");
        }
        // Re-sending never changes the account. A different role here is a
        // role edit — user management, not an invite — and a JIT-created
        // Business User can never be converted to staff roles this way.
        if (user.role !== role) {
          throw httpError(409, "This user already exists with a different role.");
        }
        await sendSetPasswordEmail(email);
        return reply.status(200).send({ user });
      }

      // Server-trusted call (no request headers forwarded): authorization
      // is this route's requireRole guard. No password → no credential row
      // until the invitee sets their own (spec: no password ever travels
      // through the Administrator).
      const created = await app.auth.api.createUser({
        body: { email, name: displayName, role },
      });
      await sendSetPasswordEmail(email);

      const [user] = await app.db
        .select(userColumns)
        .from(users)
        .where(eq(users.id, created.user.id))
        .limit(1);
      if (!user) throw httpError(500, "The invited user could not be read back.");
      return reply.status(201).send({ user });
    },
  );

  app.post(
    "/auth/sso-providers",
    {
      preHandler: requireRole("administrator"),
      schema: {
        operationId: "registerSsoProvider",
        summary:
          "Register a bring-your-own OIDC identity provider (TECH-008); " +
          "endpoint discovery runs from the issuer, and the response carries " +
          "the callback URL to paste into the IdP console",
        tags: ["auth"],
        body: z.object({
          /** Stable slug; identifies the provider in sign-in flows. */
          providerId: z
            .string()
            .regex(
              /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/,
              "Lowercase letters, digits and inner hyphens only.",
            ),
          issuer: z.url(),
          /** Email domain(s) the IdP serves; comma-separated for several. */
          domain: z.string().min(1),
          clientId: z.string().min(1),
          clientSecret: z.string().min(1),
        }),
        response: {
          201: z.object({
            provider: z.object({
              id: z.string(),
              providerId: z.string(),
              issuer: z.string(),
              domain: z.string(),
            }),
            /** The stable redirect URL to paste into the IdP console. */
            callbackUrl: z.string(),
          }),
          default: problemResponse,
        },
      },
    },
    async (request, reply) => {
      const { providerId, issuer, clientId, clientSecret } = request.body;
      const domain = request.body.domain.toLowerCase();

      // The plugin's register endpoint does the real work — issuer
      // validation, discovery, persistence — under the admin's forwarded
      // session. Its SSRF guard only fetches discovery documents from
      // trusted origins, so the runtime-supplied issuer is trusted for
      // exactly this call.
      let registered: { redirectURI: string };
      try {
        registered = await withTrustedIssuerOrigin(app.auth, issuer, () =>
          app.auth.api.registerSSOProvider({
            body: { providerId, issuer, domain, oidcConfig: { clientId, clientSecret } },
            headers: fromNodeHeaders(request.headers),
          }),
        );
      } catch (error) {
        relayAuthError(error);
      }

      // An Administrator registering the provider is OpenLaw's domain
      // -trust decision (single tenant — there is no other tenant to
      // protect from a false domain claim), so the row is marked verified
      // immediately; the plugin will not link sign-ins to pre-existing
      // users through an unverified provider, and the DNS-TXT
      // verification flow is never exposed.
      const [provider] = await app.db
        .update(ssoProviders)
        .set({ domainVerified: true, updatedAt: new Date() })
        .where(eq(ssoProviders.providerId, providerId))
        .returning({
          id: ssoProviders.id,
          providerId: ssoProviders.providerId,
          issuer: ssoProviders.issuer,
          domain: ssoProviders.domain,
        });
      if (!provider) throw httpError(500, "The registered provider could not be read back.");

      return reply.status(201).send({
        provider,
        callbackUrl: registered.redirectURI,
      });
    },
  );

  app.get(
    "/auth/mode",
    {
      preHandler: requireRole("administrator"),
      schema: {
        operationId: "getAuthMode",
        summary: "The organization's auth mode (TECH-008)",
        tags: ["auth"],
        response: {
          200: z.object({ mode: z.enum(AUTH_MODES) }),
          default: problemResponse,
        },
      },
    },
    async () => {
      const settings = await getOrgSettings(app.db);
      return { mode: settings.authMode };
    },
  );

  app.patch(
    "/auth/mode",
    {
      preHandler: requireRole("administrator"),
      schema: {
        operationId: "setAuthMode",
        summary:
          "Switch the auth mode (TECH-008): `oidc` closes password sign-in " +
          "for everyone but Administrators (break-glass); switching never " +
          "invalidates existing sessions",
        tags: ["auth"],
        body: z.object({ mode: z.enum(AUTH_MODES) }),
        response: {
          200: z.object({ mode: z.enum(AUTH_MODES) }),
          default: problemResponse,
        },
      },
    },
    async (request) => {
      // A plain column flip: enforcement reads org_settings on every
      // sign-in decision, so the switch takes effect immediately — and
      // ONLY at sign-in. Live sessions survive in both directions;
      // archival and revocation are the tools for ending them.
      const [row] = await app.db
        .update(orgSettings)
        .set({ authMode: request.body.mode, updatedAt: new Date() })
        .returning({ mode: orgSettings.authMode });
      if (!row) throw httpError(500, "org_settings has no row to update.");
      return { mode: row.mode };
    },
  );

  app.post(
    "/auth/magic-link",
    {
      schema: {
        operationId: "requestMagicLink",
        summary:
          "Request a portal magic link (DD-010); the response is identical " +
          "whether or not the address is eligible",
        tags: ["auth"],
        body: z.object({ email: z.email() }),
        response: {
          202: z.object({ message: z.string() }),
          default: problemResponse,
        },
      },
    },
    async (request, reply) => {
      const email = request.body.email.toLowerCase();

      // Policy runs BEFORE issuance. The toggle is global configuration,
      // so refusing loudly leaks nothing; the allowlist check must not be
      // observable, so the denied branch simply skips issuance and falls
      // through to the same 202.
      const settings = await getOrgSettings(app.db);
      if (!settings.magicLinkEnabled) {
        throw httpError(403, "Magic-link sign-in is disabled.");
      }
      if (isEmailDomainAllowed(email, settings.allowedEmailDomains)) {
        try {
          await app.auth.api.signInMagicLink({
            body: { email, callbackURL: "/" },
            headers: fromNodeHeaders(request.headers),
          });
        } catch (error) {
          relayAuthError(error);
        }
      }
      return reply
        .status(202)
        .send({ message: "If the address is eligible, a sign-in link is on its way." });
    },
  );

  /** Issues a set-password token and emails it (reset-password flow). */
  async function sendSetPasswordEmail(email: string): Promise<void> {
    try {
      await app.auth.api.requestPasswordReset({
        body: { email, redirectTo: "/auth/set-password" },
      });
    } catch (error) {
      relayAuthError(error);
    }
  }
};
