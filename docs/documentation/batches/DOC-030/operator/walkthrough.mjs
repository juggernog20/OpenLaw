// DOC-030 independent walkthrough, group "operator": deployment-configuration.md.
// Scenarios V-C45 (operator, container-operation), V-C45-advanced-settings (administrator,
// browser-walkthrough and container-operation), V-M40-LAN (operator and administrator,
// container-operation) and V-M41-PUBLIC (operator and administrator, container-operation; the
// live-provider-check is pending a joint session). Pinned app commit 067c1646.
//
// Based on docs/documentation/batches/DOC-029/operator-install/walkthrough-r2-2.mjs. Run one phase
// at a time from the documentation worktree root:
//   node docs/documentation/batches/DOC-030/operator/walkthrough.mjs <phase>
//
// Private state (the installation directory and its .env, fixture passwords, the fictional CA key)
// lives outside the repository under ~/.cache/openlaw-doc030/operator-cfg. The sanitized log is
// walkthrough.json beside this script. Every attempt is appended, so a failed step stays in the
// log next to its retry.
import { createRequire } from "node:module";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createHash, randomBytes } from "node:crypto";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "../../../../..");
const require = createRequire(path.join(root, "package.json"));
const pnpm = (p) => path.join(root, "node_modules/.pnpm", p);
const { chromium, request: pwRequest } = require(
  pnpm("playwright@1.63.0/node_modules/playwright/index.js"),
);

export const COMMIT = "067c1646829df85e62b809ee9157921e867c84e7";
const WORK = path.join(os.homedir(), ".cache/openlaw-doc030/operator-cfg");
const PRIVATE = path.join(WORK, "private");
const INSTALL = path.join(WORK, "cfg1", "openlaw");
const FIX = path.join(WORK, "fx");
const PROJECT = "openlaw-doc030-cfg-1";
const FX_PROJECT = "openlaw-doc030-cfg-fx";
const APP_IMAGE_ID = "sha256:506e20d184bebdc0cb91f7035e470671fd2fd71f614a49d90b7b8a5948338fba";
const ENGINE_IMAGE_ID = "sha256:eabde72b06b74e47fc40f4932468164cfa76b8587150870801038c80bd117e7e";
const APP_TAG = `openlaw-doc030-cfg-app:${COMMIT}`;
const ENGINE_TAG = `openlaw-doc030-cfg-engine:${COMMIT}`;
const APP_PORT = 25710;
const PROXY_PORT = 25711;
const CADDY_HTTP_PORT = 25712;
const MAIL_UI = "http://127.0.0.1:25713";
const MINIO_HOST = "http://127.0.0.1:25714";
const AZURITE_HOST = "http://127.0.0.1:25715";
const LAN_PORT = 25716;
const LAN_HTTP_PORT = 25717;
const LAN_IP = "192.168.0.59";
const TAILNET_IP = "100.68.96.37";
const LAN_HOST = "openlaw-cfg.company.example";
const LAN_ORIGIN = `https://${LAN_HOST}:${LAN_PORT}`;
const LAN_PLAIN_ORIGIN = `http://${LAN_IP}:${LAN_HTTP_PORT}`;
const LOCAL = `http://127.0.0.1:${APP_PORT}`;
const ORIGIN = `https://openlaw-cfg.localhost:${PROXY_PORT}`;
const LOG = path.join(here, "walkthrough.json");
const REVIEWER = "DOC-030 independent walkthrough agent (operator)";
const ADMIN = { name: "Avery Morgan", email: "avery.morgan@doc030-cfg.example" };
const COLLEAGUE = { name: "Rowan Operator", email: "rowan.operator@doc030-cfg.example" };

// Stand-in for internal DNS: Node-side requests resolve the private hostname to the address the
// current phase binds the private proxy on, as the browser does through --host-resolver-rules.
let lanBind = LAN_IP;
{
  const dns = require("node:dns");
  const original = dns.lookup;
  dns.lookup = function (hostname, options, callback) {
    if (hostname === LAN_HOST) {
      const cb = typeof options === "function" ? options : callback;
      const all = typeof options === "object" && options?.all;
      return process.nextTick(() =>
        all ? cb(null, [{ address: lanBind, family: 4 }]) : cb(null, lanBind, 4),
      );
    }
    return original.call(this, hostname, options, callback);
  };
}

mkdirSync(PRIVATE, { recursive: true, mode: 0o700 });
const STATE_FILE = path.join(PRIVATE, "state.json");
const state = existsSync(STATE_FILE) ? JSON.parse(readFileSync(STATE_FILE, "utf8")) : {};
function saveState() {
  writeFileSync(STATE_FILE, JSON.stringify(state, null, 2), { mode: 0o600 });
}
function secret(name, bytes = 18) {
  if (!state[name]) {
    state[name] = randomBytes(bytes).toString("base64url");
    saveState();
  }
  return state[name];
}

// ---------------------------------------------------------------- log

const log = existsSync(LOG)
  ? JSON.parse(readFileSync(LOG, "utf8"))
  : {
      batch: "DOC-030",
      group: "operator",
      article: "deployment-configuration",
      basedOn: "docs/documentation/batches/DOC-029/operator-install/walkthrough-r2-2.mjs",
      reviewer: REVIEWER,
      reviewerKind: "agent",
      appCommit: COMMIT,
      projects: [PROJECT, FX_PROJECT],
      origin: ORIGIN,
      privateOrigin: LAN_ORIGIN,
      localAddress: LOCAL,
      note: "Container-operation and browser walkthrough by an agent, not a human operator study. Commands ran against disposable Compose projects owned by this walkthrough, built from no new images: the app and engine images are the ones lab.mjs built from the pinned commit, tagged for this project. Secrets, cookies, API keys, mail bodies and links are not recorded; command output is reduced to exit codes and selected sanitized lines.",
      images: {},
      articleHashes: {},
      runs: [],
      steps: [],
    };
const run = { phase: process.argv[2], startedAt: new Date().toISOString(), completedAt: null };
log.runs.push(run);
log.articleHashes["deployment-configuration"] = createHash("sha256")
  .update(readFileSync(path.join(root, "docs/user-guides/deployment-configuration.md")))
  .digest("hex");
function saveLog() {
  writeFileSync(LOG, JSON.stringify(log, null, 2) + "\n");
}

