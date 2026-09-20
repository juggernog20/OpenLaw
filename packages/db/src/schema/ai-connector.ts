// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The one AI connector for this install (CTR-008, TECH-012).
 *
 * The connector is Organization configuration. It is read live before
 * each use, so a changed model or rotated key applies without a restart.
 * A unique index on a constant makes the singleton rule a database fact.
 */

import { AI_ANSWER_STYLES } from "@openlaw/shared";
import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { encryptedText } from "../secrets.js";
import { uuidPk } from "./helpers.js";

export const AI_PRESETS = [
  "anthropic",
  "openai",
  "azure_openai",
  "gemini",
  "openrouter",
  "groq",
  "ollama",
  "custom",
] as const;
export type AiPreset = (typeof AI_PRESETS)[number];

export const AI_PROTOCOLS = ["anthropic_messages", "openai_chat_completions", "gemini"] as const;
export type AiProtocol = (typeof AI_PROTOCOLS)[number];

/** Write-only Saved keys, retained when the connector is removed. */
export const aiSavedKeys = pgTable(
  "ai_saved_keys",
  {
    id: uuidPk(),
    preset: text("preset", { enum: AI_PRESETS }).notNull(),
    protocol: text("protocol", { enum: AI_PROTOCOLS }).notNull(),
    baseUrl: text("base_url").notNull(),
    apiKey: encryptedText("api_key").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    uniqueIndex("ai_saved_keys_destination_unique").on(table.preset, table.protocol, table.baseUrl),
    check(
      "ai_saved_keys_preset_check",
      sql`${table.preset} in ('anthropic', 'openai', 'azure_openai', 'gemini', 'openrouter', 'groq', 'ollama', 'custom')`,
    ),
    check(
      "ai_saved_keys_protocol_check",
      sql`${table.protocol} in ('anthropic_messages', 'openai_chat_completions', 'gemini')`,
    ),
  ],
);

export type AiSavedKey = typeof aiSavedKeys.$inferSelect;

export const aiConnector = pgTable(
  "ai_connector",
  {
    id: uuidPk(),
    preset: text("preset", { enum: AI_PRESETS }).notNull(),
    protocol: text("protocol", { enum: AI_PROTOCOLS }).notNull(),
    baseUrl: text("base_url").notNull(),
    /** The Saved key the connector sends; NULL means it sends none, as for keyless Ollama. */
    savedKeyId: text("saved_key_id").references(() => aiSavedKeys.id, { onDelete: "restrict" }),
    model: text("model").notNull(),
    answerStyle: text("answer_style", { enum: AI_ANSWER_STYLES }).notNull().default("sentence"),
    maxOutputTokens: integer("max_output_tokens").notNull().default(32768),
    contractConversionAnalysis: boolean("contract_conversion_analysis").notNull().default(false),
    contractPreparation: boolean("contract_preparation").notNull().default(false),
    matterPreparation: boolean("matter_preparation").notNull().default(false),
    disabledAt: timestamp("disabled_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    check(
      "ai_connector_answer_style_check",
      sql`${table.answerStyle} in ('few_words', 'sentence', 'full_clause')`,
    ),
    check(
      "ai_connector_output_tokens_check",
      sql`${table.maxOutputTokens} between 1024 and 262144`,
    ),
    uniqueIndex("ai_connector_singleton").on(sql`(true)`),
    check(
      "ai_connector_preset_check",
      sql`${table.preset} in ('anthropic', 'openai', 'azure_openai', 'gemini', 'openrouter', 'groq', 'ollama', 'custom')`,
    ),
    check(
      "ai_connector_protocol_check",
      sql`${table.protocol} in ('anthropic_messages', 'openai_chat_completions', 'gemini')`,
    ),
  ],
);

export type AiConnector = typeof aiConnector.$inferSelect;
