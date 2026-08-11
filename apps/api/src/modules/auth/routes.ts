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
  THEMES,
  tryWithAdvisoryLock,
  users,
  USER_ROLES,
} from "@openlaw/db";
import { provisionUser, withTrustedIssuerOrigin } from "../../auth/instance.js";
import { requireAuth, requireRole, userColumns } from "../../auth/guards.js";
import { recordActivity } from "../../lib/activity.js";
import { getOrgSettings, isEmailDomainAllowed } from "../../lib/org-settings.js";
import { httpError, problemResponse } from "../../lib/problem.js";

const UserSchema = z.object({
  id: z.string(),
  email: z.string(),
  displayName: z.string(),
  role: z.enum(USER_ROLES),
  theme: z.enum(THEMES),
});

const UserEnvelope = z.object({ user: UserSchema });

/**
 * Invitable roles: everyone but Business Users, who are JIT-provisioned
 * (DD-010) — invites are the only way these accounts come to exist.
 */
const INVITABLE_ROLES = ["administrator", "legal_team_member", "contributor"] as const;

/**
 * A bare DNS name — dot-separated labels, no scheme, port, path, or `@`.
 * Mixed case is accepted and normalised to lower case on write.
 */
const AllowedDomainSchema = z
  .string()
  .max(253)
  // Case-insensitivity is spelled out (no /i flag) because the pattern is
  // emitted into the OpenAPI document, where flags do not survive.
  .regex(
    /^[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)+$/,
    "A bare domain like acme.example — no scheme, path, port, or @.",
  );

const SessionSchema = z.object({
  id: z.string(),
  expiresAt: z.iso.datetime(),
});

const ProviderSchema = z.object({
  id: z.string(),
  providerId: z.string(),
  issuer: z.string(),
  domain: z.string(),
});

/**
 * The stored OIDC client config (better-auth keeps it as JSON text on
 * the provider row, discovery endpoints included). Only the fields this
 * module reads are typed; the secret never leaves the API. A row whose
 * JSON is unreadable reads as empty, so one corrupt provider cannot
 * fail the whole listing — the update handler's credential check then
 * asks the Administrator to repair it.
 */
