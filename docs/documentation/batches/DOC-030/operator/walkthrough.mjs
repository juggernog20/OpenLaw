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
  const wait = lastSignIn + 6000 - Date.now();
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

const AZURITE_KEY =
  "Eby8vdM02xNOcqFlqUwJPLlmEtlCDXJ1OUzFT50uSRZ6IFsuFq2UVErCz4I6tq/K1SZFPTOtr/KBHBeksoGMGw==";
async function s3Client() {
  const { S3Client, CreateBucketCommand, ListObjectsV2Command } = require(
    pnpm("@aws-sdk+client-s3@3.1139.0/node_modules/@aws-sdk/client-s3"),
  );
  const client = new S3Client({
    endpoint: MINIO_HOST,
    region: "us-east-1",
    forcePathStyle: true,
    credentials: { accessKeyId: state.minioUser, secretAccessKey: state.minioPassword },
  });
  return {
    create: (Bucket) => client.send(new CreateBucketCommand({ Bucket })),
    list: async (Bucket) => (await client.send(new ListObjectsV2Command({ Bucket }))).Contents ?? [],
  };
}
async function azureContainer(name, create = false) {
  const { BlobServiceClient, StorageSharedKeyCredential } = require(
    pnpm("@azure+storage-blob@12.33.0/node_modules/@azure/storage-blob"),
  );
  const svc = new BlobServiceClient(
    `${AZURITE_HOST}/devstoreaccount1`,
    new StorageSharedKeyCredential("devstoreaccount1", AZURITE_KEY),
  );
  const c = svc.getContainerClient(name);
  if (create) await c.create();
  const blobs = [];
  for await (const b of c.listBlobsFlat()) blobs.push(b.name);
  return blobs;
}
async function storageForm(page) {
  await page.goto(`${ORIGIN}/settings/storage`);
  await page.getByLabel("Store new documents in").waitFor({ timeout: 20_000 });
}

phases.storage = async () => {
  const s = await signIn(ORIGIN, ADMIN.email, state.adminPassword);
  const { page } = s;
  try {
    await step(
      "V-C45-advanced-settings",
      "administrator",
      "browser-walkthrough",
      "Document storage: choose S3-compatible storage for a bucket created first in MinIO, with endpoint http://minio:9000, and select Test connection",
      "Save is unavailable before a passing test; Local storage path is read only; an internal DNS name over plain http is refused.",
      async () => {
        const s3 = await s3Client();
        await s3.create("doc030-app");
        await storageForm(page);
        const localPath = await fieldSource(page, "Local storage path");
        await page.getByLabel("Store new documents in").selectOption("s3");
        await page.getByLabel("S3 bucket").fill("doc030-app");
        await page.getByLabel("S3 endpoint (optional for AWS)").fill("http://minio:9000");
        await page.getByLabel("S3 path-style addressing").selectOption("true");
        await page.getByLabel("S3 access key ID").fill(state.minioUser);
        await page.getByLabel("S3 secret access key").fill(state.minioPassword);
        const saveDisabled = await page.getByRole("button", { name: "Save" }).isDisabled();
        await page.getByRole("button", { name: "Test connection" }).click();
        const alert = page.getByRole("alert").filter({ hasText: /https|failed/ });
        await alert.first().waitFor({ timeout: 20_000 });
        const msg = (await alert.first().innerText()).trim();
        const stillDisabled = await page.getByRole("button", { name: "Save" }).isDisabled();
        expect(saveDisabled && stillDisabled && /S3_ENDPOINT must use https/.test(msg), `${saveDisabled} ${stillDisabled} ${msg}`);
        expect(localPath.includes("Deployment configuration · Read only") || localPath.some((l) => /Read only/.test(l)), `local path ${localPath}`);
        return `Bucket doc030-app created in MinIO first. Local storage path reads ${localPath.slice(0, 1).join("")} with "${localPath.find((l) => /Read only/.test(l))}". After choosing S3-compatible storage and entering bucket, endpoint http://minio:9000, path-style Yes and the MinIO keys, Save was disabled. Test connection showed "${msg}" and Save stayed disabled.`;
      },
    );
  } finally {
    await s.context.close();
  }
  await step(
    "V-C45-advanced-settings",
    "administrator",
    "container-operation",
    "Operator adds OPENLAW_PLAIN_HTTP_HOSTS=minio,azurite to .env and recreates app and worker",
    "The app and worker receive the list.",
    async () => {
      setEnv({ OPENLAW_PLAIN_HTTP_HOSTS: "minio,azurite" });
      expect(up().code === 0, "up failed");
      expect((await waitReady()) === 200, "not ready");
      return `up exited 0; OPENLAW_PLAIN_HTTP_HOSTS in the app container: ${containerEnv("app", "OPENLAW_PLAIN_HTTP_HOSTS")}; worker: ${containerEnv("worker", "OPENLAW_PLAIN_HTTP_HOSTS")} (Compose passes .env through env_file).`;
    },
  );
  const s2 = await signIn(ORIGIN, ADMIN.email, state.adminPassword);
  try {
    const page = s2.page;
    await step(
      "V-C45-advanced-settings",
      "administrator",
      "browser-walkthrough",
      "Document storage: enter the S3 settings again, Test connection, edit a field, test again, then Save",
      "The test passes and enables Save; an edit disables Save until the next test; Save shows the restart message; credentials come back blank and write-only; bucket and endpoint become read only.",
      async () => {
        await storageForm(page);
        await page.getByLabel("Store new documents in").selectOption("s3");
        await page.getByLabel("S3 bucket").fill("doc030-app");
        await page.getByLabel("S3 endpoint (optional for AWS)").fill("http://minio:9000");
        await page.getByLabel("S3 path-style addressing").selectOption("true");
        await page.getByLabel("S3 access key ID").fill(state.minioUser);
        await page.getByLabel("S3 secret access key").fill(state.minioPassword);
        await page.getByRole("button", { name: "Test connection" }).click();
        await page.getByText("Connection test passed.").waitFor({ timeout: 20_000 });
        const enabled = await page.getByRole("button", { name: "Save" }).isEnabled();
        await page.getByLabel("S3 region").fill("eu-west-1");
        const disabledAfterEdit = await page.getByRole("button", { name: "Save" }).isDisabled();
        await page.getByRole("button", { name: "Test connection" }).click();
        await page.getByText("Connection test passed.").waitFor({ timeout: 20_000 });
        await page.getByRole("button", { name: "Save" }).click();
        await page.getByText("Settings saved. Restart the API and worker to apply changes.").waitFor({ timeout: 15_000 });
        await storageForm(page);
        const secretVal = await page.getByLabel("S3 secret access key").inputValue();
        const keyVal = await page.getByLabel("S3 access key ID").inputValue();
        const secretType = await page.getByLabel("S3 secret access key").getAttribute("type");
        const text = await page.locator("main").innerText();
        const kept = (text.match(/Credential configured\. Leave blank to keep it\./g) ?? []).length;
        const bucket = await fieldSource(page, "S3 bucket");
        const endpoint = await fieldSource(page, "S3 endpoint (optional for AWS)");
        const driver = await fieldSource(page, "Store new documents in");
        const st = await json(await page.request.get(`${ORIGIN}/api/v1/advanced-settings/storage`));
        const leaked = JSON.stringify(st).includes(state.minioPassword) || JSON.stringify(st).includes(state.minioUser);
        expect(enabled && disabledAfterEdit && secretVal === "" && keyVal === "" && kept === 2 && !leaked, `${enabled} ${disabledAfterEdit} ${secretVal.length} ${keyVal.length} ${kept} leaked ${leaked}`);
        expect(bucket.some((l) => /Saved in OpenLaw · Read only/.test(l)) && endpoint.some((l) => /Read only/.test(l)), `${bucket} ${endpoint}`);
        return `Test connection showed "Connection test passed." and enabled Save; changing S3 region to eu-west-1 disabled Save until another test passed; Save showed "Settings saved. Restart the API and worker to apply changes." On reload, both credential fields (type ${secretType}) were empty, each with "Credential configured. Leave blank to keep it."; the API state carries no credential value. S3 bucket reads "${bucket.filter((l) => /Saved|Read/.test(l)).join(" ")}", S3 endpoint "${endpoint.filter((l) => /Saved|Read/.test(l)).join(" ")}". Store new documents in: ${driver.filter((l) => /Saved|Active/.test(l)).join(" / ")}.`;
      },
    );
    await step(
      "V-C45-advanced-settings",
      "administrator",
      "container-operation",
      "Try to change the configured bucket through the API",
      "The API refuses a change to a configured storage location.",
      async () => {
        const st = await json(await page.request.get(`${ORIGIN}/api/v1/advanced-settings/storage`));
        const r = await page.request.put(`${ORIGIN}/api/v1/advanced-settings/storage`, {
          headers: { origin: ORIGIN },
          data: { version: st.version, values: { S3_BUCKET: "doc030-other" } },
        });
        const body = await json(r);
        expect(r.status() === 400 && /existing storage location cannot be changed/.test(body.detail), `${r.status()} ${body.detail}`);
        return `PUT with S3_BUCKET=doc030-other answered ${r.status()} "${body.detail}".`;
      },
    );
  } finally {
    await s2.context.close();
  }
  await step(
    "V-C45-advanced-settings",
    "administrator",
    "container-operation",
    "docker compose restart app worker; upload a new Document and download it and the older local Document",
    "New writes go to the S3 bucket; the older local Document stays readable; the worker processes the new one; System status names the s3 driver.",
    async () => {
      await restartBoth();
      const api = await adminApi();
      const f = pdfFile("doc030-s3-app.pdf", "DOC-030 operator app saved S3 storage");
      const u = await upload(api, state.contractNumber, f);
      expect(u.status === 201, `upload ${u.status}`);
      const d = await download(api, u);
      const old = await download(api, state.docs.local);
      const t = await waitText(api, u);
      const ref = storageRef(u.versionId);
      const objects = await (await s3Client()).list("doc030-app");
      const sys = await json(await api.get("/api/v1/system-status"));
      state.docs.s3 = u;
      saveState();
      expect(d.matches && old.matches && t.state === "ready" && ref.startsWith("s3:") && sys.storageDriver === "s3", `${d.status} ${old.status} ${t.state} ${ref.split(":")[0]} ${sys.storageDriver}`);
      return `After restart, System status reports storage driver ${sys.storageDriver}. A new PDF answered 201; its stored reference starts with s3: and the bucket doc030-app holds ${objects.length} object(s); the download matched its SHA-256; the worker's text state became ${t.state}. The older local Document still downloaded with identical bytes.`;
    },
  );
  await step(
    "V-C45-advanced-settings",
    "administrator",
    "browser-walkthrough",
    "Test connection again with the credential fields left blank",
    "A blank credential keeps the configured credential, so the test passes.",
    async () => {
      const s3 = await signIn(ORIGIN, ADMIN.email, state.adminPassword);
      try {
        await storageForm(s3.page);
        await s3.page.getByRole("button", { name: "Test connection" }).click();
        await s3.page.getByText("Connection test passed.").waitFor({ timeout: 20_000 });
        return `With both credential fields blank, Test connection showed "Connection test passed." (it writes, reads and deletes a check object in local storage and the S3 bucket).`;
      } finally {
        await s3.context.close();
      }
    },
  );
  await step(
    "V-C45",
    "operator",
    "container-operation",
    "Make the object store unavailable (stop MinIO); check readiness, downloads and the storage test; start MinIO again",
    "readyz stays 200 while the S3 Document's download fails and the local one works; the storage test fails; everything recovers after MinIO starts.",
    async () => {
      sh("docker compose stop minio", { cwd: FIX });
      const api = await adminApi();
      const rz = await readyz();
      const s3dl = await download(api, state.docs.s3, 40_000);
      const localdl = await download(api, state.docs.local);
      const st = await json(await api.get("/api/v1/advanced-settings/storage"));
      const values = Object.fromEntries(st.fields.filter((f) => !f.locked).map((f) => [f.key, f.value]));
      const test = await api.post("/api/v1/advanced-settings/storage/test", { data: { version: st.version, values } });
      const tbody = await json(test);
      sh("docker compose start minio", { cwd: FIX });
      await sleep(5000);
      const again = await download(api, state.docs.s3);
      expect(rz === 200 && s3dl.status !== 200 && localdl.matches && test.status() === 502 && again.matches, `${rz} ${s3dl.status} ${localdl.status} ${test.status()} ${again.status}`);
      return `With MinIO stopped: /readyz answered ${rz}; the S3 Document's download answered ${s3dl.status}; the local Document downloaded with identical bytes; the storage test answered ${test.status()} "${tbody.detail}". After docker compose start minio the S3 Document downloaded again with identical bytes.`;
    },
  );
  await step(
    "V-C45",
    "operator",
    "container-operation",
    "Local driver: check that app and worker mount the same named volume at STORAGE_PATH",
    "Both containers mount the project's openlaw-files volume at /var/lib/openlaw/files.",
    () => {
      const m = (svc) =>
        sh(`docker inspect --format '{{range .Mounts}}{{.Name}}:{{.Destination}} {{end}}' $(docker compose ps -q ${svc})`).stdout.trim();
      const a = m("app");
      const w = m("worker");
      expect(a === w && a.includes(`${PROJECT}_openlaw-files:/var/lib/openlaw/files`), `${a} / ${w}`);
      const files = sh(`docker compose exec -T worker sh -c 'find /var/lib/openlaw/files -type f | wc -l'`).stdout.trim();
      return `app mounts ${a}; worker mounts ${w}; the worker sees ${files} stored file(s) there, including the local Document the app wrote.`;
    },
  );
  await step(
    "V-C45",
    "operator",
    "container-operation",
    "azure-blob through .env: create the container first in Azurite, set STORAGE_DRIVER=azure-blob and the AZURE_BLOB_* variables, recreate, upload and download",
    "New writes go to Azure Blob; the worker processes them; the S3 and local Documents stay readable; the Document storage fields set in .env become Deployment configuration · Read only.",
    async () => {
      await azureContainer("doc030-env", true);
      setEnv({
        STORAGE_DRIVER: "azure-blob",
        AZURE_BLOB_CONTAINER: "doc030-env",
        AZURE_BLOB_ACCOUNT: "devstoreaccount1",
        AZURE_BLOB_ACCOUNT_KEY: AZURITE_KEY,
        AZURE_BLOB_ENDPOINT: "http://azurite:10000/devstoreaccount1",
      });
      expect(up().code === 0, "up failed");
      expect((await waitReady()) === 200, "not ready");
      await sleep(3000);
      const api = await adminApi();
      const f = pdfFile("doc030-azure-env.pdf", "DOC-030 operator Azure Blob through the environment");
      const u = await upload(api, state.contractNumber, f);
      expect(u.status === 201, `upload ${u.status}`);
      const d = await download(api, u);
      const t = await waitText(api, u);
      const ref = storageRef(u.versionId);
      const blobs = await azureContainer("doc030-env");
      const s3dl = await download(api, state.docs.s3);
      const localdl = await download(api, state.docs.local);
      state.docs.azure = u;
      saveState();
      const st = await json(await api.get("/api/v1/advanced-settings/storage"));
      const src = Object.fromEntries(st.fields.map((f) => [f.key, `${f.source}${f.locked ? " (read only)" : ""}`]));
      expect(d.matches && t.state === "ready" && ref.startsWith("azure-blob:") && s3dl.matches && localdl.matches, `${d.status} ${t.state} ${ref.split(":")[0]} ${s3dl.status} ${localdl.status}`);
      expect(src.STORAGE_DRIVER.startsWith("deployment") && src.AZURE_BLOB_CONTAINER.startsWith("deployment") && src.S3_BUCKET.startsWith("app"), JSON.stringify(src));
      return `Container doc030-env created first. After up, a new PDF answered 201 with a stored reference starting azure-blob:, the container holds ${blobs.length} blob(s), the download matched, and the worker's text state became ${t.state}. The app-saved S3 Document and the local Document still downloaded with identical bytes. Document storage sources: STORAGE_DRIVER ${src.STORAGE_DRIVER}, AZURE_BLOB_CONTAINER ${src.AZURE_BLOB_CONTAINER}, AZURE_BLOB_ACCOUNT_KEY ${src.AZURE_BLOB_ACCOUNT_KEY}, S3_BUCKET ${src.S3_BUCKET}, STORAGE_PATH ${src.STORAGE_PATH}.`;
    },
  );
};

