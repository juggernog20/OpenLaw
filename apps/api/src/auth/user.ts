// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Who is making a request, as everything below the route layer needs
 * them described (TECH-008, DD-013).
 *
 * It sits beside {@link ./guards.js} rather than inside it because
 * the two have different reach. The guard is a Fastify `preHandler`: it
 * reads the session, re-reads the role live, and so depends on the app
 * factory's own `FastifyInstance` augmentation. These are plain types,
 * and the rules that take them — the contract reach predicate, and the
 * notification audience built on it — are asked by the **worker** as
 * well as by the API, in a process that has no Fastify instance at all.
 *
 * Keeping the type here is what lets a job re-apply the confidentiality
 * predicate without dragging the request pipeline into a process that
 * serves no requests. `guards.ts` re-exports both names, so every
 * existing importer is unaffected.
 */

import type { Theme, UserRole } from "@openlaw/db";

export interface AuthenticatedUser {
  id: string;
  email: string;
  displayName: string;
  role: UserRole;
  theme: Theme;
  /** IANA zone override; null = use the browser's (DES-014). */
  timezone: string | null;
}

export interface AuthenticatedSession {
  id: string;
  expiresAt: Date;
}
