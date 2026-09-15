// SPDX-License-Identifier: AGPL-3.0-only

import { eq, users, type AuthenticationPolicy, type Executor, type UserRole } from "@openlaw/db";
import { getOrgSettings } from "../lib/org-settings.js";

export function authenticationPolicy(
  settings: Awaited<ReturnType<typeof getOrgSettings>>,
): AuthenticationPolicy {
  return (
    settings.authenticationPolicy ?? {
      legal: {
        password: settings.authMode === "built_in",
        magicLink: settings.magicLinkEnabled,
        sso: settings.authMode === "oidc",
        requireTwoFactor: settings.requireTwoFactor && settings.authMode === "built_in",
      },
      business: {
        password: settings.authMode === "built_in",
        magicLink: settings.magicLinkEnabled,
        sso: settings.authMode === "oidc",
        requireTwoFactor: false,
      },
    }
  );
}

export function optionsForRole(policy: AuthenticationPolicy, role: UserRole | undefined) {
  return role && role !== "business_user" ? policy.legal : policy.business;
}

export async function authenticationForEmail(db: Executor, email: string) {
  const settings = await getOrgSettings(db);
  const [user] = await db
    .select({ id: users.id, role: users.role, archivedAt: users.archivedAt })
    .from(users)
    .where(eq(users.email, email.toLowerCase()));
  return { settings, user, options: optionsForRole(authenticationPolicy(settings), user?.role) };
}
