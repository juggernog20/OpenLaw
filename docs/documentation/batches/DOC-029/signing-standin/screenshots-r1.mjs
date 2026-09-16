// DOC-029 signing-standin round 1: a read-only screenshot of one walked record's Envelope history.
// Run from the repository root:
//   LAB_PASSWORD=... CONTRACT=<number> mise exec -- node docs/documentation/batches/DOC-029/signing-standin/screenshots-r1.mjs
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "../../../../..");
const require = createRequire(path.join(root, "e2e/package.json"));
const { chromium } = require("@playwright/test");
const lab = JSON.parse(readFileSync(path.join(root, ".documentation-labs/sign-r1/lab.json"), "utf8"));
const BASE = lab.appUrl;
const number = process.env.CONTRACT;

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1280, height: 1800 } });
const page = await context.newPage();
await page.goto(`${BASE}/auth/login`);
await page.getByLabel("Email").fill("nadia.haddad@helix.example");
await page.getByLabel("Password").fill(process.env.LAB_PASSWORD);
await page.getByRole("button", { name: "Sign in", exact: true }).click();
await page.waitForURL((u) => !u.pathname.startsWith("/auth"));
await page.goto(`${BASE}/contracts/${number}/approvals`);
const card = page.getByRole("region", { name: "Approvals & signing" });
await card.waitFor();
await page.waitForLoadState("networkidle").catch(() => {});
await card.screenshot({ path: path.join(here, "r1-envelope-history.png") });
await browser.close();
