// Fixture setup for the DOC-030 access walkthrough. Creates only records named "DOC-030 access ...".
// Run once from the worktree root: LAB_PASSWORD=... node docs/documentation/batches/DOC-030/access/setup.mjs
// Writes record numbers and IDs, never credentials, to fixtures.json. Rerunning reuses fixtures.json.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { apiSession, call, upload, here, SEED, sleep, magicLinkSession } from "./lib.mjs";

const OUT = path.join(here, "fixtures.json");
const fx = existsSync(OUT) ? JSON.parse(readFileSync(OUT, "utf8")) : {};
const save = () => writeFileSync(OUT, JSON.stringify(fx, null, 2) + "\n");
const must = (r, what) => {
  if (r.status >= 300)
    throw new Error(`${what}: ${r.status} ${JSON.stringify(r.body).slice(0, 300)}`);
  return r.body;
};
const tag = (fx.stamp ??=
  process.env.FIXTURE_TAG ?? new Date().toISOString().slice(0, 16).replace(/\D/g, "").slice(4));
const name = (s) => `DOC-030 access ${s} ${tag}`;

const d = await apiSession(SEED.daniel.email);
const n = await apiSession(SEED.nadia.email);
const users = must(await call(d, "GET", "/users"), "users").users;
const uid = (email) => users.find((u) => u.email === email).id;
fx.ids = Object.fromEntries(Object.entries(SEED).map(([k, v]) => [k, uid(v.email)]));
const ctypes = must(await call(d, "GET", "/contract-types"), "ctypes").contractTypes;
const mtypes = must(await call(d, "GET", "/matter-types"), "mtypes").matterTypes;
const depts = must(await call(d, "GET", "/departments"), "depts").departments;
const nda = ctypes.find((t) => t.displayName === "NDA").id;
const commercial = mtypes.find((t) => t.displayName === "Commercial").id;
const sales = depts.find((t) => t.displayName === "Sales").id;
fx.types = { nda, commercial, sales };

// ---- Fields and Forms: a Field shown on one type's Form and hidden on another's, a hidden Field, and a Branch.
if (!fx.form) {
  const existing = must(await call(d, "GET", "/fields"), "fields").fields;
  const field = async (displayName, fieldType) => {
    const f =
      existing.find((x) => x.displayName === displayName) ??
      must(
        await call(d, "POST", "/fields", { displayName, moduleScope: "contract", fieldType }),
        displayName,
      ).field;
    return { ...f, key: f.slug };
  };
  const visible = await field(name("Visible field"), "text");
  const hidden = await field(name("Hidden field"), "text");
  const gate = await field(name("Gate"), "boolean");
  const branch = await field(name("Branch field"), "text");
  const base = must(await call(d, "GET", `/contract-types/${nda}/form`), "nda form").form;
  const row = (f, visibleOnPortal) => ({
    kind: "row",
    id: f.id,
    rowRef: f.key,
    fieldType: f.fieldType,
    onIntakeForm: false,
    isRequired: false,
    visibleOnPortal,
  });
  const type = async (displayName) =>
    ctypes.find((t) => t.displayName === displayName) ??
    must(await call(d, "POST", "/contract-types", { displayName }), displayName).contractType;
  const typeA = await type(name("Form type"));
  const typeB = await type(name("Second type"));
  must(
    await call(d, "PUT", `/contract-types/${typeA.id}/form`, {
      form: [
        ...base,
        row(visible, true),
        row(hidden, false),
        row(gate, true),
        {
          kind: "branch",
          id: `doc030-access-branch-${tag}`,
          match: "all",
          conditions: [{ rowRef: gate.key, operator: "equals", value: true }],
          children: [row(branch, true)],
        },
      ],
    }),
    "form A",
  );
  must(
    await call(d, "PUT", `/contract-types/${typeB.id}/form`, {
      form: [...base, row(visible, false)],
    }),
    "form B",
  );
  fx.form = {
    typeA: { id: typeA.id, name: typeA.displayName },
    typeB: { id: typeB.id, name: typeB.displayName },
    visible: { id: visible.id, key: visible.key, name: visible.displayName },
    hidden: { id: hidden.id, key: hidden.key, name: hidden.displayName },
    gate: { id: gate.id, key: gate.key, name: gate.displayName },
    branch: { id: branch.id, key: branch.key, name: branch.displayName },
  };
  save();
}

