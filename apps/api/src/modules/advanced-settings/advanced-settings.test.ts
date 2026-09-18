// SPDX-License-Identifier: AGPL-3.0-only
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { activityLog, eq, orgSettings, sql, runtimeStatus } from "@openlaw/db";
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
  requireSecureEndpoints,
  resolveAdvancedSettings,
  startRuntimeHeartbeat,
  validateSettings,
  readSettings,
} from "./config.js";
let harness: TestHarness;
let cookies: Record<string, string>;
let staffCookies: Record<string, string>;
beforeAll(async () => {
  harness = await startHarness();
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
          DOC_ENGINE_URL: "http://doc-engine:8080",
        },
        active: effectiveEnvironment(
          {
            STORAGE_PATH: harness.storageRoot,
            BASE_URL: "https://pinned.corp.example",
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