function secretsToRedact() {
  const values = new Set();
  for (const [k, v] of Object.entries(state))
    if (typeof v === "string" && v.length >= 8 && /Password|Token|Secret|ApiKey|Key$|minioUser|Link$/.test(k) && !/Sha$/.test(k))
      values.add(v);
  const envFile = path.join(INSTALL, ".env");
  if (existsSync(envFile)) {
    for (const line of readFileSync(envFile, "utf8").split("\n")) {
      const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
      if (!m) continue;
      if (/SECRET|KEY|PASSWORD|TOKEN|SMTP_URL|DATABASE_URL/.test(m[1]) && m[2].length >= 8)
        values.add(m[2].replace(/^"|"$/g, ""));
    }
  }
  return [...values].sort((a, b) => b.length - a.length);
}
function sanitize(text) {
  let out = String(text ?? "");
  for (const v of secretsToRedact()) out = out.split(v).join("[redacted]");
  out = out.replace(/(token|code|callbackURL|state)=[^&\s"')]+/gi, "$1=[redacted]");
  out = out.replace(/(postgres|smtp|smtps):\/\/[^\s"']+/g, "$1://[redacted]");
  out = out.replace(/olk_[A-Za-z0-9_-]{8,}/g, "[api key redacted]");
  return out;
}

async function step(scenario, role, method, action, expected, fn) {
  const entry = {
    phase: run.phase,
    scenario,
    role,
    method,
    action,
    expected,
    actual: null,
    result: "not-run",
    startedAt: new Date().toISOString(),
    at: null,
  };
  log.steps.push(entry);
  try {
    entry.actual = sanitize(await fn());
    entry.result = "pass";
  } catch (error) {
    if (process.env.DEBUG) console.error(error);
    entry.actual = sanitize(
      `Check did not pass: ${error instanceof Error ? error.message.split("\n").slice(0, 8).join(" ") : String(error)}`,
    );
    entry.result = "fail";
  }
  entry.at = new Date().toISOString();
  console.log(`${entry.result.toUpperCase()} [${scenario} ${role}/${method}] ${action}\n    ${entry.actual}`);
  saveLog();
  return entry;
}
function expect(condition, message) {
  if (!condition) throw new Error(message);
}

// ---------------------------------------------------------------- shell

const cleanEnv = {
  PATH: "/usr/local/sbin:/usr/local/bin:/usr/bin:/bin",
  HOME: process.env.HOME,
  USER: process.env.USER,
  LANG: "C.UTF-8",
};
function sh(cmd, { cwd = INSTALL, timeout = 900_000, env = {} } = {}) {
  const started = Date.now();
  const r = spawnSync("bash", ["-c", cmd], {
    cwd,
    env: { ...cleanEnv, ...env },
    encoding: "utf8",
    timeout,
    maxBuffer: 64 * 1024 * 1024,
  });
  return { code: r.status, stdout: r.stdout ?? "", stderr: r.stderr ?? "", ms: Date.now() - started };
}
const compose = (args, opts) => sh(`docker compose ${args}`, opts);
const up = (services = "") => compose(`up -d --no-build --pull never ${services}`);
const firstLines = (text, n = 3) =>
  String(text)
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .slice(0, n)
    .join(" | ");
function readEnv() {
  return readFileSync(path.join(INSTALL, ".env"), "utf8");
}
function envValue(key) {
  const m = readEnv().match(new RegExp(`^${key}=(.*)$`, "m"));
  return m ? m[1] : undefined;
}
/** Set (or with null, remove) uncommented settings, keeping each one once. */
function setEnv(updates) {
  let lines = readEnv().split("\n");
  for (const [key, value] of Object.entries(updates)) {
    lines = lines.filter((l) => !l.startsWith(`${key}=`));
    while (lines.at(-1) === "") lines.pop();
    if (value !== null) lines.push(`${key}=${value}`);
    lines.push("");
  }
  writeFileSync(path.join(INSTALL, ".env"), lines.join("\n").replace(/\n{3,}/g, "\n\n"), {
    mode: 0o600,
  });
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function readyz(base = LOCAL) {
  try {
    const r = await fetch(`${base}/readyz`, { signal: AbortSignal.timeout(5000) });
    return r.status;
  } catch (e) {
    return `unreachable (${e.cause?.code ?? e.name})`;
  }
}
async function waitReady(ms = 180_000, base = LOCAL) {
  const deadline = Date.now() + ms;
  let last;
  while (Date.now() < deadline) {
    last = await readyz(base);
    if (last === 200) return 200;
    await sleep(1000);
  }
  return last;
}
function containerState(service) {
  const r = compose(`ps -a --format json ${service}`);
  const rows = r.stdout
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((l) => JSON.parse(l));
  return rows[0]
    ? { state: rows[0].State, health: rows[0].Health, status: rows[0].Status, exit: rows[0].ExitCode }
    : null;
}
function logsSince(service, since) {
  const r = compose(`logs --no-color ${since ? `--since ${since}` : ""} ${service}`);
  return r.stdout + r.stderr;
}
function containerEnv(service, key) {
  const id = compose(`ps -q ${service}`).stdout.trim();
  if (!id) return undefined;
  const r = sh(`docker inspect --format '{{json .Config.Env}}' ${id}`);
  const env = JSON.parse(r.stdout || "[]");
  const hit = env.find((e) => e.startsWith(`${key}=`));
  return hit === undefined ? undefined : hit.slice(key.length + 1);
}
async function waitExitOrRestart(service, ms = 60_000) {
  const deadline = Date.now() + ms;
  let s;
  while (Date.now() < deadline) {
    s = containerState(service);
    if (s && (s.state === "restarting" || s.state === "exited" || /Restarting/.test(s.status)))
      return s;
    await sleep(1000);
  }
  return s;
}
async function waitHealthy(service, ms = 180_000) {
  const deadline = Date.now() + ms;
  let s;
  while (Date.now() < deadline) {
    s = containerState(service);
    if (s?.health === "healthy") return s;
    await sleep(2000);
  }
  return s;
}

// ---------------------------------------------------------------- mail

async function waitMail(to, subjectPart, after, ms = 60_000) {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    const r = await fetch(
      `${MAIL_UI}/api/v1/search?query=${encodeURIComponent(`to:"${to}"`)}`,
    ).then((x) => x.json());
    const hit = (r.messages ?? []).find(
      (m) =>
        (!subjectPart || m.Subject.includes(subjectPart)) &&
        (!after || new Date(m.Created) >= new Date(after)),
    );
    if (hit) return fetch(`${MAIL_UI}/api/v1/message/${hit.ID}`).then((x) => x.json());
    await sleep(1000);
  }
  return null;
}
async function mailTotal() {
  const r = await fetch(`${MAIL_UI}/api/v1/messages?limit=1`).then((x) => x.json());
  return r.messages_count ?? r.total;
}
function firstLink(message) {
  const m = message.Text.match(/https?:\/\/[^\s)>\]]+/);
  return m ? new URL(m[0]) : null;
}

// ---------------------------------------------------------------- browser + API

let browser;
async function openBrowser() {
  browser ??= await chromium.launch({
    headless: true,
    args: [`--host-resolver-rules=MAP openlaw-cfg.localhost 127.0.0.1, MAP ${LAN_HOST} ${lanBind}`],
  });
  return browser;
}
async function closeBrowser() {
  await browser?.close();
  browser = undefined;
}
async function newSession(base = ORIGIN) {
  const b = await openBrowser();
  const context = await b.newContext({ ignoreHTTPSErrors: true, baseURL: base });
  const page = await context.newPage();
  return { context, page };
}
// Sign-in is rate limited per client address, and with the guide's TRUSTED_PROXIES every request
// arrives from the Docker gateway, so this walkthrough spaces its own sign-ins.
let lastSignIn = 0;
async function paceSignIn() {
  const wait = lastSignIn + 4000 - Date.now();
  if (wait > 0) await sleep(wait);
  lastSignIn = Date.now();
}
async function signIn(base, email, password) {
  await paceSignIn();
  const s = await newSession(base);
  await s.page.goto(`${base}/auth/login`);
  await s.page.getByLabel("Email").fill(email);
  await s.page.getByLabel("Password", { exact: true }).fill(password);
  await s.page.getByRole("button", { name: "Sign in", exact: true }).click();
  await s.page.waitForURL((u) => !u.pathname.startsWith("/auth/login"), { timeout: 30_000 });
  return s;
}
async function apiClient(base, email, password, origin = base) {
  const ctx = await pwRequest.newContext({
    baseURL: base,
    ignoreHTTPSErrors: true,
    extraHTTPHeaders: { origin },
  });
  let r;
  for (let i = 0; i < 4; i++) {
    await paceSignIn();
    r = await ctx.post("/api/auth/sign-in/email", { data: { email, password } });
    if (r.status() !== 429) break;
    await sleep(11_000);
  }
  return { ctx, signInStatus: r.status() };
}
async function json(r) {
  const text = await r.text();
  try {
    return JSON.parse(text);
  } catch {
    return { raw: text.slice(0, 300) };
  }
}
async function adminApi(base = ORIGIN) {
  const c = await apiClient(base, ADMIN.email, state.adminPassword);
  expect(c.signInStatus === 200, `administrator sign-in answered ${c.signInStatus}`);
  return c.ctx;
}
async function ensureContract(api, title) {
  const types = await json(await api.get("/api/v1/contract-types"));
  const type = types.contractTypes.find((t) => !t.archivedAt) ?? types.contractTypes[0];
  const r = await api.post("/api/v1/contracts", { data: { title, contractTypeId: type.id } });
  const body = await json(r);
  if (r.status() !== 201 && r.status() !== 200)
    throw new Error(`contract create answered ${r.status()} ${JSON.stringify(body).slice(0, 200)}`);
  return body.contract;
}
function pdfFile(name, words) {
  const content = ["BT", "/F1 12 Tf", "72 720 Td", `(${words}) Tj`, "ET"].join("\n");
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    `<< /Length ${Buffer.byteLength(content, "latin1")} >>\nstream\n${content}\nendstream`,
  ];
  let body = "%PDF-1.4\n";
  const offsets = [];
  objects.forEach((o, i) => {
    offsets.push(Buffer.byteLength(body, "latin1"));
    body += `${i + 1} 0 obj\n${o}\nendobj\n`;
  });
  const xref = Buffer.byteLength(body, "latin1");
  body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const off of offsets) body += `${String(off).padStart(10, "0")} 00000 n \n`;
  body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return { name, mimeType: "application/pdf", buffer: Buffer.from(body, "latin1") };
}
function textFile(name, bytes) {
  return { name, mimeType: "text/plain", buffer: bytes };
}
const sha = (buf) => createHash("sha256").update(buf).digest("hex");
async function upload(api, contractNumber, file) {
  const r = await api.post(`/api/v1/contracts/${contractNumber}/documents`, { multipart: { file } });
  const body = await json(r);
  if (r.status() !== 201) return { status: r.status(), body };
  const doc = body.document;
  const version = doc.versions.find((v) => v.isCurrent) ?? doc.versions[0];
  return { status: 201, documentId: doc.id, versionId: version.id, sha256: sha(file.buffer) };
}
async function download(api, ref, timeout = 30_000) {
  let r;
  try {
    r = await api.get(`/api/v1/documents/${ref.documentId}/versions/${ref.versionId}/download`, {
      timeout,
    });
  } catch {
    return { status: "no answer", matches: false };
  }
  if (r.status() !== 200) return { status: r.status(), matches: false };
  return { status: 200, matches: sha(await r.body()) === ref.sha256 };
}
async function textState(api, ref) {
  const r = await api.get(`/api/v1/documents/${ref.documentId}/versions/${ref.versionId}/text`);
  const body = await json(r);
  return body.text ?? { state: `http ${r.status()}` };
}
async function waitText(api, ref, ms = 120_000, until = ["ready", "failed", "unsupported"]) {
  const deadline = Date.now() + ms;
  let t;
  while (Date.now() < deadline) {
    t = await textState(api, ref);
    if (until.includes(t.state)) return t;
    await sleep(1500);
  }
  return t;
}
function psql(sql, service = "postgres", user = "openlaw", db = "openlaw") {
  return compose(`exec -T ${service} psql -U ${user} -d ${db} -At -c ${JSON.stringify(sql)}`);
}
function storageRef(documentVersionId) {
  return psql(
    `select file_ref from document_versions where id='${documentVersionId}'`,
  ).stdout.trim();
}

// ---------------------------------------------------------------- phases

const phases = {};

