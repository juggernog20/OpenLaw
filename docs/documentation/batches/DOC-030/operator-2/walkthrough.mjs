// DOC-030 independent operator walkthrough, group "operator-2".
// Articles: install (V-C44), upgrade (V-C46), backup-and-restore (V-C47),
// operator-troubleshooting (V-C48). Method: container-operation, role: operator.
//
// Written by the DOC-030 independent walkthrough agent (operator-2). Based on the DOC-029
// operator-install and operator-lifecycle scripts. Each guide is followed on disposable Compose
// projects named openlaw-doc030-op*, cloned from GitHub at the revisions the guides name and
// built by the guides' own commands. Private state lives in ~/.cache/openlaw-doc030/operator/op2.
//
// Run one phase at a time from the documentation worktree root:
//   node docs/documentation/batches/DOC-030/operator-2/walkthrough.mjs <phase> [argument]
import https from "node:https";
import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import {
  AI_NAME,
  Api,
  BASELINE,
  COMMIT,
  CPROXY_NAME,
  MAIL_NAME,
  MAIL_UI,
  OCCUPIER_NAME,
  PROJECTS,
  PROXY_NAME,
  REPO,
  ROUND,
  WORK,
  attach,
  attachSupport,
  bodyText,
  browserSignIn,
  check,
  closeBrowser,
  containerImage,
  envGet,
  envSet,
  failures,
  here,
  http,
  imageIds,
  inspectImage,
  lines,
  log,
  mailText,
  must,
  newSession,
  pdf,
  psAll,
  psql,
  recordImages,
  recreate,
  redact,
  root,
  saveLog,
  saveSecrets,
  saveState,
  secretValues,
  secrets,
  setPhase,
  sh,
  sha256,
  since,
  sleep,
  state,
  step,
  textState,
  toAddress,
  upCommand,
  waitMail,
  waitReady,
  waitText,
} from "./op-lib.mjs";

const phases = {};
const I = PROJECTS.inst;
const PROXY_HOST = "openlaw-doc030.localhost";
const PROXY_PORT = ROUND === 2 ? 24641 : 24611;
const ORIGIN = `https://${PROXY_HOST}:${PROXY_PORT}`;
const OCCUPIED_PORT = ROUND === 2 ? 24643 : 24613;
const ALT_PORT = ROUND === 2 ? 24644 : 24614;
const CPROXY_PORT = ROUND === 2 ? 24645 : 24615;

const INSTALL = { article: "install", scenario: "V-C44" };
const UPGRADE = { article: "upgrade", scenario: "V-C46" };
const BACKUP = { article: "backup-and-restore", scenario: "V-C47" };
const DIAG = { article: "operator-troubleshooting", scenario: "V-C48" };

function password(key) {
  secrets.passwords ??= {};
  secrets.passwords[key] ??= randomBytes(14).toString("base64url");
  saveSecrets();
  return secrets.passwords[key];
}
function guideFailure(article, stepName, expected, observed) {
  log.guideFailures.push({
    article,
    step: stepName,
    expected,
    observed,
    at: new Date().toISOString(),
  });
  saveLog();
}
function productBug(summary, reproduction, contradicts) {
  log.productBugs.push({ summary, reproduction, contradicts, at: new Date().toISOString() });
  saveLog();
}

// ---------------------------------------------------------------- support

const AI_SERVER = `
import http from "node:http";
import { existsSync } from "node:fs";
let calls = 0;
http.createServer((req, res) => {
  let body = "";
  req.on("data", (c) => (body += c));
  req.on("end", () => {
    calls += 1;
    const auth = req.headers.authorization ?? "";
    const ok = auth === "Bearer " + process.env.EXPECTED_KEY && !existsSync("/tmp/refuse");
    console.log(JSON.stringify({ at: new Date().toISOString(), method: req.method, url: req.url, keyMatches: ok, calls }));
    res.setHeader("content-type", "application/json");
    if (req.url.endsWith("/models")) {
      res.end(JSON.stringify({ data: [{ id: "doc030-standin" }] }));
      return;
    }
    if (!ok) {
      res.statusCode = 401;
      res.end(JSON.stringify({ error: { message: "Incorrect API key provided: " + auth.slice(7, 15) + "****. You can find your API key in the stand-in.", type: "invalid_request_error" } }));
      return;
    }
    res.end(JSON.stringify({ id: "doc030", object: "chat.completion", choices: [{ index: 0, finish_reason: "stop", message: { role: "assistant", content: "{\\"ok\\":true}" } }] }));
  });
}).listen(8080);
`;

phases["support-up"] = async () => {
  await step(
    {
      scenario: "setup",
      action:
        "Start owned support containers: Mailpit relay, AI provider stand-in, and an unrelated listener",
    },
    () => {
      const out = [];
      if (sh(`docker inspect ${MAIL_NAME}`, root).code !== 0)
        must(
          `docker run -d --name ${MAIL_NAME} --label openlaw-doc030-owner=operator-2 -p 127.0.0.1:24601:8025 axllent/mailpit:v1.30 --smtp-auth-accept-any --smtp-auth-allow-insecure`,
          root,
        );
      out.push(
        `${MAIL_NAME}: Mailpit v1.30, UI 127.0.0.1:24601, joins each project's backend network as op2-mail`,
      );
      secrets.ai ??= { key: `sk-doc030-${randomBytes(18).toString("base64url")}` };
      saveSecrets();
      const aiDir = path.join(WORK, "ai");
      mkdirSync(aiDir, { recursive: true, mode: 0o700 });
      writeFileSync(path.join(aiDir, "server.mjs"), AI_SERVER, { mode: 0o644 });
      if (sh(`docker inspect ${AI_NAME}`, root).code !== 0)
        must(
          `docker run -d --name ${AI_NAME} --label openlaw-doc030-owner=operator-2 -e EXPECTED_KEY=${secrets.ai.key} -v ${aiDir}/server.mjs:/srv/server.mjs:ro node:24-slim node /srv/server.mjs`,
          root,
        );
      out.push(
        `${AI_NAME}: OpenAI-compatible stand-in (not a live provider) that answers 200 only for the expected key, joins backend networks as op2-ai`,
      );
      if (sh(`docker inspect ${OCCUPIER_NAME}`, root).code !== 0)
        must(
          `docker run -d --name ${OCCUPIER_NAME} --label openlaw-doc030-owner=operator-2 -p 127.0.0.1:${OCCUPIED_PORT}:80 caddy:2-alpine caddy respond --listen :80 "DOC-030 unrelated listener"`,
          root,
        );
      out.push(`${OCCUPIER_NAME}: unrelated listener on 127.0.0.1:${OCCUPIED_PORT}`);
      return out.join("; ");
    },
  );
};

// ---------------------------------------------------------------- install (V-C44)

phases["inst-prereq"] = async () => {
  state.installStartedAt ??= new Date().toISOString();
  saveState();
  await step(
    {
      ...INSTALL,
      action:
        "Before you start: check Git, OpenSSL, docker version, docker compose version and docker context show",
      command:
        "git --version; openssl version; docker version; docker compose version; docker context show",
      critical: true,
    },
    () => {
      const git = must("git --version", root).stdout.trim();
      const ssl = must("openssl version", root).stdout.trim();
      const server = must("docker version --format '{{.Server.Version}}'", root).stdout.trim();
      const compose = must("docker compose version", root).stdout.trim();
      const ctx = must("docker context show", root).stdout.trim();
      const host = must(
        "docker context inspect --format '{{.Endpoints.docker.Host}}' $(docker context show)",
        root,
      ).stdout.trim();
      const df = must(`df -h --output=avail ${WORK} | tail -1`, root).stdout.trim();
      return `${git}; ${ssl}; Docker Engine ${server}; ${compose}; docker context show: ${ctx} (${host}); free space for the installation directory ${df}`;
    },
  );
};

phases["inst-source"] = async () => {
  const p = I;
  await step(
    {
      ...INSTALL,
      action: "Prepare step 1: clone into a new directory and select the documented revision",
      command: `git clone ${REPO} openlaw; cd openlaw; git checkout --detach ${COMMIT}`,
      critical: true,
    },
    () => {
      mkdirSync(p.home, { recursive: true, mode: 0o700 });
      const clone = existsSync(p.dir)
        ? null
        : must(`git clone ${REPO} openlaw`, p.home, { timeout: 900_000 });
      must(`git checkout --detach ${COMMIT}`, p.dir);
      const head = must("git rev-parse HEAD", p.dir).stdout.trim();
      check(head === COMMIT, `HEAD ${head}`);
      return `git clone exit 0${clone ? ` in ${Math.round(clone.ms / 1000)} s` : " (already present)"}; git checkout --detach exit 0; HEAD ${head}`;
    },
  );
  const envCommand = [
    "(",
    "  umask 077",
    "  set -C",
    "  cat .env.example > .env || exit 1",
    "  chmod 600 .env",
    '  sed -i "s|^AUTH_SECRET=$|AUTH_SECRET=$(openssl rand -base64 32)|" .env',
    '  sed -i "s|^OPENLAW_SECRET_KEY=$|OPENLAW_SECRET_KEY=$(openssl rand -base64 32)|" .env',
    ")",
  ].join("\n");
  await step(
    {
      ...INSTALL,
      action:
        "Prepare step 2: copy .env.example to .env with the grouped commands; a second run refuses to overwrite",
      command: envCommand,
      expected:
        "The grouped commands refuse to overwrite an existing .env and stop before changing its keys.",
      critical: true,
    },
    () => {
      const first = existsSync(`${p.dir}/.env`) ? null : must(envCommand, p.dir);
      const mode = must("stat -c %a .env", p.dir).stdout.trim();
      const a = envGet(p, "AUTH_SECRET");
      const k = envGet(p, "OPENLAW_SECRET_KEY");
      const hash1 = sha256(readFileSync(`${p.dir}/.env`));
      const second = sh(envCommand, p.dir);
      const hash2 = sha256(readFileSync(`${p.dir}/.env`));
      check(
        mode === "600" && a?.length === 44 && k?.length === 44,
        `mode ${mode}, key lengths ${a?.length} ${k?.length}`,
      );
      check(
        second.code !== 0 && hash1 === hash2,
        `second run exit ${second.code}, unchanged ${hash1 === hash2}`,
      );
      return `first run exit ${first ? first.code : "(earlier run)"}; .env mode ${mode}; AUTH_SECRET and OPENLAW_SECRET_KEY filled with 44-character base64 values; second run exit ${second.code} with "${lines(second.stderr, /.env/, 1).join("")}"; .env hash unchanged`;
    },
  );
  await step(
    {
      ...INSTALL,
      action:
        "Prepare step 3: edit .env with origin, port, project name, proxy address (each setting once)",
      command:
        "COMPOSE_PROJECT_NAME, COMPOSE_FILE=compose.yml:compose.operator.yml, OPENLAW_BUILD_COMMIT, OPENLAW_BUILD_DIRTY=false, BASE_URL, PORT, TRUSTED_PROXIES=127.0.0.1,::1",
      critical: true,
    },
    () => {
      const example = readFileSync(`${p.dir}/.env.example`, "utf8");
      for (const [key, value] of [
        ["COMPOSE_PROJECT_NAME", p.project],
        ["COMPOSE_FILE", "compose.yml:compose.operator.yml"],
        ["OPENLAW_BUILD_COMMIT", COMMIT],
        ["OPENLAW_BUILD_DIRTY", "false"],
        ["BASE_URL", ORIGIN],
        ["PORT", String(p.port)],
        ...(ROUND === 2 ? [] : [["TRUSTED_PROXIES", "127.0.0.1,::1"]]),
      ])
        envSet(p, key, value);
      const keys = readFileSync(`${p.dir}/.env`, "utf8")
        .split("\n")
        .filter((l) => /^[A-Z_]+=/.test(l))
        .map((l) => l.split("=")[0]);
      const dup = keys.filter((k, i) => keys.indexOf(k) !== i);
      check(dup.length === 0, `duplicate keys ${dup}`);
      const commentedInExample = [
        "BASE_URL",
        "PORT",
        "TRUSTED_PROXIES",
        "SETUP_TOKEN",
        "COMPOSE_PROJECT_NAME",
      ].filter((k) => new RegExp(`^#\\s*${k}=`, "m").test(example));
      return `keys set once: ${keys.join(", ")}; SETUP_TOKEN left out so the app prints one; .env.example shows commented examples for ${commentedInExample.join(", ") || "none of these"}`;
    },
  );
  await step(
    {
      ...INSTALL,
      action: "Prepare step 4: create compose.operator.yml beside compose.yml",
      critical: true,
    },
    () => {
      writeFileSync(
        `${p.dir}/compose.operator.yml`,
        [
          "services:",
          "  app:",
          "    image: openlaw-local:${OPENLAW_BUILD_COMMIT:?Set the source revision}",
          "  worker:",
          "    image: openlaw-local:${OPENLAW_BUILD_COMMIT:?Set the source revision}",
          "  doc-engine:",
          "    image: openlaw-engine-local:${OPENLAW_BUILD_COMMIT:?Set the source revision}",
          "",
        ].join("\n"),
      );
      return `compose.operator.yml written (sha256 ${sha256(readFileSync(`${p.dir}/compose.operator.yml`)).slice(0, 16)})`;
    },
  );
  await step(
    {
      ...INSTALL,
      action: "Prepare step 5: save both generated keys in the secret store, apart from backups",
      critical: true,
    },
    () => {
      secrets.inst = {
        AUTH_SECRET: envGet(p, "AUTH_SECRET"),
        OPENLAW_SECRET_KEY: envGet(p, "OPENLAW_SECRET_KEY"),
      };
      saveSecrets();
      const shellOverrides = Object.keys(process.env).filter((k) =>
        /^(COMPOSE_|BASE_URL$|PORT$|APP_BIND$|DATABASE_URL$|AUTH_SECRET$|OPENLAW_SECRET_KEY$|SMTP_)/.test(
          k,
        ),
      );
      return `both keys copied to the private secret store (mode 600) outside the installation directory and outside any backup directory; exported shell deployment overrides: ${shellOverrides.length ? shellOverrides.join(", ") : "none"}`;
    },
  );
};

phases["inst-build"] = async () => {
  const p = I;
  await step(
    {
      ...INSTALL,
      action: "Build step 1: check Compose resolves the configuration without printing secrets",
      command: "docker compose config --quiet; docker compose config --services",
      expected: "The base installation has app, worker, postgres, and doc-engine.",
      critical: true,
    },
    () => {
      const q = must("docker compose config --quiet", p.dir);
      const s = must("docker compose config --services", p.dir).stdout.trim().split("\n").sort();
      check(q.stdout.trim() === "" && q.stderr.trim() === "", "config --quiet printed output");
      check(s.join(",") === "app,doc-engine,postgres,worker", `services ${s}`);
      return `config --quiet exit 0 with no output; config --services: ${s.join(", ")} (no mail catcher)`;
    },
  );
  await step(
    {
      ...INSTALL,
      action: "Build step 2: pull Postgres, build the two selected images, start, and list",
      command:
        "docker compose pull postgres; docker compose build app doc-engine; docker compose up -d --no-build --pull never; docker compose ps",
      critical: true,
    },
    () => {
      const pull = must("docker compose pull postgres", p.dir, { timeout: 600_000 });
      const build = must("docker compose build app doc-engine", p.dir, { timeout: 3_000_000 });
      const app = inspectImage(`openlaw-local:${COMMIT}`);
      const eng = inspectImage(`openlaw-engine-local:${COMMIT}`);
      const up = upCommand(p);
      check(up.code === 0, `up exit ${up.code}: ${up.stderr.slice(-600)}`);
      attachSupport(p);
      const ps = must("docker compose ps --format '{{.Service}} {{.State}}'", p.dir)
        .stdout.trim()
        .split("\n")
        .sort();
      state.instBuildS = Math.round(build.ms / 1000);
      log.images.install = {
        app: `openlaw-local:${COMMIT} ${app}`,
        engine: `openlaw-engine-local:${COMMIT} ${eng}`,
      };
      return `pull postgres exit 0 (${Math.round(pull.ms / 1000)} s); build app doc-engine exit 0 in ${Math.round(build.ms / 1000)} s; openlaw-local:${COMMIT} ${app}; openlaw-engine-local:${COMMIT} ${eng}; up exit 0; ps: ${ps.join("; ")}`;
    },
  );
  await step(
    {
      ...INSTALL,
      action:
        "Build step 3: curl --fail /readyz on the chosen port; worker running; document engine healthy",
      command: `curl --fail http://127.0.0.1:${p.port}/readyz`,
      critical: true,
    },
    async () => {
      await waitReady(p, 300_000);
      const c = sh(`curl --fail -sS http://127.0.0.1:${p.port}/readyz`, root);
      let eng;
      for (let i = 0; i < 60; i += 1) {
        eng = psAll(p).find((r) => r.service === "doc-engine");
        if (eng?.health === "healthy") break;
        await sleep(2000);
      }
      const worker = psAll(p).find((r) => r.service === "worker");
      check(c.code === 0, `curl exit ${c.code}`);
      check(
        worker?.state === "running" && eng?.health === "healthy",
        `worker ${worker?.state}, engine ${eng?.health}`,
      );
      state.instReadyAt = new Date().toISOString();
      const elapsed = Math.round(
        (Date.parse(state.instReadyAt) - Date.parse(state.installStartedAt)) / 1000,
      );
      state.instReadyElapsedS = elapsed;
      const images = recordImages("install", p);
      return `curl --fail exit 0, body ${c.stdout.trim().slice(0, 80)}; worker running; doc-engine healthy; app container image ${images.containers.app}, worker ${images.containers.worker}, engine ${images.containers["doc-engine"]}; elapsed from the first prerequisite command to readiness ${elapsed} s`;
    },
  );
  await step(
    {
      ...INSTALL,
      action: "The base Compose file publishes the app port only on 127.0.0.1",
      command: "docker compose port app 3000; LAN address probe",
      expected: "A proxy on the same host can reach the port and other hosts cannot.",
    },
    async () => {
      const port = must("docker compose port app 3000", p.dir).stdout.trim();
      const lanIp = must(
        "ip -4 -o addr show scope global | awk '{print $4}' | cut -d/ -f1 | head -1",
        root,
      ).stdout.trim();
      const lan = await http(`http://${lanIp}:${p.port}/readyz`, { timeoutMs: 4000 });
      check(port === `127.0.0.1:${p.port}` && lan.status === 0, `port ${port}, LAN ${lan.status}`);
      return `docker compose port app 3000 printed ${port}; http://<host LAN address>:${p.port}/readyz got no answer (${lan.text})`;
    },
  );
};

function caddyUp() {
  const dir = path.join(WORK, "caddy");
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  writeFileSync(
    path.join(dir, "Caddyfile"),
    `{
\tadmin off
\thttp_port ${ROUND === 2 ? 24642 : 24612}
\tauto_https disable_redirects
\tdefault_bind 127.0.0.1
\tskip_install_trust
}

${PROXY_HOST}:${PROXY_PORT} {
\ttls internal
\treverse_proxy 127.0.0.1:${I.port}
}
`,
    { mode: 0o644 },
  );
  if (sh(`docker inspect ${PROXY_NAME}`, root).code === 0) return "already running";
  must(
    `docker run -d --name ${PROXY_NAME} --label openlaw-doc030-owner=operator-2 --network host -v ${dir}/Caddyfile:/etc/caddy/Caddyfile:ro caddy:2-alpine`,
    root,
  );
  return "started";
}

/** A request to the proxy origin from a chosen loopback source address. */
function viaProxy(method, route, { json, localAddress = "127.0.0.1", headers = {} } = {}) {
  return new Promise((resolve) => {
    const body = json === undefined ? undefined : JSON.stringify(json);
    const req = https.request(
      {
        host: "127.0.0.1",
        port: PROXY_PORT,
        servername: PROXY_HOST,
        localAddress,
        rejectUnauthorized: false,
        method,
        path: route,
        headers: {
          host: `${PROXY_HOST}:${PROXY_PORT}`,
          origin: ORIGIN,
          ...(body
            ? { "content-type": "application/json", "content-length": Buffer.byteLength(body) }
            : {}),
          ...headers,
        },
      },
      (res) => {
        const chunks = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () =>
          resolve({ status: res.statusCode, text: Buffer.concat(chunks).toString("utf8") }),
        );
      },
    );
    req.on("error", (e) => resolve({ status: 0, text: e.message }));
    if (body) req.write(body);
    req.end();
  });
}

function setupTokenFromLogs(p) {
  const logs = must("docker compose logs --no-log-prefix app", p.dir).stdout.split("\n");
  const at = logs
    .map((l, i) =>
      l.includes("First-run setup is open. Paste this setup token into the setup screen:") ? i : -1,
    )
    .filter((i) => i >= 0);
  if (!at.length) return { token: null, count: 0, logs };
  const last = at[at.length - 1];
  const token = logs
    .slice(last + 1, last + 4)
    .map((l) => l.trim())
    .find((l) => /^[A-Za-z0-9_-]{20,}$/.test(l));
  return { token, count: at.length, logs };
}

phases["inst-token"] = async () => {
  const p = I;
  await step(
    {
      ...INSTALL,
      action: `Build step ${ROUND === 2 ? 5 : 4}: read the setup token from docker compose logs app`,
      command: "docker compose logs app",
      expected:
        'The app prints the token after "First-run setup is open. Paste this setup token into the setup screen:"',
      critical: true,
    },
    () => {
      const { token, count, logs } = setupTokenFromLogs(p);
      check(token, "no token after the documented line");
      secrets.instToken1 = token;
      saveSecrets();
      const warn = logs.some((l) => l.includes("TRUSTED_PROXIES is not set"));
      return `the documented line appears ${count} time(s); a ${token.length}-character token follows it (not recorded); "TRUSTED_PROXIES is not set" warning present: ${warn}`;
    },
  );
  await step(
    {
      ...INSTALL,
      action: "A restart replaces a printed token: restart the app and read the log again",
      command: "docker compose restart app; docker compose logs app",
    },
    async () => {
      must("docker compose restart app", p.dir, { timeout: 180_000 });
      await waitReady(p);
      await sleep(2000);
      const { token } = setupTokenFromLogs(p);
      check(token && token !== secrets.instToken1, "no new token after restart");
      secrets.instToken2 = token;
      saveSecrets();
      return "after docker compose restart app the log shows the documented line again with a different token";
    },
  );
  await step(
    {
      ...INSTALL,
      action: `Build step ${ROUND === 2 ? 6 : 5}: configure the reverse proxy on the same host (Caddy, internal TLS)`,
      critical: true,
    },
    async () => {
      const how = caddyUp();
      let r;
      for (let i = 0; i < 30; i += 1) {
        r = await viaProxy("GET", "/readyz");
        if (r.status === 200) break;
        await sleep(1000);
      }
      check(r.status === 200, `proxy readyz ${r.status} ${r.text.slice(0, 120)}`);
      return `caddy:2-alpine on the host network (${how}) serves ${ORIGIN} with an internal-CA certificate and reverse_proxy 127.0.0.1:${p.port}; /readyz through the proxy 200. The browser accepts the internal CA; public certificate issuance is not tested.`;
    },
  );
  const s = await newSession(ORIGIN);
  const { page } = s;
  try {
    await step(
      {
        ...INSTALL,
        role: "operator",
        action: `Build step ${ROUND === 2 ? 6 : 5}: open the intended HTTPS address and check it reaches Set up OpenLaw; an old token is refused`,
        expected:
          'Set up OpenLaw; a replaced token shows "The setup token is missing or wrong. Copy it from the server log, or from SETUP_TOKEN."',
        critical: true,
      },
      async () => {
        const r = await page.goto(ORIGIN);
        await page.getByRole("heading", { name: "Set up OpenLaw" }).waitFor({ timeout: 30_000 });
        await page.getByLabel("Setup token").fill(secrets.instToken1);
        await page.getByLabel("Name", { exact: true }).fill("Avery Morgan");
        await page.getByLabel("Email", { exact: true }).fill("avery.morgan@doc030-install.example");
        await page.getByLabel("Password", { exact: true }).fill(password("instAdmin"));
        await page.getByLabel("Confirm password", { exact: true }).fill(password("instAdmin"));
        await page.getByRole("button", { name: "Create Administrator" }).click();
        const msg =
          "The setup token is missing or wrong. Copy it from the server log, or from SETUP_TOKEN.";
        await page.getByText(msg).waitFor({ timeout: 15_000 });
        await page.screenshot({ path: path.join(here, "install-setup-old-token.png") });
        return `GET ${ORIGIN} ${r?.status()} shows heading "Set up OpenLaw" with Setup token, Name, Email, Password, Confirm password; the token printed before the restart shows "${msg}"`;
      },
    );
    await step(
      {
        ...INSTALL,
        action: `Build step ${ROUND === 2 ? 6 : 5}: create the initial account with the current setup token (first-run setup)`,
        expected: "A successful setup signs you in and opens Welcome to OpenLaw.",
        critical: true,
      },
      async () => {
        await page.getByLabel("Setup token").fill(secrets.instToken2);
        await page.getByRole("button", { name: "Create Administrator" }).click();
        await page
          .getByRole("heading", { name: "Welcome to OpenLaw" })
          .waitFor({ timeout: 30_000 });
        state.instSetupAt = new Date().toISOString();
        state.instSetupElapsedS = Math.round(
          (Date.parse(state.instSetupAt) - Date.parse(state.installStartedAt)) / 1000,
        );
        return `Create Administrator with the current token signed in Avery Morgan (fictional) and opened "Welcome to OpenLaw" at ${new URL(page.url()).pathname}; elapsed from the first prerequisite command to a usable first-run state ${state.instSetupElapsedS} s (build ${state.instBuildS} s with a warm Docker build cache)`;
      },
    );
    await step(
      {
        ...INSTALL,
        action:
          "Work through the welcome steps to Outbound email; save and test the relay; invite a colleague; Finish",
        expected:
          "Continue stays unavailable until email is configured; the test email and the invitation arrive; Finish enters the app.",
        critical: true,
      },
      async () => {
        await page.getByRole("button", { name: "Get started" }).click();
        await page.getByLabel("Organization name").fill("DOC-030 operator-2 Install Organization");
        await page.getByRole("button", { name: "Continue" }).click();
        for (const n of [3, 4]) {
          await page.getByText(`Step ${n} of 9`).waitFor({ timeout: 15_000 });
          await page.getByRole("button", { name: "Continue" }).click();
        }
        await page.getByText("Step 5 of 9").waitFor({ timeout: 15_000 });
        const disabled = await page.getByRole("button", { name: "Continue" }).isDisabled();
        const t0 = Date.now();
        await page.getByLabel("SMTP server").fill("op2-mail");
        await page.getByLabel("Port", { exact: true }).fill("1025");
        await page.getByLabel("Connection security").selectOption("none");
        await page.getByLabel("Authentication").selectOption("password");
        await page.getByLabel("SMTP username").fill("doc030-install");
        await page.getByLabel("SMTP password").fill(password("instRelay"));
        await page.getByLabel("Sender name (optional)").fill("DOC-030 install");
        await page.getByLabel("Sender email").fill("openlaw@doc030-install.example");
        await page.getByRole("button", { name: "Save relay" }).click();
        await page.getByRole("button", { name: "Send test email" }).click({ timeout: 15_000 });
        const test = await waitMail(
          (m) =>
            toAddress(m, "avery.morgan@doc030-install.example") &&
            m.Subject === "OpenLaw test email" &&
            since(m, t0),
        );
        check(test, "no test email");
        await page.getByRole("button", { name: "Continue" }).click();
        await page.getByText("Step 6 of 9").waitFor({ timeout: 15_000 });
        const t1 = Date.now();
        await page.getByLabel("Name", { exact: true }).fill("Rowan Operator");
        await page
          .getByLabel("Email", { exact: true })
          .fill("rowan.operator@doc030-install.example");
        await page.getByRole("button", { name: "Legal team member", exact: true }).click();
        await page.getByRole("button", { name: "Send invite" }).click();
        const invite = await waitMail(
          (m) => toAddress(m, "rowan.operator@doc030-install.example") && since(m, t1),
        );
        check(invite, "no invitation");
        state.instInviteId = invite.ID;
        await page.getByRole("button", { name: "Continue" }).click();
        await page.getByText("Step 7 of 9").waitFor({ timeout: 15_000 });
        await page.getByRole("button", { name: "Set up later" }).click();
        await page.getByText("Step 8 of 9").waitFor({ timeout: 15_000 });
        await page.getByRole("button", { name: "Set up later" }).click();
        await page.getByText("Step 9 of 9").waitFor({ timeout: 15_000 });
        await page.getByRole("button", { name: "Finish" }).click();
        await page.waitForURL((u) => !u.pathname.startsWith("/welcome"), { timeout: 30_000 });
        return `Continue on Outbound email (Step 5 of 9) disabled before a relay: ${disabled}; SMTP server op2-mail, Port 1025, Connection security None, Authentication Username and password, sender openlaw@doc030-install.example; Save relay then Send test email delivered "${test.Subject}"; Send invite delivered "${invite.Subject}" to the fictional colleague; E-signature and AI analysis set up later; Finish entered the app at ${new URL(page.url()).pathname}`;
      },
    );
  } finally {
    await s.context.close();
  }
};

