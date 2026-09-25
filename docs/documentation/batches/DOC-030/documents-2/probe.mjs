// Probe helper for the DOC-030 documents-2 walkthrough: reads extracted text of the search fixture.
import { PEOPLE, staffContext, api, close, BASE, sleep } from "./lib.mjs";
const { page } = await staffContext(PEOPLE.nadia);
const r = await api(page, "GET", "/contracts/466/documents");
for (const d of r.body.documents.filter((d) => d.title.includes("repo-search"))) {
  for (const v of d.versions) {
    const t = await api(page, "GET", `/documents/${d.id}/versions/${v.id}/text`);
    console.log(v.versionNumber, t.status, JSON.stringify(t.body).slice(0, 300));
  }
}
for (const w of ["second round", "Fictional supplier note"]) {
  await page.goto(`${BASE}/search?q=${encodeURIComponent(w)}`);
  await page.waitForLoadState("networkidle");
  await sleep(1500);
  console.log(w, "::", (await page.getByRole("main").innerText()).replace(/\s+/g, " ").slice(0, 300));
}
await close();
