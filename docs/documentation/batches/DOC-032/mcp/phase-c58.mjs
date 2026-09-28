// DOC-032 mcp, phase c58: connect-headless-client V-M42-C58 on the owned mcp42 lab.
// Each of the three roles requests, gets approved and collects a key in the browser, as the
// guide says. A modern script Client (2026-07-28) then walks "Read resources and get prompts":
// every address in the table, both prompts, the refusals, the call count, and a listen stream
// across a ceiling change and a record update. Revoking the key in the browser must close the
// stream. Fixture writes (a long DOCX upload, record title edits as a second actor) use the
// Administrator's own API session and are marked as fixtures.
import { Session } from "../../../../../scripts/seed/client.mjs";
import { uploadDocument } from "../../../../../scripts/seed/uploads.mjs";
import {
  api,
  browserSignIn,
  connectClient,
  createLog,
  expectThat,
  flat,
  labManifest,
  LABS,
  pause,
  PASSWORD,
  PEOPLE,
  portalSignIn,
  psql,
  PW_PATH,
  rawToolsList,
  stamp,
  until,
} from "./lib.mjs";
import { ui } from "./ui.mjs";

const LAB = LABS.mcp42;
const BASE = LAB.base;
const MCP_URL = `${BASE}/mcp`;
const U = ui(BASE);
const { chromium } = await import(PW_PATH);
const { log, save, step, finish } = createLog("c58", {
  lab: LAB.name,
  environment: LAB.project,
  appUrl: BASE,
  mailUrl: LAB.mail,
  labManifest: labManifest("mcp42"),
});
const S = (role, page, extra = {}) => ({
  article: "connect-headless-client",
  scenario: "V-M42-C58",
  role,
  lab: LAB.name,
  page,
  ...extra,
});
const H = { origin: BASE };
const q = (sql) => psql(LAB.project, sql);

const browser = await chromium.launch();
const pages = {};
async function open(role) {
  if (pages[role]) return pages[role];
  const c = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  await c.grantPermissions(["clipboard-read", "clipboard-write"], { origin: BASE });
  pages[role] = await c.newPage();
  if (role === "business_user") await portalSignIn(pages[role], LAB, PEOPLE[role].email);
  else await browserSignIn(pages[role], BASE, PEOPLE[role]);
  return pages[role];
}
const admin = await open("administrator");
const second = new Session("DOC-032 mcp second actor", BASE);
await second.request("POST", "/api/auth/sign-in/email", {
  json: { email: PEOPLE.administrator.email, password: PASSWORD },
  headers: H,
});

// ---------- policy ----------
const found = (await api(admin, BASE, "GET", "/api/v1/mcp-settings")).body;
log.runs.c58.foundPolicy = found;
await step(
  S("administrator", "/settings/mcp", { article: "configure-mcp", scenario: "V-M42-MCP" }),
  "Setup: Enable MCP; Legal Users and Business Users API keys on; the ceiling as installed",
  "Settings saved. for each switch; 11 of 13 Toolsets",
  async () => {
    await U.gotoMcp(admin);
    const a = await U.toggle(admin, "Enable MCP", true);
    const b = await U.toggle(admin, "Legal Users API keys", true);
    const c = await U.toggle(admin, "Business Users API keys", true);
    await U.expandCard(admin, "Toolset ceiling");
    const summary = (await U.main(admin)).match(/\d+ of \d+ Toolsets · [a-z -]+/)?.[0];
    return `${a} ${b} ${c} Ceiling summary "${summary}".`;
  },
);

// ---------- one key per account type, through the browser ----------
const keys = {};
for (const role of ["legal_team_member", "administrator", "business_user"]) {
  const page = await open(role);
  const name = `DOC-032 mcp c58 ${role} ${stamp}`;
  await step(
    S(role, role === "business_user" ? "/portal/settings/api-keys" : "/settings/api-keys"),
    "Request and collect a key with every offered Toolset (Read); an Administrator approves from Your approvals",
    "The key is collected once",
    async () => {
      await U.apiKeysPane(page, role);
      const form = await U.readRequestForm(page);
      const offered = form.boxes.map((b) => b.name);
      await form.dialog.getByRole("button", { name: "Cancel", exact: true }).click();
      const r = await U.requestKey(page, { name, toolsets: offered, scope: "read" });
      expectThat(r.status === 201, `POST ${r.status}`);
      let approved = "self-approved (Administrator)";
      let c;
      if (role === "administrator") c = await U.collect(page, await U.readyDialog(page));
      else {
        approved = `bell: "${(await U.approveInBell(admin, name)).slice(0, 140)}"`;
        c = await U.collectAfterApproval(page, r.id, api);
      }
      keys[role] = { id: r.id, name, key: c.key, toolsets: offered };
      return `Offered ${offered.length}: ${offered.join(", ")}. ${approved}. Key collected once (${c.key.length} chars).`;
    },
  );
}