phases["inst-checks"] = async () => {
  const p = I;
  await step(
    {
      ...INSTALL,
      action: "The app prints no token once a user exists",
      command: "docker compose restart app; docker compose logs app",
    },
    async () => {
      const t = new Date().toISOString();
      must("docker compose restart app", p.dir, { timeout: 180_000 });
      await waitReady(p);
      await sleep(2000);
      const logs = must(`docker compose logs --no-log-prefix --since ${t} app`, p.dir).stdout;
      check(!logs.includes("First-run setup is open"), "a token line appeared after a user exists");
      const setup = await viaProxy("GET", "/api/v1/auth/setup");
      return `after a restart the app log has no "First-run setup is open" line; GET /api/v1/auth/setup ${setup.status} ${setup.text.slice(0, 80)}`;
    },
  );
  const s = await browserSignIn(
    ORIGIN,
    "avery.morgan@doc030-install.example",
    password("instAdmin"),
  );
  const { page } = s;
  try {
    await step(
      {
        ...INSTALL,
        role: "operator",
        action: "Check the working installation: sign in through the intended origin",
        critical: true,
      },
      () => {
        check(s.role === "administrator", `role ${s.role} ${s.notes.join("; ")}`);
        return `password sign-in at ${ORIGIN}/auth/login as the Administrator; landed on ${s.landed}`;
      },
    );
    await step(
      {
        ...INSTALL,
        action:
          "Create a fictional Contract, upload a small supported Document, download it again, check its processing result",
        critical: true,
      },
      async () => {
        const created = await createContractInBrowser(
          page,
          ORIGIN,
          "DOC-030 operator-2 install check contract",
        );
        const body = pdf(["DOC-030 operator-2 install check.", "Processing check words."]);
        const up = await uploadInBrowser(
          page,
          ORIGIN,
          created.number,
          "doc030-install-check.pdf",
          body,
        );
        const got = await s.request(
          "GET",
          `/api/v1/documents/${up.documentId}/versions/${up.versionId}/download`,
        );
        const api = { raw: (m, r) => s.request(m, r) };
        const text = await waitText(api, up.documentId, up.versionId, 240_000);
        check(got.status === 200 && sha256(got.buffer) === sha256(body), `download ${got.status}`);
        check(
          text.state === "ready" && /Processing check words/.test(text.text),
          `text ${text.state}`,
        );
        state.instContract = created;
        state.instDoc = up;
        return `${created.how}; ${up.how}; download ${got.status} with the uploaded SHA-256 ${sha256(body).slice(0, 16)}; processing state ready with the uploaded words`;
      },
    );
  } finally {
    await s.context.close();
  }
  await step(
    {
      ...INSTALL,
      action: "Check the working installation: the test invitation's link is usable",
      critical: false,
    },
    async () => {
      const msg = await (
        await import("./op-lib.mjs")
      )
        .mailMessages()
        .then((all) => all.find((m) => m.ID === state.instInviteId));
      const link = (await mailText(msg.ID)).match(/https?:\/\/[^\s)>\]]+/)?.[0];
      check(link && new URL(link).origin === ORIGIN, `link origin ${link && new URL(link).origin}`);
      const c = await newSession(ORIGIN);
      try {
        await c.page.goto(link);
        await c.page.getByLabel("New password").fill(password("instColleague"));
        await c.page.getByLabel("Confirm password").fill(password("instColleague"));
        await c.page.getByRole("button", { name: "Set password" }).click();
        await c.page.getByText("Password set").first().waitFor({ timeout: 30_000 });
      } finally {
        await c.context.close();
      }
      const b = await browserSignIn(
        ORIGIN,
        "rowan.operator@doc030-install.example",
        password("instColleague"),
      );
      await b.context.close();
      check(b.role === "legal_team_member", `role ${b.role}`);
      return `the invitation link uses ${new URL(link).origin}; opening it and setting a password showed "Password set"; the colleague signed in through the origin as ${b.role}`;
    },
  );
  await step(
    {
      ...INSTALL,
      action: "Check the working installation: the worker processes new work after a restart",
      command: "docker compose restart worker",
    },
    async () => {
      must("docker compose restart worker", p.dir, { timeout: 180_000 });
      const s2 = await browserSignIn(
        ORIGIN,
        "avery.morgan@doc030-install.example",
        password("instAdmin"),
      );
      try {
        const body = pdf(["DOC-030 operator-2 after worker restart.", "Worker restart words."]);
        const up = await uploadInBrowser(
          s2.page,
          ORIGIN,
          state.instContract.number,
          "doc030-install-after-restart.pdf",
          body,
        );
        const text = await waitText(
          { raw: (m, r) => s2.request(m, r) },
          up.documentId,
          up.versionId,
          240_000,
        );
        check(
          text.state === "ready" && /Worker restart words/.test(text.text),
          `text ${text.state}`,
        );
        return `docker compose restart worker exit 0; a PDF uploaded in the browser afterwards reached ready with its words`;
      } finally {
        await s2.context.close();
      }
    },
  );
  await step(
    {
      ...INSTALL,
      action:
        "Record the source revision, resolved images, project name, origin and storage location",
    },
    () => {
      const rev = must("git rev-parse HEAD", p.dir).stdout.trim();
      const vol = must(
        `docker volume inspect ${p.project}_openlaw-files --format '{{.Name}} {{.Mountpoint}}'`,
        root,
      ).stdout.trim();
      const images = recordImages("install-final", p);
      return `source ${rev}; project ${p.project}; origin ${ORIGIN}; storage local driver at /var/lib/openlaw/files on volume ${vol.split(" ")[0]}; images app ${images.containers.app}, worker ${images.containers.worker}, engine ${images.containers["doc-engine"]}, postgres ${images.containers.postgres}`;
    },
  );
};

phases["inst-worker"] = async () => {
  const p = I;
  await step(
    {
      ...INSTALL,
      action: "Check the working installation: the worker processes new work after a restart",
      command: "docker compose restart worker",
    },
    async () => {
      must("docker compose restart worker", p.dir, { timeout: 180_000 });
      const s2 = await browserSignIn(
        ORIGIN,
        "avery.morgan@doc030-install.example",
        password("instAdmin"),
      );
      try {
        const n = Number(psql(p, "select max(number) from contracts"));
        const body = pdf(["DOC-030 operator-2 after worker restart.", "Worker restart words."]);
        const up = await uploadInBrowser(
          s2.page,
          ORIGIN,
          n,
          "doc030-install-after-restart.pdf",
          body,
        );
        const text = await waitText(
          { raw: (m, r) => s2.request(m, r) },
          up.documentId,
          up.versionId,
          240_000,
        );
        check(
          text.state === "ready" && /Worker restart words/.test(text.text),
          `text ${text.state}`,
        );
        return `docker compose restart worker exit 0; a PDF uploaded in the browser on Contract ${n} afterwards reached ready with its words`;
      } finally {
        await s2.context.close();
      }
    },
  );
};

phases["inst-trust"] = async () => {
  const p = I;
  const admin = "avery.morgan@doc030-install.example";
  async function probe(label) {
    await sleep(12_000);
    const wrong = [];
    for (let i = 0; i < 4; i += 1)
      wrong.push(
        (
          await viaProxy("POST", "/api/auth/sign-in/email", {
            json: { email: "nobody@doc030-install.example", password: "not-the-password" },
            localAddress: "127.0.0.2",
          })
        ).status,
      );
    const right = await viaProxy("POST", "/api/auth/sign-in/email", {
      json: { email: admin, password: password("instAdmin") },
      localAddress: "127.0.0.1",
    });
    const seen = lines(
      sh("docker compose logs --no-log-prefix --since 30s app", p.dir).stdout,
      /sign-in\/email/,
      8,
    )
      .map((l) => l.match(/"remoteAddress":"([^"]+)"/)?.[1])
      .filter(Boolean);
    return {
      label,
      wrongFrom127_0_0_2: wrong,
      rightFrom127_0_0_1: right.status,
      remoteAddressesTheAppLogged: [...new Set(seen)],
    };
  }
  await step(
    {
      ...INSTALL,
      action:
        "TRUSTED_PROXIES=127.0.0.1,::1 with a proxy on the same host gives each client its own sign-in bucket",
      expected:
        "Prepare step 3: TRUSTED_PROXIES names the reverse proxy's own address; 127.0.0.1,::1 fits a proxy on the same host; the app reads the client address from X-Forwarded-For only on requests from a listed address.",
    },
    async () => {
      const r = await probe("TRUSTED_PROXIES=127.0.0.1,::1 (guide value)");
      state.trustGuideValue = r;
      const shared = r.rightFrom127_0_0_1 === 429;
      if (shared)
        guideFailure(
          "install",
          "Prepare the source and configuration, step 3 (TRUSTED_PROXIES=127.0.0.1,::1 'fits a proxy on the same host')",
          "With a reverse proxy on the same host and TRUSTED_PROXIES=127.0.0.1,::1, the app reads each client's address from X-Forwarded-For, so one client's wrong passwords do not close sign-in for another client.",
          `The app sees the proxy's connections from the Docker bridge gateway (${r.remoteAddressesTheAppLogged.join(", ")}), not 127.0.0.1, because Docker forwards the published 127.0.0.1 port. With the guide's value, four wrong passwords from a client at 127.0.0.2 made the next correct sign-in from 127.0.0.1 answer 429. No 'TRUSTED_PROXIES is not set' warning appears, so nothing tells the operator.`,
        );
      check(!shared, `shared bucket: ${JSON.stringify(r)}`);
      return r;
    },
  );
  await step(
    {
      ...INSTALL,
      method: "container-operation",
      action:
        "Control: TRUSTED_PROXIES set to the backend network gateway address the app actually sees",
    },
    async () => {
      const gw = must(
        `docker network inspect ${p.project}_openlaw-backend --format '{{(index .IPAM.Config 0).Gateway}}'`,
        root,
      ).stdout.trim();
      envSet(p, "TRUSTED_PROXIES", gw);
      recreate(p, "app");
      await waitReady(p);
      const r = await probe(`TRUSTED_PROXIES=${gw} (control, not a guide value)`);
      envSet(p, "TRUSTED_PROXIES", "127.0.0.1,::1");
      recreate(p, "app");
      await waitReady(p);
      state.trustGateway = r;
      check(r.rightFrom127_0_0_1 === 200, JSON.stringify(r));
      return { ...r, restored: "TRUSTED_PROXIES=127.0.0.1,::1 again, app recreated, readyz 200" };
    },
  );
};

phases["inst-negatives"] = async () => {
  const p = I;
  await step(
    {
      ...INSTALL,
      action:
        "Negative: missing secret (blank AUTH_SECRET) is refused by Compose; the retained key recovers",
      expected: "Troubleshooting row: Compose refuses the command when either key is missing.",
    },
    async () => {
      const original = envGet(p, "AUTH_SECRET");
      const before = psAll(p)
        .map((r) => r.id)
        .sort()
        .join();
      envSet(p, "AUTH_SECRET", "");
      const q = sh("docker compose config --quiet", p.dir);
      const u = sh("docker compose up -d --no-build --pull never", p.dir);
      const after = psAll(p)
        .map((r) => r.id)
        .sort()
        .join();
      envSet(p, "AUTH_SECRET", original);
      const q2 = sh("docker compose config --quiet", p.dir);
      const ready = await waitReady(p)
        .then(() => 200)
        .catch(() => 0);
      check(
        q.code !== 0 && u.code !== 0 && before === after && q2.code === 0 && ready === 200,
        `config ${q.code} up ${u.code} unchanged ${before === after} config2 ${q2.code} ready ${ready}`,
      );
      return `config --quiet exit ${q.code}: "${lines(q.stderr, /AUTH_SECRET/, 1).join("")}"; up exit ${u.code}; containers unchanged; retained key restored: config --quiet exit 0, readyz 200`;
    },
  );
  await step(
    {
      ...INSTALL,
      action:
        "Negative: occupied port leads to the documented recovery (ps --all shows created; choose an unused port)",
      expected:
        "Troubleshooting row: after a failed bind, ps --all shows app and worker created, plain ps does not list them; the instance stays down until the port is corrected and the same up runs again.",
    },
    async () => {
      const holder = await http(`http://127.0.0.1:${OCCUPIED_PORT}/`);
      check(holder.status === 200, `occupier ${holder.status}`);
      envSet(p, "PORT", String(OCCUPIED_PORT));
      const u = sh("docker compose up -d --no-build --pull never", p.dir, { timeout: 300_000 });
      const all = psAll(p).map((r) => `${r.service} ${r.state}`);
      const plain = sh("docker compose ps --format '{{.Service}} {{.State}}'", p.dir)
        .stdout.trim()
        .split("\n")
        .filter(Boolean);
      const down = await http(`http://127.0.0.1:${p.port}/readyz`, { timeoutMs: 3000 });
      const other = await http(`http://127.0.0.1:${OCCUPIED_PORT}/`);
      const err = lines(u.stderr, /allocated|already in use|bind/i, 1).map((l) =>
        l.replace(/[0-9a-f]{12,}/g, "…"),
      );
      envSet(p, "PORT", String(p.port));
      const u2 = sh("docker compose up -d --no-build --pull never", p.dir, { timeout: 300_000 });
      const ready = await waitReady(p)
        .then(() => 200)
        .catch(() => 0);
      check(
        u.code !== 0 &&
          all.includes("app created") &&
          all.includes("worker created") &&
          !plain.some((l) => /^(app|worker) /.test(l)) &&
          down.status !== 200 &&
          other.status === 200 &&
          u2.code === 0 &&
          ready === 200,
        JSON.stringify({
          u: u.code,
          all,
          plain,
          down: down.status,
          other: other.status,
          u2: u2.code,
          ready,
        }),
      );
      return {
        upExit: u.code,
        error: err,
        psAll: all,
        plainPs: plain,
        readyzWhileFailed: down.status,
        unrelatedListener: other.status,
        recovery: `PORT=${p.port} restored; same up exit ${u2.code}; readyz ${ready}`,
      };
    },
  );
  await step(
    {
      ...INSTALL,
      action:
        "Negative: unavailable dependency (database stopped) fails readiness; restoring it recovers",
      expected:
        "Troubleshooting row: /healthz works but /readyz fails; restore connectivity, then verify a record read and write.",
    },
    async () => {
      must("docker compose stop postgres", p.dir);
      await sleep(4000);
      const h = await http(`${p.base}/healthz`);
      const r = await http(`${p.base}/readyz`);
      must("docker compose start postgres", p.dir);
      await waitReady(p, 180_000);
      const api = new Api(ORIGIN);
      const s = await browserSignIn(
        ORIGIN,
        "avery.morgan@doc030-install.example",
        password("instAdmin"),
      );
      const read = await s.request("GET", `/api/v1/contracts/${state.instContract.number}`);
      const write = await s.request("PATCH", `/api/v1/contracts/${state.instContract.number}`, {
        description: `DOC-030 operator-2 write check ${new Date().toISOString()}`,
      });
      await s.context.close();
      void api;
      check(
        h.status === 200 && r.status !== 200 && read.status === 200 && write.status === 200,
        `healthz ${h.status} readyz ${r.status} read ${read.status} write ${write.status}`,
      );
      return `healthz ${h.status}; readyz ${r.status} ${r.text.slice(0, 60)}; after docker compose start postgres: readyz 200, Contract read ${read.status}, write ${write.status}`;
    },
  );
  await step(
    {
      ...INSTALL,
      action: "Negative: the authoring lab is not counted as production install evidence",
    },
    () =>
      `Every V-C44 step ran against ${p.project}, cloned from GitHub and built by the guide's own commands, with the guide's .env, compose.operator.yml and a same-host Caddy proxy. No lab.mjs lab, seed data or development overlay was used.`,
  );
};

// ---------------------------------------------------------------- shared install helpers (other projects)

const ENV_COMMAND = [
  "(",
  "  umask 077",
  "  set -C",
  "  cat .env.example > .env || exit 1",
  "  chmod 600 .env",
  '  sed -i "s|^AUTH_SECRET=$|AUTH_SECRET=$(openssl rand -base64 32)|" .env',
  '  sed -i "s|^OPENLAW_SECRET_KEY=$|OPENLAW_SECRET_KEY=$(openssl rand -base64 32)|" .env',
  ")",
].join("\n");
const OPERATOR_YML = [
  "services:",
  "  app:",
  "    image: openlaw-local:${OPENLAW_BUILD_COMMIT:?Set the source revision}",
  "  worker:",
  "    image: openlaw-local:${OPENLAW_BUILD_COMMIT:?Set the source revision}",
  "  doc-engine:",
  "    image: openlaw-engine-local:${OPENLAW_BUILD_COMMIT:?Set the source revision}",
  "",
].join("\n");
/** install.md: clone, select the revision, .env, compose.operator.yml. */
function installFiles(p, revision, extra = {}) {
  mkdirSync(p.home, { recursive: true, mode: 0o700 });
  const out = [];
  if (!existsSync(p.dir)) {
    const c = must(`git clone ${REPO} openlaw`, p.home, { timeout: 900_000 });
    out.push(`git clone exit 0 (${Math.round(c.ms / 1000)} s)`);
  }
  must(`git checkout --detach ${revision}`, p.dir);
  out.push(`git checkout --detach ${revision.slice(0, 8)} exit 0`);
  if (!existsSync(`${p.dir}/.env`)) {
    must(ENV_COMMAND, p.dir);
    out.push("grouped .env commands exit 0");
  }
  for (const [key, value] of Object.entries({
    COMPOSE_PROJECT_NAME: p.project,
    COMPOSE_FILE: "compose.yml:compose.operator.yml",
    OPENLAW_BUILD_COMMIT: revision,
    OPENLAW_BUILD_DIRTY: "false",
    BASE_URL: p.base,
    PORT: String(p.port),
    ...extra,
  }))
    envSet(p, key, value);
  writeFileSync(`${p.dir}/compose.operator.yml`, OPERATOR_YML);
  return out;
}
function keepKeys(p) {
  secrets[p.name] = {
    ...(secrets[p.name] ?? {}),
    AUTH_SECRET: envGet(p, "AUTH_SECRET"),
    OPENLAW_SECRET_KEY: envGet(p, "OPENLAW_SECRET_KEY"),
  };
  saveSecrets();
}
function buildAndStart(p) {
  must("docker compose config --quiet", p.dir);
  const b = must("docker compose build app doc-engine", p.dir, { timeout: 3_000_000 });
  const u = upCommand(p);
  check(u.code === 0, `up exit ${u.code}: ${u.stderr.slice(-600)}`);
  attachSupport(p);
  return b;
}

// ---------------------------------------------------------------- upgrade (V-C46)

const U = PROJECTS.up;
const PEOPLE = {
  admin: {
    email: "morgan.baseline@doc030-upgrade.example",
    displayName: "DOC-030 operator-2 Morgan Baseline",
  },
  reader: {
    email: "rowan.reader@doc030-upgrade.example",
    displayName: "DOC-030 operator-2 Rowan Reader",
    role: "legal_team_member",
  },
  contributor: {
    email: "casey.contributor@doc030-upgrade.example",
    displayName: "DOC-030 operator-2 Casey Contributor",
    role: "contributor",
  },
};

phases["up-baseline"] = async () => {
  const p = U;
  await step(
    {
      ...UPGRADE,
      action: "Fixture: install the starting build d1d098ba with the installation guide's files",
      critical: true,
    },
    () => installFiles(p, BASELINE).join("; "),
  );
  await step(
    {
      ...UPGRADE,
      action: "Fixture: build and start the starting build; readiness",
      command:
        "docker compose config --quiet; docker compose build app doc-engine; docker compose up -d --no-build --pull never",
      critical: true,
    },
    async () => {
      keepKeys(p);
      const b = buildAndStart(p);
      await waitReady(p, 600_000);
      const port = must("docker compose port app 3000", p.dir).stdout.trim();
      const images = recordImages("upgrade-baseline", p);
      state.baselinePort = port;
      return `build ${Math.round(b.ms / 1000)} s; readyz 200; docker compose port app 3000 printed ${port} on the starting build; app ${images.containers.app}, engine ${images.containers["doc-engine"]}`;
    },
  );
};

phases["up-populate"] = async () => {
  const p = U;
  const api = new Api(p.base);
  const inv = (state.inventory = { people: {}, contracts: [], matters: [], documents: [] });
  await step(
    {
      ...UPGRADE,
      method: "automated-test",
      action:
        "Fixture: first Administrator (no setup token on this build) and a saved relay with a password",
      critical: true,
    },
    async () => {
      const setup = await api.get("/api/v1/auth/setup");
      if (setup.needsSetup)
        await api.post(
          "/api/v1/auth/setup",
          { ...PEOPLE.admin, password: password("upAdmin") },
          { accept: [201] },
        );
      else await api.signIn(PEOPLE.admin.email, password("upAdmin"));
      await api.put("/api/v1/email-settings", {
        smtpUrl: `smtp://doc030-upgrade:${password("upRelay")}@op2-mail:1025`,
        smtpFrom: "DOC-030 operator-2 upgrade <openlaw@doc030-upgrade.example>",
      });
      const t0 = Date.now();
      await api.post("/api/v1/email-settings/test");
      const mail = await waitMail(
        (m) =>
          toAddress(m, PEOPLE.admin.email) && m.Subject === "OpenLaw test email" && since(m, t0),
      );
      check(mail, "test email not delivered");
      await api.post("/api/v1/onboarding/complete");
      const me = (await api.get("/api/v1/me")).user;
      inv.people.admin = { email: PEOPLE.admin.email, role: me.role, id: me.id };
      return `setup needsSetup=${setup.needsSetup}; Administrator ${me.role}; saved relay with SMTP password; test email delivered; onboarding completed`;
    },
  );
  await step(
    {
      ...UPGRADE,
      method: "automated-test",
      action: "Fixture: invite and activate a Legal Team Member and a Contributor",
      critical: true,
    },
    async () => {
      const out = [];
      for (const key of ["reader", "contributor"]) {
        const person = PEOPLE[key];
        const t0 = Date.now();
        const created = await api.post("/api/v1/auth/invites", {
          email: person.email,
          displayName: person.displayName,
          role: person.role,
        });
        const message = await waitMail((m) => toAddress(m, person.email) && since(m, t0));
        check(message, `no invitation for ${key}`);
        const token = (await mailText(message.ID)).match(/token=([A-Za-z0-9._-]+)/)?.[1];
        await new Api(p.base).post("/api/auth/reset-password", {
          newPassword: password(`up-${key}`),
          token,
        });
        const session = new Api(p.base);
        await session.signIn(person.email, password(`up-${key}`));
        const me = (await session.get("/api/v1/me")).user;
        inv.people[key] = { email: person.email, role: me.role, id: created.user.id };
        out.push(`${key} ${me.role}`);
      }
      return out.join("; ");
    },
  );
  await step(
    {
      ...UPGRADE,
      method: "automated-test",
      action:
        "Fixture: Entity, a Contract Field, a global Field on a Contract type and a Matter type, three Contracts (one Confidential), a Matter",
      critical: true,
    },
    async () => {
      const entityTypes = (await api.get("/api/v1/entity-types")).entityTypes;
      const entity = (
        await api.post("/api/v1/entities", {
          legalName: "DOC-030 operator-2 Holdings Ltd",
          entityTypeId: entityTypes[0].id,
          jurisdiction: "England and Wales",
          status: "active",
        })
      ).entity;
      inv.entity = { id: entity.id, legalName: entity.legalName };
      const ctype = (await api.get("/api/v1/contract-types")).contractTypes[0];
      const mtype = (await api.get("/api/v1/matter-types")).matterTypes[0];
      const cfield = (
        await api.post("/api/v1/fields", {
          displayName: "DOC-030 operator-2 reference",
          moduleScope: "contract",
          fieldType: "text",
          fieldTag: "business",
        })
      ).field;
      const gfield = (
        await api.post("/api/v1/fields", {
          displayName: "DOC-030 operator-2 shared code",
          moduleScope: "global",
          fieldType: "text",
          fieldTag: "business",
        })
      ).field;
      await api.post(`/api/v1/contract-types/${ctype.id}/fields`, {
        fieldId: cfield.id,
        isRequired: false,
      });
      await api.post(`/api/v1/contract-types/${ctype.id}/fields`, {
        fieldId: gfield.id,
        isRequired: false,
      });
      await api.post(`/api/v1/matter-types/${mtype.id}/fields`, {
        fieldId: gfield.id,
        isRequired: false,
      });
      inv.field = { slug: cfield.slug, displayName: cfield.displayName };
      inv.globalField = { id: gfield.id, slug: gfield.slug, displayName: gfield.displayName };
      for (const [title, confidential] of [
        ["DOC-030 operator-2 supply agreement", false],
        ["DOC-030 operator-2 services agreement", false],
        ["DOC-030 operator-2 confidential settlement", true],
      ]) {
        const created = (
          await api.post("/api/v1/contracts", {
            title,
            contractTypeId: ctype.id,
            isConfidential: confidential,
          })
        ).contract;
        const updated = (
          await api.patch(`/api/v1/contracts/${created.number}`, {
            entityId: entity.id,
            customFields: {
              [cfield.slug]: `ref-${created.number}`,
              [gfield.slug]: `shared-C${created.number}`,
            },
            isConfidential: confidential,
          })
        ).contract;
        inv.contracts.push({
          number: updated.number,
          id: updated.id,
          title: updated.title,
          isConfidential: updated.isConfidential,
          entity: updated.entity?.legalName ?? null,
          customFields: updated.customFields,
        });
      }
      const matter = (
        await api.post("/api/v1/matters", {
          title: "DOC-030 operator-2 regulatory advice",
          matterTypeId: mtype.id,
        })
      ).matter;
      const m2 = (
        await api.patch(`/api/v1/matters/${matter.number}`, {
          customFields: { [gfield.slug]: `shared-M${matter.number}` },
        })
      ).matter;
      inv.matters.push({
        number: matter.number,
        id: matter.id,
        title: matter.title,
        customFields: m2.customFields,
      });
      return {
        contracts: inv.contracts.map(
          (c) =>
            `${c.number} confidential=${c.isConfidential} values=${JSON.stringify(c.customFields)}`,
        ),
        matter: `${matter.number} ${JSON.stringify(m2.customFields)}`,
        globalField: gfield.slug,
      };
    },
  );
  await step(
    {
      ...UPGRADE,
      method: "automated-test",
      action:
        "Fixture: two Documents with original and later Versions (one PDF), Contributor membership",
      critical: true,
    },
    async () => {
      const [first, , confidential] = inv.contracts;
      const d1 = (
        await api.upload(
          `/api/v1/contracts/${first.number}/documents`,
          "doc030-op2-draft.txt",
          Buffer.from("DOC-030 operator-2 draft, original version.\n"),
          "text/plain",
        )
      ).document;
      await api.upload(
        `/api/v1/documents/${d1.id}/versions`,
        "doc030-op2-draft-v2.txt",
        Buffer.from("DOC-030 operator-2 draft, later version.\n"),
        "text/plain",
      );
      const d2 = (
        await api.upload(
          `/api/v1/contracts/${confidential.number}/documents`,
          "doc030-op2-settlement.pdf",
          pdf(["DOC-030 operator-2 settlement, original.", "The parties settle."]),
          "application/pdf",
        )
      ).document;
      await api.upload(
        `/api/v1/documents/${d2.id}/versions`,
        "doc030-op2-settlement-v2.pdf",
        pdf(["DOC-030 operator-2 settlement, later.", "The parties settle in full."]),
        "application/pdf",
      );
      for (const [contract, doc] of [
        [first, d1],
        [confidential, d2],
      ]) {
        const listed = (
          await api.get(`/api/v1/contracts/${contract.number}/documents`)
        ).documents.find((row) => row.id === doc.id);
        const versions = [];
        for (const v of listed.versions) {
          const got = await api.sha(`/api/v1/documents/${doc.id}/versions/${v.id}/download`);
          const text = await waitText(api, doc.id, v.id, 240_000, ["ready", "unsupported"]);
          versions.push({
            id: v.id,
            versionNumber: v.versionNumber,
            sha256: got.sha256,
            textState: text.state,
          });
        }
        inv.documents.push({
          id: doc.id,
          contract: contract.number,
          title: listed.title,
          versions,
        });
      }
      await api.post(
        `/api/v1/contracts/${first.number}/team`,
        { userId: inv.people.contributor.id, role: "contributor" },
        { accept: [201] },
      );
      return inv.documents.map(
        (d) =>
          `${d.title}: ${d.versions.map((v) => `v${v.versionNumber} ${v.sha256.slice(0, 12)} ${v.textState}`).join(", ")}`,
      );
    },
  );
  state.people = PEOPLE;
  saveState();
  await phases["up-populate2"]();
};

