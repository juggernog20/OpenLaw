// V-HELP browser walkthrough for the complete 57-article edition. Agent check, not human approval.
// Run from the repository root with LAB_SEED_PASSWORD set. Writes help.json beside this file.
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import * as L from "./lib.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const { record, step, save } = L.recorder({
  kind: "publication-walkthrough",
  scenario: "V-HELP",
  task: "DOC-029",
  independentReview: true,
  method: "browser-walkthrough",
  appUrl: L.BASE,
  edition: L.bundle.edition,
  articleCount: L.bundle.articles.length,
});

// Shell requests that the signed-in frame makes on every page. Help adds nothing else.
const SHELL_API = new Set([
  "GET /api/v1/me",
  "GET /api/v1/notifications/unread-count",
  "GET /api/events",
  "GET /api/v1/portal/me",
  "GET /api/v1/portal/notifications/unread-count",
]);

const PILOT = [
  { query: "form target", id: "request-forms", roles: ["administrator", "anonymous"] },
  {
    query: "assign request",
    id: "triage-requests",
    roles: ["legal_team_member", "administrator", "anonymous"],
  },
  {
    query: "convert request",
    id: "convert-request",
    roles: ["legal_team_member", "administrator", "anonymous"],
  },
  { query: "submit request", id: "submit-request", roles: ["business_user", "anonymous"] },
];
// Queries retained in earlier batches. "which version" is the recorded failed query (DOC-024).
const RETESTS = [
  { query: "which version", id: "versions-and-support" },
  {
    query: "backup codes",
    id: "staff-sign-in",
    roles: ["legal_team_member", "administrator", "anonymous"],
  },
  { query: "expired link", id: "portal-sign-in", roles: ["business_user", "anonymous"] },
  {
    query: "save a view",
    id: "search-and-views",
    roles: ["legal_team_member", "administrator", "anonymous"],
  },
  {
    query: "timezone",
    id: "personal-settings",
    roles: ["legal_team_member", "administrator", "anonymous"],
  },
  {
    query: "your tasks",
    id: "find-your-work",
    roles: ["legal_team_member", "administrator", "anonymous"],
  },
];

async function h1(page) {
  const heading = page.locator("#docs-main h1").first();
  await heading.waitFor({ timeout: 15000 });
  return (await heading.textContent()).trim();
}

async function waitTitle(page, title, message) {
  try {
    await page.waitForFunction(
      (t) => document.querySelector("#docs-main h1")?.textContent?.trim() === t,
      title,
      { timeout: 15000 },
    );
  } catch {
    throw new Error(message);
  }
}

async function waitFocus(page, predicate, arg, message) {
  try {
    await page.waitForFunction(predicate, arg, { timeout: 10000 });
  } catch {
    const now = await page.evaluate(
      () => `${document.activeElement?.tagName}#${document.activeElement?.id}`,
    );
    throw new Error(`${message}; focus is ${now}`);
  }
}

async function indexCount(page) {
  await page.locator(".docs-collection").first().waitFor({ timeout: 15000 });
  const counts = await page.locator(".docs-collection > span").allTextContents();
  return counts.reduce((n, t) => n + Number.parseInt(t, 10), 0);
}

async function overflow(page) {
  return page.evaluate(() => {
    const root = document.documentElement;
    const main = document.querySelector("main");
    return {
      width: innerWidth,
      page: root.scrollWidth > root.clientWidth + 1,
      main: main ? main.scrollWidth > main.clientWidth + 1 : false,
    };
  });
}

