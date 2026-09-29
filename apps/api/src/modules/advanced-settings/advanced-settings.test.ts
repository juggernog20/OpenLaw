// SPDX-License-Identifier: AGPL-3.0-only
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { activityLog, eq, orgSettings, sql, runtimeMetrics, runtimeStatus } from "@openlaw/db";
import { createRuntimeMetrics } from "../../lib/runtime-metrics.js";
import {
  signInCookies,
  startHarness,
  TEST_ADMIN,
  TEST_SECRET_KEY,
  tokenFrom,
  type TestHarness,
} from "../../testing/harness.js";
import {
  digest,
  effectiveEnvironment,
  emptySettings,
  isPrivateHost,
  parsePlainHttpHosts,
  parseSettings,
  preserveStorageLocations,
  pruneRuntimeRows,
  requireSecureEndpoints,
  resolveAdvancedSettings,
  startRuntimeHeartbeat,
  validateSettings,
  readSettings,
} from "./config.js";
let harness: TestHarness;
let cookies: Record<string, string>;
let staffCookies: Record<string, string>;
const metrics = createRuntimeMetrics({ servesRequests: true });
beforeAll(async () => {
  harness = await startHarness({ metrics });
  await harness.app.inject({ method: "POST", url: "/api/v1/auth/setup", payload: TEST_ADMIN });
  cookies = await signInCookies(harness.app, TEST_ADMIN.email, TEST_ADMIN.password);
  const staff = {
    email: "advanced-staff@example.com",
    displayName: "Staff",
    password: "only-for-this-test-password",
  };
  await harness.app.inject({
    method: "POST",
    url: "/api/v1/auth/invites",
    cookies,
    payload: { email: staff.email, displayName: staff.displayName, role: "legal_team_member" },
  });
  const token = tokenFrom(harness.mailer.messagesTo(staff.email)[0]!.text);
  await harness.app.inject({
    method: "POST",
    url: "/api/auth/reset-password",
    payload: { token, newPassword: staff.password },
  });
  staffCookies = await signInCookies(harness.app, staff.email, staff.password);
});
afterAll(async () => {
  metrics.stop();
  await harness?.stop();
});
async function read(section = "instance") {
  const result = await harness.app.inject({
    method: "GET",
    url: `/api/v1/advanced-settings/${section}`,
    cookies,
  });
  expect(result.statusCode, result.body).toBe(200);
  return result.json();
}
async function save(section: string, values: Record<string, string>, version?: string) {
  return harness.app.inject({
    method: "PUT",
    url: `/api/v1/advanced-settings/${section}`,
    cookies,
    payload: { version: version ?? (await read(section)).version, values },
  });
}
describe("advanced settings", () => {
  it("saves the MCP calls-per-hour limit for the next boot", async () => {
    expect((await read("mcp")).fields).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          key: "MCP_RATE_LIMIT_PER_HOUR",
          value: "600",
          activeValue: "600",
          locked: false,
        }),
      ]),
    );
    const result = await save("mcp", { MCP_RATE_LIMIT_PER_HOUR: "1200" });
    expect(result.statusCode, result.body).toBe(200);
    expect(result.json()).toMatchObject({
      restartRequired: true,
      fields: expect.arrayContaining([
        expect.objectContaining({ value: "1200", activeValue: "600" }),
      ]),
    });
    expect((await resolveAdvancedSettings(harness.db, {})).active.MCP_RATE_LIMIT_PER_HOUR).toBe(
      "1200",
    );
    expect(
      (await resolveAdvancedSettings(harness.db, { MCP_RATE_LIMIT_PER_HOUR: "900" })).active
        .MCP_RATE_LIMIT_PER_HOUR,
    ).toBe("900");
    for (const value of ["0", "-1", "1.5", "invalid", ""]) {
      const refused = await save("mcp", { MCP_RATE_LIMIT_PER_HOUR: value });
      expect(refused.statusCode).toBe(400);
      expect(refused.json().detail).toContain("MCP_RATE_LIMIT_PER_HOUR");
    }
  });

  it("requires authentication for reads, writes, probes and status", async () => {
    for (const [method, url, payload] of [
      ["GET", "/api/v1/advanced-settings/instance", undefined],
      ["PUT", "/api/v1/advanced-settings/instance", { version: "initial", values: {} }],
      ["POST", "/api/v1/advanced-settings/storage/test", { version: "initial", values: {} }],
      ["GET", "/api/v1/system-status", undefined],
    ] as const) {
      expect((await harness.app.inject({ method, url, payload })).statusCode).toBe(401);
      expect(
        (await harness.app.inject({ method, url, payload, cookies: staffCookies })).statusCode,
      ).toBe(403);
    }
  });
  it("saves an internal address without changing the running API and rejects stale edits", async () => {
    const initial = await read();
    const result = await save(
      "instance",
      { BASE_URL: "https://legal.corp.example" },
      initial.version,
    );
    expect(result.statusCode, result.body).toBe(200);
    expect(result.json()).toMatchObject({
      restartRequired: true,
      fields: [
        {
          key: "BASE_URL",
          value: "https://legal.corp.example",
          activeValue: "http://localhost:3000",
          source: "app",
        },
      ],
    });
    expect((await save("uploads", { MAX_UPLOAD_MB: "200" }, initial.version)).statusCode).toBe(409);
    const restarted = await resolveAdvancedSettings(harness.db, {});
    expect(restarted.active.BASE_URL).toBe("https://legal.corp.example");
    // A value the deployment environment sets is pinned: the saved
    // value is ignored on the next start, the way SMTP_URL pins email.
    const pinnedRestart = await resolveAdvancedSettings(harness.db, {
      BASE_URL: "https://deployment-default.test",
    });
    expect(pinnedRestart.active.BASE_URL).toBe("https://deployment-default.test");
  });
  it("pins every key the deployment environment sets and refuses to change it", async () => {
    const pinnedHarness = await startHarness({
      advancedRuntime: {
        baseline: {
          STORAGE_PATH: harness.storageRoot,
          BASE_URL: "https://pinned.corp.example",
          MCP_RATE_LIMIT_PER_HOUR: "900",
          MCP_OAUTH_GRANT_LIFETIME_DAYS: "30",
          DOC_ENGINE_URL: "http://doc-engine:8080",
        },
        active: effectiveEnvironment(
          {
            STORAGE_PATH: harness.storageRoot,
            BASE_URL: "https://pinned.corp.example",
            MCP_RATE_LIMIT_PER_HOUR: "900",
            MCP_OAUTH_GRANT_LIFETIME_DAYS: "30",
            DOC_ENGINE_URL: "http://doc-engine:8080",
          },
          emptySettings(),
        ),
      },
    });
    try {
      await pinnedHarness.app.inject({
        method: "POST",
        url: "/api/v1/auth/setup",
        payload: TEST_ADMIN,
      });
      const pinnedCookies = await signInCookies(
        pinnedHarness.app,
        TEST_ADMIN.email,
        TEST_ADMIN.password,
      );
      const instance = await pinnedHarness.app.inject({
        method: "GET",
        url: "/api/v1/advanced-settings/instance",
        cookies: pinnedCookies,
      });
      expect(instance.statusCode, instance.body).toBe(200);
      expect(instance.json().fields).toEqual([
        expect.objectContaining({
          key: "BASE_URL",
          value: "https://pinned.corp.example",
          source: "deployment",
          locked: true,
        }),
      ]);
      const version = instance.json().version as string;
      const mcp = await pinnedHarness.app.inject({
        method: "GET",
        url: "/api/v1/advanced-settings/mcp",
        cookies: pinnedCookies,
      });
      expect(mcp.json().fields).toEqual([
        expect.objectContaining({
          key: "MCP_RATE_LIMIT_PER_HOUR",
          value: "900",
          source: "deployment",
          locked: true,
        }),
        expect.objectContaining({
          key: "MCP_OAUTH_GRANT_LIFETIME_DAYS",
          value: "30",
          source: "deployment",
          locked: true,
        }),
      ]);
      const mcpRefused = await pinnedHarness.app.inject({
        method: "PUT",
        url: "/api/v1/advanced-settings/mcp",
        cookies: pinnedCookies,
        payload: { version, values: { MCP_RATE_LIMIT_PER_HOUR: "800" } },
      });
      expect(mcpRefused.statusCode).toBe(400);
      expect(mcpRefused.json().detail).toContain("MCP_RATE_LIMIT_PER_HOUR");

      const lifetimeRefused = await pinnedHarness.app.inject({
        method: "PUT",
        url: "/api/v1/advanced-settings/mcp",
        cookies: pinnedCookies,
        payload: { version, values: { MCP_OAUTH_GRANT_LIFETIME_DAYS: "45" } },
      });
      expect(lifetimeRefused.statusCode).toBe(400);
      expect(lifetimeRefused.json().detail).toContain("MCP_OAUTH_GRANT_LIFETIME_DAYS");
      const refused = await pinnedHarness.app.inject({
        method: "PUT",
        url: "/api/v1/advanced-settings/instance",
        cookies: pinnedCookies,
        payload: { version, values: { BASE_URL: "https://attacker.example" } },
      });
      expect(refused.statusCode, refused.body).toBe(400);
      expect(refused.json().detail).toContain("managed by the deployment environment");
      // Echoing the environment value unchanged is a no-op, not a refusal.
      const echoed = await pinnedHarness.app.inject({
        method: "PUT",
        url: "/api/v1/advanced-settings/instance",
        cookies: pinnedCookies,
        payload: { version, values: { BASE_URL: "https://pinned.corp.example" } },
      });
      expect(echoed.statusCode, echoed.body).toBe(200);
      expect((await readSettings(pinnedHarness.db)).values).toEqual({});
      const processing = await pinnedHarness.app.inject({
        method: "GET",
        url: "/api/v1/advanced-settings/processing",
        cookies: pinnedCookies,
      });
      expect(processing.json().fields[0]).toMatchObject({
        key: "DOC_ENGINE_URL",
        source: "deployment",
        locked: true,
      });
      // A pinned key that an older save left behind is ignored and
      // reported as deployment-managed, never as saved in the app. The
      // stale value is plain http on a public host, which the https rule
      // refuses, to show that a pinned value is never validated.
      await pinnedHarness.db.update(orgSettings).set({
        advancedSettings: JSON.stringify({
          version: "stale",
          values: { BASE_URL: "http://stale.example" },
        }),
      });
      const stale = await pinnedHarness.app.inject({
        method: "GET",
        url: "/api/v1/advanced-settings/instance",
        cookies: pinnedCookies,
      });
      expect(stale.json().fields[0]).toMatchObject({
        value: "https://pinned.corp.example",
        source: "deployment",
        locked: true,
      });
      expect(stale.json().restartRequired).toBe(false);
      // A change to another key still saves, and the save drops the
      // stale value, so the next read of the row is clean.
      const cleaned = await pinnedHarness.app.inject({
        method: "PUT",
        url: "/api/v1/advanced-settings/uploads",
        cookies: pinnedCookies,
        payload: { version: stale.json().version, values: { MAX_UPLOAD_MB: "50" } },
      });
      expect(cleaned.statusCode, cleaned.body).toBe(200);
      expect((await readSettings(pinnedHarness.db)).values).toEqual({ MAX_UPLOAD_MB: "50" });
    } finally {
      await pinnedHarness.stop();
    }
  });
  it("requires https for endpoints outside private networks and the allow list", async () => {
    for (const value of ["http://legal.corp.example", "http://8.8.8.8"])
      expect((await save("instance", { BASE_URL: value })).statusCode).toBe(400);
    for (const value of [
      "http://localhost:3000",
      "http://app.localhost",
      "http://10.0.0.5",
      "http://172.20.1.1:8080",
      "http://192.168.1.10",
      "http://[::1]:3000",
      "http://[fd00::1]",
    ])
      expect((await save("instance", { BASE_URL: value })).statusCode, value).toBe(200);
    expect(() =>
      requireSecureEndpoints({ DOC_ENGINE_URL: "http://engine.corp.example:8080" }, new Set()),
    ).toThrow(/https/);
    expect(() =>
      requireSecureEndpoints(
        { DOC_ENGINE_URL: "http://engine.corp.example:8080" },
        parsePlainHttpHosts("Engine.corp.example, other"),
      ),
    ).not.toThrow();
    expect(isPrivateHost("172.32.0.1")).toBe(false);
    expect(isPrivateHost("fe80::1")).toBe(true);
    expect(isPrivateHost("2001:db8::1")).toBe(false);
    expect(isPrivateHost("evil.localhost.example")).toBe(false);
  });
  it("audits the old and new host when an endpoint moves, never the value", async () => {
    expect((await save("instance", { BASE_URL: "https://one.corp.example" })).statusCode).toBe(200);
    expect((await save("instance", { BASE_URL: "https://two.corp.example:8443" })).statusCode).toBe(
      200,
    );
    const trail = await harness.db
      .select({ payload: activityLog.payload })
      .from(activityLog)
      .where(eq(activityLog.action, "org_settings.updated"));
    const hosts = trail
      .map((row) => row.payload as { field: string; old: unknown; new: unknown })
      .filter((payload) => payload.field === "advanced.BASE_URL.host");
    expect(hosts).toContainEqual({
      field: "advanced.BASE_URL.host",
      old: "one.corp.example",
      new: "two.corp.example:8443",
    });
    expect(JSON.stringify(trail)).not.toContain("https://two.corp.example");
  });
  it("validates URLs, upload limits, timeouts and the section allowlist", async () => {
    const invalid: Record<string, string>[] = [
      { BASE_URL: "javascript:alert(1)" },
      { BASE_URL: "https://user:password@host.test" },
      { BASE_URL: "https://host.test/path" },
      { AUTH_SECRET: "must-not-write" },
      { BASE_URL: "" },
    ];
    for (const values of invalid) expect((await save("instance", values)).statusCode).toBe(400);
    for (const value of ["0", "2.5", "10241", "NaN"])
      expect((await save("uploads", { MAX_UPLOAD_MB: value })).statusCode).toBe(400);
    expect((await save("processing", { DOC_ENGINE_TIMEOUT_MS: "99999999" })).statusCode).toBe(400);
    expect((await save("storage", { STORAGE_PATH: "/tmp/no" })).statusCode).toBe(400);
    expect((await save("uploads", { MAX_UPLOAD_MB: "250" })).statusCode).toBe(200);
  });
  it("requires a storage test and cleans up the test object before permitting save", async () => {
    expect((await save("storage", { STORAGE_DRIVER: "local" })).statusCode).toBe(409);
    const version = (await read("storage")).version;
    const test = await harness.app.inject({
      method: "POST",
      url: "/api/v1/advanced-settings/storage/test",
      cookies,
      payload: { version, values: { STORAGE_DRIVER: "local" } },
    });
    expect(test.statusCode, test.body).toBe(200);
    expect((await save("storage", { STORAGE_DRIVER: "local" }, version)).statusCode).toBe(200);
    const { readdir } = await import("node:fs/promises");
    expect(await readdir(`${harness.storageRoot}/system-checks`)).toEqual([]);
  });
  it("encrypts saved configuration and never exposes storage credentials", async () => {
    const secret = "test-only-super-secret";
    await harness.db.update(orgSettings).set({
      advancedSettings: JSON.stringify({
        version: "sealed",
        values: { S3_ACCESS_KEY_ID: "test-id", S3_SECRET_ACCESS_KEY: secret },
      }),
    });
    const response = await read("storage");
    expect(JSON.stringify(response)).not.toContain(secret);
    expect(JSON.stringify(response)).not.toContain("test-id");
    expect(
      response.fields.find((field: { key: string }) => field.key === "S3_SECRET_ACCESS_KEY"),
    ).toMatchObject({ value: "", activeValue: "", configured: true });
    const raw = await harness.db.execute(sql`select advanced_settings from org_settings`);
    expect(JSON.stringify(raw.rows)).not.toContain(secret);
    const saved = await save("storage", { S3_ACCESS_KEY_ID: "", S3_SECRET_ACCESS_KEY: "" });
    expect(saved.statusCode).toBe(409);
    const test = await harness.app.inject({
      method: "POST",
      url: "/api/v1/advanced-settings/storage/test",
      cookies,
      payload: { version: "sealed", values: { S3_ACCESS_KEY_ID: "", S3_SECRET_ACCESS_KEY: "" } },
    });
    expect(test.statusCode, test.body).toBe(200);
    expect(
      (await save("storage", { S3_ACCESS_KEY_ID: "", S3_SECRET_ACCESS_KEY: "" })).statusCode,
    ).toBe(200);
    const restarted = await resolveAdvancedSettings(harness.db, {});
    expect(restarted.active.S3_SECRET_ACCESS_KEY).toBe(secret);
    await harness.db.update(orgSettings).set({ advancedSettings: null });
  });
  it("lets an operator reset one section without clearing unrelated settings or exposing values", async () => {
    await harness.db.update(orgSettings).set({
      advancedSettings: JSON.stringify({
        version: "recovery",
        values: {
          BASE_URL: "https://wrong.internal",
          MAX_UPLOAD_MB: "225",
          S3_SECRET_ACCESS_KEY: "preserved-test-secret",
        },
      }),
    });
    const { execFile } = await import("node:child_process");
    const { promisify } = await import("node:util");
    const result = await promisify(execFile)(
      process.execPath,
      ["--import", "tsx", "src/reset-advanced-settings.ts", "instance"],
      {
        env: {
          ...process.env,
          DATABASE_URL: harness.databaseUrl,
          OPENLAW_SECRET_KEY: TEST_SECRET_KEY,
          OPENLAW_SECRET_KEY_PREVIOUS: "",
        },
      },
    );
    expect(result.stdout).toContain("Saved instance overrides removed");
    expect(result.stdout + result.stderr).not.toContain("preserved-test-secret");
    expect((await readSettings(harness.db)).values).toEqual({
      MAX_UPLOAD_MB: "225",
      S3_SECRET_ACCESS_KEY: "preserved-test-secret",
    });
    await harness.db.update(orgSettings).set({ advancedSettings: null });
  });
  it("reports current and stale worker configuration using real heartbeats", async () => {
    const env = effectiveEnvironment({ STORAGE_PATH: harness.storageRoot }, emptySettings());
    const stop = await startRuntimeHeartbeat(harness.db, "worker", env);
    try {
      let result = await harness.app.inject({
        method: "GET",
        url: "/api/v1/system-status",
        cookies,
      });
      expect(result.json().processes).toEqual([
        expect.objectContaining({ role: "worker", online: true, current: true }),
      ]);
      await save("uploads", { MAX_UPLOAD_MB: "333" });
      result = await harness.app.inject({ method: "GET", url: "/api/v1/system-status", cookies });
      expect(result.json().processes[0].current).toBe(false);
      expect(result.body).not.toContain(digest(env));
    } finally {
      await stop();
    }
    expect(await harness.db.select().from(runtimeStatus)).toEqual([]);
  });
});
describe("system performance (TECH-036)", () => {
  const minutesAgo = (minutes: number) => new Date(Date.now() - minutes * 60_000);
  const buckets = (index: number, count: number) => {
    const counts = new Array<number>(12).fill(0);
    counts[index] = count;
    return counts;
  };
  const clearRuntimeRows = async () => {
    await harness.db.delete(runtimeMetrics);
    await harness.db.delete(runtimeStatus);
  };

  it("counts API requests and leaves health probes and the web shell out", async () => {
    metrics.snapshot();
    await harness.app.inject({ method: "GET", url: "/healthz" });
    await harness.app.inject({ method: "GET", url: "/readyz" });
    await harness.app.inject({ method: "GET", url: "/matters" });
    await harness.app.inject({ method: "GET", url: "/api/v1/system-status", cookies });
    await harness.app.inject({ method: "GET", url: "/api/v1/system-status?probe=1" });
    const snapshot = metrics.snapshot();
    expect(snapshot.requests).toBe(2);
    expect(snapshot.serverErrors).toBe(0);
  });

  it("writes a snapshot a minute beside the heartbeat", async () => {
    await clearRuntimeRows();
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
    try {
      const env = effectiveEnvironment({ STORAGE_PATH: harness.storageRoot }, emptySettings());
      const stop = await startRuntimeHeartbeat(
        harness.db,
        "worker",
        env,
        createRuntimeMetrics({ servesRequests: false }),
      );
      vi.advanceTimersByTime(120_000);
      await stop();
    } finally {
      vi.useRealTimers();
    }
    const rows = await harness.db.select().from(runtimeMetrics);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ role: "worker", requests: null, latencyBuckets: null });
    expect(rows[0]!.rssBytes).toBeGreaterThan(0);
    await clearRuntimeRows();
  });

  it("deletes heartbeat and metrics rows older than 24 hours", async () => {
    await clearRuntimeRows();
    const status = (id: string, heartbeatAt: Date) => ({
      id,
      role: "api",
      configDigest: "digest",
      startedAt: heartbeatAt,
      heartbeatAt,
    });
    await harness.db
      .insert(runtimeStatus)
      .values([status("stale", minutesAgo(25 * 60)), status("recent", minutesAgo(60))]);
    const snapshot = (processId: string, recordedAt: Date) => ({
      processId,
      role: "api",
      recordedAt,
      intervalMs: 60_000,
      eventLoopP99Ms: 1,
      cpuPercent: 1,
      rssBytes: 1,
      heapUsedBytes: 1,
    });
    await harness.db
      .insert(runtimeMetrics)
      .values([snapshot("stale", minutesAgo(25 * 60)), snapshot("recent", minutesAgo(60))]);
    await pruneRuntimeRows(harness.db);
    expect((await harness.db.select().from(runtimeStatus)).map((row) => row.id)).toEqual([
      "recent",
    ]);
    expect((await harness.db.select().from(runtimeMetrics)).map((row) => row.processId)).toEqual([
      "recent",
    ]);
    await clearRuntimeRows();
  });

  it("summarises snapshots by role and window, with database and queue numbers", async () => {
    await clearRuntimeRows();
    await harness.db.insert(runtimeStatus).values({
      id: "api-1",
      role: "api",
      configDigest: "digest",
      startedAt: minutesAgo(40),
      heartbeatAt: new Date(),
    });
    const base = { intervalMs: 60_000, heapUsedBytes: 1 };
    await harness.db.insert(runtimeMetrics).values([
      {
        ...base,
        processId: "api-1",
        role: "api",
        recordedAt: minutesAgo(2),
        requests: 10,
        serverErrors: 1,
        latencyBuckets: buckets(4, 10),
        eventLoopP99Ms: 5,
        cpuPercent: 20,
        rssBytes: 100_000_000,
      },
      {
        ...base,
        processId: "api-1",
        role: "api",
        recordedAt: minutesAgo(30),
        requests: 30,
        serverErrors: 0,
        latencyBuckets: buckets(2, 30),
        eventLoopP99Ms: 50,
        cpuPercent: 40,
        rssBytes: 200_000_000,
      },
      {
        ...base,
        processId: "worker-1",
        role: "worker",
        recordedAt: minutesAgo(2),
        eventLoopP99Ms: 2,
        cpuPercent: 5,
        rssBytes: 50_000_000,
      },
    ]);
    try {
      const result = await harness.app.inject({
        method: "GET",
        url: "/api/v1/system-status",
        cookies,
      });
      expect(result.statusCode).toBe(200);
      const body = result.json();
      const row = (role: string, window: string) =>
        body.performance.find(
          (item: { role: string; window: string }) => item.role === role && item.window === window,
        );
      expect(row("api", "5m")).toEqual({
        role: "api",
        window: "5m",
        processes: 1,
        requests: 10,
        serverErrors: 1,
        latencyP50Ms: 75,
        latencyP95Ms: 97.5,
        eventLoopP99Ms: 5,
        cpuPercent: 20,
        peakRssBytes: 100_000_000,
      });
      // The hour adds the older minute: 30 requests in the 10–25 ms
      // bucket put the median at rank 20 of 40.
      expect(row("api", "1h")).toMatchObject({
        requests: 40,
        serverErrors: 1,
        latencyP50Ms: 20,
        eventLoopP99Ms: 50,
        cpuPercent: 30,
        peakRssBytes: 200_000_000,
      });
      expect(row("worker", "5m")).toMatchObject({
        processes: 1,
        requests: null,
        latencyP50Ms: null,
        cpuPercent: 5,
      });
      expect(body.processes).toEqual([
        expect.objectContaining({ role: "api", cpuPercent: 20, rssBytes: 100_000_000 }),
      ]);
      expect(body.postgres.sizeBytes).toBeGreaterThan(0);
      expect(body.postgres.connections).toBeGreaterThan(0);
      expect(body.postgres.maxConnections).toBeGreaterThan(0);
      expect(body.queue).toMatchObject({
        waiting: expect.any(Number),
        running: expect.any(Number),
        completedLastDay: expect.any(Number),
        failedLastDay: expect.any(Number),
      });
    } finally {
      await clearRuntimeRows();
    }
  });
});
it("protects old storage locations and refuses undecryptable settings", () => {
  expect(() => preserveStorageLocations({ S3_BUCKET: "old" }, { S3_BUCKET: "new" })).toThrow(
    /migration|Migrate/,
  );
  expect(() => preserveStorageLocations({ AZURE_BLOB_CONTAINER: "old" }, {})).toThrow();
  expect(() =>
    preserveStorageLocations({ S3_BUCKET: "old" }, { S3_BUCKET: "old", STORAGE_DRIVER: "local" }),
  ).not.toThrow();
  expect(() => parseSettings(null, true)).toThrow(/encryption key/);
  expect(() =>
    validateSettings(
      effectiveEnvironment(
        {},
        { version: "x", values: { S3_BUCKET: "bucket", S3_ENDPOINT: "https://secret@host" } },
      ),
    ),
  ).toThrow();
});

