// SPDX-License-Identifier: AGPL-3.0-only
import type { Db } from "@openlaw/db";
import { randomUUID } from "node:crypto";
import { Readable } from "node:stream";
import { orgSettings, runtimeStatus, sql, desc, gt } from "@openlaw/db";
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";
import { recordActivity } from "../../lib/activity.js";
import { requireRole } from "../../auth/guards.js";
import { httpError, problemResponse } from "../../lib/problem.js";
import { createStorageFromEnv } from "../../lib/storage/config.js";
import {
  digest,
  effectiveEnvironment,
  endpointHostChanges,
  parseSettings,
  pinnedKeys,
  preserveStorageLocations,
  readSettings,
  requireSecureEndpoints,
  secrets,
  sectionIds,
  sections,
  validateSettings,
  type AdvancedRuntime,
  type SavedSettings,
  type SectionId,
} from "./config.js";

const Change = z.strictObject({
  version: z.string(),
  values: z.record(z.string(), z.string().max(8192)),
});
const Params = z.object({ section: z.enum(sectionIds) });
const State = z.object({
  version: z.string(),
  restartRequired: z.boolean(),
  fields: z.array(
    z.object({
      key: z.string(),
      value: z.string(),
      activeValue: z.string(),
      secret: z.boolean(),
      configured: z.boolean(),
      source: z.enum(["app", "deployment", "default"]),
      locked: z.boolean(),
    }),
  ),
});
const Status = z.object({
  database: z.literal("available"),
  storageDriver: z.string(),
  documentEngine: z.string(),
  processes: z.array(
    z.object({
      role: z.string(),
      startedAt: z.string(),
      heartbeatAt: z.string(),
      online: z.boolean(),
      current: z.boolean(),
    }),
  ),
});
export function advancedSettingsRoutes(runtime: AdvancedRuntime): FastifyPluginAsyncZod {
  return async (app) => {
    const tested = new Map<string, number>();
    // The keys the deployment environment sets. They are read-only here,
    // the same way SMTP_URL pins email: the environment always wins.
    const pinned = pinnedKeys(runtime.baseline);
    function proposal(saved: SavedSettings, section: SectionId, body: z.infer<typeof Change>) {
      if (saved.version !== body.version)
        throw httpError(
          409,
          "These settings changed in another session. Reload the page before saving.",
        );
      const values = { ...saved.values };
      // An older save can hold a value for a key the environment pins
      // now. The environment wins, so the value is dropped here: it is
      // not validated, and the next successful save no longer carries it.
      for (const key of pinned) delete values[key];
      for (const [key, raw] of Object.entries(body.values)) {
        if (!sections[section].includes(key))
          throw httpError(400, "This setting cannot be changed in this section.");
        if (secrets.has(key) && !raw) continue;
        const value = secrets.has(key) ? raw : raw.trim();
        if (pinned.has(key)) {
          // A client that echoes the environment value unchanged is a
          // no-op. Anything else is an attempt to override the deployment.
          if (value === (runtime.baseline[key] ?? "").trim()) continue;
          throw httpError(
            400,
            `${key} is managed by the deployment environment and cannot be changed here.`,
          );
        }
        values[key] = value;
      }
      const candidate = { version: randomUUID(), values };
      const env = effectiveEnvironment(runtime.baseline, candidate);
      try {
        validateSettings(env);
        requireSecureEndpoints(candidate.values, runtime.plainHttpHosts ?? new Set());
        preserveStorageLocations(effectiveEnvironment(runtime.baseline, saved), env);
        preserveStorageLocations(runtime.active, env);
      } catch (error) {
        throw httpError(
          400,
          error instanceof Error ? error.message : "The configuration is invalid.",
        );
      }
      return { candidate, env };
    }

    app.get(
      "/advanced-settings/:section",
      {
        preHandler: requireRole("administrator"),
        schema: {
          operationId: "getAdvancedSettings",
          tags: ["advanced-settings"],
          params: Params,
          response: { 200: State, default: problemResponse },
        },
      },
      async (request) => readAdvancedSettings(app.db, runtime, request.params.section),
    );
    app.put(
      "/advanced-settings/:section",
      {
        preHandler: requireRole("administrator"),
        schema: {
          operationId: "saveAdvancedSettings",
          tags: ["advanced-settings"],
          params: Params,
          body: Change,
          response: { 200: State, default: problemResponse },
        },
      },
      async (request) => {
        await app.db.transaction(async (tx) => {
          const [row] = await tx
            .select({
              id: orgSettings.id,
              raw: orgSettings.advancedSettings,
              present: sql<boolean>`${orgSettings.advancedSettings} is not null`,
            })
            .from(orgSettings)
            .for("update");
          if (!row) throw httpError(409, "Organization settings are unavailable.");
          const saved = parseSettings(row.raw, row.present);
          const { candidate, env } = proposal(saved, request.params.section, request.body);
          if (request.params.section === "storage" && (tested.get(digest(env)) ?? 0) < Date.now())
            throw httpError(409, "Test this storage configuration successfully before saving it.");
          await tx.update(orgSettings).set({ advancedSettings: JSON.stringify(candidate) });
          await recordActivity(tx, {
            entityType: "system",
            actorId: request.user.id,
            action: "org_settings.updated",
            visibility: "admin_only",
            payload: {
              field: `advanced.${request.params.section}`,
              old: "[configuration]",
              new: "[configuration saved; restart required]",
            },
          });
          // An endpoint that moves is the change worth a trail: the
          // Audit log and the process log both name the old and new
          // host. Host names only, never a key or a credential.
          for (const change of endpointHostChanges(
            effectiveEnvironment(runtime.baseline, saved),
            env,
          )) {
            request.log.warn(
              { key: change.key, from: change.from, to: change.to },
              "advanced settings endpoint host changed",
            );
            await recordActivity(tx, {
              entityType: "system",
              actorId: request.user.id,
              action: "org_settings.updated",
              visibility: "admin_only",
              payload: {
                field: `advanced.${change.key}.host`,
                old: change.from ?? "",
                new: change.to ?? "",
              },
            });
          }
        });
        return readAdvancedSettings(app.db, runtime, request.params.section);
      },
    );
    app.post(
      "/advanced-settings/:section/test",
      {
        preHandler: requireRole("administrator"),
        schema: {
          operationId: "testAdvancedSettings",
          tags: ["advanced-settings"],
          params: Params,
          body: Change,
          response: { 200: z.object({ ok: z.literal(true) }), default: problemResponse },
        },
      },
      async (request) => {
        const section = request.params.section;
        if (section !== "storage" && section !== "processing")
          throw httpError(400, "This section does not have a connection test.");
        const { env } = proposal(await readSettings(app.db), section, request.body);
        try {
          if (section === "processing") {
            const response = await fetch(`${env.DOC_ENGINE_URL!.replace(/\/$/, "")}/healthz`, {
              signal: AbortSignal.timeout(5000),
              redirect: "error",
            });
            await response.body?.cancel();
            if (!response.ok) throw new Error("unavailable");
          } else {
            const checkDriver = async (driver: string) => {
              const storage = createStorageFromEnv({ ...env, STORAGE_DRIVER: driver });
              const key = `system-checks/${randomUUID()}`;
              const content = Buffer.from("OpenLaw storage connection test");
              const ref = await storage.put(key, Readable.from(content));
              try {
                const stream = await storage.get(ref);
                const chunks: Buffer[] = [];
                let size = 0;
                for await (const chunk of stream) {
                  const buffer = Buffer.from(chunk);
                  size += buffer.length;
                  if (size > content.length) {
                    stream.destroy();
                    throw new Error("read mismatch");
                  }
                  chunks.push(buffer);
                }
                if (!Buffer.concat(chunks).equals(content)) throw new Error("read mismatch");
              } finally {
                await storage.delete(ref);
              }
            };
            const check = async () => {
              for (const driver of [
                "local",
                ...(env.S3_BUCKET ? ["s3"] : []),
                ...(env.AZURE_BLOB_CONTAINER ? ["azure-blob"] : []),
              ])
                await checkDriver(driver);
            };
            let timeout: ReturnType<typeof setTimeout> | undefined;
            try {
              await Promise.race([
                check(),
                new Promise<never>((_, reject) => {
                  timeout = setTimeout(() => reject(new Error("timeout")), 15_000).unref();
                }),
              ]);
            } finally {
              clearTimeout(timeout);
            }
            for (const [key, expires] of tested) if (expires < Date.now()) tested.delete(key);
            if (tested.size >= 100) tested.clear();
            tested.set(digest(env), Date.now() + 10 * 60_000);
          }
        } catch {
          throw httpError(
            502,
            section === "storage"
              ? "The storage test failed. Check the destination, credentials, and read, write and delete permissions."
              : "The document service did not respond successfully. Check its address and network access.",
            { expose: true },
          );
        }
        return { ok: true as const };
      },
    );
    app.get(
      "/system-status",
      {
        preHandler: requireRole("administrator"),
        schema: {
          operationId: "getSystemStatus",
          tags: ["advanced-settings"],
          response: { 200: Status, default: problemResponse },
        },
      },
      async () => {
        const desired = effectiveEnvironment(runtime.baseline, await readSettings(app.db));
        const processes = await app.db
          .select()
          .from(runtimeStatus)
          .where(gt(runtimeStatus.heartbeatAt, new Date(Date.now() - 86_400_000)))
          .orderBy(desc(runtimeStatus.heartbeatAt))
          .limit(100);
        const visible = processes.filter(
          (row, index) =>
            row.heartbeatAt.getTime() > Date.now() - 60_000 ||
            !processes.slice(0, index).some((newer) => newer.role === row.role),
        );
        return {
          database: "available" as const,
          storageDriver: runtime.active.STORAGE_DRIVER ?? "local",
          documentEngine: runtime.active.DOC_ENGINE_URL ?? "",
          processes: visible.map((row) => ({
            role: row.role,
            startedAt: row.startedAt.toISOString(),
            heartbeatAt: row.heartbeatAt.toISOString(),
            online: row.heartbeatAt.getTime() > Date.now() - 60_000,
            current: row.configDigest === digest(desired),
          })),
        };
      },
    );
  };
}

