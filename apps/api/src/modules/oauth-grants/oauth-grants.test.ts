// SPDX-License-Identifier: AGPL-3.0-only
import { toolRegister, type ToolDefinition } from "../../mcp/register.js";
import { createHash } from "node:crypto";
import { afterAll, beforeAll, beforeEach, expect, it, vi } from "vitest";
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { decodeJwt } from "jose";
import { MCP_TOOLSETS, type McpToolset } from "@openlaw/shared";
import { provisionUser } from "../../auth/instance.js";
import {
  allowedClients,
  oauthGrants,
  oauthConsents,
  oauthRefreshTokens,
  activityLog,
  notifications,
  mcpToolCalls,
  contracts,
  contractTypes,
  contractStatuses,
  users,
  eq,
  and,
  orgSettings,
} from "@openlaw/db";
import {
  startHarness,
  signInCookies,
  TEST_ADMIN,
  type TestHarness,
} from "../../testing/harness.js";
let h: TestHarness;
let cookies: Record<string, string>;
let clientId: string;
let clientSecret: string;
let allowedId: string;
let personId: string;
let businessId: string;
let business: Record<string, string>;
const verifier = "openlaw-consent-verifier-".repeat(3);
beforeAll(async () => {
  h = await startHarness({
    advancedRuntime: {
      baseline: { MCP_RATE_LIMIT_PER_HOUR: "100" },
      active: { MCP_RATE_LIMIT_PER_HOUR: "100" },
    },
  });
  await h.app.inject({ method: "POST", url: "/api/v1/auth/setup", payload: TEST_ADMIN });
  cookies = await signInCookies(h.app, TEST_ADMIN.email, TEST_ADMIN.password);
  await h.db.update(orgSettings).set({ mcpEnabled: true, mcpLegalOAuthClientsEnabled: true });
  const created = await h.app.inject({
    method: "POST",
    url: "/api/v1/mcp-settings/allowed-clients",
    cookies,
    payload: { name: "Test Client", callbackUrls: ["https://client.example/callback"] },
  });
  expect(created.statusCode, created.body).toBe(201);
  clientId = created.json().clientId;
  allowedId = created.json().id;
  personId = (await h.db.select().from(users).where(eq(users.email, TEST_ADMIN.email)))[0]!.id;
  const person = await provisionUser(h.app.auth, {
    email: "business@example.com",
    displayName: "Business Person",
    password: TEST_ADMIN.password,
  });
  businessId = person.id;
  await h.db.update(users).set({ role: "business_user" }).where(eq(users.id, person.id));
  business = await signInCookies(h.app, "business@example.com", TEST_ADMIN.password);
  const secret = await h.app.inject({
    method: "POST",
    url: `/api/v1/mcp-settings/allowed-clients/${created.json().id}/secret`,
    cookies,
  });
  clientSecret = secret.json().secret;
});
afterAll(async () => {
  await h?.stop();
});
beforeEach(async () => {
  await h.db.update(orgSettings).set({
    mcpEnabled: true,
    mcpLegalOAuthClientsEnabled: true,
    mcpBusinessOAuthClientsEnabled: true,
    mcpReadOnly: false,
    mcpToolsetCeiling: [...MCP_TOOLSETS],
  });
  await h.db.update(allowedClients).set({ enabled: true }).where(eq(allowedClients.id, allowedId));
});
function authorizeParams(forceConsent = true) {
  return new URLSearchParams({
    client_id: clientId,
    redirect_uri: "https://client.example/callback",
    response_type: "code",
    scope: [...MCP_TOOLSETS.map((t) => `toolset:${t}`), "write", "offline_access"].join(" "),
    ...(forceConsent ? { prompt: "consent" } : {}),
    code_challenge: createHash("sha256").update(verifier).digest("base64url"),
    code_challenge_method: "S256",
    state: "test",
  });
}
async function query(session = cookies, forceConsent = true) {
  const res = await h.app.inject({
    url: `/api/auth/oauth2/authorize?${authorizeParams(forceConsent)}`,
    cookies: session,
  });
  expect(res.statusCode, res.body).toBe(302);
  return new URL(res.headers.location!, h.app.baseUrl).search.slice(1);
}
it("completes PKCE consent and lists only the chosen Toolsets and guide with SDK v2", async () => {
  const oauth_query = await query();
  const facts = await h.app.inject({
    url: `/api/v1/oauth-grants/consent?${new URLSearchParams({ oauth_query })}`,
    cookies,
  });
  expect(facts.statusCode, facts.body).toBe(200);
  expect(facts.json()).toMatchObject({
    client: { name: "Test Client", kind: "registered" },
    person: { displayName: TEST_ADMIN.displayName },
    refusalReason: null,
    writeOffered: true,
  });
  const answer = await h.app.inject({
    method: "POST",
    url: "/api/v1/oauth-grants/consent",
    cookies,
    payload: { oauth_query, accept: true, toolsets: ["contracts", "documents"], scope: "read" },
  });
  expect(answer.statusCode, answer.body).toBe(200);
  const token = await h.app.inject({
    method: "POST",
    url: "/api/auth/oauth2/token",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    payload: new URLSearchParams({
      grant_type: "authorization_code",
      client_id: clientId,
      client_secret: clientSecret,
      code: new URL(answer.json().url).searchParams.get("code")!,
      redirect_uri: "https://client.example/callback",
      code_verifier: verifier,
      resource: "http://localhost/mcp",
    }).toString(),
  });
  expect(token.statusCode, token.body).toBe(200);
  expect(token.json().scope).toBe("toolset:contracts toolset:documents offline_access");
  const endpoint = new URL("/mcp", await h.app.listen({ port: 0, host: "127.0.0.1" }));
  const client = new Client(
    { name: "Untrusted name", version: "1" },
    { versionNegotiation: { mode: { pin: "2026-07-28" } } },
  );
  try {
    await client.connect(
      new StreamableHTTPClientTransport(endpoint, {
        requestInit: { headers: { authorization: `Bearer ${token.json().access_token}` } },
      }),
    );
    const list = await client.listTools();
    expect(list.tools.map((t) => t.name)).toEqual([
      "openlaw_whoami",
      "openlaw_vocabulary",
      "openlaw_docs_search",
      "openlaw_docs_read",
      "openlaw_form_get",
      "openlaw_contracts_list",
      "openlaw_contract_get",
      "openlaw_documents_list",
      "openlaw_document_read",
    ]);
    const who = await client.callTool({ name: "openlaw_whoami", arguments: {} });
    expect(who.structuredContent).toMatchObject({
      toolsets: ["guide", "contracts", "documents"],
      scope: "read",
    });
  } finally {
    await client.close();
  }
});
async function facts(oauth_query: string, session = cookies) {
  return h.app.inject({
    url: `/api/v1/oauth-grants/consent?${new URLSearchParams({ oauth_query })}`,
    cookies: session,
  });
}
async function answer(
  oauth_query: string,
  toolsets: McpToolset[] = ["contracts", "documents"],
  scope = "read",
  session = cookies,
) {
  return h.app.inject({
    method: "POST",
    url: "/api/v1/oauth-grants/consent",
    cookies: session,
    payload: { oauth_query, accept: true, toolsets, scope },
  });
}
async function issue(
  toolsets: McpToolset[] = ["contracts", "documents"],
  scope = "read",
  session = cookies,
) {
  const consent = await answer(await query(session), toolsets, scope, session);
  expect(consent.statusCode, consent.body).toBe(200);
  const res = await token({
    grant_type: "authorization_code",
    code: new URL(consent.json().url).searchParams.get("code")!,
    redirect_uri: "https://client.example/callback",
    code_verifier: verifier,
  });
  expect(res.statusCode, res.body).toBe(200);
  return res.json() as { access_token: string; refresh_token: string };
}
async function token(params: Record<string, string>) {
  return h.app.inject({
    method: "POST",
    url: "/api/auth/oauth2/token",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    payload: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      resource: "http://localhost/mcp",
      ...params,
    }).toString(),
  });
}
async function call(accessToken: string, name = "openlaw_whoami", args: object = {}) {
  const response = await h.app.inject({
    method: "POST",
    url: "/mcp",
    headers: {
      authorization: `Bearer ${accessToken}`,
      accept: "application/json, text/event-stream",
      "mcp-protocol-version": "2025-11-25",
    },
    payload: { jsonrpc: "2.0", id: 7, method: "tools/call", params: { name, arguments: args } },
  });
  if (response.headers["content-type"]?.includes("text/event-stream")) {
    const data = response.body
      .split("\n")
      .find((line) => line.startsWith("data: "))!
      .slice(6);
    response.json = () => JSON.parse(data);
  }
  return response;
}
it.each(["mcp_disabled", "group_disabled", "client_disabled", "client_unlisted"] as const)(
  "refuses consent facts and Allow for %s",
  async (reason) => {
    const signed = await query();
    if (reason === "mcp_disabled") await h.db.update(orgSettings).set({ mcpEnabled: false });
    if (reason === "group_disabled")
      await h.db.update(orgSettings).set({ mcpLegalOAuthClientsEnabled: false });
    if (reason === "client_disabled")
      await h.db
        .update(allowedClients)
        .set({ enabled: false })
        .where(eq(allowedClients.id, allowedId));
    if (reason === "client_unlisted")
      await h.db
        .update(allowedClients)
        .set({ clientId: "unlisted" })
        .where(eq(allowedClients.id, allowedId));
    try {
      const res = await facts(signed);
      expect(res.json()).toMatchObject({
        refusalReason: reason,
        toolsets: [],
        writeOffered: false,
      });
      expect((await answer(signed)).statusCode).toBe(403);
    } finally {
      await h.db.update(allowedClients).set({ clientId }).where(eq(allowedClients.id, allowedId));
    }
  },
);
it.each(["expired", "altered"])("refuses an %s signed query without choices", async (kind) => {
  let signed = await query();
  if (kind === "altered") signed = signed.replace("state=test", "state=altered");
  else vi.setSystemTime(Date.now() + 601000);
  try {
    const res = await facts(signed);
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json()).toMatchObject({
      refusalReason: "expired_query",
      toolsets: [],
      writeOffered: false,
      client: null,
    });
    expect((await answer(signed)).statusCode).toBe(400);
  } finally {
    vi.useRealTimers();
  }
});
it("offers only usable Business User Toolsets and refuses inaccessible choices and read-only writes", async () => {
  const signed = await query(business);
  const res = await facts(signed, business);
  expect(res.json().toolsets).toEqual([
    "workspace",
    "contracts",
    "matters",
    "requests",
    "comments",
    "documents",
    "auto-docs",
    "entities",
    "knowledge",
  ]);
  expect(res.json().person).toMatchObject({
    id: businessId,
    displayName: "Business Person",
    role: "business_user",
    image: null,
  });
  expect((await answer(signed, ["tasks"], "read", business)).statusCode).toBe(403);
  await h.db.update(orgSettings).set({ mcpReadOnly: true, mcpToolsetCeiling: ["contracts"] });
  expect((await facts(signed, business)).json()).toMatchObject({
    toolsets: ["contracts"],
    writeOffered: false,
  });
  expect((await answer(signed, ["contracts"], "write", business)).statusCode).toBe(403);
  expect((await answer(signed, ["documents"], "read", business)).statusCode).toBe(403);
  expect((await answer(signed, [], "read", business)).statusCode).toBe(400);
});
it("Deny returns access_denied without creating a grant", async () => {
  const before = await h.db.select().from(oauthGrants);
  const denied = await h.app.inject({
    method: "POST",
    url: "/api/v1/oauth-grants/consent",
    cookies,
    payload: { accept: false, oauth_query: await query() },
  });
  expect(denied.statusCode, denied.body).toBe(200);
  expect(new URL(denied.json().url).searchParams.get("error")).toBe("access_denied");
  expect(await h.db.select().from(oauthGrants)).toEqual(before);
});
it("refuses outside Toolsets and writes with M40 errors and HTTP scope challenges", async () => {
  const issued = await issue();
  for (const [name, scope, code] of [
    ["openlaw_matters_list", "toolset:matters", "tool_outside_grant"],
    ["openlaw_team_add", "toolset:team write", "tool_outside_grant"],
    ["openlaw_team_remove", "toolset:team write", "tool_outside_grant"],
    ["openlaw_document_upload", "toolset:documents write", "mcp_read_only"],
  ]) {
    const res = await call(issued.access_token, name);
    expect(res.statusCode, res.body).toBe(403);
    expect(res.headers["www-authenticate"]).toContain(
      `error="insufficient_scope" scope="${scope}"`,
    );
    expect(res.json().result).toMatchObject({
      isError: true,
      content: [{ type: "text", text: expect.stringContaining(code!) }],
    });
  }
});
it("lets a Legal Team Member change a team through OAuth and refuses removal under read scope", async () => {
  const issued = await issue(["team"], "write");
  const type = (await h.db.select().from(contractTypes).limit(1))[0]!;
  const status = (
    await h.db.select().from(contractStatuses).where(eq(contractStatuses.stage, "draft")).limit(1)
  )[0]!;
  const [record] = await h.db
    .insert(contracts)
    .values({
      title: "OAuth team",
      contractTypeId: type.id,
      statusId: status.id,
      createdBy: personId,
      managerId: personId,
    })
    .returning();
  await h.db.update(users).set({ role: "legal_team_member" }).where(eq(users.id, personId));
  try {
    for (const operation of ["add", "remove"]) {
      const response = await call(issued.access_token, `openlaw_team_${operation}`, {
        record: "contract",
        number: record!.number,
        userId: businessId,
      });
      expect(response.statusCode, response.body).toBe(200);
      expect(response.json().result.isError).not.toBe(true);
      expect(response.json().result.structuredContent.team).toHaveLength(
        operation === "add" ? 1 : 0,
      );
    }
    const entries = await h.db
      .select()
      .from(activityLog)
      .where(eq(activityLog.entityId, record!.id));
    for (const action of ["contract.team_added", "contract.team_removed"])
      expect(entries).toContainEqual(
        expect.objectContaining({
          action,
          actorId: personId,
          viaKind: "oauth_client",
          viaClientName: "Test Client",
        }),
      );
    const read = await issue(["team"], "read");
    const response = await call(read.access_token, "openlaw_team_remove", {
      record: "contract",
      number: record!.number,
      userId: businessId,
    });
    expect(response.statusCode).toBe(403);
    expect(response.headers["www-authenticate"]).toContain(
      'error="insufficient_scope" scope="toolset:team write"',
    );
    expect(response.json().result).toMatchObject({
      isError: true,
      content: [{ type: "text", text: expect.stringContaining("mcp_read_only") }],
    });
  } finally {
    await h.db.update(users).set({ role: "administrator" }).where(eq(users.id, personId));
  }
});
it.each(["master", "group", "client", "archived", "missing", "owner", "administrator"])(
  "refuses the next call after %s changes",
  async (kind) => {
    const issued = await issue(["contracts"], "read", business);
    const [grant] = await h.db
      .select()
      .from(oauthGrants)
      .where(eq(oauthGrants.personId, businessId));
    if (kind === "master") await h.db.update(orgSettings).set({ mcpEnabled: false });
    if (kind === "group")
      await h.db.update(orgSettings).set({ mcpBusinessOAuthClientsEnabled: false });
    if (kind === "client")
      await h.db
        .update(allowedClients)
        .set({ enabled: false })
        .where(eq(allowedClients.id, allowedId));
    if (kind === "archived")
      await h.db.update(users).set({ archivedAt: new Date() }).where(eq(users.id, businessId));
    if (kind === "missing") await h.db.delete(oauthGrants).where(eq(oauthGrants.id, grant!.id));
    if (kind === "owner" || kind === "administrator") {
      const revoked = await h.app.inject({
        method: "POST",
        url: `/api/v1/oauth-grants/${grant!.id}/revoke`,
        cookies: kind === "owner" ? business : cookies,
      });
      expect(revoked.statusCode, revoked.body).toBe(200);
    }
    try {
      expect((await call(issued.access_token)).statusCode).toBe(401);
    } finally {
      await h.db.update(users).set({ archivedAt: null }).where(eq(users.id, businessId));
    }
  },
);
it("narrows Toolsets and scope live, and a token never widens after re-consent", async () => {
  const issued = await issue(["contracts", "documents"], "write");
  await h.db.update(orgSettings).set({ mcpReadOnly: true, mcpToolsetCeiling: ["contracts"] });
  const res = await call(issued.access_token);
  expect(res.statusCode, res.body).toBe(200);
  expect(res.json().result.structuredContent).toMatchObject({
    toolsets: ["guide", "contracts"],
    scope: "read",
  });
  await h.db.update(orgSettings).set({ mcpReadOnly: false, mcpToolsetCeiling: [...MCP_TOOLSETS] });
  const narrow = await issue(["contracts"]);
  await issue(["contracts", "documents"], "write");
  expect((await call(narrow.access_token, "openlaw_documents_list")).statusCode).toBe(403);
});
it("binds a token request that omits resource to the /mcp audience", async () => {
  const consent = await answer(await query());
  expect(consent.statusCode, consent.body).toBe(200);
  const res = await h.app.inject({
    method: "POST",
    url: "/api/auth/oauth2/token",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    payload: new URLSearchParams({
      grant_type: "authorization_code",
      client_id: clientId,
      client_secret: clientSecret,
      code: new URL(consent.json().url).searchParams.get("code")!,
      redirect_uri: "https://client.example/callback",
      code_verifier: verifier,
    }).toString(),
  });
  expect(res.statusCode, res.body).toBe(200);
  expect(decodeJwt(res.json().access_token).aud).toBe("http://localhost/mcp");
  expect((await call(res.json().access_token)).statusCode).toBe(200);
});
it("refreshes within the absolute grant lifetime and requires consent past it", async () => {
  const issued = await issue();
  const refreshed = await token({
    grant_type: "refresh_token",
    refresh_token: issued.refresh_token,
  });
  expect(refreshed.statusCode, refreshed.body).toBe(200);
  const [grant] = await h.db.select().from(oauthGrants).where(eq(oauthGrants.personId, personId));
  const refreshRows = await h.db
    .select()
    .from(oauthRefreshTokens)
    .where(and(eq(oauthRefreshTokens.userId, personId), eq(oauthRefreshTokens.clientId, clientId)));
  expect(refreshRows.every((row) => row.expiresAt <= grant!.expiresAt)).toBe(true);
  await h.db
    .update(oauthGrants)
    .set({ expiresAt: new Date(Date.now() - 1000) })
    .where(eq(oauthGrants.id, grant!.id));
  const expired = await token({
    grant_type: "refresh_token",
    refresh_token: refreshed.json().refresh_token,
  });
  expect(expired.statusCode, expired.body).toBe(400);
  expect(expired.json().error).toBe("invalid_grant");
  expect((await call(issued.access_token)).statusCode).toBe(401);
  expect(new URL(`http://localhost/?${await query(cookies, false)}`).searchParams.has("sig")).toBe(
    true,
  );
});
it("replaces consent, audits without bell items, lists grants for Administrators and protects revocation", async () => {
  const bells = await h.db.select().from(notifications);
  await issue();
  const [original] = await h.db
    .select()
    .from(oauthGrants)
    .where(eq(oauthGrants.personId, personId));
  await issue(["documents"], "write");
  const [replacement] = await h.db
    .select()
    .from(oauthGrants)
    .where(eq(oauthGrants.personId, personId));
  expect(replacement!.id).toBe(original!.id);
  expect(replacement!.toolsets).toEqual(["documents"]);
  expect(replacement!.grantedAt > original!.grantedAt).toBe(true);
  expect(replacement!.consentId).toBeTruthy();
  expect(
    (
      await h.db.select().from(oauthConsents).where(eq(oauthConsents.id, replacement!.consentId!))
    )[0]!.scopes,
  ).toEqual(["toolset:documents", "write", "offline_access"]);
  const listing = await h.app.inject({ url: "/api/v1/mcp-settings/oauth-grants", cookies });
  expect(listing.json()).toContainEqual(
    expect.objectContaining({
      id: original!.id,
      owner: TEST_ADMIN.displayName,
      clientName: "Test Client",
      toolsets: ["documents"],
      scope: "write",
    }),
  );
  expect(
    (await h.app.inject({ url: "/api/v1/mcp-settings/oauth-grants", cookies: business }))
      .statusCode,
  ).toBe(403);
  expect(
    (
      await h.app.inject({
        method: "POST",
        url: `/api/v1/oauth-grants/${original!.id}/revoke`,
        cookies: business,
      })
    ).statusCode,
  ).toBe(404);
  expect(
    (
      await h.app.inject({
        method: "POST",
        url: `/api/v1/oauth-grants/${original!.id}/revoke`,
        cookies,
      })
    ).statusCode,
  ).toBe(200);
  const audit = await h.db.select().from(activityLog);
  const grants = audit.filter((row) => row.action.startsWith("oauth_grant."));
  expect(grants.some((row) => row.action === "oauth_grant.granted")).toBe(true);
  expect(grants.some((row) => row.action === "oauth_grant.revoked")).toBe(true);
  expect(grants.every((row) => row.visibility === "admin_only")).toBe(true);
  expect(await h.db.select().from(notifications)).toEqual(bells);
});
it("uploads under a grant, attributes activity and calls, and shares the grant rate limit", async () => {
  const issued = await issue(["documents"], "write");
  const [grant] = await h.db.select().from(oauthGrants).where(eq(oauthGrants.personId, personId));
  await h.db.delete(mcpToolCalls).where(eq(mcpToolCalls.credentialId, grant!.id));
  const [type] = await h.db.select().from(contractTypes).limit(1);
  const [status] = await h.db.select().from(contractStatuses).limit(1);
  const [contract] = await h.db
    .insert(contracts)
    .values({
      title: "Grant paper",
      contractTypeId: type!.id,
      statusId: status!.id,
      createdBy: personId,
    })
    .returning();
  const prepared = await call(issued.access_token, "openlaw_document_upload", {
    ownerType: "contract",
    number: contract!.number,
    filename: "paper.txt",
    mimeType: "text/plain",
  });
  expect(prepared.statusCode, prepared.body).toBe(200);
  expect(prepared.json().result.isError, prepared.body).not.toBe(true);
  const upload = prepared.json().result.structuredContent;
  const url = new URL(upload.uploadUrl);
  const sent = await h.app.inject({
    method: "PUT",
    url: url.pathname + url.search,
    headers: upload.headers,
    payload: "Grant paper",
  });
  expect(sent.statusCode, sent.body).toBe(201);
  const audit = await h.db.select().from(activityLog).where(eq(activityLog.entityId, contract!.id));
  expect(audit).toContainEqual(
    expect.objectContaining({
      actorId: personId,
      viaKind: "oauth_client",
      viaId: grant!.id,
      viaClientName: "Test Client",
    }),
  );
  const calls = await h.db
    .select()
    .from(mcpToolCalls)
    .where(eq(mcpToolCalls.credentialId, grant!.id));
  expect(calls).toContainEqual(
    expect.objectContaining({
      credentialId: grant!.id,
      clientName: "Test Client",
      tool: "openlaw_document_upload",
      outcome: "success",
    }),
  );
  const listed = await h.app.inject({ url: "/api/v1/mcp-settings/oauth-grants", cookies });
  expect(listed.json().find((row: { id: string }) => row.id === grant!.id).lastUsedAt).toEqual(
    expect.any(String),
  );
  await h.db.insert(mcpToolCalls).values(
    Array.from({ length: 99 }, (_, i) => ({
      personId,
      credentialId: grant!.id,
      clientName: "Test Client",
      tool: "openlaw_whoami",
      outcome: "success",
      requestId: `seed-${i}`,
    })),
  );
  const limited = await call(issued.access_token);
  expect(limited.json().result.content[0].text).toContain("rate_limited:");
});