it("validates, audits and resolves the OAuth grant lifetime at boot", async () => {
  const key = "MCP_OAUTH_GRANT_LIFETIME_DAYS";
  expect((await read("mcp")).fields).toContainEqual(
    expect.objectContaining({
      key,
      value: "90",
      activeValue: "90",
      source: "default",
      locked: false,
    }),
  );
  for (const value of ["0", "366", "1.5", "invalid", ""]) {
    const response = await save("mcp", { [key]: value });
    expect(response.statusCode, response.body).toBe(400);
    expect(response.json().detail).toContain(key);
  }
  for (const value of ["1", "365"]) {
    const response = await save("mcp", { [key]: value });
    expect(response.statusCode, response.body).toBe(200);
    expect(response.json()).toMatchObject({ restartRequired: true });
    expect(response.json().fields).toContainEqual(
      expect.objectContaining({ key, value, activeValue: "90" }),
    );
    expect((await resolveAdvancedSettings(harness.db, {})).active[key]).toBe(value);
  }
  expect((await resolveAdvancedSettings(harness.db, { [key]: "30" })).active[key]).toBe("30");
  const audit = await harness.db
    .select()
    .from(activityLog)
    .where(eq(activityLog.action, "org_settings.updated"));
  expect(audit).toContainEqual(
    expect.objectContaining({
      visibility: "admin_only",
      payload: expect.objectContaining({ field: "advanced.mcp" }),
    }),
  );
});
