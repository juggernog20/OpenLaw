// DOC-029 inbox round 1: fictional Requests submitted by Jonas Weber through the Portal API.
// Each Request is named "DOC-029 inbox <role> <purpose> <stamp>". After submission the
// "Old Holdings" Entity is archived, so the conversion Requests carry an archived reference.
// Run: LAB_PASSWORD=... mise exec -- node docs/documentation/batches/DOC-029/inbox/setup-requests-r1.mjs [purposes...]
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Session } from "../../../../../scripts/seed/client.mjs";
import { makeDocx, makePdf, MEDIA_TYPES } from "../../../../../scripts/seed/files.mjs";
import { apiSignIn, BASE, freshMagicLink, PEOPLE } from "./api.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const fx = JSON.parse(readFileSync(path.join(here, "fixtures-r1.json"), "utf8"));
const outPath = path.join(here, "requests-r1.json");
const existing = existsSync(outPath) ? JSON.parse(readFileSync(outPath, "utf8")) : { requests: {} };
const stamp = Date.now().toString().slice(-6);

async function jonasSession() {
  for (let attempt = 1; attempt <= 4; attempt++) {
    const link = await freshMagicLink(PEOPLE.business_user.email);
    const s = new Session("jonas", BASE);
    const r = await s.request("GET", link, { expect: [200, 302, 303, 307] });
    const me = await s.request("GET", "/api/v1/me", { expect: [200, 401] });
    if (me.status === 200) return s;
    await new Promise((res) => setTimeout(res, 2000 * attempt));
  }
  throw new Error("Jonas could not sign in");
}

const jonas = await jonasSession();
if (process.argv.slice(2).length === 0 || process.argv.slice(2).some((p) => ["conv-contract", "conv-matter"].includes(p))) {
  // The Entity must be live and Portal-listed while Jonas submits; it is archived again below.
  const admin = await apiSignIn(PEOPLE.administrator.email);
  await admin.request("POST", `/api/v1/entities/${fx.entities.old.id}/restore`, { json: {}, expect: [200, 204, 409] });
  await admin.request("PATCH", `/api/v1/entities/${fx.entities.old.id}`, { json: { portalListed: true }, expect: [200, 409] });
}
const onboarding = (await jonas.get("/api/v1/portal/onboarding")).body;
const departmentId = onboarding.departmentId ?? fx.departments[0].id;

const PURPOSES = {
  "triage-review": { module: "contract", urgency: "high", files: ["pdf", "docx"] },
  "triage-resolve": { module: "contract", urgency: "medium", files: ["pdf"] },
  "triage-race": { module: "matter", urgency: "low", files: [] },
  "conv-contract": { module: "contract", urgency: "high", files: ["pdf", "pdf"], entity: true },
  "conv-matter": { module: "matter", urgency: "high", files: ["pdf", "pdf"], entity: true },
  "conv-retarget": { module: "contract", urgency: "medium", files: [] },
  "conv-race": { module: "contract", urgency: "medium", files: [] },
  "conv-stale": { module: "matter", urgency: "low", files: [] },
};
const wanted = process.argv.slice(2).length ? process.argv.slice(2) : Object.keys(PURPOSES);
const roles = { administrator: "Admin", legal_team_member: "Member" };

for (const [role, label] of Object.entries(roles)) {
  for (const purpose of wanted) {
    const spec = PURPOSES[purpose];
    const rt = fx.requestTypes[spec.module];
    const title = `DOC-029 inbox ${label} ${purpose} ${stamp}`;
    const customFields = {
      [fx.fields.carry.slug]: `Northwind Fictional Supplies ${label}`,
      [fx.fields.stay.slug]: `Budget note stays on the Request ${label}`,
    };
    if (spec.entity) customFields[fx.fields.entity.slug] = fx.entities.old.id;
    const { body } = await jonas.post("/api/v1/requests", {
      requestTypeId: rt.id,
      departmentId,
      title,
      description: `Fictional description for ${title}. Please prepare the paperwork.`,
      urgency: spec.urgency,
      customFields,
    });
    const request = body.request;
    const files = [];
    let i = 0;
    for (const format of spec.files) {
      i += 1;
      const name = `doc029-inbox-${label.toLowerCase()}-${purpose}-${i}.${format}`;
      const data =
        format === "pdf"
          ? makePdf(`${title} attachment ${i}`, [`Fictional attachment ${i} for ${title}.`, "No real parties are named."])
          : makeDocx(`${title} attachment ${i}`, [`Fictional Word attachment ${i} for ${title}.`]);
      const form = new FormData();
      form.append("file", new File([data], name, { type: MEDIA_TYPES[format] }));
      await jonas.upload(`/api/v1/requests/${request.number}/attachments`, form);
      files.push({ name, bytes: data.length });
    }
    existing.requests[`${role}:${purpose}`] = {
      number: request.number,
      reference: `R-${request.number}`,
      id: request.id,
      title,
      module: spec.module,
      urgency: spec.urgency,
      files,
      carriesArchivedEntity: Boolean(spec.entity),
      createdAt: new Date().toISOString(),
    };
    console.log(role, purpose, `R-${request.number}`);
  }
}

// Archive the Entity the conversion Requests carry.
if (wanted.some((p) => PURPOSES[p].entity)) {
  const admin = await apiSignIn(PEOPLE.administrator.email);
  const r = await admin.request("POST", `/api/v1/entities/${fx.entities.old.id}/archive`, {
    json: {},
    expect: [200, 204, 409],
  });
  existing.oldEntityArchive = { status: r.status, at: new Date().toISOString() };
}
existing.departmentId = departmentId;
writeFileSync(outPath, JSON.stringify(existing, null, 2));
