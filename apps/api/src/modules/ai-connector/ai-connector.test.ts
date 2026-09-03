// SPDX-License-Identifier: AGPL-3.0-only

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { activityLog, aiConnector, aiFieldPrompts, asc, inArray, sql, type Db } from "@openlaw/db";
import { CORE_ANALYSIS_TARGETS } from "@openlaw/shared";
import { FAKE_VALID_AI_KEY } from "../../lib/ai/fake.js";
import {
  signInCookies,
  startHarness,
  TEST_ADMIN,
  tokenFrom,
  type TestHarness,
} from "../../testing/harness.js";

const URL = "/api/v1/ai-connector";
const PROMPTS_URL = "/api/v1/ai-field-prompts";
const ACTIONS = [
  "ai_connector.configured",
  "ai_connector.updated",
  "ai_connector.disabled",
  "ai_connector.enabled",
  "ai_connector.removed",
  "ai_field_prompt.updated",
  "ai_field_prompt.reset",
] as const;
const STAFF = {
  email: "member-ai@example.com",
  displayName: "Mina Member",
  password: "member-ai-password",
} as const;

let harness: TestHarness;
let adminCookies: Record<string, string>;
let memberCookies: Record<string, string>;

function auditRows(db: Db) {
  return db
    .select()
    .from(activityLog)
    .where(inArray(activityLog.action, [...ACTIONS]))
    .orderBy(asc(activityLog.createdAt));
}

async function clear(): Promise<void> {
  await harness.db.delete(aiConnector);
  await harness.db.delete(aiFieldPrompts);
  await harness.db.delete(activityLog).where(inArray(activityLog.action, [...ACTIONS]));
}

async function save(payload: Record<string, unknown>) {
  return harness.app.inject({ method: "PUT", url: URL, cookies: adminCookies, payload });
}

beforeAll(async () => {
  harness = await startHarness();
  const setup = await harness.app.inject({
    method: "POST",
    url: "/api/v1/auth/setup",
    payload: TEST_ADMIN,
  });
  expect(setup.statusCode, setup.body).toBe(201);
  adminCookies = await signInCookies(harness.app, TEST_ADMIN.email, TEST_ADMIN.password);
  await harness.app.inject({
    method: "POST",
    url: "/api/v1/auth/invites",
    cookies: adminCookies,
    payload: { email: STAFF.email, displayName: STAFF.displayName, role: "legal_team_member" },
  });
  const token = tokenFrom(harness.mailer.messagesTo(STAFF.email)[0]!.text);
  await harness.app.inject({
    method: "POST",
    url: "/api/auth/reset-password",
    payload: { newPassword: STAFF.password, token },
  });
  memberCookies = await signInCookies(harness.app, STAFF.email, STAFF.password);
});

afterAll(async () => {
  await harness.stop();
});

beforeEach(clear);

describe("the AI connector role gate", () => {
  it("refuses every operation to anonymous and non-Administrator callers", async () => {
    const requests = [
      { method: "GET" as const, url: URL },
      { method: "PUT" as const, url: URL, payload: { preset: "ollama", model: "llama3.2" } },
      { method: "POST" as const, url: `${URL}/test` },
      { method: "POST" as const, url: `${URL}/disable` },
      { method: "POST" as const, url: `${URL}/enable` },
      { method: "DELETE" as const, url: URL },
      { method: "GET" as const, url: PROMPTS_URL },
      {
        method: "PUT" as const,
        url: PROMPTS_URL,
        payload: { slug: "effective_date", prompt: "Find the start date." },
      },
    ];
    for (const request of requests) {
      const anonymous = await harness.app.inject(request);
      expect(anonymous.statusCode).toBe(401);
      expect(anonymous.headers["content-type"]).toContain("application/problem+json");
      expect(anonymous.json()).toMatchObject({ status: 401, title: "Authentication required." });

      const member = await harness.app.inject({ ...request, cookies: memberCookies });
      expect(member.statusCode).toBe(403);
      expect(member.headers["content-type"]).toContain("application/problem+json");
      expect(member.json()).toMatchObject({
        status: 403,
        title: "You do not have permission to perform this action.",
      });
    }
  });
});

