// V-OFFLINE browser walkthrough. Agent check, not human approval.
// Phase "reachable": the lab runs and the browser has no internet access.
// Phase "standalone": the lab is stopped and retained copies are read from disk.
// Usage: node offline.mjs reachable <out.json> | node offline.mjs standalone <retained-root> <out.json>
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import * as L from "./lib.mjs";

const [phase, ...rest] = process.argv.slice(2);
const OPERATOR_GUIDES = ["install", "backup-and-restore", "upgrade", "operator-troubleshooting"];
// DNS refusal is a second, browser-level block beside the request guard.
const NO_DNS = ["--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1"];

async function waitTitle(page, title, selector = "#docs-main h1") {
  await page.waitForFunction(
    ([s, t]) => document.querySelector(s)?.textContent?.trim() === t,
    [selector, title],
    { timeout: 15000 },
  );
}

async function reachable(out) {
  const { step, save, record } = L.recorder({
    kind: "publication-offline",
    scenario: "V-OFFLINE",
    phase: "reachable instance, internet blocked",
    task: "DOC-030",
    independentReview: true,
    method: "browser-walkthrough",
    appUrl: L.BASE,
    edition: L.bundle.edition,
    browserBlocks: ["request guard allows only the loopback lab", ...NO_DNS],
  });
  await L.launch({ args: NO_DNS });
  const internet = await fetch("https://github.com", { signal: AbortSignal.timeout(5000) })
    .then((r) => `reachable from the host (HTTP ${r.status}); blocked only inside the browser`)
    .catch((e) => `unreachable from the host: ${e.cause?.code ?? e.message}`);
  record.hostInternet = internet;

  for (const role of ["anonymous", "operator"]) {
    const { context, log } = await L.guardedContext({ acceptDownloads: true });
    const page = await context.newPage();
    const probe = await page
      .evaluate(async () =>
        fetch("https://github.com", { mode: "no-cors" }).then(
          () => "reachable",
          (e) => `refused: ${e.message}`,
        ),
      )
      .catch((e) => `refused: ${e.message}`);
    await step(role, "Browser cannot reach the internet", async () => {
      L.check(String(probe).startsWith("refused"), `internet reachable from the browser: ${probe}`);
      return { probe };
    });
    const from = log.blocked.length;
    if (role === "anonymous") {
      await step(
        role,
        "Read the bundled /documentation index, a guide and local search",
        async () => {
          await page.goto(`${L.BASE}/documentation`);
          await page.locator(".docs-collection").first().waitFor({ timeout: 15000 });
          const counts = await page.locator(".docs-collection > span").allTextContents();
          const total = counts.reduce((n, t) => n + Number.parseInt(t, 10), 0);
          L.check(total === L.TOTAL, `index ${total}`);
          await page.locator("#docs-query").fill("restore");
          await page.keyboard.press("Enter");
          await page.waitForURL((u) => u.searchParams.get("q") === "restore");
          await page.locator(".docs-result").first().waitFor();
          const results = await page.locator(".docs-result h2").allTextContents();
          L.check(results.includes(L.titleOf("backup-and-restore")), `results ${results}`);
          await page.getByRole("link", { name: L.titleOf("backup-and-restore") }).click();
          await waitTitle(page, L.titleOf("backup-and-restore"));
          const paragraphs = await page.locator("#docs-main article p").count();
          L.check(log.blocked.length === from, `external requests: ${log.blocked.slice(from)}`);
          L.check(log.api.length === 0, `API calls: ${log.api}`);
          return {
            indexGuides: total,
            query: "restore",
            results,
            paragraphs,
            externalRequests: 0,
            apiCalls: 0,
          };
        },
      );
    } else {
      await step(role, "Read operator guides and search in the bundled reader", async () => {
        await page.goto(`${L.BASE}/documentation?audience=operator`);
        await page.locator(".docs-result").first().waitFor({ timeout: 15000 });
        const listed = await page.locator(".docs-result h2").allTextContents();
        const expected = L.expectedIds("formal", "operator").map(L.titleOf);
        L.check(JSON.stringify(listed) === JSON.stringify(expected), `operator list ${listed}`);
        for (const id of OPERATOR_GUIDES) {
          await page.goto(`${L.BASE}/documentation/${id}`);
          await waitTitle(page, L.titleOf(id));
        }
        await page.goto(`${L.BASE}/documentation?q=upgrade%20backup`);
        await page.locator(".docs-result").first().waitFor();
        const results = await page.locator(".docs-result h2").allTextContents();
        L.check(results.includes(L.titleOf("upgrade")), `search ${results}`);
        L.check(log.blocked.length === from && log.api.length === 0, "external or API request");
        return {
          operatorGuides: listed.length,
          read: OPERATOR_GUIDES,
          query: "upgrade backup",
          results,
        };
      });
      await step(
        role,
        "Open the app-served standalone edition and download its archive with no internet",
        async () => {
          await page.goto(`${L.BASE}/documentation`);
          await page.locator("#edition summary").click();
          await page.getByRole("link", { name: "Open standalone edition" }).click();
          await page.waitForURL((u) => u.pathname === "/documentation-export/index.html");
          await page.locator(".docs-collection").first().waitFor();
          await page.locator("#docs-query").fill("restore");
          await page.keyboard.press("Enter");
          await page.locator("#docs-results .docs-result").first().waitFor();
          const standaloneResults = await page
            .locator("#docs-results .docs-result h2")
            .allTextContents();
          await page.goto(`${L.BASE}/documentation`);
          await page.locator("#edition summary").click();
          const [download] = await Promise.all([
            page.waitForEvent("download"),
            page.getByRole("link", { name: "Download standalone edition" }).click(),
          ]);
          const path = await download.path();
          const sha256 = createHash("sha256").update(readFileSync(path)).digest("hex");
          L.check(log.blocked.length === from, `external requests: ${log.blocked.slice(from)}`);
          return { standaloneResults, servedArchiveSha256: sha256 };
        },
      );
    }
    await step(
      role,
      "No external request was attempted while reading (after the deliberate probe)",
      async () => {
        L.check(log.blocked.length === from, `blocked: ${[...new Set(log.blocked.slice(from))]}`);
        return {
          probeBlocked: from,
          readingBlocked: 0,
          apiCalls: [...new Set(log.api)],
          requests: log.all,
        };
      },
    );
    await context.close();
  }
  await L.close();
  console.log(
    save(out) ? "Reachable offline phase passed" : "Reachable offline phase has failures",
  );
}