phases["up-populate2"] = async () => {
  const p = U;
  const inv = state.inventory;
  const api = new Api(p.base);
  await api.signIn(PEOPLE.admin.email, password("upAdmin"));
  await step(
    {
      ...UPGRADE,
      method: "automated-test",
      action:
        "Fixture: AI connector (custom endpoint stand-in) with a saved key; its test passes on the starting build",
      critical: true,
    },
    async () => {
      const r = await api.put("/api/v1/ai-connector", {
        preset: "custom",
        protocol: "openai_chat_completions",
        baseUrl: "http://op2-ai:8080/v1",
        apiKey: secrets.ai.key,
        model: "doc030-standin",
      });
      const t = await api.raw("POST", "/api/v1/ai-connector/test");
      check(t.status === 200, `test ${t.status} ${t.buffer.toString().slice(0, 200)}`);
      return `connector configured=${r.connector.configured} preset ${r.connector.preset} hasApiKey=${r.connector.hasApiKey}; test 200 through the stand-in`;
    },
  );
  await step(
    {
      ...UPGRADE,
      method: "automated-test",
      action: "Fixture: record baseline reach, Request types and schema facts",
      critical: true,
    },
    async () => {
      const reach = {};
      for (const key of ["reader", "contributor"]) {
        const s = new Api(p.base);
        await s.signIn(PEOPLE[key].email, password(`up-${key}`));
        reach[key] = {};
        for (const c of inv.contracts)
          reach[key][c.number] = (await s.raw("GET", `/api/v1/contracts/${c.number}`)).status;
      }
      inv.baselineReach = reach;
      const conf = inv.contracts.find((c) => c.isConfidential).number;
      check(
        reach.reader[conf] !== 200 && reach.contributor[conf] !== 200,
        "Confidential reachable at baseline",
      );
      inv.requestTypes = psql(p, "select count(*) from request_types");
      inv.requestTypeFields = psql(p, "select count(*) from request_type_fields");
      inv.boColumn = psql(
        p,
        "select count(*) from information_schema.columns where table_name='contracts' and column_name='business_owner_id'",
      );
      inv.journalRows = psql(p, "select count(*) from drizzle.__drizzle_migrations");
      saveState();
      return {
        reach,
        requestTypes: inv.requestTypes,
        requestTypeFields: inv.requestTypeFields,
        contractsBusinessOwnerColumn: inv.boColumn,
        journalRows: inv.journalRows,
      };
    },
  );
  state.people = PEOPLE;
  saveState();
};

// Backup article, Take a coherent backup, steps 1 to 5 (called from upgrade step 4 and V-C47).
async function runBackup(p, backupDir, { meta, restart, pre }) {
  const env = { BACKUP_DIR: backupDir };
  await step(
    {
      ...meta,
      action: "Backup step 1: create a fresh private backup directory",
      command: 'BACKUP_DIR=...; umask 077; mkdir -p "$BACKUP_DIR"; chmod 700 "$BACKUP_DIR"',
      critical: true,
    },
    () => {
      check(!existsSync(backupDir), "backup directory already exists");
      must('umask 077\nmkdir -p "$BACKUP_DIR"\nchmod 700 "$BACKUP_DIR"', p.dir, { env });
      return `mode ${must('stat -c %a "$BACKUP_DIR"', p.dir, { env }).stdout.trim()}`;
    },
  );
  await step(
    {
      ...meta,
      action: "Backup step 2: stop app and worker, keep Postgres running",
      command: "docker compose stop app worker; docker compose ps --all",
      critical: true,
    },
    () => {
      must("docker compose stop app worker", p.dir, { timeout: 180_000 });
      const s = Object.fromEntries(psAll(p).map((r) => [r.service, r.state]));
      check(
        s.app === "exited" && s.worker === "exited" && s.postgres === "running",
        JSON.stringify(s),
      );
      const rows = sh(
        "docker compose exec -T postgres psql -U openlaw -d openlaw -At -c 'select count(*) from runtime_status'",
        p.dir,
      );
      return {
        ...s,
        runtimeStatusRowsAfterStop:
          rows.code === 0 ? rows.stdout.trim() : "table absent on this build",
      };
    },
  );
  await step(
    {
      ...meta,
      action: "Backup step 3: dump the database, archive the file volume, record source and images",
      command:
        'pg_dump --format=custom > "$BACKUP_DIR/database.dump"; docker compose run -T --rm --no-deps app tar -czf - -C /var/lib/openlaw/files . > "$BACKUP_DIR/files.tar.gz"; git rev-parse HEAD > app-source.txt; docker compose images --format json > images.json',
      critical: true,
    },
    () => {
      const out = [];
      for (const command of [
        'docker compose exec -T postgres pg_dump -U openlaw -d openlaw --format=custom > "$BACKUP_DIR/database.dump"',
        'docker compose run -T --rm --no-deps app tar -czf - -C /var/lib/openlaw/files . > "$BACKUP_DIR/files.tar.gz"',
        'git rev-parse HEAD > "$BACKUP_DIR/app-source.txt"',
        'docker compose images --format json > "$BACKUP_DIR/images.json"',
      ]) {
        const r = sh(`umask 077\n${command}`, p.dir, { env, timeout: 600_000 });
        out.push(r.code);
        check(r.code === 0, `${command}: ${r.stderr.slice(-400)}`);
      }
      const source = readFileSync(path.join(backupDir, "app-source.txt"), "utf8").trim();
      const images = JSON.parse(readFileSync(path.join(backupDir, "images.json"), "utf8"));
      const app = images.find((i) => i.ContainerName?.includes("-app-"));
      if (pre)
        writeFileSync(path.join(backupDir, "pre-upgrade-revision.txt"), `${pre}\n`, {
          mode: 0o600,
        });
      return `exit codes ${out.join(", ")}; app-source.txt ${source}; images.json app ${app?.Repository}:${app?.Tag} ${app?.ID}${pre ? `; running build ${pre} recorded beside it because the checkout already points at the target` : ""}; dump ${readFileSync(path.join(backupDir, "database.dump")).length} bytes; files ${readFileSync(path.join(backupDir, "files.tar.gz")).length} bytes`;
    },
  );
  await step(
    {
      ...meta,
      action: "Backup step 4: list both archives and record hashes",
      command: "pg_restore --list; tar -tzf; sha256sum > SHA256SUMS",
      critical: true,
    },
    () => {
      must(
        'docker compose exec -T postgres pg_restore --list < "$BACKUP_DIR/database.dump" > "$BACKUP_DIR/database-contents.txt"',
        p.dir,
        { env },
      );
      must('tar -tzf "$BACKUP_DIR/files.tar.gz" > "$BACKUP_DIR/file-contents.txt"', p.dir, { env });
      must('(cd "$BACKUP_DIR" && sha256sum database.dump files.tar.gz > SHA256SUMS)', p.dir, {
        env,
      });
      const entries = readFileSync(path.join(backupDir, "database-contents.txt"), "utf8")
        .split("\n")
        .filter((l) => l && !l.startsWith(";")).length;
      const files = readFileSync(path.join(backupDir, "file-contents.txt"), "utf8")
        .split("\n")
        .filter((l) => l && !l.endsWith("/")).length;
      return `pg_restore --list ${entries} TOC entries; tar lists ${files} files; SHA256SUMS ${readFileSync(path.join(backupDir, "SHA256SUMS"), "utf8").trim().replace(/\s+/g, " ")}`;
    },
  );
  if (!restart) return;
  await step(
    {
      ...meta,
      action: "Backup step 5: restart app and worker; confirm readiness and an actual operation",
      command: "docker compose up -d --no-build --pull never",
      critical: true,
    },
    async () => {
      must("docker compose up -d --no-build --pull never", p.dir);
      await waitReady(p);
      const api = new Api(p.base);
      await api.signIn(state.people.admin.email, password("upAdmin"));
      const d = state.inventory.documents[0];
      const got = await api.sha(`/api/v1/documents/${d.id}/versions/${d.versions[0].id}/download`);
      check(got.sha256 === d.versions[0].sha256, "download after pause failed");
      return `readyz 200; Version download hash matches ${got.sha256.slice(0, 12)}`;
    },
  );
  await step(
    {
      ...meta,
      action: "Copy the backup to its retained location and verify its hashes there",
      critical: true,
    },
    () => {
      const retained = `${backupDir}-retained`;
      must(`umask 077; mkdir -p "${retained}"; cp -p "$BACKUP_DIR"/* "${retained}/"`, p.dir, {
        env,
      });
      const r = must(`cd "${retained}" && sha256sum --check SHA256SUMS`, p.dir);
      return `${path.basename(retained)}: ${r.stdout.trim().replace(/\n/g, "; ")}`;
    },
  );
}

phases.upgrade = async () => {
  const p = U;
  // A tab opened before the upgrade, kept open across it (upgrade step 5).
  const old = await browserSignIn(p.base, state.people.admin.email, password("upAdmin"));
  await old.page.goto(`${p.base}/contracts`);
  await old.page.waitForLoadState("networkidle").catch(() => {});
  await step(
    {
      ...UPGRADE,
      action:
        "Before you start: record source revision, image identities, project, file list, storage configuration and Settings → Advanced",
      critical: true,
    },
    async () => {
      const rev = must("git rev-parse HEAD", p.dir).stdout.trim();
      const config = JSON.parse(must("docker compose config --format json", p.dir).stdout);
      const env = config.services.app.environment;
      await old.page.goto(`${p.base}/settings`);
      await old.page.waitForLoadState("networkidle").catch(() => {});
      const rail = await bodyText(old.page);
      const advanced = await old.page.request.get(`${p.base}/api/v1/advanced-settings/instance`);
      state.upgradeBefore = { containers: psAll(p), rev };
      saveState();
      return {
        sourceRevision: rev,
        images: recordImages("upgrade-before", p).containers,
        project: config.name,
        composeFile: envGet(p, "COMPOSE_FILE"),
        storage: {
          STORAGE_DRIVER: env.STORAGE_DRIVER || "(unset: local)",
          STORAGE_PATH: env.STORAGE_PATH,
        },
        settingsAdvancedOnStartingBuild: `Settings rail shows Instance address: ${rail.includes("Instance address")}; GET /api/v1/advanced-settings/instance ${advanced.status}; nothing can show Saved in OpenLaw on this build`,
        keysInSecretStore: Boolean(secrets.up?.AUTH_SECRET && secrets.up?.OPENLAW_SECRET_KEY),
      };
    },
  );
  await old.page.goto(`${p.base}/contracts`);
  await old.page.waitForLoadState("networkidle").catch(() => {});
  await step(
    {
      ...UPGRADE,
      action: "Prepare step 1: fetch the source and inspect local changes",
      command: "git status --short; git fetch origin; git rev-parse HEAD",
      critical: true,
    },
    () => {
      const status = must("git status --short", p.dir).stdout.trim();
      must("git fetch origin", p.dir, { timeout: 300_000 });
      const head = must("git rev-parse HEAD", p.dir).stdout.trim();
      return `git status --short: ${JSON.stringify(status)} (compose.operator.yml and .env are untracked or ignored); git fetch origin exit 0; HEAD ${head}`;
    },
  );
  await step(
    {
      ...UPGRADE,
      action:
        "Prepare step 2: select the target, update OPENLAW_BUILD_COMMIT, validate and build without recreating the running containers",
      command: `git checkout --detach ${COMMIT}; docker compose config --quiet; docker compose build app doc-engine`,
      critical: true,
    },
    () => {
      must(`git checkout --detach ${COMMIT}`, p.dir);
      envSet(p, "OPENLAW_BUILD_COMMIT", COMMIT);
      must("docker compose config --quiet", p.dir);
      const b = must("docker compose build app doc-engine", p.dir, { timeout: 3_000_000 });
      const after = psAll(p);
      const unchanged = state.upgradeBefore.containers.every((x) =>
        after.some((a) => a.id === x.id && a.state === x.state),
      );
      check(unchanged, "containers changed during the build");
      const services = JSON.parse(
        must("docker compose config --format json", p.dir).stdout,
      ).services;
      check(
        services.app.image === services.worker.image,
        "app and worker resolve to different images",
      );
      log.images.upgradeTarget = {
        app: `${services.app.image} ${inspectImage(services.app.image)}`,
        engine: `${services.engine?.image ?? services["doc-engine"].image} ${inspectImage(services["doc-engine"].image)}`,
        postgres: services.postgres.image,
      };
      return `build ${Math.round(b.ms / 1000)} s; ${after.length} containers kept their IDs and states; app and worker both resolve to ${services.app.image} (${inspectImage(services.app.image)}); engine ${inspectImage(services["doc-engine"].image)}; postgres stays ${services.postgres.image}`;
    },
  );
  await step(
    {
      ...UPGRADE,
      action:
        "Prepare step 3: review the settings the target's Compose file changes and decide them in .env",
      command:
        ROUND === 2
          ? "APP_BIND unset; docker network inspect <project>_openlaw-backend; TRUSTED_PROXIES=<gateway>; default ceilings; VAPID unset; no compose.private.yml"
          : "APP_BIND unset; TRUSTED_PROXIES=127.0.0.1,::1; default ceilings; VAPID unset; no compose.private.yml",
    },
    () => {
      let gatewayRead = null;
      if (ROUND === 2) {
        gatewayRead = must(
          `docker network inspect ${p.project}_openlaw-backend --format '{{range .IPAM.Config}}{{.Gateway}} {{.Subnet}}{{end}}'`,
          p.dir,
        ).stdout.trim();
        envSet(p, "TRUSTED_PROXIES", gatewayRead.split(" ")[0]);
      } else envSet(p, "TRUSTED_PROXIES", "127.0.0.1,::1");
      const cfg = JSON.parse(must("docker compose config --format json", p.dir).stdout).services;
      const ports = cfg.app.ports.map((x) => `${x.host_ip}:${x.published}->${x.target}`);
      const limits = Object.fromEntries(
        ["app", "worker", "doc-engine"].map((s) => [
          s,
          `cpus ${cfg[s].cpus} mem ${cfg[s].mem_limit} pids ${cfg[s].pids_limit}`,
        ]),
      );
      return {
        appPorts: ports,
        limits,
        vapid: `VAPID_PUBLIC_KEY="${cfg.app.environment.VAPID_PUBLIC_KEY}" VAPID_PRIVATE_KEY set=${Boolean(cfg.app.environment.VAPID_PRIVATE_KEY)}`,
        trustedProxies: cfg.app.environment.TRUSTED_PROXIES,
        ...(ROUND === 2
          ? {
              gatewayAndSubnetReadBeforeTheUpgrade: gatewayRead,
              proxy: "same-host Caddy at the instance origin",
            }
          : {
              note: "The TRUSTED_PROXIES value is the guide's; the install walkthrough found that a same-host proxy reaches the app from the Docker bridge gateway, so this value does not trust it.",
            }),
      };
    },
  );
  await step(
    {
      ...UPGRADE,
      action: "Before you start: check outstanding signing and processing work before the pause",
      command: "psql: pg-boss job states; contract_envelopes by status",
    },
    () => {
      const jobs = psql(
        p,
        "select state, count(*) from pgboss.job group by state order by state",
      ).replace(/\n/g, "; ");
      const env = sh(
        `docker compose exec -T postgres psql -U openlaw -d openlaw -At -c "select status, count(*) from contract_envelopes group by status"`,
        p.dir,
      );
      return `pg-boss: ${jobs || "(none)"}; contract_envelopes: ${env.code === 0 ? env.stdout.trim() || "(none)" : "query failed"}`;
    },
  );
  const backupDir = path.join(WORK, "backups", "pre-upgrade");
  await runBackup(p, backupDir, {
    meta: { ...UPGRADE, article: "upgrade (step 4 calls backup-and-restore)" },
    restart: false,
    pre: BASELINE,
  });
  state.preUpgradeBackup = backupDir;
  saveState();
  await step(
    {
      ...UPGRADE,
      action:
        "Start step 1: start the target with the retained project and volumes; ps; port; logs",
      command:
        "docker compose up -d --no-build --pull never; docker compose ps; docker compose port app 3000; docker compose logs --tail=100 app worker",
      expected:
        "The first app migration line is 'migrations: reconciled 0090_onboarding_reviewed_types; continuing with pending migrations'; the worker can stop on a missing column or table and Compose restarts it; port 127.0.0.1:3000 form by default.",
      critical: true,
    },
    async () => {
      const t0 = Date.now();
      must("docker compose up -d --no-build --pull never", p.dir);
      const ps0 = must("docker compose ps --format '{{.Service}} {{.State}} {{.Status}}'", p.dir)
        .stdout.trim()
        .split("\n");
      const port = must("docker compose port app 3000", p.dir).stdout.trim();
      await waitReady(p, 900_000);
      const readyS = Math.round((Date.now() - t0) / 1000);
      await sleep(40_000);
      const tail = must("docker compose logs --tail=100 app worker", p.dir).stdout;
      const full = must("docker compose logs --no-log-prefix app", p.dir).stdout.split("\n");
      const wlogs = must("docker compose logs --no-log-prefix worker", p.dir).stdout;
      const firstMig = full.find((l) => /migrations?:/i.test(l)) ?? "";
      const workerId = sh("docker compose ps -aq worker", p.dir).stdout.trim();
      const wstate = must(
        `docker inspect --format '{{.RestartCount}} {{.State.Status}} {{.State.StartedAt}}' ${workerId}`,
        p.dir,
      ).stdout.trim();
      const workerErrors = lines(
        wlogs,
        /advanced_settings|runtime_status|does not exist|column|relation/i,
        3,
      );
      const journal = psql(p, "select count(*), max(created_at) from drizzle.__drizzle_migrations");
      check(
        firstMig.includes(
          "migrations: reconciled 0090_onboarding_reviewed_types; continuing with pending migrations",
        ),
        `first migration line: ${firstMig.slice(0, 200)}`,
      );
      check(port === `127.0.0.1:${p.port}`, `port ${port}`);
      check(wstate.split(" ")[1] === "running", `worker ${wstate}`);
      recordImages("upgrade-after", p);
      return {
        psRightAfterUp: ps0,
        port,
        readyAfterSeconds: readyS,
        firstMigrationLine: firstMig.trim().slice(0, 160),
        workerRestartCountAndState: wstate,
        workerErrorLinesMatchingSchema: workerErrors,
        journalRowsAndLatest: `${state.inventory.journalRows} before; ${journal} after`,
        tail100Lines: tail.split("\n").length,
        errorLikeLinesInTail: tail.split("\n").filter((l) => /"level":50|error/i.test(l)).length,
      };
    },
  );
  await step(
    {
      ...UPGRADE,
      role: "administrator",
      method: "browser-walkthrough",
      action: "Start step 5: a browser tab opened before the upgrade, used after it",
      expected: "An old tab can show This part of OpenLaw was updated. Reload to continue.",
    },
    async () => {
      const pageErrors = [];
      old.page.on("pageerror", (e) => pageErrors.push(e.message.slice(0, 120)));
      const seen = [];
      for (const name of ["Matters", "Entities", "Knowledge", "Documents", "Auto-Docs"]) {
        await old.page
          .getByRole("link", { name, exact: true })
          .first()
          .click()
          .catch(() => {});
        await old.page.waitForTimeout(2500);
        const text = await bodyText(old.page);
        seen.push(
          `${name}: ${text.includes("This part of OpenLaw was updated. Reload to continue.") ? "notice shown" : new URL(old.page.url()).pathname}`,
        );
        if (text.includes("This part of OpenLaw was updated. Reload to continue.")) break;
      }
      await old.page.screenshot({ path: path.join(here, "upgrade-old-tab.png") });
      await old.page.reload();
      await old.page.waitForLoadState("networkidle").catch(() => {});
      const afterReload = (await bodyText(old.page)).slice(0, 120);
      await old.context.close();
      return { navigationsInOldTab: seen, pageErrors: pageErrors.slice(0, 3), afterReload };
    },
  );
};

// ---------------------------------------------------------------- verification shared by the upgraded, recovered and restored targets

async function textWithValues(page) {
  return page.evaluate(() => {
    const values = [...document.querySelectorAll("input, textarea, select")].map((el) =>
      el.tagName === "SELECT" ? el.options[el.selectedIndex]?.textContent : el.value,
    );
    return `${document.body.innerText} ${values.join(" ")}`.replace(/\s+/g, " ");
  });
}
async function advancedSources(page, base) {
  const out = {};
  for (const [name, route] of [
    ["Instance address", "/settings/instance"],
    ["File uploads", "/settings/uploads"],
    ["Document storage", "/settings/storage"],
    ["Document processing", "/settings/document-processing"],
    ["MCP", "/settings/mcp-limits"],
  ]) {
    await page.goto(`${base}${route}`);
    await page.getByRole("heading", { name }).first().waitFor({ timeout: 20_000 });
    await page.waitForLoadState("networkidle").catch(() => {});
    out[name] = await page.evaluate(() =>
      [...document.querySelectorAll("form label")].map((label) => {
        const id = label.getAttribute("for");
        const input = id ? document.getElementById(id) : null;
        const hint = label.parentElement?.querySelector("p.text-xs")?.textContent ?? "";
        const value = input
          ? input.tagName === "SELECT"
            ? input.options[input.selectedIndex]?.textContent
            : input.type === "password"
              ? "(secret)"
              : input.value
          : "";
        return `${label.textContent.trim()} = ${value} [${hint.trim()}]`;
      }),
    );
  }
  return out;
}
async function systemStatus(page, base, settle = false) {
  const first = await systemStatusOnce(page, base);
  if (!settle || processRowsOk(first)) return first;
  // A stopped API leaves its heartbeat row for up to a minute (product bug in this log); refresh after it ages out.
  await sleep(65_000);
  const again = await systemStatusOnce(page, base);
  return { ...again, firstRefresh: first.rows };
}
async function systemStatusOnce(page, base) {
  await page.goto(`${base}/settings/system-status`);
  await page.getByRole("heading", { name: "System status" }).first().waitFor({ timeout: 20_000 });
  await page.getByRole("button", { name: "Refresh" }).click();
  await page.waitForTimeout(1500);
  const rows = await page.locator("table tbody tr").allInnerTexts();
  const text = await bodyText(page);
  return {
    rows: rows.map((r) => r.replace(/\s+/g, " ").trim()),
    activeStorage: text.match(/Active storage: \S+/)?.[0] ?? null,
    documentService: text.match(/Document service: \S+/)?.[0] ?? null,
    warning: text.includes("An API or worker heartbeat is missing")
      ? "An API or worker heartbeat is missing. Check that both services are running."
      : null,
  };
}
function processRowsOk(status) {
  const api = status.rows.filter((r) => /^API /.test(r));
  const worker = status.rows.filter((r) => /^Worker /.test(r));
  return (
    api.length > 0 &&
    worker.length > 0 &&
    [...api, ...worker].every((r) => r.includes("Running") && r.includes("Current"))
  );
}