it("resumes the authorize from the signed login query once a session exists (#1136)", async () => {
  const anonymous = await h.app.inject({
    url: `/api/auth/oauth2/authorize?${authorizeParams()}`,
  });
  expect(anonymous.statusCode, anonymous.body).toBe(302);
  const login = new URL(anonymous.headers.location!, h.app.baseUrl);
  expect(login.pathname).toBe("/auth/login");
  expect(login.searchParams.has("sig")).toBe(true);
  const resumed = await h.app.inject({
    url: `/api/auth/oauth2/authorize${login.search}`,
    cookies,
  });
  expect(resumed.statusCode, resumed.body).toBe(302);
  const consent = new URL(resumed.headers.location!, h.app.baseUrl);
  expect(consent.pathname).toBe("/auth/consent");
  expect(consent.searchParams.get("sig")).not.toBe(login.searchParams.get("sig"));
  const shown = await facts(consent.search.slice(1));
  expect(shown.statusCode, shown.body).toBe(200);
  expect(shown.json()).toMatchObject({ client: { name: "Test Client" }, refusalReason: null });
});

it("recovers remembered consent without a grant and leaves other people's consent alone", async () => {
  await issue(["contracts"], "read", business);
  await h.db
    .update(oauthGrants)
    .set({ expiresAt: new Date(Date.now() - 1000) })
    .where(eq(oauthGrants.personId, businessId));
  const [businessConsent] = await h.db
    .select()
    .from(oauthConsents)
    .where(and(eq(oauthConsents.userId, businessId), eq(oauthConsents.clientId, clientId)));
  const signed = await query();
  const anonymous = await h.app.inject({ url: `/api/auth/oauth2/authorize?${signed}` });
  expect(anonymous.statusCode, anonymous.body).toBe(302);
  expect(
    await h.db.select().from(oauthConsents).where(eq(oauthConsents.id, businessConsent!.id)),
  ).toHaveLength(1);
  await issue(["contracts"]);
  await h.db.delete(oauthGrants).where(eq(oauthGrants.personId, personId));
  const resumed = new URLSearchParams(await query(cookies, false));
  expect(resumed.has("sig")).toBe(true);
  expect(
    await h.db.select().from(oauthConsents).where(eq(oauthConsents.id, businessConsent!.id)),
  ).toHaveLength(1);
});

