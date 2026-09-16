// Teardown for the DOC-029r2 matters walkthrough (round 1): archives the DOC-029r2 Matter templates,
// Matter types and Fields that setup-r1.mjs added, so the shared lab's live settings return to
// their earlier state. Records created during the walkthrough stay, named "DOC-029r2 matters ...".
// Run from the repository root: LAB_PASSWORD=... node docs/documentation/batches/DOC-029/matters/teardown-r1.mjs
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium, passwordSignIn, api } from "./lib-r1.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const fx = JSON.parse(readFileSync(path.join(here, "fixtures-r1.json"), "utf8"));
const browser = await chromium.launch();
const { page } = await passwordSignIn(browser, "daniel.okafor@helix.example");
const results = [];
for (const key of ["templateAlpha", "templateBeta", "templateGamma"])
  results.push([key, (await api(page, "POST", `/matter-templates/${fx[key].id}/archive`)).status]);
// Earlier results from a first teardown attempt are kept when this reruns.
const earlier = fx.teardown?.results ?? {};
// The DOC-029r2 Matter types are in use only by DOC-029r2 walkthrough Matters; archiving them moves
// those Matters to the protected Other type.
const other = (await api(page, "GET", "/matter-types")).json.matterTypes.find(
  (t) => t.slug === "other",
);
for (const key of ["typeMain", "typeRetype"]) {
  const current = (
    await api(page, "GET", "/matter-types?includeArchived=true")
  ).json.matterTypes.find((t) => t.id === fx[key].id);
  if (current?.archivedAt) {
    results.push([key, "already archived"]);
    continue;
  }
  results.push([
    key,
    (await api(page, "POST", `/matter-types/${fx[key].id}/archive`, { reassignToId: other.id }))
      .status,
  ]);
}
for (const key of ["fieldRequired", "fieldOptional", "fieldEntity", "fieldPerson", "fieldNumber"])
  results.push([key, (await api(page, "POST", `/fields/${fx[key].id}/archive`)).status]);
fx.teardown = { at: new Date().toISOString(), earlier, results: Object.fromEntries(results) };
writeFileSync(path.join(here, "fixtures-r1.json"), JSON.stringify(fx, null, 2) + "\n");
console.log(JSON.stringify(fx.teardown));
await browser.close();