// ---- An Administrator-added Contract Document type, for the "reads General" check.
if (!fx.docType) {
  const t = must(
    await call(d, "POST", "/documents/types/contract", {
      displayName: name("Admin document type"),
    }),
    "doc type",
  );
  fx.docType = { id: (t.documentType ?? t).id, name: (t.documentType ?? t).displayName };
  save();
}

// ---- roles-and-access records.
async function contract(s, body, what) {
  return must(await call(s, "POST", "/contracts", body), what).contract;
}
async function matter(s, body, what) {
  return must(await call(s, "POST", "/matters", body), what).matter;
}
if (!fx.co) {
  const co = await contract(
    d,
    {
      title: name("open contract"),
      contractTypeId: nda,
      managerId: fx.ids.daniel,
      owningDepartmentId: sales,
      region: "EMEA",
    },
    "CO",
  );
  fx.co = { number: co.number, id: co.id, title: co.title };
  const mo = await matter(
    d,
    {
      title: name("open matter"),
      matterTypeId: commercial,
      managerId: fx.ids.daniel,
      departmentId: sales,
      region: "EMEA",
    },
    "MO",
  );
  fx.mo = { number: mo.number, id: mo.id, title: mo.title };
  const cc = await contract(
    n,
    {
      title: name("confidential contract"),
      contractTypeId: nda,
      managerId: fx.ids.nadia,
      isConfidential: true,
      matterNumber: mo.number,
    },
    "CC",
  );
  fx.cc = { number: cc.number, id: cc.id, title: cc.title };
  const mc = await matter(
    n,
    {
      title: name("confidential matter"),
      matterTypeId: commercial,
      managerId: fx.ids.nadia,
      isConfidential: true,
    },
    "MC",
  );
  must(
    await call(n, "PUT", `/matters/${mc.number}/parent`, { parentMatterNumber: mo.number }),
    "MC parent",
  );
  fx.mc = { number: mc.number, id: mc.id, title: mc.title };
  save();
}
if (!fx.parent) {
  // A Confidential parent Contract whose team holds Jonas, and an open child Contract with no Jonas row.
  const p = await contract(
    n,
    {
      title: name("confidential parent contract"),
      contractTypeId: nda,
      managerId: fx.ids.nadia,
      isConfidential: true,
    },
    "parent",
  );
  must(
    await call(n, "POST", `/contracts/${p.number}/team`, { userId: fx.ids.jonas }),
    "parent team",
  );
  const c = await contract(
    n,
    { title: name("child contract"), contractTypeId: nda, managerId: fx.ids.nadia },
    "child",
  );
  must(
    await call(n, "POST", `/contracts/${c.number}/parent`, { parentContractNumber: p.number }),
    "child parent",
  );
  fx.parent = { number: p.number, id: p.id, title: p.title };
  fx.child = { number: c.number, id: c.id, title: c.title };
  save();
}
if (!fx.coDocs) {
  const base = must(
    await upload(
      d,
      `/contracts/${fx.co.number}/documents`,
      "doc030-access-baseline.txt",
      "DOC-030 access fictional baseline.\n",
    ),
    "baseline",
  );
  const note = must(
    await upload(
      d,
      `/contracts/${fx.co.number}/documents`,
      "doc030-access-confidential-note.txt",
      "DOC-030 access fictional confidential note.\n",
    ),
    "note",
  );
  must(
    await call(d, "PATCH", `/documents/${note.document.id}`, { isConfidential: true }),
    "note confidential",
  );
  fx.coDocs = { baseline: base.document.id, note: note.document.id };
  for (const [visibility, body] of [
    ["legal_only", "DOC-030 access Legal only note"],
    ["working_team", "DOC-030 access Working team note"],
    ["full_thread", "DOC-030 access Full thread note"],
  ])
    must(
      await call(n, "POST", "/comments", {
        entityType: "contract",
        entityId: fx.co.id,
        body,
        visibility,
      }),
      visibility,
    );
  save();
}
if (!fx.entity) {
  const etypes = must(await call(d, "GET", "/entities/types"), "etypes").entityTypes;
  const e = must(
    await call(n, "POST", "/entities", {
      legalName: name("confidential entity Ltd"),
      entityTypeId: etypes[0].id,
    }),
    "entity",
  ).entity;
  must(
    await call(n, "PATCH", `/entities/${e.id}`, { isConfidential: true }),
    "entity confidential",
  );
  fx.entity = { id: e.id, name: e.legalName };
  save();
}

