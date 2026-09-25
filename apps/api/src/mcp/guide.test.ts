// SPDX-License-Identifier: AGPL-3.0-only
import { afterAll, beforeAll, expect, it } from "vitest";
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import {
  contractTypes,
  matterTypes,
  requestTypes,
  fields,
  departments,
  regions,
  orgSettings,
  users,
  eq,
} from "@openlaw/db";
import { provisionUser } from "../auth/instance.js";
import { startHarness, signInCookies, TEST_ADMIN, type TestHarness } from "../testing/harness.js";
import { z } from "zod";
import { VocabularyOutput, FormOutput, DocsSearchOutput, DocsReadOutput } from "./guide.js";
import { toolRegister } from "./register.js";
import { compileWorkspace } from "../../../../scripts/documentation/build.mjs";
import {
  searchDocumentation,
  documentationExcerpt,
} from "../../../../scripts/documentation/reader.mjs";

let h: TestHarness;
let admin: Record<string, string>;
let legal: Client;
let business: Client;
let typeId: string;
let requestId: string;
let matterId: string;
let hiddenId: string;
const clients: Client[] = [];
const names = [
  "openlaw_whoami",
  "openlaw_vocabulary",
  "openlaw_docs_search",
  "openlaw_docs_read",
  "openlaw_form_get",
];
beforeAll(async () => {
  h = await startHarness();
  await h.app.inject({ method: "POST", url: "/api/v1/auth/setup", payload: TEST_ADMIN });
  admin = await signInCookies(h.app, TEST_ADMIN.email, TEST_ADMIN.password);
  await h.db
    .update(orgSettings)
    .set({ mcpEnabled: true, mcpLegalApiKeysEnabled: true, mcpBusinessApiKeysEnabled: true });
  const endpoint = new URL("/mcp", await h.app.listen({ port: 0, host: "127.0.0.1" }));
  for (const role of ["legal_team_member", "business_user"] as const) {
    const person = await provisionUser(h.app.auth, {
      email: `${role}@example.com`,
      displayName: role,
      password: TEST_ADMIN.password,
    });
    await h.db.update(users).set({ role }).where(eq(users.id, person.id));
    const cookies = await signInCookies(h.app, `${role}@example.com`, TEST_ADMIN.password);
    const asked = await h.app.inject({
      method: "POST",
      url: "/api/v1/api-key-requests",
      cookies,
      payload: { clientName: "Guide test", toolsets: ["requests"], scope: "read" },
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
      cookies,
    });
    const client = new Client({ name: "Guide test", version: "1" });
    clients.push(client);
    await client.connect(
      new StreamableHTTPClientTransport(endpoint, {
        requestInit: { headers: { "x-api-key": read.json().key } },
      }),
    );
    if (role === "business_user") business = client;
    else legal = client;
  }
  const created = await h.app.inject({
    method: "POST",
    url: "/api/v1/contract-types",
    cookies: admin,
    payload: { displayName: "Guide Contract" },
  });
  typeId = created.json().contractType.id;
  const [matter] = await h.db.select().from(matterTypes).limit(1);
  matterId = matter!.id;
  const [request] = await h.db
    .insert(requestTypes)
    .values({
      slug: "guide-request",
      displayName: "Guide Request",
      displayOrder: 99,
      targetModule: "contract",
      targetContractTypeId: typeId,
    })
    .returning();
  requestId = request!.id;
  const rows = await h.db
    .insert(fields)
    .values([
      {
        slug: "guide_choice",
        displayName: "Choice",
        moduleScope: "contract",
        fieldType: "single_select",
        options: ["Yes", "No"],
      },
      { slug: "guide_detail", displayName: "Detail", moduleScope: "contract", fieldType: "text" },
      {
        slug: "guide_hidden",
        displayName: "Internal reviewer",
        moduleScope: "contract",
        fieldType: "user",
      },
    ])
    .returning();
  hiddenId = rows[2]!.id;
  const read = await h.app.inject({
    method: "GET",
    url: `/api/v1/contract-types/${typeId}/form`,
    cookies: admin,
  });
  const row = (index: number, intake: boolean) => ({
    kind: "row",
    id: rows[index]!.id,
    rowRef: rows[index]!.slug,
    fieldType: rows[index]!.fieldType,
    onIntakeForm: intake,
    visibleOnPortal: intake,
    isRequired: true,
  });
  const saved = await h.app.inject({
    method: "PUT",
    url: `/api/v1/contract-types/${typeId}/form`,
    cookies: admin,
    payload: {
      form: [
        ...read.json().form,
        row(0, true),
        {
          kind: "branch",
          id: "details",
          match: "all",
          conditions: [{ rowRef: "guide_choice", operator: "equals", value: "Yes" }],
          children: [row(1, true)],
        },
        row(2, false),
      ],
    },
  });
  expect(saved.statusCode, saved.body).toBe(200);
  await h.db
    .insert(departments)
    .values({ slug: "guide-sales", displayName: "Guide Sales", displayOrder: 99 });
  await h.db
    .insert(regions)
    .values({ slug: "guide-region", displayName: "Guide Region", displayOrder: 99 });
});
afterAll(async () => {
  await Promise.all(clients.map((c) => c.close()));
  await h?.stop();
});
const outputs = {
  openlaw_vocabulary: VocabularyOutput,
  openlaw_form_get: FormOutput,
  openlaw_docs_search: DocsSearchOutput,
  openlaw_docs_read: DocsReadOutput,
};
async function call<N extends keyof typeof outputs>(
  client: Client,
  name: N,
  args: Record<string, unknown> = {},
): Promise<z.infer<(typeof outputs)[N]>> {
  const result = await client.callTool({ name, arguments: args });
  expect(result.isError, JSON.stringify(result.content)).not.toBe(true);
  const parsed = toolRegister
    .find((t) => t.name === name)!
    .outputSchema.parse(result.structuredContent);
  expect(result.content).toEqual([{ type: "text", text: JSON.stringify(parsed) }]);
  return outputs[name].parse(parsed) as z.infer<(typeof outputs)[N]>;
}
it("always lists five Guide Tools for both audiences with a narrowed ceiling", async () => {
  await h.db.update(orgSettings).set({ mcpToolsetCeiling: [] });
  try {
    for (const client of clients)
      expect((await client.listTools()).tools.map((t) => t.name)).toEqual(names);
  } finally {
    await h.db.update(orgSettings).set({ mcpToolsetCeiling: ["requests"] });
  }
});
it("reads live configured vocabulary for Legal and projects Fields for a Business User", async () => {
  const staff = await call(legal, "openlaw_vocabulary");
  expect(staff.contractTypes.find((t) => t.id === typeId)!.fields.map((f) => f.slug)).toContain(
    "guide_hidden",
  );
  const portal = await call(business, "openlaw_vocabulary");
  expect(portal.contractTypes.find((t) => t.id === typeId)!.fields.map((f) => f.slug)).toEqual(
    expect.arrayContaining(["guide_choice", "guide_detail"]),
  );
  expect(portal.requestTypes.find((t) => t.id === requestId)!.fields.map((f) => f.slug)).toContain(
    "guide_detail",
  );
  expect(JSON.stringify(portal)).not.toContain("guide_hidden");
  expect(portal.contractStatuses.length).toBeGreaterThan(0);
  expect(portal.matterStatuses.length).toBeGreaterThan(0);
  expect(portal.departments).toContainEqual(
    expect.objectContaining({ displayName: "Guide Sales" }),
  );
  expect(portal.regions).toContainEqual(expect.objectContaining({ displayName: "Guide Region" }));
  await h.db.update(fields).set({ archivedAt: new Date() }).where(eq(fields.id, hiddenId));
  try {
    expect(JSON.stringify(await call(legal, "openlaw_vocabulary"))).not.toContain("guide_hidden");
  } finally {
    await h.db.update(fields).set({ archivedAt: null }).where(eq(fields.id, hiddenId));
  }
});
it("reads the Request Intake Form as a Business User, preserving Branches and choices", async () => {
  const result = await call(business, "openlaw_form_get", { kind: "request", typeId: requestId });
  expect(result.basics).toEqual(["title", "department", "urgency", "attachments"]);
  expect(result.nodes).toContainEqual(
    expect.objectContaining({
      kind: "branch",
      id: "details",
      conditions: [{ rowRef: "guide_choice", operator: "equals", value: "Yes" }],
    }),
  );
  expect(result.nodes).toContainEqual(
    expect.objectContaining({ rowRef: "guide_detail", parentBranchId: "details" }),
  );
  expect(result.fields).toContainEqual(
    expect.objectContaining({ slug: "guide_choice", options: ["Yes", "No"] }),
  );
  expect(JSON.stringify(result)).not.toContain("guide_hidden");
});
it("reads Contract and Matter creation Forms and refuses missing or archived types", async () => {
  const result = await call(legal, "openlaw_form_get", { kind: "contract", typeId });
  expect(result.nodes).toContainEqual(
    expect.objectContaining({ rowRef: "guide_hidden", isRequired: true }),
  );
  expect(result.fields).toContainEqual(
    expect.objectContaining({ slug: "guide_hidden", fieldType: "user", isRequired: true }),
  );
  expect(
    (await call(legal, "openlaw_form_get", { kind: "matter", typeId: matterId })).nodes,
  ).toContainEqual(expect.objectContaining({ rowRef: "title" }));
  for (const kind of ["contract", "matter", "request"])
    expect(
      (await legal.callTool({ name: "openlaw_form_get", arguments: { kind, typeId: "missing" } }))
        .isError,
    ).toBe(true);
  await h.db
    .update(requestTypes)
    .set({ archivedAt: new Date() })
    .where(eq(requestTypes.id, requestId));
  try {
    expect(
      (
        await business.callTool({
          name: "openlaw_form_get",
          arguments: { kind: "request", typeId: requestId },
        })
      ).isError,
    ).toBe(true);
  } finally {
    await h.db.update(requestTypes).set({ archivedAt: null }).where(eq(requestTypes.id, requestId));
  }
  expect(
    (await business.callTool({ name: "openlaw_form_get", arguments: { kind: "contract", typeId } }))
      .isError,
  ).toBe(true);
});
it("searches and reads the same compiled articles with shared ranking and excerpts", async () => {
  const bundle = compileWorkspace({ development: true }).bundle;
  const query = "contract";
  const expected = searchDocumentation(bundle, { query }).slice(0, 2);
  expect(expected).toHaveLength(2);
  const result = await call(business, "openlaw_docs_search", { query, limit: 2 });
  expect(result.articles.map((a) => a.id)).toEqual(expected.map((a) => a.id));
  expect(result.articles[0]!.excerpt).toBe(documentationExcerpt(expected[0]!, query));
  const next = await call(business, "openlaw_docs_search", {
    query,
    limit: 2,
    cursor: result.nextCursor,
  });
  expect(next.articles[0]!.id).toBe(searchDocumentation(bundle, { query })[2]!.id);
  const article = await call(legal, "openlaw_docs_read", { id: expected[0]!.id });
  expect(article.text).toBe(expected[0]!.text);
  expect(article.unverified).toBe(expected[0]!.unverified);
  expect(
    (await call(legal, "openlaw_docs_search", { query: "no-such-phrase-12345" })).articles,
  ).toEqual([]);
  expect(
    (await legal.callTool({ name: "openlaw_docs_read", arguments: { id: "../../.env" } })).isError,
  ).toBe(true);
});

