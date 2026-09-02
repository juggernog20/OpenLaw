// SPDX-License-Identifier: AGPL-3.0-only

import { createServer, type Server } from "node:http";
import { once } from "node:events";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createAiProvider } from "../../lib/ai/index.js";
import {
  signInCookies,
  startHarness,
  TEST_ADMIN,
  type TestHarness,
} from "../../testing/harness.js";

const VALID_KEY = "local-provider-valid-key"; // NOSONAR - inert local-server fixture
let server: Server;
let baseUrl: string;
let harness: TestHarness;
let cookies: Record<string, string>;

beforeAll(async () => {
  server = createServer(async (request, response) => {
    for await (const chunk of request) {
      // Drain the request before answering, as a real provider does.
      void chunk;
    }
    response.setHeader("content-type", "application/json");
    if (request.url?.startsWith("/wrong/")) {
      response.statusCode = 404;
      response.end(JSON.stringify({ error: { message: "The deployment URL is wrong." } }));
      return;
    }
    if (request.headers.authorization !== `Bearer ${VALID_KEY}`) {
      response.statusCode = 401;
      response.end(JSON.stringify({ error: { message: "That API key is not valid." } }));
      return;
    }
    response.statusCode = 200;
    response.end(JSON.stringify({ choices: [{ message: { content: '{"ok":true}' } }] }));
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("AI test server did not bind");
  baseUrl = `http://127.0.0.1:${address.port}`;

  harness = await startHarness({ aiDriverFactory: createAiProvider });
  const setup = await harness.app.inject({
    method: "POST",
    url: "/api/v1/auth/setup",
    payload: TEST_ADMIN,
  });
  expect(setup.statusCode, setup.body).toBe(201);
  cookies = await signInCookies(harness.app, TEST_ADMIN.email, TEST_ADMIN.password);
});

afterAll(async () => {
  await harness.stop();
  server.close();
  await once(server, "close");
});

async function save(apiKey: string, url = baseUrl) {
  const response = await harness.app.inject({
    method: "PUT",
    url: "/api/v1/ai-connector",
    cookies,
    payload: {
      preset: "custom",
      protocol: "openai_chat_completions",
      baseUrl: url,
      apiKey,
      model: "local-contract-model",
    },
  });
  expect(response.statusCode, response.body).toBe(200);
}

async function probe() {
  return harness.app.inject({ method: "POST", url: "/api/v1/ai-connector/test", cookies });
}

describe("the connector test through a node:http provider", () => {
  it("answers ok after one real adapter call", async () => {
    await save(VALID_KEY);
    const response = await probe();
    expect(response.statusCode, response.body).toBe(200);
    expect(response.headers["content-type"]).toContain("application/json");
    expect(response.json()).toEqual({ ok: true });
  });

  it("prints the provider's reason for a wrong key", async () => {
    await save("wrong-key");
    const response = await probe();
    expect(response.statusCode).toBe(502);
    expect(response.headers["content-type"]).toContain("application/problem+json");
    expect(response.json()).toMatchObject({ status: 502, title: "Bad gateway" });
    expect(response.json().detail).toContain("That API key is not valid.");
  });

  it("prints the provider's reason for a wrong base URL", async () => {
    await save(VALID_KEY, `${baseUrl}/wrong`);
    const response = await probe();
    expect(response.statusCode).toBe(502);
    expect(response.headers["content-type"]).toContain("application/problem+json");
    expect(response.json()).toMatchObject({ status: 502, title: "Bad gateway" });
    expect(response.json().detail).toContain("The deployment URL is wrong.");
  });
});
