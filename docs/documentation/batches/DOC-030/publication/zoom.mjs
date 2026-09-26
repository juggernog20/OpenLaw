// Real Chromium browser zoom at 200% for each V-HELP reader. Agent check.
// A disposable profile loads a tabs-permission extension; chrome.tabs.setZoom changes page zoom, not CSS zoom.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import * as L from "./lib.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const extension = join(here, "zoom-extension");
const { step, save } = L.recorder({
  kind: "publication-browser-zoom",
  scenario: "V-HELP",
  task: "DOC-030",
  independentReview: true,
  method: "browser-walkthrough",
  appUrl: L.BASE,
  edition: L.bundle.edition,
  mechanism:
    "Disposable Chromium profile with a tabs-permission extension calling chrome.tabs.setZoom/getZoom.",
});

const READERS = [
  {
    role: "anonymous",
    base: "/documentation",
    id: "backup-and-restore",
    query: "which version",
    setTheme: "select",
  },
  { role: "administrator", base: "/help", id: "request-forms", query: "form target" },
  { role: "legal_team_member", base: "/help", id: "triage-requests", query: "assign request" },
  { role: "business_user", base: "/portal/help", id: "submit-request", query: "submit request" },
];

for (const r of READERS) {
  const profile = mkdtempSync(join(tmpdir(), "doc030-zoom-"));
  const context = await L.chromium.launchPersistentContext(profile, {
    channel: "chromium",
    headless: true,
    viewport: { width: 1280, height: 900 },
    args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`],
  });
  try {
    const guarded = await L.guardedContext({}, context);
    let worker = context.serviceWorkers()[0];
    worker ??= await context.waitForEvent("serviceworker", { timeout: 15000 });
    let page;
    if (r.role === "anonymous") page = await context.newPage();
    else if (r.role === "business_user") page = (await L.portalSession(guarded)).page;
    else page = (await L.staffSession(r.role, guarded)).page;
    await step(
      r.role,
      `200% browser zoom on ${r.base}/${r.id}: reflow, three themes, search`,
      async () => {
        await page.goto(`${L.BASE}${r.base}/${r.id}`);
        await page.waitForFunction(
          (t) => document.querySelector("#docs-main h1")?.textContent?.trim() === t,
          L.titleOf(r.id),
        );
        const before = await page.evaluate(() => ({ width: innerWidth, dpr: devicePixelRatio }));
        const url = page.url();
        const zoom = await worker.evaluate(async (u) => {
          const [tab] = await chrome.tabs.query({ url: u.split("#")[0] });
          await chrome.tabs.setZoom(tab.id, 2);
          return chrome.tabs.getZoom(tab.id);
        }, url);
        await page.waitForFunction(() => devicePixelRatio === 2, null, { timeout: 10000 });
        const layouts = [];
        for (const theme of ["light", "warm", "dark"]) {
          if (r.setTheme === "select") await page.locator("#docs-theme").selectOption(theme);
          else await page.evaluate((t) => (document.documentElement.dataset.theme = t), theme);
          await page.waitForTimeout(150);
          const l = await page.evaluate(() => {
            const root = document.documentElement;
            const main = document.querySelector("main");
            const h = document.querySelector("#docs-main h1").getBoundingClientRect();
            return {
              theme: root.dataset.theme,
              width: innerWidth,
              dpr: devicePixelRatio,
              cssZoom: getComputedStyle(root).zoom,
              overflow:
                root.scrollWidth > root.clientWidth + 1 ||
                (main ? main.scrollWidth > main.clientWidth + 1 : false),
              titleInView: h.left >= 0 && h.right <= innerWidth + 1,
            };
          });
          L.check(
            l.width === before.width / 2 && l.dpr === 2 && !l.overflow && l.titleInView,
            `layout ${JSON.stringify(l)}`,
          );
          layouts.push(l);
        }
        await page.locator("#docs-query").focus();
        await page.keyboard.type(r.query);
        await page.keyboard.press("Enter");
        await page.waitForURL((u) => u.searchParams.get("q") === r.query, { timeout: 15000 });
        await page.locator(".docs-result").first().waitFor({ timeout: 15000 });
        const results = await page.locator(".docs-result h2").allTextContents();
        const overflow = await page.evaluate(
          () => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
        );
        L.check(!overflow, "search results overflow at 200%");
        L.check(results.length > 0, "no results at 200%");
        return {
          before,
          chromeTabsGetZoom: zoom,
          layouts,
          query: r.query,
          firstResult: results[0],
          blockedExternal: [...new Set(guarded.log.blocked)],
        };
      },
    );
  } finally {
    await context.close();
    rmSync(profile, { recursive: true, force: true });
  }
}
console.log(save(join(here, "zoom.json")) ? "Zoom check passed" : "Zoom check has failures");
