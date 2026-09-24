// SPDX-License-Identifier: AGPL-3.0-only
import { Readable } from "node:stream";
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";
import {
  activityLog,
  and,
  desc,
  eq,
  gte,
  lte,
  mcpToolCalls,
  sql,
  users,
  type Db,
  type SQL,
} from "@openlaw/db";
import { requireRole } from "../../auth/guards.js";
import { recordActivity } from "../../lib/activity.js";
import { csvRow } from "../../lib/csv.js";
import { problemResponse } from "../../lib/problem.js";

const PAGE_SIZE = 50;
const EXPORT_CHUNK = 500;
const FilterSchema = z.object({
  from: z.iso.datetime({ offset: true }).optional(),
  to: z.iso.datetime({ offset: true }).optional(),
});
const EntrySchema = z.object({
  id: z.string(),
  createdAt: z.string(),
  person: z.object({ id: z.string(), displayName: z.string() }),
  clientName: z.string(),
  tool: z.string(),
  outcome: z.string(),
  durationMs: z.number().int().nonnegative(),
});
function datePredicate(filters: z.infer<typeof FilterSchema>) {
  return and(
    filters.from ? gte(mcpToolCalls.createdAt, new Date(filters.from)) : undefined,
    filters.to ? lte(mcpToolCalls.createdAt, new Date(filters.to)) : undefined,
  );
}
/** The keyset boundary the audit log uses: strictly older than one row
 * in `(created_at, id)` order, with the position read from the table
 * rather than trusted from the client. An id naming no row leaves the
 * comparison NULL, which answers an empty page. */
function olderThan(cursor: string): SQL {
  return sql`(${mcpToolCalls.createdAt}, ${mcpToolCalls.id}) < (
    select ${mcpToolCalls.createdAt}, ${mcpToolCalls.id}
    from ${mcpToolCalls}
    where ${eq(mcpToolCalls.id, cursor)}
  )`;
}
function selectCalls(db: Db, where: SQL | undefined, limit: number) {
  return db
    .select({
      id: mcpToolCalls.id,
      createdAt: mcpToolCalls.createdAt,
      person: { id: users.id, displayName: users.displayName },
      clientName: mcpToolCalls.clientName,
      tool: mcpToolCalls.tool,
      outcome: mcpToolCalls.outcome,
      durationMs: mcpToolCalls.durationMs,
    })
    .from(mcpToolCalls)
    .innerJoin(users, eq(users.id, mcpToolCalls.personId))
    .where(where)
    .orderBy(desc(mcpToolCalls.createdAt), desc(mcpToolCalls.id))
    .limit(limit);
}

// This ledger holds call metadata only. Record ids, arguments and results are
// absent, so Administrator access does not bypass a record's reach rules.
export const toolCallRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get(
    "/audit-log/tool-calls",
    {
      preHandler: requireRole("administrator"),
      schema: {
        operationId: "listAuditToolCalls",
        summary:
          "Tool call metadata, newest first. Administrator-only, date-filtered, with 50 calls per page",
        tags: ["audit-log"],
        querystring: FilterSchema.extend({ cursor: z.string().min(1).max(64).optional() }),
        response: {
          200: z.object({ entries: z.array(EntrySchema), nextCursor: z.string().nullable() }),
          default: problemResponse,
        },
      },
    },
    async (request) => {
      const { cursor, ...filters } = request.query;
      const rows = await selectCalls(
        app.db,
        and(datePredicate(filters), cursor ? olderThan(cursor) : undefined),
        PAGE_SIZE + 1,
      );
      const page = rows.slice(0, PAGE_SIZE);
      return {
        entries: page.map((row) => ({ ...row, createdAt: row.createdAt.toISOString() })),
        nextCursor: rows.length > PAGE_SIZE ? page.at(-1)!.id : null,
      };
    },
  );
  app.get(
    "/audit-log/tool-calls/export",
    {
      preHandler: requireRole("administrator"),
      schema: {
        operationId: "exportAuditToolCalls",
        summary:
          "Export all date-filtered Tool calls as CSV in bounded chunks. Administrator-only; records an audit event",
        tags: ["audit-log"],
        querystring: FilterSchema,
        response: { default: problemResponse },
      },
    },
    async (request, reply) => {
      const filters = request.query;
      const [marker] = await recordActivity(app.db, {
        entityType: "system",
        actorId: request.user.id,
        action: "export.performed",
        visibility: "admin_only",
        payload: { surface: "mcp_tool_calls", format: "csv", filters },
      });
      // Use the database clock from the audit marker, including its microseconds.
      const bounded = and(
        datePredicate(filters),
        sql`${mcpToolCalls.createdAt} <=
      (select ${activityLog.createdAt} from ${activityLog} where ${activityLog.id} = ${marker!.id})`,
      );
      async function* rows(): AsyncGenerator<string> {
        yield csvRow([
          "id",
          "created_at",
          "person_id",
          "person_name",
          "client_name",
          "tool",
          "outcome",
          "duration_ms",
        ]);
        let cursor: string | undefined;
        try {
          for (;;) {
            const chunk = await selectCalls(
              app.db,
              and(bounded, cursor ? olderThan(cursor) : undefined),
              EXPORT_CHUNK,
            );
            for (const row of chunk)
              yield csvRow([
                row.id,
                row.createdAt.toISOString(),
                row.person.id,
                row.person.displayName,
                row.clientName,
                row.tool,
                row.outcome,
                row.durationMs,
              ]);
            if (chunk.length < EXPORT_CHUNK) return;
            cursor = chunk.at(-1)!.id;
          }
        } catch (error) {
          request.log.error({ err: error, export: marker!.id }, "Tool calls export truncated");
          throw error;
        }
      }
      const stamp = new Date().toISOString().slice(0, 10);
      return reply
        .header("content-type", "text/csv; charset=utf-8")
        .header("content-disposition", `attachment; filename="openlaw-tool-calls-${stamp}.csv"`)
        .send(Readable.from(rows()) as never);
    },
  );
};