phases["storage-recheck"] = async () => {
  await step(
    "V-C45-advanced-settings",
    "administrator",
    "browser-walkthrough",
    "Reopen Document storage and read the saved S3 fields (repeat of the failed read in the earlier attempt)",
    "Credentials come back blank and write-only with the help text Credential configured. Leave blank to keep it.; bucket and endpoint are read only.",
    async () => {
      const s = await signIn(ORIGIN, ADMIN.email, state.adminPassword);
      try {
        const page = s.page;
        await storageForm(page);
        const out = {};
        for (const label of ["S3 access key ID", "S3 secret access key"]) {
          const input = page.getByLabel(label);
          const box = input.locator("xpath=ancestor::div[1]");
          out[label] = {
            value: await input.inputValue(),
            type: await input.getAttribute("type"),
            help: (await box.locator("span[hidden]").allTextContents()).join(" ").trim(),
          };
        }
        await page.getByLabel("S3 secret access key").locator("xpath=ancestor::div[1]").getByRole("button", { name: "More information" }).hover();
        await sleep(800);
        const tip = (await page.getByRole("dialog").allInnerTexts().catch(() => [])).join(" ").trim() || (await page.locator("[data-radix-popper-content-wrapper]").allInnerTexts()).join(" ");
        const bucket = await fieldSource(page, "S3 bucket");
        const endpoint = await fieldSource(page, "S3 endpoint (optional for AWS)");
        const ok = Object.values(out).every((f) => f.value === "" && f.help === "Credential configured. Leave blank to keep it.");
        expect(ok, JSON.stringify(out));
        return `S3 access key ID and S3 secret access key are empty (types ${out["S3 access key ID"].type} and ${out["S3 secret access key"].type}); each field's More information help reads "${out["S3 secret access key"].help}" (hover shows "${tip.trim()}"). S3 bucket: ${bucket.filter((l) => /Saved|Read/.test(l)).join(" ")}; S3 endpoint: ${endpoint.filter((l) => /Saved|Read/.test(l)).join(" ")}. The earlier attempt looked for the help text in the visible page; it sits behind the field's More information button.`;
      } finally {
        await s.context.close();
      }
    },
  );
};

phases["storage-ttl"] = async () => {
  await step(
    "V-C45-advanced-settings",
    "administrator",
    "container-operation",
    "Pass a storage test, wait more than 10 minutes without restarting, then save the same values",
    "The API refuses a storage save more than 10 minutes after the test; a fresh test lets the same save through.",
    async () => {
      const api = await adminApi();
      const st = await json(await api.get("/api/v1/advanced-settings/storage"));
      const values = Object.fromEntries(st.fields.filter((f) => !f.locked).map((f) => [f.key, f.value]));
      const t = await api.post("/api/v1/advanced-settings/storage/test", { data: { version: st.version, values } });
      const testedAt = Date.now();
      await sleep(10 * 60_000 + 30_000);
      const api2 = await adminApi();
      const late = await api2.put("/api/v1/advanced-settings/storage", { data: { version: st.version, values } });
      const lateBody = await json(late);
      const t2 = await api2.post("/api/v1/advanced-settings/storage/test", { data: { version: st.version, values } });
      const ok = await api2.put("/api/v1/advanced-settings/storage", { data: { version: st.version, values } });
      expect(t.status() === 200 && late.status() === 409 && t2.status() === 200 && ok.status() === 200, `${t.status()} ${late.status()} ${t2.status()} ${ok.status()}`);
      return `Unlocked fields sent unchanged (${Object.keys(values).join(", ")}). The test answered ${t.status()}. ${Math.round((Date.now() - testedAt) / 1000)} s later the save answered ${late.status()} "${lateBody.detail}". A new test answered ${t2.status()} and the same save then answered ${ok.status()}.`;
    },
  );
};

const DEV_ORIGIN = "http://localhost:3000";
function caddyfile(extra = "") {
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
${extra}`,
  );
  const r = sh("docker compose restart proxy", { cwd: FIX });
  expect(r.code === 0, `proxy restart ${r.code}`);
}
// The default Instance address is http://localhost:3000. Host port 127.0.0.1:3000 belongs to an
// unrelated local service, so the reviewer serves [::1]:3000 through Caddy and checks a marker
// header before signing in there.
const LOCALHOST_SITE = `
http://localhost:3000 {
\tbind [::1]
\theader X-Doc030-Lab cfg1
\treverse_proxy 127.0.0.1:${APP_PORT}
}
`;
async function devSession() {
  const b = await chromium.launch({
    headless: true,
    args: ["--host-resolver-rules=MAP localhost [::1]"],
  });
  const context = await b.newContext({ baseURL: DEV_ORIGIN });
  context.on("close", () => b.close().catch(() => {}));
  const page = await context.newPage();
  const r = await page.goto(`${DEV_ORIGIN}/auth/login`);
  expect(r.headers()["x-doc030-lab"] === "cfg1", "localhost:3000 did not reach this lab");
  await paceSignIn();
  await page.getByLabel("Email").fill(ADMIN.email);
  await page.getByLabel("Password", { exact: true }).fill(state.adminPassword);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.waitForURL((u) => !u.pathname.startsWith("/auth/login"), { timeout: 30_000 });
  return { context, page };
}
async function saveInstance(page, base, value) {
  await page.goto(`${base}/settings/instance`);
  await page.getByLabel("Application address").waitFor({ timeout: 20_000 });
  await page.getByLabel("Application address").fill(value);
  await page.getByRole("button", { name: "Save" }).click();
  const box = page.getByRole("alert").filter({ hasText: /saved|must|could not|BASE_URL/ });
  await box.first().waitFor({ timeout: 15_000 });
  return (await box.first().innerText()).trim();
}
const resetCmd = (section) =>
  `docker compose run -T --rm --no-deps app node apps/api/dist/reset-advanced-settings.js ${section}`;

phases.instance = async () => {
  await step(
    "V-C45-advanced-settings",
    "administrator",
    "container-operation",
    "Operator leaves BASE_URL empty: remove it from .env and recreate app and worker",
    "Without BASE_URL the Instance address falls back to OpenLaw's default and the app warns; the proxy origin no longer passes the origin check.",
    async () => {
      setEnv({ BASE_URL: null });
      const since = new Date().toISOString();
      expect(up().code === 0, "up failed");
      expect((await waitReady()) === 200, "not ready");
      const warn = /The instance address is http:\/\/localhost:3000/.test(logsSince("app", since));
      const viaProxy = await apiClient(ORIGIN, ADMIN.email, state.adminPassword);
      caddyfile(LOCALHOST_SITE);
      expect(warn && viaProxy.signInStatus === 403, `warn ${warn} proxy sign-in ${viaProxy.signInStatus}`);
      return `After removing BASE_URL and up, the app logged "The instance address is http://localhost:3000; emailed links and OIDC callbacks will point there." Sign-in through ${ORIGIN} now answered ${viaProxy.signInStatus}. The reviewer added a Caddy site for http://localhost:3000 on [::1] (the host's 127.0.0.1:3000 is taken) to reach the default origin.`;
    },
  );
  const s = await devSession();
  try {
    await step(
      "V-C45-advanced-settings",
      "administrator",
      "browser-walkthrough",
      "At the default origin, open Instance address and try an address with a path and a public plain-http address",
      "Application address shows the default with source Default; a path and plain http on a public name are refused with the reason.",
      async () => {
        await s.page.goto(`${DEV_ORIGIN}/settings/instance`);
        await s.page.getByLabel("Application address").waitFor({ timeout: 20_000 });
        const before = await fieldSource(s.page, "Application address");
        const value = await s.page.getByLabel("Application address").inputValue();
        const withPath = await saveInstance(s.page, DEV_ORIGIN, `${ORIGIN}/openlaw`);
        const plain = await saveInstance(s.page, DEV_ORIGIN, "http://openlaw.company.example");
        expect(value === DEV_ORIGIN && before.includes("Default") && /without a path/.test(withPath) && /must use https/.test(plain), `${value} ${before} | ${withPath} | ${plain}`);
        return `Application address read ${value} with source "Default". Saving ${ORIGIN}/openlaw showed "${withPath}". Saving http://openlaw.company.example showed "${plain}".`;
      },
    );
    await step(
      "V-C45-advanced-settings",
      "administrator",
      "container-operation",
      "Save plain-http private and allow-listed addresses through the API, then the intended HTTPS address in the browser",
      "http on a private IP and on a host in OPENLAW_PLAIN_HTTP_HOSTS are accepted, an unlisted internal name is refused; the HTTPS address saves with Active: showing the old value.",
      async () => {
        const put = async (v) => {
          const st = await json(await s.page.request.get(`${DEV_ORIGIN}/api/v1/advanced-settings/instance`));
          const r = await s.page.request.put(`${DEV_ORIGIN}/api/v1/advanced-settings/instance`, {
            headers: { origin: DEV_ORIGIN },
            data: { version: st.version, values: { BASE_URL: v } },
          });
          return `${v} → ${r.status()}`;
        };
        const a = await put("http://10.20.30.40:8443");
        const b = await put("http://minio:8443");
        const c = await put("http://openlaw-internal:8443");
        const since = new Date().toISOString();
        const msg = await saveInstance(s.page, DEV_ORIGIN, ORIGIN);
        const src = await fieldSource(s.page, "Application address");
        await sleep(1000);
        const hostLog = logsSince("app", since)
          .split("\n")
          .filter((l) => /endpoint host changed/.test(l))
          .map((l) => {
            try {
              const j = JSON.parse(l.replace(/^.*?\|\s*/, ""));
              return `${j.msg}: ${j.key} ${j.from} → ${j.to}`;
            } catch {
              return l.slice(0, 160);
            }
          });
        expect(a.endsWith("200") && b.endsWith("200") && c.endsWith("400") && /Settings saved/.test(msg) && src.includes(`Active: ${DEV_ORIGIN}`), `${a} ${b} ${c} ${msg} ${src}`);
        return `API saves: ${a}; ${b} (minio is listed in OPENLAW_PLAIN_HTTP_HOSTS); ${c} (an internal DNS name that is not listed). Browser: Application address ${ORIGIN} then Save showed "${msg}", with "${src.filter((l) => /Saved|Active/.test(l)).join(" / ")}". Process log: ${hostLog.join("; ") || "(none)"}.`;
      },
    );
  } finally {
    await s.context.close();
  }
  await step(
    "V-C45-advanced-settings",
    "administrator",
    "container-operation",
    "docker compose restart app worker, then sign in through the saved address and check an emailed link",
    "After both restart, the saved address is the origin: sign-in works through the proxy and a new sign-in email links to it.",
    async () => {
      await restartBoth();
      const api = await adminApi();
      const st = await json(await api.get("/api/v1/advanced-settings/instance"));
      const f = st.fields[0];
      const since = new Date().toISOString();
      const page = await newSession();
      await page.page.goto(`${ORIGIN}/auth/login`);
      await page.page.getByLabel("Email").waitFor({ timeout: 30_000 });
      await page.page.getByLabel("Email").fill(COLLEAGUE.email);
      const link = page.page.getByRole("button", { name: "Email me a sign-in link" });
      if (await link.count()) await link.click();
      const msg = await waitMail(COLLEAGUE.email, null, since, 30_000);
      await page.context.close();
      const origin = msg ? firstLink(msg).origin : "no mail";
      const audit = await json(await api.get("/api/v1/audit-log"));
      const hosts = (audit.entries ?? []).filter((e) => JSON.stringify(e).includes("advanced.BASE_URL.host")).length;
      expect(f.value === ORIGIN && f.activeValue === ORIGIN && f.source === "app" && origin === ORIGIN, `${JSON.stringify(f)} mail ${origin}`);
      return `After restart, sign-in through ${ORIGIN} answered 200; Instance address reads ${f.value}, active ${f.activeValue}, source ${f.source}. A sign-in link requested for ${COLLEAGUE.name} arrived with a link on ${origin}. The Audit log holds ${hosts} host-change entries for advanced.BASE_URL.host.`;
    },
  );
  await step(
    "V-C45-advanced-settings",
    "administrator",
    "container-operation",
    "A saved address that prevents sign-in: save https://openlaw-wrong.localhost:25799 and restart both",
    "Sign-in through the real origin is refused after the restart.",
    async () => {
      const api = await adminApi();
      const st = await json(await api.get("/api/v1/advanced-settings/instance"));
      const r = await api.put("/api/v1/advanced-settings/instance", {
        data: { version: st.version, values: { BASE_URL: "https://openlaw-wrong.localhost:25799" } },
      });
      await restartBoth();
      const c = await apiClient(ORIGIN, ADMIN.email, state.adminPassword);
      expect(r.status() === 200 && c.signInStatus === 403, `${r.status()} ${c.signInStatus}`);
      return `The save answered ${r.status()}. After docker compose restart app worker, sign-in through ${ORIGIN} answered ${c.signInStatus}.`;
    },
  );
  await step(
    "V-C45",
    "operator",
    "container-operation",
    "Recovery: set BASE_URL in .env and recreate app and worker",
    "The environment value pins the address, sign-in works again, and the saved wrong value is ignored.",
    async () => {
      setEnv({ BASE_URL: ORIGIN });
      expect(up().code === 0, "up failed");
      expect((await waitReady()) === 200, "not ready");
      const api = await adminApi();
      const st = await json(await api.get("/api/v1/advanced-settings/instance"));
      const f = st.fields[0];
      expect(f.source === "deployment" && f.locked && f.value === ORIGIN, JSON.stringify(f));
      return `After BASE_URL=${ORIGIN} and up, sign-in through the proxy answered 200. Instance address reads ${f.value}, source ${f.source}, read only ${f.locked}; the saved https://openlaw-wrong.localhost:25799 is ignored.`;
    },
  );
  await step(
    "V-C45",
    "operator",
    "container-operation",
    "Recovery command: docker compose run -T --rm --no-deps app node apps/api/dist/reset-advanced-settings.js instance, then docker compose restart app worker",
    "The command removes only the instance section's saved overrides, prints no values and writes an Audit log entry.",
    async () => {
      const r = sh(resetCmd("instance"));
      const out = (r.stdout + r.stderr).trim();
      compose("restart app worker");
      expect((await waitReady()) === 200, "not ready");
      const api = await adminApi();
      const audit = await json(await api.get("/api/v1/audit-log"));
      const entry = (audit.entries ?? []).find((e) => JSON.stringify(e).includes("deployment defaults restored by operator"));
      const mcp = await json(await api.get("/api/v1/advanced-settings/mcp"));
      expect(r.code === 0 && /Saved instance overrides removed\./.test(out) && !/openlaw-wrong/.test(out) && entry, `${r.code} ${out.slice(0, 300)}`);
      expect(mcp.fields.every((f) => f.source === "app"), "other sections changed");
      const line = out.split("\n").find((l) => /overrides removed/.test(l)) ?? "";
      return `Exit ${r.code}; output "${line.trim()}". No saved value was printed. The Audit log has an entry with new value "${JSON.stringify(entry).match(/\[deployment defaults[^\]]*\]/)?.[0]}". The MCP fields keep source app, so other sections were untouched.`;
    },
  );
  await step(
    "V-C45",
    "operator",
    "container-operation",
    "Confirm the reset: remove BASE_URL again and check that the default returns, then restore BASE_URL",
    "With the saved override gone, the Instance address falls back to the default, not to the saved wrong address.",
    async () => {
      setEnv({ BASE_URL: null });
      expect(up().code === 0, "up failed");
      expect((await waitReady()) === 200, "not ready");
      const s2 = await devSession();
      const st = await json(await s2.page.request.get(`${DEV_ORIGIN}/api/v1/advanced-settings/instance`));
      await s2.context.close();
      setEnv({ BASE_URL: ORIGIN });
      expect(up().code === 0, "up failed");
      expect((await waitReady()) === 200, "not ready");
      const f = st.fields[0];
      expect(f.value === DEV_ORIGIN && f.source === "default", JSON.stringify(f));
      return `With BASE_URL removed, Instance address read ${f.value} with source ${f.source}. BASE_URL=${ORIGIN} was then restored and app and worker recreated.`;
    },
  );
  await step(
    "V-C45",
    "operator",
    "container-operation",
    "Run the recovery command with mcp and with an unknown section",
    "mcp is accepted and removes the MCP overrides; an unknown section is refused with the usage line.",
    async () => {
      const m = sh(resetCmd("mcp"));
      const bad = sh(resetCmd("everything"));
      compose("restart app worker");
      expect((await waitReady()) === 200, "not ready");
      const api = await adminApi();
      const mcp = await json(await api.get("/api/v1/advanced-settings/mcp"));
      const usage = (bad.stdout + bad.stderr).split("\n").find((l) => /Usage:/.test(l)) ?? "";
      expect(m.code === 0 && bad.code !== 0 && mcp.fields.every((f) => f.source === "default"), `${m.code} ${bad.code} ${JSON.stringify(mcp.fields)}`);
      return `mcp: exit ${m.code}, "${(m.stdout.match(/Saved mcp overrides removed\.[^\n]*/) ?? [""])[0]}"; after restart both MCP fields show source default (${mcp.fields.map((f) => `${f.key}=${f.activeValue}`).join(", ")}). "everything": exit ${bad.code}, "${usage.replace(/^.*?Usage/, "Usage")}". The usage line does not list mcp, although mcp is accepted.`;
    },
  );
  caddyfile("");
};