/** A browser context that refuses every http(s) request; only file:// loads. */
async function diskContext(javaScriptEnabled) {
  const b = await L.launch({ args: NO_DNS });
  const context = await b.newContext({ javaScriptEnabled, viewport: { width: 1280, height: 900 } });
  const log = { http: [], files: 0 };
  await context.route("**/*", (route) => {
    const url = route.request().url();
    if (url.startsWith("file:") || url.startsWith("data:")) {
      log.files++;
      return route.continue();
    }
    log.http.push(new URL(url).origin);
    return route.abort("internetdisconnected");
  });
  return { context, log };
}

/** Follows index -> section pages -> article pages and reports what opened. */
async function crawl(page, dir) {
  const index = pathToFileURL(join(dir, "index.html")).href;
  await page.goto(index);
  const sections = await page
    .locator(".docs-collection")
    .evaluateAll((els) => els.map((e) => e.getAttribute("href")));
  const guideCount = (await page.locator(".docs-collection > span").allTextContents()).reduce(
    (n, t) => n + Number.parseInt(t, 10),
    0,
  );
  const articles = new Map();
  for (const s of sections) {
    await page.goto(pathToFileURL(join(dir, s)).href);
    for (const href of await page
      .locator(".docs-result h2 a")
      .evaluateAll((els) => els.map((e) => e.getAttribute("href"))))
      articles.set(href.replace(/\.html$/, ""), s);
  }
  const opened = [];
  const missing = [];
  for (const id of articles.keys()) {
    const file = join(dir, `${id}.html`);
    let ok = false;
    // A fresh tab per guide: after a file-not-found error page Chromium refuses later file:// loads in that tab.
    const tab = await page.context().newPage();
    try {
      await tab.goto(pathToFileURL(file).href);
      const h = (await tab.locator("#docs-main h1").first().textContent({ timeout: 3000 }))?.trim();
      const prose = await tab.locator("#docs-main article p").count();
      ok = h === L.titleOf(id) && prose > 0;
    } catch {
      ok = false;
    } finally {
      await tab.close();
    }
    (ok ? opened : missing).push(id);
  }
  return {
    indexGuides: guideCount,
    sections: sections.length,
    linked: articles.size,
    opened: opened.length,
    missing,
    fileExists: missing.map((id) => existsSync(join(dir, `${id}.html`))),
  };
}

