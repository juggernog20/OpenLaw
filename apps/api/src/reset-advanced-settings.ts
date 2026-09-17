// SPDX-License-Identifier: AGPL-3.0-only
/** Operator recovery when a saved address or storage configuration needs replacement. */
import { recordActivity } from "./lib/activity.js";
import { randomUUID } from "node:crypto";
import { createDb, orgSettings, readSecretKeys, sql, useSecretKeys } from "@openlaw/db";
import {
  parseSettings,
  sectionIds,
  sections,
  type SectionId,
} from "./modules/advanced-settings/config.js";

const section = process.argv[2];
if (!sectionIds.includes(section as SectionId) || process.argv.length !== 3) {
  console.error(
    "Usage: node apps/api/dist/reset-advanced-settings.js <instance|uploads|storage|processing>",
  );
  process.exitCode = 1;
} else {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required.");
  useSecretKeys(readSecretKeys(process.env));
  const db = createDb(process.env.DATABASE_URL);
  try {
    await db.transaction(async (tx) => {
      const [row] = await tx
        .select({
          raw: orgSettings.advancedSettings,
          present: sql<boolean>`${orgSettings.advancedSettings} is not null`,
        })
        .from(orgSettings)
        .for("update");
      if (!row) throw new Error("Organization settings are unavailable.");
      const saved = parseSettings(row.raw, row.present);
      for (const key of sections[section as SectionId]) delete saved.values[key];
      await tx.update(orgSettings).set({
        advancedSettings: JSON.stringify({ ...saved, version: randomUUID() }),
      });
      await recordActivity(tx, {
        entityType: "system",
        action: "org_settings.updated",
        visibility: "admin_only",
        payload: {
          field: `advanced.${section}`,
          old: "[configuration]",
          new: "[deployment defaults restored by operator; restart required]",
        },
      });
    });
    console.log(
      `Saved ${section} overrides removed. Restart both app and worker to use their deployment configuration.`,
    );
  } finally {
    await db.$client.end();
  }
}