phases.engine = async () => {
  await step(
    "V-C45",
    "operator",
    "container-operation",
    "Set DOC_ENGINE_TIMEOUT_MS=420001 and recreate; while the app restarts, run the recovery command for processing",
    "App and worker stop at startup naming the bound; docker compose run --rm still runs the recovery command.",
    async () => {
      setEnv({ DOC_ENGINE_TIMEOUT_MS: "420001" });
      const since = new Date().toISOString();
      up();
      const a = await waitExitOrRestart("app");
      const w = await waitExitOrRestart("worker");
      await sleep(3000);
      const pick = (svc) => logsSince(svc, since).split("\n").map((l) => l.replace(/^.*?\|\s*/, "")).find((l) => /DOC_ENGINE_TIMEOUT_MS/.test(l)) ?? "";
      const line = pick("app");
      const wline = pick("worker");
      const r = sh(resetCmd("processing"));
      setEnv({ DOC_ENGINE_TIMEOUT_MS: null });
      expect(up().code === 0, "up failed");
      expect((await waitReady()) === 200, "not ready");
      const api = await adminApi();
      const proc = await json(await api.get("/api/v1/advanced-settings/processing"));
      expect(/restart|exited/i.test(`${a?.state} ${a?.status}`) && line && wline && r.code === 0, `${JSON.stringify(a)} ${JSON.stringify(w)} ${line} ${r.code}`);
      return `App: ${a.state} (${a.status}); worker: ${w?.state} (${w?.status}). App log: "${line.slice(0, 200)}". The worker log carries the same bound. While the app was restarting, the recovery command for processing exited ${r.code} with "${(r.stdout.match(/Saved processing overrides removed\.[^\n]*/) ?? [""])[0]}". After removing the variable and up, readyz 200; Processing and Comparison timeouts now show ${proc.fields.filter((f) => f.key !== "DOC_ENGINE_URL").map((f) => `${f.activeValue} (${f.source})`).join(" and ")}.`;
    },
  );
  await step(
    "V-C45",
    "operator",
    "container-operation",
    "Set DOC_ENGINE_COMPARE_TIMEOUT_MS=840001 and recreate",
    "App and worker stop at startup; removing it recovers.",
    async () => {
      setEnv({ DOC_ENGINE_COMPARE_TIMEOUT_MS: "840001" });
      const since = new Date().toISOString();
      up();
      const a = await waitExitOrRestart("app");
      await sleep(3000);
      const pick = (svc) => logsSince(svc, since).split("\n").map((l) => l.replace(/^.*?\|\s*/, "")).find((l) => /DOC_ENGINE_COMPARE_TIMEOUT_MS/.test(l)) ?? "";
      const line = pick("app");
      const wline = pick("worker");
      setEnv({ DOC_ENGINE_COMPARE_TIMEOUT_MS: null });
      expect(up().code === 0, "up failed");
      expect((await waitReady()) === 200, "not ready");
      expect(line && wline, `${line} / ${wline}`);
      return `App: ${a?.state} (${a?.status}). App log: "${line.slice(0, 200)}"; the worker log carries it too. After removing it and up, readyz 200.`;
    },
  );
  await phases.limits();
  const burst = (n) => {
    const script = `const pdf=Buffer.from('%PDF-1.4\\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj 2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj 3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 612 792]>>endobj\\ntrailer<</Root 1 0 R>>\\n%%EOF');Promise.all(Array.from({length:${n}},()=>fetch('http://doc-engine:8080/ocr',{method:'POST',body:pdf}).then(r=>r.status+'/'+(r.headers.get('retry-after')||'-')).catch(e=>'err'))).then(a=>console.log(a.join(' ')))`;
    writeFileSync(path.join(PRIVATE, "burst.js"), script);
    return sh(`docker compose exec -T app node - < ${path.join(PRIVATE, "burst.js")}`, { timeout: 300_000 }).stdout.trim();
  };
  await step(
    "V-C45",
    "operator",
    "container-operation",
    "Engine concurrency: send 12 OCR requests at once with the defaults, then 5 with DOC_ENGINE_MAX_CONCURRENT=1 and DOC_ENGINE_MAX_QUEUED=1",
    "Past the running and waiting slots the engine answers 503 with Retry-After: 2 of 12 with 2+8 slots, 3 of 5 with 1+1.",
    async () => {
      const d = burst(12);
      setEnv({ DOC_ENGINE_MAX_CONCURRENT: "1", DOC_ENGINE_MAX_QUEUED: "1" });
      expect(up().code === 0, "up failed");
      await waitHealthy("doc-engine", 120_000);
      const c = burst(5);
      setEnv({ DOC_ENGINE_MAX_CONCURRENT: null, DOC_ENGINE_MAX_QUEUED: null });
      expect(up().code === 0, "up failed");
      await waitHealthy("doc-engine", 120_000);
      const n503 = (x) => x.split(" ").filter((y) => y.startsWith("503/")).length;
      const retry = (x) => [...new Set(x.split(" ").filter((y) => y.startsWith("503/")).map((y) => y.split("/")[1]))].join(",");
      expect(n503(d) === 2 && n503(c) === 3 && !/503\/-/.test(d + c), `${d} | ${c}`);
      return `From inside the app container: 12 concurrent POST /ocr with the defaults answered [${d}] (status/Retry-After): ${n503(d)} refused with 503, Retry-After ${retry(d)}. With DOC_ENGINE_MAX_CONCURRENT=1 and DOC_ENGINE_MAX_QUEUED=1, 5 concurrent answered [${c}]: ${n503(c)} refused. The variables were removed again.`;
    },
  );
  await step(
    "V-C45",
    "operator",
    "container-operation",
    "Stop the document engine, upload a PDF, and check readiness, processing and the Document processing test; start it again",
    "readyz stays 200 while processing does not complete and the test fails; after start a new PDF is processed.",
    async () => {
      compose("stop doc-engine");
      const api = await adminApi();
      const rz = await readyz();
      const u = await upload(api, state.contractNumber, pdfFile("doc030-engine-down.pdf", "DOC-030 operator engine down"));
      await sleep(45_000);
      const t = await textState(api, u);
      const st = await json(await api.get("/api/v1/advanced-settings/processing"));
      const values = Object.fromEntries(st.fields.filter((f) => !f.locked).map((f) => [f.key, f.value]));
      const test = await api.post("/api/v1/advanced-settings/processing/test", { data: { version: st.version, values } });
      const tb = await json(test);
      compose("start doc-engine");
      await waitHealthy("doc-engine", 120_000);
      const u2 = await upload(api, state.contractNumber, pdfFile("doc030-engine-up.pdf", "DOC-030 operator engine back"));
      const t2 = await waitText(api, u2, 180_000);
      const t1b = await waitText(api, u, 240_000);
      expect(rz === 200 && t.state !== "ready" && test.status() === 502 && t2.state === "ready", `${rz} ${t.state} ${test.status()} ${t2.state}`);
      return `With doc-engine stopped: /readyz ${rz}; a PDF uploaded then (201) still had text state "${t.state}" after 45 s; Document processing Test connection answered ${test.status()} "${tb.detail}". After docker compose start doc-engine, a new PDF reached "${t2.state}", and the earlier PDF reached "${t1b.state}".`;
    },
  );
};

phases["instance-link"] = async () => {
  await step(
    "V-C45-advanced-settings",
    "administrator",
    "container-operation",
    "Repeat (the earlier attempt lost its browser page to ERR_NETWORK_CHANGED): with BASE_URL empty, save Application address in the browser, docker compose restart app worker, sign in through the saved address and check an emailed link",
    "After both restart, the saved address is the origin: sign-in works through the proxy and a new sign-in email links to it.",
    async () => {
      setEnv({ BASE_URL: null });
      expect(up().code === 0, "up failed");
      expect((await waitReady()) === 200, "not ready");
      caddyfile(LOCALHOST_SITE);
      const s = await devSession();
      const msg0 = await saveInstance(s.page, DEV_ORIGIN, ORIGIN);
      await s.context.close();
      await restartBoth();
      const api = await adminApi();
      const st = await json(await api.get("/api/v1/advanced-settings/instance"));
      const f = st.fields[0];
      const since = new Date().toISOString();
      const page = await newSession();
      for (let i = 0; i < 3; i++) {
        try {
          await page.page.goto(`${ORIGIN}/auth/login`);
          break;
        } catch (e) {
          if (i === 2) throw e;
          await sleep(3000);
        }
      }
      await page.page.getByLabel("Email").waitFor({ timeout: 30_000 });
      await sleep(1000);
      if (!(await page.page.getByRole("button", { name: "Send link" }).count()))
        await page.page.getByRole("button", { name: "Email me a sign-in link" }).click();
      await page.page.getByLabel("Email").fill(COLLEAGUE.email);
      await page.page.getByRole("button", { name: "Send link" }).click();
      await page.page.getByText("Check your email").first().waitFor({ timeout: 15_000 });
      const msg = await waitMail(COLLEAGUE.email, null, since, 30_000);
      await page.context.close();
      const origin = msg ? firstLink(msg).origin : "no mail";
      const audit = await json(await api.get("/api/v1/audit-log"));
      const hosts = (audit.entries ?? []).filter((e) => JSON.stringify(e).includes("advanced.BASE_URL.host")).length;
      // Put the deployment back the way the rest of the walkthrough expects it.
      setEnv({ BASE_URL: ORIGIN });
      const r = sh(resetCmd("instance"));
      expect(up().code === 0, "up failed");
      compose("restart app worker");
      expect((await waitReady()) === 200, "not ready");
      caddyfile("");
      expect(/Settings saved/.test(msg0) && f.value === ORIGIN && f.activeValue === ORIGIN && f.source === "app" && origin === ORIGIN && r.code === 0, `${msg0} ${JSON.stringify(f)} mail ${origin}`);
      return `Save showed "${msg0}". After docker compose restart app worker, sign-in through ${ORIGIN} answered 200; Instance address reads ${f.value}, active ${f.activeValue}, source ${f.source}. "Email me a sign-in link", Email, Send link ("Check your email") for ${COLLEAGUE.name} delivered "${msg.Subject}" with a link on ${origin}. The Audit log holds ${hosts} entries for advanced.BASE_URL.host. Afterwards BASE_URL was set in .env again, the instance override removed with the recovery command, and both services restarted.`;
    },
  );
};

phases.limits = async () => {
  await step(
    "V-C45",
    "operator",
    "container-operation",
    "Read the container limits and engine scratch space, then raise APP_MEM_LIMIT and lower DOC_ENGINE_TMPFS_SIZE and recreate",
    "Defaults: app and worker 2 CPUs, 1g, 256 processes; engine 2 CPUs, 4g, 512 processes, /tmp 2g. The changed values apply after up.",
    async () => {
      const lim = (svc) => {
        const id = compose(`ps -q ${svc}`).stdout.trim();
        return sh(`docker inspect --format '{{.HostConfig.NanoCpus}} {{.HostConfig.Memory}} {{.HostConfig.PidsLimit}} {{with index .HostConfig \"Tmpfs\"}}{{json .}}{{end}}' ${id}`).stdout.trim();
      };
      const before = { app: lim("app"), worker: lim("worker"), engine: lim("doc-engine") };
      setEnv({ APP_MEM_LIMIT: "1536m", DOC_ENGINE_TMPFS_SIZE: "1g" });
      expect(up().code === 0, "up failed");
      expect((await waitReady()) === 200, "not ready");
      const after = { app: lim("app"), engine: lim("doc-engine") };
      setEnv({ APP_MEM_LIMIT: null, DOC_ENGINE_TMPFS_SIZE: null });
      expect(up().code === 0, "up failed");
      expect((await waitReady()) === 200, "not ready");
      expect(before.app.startsWith("2000000000 1073741824 256") && before.worker.startsWith("2000000000 1073741824 256") && before.engine.startsWith("2000000000 4294967296 512") && /size=2g/.test(before.engine), JSON.stringify(before));
      expect(after.app.startsWith("2000000000 1610612736 256") && /size=1g/.test(after.engine), JSON.stringify(after));
      return `Defaults (NanoCpus, memory bytes, pids, tmpfs): app ${before.app}; worker ${before.worker}; doc-engine ${before.engine}. With APP_MEM_LIMIT=1536m and DOC_ENGINE_TMPFS_SIZE=1g after up: app ${after.app}; doc-engine ${after.engine}. Both removed again and recreated.`;
    },
  );
};

async function testEmail(api) {
  const since = new Date().toISOString();
  const r = await api.post("/api/v1/email-settings/test");
  const body = await json(r);
  const msg = r.status() === 200 ? await waitMail(ADMIN.email, "test email", since, 30_000) : null;
  return { status: r.status(), detail: body.detail, delivered: Boolean(msg), from: msg?.From?.Address };
}
async function advancedSources(api) {
  const out = {};
  for (const section of ["uploads", "storage"]) {
    const st = await json(await api.get(`/api/v1/advanced-settings/${section}`));
    for (const f of st.fields ?? []) if (["MAX_UPLOAD_MB", "S3_BUCKET", "STORAGE_DRIVER"].includes(f.key)) out[f.key] = `${f.activeValue || f.value} (${f.source})`;
  }
  return out;
}

