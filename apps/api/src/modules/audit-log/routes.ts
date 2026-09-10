// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The Administrator's audit log (M9/7, DD-017) — the second read surface
 * over `activity_log`, and the one that answers "who did that."
 *
 * The administrator role permits this surface, including admin-only settings
 * and security events. Record and document audience checks still apply to
 * legal work, both on the page and in exports.
 *
 * Per SET-002 the pane is **absent** from the settings rail for everyone
 * else rather than shown and refused. These routes still refuse them:
 * the rail is a courtesy and the 403 is the enforcement.
 *
 * **Filters compose.** Actor, action, entity type, and date range each
 * narrow the set, and every combination of them narrows it further —
 * they are one `AND` over one predicate, built once and shared by the
 * page, the count, and the export, so the three can never disagree
 * about what "the current filter" means. Search is the fifth term, for
 * the reader who does not know which filter their entry falls under.
 *
 * **It pages, from the first release** (DD-017's implementation
 * clarification). This is the largest table in the system and it only
 * grows. Paging is the record feed's convention, unchanged: keyset on
 * `(created_at, id)`, a server-fixed page size, a cursor that is one
 * entry's id, and no total in the envelope. A cursor naming no row
 * answers an empty page rather than an error.
 *
 * **The export is itself a security event** (DD-017). Taking one
 * appends an `export.performed` entry at `admin_only` naming the
 * filters it was taken under, because data leaving the system has to be
 * accounted for like anything else. The export streams the filtered set
 * and nothing else: it is bounded above by its own entry, so an export
 * never contains the record of itself and two exports of the same
 * filter answer the same rows.
 *
 * **Read-only, and only read.** The one write here is the export's own
 * entry, through the same door every other entry goes through. DD-017
 * forbids `UPDATE` and `DELETE` on `activity_log` in application code,
 * and the surface built to show an auditor an append-only log is the
 * last place to add the first one.
 */

import { Readable } from "node:stream";
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";
import {
  ACTIVITY_ENTITY_TYPES,
  ACTIVITY_VISIBILITIES,
  activityLog,
  contracts,
  contractTeam,
  matterTeam,
  entityGrants,
  matters,
  entities,
  documents,
  inArray,
  and,
  desc,
  eq,
  gte,
  ilike,
  knowledgeItems,
  lte,
  or,
  requests,
  sql,
  users,
  type ActivityEntityType,
  type Db,
  type SQL,
} from "@openlaw/db";
import { contractTeamScope, documentAudienceScope } from "../../lib/contract-access.js";
import { matterTeamScope } from "../../lib/matter-access.js";
import { entityReachScope } from "../../lib/entity-access.js";
import type { AuthenticatedUser } from "../../auth/user.js";
import { requireRole } from "../../auth/guards.js";
import { recordActivity } from "../../lib/activity.js";
import { problemResponse } from "../../lib/problem.js";

/** SET-002: every Organization surface is Administrator-only, and this
 * is the one that reads every other one's entries. */
const requireAdministrator = requireRole("administrator");

/**
 * How many entries one page answers. A server constant rather than a
 * client parameter, for the record feed's reason: the point of paging
 * here is that no request returns the whole table, and a limit the
 * client picks is a limit the client can decline to pick. It is larger
 * than the feed's page because this surface is a table an auditor scans
 * rather than a panel beside a record.
 */
const PAGE_SIZE = 50;

/** How many rows the export reads per round trip. The export answers a
 * filtered set of unbounded size, so it walks the same keyset the pages
 * do rather than holding the whole answer in memory. */
const EXPORT_CHUNK = 500;

/** An id as this API bounds one: opaque text, no shape asserted. The
 * record feed says the same thing about the same column. */
const IdSchema = z.string().min(1).max(64);

/**
 * What a reader can narrow the log by. Every field is optional and every
 * field composes with the rest.
 */
