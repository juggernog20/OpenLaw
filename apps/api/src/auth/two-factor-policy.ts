// SPDX-License-Identifier: AGPL-3.0-only

import { eq, sessions, users, type Executor } from "@openlaw/db";
import { httpError } from "../lib/problem.js";
import { getOrgSettings } from "../lib/org-settings.js";
import { authenticationPolicy, optionsForRole } from "./authentication-policy.js";

export const TWO_FACTOR_SETUP_REQUIRED = "/problems/two-factor-setup-required";
export const TWO_FACTOR_VERIFICATION_REQUIRED = "/problems/two-factor-verification-required";

export async function readTwoFactorPolicy(db: Executor, userId: string, sessionId?: string) {
  const [user] = await db
    .select({ role: users.role, enabled: users.twoFactorEnabled })
    .from(users)
    .where(eq(users.id, userId));
  if (!user) throw httpError(401, "Authentication required.");
  const required = optionsForRole(
    authenticationPolicy(await getOrgSettings(db)),
    user.role,
  ).requireTwoFactor;
  const [session] = sessionId
    ? await db
        .select({ verified: sessions.secondFactorVerified })
        .from(sessions)
        .where(eq(sessions.id, sessionId))
    : [];
  return {
    required,
    setupRequired: required && user.enabled !== true,
    verificationRequired: required && user.enabled === true && !!sessionId && !session?.verified,
  };
}
