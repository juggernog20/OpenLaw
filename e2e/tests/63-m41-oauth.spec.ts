// SPDX-License-Identifier: AGPL-3.0-only
import { createHash, randomBytes } from "node:crypto";
import { createServer } from "node:http";
import { expect, test } from "@playwright/test";
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { z } from "zod";
import {
  ADMIN,
  BASE_URL,
  ensureAdminExists,
  ensureMemberInert,
  onboardActivatedMember,
  signInAs,
  signOut,
  sweepOrSay,
} from "./helpers.js";

const Policy = z.object({
  enabled: z.boolean(),
  legalOAuthClientsEnabled: z.boolean(),
  businessOAuthClientsEnabled: z.boolean(),
  toolsetCeiling: z.array(z.string()),
  readOnly: z.boolean(),
});

test.beforeAll(async ({ request }) => ensureAdminExists(request));
test.setTimeout(120_000);

test("a Legal Team Member consents to a Client, creates a Matter and disconnects", async ({
  page,
  browser,
  request,
}) => {
  page.setDefaultTimeout(15_000);
  await signInAs(page, ADMIN.email, ADMIN.password, ADMIN.displayName);
  const initial = await page.request.get("/api/v1/mcp-settings");
  expect(initial.status()).toBe(200);
  const policy = Policy.parse(await initial.json());
  const run = Date.now();
  const person = {
    email: `m41-${run}@example.com`,
    displayName: `M41 Legal ${run}`,
    password: ADMIN.password,
    role: "legal_team_member",
  };
  const clientName = `M41 Client ${run}`;
  const client = new Client({ name: "M41 journey", version: "1" });
  let member: Awaited<ReturnType<typeof onboardActivatedMember>> | undefined;
  let allowedId: string | undefined;
  let matterNumber: number | undefined;
  let matterTypeId: string | undefined;
  let callback: URL | undefined;
  const server = createServer((req, res) => {
    const url = new URL(req.url!, "http://127.0.0.1");
    if (url.pathname !== "/callback") {
      res.writeHead(404).end();
      return;
    }
    callback = url;
    res.writeHead(200, { "content-type": "text/plain" });
    res.end("Client connected. You can return to OpenLaw.");
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Callback has no port.");
  const redirectUri = `http://127.0.0.1:${address.port}/callback`;

  async function cleanup() {
    const failures: unknown[] = [];
    const attempt = async (action: () => Promise<unknown>) => {
      try {
        await action();
      } catch (error) {
        failures.push(error);
      }
    };
    await attempt(() => client.close());
    await attempt(async () => {
      if (allowedId) {
        const removed = await page.request.delete(
          `/api/v1/mcp-settings/allowed-clients/${allowedId}`,
        );
        expect(removed.status()).toBe(204);
      }
    });
    await attempt(async () => {
      if (matterNumber) {
        const archived = await page.request.post(`/api/v1/matters/${matterNumber}/archive`);
        expect(archived.status()).toBe(200);
      }
    });
    await attempt(async () => {
      if (matterTypeId) {
        const listed = await page.request.get("/api/v1/matter-types");
        expect(listed.status()).toBe(200);
        const types = z
          .object({ matterTypes: z.array(z.object({ id: z.string(), slug: z.string() })) })
          .parse(await listed.json());
        const fallback = types.matterTypes.find((type) => type.slug === "other");
        expect(fallback).toBeDefined();
        const archived = await page.request.post(`/api/v1/matter-types/${matterTypeId}/archive`, {
          data: { reassignToId: fallback!.id },
        });
        expect(archived.status()).toBe(200);
      }
    });
    await attempt(async () => {
      const restored = await page.request.patch("/api/v1/mcp-settings", { data: policy });
      expect(restored.status()).toBe(200);
    });
    await attempt(() => ensureMemberInert(page.request, person.email));
    await attempt(async () => member?.context.close());
    await attempt(
      () =>
        new Promise<void>((resolve, reject) =>
          server.close((error) => (error ? reject(error) : resolve())),
        ),
    );
    if (failures.length) throw new AggregateError(failures, "M41 cleanup failed");
  }

  try {
    const enabled = await page.request.patch("/api/v1/mcp-settings", {
      data: {
        enabled: true,
        legalOAuthClientsEnabled: false,
        businessOAuthClientsEnabled: false,
        toolsetCeiling: ["matters"],
        readOnly: false,
      },
    });
    expect(enabled.status()).toBe(200);
    await page.goto("/settings/mcp");
    await expect(page.getByRole("switch", { name: "Legal Users OAuth Clients" })).toBeVisible();
    await expect(page.getByRole("switch", { name: "Legal Users OAuth Clients" })).not.toBeChecked();
    await expect(page.getByText(/Not reachable|^Reachable$/)).toHaveCount(0);
    const saved = page.waitForResponse(
      (response) =>
        response.url().endsWith("/api/v1/mcp-settings") && response.request().method() === "PATCH",
    );
    await page.getByRole("switch", { name: "Legal Users OAuth Clients" }).click();
    expect((await saved).status()).toBe(200);
    await expect(page.getByRole("switch", { name: "Legal Users OAuth Clients" })).toBeChecked();
    await expect(page.getByText(/Not reachable · .*HTTPS scheme/)).toBeVisible();

    const registered = await page.request.post("/api/v1/mcp-settings/allowed-clients", {
      data: { name: clientName, callbackUrls: [redirectUri] },
    });
    expect(registered.status()).toBe(201);
    const allowed = z
      .object({ id: z.string(), clientId: z.string() })
      .parse(await registered.json());
    allowedId = allowed.id;
    const secretResponse = await page.request.post(
      `/api/v1/mcp-settings/allowed-clients/${allowedId}/secret`,
    );
    expect(secretResponse.status()).toBe(200);
    const { secret } = z.object({ secret: z.string() }).parse(await secretResponse.json());
    const typeResponse = await page.request.post("/api/v1/matter-types", {
      data: { displayName: `M41 ${run}` },
    });
    expect(typeResponse.status()).toBe(201);
    matterTypeId = z
      .object({ matterType: z.object({ id: z.string() }) })
      .parse(await typeResponse.json()).matterType.id;

    member = await onboardActivatedMember(page.request, browser, person);
    const requester = member.page;
    requester.setDefaultTimeout(15_000);
    await signOut(requester, person.displayName);
    const verifier = randomBytes(48).toString("base64url");
    const state = randomBytes(24).toString("base64url");
    const params = new URLSearchParams({
      client_id: allowed.clientId,
      redirect_uri: redirectUri,
      response_type: "code",
      scope: "toolset:matters write offline_access",
      resource: new URL("/mcp", BASE_URL).href,
      code_challenge: createHash("sha256").update(verifier).digest("base64url"),
      code_challenge_method: "S256",
      state,
    });
    await requester.goto(`/api/auth/oauth2/authorize?${params}`);
    await expect(requester).toHaveURL(/\/auth\/login\?/);
    await requester.getByLabel("Email").fill(person.email);
    await requester.getByLabel("Password", { exact: true }).fill(person.password);
    await requester.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(requester).toHaveURL(/\/auth\/consent\?/);
    await expect(
      requester.getByRole("heading", { name: `${clientName} wants to work in OpenLaw as you` }),
    ).toBeVisible();
    await expect(requester.getByText(person.email, { exact: true })).toBeVisible();
    await expect(requester.getByText("Allowed Client", { exact: true })).toBeVisible();
    const allow = requester.getByRole("button", { name: "Allow", exact: true });
    await expect(allow).toBeDisabled();
    await requester.getByRole("checkbox", { name: "Matters", exact: true }).check();
    await requester.getByRole("radio", { name: "Read and write", exact: true }).check();
    await allow.click();
    await expect(requester).toHaveURL((url) => `${url.origin}${url.pathname}` === redirectUri);
    expect(callback?.searchParams.get("state")).toBe(state);
    expect(callback?.searchParams.has("error")).toBe(false);
    const code = z.string().min(1).parse(callback?.searchParams.get("code"));
    const tokenResponse = await request.post("/api/auth/oauth2/token", {
      form: {
        grant_type: "authorization_code",
        client_id: allowed.clientId,
        client_secret: secret,
        code,
        redirect_uri: redirectUri,
        code_verifier: verifier,
        resource: new URL("/mcp", BASE_URL).href,
      },
    });
    expect(tokenResponse.status()).toBe(200);
    const token = z
      .object({ access_token: z.string(), scope: z.string() })
      .parse(await tokenResponse.json());
    expect(token.scope.split(" ").sort()).toEqual(["offline_access", "toolset:matters", "write"]);
    await client.connect(
      new StreamableHTTPClientTransport(new URL("/mcp", BASE_URL), {
        requestInit: { headers: { authorization: `Bearer ${token.access_token}` } },
      }),
    );
    const names = (await client.listTools()).tools.map((tool) => tool.name);
    expect(names).toEqual(
      expect.arrayContaining(["openlaw_whoami", "openlaw_matters_list", "openlaw_matter_create"]),
    );
    expect(names).not.toContain("openlaw_contracts_list");
    const title = `Matter via ${clientName}`;
    const created = await client.callTool({
      name: "openlaw_matter_create",
      arguments: { matterTypeId, answers: { title } },
    });
    expect(created.isError, JSON.stringify(created.content)).not.toBe(true);
    matterNumber = z.object({ number: z.number() }).parse(created.structuredContent).number;
    await requester.goto(`/matters/${matterNumber}`);
    await expect(requester.getByRole("heading", { name: title, exact: true })).toBeVisible();
    await requester.getByRole("button", { name: /^History/ }).click();
    const history = requester.getByRole("complementary", { name: "History" });
    await expect(history).toContainText(`via ${clientName}`);
    await expect(history).toContainText(person.displayName);

    await requester.getByRole("banner").getByRole("button", { name: person.displayName }).click();
    await requester.getByRole("menuitem", { name: "Settings", exact: true }).click();
    await requester
      .getByRole("navigation", { name: "Settings sections" })
      .getByRole("link", { name: "API keys", exact: true })
      .click();
    const connected = requester.getByRole("region", { name: "Connected Clients" });
    await expect(connected).toContainText(clientName);
    await expect(connected).toContainText("Matters");
    await expect(connected).toContainText("Write");
    await connected.getByRole("button", { name: `Disconnect ${clientName}`, exact: true }).click();
    await requester
      .getByRole("dialog", { name: "Revoke OAuth grant" })
      .getByRole("button", { name: "Revoke", exact: true })
      .click();
    await expect(connected).not.toContainText(clientName);
    await expect(client.listTools()).rejects.toThrow(/401/);
  } catch (error) {
    await sweepOrSay("M41", cleanup);
    throw error;
  }
  await cleanup();
});
