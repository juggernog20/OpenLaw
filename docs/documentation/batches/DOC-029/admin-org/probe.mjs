// Exploration helper: prints the accessibility tree of a page for one account.
import { chromium, signIn } from "./lib.mjs";
const [base, email, ...paths] = process.argv.slice(2);
const browser = await chromium.launch();
const page = await (await browser.newContext({ viewport: { width: 1440, height: 1000 } })).newPage();
await signIn(page, base, email);
for (const p of paths) {
  await page.goto(`${base}${p}`);
  await page.waitForLoadState("networkidle");
  console.log("=== " + page.url());
  console.log(await page.locator("body").ariaSnapshot());
}
await browser.close();
