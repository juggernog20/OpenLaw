// SPDX-License-Identifier: AGPL-3.0-only

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
  activityLog,
  aiConnector,
  aiSavedKeys,
  eq,
  aiFieldPrompts,
  asc,
  inArray,
  sql,
  type Db,
} from "@openlaw/db";
import { createAiResolver } from "../../lib/ai/resolver.js";
import { conversionPrompt, readAiPrompts } from "../../lib/ai-prompts.js";
import { createFakeAiProvider } from "../../lib/ai/fake.js";
import { AI_PROMPTS, CORE_ANALYSIS_TARGETS } from "@openlaw/shared";
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
  "ai_saved_key.stored",
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
  await harness.db.delete(aiSavedKeys);
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
afterEach(() => vi.unstubAllGlobals());

describe("the AI connector role gate", () => {
  it("refuses every operation to anonymous and non-Administrator callers", async () => {
    const requests = [
      { method: "GET" as const, url: URL },
      { method: "PUT" as const, url: URL, payload: { preset: "ollama", model: "llama3.2" } },
      { method: "POST" as const, url: `${URL}/test` },
      { method: "POST" as const, url: `${URL}/models`, payload: { preset: "ollama" } },
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
  it("reads every editable prompt with its default, its section, and its override state", async () => {
    const response = await harness.app.inject({
      method: "GET",
      url: PROMPTS_URL,
      cookies: adminCookies,
    });

    expect(response.statusCode, response.body).toBe(200);
    expect(response.json().prompts).toEqual(
      AI_PROMPTS.map(({ slug, group, defaultPrompt }) => ({
        slug,
        group,
        prompt: defaultPrompt,
        defaultPrompt,
        overridden: false,
      })),
    );
    // The three sections, in the order the card draws them, with the
    // seven core targets still last and still all present.
    const groups = response.json().prompts.map((prompt: { group: string }) => prompt.group);
    expect([...new Set(groups)]).toEqual(["rules", "conversion", "analysis"]);
    expect(
      response
        .json()
        .prompts.filter((prompt: { group: string }) => prompt.group === "analysis")
        .map((prompt: { slug: string }) => prompt.slug),
    ).toEqual(CORE_ANALYSIS_TARGETS.map((target) => target.slug));
  });

  it("saves a shared rule and a conversion prompt under their own slugs", async () => {
    const rule = await harness.app.inject({
      method: "PUT",
      url: PROMPTS_URL,
      cookies: adminCookies,
      payload: { slug: "rules.text_answers", prompt: "Answer text fields in one sentence." },
    });
    expect(rule.statusCode, rule.body).toBe(200);
    expect(rule.json().prompt).toMatchObject({
      slug: "rules.text_answers",
      group: "rules",
      prompt: "Answer text fields in one sentence.",
      overridden: true,
    });
    const conversion = await harness.app.inject({
      method: "PUT",
      url: PROMPTS_URL,
      cookies: adminCookies,
      payload: { slug: "conversion.title", prompt: "Propose a short {module} title." },
    });
    expect(conversion.statusCode, conversion.body).toBe(200);
    expect(conversion.json().prompt).toMatchObject({
      slug: "conversion.title",
      group: "conversion",
      overridden: true,
    });
    const book = await readAiPrompts(harness.db);
    expect(book.rules).toContain("Answer text fields in one sentence.");
    expect(conversionPrompt(book, "conversion.title", "Contract")).toBe(
      "Propose a short Contract title.",
    );
    for (const slug of ["rules.text_answers", "conversion.title"] as const) {
      const reset = await harness.app.inject({
        method: "PUT",
        url: PROMPTS_URL,
        cookies: adminCookies,
        payload: { slug, prompt: null },
      });
      expect(reset.statusCode, reset.body).toBe(200);
    }
    expect(await harness.db.select().from(aiFieldPrompts)).toHaveLength(0);
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
      group: "analysis",
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
  it("rotates only the destination's Saved key and rebuilds a driver when that key changes", async () => {
    await save({ preset: "openai", model: "one", apiKey: FAKE_VALID_AI_KEY });
    await save({ preset: "groq", model: "two", apiKey: "groq-test-key" });
    await save({ preset: "openai", model: "one", apiKey: "replacement-test-key" });
    const keys = await harness.db.select().from(aiSavedKeys);
    expect(keys).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ preset: "openai", apiKey: "replacement-test-key" }),
        expect.objectContaining({ preset: "groq", apiKey: "groq-test-key" }),
      ]),
    );
    const build = vi.fn(createFakeAiProvider);
    const resolve = createAiResolver(harness.db, build);
    const first = await resolve();
    expect(await resolve()).toBe(first);
    const [before] = await harness.db.select().from(aiConnector);
    await harness.db
      .update(aiSavedKeys)
      .set({ apiKey: FAKE_VALID_AI_KEY })
      .where(eq(aiSavedKeys.preset, "openai"));
    expect(await resolve()).not.toBe(first);
    expect(build).toHaveBeenCalledTimes(2);
    expect(build.mock.calls.at(-1)?.[0]?.apiKey).toBe(FAKE_VALID_AI_KEY);
    expect((await harness.db.select().from(aiConnector))[0]?.updatedAt).toEqual(before?.updatedAt);
    const stored = (await auditRows(harness.db)).filter(
      (row) => row.action === "ai_saved_key.stored",
    );
    expect(stored.map((row) => row.payload)).toEqual([
      {
        preset: "openai",
        protocol: "openai_chat_completions",
        baseUrl: "https://api.openai.com/v1",
        replaced: false,
      },
      {
        preset: "groq",
        protocol: "openai_chat_completions",
        baseUrl: "https://api.groq.com/openai/v1",
        replaced: false,
      },
      {
        preset: "openai",
        protocol: "openai_chat_completions",
        baseUrl: "https://api.openai.com/v1",
        replaced: true,
      },
    ]);
    expect(JSON.stringify(stored)).not.toContain("replacement-test-key");
    expect((await auditRows(harness.db)).some((row) => row.payload.field === "apiKey")).toBe(false);
  });

  it("stores an optional pasted Ollama key and restricts deletion of a key in use", async () => {
    const saved = await save({ preset: "ollama", model: "local", apiKey: FAKE_VALID_AI_KEY });
    expect(saved.statusCode, saved.body).toBe(200);
    expect(saved.json().connector.savedKeys).toEqual([
      expect.objectContaining({ preset: "ollama", inUse: true }),
    ]);
    await expect(harness.db.delete(aiSavedKeys)).rejects.toThrow();
    const reused = await save({ preset: "ollama", model: "local" });
    expect(reused.json().connector.hasApiKey).toBe(true);
  });

  it("finds a migrated Saved key whose URL has not been normalized", async () => {
    await harness.db.insert(aiSavedKeys).values({
      preset: "custom",
      protocol: "openai_chat_completions",
      baseUrl: "https://legacy.test/v1/?b=2&a=1#old",
      apiKey: FAKE_VALID_AI_KEY,
    });
    const saved = await save({
      preset: "custom",
      protocol: "openai_chat_completions",
      baseUrl: "https://legacy.test/v1?a=1&b=2",
      model: "local",
    });
    expect(saved.statusCode, saved.body).toBe(200);
    expect(saved.json().connector.savedKeys).toHaveLength(1);
    expect(saved.json().connector.savedKeys[0].baseUrl).toBe("https://legacy.test/v1?a=1&b=2");
    const build = vi.fn(createFakeAiProvider);
    await createAiResolver(harness.db, build)();
    expect(build.mock.calls[0]?.[0]?.apiKey).toBe(FAKE_VALID_AI_KEY);
  });

  it("keeps Saved keys when switching OpenAI to Groq and back, and when removing the connector", async () => {
    const openai = await save({ preset: "openai", model: "one", apiKey: FAKE_VALID_AI_KEY });
    expect(openai.statusCode, openai.body).toBe(200);
    const groq = await save({ preset: "groq", model: "two", apiKey: "groq-test-key" });
    expect(groq.statusCode, groq.body).toBe(200);
    const returned = await save({ preset: "openai", model: "one", apiKey: "" });
    expect(returned.statusCode, returned.body).toBe(200);
    expect(returned.json().connector.savedKeys).toEqual([
      expect.objectContaining({ preset: "openai", inUse: true }),
      expect.objectContaining({ preset: "groq", inUse: false }),
    ]);
    const probe = await harness.app.inject({
      method: "POST",
      url: `${URL}/test`,
      cookies: adminCookies,
    });
    expect(probe.statusCode, probe.body).toBe(200);
    const removed = await harness.app.inject({ method: "DELETE", url: URL, cookies: adminCookies });
    expect(removed.statusCode, removed.body).toBe(200);
    expect(removed.json().connector).toMatchObject({ configured: false, hasApiKey: false });
    expect(removed.json().connector.savedKeys).toEqual([
      expect.objectContaining({ preset: "openai", inUse: false }),
      expect.objectContaining({ preset: "groq", inUse: false }),
    ]);
    const read = await harness.app.inject({ method: "GET", url: URL, cookies: adminCookies });
    expect(read.json().connector.savedKeys).toEqual(removed.json().connector.savedKeys);
    for (const response of [openai, groq, returned, removed, read]) {
      expect(response.body).not.toContain(FAKE_VALID_AI_KEY);
      expect(response.body).not.toContain("groq-test-key");
    }
    expect((await save({ preset: "openai", model: "one" })).statusCode).toBe(200);
  });

  it("shares a Saved key across normalized custom URLs", async () => {
    const config = { preset: "custom", protocol: "openai_chat_completions", model: "local" };
    await save({
      ...config,
      baseUrl: "https://private.test/v1/?b=2&a=1#ignored",
      apiKey: FAKE_VALID_AI_KEY,
    });
    const reused = await save({ ...config, baseUrl: "https://private.test/v1?a=1&b=2" });
    expect(reused.statusCode, reused.body).toBe(200);
    expect(reused.json().connector.savedKeys).toEqual([
      expect.objectContaining({ baseUrl: "https://private.test/v1?a=1&b=2", inUse: true }),
    ]);
    const replaced = await save({
      ...config,
      baseUrl: "https://private.test/v1/?a=1&b=2",
      apiKey: "replacement-test-key",
    });
    expect(replaced.statusCode, replaced.body).toBe(200);
    expect(replaced.json().connector.savedKeys).toHaveLength(1);
    expect(replaced.json().connector.savedKeys[0].id).toBe(reused.json().connector.savedKeys[0].id);
  });

  it("reads an unconfigured singleton and the eight server-owned choices", async () => {
    const res = await harness.app.inject({ method: "GET", url: URL, cookies: adminCookies });
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json().connector).toMatchObject({ configured: false, hasApiKey: false });
    expect(res.json().presets.map((option: { preset: string }) => option.preset)).toEqual([
      "anthropic",
      "openai",
      "azure_openai",
      "gemini",
      "openrouter",
      "groq",
      "ollama",
      "custom",
    ]);
  });

  it("pins Groq settings and retains its Saved key through model and preset changes", async () => {
    const missingKey = await save({ preset: "groq", model: "openai/gpt-oss-120b" });
    expect(missingKey.statusCode, missingKey.body).toBe(400);
    expect(missingKey.json().detail).toContain("API key");

    const saved = await save({
      preset: "groq",
      protocol: "gemini",
      baseUrl: "https://attacker.invalid",
      apiKey: FAKE_VALID_AI_KEY,
      model: "openai/gpt-oss-120b",
    });
    expect(saved.statusCode, saved.body).toBe(200);
    expect(saved.json().connector).toMatchObject({
      preset: "groq",
      protocol: "openai_chat_completions",
      baseUrl: "https://api.groq.com/openai/v1",
      model: "openai/gpt-oss-120b",
      hasApiKey: true,
    });
    expect(
      saved.json().presets.find((option: { preset: string }) => option.preset === "groq"),
    ).toEqual({
      preset: "groq",
      label: "Groq",
      protocol: "openai_chat_completions",
      baseUrl: "https://api.groq.com/openai/v1",
      defaultModel: "openai/gpt-oss-120b",
      requiresApiKey: true,
      requiresBaseUrl: false,
    });
    const updated = await save({ preset: "groq", model: "another-model" });
    expect(updated.statusCode, updated.body).toBe(200);
    expect(updated.json().connector).toMatchObject({ model: "another-model", hasApiKey: true });
    expect((await harness.db.select().from(aiSavedKeys))[0]?.apiKey).toBe(FAKE_VALID_AI_KEY);
    const probe = await harness.app.inject({
      method: "POST",
      url: `${URL}/test`,
      cookies: adminCookies,
    });
    expect(probe.statusCode, probe.body).toBe(200);
    expect(probe.json()).toEqual({ ok: true });
    expect(await auditRows(harness.db)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          action: "ai_connector.configured",
          payload: expect.objectContaining({ preset: "groq" }),
        }),
      ]),
    );

    const refused = await save({ preset: "openai", model: "gpt-test" });
    expect(refused.statusCode, refused.body).toBe(400);
    const changed = await save({ preset: "ollama", model: "llama3.2" });
    expect(changed.statusCode, changed.body).toBe(200);
    expect(changed.json().connector.hasApiKey).toBe(false);
    expect((await harness.db.select().from(aiConnector))[0]?.savedKeyId).toBeNull();
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
      apiKey: FAKE_VALID_AI_KEY,
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
    const [opened] = await harness.db.select().from(aiSavedKeys).limit(1);
    expect(opened?.apiKey).toBe(FAKE_VALID_AI_KEY);
    const raw = await harness.db.execute<{ value: string }>(
      sql`SELECT api_key AS value FROM ai_saved_keys`,
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
      "ai_saved_key.stored",
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

describe("model discovery", () => {
  it("loads models with the requested Saved key even while another destination is in use", async () => {
    await save({ preset: "openai", model: "one", apiKey: FAKE_VALID_AI_KEY });
    await save({ preset: "groq", model: "two", apiKey: "groq-test-key" });
    const fetcher = vi.fn().mockImplementation(() => Promise.resolve(Response.json({ data: [] })));
    vi.stubGlobal("fetch", fetcher);
    for (const [preset, key] of [
      ["openai", FAKE_VALID_AI_KEY],
      ["groq", "groq-test-key"],
    ]) {
      const response = await discover({ preset });
      expect(response.statusCode, response.body).toBe(200);
      expect(fetcher.mock.calls.at(-1)?.[1]).toMatchObject({
        headers: { authorization: `Bearer ${key}` },
      });
      expect(response.body).not.toContain(key);
    }
    expect((await discover({ preset: "anthropic" })).statusCode).toBe(400);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  async function discover(payload: Record<string, unknown>) {
    return harness.app.inject({
      method: "POST",
      url: `${URL}/models`,
      cookies: adminCookies,
      payload,
    });
  }

  it("loads pending settings without requiring a model or saving settings", async () => {
    const fetcher = vi.fn().mockResolvedValue(Response.json({ data: [{ id: "test-model" }] }));
    vi.stubGlobal("fetch", fetcher);
    const response = await discover({
      preset: "openai",
      apiKey: FAKE_VALID_AI_KEY,
      baseUrl: "https://ignored.test",
      protocol: "gemini",
    });
    expect(response.statusCode, response.body).toBe(200);
    expect(response.json()).toEqual({
      models: [{ id: "test-model", label: "test-model" }],
      truncated: false,
    });
    expect(String(fetcher.mock.calls[0]![0])).toBe("https://api.openai.com/v1/models");
    expect(await harness.db.select().from(aiConnector)).toHaveLength(0);
    expect(await auditRows(harness.db)).toHaveLength(0);
    expect(response.body).not.toContain(FAKE_VALID_AI_KEY);
  });

  it("reuses the sealed key only at the saved destination", async () => {
    await save({
      preset: "custom",
      protocol: "openai_chat_completions",
      baseUrl: "https://private.test/v1/",
      model: "one",
      apiKey: FAKE_VALID_AI_KEY,
    });
    const fetcher = vi.fn().mockResolvedValueOnce(Response.json({ data: [] }));
    vi.stubGlobal("fetch", fetcher);
    const same = await discover({
      preset: "custom",
      protocol: "openai_chat_completions",
      baseUrl: "https://private.test/v1",
    });
    expect(same.statusCode, same.body).toBe(200);
    expect(fetcher.mock.calls[0]![1]).toMatchObject({
      headers: { authorization: `Bearer ${FAKE_VALID_AI_KEY}` },
    });
    for (const config of [
      { preset: "openai" },
      { preset: "custom", protocol: "openai_chat_completions", baseUrl: "https://other.test/v1" },
      { preset: "custom", protocol: "gemini", baseUrl: "https://private.test/v1" },
      {
        preset: "custom",
        protocol: "openai_chat_completions",
        baseUrl: "https://private.test/other",
      },
    ]) {
      const refused = await discover(config);
      expect(refused.statusCode, refused.body).toBe(400);
      const saveRefused = await save({ ...config, model: "two" });
      expect(saveRefused.statusCode, saveRefused.body).toBe(400);
    }
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect((await harness.db.select().from(aiConnector))[0]?.model).toBe("one");
  });

  it("uses a newly entered key at a changed destination without changing the saved key", async () => {
    await save({ preset: "openai", model: "old", apiKey: FAKE_VALID_AI_KEY });
    const fetcher = vi.fn().mockResolvedValue(Response.json({ data: [] }));
    vi.stubGlobal("fetch", fetcher);
    const result = await discover({ preset: "anthropic", apiKey: "replacement-test-key" });
    expect(result.statusCode, result.body).toBe(200);
    expect(fetcher.mock.calls[0]![1]).toMatchObject({
      headers: { "x-api-key": "replacement-test-key" },
    });
    expect((await harness.db.select().from(aiSavedKeys))[0]?.apiKey).toBe(FAKE_VALID_AI_KEY);
  });

  it("lists Ollama without sending a previous provider key and explains Azure manual entry", async () => {
    await save({ preset: "openai", model: "old", apiKey: FAKE_VALID_AI_KEY });
    const fetcher = vi.fn().mockResolvedValue(Response.json({ data: [] }));
    vi.stubGlobal("fetch", fetcher);
    expect((await discover({ preset: "ollama" })).statusCode).toBe(200);
    expect(fetcher.mock.calls[0]![1].headers).not.toHaveProperty("authorization");
    const azure = await discover({
      preset: "azure_openai",
      baseUrl: "https://azure.test/deployment",
    });
    expect(azure.statusCode).toBe(400);
    expect(azure.json().detail).toContain("deployment name");
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("leaves the previous Saved key on file when saving keyless Ollama", async () => {
    await save({ preset: "openai", model: "old", apiKey: FAKE_VALID_AI_KEY });
    const result = await save({ preset: "ollama", model: "installed" });
    expect(result.statusCode, result.body).toBe(200);
    expect(result.json().connector.hasApiKey).toBe(false);
    expect((await harness.db.select().from(aiConnector))[0]?.savedKeyId).toBeNull();
    expect(await harness.db.select().from(aiSavedKeys)).toHaveLength(1);
    expect((await auditRows(harness.db)).some((row) => row.payload.field === "apiKey")).toBe(false);
  });

  it("does not expose an echoed secret when a provider refuses discovery", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response(FAKE_VALID_AI_KEY, { status: 401 })),
    );
    const response = await discover({ preset: "openai", apiKey: FAKE_VALID_AI_KEY });
    expect(response.statusCode).toBe(502);
    expect(response.json().detail).toContain("HTTP 401");
    expect(response.body).not.toContain(FAKE_VALID_AI_KEY);
  });
});

describe("output token limits", () => {
  it("persists the limit, retains it when omitted, and refreshes the live driver", async () => {
    const saved = await save({ preset: "ollama", model: "local", maxOutputTokens: 65536 });
    expect(saved.statusCode, saved.body).toBe(200);
    expect(saved.json().connector.maxOutputTokens).toBe(65536);
    const build = vi.fn(createFakeAiProvider);
    const resolve = createAiResolver(harness.db, build);
    await resolve();
    expect(build.mock.calls[0]?.[0]).toMatchObject({ maxOutputTokens: 65536 });
    await save({ preset: "ollama", model: "local", maxOutputTokens: 131072 });
    await resolve();
    expect(build.mock.calls.at(-1)?.[0]).toMatchObject({ maxOutputTokens: 131072 });
    const retained = await save({ preset: "ollama", model: "local" });
    expect(retained.json().connector.maxOutputTokens).toBe(131072);
    const read = await harness.app.inject({ method: "GET", url: URL, cookies: adminCookies });
    expect(read.json().connector.maxOutputTokens).toBe(131072);
    const entries = await auditRows(harness.db);
    expect(
      entries.some(
        (entry) => entry.payload.field === "maxOutputTokens" && entry.payload.new === 131072,
      ),
    ).toBe(true);
  });

  it("defaults to 32768 and rejects invalid limits", async () => {
    const saved = await save({ preset: "ollama", model: "local" });
    expect(saved.json().connector.maxOutputTokens).toBe(32768);
    for (const maxOutputTokens of [0, 1023, 262145, 8192.5, "65536"]) {
      const response = await save({ preset: "ollama", model: "local", maxOutputTokens });
      expect(response.statusCode, response.body).toBe(400);
    }
  });
});
