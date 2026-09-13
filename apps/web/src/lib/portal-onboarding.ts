// SPDX-License-Identifier: AGPL-3.0-only

/** SET-011 checks the first run before any Portal page loader can read its work. */

import { redirect, type LoaderFunction } from "react-router";
import { currentUser, type SessionUser } from "./session";

export function portalOnboardingRequired(user: SessionUser | null) {
  return user?.role === "business_user" && !user.portalOnboardingCompletedAt;
}

export function guardPortalLoader(loader: LoaderFunction): LoaderFunction {
  return async (args) => {
    const user = await currentUser();
    const path = new URL(args.request.url).pathname.replace(/\/+$/, "");
    if (portalOnboardingRequired(user) && path !== "/portal/onboarding") {
      throw redirect("/portal/onboarding");
    }
    return loader(args);
  };
}