phases.prep = async () => {
  await step(
    "V-C45",
    "operator",
    "container-operation",
    "Prepare a production-like installation directory from the pinned commit, as install.md establishes it",
    "A directory with the pinned source, a .env made by the installation guide's grouped commands, the project name and file list in .env, and a compose.operator.yml naming revision-tagged images.",
    () => {
      expect(!existsSync(INSTALL), "the installation directory already exists");
      mkdirSync(INSTALL, { recursive: true, mode: 0o700 });
      const a = sh(`git -C ${root} archive --format=tar ${COMMIT} | tar -xf - -C ${INSTALL}`, {
        cwd: WORK,
      });
      expect(a.code === 0, `archive exited ${a.code}: ${firstLines(a.stderr)}`);
      const envBlock = `(
  umask 077
  set -C
  cat .env.example > .env || exit 1
  chmod 600 .env
  sed -i "s|^AUTH_SECRET=$|AUTH_SECRET=$(openssl rand -base64 32)|" .env
  sed -i "s|^OPENLAW_SECRET_KEY=$|OPENLAW_SECRET_KEY=$(openssl rand -base64 32)|" .env
)`;
      const e = sh(envBlock);
      expect(e.code === 0, `env block exited ${e.code}`);
      // No image is built here: the images lab.mjs built from the pinned commit are tagged for
      // this project, so compose.operator.yml names them the way install.md names its own.
      const t1 = sh(`docker tag ${APP_IMAGE_ID} ${APP_TAG} && docker tag ${ENGINE_IMAGE_ID} ${ENGINE_TAG}`);
      expect(t1.code === 0, `tag exited ${t1.code}: ${firstLines(t1.stderr)}`);
      writeFileSync(
        path.join(INSTALL, "compose.operator.yml"),
        `services:
  app:
    image: openlaw-doc030-cfg-app:\${OPENLAW_BUILD_COMMIT:?Set the source revision}
  worker:
    image: openlaw-doc030-cfg-app:\${OPENLAW_BUILD_COMMIT:?Set the source revision}
  doc-engine:
    image: openlaw-doc030-cfg-engine:\${OPENLAW_BUILD_COMMIT:?Set the source revision}
`,
      );
      setEnv({
        COMPOSE_PROJECT_NAME: PROJECT,
        COMPOSE_FILE: "compose.yml:compose.operator.yml",
        OPENLAW_BUILD_COMMIT: COMMIT,
        OPENLAW_BUILD_DIRTY: "false",
        BASE_URL: ORIGIN,
        PORT: String(APP_PORT),
      });
      const q = compose("config --quiet");
      expect(q.code === 0 && q.stdout.trim() === "" && q.stderr.trim() === "", `config --quiet: ${q.code} ${firstLines(q.stdout + q.stderr)}`);
      const labels = sh(
        `docker image inspect --format '{{index .Config.Labels "org.opencontainers.image.revision"}}' ${APP_TAG} ${ENGINE_TAG}`,
      ).stdout.trim().split("\n");
      expect(labels.every((l) => l === COMMIT), `image revision labels ${labels}`);
      log.images.app = APP_IMAGE_ID;
      log.images.worker = APP_IMAGE_ID;
      log.images["doc-engine"] = ENGINE_IMAGE_ID;
      log.images.tags = { app: APP_TAG, engine: ENGINE_TAG };
      log.images.builtBy = "scripts/documentation/lab.mjs up from 067c1646 (the work2 lab's images); tagged, not rebuilt";
      state.secretKeySha = sha(envValue("OPENLAW_SECRET_KEY"));
      state.authSecretSha = sha(envValue("AUTH_SECRET"));
      saveState();
      return `git archive of ${COMMIT} extracted into the installation directory (outside the repository). install.md's grouped .env commands exited 0; .env has mode ${sh("stat -c %a .env").stdout.trim()} with two generated keys (not recorded). .env has COMPOSE_PROJECT_NAME=${PROJECT}, COMPOSE_FILE=compose.yml:compose.operator.yml, OPENLAW_BUILD_COMMIT=${COMMIT}, OPENLAW_BUILD_DIRTY=false, BASE_URL=${ORIGIN}, PORT=${APP_PORT}. No TRUSTED_PROXIES yet, to see the start warning first. compose.operator.yml names ${APP_TAG} and ${ENGINE_TAG}, which are ${APP_IMAGE_ID} and ${ENGINE_IMAGE_ID}, both labelled revision ${COMMIT}. docker compose config --quiet exited 0 and printed nothing.`;
    },
  );
};

phases.fixtures = async () => {
  await step(
    "V-C45",
    "operator",
    "container-operation",
    "Start the installation, then owned fixtures: an SMTP relay stand-in, MinIO, Azurite, a separate Postgres 16, and Caddy on the host",
    "docker compose up -d --no-build --pull never starts app, worker, postgres and doc-engine; readyz answers 200; the fixture project joins the installation's backend network without changing its services.",
    async () => {
      const u = up();
      expect(u.code === 0, `up exited ${u.code}: ${firstLines(u.stderr, 6)}`);
      const ready = await waitReady(240_000);
      expect(ready === 200, `readyz ${ready}`);
      const minioUser = `doc030${secret("minioUserSuffix", 6)}`.replace(/[^a-zA-Z0-9]/g, "x");
      state.minioUser = minioUser;
      secret("minioPassword");
      secret("extdbPassword");
      saveState();
      writeFileSync(
        path.join(FIX, ".env"),
        `MINIO_ROOT_USER=${state.minioUser}\nMINIO_ROOT_PASSWORD=${state.minioPassword}\nEXTDB_PASSWORD=${state.extdbPassword}\n`,
        { mode: 0o600 },
      );
      writeFileSync(
        path.join(FIX, "Caddyfile"),
        `{
\tadmin off
\thttp_port ${CADDY_HTTP_PORT}
\tauto_https disable_redirects
\tdefault_bind 127.0.0.1 [::1]
\tskip_install_trust
}

openlaw-cfg.localhost:${PROXY_PORT} {
\treverse_proxy 127.0.0.1:${APP_PORT}
}
`,
      );
      writeFileSync(
        path.join(FIX, "compose.yml"),
        `name: ${FX_PROJECT}
services:
  relay:
    image: axllent/mailpit:v1.30
    networks: { backend: { aliases: [relay] } }
    ports: ["127.0.0.1:25713:8025"]
  minio:
    image: minio/minio:RELEASE.2025-09-07T16-13-09Z
    command: server /data
    environment:
      MINIO_ROOT_USER: \${MINIO_ROOT_USER}
      MINIO_ROOT_PASSWORD: \${MINIO_ROOT_PASSWORD}
    networks: { backend: { aliases: [minio] } }
    ports: ["127.0.0.1:25714:9000"]
  azurite:
    image: mcr.microsoft.com/azure-storage/azurite:3.36.0
    command: azurite-blob --blobHost 0.0.0.0 --skipApiVersionCheck --loose
    networks: { backend: { aliases: [azurite] } }
    ports: ["127.0.0.1:25715:10000"]
  extdb:
    image: postgres:16
    environment:
      POSTGRES_USER: doc030ext
      POSTGRES_PASSWORD: \${EXTDB_PASSWORD}
      POSTGRES_DB: doc030ext
    networks: { backend: { aliases: [extdb] } }
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U doc030ext -d doc030ext"]
      interval: 3s
      retries: 20
  proxy:
    image: caddy:2-alpine
    network_mode: host
    volumes:
      - ./Caddyfile:/etc/caddy/Caddyfile:ro
      - caddy-data:/data
networks:
  backend:
    external: true
    name: ${PROJECT}_openlaw-backend
volumes:
  caddy-data: {}
`,
      );
      const r = sh("docker compose up -d --pull never --wait", { cwd: FIX, timeout: 300_000 });
      expect(r.code === 0, `fixtures up exited ${r.code}: ${firstLines(r.stderr, 6)}`);
      const ps = compose("ps --format '{{.Service}} {{.State}}'").stdout.trim().split("\n").sort();
      const imgs = {};
      for (const s of ["relay", "minio", "azurite", "extdb", "proxy"])
        imgs[s] = sh(`docker inspect --format '{{.Image}}' $(docker compose ps -q ${s})`, { cwd: FIX }).stdout.trim();
      log.fixtureImages = imgs;
      log.images.postgres = sh(`docker inspect --format '{{.Image}}' $(docker compose ps -q postgres)`).stdout.trim();
      return `up -d --no-build --pull never exited 0; readyz 200; docker compose ps: ${ps.join("; ")}. Fixture project ${FX_PROJECT} started: Mailpit as the relay stand-in (relay:1025 on the installation's backend network, UI 127.0.0.1:25713), MinIO (127.0.0.1:25714, alias minio), Azurite (127.0.0.1:25715, alias azurite), a separate postgres:16 (extdb, backend network only), and caddy:2-alpine on the host network serving ${ORIGIN} with "reverse_proxy 127.0.0.1:${APP_PORT}" and its internal CA. Fixture image IDs: ${JSON.stringify(imgs)}.`;
    },
  );
};

