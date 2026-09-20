// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Loader-side guard fetchers. The route guard (issue #9) is loaders
 * composing these two questions: is anyone signed in, and does the
 * instance have any user at all (first-run setup).
 */

import { redirect, useNavigate } from "react-router";

import { unsubscribeDevice } from "./device-notifications";
import { api } from "./api";
import { authClient } from "./auth-client";
import { configureFormatting } from "./format";

export async function currentUser({ allowTwoFactorSetup = false, allowEmailSetup = false } = {}) {
  const { data, response } = await api.GET("/api/v1/me");
  if (data) {
    if (data.user.twoFactorSetupRequired && !allowTwoFactorSetup)
      throw redirect(
        data.user.role === "business_user"
          ? "/auth/two-factor/enroll?portal=1"
          : "/auth/two-factor/enroll",
      );
    if (data.user.twoFactorVerificationRequired && !allowTwoFactorSetup)
      throw redirect(
        data.user.role === "business_user" ? "/auth/two-factor?portal=1" : "/auth/two-factor",
      );
    if (data.user.emailSetupRequired && !allowEmailSetup) throw redirect("/welcome");
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
 * One `/me` per navigation. A guarded portal route asks twice, once in
 * the gate and once in the page loader it wraps, and the answer carries
 * the avatar data: URI, which runs to about 1.4 MB. Both calls share the
 * loader's Request, so the promise is keyed on it. The next navigation
 * brings a Request of its own.
 */
const perRequest = new WeakMap<Request, Promise<SessionUser | null>>();

export function currentUserFor(request: Request): Promise<SessionUser | null> {
  let asked = perRequest.get(request);
  if (!asked) {
    asked = currentUser();
    perRequest.set(request, asked);
  }
  return asked;
}

/**
 * Loader guard. Returns the signed-in user, or throws a redirect to
 * setup (no user exists yet) or login. react-router turns the thrown
 * Response into the navigation, so the loader stops on this line.
 */
export async function requireUser(
  options?: Parameters<typeof currentUser>[0],
): Promise<SessionUser> {
  const user = await currentUser(options);
  if (!user) throw redirect((await needsSetup()) ? "/auth/setup" : "/auth/login");
  return user;
}

/**
 * Returns a sign-out callback for the shell. Ends the better-auth
 * session, unsubscribes this browser from device notifications
 * (DES-089), then replaces the current history entry with `to`.
 */
export function useSignOut(to: string): () => Promise<void> {
  const navigate = useNavigate();
  return async () => {
    // The session request goes out in the click's own task. Awaiting a
    // browser API first moves it to a later task, and a navigation that
    // lands in between leaves the person signed in. The browser
    // unsubscribe needs no session, so the two run side by side.
    const ended = authClient.signOut();
    ended.catch(() => {});
    let cleanupTimer: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        unsubscribeDevice(),
        new Promise<void>((resolve) => {
          cleanupTimer = setTimeout(resolve, 3_000);
        }),
      ]);
    } catch {
      /* Session deletion also revokes server delivery. */
    } finally {
      clearTimeout(cleanupTimer);
    }
    await ended;
    void navigate(to, { replace: true });
  };
}
