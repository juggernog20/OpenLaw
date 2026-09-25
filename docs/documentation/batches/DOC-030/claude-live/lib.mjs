// Shared helpers for the DOC-030 claude-live walkthrough (connect-claude V-M41-C59 and
// deployment-configuration V-M41-PUBLIC) on the owned claudelive lab.
// The lab password comes only from LAB_PASSWORD (a fresh random value set in phase
// "passwords"; the seed password comes only from SEED_PASSWORD). Passwords, magic links,
// tokens and cookies are never written to a file under docs/.
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const HERE = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(HERE, "../../../../..");
export const REL = "docs/documentation/batches/DOC-030/claude-live";
export const PW_PATH = path.join(
  ROOT,
  "node_modules/.pnpm/playwright@1.63.0/node_modules/playwright/index.mjs",
);

export const LAB_DIR = path.join(ROOT, ".documentation-labs/claudelive");
export const LAB = {
  name: "claudelive",
  loopback: "http://127.0.0.1:43330",
  mail: "http://127.0.0.1:48450",
  project: "openlaw-docs-80ceef9e-claudelive",
};
// Phase 1 ran on https://omarchy.tail0a8904.ts.net:8443. claude.ai could not reach that port,
// so the coordinator moved the lab to 443 (see runs.origin443 in walkthrough.json).
export const PUBLIC = process.env.CLAUDELIVE_ORIGIN ?? "https://omarchy.tail0a8904.ts.net";
export const MCP_URL = `${PUBLIC}/mcp`;
export const PEOPLE = {
  administrator: { email: "daniel.okafor@helix.example", name: "Daniel Okafor" },
  legal_team_member: { email: "nadia.haddad@helix.example", name: "Nadia Haddad" },
  business_user: { email: "jonas.weber@helix.example", name: "Jonas Weber" },
};
export const CLAUDE = {
  name: "Claude",
  clientId: "https://claude.ai/oauth/mcp-oauth-client-metadata",
  redirect: "https://claude.ai/api/mcp/auth_callback",
};
export const CLAUDE_CODE = {
  name: "Claude Code",
  clientId: "https://claude.ai/oauth/claude-code-client-metadata",
};

export const pause = (ms) => new Promise((r) => setTimeout(r, ms));
export const flat = (s) => (s ?? "").replace(/\s+/g, " ").trim();
export const sha = (buf) => createHash("sha256").update(buf).digest("hex");
export const articleHash = (id) =>
  sha(readFileSync(path.join(ROOT, "docs/user-guides", `${id}.md`)));
export const stamp = new Date().toISOString().replace(/[-:T]/g, "").slice(4, 12);

