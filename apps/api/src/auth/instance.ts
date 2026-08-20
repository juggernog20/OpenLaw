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
import { admin, magicLink, twoFactor } from "better-auth/plugins";
import { userAc } from "better-auth/plugins/admin/access";
import { APIError, createAuthMiddleware, getSessionFromCtx } from "better-auth/api";
import { drizzleAdapter } from "@better-auth/drizzle-adapter";
import { sso } from "@better-auth/sso";
import { hash, verify } from "@node-rs/argon2";
import { uuidv7 } from "uuidv7";
import { eq, schema, ssoProviders, users, type Db } from "@openlaw/db";
import type { MailerResolver } from "../lib/mailer.js";
import { getOrgSettings, isEmailDomainAllowed } from "../lib/org-settings.js";
import { createProfileAuditHook } from "./audit.js";

/** The slice of the app's pino logger the auth instance needs. */
export interface AuthLogger {
  warn: (context: Record<string, unknown>, message: string) => void;
}

export interface AuthConfig {
  secret: string;
  baseUrl: string;
  /**
   * Turns better-auth's rate limiter off (TECH-018). The E2E suite reruns
   * sign-in flows far faster than any human, from one shared IP, so the
   * dev overlay sets this on the persistent instance; a real deployment
   * never should.
   */
  disableRateLimit?: boolean;
}

/** OWASP-recommended Argon2id parameters (19 MiB, t=2, p=1). */
const ARGON2 = { memoryCost: 19456, timeCost: 2, parallelism: 1 };

/** The endpoint context better-auth's session reader demands; the
 * before-hook's context satisfies it. */
type AuthHookContext = Parameters<typeof getSessionFromCtx>[0];

/** The email a sign-in body carries; a missing or non-string one becomes
 * "", which matches no account and no allowed domain. */
function bodyEmail(value: unknown): string {
  return typeof value === "string" ? value : "";
}

const AVATAR_PATTERN = /^data:image\/(png|jpeg);base64,[A-Za-z0-9+/]+={0,2}$/;

/**
 * better-auth's own /update-user validates nothing beyond "is a string",
 * so the Profile pane's contract (SET-006; the mock promises "JPG or
 * PNG, 1 MB max") is enforced here — the one door every update-user call
 * passes through. The avatar cap bounds the users row, like the org
 * logo's (SET-001).
 */
function assertProfileUpdate(body: { name?: unknown; image?: unknown }): void {
  const { name, image } = body;
  if (name !== undefined && (typeof name !== "string" || !name.trim() || name.length > 200)) {
    throw new APIError("BAD_REQUEST", { message: "Display name must be 1–200 characters." });
  }
  if (
    image !== undefined &&
    image !== null &&
    (typeof image !== "string" || image.length > 1_400_000 || !AVATAR_PATTERN.test(image))
  ) {
    throw new APIError("BAD_REQUEST", {
      message: "Avatar must be a PNG or JPEG data: URI of at most 1 MB.",
    });
  }
}

/**
 * SSO provider management is an Administrator-only surface. The plugin's
 * own endpoints only demand *a* session, which in OpenLaw would let any
 * Business User stand up an IdP for a domain or read provider configs
 * (client secret included) — provider management is authorization, not
 * just authentication. Gating in the hook covers the raw HTTP path and
 * our typed route alike (the route forwards the admin's headers).
 * Sign-in and callback paths stay open — they are the login flow itself.
 */
const SSO_MANAGEMENT_PATHS = new Set([
  "/sso/register",
  "/sso/update-provider",
  "/sso/delete-provider",
  "/sso/get-provider",
  "/sso/providers",
  "/sso/request-domain-verification",
  "/sso/verify-domain",
]);

async function assertAdministrator(ctx: AuthHookContext): Promise<void> {
  const session = await getSessionFromCtx(ctx);
  const role = (session?.user as { role?: string } | undefined)?.role;
  if (role !== "administrator") {
    throw new APIError("FORBIDDEN", {
      message: "Only Administrators can manage SSO providers.",
    });
  }
}

