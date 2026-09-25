// SPDX-License-Identifier: AGPL-3.0-only
import { betterAuth } from "better-auth";
import type { Transaction } from "@openlaw/db";
import type { Auth } from "./instance.js";
import { authAdapter } from "./api-keys.js";
import { oauthPlugins } from "./oauth.js";

/** Client management and DCR commit the protocol row and its audit together. */
export function transactionalOAuth(auth: Auth, tx: Transaction) {
  const provider = auth.options.plugins.find((plugin) => plugin.id === "oauth-provider");
  const lifetime = provider?.options.refreshTokenExpiresIn;
  const lifetimeDays = typeof lifetime === "number" ? lifetime / 86_400 : 90;
  return betterAuth({
    ...auth.options,
    database: authAdapter(tx),
    plugins: [
      ...auth.options.plugins.filter(
        (p) => !["jwt", "oauth-provider", "cimd", "allowed-clients"].includes(p.id),
      ),
      ...oauthPlugins(String(auth.options.baseURL), lifetimeDays, tx),
    ],
  });
}