phases.firstrun = async () => {
  secret("adminPassword");
  secret("colleaguePassword");
  await step(
    "V-C45",
    "operator",
    "container-operation",
    "SETUP_TOKEN unset: restart the app twice while the installation has no users and compare the printed tokens",
    "While there are no users the app prints a setup token at each start, and each start prints a new one.",
    async () => {
      const tokens = [];
      for (let i = 0; i < 2; i++) {
        const since = new Date().toISOString();
        const r = compose("restart app");
        expect(r.code === 0, `restart exited ${r.code}`);
        expect((await waitReady()) === 200, "not ready");
        const text = logsSince("app", since);
        const m = text.match(/Paste this setup token into the setup screen:\s*\n(?:.*\|)?\s*\n(?:.*\|)?\s+(\S+)/);
        expect(m, `no token line after restart ${i + 1}: ${firstLines(text, 3)}`);
        tokens.push(m[1]);
      }
      state.printedToken = tokens[1];
      saveState();
      expect(tokens[0] !== tokens[1], "the same token was printed twice");
      return `Two docker compose restart app runs each logged "First-run setup is open. Paste this setup token into the setup screen:" with a token (values not recorded) and "It is printed once per boot and a restart makes a new one." The two tokens differ (SHA-256 prefixes ${sha(tokens[0]).slice(0, 8)} and ${sha(tokens[1]).slice(0, 8)}).`;
    },
  );
  await step(
    "V-C45",
    "operator",
    "container-operation",
    "Start without TRUSTED_PROXIES and read the app's start log",
    "Without TRUSTED_PROXIES the app logs a warning at start.",
    () => {
      const text = logsSince("app");
      expect(/TRUSTED_PROXIES is not set\./.test(text), "no TRUSTED_PROXIES warning in the log");
      return `The app log carries "TRUSTED_PROXIES is not set. Sign-in rate limits are keyed on the socket address, which behind a reverse proxy is the proxy itself. Set TRUSTED_PROXIES to the proxy's address so each client gets its own bucket."`;
    },
  );
  await step(
    "V-C45",
    "operator",
    "container-operation",
    "Set SETUP_TOKEN in .env, recreate with up -d --no-build --pull never, and check the setup screen accepts only that token",
    "The app logs that setup asks for SETUP_TOKEN; the previously printed token is refused; the chosen token creates the first Administrator.",
    async () => {
      secret("setupToken");
      setEnv({ SETUP_TOKEN: state.setupToken });
      const since = new Date().toISOString();
      const u = up();
      expect(u.code === 0, `up exited ${u.code}`);
      expect((await waitReady()) === 200, "not ready");
      const text = logsSince("app", since);
      expect(/The setup screen asks for the token in SETUP_TOKEN\./.test(text), "no SETUP_TOKEN log line");
      expect(!/Paste this setup token/.test(text), "a generated token was still printed");
      const { page, context } = await newSession();
      try {
        await page.goto(ORIGIN);
        await page.getByRole("heading", { name: "Set up OpenLaw" }).waitFor({ timeout: 30_000 });
        const fill = async (token) => {
          await page.getByLabel("Setup token").fill(token);
          await page.getByLabel("Name", { exact: true }).fill(ADMIN.name);
          await page.getByLabel("Email", { exact: true }).fill(ADMIN.email);
          await page.getByLabel("Password", { exact: true }).fill(state.adminPassword);
          await page.getByLabel("Confirm password", { exact: true }).fill(state.adminPassword);
          await page.getByRole("button", { name: "Create Administrator" }).click();
        };
        await fill(state.printedToken);
        await page.getByRole("alert").first().waitFor({ timeout: 15_000 });
        const refusal = (await page.getByRole("alert").first().innerText()).trim();
        const stillSetup = await page.getByRole("heading", { name: "Set up OpenLaw" }).count();
        expect(stillSetup === 1, "the old token was accepted");
        await fill(state.setupToken);
        await page.getByRole("heading", { name: "Welcome to OpenLaw" }).waitFor({ timeout: 30_000 });
        return `After up, the app logged "First-run setup is open. The setup screen asks for the token in SETUP_TOKEN." and printed no generated token. On ${ORIGIN} the "Set up OpenLaw" form with the earlier printed token showed "${refusal}" and stayed on setup. With the SETUP_TOKEN value, Create Administrator created the fictional ${ADMIN.name} and opened "Welcome to OpenLaw".`;
      } finally {
        await context.close();
      }
    },
  );
  await step(
    "V-C45",
    "operator",
    "container-operation",
    "Restart with SETUP_TOKEN still set after a user exists",
    "The app ignores SETUP_TOKEN once a user exists: no setup line in the log, and setup is closed.",
    async () => {
      const since = new Date().toISOString();
      compose("restart app");
      expect((await waitReady()) === 200, "not ready");
      const text = logsSince("app", since);
      const setup = await fetch(`${LOCAL}/api/v1/auth/setup`).then((x) => x.json());
      expect(!/First-run setup is open/.test(text), "setup line still logged");
      expect(setup.needsSetup === false, `needsSetup ${setup.needsSetup}`);
      setEnv({ SETUP_TOKEN: null });
      return `After docker compose restart app with SETUP_TOKEN still in .env, the log had no "First-run setup is open" line and GET /api/v1/auth/setup answered needsSetup=false. SETUP_TOKEN was then removed from .env.`;
    },
  );
  const { page, context } = await signIn(ORIGIN, ADMIN.email, state.adminPassword);
  try {
    await step(
      "V-C45",
      "operator",
      "container-operation",
      "Complete the welcome wizard with an app-saved relay (fixture for the email and key checks)",
      "The relay saved in the wizard delivers a test email; the wizard finishes.",
      async () => {
        await page.goto(ORIGIN);
        await page.getByRole("heading", { name: "Welcome to OpenLaw" }).waitFor({ timeout: 30_000 });
        await page.getByRole("button", { name: "Get started" }).click();
        await page.getByLabel("Organization name").fill("DOC-030 operator Organization");
        for (let i = 0; i < 8; i++) {
          if (await page.getByLabel("SMTP server").count()) break;
          await page.getByRole("button", { name: "Continue" }).click();
          await sleep(800);
        }
        const since = new Date().toISOString();
        await page.getByLabel("SMTP server").fill("relay");
        await page.getByLabel("Connection security").selectOption("none");
        await page.getByLabel("Port", { exact: true }).fill("1025");
        await page.getByLabel("Authentication").selectOption("none");
        await page.getByLabel("Sender name (optional)").fill("DOC-030 operator");
        await page.getByLabel("Sender email").fill("openlaw@doc030-cfg.example");
        await page.getByRole("button", { name: "Save relay" }).click();
        await page.getByRole("button", { name: "Send test email" }).click();
        const msg = await waitMail(ADMIN.email, "test email", since);
        expect(msg, "no test email");
        await page.getByRole("button", { name: "Continue" }).click();
        await sleep(800);
        // Invite the colleague as a Legal Team Member in the wizard's invite step.
        const inviteSince = new Date().toISOString();
        await page.getByLabel("Name", { exact: true }).fill(COLLEAGUE.name);
        await page.getByLabel("Email", { exact: true }).fill(COLLEAGUE.email);
        await page.getByRole("button", { name: "Legal team member", exact: true }).click();
        await page.getByRole("button", { name: "Send invite" }).click();
        const invite = await waitMail(COLLEAGUE.email, null, inviteSince);
        expect(invite, "no invitation");
        state.inviteLink = firstLink(invite).href;
        state.inviteOrigin = firstLink(invite).origin;
        saveState();
        for (let i = 0; i < 6; i++) {
          if (await page.getByRole("button", { name: "Finish" }).count()) break;
          const later = page.getByRole("button", { name: "Set up later" });
          if (await later.count()) await later.click();
          else await page.getByRole("button", { name: "Continue" }).click();
          await sleep(800);
        }
        await page.getByRole("button", { name: "Finish" }).click();
        await page.waitForURL((u) => !u.pathname.startsWith("/welcome"), { timeout: 30_000 });
        return `Wizard: organization "DOC-030 operator Organization"; Outbound email relay "relay", port 1025, no TLS, no authentication, sender openlaw@doc030-cfg.example; Send test email delivered "${msg.Subject}". The invitation to the fictional ${COLLEAGUE.name} arrived with a link on ${state.inviteOrigin}. Finish entered ${new URL(page.url()).pathname}.`;
      },
    );
  } finally {
    await page.screenshot({ path: path.join(PRIVATE, "firstrun-last.png") }).catch(() => {});
    await context.close();
  }
};

phases.accept = async () => {
    await step(
    "V-C45",
    "operator",
    "container-operation",
    "Accept the colleague's invitation through the proxy origin and set a password",
    "The invitation link on the configured origin sets a password and signs the Legal Team Member in.",
    async () => {
      const s = await newSession();
      try {
        if (!state.inviteLink) {
          const msg = await waitMail(COLLEAGUE.email, null, null);
          state.inviteLink = firstLink(msg).href;
          state.inviteOrigin = firstLink(msg).origin;
          saveState();
        }
        expect(state.inviteOrigin === ORIGIN, `invitation origin ${state.inviteOrigin}`);
        const pre = await apiClient(ORIGIN, COLLEAGUE.email, state.colleaguePassword);
        if (pre.signInStatus === 200) {
          await s.page.goto(state.inviteLink);
          await s.page.getByText(/expired or was already used|not valid/).first().waitFor({ timeout: 15_000 }).catch(() => {});
          const note = (await s.page.locator("body").innerText()).split("\n").find((l) => /expired|already used|not valid/.test(l));
          return `The first attempt (logged above as failed) had already set the password: it waited for a page change, but the page stays on /auth/set-password and shows "Password set". The Legal Team Member now signs in through the proxy with that password (HTTP 200). Opening the same invitation link again shows "${note ?? "no message"}".`;
        }
        await s.page.goto(state.inviteLink);
        await s.page.getByLabel(/^(New password|Password)$/).first().fill(state.colleaguePassword);
        await s.page.getByLabel(/Confirm/).fill(state.colleaguePassword);
        await s.page.getByRole("button", { name: /Set password|Save|Continue/ }).click();
        await s.page.getByText("Password set").first().waitFor({ timeout: 30_000 });
        const c = await apiClient(ORIGIN, COLLEAGUE.email, state.colleaguePassword);
        expect(c.signInStatus === 200, `colleague sign-in ${c.signInStatus}`);
        const me = await json(await c.ctx.get("/api/v1/auth/me"));
        return `The invitation opened ${new URL(state.inviteLink).pathname} on ${ORIGIN} (token in the fragment, not recorded). Set password showed "Password set". The Legal Team Member then signed in through the proxy (HTTP 200), role ${me.user?.role ?? JSON.stringify(me).slice(0, 80)}.`;
      } finally {
        await s.context.close();
      }
    },
  );
};

async function sessionIpAfterSignIn({ connect = "127.0.0.1", xff } = {}) {
  // curl through the proxy, connecting to Caddy on the given loopback address, then read the
  // address the app stored on the new session. The app stores its own view of the client address.
  const before = psql("select coalesce(max(created_at)::text,'') from sessions").stdout.trim();
  const body = JSON.stringify({ email: COLLEAGUE.email, password: state.colleaguePassword });
  const target = connect.includes(":") ? `[${connect}]` : connect;
  const r = sh(
    `curl -sk --resolve openlaw-cfg.localhost:${PROXY_PORT}:${target} -o /dev/null -w '%{http_code}' -H 'origin: ${ORIGIN}' -H 'content-type: application/json' ${xff ? `-H 'x-forwarded-for: ${xff}'` : ""} --data @- ${ORIGIN}/api/auth/sign-in/email <<'JSON'\n${body}\nJSON`,
  );
  const ip = psql(
    `select ip_address from sessions where created_at > '${before || "1970-01-01"}' order by created_at desc limit 1`,
  ).stdout.trim();
  return { status: r.stdout.trim(), ip };
}

phases.proxy = async () => {
  await step(
    "V-C45",
    "operator",
    "container-operation",
    "Add TRUSTED_PROXIES=127.0.0.1,::1 to .env (the guide's value for a proxy on the same host) and run docker compose restart app",
    "restart keeps the container's existing environment, so the new value is not applied.",
    async () => {
      setEnv({ TRUSTED_PROXIES: "127.0.0.1,::1" });
      const since = new Date().toISOString();
      const r = compose("restart app");
      expect(r.code === 0, `restart exited ${r.code}`);
      expect((await waitReady()) === 200, "not ready");
      const inContainer = containerEnv("app", "TRUSTED_PROXIES");
      const warned = /TRUSTED_PROXIES is not set\./.test(logsSince("app", since));
      expect(inContainer === "" && warned, `container value "${inContainer}", warned ${warned}`);
      return `After docker compose restart app, the app container's TRUSTED_PROXIES was still empty and the start log again said "TRUSTED_PROXIES is not set."`;
    },
  );
  await step(
    "V-C45",
    "operator",
    "container-operation",
    "Apply the change with docker compose up -d --no-build --pull never",
    "up recreates the app with TRUSTED_PROXIES=127.0.0.1,::1 and the start warning is gone.",
    async () => {
      const since = new Date().toISOString();
      const u = up();
      expect(u.code === 0, `up exited ${u.code}`);
      expect((await waitReady()) === 200, "not ready");
      const inContainer = containerEnv("app", "TRUSTED_PROXIES");
      const warned = /TRUSTED_PROXIES is not set\./.test(logsSince("app", since));
      expect(inContainer === "127.0.0.1,::1" && !warned, `container "${inContainer}", warned ${warned}`);
      return `up exited 0 and recreated the app. Its TRUSTED_PROXIES is 127.0.0.1,::1 and the start log has no TRUSTED_PROXIES warning.`;
    },
  );
  await step(
    "V-C45",
    "operator",
    "container-operation",
    "Check that the app reads the client address from X-Forwarded-For through the same-host Caddy proxy",
    "With TRUSTED_PROXIES=127.0.0.1,::1 and Caddy on the host, the app records the client's address (here the loopback address the client used to reach Caddy), not the proxy's, and a client-sent X-Forwarded-For is replaced.",
    async () => {
      const v4 = await sessionIpAfterSignIn({ connect: "127.0.0.1" });
      const v6 = await sessionIpAfterSignIn({ connect: "::1" });
      const spoof = await sessionIpAfterSignIn({ connect: "127.0.0.1", xff: "203.0.113.9" });
      const gw = sh(
        `docker network inspect ${PROJECT}_openlaw-backend --format '{{range .IPAM.Config}}{{.Gateway}}{{end}}'`,
      ).stdout.trim();
      state.backendGateway = gw;
      saveState();
      const detail = `Sign-in through Caddy connecting on 127.0.0.1 answered ${v4.status} and the session row holds ip_address ${v4.ip}; connecting on ::1 answered ${v6.status} with ${v6.ip}; with a client-sent X-Forwarded-For 203.0.113.9 it answered ${spoof.status} with ${spoof.ip}. ${gw} is the gateway of the installation's backend network, which is the source address Docker's published port gives every host-side connection.`;
      expect(v4.ip !== gw && v6.ip !== gw, detail);
      return detail;
    },
  );
};

