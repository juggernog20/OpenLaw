// DOC-030 inbox: fictional Requests submitted through the Portal API.
// Administrator-role scenarios use Requests from Jonas Weber; Legal Team Member scenarios use
// Requests from Amara Nwosu, so neither Business User passes the 20-per-hour submission limit.
// Each Request is named "DOC-030 inbox <role> <purpose> <stamp>". After submission the
// "Old Holdings" Entity is archived, so the conversion Requests carry an archived reference.
// Run: LAB_PASSWORD=... node docs/documentation/batches/DOC-030/inbox/setup-requests.mjs [purposes...]
// Env: FIXTURES, REQUESTS (paths), ROLES=administrator,legal_team_member.
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Session } from "../../../../../scripts/seed/client.mjs";
import { makeDocx, makePdf, MEDIA_TYPES } from "../../../../../scripts/seed/files.mjs";
import { apiSignIn, BASE, freshMagicLink, PEOPLE } from "./api.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const fx = JSON.parse(
  readFileSync(process.env.FIXTURES ?? path.join(here, "fixtures.json"), "utf8"),
);
const outPath = process.env.REQUESTS ?? path.join(here, "requests.json");
const existing = existsSync(outPath) ? JSON.parse(readFileSync(outPath, "utf8")) : { requests: {} };
const stamp = Date.now().toString().slice(-6);
const ROLES = (process.env.ROLES ?? "administrator,legal_team_member").split(",");
const [adminRequester, memberRequester] = (
  process.env.REQUESTERS ?? "business_user,second_business_user"
).split(",");
const REQUESTER = { administrator: adminRequester, legal_team_member: memberRequester };

async function portalSession(key) {
  for (let attempt = 1; attempt <= 4; attempt++) {
    const link = await freshMagicLink(PEOPLE[key].email);
    const s = new Session(key, BASE);
    await s.request("GET", link, { expect: [200, 302, 303, 307] });
    const me = await s.request("GET", "/api/v1/me", { expect: [200, 401] });
    if (me.status === 200) return s;
    await new Promise((res) => setTimeout(res, 2000 * attempt));
  }
  throw new Error(`${key} could not sign in`);
}

const PURPOSES = {
  "triage-review": { module: "contract", urgency: "high", files: ["pdf", "docx"] },
  "triage-resolve": { module: "contract", urgency: "medium", files: ["pdf"] },
  "triage-race": { module: "matter", urgency: "low", files: [] },
  "conv-contract": {
    module: "contract",
    urgency: "high",
    files: ["pdf", "pdf"],
    entity: true,
    neededBy: 20,
  },
  "conv-matter": { module: "matter", urgency: "high", files: ["pdf", "pdf"], entity: true },
  "conv-retarget": { module: "contract", urgency: "medium", files: [] },
  "conv-race": { module: "contract", urgency: "medium", files: [] },
  "conv-stale": { module: "matter", urgency: "low", files: [] },
  // Only on the separate inboxai lab, where a local provider stand-in answers.
  "ai-matter": { module: "matter", urgency: "medium", files: ["pdf", "broken"], ai: true },
  "ai-matter-edit": { module: "matter", urgency: "medium", files: [], ai: true },
  "ai-contract": { module: "contract", urgency: "medium", files: ["pdf"], ai: true },
  "ai-contract-fail": { module: "contract", urgency: "medium", files: ["pdf"], ai: true },
};
const AI_PURPOSES = Object.keys(PURPOSES).filter((p) => PURPOSES[p].ai);
const argv = process.argv.slice(2);
const wanted =
  argv[0] === "ai"
    ? AI_PURPOSES
    : argv.length
      ? argv
      : Object.keys(PURPOSES).filter((p) => !PURPOSES[p].ai);
if (wanted.some((p) => PURPOSES[p].ai) && !BASE.endsWith(":43340"))
  throw new Error("AI Requests belong on the inboxai lab only.");
const labels = { administrator: "Admin", legal_team_member: "Member" };
const admin = await apiSignIn(PEOPLE.administrator.email);

