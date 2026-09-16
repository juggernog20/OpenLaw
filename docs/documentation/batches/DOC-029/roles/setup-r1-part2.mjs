// Second fixture pass for the DOC-029 roles walkthrough (round 1): the Portal paging and Contributor-guide records.
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium, passwordSignIn, api, BASE } from "./lib-r1.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(here, "fixtures-r1.json");
const fx = JSON.parse(readFileSync(OUT, "utf8"));
const must = (r, what) => {
  if (r.status >= 300)
    throw new Error(`${what}: ${r.status} ${JSON.stringify(r.json).slice(0, 300)}`);
  return r.json;
};
async function upload(page, module, number, name, text) {
  const res = await page.request.post(`${BASE}/api/v1/${module}/${number}/documents`, {
    headers: { origin: BASE },
    multipart: { file: { name, mimeType: "text/plain", buffer: Buffer.from(text) } },
    failOnStatusCode: false,
  });
  const json = await res.json().catch(() => null);
  if (res.status() >= 300)
    throw new Error(`upload ${name}: ${res.status()} ${JSON.stringify(json).slice(0, 300)}`);
  return json.document;
}
const browser = await chromium.launch();
// Reuse a record from an interrupted earlier pass instead of creating a second copy.
async function matterFor(page, body) {
  const found = must(
    await api(page, "GET", `/matters?q=${encodeURIComponent(body.title)}`),
    "find",
  ).matters.find((m) => m.title === body.title);
  if (found) return found;
  return must(await api(page, "POST", "/matters", body), body.title).matter;
}
const n = await passwordSignIn(browser, "nadia.haddad@helix.example");
const d = await passwordSignIn(browser, "daniel.okafor@helix.example");
const mtypes = must(await api(d.page, "GET", "/matter-types"), "mtypes").matterTypes;
const depts = must(await api(d.page, "GET", "/departments"), "depts").departments;
const commercial = mtypes.find((t) => t.displayName === "Commercial").id;
const sales = depts.find((t) => t.displayName === "Sales").id;

const mr = await matterFor(n.page, {
  title: "DOC-029 roles Ravi matter",
  matterTypeId: commercial,
  managerId: fx.ids.nadia,
  departmentId: sales,
  region: "EMEA",
  description: "DOC-029 roles fictional Matter description.",
});
fx.raviMatter = { number: mr.number, id: mr.id };

fx.pagingMatters = [];
for (let i = 1; i <= 25; i++) {
  const m = await matterFor(n.page, {
    title: `DOC-029 roles paging matter ${String(i).padStart(2, "0")}`,
    matterTypeId: commercial,
    managerId: fx.ids.nadia,
  });
  const added = await api(n.page, "POST", `/matters/${m.number}/team`, { userId: fx.ids.ravi });
  if (added.status >= 300 && added.status !== 409) must(added, `paging team ${i}`);
  fx.pagingMatters.push({ number: m.number, id: m.id });
}
// Ravi's document paging Matter: 51 Documents so the Documents list pages.
const dm = must(
  await api(n.page, "POST", "/matters", {
    title: "DOC-029 roles document paging matter",
    matterTypeId: commercial,
    managerId: fx.ids.nadia,
  }),
  "DM",
).matter;
must(await api(n.page, "POST", `/matters/${dm.number}/team`, { userId: fx.ids.ravi }), "DM team");
fx.docPagingMatter = { number: dm.number, id: dm.id };
for (let i = 1; i <= 51; i++)
  await upload(
    n.page,
    "matters",
    dm.number,
    `doc029-roles-page-${String(i).padStart(2, "0")}.txt`,
    `DOC-029 roles fictional paging paper ${i}.\n`,
  );

// Primary Document on Ravi's converted Contract, uploaded by Legal.
const primary = await upload(
  n.page,
  "contracts",
  fx.raviRequest.converted.convertedRecord.number,
  "doc029-roles-supporting-v1.txt",
  readFileSync(path.join(here, "fixtures", "doc029-roles-supporting-v1.txt"), "utf8"),
);
fx.raviPrimary = { id: primary.id, v1: primary.versions[0].id };
writeFileSync(OUT, JSON.stringify(fx, null, 2));
console.log(
  JSON.stringify({
    raviMatter: fx.raviMatter,
    dm: fx.docPagingMatter,
    paging: fx.pagingMatters.map((m) => m.number),
    primary: fx.raviPrimary,
  }),
);
await browser.close();
