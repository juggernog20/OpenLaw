// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The counterparty search (DD-008, CTR-011, M8/4): the one read behind
 * the typeahead that puts an organization on a contract.
 *
 * It lives in its own module rather than under `/contracts` because the
 * counterparty is not the contract's property. Intake reuses this exact
 * read in M20/M21, and the enrichment surface a later milestone brings
 * will read it too. What the contract owns is the join, and that stays
 * on the contract routes.
 *
 * There is no create route here on purpose. A counterparty is born
 * inline, from a name typed into a contract's typeahead, inside the same
 * transaction that puts it on that contract (CTR-011) — so creation is
 * the contract route's, and this module only finds what already exists.
 *
 * Access is Member+, the same floor the contract surfaces stand on.
 */

import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";
import { asc, counterparties, ilike, isNull, and, sql } from "@openlaw/db";
import { requireRole } from "../../auth/guards.js";
import { escapeLikePattern } from "../../lib/like.js";
import { problemResponse } from "../../lib/problem.js";

/** The same Member+ floor the contract record stands on. */
const requireMember = requireRole("administrator", "legal_team_member");

/**
 * How many matches one search answers. A typeahead is read at a glance,
 * so a long list is not a better answer — it is the same answer with
 * more scrolling. Someone who cannot see what they want types more.
 */
const SEARCH_LIMIT = 20;

/** One counterparty as the typeahead draws it. The jurisdiction rides
 * along as the disambiguator: two organizations do share a name, and
 * "Delaware" beside one of them is what tells them apart. */
const CounterpartyOptionSchema = z.object({
  id: z.string(),
  name: z.string(),
  jurisdiction: z.string().nullable(),
});

export const counterpartiesRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get(
    "/counterparties",
    {
      preHandler: requireMember,
      schema: {
        operationId: "searchCounterparties",
        summary:
          "Find counterparties by name — the shared typeahead's read " +
          "(CTR-011), reused by contract intake. Archived counterparties " +
          "are never offered; an empty query answers the first names " +
          "alphabetically, so an unprompted typeahead still opens onto " +
          "something",
        tags: ["counterparties"],
        querystring: z.object({ query: z.string().trim().max(200).optional() }),
        response: {
          200: z.object({ counterparties: z.array(CounterpartyOptionSchema) }),
          default: problemResponse,
        },
      },
    },
    async (request) => {
      const term = request.query.query;
      const rows = await app.db
        .select({
          id: counterparties.id,
          name: counterparties.name,
          jurisdiction: counterparties.jurisdiction,
        })
        .from(counterparties)
        .where(
          and(
            // Archived is out of the picker, in with the record: this
            // read exists to be picked from (SET-003).
            isNull(counterparties.archivedAt),
            // Contains, not starts-with: "Helix" has to find "The Helix
            // Group", or the typeahead makes a duplicate of it.
            term ? ilike(counterparties.name, `%${escapeLikePattern(term)}%`) : undefined,
          ),
        )
        // Case-insensitive, as the name index is built: "iCloud Ltd"
        // files under I wherever the default collation would put it.
        .orderBy(asc(sql`lower(${counterparties.name})`), asc(counterparties.createdAt))
        .limit(SEARCH_LIMIT);
      return { counterparties: rows };
    },
  );
};