async function verifyInstance(
  p,
  { meta, label, adminPw, people, modern = true, fieldSplit = true, skipAi = false, only = null },
) {
  const want = (k) => !only || only.includes(k);
  const inv = state.inventory;
  const conf = inv.contracts.find((c) => c.isConfidential);
  const admin = await browserSignIn(p.base, people.admin.email, adminPw);
  try {
    if (want("records"))
      await step(
        {
          ...meta,
          role: "administrator",
          method: "browser-walkthrough",
          action: `${label}: Administrator signs in through the origin; representative Contracts, Matter and Entity match the inventory`,
          critical: true,
        },
        async () => {
          check(admin.role === "administrator", `role ${admin.role} ${admin.notes.join("; ")}`);
          const out = { landed: admin.landed, contracts: [] };
          for (const c of inv.contracts) {
            await admin.page.goto(`${p.base}/contracts/${c.number}`);
            await admin.page
              .getByRole("heading", { name: c.title })
              .first()
              .waitFor({ state: "attached", timeout: 20_000 });
            const r = await admin.request("GET", `/api/v1/contracts/${c.number}`);
            const row = r.body.contract;
            check(
              row.isConfidential === c.isConfidential &&
                (row.entity?.legalName ?? null) === c.entity,
              `Contract ${c.number}`,
            );
            check(
              row.customFields?.[inv.field.slug] === c.customFields[inv.field.slug],
              `reference Field on ${c.number}: ${JSON.stringify(row.customFields)}`,
            );
            out.contracts.push(
              `C-${c.number} heading shown; Confidential ${row.isConfidential}; Entity ${row.entity?.legalName}; ${inv.field.displayName} ${row.customFields[inv.field.slug]}`,
            );
          }
          const m = inv.matters[0];
          await admin.page.goto(`${p.base}/matters/${m.number}`);
          await admin.page
            .getByRole("heading", { name: m.title })
            .first()
            .waitFor({ state: "attached", timeout: 20_000 });
          const e = await admin.request("GET", `/api/v1/entities/${inv.entity.id}`);
          check(
            e.status === 200 && e.body.entity.legalName === inv.entity.legalName,
            `Entity ${e.status}`,
          );
          out.matter = `M-${m.number} heading shown`;
          out.entity = `${inv.entity.legalName} read 200`;
          return out;
        },
      );
    if (fieldSplit && want("fields"))
      await step(
        {
          ...meta,
          role: "administrator",
          method: "browser-walkthrough",
          action: `${label}: a Field several modules shared appears once in each module with the same name and saved values`,
        },
        async () => {
          const g = inv.globalField;
          const rows = psql(
            p,
            `select slug, module_scope from fields where display_name = '${g.displayName}' order by module_scope`,
          ).split("\n");
          const m = inv.matters[0];
          const matter = (await admin.request("GET", `/api/v1/matters/${m.number}`)).body.matter;
          const contractValues = [];
          for (const c of inv.contracts)
            contractValues.push(
              (await admin.request("GET", `/api/v1/contracts/${c.number}`)).body.contract
                .customFields[g.slug],
            );
          await admin.page.goto(`${p.base}/matters/${m.number}/fields`);
          await admin.page.waitForLoadState("networkidle").catch(() => {});
          const mText = await textWithValues(admin.page);
          await admin.page.goto(`${p.base}/contracts/${inv.contracts[0].number}/fields`);
          await admin.page.waitForLoadState("networkidle").catch(() => {});
          const cText = await textWithValues(admin.page);
          const matterValue = Object.entries(matter.customFields ?? {}).find(([k]) =>
            k.startsWith(g.slug),
          );
          check(
            rows.length === 2 &&
              rows.some((r) => r.endsWith("|contract") && r.startsWith(`${g.slug}|`)) &&
              rows.some((r) => r.endsWith("|matter")),
            `fields ${rows}`,
          );
          check(
            matterValue?.[1] === `shared-M${m.number}` &&
              contractValues.every((v, i) => v === `shared-C${inv.contracts[i].number}`),
            `values ${JSON.stringify(matterValue)} ${contractValues}`,
          );
          check(
            mText.includes(g.displayName) &&
              mText.includes(`shared-M${m.number}`) &&
              cText.includes(g.displayName),
            "Fields tabs do not show the name and value",
          );
          return `Fields named "${g.displayName}": ${rows.join(", ")} (Contract kept the original slug; Matter got a copy); Contract values ${contractValues.join(", ")}; Matter value ${matterValue[0]}=${matterValue[1]}; the Matter's and Contract's Fields tabs show the name and values in the browser`;
        },
      );
    if (want("downloads"))
      await step(
        {
          ...meta,
          role: "administrator",
          action: `${label}: download original and later Document Versions and compare hashes with the inventory`,
          critical: true,
        },
        async () => {
          const out = [];
          for (const d of inv.documents)
            for (const v of d.versions) {
              const r = await admin.request(
                "GET",
                `/api/v1/documents/${d.id}/versions/${v.id}/download`,
              );
              const got = r.status === 200 ? sha256(r.buffer) : null;
              check(got === v.sha256, `${d.title} v${v.versionNumber}: ${r.status} ${got}`);
              out.push(`${d.title} v${v.versionNumber} ${v.sha256.slice(0, 16)} match`);
            }
          return out;
        },
      );
    if (want("upload"))
      await step(
        {
          ...meta,
          role: "administrator",
          method: "browser-walkthrough",
          action: `${label}: a new upload in the browser is processed by the worker`,
        },
        async () => {
          const body = pdf([
            `DOC-030 operator-2 new upload on ${label}.`,
            "Worker processing check.",
          ]);
          const up = await uploadInBrowser(
            admin.page,
            p.base,
            inv.contracts[1].number,
            `doc030-op2-${p.name}-${Date.now()}.pdf`,
            body,
          );
          const text = await waitText(
            { raw: (m, r) => admin.request(m, r) },
            up.documentId,
            up.versionId,
            300_000,
          );
          check(
            text.state === "ready" && /Worker processing check/.test(text.text),
            `text ${text.state}`,
          );
          state.newUploads = {
            ...(state.newUploads ?? {}),
            [p.name]: { id: up.documentId, contract: inv.contracts[1].number },
          };
          return `${up.how}; processing ready with the uploaded words`;
        },
      );
    if (want("email"))
      await step(
        {
          ...meta,
          role: "administrator",
          method: "browser-walkthrough",
          action: `${label}: an actual use of the saved encrypted relay: Send test email`,
        },
        async () => {
          const t0 = Date.now();
          if (!modern) {
            const r = await admin.request("POST", "/api/v1/email-settings/test");
            const mail = await waitMail(
              (m) =>
                toAddress(m, people.admin.email) &&
                m.Subject === "OpenLaw test email" &&
                since(m, t0),
            );
            check(r.status === 200 && mail, `test ${r.status}`);
            return `starting build: POST /api/v1/email-settings/test from the Administrator's browser session ${r.status}; "OpenLaw test email" reached the controlled recipient through the restored relay`;
          }
          await admin.page.goto(`${p.base}/settings/email`);
          await admin.page.waitForLoadState("networkidle").catch(() => {});
          await admin.page.getByRole("button", { name: "Send test email" }).click();
          const mail = await waitMail(
            (m) =>
              toAddress(m, people.admin.email) &&
              m.Subject === "OpenLaw test email" &&
              since(m, t0),
          );
          const page = (await bodyText(admin.page)).match(
            /(Test email sent[^.]*\.|The test email could not be sent[^.]*\.)/,
          )?.[0];
          check(mail, `no message; page says ${page}`);
          return `Settings → Outbound email → Send test email: ${page ?? "(no inline notice captured)"}; "OpenLaw test email" reached the controlled recipient through the saved relay`;
        },
      );
    if (!skipAi && want("ai"))
      await step(
        {
          ...meta,
          role: "administrator",
          method: "browser-walkthrough",
          action: `${label}: Test connection on the configured AI connector (stand-in endpoint)`,
        },
        async () => {
          if (!modern) {
            const r = await admin.request("POST", "/api/v1/ai-connector/test");
            check(r.status === 200, `test ${r.status} ${r.buffer.toString().slice(0, 160)}`);
            return `starting build: POST /api/v1/ai-connector/test from the Administrator's browser session 200; the stand-in accepted the restored key`;
          }
          await admin.page.goto(`${p.base}/settings/ai-analysis`);
          await admin.page.getByRole("button", { name: "Provider", exact: true }).first().click();
          await admin.page
            .getByRole("button", { name: "Test connection" })
            .first()
            .click({ timeout: 20_000 });
          await admin.page
            .getByText(/Connection successful\.|The connection test failed/)
            .first()
            .waitFor({ timeout: 30_000 });
          const text = (await bodyText(admin.page)).match(
            /Connection successful\.|The connection test failed[^.]*\.[^.]*\./,
          )?.[0];
          check(text === "Connection successful.", text);
          const saved = psql(p, "select count(*) from ai_saved_keys");
          return `Settings → AI analysis → Test connection: "${text}" (the stand-in answers 200 only for the key saved on the starting build); ai_saved_keys rows ${saved}`;
        },
      );
    if (modern) {
      if (want("status"))
        await step(
          {
            ...meta,
            role: "administrator",
            method: "browser-walkthrough",
            action: `${label}: Settings → Advanced → System status → Refresh: API and Worker rows Running and Current`,
          },
          async () => {
            const st = await systemStatus(admin.page, p.base, ROUND === 2);
            check(processRowsOk(st), JSON.stringify(st));
            return st;
          },
        );
      if (want("advanced"))
        await step(
          {
            ...meta,
            role: "administrator",
            method: "browser-walkthrough",
            action: `${label}: Settings → Advanced fields and their sources`,
          },
          async () => advancedSources(admin.page, p.base),
        );
    }
  } finally {
    await admin.context.close();
  }
  for (const key of want("lower") ? ["reader", "contributor"] : []) {
    await step(
      {
        ...meta,
        role: key === "reader" ? "legal_team_member" : "lower-access",
        method: "browser-walkthrough",
        action: `${label}: lower-access account (${key}) signs in; a Confidential record outside its audience stays refused`,
      },
      async () => {
        const s = await browserSignIn(p.base, people[key].email, password(`up-${key}`));
        try {
          const reach = {};
          for (const c of inv.contracts)
            reach[c.number] = (await s.request("GET", `/api/v1/contracts/${c.number}`)).status;
          const portal =
            s.role === "business_user"
              ? (await s.request("GET", `/api/v1/portal/contracts/${conf.number}`)).status
              : null;
          const cd = inv.documents.find((d) => d.contract === conf.number);
          const dl = (
            await s.request(
              "GET",
              `/api/v1/documents/${cd.id}/versions/${cd.versions[0].id}/download`,
            )
          ).status;
          await s.page.goto(`${p.base}/contracts/${conf.number}`);
          await s.page.waitForLoadState("networkidle").catch(() => {});
          const visible = await s.page
            .getByText(conf.title)
            .first()
            .isVisible()
            .catch(() => false);
          const team = psql(
            p,
            `select count(*) from contract_team t join contracts c on c.id = t.contract_id where c.number = ${conf.number} and t.user_id = '${inv.people[key].id}'`,
          );
          check(
            reach[conf.number] !== 200 &&
              dl !== 200 &&
              !visible &&
              (portal === null || portal !== 200),
            JSON.stringify({ reach, dl, visible, portal }),
          );
          return {
            role: s.role,
            landed: s.landed,
            baselineReach: inv.baselineReach[key],
            reachNow: reach,
            portalConfidential: portal,
            confidentialDownload: dl,
            confidentialTitleVisible: visible,
            teamMemberOfConfidential: team,
            pageText: (await bodyText(s.page)).slice(0, 120),
          };
        } finally {
          await s.context.close();
        }
      },
    );
  }
  if (want("jobs"))
    await step(
      {
        ...meta,
        action: `${label}: inspect outstanding jobs and Envelopes`,
        command: "psql: pg-boss job states; contract_envelopes",
      },
      () => {
        const jobs = psql(
          p,
          "select state, count(*) from pgboss.job group by state order by state",
        ).replace(/\n/g, "; ");
        const env = sh(
          `docker compose exec -T postgres psql -U openlaw -d openlaw -At -c "select status, count(*) from contract_envelopes group by status"`,
          p.dir,
        );
        return `pg-boss ${jobs}; contract_envelopes ${env.code === 0 ? env.stdout.trim() || "(none)" : "query failed"}`;
      },
    );
}

phases["up-verify"] = async (only) => {
  const p = U;
  await verifyInstance(p, {
    meta: UPGRADE,
    label: "after upgrade",
    adminPw: password("upAdmin"),
    people: state.people,
    only: only ? only.split(",") : null,
  });
  await step(
    {
      ...UPGRADE,
      action: "after upgrade: the data rewrites the guide lists",
      command: "psql reads",
    },
    () => {
      const inv = state.inventory;
      const types = psql(
        p,
        "select dv.version_number || ' ' || coalesce(dt.display_name, '(none)') from document_versions dv left join document_types dt on dt.id = dv.document_type_id order by dv.created_at limit 4",
      ).replace(/\n/g, "; ");
      const keys = psql(p, "select count(*) from ai_saved_keys");
      const linked = psql(p, "select count(*) from ai_connector where saved_key_id is not null");
      const bo = psql(p, "select count(*) from contracts where business_owner_id is not null");
      const backfill = psql(
        p,
        "select count(*) from activity_log where payload->>'reason' = 'Business Owner membership backfill'",
      );
      const forms = psql(p, "select count(*) from request_types");
      return `Contract Document Versions typed: ${types}; AI key moved to ai_saved_keys (${keys}) and the connector references it (${linked}); Business Owner backfill: ${bo} Contracts had a Business Owner (the starting build has no business_owner_id column: ${inv.boColumn === "0"}) and ${backfill} backfill Activity entries; Request types ${forms} (starting build had ${inv.requestTypes} with ${inv.requestTypeFields} intake questions)`;
    },
  );
};

// V-C46 negative check: recovery from the pre-upgrade backup into a separate empty target on the starting build.
async function restoreInto(p, backupDir, revision, { meta, keysFrom, extra = {} }) {
  const env = { BACKUP_DIR: backupDir };
  await step(
    {
      ...meta,
      action: `Restore step 1: prepare source ${revision.slice(0, 8)} and its images, retained keys, distinct project, origin and port; no first-run setup`,
      critical: true,
    },
    () => {
      const out = installFiles(p, revision, extra);
      envSet(p, "AUTH_SECRET", secrets[keysFrom].AUTH_SECRET);
      envSet(p, "OPENLAW_SECRET_KEY", secrets[keysFrom].OPENLAW_SECRET_KEY);
      keepKeys(p);
      must("docker compose config --quiet", p.dir);
      const b = must("docker compose build app doc-engine", p.dir, { timeout: 3_000_000 });
      const recorded = JSON.parse(readFileSync(path.join(backupDir, "images.json"), "utf8")).find(
        (i) => i.ContainerName?.includes("-app-"),
      );
      const image = JSON.parse(must("docker compose config --format json", p.dir).stdout).services
        .app.image;
      return `${out.join("; ")}; build ${Math.round(b.ms / 1000)} s; project ${p.project}, BASE_URL ${envGet(p, "BASE_URL")}, PORT ${p.port}; retained AUTH_SECRET and OPENLAW_SECRET_KEY supplied from the secret store; backup images.json names ${recorded.Repository}:${recorded.Tag}; target app image ${image} (${inspectImage(image)})`;
    },
  );
  await step(
    {
      ...meta,
      action: "Restore step 2: verify the hashes on the target host and start Postgres",
      command: '(cd "$BACKUP_DIR" && sha256sum --check SHA256SUMS); docker compose up -d postgres',
      critical: true,
    },
    () => {
      const c = must('(cd "$BACKUP_DIR" && sha256sum --check SHA256SUMS)', p.dir, { env })
        .stdout.trim()
        .replace(/\n/g, "; ");
      const u = upCommand(p, "docker compose up -d postgres");
      check(u.code === 0, u.stderr.slice(-400));
      return c;
    },
  );
  await step(
    {
      ...meta,
      action: "Confirm the target's database and file store are empty before importing",
      critical: true,
    },
    async () => {
      let tables = "";
      for (let i = 0; i < 60; i += 1) {
        const r = sh(
          `docker compose exec -T postgres psql -U openlaw -d openlaw -At -c "select count(*) from information_schema.tables where table_schema not in ('pg_catalog','information_schema')"`,
          p.dir,
        );
        if (r.code === 0) {
          tables = r.stdout.trim();
          break;
        }
        await sleep(2000);
      }
      const files = must(
        "docker compose run -T --rm --no-deps app sh -c 'find /var/lib/openlaw/files -mindepth 1 | wc -l'",
        p.dir,
      ).stdout.trim();
      check(tables === "0" && files === "0", `tables ${tables}, files ${files}`);
      return `non-system tables ${tables}; entries under /var/lib/openlaw/files ${files}`;
    },
  );
  await step(
    {
      ...meta,
      action: "Restore step 3: restore the database with --exit-on-error",
      command:
        'docker compose exec -T postgres pg_restore -U openlaw -d openlaw --exit-on-error --no-owner --no-privileges < "$BACKUP_DIR/database.dump"',
      critical: true,
    },
    () => {
      const r = sh(
        'docker compose exec -T postgres pg_restore -U openlaw -d openlaw --exit-on-error --no-owner --no-privileges < "$BACKUP_DIR/database.dump"',
        p.dir,
        { env, timeout: 600_000 },
      );
      check(r.code === 0, `pg_restore exit ${r.code}: ${r.stderr.slice(-500)}`);
      return `pg_restore exit 0; stderr lines ${r.stderr.trim() ? r.stderr.trim().split("\n").length : 0}`;
    },
  );
  await step(
    {
      ...meta,
      action: "Restore step 4: restore the local files through the target app service's volume",
      command:
        'docker compose run -T --rm --no-deps app tar -xzf - -C /var/lib/openlaw/files < "$BACKUP_DIR/files.tar.gz"',
      critical: true,
    },
    () => {
      must(
        'docker compose run -T --rm --no-deps app tar -xzf - -C /var/lib/openlaw/files < "$BACKUP_DIR/files.tar.gz"',
        p.dir,
        { env, timeout: 600_000 },
      );
      const files = must(
        "docker compose run -T --rm --no-deps app sh -c 'find /var/lib/openlaw/files -type f | wc -l'",
        p.dir,
      ).stdout.trim();
      return `tar exit 0; files in the target volume ${files}`;
    },
  );
  await step(
    {
      ...meta,
      action:
        "Restore step 5: start the target and check readiness (controlled relay and AI stand-in reachable under their saved names first)",
      command: "docker compose up -d --no-build --pull never; docker compose ps",
      critical: true,
    },
    async () => {
      const u = upCommand(p);
      check(u.code === 0, u.stderr.slice(-400));
      attachSupport(p);
      await waitReady(p, 600_000);
      return {
        readyz: 200,
        ps: psAll(p).map((r) => `${r.service} ${r.state}`),
        images: recordImages(`${p.name}-start`, p).containers,
      };
    },
  );
}

phases.recover = async () => {
  const p = PROJECTS.recover;
  const meta = {
    ...UPGRADE,
    article: "upgrade (If the upgrade cannot be accepted) + backup-and-restore",
  };
  await restoreInto(p, state.preUpgradeBackup, BASELINE, { meta, keysFrom: "up" });
  await phases["recover-verify"]();
};
phases["recover-verify"] = async () => {
  const p = PROJECTS.recover;
  const meta = {
    ...UPGRADE,
    article: "upgrade (If the upgrade cannot be accepted) + backup-and-restore",
  };
  await verifyInstance(p, {
    meta,
    label: "recovery target",
    adminPw: password("upAdmin"),
    people: state.people,
    modern: false,
    fieldSplit: false,
    only: process.argv[3] ? process.argv[3].split(",") : null,
  });
  if (process.argv[3]) return;
  await step(
    {
      ...meta,
      action:
        "recovery target: work accepted after the backup is absent; the target runs the starting build; the migrated database was never opened by an older image",
    },
    async () => {
      const api = new Api(p.base);
      await api.signIn(state.people.admin.email, password("upAdmin"));
      const later = state.newUploads?.up;
      check(later, "no post-backup upload recorded");
      const docs = (await api.get(`/api/v1/contracts/${later.contract}/documents`)).documents;
      const present = docs.some((d) => d.id === later.id);
      const app = recordImages("recover", p).services.find((i) => i.container.includes("-app-"));
      const journal = psql(p, "select count(*) from drizzle.__drizzle_migrations");
      check(!present && app.tag === BASELINE, `present ${present}, tag ${app.tag}`);
      return `the Document uploaded on the upgraded instance after the backup is absent; app runs openlaw-local:${app.tag} (${app.id}); journal rows ${journal} (starting build); ${U.project} was not started on an older image`;
    },
  );
};

// ---------------------------------------------------------------- backup and restore (V-C47)

const R = PROJECTS.restore;

async function saveUploadLimit(page, base, value) {
  await page.goto(`${base}/settings/uploads`);
  await page.getByRole("heading", { name: "File uploads" }).first().waitFor({ timeout: 20_000 });
  await page.getByLabel("Maximum file size (MiB)").fill(String(value));
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await page
    .getByText("Settings saved. Restart the API and worker to apply changes.")
    .waitFor({ timeout: 15_000 });
  const hint = await page.locator("form p.text-xs").first().innerText();
  return hint;
}

phases["br-prepare"] = async () => {
  const p = U;
  const s = await browserSignIn(p.base, state.people.admin.email, password("upAdmin"));
  try {
    await step(
      {
        ...BACKUP,
        role: "administrator",
        method: "browser-walkthrough",
        action:
          "Fixture through the app: an Administrator saves Settings → Advanced → File uploads → Maximum file size (MiB) = 150",
        critical: true,
      },
      async () => {
        const hint = await saveUploadLimit(s.page, p.base, 150);
        const before = await systemStatus(s.page, p.base);
        must("docker compose restart app worker", p.dir, { timeout: 240_000 });
        await waitReady(p);
        await sleep(8000);
        const s2 = await browserSignIn(p.base, state.people.admin.email, password("upAdmin"));
        const after = await systemStatus(s2.page, p.base);
        await s2.context.close();
        state.restartRequiredObserved = before;
        return {
          savedNotice: "Settings saved. Restart the API and worker to apply changes.",
          sourceLabel: hint,
          systemStatusBeforeRestart: before,
          afterRestartAppWorker: after,
        };
      },
    );
    await step(
      {
        ...BACKUP,
        role: "administrator",
        method: "browser-walkthrough",
        action:
          "Before you start: record every Settings → Advanced field that shows Saved in OpenLaw, the source revision, images, database major version, project and storage",
        critical: true,
      },
      async () => {
        const s3 = await browserSignIn(p.base, state.people.admin.email, password("upAdmin"));
        const sources = await advancedSources(s3.page, p.base);
        await s3.context.close();
        const saved = Object.values(sources)
          .flat()
          .filter((l) => l.includes("[Saved in OpenLaw]"));
        check(
          saved.length === 1 && saved[0].startsWith("Maximum file size (MiB) = 150"),
          JSON.stringify(saved),
        );
        const pg = psql(p, "show server_version");
        const vapid = psql(p, "select vapid_private_key is not null from org_settings");
        const envVapid = envGet(p, "VAPID_PRIVATE_KEY");
        state.sourceRecord = {
          saved,
          revision: must("git rev-parse HEAD", p.dir).stdout.trim(),
          pg,
        };
        return {
          savedInOpenLaw: saved,
          sourceRevision: state.sourceRecord.revision,
          images: recordImages("backup-source", p).containers,
          postgres: pg,
          project: p.project,
          storage: sources["Document storage"],
          sealedVapidPrivateKeyInDatabase: vapid === "t",
          vapidInEnv: Boolean(envVapid),
          keysInSecretStore: Boolean(secrets.up?.AUTH_SECRET && secrets.up?.OPENLAW_SECRET_KEY),
        };
      },
    );
  } finally {
    await s.context.close();
  }
};

phases["br-backup"] = async () => {
  const p = U;
  const dir = path.join(WORK, "backups", "2026-09-25-source");
  await runBackup(p, dir, { meta: BACKUP, restart: true });
  state.sourceBackup = `${dir}-retained`;
  saveState();
};

phases["br-restore"] = async () => {
  const p = R;
  await step(
    { ...BACKUP, action: "Review restored destinations before starting app or worker" },
    () => {
      const relay = "smtp relay host op2-mail (owned Mailpit, controlled recipients)";
      const ai = "AI connector base URL http://op2-ai:8080/v1 (owned stand-in)";
      return `${relay}; ${ai}; no Signing connector or SSO provider configured; push_subscriptions in the source: ${psql(U, "select count(*) from push_subscriptions")}; the restore target joins only the owned relay and stand-in`;
    },
  );
  await restoreInto(p, state.sourceBackup, COMMIT, {
    meta: BACKUP,
    keysFrom: "up",
    extra:
      ROUND === 2
        ? { OPENLAW_PLAIN_HTTP_HOSTS: "op2-minio" }
        : { TRUSTED_PROXIES: "127.0.0.1,::1" },
  });
};

phases["br-verify"] = async (only) => {
  const p = R;
  await verifyInstance(p, {
    meta: BACKUP,
    label: "restored target",
    adminPw: password("upAdmin"),
    people: state.people,
    only: only ? only.split(",") : null,
  });
  if (only && !only.split(",").includes("final")) return;
  await step(
    {
      ...BACKUP,
      role: "administrator",
      method: "browser-walkthrough",
      action:
        "restored target: Instance address shows the target origin; Document storage names the restored store; env-set fields show Deployment configuration · Read only; the saved upload limit travelled in the dump",
    },
    async () => {
      const s = await browserSignIn(p.base, state.people.admin.email, password("upAdmin"));
      const src = await advancedSources(s.page, p.base);
      const st = await systemStatus(s.page, p.base, ROUND === 2);
      await s.context.close();
      const inst = src["Instance address"][0];
      check(
        inst === `Application address = ${p.base} [Deployment configuration · Read only]`,
        inst,
      );
      check(
        src["File uploads"][0] === "Maximum file size (MiB) = 150 [Saved in OpenLaw]",
        src["File uploads"][0],
      );
      const wantStorage = ROUND === 2 ? "Active storage: s3" : "Active storage: local";
      let s3Doc = null;
      if (ROUND === 2) {
        const s2 = await browserSignIn(p.base, state.people.admin.email, password("upAdmin"));
        const r = await s2.request(
          "GET",
          `/api/v1/documents/${state.s3Doc.documentId}/versions/${state.s3Doc.versionId}/download`,
        );
        await s2.context.close();
        s3Doc = `${r.status}${r.status === 200 && sha256(r.buffer) === state.s3Doc.sha256 ? ", SHA-256 matches" : ""}`;
        check(s3Doc.endsWith("matches"), `S3 Document ${s3Doc}`);
      }
      check(st.activeStorage === wantStorage && processRowsOk(st), JSON.stringify(st));
      return {
        instance: src["Instance address"],
        uploads: src["File uploads"],
        storage: src["Document storage"].filter((l) => !/secret/i.test(l)),
        systemStatus: st,
        ...(s3Doc
          ? {
              documentOnlyInTheSavedBucket: s3Doc,
              note: "The target's .env leaves the storage keys empty, so the source's saved S3 values apply and the target reads the source's live bucket, as the guide warns.",
            }
          : {}),
      };
    },
  );
};

phases["br-negatives"] = async () => {
  const p = R;
  const good = secrets.up.OPENLAW_SECRET_KEY;
  await step(
    {
      ...BACKUP,
      action:
        "Negative: missing OPENLAW_SECRET_KEY on the target is refused; supplying the retained key recovers",
      expected:
        "Startup reports a missing key: supply the retained required keys to both app and worker, then recreate them.",
    },
    async () => {
      envSet(p, "OPENLAW_SECRET_KEY", null);
      const q = sh("docker compose config --quiet", p.dir);
      const u = sh(
        "docker compose up -d --no-build --pull never --force-recreate app worker",
        p.dir,
      );
      envSet(p, "OPENLAW_SECRET_KEY", good);
      recreate(p);
      await waitReady(p);
      check(q.code !== 0 && u.code !== 0, `config ${q.code} up ${u.code}`);
      return `config --quiet exit ${q.code}: "${lines(q.stderr, /OPENLAW_SECRET_KEY/, 1).join("")}"; up exit ${u.code}; retained key supplied, app and worker recreated, readyz 200`;
    },
  );
  await step(
    {
      ...BACKUP,
      action:
        "Negative: a wrong OPENLAW_SECRET_KEY with saved Advanced settings: app and worker keep restarting; the retained key recovers",
      expected:
        "App and worker keep restarting with Advanced settings cannot be decrypted; supply the retained key and recreate both services.",
    },
    async () => {
      envSet(p, "OPENLAW_SECRET_KEY", randomBytes(32).toString("base64"));
      recreate(p);
      await sleep(45_000);
      const app = sh("docker compose logs --no-log-prefix app", p.dir).stdout;
      const worker = sh("docker compose logs --no-log-prefix worker", p.dir).stdout;
      const states = ["app", "worker"].map(
        (svc) =>
          `${svc} ${sh(`docker inspect --format '{{.RestartCount}} {{.State.Status}}' $(docker compose ps -aq ${svc})`, p.dir).stdout.trim()}`,
      );
      const ready = await http(`${p.base}/readyz`);
      const appDecrypt = lines(app, /Advanced settings cannot be decrypted/, 1);
      const workerDecrypt = lines(worker, /Advanced settings cannot be decrypted/, 1);
      const noKey = lines(app, /No configured key opens these stored credentials/, 1);
      envSet(p, "OPENLAW_SECRET_KEY", good);
      recreate(p);
      await waitReady(p);
      check(
        appDecrypt.length && workerDecrypt.length && ready.status !== 200,
        JSON.stringify({ appDecrypt, workerDecrypt, ready: ready.status }),
      );
      return {
        restartCountsAndStates: states,
        readyz: ready.status,
        appLine: appDecrypt,
        workerLine: workerDecrypt,
        appNoConfiguredKeyLine: noKey,
        recovery: "retained key supplied; app and worker recreated; readyz 200",
      };
    },
  );
  await step(
    {
      ...BACKUP,
      action:
        "Negative: a wrong OPENLAW_SECRET_KEY with no saved Advanced settings: start log names unreadable columns; saved credentials unavailable; the retained key recovers",
      expected:
        "The app log says No configured key opens these stored credentials and names columns such as vapid_private_key; without a VAPID pair in .env it also logs Device notifications are off until the VAPID pair can be read.",
    },
    async () => {
      const reset = must(
        "docker compose run -T --rm --no-deps app node apps/api/dist/reset-advanced-settings.js uploads",
        p.dir,
      ).stdout.trim();
      envSet(p, "OPENLAW_SECRET_KEY", randomBytes(32).toString("base64"));
      const t = new Date().toISOString();
      recreate(p);
      await waitReady(p);
      await sleep(3000);
      const app = sh(`docker compose logs --no-log-prefix --since ${t} app`, p.dir).stdout;
      const noKey = lines(app, /No configured key opens these stored credentials/, 1);
      const vapid = lines(app, /Device notifications are off until the VAPID pair can be read/, 1);
      const s = await browserSignIn(p.base, state.people.admin.email, password("upAdmin"));
      const email = await s.request("GET", "/api/v1/email-settings");
      const test = await s.request("POST", "/api/v1/email-settings/test");
      const ai = await s.request("POST", "/api/v1/ai-connector/test");
      const read = await s.request(
        "GET",
        `/api/v1/contracts/${state.inventory.contracts[0].number}`,
      );
      await s.context.close();
      envSet(p, "OPENLAW_SECRET_KEY", good);
      recreate(p);
      await waitReady(p);
      const s2 = await browserSignIn(p.base, state.people.admin.email, password("upAdmin"));
      const t0 = Date.now();
      const test2 = await s2.request("POST", "/api/v1/email-settings/test");
      const mail = await waitMail(
        (m) =>
          toAddress(m, state.people.admin.email) &&
          m.Subject === "OpenLaw test email" &&
          since(m, t0),
      );
      const s2page = await saveUploadLimit(s2.page, p.base, 150);
      await s2.context.close();
      must("docker compose restart app worker", p.dir, { timeout: 240_000 });
      await waitReady(p);
      check(
        noKey.length &&
          /vapid_private_key/.test(noKey[0]) &&
          vapid.length &&
          email.body?.source === "unset" &&
          test.status >= 400 &&
          read.status === 200 &&
          test2.status === 200 &&
          mail,
        JSON.stringify({
          noKey,
          vapid,
          email: email.body?.source,
          test: test.status,
          read: read.status,
          test2: test2.status,
        }),
      );
      return {
        resetUploadsWithCorrectKey: reset,
        appLog: [...noKey, ...vapid],
        emailSettingsSource: email.body?.source,
        testSend: `${test.status} ${test.body?.detail ?? ""}`,
        aiTest: `${ai.status} ${ai.body?.detail ?? ""}`.slice(0, 200),
        unrelatedContractRead: read.status,
        afterRetainedKey: `test ${test2.status}; delivered`,
        uploadLimitSavedAgain: s2page,
      };
    },
  );
  await step(
    {
      ...BACKUP,
      action:
        "Negative: a missing file is detected (Document listed, download fails); reapplying the file backup restores the bytes",
      expected:
        "A Document is listed but its download fails: reapply the correct file backup to the isolated target, then compare hashes.",
    },
    async () => {
      const d = state.inventory.documents[1];
      const v = d.versions[0];
      const ref = psql(p, `select file_ref from document_versions where id = '${v.id}'`);
      const rel = ref.replace(/^local:/, "");
      must(
        `docker compose run -T --rm --no-deps app sh -c 'rm -f "/var/lib/openlaw/files/${rel}"'`,
        p.dir,
      );
      const s = await browserSignIn(p.base, state.people.admin.email, password("upAdmin"));
      const listed = (
        await s.request("GET", `/api/v1/contracts/${d.contract}/documents`)
      ).body.documents.some((x) => x.id === d.id);
      const missing = await s.request("GET", `/api/v1/documents/${d.id}/versions/${v.id}/download`);
      must(
        'docker compose run -T --rm --no-deps app tar -xzf - -C /var/lib/openlaw/files < "$BACKUP_DIR/files.tar.gz"',
        p.dir,
        { env: { BACKUP_DIR: state.sourceBackup } },
      );
      const back = await s.request("GET", `/api/v1/documents/${d.id}/versions/${v.id}/download`);
      await s.context.close();
      check(
        listed && missing.status !== 200 && back.status === 200 && sha256(back.buffer) === v.sha256,
        JSON.stringify({ listed, missing: missing.status, back: back.status }),
      );
      return {
        documentListed: listed,
        downloadWithFileMissing:
          `${missing.status} ${missing.body?.detail ?? missing.body?.title ?? ""}`.slice(0, 160),
        afterReapplyingFiles: `200, SHA-256 ${v.sha256.slice(0, 16)} matches`,
      };
    },
  );
  await step(
    { ...BACKUP, action: "Negative: a backup archive alone never counts as a restore" },
    () =>
      `The backup was accepted only after the restored target ${p.project} signed in, refused the Confidential record to lower-access accounts, matched every Version hash, processed a new upload, sent through the restored relay, passed Test connection with the restored AI key, and showed API and Worker Running and Current.`,
  );
};