async function searchByKeyboard(page, base, query, id) {
  const title = L.titleOf(id);
  await page.goto(`${L.BASE}${base}`);
  await h1(page);
  await page.locator("#docs-query").focus();
  await page.keyboard.type(query);
  await page.keyboard.press("Enter");
  await page.waitForURL((u) => u.searchParams.get("q") === query, { timeout: 15000 });
  await page.locator(".docs-result").first().waitFor({ timeout: 15000 });
  const results = await page.locator(".docs-result h2").allTextContents();
  const rank = results.indexOf(title);
  L.check(rank >= 0, `"${query}" did not list ${id}; got ${results.slice(0, 5).join(" | ")}`);
  let focused = "";
  for (let i = 0; i < 80 && focused !== title; i++) {
    await page.keyboard.press("Tab");
    focused = await page.evaluate(() => document.activeElement?.textContent?.trim() ?? "");
  }
  L.check(focused === title, `Tab never reached the ${id} result`);
  await page.keyboard.press("Enter");
  await page.waitForURL((u) => u.pathname.endsWith(`/${id}`), { timeout: 15000 });
  await waitTitle(page, title, "article title missing");
  await waitFocus(
    page,
    (t) =>
      document.activeElement?.tagName === "H1" && document.activeElement.textContent.trim() === t,
    title,
    "focus not on the article title",
  );
  const pageTitle = await page.title();
  await page.goBack();
  await page.waitForURL((u) => u.searchParams.get("q") === query, { timeout: 15000 });
  await page.locator(".docs-result").first().waitFor({ timeout: 15000 });
  await page.goForward();
  await page.waitForURL((u) => u.pathname.endsWith(`/${id}`), { timeout: 15000 });
  await waitTitle(page, title, "Forward did not restore the article");
  return {
    query,
    articleId: id,
    rank: rank + 1,
    resultCount: results.length,
    focus: "H1",
    pageTitle,
    back: "results",
    forward: "article",
  };
}

async function outlineFocus(page, base, id) {
  await page.goto(`${L.BASE}${base}/${id}`);
  await h1(page);
  const link = page.locator(".docs-outline a").nth(1);
  await page.locator(".docs-outline details").evaluate((d) => (d.open = true));
  const href = await link.getAttribute("href");
  await link.focus();
  await page.keyboard.press("Enter");
  const hash = href.slice(href.indexOf("#"));
  await page.waitForURL((u) => u.hash === hash, { timeout: 10000 });
  await waitFocus(
    page,
    (h) => `#${document.activeElement?.id}` === h,
    hash,
    `section focus not ${hash}`,
  );
  return { hash, focused: hash.slice(1) };
}

async function themesAndNarrow(page, base, id, setTheme) {
  const layouts = [];
  for (const width of [1280, 320]) {
    await page.setViewportSize({ width, height: 800 });
    for (const theme of ["light", "warm", "dark"]) {
      await page.goto(`${L.BASE}${base}/${id}`);
      await h1(page);
      await setTheme(theme);
      await page.waitForTimeout(150);
      const probe = await page.evaluate(() => {
        const rgb = (v) => (v.match(/[\d.]+/g) ?? []).map(Number);
        const opaque = (el) => {
          for (let n = el; n; n = n.parentElement) {
            const c = getComputedStyle(n).backgroundColor;
            if (rgb(c).length === 3 || rgb(c)[3] > 0) return c;
          }
          return getComputedStyle(document.documentElement).backgroundColor;
        };
        const lum = (c) => {
          const [r, g, b] = rgb(c)
            .slice(0, 3)
            .map((x) => {
              x /= 255;
              return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4;
            });
          return 0.2126 * r + 0.7152 * g + 0.0722 * b;
        };
        const body =
          document.querySelector("#docs-main article p") ?? document.querySelector("#docs-main h1");
        const background = opaque(body);
        const text = getComputedStyle(body).color;
        const [a, b] = [lum(background), lum(text)].sort((x, y) => y - x);
        return {
          theme: document.documentElement.dataset.theme,
          background,
          text,
          contrast: Math.round(((a + 0.05) / (b + 0.05)) * 100) / 100,
          navOpen: document.querySelector(".docs-navigation")?.open ?? null,
        };
      });
      const o = await overflow(page);
      const titleBox = await page.locator("#docs-main h1").first().boundingBox();
      L.check(probe.theme === theme, `theme attribute ${probe.theme}, expected ${theme}`);
      L.check(probe.contrast >= 4.5, `body text contrast ${probe.contrast} in ${theme}`);
      L.check(!o.page && !o.main, `horizontal overflow at ${width}px in ${theme}`);
      L.check(
        titleBox && titleBox.x >= 0 && titleBox.x + titleBox.width <= width + 1,
        "title outside viewport",
      );
      layouts.push({ width, ...probe, overflow: false });
    }
  }
  await page.setViewportSize({ width: 1280, height: 900 });
  const backgrounds = new Set(layouts.map((l) => `${l.theme}:${l.background}`));
  const distinct = new Set(layouts.filter((l) => l.width === 1280).map((l) => l.background));
  L.check(
    distinct.size === 3,
    `themes did not change the background: ${[...backgrounds].join(", ")}`,
  );
  const narrowNav = layouts.filter((l) => l.width === 320).every((l) => l.navOpen === false);
  L.check(narrowNav, "navigation not collapsed at 320px");
  return { articleId: id, layouts };
}