/**
 * Auth-mode semantics (TECH-008): in `oidc` mode the IdP is the front
 * door, so password sign-in closes — except for Administrators, whose
 * break-glass is never disabled (a broken or misconfigured IdP must not
 * lock the org out of the install that configures it). Unknown emails
 * get the same refusal as non-administrators, so the response never
 * reveals whether an account exists. The lookup is by our lowercased
 * email column; sign-in bodies arrive in whatever case the user typed.
 */
async function assertPasswordSignIn(db: Db, email: string): Promise<void> {
  const settings = await getOrgSettings(db);
  if (settings.authMode !== "oidc") return;
  const [account] = await db
    .select({ role: users.role })
    .from(users)
    .where(eq(users.email, email.toLowerCase()))
    .limit(1);
  if (account?.role !== "administrator") {
    throw new APIError("FORBIDDEN", {
      message: "Password sign-in is disabled while single sign-on is required.",
    });
  }
}

const MAGIC_LINK_PATHS = new Set(["/sign-in/magic-link", "/magic-link/verify"]);

/**
 * Policy holds on better-auth's own magic-link paths, not just our typed
 * route — direct calls meet the same rules. Guarding verify as well as
 * issuance means flipping the toggle off takes effect immediately,
 * including for links already in flight; domains are not re-checked at
 * verify because a redeemable token can only have been issued through
 * the allowlist, moments earlier (5-min TTL) — JIT creation re-checks in
 * the databaseHook regardless.
 *
 * Resolves true when issuance was denied by the allowlist: the caller
 * mirrors the endpoint's success shape for it, so responses never reveal
 * whether a domain is allowlisted.
 */
async function magicLinkDenied(
  db: Db,
  resolveMailer: MailerResolver,
  path: string,
  email: string,
): Promise<boolean> {
  const settings = await getOrgSettings(db);
  if (!settings.magicLinkEnabled) {
    throw new APIError("FORBIDDEN", { message: "Magic-link sign-in is disabled." });
  }
  if (path !== "/sign-in/magic-link") return false;
  // An instance with no resolved mailer cannot issue at all, so refuse
  // uniformly here — ahead of the allowlist branch below. Were this
  // check missing, the send would throw for allowlisted addresses only,
  // and the denied branch's mimicked success would become a reliable
  // allowlist oracle. Verify is deliberately left alone: a token in
  // flight was issued while mail still worked, and refusing it would
  // strand a link the requester already holds.
  const { mailer } = await resolveMailer();
  if (!mailer.configured) {
    throw new APIError("FORBIDDEN", {
      message:
        "Sign-in links are unavailable: this instance cannot send email. " +
        "Contact your administrator.",
    });
  }
  return !isEmailDomainAllowed(email, settings.allowedEmailDomains);
}

/**
 * Runs `fn` with the issuer's origin temporarily added to better-auth's
 * trusted origins, so registration-time endpoint discovery from a
 * runtime-supplied issuer passes the sso plugin's SSRF guard — TECH-008
 * configures IdPs at runtime, so there is no boot-time list to put an
 * issuer on. Direct `auth.api` calls run against the boot context (the
 * per-request `trustedOrigins` function below is only re-evaluated on
 * the HTTP handler path), so the boot context's live array is what must
 * gain the origin; it is removed again even when `fn` throws. Concurrent
 * requests during the window can observe the origin — accepted: it is an
 * origin an Administrator is in the act of asserting as the org's IdP,
 * and no isolated per-call context is reachable through the public API.
 * After registration the provider row itself carries the trust.
 */