const FilterSchema = z.object({
  /** One person's entries — "what did this Administrator do?" */
  actorId: IdSchema.optional(),
  /**
   * One action slug, exactly. Open text rather than an enum for the
   * reason the response's `action` is: the write vocabulary is closed,
   * but the table is append-only and nothing prunes it, so a slug
   * written by a version of this application that no longer exists is
   * still in the table and still has to be selectable. The pane offers
   * the slugs the log actually holds.
   */
  action: z.string().min(1).max(64).optional(),
  /** Contract history against user administration, and so on. */
  entityType: z.enum(ACTIVITY_ENTITY_TYPES).optional(),
  /** Inclusive lower bound on when the entry was written. */
  from: z.iso.datetime({ offset: true }).optional(),
  /** Inclusive upper bound. */
  to: z.iso.datetime({ offset: true }).optional(),
  /** Free text, for the reader who does not know which filter their
   * entry falls under. */
  q: z.string().min(1).max(200).optional(),
});

type Filters = z.infer<typeof FilterSchema>;

/** The actor as every surface draws them — one face, one rendering
 * (DES-018). */
const ActorSchema = z.object({
  id: z.string(),
  displayName: z.string(),
  image: z.string().nullable(),
  archived: z.boolean(),
});

/** The name a record goes by. Contracts, Matters, and Requests carry a
 * number; an Entity, Document, or Knowledge Item has a title alone. */
const EntityRefSchema = z.object({
  number: z.number().int().nullable(),
  title: z.string(),
});

type EntityRef = z.infer<typeof EntityRefSchema>;

const AuditEntrySchema = z.object({
  id: z.string(),
  /**
   * The action slug, as plain text rather than as an enum, exactly as
   * the record feed types it. Nothing constrains this column — the
   * closed vocabulary lives in the compiler, not in the database — so a
   * slug this build has never heard of can be in the table, and a
   * closed enum here would have the response serializer throw on it.
   * The narration layer renders an unrecognised slug plainly.
   */
  action: z.string(),
  /** Constrained by a CHECK, so an unlisted value cannot be in the
   * table. That is why these two are enums where `action` is not. */
  entityType: z.enum(ACTIVITY_ENTITY_TYPES),
  visibility: z.enum(ACTIVITY_VISIBILITIES),
  /** The record the entry hangs off. NULL for a `system` entry, which
   * is about no single record. */
  entityId: z.string().nullable(),
  /**
   * What a person calls the record `entityId` names: the reference
   * number where the record has one, and its title. NULL for a `system`
   * or `user` entry, and for a record since hard-deleted. Resolved for
   * the Administrator reading this surface, who reaches every record
   * (DD-013), so no confidentiality wall applies here.
   */
  entityRef: EntityRefSchema.nullable(),
  /** Who acted. NULL for a system-emitted event with no human actor. */
  actor: ActorSchema.nullable(),
  createdAt: z.iso.datetime({ offset: true }),
  /** The action's own data, untyped by design: each slug carries its
   * own shape, the shapes are as old as the rows, and the narration
   * layer reads them defensively. No comment text is ever in here
   * (CMT-006). */
  payload: z.record(z.string(), z.unknown()),
});

/** The columns every read of this table projects. */
const entryColumns = {
  id: activityLog.id,
  action: activityLog.action,
  entityType: activityLog.entityType,
  entityId: activityLog.entityId,
  visibility: activityLog.visibility,
  createdAt: activityLog.createdAt,
  payload: activityLog.payload,
  actor: {
    id: users.id,
    displayName: users.displayName,
    email: users.email,
    image: users.image,
    archivedAt: users.archivedAt,
  },
} as const;

/** One row as the projection above answers it, taken from the query
 * rather than restated — a second statement of these columns is a
 * second thing to keep in step. */
type EntryRow = Awaited<ReturnType<typeof selectEntries>>[number];

/**
 * A `LIKE` pattern that matches the reader's text and nothing cleverer.
 *
 * `%` and `_` are wildcards to Postgres and letters to the person who
 * typed them. Searching for `user_` must not quietly match `users`, so
 * both are escaped, along with the backslash that escapes them.
 */
function containsPattern(term: string): string {
  return `%${term.replaceAll("\\", "\\\\").replaceAll("%", "\\%").replaceAll("_", "\\_")}%`;
}