async function standalone(root, out) {
  const complete = join(root, "complete");
  const optional = join(root, "copy-optional-assets-missing");
  const incomplete = join(root, "copy-article-missing");
  const { step, save, record } = L.recorder({
    kind: "publication-offline",
    scenario: "V-OFFLINE",
    phase: "instance stopped, retained standalone copies read from disk",
    task: "DOC-030",
    independentReview: true,
    method: "browser-walkthrough",
    edition: L.bundle.edition,
    retainedRoot: "outside the worktree and the lab (path withheld; see checksums file)",
  });
  record.labProbe = await fetch(`${L.BASE}/documentation`, { signal: AbortSignal.timeout(5000) })
    .then((r) => `reachable HTTP ${r.status}`)
    .catch((e) => `refused: ${e.cause?.code ?? e.message}`);

  await step("operator", "The owned lab no longer answers", async () => {
    L.check(record.labProbe.startsWith("refused"), `lab still up: ${record.labProbe}`);
    return { probe: record.labProbe };
  });

  {
    const { context, log } = await diskContext(true);
    const page = await context.newPage();
    await step(
      "operator",
      "Complete retained copy: every guide opens from disk with JavaScript",
      async () => {
        const c = await crawl(page, complete);
        L.check(c.indexGuides === L.TOTAL && c.linked === L.TOTAL && c.opened === L.TOTAL, JSON.stringify(c));
        return c;
      },
    );
    await step(
      "operator",
      "Complete retained copy: local search, theme and edition details from disk",
      async () => {
        await page.goto(pathToFileURL(join(complete, "install.html")).href);
        await page.locator("#docs-query").fill("restore");
        await page.keyboard.press("Enter");
        await page.waitForURL(
          (u) => u.pathname.endsWith("/index.html") && u.searchParams.get("q") === "restore",
        );
        await page.locator("#docs-results .docs-result").first().waitFor({ timeout: 10000 });
        const results = await page.locator("#docs-results .docs-result h2").allTextContents();
        L.check(results.includes(L.titleOf("backup-and-restore")), `results ${results}`);
        L.check(await page.locator("#docs-index").isHidden(), "index not replaced by results");
        await page.getByRole("link", { name: L.titleOf("backup-and-restore") }).click();
        await waitTitle(page, L.titleOf("backup-and-restore"));
        await page.locator("#docs-theme").selectOption("dark");
        const theme = await page.evaluate(() => document.documentElement.dataset.theme);
        await page.goto(pathToFileURL(join(complete, "reference.html")).href);
        const kept = await page.evaluate(() => document.documentElement.dataset.theme);
        const digest = await page.locator("#edition dd").nth(3).textContent();
        L.check(
          theme === "dark" && digest === L.bundle.edition.contentDigest,
          `${theme} ${digest}`,
        );
        await page.goto(`${pathToFileURL(join(complete, "reference.html")).href}#no-such-section`);
        const notice = await page.locator("#docs-missing-section").textContent({ timeout: 5000 });
        L.check(log.http.length === 0, `http requests: ${log.http}`);
        return {
          query: "restore",
          results,
          theme,
          themeKeptOnNextPage: kept,
          contentDigest: digest,
          missingAnchorNotice: notice,
          httpRequests: 0,
        };
      },
    );
    await context.close();
  }

  for (const role of ["anonymous", "operator"]) {
    const { context, log } = await diskContext(false);
    const page = await context.newPage();
    await step(
      role,
      "Complete retained copy with JavaScript disabled: index and every guide's prose",
      async () => {
        await page.goto(pathToFileURL(join(complete, "index.html")).href);
        const noscript = await page.locator("#docs-index").isVisible();
        const c = await crawl(page, complete);
        L.check(noscript && c.indexGuides === L.TOTAL && c.opened === L.TOTAL, JSON.stringify(c));
        L.check(log.http.length === 0, `http: ${log.http}`);
        return { javascript: false, indexVisible: noscript, ...c, httpRequests: 0 };
      },
    );
    await context.close();
  }

  for (const js of [true, false]) {
    const role = js ? "operator" : "anonymous";
    const { context, log } = await diskContext(js);
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(String(e.message).slice(0, 120)));
    await step(
      role,
      `Copy without search.js and inter.woff2 (JavaScript ${js ? "on" : "off"}): index and prose remain usable`,
      async () => {
        const removed = ["search.js", "inter.woff2"].map((f) => ({
          file: f,
          present: existsSync(join(optional, f)),
        }));
        L.check(
          removed.every((r) => !r.present),
          "optional assets still present",
        );
        const c = await crawl(page, optional);
        L.check(c.indexGuides === L.TOTAL && c.opened === L.TOTAL, JSON.stringify(c));
        await page.goto(pathToFileURL(join(optional, "index.html")).href);
        await page.locator("#docs-query").fill("restore");
        await page.keyboard.press("Enter");
        await page.waitForURL((u) => u.searchParams.get("q") === "restore");
        const indexStillVisible = await page.locator("#docs-index").isVisible();
        const searchResults = await page.locator("#docs-results .docs-result").count();
        L.check(indexStillVisible, "index hidden without search");
        L.check(log.http.length === 0, `http: ${log.http}`);
        return {
          removed: removed.map((r) => r.file),
          ...c,
          searchSubmitted: "restore",
          searchResults,
          indexStillVisible,
          pageErrors: errors,
        };
      },
    );
    await context.close();
  }

  {
    const { context } = await diskContext(true);
    const page = await context.newPage();
    const result = JSON.parse(process.env.OFFLINE_COMPLETENESS ?? "{}");
    await step(
      "operator",
      "Copy with backup-and-restore.html removed fails the completeness check",
      async () => {
        L.check(
          result.missingCheck?.exitCode !== 0 &&
            /backup-and-restore\.html: FAILED/.test(result.missingCheck?.output ?? ""),
          `checksum check ${JSON.stringify(result.missingCheck)}`,
        );
        const c = await crawl(page, incomplete);
        L.check(
          c.indexGuides === L.TOTAL && c.opened === L.TOTAL - 1 && c.missing.join() === "backup-and-restore",
          JSON.stringify(c),
        );
        return { checksumCheck: result.missingCheck, browser: c };
      },
    );
    await context.close();
  }
  console.log(
    save(out) ? "Standalone phase (part 1) passed" : "Standalone phase (part 1) has failures",
  );
  await L.close();
}