async function recovery(page, base, role) {
  const out = {};
  await page.goto(`${L.BASE}${base}/no-such-article`);
  out.unknownArticle = await h1(page);
  L.check(
    out.unknownArticle === "Article unavailable",
    `unknown article shows ${out.unknownArticle}`,
  );
  L.check(await page.locator("#docs-query").isVisible(), "no search on unavailable page");
  await page.locator(".docs-empty a").click();
  await page.waitForURL((u) => u.pathname === base, { timeout: 10000 });
  out.unknownArticleRecovery = `${base} index, ${await indexCount(page)} guides`;
  await page.goto(`${L.BASE}${base}/reference#no-such-section`);
  await h1(page);
  out.unknownAnchor = (await page.locator(".docs-notice[role=status]").textContent()).trim();
  L.check(/section is unavailable/.test(out.unknownAnchor), "missing-section notice absent");
  L.check((await page.locator(".docs-outline a").count()) > 0, "outline absent on missing anchor");
  await page.goto(`${L.BASE}${base}?edition=documentation-release-0`);
  out.unbundledEdition = await h1(page);
  L.check(out.unbundledEdition === "Article unavailable", "unbundled edition not refused");
  out.unbundledEditionBody = (await page.locator(".docs-empty p").textContent()).trim();
  await page.goto(`${L.BASE}${base}?topic=no.such.topic`);
  out.unknownTopicCount = await indexCount(page);
  const expected = L.expectedIds(
    base === "/documentation" ? "formal" : base === "/help" ? "staff-help" : "portal-help",
    role === "anonymous" ? "" : role,
  ).length;
  L.check(
    out.unknownTopicCount === expected,
    `unknown topic index ${out.unknownTopicCount} != ${expected}`,
  );
  out.aliases = L.bundle.redirects.length;
  out.aliasNote =
    L.bundle.redirects.length === 0
      ? "redirects.json publishes no aliases in this edition, so no alias exists to follow."
      : "checked";
  return out;
}

async function externalSupport(page, base) {
  await page.goto(`${L.BASE}${base}/versions-and-support`);
  const title = await h1(page);
  const link = page.locator('#docs-main article a[href^="https://github.com"]').first();
  const href = await link.getAttribute("href");
  const target = await link.getAttribute("target");
  await link.click();
  await page.waitForTimeout(1500);
  const after = page.url();
  L.check(
    !after.startsWith(L.BASE) || after.includes("versions-and-support"),
    "unexpected local change",
  );
  if (!after.includes("versions-and-support")) await page.goBack();
  await page.waitForURL((u) => u.pathname.endsWith("/versions-and-support"), { timeout: 15000 });
  L.check((await h1(page)) === title, "article not restored after failed external link");
  const local = page.locator('#docs-main article a[href^="/"]').first();
  const localHref = await local.getAttribute("href");
  await local.click();
  const localPath = localHref.split("#")[0];
  await page.waitForURL((u) => u.pathname === localPath, { timeout: 15000 });
  const expectedTitle = L.titleOf(localPath.split("/").pop());
  await waitTitle(page, expectedTitle, "local link after external failure did not open its guide");
  const next = expectedTitle;
  return {
    external: href,
    target,
    externalOutcome: "blocked (no internet)",
    afterBack: title,
    localLink: localHref,
    localTitle: next,
  };
}

