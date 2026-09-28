// DOC-032 bridge compatibility replay: copy of
// docs/documentation/batches/DOC-032/compat/compat-a/portal-replay/fixtures.mjs for the replay of
// follow-request on the lab final (release candidate ad345da5). What changed, and nothing else:
// record names "DOC-032 compat compat-a" became "DOC-032 bridge"; the fixture Branch id and the Before
// you submit link URL use "doc032-bridge-" instead of "doc032-compat-a-". The STATE file is fresh for final.
// Run from the worktree root (STATE under ~/.cache or /tmp, never in the worktree):
//   LAB_PASSWORD=... STATE=<private state file> pasta --config-net -T 43390,48490 -- \
//     node docs/documentation/batches/DOC-032/bridge/portal-replay/fixtures.mjs
// compat-a header, unchanged:
// > DOC-032 compatibility replay (set compat-a): copy of docs/documentation/batches/DOC-030/portal/fixtures.mjs
// > for the replay of submit-request and follow-request on the DOC-032 `work` lab at 4ca41822.
// > What changed against the DOC-030 file, and nothing else:
// > - record names start "DOC-032 compat compat-a" instead of "DOC-030 portal";
// > - the fixture Branch id and the Before you submit link URL use "doc032-compat-a-" instead of "doc030-";
// > - the run command below names this copy.
// > Run from the worktree root (STATE under ~/.cache or /tmp, never in the worktree):
// >   LAB_PASSWORD=... STATE=<private state file> \
// >     node docs/documentation/batches/DOC-032/compat/compat-a/portal-replay/fixtures.mjs
// > The Administrator is still Daniel Okafor (unchanged in VALIDATION.md).
// > Original DOC-030 header follows.
// > DOC-030 portal walkthrough: fixture preparation through the lab API, as Daniel Okafor (Administrator).
// > Creates only records named "DOC-030 portal ..." (here "DOC-032 compat compat-a ..."). It changes no seeded record and no organization setting.
// > It creates: one Portal-listed Entity, two contract-scoped catalog Fields (a required text question and a
// > person question) plus an optional text Field under the Branch, one Contract type with its own Form
// > (Description required, a Term type Branch that shows a required Expiry date and the optional Field), one
// > request type that targets it, and one type-specific Before you submit link.
// > Resumable: when STATE already names a record, the script reuses it and creates only what is missing.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import * as L from "./lib.mjs";

const STATE = process.env.STATE;
if (!STATE) throw new Error("STATE is required");
const prior = existsSync(STATE) ? JSON.parse(readFileSync(STATE, "utf8")) : {};
const stamp = prior.stamp ?? Date.now();
const name = (what) => `DOC-032 bridge ${what} ${stamp}`;

function must(r, what) {
  if (r.status >= 300)
    throw new Error(`${what}: ${r.status} ${JSON.stringify(r.body).slice(0, 400)}`);
  return r.body;
}

const { page: daniel } = await L.staffContext(L.PEOPLE.daniel);
const state = { ...prior, stamp };

// A Portal-listed Entity for the Our entity question.
if (!state.entity) {
  const types = must(await L.api(daniel, "GET", "/entities/types"), "entity types");
  const entityType = (types.entityTypes ?? types.types ?? Object.values(types)[0]).find(
    (t) => !t.archivedAt,
  );
  const entity = must(
    await L.api(daniel, "POST", "/entities", {
      legalName: name("Evaluation Holdings Ltd"),
      entityTypeId: entityType.id,
      portalListed: true,
    }),
    "entity",
  ).entity;
  state.entity = { id: entity.id, name: entity.legalName };
}

// Catalog Fields for the destination Form.
async function field(key, displayName, fieldType) {
  state.fields ??= {};
  if (state.fields[key]) return state.fields[key];
  const f = must(
    await L.api(daniel, "POST", "/fields", { displayName, moduleScope: "contract", fieldType }),
    `${key} field`,
  ).field;
  state.fields[key] = { id: f.id, slug: f.slug, name: f.displayName };
  return state.fields[key];
}
const reason = await field("reason", name("Business reason"), "text");
const reviewer = await field("reviewer", name("Business reviewer"), "user");
const fixedNote = await field("fixedNote", name("Fixed-term note"), "text");

// Destination Contract type and its Form.
if (!state.contractType) {
  const ctype = must(
    await L.api(daniel, "POST", "/contract-types", { displayName: name("Evaluation") }),
    "contract type",
  );
  const contractType = ctype.contractType ?? ctype.type ?? ctype;
  state.contractType = { id: contractType.id, name: contractType.displayName };
}
const contractType = state.contractType;
const seeded = must(
  await L.api(daniel, "GET", `/contract-types/${contractType.id}/form`),
  "seeded form",
).form;
const flat = (nodes) => nodes.flatMap((n) => (n.kind === "branch" ? flat(n.children) : [n]));
const byRef = Object.fromEntries(flat(seeded).map((n) => [n.rowRef, n]));
const on = (ref, isRequired = false) => ({ ...byRef[ref], onIntakeForm: true, isRequired });
const off = (ref) => ({ ...byRef[ref], onIntakeForm: false, isRequired: false });
const custom = (f, fieldType, isRequired) => ({
  kind: "row",
  id: f.id,
  rowRef: f.slug,
  fieldType,
  onIntakeForm: true,
  isRequired,
  visibleOnPortal: true,
});
function formFor({ departmentRowOnIntake }) {
  return [
    byRef.title,
    byRef.contract_type,
    on("description", true),
    on("counterparties"),
    on("entity"),
    on("term_type"),
    {
      kind: "branch",
      id: "doc032-bridge-term-fixed",
      match: "all",
      conditions: [{ rowRef: "term_type", operator: "equals", value: "fixed" }],
      children: [on("expiry_date", true), custom(fixedNote, "text", false)],
    },
    on("value"),
    custom(reason, "text", true),
    custom(reviewer, "user", false),
    departmentRowOnIntake ? on("owning_department") : off("owning_department"),
    off("region"),
    off("priority"),
    off("risk"),
    off("effective_date"),
    off("renewal_period_months"),
    off("notice_period_days"),
    off("needed_by"),
  ];
}
must(
  await L.api(daniel, "PUT", `/contract-types/${contractType.id}/form`, {
    form: formFor({ departmentRowOnIntake: false }),
  }),
  "put form",
);
state.form = formFor({ departmentRowOnIntake: false });
state.formWithDepartment = formFor({ departmentRowOnIntake: true });

// Request type that targets the Contract type.
if (!state.requestType) {
  const rt = must(
    await L.api(daniel, "POST", "/request-types", { displayName: name("Evaluation review") }),
    "request type",
  ).requestType;
  must(
    await L.api(daniel, "PATCH", `/request-types/${rt.id}`, {
      targetModule: "contract",
      targetTypeId: contractType.id,
    }),
    "target",
  );
  state.requestType = { id: rt.id, slug: rt.slug, name: rt.displayName };
}
const rt = state.requestType;

// Type-specific Before you submit link.
if (!state.intakeLink) {
  const link = must(
    await L.api(daniel, "POST", "/intake-links", {
      label: name("evaluation checklist"),
      url: "https://example.com/doc032-bridge-evaluation-checklist",
      requestTypeId: rt.id,
    }),
    "intake link",
  ).intakeLink;
  state.intakeLink = { id: link.id, label: link.label };
}

writeFileSync(STATE, JSON.stringify(state, null, 2));
console.log(JSON.stringify(state, null, 2));
await L.close();
