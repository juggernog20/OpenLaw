// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The one AI connector for this install (CTR-008, TECH-012).
 *
 * The connector is Organization configuration. It is read live before
 * each use, so a changed model or rotated key applies without a restart.
 * A unique index on a constant makes the singleton rule a database fact.
 */

import { sql } from "drizzle-orm";
import { check, pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { encryptedText } from "../secrets.js";
import { uuidPk } from "./helpers.js";

export const AI_PRESETS = [
  "anthropic",
  "openai",
  "azure_openai",
  "gemini",
  "openrouter",
  "ollama",
  "custom",
] as const;
export type AiPreset = (typeof AI_PRESETS)[number];

export const AI_PROTOCOLS = ["anthropic_messages", "openai_chat_completions", "gemini"] as const;
export type AiProtocol = (typeof AI_PROTOCOLS)[number];

export const aiConnector = pgTable(
  "ai_connector",
  {
    id: uuidPk(),
    preset: text("preset", { enum: AI_PRESETS }).notNull(),
    protocol: text("protocol", { enum: AI_PROTOCOLS }).notNull(),
    baseUrl: text("base_url").notNull(),
    /** Write-only through the API and sealed under TECH-022. Ollama may leave it NULL. */
    apiKey: encryptedText("api_key"),
    model: text("model").notNull(),
    disabledAt: timestamp("disabled_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    uniqueIndex("ai_connector_singleton").on(sql`(true)`),
    check(
      "ai_connector_preset_check",
      sql`${table.preset} in ('anthropic', 'openai', 'azure_openai', 'gemini', 'openrouter', 'ollama', 'custom')`,
    ),
    check(
      "ai_connector_protocol_check",
      sql`${table.protocol} in ('anthropic_messages', 'openai_chat_completions', 'gemini')`,
    ),
  ],
);

export type AiConnector = typeof aiConnector.$inferSelect;