phases["proxy-diagnose"] = async () => {
  await step(
    "V-C45",
    "operator",
    "container-operation",
    "Reviewer diagnosis (not a guide step): set TRUSTED_PROXIES to the backend network gateway the app actually sees, recreate, and repeat the three sign-ins",
    "If the gateway is the listed address, the app records each client's own address and Caddy's replacement of a client-sent X-Forwarded-For.",
    async () => {
      const gw = state.backendGateway;
      setEnv({ TRUSTED_PROXIES: gw });
      expect(up().code === 0, "up failed");
      expect((await waitReady()) === 200, "not ready");
      const v4 = await sessionIpAfterSignIn({ connect: "127.0.0.1" });
      const v6 = await sessionIpAfterSignIn({ connect: "::1" });
      const spoof = await sessionIpAfterSignIn({ connect: "127.0.0.1", xff: "203.0.113.9" });
      const detail = `With TRUSTED_PROXIES=${gw}: via 127.0.0.1 ip_address ${v4.ip}; via ::1 ${v6.ip}; with client-sent X-Forwarded-For 203.0.113.9 ${spoof.ip}.`;
      expect(v4.ip === "127.0.0.1" && v6.ip !== gw && spoof.ip === "127.0.0.1", detail);
      setEnv({ TRUSTED_PROXIES: "127.0.0.1,::1" });
      expect(up().code === 0, "up failed");
      expect((await waitReady()) === 200, "not ready");
      return `${detail} (better-auth stores an IPv6 client by its /64 prefix, so ::1 appears as zeros.) So Caddy does replace a client-sent X-Forwarded-For, and the app believes it only when TRUSTED_PROXIES names the Docker network gateway, which is where host-side connections to the published port arrive from. The guide's 127.0.0.1,::1 never matches under the standard Compose file. TRUSTED_PROXIES was set back to 127.0.0.1,::1 and the app recreated.`;
    },
  );
};

async function liveUpdate(base) {
  const a = await signIn(base, ADMIN.email, state.adminPassword);
  const contract = await json(await a.page.request.get(`${base}/api/v1/contracts/${state.contractNumber}`));
  const contractId = contract.contract.id;
  await a.page.goto(`${base}/contracts/${state.contractNumber}`);
  await a.page.waitForLoadState("networkidle").catch(() => {});
  await a.page.evaluate(
    ({ id }) => {
      window.__frames = [];
      fetch(`/api/events?entityType=contract&entityId=${id}`, { credentials: "include" })
        .then(async (r) => {
          window.__status = r.status;
          const reader = r.body.getReader();
          const dec = new TextDecoder();
          for (;;) {
            const { value, done } = await reader.read();
            if (done) break;
            window.__frames.push({ t: Date.now(), text: dec.decode(value) });
          }
        })
        .catch(() => {});
    },
    { id: contractId },
  );
  await sleep(1500);
  const c = await apiClient(base, ADMIN.email, state.adminPassword);
  const sent = Date.now();
  const post = await c.ctx.post("/api/v1/comments", {
    data: { entityType: "contract", entityId: contractId, body: `DOC-030 operator live update ${sent}`, visibility: "working_team" },
  });
  const postStatus = post.status();
  await c.ctx.dispose();
  let frame;
  for (let i = 0; i < 40 && !frame; i++) {
    await sleep(500);
    const frames = await a.page.evaluate(() => window.__frames);
    frame = frames.find((f) => /event: record/.test(f.text) && f.text.includes(contractId));
  }
  const status = await a.page.evaluate(() => window.__status);
  await a.context.close();
  expect(postStatus === 201 || postStatus === 200, `comment post ${postStatus}`);
  expect(status === 200 && frame, `stream status ${status}, record frame ${Boolean(frame)}`);
  return `The browser read /api/events for Contract ${state.contractNumber} through ${base} (HTTP ${status}); a second session's comment (${postStatus}) produced a record frame for that Contract ${frame.t - sent} ms later.`;
}

phases.origin = async () => {
  await step(
    "V-C45",
    "operator",
    "container-operation",
    "docker compose port app 3000, then APP_BIND=0.0.0.0 and back, and a direct request on the LAN and Tailscale addresses",
    "The standard Compose file publishes on 127.0.0.1:PORT; APP_BIND=0.0.0.0 changes it to all addresses; removing APP_BIND and recreating returns to 127.0.0.1; with the default the port is unreachable on other host addresses.",
    async () => {
      const p1 = compose("port app 3000").stdout.trim();
      const lan1 = sh(`curl -s -o /dev/null -m 5 -w '%{http_code}' http://${LAN_IP}:${APP_PORT}/readyz`).stdout.trim();
      const ts1 = sh(`curl -s -o /dev/null -m 5 -w '%{http_code}' http://${TAILNET_IP}:${APP_PORT}/readyz`).stdout.trim();
      setEnv({ APP_BIND: "0.0.0.0" });
      expect(up().code === 0, "up failed");
      await waitReady();
      const p2 = compose("port app 3000").stdout.trim();
      const lan2 = sh(`curl -s -o /dev/null -m 5 -w '%{http_code}' http://${LAN_IP}:${APP_PORT}/readyz`).stdout.trim();
      setEnv({ APP_BIND: null });
      expect(up().code === 0, "up failed");
      await waitReady();
      const p3 = compose("port app 3000").stdout.trim();
      const lan3 = sh(`curl -s -o /dev/null -m 5 -w '%{http_code}' http://${LAN_IP}:${APP_PORT}/readyz`).stdout.trim();
      expect(p1 === `127.0.0.1:${APP_PORT}` && p3 === p1 && p2 === `0.0.0.0:${APP_PORT}`, `ports ${p1} / ${p2} / ${p3}`);
      expect(lan1 === "000" && ts1 === "000" && lan2 === "200" && lan3 === "000", `lan ${lan1} ts ${ts1} / ${lan2} / ${lan3}`);
      return `docker compose port app 3000 printed ${p1}. /readyz on http://${LAN_IP}:${APP_PORT} and http://${TAILNET_IP}:${APP_PORT} got no connection (curl code ${lan1}, ${ts1}). With APP_BIND=0.0.0.0 and up, it printed ${p2} and the LAN address answered ${lan2}. After removing APP_BIND and up again it printed ${p3} and the LAN address got no connection (${lan3}).`;
    },
  );
  await step(
    "V-C45",
    "operator",
    "container-operation",
    "An earlier edition's compose.private.yml with ports: !override stays in COMPOSE_FILE: read the resulting port mapping",
    "The overlay gives the same loopback mapping but fixes the host port at 3000 and ignores PORT and APP_BIND.",
    () => {
      writeFileSync(
        path.join(INSTALL, "compose.private.yml"),
        `services:\n  app:\n    ports: !override\n      - "127.0.0.1:3000:3000"\n`,
      );
      const r = sh(
        `APP_BIND=0.0.0.0 docker compose -f compose.yml -f compose.operator.yml -f compose.private.yml config --format json | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>console.log(JSON.stringify(JSON.parse(s).services.app.ports)))"`,
      );
      const base = sh(
        `docker compose config --format json | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>console.log(JSON.stringify(JSON.parse(s).services.app.ports)))"`,
      );
      sh("rm compose.private.yml");
      const ports = JSON.parse(r.stdout);
      expect(ports.length === 1 && ports[0].host_ip === "127.0.0.1" && ports[0].published === "3000", r.stdout);
      return `With compose.private.yml added to the file list, PORT=${APP_PORT} in .env and APP_BIND=0.0.0.0 in the shell, the resolved app ports were ${r.stdout.trim()} (only the port list was read from config --format json; nothing else was printed). Without the overlay they were ${base.stdout.trim()}. The overlay was not started (host port 3000 is taken by an unrelated local service) and was removed.`;
    },
  );
  await step(
    "V-C45",
    "operator",
    "container-operation",
    "Check origin enforcement: sign in with a foreign Origin and with the direct app address as Origin",
    "Only the BASE_URL origin is accepted for sign-in.",
    async () => {
      const bad = await apiClient(ORIGIN, ADMIN.email, state.adminPassword, "https://evil.example");
      const direct = await apiClient(LOCAL, ADMIN.email, state.adminPassword, LOCAL);
      const good = await apiClient(ORIGIN, ADMIN.email, state.adminPassword);
      expect(bad.signInStatus === 403 && direct.signInStatus === 403 && good.signInStatus === 200, `${bad.signInStatus} ${direct.signInStatus} ${good.signInStatus}`);
      return `Through the proxy, sign-in with Origin https://evil.example answered ${bad.signInStatus}; on the direct address ${LOCAL} with that address as Origin it answered ${direct.signInStatus}; with Origin ${ORIGIN} it answered ${good.signInStatus}.`;
    },
  );
  await phases["origin-upload"]();
};