/**
 * The one predicate behind the page, the count, and the export.
 *
 * Every term is an `AND`, so the filters compose: an actor and an action
 * and a date range narrow to the entries that satisfy all three. Search
 * is one `OR` across the fields a reader would search — what was done,
 * who did it, which record it was done to, and what the entry recorded —
 * and joins the rest as one more `AND` term.
 */
function auditPredicate(filters: Filters): SQL | undefined {
  const terms: (SQL | undefined)[] = [];
  if (filters.actorId) terms.push(eq(activityLog.actorId, filters.actorId));
  if (filters.action) terms.push(eq(activityLog.action, filters.action));
  if (filters.entityType) terms.push(eq(activityLog.entityType, filters.entityType));
  if (filters.from) terms.push(gte(activityLog.createdAt, new Date(filters.from)));
  if (filters.to) terms.push(lte(activityLog.createdAt, new Date(filters.to)));
  if (filters.q) {
    const pattern = containsPattern(filters.q);
    terms.push(
      or(
        ilike(activityLog.action, pattern),
        ilike(activityLog.entityId, pattern),
        ilike(users.displayName, pattern),
        ilike(users.email, pattern),
        // The payload is where an entry keeps the names and values it
        // was about — an email on a role change, a display name on an
        // archive. A reader searching for a person finds the entries
        // naming them, not only the ones they acted on.
        sql`${activityLog.payload}::text ilike ${pattern}`,
      ),
    );
  }
  return and(...terms);
}

/**
 * The keyset boundary: everything strictly older than one entry, in the
 * order this surface reads. `(created_at, id)` is the record feed's
 * cursor pair, and the id breaks a same-instant tie — uuidv7 is
 * time-ordered, so that order is still the order things happened in.
 *
 * The boundary's own position comes from the table rather than from the
 * client, so a client cannot hand over a timestamp that was never
 * written. An id naming no row leaves the comparison NULL, which
 * answers an empty page.
 */
function olderThan(entryId: string, reach?: SQL): SQL {
  return sql`(${activityLog.createdAt}, ${activityLog.id}) < (
    select ${activityLog.createdAt}, ${activityLog.id}
    from ${activityLog}
    where ${and(eq(activityLog.id, entryId), reach)}
  )`;
}

/** Audit access does not bypass a record's confidential audience. */
function auditReachScope(db: Db, user: AuthenticatedUser): SQL | undefined {
  const documentIds = db
    .select({ id: documents.id })
    .from(documents)
    .leftJoin(contracts, eq(documents.contractId, contracts.id))
    .leftJoin(matters, eq(documents.matterId, matters.id))
    .leftJoin(entities, eq(documents.entityId, entities.id))
    .where(
      and(
        documentAudienceScope(db, user),
        or(
          and(sql`${documents.contractId} is not null`, contractTeamScope(db, user)),
          and(sql`${documents.matterId} is not null`, matterTeamScope(db, user)),
          and(sql`${documents.entityId} is not null`, entityReachScope(db, user)),
          sql`${documents.knowledgeItemId} is not null`,
        ),
      ),
    );
  const recordScope = or(
    sql`${activityLog.entityType} not in ('contract', 'matter', 'entity', 'document')`,
    and(
      eq(activityLog.entityType, "contract"),
      inArray(
        activityLog.entityId,
        db.select({ id: contracts.id }).from(contracts).where(contractTeamScope(db, user)),
      ),
    ),
    and(
      eq(activityLog.entityType, "matter"),
      inArray(
        activityLog.entityId,
        db.select({ id: matters.id }).from(matters).where(matterTeamScope(db, user)),
      ),
    ),
    and(
      eq(activityLog.entityType, "entity"),
      inArray(
        activityLog.entityId,
        db.select({ id: entities.id }).from(entities).where(entityReachScope(db, user)),
      ),
    ),
    and(eq(activityLog.entityType, "document"), inArray(activityLog.entityId, documentIds)),
  );
  const namedOnRecord = or(
    and(
      eq(activityLog.entityType, "contract"),
      inArray(
        activityLog.entityId,
        db
          .select({ id: contracts.id })
          .from(contracts)
          .where(
            or(
              eq(contracts.managerId, user.id),
              inArray(
                contracts.id,
                db
                  .select({ id: contractTeam.contractId })
                  .from(contractTeam)
                  .where(eq(contractTeam.userId, user.id)),
              ),
            ),
          ),
      ),
    ),
    and(
      eq(activityLog.entityType, "matter"),
      inArray(
        activityLog.entityId,
        db
          .select({ id: matters.id })
          .from(matters)
          .where(
            or(
              eq(matters.managerId, user.id),
              inArray(
                matters.id,
                db
                  .select({ id: matterTeam.matterId })
                  .from(matterTeam)
                  .where(eq(matterTeam.userId, user.id)),
              ),
            ),
          ),
      ),
    ),
    and(
      eq(activityLog.entityType, "entity"),
      inArray(
        activityLog.entityId,
        db
          .select({ id: entityGrants.entityId })
          .from(entityGrants)
          .where(eq(entityGrants.userId, user.id)),
      ),
    ),
  );
  const documentReference = (key: string) =>
    or(
      namedOnRecord,
      sql`${activityLog.payload} ->> ${key} is null`,
      inArray(sql<string>`${activityLog.payload} ->> ${key}`, documentIds),
    );
  return and(recordScope, documentReference("documentId"), documentReference("fromDocumentId"));
}

