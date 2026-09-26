// DOC-030 inbox: named fixture configuration on a documentation lab.
// Creates only records whose names start with "DOC-030 inbox". Idempotent by name.
// Destination Forms (DD-028) decide what a Request collects and what a conversion carries,
// so the Contract and Matter types get their Rows through the Form API.
// Run: LAB_PASSWORD=... node docs/documentation/batches/DOC-030/inbox/setup-config.mjs
// Env: FIXTURES=<path> (default fixtures.json beside this file), LAB_APP_URL.
import { writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { apiSignIn, BASE, PEOPLE } from "./api.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const OUT = process.env.FIXTURES ?? path.join(here, "fixtures.json");
const P = "DOC-030 inbox";
const admin = await apiSignIn(PEOPLE.administrator.email);

async function list(p, key) {
  const { body } = await admin.get(p);
  return body[key] ?? [];
}
async function ensureTaxonomy(p, key, singular, displayName) {
  const rows = await list(`${p}?includeArchived=true`, key);
  let row = rows.find((r) => r.displayName === displayName);
  if (!row) row = (await admin.post(p, { displayName })).body[singular];
  return row;
}
async function ensureField(def) {
  const rows = await list("/api/v1/fields?includeArchived=true", "fields");
  let row = rows.find((r) => r.displayName === def.displayName);
  if (!row) row = (await admin.post("/api/v1/fields", def)).body.field;
  return row;
}
const flatten = (nodes) => nodes.flatMap((n) => (n.kind === "row" ? [n] : flatten(n.children)));

/** Replace the type's Form: set built-in switches and add or update catalog Field Rows. */
async function shapeForm(typePath, typeId, { builtins = {}, fields = [] }) {
  const at = `${typePath}/${typeId}/form`;
  const { body } = await admin.get(at);
  const form = body.form;
  for (const row of flatten(form)) {
    const b = builtins[row.rowRef];
    if (b) Object.assign(row, b);
  }
  for (const { field, isRequired = false, onIntakeForm = false } of fields) {
    const existing = flatten(form).find((r) => r.id === field.id);
    const row = {
      kind: "row",
      id: field.id,
      rowRef: field.slug,
      fieldType: field.fieldType,
      isRequired,
      onIntakeForm,
      visibleOnPortal: true,
    };
    if (existing) Object.assign(existing, row);
    else form.push(row);
  }
  const saved = await admin.put(at, { form });
  return saved.body.form;
}

const contractType = await ensureTaxonomy(
  "/api/v1/contract-types",
  "contractTypes",
  "contractType",
  `${P} Supplier agreement`,
);
const matterType = await ensureTaxonomy(
  "/api/v1/matter-types",
  "matterTypes",
  "matterType",
  `${P} Advisory`,
);

const def = (name, moduleScope, fieldType = "text", extra = {}) => ({
  displayName: `${P} ${name}`,
  moduleScope,
  fieldType,
  fieldTag: "business",
  ...extra,
});
// Fields belong to one module, so a Contract answer never matches a Matter Row.
const fCarry = await ensureField(def("Supplier name", "contract"));
const fStay = await ensureField(def("Budget note", "contract"));
const fReq = await ensureField(def("Cost centre", "contract"));
const fEnt = await ensureField(def("Contracting entity", "contract", "entity"));
const fRecordC = await ensureField(def("Contract summary", "contract"));
const mCarry = await ensureField(def("Adviser name", "matter"));
const mReq = await ensureField(def("Matter cost centre", "matter"));
const mEnt = await ensureField(def("Matter entity", "matter", "entity"));
const fChoice = await ensureField(
  def("Region choice", "matter", "single_select", { options: ["North", "South"] }),
);
const fRecord = await ensureField(def("Engagement summary", "matter"));

// Contract type: Description, Counterparties, Needed by and three Fields on the intake form;
// Cost centre is required for creation only; Contract summary is a Record Row.
const contractForm = await shapeForm("/api/v1/contract-types", contractType.id, {
  builtins: {
    description: { onIntakeForm: true },
    counterparties: { onIntakeForm: true },
    needed_by: { onIntakeForm: true },
  },
  fields: [
    { field: fCarry, onIntakeForm: true },
    { field: fStay, onIntakeForm: true },
    { field: fEnt, onIntakeForm: true },
    { field: fReq, isRequired: true },
    { field: fRecordC },
  ],
});
// Matter type: Description is NOT on the intake form, so the Request page shows a Description
// card; Needed by and two Fields on intake; Matter cost centre and Region choice required for
// creation; Engagement summary is a Record Row.
const matterForm = await shapeForm("/api/v1/matter-types", matterType.id, {
  builtins: {
    description: { onIntakeForm: false },
    needed_by: { onIntakeForm: true },
  },
  fields: [
    { field: mCarry, onIntakeForm: true },
    { field: mEnt, onIntakeForm: true },
    { field: mReq, isRequired: true },
    { field: fChoice, isRequired: true },
    { field: fRecord },
  ],
});

const contractRT = await ensureTaxonomy(
  "/api/v1/request-types",
  "requestTypes",
  "requestType",
  `${P} Supplier contract request`,
);
const matterRT = await ensureTaxonomy(
  "/api/v1/request-types",
  "requestTypes",
  "requestType",
  `${P} Advisory matter request`,
);
await admin.patch(`/api/v1/request-types/${contractRT.id}`, {
  targetModule: "contract",
  targetTypeId: contractType.id,
});
await admin.patch(`/api/v1/request-types/${matterRT.id}`, {
  targetModule: "matter",
  targetTypeId: matterType.id,
});

// A Contract Type default person, to check the team after conversion.
const users = (await admin.get("/api/v1/users")).body.users ?? [];
const priya = users.find((u) => u.displayName === "Priya Raman");
if (priya) {
  await admin.request("POST", `/api/v1/contract-types/${contractType.id}/people`, {
    json: { userId: priya.id },
    expect: [200, 201, 409],
  });
}

// Entities: one that stays live, one that is archived after the Requests carry it.
const entityTypes = (await admin.get("/api/v1/entity-types")).body.entityTypes ?? [];
const entityType = entityTypes.find((t) => !t.archivedAt);
const entities = (await admin.get("/api/v1/entities?includeArchived=true&limit=200")).body;
const entityRows = entities.entities ?? entities.rows ?? [];
async function ensureEntity(legalName) {
  let row = entityRows.find((e) => e.legalName === legalName);
  if (!row)
    row = (await admin.post("/api/v1/entities", { legalName, entityTypeId: entityType.id })).body
      .entity;
  return row;
}
const liveEntity = await ensureEntity(`${P} Live Holdings Ltd`);
const oldEntity = await ensureEntity(`${P} Old Holdings Ltd`);
for (const e of [liveEntity, oldEntity]) {
  await admin.request("PATCH", `/api/v1/entities/${e.id}`, {
    json: { portalListed: true },
    expect: [200, 409],
  });
}

// Matter templates on the DOC-030 Matter type.
const templates =
  (await admin.get(`/api/v1/matter-templates?includeArchived=true`)).body.matterTemplates ?? [];
async function ensureTemplate(name, extra) {
  let row = templates.find((t) => t.name === name && t.matterTypeId === matterType.id);
  if (!row)
    row = (
      await admin.post("/api/v1/matter-templates", { matterTypeId: matterType.id, name, ...extra })
    ).body.matterTemplate;
  return row;
}
const goodTemplate = await ensureTemplate(`${P} Advisory template`, {
  description: "Fictional template for the DOC-030 inbox walkthrough.",
  defaultPriority: "low",
  defaultRisk: "critical",
  titlePrefix: "TPL - ",
});
await admin.put(`/api/v1/matter-templates/${goodTemplate.id}/custom-fields`, {
  defaultCustomFields: { [mCarry.slug]: "Template adviser default", [fChoice.slug]: "North" },
});
await admin.put(`/api/v1/matter-templates/${goodTemplate.id}/tasks`, {
  tasks: [
    { title: `${P} manager task`, dueOffsetDays: 3, assigneeRole: "matter_manager" },
    { title: `${P} open task`, dueOffsetDays: null, assigneeRole: "none" },
  ],
});
await admin.put(`/api/v1/matter-templates/${goodTemplate.id}/key-dates`, {
  keyDates: [{ label: `${P} checkpoint`, offsetDays: 5, note: null }],
});

const staleTemplate = await ensureTemplate(`${P} Stale template`, {
  description: "Fictional template whose Region choice default is later removed from the options.",
});
const choiceNow = (await list("/api/v1/fields?includeArchived=true", "fields")).find(
  (f) => f.id === fChoice.id,
);
if (!(choiceNow.options ?? []).includes("West")) {
  await admin.patch(`/api/v1/fields/${fChoice.id}`, { options: ["North", "South", "West"] });
}
await admin.put(`/api/v1/matter-templates/${staleTemplate.id}/custom-fields`, {
  defaultCustomFields: { [fChoice.slug]: "West" },
});
await admin.patch(`/api/v1/fields/${fChoice.id}`, { options: ["North", "South"] });

const departments = (await admin.get("/api/v1/departments/options")).body.departments ?? [];
const brief = (form) =>
  flatten(form).map((r) => ({
    rowRef: r.rowRef,
    onIntakeForm: Boolean(r.onIntakeForm),
    isRequired: r.isRequired,
  }));

const out = {
  note: "Fixture identifiers for the DOC-030 inbox walkthrough. No credentials.",
  lab: BASE,
  createdAt: new Date().toISOString(),
  contractType: { id: contractType.id, name: contractType.displayName, form: brief(contractForm) },
  matterType: { id: matterType.id, name: matterType.displayName, form: brief(matterForm) },
  requestTypes: {
    contract: { id: contractRT.id, name: contractRT.displayName },
    matter: { id: matterRT.id, name: matterRT.displayName },
  },
  fields: Object.fromEntries(
    Object.entries({
      carry: fCarry,
      stay: fStay,
      required: fReq,
      entity: fEnt,
      recordC: fRecordC,
      mCarry,
      mRequired: mReq,
      mEntity: mEnt,
      choice: fChoice,
      record: fRecord,
    }).map(([k, f]) => [k, { id: f.id, slug: f.slug, name: f.displayName, type: f.fieldType }]),
  ),
  entities: {
    live: { id: liveEntity.id, name: liveEntity.legalName },
    old: { id: oldEntity.id, name: oldEntity.legalName },
  },
  templates: {
    good: { id: goodTemplate.id, name: goodTemplate.name },
    stale: { id: staleTemplate.id, name: staleTemplate.name },
  },
  contractTypeDefaultPerson: priya ? priya.displayName : null,
  departments: departments.map((d) => ({ id: d.id, name: d.displayName ?? d.name })),
};
writeFileSync(OUT, JSON.stringify(out, null, 2));
console.log(JSON.stringify(out, null, 2));
