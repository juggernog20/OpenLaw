// Fixture setup for the DOC-030 matters independent walkthrough.
// Adds DOC-030-named Fields, three Matter types with their Forms and four Matter templates
// through the Administrator API. It changes no seeded record or organization setting.
// Run from the repository root: LAB_PASSWORD=... node docs/documentation/batches/DOC-030/matters/setup.mjs
//
// Matter type Forms (the create dialog draws Rows On intake form or Required for creation):
// - "DOC-030 matters type": Description, Department, Priority, Risk, Needed by and the optional
//   note, Entity and person Fields On intake form; the required note Required for creation;
//   Region a record Row.
// - "DOC-030 matters retype": the Form a new type gets (Description on intake only), plus a
//   required note and a required number Field. It stands for "a new type" in the checks.
// - "DOC-030 matters department required": Department Required for creation, Description on intake.
import { writeFileSync, existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium, passwordSignIn, api } from "./lib.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(here, "fixtures.json");
const fixtures = existsSync(OUT) ? JSON.parse(readFileSync(OUT, "utf8")) : {};

const browser = await chromium.launch();
const { page } = await passwordSignIn(browser, "daniel.okafor@helix.example");
const must = (r, what) => {
  if (r.status >= 300) throw new Error(`${what}: ${r.status} ${JSON.stringify(r.json)}`);
  return r.json;
};

const fieldList = must(await api(page, "GET", "/fields?includeArchived=true"), "fields").fields;
async function field(key, displayName, fieldType, fieldTag) {
  let row = fieldList.find((f) => f.displayName === displayName);
  if (!row)
    row = must(
      await api(page, "POST", "/fields", {
        displayName,
        moduleScope: "matter",
        fieldType,
        fieldTag,
      }),
      displayName,
    ).field;
  fixtures[key] = { id: row.id, slug: row.slug, displayName, fieldType };
}
await field("fieldRequired", "DOC-030 matters required note", "text", "legal");
await field("fieldOptional", "DOC-030 matters optional note", "text", "business");
await field("fieldEntity", "DOC-030 matters Entity", "entity", "business");
await field("fieldPerson", "DOC-030 matters person", "user", "business");
await field("fieldNumber", "DOC-030 matters retype number", "number", "business");

const types = must(
  await api(page, "GET", "/matter-types?includeArchived=true"),
  "types",
).matterTypes;
const fieldRow = (key, { required = false, intake = false } = {}) => ({
  kind: "row",
  id: fixtures[key].id,
  rowRef: fixtures[key].slug,
  fieldType: fixtures[key].fieldType,
  onIntakeForm: intake,
  isRequired: required,
  visibleOnPortal: true,
});
async function type(key, displayName, shape) {
  let row = types.find((t) => t.displayName === displayName);
  if (!row)
    row = must(await api(page, "POST", "/matter-types", { displayName }), displayName).matterType;
  const current = must(await api(page, "GET", `/matter-types/${row.id}/form`), "form").form;
  const pins = current.slice(0, 2);
  const builtin = Object.fromEntries(
    current.filter((n) => n.kind === "row" && n.id === n.rowRef).map((n) => [n.rowRef, n]),
  );
  const form = [...pins, ...shape(builtin)];
  must(await api(page, "PUT", `/matter-types/${row.id}/form`, { form }), `${displayName} form`);
  const saved = must(await api(page, "GET", `/matter-types/${row.id}/form`), "form").form;
  fixtures[key] = {
    id: row.id,
    displayName,
    form: saved.map((n) => ({
      rowRef: n.rowRef,
      onIntakeForm: n.onIntakeForm,
      isRequired: n.isRequired,
    })),
  };
}
const b = (builtin, k, over = {}) => ({ ...builtin[k], ...over });
await type("typeMain", "DOC-030 matters type", (bi) => [
  b(bi, "description", { onIntakeForm: true }),
  b(bi, "department", { onIntakeForm: true }),
  b(bi, "priority", { onIntakeForm: true }),
  b(bi, "risk", { onIntakeForm: true }),
  b(bi, "needed_by", { onIntakeForm: true }),
  b(bi, "region", { onIntakeForm: false, isRequired: false }),
  fieldRow("fieldRequired", { required: true }),
  fieldRow("fieldOptional", { intake: true }),
  fieldRow("fieldEntity", { intake: true }),
  fieldRow("fieldPerson", { intake: true }),
]);
await type("typeRetype", "DOC-030 matters retype", (bi) => [
  ...["description", "department", "region", "priority", "risk", "needed_by"].map((k) =>
    b(bi, k, { onIntakeForm: k === "description", isRequired: false }),
  ),
  fieldRow("fieldRequired", { required: true }),
  fieldRow("fieldNumber", { required: true }),
]);
await type("typeDept", "DOC-030 matters department required", (bi) => [
  ...["description", "department", "region", "priority", "risk", "needed_by"].map((k) =>
    b(bi, k, { onIntakeForm: k === "description", isRequired: k === "department" }),
  ),
]);