phases.keys = async () => {
  await step(
    "V-C45",
    "operator",
    "container-operation",
    "Rotate OPENLAW_SECRET_KEY: keep the old value in OPENLAW_SECRET_KEY_PREVIOUS, set a new key, recreate, check the re-encryption result and the saved configuration",
    "The app logs that stored credentials were resealed; the saved relay delivers and the app-saved S3 store still reads.",
    async () => {
      const old = envValue("OPENLAW_SECRET_KEY");
      state.oldSecretKey = old;
      state.newSecretKey = randomBytes(32).toString("base64");
      saveState();
      setEnv({ OPENLAW_SECRET_KEY_PREVIOUS: old, OPENLAW_SECRET_KEY: state.newSecretKey });
      const since = new Date().toISOString();
      expect(up().code === 0, "up failed");
      expect((await waitReady()) === 200, "not ready");
      const line = logsSince("app", since).split("\n").map((l) => l.replace(/^.*?\|\s*/, "")).find((l) => /resealed/.test(l)) ?? "";
      const api = await adminApi();
      const mail = await testEmail(api);
      const s3 = await download(api, state.docs.s3);
      expect(/Stored credentials resealed under the key in use/.test(line) && mail.delivered && s3.matches, `${line} ${JSON.stringify(mail)} ${s3.status}`);
      return `App log: "${line}". The stored relay delivered a test email; the app-saved S3 Document downloaded with identical bytes.`;
    },
  );
  await step(
    "V-C45",
    "operator",
    "container-operation",
    "Remove OPENLAW_SECRET_KEY_PREVIOUS, recreate, and verify again",
    "The saved configuration works under the new key alone.",
    async () => {
      setEnv({ OPENLAW_SECRET_KEY_PREVIOUS: null });
      const since = new Date().toISOString();
      expect(up().code === 0, "up failed");
      expect((await waitReady()) === 200, "not ready");
      const api = await adminApi();
      const mail = await testEmail(api);
      const s3 = await download(api, state.docs.s3);
      const unreadable = /No configured key opens/.test(logsSince("app", since));
      state.sourcesBefore = await advancedSources(api);
      saveState();
      expect(mail.delivered && s3.matches && !unreadable, `${JSON.stringify(mail)} ${s3.status} ${unreadable}`);
      return `After removing OPENLAW_SECRET_KEY_PREVIOUS and up: the test email was delivered, the S3 Document downloaded with identical bytes, and the log has no "No configured key opens" warning. Saved Advanced values in use: ${JSON.stringify(state.sourcesBefore)}.`;
    },
  );
  await step(
    "V-C45",
    "operator",
    "container-operation",
    "Mismatched key: set OPENLAW_SECRET_KEY to a different valid key and recreate; check startup, Advanced values, storage, the relay and the start log",
    "App and worker still start. Saved Advanced values fall back and show Default; storage becomes local, so the saved-bucket Document fails to download; a test email fails with the SMTP-not-configured message; the start log names the affected columns in a No configured key opens line and says device notifications are off.",
    async () => {
      setEnv({ OPENLAW_SECRET_KEY: randomBytes(32).toString("base64") });
      const since = new Date().toISOString();
      expect(up().code === 0, "up failed");
      const rz = await waitReady(120_000);
      await sleep(3000);
      const w = containerState("worker");
      const log = logsSince("app", since).split("\n").map((l) => l.replace(/^.*?\|\s*/, ""));
      const noKey = log.find((l) => /No configured key opens these stored credentials/.test(l)) ?? "";
      const push = log.find((l) => /Device notifications are off until the VAPID pair can be read/.test(l)) ?? "";
      expect(rz === 200, `readyz ${rz}`);
      const api = await adminApi();
      const sources = await advancedSources(api);
      const upl = await json(await api.get("/api/v1/advanced-settings/uploads"));
      const sys = await json(await api.get("/api/v1/system-status"));
      const s3 = await download(api, state.docs.s3, 20_000);
      const local = await download(api, state.docs.local);
      const mail = await testEmail(api);
      const detail = `App readyz ${rz}; worker ${w?.state}. Advanced values now: ${JSON.stringify(sources)} (before: ${JSON.stringify(state.sourcesBefore)}); Maximum file size source "${upl.fields[0].source}". System status storage driver: ${sys.storageDriver}. The app-saved S3 Document's download answered ${s3.status}; the local Document ${local.matches ? "downloaded with identical bytes" : `answered ${local.status}`}. Test email: ${mail.status} "${mail.detail}". Start log: "${noKey.slice(0, 260)}"; "${push.slice(0, 160)}".`;
      expect(w?.state === "running" && upl.fields[0].source === "default" && sys.storageDriver === "local" && s3.status !== 200 && /SMTP is not configured — save a relay first\./.test(mail.detail ?? "") && /advanced_settings/.test(noKey) && /smtp_url/.test(noKey) && push, detail);
      return detail;
    },
  );
  await step(
    "V-C45",
    "operator",
    "container-operation",
    "With the mismatched key still set, run the recovery command for one section (processing), then restore the correct key and recreate",
    "The command still exits successfully but replaces the whole saved configuration with an empty one; after the correct key is back, every section's saved values are gone.",
    async () => {
      const r = sh(resetCmd("processing"));
      const out = (r.stdout + r.stderr).split("\n").find((l) => /overrides removed|decrypted/.test(l)) ?? "";
      setEnv({ OPENLAW_SECRET_KEY: state.newSecretKey });
      const since = new Date().toISOString();
      expect(up().code === 0, "up failed");
      expect((await waitReady()) === 200, "not ready");
      const api = await adminApi();
      const sources = await advancedSources(api);
      const mail = await testEmail(api);
      const s3 = await download(api, state.docs.s3, 20_000);
      const noKey = /No configured key opens/.test(logsSince("app", since));
      const detail = `The recovery command for processing exited ${r.code}: "${out.trim()}". After restoring the correct key and up: Advanced values ${JSON.stringify(sources)} (before: ${JSON.stringify(state.sourcesBefore)}); the S3 Document download answered ${s3.status}; the saved relay ${mail.delivered ? "delivered a test email (the relay is sealed in its own column)" : `failed: ${mail.status} ${mail.detail}`}; unreadable-credential warning at start: ${noKey}.`;
      expect(r.code === 0 && !/app/.test(sources.MAX_UPLOAD_MB) && !/app/.test(sources.S3_BUCKET ?? "") && s3.status !== 200, detail);
      return detail;
    },
  );
  await step(
    "V-C45-advanced-settings",
    "administrator",
    "browser-walkthrough",
    "After the lost saved values: save the S3 store again in Document storage (Test connection, Save), then docker compose restart app worker",
    "A value saved again replaces the unreadable one; the older S3 Document reads again.",
    async () => {
      const s = await signIn(ORIGIN, ADMIN.email, state.adminPassword);
      try {
        const page = s.page;
        await storageForm(page);
        // STORAGE_DRIVER is pinned to azure-blob by .env; the S3 reader is saved again.
        await page.getByLabel("S3 bucket").waitFor({ timeout: 5000 }).catch(() => {});
        if (!(await page.getByLabel("S3 bucket").count())) {
          const st = await json(await page.request.get(`${ORIGIN}/api/v1/advanced-settings/storage`));
          const values = { S3_BUCKET: "doc030-app", S3_ENDPOINT: "http://minio:9000", S3_FORCE_PATH_STYLE: "true", S3_REGION: "eu-west-1", S3_ACCESS_KEY_ID: state.minioUser, S3_SECRET_ACCESS_KEY: state.minioPassword };
          const t = await page.request.post(`${ORIGIN}/api/v1/advanced-settings/storage/test`, { headers: { origin: ORIGIN }, data: { version: st.version, values } });
          const r = await page.request.put(`${ORIGIN}/api/v1/advanced-settings/storage`, { headers: { origin: ORIGIN }, data: { version: st.version, values } });
          expect(t.status() === 200 && r.status() === 200, `${t.status()} ${r.status()}`);
          state.resaveNote = "The S3 fields are hidden while the pinned driver is azure-blob and no bucket is saved, so the reviewer tested and saved them through the same API the page uses";
        } else {
          await page.getByLabel("S3 bucket").fill("doc030-app");
          await page.getByLabel("S3 endpoint (optional for AWS)").fill("http://minio:9000");
          await page.getByLabel("S3 path-style addressing").selectOption("true");
          await page.getByLabel("S3 access key ID").fill(state.minioUser);
          await page.getByLabel("S3 secret access key").fill(state.minioPassword);
          await page.getByRole("button", { name: "Test connection" }).click();
          await page.getByText("Connection test passed.").waitFor({ timeout: 20_000 });
          await page.getByRole("button", { name: "Save" }).click();
          await page.getByText("Settings saved. Restart the API and worker to apply changes.").waitFor({ timeout: 15_000 });
          state.resaveNote = "Document storage: bucket, endpoint, path style and keys entered again; Test connection passed; Save showed the restart message";
        }
        saveState();
      } finally {
        await s.context.close();
      }
      await restartBoth();
      const api = await adminApi();
      const s3 = await download(api, state.docs.s3);
      expect(s3.matches, `s3 ${s3.status}`);
      return `${state.resaveNote}. After docker compose restart app worker, the older S3 Document downloaded with identical bytes.`;
    },
  );
  await phases["auth-secret"]();
};

function vapidPair() {
  const { createECDH } = require("node:crypto");
  const ecdh = createECDH("prime256v1");
  ecdh.generateKeys();
  return { pub: ecdh.getPublicKey().toString("base64url"), priv: ecdh.getPrivateKey().toString("base64url") };
}
phases.vapid = async () => {
  await step(
    "V-C45",
    "operator",
    "container-operation",
    "Web Push keys: read the generated public key, set only VAPID_PUBLIC_KEY, then both keys, then neither",
    "Unset, OpenLaw serves a generated pair; one key alone stops startup; both keys pin the pair for app and worker; removing them returns to the stored pair.",
    async () => {
      const api = await adminApi();
      const gen = (await json(await api.get("/api/v1/me/notification-preferences"))).vapidPublicKey;
      const pair = vapidPair();
      setEnv({ VAPID_PUBLIC_KEY: pair.pub });
      const since = new Date().toISOString();
      up();
      const a = await waitExitOrRestart("app");
      const w = await waitExitOrRestart("worker");
      await sleep(3000);
      const line = (svc) => logsSince(svc, since).split("\n").map((l) => l.replace(/^.*?\|\s*/, "")).find((l) => /VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY/.test(l)) ?? "";
      const aLine = line("app");
      const wLine = line("worker");
      setEnv({ VAPID_PRIVATE_KEY: pair.priv });
      expect(up().code === 0, "up failed");
      expect((await waitReady()) === 200, "not ready");
      const api2 = await adminApi();
      const pinned = (await json(await api2.get("/api/v1/me/notification-preferences"))).vapidPublicKey;
      const wEnv = containerEnv("worker", "VAPID_PUBLIC_KEY") === pair.pub;
      setEnv({ VAPID_PUBLIC_KEY: null, VAPID_PRIVATE_KEY: null });
      expect(up().code === 0, "up failed");
      expect((await waitReady()) === 200, "not ready");
      const api3 = await adminApi();
      const back = (await json(await api3.get("/api/v1/me/notification-preferences"))).vapidPublicKey;
      expect(gen && aLine && wLine && pinned === pair.pub && wEnv && back === gen, `${Boolean(gen)} app "${aLine}" worker "${wLine}" ${pinned === pair.pub} ${wEnv} ${back === gen} app ${JSON.stringify(a)} worker ${JSON.stringify(w)}`);
      return `Unset: the API served a generated public key (prefix ${gen.slice(0, 10)}…). With only VAPID_PUBLIC_KEY: app ${a?.state} (${a?.status}), worker ${w?.state} (${w?.status}); both logs "${aLine}". With both keys: the API served the pinned public key (prefix ${pair.pub.slice(0, 10)}…) and the worker received the same pair. With both removed: the API served the earlier generated key again.`;
    },
  );
};

phases.mail = async () => {
  await step(
    "V-C45",
    "operator",
    "container-operation",
    "Set SMTP_URL=smtp://relay:1025 without SMTP_FROM and recreate; check the test email, the sign-in pages, Send invite and Resend invite",
    "No email can be sent: the test is refused, the sign-in pages hide both email links, Send invite refuses with a message naming the environment and leaves no Invited row, Resend invite shows the same message, and the relay receives nothing.",
    async () => {
      // An Invited row to resend: invite Casey while the saved relay still works.
      const api0 = await adminApi();
      const inv = await api0.post("/api/v1/auth/invites", { data: { email: "casey.invitee@doc030-cfg.example", displayName: "Casey Invitee", role: "legal_team_member" } });
      expect([200, 201].includes(inv.status()), `fixture invite ${inv.status()}`);
      setEnv({ SMTP_URL: "smtp://relay:1025", SMTP_FROM: null });
      expect(up().code === 0, "up failed");
      expect((await waitReady()) === 200, "not ready");
      await sleep(2000);
      const before = await mailTotal();
      const api = await adminApi();
      const test = await testEmail(api);
      const offers = {};
      for (const p of ["/auth/login", "/portal/login"]) {
        const s = await newSession();
        await s.page.goto(`${ORIGIN}${p}`);
        await s.page.getByRole("heading").first().waitFor({ timeout: 30_000 });
        await s.page.waitForLoadState("networkidle").catch(() => {});
        await sleep(1200);
        const pw = s.page.getByRole("button", { name: "Sign in with a password" });
        if (await pw.count()) await pw.first().click();
        offers[p] = [];
        for (const name of ["Set up or reset your password", "Email me a sign-in link"])
          if (await s.page.getByRole("button", { name }).count()) offers[p].push(name);
        await s.context.close();
      }
      const s = await signIn(ORIGIN, ADMIN.email, state.adminPassword);
      let inviteMsg, rowCount, resendMsg;
      try {
        const page = s.page;
        await page.goto(`${ORIGIN}/settings/users`);
        await page.getByRole("button", { name: "Invite user" }).click();
        const dialog = page.getByRole("dialog");
        await dialog.getByLabel("Display name").fill("Dana Newcomer");
        await dialog.getByLabel("Email").fill("dana.newcomer@doc030-cfg.example");
        const answered = page.waitForResponse((r) => r.url().endsWith("/api/v1/auth/invites") && r.request().method() === "POST");
        await dialog.getByRole("button", { name: "Send invite" }).click();
        const resp = await answered;
        await sleep(1500);
        inviteMsg = `${resp.status()} "${(await page.getByRole("alert").allInnerTexts()).map((t) => t.trim()).filter(Boolean).join(" | ")}"`;
        await page.screenshot({ path: path.join(here, "invite-without-smtp-from.png") });
        await page.keyboard.press("Escape");
        await page.reload();
        await page.getByRole("button", { name: "Invite user" }).waitFor({ timeout: 20_000 });
        rowCount = await page.getByRole("row").filter({ hasText: "dana.newcomer@doc030-cfg.example" }).count();
        const row = page.getByRole("row").filter({ hasText: "casey.invitee@doc030-cfg.example" });
        const resend = row.getByRole("button", { name: "Resend invite" });
        if (await resend.count()) {
          const ans = page.waitForResponse((r) => /invite/.test(r.url()) && r.request().method() === "POST");
          await resend.first().click();
          const rr = await ans;
          await sleep(1500);
          resendMsg = `${rr.status()} "${(await row.innerText()).replace(/\s+/g, " ").trim().slice(0, 300)}"`;
        } else resendMsg = `no Resend invite on Casey's row: "${(await row.innerText().catch(() => "")).replace(/\s+/g, " ").trim()}"`;
      } finally {
        await s.context.close();
      }
      const after = await mailTotal();
      const detail = `Test email: ${test.status} "${test.detail}". Sign-in pages offer: /auth/login [${offers["/auth/login"].join(", ")}], /portal/login [${offers["/portal/login"].join(", ")}]. Settings → Users → Invite user → Send invite for the fictional Dana Newcomer: ${inviteMsg}; after reload ${rowCount} row for her. Resend invite on Casey Invitee's Invited row: ${resendMsg}. Relay message count ${before} before and ${after} after.`;
      expect(test.status !== 200 && offers["/auth/login"].length === 0 && offers["/portal/login"].length === 0 && /^4\d\d/.test(inviteMsg) && /environment|SMTP_FROM/.test(inviteMsg) && rowCount === 0 && after === before, detail);
      return `${detail} Screenshot invite-without-smtp-from.png.`;
    },
  );
  await step(
    "V-C45",
    "operator",
    "container-operation",
    "Set SMTP_FROM as well, recreate, and invite a test address",
    "The invitation reaches the relay from SMTP_FROM with a link on BASE_URL.",
    async () => {
      setEnv({ SMTP_FROM: '"DOC-030 env relay <env-relay@doc030-cfg.example>"' });
      expect(up().code === 0, "up failed");
      expect((await waitReady()) === 200, "not ready");
      const api = await adminApi();
      const since = new Date().toISOString();
      const r = await api.post("/api/v1/auth/invites", { data: { email: "dana.newcomer@doc030-cfg.example", displayName: "Dana Newcomer", role: "legal_team_member" } });
      const msg = await waitMail("dana.newcomer@doc030-cfg.example", null, since, 30_000);
      const origin = msg ? firstLink(msg).origin : null;
      expect(msg && msg.From.Address === "env-relay@doc030-cfg.example" && origin === ORIGIN, `${r.status()} ${JSON.stringify(await json(r)).slice(0, 200)} from ${msg?.From?.Address} origin ${origin}`);
      return `The invite answered ${r.status()}; "${msg.Subject}" arrived at the relay from ${msg.From.Address} with a link on ${origin}.`;
    },
  );
  await step(
    "V-C45",
    "operator",
    "container-operation",
    "With SMTP_URL pointing at an unreachable relay and SMTP_FROM set, send a test email; then remove both and send again",
    "A set SMTP_URL wins over the saved wizard relay even when it cannot deliver; removing it restores the saved relay.",
    async () => {
      setEnv({ SMTP_URL: "smtp://relay-missing.invalid:1025" });
      expect(up().code === 0, "up failed");
      expect((await waitReady()) === 200, "not ready");
      const api = await adminApi();
      const bad = await testEmail(api);
      const settings = await json(await api.get("/api/v1/email-settings"));
      setEnv({ SMTP_URL: null, SMTP_FROM: null });
      expect(up().code === 0, "up failed");
      expect((await waitReady()) === 200, "not ready");
      const api2 = await adminApi();
      const good = await testEmail(api2);
      const settings2 = await json(await api2.get("/api/v1/email-settings"));
      expect(bad.status !== 200 && good.delivered && good.from === "openlaw@doc030-cfg.example", `${JSON.stringify(bad)} ${JSON.stringify(good)}`);
      return `Unreachable env relay: the test answered ${bad.status} "${bad.detail}"; email settings report source ${settings.source}. After removing SMTP_URL and SMTP_FROM and up, source ${settings2.source}, and the test email was delivered from ${good.from} (the relay saved in the wizard).`;
    },
  );
};

