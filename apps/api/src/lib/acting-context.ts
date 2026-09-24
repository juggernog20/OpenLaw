// SPDX-License-Identifier: AGPL-3.0-only

/**
 * MCP credential attribution follows its asynchronous execution (TECH-035).
 * Only entries whose actor matches the scoped user inherit the Client.
 */
import { AsyncLocalStorage } from "node:async_hooks";
import type { AuthenticatedUser } from "../auth/user.js";

const actors = new AsyncLocalStorage<AuthenticatedUser>();

/** Scope attribution to this execution, including nested transactions. */
export function withActingUser<T>(user: AuthenticatedUser, work: () => T): T {
  return actors.run(user, work);
}

/** System events and acts by another person do not inherit the Client. */
export function activityViaFor(actorId: string | null | undefined) {
  const user = actors.getStore();
  return actorId && actorId === user?.id ? user.via : undefined;
}
