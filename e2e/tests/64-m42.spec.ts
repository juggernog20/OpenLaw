// SPDX-License-Identifier: AGPL-3.0-only
import { expect, test, type APIResponse, type Page } from "@playwright/test";
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
  toolsetCeiling: z.array(z.string()),
  readOnly: z.boolean(),
});
async function body(response: APIResponse, status = 200) {
  expect(response.status(), await response.text()).toBe(status);
  return response.json();
}

test.beforeAll(async ({ request }) => ensureAdminExists(request));
test.setTimeout(180_000);

test("a Client follows the Toolset ceiling, reads a Contract and changes a Matter team", async ({
  page,
  browser,
}) => {
  page.setDefaultTimeout(15_000);
  await signInAs(page, ADMIN.email, ADMIN.password, ADMIN.displayName);
  const policy = Policy.parse(await body(await page.request.get("/api/v1/mcp-settings")));
  const run = Date.now();
  const person = {
    email: `m42-${run}@example.com`,
    displayName: `M42 Legal ${run}`,
    password: ADMIN.password,
    role: "legal_team_member",
  };
  const colleague = {
    ...person,
    email: `m42-colleague-${run}@example.com`,
    displayName: `M42 Colleague ${run}`,
  };
  const clientName = `M42 Client ${run}`;
  const clients: Client[] = [];
  const requests: string[] = [];
  const records: { kind: "contract" | "matter"; number: number; typeId: string }[] = [];
  const types: { kind: "contract" | "matter"; id: string }[] = [];
  const members: Awaited<ReturnType<typeof onboardActivatedMember>>[] = [];

  async function connect(key: string) {
    const client = new Client(
      { name: "M42 journey", version: "1" },
      {
        versionNegotiation: { mode: { pin: "2026-07-28" } },
      },
    );
    clients.push(client);
    await client.connect(
      new StreamableHTTPClientTransport(new URL("/mcp", BASE_URL), {
        requestInit: { headers: { "x-api-key": key } },
      }),
    );
    return client;
  }
  async function requestKey(requester: Page, name: string, toolsets: string[]) {
    await requester.goto("/settings/api-keys");
    await requester.getByRole("button", { name: "Request a key", exact: true }).click();
    const dialog = requester.getByRole("dialog", { name: "Request an API key" });
    await dialog.getByLabel("Client name").fill(name);
    for (const toolset of toolsets)
      await dialog.getByRole("checkbox", { name: toolset, exact: true }).check();
    await dialog.getByRole("radio", { name: /^Write\./ }).check();
    const submitted = requester.waitForResponse(
      (r) => r.url().endsWith("/api/v1/api-key-requests") && r.request().method() === "POST",
    );
    await dialog.getByRole("button", { name: "Send request" }).click();
    const response = await submitted;
    expect(response.status()).toBe(201);
    requests.push(z.object({ id: z.string() }).parse(await response.json()).id);
    await expect(requester.getByRole("row").filter({ hasText: name })).toContainText(
      "Pending approval",
    );
    await page.getByRole("button", { name: /^Notifications/ }).click();
    const approval = page
      .getByRole("region", { name: "Your approvals" })
      .getByRole("listitem")
      .filter({ hasText: name });
    await approval.getByRole("button", { name: "Approve", exact: true }).click();
    await expect(approval).toHaveCount(0);
    await page.keyboard.press("Escape");
    await requester.reload();
    const ready = requester.getByRole("dialog", { name: "Your key is ready" });
    const key = await ready.getByRole("code").innerText();
    await ready.getByRole("button", { name: "Done", exact: true }).click();
    return key;
  }
  async function ceiling(label: string) {
    const saved = page.waitForResponse(
      (r) => r.url().endsWith("/api/v1/mcp-settings") && r.request().method() === "PATCH",
    );
    const checkbox = page.getByRole("checkbox", { name: label, exact: true });
    await checkbox.click();
    expect((await saved).status()).toBe(200);
    await expect(checkbox).toBeChecked();
  }
  async function cleanup() {
    const failures: unknown[] = [];
    const attempt = async (action: () => Promise<unknown>) => {
      try {
        await action();
      } catch (error) {
        failures.push(error);
      }
    };
    for (const client of clients) await attempt(() => client.close());
    for (const id of requests)
      await attempt(async () => {
        const rows = z
          .array(z.object({ id: z.string(), status: z.string() }))
          .parse(await body(await page.request.get("/api/v1/mcp-settings/api-keys")));
        const status = rows.find((r) => r.id === id)?.status;
        if (status === "pending")
          await body(await page.request.post(`/api/v1/api-key-requests/${id}/deny`, { data: {} }));
        if (status === "active")
          await body(await page.request.post(`/api/v1/api-key-requests/${id}/revoke`));
      });
    for (const record of records)
      await attempt(async () => {
        await body(await page.request.post(`/api/v1/${record.kind}s/${record.number}/archive`));
      });
    for (const type of types)
      await attempt(async () => {
        const listed = await body(await page.request.get(`/api/v1/${type.kind}-types`));
        const fallback = z
          .array(z.object({ id: z.string(), slug: z.string() }))
          .parse(listed[`${type.kind}Types`])
          .find((r) => r.slug === "other");
        expect(fallback).toBeDefined();
        await body(
          await page.request.post(`/api/v1/${type.kind}-types/${type.id}/archive`, {
            data: { reassignToId: fallback!.id },
          }),
        );
      });
    await attempt(async () => {
      await body(await page.request.patch("/api/v1/mcp-settings", { data: policy }));
    });
    for (const fixture of [person, colleague])
      await attempt(() => ensureMemberInert(page.request, fixture.email));
    for (const member of members) await attempt(() => member.context.close());
    if (failures.length) throw new AggregateError(failures, "M42 cleanup failed");
  }

  try {
    await body(
      await page.request.patch("/api/v1/mcp-settings", {
        data: {
          enabled: true,
          legalApiKeysEnabled: true,
          toolsetCeiling: ["contracts", "matters", "requests"],
          readOnly: false,
        },
      }),
    );
    members.push(await onboardActivatedMember(page.request, browser, person));
    members.push(await onboardActivatedMember(page.request, browser, colleague));
    const requester = members[0]!.page;
    requester.setDefaultTimeout(15_000);
    for (const kind of ["contract", "matter"] as const) {
      const createdType = await body(
        await page.request.post(`/api/v1/${kind}-types`, {
          data: { displayName: `M42 ${kind} ${run}` },
        }),
        201,
      );
      const typeId = z.object({ id: z.string() }).parse(createdType[`${kind}Type`]).id;
      types.push({ kind, id: typeId });
      const created = await body(
        await requester.request.post(`/api/v1/${kind}s`, {
          data: { title: `M42 ${kind} ${run}`, [`${kind}TypeId`]: typeId },
        }),
        201,
      );
      records.push({
        kind,
        typeId,
        number: z.object({ number: z.number() }).parse(created[kind]).number,
      });
    }
    const contract = records.find((r) => r.kind === "contract")!;
    const matter = records.find((r) => r.kind === "matter")!;
    const original =
      await test.step("A Legal Team Member holds an API key with Contracts, Matters and Requests", async () =>
        connect(
          await requestKey(requester, `M42 Original ${run}`, ["Contracts", "Matters", "Requests"]),
        ));
    await test.step("The Client opens a listen stream and re-lists Tools when an Administrator enables Team", async () => {
      const before = (await original.listTools()).tools.map((t) => t.name);
      expect(before).toEqual(
        expect.arrayContaining([
          "openlaw_contract_get",
          "openlaw_matter_get",
          "openlaw_requests_list",
        ]),
      );
      expect(before).not.toContain("openlaw_team_add");
      let changes = 0;
      original.setNotificationHandler("notifications/tools/list_changed", () => {
        changes++;
      });
      const subscription = await original.listen({ toolsListChanged: true });
      expect(subscription.honoredFilter).toEqual({ toolsListChanged: true });
      await page.goto("/settings/mcp");
      await page.getByRole("button", { name: "Toolset ceiling", exact: true }).click();
      await expect(page.getByRole("checkbox", { name: "Team", exact: true })).not.toBeChecked();
      await ceiling("Team");
      await expect.poll(() => changes).toBeGreaterThan(0);
      // The ceiling expands, but the original API key still holds its approved Toolsets.
      expect(
        (await original.listTools(undefined, { cacheMode: "refresh" })).tools
          .map((t) => t.name)
          .sort(),
      ).toEqual(before.sort());
    });
    const client =
      await test.step("The Legal Team Member requests Team and an Administrator approves the API key request", async () => {
        const connected = await connect(
          await requestKey(requester, clientName, ["Contracts", "Matters", "Requests", "Team"]),
        );
        expect((await connected.listTools()).tools.map((t) => t.name)).toEqual(
          expect.arrayContaining(["openlaw_team_add", "openlaw_team_remove"]),
        );
        return connected;
      });
    await test.step("The Client reads a Contract resource and gets summarize_record", async () => {
      const uri = `openlaw://contracts/${contract.number}`;
      const resource = await client.readResource({ uri });
      expect(resource.contents).toHaveLength(1);
      const content = z.object({ uri: z.string(), text: z.string() }).parse(resource.contents[0]);
      expect(content.uri).toBe(uri);
      expect(content.text).toContain(`M42 contract ${run}`);
      const prompt = await client.getPrompt({
        name: "summarize_record",
        arguments: { record: uri },
      });
      const embedded = prompt.messages.find((message) => message.content.type === "resource");
      expect(embedded?.content).toMatchObject({
        type: "resource",
        resource: { uri, text: content.text },
      });
    });
    await test.step("The Client adds and removes a colleague and the Matter History names the Client for both", async () => {
      for (const operation of ["add", "remove"]) {
        const result = await client.callTool({
          name: `openlaw_team_${operation}`,
          arguments: { record: "matter", number: matter.number, email: colleague.email },
        });
        expect(result.isError, JSON.stringify(result.content)).not.toBe(true);
        const team = z
          .object({ team: z.array(z.object({ displayName: z.string() })) })
          .parse(result.structuredContent).team;
        expect(team.some((p) => p.displayName === colleague.displayName)).toBe(operation === "add");
      }
      await requester.goto(`/matters/${matter.number}`);
      await requester.getByRole("button", { name: /^History/ }).click();
      const history = requester.getByRole("complementary", { name: "History" });
      await expect(
        history.getByText(
          `${person.displayName}, via ${clientName}, added ${colleague.displayName} to the team`,
          { exact: true },
        ),
      ).toBeVisible();
      await expect(
        history.getByText(
          `${person.displayName}, via ${clientName}, took ${colleague.displayName} off the team`,
          { exact: true },
        ),
      ).toBeVisible();
    });
    await test.step("An Administrator's Client reads the two team Audit log entries and General settings", async () => {
      await page.goto("/settings/mcp");
      await page.getByRole("button", { name: "Toolset ceiling", exact: true }).click();
      await ceiling("Administration");
      const issued = z.object({ id: z.string(), key: z.string() }).parse(
        await body(
          await page.request.post("/api/v1/api-key-requests", {
            data: {
              clientName: `M42 Administrator ${run}`,
              toolsets: ["administration"],
              scope: "read",
            },
          }),
          201,
        ),
      );
      requests.push(issued.id);
      const admin = await connect(issued.key);
      const audit = await admin.callTool({
        name: "openlaw_audit_log_query",
        arguments: { entityType: "matter", q: `M42 matter ${run}`, limit: 100 },
      });
      expect(audit.isError).not.toBe(true);
      const entries = z
        .object({
          entries: z.array(
            z.object({
              action: z.string(),
              viaClientName: z.string().nullable(),
              actor: z.object({ displayName: z.string() }).nullable(),
            }),
          ),
        })
        .parse(audit.structuredContent).entries;
      const team = entries.filter((entry) =>
        ["matter.team_added", "matter.team_removed"].includes(entry.action),
      );
      expect(team.map((entry) => entry.action).sort()).toEqual([
        "matter.team_added",
        "matter.team_removed",
      ]);
      for (const entry of team) {
        expect(entry.viaClientName).toBe(clientName);
        expect(entry.actor?.displayName).toBe(person.displayName);
      }
      const result = await admin.callTool({
        name: "openlaw_settings_get",
        arguments: { section: "general" },
      });
      expect(result.isError).not.toBe(true);
      const general = await body(await page.request.get("/api/v1/org/general"));
      expect(result.structuredContent).toEqual({ settings: general });
      expect(JSON.stringify(result.structuredContent)).not.toMatch(
        /secret|password|apiKey|privateKey/i,
      );
    });
    await test.step("The Administrator reads resource, prompt and Tool rows on the Tool calls tab", async () => {
      await page.goto("/settings/audit-log");
      await page.getByRole("link", { name: "Tool calls", exact: true }).click();
      for (const tool of [
        "resource:contracts",
        "prompt:summarize_record",
        "openlaw_team_add",
        "openlaw_team_remove",
      ]) {
        const row = page.getByRole("row").filter({ hasText: clientName }).filter({ hasText: tool });
        await expect(row).toHaveCount(1);
        await expect(row).toContainText("Success");
      }
    });
  } catch (error) {
    await sweepOrSay("M42", cleanup);
    throw error;
  }
  await cleanup();
});
