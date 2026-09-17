// SPDX-License-Identifier: AGPL-3.0-only
import { createHash, randomUUID } from "node:crypto";
import { orgSettings, runtimeStatus, eq, lt, sql, type Db } from "@openlaw/db";
import { z } from "zod";
import { readStorageConfig } from "../../lib/storage/config.js";
import {
  readDocEngineConfig,
  DEFAULT_DOC_ENGINE_TIMEOUT_MS,
  DEFAULT_DOC_ENGINE_COMPARE_TIMEOUT_MS,
} from "../../lib/doc-engine/config.js";

export const sectionIds = ["instance", "uploads", "storage", "processing"] as const;
export type SectionId = (typeof sectionIds)[number];
export type Environment = Readonly<Record<string, string | undefined>>;
export const sections: Record<SectionId, readonly string[]> = {
  instance: ["BASE_URL"],
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
export const defaults: Record<string, string> = {
  BASE_URL: "http://localhost:3000",
  MAX_UPLOAD_MB: "100",
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
export function effectiveEnvironment(
  baseline: Environment,
  saved: SavedSettings,
): Record<string, string> {
  const env = Object.fromEntries(
    keys.map((key) => [key, baseline[key]?.trim() || defaults[key] || ""]),
  );
  Object.assign(env, saved.values);
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
}
export async function resolveAdvancedSettings(
  db: Db,
  baseline: Environment,
): Promise<AdvancedRuntime> {
  const snapshot = Object.fromEntries(keys.map((key) => [key, baseline[key]]));
  return { baseline: snapshot, active: effectiveEnvironment(snapshot, await readSettings(db)) };
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
  for (const key of ["BASE_URL", "DOC_ENGINE_URL", "S3_ENDPOINT", "AZURE_BLOB_ENDPOINT"]) {
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