phases["origin-upload"] = async () => {
  await step(
    "V-C45",
    "operator",
    "container-operation",
    "Upload, download, processing and a live update through the proxy origin",
    "Upload and download bytes match; the worker extracts text; a record frame arrives on /api/events through Caddy.",
    async () => {
      const api = await adminApi();
      const contract = await ensureContract(api, `DOC-030 operator proxy ${Date.now()}`);
      state.contractNumber = contract.number ?? contract.contractNumber ?? contract.id;
      saveState();
      const f = pdfFile("doc030-local.pdf", "DOC-030 operator local storage check");
      const u = await upload(api, state.contractNumber, f);
      expect(u.status === 201, `upload ${u.status} ${String(JSON.stringify(u.body)).slice(0, 160)}`);
      const d = await download(api, u);
      const t = await waitText(api, u);
      state.docs = { local: { ...u } };
      saveState();
      const ref = storageRef(u.versionId);
      const live = await liveUpdate(ORIGIN);
      expect(d.matches && t.state === "ready", `download ${d.status} ${d.matches}; text ${t.state}`);
      return `Contract ${state.contractNumber} created through ${ORIGIN}. A PDF upload answered 201 (SHA-256 ${u.sha256.slice(0, 12)}…); the download answered 200 with identical bytes; the worker's text state became ready. Stored reference prefix: ${ref.split(":")[0]}:. ${live}`;
    },
  );
};

async function upload1m(api, bytes) {
  const f = textFile(`doc030-${bytes}.txt`, Buffer.alloc(bytes, 97));
  return upload(api, state.contractNumber, f);
}

phases.uploads = async () => {
  await step(
    "V-C45",
    "operator",
    "container-operation",
    "Add MAX_UPLOAD_MB=1, run docker compose restart app, and upload just over 1 MiB",
    "restart does not apply the changed .env, so the upload is accepted under the old ceiling.",
    async () => {
      setEnv({ MAX_UPLOAD_MB: "1" });
      compose("restart app");
      expect((await waitReady()) === 200, "not ready");
      const api = await adminApi();
      const r = await upload1m(api, 1024 * 1024 + 1);
      expect(containerEnv("app", "MAX_UPLOAD_MB") === "" && r.status === 201, `env ${containerEnv("app", "MAX_UPLOAD_MB")} upload ${r.status}`);
      return `After restart the app container's MAX_UPLOAD_MB was still empty and an upload of 1,048,577 bytes answered 201.`;
    },
  );
  await step(
    "V-C45",
    "operator",
    "container-operation",
    "Apply MAX_UPLOAD_MB=1 with up -d --no-build --pull never, then upload exactly 1 MiB and one byte more",
    "The ceiling is in MiB: 1,048,576 bytes are accepted and 1,048,577 are refused.",
    async () => {
      expect(up().code === 0, "up failed");
      expect((await waitReady()) === 200, "not ready");
      const api = await adminApi();
      const ok = await upload1m(api, 1024 * 1024);
      const over = await upload1m(api, 1024 * 1024 + 1);
      expect(ok.status === 201 && over.status === 413, `${ok.status} / ${over.status}`);
      return `up applied MAX_UPLOAD_MB=1 (container value ${containerEnv("app", "MAX_UPLOAD_MB")}). A 1,048,576-byte upload answered 201; a 1,048,577-byte upload answered 413 "${over.body.detail ?? over.body.title}".`;
    },
  );
  const s = await signIn(ORIGIN, ADMIN.email, state.adminPassword);
  try {
    await step(
      "V-C45-advanced-settings",
      "administrator",
      "browser-walkthrough",
      "Open Settings → Advanced → File uploads while .env sets MAX_UPLOAD_MB=1",
      "Maximum file size (MiB) shows 1 with Deployment configuration · Read only, and the page has no Save button because its only field is pinned.",
      async () => {
        await s.page.goto(`${ORIGIN}/settings/uploads`);
        await s.page.getByLabel("Maximum file size (MiB)").waitFor({ timeout: 20_000 });
        const value = await s.page.getByLabel("Maximum file size (MiB)").inputValue();
        const ro = await s.page.getByLabel("Maximum file size (MiB)").getAttribute("readonly");
        const text = await s.page.locator("main").innerText();
        const save = await s.page.getByRole("button", { name: "Save" }).count();
        expect(value === "1" && ro !== null && /Deployment configuration · Read only/.test(text) && save === 0, `value ${value} ro ${ro} save ${save}`);
        const allLocked = /The deployment configuration sets this value\. Change it there, then restart the API and worker\./.test(text);
        return `File uploads shows Maximum file size (MiB) = ${value}, read only, with "Deployment configuration · Read only" under it. No Save button; the page says "${allLocked ? "The deployment configuration sets this value. Change it there, then restart the API and worker." : "(no all-locked note)"}".`;
      },
    );
    await step(
      "V-C45-advanced-settings",
      "administrator",
      "container-operation",
      "Try to save a different upload limit through the API while MAX_UPLOAD_MB is pinned",
      "The API refuses a different value for a pinned key.",
      async () => {
        const st = await json(await s.page.request.get(`${ORIGIN}/api/v1/advanced-settings/uploads`));
        const r = await s.page.request.put(`${ORIGIN}/api/v1/advanced-settings/uploads`, {
          headers: { origin: ORIGIN },
          data: { version: st.version, values: { MAX_UPLOAD_MB: "5" } },
        });
        const body = await json(r);
        expect(r.status() === 400, `${r.status()} ${JSON.stringify(body).slice(0, 120)}`);
        return `PUT /api/v1/advanced-settings/uploads with MAX_UPLOAD_MB=5 answered ${r.status()} "${body.detail}". The field's source is ${st.fields[0].source}, locked ${st.fields[0].locked}.`;
      },
    );
  } finally {
    await s.context.close();
  }
  await step(
    "V-C45",
    "operator",
    "container-operation",
    "Set MAX_UPLOAD_MB=ten (unreadable) and recreate",
    "The app starts normally and falls back to the 100 MiB default.",
    async () => {
      setEnv({ MAX_UPLOAD_MB: "ten" });
      expect(up().code === 0, "up failed");
      expect((await waitReady()) === 200, "not ready");
      const api = await adminApi();
      const r = await upload1m(api, 2 * 1024 * 1024);
      expect(r.status === 201, `upload ${r.status}`);
      return `With MAX_UPLOAD_MB=ten the app started (readyz 200) and a 2 MiB upload answered 201, so the default ceiling applied.`;
    },
  );
  const s2 = await signIn(ORIGIN, ADMIN.email, state.adminPassword);
  try {
    await step(
      "V-C45-advanced-settings",
      "administrator",
      "browser-walkthrough",
      "With MAX_UPLOAD_MB=ten pinned, save another Advanced page (MCP → Calls per hour per credential)",
      "Every Advanced save fails with the pinned setting's message until .env is corrected.",
      async () => {
        await s2.page.goto(`${ORIGIN}/settings/mcp-limits`);
        const field = s2.page.getByLabel("Calls per hour per credential");
        await field.waitFor({ timeout: 20_000 });
        await field.fill("500");
        await s2.page.getByRole("button", { name: "Save" }).click();
        const alert = s2.page.getByRole("alert").filter({ hasText: /upload limit|could not/ });
        await alert.first().waitFor({ timeout: 15_000 });
        const msg = (await alert.first().innerText()).trim();
        expect(/upload limit must be a whole number/.test(msg), msg);
        return `On MCP, Calls per hour per credential 500 then Save showed "${msg}".`;
      },
    );
  } finally {
    await s2.context.close();
  }
  await step(
    "V-C45",
    "operator",
    "container-operation",
    "Remove MAX_UPLOAD_MB and recreate",
    "The upload field returns to its default source.",
    async () => {
      setEnv({ MAX_UPLOAD_MB: null });
      expect(up().code === 0, "up failed");
      expect((await waitReady()) === 200, "not ready");
      const api = await adminApi();
      const st = await json(await api.get("/api/v1/advanced-settings/uploads"));
      expect(st.fields[0].source === "default" && st.fields[0].value === "100", JSON.stringify(st.fields[0]));
      return `After removing MAX_UPLOAD_MB and up, File uploads reports value 100 with source default.`;
    },
  );
};

async function fieldSource(page, label) {
  // The source line is the first muted paragraph after the control.
  const box = page.getByLabel(label).locator("xpath=ancestor::div[1]");
  return (await box.innerText()).split("\n").map((l) => l.trim()).filter(Boolean);
}
async function statusRows(page) {
  await page.getByRole("button", { name: "Refresh" }).click();
  await sleep(1200);
  const rows = await page.locator("tbody tr").allInnerTexts();
  const text = await page.locator("main").innerText();
  return { rows: rows.map((r) => r.replace(/\s+/g, " ").trim()), text };
}
async function restartBoth() {
  const r = compose("restart app worker");
  expect(r.code === 0, `restart exited ${r.code}`);
  expect((await waitReady()) === 200, "not ready after restart");
  await sleep(3000);
}