/** One page of the log, newest first, under a predicate. */
function selectEntries(db: Db, where: SQL | undefined, limit: number) {
  return (
    db
      .select(entryColumns)
      .from(activityLog)
      // Left, because an entry with no human actor is a real entry — and
      // because the search's actor terms have to be readable from the
      // same row whether or not one is joined.
      .leftJoin(users, eq(activityLog.actorId, users.id))
      .where(where)
      .orderBy(desc(activityLog.createdAt), desc(activityLog.id))
      .limit(limit)
  );
}

/** The key one record's name is filed under. Typed, so two tables
 * cannot answer for one id. */
function refKey(entityType: string, entityId: string): string {
  return `${entityType}:${entityId}`;
}

/**
 * The names of the records one page's entries hang off, in one read
 * per entity type rather than one per row.
 *
 * Only the types that have a name are read. A `user` entry's subject
 * is already named in its payload, and a `system` entry is about no
 * record. An id naming no row, because the record was hard-deleted,
 * is left out and the entry answers NULL.
 */
async function resolveEntityRefs(
  db: Db,
  rows: readonly EntryRow[],
): Promise<Map<string, EntityRef>> {
  const idsOf = (entityType: ActivityEntityType): string[] => [
    ...new Set(
      rows.flatMap((row) =>
        row.entityType === entityType && row.entityId !== null ? [row.entityId] : [],
      ),
    ),
  ];
  const reads: Promise<{ id: string; number: number | null; title: string }[]>[] = [];
  const types: ActivityEntityType[] = [];
  const read = <T extends { id: string; number: number | null; title: string }>(
    entityType: ActivityEntityType,
    select: (ids: string[]) => Promise<T[]>,
  ) => {
    const ids = idsOf(entityType);
    if (ids.length === 0) return;
    types.push(entityType);
    reads.push(select(ids));
  };
  read("contract", (ids) =>
    db
      .select({ id: contracts.id, number: contracts.number, title: contracts.title })
      .from(contracts)
      .where(inArray(contracts.id, ids)),
  );
  read("matter", (ids) =>
    db
      .select({ id: matters.id, number: matters.number, title: matters.title })
      .from(matters)
      .where(inArray(matters.id, ids)),
  );
  read("request", (ids) =>
    db
      .select({ id: requests.id, number: requests.number, title: requests.summary })
      .from(requests)
      .where(inArray(requests.id, ids)),
  );
  read("document", (ids) =>
    db
      .select({ id: documents.id, number: sql<null>`null`, title: documents.title })
      .from(documents)
      .where(inArray(documents.id, ids)),
  );
  read("entity", (ids) =>
    db
      .select({ id: entities.id, number: sql<null>`null`, title: entities.legalName })
      .from(entities)
      .where(inArray(entities.id, ids)),
  );
  read("knowledge_item", (ids) =>
    db
      .select({ id: knowledgeItems.id, number: sql<null>`null`, title: knowledgeItems.title })
      .from(knowledgeItems)
      .where(inArray(knowledgeItems.id, ids)),
  );
  const refs = new Map<string, EntityRef>();
  const answers = await Promise.all(reads);
  answers.forEach((found, index) => {
    for (const row of found) {
      refs.set(refKey(types[index]!, row.id), { number: row.number, title: row.title });
    }
  });
  return refs;
}