it("pages vocabulary without dropping or duplicating configured entries", async () => {
  const complete = await call(legal, "openlaw_vocabulary");
  const collections = [
    "contractTypes",
    "matterTypes",
    "requestTypes",
    "contractStatuses",
    "matterStatuses",
    "departments",
    "regions",
  ] as const;
  const expected = collections.flatMap((key) => complete[key].map((item) => `${key}:${item.id}`));
  const actual: string[] = [];
  let cursor: string | null = null;
  do {
    const result: z.infer<typeof VocabularyOutput> = await call(legal, "openlaw_vocabulary", {
      limit: 3,
      ...(cursor === null ? {} : { cursor }),
    });
    actual.push(...collections.flatMap((key) => result[key].map((item) => `${key}:${item.id}`)));
    cursor = result.nextCursor;
  } while (cursor !== null);
  expect(actual).toEqual(expected);
});

it("pages long articles within the byte budget and rejects malformed cursors", async () => {
  const bundle = compileWorkspace({ development: true }).bundle;
  const longest = searchDocumentation(bundle).sort((a, b) => b.text.length - a.text.length)[0]!;
  expect(longest.text.length).toBeGreaterThan(12_000);
  let text = "";
  let cursor: string | null = null;
  do {
    const result: z.infer<typeof DocsReadOutput> = await call(legal, "openlaw_docs_read", {
      id: longest.id,
      ...(cursor === null ? {} : { cursor }),
    });
    expect(Buffer.byteLength(JSON.stringify(result))).toBeLessThanOrEqual(32_000);
    text += result.text;
    cursor = result.nextCursor;
  } while (cursor !== null);
  expect(text).toBe(longest.text);
  for (const cursor of ["-1", "1e3", "NaN"]) {
    const result = await legal.callTool({ name: "openlaw_docs_search", arguments: { cursor } });
    expect(result.isError).toBe(true);
    expect(JSON.stringify(result.content)).toContain("invalid_arguments");
  }
});

