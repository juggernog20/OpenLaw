// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The MCP half of the upgrade rehearsal: stored credential rows before and
 * after the upgrade, compared byte for byte.
 *
 * upgrade-fidelity.mjs compares named facts through the API. That is too
 * loose for credentials: a migration that rewrites a hashed key, a grant's
 * Toolsets or a refresh token would still read back "fine" through the
 * routes. So this reads the rows straight from Compose's Postgres and asks
 * for an exact match. The one permitted change is migration 0172, which
 * takes Team and Administration out of every Organization ceiling.
 *
 * An added column trips this on purpose. The next migration that touches
 * one of these tables has to say so here, the way `removesToolsets` does
 * for the ceiling, instead of the gate quietly widening.
 *
 * It lives beside upgrade-fidelity.mjs and CI copies both out of the
 * working copy before the baseline checkout replaces it.
 */

import { execFileSync } from "node:child_process";
import { isDeepStrictEqual } from "node:util";

const tables = [
  "org_settings",
  "api_keys",
  "api_key_requests",
  "oauth_grants",
  "allowed_clients",
  "allowed_client_links",
  "oauth_clients",
  "oauth_consents",
  "oauth_access_tokens",
  "oauth_refresh_tokens",
];

/** Read stored rows before any verification request can update credential usage. */
export function snapshotMcpRows() {
  const compose = ["compose", "-f", "compose.yml", "-f", "compose.dev.yml"];
  if (process.env.UPGRADE_COMPOSE_PROJECT) compose.push("-p", process.env.UPGRADE_COMPOSE_PROJECT);
  return Object.fromEntries(
    tables.map((table) => {
      // PostgreSQL orders jsonb object keys; row order is fixed by the primary key.
      const rows = execFileSync(
        "docker",
        [
          ...compose,
          "exec",
          "-T",
          "postgres",
          "psql",
          "-U",
          "openlaw",
          "-d",
          "openlaw",
          "-XAt",
          "-v",
          "ON_ERROR_STOP=1",
          "-c",
          `SELECT coalesce(jsonb_agg(to_jsonb(r) ORDER BY ${table === "allowed_client_links" ? "client_id" : "id"}), '[]'::jsonb)::text FROM ${table} r`,
        ],
        { encoding: "utf8" },
      ).trim();
      return [table, table === "org_settings" ? JSON.parse(rows) : rows];
    }),
  );
}

const parse = (rows) => {
  if (typeof rows !== "string") return rows;
  try {
    return JSON.parse(rows);
  } catch {
    return undefined;
  }
};

/**
 * Where two snapshots of one table first differ. Names the row and the
 * column only: the values are hashes and tokens, and a CI log is not the
 * place for them, throwaway stack or not.
 */
function describeDifference(expected, actual) {
  if (actual === undefined) return "the table is missing after the upgrade";
  const before = parse(expected);
  const after = parse(actual);
  if (!Array.isArray(before) || !Array.isArray(after)) return "the rows are not a JSON array";
  if (before.length !== after.length)
    return `${before.length} rows before the upgrade, ${after.length} after`;
  for (const [index, row] of before.entries()) {
    const other = after[index];
    const columns = new Set([...Object.keys(row), ...Object.keys(other)]);
    for (const column of columns) {
      if (isDeepStrictEqual(row[column], other[column])) continue;
      const missing = !(column in row) ? " (added)" : !(column in other) ? " (dropped)" : "";
      return `row ${row.id ?? row.client_id ?? index} column ${column}${missing}`;
    }
  }
  return "the rows serialize differently";
}

export function assertMcpRows(before, after, removesToolsets) {
  for (const [table, rows] of Object.entries(before)) {
    const expected =
      table === "org_settings" && removesToolsets
        ? rows.map((row) => ({
            ...row,
            mcp_toolset_ceiling: row.mcp_toolset_ceiling.filter(
              (toolset) => toolset !== "team" && toolset !== "administration",
            ),
          }))
        : rows;
    if (!isDeepStrictEqual(after[table], expected))
      throw new Error(
        `M42 upgrade changed ${table} beyond the permitted ceiling removal: ${describeDifference(expected, after[table])}`,
      );
  }
}
