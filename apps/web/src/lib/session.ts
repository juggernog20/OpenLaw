// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Loader-side guard fetchers. The route guard (issue #9) is loaders
 * composing these two questions: is anyone signed in, and does the
 * instance have any user at all (first-run setup).
 */

import { api } from "./api";

export async function currentUser() {
  const { data, response } = await api.GET("/api/v1/me");
  if (data) return data.user;
  if (response.status === 401) return null;
  throw new Error(`The session check failed with status ${response.status}.`);
}

export async function needsSetup(): Promise<boolean> {
  const { data, response } = await api.GET("/api/v1/auth/setup");
  if (!data) throw new Error(`The setup check failed with status ${response.status}.`);
  return data.needsSetup;
}