describe("the core Field prompts", () => {
  it("reads all seven effective prompts, defaults, and override states", async () => {
    const response = await harness.app.inject({
      method: "GET",
      url: PROMPTS_URL,
      cookies: adminCookies,
    });

    expect(response.statusCode, response.body).toBe(200);
    expect(response.json().prompts).toEqual(
      CORE_ANALYSIS_TARGETS.map(({ slug, defaultPrompt }) => ({
        slug,
        prompt: defaultPrompt,
        defaultPrompt,
        overridden: false,
      })),
    );
  });

  it("trims one saved override, bounds it like a catalog Field prompt, and refuses unknown slugs", async () => {
    const saved = await harness.app.inject({
      method: "PUT",
      url: PROMPTS_URL,
      cookies: adminCookies,
      payload: { slug: "effective_date", prompt: "  Find the first effective date.  " },
    });
    expect(saved.statusCode, saved.body).toBe(200);
    expect(saved.json().prompt).toMatchObject({
      slug: "effective_date",
      prompt: "Find the first effective date.",
      overridden: true,
    });
    expect(await harness.db.select().from(aiFieldPrompts)).toMatchObject([
      { slug: "effective_date", prompt: "Find the first effective date." },
    ]);

    const tooLong = await harness.app.inject({
      method: "PUT",
      url: PROMPTS_URL,
      cookies: adminCookies,
      payload: { slug: "effective_date", prompt: "x".repeat(2_001) },
    });
    expect(tooLong.statusCode).toBe(400);

    const unknown = await harness.app.inject({
      method: "PUT",
      url: PROMPTS_URL,
      cookies: adminCookies,
      payload: { slug: "governing_law", prompt: "Find the governing law." },
    });
    expect(unknown.statusCode).toBe(400);
  });

  it("deletes an override on reset, reads the default again, and records both changes at the settings tier", async () => {
    const save = await harness.app.inject({
      method: "PUT",
      url: PROMPTS_URL,
      cookies: adminCookies,
      payload: { slug: "notice_period_days", prompt: "Find the notice period." },
    });
    expect(save.statusCode, save.body).toBe(200);

    const reset = await harness.app.inject({
      method: "PUT",
      url: PROMPTS_URL,
      cookies: adminCookies,
      payload: { slug: "notice_period_days", prompt: null },
    });
    expect(reset.statusCode, reset.body).toBe(200);
    expect(reset.json().prompt).toEqual({
      slug: "notice_period_days",
      prompt: CORE_ANALYSIS_TARGETS[4].defaultPrompt,
      defaultPrompt: CORE_ANALYSIS_TARGETS[4].defaultPrompt,
      overridden: false,
    });
    expect(await harness.db.select().from(aiFieldPrompts)).toHaveLength(0);

    const read = await harness.app.inject({
      method: "GET",
      url: PROMPTS_URL,
      cookies: adminCookies,
    });
    expect(
      read.json().prompts.find((prompt: { slug: string }) => prompt.slug === "notice_period_days"),
    ).toEqual(reset.json().prompt);

    const entries = await auditRows(harness.db);
    expect(entries.map((entry) => entry.action)).toEqual([
      "ai_field_prompt.updated",
      "ai_field_prompt.reset",
    ]);
    expect(entries).toMatchObject([
      {
        entityType: "system",
        actorId: expect.any(String),
        visibility: "admin_only",
        payload: { slug: "notice_period_days" },
      },
      {
        entityType: "system",
        actorId: expect.any(String),
        visibility: "admin_only",
        payload: { slug: "notice_period_days" },
      },
    ]);
  });
});

