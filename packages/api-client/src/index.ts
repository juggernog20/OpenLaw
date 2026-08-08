// SPDX-License-Identifier: AGPL-3.0-only

/**
 * @openlaw/api-client — typed client for the OpenLaw API.
 *
 * src/schema.ts is generated from apps/api/openapi.json via
 * `pnpm openapi` at the repo root; never edit it by hand.
 */

import createClient, { type ClientOptions } from "openapi-fetch";
import type { paths } from "./schema";

export type { paths, components } from "./schema";

export function createApiClient(options: ClientOptions = {}) {
  return createClient<paths>({ baseUrl: "/", ...options });
}

export type ApiClient = ReturnType<typeof createApiClient>;
