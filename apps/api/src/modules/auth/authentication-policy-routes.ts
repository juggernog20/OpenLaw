// SPDX-License-Identifier: AGPL-3.0-only

/** TECH-008 group policies and password setup. Administrators edit policies; unauthenticated callers request or redeem an email-ownership proof before Business User creation (DD-013). */

import { randomBytes, createHash } from "node:crypto";
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { fromNodeHeaders } from "better-auth/node";
import { z } from "zod";
import {
  accounts,
  and,
  eq,
  gt,
  ilike,
  sql,
  orgSettings,
  ssoProviders,
  users,
  verifications,
} from "@openlaw/db";
import {
  authenticationForEmail,
  authenticationPolicy,
  optionsForRole,
} from "../../auth/authentication-policy.js";
import { requireRole } from "../../auth/guards.js";
import { clientAddress, consumeAuthRequestBudget } from "../../auth/limits.js";
import { getOrgSettings, isEmailDomainAllowed } from "../../lib/org-settings.js";
import { recordActivity } from "../../lib/activity.js";
import { httpError, problemResponse } from "../../lib/problem.js";

export const AuthenticationOptionsSchema = z
  .object({
    password: z.boolean(),
    magicLink: z.boolean(),
    sso: z.boolean(),
    requireTwoFactor: z.boolean(),
  })
  .strict();
export const AuthenticationPolicySchema = z.object({
  legal: AuthenticationOptionsSchema,
  business: AuthenticationOptionsSchema,
});
const tokenIdentifier = (token: string) =>
  `business-password:${createHash("sha256").update(token).digest("hex")}`;