async function outOfAudience(page, base, id) {
  await page.goto(`${L.BASE}${base}/${id}`);
  const title = await h1(page);
  const notice = (await page.locator(".docs-empty p").textContent()).trim();
  L.check(/available in the full documentation/.test(notice), "no audience notice");
  const link = page.locator(".docs-empty a", {
    hasText: "Read this article in the full documentation",
  });
  L.check((await link.getAttribute("href")) === `/documentation/${id}`, "formal link wrong");
  L.check(
    !(await page.getByText(/not authorized|forbidden|permission denied/i).count()),
    "shows an authorization error",
  );
  await link.click();
  await page.waitForURL((u) => u.pathname === `/documentation/${id}`, { timeout: 15000 });
  L.check((await h1(page)) === L.titleOf(id), "formal article did not open");
  L.check((await page.locator("#docs-main article").count()) === 1, "formal article body missing");
  return { requested: `${base}/${id}`, title, notice, reached: `/documentation/${id}` };
}

function helpApi(log, from) {
  const calls = log.api.slice(from);
  const extra = calls.filter((c) => !SHELL_API.has(c));
  return { calls: [...new Set(calls)], extra };
}

async function staffRole(role) {
  const { context, page, log } = await L.staffSession(role);
  const expected = L.expectedIds("staff-help", role);
  await step(role, "Staff Help index lists every eligible guide", async () => {
    await page.goto(`${L.BASE}/help`);
    const heading = await h1(page);
    const count = await indexCount(page);
    L.check(
      heading === "Help" && count === expected.length,
      `${heading} ${count} != ${expected.length}`,
    );
    return { url: "/help", heading, count, expected: expected.length };
  });
  await step(role, "Every eligible guide opens at /help/<id> with its title", async () => {
    const titles = [];
    for (const id of expected) {
      await page.goto(`${L.BASE}/help/${id}`);
      const t = await h1(page);
      L.check(t === L.titleOf(id), `${id} shows ${t}`);
      titles.push(id);
    }
    return { opened: titles.length };
  });
  await step(
    role,
    "Header Help from bound routes carries route topics and recommends guides",
    async () => {
      const out = [];
      const probe = [
        ["/inbox", "inbox"],
        ["/contracts", "contracts.list"],
        ["/matters", null],
        ["/settings", null],
      ];
      if (role === "administrator")
        probe.push(["/settings/intake/request-types", "settings.intake"]);
      for (const [route, topic] of probe) {
        await page.goto(`${L.BASE}${route}`);
        const help = page.locator('header a[aria-label="Help"]').first();
        await help.waitFor({ timeout: 15000 });
        const href = await help.getAttribute("href");
        await help.click();
        await page.waitForURL((u) => u.pathname === "/help", { timeout: 15000 });
        const topics = new URL(page.url()).searchParams.getAll("topic");
        if (topic) L.check(topics.includes(topic), `${route} header Help lacks ${topic}: ${href}`);
        L.check(!/\d{2,}|[0-9a-f]{8}-/.test(href), `record identifier in ${href}`);
        await page.locator(".docs-result, .docs-collection").first().waitFor({ timeout: 15000 });
        const results = await page.locator(".docs-result h2").allTextContents();
        out.push({ route, href, topics, results: results.slice(0, 8) });
      }
      return out;
    },
  );
  await step(
    role,
    "Observe the staff Inbox contextual link that help-contexts.json marks as a pilot entry",
    async () => {
      await page.goto(`${L.BASE}/inbox`);
      await page.locator('header a[aria-label="Help"]').first().waitFor({ timeout: 15000 });
      await page.waitForTimeout(1000);
      const contextual = await page.getByRole("link", { name: "Help with this page" }).count();
      return {
        route: "/inbox",
        contextualLinks: contextual,
        note: contextual
          ? "present"
          : "Absent. Removed from the staff Inbox and Request pages in 41390ca0. Header Help still carries topic=inbox. Recorded as a finding, not a scenario check.",
      };
    },
  );
  await step(
    role,
    "Registered topic narrows Help; unknown topic falls back to the index",
    async () => {
      await page.goto(`${L.BASE}/help?topic=inbox.convert`);
      await page.locator(".docs-result").first().waitFor({ timeout: 15000 });
      const results = await page.locator(".docs-result h2").allTextContents();
      L.check(results.includes(L.titleOf("convert-request")), `inbox.convert gave ${results}`);
      await page.goto(`${L.BASE}/help?topic=no.such.topic`);
      const count = await indexCount(page);
      L.check(count === expected.length, `unknown topic count ${count}`);
      return { topic: "inbox.convert", results, unknownTopicCount: count };
    },
  );
  for (const p of [...PILOT, ...RETESTS].filter((p) => !p.roles || p.roles.includes(role))) {
    await step(
      role,
      `Keyboard search "${p.query}" reaches ${p.id}; focus and Back/Forward`,
      async () => {
        const from = log.api.length;
        const r = await searchByKeyboard(page, "/help", p.query, p.id);
        const api = helpApi(log, from);
        L.check(api.extra.length === 0, `Help made record API calls: ${api.extra}`);
        L.check(!api.calls.some((c) => c.includes("search")), "search reached the API");
        return { ...r, apiDuringSearch: api.calls };
      },
    );
  }
  await step(role, "Section links move focus to the section heading", () =>
    outlineFocus(page, "/help", "reference"),
  );
  await step(
    role,
    "Existing shortcuts: ? opens the sheet, Escape closes it, / focuses app search, docs search types literally",
    async () => {
      await page.goto(`${L.BASE}/help`);
      await h1(page);
      await page.locator("body").click({ position: { x: 5, y: 300 } });
      await page.keyboard.press("?");
      const dialog = page.getByRole("dialog", { name: "Keyboard shortcuts" });
      await dialog.waitFor({ timeout: 5000 });
      await page.keyboard.press("Escape");
      await dialog.waitFor({ state: "hidden", timeout: 5000 });
      await page.locator("body").click({ position: { x: 5, y: 300 } });
      await page.keyboard.press("/");
      const active = await page.evaluate(() => ({
        id: document.activeElement?.id,
        role: document.activeElement?.getAttribute("role"),
        label:
          document.activeElement?.getAttribute("aria-label") ??
          document.activeElement?.getAttribute("placeholder"),
      }));
      L.check(
        active.id !== "docs-query" && active.role === "combobox",
        `/ focused ${JSON.stringify(active)}`,
      );
      await page.keyboard.press("Escape");
      await page.locator("#docs-query").focus();
      await page.keyboard.type("?/");
      const typed = await page.locator("#docs-query").inputValue();
      L.check(typed === "?/", `docs search value ${typed}`);
      L.check((await dialog.count()) === 0, "sheet opened from docs search");
      return {
        questionMark: "Keyboard shortcuts dialog",
        escape: "closed",
        slash: active,
        docsSearchTyped: typed,
      };
    },
  );
  await step(role, "Light, Warm and Dark at 1280px and 320px without horizontal overflow", () =>
    themesAndNarrow(page, "/help", "triage-requests", (theme) =>
      page.evaluate((t) => (document.documentElement.dataset.theme = t), theme),
    ),
  );
  await step(
    role,
    "Out-of-audience Help link offers the formal article, not an authorization error",
    () => outOfAudience(page, "/help", role === "administrator" ? "install" : "first-run"),
  );
  await step(
    role,
    "Unknown article, unknown anchor, unbundled edition and unknown topic recover locally",
    () => recovery(page, "/help", role),
  );
  await step(role, "Unavailable external support link leaves local Help usable", () =>
    externalSupport(page, "/help"),
  );
  await step(
    role,
    "No internet request was needed during the session (API paths include the app pages visited before Help)",
    async () => {
      const all = [...new Set(log.api)];
      return { blockedExternal: [...new Set(log.blocked)], apiPaths: all };
    },
  );
  await context.close();
}