// ---- Approval packets for Jonas: one with an open primary Document, one with a Confidential primary Document.
if (!fx.approvals) {
  const a = await contract(
    n,
    { title: name("approval contract"), contractTypeId: nda, managerId: fx.ids.nadia },
    "approval contract",
  );
  const ad = must(
    await upload(
      n,
      `/contracts/${a.number}/documents`,
      "doc030-access-approval-paper.txt",
      "DOC-030 access fictional approval paper.\n",
    ),
    "approval doc",
  );
  const b = await contract(
    n,
    {
      title: name("confidential paper approval contract"),
      contractTypeId: nda,
      managerId: fx.ids.nadia,
    },
    "approval contract 2",
  );
  const bd = must(
    await upload(
      n,
      `/contracts/${b.number}/documents`,
      "doc030-access-restricted-paper.txt",
      "DOC-030 access fictional restricted paper.\n",
    ),
    "approval doc 2",
  );
  must(
    await call(n, "PATCH", `/documents/${bd.document.id}`, { isConfidential: true }),
    "approval doc confidential",
  );
  const w = await contract(
    n,
    { title: name("withdrawn approval contract"), contractTypeId: nda, managerId: fx.ids.nadia },
    "approval contract 3",
  );
  fx.approvals = {
    open: { number: a.number, id: a.id, title: a.title, doc: ad.document.id },
    confidentialPaper: { number: b.number, id: b.id, title: b.title, doc: bd.document.id },
    withdraw: { number: w.number, id: w.id, title: w.title },
  };
  for (const k of ["open", "confidentialPaper", "withdraw"]) {
    const r = must(
      await call(n, "POST", `/contracts/${fx.approvals[k].number}/approvals`, {
        approverIds: [fx.ids.jonas],
      }),
      `approval ${k}`,
    );
    fx.approvals[k].approvalId = (r.approvals ?? [r.approval ?? r])[0]?.id ?? null;
  }
  save();
}

// ---- Jonas: a converted Request (Business Owner and team at conversion).
async function requestAndConvert(email, who, key, contractTypeId) {
  // The Portal form and the Inbox conversion are other guides' steps; here they are API fixtures.
  const b = await magicLinkSession(email);
  const rt = must(await call(d, "GET", "/portal/request-types/contract_review"), "rt");
  const rq = must(
    await call(b, "POST", "/requests", {
      requestTypeId: rt.requestType.id,
      departmentId: sales,
      title: name(`${who} request`),
      description: `DOC-030 access fictional ask from ${who}.`,
      urgency: "medium",
    }),
    `request ${who}`,
  ).request;
  const cv = must(
    await call(n, "POST", `/requests/${rq.number}/convert`, {
      title: name(`${who} converted contract`),
      contractTypeId,
    }),
    `convert ${who}`,
  );
  const rec = cv.request?.convertedRecord ?? cv.request?.conversion?.convertedRecord;
  fx[key] = {
    request: rq.number,
    number: rec.number,
    id: rec.id,
    title: name(`${who} converted contract`),
  };
  save();
}
if (!fx.jonasConverted) await requestAndConvert(SEED.jonas.email, "Jonas", "jonasConverted", nda);
if (!fx.raviConverted)
  await requestAndConvert(SEED.ravi.email, "Ravi", "raviConverted", fx.form.typeA.id);