export async function withTrustedIssuerOrigin<T>(
  auth: Auth,
  issuer: string,
  fn: () => Promise<T>,
): Promise<T> {
  const origin = new URL(issuer).origin;
  const ctx = await auth.$context;
  ctx.trustedOrigins.push(origin);
  try {
    return await fn();
  } finally {
    const index = ctx.trustedOrigins.lastIndexOf(origin);
    if (index >= 0) ctx.trustedOrigins.splice(index, 1);
  }
}

// The resolver, not a fixed mailer (#37): every send resolves the
// current configuration, so an SMTP relay saved through the wizard is
// used by the very next email with no restart.
export function createAuth(
  db: Db,
  config: AuthConfig,
  resolveMailer: MailerResolver,
  logger: AuthLogger,
) {
  return betterAuth({
    appName: "OpenLaw",
    baseURL: config.baseUrl,
    secret: config.secret,
    ...(config.disableRateLimit ? { rateLimit: { enabled: false } } : {}),
    database: drizzleAdapter(db, { provider: "pg", usePlural: true, schema }),
    // Registered providers' issuer origins stay trusted so the plugin can
    // re-run endpoint discovery after registration if it ever needs to;
    // the table is only consulted on SSO paths to keep the extra query
    // off every other auth request. Registration-time trust is separate —
    // see `withTrustedIssuerOrigin` (the row does not exist yet).
    trustedOrigins: async (request) => {
      const origins: string[] = [];
      // Matches /sign-in/sso as well as every /sso/* route.
      if (request && new URL(request.url).pathname.includes("/sso")) {
        const rows = await db.select({ issuer: ssoProviders.issuer }).from(ssoProviders);
        for (const row of rows) {
          try {
            origins.push(new URL(row.issuer).origin);
          } catch {
            // A malformed issuer trusts nothing.
          }
        }
      }
      return origins;
    },
    account: {
      accountLinking: {
        // An SSO identity may link to a pre-existing user row that never
        // proved its inbox: in SSO-mode installs invited staff sign in
        // through the IdP without ever activating a password. Safe here
        // because OpenLaw has no public sign-up — every local row is
        // admin-created or inbox-proven, so the squatted-unverified-
        // account risk this default guards against cannot arise.
        requireLocalEmailVerified: false,
      },
    },
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
        const { mailer } = await resolveMailer();
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
          const { mailer } = await resolveMailer();
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
      // TECH-008's bring-your-own IdP: generic OIDC, registered at
      // runtime through our admin-guarded route (endpoint discovery from
      // the issuer happens inside the plugin's register endpoint). 2FA
      // deliberately does not gate SSO — the IdP owns MFA there.
      sso({
        // One stable callback URL shared by every provider — this is what
        // an Administrator pastes into the IdP console (resolved under
        // the /api/auth prefix; the provider travels in the OAuth state).
        redirectURI: "/sso/callback",
        // Staff SSO is invite-only: a sign-in only creates a user when
        // the login flow explicitly requests it (requestSignUp), and even
        // then the databaseHook below applies DD-010's matrix.
        disableImplicitSignUp: true,
        // The plugin links a provider identity to a pre-existing user by
        // email only when the provider is domain-verified. OpenLaw marks
        // the row verified at registration: in a single-tenant install,
        // an Administrator registering the provider IS the domain-trust
        // decision. The DNS-TXT endpoints this feature carries stay
        // admin-gated (hook below) and unused.
        domainVerification: { enabled: true },
      }),
      // TOTP second factor for password accounts (TECH-008). Enrolment,
      // disable, and backup-code regeneration all demand the password
      // again on top of a session; the challenge hook only watches
      // /sign-in/email, so SSO and magic-link sign-ins are never gated —
      // deliberate: the IdP owns MFA for SSO, and a magic link already
      // proves inbox control. Codes ride the plugin's own budget pair:
      // five wrong codes void the challenge, and the account-level
      // lockout below caps consecutive failures across challenges. The
      // TOTP seed and backup codes are stored encrypted with the auth
      // secret. The e-mail OTP fallback is not configured (no sendOTP),
      // so TOTP and backup codes are the only second factors.
      twoFactor({
        // The plugin's defaults, pinned so a dependency bump cannot
        // silently relax the lockout (NIST SP 800-63B §5.2.2 allows far
        // stricter; 10-in-a-row is generous enough to never lock out a
        // fumbling human on a phone keyboard).
        accountLockout: {
          enabled: true,
          maxFailedAttempts: 10,
          durationSeconds: 15 * 60,
        },
      }),
    ],
    hooks: {
      // One door per policy: the dispatch below says which paths each
      // guard owns, and the guards above say what they enforce and why.
      before: createAuthMiddleware(async (ctx) => {
        if (ctx.path === "/update-user") {
          assertProfileUpdate((ctx.body ?? {}) as { name?: unknown; image?: unknown });
          return;
        }
        if (SSO_MANAGEMENT_PATHS.has(ctx.path)) {
          await assertAdministrator(ctx);
          return;
        }
        if (ctx.path === "/sign-in/email") {
          await assertPasswordSignIn(db, bodyEmail(ctx.body?.email));
          return;
        }
        if (
          MAGIC_LINK_PATHS.has(ctx.path) &&
          (await magicLinkDenied(db, resolveMailer, ctx.path, bodyEmail(ctx.body?.email)))
        ) {
          return ctx.json({ status: true });
        }
      }),
      // DD-017 audit entries for the profile mutations better-auth owns
      // (SET-006) — see ./audit.ts for what is recorded and why here.
      after: createProfileAuditHook(db),
    },
    databaseHooks: {
      session: {
        create: {
          // Archival takes effect at the door: an archived user is
          // rejected the moment any flow tries to mint them a session —
          // password (including the post-2FA-challenge session), SSO
          // callback, and magic-link redemption all funnel through here.
          // Sessions that already exist are untouched (archival is not
          // revocation; DD-013 keeps archived users readable history).
          // The read and the insert are not one transaction — a sign-in
          // racing the archival UPDATE can still slip a session through.
          // Accepted: such a session is indistinguishable from one minted
          // a moment before archival, which also survives; both end at
          // the session-revocation surface, the actual tool for cutting
          // someone off. Enforcement stays in the app layer per this
          // repo's no-database-triggers convention (SCHEMA.md).
          before: async (session) => {
            const [row] = await db
              .select({ archivedAt: users.archivedAt })
              .from(users)
              .where(eq(users.id, session.userId))
              .limit(1);
            if (row?.archivedAt) {
              // Coded so the browser-facing SSO callback redirects to the
              // app's error page instead of dumping bare JSON.
              throw new APIError("FORBIDDEN", {
                message: "This account has been archived.",
                code: "USER_ARCHIVED",
              });
            }
          },
          // The durable "last active" stamp behind the Users list
          // (SET-005). Written on session create and refresh rather than
          // computed from live session rows, which sign-out deletes —
          // "signed out an hour ago" must not read as "never signed in".
          // Granularity: every sign-in, plus one refresh per updateAge.
          // Best-effort by design: the stamp is display data, so a
          // failed write must never reject the sign-in it rode on.
          after: async (session) => {
            try {
              await db
                .update(users)
                .set({ lastActiveAt: new Date() })
                .where(eq(users.id, session.userId));
            } catch (error) {
              // Losing one stamp is invisible; failing a sign-in is not.
              // Logged so a persistent failure is not equally invisible.
              logger.warn({ err: error, userId: session.userId }, "last-active stamp failed");
            }
          },
        },
        update: {
          after: async (session) => {
            // The adapter's update hook receives a partial row; only a
            // session-refresh update (it always moves expiresAt) counts
            // as user activity.
            if (session.userId && session.expiresAt) {
              try {
                await db
                  .update(users)
                  .set({ lastActiveAt: new Date() })
                  .where(eq(users.id, session.userId));
              } catch (error) {
                // Same best-effort contract as the create stamp above.
                logger.warn({ err: error, userId: session.userId }, "last-active stamp failed");
              }
            }
          },
        },
      },
      user: {
        create: {
          // The DD-010 provisioning matrix for users born from a sign-in
          // rather than setup or an invite. Both JIT paths — magic-link
          // redemption and SSO callback — admit unknown identities only
          // as Business Users on an allowed domain, checked here because
          // policy may have changed since issuance / provider setup.
          // Other creation paths (setup, invites) are untouched.
          before: async (user, ctx) => {
            const path = ctx?.path ?? "";

            if (path === "/magic-link/verify") {
              const settings = await getOrgSettings(db);
              if (
                !settings.magicLinkEnabled ||
                !isEmailDomainAllowed(user.email, settings.allowedEmailDomains)
              ) {
                throw new APIError("FORBIDDEN", {
                  message: "This email address is not eligible for portal access.",
                });
              }
              return {
                data: {
                  ...user,
                  email: user.email.toLowerCase(),
                  name: user.name || user.email,
                  role: "business_user",
                },
              };
            }

            // SSO half of the matrix: unknown + allowlisted domain → JIT
            // Business User; unknown + non-allowlisted → rejected (IdP
            // membership alone grants nothing). Staff never pass through
            // here — their rows pre-exist, so the plugin links and signs
            // in without a create. Born verified: the IdP authenticated
            // control of the mailbox-owning account.
            if (path.startsWith("/sso/callback")) {
              const settings = await getOrgSettings(db);
              if (!isEmailDomainAllowed(user.email, settings.allowedEmailDomains)) {
                // The `code` matters: the SSO callback redirects coded
                // APIErrors back to the app's error page; an uncoded one
                // would surface as a bare JSON response mid-browser-flow.
                throw new APIError("FORBIDDEN", {
                  message: "This email address is not eligible for portal access.",
                  code: "EMAIL_DOMAIN_NOT_ALLOWED",
                });
              }
              return {
                data: {
                  ...user,
                  email: user.email.toLowerCase(),
                  name: user.name || user.email,
                  role: "business_user",
                  emailVerified: true,
                },
              };
            }
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

/**
 * The issuer better-auth 1.7 gives a password account.
 *
 * From 1.7 an account is identified by (`issuer`, `account_id`) rather
 * than by its provider id. A method with no issuer of its own gets a
 * synthetic one, `local:<provider id>`, and the library builds this exact
 * string wherever it looks a credential row up — `findCredentialAccount`
 * and `updatePassword` both filter on it.
 *
 * It is written here rather than imported because `@better-auth/core`,
 * which exports the builder, is a transitive dependency we would then
 * have to keep in lockstep for one constant — and because migration
 * 0060 has to spell the same value in SQL, where nothing can be
 * imported at all. The two are pinned together by the setup and
 * migration suites: get it wrong and no password sign-in works.
 */
export const CREDENTIAL_ISSUER = "local:credential";

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
  const created = await ctx.internalAdapter.createUser(
    {
      email: user.email.toLowerCase(),
      name: user.displayName,
      emailVerified: true,
    },
    // The provisioning origin 1.7 asks for. It only feeds the optional
    // `user.validateUserInfo` gate, which this install does not
    // configure; the value still has to be truthful, and the one caller
    // in production is first-run setup asserting an address with a
    // password of its own.
    { method: "email-password" },
  );
  await ctx.internalAdapter.linkAccount({
    userId: created.id,
    providerId: "credential",
    // 1.7 keys an account on (issuer, accountId) rather than on the
    // provider id. Local methods carry a synthetic issuer, and
    // better-auth's own credential lookups — `findCredentialAccount`
    // and `updatePassword` — filter on exactly this value, so a row
    // without it can never sign in or change its password.
    issuer: CREDENTIAL_ISSUER,
    accountId: created.id,
    password: passwordHash,
  });
  return { id: created.id };
}