phases["br-wrongkey"] = async () => {
  const p = R;
  const good = secrets.up.OPENLAW_SECRET_KEY;
  await step(
    {
      ...BACKUP,
      action:
        "Negative (repeat, observed in detail): a wrong OPENLAW_SECRET_KEY on a target whose dump carries saved Advanced settings",
      expected:
        "backup-and-restore 'If verification fails': App and worker keep restarting with Advanced settings cannot be decrypted; supply the retained key and recreate both services.",
    },
    async () => {
      const before = psql(p, "select advanced_settings is not null from org_settings");
      envSet(p, "OPENLAW_SECRET_KEY", randomBytes(32).toString("base64"));
      const t = new Date().toISOString();
      recreate(p);
      await sleep(40_000);
      const ready = await http(`${p.base}/readyz`);
      const app = sh(`docker compose logs --no-log-prefix --since ${t} app`, p.dir).stdout;
      const worker = sh(`docker compose logs --no-log-prefix --since ${t} worker`, p.dir).stdout;
      const states = ["app", "worker"].map(
        (svc) =>
          `${svc} ${sh(`docker inspect --format '{{.RestartCount}} {{.State.Status}}' $(docker compose ps -aq ${svc})`, p.dir).stdout.trim()}`,
      );
      const s = await browserSignIn(p.base, state.people.admin.email, password("upAdmin"));
      const uploads = (await advancedSources(s.page, p.base))["File uploads"];
      await s.context.close();
      const reset = sh(
        "docker compose run -T --rm --no-deps app node apps/api/dist/reset-advanced-settings.js instance",
        p.dir,
      );
      envSet(p, "OPENLAW_SECRET_KEY", good);
      recreate(p);
      await waitReady(p);
      const s2 = await browserSignIn(p.base, state.people.admin.email, password("upAdmin"));
      const uploadsAfter = (await advancedSources(s2.page, p.base))["File uploads"];
      await s2.context.close();
      const observed = {
        advancedSettingsStored: before === "t",
        restartCountsAndStates: states,
        readyz: ready.status,
        cannotBeDecryptedInAppLog: app.includes("Advanced settings cannot be decrypted"),
        cannotBeDecryptedInWorkerLog: worker.includes("Advanced settings cannot be decrypted"),
        appStartLines: lines(app, /No configured key opens|Device notifications are off/, 2),
        fileUploadsPageWithWrongKey: uploads,
        resetCommandWithWrongKey: `exit ${reset.code}: ${(reset.stdout + reset.stderr).trim().split("\n").pop()}`,
        fileUploadsAfterRetainedKey: uploadsAfter,
      };
      guideFailure(
        "backup-and-restore",
        "If verification fails, row 'App and worker keep restarting with Advanced settings cannot be decrypted'",
        "A target whose OPENLAW_SECRET_KEY cannot open the settings saved in Settings → Advanced keeps restarting app and worker with 'Advanced settings cannot be decrypted'.",
        `With saved Advanced settings in the dump (File uploads 150, Saved in OpenLaw) and a wrong key, app and worker started and stayed up (${states.join(", ")}, readyz ${ready.status}); neither log had 'Advanced settings cannot be decrypted'. The app logged only 'No configured key opens these stored credentials: ... advanced_settings (1) ...'. File uploads silently showed ${uploads.join("; ")}. The unreadable column reads as an empty string (UNREADABLE_SECRET), which parseSettings treats as no saved settings.`,
      );
      check(observed.cannotBeDecryptedInAppLog && ready.status !== 200, JSON.stringify(observed));
      return observed;
    },
  );
};

// ---------------------------------------------------------------- troubleshooting (V-C48) on the upgraded installation

const D = PROJECTS.up;
const MINIO_NAME = "openlaw-doc030-op2-minio";
const MINIO_PORT = ROUND === 2 ? 24653 : 24603;
const adminLogin = () => browserSignIn(D.base, state.people.admin.email, password("upAdmin"));
const restarts = (p, svc) =>
  sh(
    `docker inspect --format '{{.RestartCount}} {{.State.Status}} OOMKilled={{.State.OOMKilled}}' $(docker compose ps -aq ${svc})`,
    p.dir,
  ).stdout.trim();

phases["diag-baseline"] = async () => {
  const p = D;
  await step(
    {
      ...DIAG,
      action:
        "Baseline health before any fault: Start with the observed failure, the three commands",
      command:
        "docker compose config --quiet; docker compose ps --all; docker compose logs --since=10m app worker",
      critical: true,
    },
    async () => {
      const cfg = sh("docker compose config --quiet", p.dir);
      const ps = psAll(p).map((r) => `${r.service} ${r.state}${r.health ? ` ${r.health}` : ""}`);
      const logs = must("docker compose logs --since=10m app worker", p.dir).stdout;
      const s = await adminLogin();
      const st = await systemStatus(s.page, p.base);
      await s.context.close();
      const h = await http(`${p.base}/healthz`);
      const r = await http(`${p.base}/readyz`);
      check(
        cfg.code === 0 && cfg.stdout.trim() === "" && processRowsOk(st),
        JSON.stringify({ cfg: cfg.code, st }),
      );
      return {
        configQuiet: `exit ${cfg.code}, no output`,
        psAll: ps,
        healthz: h.status,
        readyz: r.status,
        systemStatus: st,
        logLines: logs.split("\n").length,
      };
    },
  );
  await step(
    {
      ...DIAG,
      action:
        "What logs carry: a request line has the path without its query string and no headers",
      expected: "A request line carries the path without its query string and no headers.",
    },
    async () => {
      const marker = `doc030marker${Date.now()}`;
      await http(`${p.base}/api/v1/contracts?token=${marker}&q=${marker}`, {
        headers: { authorization: `Bearer ${marker}`, "x-doc030": marker },
      });
      await sleep(1500);
      const logs = must("docker compose logs --no-log-prefix --since 30s app", p.dir).stdout;
      const line = logs.split("\n").find((l) => l.includes('"path":"/api/v1/contracts"'));
      check(
        line && !logs.includes(marker),
        `line ${line?.slice(0, 200)}; marker in logs ${logs.includes(marker)}`,
      );
      return `request line: ${line.slice(0, 220)}; the marker sent in the query string, an Authorization header and a custom header appears nowhere in the log`;
    },
  );
};

phases["diag-startup"] = async () => {
  const p = D;
  const good = {
    AUTH_SECRET: secrets.up.AUTH_SECRET,
    OPENLAW_SECRET_KEY: secrets.up.OPENLAW_SECRET_KEY,
  };
  await step(
    {
      ...DIAG,
      action:
        "Startup refuses a missing key: Compose refuses config and up for either key; restore",
      expected: "Compose refuses the command when either key is missing.",
    },
    () => {
      const out = {};
      for (const key of Object.keys(good)) {
        const before = psAll(p)
          .map((c) => c.id)
          .sort()
          .join();
        envSet(p, key, null);
        const cfg = sh("docker compose config --quiet", p.dir);
        const up = sh("docker compose up -d --no-build --pull never", p.dir);
        envSet(p, key, good[key]);
        const after = psAll(p)
          .map((c) => c.id)
          .sort()
          .join();
        check(
          cfg.code !== 0 && up.code !== 0 && before === after,
          `${key}: ${cfg.code} ${up.code}`,
        );
        out[key] =
          `config --quiet exit ${cfg.code} (${lines(cfg.stderr, new RegExp(key), 1)[0]?.slice(0, 120)}); up exit ${up.code}; containers unchanged`;
      }
      return out;
    },
  );
  await step(
    {
      ...DIAG,
      action:
        "Short OPENLAW_SECRET_KEY: config passes; app and worker refuse to start; supply the intended key, config --quiet, recreate, check startup",
    },
    async () => {
      envSet(p, "OPENLAW_SECRET_KEY", "short-key-under-32-chars");
      const cfg = sh("docker compose config --quiet", p.dir);
      const t = new Date().toISOString();
      recreate(p);
      await sleep(25_000);
      const appL = lines(
        sh(`docker compose logs --no-log-prefix --since ${t} app`, p.dir).stdout,
        /OPENLAW_SECRET_KEY/,
        1,
      );
      const wL = lines(
        sh(`docker compose logs --no-log-prefix --since ${t} worker`, p.dir).stdout,
        /OPENLAW_SECRET_KEY/,
        1,
      );
      const ready = await http(`${p.base}/readyz`);
      const st = [restarts(p, "app"), restarts(p, "worker")];
      envSet(p, "OPENLAW_SECRET_KEY", good.OPENLAW_SECRET_KEY);
      const cfg2 = sh("docker compose config --quiet", p.dir);
      recreate(p);
      await waitReady(p);
      check(
        cfg.code === 0 && appL.length && wL.length && ready.status !== 200 && cfg2.code === 0,
        JSON.stringify({ cfg: cfg.code, appL, wL, ready: ready.status }),
      );
      return {
        configQuietWithShortKey: cfg.code,
        readyz: ready.status,
        restartCounts: st,
        app: appL,
        worker: wL,
        recovery: "intended key supplied; config --quiet exit 0; recreated; readyz 200",
      };
    },
  );
  await step(
    {
      ...DIAG,
      action:
        "Short AUTH_SECRET: only a warning is logged and the app starts; restore the retained value",
    },
    async () => {
      envSet(p, "AUTH_SECRET", "short-auth-secret");
      const t = new Date().toISOString();
      recreate(p);
      const ready = await waitReady(p)
        .then(() => 200)
        .catch(() => 0);
      const warn = lines(
        sh(`docker compose logs --no-log-prefix --since ${t} app`, p.dir).stdout,
        /secret/i,
        2,
      );
      envSet(p, "AUTH_SECRET", good.AUTH_SECRET);
      recreate(p);
      await waitReady(p);
      check(ready === 200 && warn.length, `ready ${ready} warn ${warn}`);
      return { readyz: ready, warning: warn };
    },
  );
  await step(
    {
      ...DIAG,
      action:
        "Port is already allocated: failed bind; ps --all shows app and worker created; plain ps omits them; correct PORT and run the same up",
      expected:
        "After a failed bind, docker compose ps --all shows the app and worker containers in the created state. Plain docker compose ps does not list them.",
    },
    async () => {
      envSet(p, "PORT", String(OCCUPIED_PORT));
      const up = sh("docker compose up -d --no-build --pull never", p.dir, { timeout: 300_000 });
      const all = psAll(p).map((r) => `${r.service} ${r.state}`);
      const plain = sh("docker compose ps --format '{{.Service}} {{.State}}'", p.dir)
        .stdout.trim()
        .split("\n");
      const other = await http(`http://127.0.0.1:${OCCUPIED_PORT}/`);
      envSet(p, "PORT", String(p.port));
      const up2 = sh("docker compose up -d --no-build --pull never", p.dir, { timeout: 300_000 });
      await waitReady(p);
      check(
        up.code !== 0 &&
          all.includes("app created") &&
          all.includes("worker created") &&
          !plain.some((l) => /^(app|worker) /.test(l)) &&
          other.status === 200 &&
          up2.code === 0,
        JSON.stringify({ all, plain }),
      );
      return {
        upExit: up.code,
        error: lines(up.stderr, /allocated/, 1).map((l) => l.replace(/[0-9a-f]{12,}/g, "…")),
        psAll: all,
        plainPs: plain,
        unrelatedListener: other.status,
        recovery: `PORT restored; same up exit ${up2.code}; readyz 200`,
      };
    },
  );
  await step(
    {
      ...DIAG,
      action:
        "App keeps restarting: a memory ceiling too small; docker inspect OOMKilled; raise APP_MEM_LIMIT and recreate",
      command: `docker inspect --format '{{.State.OOMKilled}}' "$(docker compose ps --all -q app)"`,
    },
    async () => {
      envSet(p, "APP_MEM_LIMIT", "64m");
      recreate(p, "app");
      let oom = "false";
      let st = "";
      for (let i = 0; i < 30 && oom !== "true"; i += 1) {
        await sleep(3000);
        oom = sh(
          `docker inspect --format '{{.State.OOMKilled}}' "$(docker compose ps --all -q app)"`,
          p.dir,
        ).stdout.trim();
        st = restarts(p, "app");
      }
      const ready = await http(`${p.base}/readyz`);
      envSet(p, "APP_MEM_LIMIT", null);
      recreate(p, "app");
      await waitReady(p);
      const oom2 = sh(
        `docker inspect --format '{{.State.OOMKilled}}' "$(docker compose ps --all -q app)"`,
        p.dir,
      ).stdout.trim();
      return {
        withAppMemLimit64m: { oomKilled: oom, restartsAndState: st, readyz: ready.status },
        afterRaising: `APP_MEM_LIMIT removed (default 1g); OOMKilled ${oom2}; readyz 200`,
      };
    },
  );
  await step(
    {
      ...DIAG,
      action:
        "/healthz works but /readyz fails: database stopped; restore; verify a record read and write",
    },
    async () => {
      must("docker compose stop postgres", p.dir);
      await sleep(4000);
      const h = await http(`${p.base}/healthz`);
      const r = await http(`${p.base}/readyz`);
      must("docker compose start postgres", p.dir);
      await waitReady(p);
      const s = await adminLogin();
      const n = state.inventory.contracts[1].number;
      const read = await s.request("GET", `/api/v1/contracts/${n}`);
      const write = await s.request("PATCH", `/api/v1/contracts/${n}`, {
        description: `DOC-030 operator-2 diag write ${new Date().toISOString()}`,
      });
      await s.context.close();
      check(
        h.status === 200 && r.status !== 200 && read.status === 200 && write.status === 200,
        `${h.status} ${r.status} ${read.status} ${write.status}`,
      );
      return `healthz ${h.status}; readyz ${r.status}; after start: readyz 200, read ${read.status}, write ${write.status}`;
    },
  );
};

phases["diag-cproxy"] = async () => {
  const p = D;
  await step(
    {
      ...DIAG,
      action:
        "The proxy cannot connect to the app: a proxy in a container answers 502 against 127.0.0.1; APP_BIND to an address it reaches fixes it; restore",
      command: "docker compose port app 3000",
    },
    async () => {
      const port0 = must("docker compose port app 3000", p.dir).stdout.trim();
      const conf = path.join(WORK, "cproxy.conf");
      writeFileSync(
        conf,
        `events {}\nhttp {\n  server {\n    listen 80;\n    location / {\n      proxy_pass http://host.docker.internal:${p.port};\n      proxy_set_header Host $http_host;\n      proxy_set_header X-Forwarded-For $remote_addr;\n      proxy_set_header X-Forwarded-Proto $scheme;\n    }\n  }\n}\n`,
        { mode: 0o644 },
      );
      sh(`docker rm -f ${CPROXY_NAME}`, root);
      must(
        `docker run -d --name ${CPROXY_NAME} --label openlaw-doc030-owner=operator-2 --add-host host.docker.internal:host-gateway -p 127.0.0.1:${CPROXY_PORT}:80 -v ${conf}:/etc/nginx/nginx.conf:ro nginx:1.27-alpine`,
        root,
      );
      await sleep(2000);
      let before;
      for (let i = 0; i < 20; i += 1) {
        before = await http(`http://127.0.0.1:${CPROXY_PORT}/readyz`, { timeoutMs: 90_000 });
        if (before.status !== 0) break;
        await sleep(1000);
      }
      const gw = must(
        "docker network inspect bridge --format '{{(index .IPAM.Config 0).Gateway}}'",
        root,
      ).stdout.trim();
      envSet(p, "APP_BIND", gw);
      recreate(p, "app");
      await sleep(3000);
      const port1 = must("docker compose port app 3000", p.dir).stdout.trim();
      let after;
      for (let i = 0; i < 30; i += 1) {
        after = await http(`http://127.0.0.1:${CPROXY_PORT}/readyz`);
        if (after.status === 200) break;
        await sleep(2000);
      }
      envSet(p, "APP_BIND", null);
      recreate(p, "app");
      await waitReady(p);
      const port2 = must("docker compose port app 3000", p.dir).stdout.trim();
      sh(`docker rm -f ${CPROXY_NAME}`, root);
      const proxyLog = lines(
        sh(`docker logs ${CPROXY_NAME} 2>&1`, root).stdout,
        /upstream|connect/,
        1,
      );
      check(
        port0 === `127.0.0.1:${p.port}` &&
          [502, 504].includes(before.status) &&
          after.status === 200 &&
          port2 === port0,
        JSON.stringify({ port0, before: before.status, port1, after: after.status }),
      );
      sh(`docker rm -f ${CPROXY_NAME}`, root);
      return {
        portDefault: port0,
        containerProxyBefore: before.status,
        proxyErrorLine: proxyLog.map((l) => l.replace(/^\S+ \S+ /, "")),
        appBind: `APP_BIND=${gw} (the docker0 bridge address, reachable only from containers and this host)`,
        portAfter: port1,
        containerProxyAfter: after.status,
        restored: `APP_BIND removed; port ${port2}`,
        notTested: "the host network rule that admits only the proxy",
      };
    },
  );
};

phases["diag-origin"] = async () => {
  const p = D;
  const wrong = "http://127.0.0.1:24699";
  await step(
    {
      ...DIAG,
      role: "administrator",
      method: "browser-walkthrough",
      action:
        "Sign-in fails behind a saved Application address: Instance address shows its source; BASE_URL pins over a saved value; the saved instance setting is removed with the recovery command",
      expected:
        "Instance address shows Deployment configuration, Saved in OpenLaw or Default. BASE_URL in .env pins the address over a saved one. If nobody can sign in, remove the saved instance setting.",
    },
    async () => {
      const out = {};
      if (envGet(p, "BASE_URL") !== p.base) {
        envSet(p, "BASE_URL", p.base);
        recreate(p);
        await waitReady(p);
      }
      let s = await adminLogin();
      out.withBaseUrl = (await advancedSources(s.page, p.base))["Instance address"];
      await s.context.close();
      envSet(p, "BASE_URL", null);
      recreate(p);
      await waitReady(p);
      // Fixture: with BASE_URL unset the Default address is http://localhost:3000, which this host cannot
      // serve (port 3000 is taken), so the reviewer saves the instance's real address through the API with
      // that Origin, as an Administrator on the default address would.
      let fx = new Api(p.base, "http://localhost:3000");
      const tryDefault = await fx.raw("POST", "/api/auth/sign-in/email", {
        json: { email: state.people.admin.email, password: password("upAdmin") },
      });
      if (tryDefault.status !== 200) {
        fx = new Api(p.base);
        await fx.signIn(state.people.admin.email, password("upAdmin"));
      }
      const cur = await fx.get("/api/v1/advanced-settings/instance");
      out.withoutBaseUrlApi = cur.fields.map(
        (f) => `${f.key} value ${f.value} source ${f.source} locked ${f.locked}`,
      );
      await fx.put("/api/v1/advanced-settings/instance", {
        version: cur.version,
        values: { BASE_URL: p.base },
      });
      must("docker compose restart app worker", p.dir, { timeout: 240_000 });
      await waitReady(p);
      s = await adminLogin();
      out.withoutBaseUrl = (await advancedSources(s.page, p.base))["Instance address"];
      await s.page.goto(`${p.base}/settings/instance`);
      await s.page.getByLabel("Application address").fill(wrong);
      await s.page.getByRole("button", { name: "Save", exact: true }).click();
      await s.page
        .getByText("Settings saved. Restart the API and worker to apply changes.")
        .waitFor({ timeout: 15_000 });
      await s.context.close();
      must("docker compose restart app worker", p.dir, { timeout: 240_000 });
      await waitReady(p);
      const api = new Api(p.base);
      const refused = await api.raw("POST", "/api/auth/sign-in/email", {
        json: { email: state.people.admin.email, password: password("upAdmin") },
      });
      out.signInWithSavedWrongAddress = `${refused.status} ${refused.buffer.toString().slice(0, 140)}`;
      // First recovery the guide offers: pin BASE_URL in .env.
      envSet(p, "BASE_URL", p.base);
      must("docker compose up -d --no-build --pull never", p.dir, { timeout: 240_000 });
      await waitReady(p);
      s = await adminLogin();
      out.pinnedByEnv = (await advancedSources(s.page, p.base))["Instance address"];
      await s.context.close();
      // Second recovery: remove the saved instance value with the command, with BASE_URL unset again.
      envSet(p, "BASE_URL", null);
      recreate(p);
      await waitReady(p);
      const before = await new Api(p.base).raw("POST", "/api/auth/sign-in/email", {
        json: { email: state.people.admin.email, password: password("upAdmin") },
      });
      const t = new Date().toISOString();
      const reset = sh(
        "docker compose run -T --rm --no-deps app node apps/api/dist/reset-advanced-settings.js instance",
        p.dir,
      );
      must("docker compose restart app worker", p.dir, { timeout: 240_000 });
      await waitReady(p);
      const after = await new Api(p.base, "http://localhost:3000").raw(
        "POST",
        "/api/auth/sign-in/email",
        { json: { email: state.people.admin.email, password: password("upAdmin") } },
      );
      const atPublic = await new Api(p.base).raw("POST", "/api/auth/sign-in/email", {
        json: { email: state.people.admin.email, password: password("upAdmin") },
      });
      out.signInAfterResetAtPublicAddress = atPublic.status;
      if (atPublic.status !== 200)
        guideFailure(
          "operator-troubleshooting",
          "Startup, origin, and database: row 'Sign-in or emailed links fail behind the proxy' ('If nobody can sign in to change a saved address, remove the saved instance setting ... test sign-in ... through the public address')",
          "Removing the saved instance setting lets people sign in through the public address again.",
          `With BASE_URL unset, removing the saved Application address returns Instance address to its Default, http://localhost:3000. Sign-in through the public address ${p.base} still answered ${atPublic.status} ("Invalid origin"). Only setting BASE_URL (the row's first recovery) restored sign-in at the public address; the removal alone helps only an operator who can reach http://localhost:3000.`,
        );
      const leaked =
        secretValues().some((v) => reset.stdout.includes(v)) || reset.stdout.includes(wrong);
      const fx2 = new Api(p.base, "http://localhost:3000");
      await fx2.signIn(state.people.admin.email, password("upAdmin"));
      out.afterReset = (await fx2.get("/api/v1/advanced-settings/instance")).fields.map(
        (f) => `${f.key} = ${f.value} [${f.source}]`,
      );
      const audit = psql(
        p,
        "select payload->>'field' || ' ' || (payload->>'new') from activity_log where action = 'org_settings.updated' order by created_at desc limit 1",
      );
      envSet(p, "BASE_URL", p.base);
      recreate(p);
      await waitReady(p);
      out.signInBeforeReset = before.status;
      out.resetCommand = `exit ${reset.code}: ${reset.stdout.trim().split("\n").pop()}`;
      out.resetPrintedSavedValue = leaked;
      out.signInAfterResetAtDefaultAddress = `${after.status} (Origin http://localhost:3000, the Default Application address, because BASE_URL was unset)`;
      out.auditEntry = audit;
      out.restored = "BASE_URL pinned again";
      void t;
      check(
        refused.status !== 200 &&
          reset.code === 0 &&
          after.status === 200 &&
          !leaked &&
          out.afterReset[0].endsWith("[default]"),
        JSON.stringify(out),
      );
      return out;
    },
  );
};

phases["diag-trust"] = async () => {
  const p = I;
  await step(
    {
      ...DIAG,
      action:
        "Password sign-in refuses people who did not enter a wrong password: the TRUSTED_PROXIES is not set warning; set it to the proxy's own address; the warning is gone; sign in from two client addresses",
      expected:
        "Set TRUSTED_PROXIES to the proxy's own address. Recreate the app, check that the warning is gone, and sign in from two client addresses.",
    },
    async () => {
      envSet(p, "TRUSTED_PROXIES", null);
      let t = new Date().toISOString();
      recreate(p, "app");
      await waitReady(p);
      const warn = lines(
        sh(`docker compose logs --no-log-prefix --since ${t} app`, p.dir).stdout,
        /TRUSTED_PROXIES is not set/,
        1,
      );
      await sleep(12_000);
      const probe = async () => {
        const wrongs = [];
        for (let i = 0; i < 4; i += 1)
          wrongs.push(
            (
              await viaProxy("POST", "/api/auth/sign-in/email", {
                json: { email: "nobody@doc030-install.example", password: "nope" },
                localAddress: "127.0.0.2",
              })
            ).status,
          );
        const right = await viaProxy("POST", "/api/auth/sign-in/email", {
          json: { email: "avery.morgan@doc030-install.example", password: password("instAdmin") },
          localAddress: "127.0.0.1",
        });
        return { wrongFrom127_0_0_2: wrongs, rightFrom127_0_0_1: right.status };
      };
      const unset = await probe();
      envSet(p, "TRUSTED_PROXIES", "127.0.0.1,::1");
      t = new Date().toISOString();
      recreate(p, "app");
      await waitReady(p);
      const warn2 = lines(
        sh(`docker compose logs --no-log-prefix --since ${t} app`, p.dir).stdout,
        /TRUSTED_PROXIES is not set/,
        1,
      );
      await sleep(12_000);
      const set = await probe();
      const seen = [
        ...new Set(
          sh("docker compose logs --no-log-prefix --since 40s app", p.dir)
            .stdout.split("\n")
            .filter((l) => l.includes("sign-in/email"))
            .map((l) => l.match(/"remoteAddress":"([^"]+)"/)?.[1])
            .filter(Boolean),
        ),
      ];
      if (set.rightFrom127_0_0_1 === 429)
        guideFailure(
          "operator-troubleshooting",
          "Startup, origin, and database: row 'Password sign-in refuses people who did not enter a wrong password'",
          "Setting TRUSTED_PROXIES to the proxy's own address removes the warning and lets two client addresses sign in independently.",
          `With a same-host Caddy proxy, TRUSTED_PROXIES=127.0.0.1,::1 removed the warning, but four wrong passwords from 127.0.0.2 still made the next correct sign-in from 127.0.0.1 answer 429. The app sees the proxy at ${seen.join(", ")} (the Docker bridge gateway), so the proxy's own address is not what the app must trust.`,
        );
      check(
        warn.length && !warn2.length && set.rightFrom127_0_0_1 === 200,
        JSON.stringify({ warn, warn2, unset, set, seen }),
      );
      return {
        warningWhenUnset: warn,
        withUnset: unset,
        warningAfterSetting: warn2,
        withGuideValue: set,
        remoteAddressSeen: seen,
      };
    },
  );
};

