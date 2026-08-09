// SPDX-License-Identifier: AGPL-3.0-only

/**
 * better-auth React client (TECH-008). Talks to the handler mounted at
 * /api/auth on the same origin (Vite dev proxy in development, reverse
 * proxy in production), so no baseURL is configured and cookies just
 * work. `inferAdditionalFields` pulls the server instance's extra user
 * fields (role, displayName mapping) into the client types via a
 * monorepo type-only import — no server code reaches the bundle.
 */

import { createAuthClient } from "better-auth/react";
import {
  inferAdditionalFields,
  magicLinkClient,
  twoFactorClient,
} from "better-auth/client/plugins";
import { ssoClient } from "@better-auth/sso/client";
import type { Auth } from "@openlaw/api/auth";

export const authClient = createAuthClient({
  // Resolve fetch per call instead of capturing it at module load, so
  // tests can stub the global after this client exists.
  fetchOptions: {
    customFetchImpl: (input, init) => globalThis.fetch(input, init),
  },
  plugins: [
    inferAdditionalFields<Auth>(),
    magicLinkClient(),
    ssoClient(),
    // No onTwoFactorRedirect: the login screen reads `twoFactorRedirect`
    // off the sign-in response and navigates with the router instead of
    // a full page reload.
    twoFactorClient(),
  ],
});
