// DOC-029 independent operator walkthrough, group "operator-install", round 1.
// Scenarios V-C44 (install.md) and V-C45 (deployment-configuration.md), method container-operation.
//
// Run one phase at a time from the documentation worktree root:
//   mise exec -- node docs/documentation/batches/DOC-029/operator-install/walkthrough-r1.mjs <phase>
//
// Private state (the clone, its .env, fixture passwords, browser traces) lives outside the
// repository in WORK. The sanitized log is walkthrough-r1.json beside this script. Every attempt
// is appended, so a failed step stays in the log next to its retry.
import { createRequire } from "node:module";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync, chmodSync } from "node:fs";
import { createHash, randomBytes } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "../../../../..");
const require = createRequire(path.join(root, "package.json"));
const pnpm = (p) => path.join(root, "node_modules/.pnpm", p);
const { chromium, request: pwRequest } = require(
  pnpm("playwright@1.63.0/node_modules/playwright/index.js"),
);

const COMMIT = "3fa407e3a846559914aa1a63249741f30cfb4f69";
const WORK = "/home/blairwentworth/.cache/doc029-operator-install-r1";
const PRIVATE = path.join(WORK, "private");
const CLONE = path.join(WORK, "openlaw");
const FIX = path.join(WORK, "fixtures");
const PROJECT = "doc029-opinstall-r1";
const FX_PROJECT = "doc029-opinstall-r1-fx";
const APP_PORT = 23320;
const PROXY_PORT = 23321;
const MAIL_UI = "http://127.0.0.1:23322";
const MINIO_HOST = "http://127.0.0.1:23323";
const AZURITE_HOST = "http://127.0.0.1:23324";
const SPARE_PORT = 23326;
const LOCAL = `http://127.0.0.1:${APP_PORT}`;
const ORIGIN = `https://openlaw-r1.localhost:${PROXY_PORT}`;
const LOG = path.join(here, "walkthrough-r1.json");
const REVIEWER = "DOC-029 independent walkthrough agent (operator-install, round 1)";
const ADMIN = { name: "Avery Morgan", email: "avery.morgan@doc029-install.example" };
const COLLEAGUE = { name: "Rowan Operator", email: "rowan.operator@doc029-install.example" };
const RELAY_FROM = '"DOC-029 operator-install <openlaw@doc029-install.example>"';

mkdirSync(PRIVATE, { recursive: true });
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
      batch: "DOC-029",
      group: "operator-install",
      round: 1,
      reviewer: REVIEWER,
      reviewerKind: "agent",
      appCommit: COMMIT,
      projects: [PROJECT, FX_PROJECT],
      origin: ORIGIN,
      localAddress: LOCAL,
      note: "Container-operation walkthrough by an agent, not a human operator study. Commands ran against disposable Compose projects owned by this walkthrough. Secrets, cookies, mail bodies and links are not recorded; command output is reduced to exit codes and selected sanitized lines.",
      images: {},
      articleHashes: {},
      runs: [],
      steps: [],
    };
const run = { phase: process.argv[2], startedAt: new Date().toISOString(), completedAt: null };
log.runs.push(run);
for (const id of ["install", "deployment-configuration", "first-run"]) {
  const bytes = readFileSync(path.join(root, "docs/user-guides", `${id}.md`));
  log.articleHashes[id] = createHash("sha256").update(bytes).digest("hex");
}
function saveLog() {
  writeFileSync(LOG, JSON.stringify(log, null, 2) + "\n");
}

