// SPDX-License-Identifier: AGPL-3.0-only
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
      throw new Error(`M42 upgrade changed ${table} beyond the permitted ceiling removal`);
  }
}
