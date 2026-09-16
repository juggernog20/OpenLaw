// DOC-029 analysis-standin, round 2 compatibility replay: copy of analysis-standin/harness-r1.mjs. Only the default lab project and the repository root depth changed.
// Credentials and stand-in keys come only from the environment. Nothing secret is
// written to the results.
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
export const root = path.resolve(here, "../../../../../..");
const pw = path.join(
  root,
  "node_modules/.pnpm/playwright@1.63.0/node_modules/playwright/index.mjs",
);
export const { chromium } = await import(pw);
export const JSZip = (
  await import(path.join(root, "node_modules/.pnpm/jszip@3.10.2/node_modules/jszip/lib/index.js"))
).default;

export const BASE = process.env.LAB_APP_URL ?? "http://127.0.0.1:23313";
export const MAIL = process.env.LAB_MAIL_URL ?? "http://127.0.0.1:23413";
export const PROJECT = process.env.LAB_PROJECT ?? "openlaw-docs-41255c61-analysis-r2";
export const PASSWORD = process.env.LAB_PASSWORD;
export const STANDIN = process.env.STANDIN_CONTROL_URL;
const CONTROL_TOKEN = process.env.STANDIN_CONTROL_TOKEN;
export const STANDIN_KEY = process.env.STANDIN_API_KEY;
export const MODEL = "doc029-standin-model";

export const PEOPLE = {
  administrator: { email: "daniel.okafor@helix.example", name: "Daniel Okafor" },
  legal_team_member: { email: "nadia.haddad@helix.example", name: "Nadia Haddad" },
  business_user: { email: "jonas.weber@helix.example", name: "Jonas Weber" },
};

export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
export const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
export function expectThat(condition, message) {
  if (!condition) throw new Error(message);
}
export async function until(fn, message, timeout = 60000, every = 500) {
  const end = Date.now() + timeout;
  let last;
  while (Date.now() < end) {
    last = await fn();
    if (last) return last;
    await sleep(every);
  }
  throw new Error(`timed out: ${message}`);
}

export function makeRecorder(meta) {
  const results = { ...meta, startedAt: new Date().toISOString(), steps: [], finishedAt: null };
  async function step(article, role, name, expected, fn) {
    const entry = {
      article,
      role,
      step: name,
      expected,
      actual: null,
      result: "not-run",
      startedAt: new Date().toISOString(),
      at: null,
    };
    results.steps.push(entry);
    try {
      entry.actual = await fn();
      entry.result = "pass";
    } catch (error) {
      entry.actual = `Check did not complete: ${String(error?.message ?? error)
        .split("\n")
        .slice(0, 6)
        .join(" ")}`;
      entry.result = "fail";
    }
    entry.at = new Date().toISOString();
    console.log(
      `[${article}/${role}] ${entry.result.toUpperCase()} ${name}${entry.result === "fail" ? `\n   ${entry.actual}` : ""}`,
    );
    return entry;
  }
  return { results, step };
}

