// SPDX-License-Identifier: AGPL-3.0-only

/**
 * DD-029 and TECH-035 key issuance through better-auth. The adapter retains expired
 * credentials, and mint uses the approval transaction rather than a pooled connection.
 */

import { betterAuth } from "better-auth";
import { apiKey } from "@better-auth/api-key";
import { drizzleAdapter } from "@better-auth/drizzle-adapter";
import { schema, type Executor, type Transaction } from "@openlaw/db";
import { uuidv7 } from "uuidv7";

export const API_KEY_PREFIX = "ol_";
export const apiKeyPlugin = () =>
  apiKey({
    defaultPrefix: API_KEY_PREFIX,
    enableSessionForAPIKeys: false,
    maximumNameLength: 200,
    minimumNameLength: 1,
    keyExpiration: { minExpiresIn: 1, maxExpiresIn: 365 },
  });

/** The plugin deletes expired keys during mint and verification. Keep them for the ledger. */
export function authAdapter(db: Executor) {
  const factory = drizzleAdapter(db, { provider: "pg", usePlural: true, schema });
  const wrapped: typeof factory = (options) => {
    const adapter = factory(options);
    return {
      ...adapter,
      delete: async (args) => {
        if (args.model !== "apikey") await adapter.delete(args);
      },
      deleteMany: async (args) => (args.model === "apikey" ? 0 : adapter.deleteMany(args)),
    };
  };
  return wrapped;
}

/** A transaction-local plugin instance keeps mint and approval on the same connection. */
export async function mintApiKey(
  tx: Transaction,
  input: { userId: string; name: string; lifetimeDays: number; secret: string; baseUrl: string },
) {
  const auth = betterAuth({
    secret: input.secret,
    baseURL: input.baseUrl,
    database: authAdapter(tx),
    user: { fields: { name: "displayName" } },
    advanced: { database: { generateId: () => uuidv7() } },
    plugins: [apiKeyPlugin()],
  });
  return auth.api.createApiKey({
    body: { userId: input.userId, name: input.name, expiresIn: input.lifetimeDays * 86400 },
  });
}