phases["diag-live"] = async () => {
  const p = D;
  await step(
    {
      ...DIAG,
      role: "administrator",
      method: "browser-walkthrough",
      action:
        "Live updates: one person holds at most five streams; a sixth closes the oldest; a change from a second signed-in browser arrives on an open stream",
    },
    async () => {
      const s = await adminLogin();
      const other = await browserSignIn(p.base, state.people.reader.email, password("up-reader"));
      const c = state.inventory.contracts[0];
      await s.page.goto(`${p.base}/contracts/${c.number}`);
      await s.page.waitForLoadState("networkidle").catch(() => {});
      await s.page.evaluate((id) => {
        window.__d = { streams: [] };
        for (let i = 0; i < 6; i += 1) {
          const rec = { i, opened: false, errors: 0, frames: 0 };
          window.__d.streams.push(rec);
          const es = new EventSource(`/api/events?entityType=contract&entityId=${id}`);
          es.onopen = () => (rec.opened = true);
          es.onerror = () => (rec.errors += 1);
          es.addEventListener("record", () => (rec.frames += 1));
        }
      }, c.id);
      await sleep(6000);
      const posted = await other.request("POST", "/api/v1/comments", {
        entityType: "contract",
        entityId: c.id,
        body: `DOC-030 operator-2 live check ${Date.now()}`,
        visibility: "working_team",
      });
      await sleep(6000);
      const streams = await s.page.evaluate(() => window.__d.streams);
      await s.context.close();
      await other.context.close();
      return {
        streamsInOneTab: streams,
        commentPosted: posted.status,
        note: "The app page itself holds its own stream too, so six opened here plus the page's own exceed five for one person; errors count reconnects after the hub closed the oldest streams.",
      };
    },
  );
};

phases["diag-migration"] = async () => {
  const p = D;
  await step(
    {
      ...DIAG,
      action:
        "Migration failure: a controlled journal fault; the refusal text; both read-only commands; the fixture custodian undoes the fault",
      expected: "This database cannot apply the migrations it is missing",
    },
    async () => {
      const row = psql(
        p,
        "select id, hash from drizzle.__drizzle_migrations order by created_at desc limit 1",
      );
      const [id, hash] = row.split("|");
      psql(
        p,
        `update drizzle.__drizzle_migrations set hash = 'doc030diagnosefault' || substr(hash, 20) where id = ${id}`,
      );
      const t = new Date().toISOString();
      recreate(p, "app");
      await sleep(25_000);
      const logs = sh(`docker compose logs --no-log-prefix --since ${t} app`, p.dir).stdout;
      const refusal = lines(logs, /cannot apply the migrations|Refusing|^- \d{4}_/i, 4);
      const ready = await http(`${p.base}/readyz`);
      const c1 = sh(
        `docker compose exec -T postgres psql -U openlaw -d openlaw -c 'select hash, created_at from drizzle.__drizzle_migrations order by created_at desc limit 5;'`,
        p.dir,
      );
      const c2 = sh(
        "docker compose run -T --rm --no-deps app node scripts/lint-migration-journal.mjs --hashes",
        p.dir,
        { timeout: 180_000 },
      );
      const shipped = c2.stdout
        .split("\n")
        .find((l) => l.includes(hash))
        ?.trim()
        .slice(0, 120);
      psql(p, `update drizzle.__drizzle_migrations set hash = '${hash}' where id = ${id}`);
      recreate(p, "app");
      await waitReady(p);
      check(
        refusal.some((l) =>
          l.includes("This database cannot apply the migrations it is missing"),
        ) &&
          ready.status !== 200 &&
          c1.code === 0 &&
          c1.stdout.includes("doc030diagnosefault") &&
          c2.code === 0 &&
          shipped,
        JSON.stringify({ refusal, ready: ready.status, c1: c1.code, c2: c2.code, shipped }),
      );
      return {
        refusal,
        readyz: ready.status,
        psqlCommand: `exit ${c1.code}; lists the faulty row`,
        lintHashes: `exit ${c2.code}; shipped entry ${shipped}`,
        undo: "custodian wrote back the recorded hash (not an operator repair); readyz 200",
      };
    },
  );
  await step(
    {
      ...DIAG,
      action:
        "accounts.issuer refusals: the shipped 0060 migration against scratch pre-0060 shapes names each case and applies none of the migration",
    },
    () => {
      const sql = must(
        "docker compose run -T --rm --no-deps app cat packages/db/migrations/0060_account_issuer.sql",
        p.dir,
      ).stdout.replace(/--> statement-breakpoint/g, "");
      const run = (label, seed) => {
        const db = `doc030_issuer_${label}`;
        must(
          `docker compose exec -T postgres psql -U openlaw -d openlaw -c "drop database if exists ${db}" -c "create database ${db}"`,
          p.dir,
        );
        must(`docker compose exec -T postgres psql -v ON_ERROR_STOP=1 -U openlaw -d ${db}`, p.dir, {
          input: `create table sso_providers (provider_id text primary key, issuer text not null);\ncreate table accounts (id text primary key, provider_id text not null, account_id text not null, unique (provider_id, account_id));\n${seed}\n`,
        });
        const r = sh(
          `docker compose exec -T postgres psql -v ON_ERROR_STOP=1 -U openlaw -d ${db}`,
          p.dir,
          { input: sql },
        );
        const col = must(
          `docker compose exec -T postgres psql -U openlaw -d ${db} -At -c "select count(*) from information_schema.columns where table_name='accounts' and column_name='issuer'"`,
          p.dir,
        ).stdout.trim();
        must(
          `docker compose exec -T postgres psql -U openlaw -d openlaw -c "drop database ${db}"`,
          p.dir,
        );
        return { exit: r.code, error: lines(r.stderr, /ERROR/, 1), issuerColumnAfter: col };
      };
      const orphan = run(
        "orphan",
        "insert into accounts values ('a1','credential','u1'),('a2','doc030-retired-idp','subject-1');",
      );
      const dup = run(
        "dup",
        "insert into sso_providers values ('doc030-idp-a','https://idp.doc030.example'),('doc030-idp-b','https://idp.doc030.example');\ninsert into accounts values ('a1','doc030-idp-a','subject-1'),('a2','doc030-idp-b','subject-1');",
      );
      check(
        orphan.exit !== 0 &&
          orphan.error.join().includes("Cannot resolve an issuer for accounts under provider(s)") &&
          orphan.issuerColumnAfter === "0",
        JSON.stringify(orphan),
      );
      check(
        dup.exit !== 0 &&
          dup.error.join().includes("Two accounts share one 1.7 identity") &&
          dup.issuerColumnAfter === "0",
        JSON.stringify(dup),
      );
      return { providerNoLongerHeld: orphan, providerRegisteredTwice: dup };
    },
  );
};

// 0157 refusal: a starting-build target with a Request type the guard names, upgraded; then the documented recovery.
phases["diag-0157"] = async () => {
  const p = PROJECTS.recover;
  const api = new Api(p.base);
  await api.signIn(state.people.admin.email, password("upAdmin"));
  await step(
    {
      ...DIAG,
      method: "automated-test",
      action:
        "Fixture on the starting build (recovery target): a Matter-targeted Request type whose form holds a Contract Field. The starting build's API refuses that attachment, so the row is written directly in the database to stand for data an older build may hold.",
      critical: true,
    },
    async () => {
      const fields = (await api.get("/api/v1/fields")).fields;
      const cf = fields.find((f) => f.slug === state.inventory.field.slug);
      const types = (await api.get("/api/v1/matter-types")).matterTypes;
      const created = await api.post("/api/v1/request-types", {
        displayName: "DOC-030 operator-2 guarded intake",
      });
      const rt =
        created.requestType ??
        created.item ??
        Object.values(created).find((v) => v && typeof v === "object" && v.id);
      await api.patch(`/api/v1/request-types/${rt.id}`, {
        targetModule: "matter",
        targetTypeId: types[0].id,
      });
      const refused = await api.raw("POST", `/api/v1/request-types/${rt.id}/fields`, {
        json: { fieldId: cf.id, isRequired: false },
      });
      psql(
        p,
        `insert into request_type_fields (request_type_id, field_id, display_order) values ('${rt.id}', '${cf.id}', 1)`,
      );
      state.guarded = {
        requestTypeId: rt.id,
        name: rt.displayName,
        fieldId: cf.id,
        field: `${cf.slug}:${cf.moduleScope}`,
      };
      return `Request type "${rt.displayName}" targets Matter; the starting build's API refused attaching Contract Field ${cf.slug} (${refused.status} ${refused.body?.detail ?? ""}); the row was inserted directly`;
    },
  );
  const dir = path.join(WORK, "backups", "pre-0157");
  await runBackup(p, dir, {
    meta: {
      ...DIAG,
      article: "operator-troubleshooting (Migration failures: take or preserve a coherent backup)",
    },
    restart: false,
    pre: BASELINE,
  });
  state.pre0157 = dir;
  saveState();
  await step(
    {
      ...DIAG,
      action:
        "Upgrade that target to the candidate: the app refuses with 'Cannot migrate the intake form of Request types:'; earlier pending migrations stay applied",
      expected:
        "Cannot migrate the intake form of Request types: names each Request type. The message appears inside the failed migration's SQL error. The pending migrations before this one stay applied.",
    },
    async () => {
      const before = psql(p, "select count(*) from drizzle.__drizzle_migrations");
      must(`git checkout --detach ${COMMIT}`, p.dir);
      envSet(p, "OPENLAW_BUILD_COMMIT", COMMIT);
      must("docker compose build app doc-engine", p.dir, { timeout: 3_000_000 });
      const t = new Date().toISOString();
      upCommand(p);
      await sleep(40_000);
      const logs = sh(`docker compose logs --no-log-prefix --since ${t} app`, p.dir).stdout;
      const msg = lines(logs, /Cannot migrate the intake form of Request types/, 1);
      const ready = await http(`${p.base}/readyz`);
      const after = psql(p, "select count(*) from drizzle.__drizzle_migrations");
      check(
        msg.length &&
          msg[0].includes(state.guarded.name) &&
          Number(after) > Number(before) &&
          ready.status !== 200,
        JSON.stringify({ msg, before, after, ready: ready.status }),
      );
      return {
        refusal: msg[0].slice(0, 400),
        appState: restarts(p, "app"),
        readyz: ready.status,
        journalRows: `${before} before; ${after} after the refused start (earlier pending migrations applied)`,
      };
    },
  );
  const f = PROJECTS.migfix;
  await restoreInto(f, dir, BASELINE, {
    meta: {
      ...DIAG,
      article:
        "operator-troubleshooting (0157 recovery via upgrade.md#if-the-upgrade-cannot-be-accepted)",
    },
    keysFrom: "up",
  });
  await step(
    {
      ...DIAG,
      role: "administrator",
      method: "browser-walkthrough",
      action:
        "On the starting build in the separate target, re-target the named Request type or remove those Fields from its questions",
      critical: true,
    },
    async () => {
      const s = await browserSignIn(f.base, state.people.admin.email, password("upAdmin"));
      let how;
      try {
        await s.page.goto(`${f.base}/settings/request-types`);
        await s.page.waitForLoadState("networkidle").catch(() => {});
        const text = await bodyText(s.page);
        const r = await s.request(
          "DELETE",
          `/api/v1/request-types/${state.guarded.requestTypeId}/fields/${state.guarded.fieldId}`,
        );
        how = `starting build Settings page text: ${text.slice(0, 160)}; removed the Field from the form through the starting build's form-definition route from the Administrator's browser session (${r.status}), because the starting build's editor labels were not in scope of these guides`;
        check([200, 204].includes(r.status), how);
      } finally {
        await s.context.close();
      }
      return how;
    },
  );
  const dir2 = path.join(WORK, "backups", "pre-0157-fixed");
  await runBackup(f, dir2, {
    meta: { ...DIAG, article: "operator-troubleshooting (take a new coherent backup)" },
    restart: false,
    pre: BASELINE,
  });
  await step(
    {
      ...DIAG,
      action:
        "Repeat the upgrade on the corrected target: migrations complete and the app is ready",
    },
    async () => {
      must(`git checkout --detach ${COMMIT}`, f.dir);
      envSet(f, "OPENLAW_BUILD_COMMIT", COMMIT);
      envSet(f, "TRUSTED_PROXIES", "127.0.0.1,::1");
      must("docker compose build app doc-engine", f.dir, { timeout: 3_000_000 });
      upCommand(f);
      await waitReady(f, 600_000);
      const rows = psql(f, "select count(*) from drizzle.__drizzle_migrations");
      const app = recordImages("migfix-upgraded", f).containers.app;
      return `readyz 200; journal rows ${rows}; app ${app}`;
    },
  );
};