phases.database = async () => {
  const extUrl = () => `postgres://doc030ext:${state.extdbPassword}@extdb:5432/doc030ext`;
  await step(
    "V-C45",
    "operator",
    "container-operation",
    "Set DATABASE_URL to the external postgres:16 and recreate",
    "The app migrates the empty external database and starts; the bundled Postgres keeps running; the external database has no users yet.",
    async () => {
      setEnv({ DATABASE_URL: extUrl() });
      const since = new Date().toISOString();
      expect(up().code === 0, "up failed");
      const ready = await waitReady(240_000);
      const setup = await fetch(`${LOCAL}/api/v1/auth/setup`).then((x) => x.json());
      const migrations = sh(`docker compose exec -T extdb psql -U doc030ext -d doc030ext -At -c "select count(*) from drizzle.__drizzle_migrations"`, { cwd: FIX }).stdout.trim();
      const bundled = containerState("postgres");
      const token = /Paste this setup token/.test(logsSince("app", since));
      expect(ready === 200 && setup.needsSetup === true && bundled.state === "running", `${ready} ${JSON.stringify(setup)} ${bundled.state}`);
      return `readyz ${ready}; GET /api/v1/auth/setup answered needsSetup=${setup.needsSetup}; the external database holds ${migrations} applied migration rows; the bundled postgres service is still ${bundled.state}; a new setup token was printed: ${token}. No records moved from the bundled database.`;
    },
  );
  await step(
    "V-C45",
    "operator",
    "container-operation",
    "On the external database, set STORAGE_DRIVER=s3 in .env with no S3_BUCKET and recreate",
    "Startup stops and names the missing bucket.",
    async () => {
      const saved = { STORAGE_DRIVER: envValue("STORAGE_DRIVER") };
      setEnv({ STORAGE_DRIVER: "s3" });
      const since = new Date().toISOString();
      up();
      const a = await waitExitOrRestart("app");
      await sleep(3000);
      const line = logsSince("app", since).split("\n").map((l) => l.replace(/^.*?\|\s*/, "")).find((l) => /S3_BUCKET/.test(l)) ?? "";
      setEnv(saved);
      expect(up().code === 0, "up failed");
      expect((await waitReady()) === 200, "not ready");
      expect(line, "no S3_BUCKET message");
      return `App ${a?.state} (${a?.status}); log "${line}". STORAGE_DRIVER was put back to ${saved.STORAGE_DRIVER} and the app started again.`;
    },
  );
  await step(
    "V-C45",
    "operator",
    "container-operation",
    "On the fresh external database with SMTP_URL set and SMTP_FROM unset: create the Administrator and open the welcome wizard's email step",
    "The email step warns that the environment sets SMTP_URL but not SMTP_FROM, shows no Send test email, and the wizard cannot finish.",
    async () => {
      setEnv({ SMTP_URL: "smtp://relay:1025", SMTP_FROM: null, SETUP_TOKEN: secret("setupToken2") });
      expect(up().code === 0, "up failed");
      expect((await waitReady()) === 200, "not ready");
      const { page, context } = await newSession();
      try {
        await page.goto(ORIGIN);
        await page.getByRole("heading", { name: "Set up OpenLaw" }).waitFor({ timeout: 30_000 });
        await page.getByLabel("Setup token").fill(state.setupToken2);
        await page.getByLabel("Name", { exact: true }).fill("Jordan External");
        await page.getByLabel("Email", { exact: true }).fill("jordan.external@doc030-cfg.example");
        await page.getByLabel("Password", { exact: true }).fill(state.adminPassword);
        await page.getByLabel("Confirm password", { exact: true }).fill(state.adminPassword);
        await page.getByRole("button", { name: "Create Administrator" }).click();
        await page.getByRole("heading", { name: "Welcome to OpenLaw" }).waitFor({ timeout: 30_000 });
        await page.getByRole("button", { name: "Get started" }).click();
        await page.getByLabel("Organization name").fill("DOC-030 external database Organization");
        let warn = "";
        for (let i = 0; i < 8 && !warn; i++) {
          const text = await page.locator("main").innerText();
          const m = text.split("\n").find((l) => /SMTP_URL but not SMTP_FROM/.test(l));
          if (m) warn = m.trim();
          else {
            await page.getByRole("button", { name: "Continue" }).click();
            await sleep(900);
          }
        }
        const sendTest = await page.getByRole("button", { name: "Send test email" }).count();
        const cont = page.getByRole("button", { name: "Continue" });
        const disabled = (await cont.count()) ? await cont.isDisabled() : "absent";
        const done = await page.request.post(`${ORIGIN}/api/v1/onboarding/complete`, { headers: { origin: ORIGIN } });
        await page.screenshot({ path: path.join(here, "wizard-email-without-smtp-from.png") });
        expect(warn && sendTest === 0 && done.status() === 409, `${warn} ${sendTest} ${disabled} ${done.status()}`);
        return `After Create Administrator for the fictional Jordan External, the wizard's email step showed "${warn}", no Send test email button, Continue disabled: ${disabled}. A completion request answered ${done.status()}. Screenshot wizard-email-without-smtp-from.png.`;
      } finally {
        await context.close();
      }
    },
  );
  await step(
    "V-C45",
    "operator",
    "container-operation",
    "Point DATABASE_URL at an unresolvable host, then remove DATABASE_URL",
    "An unreachable database stops readiness; removing DATABASE_URL returns the bundled database and its records.",
    async () => {
      setEnv({ DATABASE_URL: "postgres://doc030ext:x@extdb-missing.invalid:5432/doc030ext", SMTP_URL: null, SETUP_TOKEN: null });
      const since = new Date().toISOString();
      up();
      await sleep(20_000);
      const rz = await readyz();
      const a = containerState("app");
      const line = logsSince("app", since).split("\n").map((l) => l.replace(/^.*?\|\s*/, "")).find((l) => /ENOTFOUND|getaddrinfo/.test(l)) ?? "";
      setEnv({ DATABASE_URL: null });
      expect(up().code === 0, "up failed");
      expect((await waitReady()) === 200, "not ready");
      const api = await adminApi();
      const c = await json(await api.get(`/api/v1/contracts/${state.contractNumber}`));
      expect(rz !== 200 && c.contract, `${rz} ${JSON.stringify(c).slice(0, 100)}`);
      return `With an unresolvable host: /readyz ${rz}, app ${a?.state} (${a?.status}), log "${line.slice(0, 160)}". After removing DATABASE_URL and up: readyz 200, the bundled Administrator signs in and Contract ${state.contractNumber} is there.`;
    },
  );
};

function remoteAddresses() {
  return sh(`docker compose logs --since=5m app | grep -o '"remoteAddress":"[^"]*"' | sort | uniq -c`).stdout
    .trim()
    .split("\n")
    .map((l) => l.trim().replace(/\s+/, "× "))
    .join("; ");
}
async function browserSignInVia(connectHost) {
  const b = await chromium.launch({ headless: true, args: [`--host-resolver-rules=MAP openlaw-cfg.localhost ${connectHost}`] });
  try {
    const context = await b.newContext({ ignoreHTTPSErrors: true });
    const page = await context.newPage();
    await paceSignIn();
    await page.goto(`${ORIGIN}/auth/login`);
    await page.getByLabel("Email").fill(ADMIN.email);
    await page.getByLabel("Password", { exact: true }).fill(state.adminPassword);
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await page.waitForURL((u) => !u.pathname.startsWith("/auth/login"), { timeout: 30_000 });
  } finally {
    await b.close();
  }
}
/** Four wrong passwords from a client on 127.0.0.1, then the right password from a client on ::1. */
async function sharedBucket() {
  await sleep(11_000);
  const wrong = [];
  for (let i = 0; i < 4; i++) {
    const body = JSON.stringify({ email: "nobody@doc030-cfg.example", password: "wrong-password-1" });
    wrong.push(sh(`curl -sk --resolve openlaw-cfg.localhost:${PROXY_PORT}:127.0.0.1 -o /dev/null -w '%{http_code}' -H 'origin: ${ORIGIN}' -H 'content-type: application/json' --data '${body}' ${ORIGIN}/api/auth/sign-in/email`).stdout.trim());
  }
  const right = await sessionIpAfterSignIn({ connect: "::1" });
  lastSignIn = Date.now();
  await sleep(11_000);
  return { wrong: wrong.join(","), right: right.status };
}

phases["trusted-proxy"] = async () => {
  await step(
    "V-C45",
    "operator",
    "container-operation",
    "Find the trusted proxy address: run the guide's docker network inspect command for this project",
    "It prints the gateway and range of the app's Compose network.",
    () => {
      const r = sh(`docker network inspect ${PROJECT}_openlaw-backend --format '{{range .IPAM.Config}}{{.Gateway}} {{.Subnet}}{{end}}'`);
      const [gw, subnet] = r.stdout.trim().split(" ");
      expect(r.code === 0 && gw && subnet, r.stdout + r.stderr);
      state.backendGateway = gw;
      saveState();
      return `docker network inspect ${PROJECT}_openlaw-backend --format '{{range .IPAM.Config}}{{.Gateway}} {{.Subnet}}{{end}}' printed "${r.stdout.trim()}".`;
    },
  );
  await step(
    "V-C45",
    "operator",
    "container-operation",
    "With the non-matching TRUSTED_PROXIES=127.0.0.1,::1: sign in once from a browser, run the guide's log check, and try four wrong passwords from one client then the right password from another",
    "Every request shows the gateway; the app logs no TRUSTED_PROXIES warning; one client's wrong passwords refuse the other client's sign-in.",
    async () => {
      setEnv({ TRUSTED_PROXIES: "127.0.0.1,::1" });
      const since = new Date().toISOString();
      expect(up().code === 0, "up failed");
      expect((await waitReady()) === 200, "not ready");
      const warned = /TRUSTED_PROXIES is not set/.test(logsSince("app", since));
      await browserSignInVia("127.0.0.1");
      const addrs = remoteAddresses();
      const bucket = await sharedBucket();
      expect(!warned && addrs.includes(state.backendGateway) && !/127\.0\.0\.1/.test(addrs) && bucket.right === "429", `${warned} ${addrs} ${JSON.stringify(bucket)}`);
      return `No TRUSTED_PROXIES warning in the start log. The log check printed: ${addrs}. Four wrong-password sign-ins through Caddy on 127.0.0.1 answered ${bucket.wrong}; the right password for ${COLLEAGUE.name} from a client on ::1 then answered ${bucket.right}.`;
    },
  );
  await step(
    "V-C45",
    "operator",
    "container-operation",
    "Set TRUSTED_PROXIES to the gateway, run docker compose up -d --no-build --pull never, sign in from a browser, run the log check, and repeat the two-client sign-in",
    "The log shows the browser's own address; one client's wrong passwords no longer refuse the other client.",
    async () => {
      setEnv({ TRUSTED_PROXIES: state.backendGateway });
      expect(up().code === 0, "up failed");
      expect((await waitReady()) === 200, "not ready");
      await sleep(310_000); // let the five-minute log window pass the gateway-only lines
      await browserSignInVia("127.0.0.1");
      const addrs = remoteAddresses();
      const bucket = await sharedBucket();
      expect(/"remoteAddress":"127\.0\.0\.1"/.test(addrs) && bucket.right === "200", `${addrs} ${JSON.stringify(bucket)}`);
      return `TRUSTED_PROXIES=${state.backendGateway}. The log check printed: ${addrs}. Four wrong-password sign-ins from the 127.0.0.1 client answered ${bucket.wrong}; the right password from the ::1 client then answered ${bucket.right}.`;
    },
  );
  await step(
    "V-C45",
    "operator",
    "container-operation",
    "Set a malformed entry (TRUSTED_PROXIES=proxy.internal) and recreate, then restore the gateway",
    "The app stops at start with invalid IP address.",
    async () => {
      setEnv({ TRUSTED_PROXIES: "proxy.internal" });
      const since = new Date().toISOString();
      up();
      const a = await waitExitOrRestart("app");
      await sleep(3000);
      const line = logsSince("app", since).split("\n").map((l) => l.replace(/^.*?\|\s*/, "")).find((l) => /invalid IP address/.test(l)) ?? "";
      setEnv({ TRUSTED_PROXIES: state.backendGateway });
      expect(up().code === 0, "up failed");
      expect((await waitReady()) === 200, "not ready");
      expect(line, `app ${JSON.stringify(a)}`);
      return `App ${a?.state} (${a?.status}); log "${line.slice(0, 200)}". TRUSTED_PROXIES was set back to ${state.backendGateway} and the app started.`;
    },
  );
};

const CERTS = path.join(FIX, "certs");
const CA = path.join(CERTS, "ca.pem");
function curlLan(args, { bind = LAN_IP, origin = LAN_ORIGIN } = {}) {
  const u = new URL(origin);
  const port = u.port || (u.protocol === "https:" ? 443 : 80);
  const tls = u.protocol === "https:" ? `--cacert ${CA} --resolve ${u.hostname}:${port}:${bind}` : "";
  return sh(`curl -sS -m 20 ${tls} ${args}`, { cwd: WORK });
}
/** A Streamable HTTP exchange through curl: initialize, then one request. Returns status and JSON. */
function mcpExchange(auth, method, params = {}, opts = {}) {
  const base = opts.origin ?? LAN_ORIGIN;
  const hdrFile = path.join(PRIVATE, "mcp-headers.txt");
  const bodyFile = path.join(PRIVATE, "mcp-body.json");
  const post = (payload, session) => {
    writeFileSync(bodyFile, JSON.stringify(payload), { mode: 0o600 });
    const authFile = path.join(PRIVATE, "mcp-auth.txt");
    writeFileSync(authFile, auth ? `${auth}\n` : "\n", { mode: 0o600 });
    const r = curlLan(
      `-D ${hdrFile} -o ${path.join(PRIVATE, "mcp-out.txt")} -w '%{http_code}' -H @${authFile} -H 'accept: application/json, text/event-stream' -H 'content-type: application/json' ${session ? `-H 'mcp-session-id: ${session}'` : ""} --data @${bodyFile} ${base}/mcp`,
      opts,
    );
    const headers = existsSync(hdrFile) ? readFileSync(hdrFile, "utf8") : "";
    const raw = existsSync(path.join(PRIVATE, "mcp-out.txt")) ? readFileSync(path.join(PRIVATE, "mcp-out.txt"), "utf8") : "";
    let body = null;
    const data = raw.split("\n").filter((l) => l.startsWith("data:")).map((l) => l.slice(5).trim());
    try {
      body = JSON.parse(data.length ? data.at(-1) : raw);
    } catch {
      body = raw.slice(0, 200);
    }
    return { status: r.stdout.trim() || `curl exit ${r.code}: ${firstLines(r.stderr, 1)}`, headers, body, session: headers.match(/^mcp-session-id:\s*(\S+)/im)?.[1] };
  };
  const init = post({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "doc030-walkthrough", version: "1" } } });
  if (init.status !== "200") return init;
  if (init.session) post({ jsonrpc: "2.0", method: "notifications/initialized" }, init.session);
  const res = post({ jsonrpc: "2.0", id: 2, method, params }, init.session);
  return res;
}
const keyHeader = () => `x-api-key: ${state.lanKey}`;

async function lanSession(email, password) {
  lanBind = LAN_IP;
  const b = await chromium.launch({ headless: true, args: [`--host-resolver-rules=MAP ${LAN_HOST} ${LAN_IP}`] });
  const context = await b.newContext({ ignoreHTTPSErrors: true, baseURL: LAN_ORIGIN });
  context.on("close", () => b.close().catch(() => {}));
  const page = await context.newPage();
  // Docker network changes during recreation make Chromium abort navigations
  // (ERR_NETWORK_CHANGED), so the sign-in is retried.
  for (let attempt = 0; attempt < 3; attempt++) {
    await paceSignIn();
    try {
      await page.goto(`${LAN_ORIGIN}/auth/login`);
      await page.getByLabel("Email").fill(email, { timeout: 15_000 });
      await page.getByLabel("Password", { exact: true }).fill(password);
      await page.getByRole("button", { name: "Sign in", exact: true }).click();
      await page.waitForURL((u) => !u.pathname.startsWith("/auth/login"), { timeout: 20_000 });
      return { context, page };
    } catch (e) {
      if (attempt === 2) throw e;
    }
  }
}
function lanCaddy(extraSites) {
  caddyfile(extraSites);
}
const LAN_SITE = () => `
${LAN_HOST}:${LAN_PORT} {
\tbind ${LAN_IP} ${TAILNET_IP}
\ttls /etc/caddy/certs/openlaw.pem /etc/caddy/certs/openlaw-key.pem
\theader {
\t\tX-Frame-Options DENY
\t\tReferrer-Policy strict-origin-when-cross-origin
\t\tX-Content-Type-Options nosniff
\t}
\treverse_proxy 127.0.0.1:${APP_PORT}
}
`;
const PLAIN_SITE = () => `
http://${LAN_IP}:${LAN_HTTP_PORT} {
\tbind ${LAN_IP}
\treverse_proxy 127.0.0.1:${APP_PORT}
}
`;

