// SPDX-License-Identifier: AGPL-3.0-only

import {
  AUTO_DOC_AUDIENCES,
  AUTO_DOC_FORMATS,
  and,
  isNull,
  ne,
  AUTO_DOC_STATES,
  autoDocs,
  asc,
  eq,
  sql,
} from "@openlaw/db";
import { z } from "zod";
import { httpError } from "../../lib/problem.js";
import { escapeLikePattern } from "../../lib/like.js";
import { NO_PERMISSION, type AuthenticatedUser } from "../../auth/guards.js";
import type { Db } from "@openlaw/db";
import type { AutoDoc } from "@openlaw/db";
import { portalAutoDocScope, portalWarningsFor, PORTAL_UNAVAILABLE } from "./portal-policy.js";

export const AutoDocListQuery = z.object({
  q: z.string().trim().max(200).optional(),
  state: z.enum([...AUTO_DOC_STATES, "all"]).optional(),
  audience: z.enum(AUTO_DOC_AUDIENCES).optional(),
  targetContractTypeId: z.string().min(1).optional(),
});
export const AutoDocRow = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  formats: z.enum(AUTO_DOC_FORMATS),
  coverNote: z.string().nullable(),
  state: z.enum(AUTO_DOC_STATES),
  templateDocumentId: z.string().nullable(),
  audience: z.enum(AUTO_DOC_AUDIENCES),
  acknowledgementText: z.string().nullable(),
  targetContractTypeId: z.string().nullable(),
  titlePattern: z.string().nullable(),
  fixedEntityId: z.string().nullable(),
  defaultLegalOwnerId: z.string().nullable(),
  publishedDocumentVersionId: z.string().nullable(),
  publishedFormVersionId: z.string().nullable(),
  publishedAt: z.iso.datetime().nullable(),
  archivedAt: z.iso.datetime().nullable(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});
export function rowView(row: AutoDoc) {
  return {
    ...row,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    publishedAt: row.publishedAt?.toISOString() ?? null,
    archivedAt: row.archivedAt?.toISOString() ?? null,
  };
}
function assertReader(user: AuthenticatedUser): void {
  if (user.role !== "administrator" && user.role !== "legal_team_member")
    throw httpError(403, NO_PERMISSION);
}
export async function listAutoDocs(
  db: Db,
  user: AuthenticatedUser,
  input: z.input<typeof AutoDocListQuery> = {},
) {
  assertReader(user);
  const query = AutoDocListQuery.parse(input);
  return {
    autoDocs: (
      await db
        .select()
        .from(autoDocs)
        .where(
          and(
            query.state === "all"
              ? undefined
              : query.state
                ? eq(autoDocs.state, query.state)
                : ne(autoDocs.state, "archived"),
            query.audience ? eq(autoDocs.audience, query.audience) : undefined,
            query.targetContractTypeId
              ? query.targetContractTypeId === "none"
                ? isNull(autoDocs.targetContractTypeId)
                : eq(autoDocs.targetContractTypeId, query.targetContractTypeId)
              : undefined,
            query.q ? sql`${autoDocs.name} ilike ${`%${escapeLikePattern(query.q)}%`}` : undefined,
          ),
        )
        .orderBy(asc(sql`lower(${autoDocs.name})`), asc(autoDocs.id))
    ).map((row) => AutoDocRow.parse(rowView(row))),
  };
}
export async function listPortalAutoDocs(db: Db, user: AuthenticatedUser) {
  const rows = await db
    .select()
    .from(autoDocs)
    .where(and(eq(autoDocs.state, "published"), portalAutoDocScope(user)))
    .orderBy(asc(autoDocs.name), asc(autoDocs.id));
  const warnings =
    user.role === "business_user" ? await portalWarningsFor(db, rows) : new Map<string, string[]>();
  return {
    autoDocs: rows.map((row) => {
      const ready = !warnings.get(row.id)?.length;
      return {
        id: row.id,
        name: row.name,
        description: row.description,
        formats: row.formats,
        createsContract: row.targetContractTypeId !== null,
        availability: { ready, message: ready ? null : PORTAL_UNAVAILABLE },
      };
    }),
  };
}
