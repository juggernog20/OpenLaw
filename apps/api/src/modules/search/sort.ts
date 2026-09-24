// SPDX-License-Identifier: AGPL-3.0-only

import { sql, type SQL } from "@openlaw/db";
import { SEARCH_KINDS, type SearchQuestion } from "@openlaw/shared";
import { z } from "zod";
import { httpError } from "../../lib/problem.js";

type Sort = SearchQuestion["sort"];
const identity = { id: z.string().min(1).max(64), kind: z.enum(SEARCH_KINDS) };
const CursorSchema = z.discriminatedUnion("sort", [
  z.object({ ...identity, sort: z.literal("relevance"), rank: z.number().nonnegative() }),
  z.object({
    ...identity,
    sort: z.enum(["newest", "oldest"]),
    createdAt: z.iso.datetime({ offset: true }),
  }),
  z.object({ ...identity, sort: z.literal("title"), title: z.string() }),
  z.object({
    ...identity,
    sort: z.literal("expiry"),
    expiry: z.iso.date().nullable(),
    rank: z.number().nonnegative(),
  }),
]);
type Cursor = z.infer<typeof CursorSchema>;

export function readQuestionCursor(encoded: string, sort: Sort): Cursor {
  try {
    const raw = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8"));
    // Questions opened before sort support carry the original relevance cursor.
    const cursor = CursorSchema.parse({ sort: "relevance", ...raw });
    if (cursor.sort !== sort) throw new Error("Cursor sort differs from question");
    return cursor;
  } catch {
    throw httpError(400, "Invalid search cursor.");
  }
}

export function writeQuestionCursor(
  sort: Sort,
  row: {
    id: string;
    kind: string;
    rank: number;
    created_at: string;
    expiry_date: string | null;
    sort_title: string;
  },
): string {
  const key =
    sort === "title"
      ? { title: row.sort_title }
      : sort === "newest" || sort === "oldest"
        ? { createdAt: row.created_at }
        : sort === "expiry"
          ? { expiry: row.expiry_date, rank: row.rank }
          : { rank: row.rank };
  return Buffer.from(JSON.stringify({ sort, id: row.id, kind: row.kind, ...key })).toString(
    "base64url",
  );
}

/** Use the same keys and directions for ORDER BY and the keyset boundary. */
export function questionSort(sort: Sort, cursor?: Cursor): { order: SQL; after: SQL } {
  const keys: { column: SQL; value: SQL; descending: boolean }[] = [];
  const add = (column: SQL, value: SQL, descending = false) =>
    keys.push({ column, value, descending });
  if (sort === "relevance") {
    add(sql`rank`, sql`${cursor?.sort === "relevance" ? cursor.rank : 0}::real`, true);
  } else if (sort === "newest" || sort === "oldest") {
    add(
      sql`created_at`,
      sql`${cursor?.sort === "newest" || cursor?.sort === "oldest" ? cursor.createdAt : null}::timestamptz`,
      sort === "newest",
    );
  } else if (sort === "title") {
    add(sql`sort_title`, sql`${cursor?.sort === "title" ? cursor.title : ""}`);
  } else {
    add(
      sql`case when kind = 'contract' then 0 else 1 end`,
      sql`${cursor?.kind === "contract" ? 0 : 1}::integer`,
    );
    add(
      sql`coalesce(expiry_date, 'infinity'::date)`,
      sql`coalesce(${cursor?.sort === "expiry" ? cursor.expiry : null}::date, 'infinity'::date)`,
    );
    add(
      sql`case when kind = 'contract' then 0::real else rank end`,
      sql`${cursor?.sort === "expiry" && cursor.kind !== "contract" ? cursor.rank : 0}::real`,
      true,
    );
  }
  const descending = sort === "relevance" || sort === "newest" || sort === "expiry";
  add(sql`id`, sql`${cursor?.id ?? ""}`, descending);
  add(sql`kind`, sql`${cursor?.kind ?? ""}`, descending);
  return {
    order: sql.join(
      keys.map(({ column, descending }) => sql`${column} ${descending ? sql`desc` : sql`asc`}`),
      sql`, `,
    ),
    after: cursor
      ? sql`(${sql.join(
          keys.map(
            (key, index) =>
              sql`(${sql.join(
                [
                  ...keys.slice(0, index).map(({ column, value }) => sql`${column} = ${value}`),
                  sql`${key.column} ${key.descending ? sql`<` : sql`>`} ${key.value}`,
                ],
                sql` and `,
              )})`,
          ),
          sql` or `,
        )})`
      : sql`true`,
  };
}