// ---- Ravi's Contract: primary Document by Legal, Field values, a primary Counterparty.
if (!fx.raviPrimary) {
  const p = must(
    await upload(
      n,
      `/contracts/${fx.raviConverted.number}/documents`,
      "doc030-access-supporting-v1.txt",
      "DOC-030 access fictional supporting paper, version 1.\n",
    ),
    "ravi primary",
  );
  fx.raviPrimary = { id: p.document.id, v1: p.document.versions[0].id };
  must(
    await call(n, "PATCH", `/contracts/${fx.raviConverted.number}`, {
      customFields: {
        [fx.form.visible.key]: "DOC-030 access shown value",
        [fx.form.hidden.key]: "DOC-030 access hidden value",
        [fx.form.gate.key]: false,
      },
      region: "EMEA",
      owningDepartmentId: sales,
      value: { amount: 1200000, currency: "GBP", cadence: "annually" },
      effectiveDate: "2026-01-01",
      expiryDate: "2027-12-31",
    }),
    "ravi fields",
  );
  must(
    await call(n, "POST", `/contracts/${fx.raviConverted.number}/counterparties`, {
      name: name("Fictional Supplier Ltd"),
    }),
    "counterparty",
  );
  save();
}
if (!fx.mr) {
  const mr = await matter(
    n,
    {
      title: name("Ravi matter"),
      matterTypeId: commercial,
      managerId: fx.ids.nadia,
      departmentId: sales,
      region: "EMEA",
      description: "DOC-030 access fictional Matter description.",
    },
    "MR",
  );
  fx.mr = { number: mr.number, id: mr.id, title: mr.title };
  save();
}
// Ravi's comparable Matter: same type, no Ravi row.
if (!fx.mx) {
  const mx = await matter(
    n,
    { title: name("comparable matter"), matterTypeId: commercial, managerId: fx.ids.nadia },
    "MX",
  );
  fx.mx = { number: mx.number, id: mx.id, title: mx.title };
  save();
}
// Document paging Matter with 51 Documents, Ravi on its team.
if (!fx.dm) {
  const dm = await matter(
    n,
    { title: name("document paging matter"), matterTypeId: commercial, managerId: fx.ids.nadia },
    "DM",
  );
  must(await call(n, "POST", `/matters/${dm.number}/team`, { userId: fx.ids.ravi }), "DM team");
  for (let i = 1; i <= 51; i++)
    must(
      await upload(
        n,
        `/matters/${dm.number}/documents`,
        `doc030-access-page-${String(i).padStart(2, "0")}.txt`,
        `DOC-030 access fictional paging paper ${i}.\n`,
      ),
      `page ${i}`,
    );
  fx.dm = { number: dm.number, id: dm.id, title: dm.title };
  save();
}
// Show more: 26 Contracts with Jonas and Ravi on the team (Portal pages hold 25 rows).
if (!fx.paging) {
  fx.paging = [];
  for (let i = 1; i <= 26; i++) {
    const c = await contract(
      n,
      {
        title: name(`paging contract ${String(i).padStart(2, "0")}`),
        contractTypeId: nda,
        managerId: fx.ids.nadia,
      },
      `paging ${i}`,
    );
    must(
      await call(n, "POST", `/contracts/${c.number}/team`, { userId: fx.ids.jonas }),
      `paging team J ${i}`,
    );
    must(
      await call(n, "POST", `/contracts/${c.number}/team`, { userId: fx.ids.ravi }),
      `paging team R ${i}`,
    );
    fx.paging.push(c.number);
    await sleep(50);
  }
  save();
}

