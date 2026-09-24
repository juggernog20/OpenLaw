// SPDX-License-Identifier: AGPL-3.0-only
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
  sweepOrSay,
} from "./helpers.js";

const Policy = z.object({
  enabled: z.boolean(),
  legalApiKeysEnabled: z.boolean(),
  businessApiKeysEnabled: z.boolean(),
  toolsetCeiling: z.array(z.string()),
  readOnly: z.boolean(),
  apiKeyLifetimeDays: z.number(),
});

test.beforeAll(async ({ request }) => ensureAdminExists(request));
test.setTimeout(120_000);

test("a Legal Team Member collects an approved key once and connects an SDK Client", async ({
  page,
  browser,
}) => {
  await signInAs(page, ADMIN.email, ADMIN.password, ADMIN.displayName);
  const initial = await page.request.get("/api/v1/mcp-settings");
  expect(initial.status()).toBe(200);
  const policy = Policy.parse(await initial.json());
  const run = Date.now();
  const person = {
    email: `m40-${run}@example.com`,
    displayName: `M40 Legal ${run}`,
    password: ADMIN.password,
    role: "legal_team_member",
  };
  const clientName = `M40 headless ${run}`;
  let member: Awaited<ReturnType<typeof onboardActivatedMember>> | undefined;
  let requestId: string | undefined;
  const client = new Client({ name: "M40 journey", version: "1" });

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
      if (!requestId) return;
      const response = await page.request.get("/api/v1/mcp-settings/api-keys");
      expect(response.status()).toBe(200);
      const rows = z
        .array(z.object({ id: z.string(), status: z.string() }))
        .parse(await response.json());
      const row = rows.find((item) => item.id === requestId);
      if (row?.status === "pending") {
        const denied = await page.request.post(`/api/v1/api-key-requests/${requestId}/deny`, {
          data: {},
        });
        expect(denied.status()).toBe(200);
      } else if (row?.status === "active") {
        const revoked = await page.request.post(`/api/v1/api-key-requests/${requestId}/revoke`);
        expect(revoked.status()).toBe(200);
      }
    });
    await attempt(async () => {
      const restored = await page.request.patch("/api/v1/mcp-settings", { data: policy });
      expect(restored.status()).toBe(200);
    });
    await attempt(() => ensureMemberInert(page.request, person.email));
    await attempt(async () => member?.context.close());
    if (failures.length) throw new AggregateError(failures, "M40 cleanup failed");
  }

  try {
    const enabled = await page.request.patch("/api/v1/mcp-settings", {
      data: {
        enabled: true,
        legalApiKeysEnabled: true,
        toolsetCeiling: ["contracts"],
        readOnly: true,
      },
    });
    expect(enabled.status()).toBe(200);
    member = await onboardActivatedMember(page.request, browser, person);
    const requester = member.page;
    await requester.goto("/settings/api-keys");
    await requester.getByRole("button", { name: "Request a key", exact: true }).click();
    const dialog = requester.getByRole("dialog", { name: "Request an API key" });
    await dialog.getByLabel("Client name").fill(clientName);
    await dialog.getByRole("checkbox", { name: "Contracts", exact: true }).check();
    await dialog.getByRole("radio", { name: "Read. Find and read what you can access." }).check();
    const submitted = requester.waitForResponse(
      (response) =>
        response.url().endsWith("/api/v1/api-key-requests") &&
        response.request().method() === "POST",
    );
    await dialog.getByRole("button", { name: "Send request" }).click();
    const response = await submitted;
    expect(response.status()).toBe(201);
    requestId = z.object({ id: z.string() }).parse(await response.json()).id;
    await expect(requester.getByRole("row").filter({ hasText: clientName })).toContainText(
      "Pending approval",
    );

    await page.getByRole("button", { name: /^Notifications/ }).click();
    const approvals = page.getByRole("region", { name: "Your approvals" });
    const approval = approvals.getByRole("listitem").filter({ hasText: clientName });
    await expect(approval).toContainText(person.displayName);
    await page.getByRole("button", { name: "Mark all read", exact: true }).click();
    await expect(approval).toBeVisible();
    await approval.getByRole("button", { name: "Approve", exact: true }).click();
    await expect(approval).toHaveCount(0);

    await requester.reload();
    const ready = requester.getByRole("dialog", { name: "Your key is ready" });
    await expect(ready).toBeVisible();
    const key = await ready.locator("code").innerText();
    expect(key.length > 20).toBe(true);
    const guide = ready.getByRole("link", { name: "Connect a headless Client" });
    expect(await guide.getAttribute("href")).toBe("/documentation/connect-headless-client");
    await ready.getByRole("button", { name: "Done", exact: true }).click();
    await requester.reload();
    await expect(requester.getByRole("row").filter({ hasText: clientName })).toContainText(
      "Active",
    );
    await expect(ready).toHaveCount(0);
    const reread = await requester.request.get(`/api/v1/api-key-requests/${requestId}`);
    expect(reread.status()).toBe(200);
    expect(Boolean((await reread.json()).key)).toBe(false);

    await client.connect(
      new StreamableHTTPClientTransport(new URL("/mcp", BASE_URL), {
        requestInit: { headers: { "x-api-key": key } },
      }),
    );
    const names = (await client.listTools()).tools.map((tool) => tool.name);
    expect(names).toEqual(
      expect.arrayContaining([
        "openlaw_whoami",
        "openlaw_docs_read",
        "openlaw_docs_search",
        "openlaw_contracts_list",
        "openlaw_contract_get",
      ]),
    );
    expect(names).not.toContain("openlaw_contract_create");
    expect(names).not.toContain("openlaw_matters_list");
    const identity = await client.callTool({ name: "openlaw_whoami", arguments: {} });
    expect(identity.isError).not.toBe(true);
    expect(JSON.stringify(identity.structuredContent)).toContain(person.displayName);

    await requester.goto("/documentation/connect-headless-client");
    await expect(
      requester.getByRole("heading", { name: "Connect a headless Client", exact: true }),
    ).toBeVisible();
    await expect(requester.getByText("claude mcp add", { exact: false })).toBeVisible();
  } catch (error) {
    await sweepOrSay("M40", cleanup);
    throw error;
  }
  await cleanup();
});