export async function readAdvancedSettings(db: Db, runtime: AdvancedRuntime, section: SectionId) {
  const pinned = pinnedKeys(runtime.baseline);
  const saved = await readSettings(db);
  const desired = effectiveEnvironment(runtime.baseline, saved);
  const active = runtime.active;
  const keys = section === "storage" ? [...sections.storage, "STORAGE_PATH"] : sections[section];
  return {
    version: saved.version,
    restartRequired: keys.some((key) => desired[key] !== (active[key] ?? "")),
    fields: keys.map((key) => ({
      key,
      secret: secrets.has(key),
      configured: Boolean(desired[key]),
      value: secrets.has(key) ? "" : (desired[key] ?? ""),
      activeValue: secrets.has(key) ? "" : (active[key] ?? ""),
      // A pinned key reports the deployment as its source even when
      // an older save left a value behind: that value is ignored.
      source: pinned.has(key)
        ? ("deployment" as const)
        : key in saved.values
          ? ("app" as const)
          : ("default" as const),
      locked:
        key === "STORAGE_PATH" ||
        pinned.has(key) ||
        Boolean(
          (desired.S3_BUCKET && ["S3_BUCKET", "S3_ENDPOINT"].includes(key)) ||
          (desired.AZURE_BLOB_CONTAINER &&
            ["AZURE_BLOB_CONTAINER", "AZURE_BLOB_ACCOUNT", "AZURE_BLOB_ENDPOINT"].includes(key)),
        ),
    })),
  };
}
