// SPDX-License-Identifier: AGPL-3.0-only
import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { activityLog, orgSettings, eq } from "@openlaw/db";
import { buildApp } from "../../app.js";
import { testDeps } from "../../testing/deps.js";
import {
  startHarness,
  signInCookies,
  TEST_ADMIN,
  TEST_AUTH_CONFIG,
  type TestHarness,
} from "../../testing/harness.js";
let h: TestHarness;
const url = "/api/v1/mcp-settings";
beforeAll(async () => {
  h = await startHarness();
  await h.app.inject({ method: "POST", url: "/api/v1/auth/setup", payload: TEST_ADMIN });
});
afterAll(async () => {
  await h?.stop();
});

it.each([
  ["https://legal.example", ["8.8.8.8"], []],
  ["https://legal.example", ["10.1.2.3"], ["public_ipv4"]],
  ["https://legal.example", ["172.16.0.1"], ["public_ipv4"]],
  ["https://legal.example", ["192.168.1.1"], ["public_ipv4"]],
  ["https://legal.example", ["127.0.0.1"], ["public_ipv4"]],
  ["https://legal.example", ["169.254.1.1"], ["public_ipv4"]],
  ["https://legal.example", ["100.64.0.1"], ["public_ipv4"]],
  ["https://legal.example", ["100.127.255.254"], ["public_ipv4"]],
  ["https://legal.example", ["100.128.0.1"], []],
  ["https://legal.example", ["8.8.8.8", "10.0.0.1"], ["public_ipv4"]],
  ["https://legal.example", [], ["ipv4", "public_ipv4"]],
  ["https://legal.example", null, ["ipv4", "public_ipv4"]],
  ["http://localhost", ["127.0.0.1"], ["https", "public_ipv4"]],
] as const)(
  "checks %s resolving to %j and saves despite warnings",
  async (baseUrl, addresses, failed) => {
    await h.db
      .update(orgSettings)
      .set({ mcpLegalOAuthClientsEnabled: false, mcpBusinessOAuthClientsEnabled: false });
    const resolver = vi.fn(async () => {
      if (addresses === null) throw new Error("ENOTFOUND");
      return [...addresses];
    });
    const app = await buildApp(
      testDeps({ db: h.db, config: { ...TEST_AUTH_CONFIG, baseUrl }, mcpResolveIpv4: resolver }),
    );
    try {
      const cookies = await signInCookies(app, TEST_ADMIN.email, TEST_ADMIN.password);
      expect((await app.inject({ url, cookies })).json().reachability).toBeNull();
      expect(resolver).not.toHaveBeenCalled();
      for (const field of ["legalOAuthClientsEnabled", "businessOAuthClientsEnabled"]) {
        const result = await app.inject({
          method: "PATCH",
          url,
          cookies,
          payload: { [field]: true },
        });
        expect(result.statusCode, result.body).toBe(200);
        expect(result.json()[field]).toBe(true);
        expect(result.json().reachability).toHaveLength(3);
        expect(
          result
            .json()
            .reachability.filter((c: { passed: boolean }) => !c.passed)
            .map((c: { name: string }) => c.name),
        ).toEqual(failed);
      }
      const read = await app.inject({ url, cookies });
      expect(read.json()).toMatchObject({
        legalOAuthClientsEnabled: true,
        businessOAuthClientsEnabled: true,
      });
      expect(resolver).toHaveBeenCalledTimes(1);
      const clock = vi.spyOn(Date, "now").mockReturnValue(Date.now() + 31_000);
      try {
        await app.inject({ url, cookies });
      } finally {
        clock.mockRestore();
      }
      expect(resolver).toHaveBeenCalledTimes(2);
      await app.inject({
        method: "PATCH",
        url,
        cookies,
        payload: { legalOAuthClientsEnabled: false, businessOAuthClientsEnabled: false },
      });
      expect((await app.inject({ url, cookies })).json().reachability).toBeNull();
      const audit = await h.db
        .select()
        .from(activityLog)
        .where(eq(activityLog.action, "org_settings.updated"));
      for (const field of ["mcpLegalOAuthClientsEnabled", "mcpBusinessOAuthClientsEnabled"])
        expect(audit).toContainEqual(
          expect.objectContaining({
            visibility: "admin_only",
            payload: { field, old: false, new: true },
          }),
        );
    } finally {
      await app.close();
    }
  },
);
it("refuses the whole PATCH when http on a non-loopback host prevented the authorization server boot", async () => {
  await h.db.update(orgSettings).set({
    mcpEnabled: false,
    mcpLegalOAuthClientsEnabled: false,
    mcpBusinessOAuthClientsEnabled: false,
  });
  const app = await buildApp(
    testDeps({
      db: h.db,
      config: { ...TEST_AUTH_CONFIG, baseUrl: "http://legal.lan" },
      mcpResolveIpv4: async () => ["10.0.0.1"],
    }),
  );
  try {
    const cookies = await signInCookies(app, TEST_ADMIN.email, TEST_ADMIN.password);
    const before = await h.db.select().from(activityLog);
    for (const field of ["legalOAuthClientsEnabled", "businessOAuthClientsEnabled"]) {
      const result = await app.inject({
        method: "PATCH",
        url,
        cookies,
        payload: { enabled: true, [field]: true },
      });
      expect(result.statusCode, result.body).toBe(400);
      expect(result.headers["content-type"]).toContain("application/problem+json");
      expect(result.json().detail).toMatch(/scheme.*http/);
      expect(result.json().reachability).toContainEqual({ name: "https", passed: false });
    }
    expect((await app.inject({ url, cookies })).json()).toMatchObject({
      enabled: false,
      legalOAuthClientsEnabled: false,
      businessOAuthClientsEnabled: false,
    });
    expect(await h.db.select().from(activityLog)).toEqual(before);
  } finally {
    await app.close();
  }
});
