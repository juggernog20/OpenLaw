// Shared helpers for the DOC-030 contracts-c independent walkthrough.
// Copied from the DOC-030 contracts-a api.mjs pattern (itself from DOC-029): password sign-in,
// a fresh Business User magic link read from the lab Mailpit, one browser context per identity,
// and a JSON step log. API calls are used only for fixture setup, a second actor's competing
// write, and state reads. Every guide step runs in the browser as the named role.
// The seed demo password comes from LAB_PASSWORD. Links, cookies and mail bodies are never saved.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const here = path.dirname(fileURLToPath(import.meta.url));
export const root = path.resolve(here, "../../../../..");
export const PASSWORD = process.env.LAB_PASSWORD;
if (!PASSWORD)
  throw new Error("Set LAB_PASSWORD to the seed demo password documented in VALIDATION.md.");
const PW = path.join(root, "node_modules/.pnpm/playwright@1.63.0/node_modules/playwright/index.mjs");
export const { chromium } = await import(PW);

export function labInfo(name) {
  return JSON.parse(readFileSync(path.join(root, `.documentation-labs/${name}/lab.json`), "utf8"));
}
export const sha = (buf) => createHash("sha256").update(buf).digest("hex");
export const articleHash = (id) =>
  sha(readFileSync(path.join(root, `docs/user-guides/${id}.md`)));
export const articleText = (id) =>
  readFileSync(path.join(root, `docs/user-guides/${id}.md`), "utf8");

export const PEOPLE = {
  daniel: { email: "daniel.okafor@helix.example", name: "Daniel Okafor", role: "administrator" },
  nadia: { email: "nadia.haddad@helix.example", name: "Nadia Haddad", role: "legal_team_member" },
  priya: { email: "priya.raman@helix.example", name: "Priya Raman", role: "legal_team_member" },
  marcus: {
    email: "marcus.oyelaran@helix.example",
    name: "Marcus Oyelaran",
    role: "legal_team_member",
  },
  ravi: { email: "ravi.menon@helix.example", name: "Ravi Menon", role: "business_user" },
  // Seeded Business Users no other DOC-030 group names, so the shared sign-in link budget
  // (3 per address in 15 minutes) on work2 stays free for the other agents.
  ade: { email: "ade.balogun@helix.example", name: "Ade Balogun", role: "business_user" },
  mei: { email: "mei.tanaka@helix.example", name: "Mei Tanaka", role: "business_user" },
};

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export function expectThat(condition, message) {
  if (!condition) throw new Error(message);
}
export const tidy = (v) =>
  typeof v === "string" ? v.replace(/\s+/g, " ").trim() : Array.isArray(v) ? v.map(tidy) : v;
export const q = (s) => JSON.stringify(tidy(s));
export async function until(fn, message, timeout = 15000, interval = 400) {
  const end = Date.now() + timeout;
  let last;
  while (Date.now() < end) {
    last = await fn();
    if (last) return last;
    await sleep(interval);
  }
  throw new Error(`timed out: ${message}`);
}
export function utcDatePlus(iso, days) {
  const d = new Date(iso);
  const base = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
  return new Date(base + days * 86400000).toISOString().slice(0, 10);
}
export const stampNow = () =>
  new Date()
    .toISOString()
    .replace(/[-:TZ.]/g, "")
    .slice(0, 14);

/**
 * The group log. One file, walkthrough.json, keeps a section per article and phase; a run
 * replaces only the sections it writes. Links and tokens never reach it.
 */
