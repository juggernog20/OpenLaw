// SPDX-License-Identifier: AGPL-3.0-only
import { createHash, randomUUID } from "node:crypto";
import { isIPv4, isIPv6 } from "node:net";
import { orgSettings, runtimeStatus, eq, lt, sql, type Db } from "@openlaw/db";
import { z } from "zod";
import { readStorageConfig } from "../../lib/storage/config.js";
import {
  readDocEngineConfig,
  DEFAULT_DOC_ENGINE_TIMEOUT_MS,
  DEFAULT_DOC_ENGINE_COMPARE_TIMEOUT_MS,
} from "../../lib/doc-engine/config.js";

export const sectionIds = ["instance", "uploads", "storage", "processing", "mcp"] as const;
export type SectionId = (typeof sectionIds)[number];
export type Environment = Readonly<Record<string, string | undefined>>;
export const sections: Record<SectionId, readonly string[]> = {
  instance: ["BASE_URL"],
  mcp: ["MCP_RATE_LIMIT_PER_HOUR", "MCP_OAUTH_GRANT_LIFETIME_DAYS"],
  uploads: ["MAX_UPLOAD_MB"],
  storage: [
    "STORAGE_DRIVER",
    "S3_BUCKET",
    "S3_ENDPOINT",
    "S3_REGION",
    "S3_FORCE_PATH_STYLE",
    "S3_ACCESS_KEY_ID",
    "S3_SECRET_ACCESS_KEY",
    "AZURE_BLOB_CONTAINER",
    "AZURE_BLOB_ACCOUNT",
    "AZURE_BLOB_ENDPOINT",
    "AZURE_BLOB_ACCOUNT_KEY",
  ],
  processing: ["DOC_ENGINE_URL", "DOC_ENGINE_TIMEOUT_MS", "DOC_ENGINE_COMPARE_TIMEOUT_MS"],
};
export const secrets = new Set([
  "S3_ACCESS_KEY_ID",
  "S3_SECRET_ACCESS_KEY",
  "AZURE_BLOB_ACCOUNT_KEY",
]);
const keys = [...Object.values(sections).flat(), "STORAGE_PATH"];
/** The keys that name a network endpoint. Each one is checked as a URL. */
export const endpointKeys = [
  "BASE_URL",
  "DOC_ENGINE_URL",
  "S3_ENDPOINT",
  "AZURE_BLOB_ENDPOINT",
] as const;
/**
 * The environment variable that lists hosts allowed over plain http.
 * Comma separated host names, compared case-insensitively.
 */
export const PLAIN_HTTP_HOSTS_VARIABLE = "OPENLAW_PLAIN_HTTP_HOSTS";
export const defaults: Record<string, string> = {
  BASE_URL: "http://localhost:3000",
  MAX_UPLOAD_MB: "100",
  MCP_RATE_LIMIT_PER_HOUR: "600",
  MCP_OAUTH_GRANT_LIFETIME_DAYS: "90",
  STORAGE_DRIVER: "local",
  STORAGE_PATH: "/var/lib/openlaw/files",
  S3_REGION: "us-east-1",
  DOC_ENGINE_URL: "http://doc-engine:8080",
  DOC_ENGINE_TIMEOUT_MS: String(DEFAULT_DOC_ENGINE_TIMEOUT_MS),
  DOC_ENGINE_COMPARE_TIMEOUT_MS: String(DEFAULT_DOC_ENGINE_COMPARE_TIMEOUT_MS),
};
const StoredSchema = z.object({ version: z.string(), values: z.record(z.string(), z.string()) });
export type SavedSettings = z.infer<typeof StoredSchema>;
export const emptySettings = (): SavedSettings => ({ version: "initial", values: {} });
export function parseSettings(raw: string | null, present: boolean): SavedSettings {
  if (present && raw === null)
    throw new Error(
      "Advanced settings cannot be decrypted. Restore the instance encryption key before restarting.",
    );
  if (!raw) return emptySettings();
  const saved = StoredSchema.parse(JSON.parse(raw));
  if (Object.keys(saved.values).some((key) => !keys.includes(key) || key === "STORAGE_PATH"))
    throw new Error("Unknown advanced setting.");
  return saved;
}
export async function readSettings(db: Db): Promise<SavedSettings> {
  const [row] = await db
    .select({
      raw: orgSettings.advancedSettings,
      present: sql<boolean>`${orgSettings.advancedSettings} is not null`,
    })
    .from(orgSettings);
  return parseSettings(row?.raw ?? null, row?.present ?? false);
}
/**
 * The keys the deployment environment sets to a non-empty value.
 *
 * A pinned key keeps its environment value. A value saved in the app is
 * ignored, and the PUT refuses to change it. This is the rule SMTP_URL
 * already follows, applied to every advanced setting, so that a stolen
 * Administrator session cannot repoint storage, the doc engine, or the
 * instance address away from what the operator deployed.
 */