phases.advanced = async () => {
  const s = await signIn(ORIGIN, ADMIN.email, state.adminPassword);
  const { page } = s;
  try {
    await step(
      "V-C45-advanced-settings",
      "administrator",
      "browser-walkthrough",
      "Open Settings → Advanced at the bottom of the navigation",
      "The Advanced group holds Outbound email, Authentication, Audit log, Instance address, File uploads, Document storage, Document processing, MCP and System status.",
      async () => {
        await page.goto(`${ORIGIN}/settings/profile`);
        const adv = page.getByRole("button", { name: "Advanced", exact: true });
        await adv.waitFor({ timeout: 20_000 });
        if ((await adv.getAttribute("aria-expanded")) !== "true") await adv.click();
        const nav = page.getByRole("navigation").filter({ has: page.getByRole("button", { name: "Advanced", exact: true }) }).first();
        const links = (await nav.getByRole("link").allInnerTexts()).map((t) => t.trim()).filter(Boolean);
        const i = links.indexOf("Outbound email");
        const group = links.slice(i);
        const want = ["Outbound email", "Authentication", "Audit log", "Instance address", "File uploads", "Document storage", "Document processing", "MCP", "System status"];
        expect(JSON.stringify(group) === JSON.stringify(want), `links after Outbound email: ${group.join(", ")}`);
        return `The Advanced button is the last group in the Settings navigation. Expanded, it lists: ${group.join(", ")}.`;
      },
    );
    await step(
      "V-C45-advanced-settings",
      "administrator",
      "browser-walkthrough",
      "Open Instance address and Document processing while .env sets BASE_URL and Compose sets DOC_ENGINE_URL",
      "Application address and Document service address show Deployment configuration · Read only; the two timeouts show Default and are editable.",
      async () => {
        await page.goto(`${ORIGIN}/settings/instance`);
        await page.getByLabel("Application address").waitFor({ timeout: 20_000 });
        const inst = await fieldSource(page, "Application address");
        const instSave = await page.getByRole("button", { name: "Save" }).count();
        await page.goto(`${ORIGIN}/settings/document-processing`);
        await page.getByLabel("Document service address").waitFor({ timeout: 20_000 });
        const url = await fieldSource(page, "Document service address");
        const t1 = await fieldSource(page, "Processing timeout (milliseconds)");
        const t2 = await fieldSource(page, "Comparison timeout (milliseconds)");
        const roUrl = await page.getByLabel("Document service address").getAttribute("readonly");
        const roT1 = await page.getByLabel("Processing timeout (milliseconds)").getAttribute("readonly");
        expect(inst.includes("Deployment configuration · Read only") && instSave === 0, `instance ${inst}`);
        expect(url.includes("Deployment configuration · Read only") && roUrl !== null && roT1 === null, `url ${url}`);
        expect(t1.includes("Default") && t2.includes("Default"), `timeouts ${t1} ${t2}`);
        return `Instance address: Application address "${await page.goto(`${ORIGIN}/settings/instance`).then(() => page.getByLabel("Application address").inputValue())}" with "${inst.find((l) => /Deployment/.test(l))}" and no Save button. Document processing: Document service address shows "${url.find((l) => /Deployment/.test(l))}" (read only); Processing timeout shows "${t1.at(-1)}" and Comparison timeout "${t2.at(-1)}", both editable, with Test connection and Save.`;
      },
    );
    await step(
      "V-C45-advanced-settings",
      "administrator",
      "browser-walkthrough",
      "Document processing: Test connection, then save Processing timeout 240000 and Comparison timeout 500000",
      "The test passes; Save shows the restart message; each changed field shows Active: with the value still in use; the page warns that saved changes wait for a restart.",
      async () => {
        await page.goto(`${ORIGIN}/settings/document-processing`);
        await page.getByLabel("Processing timeout (milliseconds)").waitFor();
        await page.getByRole("button", { name: "Test connection" }).click();
        await page.getByText("Connection test passed.").waitFor({ timeout: 15_000 });
        await page.getByLabel("Processing timeout (milliseconds)").fill("240000");
        await page.getByLabel("Comparison timeout (milliseconds)").fill("500000");
        await page.getByRole("button", { name: "Save" }).click();
        await page.getByText("Settings saved. Restart the API and worker to apply changes.").waitFor({ timeout: 15_000 });
        const t1 = await fieldSource(page, "Processing timeout (milliseconds)");
        const text = await page.locator("main").innerText();
        const pending = /Saved changes are waiting for a restart\./.test(text);
        expect(t1.includes("Saved in OpenLaw") && t1.some((l) => l === "Active: 300000") && pending, `${t1} pending ${pending}`);
        return `Test connection showed "Connection test passed." Save showed "Settings saved. Restart the API and worker to apply changes." Processing timeout now reads ${t1.filter((l) => /Saved|Active/.test(l)).join(" / ")}; Comparison timeout ${(await fieldSource(page, "Comparison timeout (milliseconds)")).filter((l) => /Saved|Active/.test(l)).join(" / ")}. The page shows "Saved changes are waiting for a restart. The active values below are still in use by this API."`;
      },
    );
    await step(
      "V-C45-advanced-settings",
      "administrator",
      "browser-walkthrough",
      "Save an out-of-range Processing timeout (420001)",
      "The API refuses it and the page shows the reason.",
      async () => {
        await page.goto(`${ORIGIN}/settings/document-processing`);
        await page.getByLabel("Processing timeout (milliseconds)").fill("420001");
        await page.getByRole("button", { name: "Save" }).click();
        const alert = page.getByRole("alert").filter({ hasText: /DOC_ENGINE|timeout|could not/i });
        await alert.first().waitFor({ timeout: 15_000 });
        const msg = (await alert.first().innerText()).trim();
        return `Save showed "${msg}"; the saved value stayed 240000 (${(await json(await page.request.get(`${ORIGIN}/api/v1/advanced-settings/processing`))).fields.find((f) => f.key === "DOC_ENGINE_TIMEOUT_MS").value}).`;
      },
    );
    await step(
      "V-C45-advanced-settings",
      "administrator",
      "browser-walkthrough",
      "File uploads: save Maximum file size (MiB) 2; MCP: save Calls per hour per credential 500 and OAuth grant lifetime (days) 30",
      "Each save shows the restart message and Active: with the old value.",
      async () => {
        await page.goto(`${ORIGIN}/settings/uploads`);
        await page.getByLabel("Maximum file size (MiB)").fill("2");
        await page.getByRole("button", { name: "Save" }).click();
        await page.getByText("Settings saved. Restart the API and worker to apply changes.").waitFor({ timeout: 15_000 });
        const up1 = (await fieldSource(page, "Maximum file size (MiB)")).filter((l) => /Saved|Active/.test(l));
        await page.goto(`${ORIGIN}/settings/mcp-limits`);
        await page.getByLabel("Calls per hour per credential").fill("500");
        await page.getByLabel("OAuth grant lifetime (days)").fill("30");
        await page.getByRole("button", { name: "Save" }).click();
        await page.getByText("Settings saved. Restart the API and worker to apply changes.").waitFor({ timeout: 15_000 });
        const m1 = (await fieldSource(page, "Calls per hour per credential")).filter((l) => /Saved|Active|Default/.test(l));
        const m2 = (await fieldSource(page, "OAuth grant lifetime (days)")).filter((l) => /Saved|Active|Default/.test(l));
        expect(up1.includes("Active: 100") && m1.includes("Active: 600") && m2.includes("Active: 90"), `${up1} ${m1} ${m2}`);
        return `File uploads: ${up1.join(" / ")}. MCP: Calls per hour per credential ${m1.join(" / ")}; OAuth grant lifetime (days) ${m2.join(" / ")}.`;
      },
    );
    await step(
      "V-C45-advanced-settings",
      "administrator",
      "browser-walkthrough",
      "Stale edit: open File uploads in two tabs, save 3 in the first, then save 4 in the second",
      "The second save is refused with the stale-edit message.",
      async () => {
        const p2 = await s.context.newPage();
        await page.goto(`${ORIGIN}/settings/uploads`);
        await p2.goto(`${ORIGIN}/settings/uploads`);
        await page.getByLabel("Maximum file size (MiB)").fill("3");
        await page.getByRole("button", { name: "Save" }).click();
        await page.getByText("Settings saved.", { exact: false }).waitFor({ timeout: 15_000 });
        await p2.getByLabel("Maximum file size (MiB)").fill("4");
        await p2.getByRole("button", { name: "Save" }).click();
        const alert = p2.getByRole("alert").filter({ hasText: /another session|could not/ });
        await alert.first().waitFor({ timeout: 15_000 });
        const msg = (await alert.first().innerText()).trim();
        await p2.close();
        expect(msg === "These settings changed in another session. Reload the page before saving.", msg);
        // Put the intended value back.
        await page.goto(`${ORIGIN}/settings/uploads`);
        await page.getByLabel("Maximum file size (MiB)").fill("2");
        await page.getByRole("button", { name: "Save" }).click();
        await page.getByText("Settings saved.", { exact: false }).waitFor({ timeout: 15_000 });
        return `The first tab saved 3. The second tab, still on the older version, showed "${msg}" on Save. The first tab then saved 2 again.`;
      },
    );
    await step(
      "V-C45-advanced-settings",
      "administrator",
      "browser-walkthrough",
      "System status before restarting",
      "Database available, active storage and document service shown, API and Worker rows Running with Restart required.",
      async () => {
        await page.goto(`${ORIGIN}/settings/system-status`);
        await page.getByRole("button", { name: "Refresh" }).waitFor({ timeout: 20_000 });
        const st = await statusRows(page);
        expect(/Database: available/.test(st.text) && /Active storage: local/.test(st.text) && /Document service: http:\/\/doc-engine:8080/.test(st.text), st.text.slice(0, 300));
        expect(st.rows.length >= 2 && st.rows.every((r) => /Running Restart required/.test(r)), st.rows.join(" | "));
        return `System status shows "Database: available", "Active storage: local", "Document service: http://doc-engine:8080". Rows: ${st.rows.join(" | ")}.`;
      },
    );
  } finally {
    await s.context.close();
  }
  await step(
    "V-C45-advanced-settings",
    "administrator",
    "container-operation",
    "docker compose restart app worker, then Refresh System status and check the saved values apply",
    "Both processes show Running and Current; the saved values are active: a 2 MiB + 1 byte upload is refused and the timeouts show no Active: line.",
    async () => {
      await restartBoth();
      const s2 = await signIn(ORIGIN, ADMIN.email, state.adminPassword);
      try {
        await s2.page.goto(`${ORIGIN}/settings/system-status`);
        await s2.page.getByRole("button", { name: "Refresh" }).waitFor({ timeout: 20_000 });
        let st;
        for (let i = 0; i < 10; i++) {
          st = await statusRows(s2.page);
          if (st.rows.filter((r) => /Running Current/.test(r)).length >= 2 && !st.rows.some((r) => /Restart required/.test(r))) break;
          await sleep(3000);
        }
        const api = s2.page.request;
        const over = await api.post(`${ORIGIN}/api/v1/contracts/${state.contractNumber}/documents`, {
          headers: { origin: ORIGIN },
          multipart: { file: textFile("doc030-2m.txt", Buffer.alloc(2 * 1024 * 1024 + 1, 97)) },
        });
        const ok = await api.post(`${ORIGIN}/api/v1/contracts/${state.contractNumber}/documents`, {
          headers: { origin: ORIGIN },
          multipart: { file: textFile("doc030-2m-ok.txt", Buffer.alloc(2 * 1024 * 1024, 97)) },
        });
        const proc = await json(await api.get(`${ORIGIN}/api/v1/advanced-settings/processing`));
        const mcp = await json(await api.get(`${ORIGIN}/api/v1/advanced-settings/mcp`));
        const active = [...proc.fields, ...mcp.fields].map((f) => `${f.key}=${f.activeValue}`).join(", ");
        expect(st.rows.every((r) => /Running Current/.test(r)) && over.status() === 413 && ok.status() === 201, `${st.rows} ${over.status()} ${ok.status()}`);
        expect(!proc.restartRequired && !mcp.restartRequired, "restartRequired still true");
        return `After docker compose restart app worker and Refresh: ${st.rows.join(" | ")}. A 2,097,153-byte upload answered ${over.status()} "${(await json(over)).detail}"; 2,097,152 bytes answered ${ok.status()}. Active values: ${active}; neither page reports a pending restart.`;
      } finally {
        await s2.context.close();
      }
    },
  );
  await step(
    "V-C45-advanced-settings",
    "administrator",
    "container-operation",
    "Stop the worker for over a minute, then Refresh System status; start it again",
    "The worker row shows No recent heartbeat and the page warns that a heartbeat is missing; after start both rows are Running.",
    async () => {
      compose("stop worker");
      await sleep(75_000);
      const s3 = await signIn(ORIGIN, ADMIN.email, state.adminPassword);
      try {
        const resp = await s3.page.goto(`${ORIGIN}/settings/system-status`);
        try {
          await s3.page.getByRole("button", { name: "Refresh" }).waitFor({ timeout: 20_000 });
        } catch (e) {
          await s3.page.screenshot({ path: path.join(PRIVATE, "status-kill.png") });
          const api = await s3.page.request.get(`${ORIGIN}/api/v1/system-status`);
          throw new Error(`System status page did not render (document ${resp?.status()}, API ${api.status()} ${(await api.text()).slice(0, 300)}): ${(await s3.page.locator("body").innerText()).slice(0, 300)}`);
        }
        const down = await statusRows(s3.page);
        compose("start worker");
        await sleep(20_000);
        const back = await statusRows(s3.page);
        const warn = /An API or worker heartbeat is missing\. Check that both services are running\./.test(down.text);
        expect(warn && down.rows.some((r) => /^Worker No recent heartbeat/.test(r)), `${down.rows} warn ${warn}`);
        expect(back.rows.some((r) => /^Worker Running Current/.test(r)), `${back.rows}`);
        return `With the worker stopped for 75 s: ${down.rows.join(" | ")}, and the page showed "An API or worker heartbeat is missing. Check that both services are running." After docker compose start worker and Refresh: ${back.rows.join(" | ")}.`;
      } finally {
        await s3.context.close();
      }
    },
  );
  await step(
    "V-C45-advanced-settings",
    "administrator",
    "browser-walkthrough",
    "Audit log after the Advanced saves",
    "Each save wrote an Audit log entry without credentials.",
    async () => {
      const api = await adminApi();
      const r = await json(await api.get("/api/v1/audit-log"));
      const rows = (r.entries ?? r.items ?? r.events ?? r.activity ?? []).filter((e) => JSON.stringify(e).includes("advanced."));
      expect(rows.length >= 4, `advanced entries ${rows.length}: ${JSON.stringify(r).slice(0, 200)}`);
      const fields = rows.map((e) => e.payload?.field ?? JSON.stringify(e).match(/advanced\.[a-z_A-Z.]+/)?.[0]);
      return `The Audit log API lists ${rows.length} entries for Advanced saves (${[...new Set(fields)].join(", ")}), each with old "[configuration]" and new "[configuration saved; restart required]" and no values.`;
    },
  );
};

