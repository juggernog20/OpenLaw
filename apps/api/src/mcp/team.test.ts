// SPDX-License-Identifier: AGPL-3.0-only
import { afterAll, beforeAll, expect, it } from "vitest";
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import {
  activityLog,
  apiKeyRequests,
  contracts,
  contractTypes,
  contractStatuses,
  contractTeam,
  matters,
  matterTypes,
  matterStatuses,
  matterTeam,
  users,
  orgSettings,
  notifications,
  eq,
} from "@openlaw/db";
import { provisionUser } from "../auth/instance.js";
import { startHarness, signInCookies, TEST_ADMIN, type TestHarness } from "../testing/harness.js";

let h: TestHarness;
let admin: Record<string, string>;
let legalCookies: Record<string, string>;
let legalId: string;
let adminId: string;
let personId: string;
let legal: Client;
let reader: Client;
let narrow: Client;
let keyId: string;
const clients: Client[] = [];
const names = ["openlaw_team_add", "openlaw_team_remove"];
beforeAll(async () => {
  h = await startHarness();
  await h.app.inject({ method: "POST", url: "/api/v1/auth/setup", payload: TEST_ADMIN });
  admin = await signInCookies(h.app, TEST_ADMIN.email, TEST_ADMIN.password);
  adminId = (await h.db.select().from(users).where(eq(users.email, TEST_ADMIN.email)))[0]!.id;
  for (const [email, displayName] of [
    ["sarah@example.com", "Sarah Chen"],
    ["daniel@example.com", "Daniel Okafor"],
  ]) {
    const person = await provisionUser(h.app.auth, {
      email: email!,
      displayName: displayName!,
      password: TEST_ADMIN.password,
    });
    await h.db
      .update(users)
      .set({ role: email!.startsWith("sarah") ? "legal_team_member" : "business_user" })
      .where(eq(users.id, person.id));
    if (email!.startsWith("sarah")) legalId = person.id;
    else personId = person.id;
  }
  legalCookies = await signInCookies(h.app, "sarah@example.com", TEST_ADMIN.password);
  await h.db.update(orgSettings).set({
    mcpEnabled: true,
    mcpLegalApiKeysEnabled: true,
    mcpToolsetCeiling: ["team", "contracts"],
  });
  const endpoint = new URL("/mcp", await h.app.listen({ port: 0, host: "127.0.0.1" }));
  for (const [toolsets, scope] of [
    [["team"], "write"],
    [["team"], "read"],
    [["contracts"], "write"],
  ] as const) {
    const asked = await h.app.inject({
      method: "POST",
      url: "/api/v1/api-key-requests",
      cookies: legalCookies,
      payload: { clientName: "Claude Code", toolsets, scope },
    });
    expect(asked.statusCode, asked.body).toBe(201);
    const approved = await h.app.inject({
      method: "POST",
      url: `/api/v1/api-key-requests/${asked.json().id}/approve`,
      cookies: admin,
      payload: {},
    });
    expect(approved.statusCode, approved.body).toBe(200);
    const read = await h.app.inject({
      method: "GET",
      url: `/api/v1/api-key-requests/${asked.json().id}`,
      cookies: legalCookies,
    });
    const client = new Client({ name: "Claude Code", version: "1" });
    clients.push(client);
    await client.connect(
      new StreamableHTTPClientTransport(endpoint, {
        requestInit: { headers: { "x-api-key": read.json().key } },
      }),
    );
    if (scope === "read") reader = client;
    else if (toolsets[0] === "contracts") narrow = client;
    else {
      legal = client;
      keyId = (
        await h.db.select().from(apiKeyRequests).where(eq(apiKeyRequests.id, asked.json().id))
      )[0]!.keyId!;
    }
  }
});
afterAll(async () => {
  await Promise.all(clients.map((client) => client.close()));
  await h?.stop();
});
async function record(
  kind: "contract" | "matter",
  overrides: {
    archivedAt?: Date;
    isConfidential?: boolean;
    businessOwnerId?: string;
    createdBy?: string;
    managerId?: string;
  } = {},
) {
  const common = {
    title: "Team Tool record",
    createdBy: legalId,
    managerId: legalId,
    ...overrides,
  };
  if (kind === "contract") {
    const type = (await h.db.select().from(contractTypes).limit(1))[0]!;
    const status = (
      await h.db.select().from(contractStatuses).where(eq(contractStatuses.stage, "draft")).limit(1)
    )[0]!;
    return (
      await h.db
        .insert(contracts)
        .values({ ...common, contractTypeId: type.id, statusId: status.id })
        .returning()
    )[0]!;
  }
  const type = (await h.db.select().from(matterTypes).limit(1))[0]!;
  const status = (
    await h.db.select().from(matterStatuses).where(eq(matterStatuses.category, "open")).limit(1)
  )[0]!;
  return (
    await h.db
      .insert(matters)
      .values({ ...common, matterTypeId: type.id, statusId: status.id })
      .returning()
  )[0]!;
}
async function member(kind: "contract" | "matter", id: string, userId: string) {
  if (kind === "contract") await h.db.insert(contractTeam).values({ contractId: id, userId });
  else await h.db.insert(matterTeam).values({ matterId: id, userId });
}
async function call(client: Client, name: string, args: Record<string, unknown>, error?: string) {
  const result = await client.callTool({ name: `openlaw_team_${name}`, arguments: args });
  expect(result.isError, JSON.stringify(result)).toBe(error ? true : undefined);
  if (error) expect(JSON.stringify(result)).toContain(error);
  return result.structuredContent as { team: { id: string; displayName: string }[] };
}
it("lists Team Tools, applies the ceiling and grant, and refuses Business Users and read scope", async () => {
  const listed = (await legal.listTools()).tools;
  expect(listed.map((tool) => tool.name)).toEqual(expect.arrayContaining(names));
  expect(listed.find((tool) => tool.name === names[1])!.annotations!.destructiveHint).toBe(true);
  expect(listed.find((tool) => tool.name === names[0])!.annotations!.destructiveHint).toBe(false);
  const args = { record: "contract", number: 1, userId: personId };
  for (const name of ["add", "remove"]) {
    await call(narrow, name, args, "tool_outside_grant");
    await call(reader, name, args, "mcp_read_only");
  }
  expect((await narrow.listTools()).tools.map((tool) => tool.name)).not.toEqual(
    expect.arrayContaining(names),
  );
  try {
    await h.db.update(orgSettings).set({ mcpToolsetCeiling: ["contracts"] });
    for (const name of ["add", "remove"]) await call(legal, name, args, "tool_outside_grant");
    await h.db
      .update(orgSettings)
      .set({ mcpToolsetCeiling: ["team", "contracts"], mcpBusinessApiKeysEnabled: true });
    await h.db.update(users).set({ role: "business_user" }).where(eq(users.id, legalId));
    expect((await legal.listTools()).tools.map((tool) => tool.name)).not.toEqual(
      expect.arrayContaining(names),
    );
    for (const name of ["add", "remove"]) await call(legal, name, args, "tool_outside_grant");
  } finally {
    await h.db.update(users).set({ role: "legal_team_member" }).where(eq(users.id, legalId));
    await h.db.update(orgSettings).set({ mcpToolsetCeiling: ["team", "contracts"] });
  }
});
it.each(["contract", "matter"] as const)(
  "changes the %s team and retains person and Client attribution in History, audit and export",
  async (kind) => {
    const row = await record(kind);
    const args = { record: kind, number: row.number };
    const added = await call(legal, "add", { ...args, email: "DANIEL@example.com" });
    expect(added.team).toContainEqual(
      expect.objectContaining({ id: personId, displayName: "Daniel Okafor" }),
    );
    const removed = await call(legal, "remove", { ...args, userId: personId });
    expect(removed.team).toEqual([]);
    await call(legal, "add", { ...args, userId: personId });
    await call(legal, "remove", { ...args, email: "daniel@example.com" });
    const via = {
      actorId: legalId,
      viaKind: "api_key",
      viaId: keyId,
      viaClientName: "Claude Code",
    };
    const rows = await h.db.select().from(activityLog).where(eq(activityLog.entityId, row.id));
    expect(rows).toHaveLength(4);
    for (const action of ["added", "removed"])
      expect(rows).toContainEqual(
        expect.objectContaining({
          ...via,
          action: `${kind}.team_${action}`,
          visibility: "working_team",
          payload: { number: row.number, title: row.title, member: "Daniel Okafor" },
        }),
      );
    for (const url of [
      `/api/v1/activity?entityType=${kind}&entityId=${row.id}`,
      `/api/v1/audit-log?q=${row.id}`,
    ]) {
      const response = await h.app.inject({
        url,
        cookies: url.includes("audit-log") ? admin : legalCookies,
      });
      expect(response.statusCode, response.body).toBe(200);
      expect(response.json().entries).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            viaKind: "api_key",
            viaId: keyId,
            viaClientName: "Claude Code",
          }),
        ]),
      );
    }
    const csv = await h.app.inject({
      url: `/api/v1/audit-log/export?q=${row.id}`,
      cookies: admin,
    });
    expect(csv.statusCode).toBe(200);
    expect(csv.body).toContain('"Sarah Chen"');
    expect(csv.body).toContain(`"api_key","${keyId}","Claude Code"`);
    expect(csv.body).toContain("Daniel Okafor");
    if (kind === "contract") {
      const notices = await h.db
        .select()
        .from(notifications)
        .where(eq(notifications.userId, personId));
      expect(notices).toContainEqual(
        expect.objectContaining({
          payload: expect.objectContaining({
            actorName: "Sarah Chen",
            viaClientName: "Claude Code",
          }),
        }),
      );
    }
  },
);
it.each(["contract", "matter"] as const)(
  "enforces %s guards in order through the Tools",
  async (kind) => {
    const row = await record(kind);
    const args = { record: kind, number: row.number, userId: personId };
    await call(legal, "remove", args, "not_found");
    await call(legal, "add", args);
    await call(legal, "add", args, "conflict");
    await call(legal, "add", { ...args, userId: "unknown" }, "validation_error");
    await call(legal, "remove", { ...args, userId: "unknown" }, "not_found");
    for (const name of ["add", "remove"]) {
      await call(
        legal,
        name,
        { record: kind, number: row.number, email: "unknown@example.com" },
        "validation_error",
      );
      await call(legal, name, { ...args, email: "daniel@example.com" }, "invalid_arguments");
      await call(legal, name, { record: kind, number: row.number }, "invalid_arguments");
    }
    const owner = await record(kind, { businessOwnerId: personId });
    await member(kind, owner.id, personId);
    await call(legal, "remove", { ...args, number: owner.number }, "Change the Business Owner");
    const archived = await record(kind, { archivedAt: new Date() });
    const confidential = await record(kind, {
      isConfidential: true,
      createdBy: adminId,
      managerId: adminId,
      archivedAt: new Date(),
    });
    await member(kind, confidential.id, legalId);
    const hidden = await record(kind, {
      isConfidential: true,
      createdBy: adminId,
      managerId: adminId,
    });
    for (const name of ["add", "remove"]) {
      await call(legal, name, { ...args, number: archived.number, userId: "unknown" }, "archived");
      await call(
        legal,
        name,
        { ...args, number: confidential.number, userId: "unknown" },
        "forbidden",
      );
      await call(legal, name, { ...args, number: hidden.number }, "not_found");
    }
    for (const authority of ["creator", "manager"] as const) {
      const allowed = await record(kind, {
        isConfidential: true,
        createdBy: authority === "creator" ? legalId : adminId,
        managerId: authority === "manager" ? legalId : adminId,
      });
      if (authority === "creator") await member(kind, allowed.id, legalId);
      await call(legal, "add", { ...args, number: allowed.number });
      await call(legal, "remove", { ...args, number: allowed.number });
    }
    await h.db.update(users).set({ archivedAt: new Date() }).where(eq(users.id, personId));
    try {
      await call(legal, "add", { ...args, number: owner.number }, "validation_error");
      // A deactivated person can still leave a team, the same as over HTTP.
      expect((await call(legal, "remove", args)).team).toEqual([]);
      await call(
        legal,
        "remove",
        { record: kind, number: row.number, email: "daniel@example.com" },
        "not_found",
      );
    } finally {
      await h.db.update(users).set({ archivedAt: null }).where(eq(users.id, personId));
    }
  },
);
