// Fixture setup for the DOC-029 roles independent walkthrough (round 1).
// Creates only records named "DOC-029 roles ..." in the shared work lab.
// Writes record numbers and IDs (no credentials) to fixtures-r1.json.
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium, passwordSignIn, magicSignIn, api, BASE } from "./lib-r1.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(here, "fixtures-r1.json");
const must = (r, what) => {
  if (r.status >= 300)
    throw new Error(`${what}: ${r.status} ${JSON.stringify(r.json).slice(0, 300)}`);
  return r.json;
};

async function upload(page, module, number, file, extra = {}) {
  const res = await page.request.post(`${BASE}/api/v1/${module}/${number}/documents`, {
    headers: { origin: BASE },
    multipart: {
      ...extra,
      file: {
        name: path.basename(file),
        mimeType: "text/plain",
        buffer: readFileSync(path.join(here, "fixtures", file)),
      },
    },
    failOnStatusCode: false,
  });
  const json = await res.json().catch(() => null);
  if (res.status() >= 300)
    throw new Error(`upload ${file}: ${res.status()} ${JSON.stringify(json).slice(0, 300)}`);
  return json;
}

const browser = await chromium.launch();
const d = await passwordSignIn(browser, "daniel.okafor@helix.example");
const n = await passwordSignIn(browser, "nadia.haddad@helix.example");
const users = must(await api(d.page, "GET", "/users"), "users").users;
const uid = (email) => users.find((u) => u.email === email).id;
const ids = {
  daniel: uid("daniel.okafor@helix.example"),
  nadia: uid("nadia.haddad@helix.example"),
  priya: uid("priya.raman@helix.example"),
  ravi: uid("ravi.menon@helix.example"),
  jonas: uid("jonas.weber@helix.example"),
  amara: uid("amara.nwosu@helix.example"),
};
const ctypes = must(await api(d.page, "GET", "/contract-types"), "ctypes").contractTypes;
const mtypes = must(await api(d.page, "GET", "/matter-types"), "mtypes").matterTypes;
const etypes = must(await api(d.page, "GET", "/entities/types"), "etypes").entityTypes;
const depts = must(await api(d.page, "GET", "/departments"), "depts").departments;
const nda = ctypes.find((t) => t.displayName === "NDA").id;
const commercial = mtypes.find((t) => t.displayName === "Commercial").id;
const sales = depts.find((t) => t.displayName === "Sales").id;

const fx = { createdAt: new Date().toISOString(), ids };

const co = must(
  await api(d.page, "POST", "/contracts", {
    title: "DOC-029 roles open contract",
    contractTypeId: nda,
    managerId: ids.daniel,
    owningDepartmentId: sales,
    region: "EMEA",
  }),
  "CO",
).contract;
fx.openContract = { number: co.number, id: co.id };
const mo = must(
  await api(d.page, "POST", "/matters", {
    title: "DOC-029 roles open matter",
    matterTypeId: commercial,
    managerId: ids.daniel,
    departmentId: sales,
    region: "EMEA",
  }),
  "MO",
).matter;
fx.openMatter = { number: mo.number, id: mo.id };
const cc = must(
  await api(n.page, "POST", "/contracts", {
    title: "DOC-029 roles confidential contract",
    contractTypeId: nda,
    managerId: ids.nadia,
    isConfidential: true,
    matterNumber: mo.number,
  }),
  "CC",
).contract;
fx.confContract = { number: cc.number, id: cc.id };
const mc = must(
  await api(n.page, "POST", "/matters", {
    title: "DOC-029 roles confidential matter",
    matterTypeId: commercial,
    managerId: ids.nadia,
    isConfidential: true,
    parentMatterNumber: mo.number,
  }),
  "MC",
).matter;
fx.confMatter = { number: mc.number, id: mc.id };

// Documents on the open Contract and open Matter: a baseline and a Confidential note.
const base = await upload(d.page, "contracts", co.number, "doc029-roles-baseline.txt");
const note = await upload(d.page, "contracts", co.number, "doc029-roles-confidential-note.txt");
fx.openContractDocs = { baseline: base, note };
const mnote = await upload(d.page, "matters", mo.number, "doc029-roles-confidential-note.txt");
fx.openMatterDocs = { note: mnote };
for (const doc of [note.document, mnote.document])
  must(await api(d.page, "PATCH", `/documents/${doc.id}`, { isConfidential: true }), "doc conf");

// Confidential Entity created by Nadia.
const ent = must(
  await api(n.page, "POST", "/entities", {
    legalName: "DOC-029 roles confidential entity Ltd",
    entityTypeId: etypes[0].id,
  }),
  "E",
).entity;
must(await api(n.page, "PATCH", `/entities/${ent.id}`, { isConfidential: true }), "E conf");
fx.confEntity = { id: ent.id };

// Comments on the open Contract at three tiers.
for (const [visibility, body] of [
  ["legal_only", "DOC-029 roles Legal only note"],
  ["working_team", "DOC-029 roles Working team note"],
  ["full_thread", "DOC-029 roles Full thread note"],
]) {
  must(
    await api(n.page, "POST", "/comments", {
      entityType: "contract",
      entityId: co.id,
      body,
      visibility,
    }),
    `comment ${visibility}`,
  );
}

// Requests from Jonas and Ravi, converted by Nadia into Contracts.
const reviewType = must(await api(d.page, "GET", "/portal/request-types/contract_review"), "rt")
  .requestType.id;
for (const [who, email, key] of [
  ["Jonas", "jonas.weber@helix.example", "jonas"],
  ["Ravi", "ravi.menon@helix.example", "ravi"],
]) {
  const b = await magicSignIn(browser, email);
  const rq = must(
    await api(b.page, "POST", "/requests", {
      requestTypeId: reviewType,
      departmentId: sales,
      title: `DOC-029 roles ${who} request`,
      description: `DOC-029 roles fictional ask from ${who}.`,
      urgency: "medium",
      customFields: { counterparty_name: "DOC-029 Fictional Counterparty Ltd" },
    }),
    `request ${who}`,
  ).request;
  const converted = must(
    await api(n.page, "POST", `/requests/${rq.number}/convert`, {
      title: `DOC-029 roles ${who} converted contract`,
      contractTypeId: nda,
    }),
    `convert ${who}`,
  );
  fx[`${key}Request`] = {
    number: rq.number,
    converted: converted.request?.conversion ?? converted.request,
  };
  await b.context.close();
}
writeFileSync(OUT, JSON.stringify(fx, null, 2));
console.log(JSON.stringify(fx, null, 2));
await browser.close();