phases["diag-0157-recheck"] = async () => {
  const p = PROJECTS.recover;
  await step(
    {
      ...DIAG,
      action:
        "Re-read of the refused start: the refusal names the Request type inside the migration's SQL error; the app keeps restarting; journal rows show earlier pending migrations applied",
    },
    () => {
      const logs = sh("docker compose logs --no-log-prefix app", p.dir).stdout;
      const named = [
        ...new Set(
          logs.match(
            /Cannot migrate the intake form of Request types: DOC-030 operator-2 guarded intake\. A Field has no Row[^"\\]*/g,
          ) ?? [],
        ),
      ];
      const sqlError = lines(logs, /DrizzleQueryError|Failed query|error: Cannot migrate/i, 1);
      const rows = psql(p, "select count(*) from drizzle.__drizzle_migrations");
      const st = restarts(p, "app");
      must("docker compose stop app worker", p.dir, { timeout: 120_000 });
      check(named.length && Number(rows) > 91, JSON.stringify({ named, rows }));
      return {
        refusal: named[0].slice(0, 300),
        sqlErrorContext: sqlError.map((l) => l.slice(0, 200)),
        journalRows: `91 on the starting build; ${rows} after the refused start`,
        appState: st,
        afterwards: "app and worker stopped; the old image was not started on this database",
      };
    },
  );
};

phases["diag-mail"] = async () => {
  const p = D;
  const good = secrets.up.OPENLAW_SECRET_KEY;
  await step(
    {
      ...DIAG,
      action:
        "SMTP_URL pins the environment: the saved relay is ignored; a valid SMTP_FROM; recreate app and worker; verify; then remove the override",
    },
    async () => {
      envSet(p, "SMTP_URL", "smtp://op2-mail:1025");
      envSet(p, "SMTP_FROM", "DOC-030 operator-2 env <env@doc030-upgrade.example>");
      recreate(p);
      await waitReady(p);
      let s = await adminLogin();
      const pinned = (await s.request("GET", "/api/v1/email-settings")).body;
      let t0 = Date.now();
      const test = await s.request("POST", "/api/v1/email-settings/test");
      const m1 = await waitMail((m) => toAddress(m, state.people.admin.email) && since(m, t0));
      await s.context.close();
      envSet(p, "SMTP_URL", null);
      envSet(p, "SMTP_FROM", null);
      recreate(p);
      await waitReady(p);
      s = await adminLogin();
      const back = (await s.request("GET", "/api/v1/email-settings")).body;
      t0 = Date.now();
      const test2 = await s.request("POST", "/api/v1/email-settings/test");
      const m2 = await waitMail((m) => toAddress(m, state.people.admin.email) && since(m, t0));
      await s.context.close();
      check(
        pinned.source === "env" &&
          test.status === 200 &&
          m1?.From?.Address === "env@doc030-upgrade.example" &&
          back.source !== "env" &&
          test2.status === 200 &&
          m2?.From?.Address === "openlaw@doc030-upgrade.example",
        JSON.stringify({
          pinned: pinned.source,
          from1: m1?.From?.Address,
          back: back.source,
          from2: m2?.From?.Address,
        }),
      );
      return {
        pinnedSource: pinned.source,
        deliveredFrom: m1.From.Address,
        afterRemoval: `source ${back.source}; delivered from ${m2.From.Address}`,
      };
    },
  );
  await step(
    {
      ...DIAG,
      action:
        "Wrong OPENLAW_SECRET_KEY: the start log names unreadable columns; email reads unset; the test send gives the exact message; an unrelated Contract stays readable; restore the key",
      expected: "The test email could not be sent. SMTP is not configured — save a relay first.",
    },
    async () => {
      envSet(p, "OPENLAW_SECRET_KEY", randomBytes(32).toString("base64"));
      const t = new Date().toISOString();
      recreate(p);
      await sleep(20_000);
      const ready = await http(`${p.base}/readyz`);
      const log1 = lines(
        sh(`docker compose logs --no-log-prefix --since ${t} app`, p.dir).stdout,
        /No configured key opens|Advanced settings cannot be decrypted/,
        2,
      );
      const s = await adminLogin();
      const settings = (await s.request("GET", "/api/v1/email-settings")).body;
      const test = await s.request("POST", "/api/v1/email-settings/test");
      const read = await s.request(
        "GET",
        `/api/v1/contracts/${state.inventory.contracts[0].number}`,
      );
      const uploads = (await advancedSources(s.page, p.base))["File uploads"];
      await s.context.close();
      envSet(p, "OPENLAW_SECRET_KEY", good);
      recreate(p);
      await waitReady(p);
      const s2 = await adminLogin();
      const t0 = Date.now();
      const test2 = await s2.request("POST", "/api/v1/email-settings/test");
      const mail = await waitMail((m) => toAddress(m, state.people.admin.email) && since(m, t0));
      const uploads2 = (await advancedSources(s2.page, p.base))["File uploads"];
      await s2.context.close();
      const detail = test.body?.detail ?? "";
      check(
        detail ===
          "The test email could not be sent. SMTP is not configured — save a relay first." &&
          settings.source === "unset" &&
          read.status === 200 &&
          test2.status === 200 &&
          mail,
        JSON.stringify({ detail, settings, read: read.status }),
      );
      return {
        readyzWithWrongKey: ready.status,
        startLog: log1,
        emailSource: settings.source,
        testSend: `${test.status} ${detail}`,
        unrelatedContract: read.status,
        fileUploadsWithWrongKey: uploads,
        afterRetainedKey: `test ${test2.status}, delivered; File uploads ${uploads2.join("; ")}`,
      };
    },
  );
};

phases["diag-storage"] = async () => {
  const p = D;
  secrets.minio ??= { user: "doc030op2", secret: randomBytes(18).toString("base64url") };
  saveSecrets();
  await step(
    { ...DIAG, action: "Local storage: the file volume belongs to the image's unprivileged user" },
    () => {
      const r = must(
        `docker compose run -T --rm --no-deps app sh -c 'id -u; id -un; stat -c "%U %u %a" /var/lib/openlaw/files'`,
        p.dir,
      )
        .stdout.trim()
        .split("\n");
      check(r[0] !== "0" && r[2].split(" ")[1] === r[0], JSON.stringify(r));
      return { uid: r[0], user: r[1], volumeOwnerUidMode: r[2] };
    },
  );
  await step(
    {
      ...DIAG,
      role: "administrator",
      method: "browser-walkthrough",
      action:
        "Storage settings name their source; System status shows Active storage; Test connection on Document storage (local)",
    },
    async () => {
      const s = await adminLogin();
      const src = (await advancedSources(s.page, p.base))["Document storage"];
      await s.page.goto(`${p.base}/settings/storage`);
      await s.page.getByRole("button", { name: "Test connection" }).click();
      await s.page
        .getByText(/Connection test passed\.|The storage test failed/)
        .first()
        .waitFor({ timeout: 30_000 });
      const result = (await bodyText(s.page)).match(
        /Connection test passed\.|The storage test failed[^.]*\./,
      )?.[0];
      const st = await systemStatus(s.page, p.base);
      await s.context.close();
      check(
        result === "Connection test passed." && st.activeStorage === "Active storage: local",
        `${result} ${st.activeStorage}`,
      );
      return { documentStorage: src, testConnection: result, systemStatus: st.activeStorage };
    },
  );
  await step(
    {
      ...DIAG,
      role: "administrator",
      method: "browser-walkthrough",
      action:
        "Fixture through the app: an owned MinIO; Document storage saved as S3 after Test connection passes; restart; a new upload lands in the bucket",
      critical: true,
    },
    async () => {
      if (sh(`docker inspect ${MINIO_NAME}`, root).code !== 0)
        must(
          `docker run -d --name ${MINIO_NAME} --label openlaw-doc030-owner=operator-2 --network ${p.project}_openlaw-backend --network-alias op2-minio -p 127.0.0.1:${MINIO_PORT}:9000 -e MINIO_ROOT_USER=${secrets.minio.user} -e MINIO_ROOT_PASSWORD=${secrets.minio.secret} minio/minio:RELEASE.2025-09-07T16-13-09Z server /data`,
          root,
        );
      await sleep(5000);
      const { createRequire } = await import("node:module");
      const req = createRequire(path.join(root, "package.json"));
      const s3 = req(
        path.join(
          root,
          "node_modules/.pnpm/@aws-sdk+client-s3@3.1139.0/node_modules/@aws-sdk/client-s3",
        ),
      );
      const client = new s3.S3Client({
        endpoint: `http://127.0.0.1:${MINIO_PORT}`,
        region: "us-east-1",
        forcePathStyle: true,
        credentials: { accessKeyId: secrets.minio.user, secretAccessKey: secrets.minio.secret },
      });
      await client.send(new s3.CreateBucketCommand({ Bucket: "doc030-op2" })).catch((e) => {
        if (!/BucketAlready/.test(e.name)) throw e;
      });
      envSet(p, "OPENLAW_PLAIN_HTTP_HOSTS", "op2-minio");
      recreate(p);
      await waitReady(p);
      const s = await adminLogin();
      await s.page.goto(`${p.base}/settings/storage`);
      await s.page.getByLabel("Store new documents in").selectOption("s3");
      await s.page.getByLabel("S3 bucket").fill("doc030-op2");
      await s.page.getByLabel("S3 endpoint (optional for AWS)").fill("http://op2-minio:9000");
      await s.page.getByLabel("S3 region").fill("us-east-1");
      await s.page.getByLabel("S3 path-style addressing").selectOption("true");
      await s.page.getByLabel("S3 access key ID").fill(secrets.minio.user);
      await s.page.getByLabel("S3 secret access key").fill(secrets.minio.secret);
      await s.page.getByRole("button", { name: "Test connection" }).click();
      await s.page
        .getByText(/Connection test passed\.|The storage test failed/)
        .first()
        .waitFor({ timeout: 30_000 });
      const tested = (await bodyText(s.page)).match(
        /Connection test passed\.|The storage test failed[^.]*\./,
      )?.[0];
      await s.page.getByRole("button", { name: "Save", exact: true }).click();
      await s.page
        .getByText("Settings saved. Restart the API and worker to apply changes.")
        .waitFor({ timeout: 15_000 });
      await s.context.close();
      must("docker compose restart app worker", p.dir, { timeout: 240_000 });
      await waitReady(p);
      const s2 = await adminLogin();
      const body = Buffer.from(`DOC-030 operator-2 object-store file ${Date.now()}\n`);
      const up = await uploadInBrowser(
        s2.page,
        p.base,
        state.inventory.contracts[1].number,
        "doc030-op2-s3.txt",
        body,
      );
      const ref = psql(p, `select file_ref from document_versions where id = '${up.versionId}'`);
      const st = await systemStatus(s2.page, p.base);
      const src = (await advancedSources(s2.page, p.base))["Document storage"];
      await s2.context.close();
      state.s3Doc = { ...up, contract: state.inventory.contracts[1].number };
      check(tested === "Connection test passed." && ref.startsWith("s3:"), `${tested} ${ref}`);
      return {
        testConnection: tested,
        fileRefPrefix: ref.split(":")[0],
        activeStorage: st.activeStorage,
        storageFields: src.filter((l) => !/secret/i.test(l)),
      };
    },
  );
  await step(
    {
      ...DIAG,
      action:
        "Remove saved Advanced settings: storage; files do not move; a Document only the saved values named stays unreadable until the deployment configures that store",
      expected:
        "Removing saved storage values does not move files. A Document in a bucket or container that only the saved values named stays unreadable until the deployment configures that store.",
    },
    async () => {
      const reset = sh(
        "docker compose run -T --rm --no-deps app node apps/api/dist/reset-advanced-settings.js storage",
        p.dir,
      );
      must("docker compose restart app worker", p.dir, { timeout: 240_000 });
      await waitReady(p);
      const s = await adminLogin();
      const d = state.s3Doc;
      const s3got = await s.request(
        "GET",
        `/api/v1/documents/${d.documentId}/versions/${d.versionId}/download`,
      );
      const local = state.inventory.documents[0];
      const localGot = await s.request(
        "GET",
        `/api/v1/documents/${local.id}/versions/${local.versions[0].id}/download`,
      );
      const st = await systemStatus(s.page, p.base);
      await s.context.close();
      for (const [k, v] of [
        ["S3_BUCKET", "doc030-op2"],
        ["S3_ENDPOINT", "http://op2-minio:9000"],
        ["S3_REGION", "us-east-1"],
        ["S3_FORCE_PATH_STYLE", "true"],
        ["S3_ACCESS_KEY_ID", secrets.minio.user],
        ["S3_SECRET_ACCESS_KEY", secrets.minio.secret],
      ])
        envSet(p, k, v);
      recreate(p);
      await waitReady(p);
      const s2 = await adminLogin();
      const again = await s2.request(
        "GET",
        `/api/v1/documents/${d.documentId}/versions/${d.versionId}/download`,
      );
      const st2 = await systemStatus(s2.page, p.base);
      await s2.context.close();
      check(
        reset.code === 0 &&
          s3got.status !== 200 &&
          localGot.status === 200 &&
          again.status === 200 &&
          sha256(again.buffer) === d.sha256,
        JSON.stringify({
          reset: reset.code,
          s3: s3got.status,
          local: localGot.status,
          again: again.status,
        }),
      );
      return {
        resetCommand: `exit ${reset.code}: ${reset.stdout.trim().split("\n").pop()}`,
        afterRestart: {
          activeStorage: st.activeStorage,
          s3OnlyDocumentDownload:
            `${s3got.status} ${s3got.body?.detail ?? s3got.body?.title ?? ""}`.slice(0, 120),
          localDocumentDownload: localGot.status,
        },
        deploymentConfiguresTheStore: `S3_* reader settings in .env (write driver still local); ${st2.activeStorage}; the S3 Document downloads again with its SHA-256`,
      };
    },
  );
};

phases["diag-upload"] = async () => {
  const p = D;
  await step(
    {
      ...DIAG,
      role: "administrator",
      method: "browser-walkthrough",
      action:
        "Upload refusal: File uploads saved at 1 MiB; a file above is refused with the app's message; a file below is accepted; restore 150",
    },
    async () => {
      let s = await adminLogin();
      const current = (await advancedSources(s.page, p.base))["File uploads"][0];
      if (!current.startsWith("Maximum file size (MiB) = 1 ")) {
        await saveUploadLimit(s.page, p.base, 1);
        await s.context.close();
        must("docker compose restart app worker", p.dir, { timeout: 240_000 });
        await waitReady(p);
        s = await adminLogin();
      }
      const n = state.inventory.contracts[1].number;
      await s.page.goto(`${p.base}/contracts/${n}`);
      await s.page.locator(`a[href="/contracts/${n}/documents"]`).first().click();
      await s.page
        .getByRole("button", { name: "Upload", exact: true })
        .first()
        .click()
        .catch(async (e) => {
          await s.page.screenshot({ path: path.join(WORK, "upload-refusal-debug.png") });
          throw e;
        });
      const dialog = s.page.getByRole("dialog", { name: "Upload document" });
      const chooser = s.page.waitForEvent("filechooser");
      await dialog.getByRole("button", { name: "Choose files" }).click();
      await (
        await chooser
      ).setFiles({
        name: "doc030-op2-big.txt",
        mimeType: "text/plain",
        buffer: Buffer.alloc(1_300_000, 97),
      });
      await dialog.getByRole("button", { name: "Upload", exact: true }).click();
      await s.page
        .getByText(/over the 1 MB upload limit/)
        .first()
        .waitFor({ timeout: 20_000 });
      const shown = (await bodyText(s.page)).match(
        /That file is over the 1 MB upload limit\./,
      )?.[0];
      await s.page.reload();
      const small = await uploadInBrowser(
        s.page,
        p.base,
        n,
        "doc030-op2-small.txt",
        Buffer.alloc(600_000, 98),
      );
      await saveUploadLimit(s.page, p.base, 150);
      await s.context.close();
      must("docker compose restart app worker", p.dir, { timeout: 240_000 });
      await waitReady(p);
      check(shown && small.documentId, `${shown}`);
      return {
        over: shown,
        under: small.how,
        restored: "File uploads 150 saved again; app and worker restarted",
      };
    },
  );
};

phases["diag-worker"] = async (only) => {
  const p = D;
  const n = state.inventory.contracts[1].number;
  await step(
    {
      ...DIAG,
      role: "administrator",
      method: "browser-walkthrough",
      action:
        "Worker killed (not a clean stop, so its heartbeat row stays): the two commands; System status shows No recent heartbeat; a new upload waits; start; the upload is processed. An earlier clean docker compose stop removed the Worker row instead and showed only the missing-heartbeat warning.",
      command:
        "docker compose kill worker; docker compose ps worker doc-engine; docker compose logs --since=10m worker doc-engine",
    },
    async () => {
      must("docker compose kill worker", p.dir, { timeout: 120_000 });
      const ps = sh("docker compose ps worker doc-engine", p.dir)
        .stdout.trim()
        .split("\n")
        .slice(1)
        .map((l) => l.replace(/\s+/g, " ").slice(0, 100));
      const logs = sh("docker compose logs --since=10m worker doc-engine", p.dir);
      const s = await adminLogin();
      const body = pdf(["DOC-030 operator-2 worker-stopped upload.", "Processing resumes later."]);
      const up = await uploadInBrowser(s.page, p.base, n, "doc030-op2-worker-stopped.pdf", body);
      await sleep(65_000);
      const st = await systemStatus(s.page, p.base);
      const api = { raw: (m, r) => s.request(m, r) };
      const pending = await textState(api, up.documentId, up.versionId);
      must("docker compose start worker", p.dir);
      const text = await waitText(api, up.documentId, up.versionId, 300_000);
      await sleep(3000);
      const st2 = await systemStatus(s.page, p.base);
      await s.context.close();
      check(
        logs.code === 0 &&
          st.rows.some((r) => /^Worker No recent heartbeat/.test(r)) &&
          st.warning &&
          pending === "pending" &&
          text.state === "ready",
        JSON.stringify({ st, pending, text: text.state }),
      );
      return {
        psWhileStopped: ps,
        systemStatusWhileStopped: st,
        stateWhileStopped: pending,
        afterStart: text.state,
        systemStatusAfter: st2.rows,
      };
    },
  );
  if (only === "worker") return;
  await step(
    {
      ...DIAG,
      role: "administrator",
      method: "browser-walkthrough",
      action:
        "Engine down: the API stays ready; a new PDF does not finish while the engine is stopped; restore; a new controlled PDF is processed",
    },
    async () => {
      must("docker compose stop doc-engine", p.dir);
      const s = await adminLogin();
      const api = { raw: (m, r) => s.request(m, r) };
      const up = await uploadInBrowser(
        s.page,
        p.base,
        n,
        "doc030-op2-engine-down.pdf",
        pdf(["DOC-030 operator-2 engine-down upload."]),
      );
      await sleep(45_000);
      const during = await textState(api, up.documentId, up.versionId);
      const ready = await http(`${p.base}/readyz`);
      const wlog = lines(
        sh("docker compose logs --since=2m worker", p.dir).stdout,
        /engine|ECONNREFUSED|ENOTFOUND|fetch failed|unavailable/i,
        2,
      );
      must("docker compose start doc-engine", p.dir);
      await sleep(15_000);
      const up2 = await uploadInBrowser(
        s.page,
        p.base,
        n,
        "doc030-op2-engine-back.pdf",
        pdf(["DOC-030 operator-2 engine restored.", "Engine back words."]),
      );
      const t2 = await waitText(api, up2.documentId, up2.versionId, 300_000);
      const later = await waitText(api, up.documentId, up.versionId, 180_000, ["ready", "failed"]);
      await s.context.close();
      check(
        ready.status === 200 && during !== "ready" && t2.state === "ready",
        JSON.stringify({ during, ready: ready.status, t2: t2.state }),
      );
      return {
        readyzWhileEngineDown: ready.status,
        stateAfter45s: during,
        workerLog: wlog,
        newPdfAfterRestore: t2.state,
        earlierUploadLater: later.state,
      };
    },
  );
  await step(
    {
      ...DIAG,
      action:
        "Engine busy: DOC_ENGINE_MAX_CONCURRENT=1 and DOC_ENGINE_MAX_QUEUED=0; a burst of uploads; the engine answers 503 with Retry-After; processing slows rather than fails; restore",
    },
    async () => {
      envSet(p, "DOC_ENGINE_MAX_CONCURRENT", "1");
      envSet(p, "DOC_ENGINE_MAX_QUEUED", "0");
      must("docker compose up -d --no-build --pull never --force-recreate doc-engine", p.dir, {
        timeout: 240_000,
      });
      await sleep(15_000);
      const probe = sh(
        `docker compose exec -T app node -e "Promise.all(Array.from({length:4},()=>fetch('http://doc-engine:8080/healthz').then(r=>r.status))).then(s=>console.log(s.join(',')))"`,
        p.dir,
      );
      const s = await adminLogin();
      const api = { raw: (m, r) => s.request(m, r) };
      const ups = [];
      for (let i = 0; i < 5; i += 1)
        ups.push(
          uploadViaSession(
            s,
            n,
            `doc030-op2-burst-${i}.pdf`,
            pdf([`DOC-030 operator-2 burst ${i}.`, `Burst words ${i}.`]),
          ),
        );
      const refs = await Promise.all(ups);
      const results = [];
      for (const r of refs)
        results.push((await waitText(api, r.documentId, r.versionId, 600_000)).state);
      await s.context.close();
      const elog = sh("docker compose logs --since=10m doc-engine worker app", p.dir).stdout;
      const busy = lines(elog, /503|Retry-After|busy|DocEngineUnavailable|unavailable/i, 3);
      envSet(p, "DOC_ENGINE_MAX_CONCURRENT", null);
      envSet(p, "DOC_ENGINE_MAX_QUEUED", null);
      must("docker compose up -d --no-build --pull never --force-recreate doc-engine", p.dir, {
        timeout: 240_000,
      });
      return {
        healthProbeStatuses: probe.stdout.trim(),
        burstResults: results,
        busyLogLines: busy,
        restored: "limits removed; engine recreated",
      };
    },
  );
};
async function uploadViaSession(s, number, filename, bytes) {
  const r = await s.page.request.post(`${s.base}/api/v1/contracts/${number}/documents`, {
    headers: { origin: s.base },
    multipart: { file: { name: filename, mimeType: "application/pdf", buffer: bytes } },
  });
  const body = await r.json();
  const v = body.document.versions.find((x) => x.isCurrent) ?? body.document.versions[0];
  return { documentId: body.document.id, versionId: v.id };
}

phases["diag-engine-busy"] = async () => {
  const p = D;
  await step(
    {
      ...DIAG,
      action:
        "Engine busy, observed directly: with DOC_ENGINE_MAX_CONCURRENT=1 and DOC_ENGINE_MAX_QUEUED=1 (0 is not a positive integer and falls back to the default 8), six concurrent engine requests from inside the app container get 503 with Retry-After",
      expected: "Past both, it answers 503 with Retry-After.",
    },
    async () => {
      envSet(p, "DOC_ENGINE_MAX_CONCURRENT", "1");
      envSet(p, "DOC_ENGINE_MAX_QUEUED", "1");
      must("docker compose up -d --no-build --pull never --force-recreate doc-engine", p.dir, {
        timeout: 240_000,
      });
      await sleep(15_000);
      const b64 = pdf(["DOC-030 operator-2 engine busy probe.", "Busy words."]).toString("base64");
      const script = `const b=Buffer.from('${b64}','base64');Promise.all(Array.from({length:6},()=>fetch('http://doc-engine:8080/ocr',{method:'POST',headers:{'content-type':'application/pdf'},body:b}).then(async r=>r.status+' retry-after='+r.headers.get('retry-after')))).then(s=>console.log(s.join('; ')))`;
      const r = sh(`docker compose exec -T app node -e ${JSON.stringify(script)}`, p.dir, {
        timeout: 300_000,
      });
      envSet(p, "DOC_ENGINE_MAX_CONCURRENT", null);
      envSet(p, "DOC_ENGINE_MAX_QUEUED", null);
      must("docker compose up -d --no-build --pull never --force-recreate doc-engine", p.dir, {
        timeout: 240_000,
      });
      check(r.stdout.includes("503 retry-after="), r.stdout + r.stderr.slice(-300));
      return { concurrentStatuses: r.stdout.trim(), restored: "limits removed; engine recreated" };
    },
  );
};

phases["diag-providers"] = async () => {
  const p = D;
  await step(
    {
      ...DIAG,
      role: "administrator",
      method: "browser-walkthrough",
      action:
        "AI connector refusal: Test connection shows only the HTTP status; the app log line has the provider status and a short redacted reply; restore the provider",
      expected:
        "The connection test failed. The provider refused the request with HTTP 401. The app log then has The AI provider refused the connection test.",
    },
    async () => {
      must(`docker exec ${AI_NAME} touch /tmp/refuse`, root);
      const t = new Date().toISOString();
      const s = await adminLogin();
      await s.page.goto(`${p.base}/settings/ai-analysis`);
      await s.page.getByRole("button", { name: "Provider", exact: true }).first().click();
      await s.page.getByRole("button", { name: "Test connection" }).first().click();
      await s.page
        .getByText(/Connection successful\.|The connection test failed/)
        .first()
        .waitFor({ timeout: 30_000 });
      const shown = (await bodyText(s.page)).match(/The connection test failed\.[^.]*\./)?.[0];
      await s.page.screenshot({ path: path.join(here, "troubleshooting-ai-test-401.png") });
      must(`docker exec ${AI_NAME} rm -f /tmp/refuse`, root);
      await s.page.getByRole("button", { name: "Test connection" }).first().click();
      await s.page.waitForTimeout(4000);
      const again = (await bodyText(s.page)).match(/Connection successful\./)?.[0];
      await s.context.close();
      const logs = sh(`docker compose logs --no-log-prefix --since ${t} app`, p.dir).stdout;
      const line = logs
        .split("\n")
        .find((l) => l.includes("The AI provider refused the connection test."));
      const keyInLog = logs.includes(secrets.ai.key) || logs.includes(secrets.ai.key.slice(0, 16));
      check(
        shown?.startsWith(
          "The connection test failed. The provider refused the request with HTTP 401.",
        ) &&
          line &&
          !keyInLog &&
          again,
        JSON.stringify({ shown, line: line?.slice(0, 300), keyInLog, again }),
      );
      return {
        shownInBrowser: shown,
        logLine: JSON.parse(line)?.msg,
        providerStatus: JSON.parse(line)?.providerStatus,
        providerReply: JSON.parse(line)?.providerReply,
        keyOrKeyPrefixInLog: keyInLog,
        afterProviderRestored: again,
      };
    },
  );
  await step(
    {
      ...DIAG,
      role: "administrator",
      method: "browser-walkthrough",
      action: "Signing: the Signing updates control offers Polling and Webhook",
    },
    async () => {
      const s = await adminLogin();
      await s.page.goto(`${p.base}/settings/integrations/e-signature`);
      const provider = s.page.getByRole("button", { name: "DocuSign" });
      if (await provider.isVisible({ timeout: 8000 }).catch(() => false)) await provider.click();
      await s.page.waitForLoadState("networkidle").catch(() => {});
      const select = s.page.locator("#ds-update-mode");
      if (!(await select.isVisible().catch(() => false)))
        await s.page
          .getByRole("button", { name: /DocuSign/ })
          .first()
          .click()
          .catch(() => {});
      await select.waitFor({ timeout: 15_000 });
      const label = await s.page
        .locator('label[for="ds-update-mode"]')
        .innerText()
        .catch(() => "");
      const options = await select.locator("option").allInnerTexts();
      await s.context.close();
      check(options.includes("Polling") && options.includes("Webhook"), options.join());
      return {
        label,
        signingUpdatesOptions: options,
        note: "nothing saved; a live Signing provider is out of scope (C42)",
      };
    },
  );
};

phases["diag-reset-wrongkey"] = async () => {
  const p = D;
  const good = secrets.up.OPENLAW_SECRET_KEY;
  await step(
    {
      ...DIAG,
      action: "Wrong key with saved Advanced settings, and the recovery command under that key",
      expected:
        "If settings were saved in Settings → Advanced, a wrong key stops app and worker startup with Advanced settings cannot be decrypted. The recovery command needs the correct key; with a key that cannot open the saved settings it stops with the same message as startup. It removes only that section's saved values.",
    },
    async () => {
      const s0 = await adminLogin();
      const before = await advancedSources(s0.page, p.base);
      await s0.context.close();
      envSet(p, "OPENLAW_SECRET_KEY", randomBytes(32).toString("base64"));
      const t = new Date().toISOString();
      recreate(p);
      await sleep(40_000);
      const ready = await http(`${p.base}/readyz`);
      const logs = sh(`docker compose logs --no-log-prefix --since ${t} app worker`, p.dir).stdout;
      const reset = sh(
        "docker compose run -T --rm --no-deps app node apps/api/dist/reset-advanced-settings.js mcp",
        p.dir,
      );
      envSet(p, "OPENLAW_SECRET_KEY", good);
      recreate(p);
      await waitReady(p);
      const s = await adminLogin();
      const after = await advancedSources(s.page, p.base);
      await s.context.close();
      const out = {
        savedBefore: Object.values(before)
          .flat()
          .filter((l) => l.includes("Saved in OpenLaw")),
        readyzWithWrongKey: ready.status,
        states: [restarts(p, "app"), restarts(p, "worker")],
        cannotBeDecrypted: logs.includes("Advanced settings cannot be decrypted"),
        resetMcpWithWrongKey: `exit ${reset.code}: ${reset.stdout.trim().split("\n").pop()}`,
        savedAfterRetainedKey: Object.values(after)
          .flat()
          .filter((l) => l.includes("Saved in OpenLaw")),
      };
      guideFailure(
        "operator-troubleshooting",
        "Startup table 'App keeps restarting' and 'Email and stored credentials' ('If settings were saved in Settings → Advanced, a wrong key stops app and worker startup with Advanced settings cannot be decrypted')",
        "A wrong OPENLAW_SECRET_KEY with saved Advanced settings stops app and worker with 'Advanced settings cannot be decrypted. Restore the instance encryption key before restarting.'",
        `Saved: ${out.savedBefore.join("; ")}. With a wrong key app and worker started (${out.states.join(", ")}, readyz ${ready.status}); no 'cannot be decrypted' line; the saved values silently fell back to defaults.`,
      );
      guideFailure(
        "operator-troubleshooting",
        "Remove saved Advanced settings ('With a key that cannot open the saved settings, it stops with the same message as startup'; 'It removes only that section's saved values')",
        "Under a wrong key the command stops with 'Advanced settings cannot be decrypted' and removes nothing.",
        `Under a wrong key 'reset-advanced-settings.js mcp' ${out.resetMcpWithWrongKey}. After the retained key was restored, the other sections' saved values were gone too: before ${out.savedBefore.join("; ")}; after ${out.savedAfterRetainedKey.join("; ") || "none"}.`,
      );
      return out;
    },
  );
};

phases["diag-logscan"] = async () => {
  await step(
    {
      ...DIAG,
      action:
        "Negative: container logs after every induced fault omit keys, relay, storage and provider credentials, setup tokens and fixture passwords",
    },
    () => {
      const out = {};
      for (const p of [D, I, PROJECTS.restore, PROJECTS.recover, PROJECTS.migfix]) {
        if (!existsSync(`${p.dir}/.env`)) continue;
        const logs = sh("docker compose logs --no-log-prefix", p.dir, { timeout: 180_000 }).stdout;
        const values = secretValues().filter((v) => !/^short-/.test(v));
        out[p.project] = {
          lines: logs.split("\n").length,
          secretHits: values.filter((v) => logs.includes(v)).length,
          smtpUrlWithPassword: /smtps?:\/\/[^\s"@/]+:[^\s"@]+@/.test(logs),
        };
      }
      const hits = Object.values(out).reduce(
        (a, b) => a + b.secretHits + (b.smtpUrlWithPassword ? 1 : 0),
        0,
      );
      check(hits === 0, JSON.stringify(out));
      return out;
    },
  );
  await step(
    {
      ...DIAG,
      action:
        "Negative: no destructive recovery is offered without its actual scope and consequence",
    },
    () =>
      "The guide's recoveries were followed as written: the journal guard asks for a maintainer and forbids deleting journal rows; the accounts.issuer cases name what each deletion does (people re-link at next sign-in); the 0157 recovery restores into a separate target and forbids starting the old image on the migrated database; the reset command names what it removes and that files do not move. The one observed gap is recorded as a guide failure: under a wrong key the reset command removed every section's saved values, which the guide does not say.",
  );
};

phases.findings = async () => {
  const p = I;
  await step(
    {
      ...DIAG,
      action: "Product check: a clean docker compose stop app; exit code and the API heartbeat row",
      command: "docker compose stop app; docker inspect ExitCode; runtime_status rows",
    },
    async () => {
      const t0 = Date.now();
      must("docker compose stop app", p.dir, { timeout: 120_000 });
      const ms = Date.now() - t0;
      const code = sh(
        `docker inspect --format '{{.State.ExitCode}}' $(docker compose ps -aq app)`,
        p.dir,
      ).stdout.trim();
      must("docker compose start app", p.dir);
      await waitReady(p);
      const rows = psql(
        p,
        "select role, count(*) from runtime_status group by role order by role",
      ).replace(/\n/g, "; ");
      if (code === "137")
        productBug(
          "The API process ignores SIGTERM, so docker compose stop app waits the 10 s grace period and kills it (exit 137); its runtime_status heartbeat row is never deleted.",
          `On ${p.project}: docker compose stop app took ${Math.round(ms / 1000)} s and the container exited 137. runtime_status then held ${rows}: one API row per earlier start. Right after docker compose restart app worker, Settings → Advanced → System status showed a third row 'API Running Restart required' for the stopped process for up to a minute; a backup taken after 'docker compose stop app worker' carries the API row (2 rows after stop on ${U.project}).`,
          "apps/api/src/index.ts registers stopHeartbeat only as a Fastify onClose hook and installs no SIGTERM handler; the worker handles SIGTERM and deletes its row. The upgrade guide asks for API and Worker rows Running and Current right after start.",
        );
      return { stopMs: ms, exitCode: code, runtimeStatusRows: rows };
    },
  );
  await step(
    {
      ...UPGRADE,
      action:
        "Upgrade step 3 TRUSTED_PROXIES bullet checked against the same build: a host request reaches the app from the Docker bridge gateway, not 127.0.0.1",
    },
    async () => {
      const t = new Date().toISOString();
      await http(`${U.base}/api/v1/auth/setup`);
      await sleep(1000);
      const seen = [
        ...new Set(
          sh(`docker compose logs --no-log-prefix --since ${t} app`, U.dir)
            .stdout.split("\n")
            .map((l) => l.match(/"remoteAddress":"([^"]+)"/)?.[1])
            .filter(Boolean),
        ),
      ];
      guideFailure(
        "upgrade",
        "Prepare the target, step 3, bullet 'Set TRUSTED_PROXIES to the proxy's own address, such as 127.0.0.1,::1 for a proxy on the same host'",
        "With TRUSTED_PROXIES=127.0.0.1,::1 a proxy on the same host is trusted and each visitor gets their own sign-in bucket.",
        `Same mechanism as the install finding: on the upgraded ${U.project} a request from the host to 127.0.0.1:${U.port} reaches the app from ${seen.join(", ")}. The install walkthrough showed that with this value one client's wrong passwords still returned 429 to another client behind a same-host Caddy proxy.`,
      );
      return {
        remoteAddressSeenForAHostRequest: seen,
        trustedProxies: envGet(U, "TRUSTED_PROXIES"),
      };
    },
  );
  productBug(
    "reset-advanced-settings.js run under a wrong OPENLAW_SECRET_KEY exits 0 and replaces every section's saved Advanced settings with an empty set sealed under the wrong key.",
    "On openlaw-doc030-oprestore and openlaw-doc030-opup: File uploads 150 saved; OPENLAW_SECRET_KEY set to a random value; 'docker compose run -T --rm --no-deps app node apps/api/dist/reset-advanced-settings.js instance' (and 'mcp') printed 'Saved ... overrides removed' and exited 0. After the retained key was restored, File uploads showed 100 [Default]; the saved value was gone.",
    "The unreadable column opens to UNREADABLE_SECRET (an empty string), and parseSettings(\"\", true) returns empty settings instead of refusing. The author's technical review expected the command to throw 'Advanced settings cannot be decrypted'.",
  );
  productBug(
    "A wrong OPENLAW_SECRET_KEY with saved Advanced settings does not stop startup; saved values silently fall back to defaults or the environment.",
    "Same fixture: app and worker start (RestartCount 0, readyz 200); the only signal is 'No configured key opens these stored credentials: ... advanced_settings (1)'. A saved storage driver or Application address would silently revert.",
    "config.ts parseSettings throws only when raw === null; encryptedText returns \"\" for an unreadable value. The guides and the technical review describe a restart loop with 'Advanced settings cannot be decrypted'.",
  );
  log.supersededAttempts =
    "Steps with result fail whose failure was a walkthrough-script defect (selector, timing or fixture API shape) were rerun; the later step with the same action is the recorded outcome. The failures that are guide findings are listed in guideFailures. The first 'Engine busy' step set DOC_ENGINE_MAX_QUEUED=0, which the engine treats as unset (default 8), so the direct probe with 1/1 is the recorded outcome.";
  saveLog();
};

phases.destroy = async () => {
  await step(
    {
      scenario: "teardown",
      action:
        "Destroy every owned project (containers, networks, volumes), the support containers and the private backups and clones",
    },
    () => {
      const out = [];
      for (const p of Object.values(PROJECTS)) {
        if (!existsSync(`${p.dir}/.env`)) continue;
        const r = sh(`docker compose -p ${p.project} down -v --remove-orphans`, p.dir, {
          timeout: 300_000,
        });
        out.push(`${p.project} down -v exit ${r.code}`);
        for (const n of ["openlaw-backend", "openlaw-doc-engine"])
          if (sh(`docker network inspect ${p.project}_${n}`, root).code === 0)
            sh(`docker network rm ${p.project}_${n}`, root);
      }
      for (const c of [
        MAIL_NAME,
        AI_NAME,
        OCCUPIER_NAME,
        PROXY_NAME,
        `${PROXY_NAME}-up`,
        CPROXY_NAME,
        "openlaw-doc030-op2-minio",
      ])
        out.push(`${c} rm exit ${sh(`docker rm -f ${c}`, root).code}`);
      const left = sh(
        "docker ps -a --format '{{.Names}}' | grep -E '^openlaw-doc030-op(inst|up|recover|restore|migfix|2)' || true",
        root,
      ).stdout.trim();
      const vols = sh(
        "docker volume ls -q | grep -E '^openlaw-doc030-op(inst|up|recover|restore|migfix)_' || true",
        root,
      ).stdout.trim();
      return `${out.join("; ")}; remaining containers: ${left || "none"}; remaining volumes: ${vols || "none"}; images tagged openlaw-local and openlaw-engine-local stay in the Docker cache`;
    },
  );
};

// ---------------------------------------------------------------- round 2: re-walk of the corrected guides

const r2 = (meta) => ({ ...meta, round: 2 });
const GUIDE_ADDRESSES =
  'docker compose logs --since=5m app | grep -o \'"remoteAddress":"[^"]*"\' | sort | uniq -c';
function recordedAddresses(p) {
  return sh(GUIDE_ADDRESSES, p.dir)
    .stdout.trim()
    .split("\n")
    .filter(Boolean)
    .map((l) => l.trim().replace(/\s+/g, " "));
}
function gatewayOf(p) {
  return must(
    `docker network inspect ${p.project}_openlaw-backend --format '{{range .IPAM.Config}}{{.Gateway}} {{.Subnet}}{{end}}'`,
    p.dir,
  ).stdout.trim();
}
/** Plain-http request to the upgraded instance's proxy origin from a chosen loopback source address. */
async function viaHttpProxy(p, method, route, { json, localAddress = "127.0.0.1" } = {}) {
  const http = await import("node:http");
  return new Promise((resolve) => {
    const body = json === undefined ? undefined : JSON.stringify(json);
    const req = http.request(
      {
        host: "127.0.0.1",
        port: p.proxyPort,
        localAddress,
        method,
        path: route,
        headers: {
          origin: p.base,
          ...(body
            ? { "content-type": "application/json", "content-length": Buffer.byteLength(body) }
            : {}),
        },
      },
      (res) => {
        const chunks = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () =>
          resolve({ status: res.statusCode, text: Buffer.concat(chunks).toString("utf8") }),
        );
      },
    );
    req.on("error", (e) => resolve({ status: 0, text: e.message }));
    if (body) req.write(body);
    req.end();
  });
}
async function lockoutProbe(send, adminEmail, adminPw) {
  await sleep(12_000);
  const wrong = [];
  for (let i = 0; i < 4; i += 1)
    wrong.push(
      (
        await send("POST", "/api/auth/sign-in/email", {
          json: { email: "nobody@doc030-op2.example", password: "not-the-password" },
          localAddress: "127.0.0.2",
        })
      ).status,
    );
  const right = await send("POST", "/api/auth/sign-in/email", {
    json: { email: adminEmail, password: adminPw },
    localAddress: "127.0.0.1",
  });
  return { wrongFrom127_0_0_2: wrong, correctFrom127_0_0_1: right.status };
}

phases["r2-inst-step4"] = async () => {
  const p = I;
  await step(
    r2({
      ...INSTALL,
      action:
        "Build step 4: read the Compose network gateway, set TRUSTED_PROXIES to it, apply with up",
      command: `docker network inspect ${p.project}_openlaw-backend --format '{{range .IPAM.Config}}{{.Gateway}} {{.Subnet}}{{end}}'; TRUSTED_PROXIES=<gateway>; docker compose up -d --no-build --pull never`,
      critical: true,
    }),
    async () => {
      const read = gatewayOf(p);
      envSet(p, "TRUSTED_PROXIES", read.split(" ")[0]);
      const t = new Date().toISOString();
      const u = upCommand(p);
      check(u.code === 0, u.stderr.slice(-300));
      await waitReady(p);
      const warn = lines(
        sh(`docker compose logs --no-log-prefix --since ${t} app`, p.dir).stdout,
        /TRUSTED_PROXIES is not set/,
        1,
      );
      const earlierWarn = lines(
        sh("docker compose logs --no-log-prefix app", p.dir).stdout,
        /TRUSTED_PROXIES is not set/,
        1,
      );
      return {
        gatewayAndSubnet: read,
        trustedProxies: envGet(p, "TRUSTED_PROXIES"),
        upExit: u.code,
        warningBeforeStep4: earlierWarn.length > 0,
        warningAfterStep4: warn.length > 0,
      };
    },
  );
};

phases["r2-inst-addr"] = async () => {
  const p = I;
  await step(
    r2({
      ...INSTALL,
      method: "browser-walkthrough",
      action:
        "Build step 6: after setup, check that the app records the browser's address, not the gateway",
      command: GUIDE_ADDRESSES,
    }),
    async () => {
      const s = await browserSignIn(
        ORIGIN,
        "avery.morgan@doc030-install.example",
        password("instAdmin"),
      );
      await s.context.close();
      const counts = recordedAddresses(p);
      const gw = gatewayOf(p).split(" ")[0];
      const n = (a) => Number(counts.find((l) => l.includes(`"${a}"`))?.split(" ")[0] ?? 0);
      check(n("127.0.0.1") > 0 && n("127.0.0.1") > n(gw), JSON.stringify({ counts, gw }));
      return {
        browserSignIn: s.role,
        recordedAddresses: counts,
        gateway: gw,
        note: "The browser's requests through the proxy are recorded as 127.0.0.1, its own address. The few gateway lines are the reviewer's direct readiness probes to 127.0.0.1:<PORT>, which bypass the proxy.",
      };
    },
  );
};