it("reports a refresh storage failure as a server error rather than invalid consent", async () => {
  const issued = await issue();
  await h.db
    .update(oauthGrants)
    .set({ expiresAt: new Date(Date.now() + 60000) })
    .where(eq(oauthGrants.personId, personId));
  await h.db.$client.query(`
    CREATE FUNCTION refuse_test_expiry_update() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN RAISE EXCEPTION 'Test storage failure'; END $$;
    CREATE TRIGGER refuse_test_expiry_update BEFORE UPDATE ON oauth_refresh_tokens
    FOR EACH ROW WHEN (NEW.expires_at IS DISTINCT FROM OLD.expires_at)
    EXECUTE FUNCTION refuse_test_expiry_update();
  `);
  try {
    const res = await token({ grant_type: "refresh_token", refresh_token: issued.refresh_token });
    expect(res.statusCode, res.body).toBe(500);
    expect(res.body).not.toContain("invalid_grant");
  } finally {
    await h.db.$client.query(
      "DROP TRIGGER refuse_test_expiry_update ON oauth_refresh_tokens; DROP FUNCTION refuse_test_expiry_update();",
    );
  }
});

it.each(["legal_team_member", "business_user"] as const)(
  "lists only the %s's own connected Clients and disconnects immediately",
  async (role) => {
    await h.db.update(users).set({ role }).where(eq(users.id, businessId));
    try {
      const otherToken = await issue(["documents"], "write");
      const ownToken = await issue(["contracts"], "read", business);
      const [other] = await h.db
        .select()
        .from(oauthGrants)
        .where(eq(oauthGrants.personId, personId));
      const [own] = await h.db
        .select()
        .from(oauthGrants)
        .where(eq(oauthGrants.personId, businessId));
      expect((await call(ownToken.access_token)).statusCode).toBe(200);
      const listing = await h.app.inject({
        url: `/api/v1/oauth-grants?personId=${personId}`,
        cookies: business,
      });
      expect(listing.statusCode, listing.body).toBe(200);
      expect(listing.headers["cache-control"]).toBe("no-store");
      expect(listing.json()).toEqual([
        expect.objectContaining({
          id: own!.id,
          personId: businessId,
          clientName: "Test Client",
          toolsets: ["contracts"],
          scope: "read",
          grantedAt: own!.grantedAt.toISOString(),
          lastUsedAt: expect.any(String),
        }),
      ]);
      const adminListing = await h.app.inject({ url: "/api/v1/oauth-grants", cookies });
      expect(adminListing.json().map((row: { id: string }) => row.id)).toEqual([other!.id]);
      expect((await h.app.inject({ url: "/api/v1/oauth-grants" })).statusCode).toBe(401);
      const denied = await h.app.inject({
        method: "POST",
        url: `/api/v1/oauth-grants/${other!.id}/revoke`,
        cookies: business,
      });
      expect(denied.statusCode).toBe(404);
      expect((await call(otherToken.access_token)).statusCode).toBe(200);
      for (let i = 0; i < 2; i++) {
        const revoked = await h.app.inject({
          method: "POST",
          url: `/api/v1/oauth-grants/${own!.id}/revoke`,
          cookies: business,
        });
        expect(revoked.statusCode, revoked.body).toBe(200);
      }
      expect(
        (await h.app.inject({ url: "/api/v1/oauth-grants", cookies: business })).json(),
      ).toEqual([]);
      expect((await call(ownToken.access_token)).statusCode).toBe(401);
      const audit = await h.db
        .select()
        .from(activityLog)
        .where(
          and(eq(activityLog.actorId, businessId), eq(activityLog.action, "oauth_grant.revoked")),
        );
      expect(audit).toContainEqual(
        expect.objectContaining({
          visibility: "admin_only",
          payload: expect.objectContaining({
            oauthGrantId: own!.id,
            personId: businessId,
            clientName: "Test Client",
          }),
        }),
      );
      await issue(["contracts"], "read", business);
      await h.db
        .update(oauthGrants)
        .set({ expiresAt: new Date(Date.now() - 1000) })
        .where(eq(oauthGrants.id, own!.id));
      expect(
        (await h.app.inject({ url: "/api/v1/oauth-grants", cookies: business })).json(),
      ).toEqual([]);
    } finally {
      await h.db.update(users).set({ role: "business_user" }).where(eq(users.id, businessId));
    }
  },
);

