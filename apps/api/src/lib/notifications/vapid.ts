// SPDX-License-Identifier: AGPL-3.0-only
import { eq, orgSettings, sql, type Db } from "@openlaw/db";
import webPush from "web-push";

export interface VapidDetails {
  publicKey: string;
  privateKey: string;
  subject: string;
}
export type VapidResolver = () => Promise<VapidDetails>;
export interface VapidEnv {
  publicKey?: string;
  privateKey?: string;
  smtpFrom?: string;
  smtpUrl?: string;
}

function subject(from: string | null | undefined, baseUrl: string): string {
  if (!from) return baseUrl;
  const address = /<([^<>]+)>/.exec(from)?.[1] ?? from.trim();
  return `mailto:${address}`;
}

/** Env pins the whole pair. Otherwise, the first caller creates it under the singleton lock. */
export function createVapidResolver(db: Db, env: VapidEnv, baseUrl: string): VapidResolver {
  if (Boolean(env.publicKey) !== Boolean(env.privateKey)) {
    throw new Error("VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY must be set together.");
  }
  return async () =>
    db.transaction(async (tx) => {
      const [settings] = await tx
        .select({
          id: orgSettings.id,
          publicKey: orgSettings.vapidPublicKey,
          privateKey: orgSettings.vapidPrivateKey,
          privateKeyStored: sql<boolean>`${orgSettings.vapidPrivateKey} is not null`,
          smtpFrom: orgSettings.smtpFrom,
        })
        .from(orgSettings)
        .limit(1)
        .for("update");
      if (!settings) throw new Error("org_settings has no row.");
      const contact = subject(env.smtpFrom || (env.smtpUrl ? null : settings.smtpFrom), baseUrl);
      if (env.publicKey && env.privateKey) {
        return { publicKey: env.publicKey, privateKey: env.privateKey, subject: contact };
      }
      if (settings.publicKey && settings.privateKey) {
        return { publicKey: settings.publicKey, privateKey: settings.privateKey, subject: contact };
      }
      // Preserve an unreadable or incomplete pair so the operator can restore its sealing key.
      if (settings.publicKey || settings.privateKeyStored) {
        throw new Error(
          "The stored VAPID pair is incomplete or unreadable. Check OPENLAW_SECRET_KEY.",
        );
      }
      const keys = webPush.generateVAPIDKeys();
      await tx
        .update(orgSettings)
        .set({ vapidPublicKey: keys.publicKey, vapidPrivateKey: keys.privateKey })
        .where(eq(orgSettings.id, settings.id));
      return { ...keys, subject: contact };
    });
}