// ---- Second round of fixtures.
if (!fx.archivedJ) {
  const a = await contract(
    n,
    { title: name("archived team contract"), contractTypeId: nda, managerId: fx.ids.nadia },
    "archivedJ",
  );
  must(
    await call(n, "POST", `/contracts/${a.number}/team`, { userId: fx.ids.jonas }),
    "archivedJ team",
  );
  must(await call(n, "POST", `/contracts/${a.number}/archive`, {}), "archivedJ archive");
  fx.archivedJ = { number: a.number, title: a.title };
  save();
}
if (!fx.jonasPrimary) {
  const p = must(
    await upload(
      n,
      `/contracts/${fx.jonasConverted.number}/documents`,
      "doc030-access-jonas-paper.txt",
      "DOC-030 access fictional paper for Jonas.\n",
    ),
    "jonas primary",
  );
  must(
    await call(n, "POST", `/contracts/${fx.jonasConverted.number}/counterparties`, {
      name: name("Fictional Partner Ltd"),
    }),
    "jonas counterparty",
  );
  must(
    await call(n, "PATCH", `/contracts/${fx.jonasConverted.number}`, {
      value: { amount: 5000000, currency: "GBP", cadence: "one_time" },
      effectiveDate: "2026-02-01",
      expiryDate: "2028-01-31",
    }),
    "jonas values",
  );
  fx.jonasPrimary = { id: p.document.id };
  save();
}
if (!fx.entity2) {
  const etypes = must(await call(d, "GET", "/entities/types"), "etypes").entityTypes;
  const e = must(
    await call(n, "POST", "/entities", {
      legalName: name("second confidential entity Ltd"),
      entityTypeId: etypes[0].id,
    }),
    "entity2",
  ).entity;
  must(
    await call(n, "PATCH", `/entities/${e.id}`, { isConfidential: true }),
    "entity2 confidential",
  );
  fx.entity2 = { id: e.id, name: e.legalName };
  save();
}
if (!fx.cr2) {
  const c = await contract(
    n,
    {
      title: name("Ravi second type contract"),
      contractTypeId: fx.form.typeB.id,
      managerId: fx.ids.nadia,
    },
    "cr2",
  );
  must(
    await call(n, "PATCH", `/contracts/${c.number}`, {
      customFields: { [fx.form.visible.key]: "DOC-030 access value on the second type" },
    }),
    "cr2 field",
  );
  must(await call(n, "POST", `/contracts/${c.number}/team`, { userId: fx.ids.ravi }), "cr2 team");
  fx.cr2 = { number: c.number, title: c.title };
  save();
}
if (!fx.raviApprovals) {
  fx.raviApprovals = {};
  for (const k of ["approve", "reject"]) {
    const c = await contract(
      n,
      { title: name(`Ravi ${k} approval contract`), contractTypeId: nda, managerId: fx.ids.nadia },
      `ravi ${k}`,
    );
    const doc = must(
      await upload(
        n,
        `/contracts/${c.number}/documents`,
        `doc030-access-ravi-${k}-paper.txt`,
        `DOC-030 access fictional paper to ${k}.\n`,
      ),
      `ravi ${k} doc`,
    );
    const r = must(
      await call(n, "POST", `/contracts/${c.number}/approvals`, { approverIds: [fx.ids.ravi] }),
      `ravi ${k} approval`,
    );
    fx.raviApprovals[k] = {
      number: c.number,
      title: c.title,
      doc: doc.document.id,
      approvalId: (r.approvals ?? [r.approval ?? r])[0]?.id ?? null,
    };
  }
  save();
}
fx.createdAt ??= new Date().toISOString();
save();
console.log(JSON.stringify(fx, null, 2));
