// DOC-029r2 portal compatibility replay: fixture preparation through the lab API (adapted from portal/fixtures-r1.mjs).
// Creates only records named "DOC-029r2 portal ..."; changes no organisation settings.
// Writes identifiers to the private state file given in STATE (outside the repository).
import { writeFileSync } from "node:fs";
import * as L from "./lib-r2.mjs";

const STATE = process.env.STATE;
if (!STATE) throw new Error("STATE is required");

import { pdf } from "./pdf-r2.mjs";
const file = (name, marker) => ({ name, mimeType: "application/pdf", buffer: pdf(marker ?? name) });

function must(r, what) {
  if (r.status >= 300)
    throw new Error(`${what}: ${r.status} ${JSON.stringify(r.body).slice(0, 400)}`);
  return r.body;
}

const { page: nadia } = await L.staffContext(L.PEOPLE.nadia);
// Resumable: reuse fixtures an interrupted earlier preparation run already created.
const existingK = (await L.api(nadia, "GET", "/knowledge?limit=100")).body.knowledgeItems.filter(
  (k) => k.title.startsWith("DOC-029r2 portal "),
);
const found = existingK.map((k) => Number(k.title.split(" ").at(-1))).filter(Boolean);
const stamp = found.length ? Math.max(...found) : Date.now();
const state = { stamp, knowledge: {} };

// Knowledge fixtures
const listed = must(
  await L.api(nadia, "GET", "/knowledge?limit=100"),
  "knowledge list",
).knowledgeItems;
const article = { id: listed.find((k) => k.knowledgeTypeName === "Article").knowledgeTypeId };
async function knowledge(key, { audience, publish, archive, docs, body }) {
  const title = `DOC-029r2 portal ${key} ${stamp}`;
  const prior = existingK.find((k) => k.title === title);
  if (prior) {
    const detail = (
      await L.api(nadia, "GET", `/documents?ownerType=knowledge_item&ownerId=${prior.id}`)
    ).body;
    state.knowledge[key] = {
      id: prior.id,
      title,
      docs: docs.map((name) => ({ name })),
      reused: true,
    };
    return;
  }
  const item = must(
    await L.api(nadia, "POST", "/knowledge", { title, knowledgeTypeId: article.id }),
    `create ${key}`,
  ).knowledgeItem;
  const uploaded = [];
  for (const name of docs) {
    const d = must(
      await L.api(nadia, "POST", `/knowledge/${item.id}/documents`, undefined, {
        file: file(name),
      }),
      `upload ${name}`,
    ).document;
    uploaded.push({ id: d.id, name });
    await new Promise((r) => setTimeout(r, 1100));
  }
  const patch = { audience };
  if (body) patch.body = body;
  if (uploaded.length) patch.primaryDocumentId = uploaded.at(-1).id;
  must(await L.api(nadia, "PATCH", `/knowledge/${item.id}`, patch), `patch ${key}`);
  if (publish)
    must(await L.api(nadia, "POST", `/knowledge/${item.id}/publish`, {}), `publish ${key}`);
  if (archive)
    must(await L.api(nadia, "POST", `/knowledge/${item.id}/archive`, {}), `archive ${key}`);
  state.knowledge[key] = { id: item.id, title, docs: uploaded };
}
await knowledge("guidance", {
  audience: "everyone",
  publish: true,
  docs: [`doc029-supporting-${stamp}.pdf`, `doc029-primary-${stamp}.pdf`],
  body: "Read this DOC-029r2 portal guidance before you ask Legal for a review.\n\nSend the latest draft with your Request.",
});
await knowledge("restricted", {
  audience: "legal_only",
  publish: true,
  docs: [`doc029-restricted-${stamp}.pdf`],
});
await knowledge("draft", {
  audience: "everyone",
  publish: false,
  docs: [`doc029-draft-${stamp}.pdf`],
});
await knowledge("archived", {
  audience: "everyone",
  publish: true,
  archive: true,
  docs: [`doc029-archived-${stamp}.pdf`],
});

writeFileSync(STATE, JSON.stringify(state, null, 2));
console.log(JSON.stringify(state, null, 2));
await L.close();