const templates = must(
  await api(page, "GET", "/matter-templates?includeArchived=true"),
  "templates",
).matterTemplates;
async function template(key, typeKey, spec) {
  const typeId = fixtures[typeKey].id;
  let row = templates.find((t) => t.name === spec.name && t.matterTypeId === typeId);
  if (!row)
    row = must(
      await api(page, "POST", "/matter-templates", {
        matterTypeId: typeId,
        name: spec.name,
        description: spec.description,
        defaultPriority: spec.priority,
        defaultRisk: spec.risk,
        titlePrefix: spec.titlePrefix,
      }),
      spec.name,
    ).matterTemplate;
  if (row.archivedAt)
    must(await api(page, "POST", `/matter-templates/${row.id}/restore`), "restore");
  must(await api(page, "PUT", `/matter-templates/${row.id}/tasks`, { tasks: spec.tasks }), "tasks");
  must(
    await api(page, "PUT", `/matter-templates/${row.id}/key-dates`, { keyDates: spec.keyDates }),
    "dates",
  );
  must(
    await api(page, "PUT", `/matter-templates/${row.id}/custom-fields`, {
      defaultCustomFields: spec.defaults,
    }),
    "defaults",
  );
  fixtures[key] = { id: row.id, name: spec.name, titlePrefix: spec.titlePrefix };
}
const req = () => fixtures.fieldRequired.slug;
const opt = () => fixtures.fieldOptional.slug;
await template("templateAlpha", "typeMain", {
  name: "DOC-030 matters alpha playbook",
  description: "Fictional review plan for the walkthrough.",
  priority: "high",
  risk: "critical",
  titlePrefix: "DOC-030 alpha review -",
  tasks: [
    { title: "DOC-030 alpha evidence review", dueOffsetDays: 3, assigneeRole: "matter_manager" },
    { title: "DOC-030 alpha discussion", dueOffsetDays: null, assigneeRole: "none" },
  ],
  keyDates: [
    { label: "DOC-030 alpha kickoff", offsetDays: 0, note: null },
    { label: "DOC-030 alpha filing", offsetDays: 7, note: "Fictional filing window." },
  ],
  defaults: { [req()]: "Alpha required default", [opt()]: "Alpha optional default" },
});
await template("templateBeta", "typeMain", {
  name: "DOC-030 matters beta playbook",
  description: "Second fictional plan.",
  priority: "low",
  risk: "low",
  titlePrefix: "DOC-030 beta review -",
  tasks: [{ title: "DOC-030 beta check", dueOffsetDays: 5, assigneeRole: "none" }],
  keyDates: [{ label: "DOC-030 beta date", offsetDays: 10, note: null }],
  defaults: { [opt()]: "Beta optional default" },
});
await template("templateGamma", "typeMain", {
  name: "DOC-030 matters gamma playbook",
  description: "Archived during the walkthrough to test a stale selection.",
  priority: "medium",
  risk: "medium",
  titlePrefix: "DOC-030 gamma review -",
  tasks: [],
  keyDates: [],
  defaults: {},
});
await template("templateUndrawn", "typeRetype", {
  name: "DOC-030 matters undrawn defaults playbook",
  description: "Sets Priority and Risk on a type whose Form does not collect them at creation.",
  priority: "high",
  risk: "low",
  titlePrefix: "DOC-030 undrawn -",
  tasks: [],
  keyDates: [],
  defaults: { [req()]: "Undrawn required default" },
});

const entities = must(await api(page, "GET", "/entities"), "entities").entities;
const entity = entities.find(
  (e) => e.legalName.startsWith("Helix") && !e.isConfidential && !e.archivedAt,
);
fixtures.entity = { id: entity.id, legalName: entity.legalName };
const docTypes = must(
  await api(page, "GET", "/documents/type-options?module=matter"),
  "document types",
).documentTypes;
fixtures.matterDocumentTypes = docTypes.map((d) => d.displayName);
fixtures.createdAt = fixtures.createdAt ?? new Date().toISOString();
writeFileSync(OUT, JSON.stringify(fixtures, null, 2) + "\n");
console.log(JSON.stringify(fixtures, null, 2));
await browser.close();