/** One row, as the API answers it. The export passes no names: its
 * columns are the row's own, and the id is what it carries. */
function toEntry(row: EntryRow, refs?: ReadonlyMap<string, EntityRef>) {
  return {
    id: row.id,
    action: row.action,
    entityType: row.entityType,
    entityId: row.entityId,
    entityRef:
      row.entityId === null ? null : (refs?.get(refKey(row.entityType, row.entityId)) ?? null),
    visibility: row.visibility,
    actor:
      row.actor?.id && row.actor.displayName !== null
        ? {
            id: row.actor.id,
            displayName: row.actor.displayName,
            image: row.actor.image,
            archived: row.actor.archivedAt !== null,
          }
        : null,
    createdAt: row.createdAt.toISOString(),
    payload: row.payload,
  };
}

/** The CSV header, and the order every row follows. */
const CSV_COLUMNS = [
  "id",
  "created_at",
  "action",
  "entity_type",
  "entity_id",
  "visibility",
  "actor_id",
  "actor_name",
  "actor_email",
  "payload",
] as const;

/**
 * One CSV field, quoted per RFC 4180 and defused for a spreadsheet.
 *
 * Everything is quoted, and an embedded quote is doubled. A value
 * opening with `=`, `+`, `-`, `@`, a tab, or a carriage return is
 * prefixed with an apostrophe: this file is handed to an auditor who
 * opens it in a spreadsheet, and a display name of `=1+1` is a formula
 * there. The apostrophe is visible in the cell text, which is the honest
 * trade — an audit export must not execute, and it must not silently
 * drop what it could not carry.
 */
function csvField(value: unknown): string {
  const text = value === null || value === undefined ? "" : String(value);
  const defused = /^[=+\-@\t\r]/.test(text) ? `'${text}` : text;
  return `"${defused.replaceAll('"', '""')}"`;
}

function csvRow(values: readonly unknown[]): string {
  return `${values.map(csvField).join(",")}\r\n`;
}