async function restored(root, out) {
  const incomplete = join(root, "copy-article-missing");
  const previous = JSON.parse(readFileSync(out, "utf8"));
  const { step, record } = L.recorder({});
  const result = JSON.parse(process.env.OFFLINE_COMPLETENESS ?? "{}");
  const { context, log } = await diskContext(true);
  const page = await context.newPage();
  await step(
    "operator",
    "After restoring the file from the complete retained copy, the copy passes and reads",
    async () => {
      L.check(
        result.restoredCheck?.exitCode === 0,
        `checksum check ${JSON.stringify(result.restoredCheck)}`,
      );
      const c = await crawl(page, incomplete);
      L.check(c.opened === L.TOTAL && c.missing.length === 0, JSON.stringify(c));
      await page.goto(pathToFileURL(join(incomplete, "backup-and-restore.html")).href);
      await waitTitle(page, L.titleOf("backup-and-restore"));
      L.check(log.http.length === 0, "http request");
      return { checksumCheck: result.restoredCheck, browser: c };
    },
  );
  await context.close();
  await L.close();
  previous.steps.push(...record.steps);
  previous.completedAt = new Date().toISOString();
  previous.passed = previous.steps.every((s) => s.result === "pass");
  writeFileSync(out, `${JSON.stringify(previous, null, 2)}\n`);
  console.log(previous.passed ? "Standalone phase passed" : "Standalone phase has failures");
}

if (phase === "reachable") await reachable(rest[0]);
else if (phase === "standalone") await standalone(rest[0], rest[1]);
else if (phase === "restored") await restored(rest[0], rest[1]);
else
  throw new Error(
    "Usage: offline.mjs reachable <out> | standalone <root> <out> | restored <root> <out>",
  );
