// SPDX-License-Identifier: AGPL-3.0-only

/** SET-011 checks the first run before any Portal page loader can read its work. */

import { redirect, type LoaderFunction } from "react-router";
import { currentUserFor, type SessionUser } from "./session";

export function portalOnboardingRequired(user: SessionUser | null) {
  return user?.role === "business_user" && !user.portalOnboardingCompletedAt;
}

/**
 * Wraps a Portal route's loader in the gate. A route with no loader of
 * its own still passes the gate, so adding one to the tree cannot leave
 * a Portal address ungated by accident.
 */
export function guardPortalLoader(loader?: LoaderFunction): LoaderFunction {
  return async (args) => {
    const user = await currentUserFor(args.request);
    const path = new URL(args.request.url).pathname.replace(/\/+$/, "");
    if (portalOnboardingRequired(user) && path !== "/portal/onboarding") {
      throw redirect("/portal/onboarding");
    }
    return loader ? loader(args) : null;
  };
}
