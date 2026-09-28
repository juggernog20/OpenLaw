// Shared helpers for the DOC-032 access independent walkthrough, adapted from
// DOC-030/access/lib.mjs, DOC-030/access-2/lib.mjs and DOC-032/admin-org/lib.mjs.
// The lab is the owned lab `accs` (.documentation-labs/accs/lab.json), built from 4ca41822.
// The seed demo password comes from LAB_PASSWORD. Links, cookies, secrets and mail bodies stay in memory.
import { createHmac } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "../../../../../node_modules/.pnpm/playwright@1.63.0/node_modules/playwright/index.mjs";
import { Session } from "../../../../../scripts/seed/client.mjs";

export const here = path.dirname(fileURLToPath(import.meta.url));
export const root = path.resolve(here, "../../../../..");
export const LAB = JSON.parse(
  readFileSync(path.join(root, ".documentation-labs/accs/lab.json"), "utf8"),
);
export const BASE = LAB.appUrl;
export const MAIL = LAB.mailUrl;
export const PROJECT = LAB.project;
export const PASSWORD = process.env.LAB_PASSWORD;
if (!PASSWORD)
  throw new Error("Set LAB_PASSWORD to the seed demo password documented in VALIDATION.md.");
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export const SEED = {
  daniel: { email: "daniel.okafor@helix.example", name: "Daniel Okafor" },
  devon: { email: "devon@helix.example", name: "Devon Calloway" },
  nadia: { email: "nadia.haddad@helix.example", name: "Nadia Haddad" },
  jonas: { email: "jonas.weber@helix.example", name: "Jonas Weber" },
  amara: { email: "amara.nwosu@helix.example", name: "Amara Nwosu" },
  ravi: { email: "ravi.menon@helix.example", name: "Ravi Menon" },
};

// ---------- OIDC fixture (DOC-032/admin-org/oidc-fixture.mjs, started by phase.sh oidc) ----------
export const OIDC_IP = (() => {
  try {
    return execFileSync(
      "docker",
      [
        "--context",
        "default",
        "inspect",
        `${PROJECT}-oidc-1`,
        "--format",
        "{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}",
      ],
      { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] },
    ).trim();
  } catch {
    return "";
  }
})();
const OIDC_CONTROL = OIDC_IP ? `http://${OIDC_IP}:8081/identity` : null;
/** Selects the fictional identity the next token and userinfo assert. */
export async function idpIdentity(sub, email, name) {
  if (!OIDC_CONTROL) throw new Error("The accs OIDC fixture is not running");
  return (
    await fetch(OIDC_CONTROL, { method: "POST", body: JSON.stringify({ sub, email, name }) })
  ).json();
}
export async function lastIssuer() {
  return (await (await fetch(OIDC_CONTROL)).json()).lastIssuer;
}

// ---------- browser ----------
let browser;
export async function launch() {
  // The fixture is "oidc" on the lab network; the browser resolves that name to the container.
  const rules = ["MAP localhost 127.0.0.1", ...(OIDC_IP ? [`MAP oidc ${OIDC_IP}`] : [])];
  browser ??= await chromium.launch({
    headless: true,
    args: [`--host-resolver-rules=${rules.join(",")}`],
  });
  return browser;
}
export async function closeBrowser() {
  await browser?.close();
  browser = undefined;
}
export async function newContext() {
  const b = await launch();
  const context = await b.newContext({
    viewport: { width: 1440, height: 900 },
    acceptDownloads: true,
  });
  const page = await context.newPage();
  return { context, page };
}