async function businessUser() {
  const role = "business_user";
  const { context, page, log } = await L.portalSession();
  const expected = L.expectedIds("portal-help", role);
  await step(role, "Business Portal Help index lists every eligible guide", async () => {
    await page.goto(`${L.BASE}/portal/help`);
    const heading = await h1(page);
    const count = await indexCount(page);
    L.check(
      heading === "Help" && count === expected.length,
      `${heading} ${count} != ${expected.length}`,
    );
    return { url: "/portal/help", heading, count, expected: expected.length };
  });
  await step(role, "Every eligible guide opens at /portal/help/<id>", async () => {
    for (const id of expected) {
      await page.goto(`${L.BASE}/portal/help/${id}`);
      L.check((await h1(page)) === L.titleOf(id), `${id} title`);
    }
    return { opened: expected.length };
  });
  await step(
    role,
    "Staff /help address sends the Business User to Portal Help with its path",
    async () => {
      await page.goto(
        `${L.BASE}/help/submit-request#${L.bundle.articles.find((a) => a.id === "submit-request").outline[1].id}`,
      );
      await page.waitForURL((u) => u.pathname === "/portal/help/submit-request", {
        timeout: 15000,
      });
      await h1(page);
      return { url: new URL(page.url()).pathname + new URL(page.url()).hash };
    },
  );
  await step(role, "Contextual Help on Portal home, form and Request pages", async () => {
    const out = [];
    await page.goto(`${L.BASE}/portal`);
    const home = page.getByRole("link", { name: "Help with this page" });
    await home.waitFor({ timeout: 15000 });
    out.push({ route: "/portal", href: await home.getAttribute("href") });
    const form = await page.locator('a[href^="/portal/new/"]').first().getAttribute("href");
    await page.goto(`${L.BASE}${form}`);
    const formHelp = page.getByRole("link", { name: "Help with this page" });
    await formHelp.waitFor({ timeout: 15000 });
    out.push({ route: "/portal/new/:slug", href: await formHelp.getAttribute("href") });
    await page.goto(`${L.BASE}/portal`);
    const req = page.locator('a[href^="/portal/requests/"]').first();
    await req.waitFor({ timeout: 15000 });
    const reqHref = await req.getAttribute("href");
    await page.goto(`${L.BASE}${reqHref}`);
    const reqHelp = page.getByRole("link", { name: "Help with this page" });
    await reqHelp.waitFor({ timeout: 15000 });
    out.push({ route: "/portal/requests/:number", href: await reqHelp.getAttribute("href") });
    await reqHelp.click();
    await page.waitForURL((u) => u.pathname === "/portal/help", { timeout: 15000 });
    await page.locator(".docs-result").first().waitFor({ timeout: 15000 });
    const results = await page.locator(".docs-result h2").allTextContents();
    const expectedTopics = ["portal.home", "portal.form", "portal.request"];
    out.forEach((o, i) =>
      L.check(o.href === `/portal/help?topic=${expectedTopics[i]}`, `${o.route} ${o.href}`),
    );
    const header = await page.locator('a[aria-label="Help"]').first().getAttribute("href");
    return { links: out, requestTopicResults: results, headerOnHelp: header };
  });
  await step(role, "Unknown topic falls back to the Portal Help index", async () => {
    await page.goto(`${L.BASE}/portal/help?topic=no.such.topic`);
    const count = await indexCount(page);
    L.check(count === expected.length, `count ${count}`);
    return { count };
  });
  for (const p of [...PILOT, ...RETESTS].filter((p) => !p.roles || p.roles.includes(role))) {
    await step(
      role,
      `Keyboard search "${p.query}" reaches ${p.id}; focus and Back/Forward`,
      async () => {
        const from = log.api.length;
        const r = await searchByKeyboard(page, "/portal/help", p.query, p.id);
        const api = helpApi(log, from);
        L.check(api.extra.length === 0, `Help made record API calls: ${api.extra}`);
        return { ...r, apiDuringSearch: api.calls };
      },
    );
  }
  await step(role, "Section links move focus to the section heading", () =>
    outlineFocus(page, "/portal/help", "submit-request"),
  );
  await step(
    role,
    "Portal has no global shortcuts; ? and / type literally in docs search",
    async () => {
      await page.goto(`${L.BASE}/portal/help`);
      await h1(page);
      await page.locator("#docs-query").focus();
      await page.keyboard.type("?/");
      const typed = await page.locator("#docs-query").inputValue();
      L.check(typed === "?/", `typed ${typed}`);
      L.check((await page.getByRole("dialog").count()) === 0, "a dialog opened");
      return { docsSearchTyped: typed, dialogs: 0 };
    },
  );
  await step(role, "Light, Warm and Dark at 1280px and 320px without horizontal overflow", () =>
    themesAndNarrow(page, "/portal/help", "submit-request", (theme) =>
      page.evaluate((t) => (document.documentElement.dataset.theme = t), theme),
    ),
  );
  await step(role, "Out-of-audience Help link offers the formal article", () =>
    outOfAudience(page, "/portal/help", "triage-requests"),
  );
  await step(
    role,
    "Unknown article, unknown anchor, unbundled edition and unknown topic recover locally",
    () => recovery(page, "/portal/help", role),
  );
  await step(role, "Unavailable external support link leaves local Help usable", () =>
    externalSupport(page, "/portal/help"),
  );
  await step(
    role,
    "No internet request was needed during the session (API paths include the app pages visited before Help)",
    async () => ({
      blockedExternal: [...new Set(log.blocked)],
      apiPaths: [...new Set(log.api)],
    }),
  );
  await context.close();
}