export const auditLogRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get(
    "/audit-log",
    {
      preHandler: requireAdministrator,
      schema: {
        operationId: "listAuditLog",
        summary:
          "The system-wide audit log (DD-017), newest first: reachable entries " +
          "across entity types and tiers, including the " +
          "`admin_only` settings, user administration, and security " +
          "entries that no record feed carries. Administrator-only " +
          "(SET-002). Actor, action, entity type, date range, and search " +
          "compose. Each entry names the record it hangs off in " +
          "`entityRef`, where the record has a number or a title. Paged " +
          "from a server-fixed page size: pass the previous page's " +
          "`nextCursor` to read further back",
        tags: ["audit-log"],
        querystring: FilterSchema.extend({
          /** The previous page's `nextCursor`. Omit for the first page. */
          cursor: IdSchema.optional(),
        }),
        response: {
          200: z.object({
            entries: z.array(AuditEntrySchema),
            /** Pass back as `cursor` for the next page. NULL when this
             * page is the end of the log. */
            nextCursor: z.string().nullable(),
          }),
          default: problemResponse,
        },
      },
    },
    async (request) => {
      const { cursor, ...filters } = request.query;
      const where = and(
        auditPredicate(filters),
        auditReachScope(app.db, request.user),
        cursor === undefined ? undefined : olderThan(cursor, auditReachScope(app.db, request.user)),
      );
      // One past the page, which is how the answer knows whether there
      // is more without counting anything.
      const rows = await selectEntries(app.db, where, PAGE_SIZE + 1);
      const page = rows.slice(0, PAGE_SIZE);
      const refs = await resolveEntityRefs(app.db, page);
      return {
        entries: page.map((row) => toEntry(row, refs)),
        // Only when a further row was actually read. A cursor on the
        // last page would send the client for an empty one.
        nextCursor: rows.length > PAGE_SIZE ? (page.at(-1)?.id ?? null) : null,
      };
    },
  );

  app.get(
    "/audit-log/actions",
    {
      preHandler: requireAdministrator,
      schema: {
        operationId: "listAuditLogActions",
        summary:
          "The action slugs the log actually holds, ascending — the " +
          "vocabulary the action filter offers. Read from the table " +
          "rather than from the code, because the log outlives the code " +
          "that wrote it and a slug no longer emitted is still in there",
        tags: ["audit-log"],
        response: {
          200: z.object({ actions: z.array(z.string()) }),
          default: problemResponse,
        },
      },
    },
    async (request) => {
      const rows = await app.db
        .selectDistinct({ action: activityLog.action })
        .from(activityLog)
        .where(auditReachScope(app.db, request.user))
        .orderBy(activityLog.action);
      return { actions: rows.map((row) => row.action) };
    },
  );

  app.get(
    "/audit-log/export",
    {
      preHandler: requireAdministrator,
      schema: {
        operationId: "exportAuditLog",
        summary:
          "The currently filtered log as CSV (DD-017), newest first — " +
          "the same filters the page takes, and exactly the set they " +
          "name. The export is itself a security event: it appends an " +
          "`export.performed` entry at `admin_only` naming its filters, " +
          "and bounds itself at that entry, so an export never streams " +
          "itself. Administrator-only (SET-002)",
        tags: ["audit-log"],
        querystring: FilterSchema,
        // No 200 schema on purpose: this operation answers `text/csv`,
        // and a response schema here would put the JSON serializer in
        // front of a stream. Refusals still answer a Problem body.
        response: { default: problemResponse },
      },
    },
    async (request, reply) => {
      const filters = request.query;
      const where = and(auditPredicate(filters), auditReachScope(app.db, request.user));

      // The entry goes down before a byte is streamed, so a reader who
      // disconnects mid-download is still on the record as having asked
      // for the data. It carries the filters, so the log says what left
      // and not merely that something did.
      const [marker] = await recordActivity(app.db, {
        entityType: "system",
        actorId: request.user.id,
        action: "export.performed",
        visibility: "admin_only",
        payload: { surface: "audit_log", format: "csv", filters },
      });

      // Bounded above by the export's own entry. That is what makes the
      // answer exactly "the filtered set as it stood when the export was
      // taken": this entry is out of it, and so is anything written
      // while the stream is running.
      const bounded = and(where, marker ? olderThan(marker.id) : undefined);

      async function* rows(): AsyncGenerator<string> {
        yield csvRow(CSV_COLUMNS);
        let cursor: string | undefined;
        try {
          for (;;) {
            const chunk = await selectEntries(
              app.db,
              cursor === undefined ? bounded : and(bounded, olderThan(cursor)),
              EXPORT_CHUNK,
            );
            for (const row of chunk) {
              const entry = toEntry(row);
              yield csvRow([
                entry.id,
                entry.createdAt,
                entry.action,
                entry.entityType,
                entry.entityId,
                entry.visibility,
                entry.actor?.id ?? null,
                entry.actor?.displayName ?? null,
                row.actor?.email ?? null,
                JSON.stringify(entry.payload),
              ]);
            }
            if (chunk.length < EXPORT_CHUNK) return;
            cursor = chunk.at(-1)?.id;
            if (cursor === undefined) return;
          }
        } catch (error) {
          // The response committed the moment the first chunk went out,
          // so a failure here cannot become a Problem body — the reader
          // gets a short file and no way to tell it is short. The log is
          // the only place that can say so, and the marker names the
          // export entry the truncated file belongs to.
          request.log.error({ err: error, export: marker?.id }, "audit log export truncated");
          throw error;
        }
      }

      const stamp = new Date().toISOString().slice(0, 10);
      return (
        reply
          .header("content-type", "text/csv; charset=utf-8")
          .header("content-disposition", `attachment; filename="openlaw-audit-log-${stamp}.csv"`)
          // The declared `default` Problem schema is the only one this
          // route has, so the reply's payload type is Problem. The 200
          // is deliberately outside it — a CSV stream, sent raw. The
          // cast says that rather than pretending the stream is a body
          // shape it is not.
          .send(Readable.from(rows()) as never)
      );
    },
  );
};
