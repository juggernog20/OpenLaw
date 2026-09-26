// Internal link and anchor check across every article in the formal reader. Agent check.
// Loads each guide signed out with internet blocked, then follows every distinct internal target.
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import * as L from "./lib.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const { step, save } = L.recorder({
  kind: "publication-link-check",
  scenario: "V-HELP",
  task: "DOC-030",
  independentReview: true,
  method: "browser-walkthrough",
  appUrl: L.BASE,
  edition: L.bundle.edition,
  articleCount: L.bundle.articles.length,
});

async function waitTitle(page, title) {
  await page.waitForFunction(
    (t) => document.querySelector("#docs-main h1")?.textContent?.trim() === t,
    title,
    { timeout: 15000 },
  );
}

const { context, log } = await L.guardedContext();
const page = await context.newPage();
const pages = new Map();
try {
  await step(
    "anonymous",
    "Read every formal guide and collect its links and heading anchors",
    async () => {
      for (const a of L.bundle.articles) {
        await page.goto(`${L.BASE}/documentation/${a.id}`);
        await waitTitle(page, a.title);
        const facts = await page.evaluate(() => ({
          links: [...document.querySelectorAll("#docs-main article a[href]")].map((x) =>
            x.getAttribute("href"),
          ),
          ids: [...document.querySelectorAll("#docs-main article [id]")].map((x) => x.id),
          images: [...document.querySelectorAll("#docs-main article img")].map((x) => ({
            src: x.getAttribute("src"),
            loaded: x.complete && x.naturalWidth > 0,
            alt: x.getAttribute("alt"),
          })),
        }));
        pages.set(a.id, facts);
      }
      const images = [...pages.values()].flatMap((p) => p.images);
      L.check(
        images.every((i) => i.loaded && i.alt),
        "an article image failed to load or lacks alt text",
      );
      return {
        articles: pages.size,
        links: [...pages.values()].reduce((n, p) => n + p.links.length, 0),
        images: images.length,
      };
    },
  );

  const internal = [];
  const external = new Set();
  for (const [id, p] of pages)
    for (const href of p.links) {
      if (/^https?:|^mailto:/.test(href)) external.add(href);
      else internal.push({ from: id, href });
    }

  await step(
    "anonymous",
    "Every internal link names a published guide and an existing anchor",
    async () => {
      const broken = [];
      for (const { from, href } of internal) {
        const [path, anchor] = href.split("#");
        const target = path === "" ? from : path.replace(/^\/documentation\//, "");
        if (path !== "" && !path.startsWith("/documentation/"))
          broken.push({ from, href, reason: "not a formal link" });
        else if (!pages.has(target)) broken.push({ from, href, reason: "unknown article" });
        else if (anchor && !pages.get(target).ids.includes(anchor))
          broken.push({ from, href, reason: "missing anchor" });
      }
      L.check(broken.length === 0, `broken: ${JSON.stringify(broken.slice(0, 10))}`);
      return {
        internalLinks: internal.length,
        withAnchor: internal.filter((l) => l.href.includes("#")).length,
        distinctTargets: new Set(
          internal.map((l) => (l.href.startsWith("#") ? `${l.from}${l.href}` : l.href)),
        ).size,
        externalLinks: [...external].length,
      };
    },
  );

  await step(
    "anonymous",
    "Follow every distinct internal target in the browser and land on its title and section",
    async () => {
      const targets = new Map();
      for (const { from, href } of internal) {
        const full = href.startsWith("#") ? `/documentation/${from}${href}` : href;
        if (!targets.has(full)) targets.set(full, { from, href });
      }
      const failures = [];
      for (const [full, { from, href }] of targets) {
        const [path, anchor] = full.split("#");
        const id = path.split("/").pop();
        try {
          // Start from the linking guide and click, so the reader's own link handling runs.
          await page.goto(`${L.BASE}/documentation/${from}`);
          await waitTitle(page, L.titleOf(from));
          const link = page.locator(`#docs-main article a[href="${href}"]`).first();
          await link.scrollIntoViewIfNeeded();
          await link.click();
          await page.waitForURL(
            (u) => u.pathname === path && (!anchor || u.hash === `#${anchor}`),
            { timeout: 15000 },
          );
          await waitTitle(page, L.titleOf(id));
          if (anchor) {
            await page.waitForFunction((a) => document.activeElement?.id === a, anchor, {
              timeout: 10000,
            });
            const notice = await page.locator(".docs-notice[role=status]").count();
            if (notice) throw new Error("missing-section notice shown");
          }
        } catch (error) {
          failures.push({ from, href: full, error: String(error.message).split("\n")[0] });
        }
      }
      L.check(failures.length === 0, `failures: ${JSON.stringify(failures.slice(0, 10))}`);
      return { followed: targets.size, failures: 0 };
    },
  );

  await step(
    "anonymous",
    "Help-destination links (staff and Portal) resolve to guides in that destination or the formal reader",
    async () => {
      const broken = [];
      let checked = 0;
      for (const a of L.bundle.articles)
        for (const [destination, base] of [
          ["staff-help", "/help/"],
          ["portal-help", "/portal/help/"],
        ]) {
          const html = a.html[destination];
          if (!html || !a.destinations.includes(destination)) continue;
          for (const [, href] of html.matchAll(/<a [^>]*href="([^"]+)"/g)) {
            if (/^https?:|^mailto:/.test(href)) continue;
            checked++;
            const [path, anchor] = href.split("#");
            const inHelp = path.startsWith(base);
            const target =
              path === "" ? a.id : path.replace(/^\/(documentation|help|portal\/help)\//, "");
            const article = L.bundle.articles.find((x) => x.id === target);
            if (!article) broken.push({ from: a.id, destination, href, reason: "unknown article" });
            else if (inHelp && !article.destinations.includes(destination))
              broken.push({
                from: a.id,
                destination,
                href,
                reason: "target not in this Help destination",
              });
            else if (!inHelp && path !== "" && !path.startsWith("/documentation/"))
              broken.push({ from: a.id, destination, href, reason: "wrong base" });
            else if (anchor && !pages.get(target).ids.includes(anchor))
              broken.push({ from: a.id, destination, href, reason: "missing anchor" });
          }
        }
      L.check(broken.length === 0, `broken: ${JSON.stringify(broken.slice(0, 10))}`);
      return {
        checked,
        broken: 0,
        basis: "compiled bundle HTML, anchors from the formal reader pages",
      };
    },
  );

  await step("anonymous", "The link check made no API or internet request", async () => {
    L.check(log.api.length === 0, `api: ${[...new Set(log.api)]}`);
    return { apiCalls: 0, blockedExternal: [...new Set(log.blocked)] };
  });
} finally {
  await context.close();
  await L.close();
  console.log(save(join(here, "links.json")) ? "Link check passed" : "Link check has failures");
}