describe("saving and reading", () => {
  it("reads an unconfigured singleton and the seven server-owned choices", async () => {
    const res = await harness.app.inject({ method: "GET", url: URL, cookies: adminCookies });
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json().connector).toMatchObject({ configured: false, hasApiKey: false });
    expect(res.json().presets.map((option: { preset: string }) => option.preset)).toEqual([
      "anthropic",
      "openai",
      "azure_openai",
      "gemini",
      "openrouter",
      "ollama",
      "custom",
    ]);
  });

  it("refuses a first non-Ollama save without a key", async () => {
    const res = await save({ preset: "openai", model: "gpt-test" });
    expect(res.statusCode).toBe(400);
    expect(res.json().detail).toContain("API key");
  });

  it("saves Ollama without a key", async () => {
    const res = await save({ preset: "ollama", model: "llama-test" });
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json().connector).toMatchObject({
      preset: "ollama",
      protocol: "openai_chat_completions",
      baseUrl: "http://localhost:11434/v1",
      hasApiKey: false,
      model: "llama-test",
    });
  });

  it("pins a preset protocol and URL, ignoring client replacements", async () => {
    const res = await save({
      preset: "anthropic",
      protocol: "gemini",
      baseUrl: "https://attacker.invalid",
      apiKey: FAKE_VALID_AI_KEY,
      model: "claude-test",
    });
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json().connector).toMatchObject({
      protocol: "anthropic_messages",
      baseUrl: "https://api.anthropic.com/v1",
    });
  });

  it("stores a custom protocol and URL, and Azure's full deployment endpoint", async () => {
    const custom = await save({
      preset: "custom",
      protocol: "gemini",
      baseUrl: "https://models.example.test/root",
      apiKey: FAKE_VALID_AI_KEY,
      model: "legal-model",
    });
    expect(custom.statusCode, custom.body).toBe(200);
    expect(custom.json().connector).toMatchObject({
      protocol: "gemini",
      baseUrl: "https://models.example.test/root",
    });
    const azure = await save({
      preset: "azure_openai",
      baseUrl:
        "https://legal.openai.azure.com/openai/deployments/contracts/chat/completions?api-version=2026-01-01",
      model: "contracts",
    });
    expect(azure.statusCode, azure.body).toBe(200);
    expect(azure.json().connector.baseUrl).toContain("/deployments/contracts/chat/completions");
  });

  it("refuses a base URL that embeds plaintext credentials", async () => {
    const credentialUrl = new globalThis.URL("https://models.example.test/v1");
    credentialUrl.username = "example-user";
    credentialUrl.password = "example-password";
    const response = await save({
      preset: "custom",
      protocol: "openai_chat_completions",
      baseUrl: credentialUrl.toString(),
      apiKey: FAKE_VALID_AI_KEY,
      model: "legal-model",
    });
    expect(response.statusCode).toBe(400);
    expect(response.headers["content-type"]).toContain("application/problem+json");
    expect(response.json()).toMatchObject({
      status: 400,
      title: "The provider base URL must not contain credentials.",
    });
    expect(response.json().detail).toContain("must not contain credentials");
  });

  it("never returns the key, and a blank save keeps the sealed value", async () => {
    expect(
      (
        await save({
          preset: "openai",
          apiKey: FAKE_VALID_AI_KEY,
          model: "gpt-test",
        })
      ).statusCode,
    ).toBe(200);
    const updated = await save({ preset: "openai", apiKey: "   ", model: "gpt-test-2" });
    expect(updated.statusCode, updated.body).toBe(200);
    expect(updated.body).not.toContain(FAKE_VALID_AI_KEY);
    expect(updated.json().connector).toMatchObject({ hasApiKey: true, model: "gpt-test-2" });
    expect("apiKey" in updated.json().connector).toBe(false);
    const [opened] = await harness.db.select().from(aiConnector).limit(1);
    expect(opened?.apiKey).toBe(FAKE_VALID_AI_KEY);
    const raw = await harness.db.execute<{ value: string }>(
      sql`SELECT api_key AS value FROM ai_connector`,
    );
    expect(raw.rows[0]?.value).not.toContain(FAKE_VALID_AI_KEY);
  });

  it("keeps one row even after repeated saves", async () => {
    await save({ preset: "ollama", model: "one" });
    await save({ preset: "ollama", model: "two" });
    expect(await harness.db.select().from(aiConnector)).toHaveLength(1);
  });

  it("rebuilds the resolved provider from the next live read after an update", async () => {
    await save({ preset: "openai", apiKey: FAKE_VALID_AI_KEY, model: "model-one" });
    const first = await harness.resolveAiProvider();
    expect(first?.model).toBe("model-one");
    await save({ preset: "openai", model: "model-two" });
    const second = await harness.resolveAiProvider();
    expect(second?.model).toBe("model-two");
    expect(second).not.toBe(first);
  });
});