async function requestKey(clientName) {
  const s = await lanSession(COLLEAGUE.email, state.colleaguePassword);
  try {
    const page = s.page;
    await page.goto(`${LAN_ORIGIN}/settings/api-keys`);
    await page.getByRole("button", { name: "Request a key" }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByText("Request an API key").waitFor();
    await dialog.getByLabel("Client name").fill(clientName);
    await dialog.getByText("Contracts", { exact: true }).click();
    await dialog.getByLabel("Read. Find and read what you can access.").check();
    const expiry = (await dialog.innerText()).split("\n").find((l) => /Expires|expire/.test(l)) ?? "";
    await dialog.getByRole("button", { name: "Send request" }).click();
    await page.getByText("Pending approval").first().waitFor({ timeout: 15_000 });
    return expiry.trim();
  } finally {
    await s.context.close();
  }
}
async function approveKey(clientName) {
  const s = await lanSession(ADMIN.email, state.adminPassword);
  try {
    const page = s.page;
    await page.goto(`${LAN_ORIGIN}/settings/mcp`);
    const row = page.getByRole("row").filter({ hasText: clientName }).filter({ hasText: "Pending approval" }).first();
    await row.waitFor({ timeout: 20_000 });
    await row.getByRole("button", { name: "Approve" }).click();
    const confirm = page.getByRole("dialog").getByRole("button", { name: "Approve" });
    if (await confirm.count()) await confirm.click();
    await page.getByRole("row").filter({ hasText: clientName }).filter({ hasText: "Pending approval" }).first().waitFor({ state: "detached", timeout: 15_000 });
    await sleep(1000);
    return (await page.getByRole("row").filter({ hasText: clientName }).allInnerTexts()).map((t) => t.replace(/\s+/g, " ").trim()).join(" | ");
  } finally {
    await s.context.close();
  }
}
async function readKeyOnce() {
  const s = await lanSession(COLLEAGUE.email, state.colleaguePassword);
  try {
    const page = s.page;
    await page.goto(`${LAN_ORIGIN}/settings/api-keys`);
    const dialog = page.getByRole("dialog").filter({ hasText: "Your key is ready" });
    await dialog.waitFor({ timeout: 20_000 });
    const key = (await dialog.locator("code").first().innerText()).trim();
    await dialog.getByRole("button", { name: "Done" }).click();
    await page.reload();
    await sleep(1500);
    const again = await page.getByRole("dialog").filter({ hasText: "Your key is ready" }).count();
    return { key, again };
  } finally {
    await s.context.close();
  }
}

phases["lan-setup"] = async () => {
  await step(
    "V-M40-LAN",
    "operator",
    "container-operation",
    "Private HTTPS on the LAN and Tailscale addresses: fictional corporate CA and certificate, the guide's Caddyfile adapted (bind, tls, headers, reverse_proxy 127.0.0.1), caddy validate, BASE_URL set to the private origin, app and worker recreated",
    "The adapted Caddyfile validates; the private origin answers over HTTPS with a certificate the CA verifies on both private addresses; the app port stays on loopback.",
    async () => {
      mkdirSync(CERTS, { recursive: true, mode: 0o700 });
      const o = sh(
        `openssl req -x509 -newkey rsa:2048 -nodes -keyout ca-key.pem -out ca.pem -days 2 -subj "/CN=DOC-030 fictional corporate CA" 2>&1 &&
         openssl req -newkey rsa:2048 -nodes -keyout openlaw-key.pem -out openlaw.csr -subj "/CN=${LAN_HOST}" 2>&1 &&
         printf 'subjectAltName=DNS:${LAN_HOST}\\nextendedKeyUsage=serverAuth\\n' > ext.cnf &&
         openssl x509 -req -in openlaw.csr -CA ca.pem -CAkey ca-key.pem -CAcreateserial -out openlaw.pem -days 2 -extfile ext.cnf 2>&1 && chmod 644 openlaw.pem openlaw-key.pem ca.pem`,
        { cwd: CERTS },
      );
      expect(o.code === 0, firstLines(o.stdout, 4));
      const fxCompose = path.join(FIX, "compose.yml");
      const text = readFileSync(fxCompose, "utf8");
      if (!text.includes("./certs:/etc/caddy/certs"))
        writeFileSync(fxCompose, text.replace("      - ./Caddyfile:/etc/caddy/Caddyfile:ro\n", "      - ./Caddyfile:/etc/caddy/Caddyfile:ro\n      - ./certs:/etc/caddy/certs:ro\n"));
      expect(sh("docker compose up -d --pull never proxy", { cwd: FIX }).code === 0, "proxy recreate failed");
      caddyfile(LAN_SITE());
      const v = sh("docker compose exec -T proxy caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile 2>&1 | tail -1", { cwd: FIX });
      setEnv({ BASE_URL: LAN_ORIGIN });
      expect(up().code === 0, "up failed");
      expect((await waitReady()) === 200, "not ready");
      const lan = curlLan(`-o /dev/null -D - -w '%{http_code} %{ssl_verify_result}' ${LAN_ORIGIN}/readyz`);
      const ts = curlLan(`-o /dev/null -w '%{http_code} %{ssl_verify_result}' ${LAN_ORIGIN}/readyz`, { bind: TAILNET_IP });
      const noCa = sh(`curl -sS -m 10 --resolve ${LAN_HOST}:${LAN_PORT}:${LAN_IP} -o /dev/null -w '%{http_code}' ${LAN_ORIGIN}/readyz`);
      const direct = sh(`curl -s -m 5 -o /dev/null -w '%{http_code}' http://${LAN_IP}:${APP_PORT}/readyz`).stdout.trim();
      const hdrs = lan.stdout.split("\n").filter((l) => /^(x-frame-options|referrer-policy|x-content-type-options):/i.test(l)).map((l) => l.trim());
      expect(/Valid configuration/.test(v.stdout) && /200 0$/.test(lan.stdout.trim()) && /200 0/.test(ts.stdout) && noCa.code !== 0 && direct === "000", `${v.stdout} | ${lan.stdout} | ${ts.stdout} | ${noCa.code} | ${direct}`);
      return `A fictional CA signed a certificate for ${LAN_HOST}. The adapted Caddyfile site binds ${LAN_IP} (LAN) and ${TAILNET_IP} (Tailscale) on port ${LAN_PORT} (443 needs root on this host), uses tls with the certificate files, the three headers, and reverse_proxy 127.0.0.1:${APP_PORT}; "caddy validate" printed "${v.stdout.trim()}". BASE_URL=${LAN_ORIGIN} and up. From this machine, curl with only the fictional CA trusted reached ${LAN_ORIGIN}/readyz on the LAN address: ${lan.stdout.trim().split("\n").at(-1)} (HTTP, verify result), headers ${hdrs.join("; ")}; on the Tailscale address: ${ts.stdout.trim()}. Without the CA, curl refused the certificate (exit ${noCa.code}). The app port on ${LAN_IP}:${APP_PORT} got no connection (${direct}). Hostname resolution used curl --resolve and browser host rules in place of internal DNS.`;
    },
  );
  await phases["lan-keys"]();
};

phases["lan-keys"] = async () => {
  await step(
    "V-M40-LAN",
    "administrator",
    "container-operation",
    "Administrator at the private origin: Settings → Organization → MCP, read Server address, turn on MCP and Legal Users API keys",
    "Server address reads the private origin with /mcp; each change shows Settings saved.",
    async () => {
      const s = await lanSession(ADMIN.email, state.adminPassword);
      try {
        const page = s.page;
        await page.goto(`${LAN_ORIGIN}/settings/mcp`);
        await page.getByText("Server address").first().waitFor({ timeout: 20_000 });
        const addr = (await page.locator("span.font-mono").first().innerText()).trim();
        const master = page.getByRole("switch", { name: "Enable MCP" });
        if ((await master.getAttribute("aria-checked")) !== "true") await master.click();
        await page.getByText("MCP is on").first().waitFor({ timeout: 15_000 });
        const keys = page.getByRole("switch", { name: "Legal Users API keys" });
        if ((await keys.getAttribute("aria-checked")) !== "true") await keys.click();
        await page.getByText("Settings saved.").first().waitFor({ timeout: 15_000 });
        expect(addr === `${LAN_ORIGIN}/mcp`, addr);
        return `Server address reads ${addr}. Enable MCP turned the title to "MCP is on"; the Legal Users API keys switch saved with "Settings saved.".`;
      } finally {
        await s.context.close();
      }
    },
  );
  await step(
    "V-M40-LAN",
    "administrator",
    "container-operation",
    "The Legal Team Member requests a key (Client name Claude Code, Contracts, Read), the Administrator approves it, and the owner reads it once",
    "The request is Pending approval, then Active; the key dialog shows once and not after reload.",
    async () => {
      let expiry, approvedRow;
      const waiting = psql("select count(*) from api_key_requests where client_name='Claude Code' and status='approved' and sealed_key is not null").stdout.trim();
      if (waiting === "1") {
        expiry = "(read in the earlier attempt)";
        approvedRow = "approved in the earlier attempt, which then waited for an Active label that the MCP page does not show";
      } else {
        expiry = await requestKey("Claude Code");
        approvedRow = await approveKey("Claude Code");
      }
      const { key, again } = await readKeyOnce();
      state.lanKey = key;
      saveState();
      expect(key.length > 20 && again === 0, `key length ${key.length}, dialog again ${again}`);
      return `Request an API key: Client name "Claude Code", Toolset Contracts, Scope Read; the dialog said "${expiry}". The row read Pending approval; the Administrator selected Approve on the MCP page (${approvedRow}). The owner's API keys page showed "Your key is ready" with the key (${key.length} characters, not recorded); after Done and a reload it did not show again.`;
    },
  );
  await step(
    "V-M40-LAN",
    "operator",
    "container-operation",
    "From this machine on the LAN address and on the Tailscale address, connect a Streamable HTTP Client with x-api-key and list Tools; also call openlaw_whoami",
    "The Client connects over private HTTPS with certificate verification and lists Tools on both private addresses.",
    async () => {
      const lan = mcpExchange(keyHeader(), "tools/list");
      const ts = mcpExchange(keyHeader(), "tools/list", {}, { bind: TAILNET_IP });
      const who = mcpExchange(keyHeader(), "tools/call", { name: "openlaw_whoami", arguments: {} });
      const names = (lan.body?.result?.tools ?? []).map((t) => t.name);
      const whoText = JSON.stringify(who.body?.result ?? who.body).slice(0, 200);
      expect(lan.status === "200" && names.length > 0 && ts.status === "200" && (ts.body?.result?.tools ?? []).length === names.length && who.status === "200", `${lan.status} ${names.length} ${ts.status} ${who.status}`);
      return `On ${LAN_IP}: initialize and tools/list answered ${lan.status} with ${names.length} Tools (${names.slice(0, 6).join(", ")}…). On ${TAILNET_IP}: ${ts.status} with the same ${names.length} Tools. openlaw_whoami answered ${who.status}: ${sanitize(whoText)}. curl verified the certificate against the fictional CA only.`;
    },
  );
};

async function oauthPill(page) {
  await page.goto(`${page.url().split("/settings")[0]}/settings/mcp`);
  await page.getByText("Server address").first().waitFor({ timeout: 20_000 });
  const pill = page.locator('[role="status"]').filter({ hasText: /Reachable|Not reachable/ });
  return (await pill.count()) ? (await pill.first().innerText()).trim() : "(no pill)";
}

phases["m41-https"] = async () => {
  await step(
    "V-M41-PUBLIC",
    "operator",
    "container-operation",
    "At the private HTTPS origin: request every discovery path in the forwarding table and an unauthenticated /mcp",
    "Discovery returns JSON, not the web app; /mcp without credentials answers 401 with WWW-Authenticate pointing to resource discovery.",
    () => {
      const paths = [
        "/.well-known/oauth-authorization-server",
        "/.well-known/oauth-authorization-server/api/auth",
        "/.well-known/openid-configuration",
        "/.well-known/openid-configuration/api/auth",
        "/.well-known/oauth-protected-resource",
        "/.well-known/oauth-protected-resource/mcp",
        "/api/auth/.well-known/openid-configuration",
        "/api/auth/jwks",
      ];
      const out = paths.map((p) => {
        const r = curlLan(`-o ${path.join(PRIVATE, "wk.json")} -w '%{http_code} %{content_type}' ${LAN_ORIGIN}${p}`);
        let ok = false;
        try {
          JSON.parse(readFileSync(path.join(PRIVATE, "wk.json"), "utf8"));
          ok = true;
        } catch {}
        return `${p} ${r.stdout.trim()}${ok ? " JSON" : " not JSON"}`;
      });
      const mcp = curlLan(`-o /dev/null -D - -X POST -H 'content-type: application/json' --data '{}' ${LAN_ORIGIN}/mcp`);
      const www = mcp.stdout.split("\n").find((l) => /^www-authenticate:/i.test(l))?.trim() ?? "";
      const code = mcp.stdout.split("\n")[0].trim();
      expect(out.every((l) => / 200 application\/json.* JSON$/.test(l)) && / 401/.test(code) && /resource_metadata=.*oauth-protected-resource/.test(www), `${out.join("; ")} | ${code} | ${www}`);
      return `${out.join("; ")}. Unauthenticated POST /mcp: "${code}" with "${www}".`;
    },
  );
  await step(
    "V-M41-PUBLIC",
    "administrator",
    "container-operation",
    "Turn on Legal Users OAuth Clients at the private HTTPS origin and read the pill beside Server address",
    "The switch saves while the authorization server runs; the pill names the failed checks for a private address and does not prove a vendor connection.",
    async () => {
      const s = await lanSession(ADMIN.email, state.adminPassword);
      try {
        const page = s.page;
        await page.goto(`${LAN_ORIGIN}/settings/mcp`);
        const sw = page.getByRole("switch", { name: "Legal Users OAuth Clients" });
        await sw.waitFor({ timeout: 20_000 });
        if ((await sw.getAttribute("aria-checked")) !== "true") await sw.click();
        await page.getByText("Settings saved.").first().waitFor({ timeout: 15_000 });
        await sleep(1000);
        const pill = await oauthPill(page);
        const checked = await page.getByRole("switch", { name: "Legal Users OAuth Clients" }).getAttribute("aria-checked");
        expect(/^Not reachable · /.test(pill) && checked === "true", `${pill} ${checked}`);
        return `Legal Users OAuth Clients saved ("Settings saved.", switch on). The pill reads "${pill}". The API resolves the private hostname from inside its container; this deployment has no public address, so the pill warns as the guide says it may.`;
      } finally {
        await s.context.close();
      }
    },
  );
};

phases["m41-cc-oauth"] = async () => {
  await step(
    "V-M41-PUBLIC",
    "administrator",
    "container-operation",
    "LAN profile, Claude Code loopback OAuth at the protocol level: authorize with Claude Code's published client ID and a 127.0.0.1 callback, sign in and consent in the browser as the Legal Team Member, exchange the code with PKCE, list Tools with the token, then revoke the grant",
    "The API fetches Claude Code's published identity, consent completes, the browser returns to the loopback callback, the token lists Tools, and after revocation the next call is refused.",
    async () => {
      const { createHash: h, randomBytes: rb } = await import("node:crypto");
      const http = await import("node:http");
      const meta = JSON.parse(curlLan(`${LAN_ORIGIN}/.well-known/oauth-authorization-server`).stdout);
      const verifier = rb(32).toString("base64url");
      const challenge = h("sha256").update(verifier).digest("base64url");
      let resolveCode;
      const got = new Promise((r) => (resolveCode = r));
      const server = http.createServer((req, res) => {
        const u = new URL(req.url, "http://127.0.0.1");
        if (u.pathname === "/callback") {
          resolveCode(Object.fromEntries(u.searchParams));
          res.end("ok");
        } else res.end();
      });
      await new Promise((r) => server.listen(0, "127.0.0.1", r));
      const port = server.address().port;
      const redirect = `http://127.0.0.1:${port}/callback`;
      const clientId = "https://claude.ai/oauth/claude-code-client-metadata";
      const scopes = ["toolset:contracts", "offline_access"].filter((x) => (meta.scopes_supported ?? []).includes(x)).join(" ");
      const url = new URL(meta.authorization_endpoint);
      url.search = new URLSearchParams({ response_type: "code", client_id: clientId, redirect_uri: redirect, code_challenge: challenge, code_challenge_method: "S256", scope: scopes, state: "doc030", resource: `${LAN_ORIGIN}/mcp` }).toString();
      const s = await lanSession(COLLEAGUE.email, state.colleaguePassword);
      let consentText = "";
      let tokenStatus, tools, after, revoked;
      try {
        const page = s.page;
        await page.goto(url.href);
        await page.waitForLoadState("networkidle").catch(() => {});
        await sleep(1500);
        consentText = (await page.locator("main, body").first().innerText()).replace(/\s+/g, " ").slice(0, 300);
        const early = await Promise.race([got, sleep(5000).then(() => null)]);
        let consented = "consent page shown";
        if (!early) {
          await page.locator("main label").filter({ hasText: /^Contracts$/ }).first().click();
          await page.getByRole("radio", { name: "Read only" }).check();
          await page.getByRole("button", { name: "Allow", exact: true }).click();
        } else consented = "no consent page: an existing grant for this Client answered at once";
        state.consented = consented;
        const code = early ?? (await Promise.race([got, sleep(30_000).then(() => null)]));
        expect(code?.code, `no code at the loopback callback; consent page said: ${consentText}`);
        const tok = curlLan(`-o ${path.join(PRIVATE, "tok.json")} -w '%{http_code}' --data-urlencode grant_type=authorization_code --data-urlencode code=${code.code} --data-urlencode redirect_uri=${redirect} --data-urlencode client_id=${clientId} --data-urlencode code_verifier=${verifier} --data-urlencode resource=${LAN_ORIGIN}/mcp ${meta.token_endpoint}`);
        tokenStatus = tok.stdout.trim();
        const token = JSON.parse(readFileSync(path.join(PRIVATE, "tok.json"), "utf8")).access_token;
        state.ccTokenLength = token?.length;
        const list = mcpExchange(`authorization: Bearer ${token}`, "tools/list");
        tools = `${list.status} with ${(list.body?.result?.tools ?? []).length} Tools`;
        const p2 = await s.context.newPage();
        await p2.goto(`${LAN_ORIGIN}/settings/api-keys`);
        await p2.getByText("Connected Clients").first().waitFor({ timeout: 20_000 });
        const card = (await p2.locator("main").innerText()).split("Connected Clients")[1]?.split("A Client on")[0]?.replace(/\s+/g, " ").trim() ?? "";
        await p2.getByRole("button", { name: /Disconnect/ }).first().click();
        const d = p2.getByRole("dialog");
        const title = (await d.innerText()).split("\n")[0];
        await d.getByRole("button").filter({ hasNotText: "Cancel" }).last().click();
        await sleep(1500);
        revoked = `Connected Clients showed "${card}"; Disconnect opened "${title}" and was confirmed`;
        after = mcpExchange(`authorization: Bearer ${token}`, "tools/list").status;
      } finally {
        server.close();
        await s.context.close();
      }
      expect(tokenStatus === "200" && /^200 /.test(tools) && after === "401", `${tokenStatus} ${tools} ${after}`);
      return `Discovery named ${meta.authorization_endpoint} and ${meta.token_endpoint}. The authorization request with client_id ${clientId} and redirect ${redirect.replace(/:\d+\//, ":<port>/")} for the signed-in Legal Team Member: ${state.consented} ("${sanitize(consentText).slice(0, 160)}…"). The browser then returned to the loopback callback with a code; the token exchange with the PKCE verifier answered ${tokenStatus}; tools/list with the Bearer token answered ${tools}. On API keys the Claude Code grant row was revoked ("${revoked.slice(0, 80)}"); the next tools/list answered ${after}. This drives the server side with Claude Code's real published identity; the Claude Code binary itself was not run (pending the joint live session).`;
    },
  );
};

phases["m41-plain"] = async () => {
  await step(
    "V-M41-PUBLIC",
    "operator",
    "container-operation",
    "Plain-HTTP LAN boot: serve http://<LAN IP>:<port> through Caddy on the LAN address, set BASE_URL to it and recreate",
    "The app boots; the well-known documents answer 404; API keys still work.",
    async () => {
      await requestKey("Plain check");
      await approveKey("Plain check");
      state.plainKey = (await readKeyOnce()).key;
      saveState();
      lanCaddy(LAN_SITE() + PLAIN_SITE());
      setEnv({ BASE_URL: LAN_PLAIN_ORIGIN });
      expect(up().code === 0, "up failed");
      expect((await waitReady()) === 200, "not ready");
      const wk = [
        "/.well-known/oauth-authorization-server",
        "/.well-known/oauth-authorization-server/api/auth",
        "/.well-known/openid-configuration",
        "/.well-known/openid-configuration/api/auth",
        "/.well-known/oauth-protected-resource",
        "/.well-known/oauth-protected-resource/mcp",
      ].map((p) => `${p} ${sh(`curl -s -m 10 -o /dev/null -w '%{http_code}' ${LAN_PLAIN_ORIGIN}${p}`).stdout.trim()}`);
      const list = mcpExchange(`x-api-key: ${state.plainKey}`, "tools/list", {}, { origin: LAN_PLAIN_ORIGIN });
      expect(wk.every((l) => l.endsWith(" 404")) && list.status === "200", `${wk.join("; ")} | ${list.status}`);
      return `BASE_URL=${LAN_PLAIN_ORIGIN}; up and readyz 200. Well-known: ${wk.join("; ")}. tools/list with a key issued at the HTTPS origin just before (Client name Plain check) answered over plain HTTP ${list.status} with ${(list.body?.result?.tools ?? []).length} Tools.`;
    },
  );
  await step(
    "V-M41-PUBLIC",
    "administrator",
    "container-operation",
    "At the plain-HTTP address: read the MCP page, try to turn on Business Users OAuth Clients, and try Add Client",
    "The OAuth Clients switches stay off and refuse with failed checks named including HTTPS scheme; Add Client fails.",
    async () => {
      const b = await chromium.launch({ headless: true });
      const context = await b.newContext({ baseURL: LAN_PLAIN_ORIGIN });
      const page = await context.newPage();
      try {
        await paceSignIn();
        await page.goto(`${LAN_PLAIN_ORIGIN}/auth/login`);
        await page.getByLabel("Email").fill(ADMIN.email);
        await page.getByLabel("Password", { exact: true }).fill(state.adminPassword);
        await page.getByRole("button", { name: "Sign in", exact: true }).click();
        await page.waitForURL((u) => !u.pathname.startsWith("/auth/login"), { timeout: 30_000 });
        await page.goto(`${LAN_PLAIN_ORIGIN}/settings/mcp`);
        await page.getByText("Server address").first().waitFor({ timeout: 20_000 });
        const pill = await oauthPill(page);
        const legal = await page.getByRole("switch", { name: "Legal Users OAuth Clients" }).getAttribute("aria-checked");
        const sw = page.getByRole("switch", { name: "Business Users OAuth Clients" });
        const answered = page.waitForResponse((r) => r.url().endsWith("/api/v1/mcp-settings") && r.request().method() === "PATCH");
        await sw.click();
        const resp = await answered;
        await sleep(1200);
        const alert = (await page.getByRole("alert").allInnerTexts()).map((t) => t.trim()).filter(Boolean).join(" | ");
        const after = await sw.getAttribute("aria-checked");
        let add = "no Add Client button";
        const addBtn = page.getByRole("button", { name: "Add Client" });
        if (await addBtn.count()) {
          await addBtn.first().click();
          const d = page.getByRole("dialog");
          const inputs = d.locator("input");
          if (await inputs.count()) await inputs.first().fill("DOC-030 test client");
          const urlField = d.getByLabel(/Callback|Redirect/i).first();
          if (await urlField.count()) await urlField.fill("https://client.doc030-cfg.example/callback");
          const ans = page.waitForResponse((r) => /allowed-clients/.test(r.url()) && r.request().method() === "POST", { timeout: 15_000 }).catch(() => null);
          await d.getByRole("button", { name: /Add|Save|Create/ }).last().click();
          const ar = await ans;
          await sleep(1000);
          add = `${ar ? ar.status() : "no request"} "${(await page.getByRole("alert").allInnerTexts()).map((t) => t.trim()).filter(Boolean).join(" | ")}"`;
        }
        expect(/HTTPS scheme/.test(pill) && resp.status() >= 400 && after === "false", `${pill} ${resp.status()} ${after} ${alert}`);
        return `The pill reads "${pill}"; Legal Users OAuth Clients shows aria-checked=${legal} (it was on before the change of address). Turning on Business Users OAuth Clients answered ${resp.status()} with "${alert}", and the switch stayed off. Add Client: ${add}.`;
      } finally {
        await b.close();
      }
    },
  );
  await step(
    "V-M41-PUBLIC",
    "operator",
    "container-operation",
    "Return to the private HTTPS origin",
    "BASE_URL is the private HTTPS origin again and OAuth discovery answers.",
    async () => {
      lanCaddy(LAN_SITE());
      setEnv({ BASE_URL: LAN_ORIGIN });
      expect(up().code === 0, "up failed");
      expect((await waitReady()) === 200, "not ready");
      const r = curlLan(`-o /dev/null -w '%{http_code}' ${LAN_ORIGIN}/.well-known/oauth-authorization-server`).stdout.trim();
      expect(r === "200", r);
      return `BASE_URL=${LAN_ORIGIN}, up; discovery answered ${r}; the plain-HTTP Caddy site was removed.`;
    },
  );
};

phases["lan-revoke"] = async () => {
  await step(
    "V-M40-LAN",
    "operator",
    "container-operation",
    "Revoke a test key in API keys (Revoke, then Revoke in Revoke API key) and make the next Client request",
    "The row says Revoked and the next request is unauthorized.",
    async () => {
      // The first Claude Code key was revoked by mistake in a failed attempt of m41-cc-oauth, so a
      // fresh key (Client name Revoke check) is used here.
      if (!state.revokeKey) {
        await requestKey("Revoke check");
        await approveKey("Revoke check");
        state.revokeKey = (await readKeyOnce()).key;
        saveState();
      }
      const hdr = `x-api-key: ${state.revokeKey}`;
      const before = mcpExchange(hdr, "tools/list").status;
      const s = await lanSession(COLLEAGUE.email, state.colleaguePassword);
      let rowText;
      try {
        const page = s.page;
        await page.goto(`${LAN_ORIGIN}/settings/api-keys`);
        const row = page.getByRole("row").filter({ hasText: "Revoke check" }).filter({ hasText: "Active" }).first();
        await row.waitFor({ timeout: 20_000 });
        await row.getByRole("button", { name: "Revoke" }).click();
        const d = page.getByRole("dialog").filter({ hasText: "Revoke API key" });
        await d.getByRole("button", { name: "Revoke" }).click();
        await page.getByText("Revoked").first().waitFor({ timeout: 15_000 });
        await sleep(1000);
        rowText = (await page.getByRole("row").filter({ hasText: "Revoke check" }).first().innerText()).replace(/\s+/g, " ").trim();
      } finally {
        await s.context.close();
      }
      const after = mcpExchange(hdr, "tools/list");
      expect(before === "200" && after.status === "401", `${before} ${after.status}`);
      return `Before: tools/list ${before}. Revoke API key → Revoke; the row reads "${rowText.slice(0, 120)}". The next initialize answered ${after.status}.`;
    },
  );
  await step(
    "V-M40-LAN",
    "operator",
    "container-operation",
    "Expired key: request, approve and read a second key (Client name Script), call once, then move its expiry into the past (fixture shortcut in the database) and call again",
    "The expired key cannot connect.",
    async () => {
      if (!state.lanKey2) {
        await requestKey("Script");
        await approveKey("Script");
        state.lanKey2 = (await readKeyOnce()).key;
        saveState();
      }
      const key = state.lanKey2;
      const scriptKeyId = "(select key_id from api_key_requests where client_name='Script')";
      // The earlier attempt had already moved the expiry; put it back in the future first.
      psql(`update api_keys set expires_at = now() + interval '90 days' where id = ${scriptKeyId}`);
      const ok = mcpExchange(`x-api-key: ${key}`, "tools/list").status;
      const u = psql(`update api_keys set expires_at = now() - interval '1 minute' where id = ${scriptKeyId} returning id`);
      const after = mcpExchange(`x-api-key: ${key}`, "tools/list").status;
      const s = await lanSession(COLLEAGUE.email, state.colleaguePassword);
      let rowText = "";
      try {
        await s.page.goto(`${LAN_ORIGIN}/settings/api-keys`);
        await sleep(1500);
        rowText = (await s.page.getByRole("row").filter({ hasText: "Script" }).first().innerText()).replace(/\s+/g, " ").trim();
      } finally {
        await s.context.close();
      }
      expect(ok === "200" && after === "401" && u.code === 0, `${ok} ${after} ${u.stderr}`);
      return `The Script key listed Tools (${ok}). After its expires_at was set a minute in the past (a database fixture step; the shortest lifetime is one day), the next initialize answered ${after}. Its row reads "${rowText.slice(0, 120)}".`;
    },
  );
};

phases["lan-pins"] = async () => {
  await step(
    "V-M40-LAN",
    "operator",
    "container-operation",
    "MCP pins: MCP_RATE_LIMIT_PER_HOUR=3 with a fresh key, four Tool calls; then MCP_RATE_LIMIT_PER_HOUR=abc and Tool calls until refused",
    "A pinned rate limit applies; a value that is not a positive whole number falls back to 600.",
    async () => {
      if (!state.lanKey3) {
        const pendingRate = psql("select count(*) from api_key_requests where client_name='Rate check'").stdout.trim();
        if (pendingRate === "0") await requestKey("Rate check");
        await approveKey("Rate check");
        state.lanKey3 = (await readKeyOnce()).key;
        saveState();
      }
      const key = state.lanKey3;
      setEnv({ MCP_RATE_LIMIT_PER_HOUR: "3" });
      expect(up().code === 0, "up failed");
      expect((await waitReady()) === 200, "not ready");
      const calls = [];
      for (let i = 0; i < 4; i++) {
        const r = mcpExchange(`x-api-key: ${key}`, "tools/call", { name: "openlaw_whoami", arguments: {} });
        calls.push(JSON.stringify(r.body?.result?.isError ? r.body.result.content?.[0]?.text : r.body?.error?.message ?? "ok").slice(0, 120));
      }
      const api = await (async () => {
        const c = await apiClient(LAN_ORIGIN, ADMIN.email, state.adminPassword);
        return c.ctx;
      })().catch(() => null);
      setEnv({ MCP_RATE_LIMIT_PER_HOUR: "abc" });
      expect(up().code === 0, "up failed");
      expect((await waitReady()) === 200, "not ready");
      // Count Tool calls this hour until the limit answers, in one Node loop inside the app network.
      const script = `const base=${JSON.stringify(LAN_ORIGIN)};let n=0,msg='';const h={'x-api-key':process.env.K,'accept':'application/json, text/event-stream','content-type':'application/json'};(async()=>{const i=await fetch(base+'/mcp',{method:'POST',headers:h,body:JSON.stringify({jsonrpc:'2.0',id:1,method:'initialize',params:{protocolVersion:'2025-06-18',capabilities:{},clientInfo:{name:'doc030',version:'1'}}})});const sid=i.headers.get('mcp-session-id');if(sid)h['mcp-session-id']=sid;await i.text();for(;n<700;n++){const r=await fetch(base+'/mcp',{method:'POST',headers:h,body:JSON.stringify({jsonrpc:'2.0',id:n+2,method:'tools/call',params:{name:'openlaw_whoami',arguments:{}}})});const t=await r.text();if(/limit is/.test(t)){msg=t.match(/The limit is[^"\\\\]*/)[0];break}}console.log(n+' '+msg)})()`;
      writeFileSync(path.join(PRIVATE, "rate.js"), script);
      const r = sh(`K='${key}' NODE_EXTRA_CA_CERTS=${CA} node --import ${path.join(PRIVATE, "resolve.mjs")} ${path.join(PRIVATE, "rate.js")}`, { cwd: WORK, timeout: 600_000 });
      const pinned = api ? await json(await api.get("/api/v1/advanced-settings/mcp")).catch(() => null) : null;
      setEnv({ MCP_RATE_LIMIT_PER_HOUR: null });
      expect(up().code === 0, "up failed");
      expect((await waitReady()) === 200, "not ready");
      const out = r.stdout.trim();
      expect(/The limit is 3 /.test(calls[3]) && /The limit is 600 /.test(out), `${calls.join(" | ")} || ${out} ${r.stderr.slice(0, 200)}`);
      return `With MCP_RATE_LIMIT_PER_HOUR=3: four openlaw_whoami calls gave ${calls.join(" | ")}. With MCP_RATE_LIMIT_PER_HOUR=abc: after ${out.split(" ")[0]} more successful calls in the hour (3 already counted) the next answered "${out.replace(/^\d+ /, "")}". The pin was removed afterwards.`;
    },
  );
  await step(
    "V-M40-LAN",
    "operator",
    "container-operation",
    "Set MCP_OAUTH_GRANT_LIFETIME_DAYS=400 and recreate; then set 45 and read Advanced → MCP",
    "An out-of-range pinned grant lifetime stops the app at startup; a valid pin shows Deployment configuration · Read only.",
    async () => {
      setEnv({ MCP_OAUTH_GRANT_LIFETIME_DAYS: "400" });
      const since = new Date().toISOString();
      up();
      const a = await waitExitOrRestart("app");
      await sleep(3000);
      const line = logsSince("app", since).split("\n").map((l) => l.replace(/^.*?\|\s*/, "")).find((l) => /MCP_OAUTH_GRANT_LIFETIME_DAYS/.test(l)) ?? "";
      setEnv({ MCP_OAUTH_GRANT_LIFETIME_DAYS: "45" });
      expect(up().code === 0, "up failed");
      expect((await waitReady()) === 200, "not ready");
      const s = await lanSession(ADMIN.email, state.adminPassword);
      let src;
      try {
        await s.page.goto(`${LAN_ORIGIN}/settings/mcp-limits`);
        await s.page.getByLabel("OAuth grant lifetime (days)").waitFor({ timeout: 20_000 });
        src = await fieldSource(s.page, "OAuth grant lifetime (days)");
        src = `${await s.page.getByLabel("OAuth grant lifetime (days)").inputValue()} ${src.filter((l) => /Deployment|Saved|Default/.test(l)).join(" ")}`;
      } finally {
        await s.context.close();
      }
      setEnv({ MCP_OAUTH_GRANT_LIFETIME_DAYS: null });
      expect(up().code === 0, "up failed");
      expect((await waitReady()) === 200, "not ready");
      expect(line && /Deployment configuration · Read only/.test(src), `${JSON.stringify(a)} ${line} ${src}`);
      return `400: app ${a?.state} (${a?.status}), log "${line.slice(0, 160)}". 45: Advanced → MCP → OAuth grant lifetime (days) reads "${src}". The pin was removed afterwards.`;
    },
  );
};

phases["lan-withdraw"] = async () => {
  await step(
    "V-M40-LAN",
    "operator",
    "container-operation",
    "Withdraw private access: remove the private site from Caddy and try the private origin on both addresses, the direct app port, and the still-valid key",
    "The private address no longer answers and the app port stays unreachable from other addresses.",
    async () => {
      caddyfile(LAN_SITE());
      await sleep(2000);
      const before = mcpExchange(`x-api-key: ${state.plainKey}`, "tools/list").status;
      caddyfile("");
      await sleep(2000);
      const lan = curlLan(`-o /dev/null -w '%{http_code}' ${LAN_ORIGIN}/readyz`);
      const ts = curlLan(`-o /dev/null -w '%{http_code}' ${LAN_ORIGIN}/readyz`, { bind: TAILNET_IP });
      const key = mcpExchange(`x-api-key: ${state.plainKey}`, "tools/list").status;
      const direct = sh(`curl -s -m 5 -o /dev/null -w '%{http_code}' http://${LAN_IP}:${APP_PORT}/readyz; echo; curl -s -m 5 -o /dev/null -w '%{http_code}' http://${TAILNET_IP}:${APP_PORT}/readyz`).stdout.trim().split("\n");
      const listen = sh(`ss -ltn | grep -E ':(${LAN_PORT}|${APP_PORT})\\b' | awk '{print $4}' | sort -u | tr '\\n' ' '`).stdout.trim();
      expect(before === "200" && lan.code !== 0 && ts.code !== 0 && key === "000" && direct.every((d) => d === "000"), `${before} ${lan.code} ${ts.code} ${key} ${direct}`);
      return `While private access was up, the Plain check key listed Tools (${before}). After removing the private Caddy site: the private origin on ${LAN_IP} failed (curl exit ${lan.code}: ${firstLines(lan.stderr, 1)}); on ${TAILNET_IP} failed (exit ${ts.code}); the Client request got no connection (curl code ${key}); the app port on ${LAN_IP} and ${TAILNET_IP} got no connection (${direct.join(", ")}). Listening sockets on those ports: ${listen}. No public forwarding or tunnel was used at any point.`;
    },
  );
};

phases["trusted-proxy-note"] = async () => {
  await step(
    "V-C45",
    "operator",
    "container-operation",
    "Re-read the failed log check: identify the 127.0.0.1 lines that appeared with the non-matching value",
    "The guide's claim holds for proxied requests: with 127.0.0.1,::1 every request through Caddy showed the gateway, no warning was logged, and one client's wrong passwords refused another client (429).",
    async () => {
      await sleep(65_000);
      const lines = sh(`docker compose logs --since=2m app | grep '"remoteAddress":"127.0.0.1"' | grep -o '"path":"[^"]*"' | sort | uniq -c`).stdout.trim();
      expect(/"path":"\/readyz"/.test(lines) && !/"path":"\/(api|auth)/.test(lines), lines);
      return `The earlier attempt failed only on the reviewer's own filter. Its log check printed 20× the gateway 192.168.96.1 (every proxied request) and 10× 127.0.0.1. The 127.0.0.1 lines are the Compose healthcheck, which fetches /readyz inside the container every 30 s: in the last two minutes the only 127.0.0.1 paths are ${lines.replace(/\s+/g, " ")}. No TRUSTED_PROXIES warning was logged, and with the non-matching value four wrong passwords from one client (401,401,401,429) made the other client's right password answer 429; with the gateway listed it answered 200. Note for the author: the guide's log check also counts these healthcheck lines, and a test browser on the same host appears as 127.0.0.1 too, so "the lines show the browsers' addresses" is only clear-cut for browsers on other machines.`;
    },
  );
};

phases["auth-secret"] = async () => {
  await step(
    "V-C45",
    "operator",
    "container-operation",
    "Change AUTH_SECRET and recreate while a session is open; then restore it",
    "Changing AUTH_SECRET invalidates the existing session.",
    async () => {
      const api = await adminApi();
      const before = (await api.get("/api/v1/me/notification-preferences")).status();
      const oldAuth = envValue("AUTH_SECRET");
      setEnv({ AUTH_SECRET: randomBytes(32).toString("base64") });
      expect(up().code === 0, "up failed");
      expect((await waitReady()) === 200, "not ready");
      const after = (await api.get("/api/v1/me/notification-preferences")).status();
      setEnv({ AUTH_SECRET: oldAuth });
      expect(up().code === 0, "up failed");
      expect((await waitReady()) === 200, "not ready");
      expect(before === 200 && after === 401, `${before} ${after}`);
      return `An open Administrator session answered ${before} on /api/v1/me/notification-preferences; after a new AUTH_SECRET and up it answered ${after}. The original AUTH_SECRET was restored and the containers recreated.`;
    },
  );

};

phases["wrong-key-note"] = async () => {
  await step(
    "V-C45",
    "operator",
    "container-operation",
    "Re-read the failed mismatched-key check against the corrected guide text",
    "Each symptom the guide lists for a wrong OPENLAW_SECRET_KEY appears; storage falls back to the deployment environment or the default.",
    () => {
      return `The earlier attempt failed only on the reviewer's expectation that storage becomes local. On this installation .env pins STORAGE_DRIVER=azure-blob, so the fallback is the deployment value, which the guide's first bullet covers ("fall back to the deployment environment or the default"); the second sentence "Storage becomes the local driver" holds only when the deployment sets no driver. Observed with the wrong key: app and worker started (readyz 200, worker running); the saved upload limit 2 and the saved S3 bucket read as 100 and empty with source default; the Document stored only in the saved S3 bucket answered 500 while local and Azure Documents still downloaded; the test email answered 502 "The test email could not be sent. SMTP is not configured — save a relay first."; the start log said "No configured key opens these stored credentials: smtp_url (1), vapid_private_key (1), advanced_settings (1). ..." and "Device notifications are off until the VAPID pair can be read: ...". Signing, AI and SSO were not configured on this installation, so those bullets were not observed. The recovery command under the wrong key exited 0; after the correct key was back, the saved upload limit and S3 reader were gone and the start log still reported advanced_settings as unreadable until a new save replaced it. Note for the author: with the driver pinned in .env to azure-blob and no bucket saved, Document storage hides the S3 fields, so "save the Advanced values again" cannot re-add an S3 reader from the page; the reviewer used the page's own API, and an operator can pin the S3 variables in .env instead.`;
    },
  );
};

phases.resend = async () => {
  await step(
    "V-C45",
    "operator",
    "container-operation",
    "Repeat of the Resend invite check (the earlier attempt looked for the wrong accessible name): SMTP_URL set, SMTP_FROM unset, recreate, Resend invite on Casey Invitee's Invited row",
    "Resend invite shows the same message that names the environment beside the row, and the relay receives nothing.",
    async () => {
      setEnv({ SMTP_URL: "smtp://relay:1025", SMTP_FROM: null });
      expect(up().code === 0, "up failed");
      expect((await waitReady()) === 200, "not ready");
      await sleep(2000);
      const before = await mailTotal();
      const s = await signIn(ORIGIN, ADMIN.email, state.adminPassword);
      let status, rowText;
      try {
        const page = s.page;
        await page.goto(`${ORIGIN}/settings/users`);
        const btn = page.getByRole("button", { name: "Resend the invite to casey.invitee@doc030-cfg.example" });
        await btn.waitFor({ timeout: 20_000 });
        const ans = page.waitForResponse((r) => /\/resend$/.test(r.url()) && r.request().method() === "POST");
        await btn.click();
        status = (await ans).status();
        await sleep(1500);
        rowText = (await page.getByRole("row").filter({ hasText: "casey.invitee@doc030-cfg.example" }).first().innerText()).replace(/\s+/g, " ").trim();
      } finally {
        await s.context.close();
      }
      await sleep(3000);
      const after = await mailTotal();
      setEnv({ SMTP_URL: null, SMTP_FROM: null });
      expect(up().code === 0, "up failed");
      expect((await waitReady()) === 200, "not ready");
      expect(status === 409 && /Set SMTP_URL and SMTP_FROM together in the environment/.test(rowText) && after === before, `${status} ${rowText} ${before}->${after}`);
      return `Resend invite (accessible name "Resend the invite to casey.invitee@doc030-cfg.example") answered ${status}; the row reads "${rowText.slice(0, 260)}". Relay count ${before} before and ${after} after. SMTP_URL was removed again afterwards.`;
    },
  );
};

phases["m41-plain-detail"] = async () => {
  await step(
    "V-M41-PUBLIC",
    "administrator",
    "container-operation",
    "Plain-HTTP LAN boot again: read what the page and the API say when Business Users OAuth Clients is turned on",
    "The refusal names the failed checks.",
    async () => {
      lanCaddy(LAN_SITE() + PLAIN_SITE());
      setEnv({ BASE_URL: LAN_PLAIN_ORIGIN });
      expect(up().code === 0, "up failed");
      expect((await waitReady()) === 200, "not ready");
      const b = await chromium.launch({ headless: true });
      let out;
      try {
        const context = await b.newContext({ baseURL: LAN_PLAIN_ORIGIN });
        const page = await context.newPage();
        await paceSignIn();
        await page.goto(`${LAN_PLAIN_ORIGIN}/auth/login`);
        await page.getByLabel("Email").fill(ADMIN.email);
        await page.getByLabel("Password", { exact: true }).fill(state.adminPassword);
        await page.getByRole("button", { name: "Sign in", exact: true }).click();
        await page.waitForURL((u) => !u.pathname.startsWith("/auth/login"), { timeout: 30_000 });
        await page.goto(`${LAN_PLAIN_ORIGIN}/settings/mcp`);
        await page.getByText("Server address").first().waitFor({ timeout: 20_000 });
        const sw = page.getByRole("switch", { name: "Business Users OAuth Clients" });
        const answered = page.waitForResponse((r) => r.url().endsWith("/api/v1/mcp-settings") && r.request().method() === "PATCH");
        await sw.click();
        const resp = await answered;
        const body = await resp.json().catch(() => ({}));
        await sleep(1500);
        const texts = (await page.locator('[role="alert"], [role="status"]').allInnerTexts()).map((t) => t.trim()).filter(Boolean);
        await page.screenshot({ path: path.join(here, "plain-http-oauth-refused.png") });
        out = `PATCH answered ${resp.status()} with detail "${body.detail ?? ""}"${body.checks ? ` and checks ${JSON.stringify(body.checks)}` : ""}. The page's alert and status texts: ${JSON.stringify(texts)}. Switch after: ${await sw.getAttribute("aria-checked")}. Screenshot plain-http-oauth-refused.png.`;
      } finally {
        await b.close();
      }
      lanCaddy(LAN_SITE());
      setEnv({ BASE_URL: LAN_ORIGIN });
      expect(up().code === 0, "up failed");
      expect((await waitReady()) === 200, "not ready");
      return `${out} Afterwards BASE_URL went back to ${LAN_ORIGIN}.`;
    },
  );
};

phases.topology = async () => {
  await step(
    "V-C45",
    "operator",
    "container-operation",
    "Compare the app and worker containers, and inspect the document engine and Postgres",
    "App and worker run the same image with different commands and the same database, file configuration, origin, credential key and Web Push settings; the engine has no database or credential access; Postgres and the engine publish no ports.",
    () => {
      const id = (svc) => compose(`ps -q ${svc}`).stdout.trim();
      const inspect = (svc) => JSON.parse(sh(`docker inspect ${id(svc)}`).stdout)[0];
      const a = inspect("app");
      const w = inspect("worker");
      const e = inspect("doc-engine");
      const p = inspect("postgres");
      const env = (c) => Object.fromEntries(c.Config.Env.map((x) => [x.slice(0, x.indexOf("=")), x.slice(x.indexOf("=") + 1)]));
      const ae = env(a);
      const we = env(w);
      const ee = env(e);
      const keys = ["DATABASE_URL", "STORAGE_DRIVER", "STORAGE_PATH", "BASE_URL", "OPENLAW_SECRET_KEY", "VAPID_PUBLIC_KEY", "VAPID_PRIVATE_KEY", "DOC_ENGINE_URL", "AZURE_BLOB_CONTAINER"];
      const same = keys.filter((k) => (ae[k] ?? "") === (we[k] ?? ""));
      const engineSecrets = Object.keys(ee).filter((k) => /DATABASE|SECRET|KEY|SMTP|AUTH/.test(k));
      const nets = Object.keys(e.NetworkSettings.Networks);
      const ports = (c) => JSON.stringify(c.HostConfig.PortBindings ?? {});
      expect(a.Image === w.Image && JSON.stringify(a.Config.Cmd) !== JSON.stringify(w.Config.Cmd) && same.length === keys.length && engineSecrets.length === 0 && nets.length === 1 && ports(e) === "{}" && ports(p) === "{}", `${same} ${engineSecrets} ${nets} ${ports(e)} ${ports(p)}`);
      return `App and worker image ${a.Image}; commands ${JSON.stringify(a.Config.Cmd ?? a.Path)} and ${JSON.stringify(w.Config.Cmd)}. Identical in both (values compared, not recorded): ${same.join(", ")}. doc-engine: no variable naming a database, key, secret or relay (its variables include ${Object.keys(ee).filter((k) => k.startsWith("DOC_ENGINE")).join(", ")}); network ${nets.join(", ")}; published ports ${ports(e)}. postgres published ports ${ports(p)}.`;
    },
  );
};

phases["vendor-lists"] = async () => {
  await step(
    "V-M41-PUBLIC",
    "operator",
    "container-operation",
    "Read the vendor egress sources the guide names (outbound reads only; nothing is exposed)",
    "Anthropic's page lists 160.79.104.0/21; OpenAI's chatgpt-connectors.json returns prefixes a scheduled job can apply; Microsoft's managed connector page answers.",
    async () => {
      const get = async (u) => {
        try {
          const r = await fetch(u, { signal: AbortSignal.timeout(20_000), headers: { "user-agent": "Mozilla/5.0 doc030-walkthrough" } });
          return { status: r.status, text: await r.text() };
        } catch (e) {
          return { status: `error ${e.cause?.code ?? e.name}`, text: "" };
        }
      };
      const a = await get("https://platform.claude.com/docs/en/api/ip-addresses");
      const o = await get("https://openai.com/chatgpt-connectors.json");
      const og = await get("https://developers.openai.com/api/docs/guides/ip-addresses");
      const m = await get("https://learn.microsoft.com/en-us/connectors/common/outbound-ip-addresses");
      let prefixes = "not JSON";
      try {
        const j = JSON.parse(o.text);
        const list = j.prefixes ?? j;
        prefixes = `${Array.isArray(list) ? list.length : Object.keys(list).length} entries${j.creationTime ? `, creationTime ${j.creationTime}` : ""}`;
      } catch {}
      const anth = a.text.includes("160.79.104.0/21");
      return `Anthropic outbound IP page: ${a.status}, lists 160.79.104.0/21: ${anth}. OpenAI chatgpt-connectors.json: ${o.status}, ${prefixes}. OpenAI egress guidance: ${og.status}. Microsoft managed connector outbound addresses: ${m.status}${/AzureConnectors/.test(m.text) ? ", mentions AzureConnectors" : ""}. Applying these to a firewall in front of a public listener is part of the pending live session: this lab has no public listener.`;
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
  // Browsers launched by a failed private-origin sign-in are not always closed; exit anyway.
  setTimeout(() => process.exit(process.exitCode ?? 0), 500).unref();
}
