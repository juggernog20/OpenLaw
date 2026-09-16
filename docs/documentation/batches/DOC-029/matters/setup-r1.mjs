// Fixture setup for the DOC-029 matters independent walkthrough (round 1).
// Adds DOC-029-named Fields, two Matter types and three Matter templates through the
// Administrator API. It changes no existing setting; teardown-r1.mjs archives what it added.
// Run from the repository root: LAB_PASSWORD=... node docs/documentation/batches/DOC-029/matters/setup-r1.mjs
import { writeFileSync, existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium, passwordSignIn, api } from "./lib-r1.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(here, "fixtures-r1.json");
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
  fixtures[key] = { id: row.id, slug: row.slug, displayName };
  return row;
}
await field("fieldRequired", "DOC-029 matters required note", "text", "legal");
await field("fieldOptional", "DOC-029 matters optional note", "text", "business");
await field("fieldEntity", "DOC-029 matters Entity", "entity", "business");
await field("fieldPerson", "DOC-029 matters person", "user", "business");
await field("fieldNumber", "DOC-029 matters retype number", "number", "business");

const types = must(
  await api(page, "GET", "/matter-types?includeArchived=true"),
  "types",
).matterTypes;
async function type(key, displayName, attach) {
  let row = types.find((t) => t.displayName === displayName);
  if (!row)
    row = must(await api(page, "POST", "/matter-types", { displayName }), displayName).matterType;
  const attached = must(
    await api(page, "GET", `/matter-types/${row.id}/fields`),
    "attached",
  ).attachedFields;
  for (const [fieldKey, isRequired] of attach) {
    const fieldId = fixtures[fieldKey].id;
    if (!attached.some((a) => (a.fieldId ?? a.id) === fieldId))
      must(
        await api(page, "POST", `/matter-types/${row.id}/fields`, { fieldId, isRequired }),
        `attach ${fieldKey}`,
      );
  }
  fixtures[key] = { id: row.id, displayName };
}
await type("typeMain", "DOC-029 matters type", [
  ["fieldRequired", true],
  ["fieldOptional", false],
  ["fieldEntity", false],
  ["fieldPerson", false],
]);
await type("typeRetype", "DOC-029 matters retype", [
  ["fieldRequired", true],
  ["fieldNumber", true],
]);

const templates = must(
  await api(page, "GET", "/matter-templates?includeArchived=true"),
  "templates",
).matterTemplates;
async function template(key, spec) {
  let row = templates.find((t) => t.name === spec.name && t.matterTypeId === fixtures.typeMain.id);
  if (!row)
    row = must(
      await api(page, "POST", "/matter-templates", {
        matterTypeId: fixtures.typeMain.id,
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
await template("templateAlpha", {
  name: "DOC-029 matters alpha playbook",
  description: "Fictional review plan for the walkthrough.",
  priority: "high",
  risk: "critical",
  titlePrefix: "DOC-029 alpha review -",
  tasks: [
    { title: "DOC-029 alpha evidence review", dueOffsetDays: 3, assigneeRole: "matter_manager" },
    { title: "DOC-029 alpha discussion", dueOffsetDays: null, assigneeRole: "none" },
  ],
  keyDates: [
    { label: "DOC-029 alpha kickoff", offsetDays: 0, note: null },
    { label: "DOC-029 alpha filing", offsetDays: 7, note: "Fictional filing window." },
  ],
  defaults: { [req()]: "Alpha required default", [opt()]: "Alpha optional default" },
});
await template("templateBeta", {
  name: "DOC-029 matters beta playbook",
  description: "Second fictional plan.",
  priority: "low",
  risk: "low",
  titlePrefix: "DOC-029 beta review -",
  tasks: [{ title: "DOC-029 beta check", dueOffsetDays: 5, assigneeRole: "none" }],
  keyDates: [{ label: "DOC-029 beta date", offsetDays: 10, note: null }],
  defaults: { [opt()]: "Beta optional default" },
});
await template("templateGamma", {
  name: "DOC-029 matters gamma playbook",
  description: "Archived during the walkthrough to test a stale selection.",
  priority: "medium",
  risk: "medium",
  titlePrefix: "DOC-029 gamma review -",
  tasks: [],
  keyDates: [],
  defaults: {},
});

const entities = must(await api(page, "GET", "/entities"), "entities").entities;
const entity = entities.find(
  (e) => e.legalName.startsWith("Helix") && !e.isConfidential && !e.archivedAt,
);
fixtures.entity = { id: entity.id, legalName: entity.legalName };
fixtures.createdAt = fixtures.createdAt ?? new Date().toISOString();
writeFileSync(OUT, JSON.stringify(fixtures, null, 2) + "\n");
console.log(JSON.stringify(fixtures, null, 2));
await browser.close();