export function pinnedKeys(baseline: Environment): Set<string> {
  return new Set(keys.filter((key) => Boolean(baseline[key]?.trim())));
}
export function effectiveEnvironment(
  baseline: Environment,
  saved: SavedSettings,
): Record<string, string> {
  const env = Object.fromEntries(
    keys.map((key) => [key, baseline[key]?.trim() || defaults[key] || ""]),
  );
  const pinned = pinnedKeys(baseline);
  for (const [key, value] of Object.entries(saved.values)) {
    if (!pinned.has(key)) env[key] = value;
  }
  env.STORAGE_DRIVER = env.STORAGE_DRIVER?.toLowerCase() || "local";
  if (env.S3_FORCE_PATH_STYLE === "1") env.S3_FORCE_PATH_STYLE = "true";
  if (env.S3_FORCE_PATH_STYLE === "0") env.S3_FORCE_PATH_STYLE = "false";
  if (!env.S3_FORCE_PATH_STYLE) env.S3_FORCE_PATH_STYLE = env.S3_ENDPOINT ? "true" : "false";
  return env;
}
export function digest(env: Environment): string {
  return createHash("sha256")
    .update(JSON.stringify(keys.map((key) => [key, env[key] ?? ""])))
    .digest("hex");
}
export interface AdvancedRuntime {
  baseline: Environment;
  active: Environment;
  /** Hosts an Administrator may save with a plain http address. Empty when absent. */
  plainHttpHosts?: ReadonlySet<string>;
}
/** Parses the comma separated allow list into lowercase host names. */
export function parsePlainHttpHosts(raw: string | undefined): Set<string> {
  return new Set(
    (raw ?? "")
      .split(",")
      .map((host) => host.trim().toLowerCase())
      .filter((host) => host.length > 0),
  );
}
export async function resolveAdvancedSettings(
  db: Db,
  baseline: Environment,
): Promise<AdvancedRuntime> {
  const snapshot = Object.fromEntries(keys.map((key) => [key, baseline[key]]));
  return {
    baseline: snapshot,
    active: effectiveEnvironment(snapshot, await readSettings(db)),
    plainHttpHosts: parsePlainHttpHosts(baseline[PLAIN_HTTP_HOSTS_VARIABLE]),
  };
}
/**
 * Whether a host is on a private network, where plain http stays on the
 * operator's own wire. Covers localhost, loopback, RFC 1918, link-local,
 * and the IPv6 unique-local and link-local ranges.
 */
export function isPrivateHost(hostname: string): boolean {
  const host = hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (host === "localhost" || host.endsWith(".localhost")) return true;
  if (isIPv4(host)) {
    const [a = 0, b = 0] = host.split(".").map(Number);
    return (
      a === 10 ||
      a === 127 ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 169 && b === 254)
    );
  }
  if (isIPv6(host)) {
    if (host === "::1") return true;
    const first = host.split(":")[0] ?? "";
    return /^f[cd][0-9a-f]{0,2}$/.test(first) || /^fe[89ab][0-9a-f]?$/.test(first);
  }
  return false;
}
/**
 * Refuses a plain http endpoint saved in the app unless its host is
 * private or on the operator's allow list. Only app-saved values are
 * checked. An environment value is the operator's own choice and is
 * pinned anyway.
 */