export async function standin(pathname, body) {
  const response = await fetch(`${STANDIN}${pathname}`, {
    method: body === undefined ? "GET" : "POST",
    headers: { "x-control-token": CONTROL_TOKEN, "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!response.ok) throw new Error(`stand-in control ${pathname} answered ${response.status}`);
  return response.json();
}

export function docker(...args) {
  return execFileSync("docker", ["--context", "default", ...args], { encoding: "utf8" }).trim();
}
export const pauseWorker = () => docker("pause", `${PROJECT}-worker-1`);
export const resumeWorker = () => docker("unpause", `${PROJECT}-worker-1`);

export async function signIn(browser, role) {
  const person = PEOPLE[role];
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
    acceptDownloads: true,
  });
  const page = await context.newPage();
  if (role === "business_user") {
    await page.goto(`${BASE}/auth/login`);
    const before = Date.now();
    const response = await context.request.post(`${BASE}/api/v1/auth/magic-link`, {
      headers: { origin: BASE },
      data: { email: person.email, group: "business" },
    });
    expectThat(response.ok(), `magic link request answered ${response.status()}`);
    const link = await until(
      async () => {
        const search = await fetch(
          `${MAIL}/api/v1/search?query=${encodeURIComponent(`to:"${person.email}"`)}`,
        ).then((r) => r.json());
        for (const message of search.messages ?? []) {
          if (new Date(message.Created).valueOf() < before - 2000) continue;
          const full = await fetch(`${MAIL}/api/v1/message/${message.ID}`).then((r) => r.json());
          const match = full.Text.match(/https?:\/\/\S+(?:magic-link|verify)\S*/);
          if (match) return match[0];
        }
        return null;
      },
      "magic link mail",
      30000,
      1000,
    );
    const url = new URL(link);
    const lab = new URL(BASE);
    url.protocol = lab.protocol;
    url.host = lab.host;
    await page.goto(url.toString());
    await page.waitForLoadState("networkidle");
  } else {
    await page.goto(`${BASE}/auth/login`);
    await page.getByLabel("Email").fill(person.email);
    await page.getByLabel("Password").fill(PASSWORD);
    await page.getByRole("button", { name: "Sign in" }).click();
    await page
      .getByRole("banner")
      .getByRole("button", { name: person.name })
      .waitFor({ timeout: 30000 });
  }
  const api = makeApi(context);
  return { context, page, api, role, person };
}

export function makeApi(context) {
  async function call(method, url, options = {}) {
    const response = await context.request.fetch(`${BASE}/api/v1${url}`, {
      method,
      headers: { origin: BASE, ...(options.headers ?? {}) },
      ...(options.data !== undefined ? { data: options.data } : {}),
      ...(options.multipart ? { multipart: options.multipart } : {}),
    });
    const text = await response.text();
    let json = null;
    try {
      json = JSON.parse(text);
    } catch {
      json = null;
    }
    return { status: response.status(), json, text };
  }
  return {
    get: (url) => call("GET", url),
    post: (url, data) => call("POST", url, { data: data ?? {} }),
    put: (url, data) => call("PUT", url, { data }),
    patch: (url, data) => call("PATCH", url, { data }),
    del: (url) => call("DELETE", url),
    upload: (url, file, fields = {}) =>
      call("POST", url, {
        multipart: {
          ...fields,
          file: { name: file.name, mimeType: file.mimeType, buffer: file.buffer },
        },
      }),
    bytes: async (url) => {
      const response = await context.request.get(`${BASE}/api/v1${url}`);
      return { status: response.status(), body: await response.body() };
    },
  };
}

export async function ok(promise, expected = [200, 201, 202]) {
  const answer = await promise;
  if (!expected.includes(answer.status))
    throw new Error(`API answered ${answer.status}: ${answer.text.slice(0, 300)}`);
  return answer.json;
}

/** A text PDF made by headless Chromium from simple HTML paragraphs. */
export async function makePdf(browser, name, paragraphs, title = name) {
  const context = await browser.newContext();
  const page = await context.newPage();
  const html = `<!doctype html><html><head><title>${title}</title></head><body style="font-family: serif; font-size: 13pt">${paragraphs.map((p) => `<p>${p}</p>`).join("")}</body></html>`;
  await page.setContent(html);
  const buffer = await page.pdf({ format: "A4" });
  await context.close();
  return { name, mimeType: "application/pdf", buffer };
}

/** A minimal Word document with one run per paragraph. */
export async function makeDocx(name, paragraphs) {
  const zip = new JSZip();
  const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  zip.file(
    "[Content_Types].xml",
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>',
  );
  zip.file(
    "_rels/.rels",
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>',
  );
  zip.file(
    "word/document.xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${paragraphs
      .map((p) => `<w:p><w:r><w:t xml:space="preserve">${esc(p)}</w:t></w:r></w:p>`)
      .join("")}<w:sectPr/></w:body></w:document>`,
  );
  const buffer = await zip.generateAsync({ type: "nodebuffer" });
  return {
    name,
    mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    buffer,
  };
}

export async function docxTrackedRuns(buffer) {
  const zip = await JSZip.loadAsync(buffer);
  const xml = await zip.file("word/document.xml").async("string");
  const texts = (tag, inner) =>
    [...xml.matchAll(new RegExp(`<w:${tag}\\b[^>]*>([\\s\\S]*?)</w:${tag}>`, "g"))]
      .map((m) =>
        [...m[1].matchAll(new RegExp(`<w:${inner}[^>]*>([^<]*)</w:${inner}>`, "g"))]
          .map((t) => t[1])
          .join(""),
      )
      .filter(Boolean);
  return { ins: texts("ins", "t"), del: texts("del", "delText") };
}