function oidcConfigOf(row: { oidcConfig: string | null }): {
  clientId?: string;
  clientSecret?: string;
} {
  if (!row.oidcConfig) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(row.oidcConfig);
  } catch {
    return {};
  }
  const config = z
    .object({ clientId: z.string().optional(), clientSecret: z.string().optional() })
    .loose()
    .safeParse(parsed);
  return config.success
    ? { clientId: config.data.clientId, clientSecret: config.data.clientSecret }
    : {};
}

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

  app.patch(
    "/me/preferences",
    {
      preHandler: requireAuth,
      schema: {
        operationId: "updateMyPreferences",
        summary: "Update the signed-in user's preferences (theme, #44)",
        tags: ["auth"],
        body: z.object({ theme: z.enum(THEMES) }),
        response: { 200: UserEnvelope, default: problemResponse },
      },
    },
    async (request) => {
      // Mutation and audit entry commit together (SET-003/DD-017): every
      // settings change is recorded, or it does not land. The old value
      // is lock-read inside the transaction — the guard's earlier read
      // could be stale under a concurrent PATCH.
      const user = await app.db.transaction(async (tx) => {
        const [current] = await tx
          .select({ theme: users.theme })
          .from(users)
          .where(eq(users.id, request.user.id))
          .for("update");
        // requireAuth just loaded this user, so the row exists; a vanished
        // row here means the account was deleted mid-request.
        if (!current) throw httpError(401, "Authentication required.");
        const [row] = await tx
          .update(users)
          .set({ theme: request.body.theme, updatedAt: new Date() })
          .where(eq(users.id, request.user.id))
          .returning(userColumns);
        if (!row) throw httpError(401, "Authentication required.");
        if (row.theme !== current.theme) {
          await recordActivity(tx, {
            entityType: "user",
            entityId: row.id,
            actorId: row.id,
            action: "user.theme_changed",
            visibility: "admin_only",
            payload: { field: "theme", old: current.theme, new: row.theme },
          });
        }
        return row;
      });
      return { user };
    },
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

  app.get(
    "/auth/methods",
    {
      schema: {
        operationId: "getAuthMethods",
        summary:
          "What the login screen may offer (TECH-008): the auth mode, the " +
          "magic-link toggle, whether outbound email works, and the SSO " +
          "provider to start, if one is registered",
        tags: ["auth"],
        response: {
          200: z.object({
            mode: z.enum(AUTH_MODES),
            magicLinkEnabled: z.boolean(),
            /**
             * Whether the deployment can send mail at all. The login screen
             * hides the magic-link affordance when this is false, because a
             * link that can never be delivered is a dead end for the
             * requester. Deliberately says nothing about the DD-010 domain
             * allowlist: allowlist contents are org policy, and reflecting
             * them here would tell an anonymous visitor whether the portal
             * is open.
             */
            emailConfigured: z.boolean(),
            /** Slug of the provider the SSO button starts; null when none exists. */
            ssoProviderId: z.string().nullable(),
          }),
          default: problemResponse,
        },
      },
    },
    // Deliberately unauthenticated: the login screen has no session yet,
    // and everything here is visible on that screen anyway the moment it
    // renders. `emailConfigured` is global deployment configuration, the
    // same disclosure class as the magic-link toggle beside it. The
    // admin-only GET /auth/mode stays the management surface.
    async () => {
      const settings = await getOrgSettings(app.db);
      const [provider] = await app.db
        .select({ providerId: ssoProviders.providerId })
        .from(ssoProviders)
        .orderBy(ssoProviders.createdAt)
        .limit(1);
      return {
        mode: settings.authMode,
        magicLinkEnabled: settings.magicLinkEnabled,
        emailConfigured: app.mailer.configured,
        ssoProviderId: provider?.providerId ?? null,
      };
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

      // Logged after the fact: the row itself was written by better-auth
      // outside any transaction of ours, so exact atomicity is not on
      // offer here. Credentials never enter the payload.
      await recordActivity(app.db, {
        entityType: "system",
        actorId: request.user.id,
        action: "sso_provider.registered",
        visibility: "admin_only",
        payload: { providerId: provider.providerId, issuer: provider.issuer, domain },
      });

      return reply.status(201).send({
        provider,
        callbackUrl: registered.redirectURI,
      });
    },
  );

  app.get(
    "/auth/sso-providers",
    {
      preHandler: requireRole("administrator"),
      schema: {
        operationId: "listSsoProviders",
        summary:
          "The registered OIDC identity providers (TECH-008), with their " +
          "client IDs but never their secrets",
        tags: ["auth"],
        response: {
          200: z.object({
            providers: z.array(ProviderSchema.extend({ clientId: z.string().nullable() })),
          }),
          default: problemResponse,
        },
      },
    },
    async () => {
      const rows = await app.db.select().from(ssoProviders).orderBy(ssoProviders.createdAt);
      return {
        providers: rows.map((row) => ({
          id: row.id,
          providerId: row.providerId,
          issuer: row.issuer,
          domain: row.domain,
          clientId: oidcConfigOf(row).clientId ?? null,
        })),
      };
    },
  );

  app.patch(
    "/auth/sso-providers/:providerId",
    {
      preHandler: requireRole("administrator"),
      schema: {
        operationId: "updateSsoProvider",
        summary:
          "Update the registered provider (TECH-008): omitted fields keep " +
          "their stored values, endpoint discovery re-runs from the " +
          "issuer, and a failed update leaves the provider untouched",
        tags: ["auth"],
        params: z.object({ providerId: z.string() }),
        body: z
          .object({
            issuer: z.url().optional(),
            /** Email domain(s) the IdP serves; comma-separated for several. */
            domain: z.string().min(1).optional(),
            clientId: z.string().min(1).optional(),
            /** Omitted = keep the stored secret; present = rotate it. */
            clientSecret: z.string().min(1).optional(),
          })
          .refine((body) => Object.values(body).some((value) => value !== undefined), {
            message: "Provide at least one field to change.",
          }),
        response: {
          200: z.object({
            provider: ProviderSchema,
            /** The stable redirect URL to paste into the IdP console. */
            callbackUrl: z.string(),
          }),
          default: problemResponse,
        },
      },
    },
    async (request) => {
      // better-auth has no update endpoint, and registering over an
      // existing slug is refused — so an update is delete + re-register
      // (which re-runs discovery against the possibly-new issuer). The
      // advisory lock makes that sequence a cross-process critical
      // section, so two concurrent updates cannot interleave their
      // deletes and registrations; a caller that cannot take the lock
      // has raced another update and answers 409.
      const outcome = await tryWithAdvisoryLock(
        app.db,
        ADVISORY_LOCK.ssoProviderUpdate,
        async () => {
          const [existing] = await app.db
            .select()
            .from(ssoProviders)
            .where(eq(ssoProviders.providerId, request.params.providerId))
            .limit(1);
          if (!existing) throw httpError(404, "No identity provider is registered under this ID.");
          const stored = oidcConfigOf(existing);
          const clientId = request.body.clientId ?? stored.clientId;
          const clientSecret = request.body.clientSecret ?? stored.clientSecret;
          // A row whose stored config lost its credentials cannot fall
          // back to empty strings — that would re-register a provider
          // no IdP will ever accept.
          if (!clientId || !clientSecret) {
            throw httpError(
              400,
              "The stored provider is missing client credentials — provide clientId and " +
                "clientSecret to repair it.",
            );
          }
          const merged = {
            providerId: existing.providerId,
            issuer: request.body.issuer ?? existing.issuer,
            domain: (request.body.domain ?? existing.domain).toLowerCase(),
            clientId,
            clientSecret,
          };

          // The deleted row is put back verbatim if registration fails,
          // so a typo does not cost the org its working provider. (A
          // process crash between the delete and the restore can still
          // lose the row — the lock bounds concurrency, not crashes.)
          await app.db.delete(ssoProviders).where(eq(ssoProviders.id, existing.id));
          let registered: { redirectURI: string };
          try {
            registered = await withTrustedIssuerOrigin(app.auth, merged.issuer, () =>
              app.auth.api.registerSSOProvider({
                body: {
                  providerId: merged.providerId,
                  issuer: merged.issuer,
                  domain: merged.domain,
                  oidcConfig: { clientId: merged.clientId, clientSecret: merged.clientSecret },
                },
                headers: fromNodeHeaders(request.headers),
              }),
            );
          } catch (error) {
            try {
              await app.db.insert(ssoProviders).values(existing);
            } catch (restoreError) {
              // The registration error is the one the caller can act
              // on; a failed restore must not replace it.
              request.log.error({ err: restoreError }, "sso provider restore failed");
            }
            relayAuthError(error);
          }

          const [provider] = await app.db
            .update(ssoProviders)
            .set({ domainVerified: true, updatedAt: new Date() })
            .where(eq(ssoProviders.providerId, merged.providerId))
            .returning({
              id: ssoProviders.id,
              providerId: ssoProviders.providerId,
              issuer: ssoProviders.issuer,
              domain: ssoProviders.domain,
            });
          if (!provider) throw httpError(500, "The updated provider could not be read back.");

          const changes: { field: string; old: unknown; new: unknown }[] = [];
          if (provider.issuer !== existing.issuer) {
            changes.push({ field: "issuer", old: existing.issuer, new: provider.issuer });
          }
          if (provider.domain !== existing.domain) {
            changes.push({ field: "domain", old: existing.domain, new: provider.domain });
          }
          if (request.body.clientId !== undefined && request.body.clientId !== stored.clientId) {
            changes.push({ field: "clientId", old: stored.clientId, new: request.body.clientId });
          }
          // A provided secret counts as rotated — equality with the
          // stored one is not worth checking, and the value never
          // appears anywhere.
          if (request.body.clientSecret !== undefined) {
            changes.push({ field: "clientSecret", old: "[secret]", new: "[secret]" });
          }
          for (const change of changes) {
            await recordActivity(app.db, {
              entityType: "system",
              actorId: request.user.id,
              action: "sso_provider.updated",
              visibility: "admin_only",
              payload: { providerId: provider.providerId, ...change },
            });
          }

          return { provider, callbackUrl: registered.redirectURI };
        },
      );
      if (!outcome.acquired) {
        throw httpError(409, "Another provider update is in progress. Try again.");
      }
      return outcome.result;
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
      // archival and revocation are the tools for ending them. The flip
      // and its DD-017 entry commit together, old value lock-read so a
      // concurrent switch cannot make the audit trail lie.
      const mode = await app.db.transaction(async (tx) => {
        const [current] = await tx
          .select({ authMode: orgSettings.authMode })
          .from(orgSettings)
          .limit(1)
          .for("update");
        if (!current) throw httpError(500, "org_settings has no row to update.");
        if (current.authMode === request.body.mode) return current.authMode;
        const [row] = await tx
          .update(orgSettings)
          .set({ authMode: request.body.mode, updatedAt: new Date() })
          .returning({ mode: orgSettings.authMode });
        if (!row) throw httpError(500, "org_settings has no row to update.");
        await recordActivity(tx, {
          entityType: "system",
          actorId: request.user.id,
          action: "org_settings.updated",
          visibility: "admin_only",
          payload: { field: "authMode", old: current.authMode, new: row.mode },
        });
        return row.mode;
      });
      return { mode };
    },
  );

  app.get(
    "/auth/allowed-domains",
    {
      preHandler: requireRole("administrator"),
      schema: {
        operationId: "getAllowedDomains",
        summary: "The magic-link domain allowlist (DD-010); empty admits nobody",
        tags: ["auth"],
        response: {
          200: z.object({ domains: z.array(z.string()) }),
          default: problemResponse,
        },
      },
    },
    async () => {
      const settings = await getOrgSettings(app.db);
      return { domains: settings.allowedEmailDomains };
    },
  );

  app.put(
    "/auth/allowed-domains",
    {
      preHandler: requireRole("administrator"),
      schema: {
        operationId: "setAllowedDomains",
        summary:
          "Replace the magic-link domain allowlist (DD-010); the list is " +
          "normalised to lower case and enforced on the next request — an " +
          "empty list closes the portal to everyone",
        tags: ["auth"],
        body: z.object({ domains: z.array(AllowedDomainSchema).max(1000) }),
        response: {
          200: z.object({ domains: z.array(z.string()) }),
          default: problemResponse,
        },
      },
    },
    async (request) => {
      // Lower-casing first makes duplicates that differ only by case
      // collapse; the policy check is case-insensitive anyway, so the
      // stored list is just its canonical spelling.
      const domains = [...new Set(request.body.domains.map((domain) => domain.toLowerCase()))];
      const stored = await app.db.transaction(async (tx) => {
        const [current] = await tx
          .select({ domains: orgSettings.allowedEmailDomains })
          .from(orgSettings)
          .limit(1)
          .for("update");
        if (!current) throw httpError(500, "org_settings has no row to update.");
        // Order counts as change: the stored list is the canonical one.
        if (JSON.stringify(current.domains) === JSON.stringify(domains)) return current.domains;
        const [row] = await tx
          .update(orgSettings)
          .set({ allowedEmailDomains: domains, updatedAt: new Date() })
          .returning({ domains: orgSettings.allowedEmailDomains });
        if (!row) throw httpError(500, "org_settings has no row to update.");
        await recordActivity(tx, {
          entityType: "system",
          actorId: request.user.id,
          action: "org_settings.updated",
          visibility: "admin_only",
          payload: { field: "allowedEmailDomains", old: current.domains, new: row.domains },
        });
        return row.domains;
      });
      return { domains: stored };
    },
  );

  app.patch(
    "/auth/portal",
    {
      preHandler: requireRole("administrator"),
      schema: {
        operationId: "setMagicLinkEnabled",
        summary:
          "Open or close magic-link sign-in (DD-010's portal floor); takes " +
          "effect on the next request, independent of the domain allowlist",
        tags: ["auth"],
        body: z.object({ magicLinkEnabled: z.boolean() }),
        response: {
          200: z.object({ magicLinkEnabled: z.boolean() }),
          default: problemResponse,
        },
      },
    },
    async (request) => {
      const magicLinkEnabled = await app.db.transaction(async (tx) => {
        const [current] = await tx
          .select({ magicLinkEnabled: orgSettings.magicLinkEnabled })
          .from(orgSettings)
          .limit(1)
          .for("update");
        if (!current) throw httpError(500, "org_settings has no row to update.");
        if (current.magicLinkEnabled === request.body.magicLinkEnabled) {
          return current.magicLinkEnabled;
        }
        const [row] = await tx
          .update(orgSettings)
          .set({ magicLinkEnabled: request.body.magicLinkEnabled, updatedAt: new Date() })
          .returning({ magicLinkEnabled: orgSettings.magicLinkEnabled });
        if (!row) throw httpError(500, "org_settings has no row to update.");
        await recordActivity(tx, {
          entityType: "system",
          actorId: request.user.id,
          action: "org_settings.updated",
          visibility: "admin_only",
          payload: {
            field: "magicLinkEnabled",
            old: current.magicLinkEnabled,
            new: row.magicLinkEnabled,
          },
        });
        return row.magicLinkEnabled;
      });
      return { magicLinkEnabled };
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

      // Policy runs BEFORE issuance. The toggle and the mailer are global
      // configuration, so refusing loudly leaks nothing; the allowlist
      // check must not be observable, so the denied branch simply skips
      // issuance and falls through to the same 202.
      const settings = await getOrgSettings(app.db);
      if (!settings.magicLinkEnabled) {
        throw httpError(403, "Magic-link sign-in is disabled.");
      }
      // Uniformly, and before the allowlist check. With no mailer, the
      // send inside issuance throws — so checking later (or not at all)
      // would answer allowlisted addresses with an error and everyone
      // else with the neutral 202, handing an anonymous visitor exactly
      // the allowlist oracle DD-010's identical response exists to deny.
      if (!app.mailer.configured) {
        throw httpError(
          403,
          "Sign-in links are unavailable: this instance cannot send email. " +
            "Contact your administrator.",
        );
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