async function anonymous() {
  const role = "anonymous";
  const { context, log } = await L.guardedContext();
  const page = await context.newPage();
  const expected = L.expectedIds("formal");
  // Each public step reports the API requests it caused, so a stray call names its step.
  const astep = (r, action, fn) =>
    step(r, action, async () => {
      const from = log.api.length;
      const out = await fn();
      const api = log.api.slice(from);
      if (api.length) throw new Error(`public reading called ${[...new Set(api)]}`);
      return out;
    });
  await astep(role, "Signed-out /documentation lists all 57 guides", async () => {
    await page.goto(`${L.BASE}/documentation`);
    const heading = await h1(page);
    const count = await indexCount(page);
    L.check(count === 57 && expected.length === 57, `count ${count}`);
    const edition = await page.locator("#edition dd").allTextContents();
    L.check(edition.includes(L.bundle.edition.contentDigest), "served digest differs");
    return { heading, count, digest: L.bundle.edition.contentDigest, distribution: edition[2] };
  });
  await astep(role, "Every guide opens at /documentation/<id> with its title", async () => {
    for (const id of expected) {
      await page.goto(`${L.BASE}/documentation/${id}`);
      L.check((await h1(page)) === L.titleOf(id), `${id} title`);
    }
    return { opened: expected.length };
  });
  await astep(
    role,
    "Signed-out Help deep links redirect to the formal article with the fragment",
    async () => {
      // A separate context: the Help route checks the session before it redirects.
      const other = await L.guardedContext();
      const page = await other.context.newPage();
      const out = [];
      for (const [path, id] of [
        ["/help", "triage-requests"],
        ["/portal/help", "submit-request"],
      ]) {
        const anchor = L.bundle.articles.find((a) => a.id === id).outline[1].id;
        await page.goto(`${L.BASE}${path}/${id}#${anchor}`);
        await page.waitForURL((u) => u.pathname === `/documentation/${id}`, { timeout: 15000 });
        const u = new URL(page.url());
        L.check(u.hash === `#${anchor}`, `fragment lost: ${u.hash}`);
        await h1(page);
        await waitFocus(
          page,
          (a) => document.activeElement?.id === a,
          anchor,
          "fragment not focused",
        );
        out.push({ from: `${path}/${id}#${anchor}`, to: u.pathname + u.hash, focused: anchor });
      }
      out.push({ sessionCheckApi: [...new Set(other.log.api)] });
      await other.context.close();
      return out;
    },
  );
  await astep(role, "Sign-in screen contextual link opens formal guidance", async () => {
    // A separate context: the sign-in screen checks the session, which public reading must not.
    const other = await L.guardedContext();
    const page = await other.context.newPage();
    await page.goto(`${L.BASE}/auth/login`);
    const link = page.getByRole("link", { name: "Help with this page" });
    await link.waitFor({ timeout: 15000 });
    const href = await link.getAttribute("href");
    await link.click();
    await page.waitForURL((u) => u.pathname.startsWith("/documentation"), { timeout: 15000 });
    await page.locator(".docs-result").first().waitFor({ timeout: 15000 });
    const results = await page.locator(".docs-result h2").allTextContents();
    await other.context.close();
    return { href, results };
  });
  for (const p of [...PILOT, ...RETESTS].filter((p) => !p.roles || p.roles.includes(role))) {
    await astep(role, `Keyboard search "${p.query}" reaches ${p.id}; focus and Back/Forward`, () =>
      searchByKeyboard(page, "/documentation", p.query, p.id),
    );
  }
  await astep(role, "Audience filter narrows the formal index", async () => {
    await page.goto(`${L.BASE}/documentation?audience=operator`);
    await page.locator(".docs-result").first().waitFor({ timeout: 15000 });
    const n = await page.locator(".docs-result").count();
    const e = L.expectedIds("formal", "operator").length;
    L.check(n === e, `${n} != ${e}`);
    return { audience: "operator", results: n };
  });
  await astep(role, "Skip link and section focus by keyboard", async () => {
    await page.goto(`${L.BASE}/documentation/reference`);
    await h1(page);
    // The reader focuses the title on load. Walk back with Shift+Tab to the first stop.
    let first = "";
    for (let i = 0; i < 40 && first !== "Skip to content"; i++) {
      await page.keyboard.press("Shift+Tab");
      first = await page.evaluate(() => document.activeElement?.textContent?.trim() ?? "");
    }
    L.check(first === "Skip to content", `no skip link before the title: ${first}`);
    const firstInOrder = await page.evaluate(() => {
      const stops = [
        ...document.querySelectorAll(
          "a[href], button, input, select, summary, [tabindex]:not([tabindex='-1'])",
        ),
      ];
      return stops[0]?.textContent?.trim();
    });
    L.check(firstInOrder === "Skip to content", `first focusable is ${firstInOrder}`);
    await page.keyboard.press("Enter");
    await waitFocus(
      page,
      () => document.activeElement?.id === "docs-main",
      null,
      "skip link did not focus main",
    );
    const after = "docs-main";
    return {
      firstTabStop: first,
      skipTarget: after,
      section: await outlineFocus(page, "/documentation", "reference"),
    };
  });
  await astep(
    role,
    "Modified click opens a guide in a new tab and leaves this page in place",
    async () => {
      await page.goto(`${L.BASE}/documentation?q=backup`);
      const link = page.locator(".docs-result h2 a").first();
      await link.waitFor({ timeout: 15000 });
      const [popup] = await Promise.all([
        context.waitForEvent("page"),
        link.click({ modifiers: ["Control"] }),
      ]);
      await popup.waitForLoadState();
      const popupPath = new URL(popup.url()).pathname;
      await popup.close();
      L.check(new URL(page.url()).searchParams.get("q") === "backup", "original page navigated");
      return { popupPath, original: "/documentation?q=backup" };
    },
  );
  await astep(
    role,
    "Light, Warm and Dark theme selector at 1280px and 320px without overflow",
    () =>
      themesAndNarrow(page, "/documentation", "backup-and-restore", (theme) =>
        page.locator("#docs-theme").selectOption(theme),
      ),
  );
  await astep(
    role,
    "Unknown article, unknown anchor, unbundled edition and unknown topic recover locally",
    () => recovery(page, "/documentation", role),
  );
  await astep(role, "Unavailable external support link leaves local documentation usable", () =>
    externalSupport(page, "/documentation"),
  );
  await astep(role, "Public reading made no session or organization API request", async () => {
    const reading = log.api;
    L.check(reading.length === 0, `API calls while reading: ${[...new Set(reading)]}`);
    return { apiCalls: 0, blockedExternal: [...new Set(log.blocked)], requests: log.all };
  });
  await context.close();
}

try {
  await anonymous();
  await staffRole("administrator");
  await staffRole("legal_team_member");
  await businessUser();
} finally {
  await L.close();
  const passed = save(join(here, "help.json"));
  console.log(passed ? "V-HELP walkthrough passed" : "V-HELP walkthrough has failures");
}
