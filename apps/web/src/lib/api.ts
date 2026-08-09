// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The typed OpenAPI client for our own /api/v1 routes. Auth *flows*
 * (sign-in, TOTP, reset) go through the better-auth client instead —
 * the two surfaces are parallel by design (TECH-008).
 */

import { createApiClient } from "@openlaw/api-client";

// Absolute base (Node's Request rejects relative URLs, and tests run on
// Node's fetch primitives), same-origin either way; fetch resolved per
// call rather than captured at module load, so tests can stub the global
// after this client exists.
export const api = createApiClient({
  baseUrl: window.location.origin,
  fetch: (request) => globalThis.fetch(request),
});