export async function until(fn, message, timeout = 15000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    try {
      const v = await fn();
      if (v) return v;
    } catch {}
    await pause(300);
  }
  throw new Error(message);
}
export function expectThat(cond, message) {
  if (!cond) throw new Error(message);
}
/** Removes any secret-looking value before text reaches the log. */
export function scrub(text, secrets = []) {
  let t = String(text ?? "");
  for (const s of secrets.filter((x) => x && x.length >= 6)) t = t.split(s).join("<redacted>");
  return t
    .replace(/(token|code|session|cookie|secret|password)=([^&\s"']{6,})/gi, "$1=<redacted>")
    .replace(/Bearer\s+(?!resource_metadata)[A-Za-z0-9._~+/=-]{10,}/g, "Bearer <redacted>");
}

// ---------- JSON log ----------
const LOG = path.join(HERE, "walkthrough.json");
export function createLog(phase, meta = {}) {
  const log = existsSync(LOG)
    ? JSON.parse(readFileSync(LOG, "utf8"))
    : {
        kind: "independent-article-walkthrough",
        task: "DOC-030",
        group: "claude-live",
        issue: 1157,
        independentReview: true,
        walkthroughReviewer: "DOC-030 independent live-provider walkthrough agent (claude-live)",
        reviewerKind: "agent",
        appCommit: "067c1646829df85e62b809ee9157921e867c84e7",
        lab: LAB.name,
        environment: LAB.project,
        publicOrigin: PUBLIC,
        browser:
          "Playwright 1.63.0 Chromium from node_modules, headless, 1440x1000; one isolated browser context per identity",
        note: "Agent walkthrough. Container and network commands ran on the owned claudelive lab and this machine's Tailscale Funnel listener on 8443 only. The live-provider rows record the batch owner's own claude.ai session, as reported to this agent by the coordinator, and this agent's server-side reads of what that session did. Passwords, magic links, tokens and cookies are not recorded.",
        runs: {},
        steps: [],
        productBugs: [],
        guideFailures: [],
      };
  log.steps = log.steps.filter((s) => s.phase !== phase);
  log.runs[phase] = {
    ...meta,
    articleHashesAtStart: {
      "connect-claude": articleHash("connect-claude"),
      "deployment-configuration": articleHash("deployment-configuration"),
      "configure-mcp": articleHash("configure-mcp"),
    },
    startedAt: new Date().toISOString(),
    finishedAt: null,
  };
  const save = () => {
    log.runs[phase].finishedAt = new Date().toISOString();
    writeFileSync(LOG, `${JSON.stringify(log, null, 2)}\n`);
  };
  async function step(sel, name, expected, fn) {
    const entry = {
      phase,
      article: sel.article,
      scenario: sel.scenario,
      role: sel.role,
      method: sel.method ?? "browser-walkthrough",
      page: sel.page ?? null,
      step: name,
      expected,
      actual: null,
      result: "not-run",
      startedAt: new Date().toISOString(),
      at: null,
    };
    log.steps.push(entry);
    try {
      entry.actual = scrub(await fn(entry), sel.secrets);
      entry.result = entry.result === "not-run" ? "pass" : entry.result;
    } catch (error) {
      entry.actual = scrub(
        `Check did not complete: ${String(error?.message ?? error)
          .split("\n")
          .slice(0, 8)
          .join(" ")}`,
        sel.secrets,
      );
      entry.result = "fail";
    }
    entry.at = new Date().toISOString();
    console.log(
      `[${sel.role}] ${entry.result.toUpperCase()} ${sel.scenario}: ${name}${entry.result !== "pass" ? ` -- ${entry.actual}` : ""}`,
    );
    save();
    return entry;
  }
  return { log, save, step };
}

// ---------- the owned lab's Compose project ----------
export function compose(args, opts = {}) {
  return execFileSync(
    "docker",
    [
      "--context",
      "default",
      "compose",
      "--project-name",
      LAB.project,
      "--env-file",
      path.join(LAB_DIR, "source/.env"),
      "--file",
      path.join(LAB_DIR, "source/compose.yml"),
      "--file",
      path.join(LAB_DIR, "overlay.json"),
      ...args,
    ],
    { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], env: cleanEnv, ...opts },
  );
}
// As lab.mjs does: shell deployment variables must not reach Compose interpolation.
const cleanEnv = Object.fromEntries(
  ["PATH", "HOME", "DOCKER_CONFIG", "XDG_CONFIG_HOME", "XDG_RUNTIME_DIR"].flatMap((k) =>
    process.env[k] === undefined ? [] : [[k, process.env[k]]],
  ),
);
export function sh(cmd, args) {
  try {
    return { code: 0, out: execFileSync(cmd, args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }) };
  } catch (e) {
    return { code: e.status ?? 1, out: `${e.stdout ?? ""}${e.stderr ?? ""}` };
  }
}
export async function waitHealthy(base = LAB.loopback, timeout = 180000) {
  await until(
    async () => (await fetch(`${base}/readyz`).catch(() => null))?.ok,
    `lab at ${base} did not answer /readyz`,
    timeout,
  );
}

// ---------- browser ----------
export async function browserSignIn(page, person, password = process.env.LAB_PASSWORD) {
  await page.goto(`${PUBLIC}/auth/login`);
  await page.getByLabel("Email").fill(person.email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.waitForURL((u) => !u.pathname.startsWith("/auth/"), { timeout: 30000 });
}
export async function api(page, method, url, data) {
  const res = await page.request.fetch(`${PUBLIC}${url}`, {
    method,
    data,
    headers: { origin: PUBLIC, ...(data ? { "content-type": "application/json" } : {}) },
  });
  let body = null;
  try {
    body = await res.json();
  } catch {}
  return { status: res.status(), body };
}

// ---------- Mailpit ----------
async function mailpit(p) {
  const r = await fetch(`${LAB.mail}${p}`);
  if (!r.ok) throw new Error(`Mailpit ${r.status} for ${p}`);
  return r.json();
}
export async function waitForMail(address, subjectRe, since, timeoutMs = 60000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const found = await mailpit(
      `/api/v1/search?query=${encodeURIComponent(`to:"${address}"`)}&limit=40`,
    );
    const match = (found.messages ?? []).find(
      (m) =>
        new Date(m.Created).getTime() >= since - 1500 && (!subjectRe || subjectRe.test(m.Subject)),
    );
    if (match) {
      const message = await mailpit(`/api/v1/message/${match.ID}`);
      return { subject: message.Subject, text: message.Text ?? "" };
    }
    await pause(800);
  }
  return null;
}
