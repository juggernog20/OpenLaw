// Operator browser check for C42 and C43. Signed out, the operator opens the formal
// documentation reader and follows the deployment-configuration link that both articles
// give for outbound provider access and credential-key retention. Read-only.
// Run: mise exec -- node docs/documentation/batches/DOC-029/live-provider/walkthrough/operator-browser.mjs
import { createRequire } from "node:module";
import { writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
const here = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(path.join(here, "../../../../../../e2e/package.json"));
const { chromium } = require("@playwright/test");
const BASE = "http://127.0.0.1:23314";
const out = { phase: "operator-browser", reviewer: "DOC-029 independent live-provider walkthrough agent", reviewerKind: "agent", appCommit: "3fa407e3a846559914aa1a63249741f30cfb4f69", startedAt: new Date().toISOString(), steps: [] };
const browser = await chromium.launch();
try {
  const page = await (await browser.newContext()).newPage();
  for (const [id, article] of [["OB01", "configure-signing"], ["OB02", "configure-analysis"]]) {
    const entry = { id, article, role: "operator", method: "browser-walkthrough", action: `Signed out, open /documentation/${article}, follow the deployment configuration link, find the provider and key sections` };
    try {
      await page.goto(`${BASE}/documentation/${article}`);
      const link = page.getByRole("link", { name: "deployment configuration" }).first();
      await link.waitFor({ timeout: 20000 });
      await link.click();
      await page.waitForURL(/deployment-configuration/, { timeout: 20000 });
      await page.getByRole("heading", { name: "Preserve and rotate encryption keys" }).waitFor({ timeout: 20000 });
      const body = await page.locator("main").innerText();
      const outbound = body.includes("Allow the required outbound provider traffic from both the app and worker");
      const key = /OPENLAW_SECRET_KEY` encrypts|OPENLAW_SECRET_KEY encrypts/.test(body);
      const heading = await page.getByRole("heading", { name: "Preserve and rotate encryption keys" }).count();
      if (!(outbound && key && heading)) throw new Error(`outbound=${outbound} key=${key} heading=${heading}`);
      entry.actual = `The formal reader opened /documentation/${article}. Its deployment configuration link opened ${new URL(page.url()).pathname}. The page says to allow outbound provider traffic from both the app and worker, and has "Preserve and rotate encryption keys", which says OPENLAW_SECRET_KEY encrypts the Signing RSA key and HMAC secret and the AI-provider key. The reader serves the committed ${article} bytes of 3fa407e3; this check proves the operator link and target, not the reviewed wording.`;
      entry.result = "pass";
    } catch (e) {
      entry.actual = String(e.message).split("\n")[0];
      entry.result = "fail";
    }
    out.steps.push(entry);
    console.log(entry.result, id, entry.actual);
  }
} finally {
  await browser.close();
  out.finishedAt = new Date().toISOString();
  writeFileSync(path.join(here, "operator-browser.json"), `${JSON.stringify(out, null, 2)}\n`);
}