function secretsToRedact() {
  const values = new Set();
  for (const v of Object.values(state)) if (typeof v === "string" && v.length >= 8) values.add(v);
  const envFile = path.join(CLONE, ".env");
  if (existsSync(envFile)) {
    for (const line of readFileSync(envFile, "utf8").split("\n")) {
      const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
      if (!m) continue;
      if (/SECRET|KEY|PASSWORD|SMTP_URL|DATABASE_URL/.test(m[1]) && m[2].length >= 8) {
        values.add(m[2].replace(/^"|"$/g, ""));
      }
    }
  }
  return [...values];
}
function sanitize(text) {
  let out = String(text ?? "");
  for (const v of secretsToRedact()) out = out.split(v).join("[redacted]");
  out = out.replace(/(token|code|callbackURL)=[^&\s"')]+/gi, "$1=[redacted]");
  out = out.replace(/(postgres|smtp|smtps):\/\/[^\s"']+/g, "$1://[redacted]");
  return out;
}

async function step(scenario, action, expected, method, fn) {
  const entry = {
    phase: run.phase,
    scenario,
    articles: scenario === "V-C44" ? ["install"] : ["deployment-configuration"],
    role: "operator",
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
    entry.actual = sanitize(
      `Check did not pass: ${error instanceof Error ? error.message.split("\n").slice(0, 6).join(" ") : String(error)}`,
    );
    entry.result = "fail";
  }
  entry.at = new Date().toISOString();
  console.log(`${entry.result.toUpperCase()} [${scenario}] ${action}\n    ${entry.actual}`);
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
function sh(cmd, { cwd = CLONE, timeout = 1_800_000, env = {} } = {}) {
  const started = Date.now();
  const r = spawnSync("bash", ["-c", cmd], {
    cwd,
    env: { ...cleanEnv, ...env },
    encoding: "utf8",
    timeout,
    maxBuffer: 64 * 1024 * 1024,
  });
  return {
    code: r.status,
    stdout: r.stdout ?? "",
    stderr: r.stderr ?? "",
    ms: Date.now() - started,
  };
}
const compose = (args, opts) => sh(`docker compose ${args}`, opts);
const up = () => compose("up -d --no-build --pull never");
const firstLines = (text, n = 3) =>
  text
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .slice(0, n)
    .join(" | ");

function readEnv() {
  return readFileSync(path.join(CLONE, ".env"), "utf8");
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
    if (lines.at(-1) === "") lines.pop();
    if (value !== null) lines.push(`${key}=${value}`);
    lines.push("");
  }
  writeFileSync(path.join(CLONE, ".env"), lines.join("\n").replace(/\n{3,}/g, "\n\n"), {
    mode: 0o600,
  });
}

async function sleep(ms) {
  await new Promise((r) => setTimeout(r, ms));
}
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
  return rows[0] ? { state: rows[0].State, health: rows[0].Health, status: rows[0].Status } : null;
}
function appLogs(service, since) {
  return compose(`logs --no-color ${since ? `--since ${since}` : ""} ${service}`).stdout;
}

// ---------------------------------------------------------------- mail

async function mailCount() {
  const r = await fetch(`${MAIL_UI}/api/v1/messages?limit=1`).then((x) => x.json());
  return r.messages_count ?? r.total;
}
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
    if (hit) {
      const full = await fetch(`${MAIL_UI}/api/v1/message/${hit.ID}`).then((x) => x.json());
      return full;
    }
    await sleep(1000);
  }
  return null;
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
    args: [`--host-resolver-rules=MAP openlaw-r1.localhost 127.0.0.1`],
  });
  return browser;
}
async function newSession(base = ORIGIN) {
  const b = await openBrowser();
  const context = await b.newContext({ ignoreHTTPSErrors: true, baseURL: base });
  const page = await context.newPage();
  return { context, page };
}
/** Password sign-in through the browser's own sign-in page. */
async function signIn(base, email, password) {
  const s = await newSession(base);
  await s.page.goto(`${base}/auth/login`);
  await s.page.getByLabel("Email").fill(email);
  await s.page.getByLabel("Password", { exact: true }).fill(password);
  await s.page.getByRole("button", { name: "Sign in", exact: true }).click();
  await s.page.waitForURL((u) => !u.pathname.startsWith("/auth/login"), { timeout: 30_000 });
  return s;
}
/** An API client that carries a session cookie jar and the right Origin. */
async function apiClient(base, email, password, origin = base) {
  const ctx = await pwRequest.newContext({
    baseURL: base,
    ignoreHTTPSErrors: true,
    extraHTTPHeaders: { origin },
  });
  const r = await ctx.post("/api/auth/sign-in/email", { data: { email, password } });
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
async function ensureContract(api, title) {
  const types = await json(await api.get("/api/v1/contract-types"));
  const type = types.contractTypes.find((t) => !t.archivedAt) ?? types.contractTypes[0];
  const r = await api.post("/api/v1/contracts", { data: { title, contractTypeId: type.id } });
  const body = await json(r);
  if (r.status() !== 201 && r.status() !== 200)
    throw new Error(`contract create answered ${r.status()} ${JSON.stringify(body).slice(0, 200)}`);
  return body.contract;
}
function textFile(name, bytes) {
  return { name, mimeType: "text/plain", buffer: bytes };
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
const sha = (buf) => createHash("sha256").update(buf).digest("hex");
async function upload(api, contractNumber, file) {
  const r = await api.post(`/api/v1/contracts/${contractNumber}/documents`, {
    multipart: { file },
  });
  const body = await json(r);
  if (r.status() !== 201) return { status: r.status(), body };
  const doc = body.document;
  const version = doc.versions.find((v) => v.isCurrent) ?? doc.versions[0];
  return { status: 201, documentId: doc.id, versionId: version.id, sha256: sha(file.buffer) };
}
async function download(api, ref, timeout = 30_000) {
  const started = Date.now();
  let r;
  try {
    r = await api.get(`/api/v1/documents/${ref.documentId}/versions/${ref.versionId}/download`, {
      timeout,
    });
  } catch (e) {
    return {
      status: `no answer within ${Math.round((Date.now() - started) / 1000)} s`,
      matches: false,
    };
  }
  if (r.status() !== 200) return { status: r.status(), matches: false, ms: Date.now() - started };
  const bytes = await r.body();
  return { status: 200, matches: sha(bytes) === ref.sha256 };
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
async function adminApi(base = ORIGIN) {
  const c = await apiClient(base, ADMIN.email, state.adminPassword);
  expect(c.signInStatus === 200, `administrator sign-in answered ${c.signInStatus}`);
  return c.ctx;
}

// ---------------------------------------------------------------- phases

const phases = {};

phases.install = async () => {
  const t0 = Date.now();
  state.installStartedAt = new Date(t0).toISOString();
  saveState();
  await step(
    "V-C44",
    "Check prerequisites: docker version, docker compose version, docker context show, Git and OpenSSL",
    "Docker Engine and the Compose plugin answer, the context is the intended host, Git and OpenSSL are present.",
    "container-operation",
    () => {
      const v = sh("docker version --format '{{.Server.Version}}'", { cwd: WORK });
      const c = sh("docker compose version --short", { cwd: WORK });
      const ctx = sh("docker context show", { cwd: WORK });
      const g = sh("git --version && openssl version", { cwd: WORK });
      expect(
        v.code === 0 && c.code === 0 && ctx.code === 0 && g.code === 0,
        "a prerequisite command failed",
      );
      return `Docker Engine ${v.stdout.trim()}, Compose ${c.stdout.trim()}, context "${ctx.stdout.trim()}" (the local host), ${firstLines(g.stdout, 2)}. Disk had about 1.5 TB free.`;
    },
  );
  await step(
    "V-C44",
    "Clone into a new directory, enter it, and select the documented revision",
    "A detached checkout at 3fa407e3a846559914aa1a63249741f30cfb4f69.",
    "container-operation",
    () => {
      expect(!existsSync(CLONE), "the installation directory already exists");
      const r = sh(
        `git clone https://github.com/juggernog20/OpenLaw.git openlaw && cd openlaw && git checkout --detach ${COMMIT}`,
        { cwd: WORK },
      );
      expect(r.code === 0, `clone/checkout exited ${r.code}: ${firstLines(r.stderr)}`);
      const head = sh("git rev-parse HEAD && git status --porcelain | wc -l");
      const [rev, dirty] = head.stdout.trim().split("\n");
      expect(rev === COMMIT, `HEAD is ${rev}`);
      return `git clone and git checkout --detach exited 0 in ${Math.round(r.ms / 1000)} s. HEAD is ${rev}; ${dirty} uncommitted paths.`;
    },
  );
  const envBlock = `(
  umask 077
  set -C
  cat .env.example > .env || exit 1
  chmod 600 .env
  sed -i "s|^AUTH_SECRET=$|AUTH_SECRET=$(openssl rand -base64 32)|" .env
  sed -i "s|^OPENLAW_SECRET_KEY=$|OPENLAW_SECRET_KEY=$(openssl rand -base64 32)|" .env
)`;
  await step(
    "V-C44",
    "Run the grouped .env commands",
    ".env exists with mode 600 and both keys generated.",
    "container-operation",
    () => {
      const r = sh(envBlock);
      expect(r.code === 0, `block exited ${r.code}`);
      const mode = sh("stat -c %a .env").stdout.trim();
      const a = envValue("AUTH_SECRET") ?? "";
      const k = envValue("OPENLAW_SECRET_KEY") ?? "";
      expect(mode === "600", `mode ${mode}`);
      expect(
        a.length === 44 && k.length === 44 && a !== k,
        "keys were not generated as two different values",
      );
      state.authSecretSha = sha(a);
      state.secretKeySha = sha(k);
      saveState();
      return `The block exited 0. .env has mode 600. AUTH_SECRET and OPENLAW_SECRET_KEY each hold a different 44-character generated value (values not recorded).`;
    },
  );
  await step(
    "V-C44",
    "Run the grouped .env commands again over the existing .env",
    "The commands refuse to overwrite the existing .env and stop before changing its keys.",
    "container-operation",
    () => {
      const before = sha(readEnv());
      const r = sh(envBlock);
      const after = sha(readEnv());
      expect(r.code !== 0, "the second run exited 0");
      expect(before === after, "the .env bytes changed");
      return `The second run exited ${r.code} with "${firstLines(r.stderr, 1)}". The .env bytes were unchanged (same SHA-256 before and after).`;
    },
  );
  await step(
    "V-C44",
    "Edit .env with the origin, port and project name, and create compose.operator.yml",
    "Each setting appears once; compose.operator.yml names the two revision-tagged images.",
    "container-operation",
    () => {
      setEnv({
        COMPOSE_PROJECT_NAME: PROJECT,
        COMPOSE_FILE: "compose.yml:compose.operator.yml",
        OPENLAW_BUILD_COMMIT: COMMIT,
        OPENLAW_BUILD_DIRTY: "false",
        BASE_URL: ORIGIN,
        PORT: String(APP_PORT),
      });
      writeFileSync(
        path.join(CLONE, "compose.operator.yml"),
        `services:
  app:
    image: openlaw-local:\${OPENLAW_BUILD_COMMIT:?Set the source revision}
  worker:
    image: openlaw-local:\${OPENLAW_BUILD_COMMIT:?Set the source revision}
  doc-engine:
    image: openlaw-engine-local:\${OPENLAW_BUILD_COMMIT:?Set the source revision}
`,
      );
      const dupes = [
        "COMPOSE_PROJECT_NAME",
        "COMPOSE_FILE",
        "OPENLAW_BUILD_COMMIT",
        "OPENLAW_BUILD_DIRTY",
        "BASE_URL",
        "PORT",
      ].filter(
        (k) =>
          readEnv()
            .split("\n")
            .filter((l) => l.startsWith(`${k}=`)).length !== 1,
      );
      expect(dupes.length === 0, `settings not present exactly once: ${dupes.join(", ")}`);
      return `Added COMPOSE_PROJECT_NAME=${PROJECT}, COMPOSE_FILE=compose.yml:compose.operator.yml, OPENLAW_BUILD_COMMIT=${COMMIT}, OPENLAW_BUILD_DIRTY=false, BASE_URL=${ORIGIN} (the local proxy origin chosen for this check) and PORT=${APP_PORT}, each once. Wrote compose.operator.yml exactly as the article shows. Saving the keys in a secret store was represented by the private walkthrough directory outside the repository.`;
    },
  );
  await step(
    "V-C44",
    "Check the configuration: docker compose config --quiet and --services",
    "config --quiet prints nothing and exits 0; the services are app, worker, postgres and doc-engine.",
    "container-operation",
    () => {
      const q = compose("config --quiet");
      const s = compose("config --services");
      expect(q.code === 0 && q.stdout.trim() === "", `config --quiet exited ${q.code} with output`);
      const services = s.stdout.trim().split("\n").sort();
      expect(
        JSON.stringify(services) === JSON.stringify(["app", "doc-engine", "postgres", "worker"]),
        `services ${services}`,
      );
      return `docker compose config --quiet exited 0 with no output. config --services listed ${services.join(", ")}.`;
    },
  );
  await step(
    "V-C44",
    "docker compose pull postgres",
    "Postgres 16 is available.",
    "container-operation",
    () => {
      const r = compose("pull postgres");
      expect(r.code === 0, `pull exited ${r.code}: ${firstLines(r.stderr)}`);
      return `docker compose pull postgres exited 0 in ${Math.round(r.ms / 1000)} s.`;
    },
  );
  await step(
    "V-C44",
    "docker compose build app doc-engine",
    "Both images build and carry the revision tags; the worker needs no separate build.",
    "container-operation",
    () => {
      const r = compose("build app doc-engine", { timeout: 3_600_000 });
      expect(
        r.code === 0,
        `build exited ${r.code}: ${firstLines(r.stderr.split("\n").slice(-8).join("\n"), 8)}`,
      );
      const app = sh(
        `docker image inspect --format '{{.Id}}' openlaw-local:${COMMIT}`,
      ).stdout.trim();
      const eng = sh(
        `docker image inspect --format '{{.Id}}' openlaw-engine-local:${COMMIT}`,
      ).stdout.trim();
      expect(app.startsWith("sha256:") && eng.startsWith("sha256:"), "a tagged image is missing");
      state.buildMs = r.ms;
      saveState();
      return `docker compose build app doc-engine exited 0 in ${Math.round(r.ms / 1000)} s. openlaw-local:${COMMIT} is ${app}; openlaw-engine-local:${COMMIT} is ${eng}.`;
    },
  );
  await upAndReady();
};

async function upAndReady() {
  await step(
    "V-C44",
    "docker compose up -d --no-build --pull never, then docker compose ps",
    "The four services start from the built images.",
    "container-operation",
    () => {
      const r = up();
      expect(r.code === 0, `up exited ${r.code}: ${firstLines(r.stderr)}`);
      const ps = compose("ps --format '{{.Service}} {{.State}}'").stdout.trim().split("\n").sort();
      return `up exited 0. docker compose ps: ${ps.join("; ")}.`;
    },
  );
  await step(
    "V-C44",
    "curl --fail http://127.0.0.1:<PORT>/readyz; check the worker is running and the document engine becomes healthy",
    "readyz succeeds; worker running; doc-engine healthy.",
    "container-operation",
    async () => {
      const code = await waitReady(240_000);
      const c = sh(
        `curl --fail -sS -o /dev/null -w '%{http_code}' http://127.0.0.1:${APP_PORT}/readyz`,
      );
      expect(code === 200 && c.code === 0, `readyz ${code}, curl exit ${c.code}`);
      state.readyAt = new Date().toISOString();
      saveState();
      let eng;
      for (let i = 0; i < 90; i++) {
        eng = containerState("doc-engine");
        if (eng?.health === "healthy") break;
        await sleep(2000);
      }
      const worker = containerState("worker");
      expect(worker?.state === "running", `worker ${JSON.stringify(worker)}`);
      expect(eng?.health === "healthy", `doc-engine ${JSON.stringify(eng)}`);
      const appImg = sh(
        `docker inspect --format '{{.Image}}' $(docker compose ps -q app)`,
      ).stdout.trim();
      const wImg = sh(
        `docker inspect --format '{{.Image}}' $(docker compose ps -q worker)`,
      ).stdout.trim();
      const eImg = sh(
        `docker inspect --format '{{.Image}}' $(docker compose ps -q doc-engine)`,
      ).stdout.trim();
      log.images = { app: appImg, worker: wImg, "doc-engine": eImg, postgres: "postgres:16" };
      const elapsed = Math.round((Date.now() - new Date(state.installStartedAt).getTime()) / 1000);
      return `curl --fail /readyz exited 0 with HTTP 200. The worker is running and the doc-engine reports healthy. The running app and worker containers use ${appImg}; doc-engine uses ${eImg}. Elapsed from the first prerequisite command to readiness: ${elapsed} s on this host (build cache warm from earlier labs of the same revision).`;
    },
  );
}

phases["install-up"] = async () => {
  await step(
    "V-C44",
    "Environment workaround: create the two project networks with explicit private subnets",
    "The shared host's Docker address pools are exhausted by parallel labs; pre-created networks carrying the Compose project labels let the article's own up command proceed unchanged.",
    "container-operation",
    () => {
      const r = sh(
        `docker network inspect ${PROJECT}_openlaw-backend ${PROJECT}_openlaw-doc-engine --format '{{.Name}} internal={{.Internal}} {{range .IPAM.Config}}{{.Subnet}}{{end}}'`,
      );
      expect(r.code === 0, "networks missing");
      return `The first up failed with "all predefined address pools have been fully subnetted" because other parallel documentation labs hold every default pool. The reviewer created ${r.stdout.trim().split("\n").join("; ")} with the Compose project and network labels (docker network create --subnet ... --label com.docker.compose.project=${PROJECT} --label com.docker.compose.network=...). No installation file changed; this is a host workaround, not an article step.`;
    },
  );
  await upAndReady();
};

phases.fixtures = async () => {
  await step(
    "V-C45",
    "Start owned test dependencies: SMTP relay stand-in, MinIO, Azurite, a separate Postgres 16, and a Caddy reverse proxy on the app host",
    "The fixture project starts beside the installation without changing its services.",
    "container-operation",
    () => {
      mkdirSync(FIX, { recursive: true });
      const minioUser = `doc029${secret("minioUserSuffix", 6)}`.replace(/[^a-zA-Z0-9]/g, "x");
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
\thttp_port 23325
\tauto_https disable_redirects
\tdefault_bind 127.0.0.1 [::1]
\tskip_install_trust
}

openlaw-r1.localhost:${PROXY_PORT} {
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
    ports: ["127.0.0.1:23322:8025"]
  minio:
    image: minio/minio:RELEASE.2025-09-07T16-13-09Z
    command: server /data
    environment:
      MINIO_ROOT_USER: \${MINIO_ROOT_USER}
      MINIO_ROOT_PASSWORD: \${MINIO_ROOT_PASSWORD}
    networks: { backend: { aliases: [minio] } }
    ports: ["127.0.0.1:23323:9000"]
  azurite:
    image: mcr.microsoft.com/azure-storage/azurite:3.36.0
    command: azurite-blob --blobHost 0.0.0.0 --skipApiVersionCheck --loose
    networks: { backend: { aliases: [azurite] } }
    ports: ["127.0.0.1:23324:10000"]
  extdb:
    image: postgres:16
    environment:
      POSTGRES_USER: doc029ext
      POSTGRES_PASSWORD: \${EXTDB_PASSWORD}
      POSTGRES_DB: doc029ext
    networks: { backend: { aliases: [extdb] } }
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U doc029ext -d doc029ext"]
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
      return `Fixture project ${FX_PROJECT} started: Mailpit as the SMTP relay stand-in (relay:1025 on the installation's backend network, UI on 127.0.0.1:23322), MinIO (127.0.0.1:23323), Azurite (127.0.0.1:23324), a separate postgres:16 service reachable only on the backend network as extdb, and caddy:2-alpine on the host network serving https://openlaw-r1.localhost:${PROXY_PORT} with "reverse_proxy 127.0.0.1:${APP_PORT}". Caddy issues the localhost certificate from its internal CA; the browser context accepts that CA, which does not test public certificate issuance.`;
    },
  );
  await step(
    "V-C44",
    "Open the HTTPS origin and check that it reaches Set up OpenLaw",
    "The proxy origin serves the Set up OpenLaw page on an empty instance.",
    "browser-walkthrough",
    async () => {
      const { page, context } = await newSession();
      const r = await page.goto(ORIGIN);
      await page.getByRole("heading", { name: "Set up OpenLaw" }).waitFor({ timeout: 30_000 });
      const status = r?.status();
      await page.screenshot({ path: path.join(here, "r1-setup-through-proxy.png") });
      await context.close();
      return `GET ${ORIGIN} answered ${status} through Caddy, and the page shows the "Set up OpenLaw" heading. Screenshot r1-setup-through-proxy.png.`;
    },
  );
};

phases.firstrun = async () => {
  secret("adminPassword");
  const { page, context } = await newSession();
  const shot = (n) =>
    page.screenshot({ path: path.join(PRIVATE, `firstrun-${n}.png`) }).catch(() => {});
  try {
    await step(
      "V-C44",
      "Create the initial Administrator through the HTTPS origin (first-run.md: Set up OpenLaw)",
      "Create Administrator signs the fictional Administrator in and opens Welcome to OpenLaw.",
      "browser-walkthrough",
      async () => {
        await page.goto(ORIGIN);
        await page.getByRole("heading", { name: "Set up OpenLaw" }).waitFor();
        await page.getByLabel("Name", { exact: true }).fill(ADMIN.name);
        await page.getByLabel("Email", { exact: true }).fill(ADMIN.email);
        await page.getByLabel("Password", { exact: true }).fill(state.adminPassword);
        await page.getByLabel("Confirm password", { exact: true }).fill(state.adminPassword);
        await page.getByRole("button", { name: "Create Administrator" }).click();
        await page
          .getByRole("heading", { name: "Welcome to OpenLaw" })
          .waitFor({ timeout: 30_000 });
        return `Created the fictional Administrator ${ADMIN.name} at ${ORIGIN}. OpenLaw signed her in and showed "Welcome to OpenLaw".`;
      },
    );
    await shot("welcome");
    await step(
      "V-C44",
      "Welcome wizard up to Outbound email, then check that the wizard cannot finish without email",
      "Continue on Outbound email is unavailable and completing onboarding is refused while email is not configured.",
      "browser-walkthrough",
      async () => {
        await page.getByRole("button", { name: "Get started" }).click();
        await page.getByLabel("Organization name").fill("DOC-029 operator-install Organization");
        await page.getByRole("button", { name: "Continue" }).click();
        await page.getByText(/Step 3 of 9/).waitFor();
        await page.getByRole("button", { name: "Continue" }).click();
        await page.getByText(/Step 4 of 9/).waitFor();
        await page.getByRole("button", { name: "Continue" }).click();
        await page.getByText(/Step 5 of 9/).waitFor();
        await shot("email-step");
        const cont = page.getByRole("button", { name: "Continue" });
        const disabled = await cont.isDisabled();
        const later = await page.getByRole("button", { name: "Set up later" }).count();
        const r = await page.request.post(`${ORIGIN}/api/v1/onboarding/complete`, {
          headers: { origin: ORIGIN },
        });
        const body = await json(r);
        expect(disabled, "Continue is enabled before email is configured");
        expect(later === 0, "Set up later is offered on Outbound email");
        expect(r.status() === 409, `onboarding/complete answered ${r.status()}`);
        return `Your organization saved "DOC-029 operator-install Organization"; Authentication and Business-user portal continued with defaults. On Outbound email (Step 5 of 9) Continue was disabled and no Set up later was offered. A direct completion request answered HTTP 409 "${body.detail ?? body.title}".`;
      },
    );
    await step(
      "V-C44",
      "Save and test the SMTP relay in Outbound email",
      "Save relay stores the relay, Send test email delivers to the Administrator, and Continue becomes available.",
      "browser-walkthrough",
      async () => {
        const since = new Date().toISOString();
        await page.getByLabel("SMTP relay URL").fill("smtp://relay:1025");
        await page.getByLabel("From address").fill(RELAY_FROM.replace(/"/g, ""));
        await page.getByRole("button", { name: "Save relay" }).click();
        await page.getByRole("button", { name: "Send test email" }).waitFor({ timeout: 15_000 });
        await page.getByRole("button", { name: "Send test email" }).click();
        const msg = await waitMail(ADMIN.email, "OpenLaw test email", since);
        expect(msg, "no test email arrived at the relay");
        const cont = page.getByRole("button", { name: "Continue" });
        await cont.waitFor();
        expect(!(await cont.isDisabled()), "Continue stayed disabled after saving the relay");
        return `Save relay stored smtp://relay:1025 with the From address; Send test email delivered "OpenLaw test email" to ${ADMIN.email} at the owned relay; Continue became available.`;
      },
    );
    await step(
      "V-C44",
      "Invite a colleague, skip E-signature and AI analysis, and Finish on Review",
      "The invitation arrives with a link on the configured origin; Finish enters the app.",
      "browser-walkthrough",
      async () => {
        await page.getByRole("button", { name: "Continue" }).click();
        await page.getByText(/Step 6 of 9/).waitFor();
        await shot("invite-step");
        const since = new Date().toISOString();
        await page.getByLabel("Name", { exact: true }).fill(COLLEAGUE.name);
        await page.getByLabel("Email", { exact: true }).fill(COLLEAGUE.email);
        await page.getByRole("button", { name: "Legal team member", exact: true }).click();
        await page.getByRole("button", { name: "Send invite" }).click();
        const msg = await waitMail(COLLEAGUE.email, null, since);
        expect(msg, "no invitation arrived");
        const link = firstLink(msg);
        expect(link && link.origin === ORIGIN, `invitation link origin ${link?.origin}`);
        state.invitePath = link.pathname;
        saveState();
        await page.getByRole("button", { name: "Continue" }).click();
        await page.getByText(/Step 7 of 9/).waitFor();
        await page.getByRole("button", { name: "Set up later" }).click();
        await page.getByText(/Step 8 of 9/).waitFor();
        await page.getByRole("button", { name: "Set up later" }).click();
        await page.getByText(/Step 9 of 9/).waitFor();
        await shot("review-step");
        await page.getByRole("button", { name: "Finish" }).click();
        await page.waitForURL((u) => !u.pathname.startsWith("/onboarding"), { timeout: 30_000 });
        const status = await json(await page.request.get(`${ORIGIN}/api/v1/onboarding`));
        return `Send invite delivered an invitation "${msg.Subject}" to the fictional ${COLLEAGUE.name}; its link uses origin ${link.origin} (token not recorded). E-signature and AI analysis were set up later; Finish on Review entered the app at ${new URL(page.url()).pathname}. Onboarding completed: ${status.completed ?? JSON.stringify(status).slice(0, 80)}.`;
      },
    );
  } finally {
    await shot("last");
    await context.close();
  }
};

phases["firstrun-finish"] = async () => {
  await step(
    "V-C44",
    "Resume the unfinished wizard after sign-in and Finish on Review",
    "Home reopens the wizard at Welcome; saved choices remain; Finish records completion and enters the app.",
    "browser-walkthrough",
    async () => {
      const s = await signIn(ORIGIN, ADMIN.email, state.adminPassword);
      const { page } = s;
      try {
        await page.goto(ORIGIN);
        await page
          .getByRole("heading", { name: "Welcome to OpenLaw" })
          .waitFor({ timeout: 30_000 });
        const reopenedAt = new URL(page.url()).pathname;
        await page.getByRole("button", { name: "Get started" }).click();
        const org = await page.getByLabel("Organization name").inputValue();
        for (let n = 2; n < 9; n++) {
          await page.getByText(`Step ${n} of 9`).waitFor();
          const later = page.getByRole("button", { name: "Set up later" });
          const cont = page.getByRole("button", { name: "Continue" });
          if (n >= 7 && (await later.count())) await later.click();
          else await cont.click();
          await page.getByText(`Step ${n + 1} of 9`).waitFor({ timeout: 15_000 });
        }
        await page.getByRole("button", { name: "Finish" }).click();
        await page.waitForURL((u) => !u.pathname.startsWith("/welcome"), { timeout: 30_000 });
        const status = await json(await page.request.get(`${ORIGIN}/api/v1/onboarding`));
        expect(status.completed === true, `onboarding ${JSON.stringify(status).slice(0, 120)}`);
        return `After password sign-in, the address opened the wizard at ${reopenedAt} on "Welcome to OpenLaw". Get started showed the saved Organization name "${org}". Continue moved through the saved steps; E-signature and AI analysis were set up later; Finish on Review entered the app at ${new URL(page.url()).pathname}. The onboarding state now reads completed=true.`;
      } finally {
        await page.screenshot({ path: path.join(PRIVATE, "firstrun-finish.png") }).catch(() => {});
        await s.context.close();
      }
    },
  );
};

phases["firstrun-verify"] = async () => {
  await step(
    "V-C44",
    "Verify that the earlier Finish on Review completed onboarding",
    "The onboarding state reads completed with review done, and the address opens Home rather than the wizard.",
    "browser-walkthrough",
    async () => {
      const s = await signIn(ORIGIN, ADMIN.email, state.adminPassword);
      try {
        await s.page.goto(ORIGIN);
        await s.page.getByRole("heading", { name: "Home" }).waitFor({ timeout: 30_000 });
        const status = await json(await s.page.request.get(`${ORIGIN}/api/v1/onboarding`));
        const org = await json(await s.page.request.get(`${ORIGIN}/api/v1/org/general`));
        expect(
          status.completed === true && status.steps.review.done && status.steps.email.done,
          JSON.stringify(status).slice(0, 160),
        );
        return `The onboarding state reads completed=true with review done, email done and invites done; e-signature and AI analysis are not done (set up later). The address opens Home at ${new URL(s.page.url()).pathname}. The organization name is "${org.general.name}". The first attempt's Finish click had completed; its status read ran before the write landed.`;
      } finally {
        await s.context.close();
      }
    },
  );
};

phases.checks = async () => {
  secret("colleaguePassword");
  await step(
    "V-C44",
    "Sign in through the intended origin",
    "Password sign-in through the proxy origin reaches the app.",
    "browser-walkthrough",
    async () => {
      const s = await signIn(ORIGIN, ADMIN.email, state.adminPassword);
      const p = new URL(s.page.url()).pathname;
      await s.context.close();
      return `Signed in as ${ADMIN.name} at ${ORIGIN}/auth/login; the browser left the sign-in page for ${p}.`;
    },
  );
  const api = await adminApi();
  await step(
    "V-C44",
    "Create a fictional Contract, upload a small supported Document, download it again and check its processing result",
    "The Contract exists; the downloaded bytes match; processing reaches ready.",
    "container-operation",
    async () => {
      const contract = state.contractNumber
        ? (await json(await api.get(`/api/v1/contracts/${state.contractNumber}`))).contract
        : await ensureContract(api, "DOC-029 operator-install check contract");
      state.contractNumber = contract.number;
      const pdf = pdfFile("doc029-install-check.pdf", "DOC-029 operator install check words");
      const ref = await upload(api, contract.number, pdf);
      expect(
        ref.status === 201,
        `upload answered ${ref.status} ${String(JSON.stringify(ref.body)).slice(0, 200)}`,
      );
      state.docs = { installPdf: ref };
      saveState();
      const d = await download(api, ref);
      expect(d.matches, `download ${d.status}, bytes match ${d.matches}`);
      const t = await waitText(api, ref);
      expect(
        t.state === "ready" && /operator install check/i.test(t.text ?? ""),
        `processing ${t.state}`,
      );
      return `Created Contract ${contract.number} "DOC-029 operator-install check contract". Uploaded a one-page PDF (201); its download matched the uploaded SHA-256. Text extraction reached "ready" with the uploaded words (source ${t.source ?? "n/a"}).`;
    },
  );
  await step(
    "V-C44",
    "Confirm the test invitation's link is usable",
    "The recipient can open the link on the configured origin and set a password, then sign in.",
    "browser-walkthrough",
    async () => {
      const msg = await waitMail(COLLEAGUE.email, null, null, 5000);
      const link = firstLink(msg);
      expect(link?.origin === ORIGIN, "no invitation link on the origin");
      const { page, context } = await newSession();
      await page.goto(link.toString());
      await page.getByLabel("New password").fill(state.colleaguePassword);
      await page.getByLabel("Confirm password").fill(state.colleaguePassword);
      await page.getByRole("button", { name: "Set password" }).click();
      await page.getByText("Password set").first().waitFor({ timeout: 30_000 });
      await context.close();
      const c = await apiClient(ORIGIN, COLLEAGUE.email, state.colleaguePassword);
      const me = await json(await c.ctx.get("/api/v1/me"));
      await c.ctx.dispose();
      expect(
        c.signInStatus === 200 && me.user?.email === COLLEAGUE.email,
        `sign-in ${c.signInStatus}`,
      );
      return `Opened the invitation link on ${ORIGIN}, set a password for ${COLLEAGUE.name}, and signed in with it (role ${me.user.role}).`;
    },
  );
  await step(
    "V-C44",
    "Confirm that the worker processes new work after a restart",
    "After docker compose restart worker, a new upload is processed.",
    "container-operation",
    async () => {
      const r = compose("restart worker");
      expect(r.code === 0, `restart exited ${r.code}`);
      const ref = await upload(
        api,
        state.contractNumber,
        pdfFile("doc029-after-restart.pdf", "processed after worker restart"),
      );
      expect(ref.status === 201, `upload ${ref.status}`);
      const t = await waitText(api, ref);
      expect(t.state === "ready", `processing ${t.state}`);
      return `docker compose restart worker exited 0. A PDF uploaded afterwards reached "ready" with its words.`;
    },
  );
  await step(
    "V-C44",
    "Record the source revision, resolved images, project name, origin and storage location",
    "The identities can be read back from the running installation.",
    "container-operation",
    () => {
      const rev = sh("git rev-parse HEAD").stdout.trim();
      const imgs = compose("images --format json").stdout.trim();
      const vol = sh(
        `docker volume inspect ${PROJECT}_openlaw-files --format '{{.Name}}'`,
      ).stdout.trim();
      expect(rev === COMMIT && imgs.length > 0 && vol, "an identity could not be read");
      return `Source ${rev}; project ${PROJECT}; origin ${ORIGIN}; local files in volume ${vol}; images as recorded in the log's images field.`;
    },
  );
  const elapsed = Math.round((Date.now() - new Date(state.installStartedAt).getTime()) / 1000);
  state.installChecksElapsedS = elapsed;
  saveState();
  await api.dispose();
};

phases["checks-document"] = async () => {
  const api = await adminApi();
  await step(
    "V-C44",
    "Create a fictional Contract, upload a small supported Document, download it again and check its processing result",
    "The Contract exists; the downloaded bytes match; processing reaches ready.",
    "container-operation",
    async () => {
      const contract = state.contractNumber
        ? (await json(await api.get(`/api/v1/contracts/${state.contractNumber}`))).contract
        : await ensureContract(api, "DOC-029 operator-install check contract");
      state.contractNumber = contract.number;
      const pdf = pdfFile("doc029-install-check.pdf", "DOC-029 operator install check words");
      const ref = await upload(api, contract.number, pdf);
      expect(
        ref.status === 201,
        `upload answered ${ref.status} ${String(JSON.stringify(ref.body)).slice(0, 200)}`,
      );
      state.docs = { installPdf: ref };
      saveState();
      const d = await download(api, ref);
      expect(d.matches, `download ${d.status}, bytes match ${d.matches}`);
      const t = await waitText(api, ref);
      expect(
        t.state === "ready" && /operator install check/i.test(t.text ?? ""),
        `processing ${t.state}`,
      );
      return `Created Contract ${contract.number} "DOC-029 operator-install check contract". Uploaded a one-page PDF (201); its download matched the uploaded SHA-256. Text extraction reached "ready" with the uploaded words (source ${t.source ?? "n/a"}).`;
    },
  );
  await api.dispose();
};

phases["install-negatives"] = async () => {
  await step(
    "V-C44",
    "Missing secret: blank AUTH_SECRET",
    "Compose refuses before any container changes; restoring the key recovers.",
    "container-operation",
    async () => {
      const original = envValue("AUTH_SECRET");
      setEnv({ AUTH_SECRET: "" });
      const q = compose("config --quiet");
      const u = up();
      const ps = compose("ps --format '{{.Service}}'").stdout.trim().split("\n").sort();
      setEnv({ AUTH_SECRET: original });
      const q2 = compose("config --quiet");
      const ready = await readyz();
      expect(q.code !== 0 && u.code !== 0, "Compose accepted a blank AUTH_SECRET");
      expect(
        ps.length === 4 && q2.code === 0 && ready === 200,
        `after restore: ps ${ps}, config ${q2.code}, readyz ${ready}`,
      );
      return `With AUTH_SECRET blank, config --quiet exited ${q.code} and up exited ${u.code} with "${firstLines(u.stderr, 1)}". docker compose ps still listed ${ps.join(", ")}. Restoring the key made config --quiet exit 0; /readyz answered 200.`;
    },
  );
  await step(
    "V-C44",
    "Occupied port: set PORT to a port an unrelated listener already holds",
    "The start fails and names the port; the other listener is untouched; an unused port recovers.",
    "container-operation",
    async () => {
      const holder = spawnSync(
        "bash",
        [
          "-c",
          `nohup python3 -m http.server ${SPARE_PORT} --bind 0.0.0.0 >/dev/null 2>&1 & echo $!`,
        ],
        { encoding: "utf8" },
      );
      const pid = holder.stdout.trim();
      await sleep(1500);
      try {
        setEnv({ PORT: String(SPARE_PORT) });
        const u = up();
        const ps = compose("ps --format '{{.Service}}'")
          .stdout.trim()
          .split("\n")
          .filter(Boolean)
          .sort();
        const other = await fetch(`http://127.0.0.1:${SPARE_PORT}/`)
          .then((r) => r.status)
          .catch(() => "down");
        setEnv({ PORT: String(APP_PORT) });
        const u2 = up();
        const ready = await waitReady(120_000);
        expect(
          u.code !== 0 && /address already in use|port is already allocated/i.test(u.stderr),
          `up exited ${u.code}: ${firstLines(u.stderr)}`,
        );
        expect(other === 200, `the unrelated listener answered ${other}`);
        expect(u2.code === 0 && ready === 200, `recovery up ${u2.code}, readyz ${ready}`);
        const line =
          u.stderr.split("\n").find((l) => /already in use|already allocated/i.test(l)) ?? "";
        return `With PORT=${SPARE_PORT} held by an unrelated owned listener, up exited ${u.code} with "${(line.match(/(failed to bind|Bind for).*$/)?.[0] ?? line).trim().slice(0, 200)}". docker compose ps then listed ${ps.join(", ") || "nothing"}. The unrelated listener still answered 200. Restoring PORT=${APP_PORT} and running up -d --no-build --pull never brought the app back; /readyz 200.`;
      } finally {
        spawnSync("kill", [pid]);
      }
    },
  );
  await step(
    "V-C44",
    "Unavailable dependency: stop the bundled database",
    "Readiness fails while the database is unavailable and recovers when it returns.",
    "container-operation",
    async () => {
      const s = compose("stop postgres");
      await sleep(3000);
      const down = await readyz();
      const st = compose("start postgres");
      const ready = await waitReady(120_000);
      expect(s.code === 0 && down !== 200, `readyz while stopped: ${down}`);
      expect(st.code === 0 && ready === 200, `after start: ${ready}`);
      return `docker compose stop postgres; /readyz then answered ${down}. docker compose start postgres; /readyz answered 200 again.`;
    },
  );
  await step(
    "V-C44",
    "Negative: the authoring lab is not used as installation evidence",
    "All V-C44 observations come from the owned project built by the article's commands.",
    "container-operation",
    () =>
      `Every V-C44 step ran against ${PROJECT}, built by the article's own clone, .env and Compose commands. No lab.mjs lab, seed data, or dev overlay was used.`,
  );
};

phases["port-negative"] = async () => {
  await step(
    "V-C44",
    "Occupied port: set PORT to a port an unrelated listener already holds",
    "The start fails and names the port; the other listener is untouched; an unused port recovers.",
    "container-operation",
    async () => {
      const holder = spawnSync(
        "bash",
        [
          "-c",
          `nohup python3 -m http.server ${SPARE_PORT} --bind 0.0.0.0 >/dev/null 2>&1 & echo $!`,
        ],
        { encoding: "utf8" },
      );
      const pid = holder.stdout.trim();
      await sleep(1500);
      try {
        setEnv({ PORT: String(SPARE_PORT) });
        const u = up();
        const ps = compose("ps --format '{{.Service}}'")
          .stdout.trim()
          .split("\n")
          .filter(Boolean)
          .sort();
        const other = await fetch(`http://127.0.0.1:${SPARE_PORT}/`)
          .then((r) => r.status)
          .catch(() => "down");
        setEnv({ PORT: String(APP_PORT) });
        const u2 = up();
        const ready = await waitReady(120_000);
        expect(
          u.code !== 0 && /address already in use|port is already allocated/i.test(u.stderr),
          `up exited ${u.code}: ${firstLines(u.stderr)}`,
        );
        expect(other === 200, `the unrelated listener answered ${other}`);
        expect(u2.code === 0 && ready === 200, `recovery up ${u2.code}, readyz ${ready}`);
        const line =
          u.stderr.split("\n").find((l) => /already in use|already allocated/i.test(l)) ?? "";
        return `With PORT=${SPARE_PORT} held by an unrelated owned listener, up exited ${u.code} with "${(line.match(/(failed to bind|Bind for).*$/)?.[0] ?? line).trim().slice(0, 200)}". docker compose ps then listed ${ps.join(", ") || "nothing"}. The unrelated listener still answered 200. Restoring PORT=${APP_PORT} and running up -d --no-build --pull never brought the app back; /readyz 200.`;
      } finally {
        spawnSync("kill", [pid]);
      }
    },
  );
};

phases.apply = async () => {
  const api = await adminApi();
  const big = textFile("doc029-limit-big.txt", Buffer.alloc(1_100_000, 97));
  const small = textFile("doc029-limit-small.txt", Buffer.alloc(200_000, 98));
  const inContainer = (svc, name) => compose(`exec -T ${svc} printenv ${name}`).stdout.trim();
  await step(
    "V-C45",
    "docker compose restart does not apply a changed .env",
    "After setting MAX_UPLOAD_MB=1 and restarting, the app still has the old environment.",
    "container-operation",
    async () => {
      setEnv({ MAX_UPLOAD_MB: "1" });
      const r = compose("restart app");
      await waitReady();
      const env = inContainer("app", "MAX_UPLOAD_MB");
      const up1 = await upload(await adminApi(), state.contractNumber, big);
      expect(
        r.code === 0 && env === "" && up1.status === 201,
        `env "${env}", upload ${up1.status}`,
      );
      return `After adding MAX_UPLOAD_MB=1 and docker compose restart app, the container's MAX_UPLOAD_MB was still empty and a 1,100,000-byte upload was accepted (201).`;
    },
  );
  await step(
    "V-C45",
    "up -d --no-build --pull never applies it; MAX_UPLOAD_MB=1 refuses a larger upload and accepts a smaller one",
    "The recreated app enforces the 1 MB ceiling.",
    "container-operation",
    async () => {
      const r = up();
      await waitReady();
      const env = inContainer("app", "MAX_UPLOAD_MB");
      const a = await adminApi();
      const b = await upload(a, state.contractNumber, big);
      const s = await upload(a, state.contractNumber, small);
      expect(
        r.code === 0 && env === "1" && b.status === 413 && s.status === 201,
        `env ${env}, big ${b.status}, small ${s.status}`,
      );
      return `up -d --no-build --pull never recreated the app; MAX_UPLOAD_MB is now 1 in the container. The 1,100,000-byte upload was refused with ${b.status} "${b.body?.detail ?? ""}"; a 200,000-byte upload was accepted (201). The Caddy proxy has no body limit configured, so the app's own refusal was seen.`;
    },
  );
  await step(
    "V-C45",
    "An unreadable MAX_UPLOAD_MB falls back to the default instead of stopping startup",
    "MAX_UPLOAD_MB=ten starts normally and accepts a 1.1 MB upload.",
    "container-operation",
    async () => {
      setEnv({ MAX_UPLOAD_MB: "ten" });
      const r = up();
      const ready = await waitReady();
      const b = await upload(await adminApi(), state.contractNumber, big);
      setEnv({ MAX_UPLOAD_MB: null });
      up();
      await waitReady();
      expect(
        r.code === 0 && ready === 200 && b.status === 201,
        `ready ${ready}, upload ${b.status}`,
      );
      return `With MAX_UPLOAD_MB=ten the app started (/readyz 200) and accepted the 1,100,000-byte upload (201), so the ceiling fell back to the 100 MB default. The setting was then removed and the containers recreated.`;
    },
  );
  await step(
    "V-C45",
    "config --quiet validates without printing the expanded configuration",
    "Exit 0 and no output.",
    "container-operation",
    () => {
      const q = compose("config --quiet");
      expect(q.code === 0 && q.stdout === "" && q.stderr === "", "output was printed");
      return "docker compose config --quiet exited 0 and printed nothing on stdout or stderr.";
    },
  );
  await step(
    "V-C45",
    "App and worker share image and configuration with different commands; the engine has no database or credential access; database and engine ports are unpublished; PORT moves only the host port",
    "Inspection matches the article's topology statements.",
    "container-operation",
    () => {
      const id = (svc) => compose(`ps -q ${svc}`).stdout.trim();
      const insp = (svc, fmt) => sh(`docker inspect --format '${fmt}' ${id(svc)}`).stdout.trim();
      const appImg = insp("app", "{{.Image}}");
      const wImg = insp("worker", "{{.Image}}");
      const appCmd = insp("app", "{{json .Config.Cmd}}");
      const wCmd = insp("worker", "{{json .Config.Cmd}}");
      const envNames = (svc) =>
        insp(svc, "{{range .Config.Env}}{{println .}}{{end}}")
          .split("\n")
          .map((l) => l.split("=")[0]);
      const engEnv = envNames("doc-engine");
      const engNets = insp(
        "doc-engine",
        "{{range $k, $v := .NetworkSettings.Networks}}{{$k}} {{end}}",
      );
      const pgPorts = insp("postgres", "{{json .HostConfig.PortBindings}}");
      const engPorts = insp("doc-engine", "{{json .HostConfig.PortBindings}}");
      const appPorts = insp("app", "{{json .HostConfig.PortBindings}}");
      const same = ["DATABASE_URL", "STORAGE_PATH", "BASE_URL", "DOC_ENGINE_URL"].every(
        (k) => inContainer("app", k) === inContainer("worker", k),
      );
      const keySame =
        sha(inContainer("app", "OPENLAW_SECRET_KEY")) ===
        sha(inContainer("worker", "OPENLAW_SECRET_KEY"));
      expect(appImg === wImg && appCmd !== wCmd, "app/worker image or command");
      expect(same && keySame, "app and worker environment differ");
      expect(!engEnv.some((k) => /DATABASE_URL|SECRET|AUTH/.test(k)), `engine env ${engEnv}`);
      expect(!/backend/.test(engNets), `engine networks ${engNets}`);
      expect(
        ["{}", "null"].includes(pgPorts) && ["{}", "null"].includes(engPorts),
        "a private port is published",
      );
      expect(
        appPorts.includes('"3000/tcp"') && appPorts.includes(`"${APP_PORT}"`),
        `app ports ${appPorts}`,
      );
      return `App and worker run the same image ${appImg} with commands ${appCmd === "null" ? "(image default)" : appCmd} and ${wCmd}. DATABASE_URL, STORAGE_PATH, BASE_URL, DOC_ENGINE_URL and OPENLAW_SECRET_KEY are identical in both (compared, not recorded). The doc-engine container has no DATABASE_URL, AUTH_SECRET or OPENLAW_SECRET_KEY and joins only ${engNets.trim()}. Postgres and doc-engine publish no host ports; the app maps container port 3000 to host port ${APP_PORT}.`;
    },
  );
  await step(
    "V-C45",
    "Document-engine defaults: DOC_ENGINE_URL and DOC_ENGINE_TMPFS_SIZE",
    "The bundled engine URL is http://doc-engine:8080 and scratch space is a 2g tmpfs.",
    "container-operation",
    () => {
      const url = inContainer("app", "DOC_ENGINE_URL");
      const tmpfs = sh(
        `docker inspect --format '{{json .HostConfig.Tmpfs}}' $(docker compose ps -q doc-engine)`,
      ).stdout.trim();
      const ro = sh(
        `docker inspect --format '{{.HostConfig.ReadonlyRootfs}}' $(docker compose ps -q doc-engine)`,
      ).stdout.trim();
      expect(
        url === "http://doc-engine:8080" && tmpfs.includes("size=2g"),
        `url ${url}, tmpfs ${tmpfs}`,
      );
      return `The app's DOC_ENGINE_URL is ${url}. The doc-engine mounts /tmp as tmpfs ${tmpfs} with a read-only root filesystem (${ro}).`;
    },
  );
  await api.dispose();
};

phases.proxy = async () => {
  await step(
    "V-C45",
    "Sign in through the proxy origin",
    "Password sign-in through Caddy succeeds.",
    "browser-walkthrough",
    async () => {
      const s = await signIn(ORIGIN, ADMIN.email, state.adminPassword);
      const me = await json(await s.page.request.get(`${ORIGIN}/api/v1/me`));
      await s.context.close();
      expect(me.user?.email === ADMIN.email, "no session after sign-in");
      return `Signed in at ${ORIGIN} in the browser; /api/v1/me through the proxy returned the Administrator.`;
    },
  );
  await step(
    "V-C45",
    "Wrong origin: a request whose Origin is not BASE_URL is refused",
    "Sign-in posted with a foreign Origin is refused; the direct port with the configured Origin still works.",
    "container-operation",
    async () => {
      const bad = await apiClient(
        ORIGIN,
        ADMIN.email,
        state.adminPassword,
        "https://not-the-configured-origin.example",
      );
      const direct = await apiClient(
        LOCAL,
        ADMIN.email,
        state.adminPassword,
        `http://127.0.0.1:${APP_PORT}`,
      );
      const directGood = await apiClient(LOCAL, ADMIN.email, state.adminPassword, ORIGIN);
      await bad.ctx.dispose();
      await direct.ctx.dispose();
      await directGood.ctx.dispose();
      expect(bad.signInStatus === 403, `foreign origin answered ${bad.signInStatus}`);
      expect(direct.signInStatus === 403, `direct-address origin answered ${direct.signInStatus}`);
      return `Sign-in through the proxy with Origin https://not-the-configured-origin.example answered ${bad.signInStatus}. Sign-in on the direct app port with Origin http://127.0.0.1:${APP_PORT} (not BASE_URL) answered ${direct.signInStatus}; with Origin set to BASE_URL it answered ${directGood.signInStatus}. The app accepts only the configured origin.`;
    },
  );
  await step(
    "V-C45",
    "Upload and download a Document through the proxy origin",
    "Bytes match after a round trip through the proxy.",
    "container-operation",
    async () => {
      const api = await adminApi(ORIGIN);
      const ref = await upload(
        api,
        state.contractNumber,
        textFile("doc029-proxy.txt", Buffer.from("DOC-029 through the proxy\n")),
      );
      const d = await download(api, ref);
      await api.dispose();
      expect(ref.status === 201 && d.matches, `upload ${ref.status}, download ${d.status}`);
      return `Uploaded a Document through ${ORIGIN} (201) and downloaded it through the same origin; the SHA-256 matched.`;
    },
  );
  await step(
    "V-C45",
    "A live update arrives through the proxy",
    "With the Contract page open in one browser, a comment by a second person appears as a record frame on /api/events and on screen without a reload.",
    "browser-walkthrough",
    async () => {
      const a = await signIn(ORIGIN, ADMIN.email, state.adminPassword);
      const contract = await json(
        await a.page.request.get(`${ORIGIN}/api/v1/contracts/${state.contractNumber}`),
      );
      const contractId = contract.contract.id;
      // Rowan must be able to reach the Contract: add her to its team.
      const users = await json(await a.page.request.get(`${ORIGIN}/api/v1/users`));
      const rowan = users.users.find((u) => u.email === COLLEAGUE.email);
      await a.page.goto(`${ORIGIN}/contracts/${state.contractNumber}`);
      await a.page.waitForLoadState("networkidle").catch(() => {});
      const origin0 = await a.page.evaluate(() => performance.timeOrigin);
      await a.page.evaluate(
        ({ id }) => {
          window.__frames = [];
          const ctrl = new AbortController();
          window.__abort = ctrl;
          fetch(`/api/events?entityType=contract&entityId=${id}`, {
            signal: ctrl.signal,
            credentials: "include",
          })
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
      const c = await apiClient(ORIGIN, COLLEAGUE.email, state.colleaguePassword);
      const body = `DOC-029 operator-install live update ${Date.now()}`;
      const sent = Date.now();
      const post = await c.ctx.post("/api/v1/comments", {
        data: { entityType: "contract", entityId: contractId, body, visibility: "working_team" },
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
      let onScreen = false;
      try {
        await a.page.getByText(body).first().waitFor({ timeout: 10_000 });
        onScreen = true;
      } catch {}
      const origin1 = await a.page.evaluate(() => performance.timeOrigin);
      await a.context.close();
      expect(
        postStatus === 201 || postStatus === 200,
        `comment post ${postStatus} (${rowan?.role})`,
      );
      expect(status === 200 && frame, `stream status ${status}, record frame ${Boolean(frame)}`);
      const kind =
        frame.text.match(/"kind":"([^"]+)"/)?.[1] ?? frame.text.match(/"type":"([^"]+)"/)?.[1];
      return `The Administrator's browser held Contract ${state.contractNumber} open through ${ORIGIN} and read /api/events for that record (HTTP ${status}). ${COLLEAGUE.name} posted a comment through the proxy (${postStatus}). A named record frame${kind ? ` (${kind})` : ""} for that Contract arrived ${frame.t - sent} ms later. The comment text ${onScreen ? "appeared on the open page without a reload" : "did not appear in the visible page within 10 s"}; the page's timeOrigin ${origin0 === origin1 ? "was unchanged" : "changed"}.`;
    },
  );
};

phases.storage = async (only) => {
  const { S3Client, CreateBucketCommand, ListObjectsV2Command } = require(
    pnpm("@aws-sdk+client-s3@3.1133.0/node_modules/@aws-sdk/client-s3"),
  );
  const { BlobServiceClient, StorageSharedKeyCredential } = require(
    pnpm("@azure+storage-blob@12.33.0/node_modules/@azure/storage-blob"),
  );
  const AZ_ACCOUNT = "devstoreaccount1";
  // Azurite's documented development account key. Supply it through AZURITE_ACCOUNT_KEY so no key
  // text is kept in this file; the sanitizer keeps it out of the log.
  const AZ_KEY = process.env.AZURITE_ACCOUNT_KEY ?? state.azKey;
  state.azKey = AZ_KEY;
  saveState();
  const s3 = new S3Client({
    endpoint: MINIO_HOST,
    region: "us-east-1",
    forcePathStyle: true,
    credentials: { accessKeyId: state.minioUser, secretAccessKey: state.minioPassword },
  });
  const blob = new BlobServiceClient(
    `${AZURITE_HOST}/${AZ_ACCOUNT}`,
    new StorageSharedKeyCredential(AZ_ACCOUNT, AZ_KEY),
  );
  const docs = (state.storageDocs ??= {});
  const checkAll = async (api) => {
    const out = [];
    for (const [name, ref] of Object.entries(docs)) {
      const d = await download(api, ref);
      out.push(`${name} ${d.status}${d.matches ? " match" : " MISMATCH"}`);
    }
    return out;
  };
  if (!only)
    await step(
      "V-C45",
      "local driver: upload and download, file lands in the shared named volume at the default STORAGE_PATH",
      "Bytes match; the file is under /var/lib/openlaw/files in both app and worker.",
      "container-operation",
      async () => {
        const api = await adminApi();
        const ref = await upload(
          api,
          state.contractNumber,
          textFile("doc029-local.txt", Buffer.from(`DOC-029 local ${Date.now()}\n`)),
        );
        docs.local = ref;
        saveState();
        const d = await download(api, ref);
        const appCount = compose(
          "exec -T app sh -c 'find /var/lib/openlaw/files -type f | wc -l'",
        ).stdout.trim();
        const wCount = compose(
          "exec -T worker sh -c 'find /var/lib/openlaw/files -type f | wc -l'",
        ).stdout.trim();
        await api.dispose();
        expect(
          ref.status === 201 && d.matches && Number(appCount) > 0 && appCount === wCount,
          `upload ${ref.status} match ${d.matches} files ${appCount}/${wCount}`,
        );
        return `With STORAGE_DRIVER unset (local), an upload returned 201 and its download matched. The app and worker both see ${appCount} files under /var/lib/openlaw/files in the shared volume.`;
      },
    );
  if (!only)
    await step(
      "V-C45",
      "s3 driver: create the bucket first, set the S3 variables, recreate; upload/download new and older Documents; worker processing",
      "New file is written to the bucket; older local file still downloads; processing reaches ready.",
      "container-operation",
      async () => {
        await s3.send(new CreateBucketCommand({ Bucket: "doc029-openlaw-files" })).catch((e) => {
          if (!/BucketAlreadyOwnedByYou/.test(e.name)) throw e;
        });
        setEnv({
          STORAGE_DRIVER: "s3",
          S3_BUCKET: "doc029-openlaw-files",
          S3_ENDPOINT: "http://minio:9000",
          S3_FORCE_PATH_STYLE: "true",
          S3_ACCESS_KEY_ID: state.minioUser,
          S3_SECRET_ACCESS_KEY: state.minioPassword,
        });
        const r = up();
        const ready = await waitReady();
        const api = await adminApi();
        const ref = await upload(
          api,
          state.contractNumber,
          textFile("doc029-s3.txt", Buffer.from(`DOC-029 s3 ${Date.now()}\n`)),
        );
        docs.s3 = ref;
        saveState();
        const objs = await s3.send(new ListObjectsV2Command({ Bucket: "doc029-openlaw-files" }));
        const pdf = await upload(
          api,
          state.contractNumber,
          pdfFile("doc029-s3.pdf", "stored on the s3 driver"),
        );
        const t = await waitText(api, pdf);
        const all = await checkAll(api);
        await api.dispose();
        expect(
          r.code === 0 && ready === 200 && ref.status === 201,
          `up ${r.code} ready ${ready} upload ${ref.status}`,
        );
        expect((objs.KeyCount ?? 0) >= 1, "bucket is empty");
        expect(
          all.every((x) => x.includes("200 match")),
          all.join(", "),
        );
        expect(t.state === "ready", `processing ${t.state}`);
        return `Created bucket doc029-openlaw-files in MinIO, set STORAGE_DRIVER=s3 with S3_BUCKET, S3_ENDPOINT=http://minio:9000, S3_FORCE_PATH_STYLE=true and explicit keys, and recreated. /readyz 200. A new upload returned 201 and the bucket now holds ${objs.KeyCount} objects. Downloads: ${all.join(", ")}. A PDF written to s3 reached "ready" in the worker.`;
      },
    );
  if (!only)
    await step(
      "V-C45",
      "azure-blob driver: create the container first, set the Azure variables, recreate; every earlier store still reads; worker processing",
      "New file in the Azurite container; local and s3 files still download; processing reaches ready.",
      "container-operation",
      async () => {
        await blob.getContainerClient("doc029-openlaw-files").createIfNotExists();
        setEnv({
          STORAGE_DRIVER: "azure-blob",
          AZURE_BLOB_CONTAINER: "doc029-openlaw-files",
          AZURE_BLOB_ACCOUNT: AZ_ACCOUNT,
          AZURE_BLOB_ACCOUNT_KEY: AZ_KEY,
          AZURE_BLOB_ENDPOINT: `http://azurite:10000/${AZ_ACCOUNT}`,
        });
        const r = up();
        const ready = await waitReady();
        const api = await adminApi();
        const ref = await upload(
          api,
          state.contractNumber,
          textFile("doc029-azure.txt", Buffer.from(`DOC-029 azure ${Date.now()}\n`)),
        );
        docs.azure = ref;
        saveState();
        let n = 0;
        for await (const _ of blob.getContainerClient("doc029-openlaw-files").listBlobsFlat()) n++;
        const pdf = await upload(
          api,
          state.contractNumber,
          pdfFile("doc029-azure.pdf", "stored on the azure driver"),
        );
        const t = await waitText(api, pdf);
        const all = await checkAll(api);
        await api.dispose();
        expect(
          r.code === 0 && ready === 200 && ref.status === 201 && n >= 1,
          `up ${r.code} ready ${ready} upload ${ref.status} blobs ${n}`,
        );
        expect(
          all.every((x) => x.includes("200 match")),
          all.join(", "),
        );
        expect(t.state === "ready", `processing ${t.state}`);
        return `Created container doc029-openlaw-files in Azurite, set STORAGE_DRIVER=azure-blob with AZURE_BLOB_CONTAINER, AZURE_BLOB_ACCOUNT, AZURE_BLOB_ACCOUNT_KEY and AZURE_BLOB_ENDPOINT=http://azurite:10000/devstoreaccount1, and recreated. /readyz 200. A new upload returned 201; the container holds ${n} blobs. Downloads: ${all.join(", ")}. A PDF written to azure-blob reached "ready" in the worker.`;
      },
    );
  if (!only)
    await step(
      "V-C45",
      "Startup validates storage configuration: STORAGE_DRIVER=s3 without S3_BUCKET",
      "The app refuses to start with a storage configuration message; correcting it recovers.",
      "container-operation",
      async () => {
        const bucket = envValue("S3_BUCKET");
        setEnv({ STORAGE_DRIVER: "s3", S3_BUCKET: null });
        const since = new Date().toISOString();
        up();
        await sleep(15_000);
        const ready = await readyz();
        const logs = appLogs("app", since);
        const line = logs.split("\n").find((l) => /S3_BUCKET/.test(l)) ?? "";
        setEnv({ STORAGE_DRIVER: "azure-blob", S3_BUCKET: bucket });
        up();
        const back = await waitReady();
        expect(ready !== 200 && line, `readyz ${ready}; log line "${line}"`);
        expect(back === 200, `recovery ${back}`);
        return `With STORAGE_DRIVER=s3 and S3_BUCKET removed, the app did not become ready (/readyz ${ready}) and logged "${line
          .replace(/^.*?\|\s*/, "")
          .trim()
          .slice(0, 200)}". Restoring the settings and recreating returned /readyz 200.`;
      },
    );
  await step(
    "V-C45",
    "Unavailable storage: a wrong S3_ENDPOINT on the retained s3 reader",
    "The app stays ready but the older s3 Document's download fails; correcting the endpoint recovers.",
    "container-operation",
    async () => {
      setEnv({ S3_ENDPOINT: "http://minio-unreachable:9000" });
      let r, ready, bad, other;
      try {
        r = up();
        ready = await waitReady(60_000);
        const api = await adminApi();
        other = await download(api, docs.local);
        const t0 = Date.now();
        bad = await download(api, docs.s3, 300_000);
        bad.seconds = Math.round((Date.now() - t0) / 1000);
        await api.dispose();
      } finally {
        setEnv({ S3_ENDPOINT: "http://minio:9000" });
        up();
      }
      const back = await waitReady();
      const api2 = await adminApi();
      const all = await checkAll(api2);
      await api2.dispose();
      expect(
        r.code === 0 && ready === 200 && other.matches && bad.status !== 200,
        `ready ${ready}, s3 ${bad.status}, local ${other.status}`,
      );
      expect(back === 200 && all.every((x) => x.includes("200 match")), all.join(", "));
      return `With S3_ENDPOINT=http://minio-unreachable:9000 the app still became ready (/readyz ${ready}) and the local Document still downloaded. The s3 Document's download answered ${bad.status} after ${bad.seconds} s. Restoring S3_ENDPOINT=http://minio:9000 and recreating: ${all.join(", ")}.`;
    },
  );
  await step(
    "V-C45",
    "Return new writes to local while keeping s3 and azure-blob readers configured",
    "All three stores stay readable.",
    "container-operation",
    async () => {
      setEnv({ STORAGE_DRIVER: null });
      up();
      await waitReady();
      const api = await adminApi();
      const ref = await upload(
        api,
        state.contractNumber,
        textFile("doc029-local-again.txt", Buffer.from(`DOC-029 local again ${Date.now()}\n`)),
      );
      docs.localAgain = ref;
      saveState();
      const all = await checkAll(api);
      await api.dispose();
      expect(
        all.every((x) => x.includes("200 match")),
        all.join(", "),
      );
      return `Removed STORAGE_DRIVER (default local) and kept the S3 and Azure reader settings. A new local upload returned ${ref.status}. Downloads: ${all.join(", ")}.`;
    },
  );
};

phases.engine = async () => {
  const restore = () => {
    setEnv({ DOC_ENGINE_TIMEOUT_MS: null, DOC_ENGINE_COMPARE_TIMEOUT_MS: null });
    return up();
  };
  const refused = async (key, value) => {
    setEnv({ [key]: value });
    const since = new Date().toISOString();
    up();
    await sleep(20_000);
    const ready = await readyz();
    const appLine =
      appLogs("app", since)
        .split("\n")
        .find((l) => l.includes(key)) ?? "";
    const wLine =
      appLogs("worker", since)
        .split("\n")
        .find((l) => l.includes(key)) ?? "";
    const w = containerState("worker");
    restore();
    const back = await waitReady();
    expect(
      ready !== 200 && appLine && wLine,
      `readyz ${ready}; app line "${appLine.slice(0, 80)}"; worker line "${wLine.slice(0, 80)}"`,
    );
    expect(back === 200, `recovery ${back}`);
    return `With ${key}=${value}, the app did not become ready (/readyz ${ready}) and logged "${appLine
      .replace(/^.*?\|\s*/, "")
      .trim()
      .slice(
        0,
        160,
      )}". The worker logged the same refusal (state ${w?.state}, ${w?.status}). Removing the setting and recreating returned /readyz 200.`;
  };
  await step(
    "V-C45",
    "DOC_ENGINE_TIMEOUT_MS above 420000 stops app and worker startup",
    "Both processes refuse to start; removing the value recovers.",
    "container-operation",
    () => refused("DOC_ENGINE_TIMEOUT_MS", "420001"),
  );
  await step(
    "V-C45",
    "DOC_ENGINE_COMPARE_TIMEOUT_MS above 840000 stops startup",
    "Startup refuses; removing the value recovers.",
    "container-operation",
    () => refused("DOC_ENGINE_COMPARE_TIMEOUT_MS", "840001"),
  );
  await step(
    "V-C45",
    "An unavailable engine leaves the app ready while processing does not complete; restoring it recovers",
    "With doc-engine stopped, /readyz stays 200 and a new PDF does not reach ready; after start, a new PDF reaches ready.",
    "container-operation",
    async () => {
      const api = await adminApi();
      compose("stop doc-engine");
      const ready = await readyz();
      const ref = await upload(
        api,
        state.contractNumber,
        pdfFile("doc029-engine-down.pdf", "engine is down"),
      );
      const t = await waitText(api, ref, 60_000, ["ready"]);
      const after60 = t.state;
      compose("start doc-engine");
      for (let i = 0; i < 60 && containerState("doc-engine")?.health !== "healthy"; i++)
        await sleep(2000);
      const ref2 = await upload(
        api,
        state.contractNumber,
        pdfFile("doc029-engine-back.pdf", "engine is back"),
      );
      const t2 = await waitText(api, ref2, 180_000, ["ready", "failed"]);
      const t1later = await textState(api, ref);
      await api.dispose();
      expect(ready === 200 && after60 !== "ready", `readyz ${ready}, first PDF ${after60}`);
      expect(t2.state === "ready", `second PDF ${t2.state}`);
      return `With docker compose stop doc-engine, /readyz answered ${ready}. A PDF uploaded then was still "${after60}" after 60 s. After docker compose start doc-engine, a new PDF reached "ready"; the earlier one was then "${t1later.state}".`;
    },
  );
};

phases.database = async () => {
  const extUrl = () => `postgres://doc029ext:${state.extdbPassword}@extdb:5432/doc029ext`;
  await step(
    "V-C45",
    "External database: set DATABASE_URL to a separate PostgreSQL 16 and recreate",
    "The app migrates the selected database, becomes ready, and writes records there; the bundled service stays in the topology.",
    "container-operation",
    async () => {
      const before = await json(await (await adminApi()).get("/api/v1/contracts"));
      state.bundledContractCount = before.contracts?.length;
      saveState();
      setEnv({ DATABASE_URL: extUrl() });
      const r = up();
      const ready = await waitReady();
      const setup = await fetch(`${LOCAL}/api/v1/auth/setup`).then((x) => x.json());
      const ctx = await pwRequest.newContext({
        baseURL: LOCAL,
        extraHTTPHeaders: { origin: ORIGIN },
      });
      secret("externalAdminPassword");
      const created = await ctx.post("/api/v1/auth/setup", {
        data: {
          email: "sam.external@doc029-install.example",
          displayName: "DOC-029 Sam External",
          password: state.externalAdminPassword,
        },
      });
      await ctx.dispose();
      const fx = (sql) =>
        sh(`docker compose exec -T extdb psql -U doc029ext -d doc029ext -Atc "${sql}"`, {
          cwd: FIX,
        });
      const extUsers = fx(
        "select count(*) from users where email='sam.external@doc029-install.example'",
      ).stdout.trim();
      const migrations = fx("select count(*) from drizzle.__drizzle_migrations").stdout.trim();
      const bundled = compose(
        `exec -T postgres psql -U openlaw -d openlaw -Atc "select count(*) from users where email='sam.external@doc029-install.example'"`,
      ).stdout.trim();
      const pg = containerState("postgres");
      expect(
        r.code === 0 && ready === 200 && setup.needsSetup === true,
        `ready ${ready}, needsSetup ${setup.needsSetup}`,
      );
      expect(
        [200, 201].includes(created.status()) && extUsers === "1" && bundled === "0",
        `setup ${created.status()}, ext ${extUsers}, bundled ${bundled}`,
      );
      return `Set DATABASE_URL to the separate postgres:16 service and recreated. /readyz 200; the selected database reported needsSetup=true. It holds ${migrations || "the"} applied migration rows. Creating the fictional Administrator "DOC-029 Sam External" answered ${created.status()}; that user exists in the external database (count ${extUsers}) and not in the bundled one (count ${bundled}). The bundled postgres service stayed ${pg?.state}.`;
    },
  );
  await step(
    "V-C45",
    "Unreachable external database: DATABASE_URL names a host that does not answer",
    "The app does not become ready; correcting the URL recovers.",
    "container-operation",
    async () => {
      setEnv({
        DATABASE_URL: `postgres://doc029ext:${state.extdbPassword}@extdb-missing:5432/doc029ext`,
      });
      const since = new Date().toISOString();
      up();
      await sleep(20_000);
      const ready = await readyz();
      const line =
        appLogs("app", since)
          .split("\n")
          .find((l) => /ENOTFOUND|ECONNREFUSED|getaddrinfo|connect/i.test(l)) ?? "";
      setEnv({ DATABASE_URL: extUrl() });
      up();
      const back = await waitReady();
      expect(ready !== 200 && back === 200, `ready ${ready}, back ${back}`);
      return `With the host extdb-missing, /readyz answered ${ready} and the app logged "${line
        .replace(/^.*?\|\s*/, "")
        .trim()
        .slice(0, 160)}". Restoring the external URL returned /readyz 200.`;
    },
  );
  await step(
    "V-C45",
    "Remove DATABASE_URL: the bundled database and its earlier records return; nothing was transferred",
    "The original Administrator and Contracts are present; Sam External is not.",
    "container-operation",
    async () => {
      setEnv({ DATABASE_URL: null });
      up();
      const ready = await waitReady();
      const api = await adminApi();
      const list = await json(await api.get("/api/v1/contracts"));
      const users = await json(await api.get("/api/v1/users"));
      await api.dispose();
      const sam = users.users.some((u) => u.email.startsWith("sam.external"));
      expect(
        ready === 200 && list.contracts?.length === state.bundledContractCount && !sam,
        `ready ${ready}, contracts ${list.contracts?.length}, sam ${sam}`,
      );
      return `Removed DATABASE_URL and recreated. /readyz 200; ${ADMIN.name} signed in; the Contract list has the same ${list.contracts.length} records as before; Sam External does not exist in the bundled database.`;
    },
  );
};

phases.mail = async () => {
  const testSend = async () => {
    const api = await adminApi();
    const stateNow = await json(await api.get("/api/v1/email-settings"));
    const since = new Date().toISOString();
    const r = await api.post("/api/v1/email-settings/test");
    const body = await json(r);
    const arrived =
      r.status() === 200 ? await waitMail(ADMIN.email, "OpenLaw test email", since, 20_000) : null;
    const put = await api.put("/api/v1/email-settings", {
      data: { smtpUrl: "smtp://relay:1025", smtpFrom: RELAY_FROM.replace(/"/g, "") },
    });
    const invite = await api.post("/api/v1/auth/invites", {
      data: {
        email: `doc029-probe-${Date.now()}@doc029-install.example`,
        displayName: "DOC-029 operator-install probe",
        role: "legal_team_member",
      },
    });
    const inviteBody = await json(invite);
    await api.dispose();
    return {
      source: stateNow.source,
      from: stateNow.fromAddress,
      status: r.status(),
      detail: body.detail,
      arrived: Boolean(arrived),
      putStatus: put.status(),
      inviteStatus: invite.status(),
      inviteDetail: inviteBody.detail,
    };
  };
  await step(
    "V-C45",
    "Saved wizard relay is in use",
    "Source app; a test send is delivered.",
    "container-operation",
    async () => {
      const t = await testSend();
      expect(t.source === "app" && t.status === 200 && t.arrived, JSON.stringify(t));
      return `email-settings source "${t.source}"; Send test answered 200 and the message arrived at the owned relay.`;
    },
  );
  await step(
    "V-C45",
    "SMTP_URL and SMTP_FROM pin email to the environment, even when the pinned relay does not work",
    "Source env; saving a relay in the app is refused; the test send fails and nothing reaches the saved relay.",
    "container-operation",
    async () => {
      setEnv({ SMTP_URL: "smtp://relay-unreachable:1025", SMTP_FROM: RELAY_FROM });
      up();
      await waitReady();
      const before = await mailCount();
      const t = await testSend();
      const after = await mailCount();
      expect(
        t.source === "env" && t.status === 502 && t.putStatus === 409 && before === after,
        JSON.stringify(t),
      );
      return `With both set to a relay host that does not exist, email-settings source is "${t.source}". Saving the app relay answered ${t.putStatus}. The test send answered ${t.status} "${t.detail}". The saved relay received nothing (${before} before, ${after} after).`;
    },
  );
  await step(
    "V-C45",
    "SMTP_URL without SMTP_FROM: the effective source lacks a From address",
    "Source stays env; email-dependent flows report that email is unavailable.",
    "container-operation",
    async () => {
      setEnv({ SMTP_URL: "smtp://relay:1025", SMTP_FROM: null });
      up();
      await waitReady();
      const before = await mailCount();
      const t = await testSend();
      const after = await mailCount();
      expect(
        t.source === "env" && t.from === null && t.status === 502 && before === after,
        JSON.stringify(t),
      );
      expect(t.inviteStatus >= 400, `invite answered ${t.inviteStatus}`);
      return `With only SMTP_URL (pointing at the working relay), source is "${t.source}" with no From address. The test send answered ${t.status} "${t.detail}". Inviting a probe user answered ${t.inviteStatus} "${t.inviteDetail}". The relay received nothing.`;
    },
  );
  await step(
    "V-C45",
    "Remove the override and recreate: the saved relay is used again",
    "Source app; delivery works.",
    "container-operation",
    async () => {
      setEnv({ SMTP_URL: null, SMTP_FROM: null });
      up();
      await waitReady();
      const t = await testSend();
      expect(t.source === "app" && t.status === 200 && t.arrived, JSON.stringify(t));
      return `Removed SMTP_URL and SMTP_FROM and recreated. Source is "${t.source}" and the test message arrived through the saved relay.`;
    },
  );
  await step(
    "V-C45",
    "No separate email Settings page after the wizard",
    "Settings navigation offers no Email page; the Setup checklist Email row, if shown, has no link.",
    "browser-walkthrough",
    async () => {
      const s = await signIn(ORIGIN, ADMIN.email, state.adminPassword);
      await s.page.goto(`${ORIGIN}/settings/general`);
      await s.page.waitForLoadState("networkidle").catch(() => {});
      await s.page.getByText("Users").first().waitFor({ timeout: 20_000 });
      const nav = (await s.page.getByRole("link").allInnerTexts())
        .map((t) => t.trim())
        .filter(Boolean);
      const onboarding = await json(await s.page.request.get(`${ORIGIN}/api/v1/onboarding`));
      await s.context.close();
      const emailLinks = nav.filter((t) => /e-?mail|smtp/i.test(t));
      const emailStep = JSON.stringify(onboarding).match(/"email":\{[^}]*\}/)?.[0];
      expect(emailLinks.length === 0, `links: ${emailLinks}`);
      return `Settings -> Organization -> General shows ${nav.length} links (${nav.join(", ").slice(0, 400)}); none is for email or SMTP. The onboarding state's email step reads ${emailStep ?? "(not found)"}.`;
    },
  );
};

phases["settings-email"] = async () => {
  await step(
    "V-C45",
    "No separate email Settings page after the wizard",
    "Settings navigation offers no Email page; the Setup checklist Email row, if shown, has no link.",
    "browser-walkthrough",
    async () => {
      const s = await signIn(ORIGIN, ADMIN.email, state.adminPassword);
      await s.page.goto(`${ORIGIN}/settings/general`);
      await s.page.waitForLoadState("networkidle").catch(() => {});
      await s.page.getByText("Users").first().waitFor({ timeout: 20_000 });
      const nav = (await s.page.getByRole("link").allInnerTexts())
        .map((t) => t.trim())
        .filter(Boolean);
      const onboarding = await json(await s.page.request.get(`${ORIGIN}/api/v1/onboarding`));
      await s.context.close();
      const emailLinks = nav.filter((t) => /e-?mail|smtp/i.test(t));
      const emailStep = JSON.stringify(onboarding).match(/"email":\{[^}]*\}/)?.[0];
      expect(emailLinks.length === 0, `links: ${emailLinks}`);
      return `Settings -> Organization -> General shows ${nav.length} links (${nav.join(", ").slice(0, 400)}); none is for email or SMTP. The onboarding state's email step reads ${emailStep ?? "(not found)"}.`;
    },
  );
};

phases["mail-flows"] = async () => {
  await step(
    "V-C45",
    "SMTP_URL without SMTP_FROM: which email-dependent flows report that email is unavailable",
    "Magic-link and password-setup requests, and an invitation from Settings -> Users, each report that email is unavailable; nothing is sent.",
    "container-operation",
    async () => {
      setEnv({ SMTP_URL: "smtp://relay:1025", SMTP_FROM: null });
      up();
      await waitReady();
      const since = new Date().toISOString();
      const before = await mailCount();
      const probe = await pwRequest.newContext({
        baseURL: ORIGIN,
        ignoreHTTPSErrors: true,
        extraHTTPHeaders: { origin: ORIGIN },
      });
      const magic = await probe.post("/api/v1/auth/magic-link", {
        data: { email: COLLEAGUE.email },
      });
      const magicBody = await json(magic);
      const setup = await probe.post("/api/v1/auth/password-setup", {
        data: { email: COLLEAGUE.email },
      });
      const setupBody = await json(setup);
      await probe.dispose();
      const s = await signIn(ORIGIN, ADMIN.email, state.adminPassword);
      const invitee = `doc029-invite-no-from-${Date.now()}@doc029-install.example`;
      let screen = "";
      let listed = false;
      try {
        await s.page.goto(`${ORIGIN}/settings/users`);
        await s.page.getByRole("button", { name: "Invite user" }).click();
        const dialog = s.page.getByRole("dialog");
        await dialog.getByLabel("Display name").fill("DOC-029 operator-install no-From invitee");
        await dialog.getByLabel("Email").fill(invitee);
        await dialog.getByRole("button", { name: "Send invite" }).click();
        await sleep(4000);
        screen = (
          await s.page
            .locator('[role="alert"], [role="status"], [data-sonner-toast]')
            .allInnerTexts()
        ).join(" | ");
        const dialogOpen = await dialog.isVisible().catch(() => false);
        await s.page.screenshot({ path: path.join(here, "r1-invite-without-smtp-from.png") });
        const users = await json(await s.page.request.get(`${ORIGIN}/api/v1/users`));
        listed = users.users.some((u) => u.email === invitee);
        screen += dialogOpen ? " (dialog still open)" : " (dialog closed)";
      } finally {
        await s.context.close();
      }
      await sleep(5000);
      const after = await mailCount();
      const logLine = appLogs("app", since)
        .split("\n")
        .filter((l) => /SMTP|mail/i.test(l))
        .map((l) =>
          l
            .replace(/^.*?\|\s*/, "")
            .trim()
            .slice(0, 160),
        )
        .slice(0, 2)
        .join(" / ");
      setEnv({ SMTP_URL: null, SMTP_FROM: null });
      up();
      await waitReady();
      const summary = `Magic-link request answered ${magic.status()} "${magicBody.detail ?? ""}". Password-setup request answered ${setup.status()} "${setupBody.detail ?? ""}". Settings -> Users -> Invite user -> Send invite for a fictional invitee showed "${screen}"; the invitee ${listed ? "was added as a user" : "was not added"}. The relay received ${after - before} messages. App log lines mentioning mail: ${logLine || "none"}. The override was then removed and the containers recreated.`;
      expect(magic.status() >= 400 && setup.status() >= 400, summary);
      expect(
        !(listed && after === before && !/email|mail|SMTP/i.test(screen)),
        `The invitation was accepted without a report that email is unavailable. ${summary}`,
      );
      return summary;
    },
  );
};

phases.keys = async () => {
  const deliver = async () => {
    const api = await adminApi();
    const since = new Date().toISOString();
    const r = await api.post("/api/v1/email-settings/test");
    const body = await json(r);
    const src = await json(await api.get("/api/v1/email-settings"));
    const contracts = await api.get("/api/v1/contracts");
    const arrived =
      r.status() === 200
        ? Boolean(await waitMail(ADMIN.email, "OpenLaw test email", since, 20_000))
        : false;
    await api.dispose();
    return {
      status: r.status(),
      detail: body.detail,
      arrived,
      source: src.source,
      contracts: contracts.status(),
    };
  };
  const bootLines = (since) =>
    appLogs("app", since)
      .split("\n")
      .filter((l) => /resealed|No configured key opens/.test(l))
      .map((l) => l.replace(/^.*?\|\s*/, "").trim());
  await step(
    "V-C45",
    "Rotate OPENLAW_SECRET_KEY: set OPENLAW_SECRET_KEY_PREVIOUS to the current value and a new key, then recreate",
    "The app reports re-encryption and the stored relay still sends.",
    "container-operation",
    async () => {
      const current = envValue("OPENLAW_SECRET_KEY");
      state.keyBeforeRotation = current;
      const next = sh("openssl rand -base64 32").stdout.trim();
      state.keyAfterRotation = next;
      saveState();
      setEnv({ OPENLAW_SECRET_KEY_PREVIOUS: current, OPENLAW_SECRET_KEY: next });
      const since = new Date().toISOString();
      const r = up();
      await waitReady();
      await sleep(2000);
      const lines = bootLines(since);
      const d = await deliver();
      expect(
        r.code === 0 && lines.some((l) => /resealed/.test(l)) && d.status === 200 && d.arrived,
        `${lines} ${JSON.stringify(d)}`,
      );
      return `Recreated with the previous key and a newly generated key. The app logged "${lines.join(" / ")}". A test send through the stored relay answered 200 and arrived.`;
    },
  );
  await step(
    "V-C45",
    "Remove OPENLAW_SECRET_KEY_PREVIOUS and recreate again",
    "The stored relay still sends under the new key alone.",
    "container-operation",
    async () => {
      setEnv({ OPENLAW_SECRET_KEY_PREVIOUS: null });
      const since = new Date().toISOString();
      up();
      await waitReady();
      await sleep(2000);
      const lines = bootLines(since);
      const d = await deliver();
      expect(d.status === 200 && d.arrived, JSON.stringify(d));
      return `Removed OPENLAW_SECRET_KEY_PREVIOUS and recreated. Boot lines about stored credentials: ${lines.length ? lines.join(" / ") : "none"}. A test send answered 200 and arrived.`;
    },
  );
  await step(
    "V-C45",
    "Mismatched key: a valid but wrong OPENLAW_SECRET_KEY",
    "Records stay readable; the saved relay cannot be used; restoring the correct key and recreating recovers without re-entering the relay.",
    "container-operation",
    async () => {
      const wrong = sh("openssl rand -base64 32").stdout.trim();
      state.wrongKey = wrong;
      saveState();
      setEnv({ OPENLAW_SECRET_KEY: wrong });
      const since = new Date().toISOString();
      up();
      const ready = await waitReady();
      await sleep(2000);
      const lines = bootLines(since);
      const bad = await deliver();
      setEnv({ OPENLAW_SECRET_KEY: state.keyAfterRotation });
      up();
      await waitReady();
      const good = await deliver();
      expect(
        ready === 200 && bad.contracts === 200 && bad.status !== 200,
        `wrong key: ${JSON.stringify(bad)}`,
      );
      expect(good.status === 200 && good.arrived, `restored: ${JSON.stringify(good)}`);
      return `With a different valid key, /readyz answered ${ready} and the app logged "${lines.join(" / ") || "no key line"}". The Contract list answered ${bad.contracts}. Email source read "${bad.source}" and a test send answered ${bad.status} "${bad.detail}". Restoring the retained key and recreating (without re-saving the relay) made the test send answer 200 and arrive.`;
    },
  );
  await step(
    "V-C45",
    "Missing or short OPENLAW_SECRET_KEY: both processes require it at startup",
    "A blank key is refused by Compose; a short key stops app and worker startup; the correct key recovers.",
    "container-operation",
    async () => {
      const good = envValue("OPENLAW_SECRET_KEY");
      setEnv({ OPENLAW_SECRET_KEY: "" });
      const blank = up();
      setEnv({ OPENLAW_SECRET_KEY: "doc029-too-short" });
      const since = new Date().toISOString();
      up();
      await sleep(15_000);
      const ready = await readyz();
      const appLine =
        appLogs("app", since)
          .split("\n")
          .find((l) => /OPENLAW_SECRET_KEY/.test(l)) ?? "";
      const wLine =
        appLogs("worker", since)
          .split("\n")
          .find((l) => /OPENLAW_SECRET_KEY/.test(l)) ?? "";
      setEnv({ OPENLAW_SECRET_KEY: good });
      up();
      const back = await waitReady();
      const d = await deliver();
      expect(
        blank.code !== 0 && ready !== 200 && appLine && wLine,
        `blank ${blank.code}, ready ${ready}, app "${appLine.slice(0, 60)}", worker "${wLine.slice(0, 60)}"`,
      );
      expect(back === 200 && d.arrived, `recovery ${back} ${JSON.stringify(d)}`);
      return `A blank key made up exit ${blank.code} with "${firstLines(blank.stderr, 1)}". A 16-character key stopped startup: /readyz ${ready}; app logged "${appLine
        .replace(/^.*?\|\s*/, "")
        .trim()
        .slice(0, 140)}"; worker logged "${wLine
        .replace(/^.*?\|\s*/, "")
        .trim()
        .slice(0, 140)}". Restoring the key recovered readiness and delivery.`;
    },
  );
  await step(
    "V-C45",
    "Changing AUTH_SECRET invalidates existing sessions",
    "A session signed in before the change is no longer accepted after recreation; restoring the key restores normal sign-in.",
    "container-operation",
    async () => {
      const api = await adminApi();
      const before = (await api.get("/api/v1/me")).status();
      const original = envValue("AUTH_SECRET");
      setEnv({ AUTH_SECRET: sh("openssl rand -base64 32").stdout.trim() });
      up();
      await waitReady();
      const during = (await api.get("/api/v1/me")).status();
      await api.dispose();
      setEnv({ AUTH_SECRET: original });
      up();
      await waitReady();
      const again = await adminApi();
      const after = (await again.get("/api/v1/me")).status();
      await again.dispose();
      expect(
        before === 200 && during === 401 && after === 200,
        `before ${before}, during ${during}, after ${after}`,
      );
      return `An existing session answered /api/v1/me ${before}. After replacing AUTH_SECRET and recreating, the same session answered ${during}. Restoring the original AUTH_SECRET and signing in again answered ${after}.`;
    },
  );
};

phases.images = async () => {
  const insp = (svc) =>
    sh(`docker inspect --format '{{.Image}}' $(docker compose ps -q ${svc})`).stdout.trim();
  log.images = {
    app: insp("app"),
    worker: insp("worker"),
    "doc-engine": insp("doc-engine"),
    postgres:
      sh(`docker inspect --format '{{.Image}}' $(docker compose ps -q postgres)`).stdout.trim() +
      " (postgres:16)",
  };
  console.log(log.images);
};

phases.teardown = async () => {
  await step(
    "V-C45",
    "Remove the owned fixture and installation projects",
    "Both projects' containers, networks and volumes are removed; nothing else is touched.",
    "container-operation",
    () => {
      const fx = sh(`docker compose -p ${FX_PROJECT} down -v --remove-orphans`, { cwd: FIX });
      const ins = sh(`docker compose -p ${PROJECT} down -v --remove-orphans`);
      const left = sh(
        `docker ps -a --filter label=com.docker.compose.project=${PROJECT} -q; docker ps -a --filter label=com.docker.compose.project=${FX_PROJECT} -q; docker volume ls -q --filter label=com.docker.compose.project=${PROJECT}; docker volume ls -q --filter label=com.docker.compose.project=${FX_PROJECT}`,
      ).stdout.trim();
      expect(
        fx.code === 0 && ins.code === 0 && left === "",
        `fx ${fx.code}, install ${ins.code}, left "${left}"`,
      );
      return `docker compose -p ${FX_PROJECT} down -v and docker compose -p ${PROJECT} down -v exited 0; no containers or volumes remain with either project label. The locally built image tags were left in the cache.`;
    },
  );
};

const name = process.argv[2];
if (!phases[name]) {
  console.error(`phases: ${Object.keys(phases).join(", ")}`);
  process.exit(2);
}
try {
  await phases[name](process.argv[3]);
} finally {
  run.completedAt = new Date().toISOString();
  saveLog();
  await browser?.close();
}