export const authenticationPolicyRoutes: FastifyPluginAsyncZod = async (app) => {
  app.patch(
    "/auth/policy/:group",
    {
      preHandler: requireRole("administrator"),
      schema: {
        operationId: "setAuthenticationPolicy",
        tags: ["auth"],
        params: z.object({ group: z.enum(["legal", "business"]) }),
        body: AuthenticationOptionsSchema,
        response: { 200: AuthenticationPolicySchema, default: problemResponse },
      },
    },
    async (request) => {
      const options = request.body;
      if (!options.password && !options.magicLink && !options.sso)
        throw httpError(400, "Enable at least one sign-in method.");
      if (
        options.sso &&
        !(await app.db.select({ id: ssoProviders.id }).from(ssoProviders).limit(1)).length
      )
        throw httpError(400, "Configure an identity provider before enabling single sign-on.");
      return app.db.transaction(async (tx) => {
        const [settings] = await tx.select().from(orgSettings).for("update");
        if (!settings) throw httpError(500, "Organization settings are unavailable.");
        const previous = authenticationPolicy(settings);
        const next = { ...previous, [request.params.group]: options };
        if (JSON.stringify(previous) !== JSON.stringify(next)) {
          await tx
            .update(orgSettings)
            .set({ authenticationPolicy: next, updatedAt: new Date() })
            .where(eq(orgSettings.id, settings.id));
          await recordActivity(tx, {
            entityType: "system",
            actorId: request.user.id,
            action: "org_settings.updated",
            visibility: "admin_only",
            payload: {
              field:
                request.params.group === "legal" ? "legalAuthentication" : "businessAuthentication",
              old: previous[request.params.group],
              new: options,
            },
          });
        }
        return next;
      });
    },
  );

  app.post(
    "/auth/password-setup",
    {
      schema: {
        operationId: "requestPasswordSetup",
        tags: ["auth"],
        body: z.object({ email: z.email() }),
        response: { 202: z.object({ message: z.string() }), default: problemResponse },
      },
    },
    async (request, reply) => {
      const email = request.body.email.toLowerCase();
      const now = new Date();
      // The shared budget (TECH-032): counted in the database so every
      // replica sees it, and before any eligibility question so the
      // refusal says nothing about the address.
      const allowed = await consumeAuthRequestBudget(app.db, {
        route: "password-setup",
        email,
        address: clientAddress(request, app.trustedProxies),
      });
      if (!allowed) throw httpError(429, "Too many password setup requests. Try again later.");
      const { settings, user, options } = await authenticationForEmail(app.db, email);
      const { mailer } = await app.resolveMailer();
      if (!mailer.configured)
        throw httpError(503, "Email is not configured. Contact your administrator.");
      if ((options.password || user?.role === "administrator") && !user?.archivedAt) {
        if (user) {
          await app.auth.api.requestPasswordReset({
            body: { email },
            headers: fromNodeHeaders(request.headers),
          });
        } else if (isEmailDomainAllowed(email, settings.allowedEmailDomains)) {
          const token = `business.${randomBytes(32).toString("hex")}`;
          const verification = await app.db.transaction(async (tx) => {
            await tx.execute(
              sql`select pg_advisory_xact_lock(hashtext(${`business-password-email:${email}`}))`,
            );
            const [pending] = await tx
              .select({ id: verifications.id })
              .from(verifications)
              .where(
                and(
                  eq(verifications.value, email),
                  ilike(verifications.identifier, "business-password:%"),
                  gt(verifications.expiresAt, now),
                ),
              );
            if (pending) return undefined;
            const [created] = await tx
              .insert(verifications)
              .values({
                identifier: tokenIdentifier(token),
                value: email,
                expiresAt: new Date(now.getTime() + 3600000),
              })
              .returning({ id: verifications.id });
            return created;
          });
          if (!verification)
            return reply.status(202).send({
              message: "If the address is eligible, a password setup link is on its way.",
            });
          const context = await app.auth.$context;
          const origin = new URL(context.baseURL).origin;
          try {
            // The token rides in the URL fragment, which a browser never
            // sends, so no request log holds a live token (TECH-032).
            await mailer.send({
              to: email,
              subject: "Set your OpenLaw password",
              text: `Set your OpenLaw password using the link below:\n\n${origin}/auth/set-password#token=${token}\n\nThe link expires in one hour. If you did not expect this email, you can ignore it.`,
            });
          } catch (error) {
            await app.db.delete(verifications).where(eq(verifications.id, verification.id));
            throw error;
          }
        }
      }
      return reply
        .status(202)
        .send({ message: "If the address is eligible, a password setup link is on its way." });
    },
  );

  app.post(
    "/auth/password-setup/complete",
    {
      schema: {
        operationId: "completePasswordSetup",
        tags: ["auth"],
        body: z.object({ token: z.string().max(200), password: z.string().min(8).max(128) }),
        response: { 200: z.object({ success: z.boolean() }), default: problemResponse },
      },
    },
    async (request) => {
      // Argon2 costs 19 MiB and two passes per call, so an anonymous
      // caller must not be able to buy one with a made-up token. The
      // address budget is spent first, and the hash is computed only
      // once the token has been found live and locked (TECH-032).
      if (
        !(await consumeAuthRequestBudget(app.db, {
          route: "password-setup-complete",
          address: clientAddress(request, app.trustedProxies),
        }))
      )
        throw httpError(429, "Too many password setup requests. Try again later.");
      await app.db.transaction(async (tx) => {
        const [verification] = await tx
          .select()
          .from(verifications)
          .where(eq(verifications.identifier, tokenIdentifier(request.body.token)))
          .for("update");
        if (!verification || verification.expiresAt <= new Date())
          throw httpError(400, "This link has expired or was already used. Ask for a new one.");
        const settings = await getOrgSettings(tx);
        const [existing] = await tx.select().from(users).where(eq(users.email, verification.value));
        if (
          !optionsForRole(authenticationPolicy(settings), existing?.role).password ||
          existing?.archivedAt ||
          (!existing && !isEmailDomainAllowed(verification.value, settings.allowedEmailDomains))
        )
          throw httpError(403, "Password setup is no longer available for this address.");
        // A simultaneous invite or verified sign-in owns the account that now exists.
        // Ask for a fresh reset link rather than changing that account through a signup token.
        if (existing)
          throw httpError(409, "An account already exists. Request a new password setup link.");
        const hash = await (await app.auth.$context).password.hash(request.body.password);
        const [created] = await tx
          .insert(users)
          .values({
            email: verification.value,
            displayName: verification.value,
            role: "business_user",
            emailVerified: true,
          })
          .returning();
        await tx.insert(accounts).values({
          userId: created!.id,
          accountId: created!.id,
          providerId: "credential",
          password: hash,
        });
        await tx
          .delete(verifications)
          .where(
            and(
              eq(verifications.id, verification.id),
              eq(verifications.identifier, tokenIdentifier(request.body.token)),
            ),
          );
      });
      return { success: true };
    },
  );
};