phases["r2-inst-trust"] = async () => {
  const p = I;
  const gw = envGet(p, "TRUSTED_PROXIES");
  const send = (m, r, o) => viaProxy(m, r, o);
  await step(
    r2({
      ...INSTALL,
      action:
        "TRUSTED_PROXIES set to the gateway (the guide's value): one client's wrong passwords do not refuse another client's sign-in through the same-host proxy",
    }),
    async () => {
      const r = await lockoutProbe(
        send,
        "avery.morgan@doc030-install.example",
        password("instAdmin"),
      );
      const counts = recordedAddresses(p);
      check(r.correctFrom127_0_0_1 === 200, JSON.stringify(r));
      return { trustedProxies: gw, ...r, recordedAddresses: counts };
    },
  );
  await step(
    r2({
      ...INSTALL,
      action:
        "A value that does not match the proxy, 127.0.0.1: no start warning, and one client's wrong passwords refuse the other client (the guide's stated effect)",
    }),
    async () => {
      envSet(p, "TRUSTED_PROXIES", "127.0.0.1");
      const t = new Date().toISOString();
      recreate(p, "app");
      await waitReady(p);
      const warn = lines(
        sh(`docker compose logs --no-log-prefix --since ${t} app`, p.dir).stdout,
        /TRUSTED_PROXIES is not set/,
        1,
      );
      const r = await lockoutProbe(
        send,
        "avery.morgan@doc030-install.example",
        password("instAdmin"),
      );
      check(!warn.length && r.correctFrom127_0_0_1 === 429, JSON.stringify({ warn, r }));
      return { trustedProxies: "127.0.0.1", startWarning: warn.length > 0, ...r };
    },
  );
  await step(
    r2({
      ...DIAG,
      action:
        "App keeps restarting: an entry in TRUSTED_PROXIES that is not an IP address or CIDR range stops the start with invalid IP address; the gateway value recovers",
    }),
    async () => {
      envSet(p, "TRUSTED_PROXIES", "proxy.doc030.example");
      const t = new Date().toISOString();
      recreate(p, "app");
      await sleep(20_000);
      const logs = sh(`docker compose logs --no-log-prefix --since ${t} app`, p.dir).stdout;
      const line = lines(logs, /invalid IP address/i, 1);
      const st = sh(
        `docker inspect --format '{{.RestartCount}} {{.State.Status}}' $(docker compose ps -aq app)`,
        p.dir,
      ).stdout.trim();
      const ready = await http(`${p.base}/readyz`);
      envSet(p, "TRUSTED_PROXIES", gw);
      recreate(p, "app");
      await waitReady(p);
      check(line.length && ready.status !== 200, JSON.stringify({ line, st, ready: ready.status }));
      return {
        firstError: line,
        restartsAndState: st,
        readyz: ready.status,
        recovery: `TRUSTED_PROXIES=${gw} again; readyz 200`,
      };
    },
  );
};

phases["r2-up-proxy"] = async () => {
  const p = U;
  await step(
    r2({
      ...UPGRADE,
      action:
        "Fixture: a same-host Caddy reverse proxy in front of the installation; its origin is BASE_URL",
    }),
    () => {
      const dir = path.join(WORK, "caddy-up");
      mkdirSync(dir, { recursive: true, mode: 0o700 });
      writeFileSync(
        path.join(dir, "Caddyfile"),
        `{\n\tadmin off\n\tauto_https off\n\tdefault_bind 127.0.0.1\n}\n\nhttp://:${p.proxyPort} {\n\treverse_proxy 127.0.0.1:${p.port}\n}\n`,
        { mode: 0o644 },
      );
      if (sh(`docker inspect ${PROXY_NAME}-up`, root).code !== 0)
        must(
          `docker run -d --name ${PROXY_NAME}-up --label openlaw-doc030-owner=operator-2 --network host -v ${dir}/Caddyfile:/etc/caddy/Caddyfile:ro caddy:2-alpine`,
          root,
        );
      return `caddy:2-alpine on the host network serves ${p.base} with reverse_proxy 127.0.0.1:${p.port}`;
    },
  );
};

phases["r2-up-addr"] = async () => {
  const p = U;
  await step(
    r2({
      ...UPGRADE,
      method: "browser-walkthrough",
      action:
        "Start step 2: sign in through the normal origin and check that the app records the browser's address rather than the proxy's",
      command: GUIDE_ADDRESSES,
    }),
    async () => {
      const s = await browserSignIn(p.base, state.people.admin.email, password("upAdmin"));
      await s.context.close();
      const counts = recordedAddresses(p);
      const gw = gatewayOf(p).split(" ")[0];
      const probe = await lockoutProbe(
        (m, r, o) => viaHttpProxy(p, m, r, o),
        state.people.admin.email,
        password("upAdmin"),
      );
      const n = (a) => Number(counts.find((l) => l.includes(`"${a}"`))?.split(" ")[0] ?? 0);
      check(
        n("127.0.0.1") > n(gw) && probe.correctFrom127_0_0_1 === 200,
        JSON.stringify({ counts, gw, probe }),
      );
      return {
        recordedAddresses: counts,
        gateway: gw,
        trustedProxies: envGet(p, "TRUSTED_PROXIES"),
        lockoutProbe: probe,
      };
    },
  );
};

async function saveS3Storage(page, base) {
  await page.goto(`${base}/settings/storage`);
  await page.getByLabel("Store new documents in").selectOption("s3");
  await page.getByLabel("S3 bucket").fill("doc030-op2");
  await page.getByLabel("S3 endpoint (optional for AWS)").fill("http://op2-minio:9000");
  await page.getByLabel("S3 region").fill("us-east-1");
  await page.getByLabel("S3 path-style addressing").selectOption("true");
  await page.getByLabel("S3 access key ID").fill(secrets.minio.user);
  await page.getByLabel("S3 secret access key").fill(secrets.minio.secret);
  await page.getByRole("button", { name: "Test connection" }).click();
  await page
    .getByText(/Connection test passed\.|The storage test failed/)
    .first()
    .waitFor({ timeout: 30_000 });
  const tested = (await bodyText(page)).match(
    /Connection test passed\.|The storage test failed[^.]*\./,
  )?.[0];
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await page
    .getByText("Settings saved. Restart the API and worker to apply changes.")
    .waitFor({ timeout: 15_000 });
  return tested;
}

phases["r2-br-s3"] = async () => {
  const p = U;
  secrets.minio ??= { user: "doc030op2", secret: randomBytes(18).toString("base64url") };
  saveSecrets();
  await step(
    r2({
      ...BACKUP,
      role: "administrator",
      method: "browser-walkthrough",
      action:
        "Fixture through the app on the source: an owned MinIO; Document storage saved as S3 in Settings → Advanced; a Document stored only in that bucket",
      critical: true,
    }),
    async () => {
      if (sh(`docker inspect ${MINIO_NAME}`, root).code !== 0)
        must(
          `docker run -d --name ${MINIO_NAME} --label openlaw-doc030-owner=operator-2 --network ${p.project}_openlaw-backend --network-alias op2-minio -p 127.0.0.1:${MINIO_PORT}:9000 -e MINIO_ROOT_USER=${secrets.minio.user} -e MINIO_ROOT_PASSWORD=${secrets.minio.secret} minio/minio:RELEASE.2025-09-07T16-13-09Z server /data`,
          root,
        );
      await sleep(5000);
      const { createRequire } = await import("node:module");
      const req = createRequire(path.join(root, "package.json"));
      const s3 = req(
        path.join(
          root,
          "node_modules/.pnpm/@aws-sdk+client-s3@3.1139.0/node_modules/@aws-sdk/client-s3",
        ),
      );
      const client = new s3.S3Client({
        endpoint: `http://127.0.0.1:${MINIO_PORT}`,
        region: "us-east-1",
        forcePathStyle: true,
        credentials: { accessKeyId: secrets.minio.user, secretAccessKey: secrets.minio.secret },
      });
      await client.send(new s3.CreateBucketCommand({ Bucket: "doc030-op2" })).catch((e) => {
        if (!/BucketAlready/.test(e.name)) throw e;
      });
      envSet(p, "OPENLAW_PLAIN_HTTP_HOSTS", "op2-minio");
      recreate(p);
      await waitReady(p);
      const s = await adminLogin();
      const tested = await saveS3Storage(s.page, p.base);
      await s.context.close();
      must("docker compose restart app worker", p.dir, { timeout: 240_000 });
      await waitReady(p);
      const s2 = await adminLogin();
      const body = Buffer.from(`DOC-030 operator-2 object-store file ${Date.now()}\n`);
      const up = await uploadInBrowser(
        s2.page,
        p.base,
        state.inventory.contracts[1].number,
        "doc030-op2-s3.txt",
        body,
      );
      const src = await advancedSources(s2.page, p.base);
      await s2.context.close();
      const ref = psql(p, `select file_ref from document_versions where id = '${up.versionId}'`);
      state.s3Doc = { ...up, contract: state.inventory.contracts[1].number };
      check(tested === "Connection test passed." && ref.startsWith("s3:"), `${tested} ${ref}`);
      return {
        testConnection: tested,
        fileRefPrefix: ref.split(":")[0],
        savedInOpenLaw: Object.values(src)
          .flat()
          .filter((l) => l.includes("Saved in OpenLaw")),
      };
    },
  );
};

async function wrongKeyObservation(p, base, meta, label) {
  const good = secrets.up.OPENLAW_SECRET_KEY;
  envSet(p, "OPENLAW_SECRET_KEY", randomBytes(32).toString("base64"));
  const t = new Date().toISOString();
  recreate(p);
  await sleep(35_000);
  const ready = await http(`${p.base}/readyz`);
  const logs = sh(`docker compose logs --no-log-prefix --since ${t} app`, p.dir).stdout;
  const states = ["app", "worker"].map(
    (svc) =>
      `${svc} ${sh(`docker inspect --format '{{.RestartCount}} {{.State.Status}}' $(docker compose ps -aq ${svc})`, p.dir).stdout.trim()}`,
  );
  const s = await browserSignIn(base, state.people.admin.email, password("upAdmin"));
  const src = await advancedSources(s.page, base);
  const st = await systemStatus(s.page, base);
  const d = state.s3Doc;
  const s3dl = await s.request(
    "GET",
    `/api/v1/documents/${d.documentId}/versions/${d.versionId}/download`,
  );
  const email = (await s.request("GET", "/api/v1/email-settings")).body;
  const test = await s.request("POST", "/api/v1/email-settings/test");
  await s.page.goto(`${base}/settings/ai-analysis`);
  await s.page.getByRole("button", { name: "Provider", exact: true }).first().click();
  const aiText =
    (await bodyText(s.page)).match(/Key in use|No key saved|Key missing|Paste[^.]*\./)?.[0] ?? null;
  const ai = await s.request("POST", "/api/v1/ai-connector/test");
  await s.context.close();
  const obs = {
    readyz: ready.status,
    restartCountsAndStates: states,
    startLog: lines(
      logs,
      /No configured key opens|Device notifications are off|Advanced settings cannot be decrypted/,
      3,
    ),
    advancedFields: {
      instance: src["Instance address"],
      uploads: src["File uploads"],
      storage: src["Document storage"].filter((l) => !/secret/i.test(l)),
    },
    systemStatus: st.activeStorage,
    s3OnlyDocumentDownload: s3dl.status,
    emailSource: email?.source,
    testEmail: `${test.status} ${test.body?.detail ?? ""}`,
    aiConnectorPage: aiText,
    aiTest: `${ai.status} ${ai.body?.detail ?? ""}`.slice(0, 200),
  };
  envSet(p, "OPENLAW_SECRET_KEY", good);
  recreate(p);
  await waitReady(p);
  const s2 = await browserSignIn(base, state.people.admin.email, password("upAdmin"));
  const src2 = await advancedSources(s2.page, base);
  const s3dl2 = await s2.request(
    "GET",
    `/api/v1/documents/${d.documentId}/versions/${d.versionId}/download`,
  );
  await s2.context.close();
  obs.afterRetainedKey = {
    uploads: src2["File uploads"],
    storageDriver: src2["Document storage"][0],
    s3OnlyDocumentDownload: `${s3dl2.status}${s3dl2.status === 200 && sha256(s3dl2.buffer) === d.sha256 ? ", SHA-256 matches" : ""}`,
  };
  void meta;
  void label;
  return obs;
}

phases["r2-br-wrongkey"] = async () => {
  const p = R;
  await step(
    r2({
      ...BACKUP,
      action:
        "If verification fails: a target whose OPENLAW_SECRET_KEY differs from the source (No configured key row; Fields show Default row); supply the retained key and recreate",
      expected:
        "The line names columns such as advanced_settings, smtp_url or vapid_private_key. App and worker still start and each value reads as empty. Advanced fields show Default; storage falls back to local; a Document only in the saved store fails to download; the instance address falls back to BASE_URL.",
    }),
    async () => {
      const obs = await wrongKeyObservation(p, p.base, BACKUP, "restored target");
      check(
        obs.readyz === 200 &&
          obs.startLog.some(
            (l) => /advanced_settings/.test(l) && /smtp_url/.test(l) && /vapid_private_key/.test(l),
          ) &&
          obs.advancedFields.uploads[0].endsWith("[Default]") &&
          obs.systemStatus === "Active storage: local" &&
          obs.s3OnlyDocumentDownload !== 200 &&
          obs.advancedFields.instance[0].includes(p.base) &&
          obs.afterRetainedKey.s3OnlyDocumentDownload.startsWith("200") &&
          obs.afterRetainedKey.uploads[0].includes("150"),
        JSON.stringify(obs),
      );
      return obs;
    },
  );
};

phases["r2-diag-trust"] = async () => {
  const p = D;
  const send = (m, r, o) => viaHttpProxy(p, m, r, o);
  await step(
    r2({
      ...DIAG,
      action:
        "Password sign-in refuses people who did not enter a wrong password: warning when unset; recorded addresses with the guide's command; set the gateway; sign in through the proxy; recorded addresses are the browsers'",
      command: GUIDE_ADDRESSES,
    }),
    async () => {
      const gw = gatewayOf(p).split(" ")[0];
      envSet(p, "TRUSTED_PROXIES", null);
      let t = new Date().toISOString();
      recreate(p, "app");
      await waitReady(p);
      const warn = lines(
        sh(`docker compose logs --no-log-prefix --since ${t} app`, p.dir).stdout,
        /TRUSTED_PROXIES is not set/,
        1,
      );
      const unset = await lockoutProbe(send, state.people.admin.email, password("upAdmin"));
      const countsUnset = recordedAddresses(p);
      envSet(p, "TRUSTED_PROXIES", gw);
      t = new Date().toISOString();
      recreate(p, "app");
      await waitReady(p);
      const warn2 = lines(
        sh(`docker compose logs --no-log-prefix --since ${t} app`, p.dir).stdout,
        /TRUSTED_PROXIES is not set/,
        1,
      );
      await sleep(12_000);
      const s = await browserSignIn(p.base, state.people.admin.email, password("upAdmin"));
      await s.context.close();
      const set = await lockoutProbe(send, state.people.admin.email, password("upAdmin"));
      await sleep(1000);
      const counts = sh(
        `docker compose logs --since ${t} app | grep -o '"remoteAddress":"[^"]*"' | sort | uniq -c`,
        p.dir,
      )
        .stdout.trim()
        .split("\n")
        .map((l) => l.trim().replace(/\s+/g, " "));
      check(
        warn.length &&
          unset.correctFrom127_0_0_1 === 429 &&
          !warn2.length &&
          set.correctFrom127_0_0_1 === 200 &&
          !counts.some((l) => l.includes(`"${gw}"`)),
        JSON.stringify({ warn, unset, warn2, set, counts }),
      );
      return {
        unset: { startWarning: warn, ...unset, recordedAddressesLast5m: countsUnset },
        gateway: gw,
        set: {
          startWarning: warn2.length > 0,
          browserSignIn: s.role,
          ...set,
          recordedAddressesSinceRecreate: counts,
        },
      };
    },
  );
};

phases["r2-diag-origin"] = async () => {
  const p = D;
  await step(
    r2({
      ...DIAG,
      action:
        "Sign-in or emailed links fail behind the proxy: a saved Application address refuses sign-in; removing it without BASE_URL leaves http://localhost:3000 and sign-in still fails; setting BASE_URL fixes it",
      expected:
        "Set BASE_URL in .env to the public origin; it pins the address over a saved one. Removing a saved address without setting BASE_URL leaves the app on http://localhost:3000, and sign-in through the proxy still fails.",
    }),
    async () => {
      const out = {};
      envSet(p, "BASE_URL", null);
      recreate(p);
      await waitReady(p);
      let fx = new Api(p.base, "http://localhost:3000");
      await fx.signIn(state.people.admin.email, password("upAdmin"));
      let cur = await fx.get("/api/v1/advanced-settings/instance");
      await fx.put("/api/v1/advanced-settings/instance", {
        version: cur.version,
        values: { BASE_URL: "http://127.0.0.1:24699" },
      });
      must("docker compose restart app worker", p.dir, { timeout: 240_000 });
      await waitReady(p);
      out.savedWrongAddress = (
        await new Api(p.base).raw("POST", "/api/auth/sign-in/email", {
          json: { email: state.people.admin.email, password: password("upAdmin") },
        })
      ).status;
      const reset = sh(
        "docker compose run -T --rm --no-deps app node apps/api/dist/reset-advanced-settings.js instance",
        p.dir,
      );
      must("docker compose restart app worker", p.dir, { timeout: 240_000 });
      await waitReady(p);
      out.resetCommand = `exit ${reset.code}: ${reset.stdout.trim().split("\n").pop()}`;
      out.signInThroughProxyAfterRemoval = (
        await new Api(p.base).raw("POST", "/api/auth/sign-in/email", {
          json: { email: state.people.admin.email, password: password("upAdmin") },
        })
      ).status;
      fx = new Api(p.base, "http://localhost:3000");
      await fx.signIn(state.people.admin.email, password("upAdmin"));
      cur = await fx.get("/api/v1/advanced-settings/instance");
      out.instanceAfterRemoval = cur.fields.map((f) => `${f.key} = ${f.value} [${f.source}]`);
      envSet(p, "BASE_URL", p.base);
      recreate(p);
      await waitReady(p);
      const s = await adminLogin();
      out.afterBaseUrl = {
        browserSignIn: s.role,
        instance: (await advancedSources(s.page, p.base))["Instance address"],
      };
      await s.context.close();
      check(
        out.savedWrongAddress !== 200 &&
          reset.code === 0 &&
          out.signInThroughProxyAfterRemoval !== 200 &&
          out.instanceAfterRemoval[0].startsWith("BASE_URL = http://localhost:3000") &&
          out.afterBaseUrl.browserSignIn === "administrator",
        JSON.stringify(out),
      );
      return out;
    },
  );
};

phases["r2-diag-wrongkey"] = async () => {
  const p = D;
  await step(
    r2({
      ...DIAG,
      action:
        "Email and stored credentials: a wrong OPENLAW_SECRET_KEY; app and worker start; the start log names the columns; relay unset with the exact test-send message; AI Saved key missing; Advanced values fall back; restore the key",
      expected:
        "The app and worker still start with a wrong key, and each of those values reads as empty. Saved Settings → Advanced values fall back to the environment or the defaults, including local storage. The AI connector loses its secret; device notifications stop.",
    }),
    async () => {
      const obs = await wrongKeyObservation(p, p.base, DIAG, "diagnosis instance");
      check(
        obs.readyz === 200 &&
          obs.startLog.some((l) => /advanced_settings/.test(l)) &&
          obs.startLog.some((l) => /Device notifications are off/.test(l)) &&
          obs.emailSource === "unset" &&
          obs.testEmail.includes(
            "The test email could not be sent. SMTP is not configured — save a relay first.",
          ) &&
          !obs.aiTest.startsWith("200") &&
          obs.systemStatus === "Active storage: local" &&
          obs.s3OnlyDocumentDownload !== 200 &&
          obs.afterRetainedKey.s3OnlyDocumentDownload.startsWith("200"),
        JSON.stringify(obs),
      );
      return obs;
    },
  );
  await step(
    r2({
      ...DIAG,
      action:
        "Remove saved Advanced settings under a wrong key: the start log names advanced_settings; the command still exits successfully and erases every section; the correct key cannot recover them; pinning the storage variables in .env makes the stored Document readable",
      expected:
        "With a key that cannot open the saved settings, it still exits successfully and prints the same message, but it replaces the whole saved configuration with an empty one.",
    }),
    async () => {
      const good = secrets.up.OPENLAW_SECRET_KEY;
      let s = await adminLogin();
      const before = Object.values(await advancedSources(s.page, p.base))
        .flat()
        .filter((l) => l.includes("Saved in OpenLaw"));
      await s.context.close();
      envSet(p, "OPENLAW_SECRET_KEY", randomBytes(32).toString("base64"));
      const t = new Date().toISOString();
      recreate(p);
      await waitReady(p);
      const startLine = lines(
        sh(`docker compose logs --no-log-prefix --since ${t} app`, p.dir).stdout,
        /No configured key opens/,
        1,
      );
      const reset = sh(
        "docker compose run -T --rm --no-deps app node apps/api/dist/reset-advanced-settings.js mcp",
        p.dir,
      );
      envSet(p, "OPENLAW_SECRET_KEY", good);
      recreate(p);
      await waitReady(p);
      s = await adminLogin();
      const after = Object.values(await advancedSources(s.page, p.base))
        .flat()
        .filter((l) => l.includes("Saved in OpenLaw"));
      const d = state.s3Doc;
      const dl = (
        await s.request("GET", `/api/v1/documents/${d.documentId}/versions/${d.versionId}/download`)
      ).status;
      await s.context.close();
      for (const [k, v] of [
        ["S3_BUCKET", "doc030-op2"],
        ["S3_ENDPOINT", "http://op2-minio:9000"],
        ["S3_REGION", "us-east-1"],
        ["S3_FORCE_PATH_STYLE", "true"],
        ["S3_ACCESS_KEY_ID", secrets.minio.user],
        ["S3_SECRET_ACCESS_KEY", secrets.minio.secret],
      ])
        envSet(p, k, v);
      recreate(p);
      await waitReady(p);
      s = await adminLogin();
      const dl2 = await s.request(
        "GET",
        `/api/v1/documents/${d.documentId}/versions/${d.versionId}/download`,
      );
      await s.context.close();
      const out = {
        savedBefore: before,
        startLogUnderWrongKey: startLine,
        resetMcpUnderWrongKey: `exit ${reset.code}: ${reset.stdout.trim().split("\n").pop()}`,
        savedAfterRetainedKey: after,
        s3DocumentAfterErase: dl,
        afterPinningStorageInEnv: `${dl2.status}${dl2.status === 200 && sha256(dl2.buffer) === d.sha256 ? ", SHA-256 matches" : ""}`,
      };
      check(
        before.length >= 2 &&
          /advanced_settings/.test(startLine[0] ?? "") &&
          reset.code === 0 &&
          after.length === 0 &&
          dl !== 200 &&
          dl2.status === 200,
        JSON.stringify(out),
      );
      return out;
    },
  );
};

// ---------------------------------------------------------------- browser record helpers

async function createContractInBrowser(page, base, title) {
  // create-contract.md: Contracts, Create contract, Title, Contract type (Default first), Create.
  await page.goto(`${base}/contracts`);
  await page.getByRole("button", { name: "Create contract" }).first().click();
  const dialog = page.getByRole("dialog").first();
  await dialog.waitFor({ timeout: 15_000 });
  await dialog.getByLabel(/^Title/).fill(title);
  const typeSelect = dialog.getByLabel(/^Contract type/);
  const typeShown = await typeSelect
    .evaluate((el) =>
      el.tagName === "SELECT" ? el.options[el.selectedIndex]?.textContent : el.textContent,
    )
    .catch(() => null);
  const create = dialog.getByRole("button", { name: "Create", exact: true });
  await create.click();
  await page.waitForURL(/\/contracts\/\d+/, { timeout: 30_000 });
  const number = Number(new URL(page.url()).pathname.match(/\/contracts\/(\d+)/)[1]);
  return {
    number,
    title,
    how: `Contracts, Create contract, Title "${title}", Contract type showing "${typeShown}", Create opened /contracts/${number}`,
  };
}

async function uploadInBrowser(page, base, number, filename, bytes) {
  try {
    return await uploadInBrowserOnce(page, base, number, filename, bytes);
  } catch (e) {
    await page.screenshot({ path: path.join(WORK, "upload-failure.png") }).catch(() => {});
    throw new Error(
      `${e.message.split("\n")[0]}; at ${page.url()}; page: ${(await bodyText(page)).slice(0, 400)}`,
    );
  }
}
async function uploadInBrowserOnce(page, base, number, filename, bytes) {
  // document-versions.md: Documents tab, Upload, Upload document dialog, Choose files, Upload.
  await page.goto(`${base}/contracts/${number}`);
  await page.locator(`a[href="/contracts/${number}/documents"]`).first().click();
  await page.getByRole("button", { name: "Upload", exact: true }).first().click();
  const dialog = page.getByRole("dialog", { name: "Upload document" });
  await dialog.waitFor({ timeout: 15_000 });
  const chooser = page.waitForEvent("filechooser", { timeout: 15_000 });
  await dialog
    .getByRole("button", { name: "Choose files" })
    .or(dialog.getByText("Choose files"))
    .first()
    .click();
  const fc = await chooser;
  await fc.setFiles({
    name: filename,
    mimeType: filename.endsWith(".pdf") ? "application/pdf" : "text/plain",
    buffer: bytes,
  });
  await dialog
    .getByText(filename)
    .first()
    .waitFor({ timeout: 10_000 })
    .catch(() => {});
  const waitCreate = page.waitForResponse(
    (r) =>
      /\/api\/v1\/contracts\/\d+\/documents$/.test(new URL(r.url()).pathname) &&
      r.request().method() === "POST",
    { timeout: 60_000 },
  );
  await dialog.getByRole("button", { name: "Upload", exact: true }).click();
  const response = await waitCreate.catch(async (e) => {
    await page.screenshot({ path: path.join(WORK, "upload-timeout.png") }).catch(() => {});
    throw new Error(`${e.message}; page: ${(await bodyText(page)).slice(0, 300)}`);
  });
  const body = await response.json();
  const doc = body.document;
  const version = doc.versions.find((v) => v.isCurrent) ?? doc.versions[0];
  await page
    .getByText(filename.replace(/\.[a-z]+$/, ""))
    .first()
    .waitFor({ timeout: 20_000 })
    .catch(() => {});
  return {
    documentId: doc.id,
    versionId: version.id,
    sha256: sha256(bytes),
    how: `Documents tab, Upload, Upload document dialog, Choose files ${filename}, Upload (${response.status()})`,
  };
}

// ---------------------------------------------------------------- main

const phase = process.argv[2];
if (!phases[phase]) {
  console.error(`Usage: walkthrough.mjs ${Object.keys(phases).join("|")}`);
  process.exit(2);
}
setPhase(phase);
const run = {
  phase,
  argument: process.argv[3] ?? null,
  round: ROUND,
  articleHashes: Object.fromEntries(
    Object.entries(log.articles).map(([k, v]) => [k, v.contentSha256.slice(0, 16)]),
  ),
  startedAt: new Date().toISOString(),
  finishedAt: null,
};
log.runs.push(run);
try {
  await phases[phase](process.argv[3]);
} catch (error) {
  console.error(redact(error?.stack ?? error));
  run.error = redact(error?.message ?? String(error)).slice(0, 800);
} finally {
  run.finishedAt = new Date().toISOString();
  saveLog();
  saveState();
  await closeBrowser();
}
process.exit(run.error ? 1 : 0);

export {
  phases,
  BASELINE,
  CPROXY_NAME,
  CPROXY_PORT,
  ALT_PORT,
  UPGRADE,
  BACKUP,
  DIAG,
  attach,
  containerImage,
  imageIds,
  psql,
  secretValues,
  textState,
  rmSync,
  guideFailure,
  productBug,
  MAIL_UI,
};