// ---------- Mailpit ----------
export async function mailSince(email, sinceMs, subjectRe) {
  const r = await fetch(
    `${MAIL}/api/v1/search?query=${encodeURIComponent(`to:"${email}"`)}&limit=50`,
  ).then((x) => x.json());
  return (r.messages ?? [])
    .filter((m) => new Date(m.Created).getTime() >= sinceMs - 1500)
    .filter((m) => !subjectRe || subjectRe.test(m.Subject))
    .sort((a, b) => new Date(b.Created) - new Date(a.Created));
}
/** Waits for a new message; returns {subject, link, text, html} with the link moved to the lab host. Never persisted. */
export async function waitForLink(email, sinceMs, { subjectRe, linkRe, timeoutMs = 30000 } = {}) {
  const until = Date.now() + timeoutMs;
  while (Date.now() < until) {
    const msgs = await mailSince(email, sinceMs, subjectRe);
    if (msgs.length) {
      const m = await fetch(`${MAIL}/api/v1/message/${msgs[0].ID}`).then((x) => x.json());
      const links = (m.Text ?? "").match(/https?:\/\/[^\s)>\]"]+/g) ?? [];
      const pick = links.find((l) => !linkRe || linkRe.test(l)) ?? null;
      let link = null;
      if (pick) {
        const u = new URL(pick.replace(/[.,]+$/, ""));
        const lab = new URL(BASE);
        u.protocol = lab.protocol;
        u.host = lab.host;
        link = u.toString();
      }
      return {
        subject: m.Subject,
        link,
        count: msgs.length,
        text: (m.Text ?? "").replace(/https?:\/\/\S+/g, "<link>"),
        html: (m.HTML ?? "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " "),
      };
    }
    await sleep(500);
  }
  return null;
}

// ---------- TOTP (RFC 6238, SHA-1, 30 s, 6 digits) ----------
function base32(secret) {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = "";
  for (const c of secret.replace(/[\s=-]/g, "").toUpperCase()) {
    const v = alphabet.indexOf(c);
    if (v < 0) throw new Error("secret is not base32");
    bits += v.toString(2).padStart(5, "0");
  }
  const bytes = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) bytes.push(parseInt(bits.slice(i, i + 8), 2));
  return Buffer.from(bytes);
}
export function totp(secret, offsetSteps = 0) {
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 1000 / 30) + offsetSteps));
  const h = createHmac("sha1", base32(secret)).update(buf).digest();
  const o = h[h.length - 1] & 0xf;
  const n = ((h[o] & 0x7f) << 24) | (h[o + 1] << 16) | (h[o + 2] << 8) | h[o + 3];
  return String(n % 1000000).padStart(6, "0");
}
export function wrongCode(secret) {
  const valid = new Set([-1, 0, 1].map((o) => totp(secret, o)));
  let n = 123456;
  while (valid.has(String(n))) n++;
  return String(n);
}
export async function freshStep(margin = 8) {
  const left = 30 - (Math.floor(Date.now() / 1000) % 30);
  if (left < margin) await sleep(left * 1000 + 500);
}
// A TOTP code is accepted once per 30-second step; wait for a new step before reusing a secret.
const lastStep = new Map();
export async function code(secret) {
  await freshStep();
  let s = Math.floor(Date.now() / 30000);
  if (lastStep.get(secret) === s) {
    await sleep(30000 - (Date.now() % 30000) + 600);
    s = Math.floor(Date.now() / 30000);
  }
  lastStep.set(secret, s);
  return totp(secret);
}

// ---------- API sessions (fixtures, a second actor's write, setting changes and state reads) ----------
export async function apiSession(email, password = PASSWORD) {
  const s = new Session(email, BASE);
  await s.request("POST", "/api/auth/sign-in/email", {
    json: { email, password },
    headers: { origin: BASE },
  });
  return s;
}
export async function call(s, method, p, json) {
  try {
    const r = await s.request(method, `/api/v1${p}`, {
      ...(json === undefined ? {} : { json }),
      headers: { origin: BASE },
    });
    return { status: r.status, body: r.body };
  } catch (e) {
    return { status: e.status ?? 0, body: e.body ?? String(e.message) };
  }
}
export async function upload(s, p, name, content, mimeType = "text/plain") {
  const form = new FormData();
  form.append("file", new Blob([content], { type: mimeType }), name);
  try {
    const r = await s.request("POST", `/api/v1${p}`, { form, headers: { origin: BASE } });
    return { status: r.status, body: r.body };
  } catch (e) {
    return { status: e.status ?? 0, body: e.body };
  }
}
/** Browser-context API read with the page's own session. */
export async function pageApi(page, method, p, data) {
  const r = await page.request.fetch(`${BASE}/api/v1${p}`, {
    method,
    headers: { origin: BASE },
    failOnStatusCode: false,
    ...(data === undefined ? {} : { data }),
  });
  let body = null;
  try {
    body = await r.json();
  } catch {}
  return { status: r.status(), body };
}
export function must(r, what) {
  if (r.status >= 300)
    throw new Error(`${what}: ${r.status} ${JSON.stringify(r.body).slice(0, 300)}`);
  return r.body;
}

/** Database access on the owned lab: state reads, and fixture preparation or fault injection that the step names. */
export function sql(query) {
  return execFileSync(
    "docker",
    ["exec", `${PROJECT}-postgres-1`, "psql", "-U", "openlaw", "-d", "openlaw", "-At", "-c", query],
    { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 },
  ).trim();
}

// ---------- page helpers ----------
export async function text(locator) {
  return (await locator.innerText().catch(() => "")).replace(/\s+/g, " ").trim();
}
export async function settle(page) {
  await page.waitForLoadState("networkidle", { timeout: 15000 }).catch(() => {});
  await sleep(500);
}
export const seen = (locator, timeout = 10000) =>
  locator
    .first()
    .waitFor({ timeout })
    .then(
      () => true,
      () => false,
    );
export async function buttons(page) {
  return (await page.locator("main").getByRole("button").allInnerTexts())
    .map((x) => x.trim())
    .filter(Boolean);
}
export async function h1(page) {
  const heading = page.getByRole("heading", { level: 1 }).first();
  await heading.waitFor({ timeout: 15000 });
  return (await heading.innerText()).trim();
}
export async function applet(page, name) {
  const panel = page.getByRole("complementary", { name, exact: true });
  if (!(await panel.isVisible().catch(() => false))) {
    await page
      .getByRole("toolbar", { name: "Applets" })
      .getByRole("button", { name: new RegExp(`^${name}\\b`) })
      .first()
      .click();
  }
  await panel.waitFor({ timeout: 10000 });
  await sleep(700);
  return panel;
}
export async function rosterRows(panel) {
  return (await panel.getByRole("listitem").allInnerTexts()).map((t) =>
    t.replace(/\s+/g, " ").trim(),
  );
}
export function check(condition, message) {
  if (!condition) throw new Error(message);
}