export function requireSecureEndpoints(
  values: Readonly<Record<string, string>>,
  plainHttpHosts: ReadonlySet<string>,
): void {
  for (const key of endpointKeys) {
    const value = values[key];
    if (!value) continue;
    let url: URL;
    try {
      url = new URL(value);
    } catch {
      continue;
    }
    if (url.protocol !== "http:") continue;
    if (isPrivateHost(url.hostname) || plainHttpHosts.has(url.hostname.toLowerCase())) continue;
    throw new Error(
      `${key} must use https. Plain http is allowed only for localhost, private network addresses, and hosts listed in ${PLAIN_HTTP_HOSTS_VARIABLE}.`,
    );
  }
}
/** One endpoint whose host changed, named by host only. Never a key or a secret. */
export interface EndpointHostChange {
  key: (typeof endpointKeys)[number];
  from: string | null;
  to: string | null;
}
function hostOf(value: string | undefined): string | null {
  if (!value) return null;
  try {
    return new URL(value).host || null;
  } catch {
    return null;
  }
}
/** The endpoint hosts that differ between two effective environments. */
export function endpointHostChanges(before: Environment, after: Environment): EndpointHostChange[] {
  const changes: EndpointHostChange[] = [];
  for (const key of endpointKeys) {
    const from = hostOf(before[key]);
    const to = hostOf(after[key]);
    if (from !== to) changes.push({ key, from, to });
  }
  return changes;
}
export function oauthGrantLifetimeDays(env: Environment): number {
  const days = Number(env.MCP_OAUTH_GRANT_LIFETIME_DAYS ?? defaults.MCP_OAUTH_GRANT_LIFETIME_DAYS);
  if (!Number.isSafeInteger(days) || days < 1 || days > 365)
    throw new Error("MCP_OAUTH_GRANT_LIFETIME_DAYS must be a whole number from 1 to 365 days.");
  return days;
}
export function validateSettings(env: Environment): void {
  for (const key of [
    "BASE_URL",
    "DOC_ENGINE_URL",
    "DOC_ENGINE_TIMEOUT_MS",
    "DOC_ENGINE_COMPARE_TIMEOUT_MS",
  ]) {
    if (!env[key]?.trim()) throw new Error(`${key} is required.`);
  }
  for (const key of endpointKeys) {
    const value = env[key];
    if (!value) continue;
    let url: URL;
    try {
      url = new URL(value);
    } catch {
      throw new Error(`${key} must be a complete HTTP or HTTPS address.`);
    }
    if (
      !["http:", "https:"].includes(url.protocol) ||
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      (key === "BASE_URL" && url.pathname !== "/")
    )
      throw new Error(
        `${key} must be an HTTP or HTTPS address without credentials, query parameters or fragments${key === "BASE_URL" ? ", and without a path" : ""}.`,
      );
  }
  const mcpRate = Number(env.MCP_RATE_LIMIT_PER_HOUR);
  if (!Number.isSafeInteger(mcpRate) || mcpRate < 1)
    throw new Error("MCP_RATE_LIMIT_PER_HOUR must be a positive whole number.");
  oauthGrantLifetimeDays(env);
  const upload = Number(env.MAX_UPLOAD_MB);
  if (!Number.isSafeInteger(upload) || upload < 1 || upload > 10240)
    throw new Error("The upload limit must be a whole number from 1 to 10,240 MiB.");
  readDocEngineConfig(env);
  readStorageConfig(env);
  if (env.S3_BUCKET) readStorageConfig({ ...env, STORAGE_DRIVER: "s3" });
  if (env.AZURE_BLOB_CONTAINER) readStorageConfig({ ...env, STORAGE_DRIVER: "azure-blob" });
}
export function preserveStorageLocations(before: Environment, after: Environment): void {
  for (const [configured, identity] of [
    ["S3_BUCKET", ["S3_BUCKET", "S3_ENDPOINT"]],
    ["AZURE_BLOB_CONTAINER", ["AZURE_BLOB_CONTAINER", "AZURE_BLOB_ACCOUNT", "AZURE_BLOB_ENDPOINT"]],
  ] as const) {
    if (before[configured] && identity.some((key) => (before[key] ?? "") !== (after[key] ?? "")))
      throw new Error(
        "An existing storage location cannot be changed or removed here. Migrate its documents before changing the deployment configuration.",
      );
  }
}
export async function startRuntimeHeartbeat(
  db: Db,
  role: "api" | "worker",
  env: Environment,
): Promise<() => Promise<void>> {
  const id = randomUUID();
  const startedAt = new Date();
  const beat = async () => {
    const heartbeatAt = new Date();
    await db
      .insert(runtimeStatus)
      .values({ id, role, configDigest: digest(env), startedAt, heartbeatAt })
      .onConflictDoUpdate({ target: runtimeStatus.id, set: { heartbeatAt } });
  };
  await db
    .delete(runtimeStatus)
    .where(lt(runtimeStatus.heartbeatAt, new Date(Date.now() - 86_400_000)));
  await beat();
  let pending = Promise.resolve();
  const timer = setInterval(() => {
    pending = pending.then(beat).catch(() => {});
  }, 15_000).unref();
  return async () => {
    clearInterval(timer);
    await pending;
    await db.delete(runtimeStatus).where(eq(runtimeStatus.id, id));
  };
}
