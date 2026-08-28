// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Loader-side guard fetchers. The route guard (issue #9) is loaders
 * composing these two questions: is anyone signed in, and does the
 * instance have any user at all (first-run setup).
 */

import { redirect, useNavigate } from "react-router";

import { api } from "./api";
import { authClient } from "./auth-client";
import { configureFormatting } from "./format";

export async function currentUser() {
  const { data, response } = await api.GET("/api/v1/me");
  if (data) {
    // DES-014 seeding lives here, not in a component: render must stay
    // pure, and every guarded route resolves this loader before its
    // first component formats a date. A timezone change re-runs it via
    // the pane's revalidation.
    configureFormatting({ timeZone: data.user.timezone ?? null });
    return data.user;
  }
  if (response.status === 401) return null;
  throw new Error(`The session check failed with status ${response.status}.`);
}

export async function needsSetup(): Promise<boolean> {
  const { data, response } = await api.GET("/api/v1/auth/setup");
  if (!data) throw new Error(`The setup check failed with status ${response.status}.`);
  return data.needsSetup;
}

export type SessionUser = NonNullable<Awaited<ReturnType<typeof currentUser>>>;

/**
 * Loader guard. Returns the signed-in user, or throws a redirect to
 * setup (no user exists yet) or login. react-router turns the thrown
 * Response into the navigation, so the loader stops on this line.
 */
export async function requireUser(): Promise<SessionUser> {
  const user = await currentUser();
  if (!user) throw redirect((await needsSetup()) ? "/auth/setup" : "/auth/login");
  return user;
}

/**
 * Returns a sign-out callback for the shell. Ends the better-auth
 * session, then replaces the current history entry with `to`.
 */
export function useSignOut(to: string): () => Promise<void> {
  const navigate = useNavigate();
  return async () => {
    await authClient.signOut();
    void navigate(to, { replace: true });
  };
}