// ---------- fixture: a Document Version with more than one page of text ----------
const reachLtm = {};
const clients = {};
for (const role of Object.keys(keys)) {
  clients[role] = await connectClient(MCP_URL, { "x-api-key": keys[role].key }, { mode: "modern" });
}
const firstNumber = async (client, tool) => {
  const r = await client.callTool({ name: tool, arguments: { limit: 100 } });
  const list = Object.values(r.structuredContent ?? {}).find(Array.isArray) ?? [];
  return list.map((x) => x.number).filter(Boolean);
};
reachLtm.contracts = await firstNumber(clients.legal_team_member.client, "openlaw_contracts_list");
const LONG_CONTRACT = reachLtm.contracts[0];
let longVersion;
await step(
  S("administrator", "fixture", { method: "browser-walkthrough" }),
  "Fixture setup (not a reader step): the Administrator uploads a long DOCX to a Contract the Legal Team Member reaches, and its text is extracted",
  "document_version_text ready with more than 4000 characters",
  async () => {
    const paragraphs = Array.from(
      { length: 60 },
      (_, i) =>
        `Clause ${i + 1}. The parties agree that this fictional DOC-032 walkthrough paragraph exists only to make the extracted text longer than one page of the document read Tool.`,
    );
    const doc = await uploadDocument(
      second,
      `/api/v1/contracts/${LONG_CONTRACT}/documents`,
      { title: `DOC-032 mcp long text ${stamp}`, paragraphs },
      { format: "docx" },
    );
    const documentId = doc?.id;
    const row = await until(
      async () => {
        const out = q(
          `select v.id || '|' || t.state || '|' || coalesce(length(t.text),0) from document_versions v join document_version_text t on t.version_id = v.id where v.document_id = '${documentId}' order by v.version_number desc limit 1`,
        );
        return out.includes("|ready|") ? out : null;
      },
      "text never became ready",
      120000,
    );
    const [id, , length] = row.split("|");
    longVersion = { documentId, versionId: id, length: Number(length) };
    expectThat(longVersion.length > 4000, row);
    return `Uploaded to C-${LONG_CONTRACT}; Version text ready with ${length} characters.`;
  },
);

// ---------- helpers ----------
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
async function readAndCompare(client, uri, tool, args) {
  const r = await client.readResource({ uri });
  const t = await client.callTool({ name: tool, arguments: args });
  const c = r.contents?.[0];
  if (r.isError) return { uri, refused: flat(r.content?.[0]?.text) };
  if (c.mimeType === "application/json") {
    const equal = same(JSON.parse(c.text), t.structuredContent);
    return { uri, mimeType: c.mimeType, title: c._meta?.title, equal };
  }
  const expected = t.structuredContent?.text?.text;
  const continuation = t.structuredContent?.nextCursor
    ? c.text.slice(c.text.lastIndexOf("\n\nContinue with"))
    : null;
  return {
    uri,
    mimeType: c.mimeType,
    equal: c.text.startsWith(expected ?? "\u0000"),
    textLength: c.text.length,
    continuation,
  };
}
const refusalOf = async (client, uri) => {
  const r = await client.readResource({ uri }).catch((e) => ({ thrown: e.message }));
  return (
    r.thrown ??
    (r.isError ? flat(r.content?.[0]?.text) : `not refused (${r.contents?.length} contents)`)
  );
};
const callsFor = (clientName) =>
  Number(q(`select count(*) from mcp_tool_calls where client_name = '${clientName}'`));