if (wanted.some((p) => PURPOSES[p].entity)) {
  // The Entity must be live and Portal-listed while the Requester submits; it is archived below.
  await admin.request("POST", `/api/v1/entities/${fx.entities.old.id}/restore`, {
    json: {},
    expect: [200, 204, 409],
  });
  await admin.request("PATCH", `/api/v1/entities/${fx.entities.old.id}`, {
    json: { portalListed: true },
    expect: [200, 409],
  });
}

for (const role of ROLES) {
  const label = labels[role];
  const requesterKey = REQUESTER[role];
  const requester = await portalSession(requesterKey);
  const onboarding = (await requester.get("/api/v1/portal/onboarding")).body;
  const departmentId = onboarding.departmentId ?? fx.departments[0].id;
  for (const purpose of wanted) {
    const spec = PURPOSES[purpose];
    const rt = fx.requestTypes[spec.module];
    const title = `DOC-030 inbox ${label} ${purpose} ${stamp}`;
    // AI Requests carry fixed fictional facts the stand-in quotes back as evidence.
    const description = spec.ai
      ? spec.module === "matter"
        ? `Fictional description for ${title}. Advisory support for onboarding a new supplier. Engagement summary: Quarterly advisory retainer for supplier onboarding. Cost centre MC-AI-4411. The work sits in the North region.`
        : `Fictional description for ${title}. Contract summary: Two-year supply of fictional widgets. Cost centre CC-AI-9911. Risk is medium.`
      : `Fictional description for ${title}. Please prepare the paperwork.`;
    const F = fx.fields;
    const customFields = {};
    const body = { requestTypeId: rt.id, departmentId, title, urgency: spec.urgency };
    if (spec.module === "contract") {
      customFields[F.carry.slug] = `Northwind Fictional Supplies ${label}`;
      customFields[F.stay.slug] = `Budget note stays on the Request ${label}`;
      customFields.description = description;
      if (spec.entity) customFields[F.entity.slug] = fx.entities.old.id;
      body.counterparties = [{ name: `DOC-030 inbox Fictional Counterparty ${label} ${stamp}` }];
    } else {
      customFields[F.mCarry.slug] = `Fictional Adviser ${label}`;
      body.description = description;
      if (spec.entity) customFields[F.mEntity.slug] = fx.entities.old.id;
    }
    if (spec.neededBy)
      customFields.needed_by = new Date(Date.now() + spec.neededBy * 86400000)
        .toISOString()
        .slice(0, 10);
    body.customFields = customFields;
    const { body: created } = await requester.post("/api/v1/requests", body);
    const request = created.request;
    const files = [];
    let i = 0;
    for (const format of spec.files) {
      i += 1;
      const name = `doc030-inbox-${label.toLowerCase()}-${purpose}-${i}.${format === "broken" ? "pdf" : format}`;
      const data =
        format === "broken"
          ? Buffer.from("%PDF-1.4\nThis fictional file is intentionally not a readable PDF.\n")
          : format === "pdf"
            ? makePdf(`${title} attachment ${i}`, [
                `Fictional attachment ${i} for ${title}.`,
                "No real parties are named.",
              ])
            : makeDocx(`${title} attachment ${i}`, [
                `Fictional Word attachment ${i} for ${title}.`,
              ]);
      const form = new FormData();
      form.append(
        "file",
        new File([data], name, { type: MEDIA_TYPES[format === "broken" ? "pdf" : format] }),
      );
      await requester.upload(`/api/v1/requests/${request.number}/attachments`, form);
      files.push({ name, bytes: data.length });
    }
    existing.requests[`${role}:${purpose}`] = {
      number: request.number,
      reference: `R-${request.number}`,
      id: request.id,
      title,
      requester: requesterKey,
      module: spec.module,
      urgency: spec.urgency,
      neededBy: customFields.needed_by ?? null,
      files,
      carriesArchivedEntity: Boolean(spec.entity),
      createdAt: new Date().toISOString(),
    };
    console.log(role, purpose, `R-${request.number}`);
  }
}

if (wanted.some((p) => PURPOSES[p].entity)) {
  const r = await admin.request("POST", `/api/v1/entities/${fx.entities.old.id}/archive`, {
    json: {},
    expect: [200, 204, 409],
  });
  existing.oldEntityArchive = { status: r.status, at: new Date().toISOString() };
}
writeFileSync(outPath, JSON.stringify(existing, null, 2));