it("offers the same audience-filtered Toolsets for consent and API key requests", async () => {
  const register = toolRegister as ToolDefinition[];
  const originalLength = register.length;
  register.push(
    ...(["team", "administration"] as const).map((toolset) => ({
      ...register[0]!,
      name: `test_${toolset}`,
      toolset,
      legalUser: "on" as const,
      businessUser: "off" as const,
    })),
  );
  try {
    const member = await provisionUser(h.app.auth, {
      email: "choices-member@example.com",
      displayName: "Member",
      password: TEST_ADMIN.password,
    });
    await h.db.update(users).set({ role: "legal_team_member" }).where(eq(users.id, member.id));
    const memberCookies = await signInCookies(
      h.app,
      "choices-member@example.com",
      TEST_ADMIN.password,
    );
    await h.db
      .update(orgSettings)
      .set({ mcpLegalApiKeysEnabled: true, mcpBusinessApiKeysEnabled: true });
    for (const [session, expected] of [
      [cookies, ["contracts", "tasks", "team", "administration"]],
      [memberCookies, ["contracts", "tasks", "team"]],
      [business, ["contracts"]],
    ] as const) {
      await h.db
        .update(orgSettings)
        .set({ mcpToolsetCeiling: ["contracts", "tasks", "team", "administration"] });
      const consent = await facts(await query(session), session);
      const keys = await h.app.inject({ url: "/api/v1/api-key-requests", cookies: session });
      expect(consent.statusCode, consent.body).toBe(200);
      expect(keys.statusCode, keys.body).toBe(200);
      expect(consent.json().toolsets).toEqual(expected);
      expect(keys.json().policy.toolsets).toEqual(expected);
      expect(keys.json().policy.toolsetCeiling).toEqual([
        "contracts",
        "tasks",
        "team",
        "administration",
      ]);
      for (const toolset of ["contracts", "tasks", "team", "administration"] as const) {
        const response = await h.app.inject({
          method: "POST",
          url: "/api/v1/api-key-requests",
          cookies: session,
          payload: { clientName: "Audience test", toolsets: [toolset], scope: "read" },
        });
        if ((expected as readonly string[]).includes(toolset))
          expect(response.statusCode, response.body).toBe(201);
        else {
          expect(response.statusCode, response.body).toBe(403);
          expect(response.json().type).toBe("urn:openlaw:problem:toolset-outside-ceiling");
        }
      }
      await h.db.update(orgSettings).set({ mcpToolsetCeiling: ["contracts"] });
      expect((await facts(await query(session), session)).json().toolsets).toEqual(["contracts"]);
      expect(
        (await h.app.inject({ url: "/api/v1/api-key-requests", cookies: session })).json().policy
          .toolsets,
      ).toEqual(["contracts"]);
    }
  } finally {
    register.splice(originalLength);
  }
});
