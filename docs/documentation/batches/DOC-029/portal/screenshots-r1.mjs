// Focused screenshots for the DOC-029 portal round 1 walkthrough (Business User, fictional records).
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as L from "./lib-r1.mjs";
const here = path.dirname(fileURLToPath(import.meta.url));
const { page } = await L.portalContext(L.PEOPLE.jonas);
await page.goto(`${L.BASE}/portal/requests/${process.env.DECLINED_NUMBER}`);
await page.getByRole("toolbar", { name: "Applets" }).getByRole("button", { name: "Comments" }).click();
await page.getByRole("complementary", { name: "Comments" }).getByRole("list", { name: "Comments" }).waitFor();
await page.waitForTimeout(800);
await page.screenshot({ path: path.join(here, "r1-declined-request-comments.png") });
await page.goto(`${L.BASE}/portal/knowledge/${process.env.GUIDANCE_ID}`);
await page.getByRole("region", { name: "Documents" }).waitFor();
await page.waitForTimeout(500);
await page.screenshot({ path: path.join(here, "r1-knowledge-documents.png") });
await L.close();