it("keeps vocabulary readable when one Request type has an unavailable destination Form", async () => {
  await h.db
    .update(contractTypes)
    .set({ archivedAt: new Date() })
    .where(eq(contractTypes.id, typeId));
  try {
    for (const client of clients) {
      const result = await call(client, "openlaw_vocabulary");
      expect(result.requestTypes.find((t) => t.id === requestId)).toMatchObject({
        targetModule: "contract",
        targetTypeId: typeId,
        fields: [],
        formAvailable: false,
      });
      expect(result.matterTypes.length).toBeGreaterThan(0);
      const form = await client.callTool({
        name: "openlaw_form_get",
        arguments: { kind: "request", typeId: requestId },
      });
      expect(form.isError).toBe(true);
      expect(JSON.stringify(form.content)).toContain("form_unavailable");
    }
  } finally {
    await h.db.update(contractTypes).set({ archivedAt: null }).where(eq(contractTypes.id, typeId));
  }
});

it.each([
  "configure-mcp",
  "connect-headless-client",
  "connect-claude",
  "connect-chatgpt",
  "connect-microsoft-365-copilot",
])("serves %s through Guide with the same article as Help", async (id) => {
  const article = compileWorkspace({ development: true }).bundle.articles.find((a) => a.id === id);
  expect(article).toBeDefined();
  for (const client of [legal, business]) {
    const found = await call(client, "openlaw_docs_search", { query: article!.title });
    expect(found.articles.map((a) => a.id)).toContain(id);
    const read = await call(client, "openlaw_docs_read", { id });
    expect(read.text).toBe(article!.text);
  }
});