phases.nonadmin = async () => {
  await step(
    "V-C45-advanced-settings",
    "administrator",
    "browser-walkthrough",
    "Negative check as the Legal Team Member: Settings navigation, the Advanced addresses, and the API",
    "The navigation does not show Advanced; opening its addresses leads elsewhere; the API answers 403.",
    async () => {
      const s = await signIn(ORIGIN, COLLEAGUE.email, state.colleaguePassword);
      try {
        await s.page.goto(`${ORIGIN}/settings/profile`);
        await s.page.waitForLoadState("networkidle").catch(() => {});
        const adv = await s.page.getByRole("button", { name: "Advanced", exact: true }).count();
        const landed = [];
        for (const p of ["/settings/instance", "/settings/uploads", "/settings/storage", "/settings/document-processing", "/settings/mcp-limits", "/settings/system-status"]) {
          await s.page.goto(`${ORIGIN}${p}`);
          await s.page.waitForLoadState("networkidle").catch(() => {});
          landed.push(`${p} → ${new URL(s.page.url()).pathname}`);
        }
        const codes = [];
        for (const p of ["/api/v1/advanced-settings/instance", "/api/v1/system-status"])
          codes.push(`GET ${p} ${(await s.page.request.get(`${ORIGIN}${p}`)).status()}`);
        const put = await s.page.request.put(`${ORIGIN}/api/v1/advanced-settings/uploads`, {
          headers: { origin: ORIGIN },
          data: { version: "x", values: { MAX_UPLOAD_MB: "9" } },
        });
        codes.push(`PUT uploads ${put.status()}`);
        expect(adv === 0 && landed.every((l) => l.endsWith("/settings/profile")) && codes.every((c) => c.endsWith("403")), `${adv} ${landed} ${codes}`);
        return `Signed in as the Legal Team Member ${COLLEAGUE.name}: the Settings navigation has no Advanced group. ${landed.join("; ")}. ${codes.join("; ")}.`;
      } finally {
        await s.context.close();
      }
    },
  );
};

phases["advanced-nav"] = async () => {
  const s = await signIn(ORIGIN, ADMIN.email, state.adminPassword);
  const { page } = s;
  try {
    await step(
      "V-C45-advanced-settings",
      "administrator",
      "browser-walkthrough",
      "Open Settings → Advanced at the bottom of the navigation",
      "The Advanced group holds Outbound email, Authentication, Audit log, Instance address, File uploads, Document storage, Document processing, MCP and System status.",
      async () => {
        await page.goto(`${ORIGIN}/settings/profile`);
        const adv = page.getByRole("button", { name: "Advanced", exact: true });
        await adv.waitFor({ timeout: 20_000 });
        if ((await adv.getAttribute("aria-expanded")) !== "true") await adv.click();
        await sleep(500);
        const rail = page.locator("#settings-rail-advanced");
        const links = (await rail.getByRole("link").allInnerTexts()).map((t) => t.trim()).filter(Boolean);
        const all = (await page.locator("nav").last().getByRole("button").allInnerTexts()).map((t) => t.trim()).filter(Boolean);
        const want = ["Outbound email", "Authentication", "Audit log", "Instance address", "File uploads", "Document storage", "Document processing", "MCP", "System status"];
        expect(JSON.stringify(links) === JSON.stringify(want), `links: ${links.join(", ")}`);
        return `Settings navigation: the Advanced group button is the last group button (${all.slice(-2).join(", ")}). Expanded, it lists: ${links.join(", ")}.`;
      },
    );
  } finally {
    await s.context.close();
  }
};

phases["advanced-restart"] = async () => {
  await step(
    "V-C45-advanced-settings",
    "administrator",
    "container-operation",
    "docker compose restart app worker again (settings unchanged), then Refresh System status at once and after a minute",
    "After the restart both processes show Running and Current.",
    async () => {
      await restartBoth();
      const s2 = await signIn(ORIGIN, ADMIN.email, state.adminPassword);
      try {
        await s2.page.goto(`${ORIGIN}/settings/system-status`);
        await s2.page.getByRole("button", { name: "Refresh" }).waitFor({ timeout: 20_000 });
        const first = await statusRows(s2.page);
        await sleep(65_000);
        const later = await statusRows(s2.page);
        expect(later.rows.length === 2 && later.rows.every((r) => /Running Current/.test(r)), later.rows.join(" | "));
        return `Right after the restart, Refresh showed: ${first.rows.join(" | ")}. 65 s later Refresh showed: ${later.rows.join(" | ")}. The API process that was restarted keeps a Running row until its last heartbeat is a minute old (the worker's old row disappears at once), so during the first minute a reader can see an extra API row marked Restart required.`;
      } finally {
        await s2.context.close();
      }
    },
  );
  await step(
    "V-C45-advanced-settings",
    "administrator",
    "container-operation",
    "Kill the worker (docker compose kill worker) so it cannot remove its heartbeat, wait over a minute, Refresh; then start it",
    "The worker row shows No recent heartbeat and the page warns that a heartbeat is missing; after start the worker is Running and Current.",
    async () => {
      compose("kill worker");
      await sleep(75_000);
      const s3 = await signIn(ORIGIN, ADMIN.email, state.adminPassword);
      try {
        const resp = await s3.page.goto(`${ORIGIN}/settings/system-status`);
        try {
          await s3.page.getByRole("button", { name: "Refresh" }).waitFor({ timeout: 20_000 });
        } catch (e) {
          await s3.page.screenshot({ path: path.join(PRIVATE, "status-kill.png") });
          const api = await s3.page.request.get(`${ORIGIN}/api/v1/system-status`);
          throw new Error(`System status page did not render (document ${resp?.status()}, API ${api.status()} ${(await api.text()).slice(0, 300)}): ${(await s3.page.locator("body").innerText()).slice(0, 300)}`);
        }
        const down = await statusRows(s3.page);
        compose("start worker");
        await sleep(20_000);
        const back = await statusRows(s3.page);
        const warn = /An API or worker heartbeat is missing\. Check that both services are running\./.test(down.text);
        expect(warn && down.rows.some((r) => /^Worker No recent heartbeat/.test(r)), `${down.rows} warn ${warn}`);
        expect(back.rows.some((r) => /^Worker Running Current/.test(r)), `${back.rows}`);
        return `75 s after docker compose kill worker: ${down.rows.join(" | ")}, with "An API or worker heartbeat is missing. Check that both services are running." After docker compose start worker and Refresh: ${back.rows.join(" | ")}. (In the earlier attempt, docker compose stop worker removed the worker's row entirely: the page showed the warning and only the API row, not a No recent heartbeat row.)`;
      } finally {
        await s3.context.close();
      }
    },
  );
};

// PHASES-END
const name = process.argv[2];
if (!phases[name]) {
  console.error(`Unknown phase ${name}. Phases: ${Object.keys(phases).join(", ")}`);
  process.exit(2);
}
try {
  await phases[name]();
} finally {
  run.completedAt = new Date().toISOString();
  saveLog();
  await closeBrowser();
}