// =====================================================================
for (const role of ["legal_team_member", "administrator", "business_user"]) {
  const { client, protocolVersion } = clients[role];
  const legal = role !== "business_user";
  const k = keys[role];
  const reach = {};
  await step(
    S(role, "script Client"),
    "resources/templates/list and resources/list on a modern Streamable HTTP Client",
    legal
      ? "Five record templates plus document-versions; inbox, tasks/mine and vocabulary"
      : "No entities template and no tasks/mine; inbox and vocabulary",
    async () => {
      const templates = (await client.listResourceTemplates()).resourceTemplates.map(
        (t) => t.uriTemplate,
      );
      const fixed = (await client.listResources()).resources.map((t) => t.uri);
      const want = legal
        ? [
            "openlaw://contracts/{number}",
            "openlaw://matters/{number}",
            "openlaw://requests/{number}",
            "openlaw://entities/{id}",
            "openlaw://knowledge/{id}",
            "openlaw://document-versions/{versionId}",
          ]
        : [
            "openlaw://contracts/{number}",
            "openlaw://matters/{number}",
            "openlaw://requests/{number}",
            "openlaw://knowledge/{id}",
            "openlaw://document-versions/{versionId}",
          ];
      const wantFixed = legal
        ? ["openlaw://inbox", "openlaw://tasks/mine", "openlaw://vocabulary"]
        : ["openlaw://inbox", "openlaw://vocabulary"];
      expectThat(
        same(templates, want) && same(fixed, wantFixed),
        JSON.stringify({ templates, fixed }),
      );
      return `Protocol ${protocolVersion}. Templates: ${templates.join(", ")}. Fixed: ${fixed.join(", ")}.`;
    },
  );

  await step(
    S(role, "script Client"),
    "resources/read for each address in the table; compare with the matching Tool",
    "Each JSON read equals the Tool's structured result; Document Version text is text/plain and ends with the openlaw_document_read arguments and cursor when more text exists",
    async () => {
      const out = [];
      reach.contracts = await firstNumber(client, "openlaw_contracts_list");
      reach.matters = await firstNumber(client, "openlaw_matters_list");
      reach.requests = await firstNumber(client, "openlaw_requests_list");
      const c = reach.contracts[0];
      if (c) {
        out.push(
          await readAndCompare(client, `openlaw://contracts/C-${c}`, "openlaw_contract_get", {
            number: c,
          }),
        );
        const bare = await client.readResource({ uri: `openlaw://contracts/${c}` });
        const pref = await client.readResource({ uri: `openlaw://contracts/C-${c}` });
        out.push({
          uri: `openlaw://contracts/${c} vs C-${c}`,
          equal: bare.contents[0].text === pref.contents[0].text,
        });
      }
      if (reach.matters[0])
        out.push(
          await readAndCompare(
            client,
            `openlaw://matters/M-${reach.matters[0]}`,
            "openlaw_matter_get",
            { number: reach.matters[0] },
          ),
        );
      if (reach.requests[0])
        out.push(
          await readAndCompare(
            client,
            `openlaw://requests/R-${reach.requests[0]}`,
            "openlaw_request_get",
            { number: reach.requests[0] },
          ),
        );
      if (legal) {
        const e = await client.callTool({ name: "openlaw_entities_list", arguments: { limit: 5 } });
        const entity = Object.values(e.structuredContent ?? {}).find(Array.isArray)?.[0]?.id;
        reach.entity = entity;
        out.push(
          await readAndCompare(client, `openlaw://entities/${entity}`, "openlaw_entity_get", {
            id: entity,
          }),
        );
      }
      for (const query of ["NDA", "policy", "contract", "data", "the"]) {
        const kq = await client.callTool({
          name: "openlaw_knowledge_search",
          arguments: { query },
        });
        const id = (kq.structuredContent?.results ?? [])[0]?.id;
        if (id) {
          reach.knowledge = id;
          out.push(
            await readAndCompare(client, `openlaw://knowledge/${id}`, "openlaw_knowledge_get", {
              id,
            }),
          );
          break;
        }
      }
      // A Document Version on a reached record (the long fixture for Legal Users).
      let version = legal ? longVersion : null;
      if (!version && c) {
        const row = q(
          `select v.document_id || '|' || v.id from document_versions v join documents d on d.id = v.document_id join contracts k on k.id = d.contract_id where k.number = ${c} order by v.created_at limit 1`,
        );
        if (row) version = { documentId: row.split("|")[0], versionId: row.split("|")[1] };
      }
      if (version) {
        const r = await readAndCompare(
          client,
          `openlaw://document-versions/${version.versionId}`,
          "openlaw_document_read",
          {
            documentId: version.documentId,
            versionId: version.versionId,
          },
        );
        out.push(r);
        if (r.continuation) {
          const args = JSON.parse(r.continuation.slice(r.continuation.indexOf("{")));
          const next = await client.callTool({ name: "openlaw_document_read", arguments: args });
          out.push({
            uri: "openlaw_document_read with the continuation arguments",
            ok: !next.isError,
            nextText: next.structuredContent?.text?.text?.slice(0, 40),
          });
        }
      }
      out.push(await readAndCompare(client, "openlaw://inbox", "openlaw_requests_list", {}));
      if (legal)
        out.push(await readAndCompare(client, "openlaw://tasks/mine", "openlaw_tasks_list", {}));
      out.push(await readAndCompare(client, "openlaw://vocabulary", "openlaw_vocabulary", {}));
      log.runs.c58[`reads_${role}`] = out;
      const bad = out.filter((o) => o.refused || o.equal === false || o.ok === false);
      const docRead = out.find((o) => o.uri?.startsWith("openlaw://document-versions/"));
      expectThat(
        bad.length === 0 && docRead && docRead.mimeType === "text/plain",
        JSON.stringify(out),
      );
      if (legal)
        expectThat(
          /^\n\nContinue with T26 openlaw_document_read: \{.*"cursor":/.test(
            docRead.continuation ?? "",
          ),
          JSON.stringify(docRead),
        );
      return out
        .map(
          (o) =>
            `${o.uri}: ${o.mimeType ?? ""} ${o.equal === undefined ? "" : o.equal ? "same as Tool" : "DIFFERENT"}${o.title ? ` ("${o.title}")` : ""}${o.continuation ? `; ends with "${o.continuation.trim().slice(0, 150)}"` : ""}${o.ok !== undefined ? ` → ${o.ok ? "next part read" : "failed"}` : ""}`,
        )
        .join(" | ");
    },
  );

  await step(
    S(role, "script Client"),
    "Negative: an address with a query, a fragment or an extra path segment is refused; a record outside the grant or reach is refused",
    "isError with invalid_arguments; tool_outside_grant or not_found as the guide lists",
    async () => {
      const c = reach.contracts[0] ?? 1;
      const results = {
        query: await refusalOf(client, `openlaw://contracts/C-${c}?view=full`),
        fragment: await refusalOf(client, `openlaw://contracts/C-${c}#top`),
        extraSegment: await refusalOf(client, `openlaw://contracts/C-${c}/documents`),
        inboxQuery: await refusalOf(client, "openlaw://inbox?limit=5"),
      };
      if (!legal) {
        const e = keys.legal_team_member && reachLtm.entity;
        results.entity = await refusalOf(
          client,
          `openlaw://entities/${e ?? "01a0e6d6-0000-7000-8000-000000000000"}`,
        );
        results.tasksMine = await refusalOf(client, "openlaw://tasks/mine");
        const unreached = reachLtm.contracts.find((n) => !reach.contracts.includes(n));
        reach.unreached = unreached;
        results.unreachedContract = await refusalOf(client, `openlaw://contracts/C-${unreached}`);
      }
      const ok =
        /^invalid_arguments/.test(results.query) &&
        /^invalid_arguments/.test(results.fragment) &&
        /^invalid_arguments/.test(results.extraSegment) &&
        !/not refused/.test(results.inboxQuery) &&
        (legal ||
          (/^tool_outside_grant/.test(results.entity) &&
            /^tool_outside_grant/.test(results.tasksMine) &&
            /^not_found/.test(results.unreachedContract)));
      expectThat(ok, JSON.stringify(results));
      return Object.entries(results)
        .map(([k2, v]) => `${k2}: "${v.slice(0, 120)}"`)
        .join("; ");
    },
  );
  if (role === "legal_team_member") reachLtm.entity = reach.entity;

  await step(
    S(role, "script Client"),
    legal
      ? "prompts/list; prompts/get triage_inbox with limit 5; summarize_record with an address and with a kind and number; limits 0 and 101"
      : "prompts/list; triage_inbox is absent and refused; summarize_record with an address and with a kind and number; an Entity is refused",
    "Instruction plus embedded resource for each prompt; limits outside 1 to 100 refused",
    async () => {
      const listed = (await client.listPrompts()).prompts.map((p) => p.name);
      const c = reach.contracts[0];
      const parts = [`prompts/list: ${listed.join(", ")}`];
      const shape = (p) =>
        p.messages
          ?.map(
            (m) =>
              `${m.role}:${m.content.type}${m.content.resource ? `(${m.content.resource.uri}, ${m.content.resource.mimeType})` : ""}`,
          )
          .join(" + ");
      let ok = true;
      if (legal) {
        const t = await client.getPrompt({ name: "triage_inbox", arguments: { limit: "5" } });
        const text = t.messages[0].content.text;
        const inbox = JSON.parse(t.messages[1].content.resource.text);
        const shown = Object.values(inbox).find(Array.isArray)?.length;
        parts.push(
          `triage_inbox limit 5 → ${shape(t)}; embedded Inbox holds ${shown} Requests; instruction says "${text.match(/Wait for the person's confirmation[^.]*\./)?.[0]}" and gives ${text.match(/http\S+\/inbox\/\{number\}/)?.[0]}`,
        );
        const zero = await client.getPrompt({ name: "triage_inbox", arguments: { limit: "0" } });
        const big = await client.getPrompt({ name: "triage_inbox", arguments: { limit: "101" } });
        parts.push(
          `limit "0" → ${flat(zero.content?.[0]?.text)}; limit "101" → ${flat(big.content?.[0]?.text)}`,
        );
        ok &&=
          listed.includes("triage_inbox") &&
          shown <= 5 &&
          zero.isError &&
          big.isError &&
          /confirmation/.test(text);
      } else {
        const t = await client.getPrompt({ name: "triage_inbox", arguments: {} });
        parts.push(`triage_inbox → ${flat(t.content?.[0]?.text)}`);
        ok &&= !listed.includes("triage_inbox") && t.isError;
        const e = await client.getPrompt({
          name: "summarize_record",
          arguments: { record: `entity ${reachLtm.entity}` },
        });
        parts.push(`summarize_record entity → ${flat(e.content?.[0]?.text).slice(0, 140)}`);
        ok &&= !!e.isError;
      }
      const a = await client.getPrompt({
        name: "summarize_record",
        arguments: { record: `openlaw://contracts/C-${c}` },
      });
      const b = await client.getPrompt({
        name: "summarize_record",
        arguments: { record: `contract C-${c}` },
      });
      parts.push(
        `summarize_record "openlaw://contracts/C-${c}" → ${shape(a)}; "contract C-${c}" → ${shape(b)}; summary says "${a.messages[0].content.text.match(/Do not change the record\./)?.[0]}"`,
      );
      ok &&=
        a.messages.length === 2 &&
        b.messages[1].content.resource.uri === `openlaw://contracts/C-${c}` &&
        !a.isError;
      expectThat(ok, parts.join(" | "));
      return parts.join(" | ");
    },
  );

  await step(
    S(role, "script Client"),
    "Each resource read or prompt get counts once against the credential's rate limit; the embedded read does not count again",
    "One ledger row per read and per get",
    async () => {
      const c = reach.contracts[0];
      const before = callsFor(k.name);
      await client.readResource({ uri: `openlaw://contracts/C-${c}` });
      const afterRead = callsFor(k.name);
      await client.getPrompt({
        name: "summarize_record",
        arguments: { record: `openlaw://contracts/C-${c}` },
      });
      const afterGet = callsFor(k.name);
      const tools = q(
        `select tool from mcp_tool_calls where client_name = '${k.name}' order by created_at desc limit 2`,
      ).split("\n");
      expectThat(
        afterRead - before === 1 && afterGet - afterRead === 1,
        `${before} ${afterRead} ${afterGet}`,
      );
      return `Ledger rows for this key (state read, the rate limit counts these): ${before} → ${afterRead} after one resources/read → ${afterGet} after one prompts/get with its embedded read. Newest rows name ${tools.join(", ")}.`;
    },
  );

  // ---------- listen ----------
  const events = [];
  let sub;
  await step(
    S(role, "script Client + /settings/mcp"),
    "Open subscriptions/listen (toolsListChanged, resourcesListChanged, promptsListChanged; resourceSubscriptions), change the Toolset ceiling, update a subscribed record",
    "list_changed notifications arrive; notifications/resources/updated arrives for reached records only",
    async () => {
      const c = reach.contracts[0];
      const subs = [`openlaw://contracts/C-${c}`];
      if (legal) subs.push("openlaw://inbox");
      if (!legal) subs.push(`openlaw://contracts/C-${reach.unreached}`);
      client.fallbackNotificationHandler = async (n) => {
        events.push({ at: Date.now(), method: n.method, uri: n.params?.uri });
      };
      sub = await client.listen({
        toolsListChanged: true,
        resourcesListChanged: true,
        promptsListChanged: true,
        resourceSubscriptions: subs,
      });
      // The ceiling change, in the browser as the Administrator.
      await U.gotoMcp(admin);
      await U.expandCard(admin, "Toolset ceiling");
      const x = await U.checkbox(admin, "Knowledge", false);
      await until(
        () => events.some((e) => e.method === "notifications/tools/list_changed"),
        "no list_changed",
        15000,
      );
      const y = await U.checkbox(admin, "Knowledge", true);
      await pause(1500);
      const listMethods = [...new Set(events.map((e) => e.method))];
      // A second actor updates the subscribed records (fixture writes, titles put back).
      const edited = [];
      for (const n of legal ? [c] : [c, reach.unreached]) {
        const before = await second.get(`/api/v1/contracts/${n}`);
        const title = before.body?.contract?.title ?? before.body?.title;
        await second.request("PATCH", `/api/v1/contracts/${n}`, {
          json: { title: `${title} (DOC-032)` },
          headers: H,
        });
        await pause(2500);
        await second.request("PATCH", `/api/v1/contracts/${n}`, { json: { title }, headers: H });
        edited.push(n);
      }
      await pause(2500);
      const afterTitles = events
        .filter((e) => e.method === "notifications/resources/updated")
        .map((e) => e.uri);
      // Title edits are working_team activity. A Business User hears full_thread only, so the
      // second actor also posts a full_thread comment on both records.
      const commented = [];
      if (!legal) {
        for (const n of [c, reach.unreached]) {
          const id = q(`select id from contracts where number = ${n}`);
          const r = await second.request("POST", "/api/v1/comments", {
            json: {
              entityType: "contract",
              entityId: id,
              body: `DOC-032 mcp fictional full-thread comment ${stamp}`,
              visibility: "full_thread",
            },
            headers: H,
          });
          commented.push(`C-${n} (${r.status})`);
        }
        await pause(3000);
      }
      const updated = events
        .filter((e) => e.method === "notifications/resources/updated")
        .map((e) => e.uri);
      const okReached = updated.includes(`openlaw://contracts/C-${c}`);
      const okUnreached = legal || !updated.includes(`openlaw://contracts/C-${reach.unreached}`);
      expectThat(
        listMethods.includes("notifications/tools/list_changed") &&
          listMethods.includes("notifications/prompts/list_changed") &&
          listMethods.includes("notifications/resources/list_changed") &&
          okReached &&
          okUnreached,
        JSON.stringify({ events, honored: sub.honoredFilter }),
      );
      return `Honored filter ${JSON.stringify(sub.honoredFilter)}. ${x} ${y} Notifications: ${listMethods.join(", ")}. Second actor edited the title of ${edited.map((n) => `C-${n}`).join(" and ")} twice each (then put it back). resources/updated URIs after the title edits: ${JSON.stringify([...new Set(afterTitles)])}${legal ? "" : ` (working_team activity; this Business User hears full_thread only). Second actor then posted full_thread comments on ${commented.join(" and ")}`}. All resources/updated URIs: ${JSON.stringify([...new Set(updated)])}${legal ? "" : `; nothing for the unreached C-${reach.unreached}`}. Updates carry the address only: ${JSON.stringify(events.find((e) => e.uri) ?? {})}.`;
    },
  );
  if (legal) {
    await step(
      S(role, "script Client"),
      "Inbox subscription: a new Request reaches the Legal User's Inbox",
      "notifications/resources/updated for openlaw://inbox",
      async () => {
        const n0 = events.length;
        // A staff view of a Request that is still new moves it out of the Inbox queue.
        const fresh = q(
          `select number from requests where status = 'new' and archived_at is null order by number desc limit 1`,
        );
        expectThat(fresh, "no new Request in the Inbox to view");
        const viewed = await second.request("POST", `/api/v1/requests/${fresh}/read`, {
          headers: H,
        });
        const got = await until(
          async () => events.slice(n0).find((e) => e.uri === "openlaw://inbox"),
          "no Inbox update",
          10000,
        );
        return `Fixture: the second actor (Daniel, API session) marked new Request R-${fresh} read, as opening it in the Inbox does (POST /read answered ${viewed.status}) and changes the Inbox queue. The stream received ${JSON.stringify(got)}.`;
      },
    );
  }

  await step(
    S(role, role === "business_user" ? "/portal/settings/api-keys" : "/settings/api-keys"),
    "Negative: revoke the key on its own row; the listen stream closes and the next call is unauthorized",
    "Stream closed; 401; row Revoked",
    async () => {
      const page = await open(role);
      await U.apiKeysPane(page, role);
      await page
        .getByRole("row")
        .filter({ hasText: k.name })
        .getByRole("button", { name: "Revoke", exact: true })
        .click();
      const dlg = page.getByRole("dialog", { name: "Revoke API key" });
      await dlg.getByRole("button", { name: "Revoke", exact: true }).click();
      await dlg.waitFor({ state: "detached" });
      const how = await Promise.race([
        sub.closed,
        pause(20000).then(() => "still open after 20 s"),
      ]);
      const next = await rawToolsList(MCP_URL, { "x-api-key": k.key });
      const row = await until(
        async () => {
          const t = await U.rowText(page, k.name);
          if (/Revoked/.test(t)) return t;
          await page.reload();
          return null;
        },
        "row never read Revoked",
        20000,
      );
      await client.close().catch(() => {});
      expectThat(how !== "still open after 20 s" && next.status === 401, `${how} ${next.status}`);
      return `Listen stream ended (${how}). Next tools/list → ${next.status}. Row "${row}".`;
    },
  );
}

// ---------- the Tool calls page names resource and prompt rows (configure-mcp) ----------
await step(
  S("administrator", "/settings/audit-log/tool-calls", {
    article: "configure-mcp",
    scenario: "V-M42-MCP",
  }),
  "Tool calls in the last day: a resource read shows as resource:<kind>; a prompt get as prompt:<name>; neither records the address",
  "Rows such as resource:contracts and prompt:triage_inbox; no address column or text",
  async () => {
    await U.gotoMcp(admin);
    await admin.getByRole("link", { name: "Tool calls in the last day" }).click();
    await admin.waitForURL(/\/settings\/audit-log\/tool-calls/);
    await admin.getByRole("columnheader", { name: "When" }).waitFor();
    const rows = (
      await admin.getByRole("row").filter({ hasText: `DOC-032 mcp c58` }).allInnerTexts()
    ).map(flat);
    const tools = [
      ...new Set(
        rows
          .map((r) => r.match(/\b(resource:[a-z-]+|prompt:[a-z_]+|openlaw_[a-z_]+)\b/)?.[0])
          .filter(Boolean),
      ),
    ];
    const addresses = rows.filter((r) => /openlaw:\/\//.test(r)).length;
    expectThat(
      tools.includes("resource:contracts") &&
        tools.includes("prompt:triage_inbox") &&
        addresses === 0,
      JSON.stringify(tools),
    );
    return `${rows.length} rows for this phase's keys on the first page. Tool values seen: ${tools.join(", ")}. Rows containing an openlaw:// address: ${addresses}. Example: "${rows.find((r) => /resource:contracts/.test(r))}".`;
  },
);

// ---------- put the policy back ----------
await step(
  S("administrator", "fixture", { article: "configure-mcp", scenario: "V-M42-MCP" }),
  "Cleanup: put every organization MCP setting back as found",
  "Policy equals the found policy",
  async () => {
    const keysOf = [
      "enabled",
      "legalApiKeysEnabled",
      "businessApiKeysEnabled",
      "toolsetCeiling",
      "readOnly",
    ];
    const body = Object.fromEntries(keysOf.map((x) => [x, found[x]]));
    const r = await api(admin, BASE, "PATCH", "/api/v1/mcp-settings", body);
    expectThat(r.status === 200, `PATCH ${r.status}`);
    return `PATCH ${r.status} with ${JSON.stringify(body)}.`;
  },
);

finish();
await browser.close();
process.exit(0);
