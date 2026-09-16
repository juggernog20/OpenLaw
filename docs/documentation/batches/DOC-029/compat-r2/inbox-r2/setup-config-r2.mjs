// DOC-029r2 inbox round 2 compatibility replay of the round 1 script: named fixture configuration on the shared work lab.
// Creates only records whose names start with "DOC-029r2 inbox". Idempotent by name.
// Run: LAB_PASSWORD=... mise exec -- node docs/documentation/batches/DOC-029/compat-r2/inbox-r2/setup-config-r2.mjs
import { writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { apiSignIn, PEOPLE } from "./api.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const P = "DOC-029r2 inbox";
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
async function attach(typePath, typeId, fieldId, isRequired = false) {
  await admin.request("POST", `${typePath}/${typeId}/fields`, {
    json: { fieldId, isRequired },
    expect: [201, 409],
  });
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

const fCarry = await ensureField({
  displayName: `${P} Supplier name`,
  moduleScope: "global",
  fieldType: "text",
  fieldTag: "business",
});
const fStay = await ensureField({
  displayName: `${P} Budget note`,
  moduleScope: "global",
  fieldType: "text",
  fieldTag: "business",
});
const fReq = await ensureField({
  displayName: `${P} Cost centre`,
  moduleScope: "global",
  fieldType: "text",
  fieldTag: "business",
});
const fEnt = await ensureField({
  displayName: `${P} Contracting entity`,
  moduleScope: "global",
  fieldType: "entity",
  fieldTag: "business",
});
const fChoice = await ensureField({
  displayName: `${P} Region`,
  moduleScope: "global",
  fieldType: "single_select",
  fieldTag: "business",
  options: ["North", "South"],
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

for (const rt of [contractRT, matterRT]) {
  await attach("/api/v1/request-types", rt.id, fCarry.id);
  await attach("/api/v1/request-types", rt.id, fStay.id);
  await attach("/api/v1/request-types", rt.id, fEnt.id);
}
for (const [p, t] of [
  ["/api/v1/contract-types", contractType],
  ["/api/v1/matter-types", matterType],
]) {
  await attach(p, t.id, fCarry.id);
  await attach(p, t.id, fReq.id, true);
  await attach(p, t.id, fEnt.id);
  await attach(p, t.id, fChoice.id);
}

// A Contract Type default person, to check the team after conversion.
const users = (await admin.get("/api/v1/users")).body.users ?? [];
const priya = users.find((u) => u.displayName === "Priya Raman");
if (priya) {
  await admin.request("POST", `/api/v1/contract-types/${contractType.id}/people`, {
    json: { userId: priya.id },
    expect: [201, 409],
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

// Matter templates on the DOC-029 Matter type.
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
  description: "Fictional template for the DOC-029r2 inbox walkthrough.",
  defaultPriority: "low",
  defaultRisk: "critical",
  titlePrefix: "TPL - ",
});
await admin.put(`/api/v1/matter-templates/${goodTemplate.id}/custom-fields`, {
  defaultCustomFields: { [fCarry.slug]: "Template supplier default", [fChoice.slug]: "North" },
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
  description: "Fictional template whose Region default is later removed from the options.",
});
// Set its default while the option exists, then remove the option from the Field.
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

const out = {
  note: "Fixture identifiers for the DOC-029r2 inbox round 1 walkthrough. No credentials.",
  createdAt: new Date().toISOString(),
  contractType: { id: contractType.id, name: contractType.displayName },
  matterType: { id: matterType.id, name: matterType.displayName },
  requestTypes: {
    contract: { id: contractRT.id, name: contractRT.displayName },
    matter: { id: matterRT.id, name: matterRT.displayName },
  },
  fields: {
    carry: { id: fCarry.id, slug: fCarry.slug, name: fCarry.displayName },
    stay: { id: fStay.id, slug: fStay.slug, name: fStay.displayName },
    required: { id: fReq.id, slug: fReq.slug, name: fReq.displayName },
    entity: { id: fEnt.id, slug: fEnt.slug, name: fEnt.displayName },
    choice: { id: fChoice.id, slug: fChoice.slug, name: fChoice.displayName },
  },
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
writeFileSync(path.join(here, "fixtures-r2.json"), JSON.stringify(out, null, 2));
console.log(JSON.stringify(out, null, 2));
