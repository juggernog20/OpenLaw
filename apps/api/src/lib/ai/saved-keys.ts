// SPDX-License-Identifier: AGPL-3.0-only

/** Finds Saved keys by destination, including legacy URL spellings (SET-008). */

import { aiSavedKeys, and, eq, type Executor, type AiPreset, type AiProtocol } from "@openlaw/db";
import { normalizeAiBaseUrl } from "@openlaw/shared";

type Destination = { preset: AiPreset; protocol: AiProtocol; baseUrl: string };

/** Migrated rows may retain the old spelling of a URL. Compare both normalized values. */
export async function findSavedAiKey(db: Executor, destination: Destination) {
  const keys = await db
    .select()
    .from(aiSavedKeys)
    .where(
      and(
        eq(aiSavedKeys.preset, destination.preset),
        eq(aiSavedKeys.protocol, destination.protocol),
      ),
    );
  const baseUrl = normalizeAiBaseUrl(destination.baseUrl);
  return keys.find((key) => normalizeAiBaseUrl(key.baseUrl) === baseUrl);
}