export function recorder(file, section, meta) {
  const all = existsSync(file)
    ? JSON.parse(readFileSync(file, "utf8"))
    : { kind: "independent-article-walkthrough", group: "contracts-c", sections: {} };
  const results = { ...meta, startedAt: new Date().toISOString(), finishedAt: null, steps: [] };
  all.sections[section] = results;
  const save = () => {
    results.finishedAt = new Date().toISOString();
    all.updatedAt = results.finishedAt;
    writeFileSync(
      file,
      JSON.stringify(all, null, 2).replace(/token=[^&\s"\\]+/g, "token=[redacted]") + "\n",
    );
  };
  const blocked = new Set();
  let failures = 0;
  async function step(o, fn) {
    const entry = {
      article: o.article,
      scenario: o.scenario,
      role: o.role,
      method: "browser-walkthrough",
      actors: o.actors,
      page: o.page,
      action: o.action,
      expected: o.expected,
      startedAt: new Date().toISOString(),
      finishedAt: null,
      actual: null,
      result: "not-run",
    };
    results.steps.push(entry);
    const key = `${o.article}:${o.role}`;
    if (blocked.has(key) && !o.independent) {
      entry.actual = "Not run: an earlier step for this article and role failed.";
      entry.finishedAt = entry.startedAt;
      console.log(`[${o.article}/${o.role}] NOT-RUN ${o.action}`);
      save();
      return false;
    }
    try {
      entry.actual = await fn();
      entry.result = "pass";
    } catch (error) {
      failures += 1;
      if (!o.independent) blocked.add(key);
      entry.actual = `Check did not complete: ${String(error?.message ?? error)
        .split("\n")
        .slice(0, 6)
        .join(" ")}`;
      entry.result = "fail";
    }
    entry.finishedAt = new Date().toISOString();
    console.log(
      `[${o.article}/${o.role}] ${entry.result.toUpperCase()} ${o.action}\n    ${entry.actual}`,
    );
    save();
    return entry.result === "pass";
  }
  return { results, step, save, failures: () => failures };
}

export function session(BASE, MAIL) {
  let browser;
  const viewport = { width: 1366, height: 1100 };
  function wrap(ctx, page, person) {
    page.on("dialog", (d) => (d.type() === "beforeunload" ? d.accept() : d.dismiss()));
    const api = async (method, p, data, extra = {}) => {
      const r = await page.request.fetch(`${BASE}/api/v1${p}`, {
        method,
        data,
        headers: { origin: BASE },
        failOnStatusCode: false,
        ...extra,
      });
      let json = null;
      try {
        json = await r.json();
      } catch {}
      return { status: r.status(), json };
    };
    return { ctx, context: ctx, page, api, person, ...person };
  }
  async function launch() {
    browser = await chromium.launch({ headless: true });
    return browser;
  }
  async function close() {
    await browser?.close();
  }
  async function password(person) {
    const ctx = await browser.newContext({ viewport });
    const page = await ctx.newPage();
    await page.goto(`${BASE}/auth/login`);
    await page.getByLabel("Email").fill(person.email);
    await page.getByLabel("Password").fill(PASSWORD);
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await page.waitForURL((u) => !u.pathname.startsWith("/auth"), { timeout: 30000 });
    return wrap(ctx, page, person);
  }
  /**
   * A Business User signs in from the login page with a fresh link read from Mailpit.
   * On a 429 (the shared budget is 3 per address and 30 per client in 15 minutes) it waits a
   * minute and asks again. STATE_DIR may name a folder outside docs/ where the signed-in state
   * is kept between development runs.
   */
  async function magic(person) {
    const stateFile = process.env.STATE_DIR
      ? path.join(process.env.STATE_DIR, `${new URL(BASE).port}-${person.email}.json`)
      : null;
    if (stateFile && existsSync(stateFile)) {
      const ctx = await browser.newContext({ viewport, storageState: stateFile });
      const page = await ctx.newPage();
      const me = await page.request.get(`${BASE}/api/v1/me`, { failOnStatusCode: false });
      if (me.ok() && (await me.json()).user?.email === person.email) {
        await page.goto(`${BASE}/portal`);
        return wrap(ctx, page, person);
      }
      await ctx.close();
    }
    const ctx = await browser.newContext({ viewport });
    const page = await ctx.newPage();
    const deadline = Date.now() + 20 * 60_000;
    while (Date.now() < deadline) {
      const since = Date.now() - 1500;
      await page.goto(`${BASE}/auth/login`);
      await page.getByRole("button", { name: "Email me a sign-in link" }).click();
      await page.getByLabel("Email").fill(person.email);
      const sent = page.waitForResponse(
        (r) => r.request().method() === "POST" && /magic-link/.test(new URL(r.url()).pathname),
      );
      await page
        .getByRole("button", { name: /Send|Email me/ })
        .last()
        .click();
      const status = (await sent).status();
      if (status === 429) {
        console.log(`sign-in link for ${person.email}: 429, waiting 60 s`);
        await sleep(60_000);
        continue;
      }
      let href = null;
      for (let i = 0; i < 90 && !href; i++) {
        await sleep(500);
        const search = await fetch(
          `${MAIL}/api/v1/search?query=${encodeURIComponent(`to:"${person.email}"`)}`,
        ).then((r) => r.json());
        for (const m of search.messages ?? []) {
          if (new Date(m.Created).getTime() < since) continue;
          const message = await fetch(`${MAIL}/api/v1/message/${m.ID}`).then((r) => r.json());
          const match = message.Text?.match(/https?:\/\/[^\s)>\]]+magic[^\s)>\]]*/i);
          if (match) {
            const url = new URL(match[0].replace(/[.,]+$/, ""));
            const lab = new URL(BASE);
            url.protocol = lab.protocol;
            url.host = lab.host;
            href = url.toString();
            break;
          }
        }
      }
      if (!href) continue;
      await page.goto(href);
      await page.waitForLoadState("networkidle").catch(() => {});
      const me = await page.request.get(`${BASE}/api/v1/me`, { failOnStatusCode: false });
      if (me.ok()) {
        if (stateFile) await ctx.storageState({ path: stateFile });
        return wrap(ctx, page, person);
      }
      await sleep(30_000);
    }
    throw new Error(`magic-link sign-in failed for ${person.email}`);
  }
  return { launch, close, password, magic };
}

/** A one-page PDF with fictional text. `extra` is appended as more text lines. */
export function pdf(text, extra = []) {
  const lines = [text, ...extra].map((t) => t.replace(/[()\\]/g, ""));
  const objs = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
    null,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  const stream = lines.map((l, i) => `BT /F1 12 Tf 72 ${720 - i * 20} Td (${l}) Tj ET`).join("\n");
  objs[3] = `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`;
  let out = "%PDF-1.4\n";
  const offs = [];
  objs.forEach((o, i) => {
    offs.push(out.length);
    out += `${i + 1} 0 obj\n${o}\nendobj\n`;
  });
  const xref = out.length;
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${offs.map((o) => `${String(o).padStart(10, "0")} 00000 n \n`).join("")}`;
  out += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, "latin1");
}