describe("testing and lifecycle", () => {
  it("probes successfully and reports the provider's refusal reason", async () => {
    await save({ preset: "openai", apiKey: FAKE_VALID_AI_KEY, model: "gpt-test" });
    const ok = await harness.app.inject({
      method: "POST",
      url: `${URL}/test`,
      cookies: adminCookies,
    });
    expect(ok.statusCode, ok.body).toBe(200);
    expect(ok.json()).toEqual({ ok: true });

    await save({ preset: "openai", apiKey: "wrong-api-key", model: "gpt-test" });
    const refused = await harness.app.inject({
      method: "POST",
      url: `${URL}/test`,
      cookies: adminCookies,
    });
    expect(refused.statusCode).toBe(502);
    expect(refused.json().detail).toContain("The provider refused the API key.");
  });

  it("turns the connector off and on through the live resolver", async () => {
    await save({ preset: "openai", apiKey: FAKE_VALID_AI_KEY, model: "gpt-test" });
    expect(await harness.resolveAiProvider()).not.toBeNull();
    const off = await harness.app.inject({
      method: "POST",
      url: `${URL}/disable`,
      cookies: adminCookies,
    });
    expect(off.statusCode, off.body).toBe(200);
    expect(off.json().connector.enabled).toBe(false);
    expect(await harness.resolveAiProvider()).toBeNull();
    const on = await harness.app.inject({
      method: "POST",
      url: `${URL}/enable`,
      cookies: adminCookies,
    });
    expect(on.statusCode, on.body).toBe(200);
    expect(await harness.resolveAiProvider()).not.toBeNull();
  });

  it("removes the row and resolves to no provider", async () => {
    await save({ preset: "openai", apiKey: FAKE_VALID_AI_KEY, model: "gpt-test" });
    const removed = await harness.app.inject({ method: "DELETE", url: URL, cookies: adminCookies });
    expect(removed.statusCode, removed.body).toBe(200);
    expect(removed.json().connector.configured).toBe(false);
    expect(await harness.db.select().from(aiConnector)).toHaveLength(0);
    expect(await harness.resolveAiProvider()).toBeNull();
  });
});

describe("the settings history", () => {
  it("records configure, update, disable, enable, and remove without the key", async () => {
    await save({ preset: "openai", apiKey: FAKE_VALID_AI_KEY, model: "gpt-test" });
    await save({ preset: "openai", model: "gpt-test-2" });
    await harness.app.inject({ method: "POST", url: `${URL}/disable`, cookies: adminCookies });
    await harness.app.inject({ method: "POST", url: `${URL}/enable`, cookies: adminCookies });
    await harness.app.inject({ method: "DELETE", url: URL, cookies: adminCookies });
    const rows = await auditRows(harness.db);
    expect(rows.map((row) => row.action)).toEqual([
      "ai_connector.configured",
      "ai_connector.updated",
      "ai_connector.disabled",
      "ai_connector.enabled",
      "ai_connector.removed",
    ]);
    expect(rows.every((row) => row.visibility === "admin_only")).toBe(true);
    expect(JSON.stringify(rows)).not.toContain(FAKE_VALID_AI_KEY);
  });
});
