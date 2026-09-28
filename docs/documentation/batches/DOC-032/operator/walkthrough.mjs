// DOC-032 independent operator walkthrough, group "operator".
// Articles: install (V-C44) and upgrade (V-C46). Method: container-operation, role: operator.
//
// Written by the DOC-032 independent walkthrough agent (operator), after the pattern of
// docs/documentation/batches/DOC-030/operator-2/walkthrough.mjs. Each guide is followed on
// disposable Compose projects named openlaw-doc032-op*, cloned from GitHub at the revisions the
// guides name and built by the guides' own commands. Private state (keys, passwords, tokens,
// backups, the seed's output) lives in ~/.cache/openlaw-doc032-operator and is removed at the end.
//
// Run one phase at a time from the documentation worktree root, with the starting build's seed
// password in LAB_PASSWORD for the upgrade phases:
//   node docs/documentation/batches/DOC-032/operator/walkthrough.mjs <phase> [argument]
import https from "node:https";
import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import {
  Api,
  BASELINE,
  COMMIT,
  PROJECTS,
  PROXY_IP,
  REPO,
  SUPPORT,
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
  here,
  http,
  inspectImage,
  lines,
  log,
  mailText,
  mailUi,
  must,
  networkOverride,
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
  secrets,
  setPhase,
  sh,
  sha256,
  since,
  sleep,
  state,
  step,
  toAddress,
  waitMail,
  waitReady,
  waitText,
} from "./op-lib.mjs";

const phases = {};
const I = PROJECTS.inst;
const U = PROJECTS.up;
const R = PROJECTS.recover;
const INSTALL = { article: "install", scenario: "V-C44" };
const UPGRADE = { article: "upgrade", scenario: "V-C46" };
const NET_FILE = "compose.doc032-net.yml";
const COMPOSE_FILE = `compose.yml:compose.operator.yml:${NET_FILE}`;

function password(key) {
  secrets.passwords ??= {};
  secrets.passwords[key] ??= randomBytes(14).toString("base64url");
  saveSecrets();
  return secrets.passwords[key];
}
function labPassword() {
  const value = process.env.LAB_PASSWORD;
  check(value, "LAB_PASSWORD is not set");
  return value;
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
function observe(article, note) {
  log.observations.push({ article, note, at: new Date().toISOString() });
  saveLog();
}

// ---------------------------------------------------------------- support

const AI_SERVER = `
import http from "node:http";
let calls = 0;
http.createServer((req, res) => {
  let body = "";
  req.on("data", (c) => (body += c));
  req.on("end", () => {
    calls += 1;
    const auth = req.headers.authorization ?? "";
    const ok = auth === "Bearer " + process.env.EXPECTED_KEY;
    console.log(JSON.stringify({ at: new Date().toISOString(), method: req.method, url: req.url, keyMatches: ok, calls }));
    res.setHeader("content-type", "application/json");
    if (!ok) {
      res.statusCode = 401;
      res.end(JSON.stringify({ error: { message: "Incorrect API key provided.", type: "invalid_request_error" } }));
      return;
    }
    if (req.url.endsWith("/models")) {
      res.end(JSON.stringify({ data: [{ id: "doc032-standin" }] }));
      return;
    }
    res.end(JSON.stringify({ id: "doc032", object: "chat.completion", choices: [{ index: 0, finish_reason: "stop", message: { role: "assistant", content: "{\\"ok\\":true}" } }] }));
  });
}).listen(8080);
`;
const IDP_SERVER = `
import http from "node:http";
const issuer = "http://doc032-idp:8080";
const discovery = {
  issuer,
  authorization_endpoint: issuer + "/authorize",
  token_endpoint: issuer + "/token",
  userinfo_endpoint: issuer + "/userinfo",
  jwks_uri: issuer + "/jwks",
  response_types_supported: ["code"],
  subject_types_supported: ["public"],
  id_token_signing_alg_values_supported: ["RS256"],
  scopes_supported: ["openid", "email", "profile"],
  token_endpoint_auth_methods_supported: ["client_secret_basic", "client_secret_post"],
  grant_types_supported: ["authorization_code"],
  code_challenge_methods_supported: ["S256"],
};
http.createServer((req, res) => {
  console.log(JSON.stringify({ at: new Date().toISOString(), method: req.method, url: req.url }));
  res.setHeader("content-type", "application/json");
  if (req.url.startsWith("/.well-known/openid-configuration")) return res.end(JSON.stringify(discovery));
  if (req.url.startsWith("/jwks")) return res.end(JSON.stringify({ keys: [] }));
  res.statusCode = 404;
  res.end("{}");
}).listen(8080);
`;

function caddyfile() {
  const sites = Object.values(PROJECTS)
    .filter((p) => p.host)
    .map(
      (p) => `${p.host}:${p.proxyPort} {\n\ttls internal\n\treverse_proxy 127.0.0.1:${p.port}\n}\n`,
    )
    .join("\n");
  return `{\n\tadmin off\n\thttp_port ${SUPPORT.proxy.httpPort}\n\tauto_https disable_redirects\n\tdefault_bind ${PROXY_IP}\n\tskip_install_trust\n}\n\n${sites}`;
}

phases["support-up"] = async () => {
  await step(
    {
      scenario: "setup",
      action:
        "Start owned support containers: two Mailpit relays, an AI provider stand-in, an OIDC discovery stand-in, an unrelated listener, and the same-host Caddy proxy",
    },
    () => {
      const out = [];
      const label = "--label openlaw-doc032-owner=operator";
      for (const key of ["mailInst", "mailUp"]) {
        const m = SUPPORT[key];
        if (sh(`docker inspect ${m.name}`, root).code !== 0)
          must(
            `docker run -d --name ${m.name} ${label} -p 127.0.0.1:${m.ui}:8025 axllent/mailpit:v1.30 --smtp-auth-accept-any --smtp-auth-allow-insecure`,
            root,
          );
        out.push(
          `${m.name}: Mailpit v1.30, UI 127.0.0.1:${m.ui}, joins project networks as doc032-mail`,
        );
      }
      const dir = path.join(WORK, "support");
      mkdirSync(dir, { recursive: true, mode: 0o700 });
      writeFileSync(path.join(dir, "ai.mjs"), AI_SERVER, { mode: 0o644 });
      writeFileSync(path.join(dir, "idp.mjs"), IDP_SERVER, { mode: 0o644 });
      writeFileSync(path.join(dir, "Caddyfile"), caddyfile(), { mode: 0o644 });
      secrets.ai ??= { key: `sk-doc032-${randomBytes(18).toString("base64url")}` };
      saveSecrets();
      if (sh(`docker inspect ${SUPPORT.ai.name}`, root).code !== 0)
        must(
          `docker run -d --name ${SUPPORT.ai.name} ${label} -e EXPECTED_KEY=${secrets.ai.key} -v ${dir}/ai.mjs:/srv/ai.mjs:ro node:24-slim node /srv/ai.mjs`,
          root,
        );
      out.push(
        `${SUPPORT.ai.name}: OpenAI-compatible stand-in (not a live provider), answers 200 only for the expected key`,
      );
      if (sh(`docker inspect ${SUPPORT.idp.name}`, root).code !== 0)
        must(
          `docker run -d --name ${SUPPORT.idp.name} ${label} -v ${dir}/idp.mjs:/srv/idp.mjs:ro node:24-slim node /srv/idp.mjs`,
          root,
        );
      out.push(
        `${SUPPORT.idp.name}: OIDC discovery stand-in (not a live identity provider) as doc032-idp`,
      );
      if (sh(`docker inspect ${SUPPORT.occupier.name}`, root).code !== 0)
        must(
          `docker run -d --name ${SUPPORT.occupier.name} ${label} -p 127.0.0.1:${SUPPORT.occupier.port}:80 caddy:2-alpine caddy respond --listen :80 "DOC-032 unrelated listener"`,
          root,
        );
      out.push(
        `${SUPPORT.occupier.name}: unrelated listener on 127.0.0.1:${SUPPORT.occupier.port}`,
      );
      if (sh(`docker inspect ${SUPPORT.proxy.name}`, root).code !== 0)
        must(
          `docker run -d --name ${SUPPORT.proxy.name} ${label} --network host -v ${dir}/Caddyfile:/etc/caddy/Caddyfile:ro caddy:2-alpine`,
          root,
        );
      out.push(
        `${SUPPORT.proxy.name}: Caddy on the host network, internal-CA TLS on ${PROXY_IP}, ${Object.values(
          PROJECTS,
        )
          .filter((p) => p.host)
          .map((p) => `${p.base} -> 127.0.0.1:${p.port}`)
          .join(", ")}`,
      );
      return out.join("; ");
    },
  );
};

// ---------------------------------------------------------------- install (V-C44)

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
      return `${git}; ${ssl}; Docker Engine ${server}; ${compose}; docker context show: ${ctx} (${host}); free space ${df}`;
    },
  );
};

phases["inst-source"] = async () => {
  const p = I;
  await step(
    {
      ...INSTALL,
      action:
        "Prepare step 1: clone into a new directory, enter it, and select the documented revision",
      command: `git clone ${REPO} openlaw; cd openlaw; git checkout --detach ${COMMIT}`,
    },
    () => {
      mkdirSync(p.home, { recursive: true, mode: 0o700 });
      const clone = existsSync(p.dir)
        ? null
        : must(`git clone ${REPO} openlaw`, p.home, { timeout: 900_000 });
      const co = sh(`git checkout --detach ${COMMIT}`, p.dir);
      if (co.code !== 0 && !state.pinPublication) {
        state.pinPublication = {
          at: new Date().toISOString(),
          checkoutExit: co.code,
          stderr: co.stderr.trim().slice(-200),
        };
        log.publicationBlockers = [
          {
            articles: ["install", "upgrade"],
            step: "install Prepare step 1 (git clone from GitHub, git checkout --detach 4ca41822...) and upgrade Prepare steps 1-2 (git fetch origin; git checkout --detach 4ca41822...)",
            observed: `git clone ${REPO} then git checkout --detach ${COMMIT} exit ${co.code}: "${co.stderr.trim().slice(-120)}". The revision is on no GitHub branch (git ls-remote shows dev at e924a3f3; the pin is 6 commits past it on the unpublished local branch docs/edition-refresh).`,
            consequence:
              "A reader cannot build the documented revision until it is published on a GitHub branch or tag. The guide text is otherwise correct for the pin; the walkthrough continued by fetching the pin from the local repository into the GitHub clone.",
          },
        ];
        saveLog();
      }
      const clonedExit = clone ? ` in ${Math.round(clone.ms / 1000)} s` : " (already present)";
      check(
        co.code === 0,
        `git clone exit 0${clonedExit}; git checkout --detach exit ${co.code}: ${co.stderr.slice(-300)}`,
      );
      const head = must("git rev-parse HEAD", p.dir).stdout.trim();
      check(head === COMMIT, `HEAD ${head}`);
      return `git clone exit 0${clonedExit}; git checkout --detach exit 0; HEAD ${head}`;
    },
  );
  if (must("git rev-parse HEAD", p.dir).stdout.trim() !== COMMIT)
    await step(
      {
        ...INSTALL,
        action:
          "Walkthrough deviation: fetch the unpublished pin from the local repository into the GitHub clone, then git checkout --detach",
        command: `git fetch <local repository> ${COMMIT}; git checkout --detach ${COMMIT}`,
        critical: true,
      },
      () => {
        const f = must(`git fetch ${root} ${COMMIT}`, p.dir, { timeout: 300_000 });
        must(`git checkout --detach ${COMMIT}`, p.dir);
        const head = must("git rev-parse HEAD", p.dir).stdout.trim();
        check(head === COMMIT, `HEAD ${head}`);
        return `git fetch exit ${f.code}; git checkout --detach exit 0; HEAD ${head}; the source tree is byte-identical to the pin (git status --short: ${JSON.stringify(must("git status --short", p.dir).stdout.trim())})`;
      },
    );
  await step(
    {
      ...INSTALL,
      action:
        "Prepare step 2: copy .env.example to .env with the grouped commands; a second run refuses to overwrite",
      command: ENV_COMMAND,
      expected:
        "The grouped commands refuse to overwrite an existing .env and stop before changing its keys.",
      critical: true,
    },
    () => {
      const first = existsSync(`${p.dir}/.env`) ? null : must(ENV_COMMAND, p.dir);
      const mode = must("stat -c %a .env", p.dir).stdout.trim();
      const a = envGet(p, "AUTH_SECRET");
      const k = envGet(p, "OPENLAW_SECRET_KEY");
      const hash1 = sha256(readFileSync(`${p.dir}/.env`));
      const second = sh(ENV_COMMAND, p.dir);
      const hash2 = sha256(readFileSync(`${p.dir}/.env`));
      check(
        mode === "600" && a?.length === 44 && k?.length === 44,
        `mode ${mode}, key lengths ${a?.length} ${k?.length}`,
      );
      check(
        second.code !== 0 && hash1 === hash2,
        `second run exit ${second.code}, unchanged ${hash1 === hash2}`,
      );
      return `first run exit ${first ? first.code : "(earlier run)"}; .env mode ${mode}; AUTH_SECRET and OPENLAW_SECRET_KEY hold 44-character base64 values; second run exit ${second.code} with "${lines(second.stderr, /\.env/, 1).join("")}"; .env unchanged`;
    },
  );
  await step(
    {
      ...INSTALL,
      action:
        "Prepare step 3: edit .env with project name, file list, revision, origin and port (each once); leave TRUSTED_PROXIES out",
      command: `COMPOSE_PROJECT_NAME=${p.project}; COMPOSE_FILE=compose.yml:compose.operator.yml (+ host network override); OPENLAW_BUILD_COMMIT=${COMMIT}; OPENLAW_BUILD_DIRTY=false; BASE_URL=${p.base}; PORT=${p.port}`,
      critical: true,
    },
    () => {
      for (const [key, value] of [
        ["COMPOSE_PROJECT_NAME", p.project],
        ["COMPOSE_FILE", COMPOSE_FILE],
        ["OPENLAW_BUILD_COMMIT", COMMIT],
        ["OPENLAW_BUILD_DIRTY", "false"],
        ["BASE_URL", p.base],
        ["PORT", String(p.port)],
      ])
        envSet(p, key, value);
      writeFileSync(`${p.dir}/${NET_FILE}`, networkOverride(p));
      const keys = readFileSync(`${p.dir}/.env`, "utf8")
        .split("\n")
        .filter((l) => /^[A-Z_]+=/.test(l))
        .map((l) => l.split("=")[0]);
      const dup = keys.filter((k, i) => keys.indexOf(k) !== i);
      check(dup.length === 0, `duplicate keys ${dup}`);
      check(!keys.includes("TRUSTED_PROXIES"), "TRUSTED_PROXIES present");
      const example = readFileSync(`${p.dir}/.env.example`, "utf8");
      const tpComment = lines(example, /TRUSTED_PROXIES/, 3);
      return `keys set once: ${keys.join(", ")}; TRUSTED_PROXIES and SETUP_TOKEN left out; host-specific deviation: ${NET_FILE} appended to COMPOSE_FILE to give the two networks explicit subnets ${p.subnets.join(" and ")} (this host's default address pools are exhausted); .env.example TRUSTED_PROXIES lines: ${tpComment.join(" / ")}`;
    },
  );
  await step(
    {
      ...INSTALL,
      action: "Prepare step 4: create compose.operator.yml beside compose.yml",
      critical: true,
    },
    () => {
      writeFileSync(`${p.dir}/compose.operator.yml`, OPERATOR_YML);
      return `compose.operator.yml written with the guide's three image lines (sha256 ${sha256(readFileSync(`${p.dir}/compose.operator.yml`)).slice(0, 16)})`;
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
        /^(COMPOSE_|BASE_URL$|PORT$|APP_BIND$|DATABASE_URL$|AUTH_SECRET$|OPENLAW_SECRET_KEY$|SMTP_|TRUSTED_PROXIES$)/.test(
          k,
        ),
      );
      return `both keys copied to a private secret store (mode 600) outside the installation and backup directories; exported shell deployment overrides: ${shellOverrides.length ? shellOverrides.join(", ") : "none"}`;
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
      check(
        q.stdout.trim() === "" && q.stderr.trim() === "",
        `config --quiet printed output: ${q.stderr.slice(0, 200)}`,
      );
      check(s.join(",") === "app,doc-engine,postgres,worker", `services ${s}`);
      return `config --quiet exit 0 with no output; config --services: ${s.join(", ")}`;
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
      const up = must("docker compose up -d --no-build --pull never", p.dir, { timeout: 600_000 });
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
      return `pull postgres exit 0 (${Math.round(pull.ms / 1000)} s); build app doc-engine exit 0 in ${Math.round(build.ms / 1000)} s (warm Docker build cache); openlaw-local:${COMMIT} ${app}; openlaw-engine-local:${COMMIT} ${eng}; up exit ${up.code}; ps: ${ps.join("; ")}`;
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
      state.instReadyElapsedS = Math.round(
        (Date.parse(state.instReadyAt) - Date.parse(state.installStartedAt)) / 1000,
      );
      const images = recordImages("install", p);
      return `curl --fail exit 0, body ${c.stdout.trim().slice(0, 80)}; worker running; doc-engine healthy; containers app ${images.containers.app}, worker ${images.containers.worker}, engine ${images.containers["doc-engine"]}; elapsed from the first prerequisite command to readiness ${state.instReadyElapsedS} s`;
    },
  );
  await step(
    {
      ...INSTALL,
      action: "The base Compose file publishes the app port only on the host's 127.0.0.1",
      command: "docker compose port app 3000; LAN address probe",
      expected: "A proxy on the same host can reach it and other hosts cannot.",
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

function recordedAddresses(p, sinceArg = "5m") {
  const r = sh(
    `docker compose logs --since=${sinceArg} app | grep -o '"remoteAddress":"[^"]*"' | sort | uniq -c`,
    p.dir,
  );
  return r.stdout
    .trim()
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
}
/** Requests the app recorded from the gateway other than the operator's own direct /readyz probes. */
function gatewayNonProbe(p, gw, sinceArg = "5m") {
  const out = sh(`docker compose logs --since=${sinceArg} --no-log-prefix app`, p.dir).stdout.split(
    "\n",
  );
  return out.filter((l) => l.includes(`"remoteAddress":"${gw}"`) && !l.includes('"path":"/readyz"'))
    .length;
}
function gatewayOf(p) {
  return must(
    `docker network inspect ${p.project}_openlaw-backend --format '{{range .IPAM.Config}}{{.Gateway}} {{.Subnet}}{{end}}'`,
    root,
  ).stdout.trim();
}

phases["inst-trust"] = async () => {
  const p = I;
  await step(
    {
      ...INSTALL,
      action:
        "Build step 4: the app logs a warning at start without TRUSTED_PROXIES; read the gateway with the guide's command",
      command: `docker network inspect ${p.project}_openlaw-backend --format '{{range .IPAM.Config}}{{.Gateway}} {{.Subnet}}{{end}}'`,
      critical: true,
    },
    () => {
      const logs = must("docker compose logs --no-log-prefix app", p.dir).stdout;
      const warn = lines(logs, /TRUSTED_PROXIES/, 1);
      const gw = gatewayOf(p);
      state.instGateway = gw.split(" ")[0];
      check(warn.length === 1, "no TRUSTED_PROXIES warning at start");
      check(/^\d+\.\d+\.\d+\.\d+ \d+\.\d+\.\d+\.\d+\/\d+$/.test(gw), `gateway output ${gw}`);
      return `start log warning: ${warn[0].slice(0, 220)}; the guide's command printed "${gw}"`;
    },
  );
  await step(
    {
      ...INSTALL,
      action: "Build step 4: add TRUSTED_PROXIES=<gateway> to .env and apply it",
      command: "TRUSTED_PROXIES=<gateway>; docker compose up -d --no-build --pull never",
      critical: true,
    },
    async () => {
      envSet(p, "TRUSTED_PROXIES", state.instGateway);
      const t = new Date().toISOString();
      const up = must("docker compose up -d --no-build --pull never", p.dir, { timeout: 300_000 });
      await waitReady(p);
      await sleep(3000);
      const logs = must(`docker compose logs --no-log-prefix --since ${t} app`, p.dir).stdout;
      const env = must("docker compose exec -T app printenv TRUSTED_PROXIES", p.dir).stdout.trim();
      check(env === state.instGateway, `app sees ${env}`);
      check(!/TRUSTED_PROXIES is not set/.test(logs), "warning still logged");
      return `up exit ${up.code}; ${lines(up.stderr, /Recreat|Started|Running/, 4).join(" | ")}; the app container now has TRUSTED_PROXIES=${env}; the new start log has no TRUSTED_PROXIES warning; readyz 200`;
    },
  );
};

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
    .slice(last, last + 4)
    .map((l) =>
      l
        .replace("First-run setup is open. Paste this setup token into the setup screen:", "")
        .trim(),
    )
    .find((l) => /^[A-Za-z0-9_-]{20,}$/.test(l));
  return { token, count: at.length, logs };
}

phases["inst-token"] = async () => {
  const p = I;
  await step(
    {
      ...INSTALL,
      action: "Build step 5: read the setup token from docker compose logs app",
      command: "docker compose logs app",
      expected:
        'The app prints the token after "First-run setup is open. Paste this setup token into the setup screen:"',
      critical: true,
    },
    () => {
      const { token, count } = setupTokenFromLogs(p);
      check(token, "no token after the documented line");
      secrets.instToken1 = token;
      saveSecrets();
      return `the documented line appears ${count} time(s) (one per start so far); a ${token.length}-character token follows it (not recorded)`;
    },
  );
  await step(
    {
      ...INSTALL,
      action: "Build step 5: a restart replaces a printed token; read the log again",
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
};

phases["inst-setup"] = async () => {
  const p = I;
  await step(
    {
      ...INSTALL,
      action:
        "Build step 6: configure the reverse proxy on the same host (Caddy, internal TLS) and open the intended HTTPS address",
      critical: true,
    },
    async () => {
      let r;
      for (let i = 0; i < 30; i += 1) {
        r = await viaProxy(p, "GET", "/readyz");
        if (r.status === 200) break;
        await sleep(1000);
      }
      check(r.status === 200, `proxy readyz ${r.status} ${r.text.slice(0, 120)}`);
      return `Caddy on the host network serves ${p.base} (bound to ${PROXY_IP}) with an internal-CA certificate and reverse_proxy 127.0.0.1:${p.port}; /readyz through the proxy 200. The browser maps ${p.host} to ${PROXY_IP} and accepts the internal CA; public certificate issuance is not tested.`;
    },
  );
  const s = await newSession(p.base);
  const { page } = s;
  try {
    await step(
      {
        ...INSTALL,
        role: "operator",
        method: "container-operation",
        page: "/setup",
        action:
          "Build step 6: the address reaches Set up OpenLaw; the token printed before the restart is refused",
        expected:
          'Set up OpenLaw; a replaced token shows "The setup token is missing or wrong. Copy it from the server log, or from the SETUP_TOKEN environment variable."',
        critical: true,
      },
      async () => {
        const r = await page.goto(p.base);
        await page.getByRole("heading", { name: "Set up OpenLaw" }).waitFor({ timeout: 30_000 });
        await page.getByLabel("Setup token").fill(secrets.instToken1);
        await page.getByLabel("Name", { exact: true }).fill("Morgan Ashby");
        await page.getByLabel("Email", { exact: true }).fill("morgan.ashby@doc032-install.example");
        await page.getByLabel("Password", { exact: true }).fill(password("instAdmin"));
        await page.getByLabel("Confirm password", { exact: true }).fill(password("instAdmin"));
        await sleep(1500);
        const verifiedOld = await page
          .getByText("Setup token verified")
          .isVisible()
          .catch(() => false);
        await page.getByRole("button", { name: "Create Administrator" }).click();
        const msg =
          "The setup token is missing or wrong. Copy it from the server log, or from the SETUP_TOKEN environment variable.";
        await page.getByText(msg).first().waitFor({ timeout: 15_000 });
        return `GET ${p.base} ${r?.status()} lands on ${new URL(page.url()).pathname} with heading "Set up OpenLaw" and Setup token, Name, Email, Password, Confirm password; the old token shows no "Setup token verified" (${!verifiedOld}); Create Administrator shows "${msg}"`;
      },
    );
    await step(
      {
        ...INSTALL,
        page: "/setup",
        action:
          "Build step 6: create the initial account with the current setup token (first-run setup)",
        expected:
          "Setup token verified; a successful setup signs you in and opens Welcome to OpenLaw.",
        critical: true,
      },
      async () => {
        await page.getByLabel("Setup token").fill(secrets.instToken2);
        await page.getByText("Setup token verified").waitFor({ timeout: 15_000 });
        await page.getByRole("button", { name: "Create Administrator" }).click();
        await page
          .getByRole("heading", { name: "Welcome to OpenLaw" })
          .first()
          .waitFor({ timeout: 30_000 });
        state.instSetupAt = new Date().toISOString();
        state.instSetupElapsedS = Math.round(
          (Date.parse(state.instSetupAt) - Date.parse(state.installStartedAt)) / 1000,
        );
        return `the current token shows "Setup token verified"; Create Administrator signed in the fictional Administrator and opened "Welcome to OpenLaw" at ${new URL(page.url()).pathname}; elapsed from the first prerequisite command to usable first-run setup ${state.instSetupElapsedS} s (build ${state.instBuildS} s with a warm cache)`;
      },
    );
    await step(
      {
        ...INSTALL,
        page: "/welcome",
        action:
          "first-run hand-off: work through the welcome steps; save and test the relay; invite a colleague; Finish",
        expected:
          "Continue on Outbound email stays unavailable until email is configured; the test email and the invitation arrive; Finish enters the app.",
        critical: true,
      },
      async () => {
        const seen = [];
        const stepLabel = async () => (await bodyText(page)).match(/Step \d of \d/)?.[0];
        await page.getByRole("button", { name: "Get started" }).click();
        await page.getByLabel("Organization name").fill("DOC-032 operator Install Organization");
        seen.push(await stepLabel());
        await page.getByRole("button", { name: "Continue" }).click();
        await page.getByText(/Step 3 of \d/).waitFor({ timeout: 15_000 });
        seen.push(await stepLabel());
        await page.getByRole("button", { name: "Continue" }).click();
        await page.getByText(/Step 4 of \d/).waitFor({ timeout: 15_000 });
        seen.push(await stepLabel());
        const disabled = await page.getByRole("button", { name: "Continue" }).isDisabled();
        const t0 = Date.now();
        await page.getByLabel("SMTP server").fill("doc032-mail");
        await page.getByLabel("Port", { exact: true }).fill("1025");
        await page.getByLabel("Connection security").selectOption("none");
        await page.getByLabel("Authentication").selectOption("password");
        await page.getByLabel("SMTP username").fill("doc032-install");
        await page.getByLabel("SMTP password").fill(password("instRelay"));
        await page.getByLabel("Sender name (optional)").fill("DOC-032 install");
        await page.getByLabel("Sender email").fill("openlaw@doc032-install.example");
        await page.getByRole("button", { name: "Save relay" }).click();
        await page.getByRole("button", { name: "Send test email" }).click({ timeout: 15_000 });
        const test = await waitMail(
          p,
          (m) =>
            toAddress(m, "morgan.ashby@doc032-install.example") &&
            m.Subject === "OpenLaw test email" &&
            since(m, t0),
        );
        check(test, "no test email");
        await page.getByRole("button", { name: "Continue" }).click();
        await page.getByText(/Step 5 of \d/).waitFor({ timeout: 15_000 });
        seen.push(await stepLabel());
        const t1 = Date.now();
        await page.getByLabel("Name", { exact: true }).fill("Rowan Keller");
        await page.getByLabel("Email", { exact: true }).fill("rowan.keller@doc032-install.example");
        await page.getByRole("button", { name: "Legal team member", exact: true }).click();
        await page.getByRole("button", { name: "Send invite" }).click();
        const invite = await waitMail(
          p,
          (m) => toAddress(m, "rowan.keller@doc032-install.example") && since(m, t1),
        );
        check(invite, "no invitation");
        state.instInviteId = invite.ID;
        await page.getByRole("button", { name: "Continue" }).click();
        await page.getByText(/Step 6 of \d/).waitFor({ timeout: 15_000 });
        seen.push(await stepLabel());
        await page.getByRole("button", { name: "Set up later" }).click();
        await page.getByText(/Step 7 of \d/).waitFor({ timeout: 15_000 });
        seen.push(await stepLabel());
        await page.getByRole("button", { name: "Set up later" }).click();
        await page.getByText(/Step 8 of \d/).waitFor({ timeout: 15_000 });
        seen.push(await stepLabel());
        await page.getByRole("button", { name: "Finish" }).click();
        await page.waitForURL((u) => !u.pathname.startsWith("/welcome"), { timeout: 30_000 });
        return `steps seen ${seen.join(", ")}; Continue on Outbound email disabled before a relay: ${disabled}; SMTP server doc032-mail, Port 1025, Connection security None, Authentication Username and password; Save relay then Send test email delivered "${test.Subject}"; Send invite delivered "${invite.Subject}"; E-signature and AI analysis set up later; Finish entered the app at ${new URL(page.url()).pathname}`;
      },
    );
  } finally {
    await s.context.close();
  }
  await phases["inst-addr"]();
};

phases["inst-addr"] = async () => {
  const p = I;
  await step(
    {
      ...INSTALL,
      action:
        "Build step 6: check that the app records the browser's address, not the gateway (Find the trusted proxy address)",
      command:
        'docker compose logs --since=5m app | grep -o \'"remoteAddress":"[^"]*"\' | sort | uniq -c',
      expected: "Ignoring 127.0.0.1 (health checks), the other lines show the browser's address.",
    },
    async () => {
      const b = await browserSignIn(
        p.base,
        "morgan.ashby@doc032-install.example",
        password("instAdmin"),
      );
      await b.context.close();
      const rows = recordedAddresses(p);
      const others = rows.filter((r) => !r.includes('"127.0.0.1"'));
      const gwOther = gatewayNonProbe(p, state.instGateway);
      check(b.role === "administrator", `sign-in role ${b.role}`);
      check(
        others.some((r) => r.includes(`"${PROXY_IP}"`)) && gwOther === 0,
        JSON.stringify({ rows, gwOther }),
      );
      return `browser sign-in through ${p.base} as the Administrator; the guide's command listed: ${rows.join("; ")}; the browser's requests show ${PROXY_IP}; the only gateway (${state.instGateway}) lines are the walkthrough's own direct curl /readyz probes on 127.0.0.1:${p.port} (non-probe gateway requests: ${gwOther})`;
    },
  );
};

/** A request to a proxy origin from Node (used only for readiness through the proxy). */
function viaProxy(p, method, route) {
  return new Promise((resolve) => {
    const req = https.request(
      {
        host: PROXY_IP,
        port: p.proxyPort,
        servername: p.host,
        rejectUnauthorized: false,
        method,
        path: route,
        headers: { host: `${p.host}:${p.proxyPort}` },
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
    req.end();
  });
}

phases["inst-checks"] = async () => {
  const p = I;
  const admin = "morgan.ashby@doc032-install.example";
  await step(
    {
      ...INSTALL,
      action: "Build step 5: the app prints no token once a user exists",
      command: "docker compose restart app; docker compose logs app",
    },
    async () => {
      const t = new Date().toISOString();
      must("docker compose restart app", p.dir, { timeout: 180_000 });
      await waitReady(p);
      await sleep(2000);
      const logs = must(`docker compose logs --no-log-prefix --since ${t} app`, p.dir).stdout;
      check(!logs.includes("First-run setup is open"), "a token line appeared after a user exists");
      const setup = await http(`${p.direct}/api/v1/auth/setup`);
      return `after a restart the app log has no "First-run setup is open" line; GET /api/v1/auth/setup ${setup.status} ${setup.text.slice(0, 80)}`;
    },
  );
  const s = await browserSignIn(p.base, admin, password("instAdmin"));
  const { page } = s;
  try {
    await step(
      {
        ...INSTALL,
        page: "/auth/login",
        action: "Check the working installation: sign in through the intended origin",
        critical: true,
      },
      () => {
        check(s.role === "administrator", `role ${s.role} ${s.notes.join("; ")}`);
        return `password sign-in at ${p.base}/auth/login as the Administrator; landed on ${s.landed}`;
      },
    );
    await step(
      {
        ...INSTALL,
        page: "/contracts",
        action:
          "Check the working installation: create a fictional Contract, upload a small supported Document, download it again, check its processing result",
        critical: true,
      },
      async () => {
        const created = await createContractInBrowser(
          page,
          p.base,
          "DOC-032 operator install check contract",
        );
        const body = pdf(["DOC-032 operator install check.", "Processing check words."]);
        const up = await uploadInBrowser(
          page,
          p.base,
          created.number,
          "doc032-install-check.pdf",
          body,
        );
        const got = await s.request(
          "GET",
          `/api/v1/documents/${up.documentId}/versions/${up.versionId}/download`,
        );
        const text = await waitText(s.request, up.documentId, up.versionId, 240_000);
        check(got.status === 200 && sha256(got.buffer) === sha256(body), `download ${got.status}`);
        check(
          text.state === "ready" && /Processing check words/.test(text.text),
          `text ${text.state}`,
        );
        state.instContract = created;
        return `${created.how}; ${up.how}; download ${got.status} with the uploaded SHA-256 ${sha256(body).slice(0, 16)}; processing state ready with the uploaded words`;
      },
    );
  } finally {
    await s.context.close();
  }
  await step(
    {
      ...INSTALL,
      page: "/auth/reset-password",
      action:
        "Check the working installation: the test invitation reached the recipient with a usable link",
    },
    async () => {
      const link = (await mailText(p, state.instInviteId)).match(/https?:\/\/[^\s)>\]]+/)?.[0];
      check(link && new URL(link).origin === p.base, `link origin ${link && new URL(link).origin}`);
      const c = await newSession(p.base);
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
        p.base,
        "rowan.keller@doc032-install.example",
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
      const s2 = await browserSignIn(p.base, admin, password("instAdmin"));
      try {
        const body = pdf(["DOC-032 operator after worker restart.", "Worker restart words."]);
        const up = await uploadInBrowser(
          s2.page,
          p.base,
          state.instContract.number,
          "doc032-install-after-restart.pdf",
          body,
        );
        const text = await waitText(s2.request, up.documentId, up.versionId, 240_000);
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
        `docker volume inspect ${p.project}_openlaw-files --format '{{.Name}}'`,
        root,
      ).stdout.trim();
      const images = recordImages("install-final", p);
      return `source ${rev}; project ${p.project}; origin ${p.base}; storage local driver on volume ${vol}; images app ${images.containers.app}, worker ${images.containers.worker}, engine ${images.containers["doc-engine"]}, postgres ${images.containers.postgres}; operator contact: fictional`;
    },
  );
};

phases["inst-negatives"] = async () => {
  const p = I;
  await step(
    {
      ...INSTALL,
      action:
        "Negative (missing secret): a blank AUTH_SECRET is refused by Compose; the retained key recovers (If startup fails -> operator troubleshooting)",
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
        "Negative (occupied port): the documented recovery (ps --all shows created; choose an unused port; same up again)",
      expected:
        "Troubleshooting row: after a failed bind, ps --all shows app and worker created, plain ps does not list them; the instance stays down until the port is corrected.",
    },
    async () => {
      const occ = SUPPORT.occupier.port;
      const holder = await http(`http://127.0.0.1:${occ}/`);
      check(holder.status === 200, `occupier ${holder.status}`);
      envSet(p, "PORT", String(occ));
      const u = sh("docker compose up -d --no-build --pull never", p.dir, { timeout: 300_000 });
      const all = psAll(p).map((r) => `${r.service} ${r.state}`);
      const plain = sh("docker compose ps --format '{{.Service}} {{.State}}'", p.dir)
        .stdout.trim()
        .split("\n")
        .filter(Boolean);
      const down = await http(`http://127.0.0.1:${p.port}/readyz`, { timeoutMs: 3000 });
      const other = await http(`http://127.0.0.1:${occ}/`);
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
        "Negative (unavailable dependency): database stopped; /healthz works, /readyz fails; restoring it recovers a record read and write",
      expected: "Troubleshooting row: restore connectivity, then verify a record read and write.",
    },
    async () => {
      must("docker compose stop postgres", p.dir);
      await sleep(4000);
      const h = await http(`${p.direct}/healthz`);
      const r = await http(`${p.direct}/readyz`);
      must("docker compose start postgres", p.dir);
      await waitReady(p, 180_000);
      const s = await browserSignIn(
        p.base,
        "morgan.ashby@doc032-install.example",
        password("instAdmin"),
      );
      const read = await s.request("GET", `/api/v1/contracts/${state.instContract.number}`);
      const write = await s.request("PATCH", `/api/v1/contracts/${state.instContract.number}`, {
        description: `DOC-032 operator write check ${new Date().toISOString()}`,
      });
      await s.context.close();
      check(
        h.status === 200 && r.status !== 200 && read.status === 200 && write.status === 200,
        `healthz ${h.status} readyz ${r.status} read ${read.status} write ${write.status}`,
      );
      return `with postgres stopped: healthz ${h.status}, readyz ${r.status} ${r.text.slice(0, 60)}; after docker compose start postgres: readyz 200, Contract read ${read.status}, write ${write.status} from the Administrator's browser session`;
    },
  );
  await step(
    {
      ...INSTALL,
      action: "Negative: the authoring lab is not counted as production install evidence",
    },
    () =>
      `Every V-C44 step ran against ${p.project}, cloned from GitHub and built by the guide's own commands, with the guide's .env, compose.operator.yml and a same-host Caddy proxy. No lab.mjs lab, seed data or development overlay was used. Only host deviation: ${NET_FILE} (explicit subnets) in COMPOSE_FILE.`,
  );
};

// ---------------------------------------------------------------- shared install helper (other projects)

/** install.md: clone, select the revision, .env, compose.operator.yml (and the host subnet override). */
function installFiles(p, revision, extra = {}) {
  mkdirSync(p.home, { recursive: true, mode: 0o700 });
  const out = [];
  if (!existsSync(p.dir)) {
    const c = must(`git clone ${REPO} openlaw`, p.home, { timeout: 900_000 });
    out.push(`git clone ${REPO} exit 0 (${Math.round(c.ms / 1000)} s)`);
  }
  if (sh(`git cat-file -e ${revision}^{commit}`, p.dir).code !== 0) {
    must(`git fetch ${root} ${revision}`, p.dir, { timeout: 300_000 });
    out.push(`${revision.slice(0, 8)} is on no GitHub branch; fetched from the local repository`);
  }
  must(`git checkout --detach ${revision}`, p.dir);
  out.push(`git checkout --detach ${revision.slice(0, 8)} exit 0`);
  if (!existsSync(`${p.dir}/.env`)) {
    must(ENV_COMMAND, p.dir);
    out.push("grouped .env commands exit 0");
  }
  for (const [key, value] of Object.entries({
    COMPOSE_PROJECT_NAME: p.project,
    COMPOSE_FILE,
    OPENLAW_BUILD_COMMIT: revision,
    OPENLAW_BUILD_DIRTY: "false",
    BASE_URL: p.base,
    PORT: String(p.port),
    ...extra,
  }))
    envSet(p, key, value);
  writeFileSync(`${p.dir}/compose.operator.yml`, OPERATOR_YML);
  writeFileSync(`${p.dir}/${NET_FILE}`, networkOverride(p));
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

// ---------------------------------------------------------------- upgrade (V-C46): starting build and seed

/** Scratch copy of the starting build's seed with the two fixture fixes described in phase up-seed. */
phases["seed-prepare"] = async () => {
  await step(
    {
      ...UPGRADE,
      method: "automated-test",
      action:
        "Fixture: scratch copy of scripts/seed at 067c1646 with 00528360's contracts.mjs fix and the stand-in's base_uri on its network alias",
      critical: true,
    },
    () => {
      const dir = path.join(WORK, "seed067");
      rmSync(dir, { recursive: true, force: true });
      mkdirSync(dir, { recursive: true, mode: 0o700 });
      must(`git archive ${BASELINE} scripts/seed | tar -x -C ${dir}`, root);
      must(`git show 00528360 -- scripts/seed/contracts.mjs | patch -p1 -d ${dir}`, root);
      const stub = path.join(dir, "scripts/seed/signing-stub.mjs");
      const before = readFileSync(stub, "utf8");
      const after = before.replace(
        "base_uri: `http://127.0.0.1:${port}`,",
        "base_uri: `http://doc032-seed:${port}`,",
      );
      check(after !== before, "base_uri line not found");
      writeFileSync(stub, after);
      return "git archive 067c1646 scripts/seed; patch from 00528360 applied to contracts.mjs; signing-stub.mjs base_uri http://doc032-seed:8129";
    },
  );
};

const FIXTURE_ENV = [
  "SETUP_TOKEN",
  "AUTH_RATE_LIMIT",
  "SIGNING_STANDIN",
  "DOCUSIGN_BASE_URL",
  "SMTP_URL",
  "SMTP_FROM",
];
async function seedData() {
  // The starting build's seed data (the checkout moves to the target during the upgrade).
  return import(path.join(WORK, "seed067/scripts/seed/data.mjs"));
}

phases["up-baseline"] = async () => {
  const p = U;
  await step(
    {
      ...UPGRADE,
      action:
        "Fixture: install the starting build 067c1646 with the installation guide's files (TRUSTED_PROXIES as the starting build's .env.example suggested)",
      critical: true,
    },
    () => {
      const out = installFiles(p, BASELINE, { TRUSTED_PROXIES: "127.0.0.1,::1" });
      secrets.upSetupToken ??= randomBytes(18).toString("base64url");
      saveSecrets();
      envSet(p, "SETUP_TOKEN", secrets.upSetupToken);
      envSet(p, "AUTH_RATE_LIMIT", "off");
      envSet(p, "SIGNING_STANDIN", "true");
      envSet(p, "DOCUSIGN_BASE_URL", "http://doc032-seed:8129");
      // As in the lab overlay: the seed finishes onboarding only with deployment email set.
      envSet(p, "SMTP_URL", "smtp://doc032-mail:1025");
      envSet(p, "SMTP_FROM", '"OpenLaw <legal@helix.example>"');
      keepKeys(p);
      const example = lines(readFileSync(`${p.dir}/.env.example`, "utf8"), /TRUSTED_PROXIES/, 3);
      return `${out.join("; ")}; starting build .env.example TRUSTED_PROXIES lines: ${example.join(" / ")}; fixture-only settings for the seed (removed before the upgrade): SETUP_TOKEN, AUTH_RATE_LIMIT=off, SIGNING_STANDIN=true, DOCUSIGN_BASE_URL=http://doc032-seed:8129, SMTP_URL=smtp://doc032-mail:1025, SMTP_FROM (as the lab overlay sets them)`;
    },
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
      must("docker compose config --quiet", p.dir);
      const b = must("docker compose build app doc-engine", p.dir, { timeout: 3_000_000 });
      must("docker compose up -d --no-build --pull never", p.dir, { timeout: 600_000 });
      attachSupport(p);
      await waitReady(p, 600_000);
      const port = must("docker compose port app 3000", p.dir).stdout.trim();
      const images = recordImages("upgrade-starting-build", p);
      return `build ${Math.round(b.ms / 1000)} s; readyz 200; port ${port}; app ${images.containers.app}, worker ${images.containers.worker}, engine ${images.containers["doc-engine"]}`;
    },
  );
};

phases["up-seed"] = async () => {
  const p = U;
  await step(
    {
      ...UPGRADE,
      method: "automated-test",
      action:
        "Fixture: populate the starting instance with scripts/seed from 067c1646 plus the one-file seed fix 00528360 and the signing stand-in answering as doc032-seed (light profile, random seed 7, e-signature Envelopes against the seed's own stand-in)",
      command:
        "node scripts/seed/index.mjs --scale light --seed 7 --skip-ai --with-signing --only-if-empty --wait (inside a node:24-slim container on the project's backend network, SEED_BASE_URL = the instance origin through an in-network Caddy)",
      critical: true,
    },
    () => {
      const outFile = path.join(WORK, "seed-output.log");
      // The seed sends Origin: SEED_BASE_URL, which must equal BASE_URL. An in-network Caddy
      // answers on the origin's name so the seed can reach the app at its own origin.
      const dir = path.join(WORK, "support");
      writeFileSync(
        path.join(dir, "Caddyfile.seed"),
        `{\n\tadmin off\n\tauto_https disable_redirects\n\tskip_install_trust\n}\n\n${p.host}:${p.proxyPort} {\n\ttls internal\n\treverse_proxy app:3000\n}\n`,
        { mode: 0o644 },
      );
      sh("docker rm -f openlaw-doc032-op-seedproxy", root);
      must(
        `docker run -d --name openlaw-doc032-op-seedproxy --label openlaw-doc032-owner=operator --network ${p.project}_openlaw-backend --network-alias ${p.host} -v ${dir}/Caddyfile.seed:/etc/caddy/Caddyfile:ro caddy:2-alpine`,
        root,
      );
      const r = sh(
        [
          "docker run --rm --name openlaw-doc032-op-seed --label openlaw-doc032-owner=operator",
          `--network ${p.project}_openlaw-backend --network-alias doc032-seed`,
          `-v ${path.join(WORK, "seed067")}/scripts/seed:/seed/scripts/seed:ro`,
          `-e SEED_BASE_URL=${p.base} -e SEED_MAILPIT_URL=http://doc032-mail:8025 -e SEED_SMTP_URL=smtp://doc032-mail:1025`,
          `-e SEED_WEB_URL=${p.base} -e SETUP_TOKEN -e NODE_TLS_REJECT_UNAUTHORIZED=0`,
          "node:24-slim node /seed/scripts/seed/index.mjs --scale light --seed 7 --skip-ai --with-signing --only-if-empty --wait",
          `> ${outFile} 2>&1`,
        ].join(" "),
        root,
        { env: { SETUP_TOKEN: secrets.upSetupToken }, timeout: 5_400_000 },
      );
      sh("docker rm -f openlaw-doc032-op-seedproxy", root);
      const out = readFileSync(outFile, "utf8");
      const phasesSeen = lines(out, /^\[\d\d:\d\d\] [a-z]/, 40).map((l) =>
        l.replace(/^\[\d\d:\d\d\] /, ""),
      );
      const counts = lines(
        out,
        /contracts|matters|requests|envelope|signing|entities|people|knowledge/i,
        30,
      ).filter((l) => !/password|sign in at/i.test(l));
      state.seedMs = r.ms;
      check(r.code === 0, `seed exit ${r.code}: ${out.slice(-800)}`);
      return {
        exit: r.code,
        minutes: Math.round(r.ms / 6000) / 10,
        phases: phasesSeen,
        notes: counts.slice(0, 20),
      };
    },
  );
};

phases["up-fixture"] = async () => {
  const p = U;
  const { ADMIN } = await seedData();
  check(
    ADMIN.password === labPassword(),
    "LAB_PASSWORD differs from the starting build's seed password",
  );
  await step(
    {
      ...UPGRADE,
      method: "automated-test",
      action:
        "Fixture: remove the seed-only settings (SETUP_TOKEN, AUTH_RATE_LIMIT, SIGNING_STANDIN, DOCUSIGN_BASE_URL, SMTP_URL, SMTP_FROM) and recreate app and worker",
      critical: true,
    },
    async () => {
      for (const k of FIXTURE_ENV) envSet(p, k, null);
      recreate(p);
      await waitReady(p);
      const env = sh("docker compose exec -T app env", p.dir).stdout;
      const left = FIXTURE_ENV.filter((k) => new RegExp(`^${k}=.+$`, "m").test(env));
      check(left.length === 0, `still set: ${left}`);
      return `recreated; readyz 200; none of ${FIXTURE_ENV.join(", ")} has a value in the app container (compose.yml passes SETUP_TOKEN as an empty string)`;
    },
  );
  const api = new Api(p.direct, p.base);
  await api.signIn(ADMIN.email, labPassword());
  await step(
    {
      ...UPGRADE,
      method: "automated-test",
      action: "Fixture: a saved relay with an SMTP password; its test email arrives",
      critical: true,
    },
    async () => {
      await api.put("/api/v1/email-settings", {
        smtpUrl: `smtp://doc032-upgrade:${password("upRelay")}@doc032-mail:1025`,
        smtpFrom: "Helix legal <legal@helix.example>",
      });
      const t0 = Date.now();
      await api.post("/api/v1/email-settings/test");
      const mail = await waitMail(
        p,
        (m) => toAddress(m, ADMIN.email) && m.Subject === "OpenLaw test email" && since(m, t0),
      );
      check(mail, "test email not delivered");
      return "relay smtp://doc032-upgrade:[redacted]@doc032-mail:1025 saved in the app; test email delivered to the Administrator";
    },
  );
  await step(
    {
      ...UPGRADE,
      method: "automated-test",
      action: "Fixture: AI connector (custom endpoint stand-in) with a saved key; its test passes",
      critical: true,
    },
    async () => {
      const r = await api.put("/api/v1/ai-connector", {
        preset: "custom",
        protocol: "openai_chat_completions",
        baseUrl: "http://doc032-ai:8080/v1",
        apiKey: secrets.ai.key,
        model: "doc032-standin",
      });
      const t = await api.raw("POST", "/api/v1/ai-connector/test");
      check(t.status === 200, `test ${t.status} ${t.buffer.toString().slice(0, 200)}`);
      return `connector preset ${r.connector.preset}, hasApiKey ${r.connector.hasApiKey}; test 200 through the stand-in`;
    },
  );
  await step(
    {
      ...UPGRADE,
      method: "automated-test",
      action: "Fixture: register an SSO provider (OIDC discovery stand-in) with a client secret",
      critical: true,
    },
    async () => {
      secrets.ssoSecret ??= randomBytes(18).toString("base64url");
      saveSecrets();
      const r = await api.post(
        "/api/v1/auth/sso-providers",
        {
          providerId: "doc032-idp",
          issuer: "http://doc032-idp:8080",
          domain: "doc032-sso.example",
          clientId: "doc032-client",
          clientSecret: secrets.ssoSecret,
        },
        { accept: [201] },
      );
      return `provider ${r.provider.providerId} issuer ${r.provider.issuer} domain ${r.provider.domain}; callback ${r.callbackUrl}`;
    },
  );
  await step(
    {
      ...UPGRADE,
      method: "automated-test",
      action:
        "Fixture: MCP on with a Toolset ceiling that includes Team and Administration; an Administrator's API key with Team and Administration",
      critical: true,
    },
    async () => {
      const all = [
        "workspace",
        "contracts",
        "matters",
        "tasks",
        "requests",
        "comments",
        "documents",
        "auto-docs",
        "entities",
        "knowledge",
        "people",
        "team",
        "administration",
      ];
      const m = await api.patch("/api/v1/mcp-settings", {
        enabled: true,
        legalApiKeysEnabled: true,
        toolsetCeiling: all,
        readOnly: false,
      });
      const created = await api.post(
        "/api/v1/api-key-requests",
        {
          clientName: "DOC-032 operator upgrade client",
          toolsets: ["workspace", "contracts", "team", "administration"],
          scope: "read",
        },
        { accept: [201] },
      );
      let key = created.key;
      if (!key) key = (await api.get(`/api/v1/api-key-requests/${created.id}`)).key;
      check(key, "no API key returned");
      secrets.mcpKey = key;
      state.mcpKeyId = created.id;
      saveSecrets();
      const tools = await mcpTools(p, key);
      state.mcpBefore = tools;
      return `MCP enabled; ceiling ${m.toolsetCeiling.join(", ")}; API key request ${created.status ?? "active"} for workspace, contracts, team, administration (key held privately); tools/list through the origin: ${tools.count} tools, Team/Administration tools present: ${tools.teamAdmin.join(", ") || "none"}`;
    },
  );
  const s = await browserSignIn(p.base, ADMIN.email, labPassword());
  try {
    await step(
      {
        ...UPGRADE,
        role: "administrator",
        method: "browser-walkthrough",
        page: "/settings/uploads",
        action:
          "Fixture: save Maximum file size (MiB) = 40 in Settings → Advanced → File uploads so a field shows Saved in OpenLaw",
        critical: true,
      },
      async () => {
        await s.page.goto(`${p.base}/settings/uploads`);
        const field = s.page.getByLabel("Maximum file size (MiB)");
        await field.waitFor({ timeout: 20_000 });
        await field.fill("40");
        await s.page.getByRole("button", { name: /^Save/ }).first().click();
        await s.page
          .getByText(/Settings saved/)
          .first()
          .waitFor({ timeout: 15_000 });
        return `saved; the page says "${(await bodyText(s.page)).match(/Settings saved[^.]*\.[^.]*\./)?.[0]}"`;
      },
    );
  } finally {
    await s.context.close();
  }
  await step(
    {
      ...UPGRADE,
      method: "automated-test",
      action:
        "Fixture: restart app and worker so the saved Advanced value is active on the starting build",
      command: "docker compose restart app worker",
    },
    async () => {
      must("docker compose restart app worker", p.dir, { timeout: 300_000 });
      await waitReady(p);
      return "restarted; readyz 200";
    },
  );
};

// ---------------------------------------------------------------- inventory (before and after)

function mcpPost(p, key, body, sessionId) {
  return new Promise((resolve) => {
    const data = JSON.stringify(body);
    const req = https.request(
      {
        host: PROXY_IP,
        port: p.proxyPort,
        servername: p.host,
        rejectUnauthorized: false,
        method: "POST",
        path: "/mcp",
        headers: {
          host: `${p.host}:${p.proxyPort}`,
          "x-api-key": key,
          "content-type": "application/json",
          accept: "application/json, text/event-stream",
          "content-length": Buffer.byteLength(data),
          ...(sessionId ? { "mcp-session-id": sessionId } : {}),
          "mcp-protocol-version": "2025-06-18",
        },
      },
      (res) => {
        const chunks = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => {
          const text = Buffer.concat(chunks).toString("utf8");
          let json = null;
          try {
            json = JSON.parse(text);
          } catch {
            const dataLine = text
              .split("\n")
              .reverse()
              .find((l) => l.startsWith("data:"));
            try {
              json = dataLine ? JSON.parse(dataLine.slice(5)) : null;
            } catch {
              json = null;
            }
          }
          resolve({ status: res.statusCode, json, text, session: res.headers["mcp-session-id"] });
        });
      },
    );
    req.on("error", (e) => resolve({ status: 0, text: e.message, json: null }));
    req.write(data);
    req.end();
  });
}
async function mcpTools(p, key) {
  let session;
  const list = async (cursor) => {
    const body = {
      jsonrpc: "2.0",
      id: 1,
      method: "tools/list",
      ...(cursor ? { params: { cursor } } : {}),
    };
    let r = await mcpPost(p, key, body, session);
    if (!r.json?.result && !session) {
      const init = await mcpPost(p, key, {
        jsonrpc: "2.0",
        id: 0,
        method: "initialize",
        params: {
          protocolVersion: "2025-06-18",
          capabilities: {},
          clientInfo: { name: "doc032-operator", version: "1" },
        },
      });
      session = init.session;
      await mcpPost(p, key, { jsonrpc: "2.0", method: "notifications/initialized" }, session);
      r = await mcpPost(p, key, body, session);
    }
    check(r.json?.result?.tools, `tools/list ${r.status} ${r.text.slice(0, 300)}`);
    return r.json.result;
  };
  const names = [];
  let cursor;
  for (let page = 0; page < 50; page += 1) {
    const result = await list(cursor);
    names.push(...result.tools.map((t) => t.name));
    if (!result.nextCursor) break;
    cursor = result.nextCursor;
  }
  // Team tools are openlaw_team_*; Administration tools are openlaw_audit_log_query and openlaw_settings_get (apps/api/src/mcp at the pin).
  const teamAdmin = names.filter((n) =>
    /^openlaw_team_|^openlaw_audit_log_query$|^openlaw_settings_get$/.test(n),
  );
  return { count: names.length, names, teamAdmin };
}

/** Row count and a digest of every row's text, per public table. */
function tableDigests(p) {
  const tables = psql(
    p,
    "select table_name from information_schema.tables where table_schema = 'public' and table_type = 'BASE TABLE' order by table_name",
  )
    .split("\n")
    .filter(Boolean);
  const sql = tables
    .map(
      (t) =>
        `select '${t}', count(*), coalesce(encode(sha256(convert_to(string_agg(x::text, E'\\n' order by x::text), 'UTF8')), 'hex'), '') from "${t}" x`,
    )
    .join(" union all ");
  const rows = psql(p, sql)
    .split("\n")
    .map((l) => l.split("|"));
  return {
    counts: Object.fromEntries(rows.map(([t, c]) => [t, Number(c)])),
    digests: Object.fromEntries(rows.map(([t, , d]) => [t, d.slice(0, 16)])),
  };
}
function fileHashes(p) {
  const r = must(
    "docker compose run -T --rm --no-deps app sh -c 'cd /var/lib/openlaw/files && find . -type f -exec sha256sum {} +'",
    p.dir,
    { timeout: 600_000 },
  );
  const map = {};
  for (const line of r.stdout.trim().split("\n").filter(Boolean)) {
    const [hash, ...rest] = line.split(/\s+/);
    map[rest.join(" ")] = hash;
  }
  return map;
}
const SEALED = [
  ["api_key_requests", "sealed_key"],
  ["ai_saved_keys", "api_key"],
  ["signing_connectors", "private_key"],
  ["signing_connectors", "webhook_secret"],
  ["org_settings", "smtp_url"],
  ["org_settings", "vapid_private_key"],
  ["org_settings", "advanced_settings"],
  ["sso_providers", "oidc_config"],
];
function sealedDigests(p) {
  const out = {};
  for (const [t, c] of SEALED) {
    const row = psql(
      p,
      `select count(${c}), coalesce(encode(sha256(convert_to(string_agg(${c}::text, '|' order by id), 'UTF8')), 'hex'), '') from ${t}`,
    );
    const [n, digest] = row.split("|");
    out[`${t}.${c}`] = { nonNull: Number(n), sha256: digest.slice(0, 16) };
  }
  return out;
}
function journal(p) {
  const [rows, last] = psql(
    p,
    "select count(*), max(created_at) from drizzle.__drizzle_migrations",
  ).split("|");
  const meta = JSON.parse(
    readFileSync(path.join(p.dir, "packages/db/migrations/meta/_journal.json"), "utf8"),
  );
  const tag = meta.entries.find((e) => String(e.when) === String(last))?.tag ?? `(when ${last})`;
  return { rows: Number(rows), last: tag };
}
function contractVocabulary(p) {
  return {
    statuses: psql(
      p,
      "select display_name || ' [' || stage || ']' from contract_statuses where archived_at is null order by display_order",
    ).split("\n"),
    documentTypes: psql(
      p,
      "select display_name from document_types where module = 'contract' and archived_at is null order by display_order",
    ).split("\n"),
  };
}

async function inventory(p, label) {
  const { counts, digests } = tableDigests(p);
  const files = fileHashes(p);
  const sealed = sealedDigests(p);
  const inv = {
    at: new Date().toISOString(),
    journal: journal(p),
    counts,
    digests,
    files: {
      count: Object.keys(files).length,
      digest: sha256(
        Object.entries(files)
          .sort()
          .map(([k, v]) => `${k} ${v}`)
          .join("\n"),
      ),
    },
    sealed,
    vocabulary: contractVocabulary(p),
    envelopes: psql(
      p,
      "select status, count(*) from contract_envelopes group by status order by status",
    ).split("\n"),
    sso: psql(p, "select provider_id from sso_providers").split("\n"),
    ceiling: psql(p, "select mcp_toolset_ceiling::text from org_settings"),
  };
  state.inventories ??= {};
  state.inventories[label] = { ...inv, fileMap: files };
  saveState();
  return inv;
}

async function magicSignIn(p, email) {
  const s = await newSession(p.base);
  const t0 = Date.now();
  await s.page.goto(`${p.base}/auth/login`);
  await s.page.getByLabel("Email").first().waitFor({ timeout: 30_000 });
  await s.page.waitForLoadState("networkidle").catch(() => {});
  // Sign in: "Email me a sign-in link" opens "Get a sign-in link" with Email and Send link.
  await s.page.getByRole("button", { name: "Email me a sign-in link" }).click();
  await s.page.getByText("Get a sign-in link").first().waitFor({ timeout: 15_000 });
  await s.page.getByLabel("Email").first().fill(email);
  await s.page.getByRole("button", { name: "Send link" }).click();
  const mail = await waitMail(p, (m) => toAddress(m, email) && since(m, t0), 60_000);
  check(mail, `no sign-in link for ${email}`);
  const link = (await mailText(p, mail.ID)).match(/https?:\/\/[^\s)>\]]+/)?.[0];
  check(link && new URL(link).origin === p.base, `link origin ${link && new URL(link).origin}`);
  await s.page.goto(link);
  await s.page
    .waitForURL((u) => !u.pathname.startsWith("/auth"), { timeout: 30_000 })
    .catch(() => {});
  await s.page.waitForLoadState("networkidle").catch(() => {});
  const me = await s.request("GET", "/api/v1/me");
  s.role = me.body?.user?.role ?? null;
  s.userId = me.body?.user?.id ?? null;
  s.landed = new URL(s.page.url()).pathname;
  s.linkOrigin = new URL(link).origin;
  return s;
}

function pickFixtures(p) {
  const people = psql(
    p,
    "select role || '|' || email from users where archived_at is null and role in ('legal_team_member','business_user') order by role, created_at",
  )
    .split("\n")
    .map((l) => l.split("|"));
  const ltm = people.find(([r]) => r === "legal_team_member")?.[1];
  const bu = people.find(([r]) => r === "business_user")?.[1];
  const outside = (email) =>
    psql(
      p,
      `select c.number || '|' || c.title from contracts c, users u where u.email = '${email}' and c.is_confidential and c.manager_id is distinct from u.id and c.business_owner_id is distinct from u.id and not exists (select 1 from contract_team t where t.contract_id = c.id and t.user_id = u.id) order by c.number limit 1`,
    ).split("|");
  const versions = psql(
    p,
    "select v.document_id || '|' || v.id || '|' || v.version_number || '|' || v.kind || '|' || coalesce(v.source, '') from document_versions v join documents d on d.id = v.document_id where d.id in (select document_id from document_versions group by document_id having count(*) >= 2 order by document_id limit 3) order by v.document_id, v.version_number",
  )
    .split("\n")
    .map((l) => l.split("|"));
  const executed = psql(
    p,
    "select v.document_id || '|' || v.id || '|' || v.version_number || '|' || v.kind || '|' || coalesce(v.source, '') from document_versions v where v.kind = 'executed' order by v.created_at limit 2",
  )
    .split("\n")
    .filter(Boolean)
    .map((l) => l.split("|"));
  const reps = [...versions, ...executed].map(([doc, id, n, kind, source]) => ({
    doc,
    id,
    n: Number(n),
    kind,
    source,
  }));
  const contracts = psql(
    p,
    "select number || '|' || title from contracts where not is_confidential order by number limit 3",
  )
    .split("\n")
    .map((l) => l.split("|"));
  const matter = psql(
    p,
    "select number || '|' || title from matters order by number limit 1",
  ).split("|");
  const entity = psql(
    p,
    "select id || '|' || legal_name from entities order by created_at limit 1",
  ).split("|");
  return {
    ltm,
    bu,
    confLtm: ltm && outside(ltm),
    confBu: bu && outside(bu),
    reps,
    contracts,
    matter,
    entity,
  };
}

async function downloadHashes(send, reps) {
  const out = [];
  for (const v of reps) {
    const r = await send("GET", `/api/v1/documents/${v.doc}/versions/${v.id}/download`);
    out.push({ ...v, status: r.status, sha256: r.status === 200 ? sha256(r.buffer) : null });
  }
  return out;
}

async function advancedUploads(page, base) {
  await page.goto(`${base}/settings/uploads`);
  await page.getByLabel("Maximum file size (MiB)").waitFor({ timeout: 20_000 });
  await page.waitForLoadState("networkidle").catch(() => {});
  const value = await page.getByLabel("Maximum file size (MiB)").inputValue();
  const text = await bodyText(page);
  const source =
    ["Saved in OpenLaw", "Deployment configuration", "Default"].find((s) => text.includes(s)) ??
    null;
  return { value, source };
}
async function systemStatus(page, base) {
  let last;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    await page.goto(`${base}/settings/system-status`);
    await page.getByRole("heading", { name: "System status" }).first().waitFor({ timeout: 20_000 });
    await page.getByRole("button", { name: "Refresh" }).click();
    await page.waitForTimeout(1500);
    const rows = (await page.locator("table tbody tr").allInnerTexts()).map((r) =>
      r.replace(/\s+/g, " ").trim(),
    );
    const text = await bodyText(page);
    last = {
      rows,
      activeStorage: text.match(/Active storage: \S+/)?.[0] ?? null,
      missingWarning: text.includes("An API or worker heartbeat is missing"),
    };
    const procs = rows.filter((r) => /^(API|Worker) /.test(r));
    if (procs.length >= 2 && procs.every((r) => r.includes("Running") && r.includes("Current")))
      return { ...last, ok: true, attempts: attempt + 1 };
    await sleep(65_000);
  }
  return { ...last, ok: false };
}

phases["up-before"] = async () => {
  const p = U;
  const { ADMIN } = await seedData();
  await step(
    {
      ...UPGRADE,
      action:
        "Baseline inventory on the starting build: migration journal, record counts, file hashes, sealed settings, Contract vocabulary",
      command: "psql reads; find /var/lib/openlaw/files -type f -exec sha256sum",
      critical: true,
    },
    async () => {
      // Let the seed's queued processing finish first, so the baseline is the state the pause will copy.
      let pending = "";
      for (let i = 0; i < 120; i += 1) {
        pending = psql(
          p,
          "select count(*) from pgboss.job where state in ('created','retry','active') and start_after <= now()",
        );
        if (pending === "0") break;
        await sleep(5000);
      }
      check(pending === "0", `${pending} jobs still due`);
      await sleep(10_000);
      const inv = await inventory(p, "before");
      const fx = pickFixtures(p);
      state.fx = fx;
      saveState();
      const nonEmpty = Object.entries(inv.counts).filter(([, c]) => c > 0);
      return {
        journal: inv.journal,
        tables: `${Object.keys(inv.counts).length} tables, ${nonEmpty.length} non-empty`,
        keyCounts: Object.fromEntries(
          [
            "users",
            "contracts",
            "matters",
            "entities",
            "documents",
            "document_versions",
            "contract_envelopes",
            "requests",
            "tasks",
            "comments",
            "knowledge_items",
            "fields",
            "activity_log",
            "sso_providers",
            "api_key_requests",
            "ai_saved_keys",
            "signing_connectors",
          ]
            .filter((t) => t in inv.counts)
            .map((t) => [t, inv.counts[t]]),
        ),
        files: inv.files,
        sealed: inv.sealed,
        vocabulary: inv.vocabulary,
        envelopes: inv.envelopes,
        ceiling: inv.ceiling,
        fixtures: {
          ltm: fx.ltm,
          businessUser: fx.bu,
          confidentialOutsideLtm: fx.confLtm?.[0],
          confidentialOutsideBu: fx.confBu?.[0],
          representativeVersions: fx.reps.length,
        },
      };
    },
  );
  await step(
    {
      ...UPGRADE,
      method: "automated-test",
      action: "Baseline: representative Version hashes, lower-access reach, MCP tools",
      critical: true,
    },
    async () => {
      const api = new Api(p.direct, p.base);
      await api.signIn(ADMIN.email, labPassword());
      const hashes = await downloadHashes((m, r) => api.raw(m, r), state.fx.reps);
      check(
        hashes.every((h) => h.status === 200),
        JSON.stringify(hashes.map((h) => h.status)),
      );
      state.repHashes = hashes;
      const ltm = new Api(p.direct, p.base);
      await ltm.signIn(state.fx.ltm, labPassword());
      const conf = state.fx.confLtm[0];
      const reach = (await ltm.raw("GET", `/api/v1/contracts/${conf}`)).status;
      check(reach !== 200, `LTM reached Confidential C-${conf}`);
      state.ltmReachBefore = reach;
      const tools = await mcpTools(p, secrets.mcpKey);
      state.mcpBefore = tools;
      saveState();
      return {
        versions: hashes.map(
          (h) => `doc ${h.doc.slice(0, 8)} v${h.n} ${h.kind}/${h.source} ${h.sha256.slice(0, 16)}`,
        ),
        legalTeamMemberOnConfidential: `C-${conf} answered ${reach}`,
        mcpTools: `${tools.count} tools; Team/Administration-like names ${tools.teamAdmin.length}`,
      };
    },
  );
  const s = await browserSignIn(p.base, ADMIN.email, labPassword());
  try {
    await step(
      {
        ...UPGRADE,
        role: "administrator",
        method: "browser-walkthrough",
        page: "/settings/uploads",
        action:
          "Before you start: record every Settings → Advanced field that shows Saved in OpenLaw; System status on the starting build",
      },
      async () => {
        const up = await advancedUploads(s.page, p.base);
        const st = await systemStatus(s.page, p.base);
        state.advancedBefore = up;
        check(up.value === "40" && up.source === "Saved in OpenLaw", JSON.stringify(up));
        return { fileUploads: up, systemStatus: st };
      },
    );
  } finally {
    await s.context.close();
  }
};

// Backup article, Take a coherent backup, steps 1 to 4 (upgrade step 4 keeps app and worker stopped).
async function runBackup(p, backupDir, pre) {
  const env = { BACKUP_DIR: backupDir };
  const meta = { ...UPGRADE, article: "upgrade (step 4 follows backup-and-restore)" };
  await step(
    {
      ...meta,
      action: "Upgrade step 4 / backup step 1: create a fresh private backup directory",
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
      action: "Upgrade step 4 / backup step 2: stop app and worker, keep Postgres running",
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
      return s;
    },
  );
  await step(
    {
      ...meta,
      action:
        "Upgrade step 4 / backup step 3: dump the database, archive the file volume, record source and images",
      command:
        'pg_dump --format=custom > "$BACKUP_DIR/database.dump"; docker compose run -T --rm --no-deps app tar -czf - -C /var/lib/openlaw/files . > "$BACKUP_DIR/files.tar.gz"; git rev-parse HEAD > app-source.txt; docker compose images --format json > images.json',
      critical: true,
    },
    () => {
      const codes = [];
      for (const command of [
        'docker compose exec -T postgres pg_dump -U openlaw -d openlaw --format=custom > "$BACKUP_DIR/database.dump"',
        'docker compose run -T --rm --no-deps app tar -czf - -C /var/lib/openlaw/files . > "$BACKUP_DIR/files.tar.gz"',
        'git rev-parse HEAD > "$BACKUP_DIR/app-source.txt"',
        'docker compose images --format json > "$BACKUP_DIR/images.json"',
      ]) {
        const r = sh(`umask 077\n${command}`, p.dir, { env, timeout: 900_000 });
        codes.push(r.code);
        check(r.code === 0, `${command}: ${r.stderr.slice(-400)}`);
      }
      const source = readFileSync(path.join(backupDir, "app-source.txt"), "utf8").trim();
      const images = JSON.parse(readFileSync(path.join(backupDir, "images.json"), "utf8"));
      const app = images.find((i) => i.ContainerName?.includes("-app-"));
      writeFileSync(path.join(backupDir, "pre-upgrade-revision.txt"), `${pre}\n`, { mode: 0o600 });
      return `exit codes ${codes.join(", ")}; app-source.txt ${source} (the checkout already points at the target); images.json app ${app?.Repository}:${app?.Tag}; pre-upgrade revision ${pre} recorded beside it; dump ${readFileSync(path.join(backupDir, "database.dump")).length} bytes; files ${readFileSync(path.join(backupDir, "files.tar.gz")).length} bytes`;
    },
  );
  await step(
    {
      ...meta,
      action:
        "Upgrade step 4 / backup step 4: list both archives and record hashes; copy to a retained location and verify there",
      command: "pg_restore --list; tar -tzf; sha256sum > SHA256SUMS; sha256sum --check",
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
      const retained = `${backupDir}-retained`;
      must(`umask 077; mkdir -p "${retained}"; cp -p "$BACKUP_DIR"/* "${retained}/"`, p.dir, {
        env,
      });
      const c = must(`cd "${retained}" && sha256sum --check SHA256SUMS`, p.dir);
      return `pg_restore --list ${entries} TOC entries; tar lists ${files} files; SHA256SUMS ${readFileSync(
        path.join(backupDir, "SHA256SUMS"),
        "utf8",
      )
        .trim()
        .replace(/\s+/g, " ")
        .replace(
          / database/,
          " database",
        )}; retained copy: ${c.stdout.trim().replace(/\n/g, "; ")}`;
    },
  );
}

phases.upgrade = async () => {
  const p = U;
  const { ADMIN } = await seedData();
  const old = await browserSignIn(p.base, ADMIN.email, labPassword());
  await old.page.goto(`${p.base}/contracts`);
  await old.page.waitForLoadState("networkidle").catch(() => {});
  state.oldTabOpenedAt = new Date().toISOString();
  await step(
    {
      ...UPGRADE,
      action:
        "Before you start: record source revision, image identities, project name, file list, storage configuration and keys",
      critical: true,
    },
    async () => {
      const rev = must("git rev-parse HEAD", p.dir).stdout.trim();
      const config = JSON.parse(must("docker compose config --format json", p.dir).stdout);
      const env = config.services.app.environment;
      state.upgradeBefore = { containers: psAll(p), rev };
      saveState();
      return {
        sourceRevision: rev,
        images: recordImages("upgrade-before", p).containers,
        project: config.name,
        composeFile: envGet(p, "COMPOSE_FILE"),
        storage: {
          STORAGE_DRIVER: env.STORAGE_DRIVER || "(unset: local)",
          volume: `${p.project}_openlaw-files`,
        },
        advancedSavedInOpenLaw: state.advancedBefore,
        keysInSecretStore: Boolean(secrets.up?.AUTH_SECRET && secrets.up?.OPENLAW_SECRET_KEY),
      };
    },
  );
  await step(
    {
      ...UPGRADE,
      action: "Prepare step 1: fetch the source and inspect local changes",
      command: "git status --short; git fetch origin; git rev-parse HEAD",
      critical: true,
    },
    () => {
      const status = must("git status --short", p.dir).stdout.trim();
      const f = must("git fetch origin", p.dir, { timeout: 300_000 });
      const head = must("git rev-parse HEAD", p.dir).stdout.trim();
      return `git status --short: ${JSON.stringify(status)}; git fetch origin exit ${f.code}; HEAD ${head}`;
    },
  );
  if (sh(`git cat-file -e ${COMMIT}^{commit}`, p.dir).code !== 0) {
    await step(
      {
        ...UPGRADE,
        action: "Prepare step 2: git checkout --detach the target after git fetch origin",
        command: `git checkout --detach ${COMMIT}`,
      },
      () => {
        const co = sh(`git checkout --detach ${COMMIT}`, p.dir);
        check(
          co.code === 0,
          `git checkout --detach exit ${co.code}: ${co.stderr.trim().slice(-160)} (the pin is on no GitHub branch; see publicationBlockers)`,
        );
        return "checkout exit 0";
      },
    );
    await step(
      {
        ...UPGRADE,
        action:
          "Walkthrough deviation: fetch the unpublished pin from the local repository into the GitHub clone",
        command: `git fetch <local repository> ${COMMIT}`,
        critical: true,
      },
      () =>
        `git fetch exit ${must(`git fetch ${root} ${COMMIT}`, p.dir, { timeout: 300_000 }).code}`,
    );
  }
  await step(
    {
      ...UPGRADE,
      action:
        "Prepare step 2: select the target, update OPENLAW_BUILD_COMMIT, validate and build without recreating the running containers",
      command: `git checkout --detach ${COMMIT}; docker compose config --quiet; docker compose build app doc-engine`,
      critical: true,
    },
    () => {
      const co = sh(`git checkout --detach ${COMMIT}`, p.dir);
      check(co.code === 0, `checkout exit ${co.code}: ${co.stderr.slice(-300)}`);
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
        engine: `${services["doc-engine"].image} ${inspectImage(services["doc-engine"].image)}`,
        postgres: services.postgres.image,
      };
      return `checkout exit 0; build ${Math.round(b.ms / 1000)} s; ${after.length} containers kept their IDs and states; app and worker both resolve to ${services.app.image} (${inspectImage(services.app.image)}); engine ${inspectImage(services["doc-engine"].image)}; postgres stays ${services.postgres.image}`;
    },
  );
  await step(
    {
      ...UPGRADE,
      action:
        "Prepare step 3: review TRUSTED_PROXIES before the target starts; the Compose file is unchanged",
      command: `git diff --stat ${BASELINE} ${COMMIT} -- compose.yml; docker network inspect ${p.project}_openlaw-backend --format '{{range .IPAM.Config}}{{.Gateway}} {{.Subnet}}{{end}}'; TRUSTED_PROXIES=<gateway>`,
    },
    () => {
      const diff = must(
        `git diff --stat ${BASELINE} ${COMMIT} -- compose.yml`,
        p.dir,
      ).stdout.trim();
      const before = envGet(p, "TRUSTED_PROXIES");
      const gw = gatewayOf(p);
      envSet(p, "TRUSTED_PROXIES", gw.split(" ")[0]);
      state.upGateway = gw.split(" ")[0];
      const cfg = JSON.parse(must("docker compose config --format json", p.dir).stdout).services;
      const ports = cfg.app.ports.map((x) => `${x.host_ip}:${x.published}->${x.target}`);
      check(diff === "", `compose.yml changed: ${diff}`);
      return {
        composeYmlDiff: diff || "(empty)",
        trustedProxiesBefore: before,
        gatewayRead: gw,
        trustedProxiesAfter: cfg.app.environment.TRUSTED_PROXIES,
        appPorts: ports,
        composePrivateOverlay: existsSync(`${p.dir}/compose.private.yml`),
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
      const env = psql(
        p,
        "select status, count(*) from contract_envelopes group by status order by status",
      ).replace(/\n/g, "; ");
      const fetches = sh(
        `docker compose exec -T postgres psql -U openlaw -d openlaw -At -c "select coalesce(executed_fetch->>'state', '(none)'), count(*) from contract_envelopes group by 1"`,
        p.dir,
      )
        .stdout.trim()
        .replace(/\n/g, "; ");
      return `pg-boss: ${jobs || "(none)"}; contract_envelopes: ${env}; executed-copy fetch states: ${fetches || "n/a"}`;
    },
  );
  const backupDir = path.join(WORK, "backups", "pre-upgrade");
  await runBackup(p, backupDir, BASELINE);
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
        "The app runs the 12 migrations 0172 to 0183 at startup; readiness; the worker stays running; port 127.0.0.1:<PORT>.",
      critical: true,
    },
    async () => {
      const t0 = Date.now();
      must("docker compose up -d --no-build --pull never", p.dir, { timeout: 600_000 });
      const ps0 = must("docker compose ps --format '{{.Service}} {{.State}} {{.Status}}'", p.dir)
        .stdout.trim()
        .split("\n");
      const port = must("docker compose port app 3000", p.dir).stdout.trim();
      await waitReady(p, 900_000);
      const readyS = Math.round((Date.now() - t0) / 1000);
      await sleep(45_000);
      const tail = must("docker compose logs --tail=100 app worker", p.dir).stdout;
      const appLogs = must("docker compose logs --no-log-prefix app", p.dir).stdout;
      const workerLogs = must("docker compose logs --no-log-prefix worker", p.dir).stdout;
      const workerId = sh("docker compose ps -aq worker", p.dir).stdout.trim();
      const wstate = must(
        `docker inspect --format '{{.RestartCount}} {{.State.Status}}' ${workerId}`,
        p.dir,
      ).stdout.trim();
      const appId = sh("docker compose ps -aq app", p.dir).stdout.trim();
      const astate = must(
        `docker inspect --format '{{.RestartCount}} {{.State.Status}}' ${appId}`,
        p.dir,
      ).stdout.trim();
      const j = journal(p);
      const before = state.inventories.before.journal;
      const migrationLines = lines(appLogs, /migrat/i, 6);
      const errorLines = [
        ...lines(appLogs, /"level":(50|60)|error/i, 5),
        ...lines(workerLogs, /"level":(50|60)|error/i, 5),
      ].map((l) => l.slice(0, 240));
      const warnLines = lines(appLogs, /TRUSTED_PROXIES|No configured key|resealed/i, 3);
      check(
        j.rows === before.rows + 12 && j.last === "0183_sso-provider-name",
        `journal ${JSON.stringify(j)} before ${JSON.stringify(before)}`,
      );
      check(port === `127.0.0.1:${p.port}`, `port ${port}`);
      check(wstate.endsWith("running"), `worker ${wstate}`);
      const images = recordImages("upgrade-after", p);
      return {
        psRightAfterUp: ps0,
        port,
        readyAfterSeconds: readyS,
        journal: `${before.rows} rows ending ${before.last} before; ${j.rows} rows ending ${j.last} after`,
        appMigrationLines: migrationLines,
        startWarnings: warnLines,
        appRestartsAndState: astate,
        workerRestartsAndState: wstate,
        errorLikeLines: errorLines,
        tail100Lines: tail.split("\n").length,
        images: images.containers,
      };
    },
  );
  state.oldTab = true;
  saveState();
  await step(
    {
      ...UPGRADE,
      role: "administrator",
      method: "browser-walkthrough",
      page: "/contracts",
      action: "Start step 5: a browser tab opened before the upgrade, used after it",
      expected: "An old tab can show This part of OpenLaw was updated. Reload to continue.",
    },
    async () => {
      const seen = [];
      for (const name of [
        "Matters",
        "Entities",
        "Knowledge",
        "Documents",
        "Settings",
        "Contracts",
      ]) {
        await old.page
          .getByRole("link", { name, exact: true })
          .first()
          .click({ timeout: 5000 })
          .catch(() => {});
        await old.page.waitForTimeout(2500);
        const text = await bodyText(old.page);
        const notice = text.includes("This part of OpenLaw was updated. Reload to continue.");
        seen.push(`${name}: ${notice ? "notice shown" : new URL(old.page.url()).pathname}`);
        if (notice) break;
      }
      await old.page.reload();
      await old.page.waitForLoadState("networkidle").catch(() => {});
      const afterReload = new URL(old.page.url()).pathname;
      await old.context.close();
      return { navigationsInOldTab: seen, afterReload };
    },
  );
};

function compareInventories(a, b) {
  const tables = [...new Set([...Object.keys(a.counts), ...Object.keys(b.counts)])].sort();
  const countDiff = tables
    .filter((t) => a.counts[t] !== b.counts[t])
    .map((t) => `${t} ${a.counts[t] ?? "absent"} -> ${b.counts[t] ?? "absent"}`);
  const digestDiff = tables
    .filter((t) => a.digests[t] !== b.digests[t] && a.counts[t] === b.counts[t])
    .map((t) => t);
  const same = tables.filter((t) => a.digests[t] === b.digests[t]).length;
  const filesA = a.fileMap;
  const filesB = b.fileMap;
  const fileMismatch = Object.keys(filesA).filter((k) => filesA[k] !== filesB[k]);
  const sealedDiff = Object.keys(a.sealed).filter(
    (k) => JSON.stringify(a.sealed[k]) !== JSON.stringify(b.sealed[k]),
  );
  return {
    tables: tables.length,
    identicalRowDigests: same,
    countChanges: countDiff,
    sameCountDifferentRows: digestDiff,
    filesBefore: Object.keys(filesA).length,
    filesAfter: Object.keys(filesB).length,
    fileHashMismatches: fileMismatch.length,
    sealedChanged: sealedDiff,
  };
}

phases["up-verify"] = async (only) => {
  const p = U;
  const want = (k) => !only || only.split(",").includes(k);
  const { ADMIN } = await seedData();
  const fx = state.fx;
  if (want("inventory"))
    await step(
      {
        ...UPGRADE,
        action:
          "After the upgrade, before any new work: migration outcome, record counts, row digests, file hashes and sealed settings against the baseline",
        command: "psql reads; find /var/lib/openlaw/files -type f -exec sha256sum",
        critical: true,
      },
      async () => {
        const after = await inventory(p, "after");
        const before = state.inventories.before;
        const cmp = compareInventories(before, state.inventories.after);
        state.compare = cmp;
        saveState();
        check(
          cmp.fileHashMismatches === 0 && cmp.filesAfter === cmp.filesBefore,
          `files ${JSON.stringify(cmp)}`,
        );
        return {
          journalBefore: before.journal,
          journalAfter: after.journal,
          ...cmp,
          vocabularyAfter: after.vocabulary,
          envelopesAfter: after.envelopes,
          ceilingBefore: before.ceiling,
          ceilingAfter: after.ceiling,
          ssoAfter: after.sso,
          sealedAfter: after.sealed,
        };
      },
    );
  if (want("admin")) {
    const signInFrom = new Date(Date.now() - 2000).toISOString();
    const s = await browserSignIn(p.base, ADMIN.email, labPassword());
    try {
      await step(
        {
          ...UPGRADE,
          role: "administrator",
          method: "browser-walkthrough",
          page: "/auth/login",
          action:
            "Verify step 2: sign in through the normal origin; the app records the browser's address rather than the proxy's",
          command:
            'docker compose logs --since=5m app | grep -o \'"remoteAddress":"[^"]*"\' | sort | uniq -c',
          critical: true,
        },
        async () => {
          check(s.role === "administrator", `role ${s.role} ${s.notes.join("; ")}`);
          const rows = recordedAddresses(p);
          const others = rows.filter((r) => !r.includes('"127.0.0.1"'));
          const gwOther = gatewayNonProbe(p, state.upGateway, signInFrom);
          const browserRows = recordedAddresses(p, signInFrom);
          check(
            others.some((r) => r.includes(`"${PROXY_IP}"`)) && gwOther === 0,
            JSON.stringify({ rows, gwOther }),
          );
          return `Administrator signed in at ${p.base} and landed on ${s.landed}; the guide's command listed ${rows.join("; ")}; the browser's requests show ${PROXY_IP}; gateway (${state.upGateway}) lines are only the walkthrough's direct /readyz probes (non-probe gateway requests: ${gwOther}); since the browser sign-in only: ${browserRows.join("; ")}. Earlier gateway lines in the 5-minute window are the walkthrough's own direct API probes on 127.0.0.1:${p.port}`;
        },
      );
      await step(
        {
          ...UPGRADE,
          role: "administrator",
          method: "browser-walkthrough",
          page: "/contracts/:number",
          action:
            "Verify step 3: known Contracts, a Matter and an Entity open with their saved values",
        },
        async () => {
          const out = [];
          for (const [number, title] of fx.contracts) {
            await s.page.goto(`${p.base}/contracts/${number}`);
            await s.page
              .getByRole("heading", { name: title })
              .first()
              .waitFor({ state: "attached", timeout: 20_000 });
            await s.page.goto(`${p.base}/contracts/${number}/fields`);
            await s.page.waitForLoadState("networkidle").catch(() => {});
            const r = await s.request("GET", `/api/v1/contracts/${number}`);
            const values = Object.values(r.body?.contract?.customFields ?? {}).filter(
              (v) => v !== null && v !== "",
            );
            const shown = await s.page.evaluate(
              () =>
                `${document.body.innerText} ${[...document.querySelectorAll("input, textarea, select")].map((e) => e.value).join(" ")}`,
            );
            const visible = values.filter((v) => typeof v === "string" && shown.includes(v)).length;
            out.push(
              `C-${number} heading shown; ${values.length} Field values saved, ${visible} string values visible on its Fields tab`,
            );
          }
          const [mn, mt] = fx.matter;
          await s.page.goto(`${p.base}/matters/${mn}`);
          await s.page
            .getByRole("heading", { name: mt })
            .first()
            .waitFor({ state: "attached", timeout: 20_000 });
          out.push(`M-${mn} heading shown`);
          const [eid, en] = fx.entity;
          await s.page.goto(`${p.base}/entities/${eid}`);
          await s.page.getByText(en).first().waitFor({ timeout: 20_000 });
          out.push(`Entity "${en}" shown`);
          const cmp = state.compare;
          out.push(
            `row digests identical for contracts ${!cmp.sameCountDifferentRows.includes("contracts") && !cmp.countChanges.some((c) => c.startsWith("contracts "))}, matters ${!cmp.sameCountDifferentRows.includes("matters")}, entities ${!cmp.sameCountDifferentRows.includes("entities")}, fields ${!cmp.sameCountDifferentRows.includes("fields")}`,
          );
          return out;
        },
      );
      await step(
        {
          ...UPGRADE,
          role: "administrator",
          method: "browser-walkthrough",
          page: "/settings/contracts/statuses",
          action:
            "Verify step 3: Contract Statuses and Document types keep their names, with Partially signed added",
        },
        async () => {
          await s.page.goto(`${p.base}/settings/contracts/statuses`);
          await s.page.waitForLoadState("networkidle").catch(() => {});
          const st = await bodyText(s.page);
          await s.page.goto(`${p.base}/settings/documents/contracts`);
          await s.page.waitForLoadState("networkidle").catch(() => {});
          const dt = await bodyText(s.page);
          const b = state.inventories.before.vocabulary;
          const a = state.inventories.after.vocabulary;
          const statusNames = b.statuses.map((x) => x.replace(/ \[.*$/, ""));
          const missingS = statusNames.filter((n) => !st.includes(n));
          const missingT = b.documentTypes.filter((n) => !dt.includes(n));
          const addedS = a.statuses.filter((x) => !b.statuses.includes(x));
          const addedT = a.documentTypes.filter((x) => !b.documentTypes.includes(x));
          const lastSignature = a.statuses.filter((x) => x.endsWith("[signature]")).pop();
          const beforeExecuted = a.documentTypes[a.documentTypes.indexOf("Executed") - 1];
          const orderKept =
            JSON.stringify(a.statuses.filter((x) => b.statuses.includes(x))) ===
              JSON.stringify(b.statuses) &&
            JSON.stringify(a.documentTypes.filter((x) => b.documentTypes.includes(x))) ===
              JSON.stringify(b.documentTypes);
          check(
            missingS.length === 0 &&
              missingT.length === 0 &&
              st.includes("Partially signed") &&
              dt.includes("Partially signed"),
            JSON.stringify({ missingS, missingT }),
          );
          check(
            lastSignature === "Partially signed [signature]" &&
              beforeExecuted === "Partially signed" &&
              orderKept,
            JSON.stringify({ lastSignature, beforeExecuted, orderKept }),
          );
          return `Settings → Contracts → Statuses shows all ${statusNames.length} earlier names plus Partially signed (added: ${addedS.join(", ")}; last in the Signature Stage); Settings → Documents → Contracts shows all ${b.documentTypes.length} earlier types plus ${addedT.join(", ")} (just before Executed); the earlier order is kept`;
        },
      );
      await step(
        {
          ...UPGRADE,
          role: "administrator",
          method: "browser-walkthrough",
          action:
            "Verify step 3: download representative original and later Document Versions and compare hashes with the pre-upgrade inventory",
          critical: true,
        },
        async () => {
          const after = await downloadHashes(s.request, state.repHashes);
          const bad = after.filter((v, i) => v.sha256 !== state.repHashes[i].sha256);
          check(bad.length === 0, JSON.stringify(bad));
          return after.map(
            (v) =>
              `doc ${v.doc.slice(0, 8)} v${v.n} ${v.kind}/${v.source} ${v.sha256.slice(0, 16)} match`,
          );
        },
      );
      await step(
        {
          ...UPGRADE,
          role: "administrator",
          method: "browser-walkthrough",
          page: "/contracts/:number/documents",
          action: "Verify step 4: a new upload in the browser is processed by the worker",
        },
        async () => {
          const body = pdf([
            "DOC-032 operator new upload after the upgrade.",
            "Worker processing check.",
          ]);
          const number = Number(fx.contracts[1][0]);
          const up = await uploadInBrowser(
            s.page,
            p.base,
            number,
            `doc032-op-upgrade-${Date.now()}.pdf`,
            body,
          );
          const text = await waitText(s.request, up.documentId, up.versionId, 300_000);
          check(
            text.state === "ready" && /Worker processing check/.test(text.text),
            `text ${text.state}`,
          );
          state.postUpgradeUpload = { id: up.documentId, contract: number };
          saveState();
          return `${up.how}; processing ready with the uploaded words`;
        },
      );
      await step(
        {
          ...UPGRADE,
          role: "administrator",
          method: "browser-walkthrough",
          page: "/settings/email",
          action: "Verify step 4: an actual use of the saved encrypted relay: Send test email",
        },
        async () => {
          const t0 = Date.now();
          await s.page.goto(`${p.base}/settings/email`);
          await s.page.waitForLoadState("networkidle").catch(() => {});
          await s.page.getByRole("button", { name: "Send test email" }).click({ timeout: 20_000 });
          const mail = await waitMail(
            p,
            (m) => toAddress(m, ADMIN.email) && m.Subject === "OpenLaw test email" && since(m, t0),
          );
          const notice = (await bodyText(s.page)).match(
            /Test email sent to \S+ Check your inbox\.|The test email could not be sent[^.]*\./,
          )?.[0];
          check(mail, `no message; page says ${notice}`);
          return `Settings → Advanced → Outbound email → Send test email: "${notice ?? "(no inline notice captured)"}"; "OpenLaw test email" reached the controlled recipient through the relay saved on the starting build`;
        },
      );
      await step(
        {
          ...UPGRADE,
          role: "administrator",
          method: "browser-walkthrough",
          page: "/settings/ai-analysis",
          action:
            "Verify step 4: Test connection on the configured AI connector (stand-in accepts only the saved key)",
        },
        async () => {
          await s.page.goto(`${p.base}/settings/ai-analysis`);
          await s.page.waitForLoadState("networkidle").catch(() => {});
          const provider = s.page.getByRole("button", { name: "Provider", exact: true }).first();
          if (await provider.isVisible().catch(() => false)) await provider.click();
          await s.page
            .getByRole("button", { name: "Test connection" })
            .first()
            .click({ timeout: 20_000 });
          await s.page
            .getByText(/Connection successful\.|The connection test failed/)
            .first()
            .waitFor({ timeout: 30_000 });
          const text = (await bodyText(s.page)).match(
            /Connection successful\.|The connection test failed[^.]*\.[^.]*\./,
          )?.[0];
          check(text === "Connection successful.", text);
          return `Settings → AI analysis → Test connection: "${text}"`;
        },
      );
      await step(
        {
          ...UPGRADE,
          role: "administrator",
          method: "browser-walkthrough",
          page: "/settings/system-status",
          action:
            "Verify step 4: Settings → Advanced → System status → Refresh: API and Worker Running and Current; the Saved in OpenLaw field keeps its value",
        },
        async () => {
          const st = await systemStatus(s.page, p.base);
          const up = await advancedUploads(s.page, p.base);
          check(st.ok, JSON.stringify(st));
          check(
            up.value === state.advancedBefore.value && up.source === "Saved in OpenLaw",
            JSON.stringify(up),
          );
          return { systemStatus: st, fileUploads: up, before: state.advancedBefore };
        },
      );
      await step(
        {
          ...UPGRADE,
          role: "administrator",
          method: "browser-walkthrough",
          page: "/settings/mcp",
          action:
            "Listed change: the saved Toolset ceiling loses Team and Administration; the existing API key cannot run their Tools",
        },
        async () => {
          await s.page.goto(`${p.base}/settings/mcp`);
          await s.page.waitForLoadState("networkidle").catch(() => {});
          const text = await bodyText(s.page);
          const settings = await s.request("GET", "/api/v1/mcp-settings");
          const ceiling = settings.body?.toolsetCeiling ?? [];
          const tools = await mcpTools(p, secrets.mcpKey);
          const lost = state.mcpBefore.names.filter((n) => !tools.names.includes(n));
          const keyRow = psql(
            p,
            `select toolsets::text from api_key_requests where id = '${state.mcpKeyId}'`,
          );
          check(
            !ceiling.includes("team") &&
              !ceiling.includes("administration") &&
              tools.teamAdmin.length === 0 &&
              lost.length === 0,
            JSON.stringify({ ceiling, lost, teamAdmin: tools.teamAdmin }),
          );
          return {
            ceilingBefore: state.inventories.before.ceiling,
            ceilingAfter: ceiling,
            keyToolsetsStillRecorded: keyRow,
            settingsPageMentionsTeam: /Team/.test(text),
            settingsPageMentionsAdministration: /Administration/.test(text),
            toolsBefore: state.mcpBefore.count,
            toolsAfter: tools.count,
            teamAdministrationToolsListedForTheKey: tools.teamAdmin,
            earlierToolsNoLongerListed: lost,
          };
        },
      );
      await step(
        {
          ...UPGRADE,
          role: "administrator",
          method: "browser-walkthrough",
          page: "/settings/authentication",
          action:
            "Listed change: the registered SSO provider has an empty display name, so Settings shows its Provider ID",
        },
        async () => {
          await s.page.goto(`${p.base}/settings/authentication`);
          await s.page.waitForLoadState("networkidle").catch(() => {});
          const idp = s.page.getByRole("button", { name: /Identity providers/ }).first();
          if (await idp.isVisible().catch(() => false)) await idp.click().catch(() => {});
          await s.page.waitForTimeout(1000);
          const text = await bodyText(s.page);
          const name = psql(
            p,
            "select coalesce(nullif(name, ''), '(empty)') from sso_providers where provider_id = 'doc032-idp'",
          );
          const remove = await s.page.getByRole("button", { name: "Remove doc032-idp" }).count();
          check(
            name === "(empty)" && text.includes("doc032-idp"),
            JSON.stringify({ name, has: text.includes("doc032-idp") }),
          );
          return `sso_providers.name ${name}; Settings → Authentication lists "doc032-idp" with its domain doc032-sso.example: ${text.includes("doc032-sso.example")}; a "Remove doc032-idp" control: ${remove > 0}`;
        },
      );
    } finally {
      await s.context.close();
    }
  }
  if (want("lower")) {
    await step(
      {
        ...UPGRADE,
        role: "legal_team_member",
        method: "browser-walkthrough",
        page: "/contracts/:number",
        action:
          "Verify step 2: a lower-access account (Legal Team Member) still cannot reach a Confidential record outside its audience",
      },
      async () => {
        const s = await browserSignIn(p.base, fx.ltm, labPassword());
        try {
          const [number, title] = fx.confLtm;
          const api = await s.request("GET", `/api/v1/contracts/${number}`);
          await s.page.goto(`${p.base}/contracts/${number}`);
          await s.page.waitForLoadState("networkidle").catch(() => {});
          const visible = await s.page
            .getByText(title)
            .first()
            .isVisible()
            .catch(() => false);
          const pageText = (await bodyText(s.page)).slice(0, 160);
          const open = Number(fx.contracts[0][0]);
          const control = await s.request("GET", `/api/v1/contracts/${open}`);
          check(
            s.role === "legal_team_member" &&
              api.status !== 200 &&
              !visible &&
              control.status === 200,
            JSON.stringify({ role: s.role, api: api.status, visible, control: control.status }),
          );
          return `signed in as ${s.role}; Confidential C-${number} (not a team member, Owner or Business Owner) answered ${api.status} before the upgrade ${state.ltmReachBefore} and ${api.status} after; its title is not shown; the page reads "${pageText}"; a non-confidential C-${open} still opens (${control.status})`;
        } finally {
          await s.context.close();
        }
      },
    );
    await step(
      {
        ...UPGRADE,
        role: "business_user",
        method: "browser-walkthrough",
        page: "/portal",
        action:
          "Verify step 2: a Business User signs in with a fresh magic link and cannot reach a Confidential record outside its audience",
      },
      async () => {
        const s = await magicSignIn(p, fx.bu);
        try {
          const [number] = fx.confBu;
          const staff = await s.request("GET", `/api/v1/contracts/${number}`);
          const portal = await s.request("GET", `/api/v1/portal/contracts/${number}`);
          check(
            s.role === "business_user" && staff.status !== 200 && portal.status !== 200,
            JSON.stringify({ role: s.role, staff: staff.status, portal: portal.status }),
          );
          return `magic link from Mailpit uses ${s.linkOrigin}; signed in as ${s.role}, landed on ${s.landed}; Confidential C-${number} answered ${staff.status} (staff API) and ${portal.status} (Portal API)`;
        } finally {
          await s.context.close();
        }
      },
    );
  }
  if (want("reselect")) {
    const s = await browserSignIn(p.base, ADMIN.email, labPassword());
    try {
      await step(
        {
          ...UPGRADE,
          role: "administrator",
          method: "browser-walkthrough",
          page: "/settings/mcp",
          action:
            "Listed change, follow-up: once an Administrator selects Team and Administration again, the existing API key lists their Tools",
        },
        async () => {
          const before = await mcpTools(p, secrets.mcpKey);
          const cur = (await s.request("GET", "/api/v1/mcp-settings")).body.toolsetCeiling;
          const r = await s.request("PATCH", "/api/v1/mcp-settings", {
            toolsetCeiling: [...cur, "team", "administration"],
          });
          const after = await mcpTools(p, secrets.mcpKey);
          check(
            r.status === 200 && after.teamAdmin.length > 0 && before.teamAdmin.length === 0,
            JSON.stringify({ status: r.status, before: before.teamAdmin, after: after.teamAdmin }),
          );
          return `with the migrated ceiling the key lists ${before.count} tools and no Team or Administration tool; after the Administrator adds Team and Administration to the ceiling (PATCH /api/v1/mcp-settings from the signed-in browser, ${r.status}) the same key lists ${after.count} tools including ${after.teamAdmin.join(", ")}`;
        },
      );
    } finally {
      await s.context.close();
    }
  }
  if (want("jobs"))
    await step(
      {
        ...UPGRADE,
        action:
          "Verify step 5: inspect outstanding jobs and Envelopes; the worker is still running",
        command: "psql: pg-boss job states; contract_envelopes; docker inspect worker",
      },
      () => {
        const jobs = psql(
          p,
          "select state, count(*) from pgboss.job group by state order by state",
        ).replace(/\n/g, "; ");
        const env = psql(
          p,
          "select status || ' completes_contract=' || completes_contract, count(*) from contract_envelopes group by 1 order by 1",
        ).replace(/\n/g, "; ");
        const failed = psql(
          p,
          "select name, count(*) from pgboss.job where state = 'failed' group by name order by 2 desc limit 5",
        ).replace(/\n/g, "; ");
        const workerId = sh("docker compose ps -aq worker", p.dir).stdout.trim();
        const w = must(
          `docker inspect --format '{{.RestartCount}} {{.State.Status}}' ${workerId}`,
          p.dir,
        ).stdout.trim();
        const partial = psql(
          p,
          "select count(*) from document_versions where kind = 'partially_signed'",
        );
        return `pg-boss ${jobs}; failed by queue: ${failed || "none"}; contract_envelopes ${env}; Versions of type Partially signed: ${partial}; worker restarts/state ${w}`;
      },
    );
};

// ---------------------------------------------------------------- negative check: backup-based recovery into a separate target

phases.recover = async () => {
  const p = R;
  const backupDir = `${state.preUpgradeBackup}-retained`;
  const env = { BACKUP_DIR: backupDir };
  const meta = {
    ...UPGRADE,
    article: "upgrade (If the upgrade cannot be accepted) + backup-and-restore",
  };
  await step(
    {
      ...meta,
      action:
        "Recovery step 1: prepare the starting build's source and images, retained keys, distinct project, origin and port; no first-run setup",
      critical: true,
    },
    () => {
      const out = installFiles(p, BASELINE);
      envSet(p, "AUTH_SECRET", secrets.up.AUTH_SECRET);
      envSet(p, "OPENLAW_SECRET_KEY", secrets.up.OPENLAW_SECRET_KEY);
      keepKeys(p);
      must("docker compose config --quiet", p.dir);
      const b = must("docker compose build app doc-engine", p.dir, { timeout: 3_000_000 });
      const recorded = JSON.parse(readFileSync(path.join(backupDir, "images.json"), "utf8")).find(
        (i) => i.ContainerName?.includes("-app-"),
      );
      const image = JSON.parse(must("docker compose config --format json", p.dir).stdout).services
        .app.image;
      return `${out.join("; ")}; build ${Math.round(b.ms / 1000)} s; project ${p.project}, BASE_URL ${envGet(p, "BASE_URL")}, PORT ${p.port}; retained keys from the secret store; backup images.json names ${recorded.Repository}:${recorded.Tag}; target app image ${image} (${inspectImage(image)})`;
    },
  );
  await step(
    {
      ...meta,
      action:
        "Recovery step 2: verify the hashes on the target host and start Postgres; confirm the target is empty",
      command: '(cd "$BACKUP_DIR" && sha256sum --check SHA256SUMS); docker compose up -d postgres',
      critical: true,
    },
    async () => {
      const c = must('(cd "$BACKUP_DIR" && sha256sum --check SHA256SUMS)', p.dir, { env })
        .stdout.trim()
        .replace(/\n/g, "; ");
      must("docker compose up -d postgres", p.dir, { timeout: 300_000 });
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
      return `${c}; target non-system tables ${tables}; entries under /var/lib/openlaw/files ${files}`;
    },
  );
  await step(
    {
      ...meta,
      action:
        "Recovery steps 3 and 4: restore the database with --exit-on-error and the files through the target app service's volume",
      critical: true,
    },
    () => {
      const r = sh(
        'docker compose exec -T postgres pg_restore -U openlaw -d openlaw --exit-on-error --no-owner --no-privileges < "$BACKUP_DIR/database.dump"',
        p.dir,
        { env, timeout: 900_000 },
      );
      check(r.code === 0, `pg_restore exit ${r.code}: ${r.stderr.slice(-500)}`);
      must(
        'docker compose run -T --rm --no-deps app tar -xzf - -C /var/lib/openlaw/files < "$BACKUP_DIR/files.tar.gz"',
        p.dir,
        { env, timeout: 900_000 },
      );
      return `pg_restore exit 0; tar exit 0`;
    },
  );
  await step(
    {
      ...meta,
      action:
        "Recovery step 5: start the target (controlled relay and stand-ins reachable under their saved names) and check readiness",
      command: "docker compose up -d --no-build --pull never; docker compose ps",
      critical: true,
    },
    async () => {
      must("docker compose up -d --no-build --pull never", p.dir, { timeout: 600_000 });
      attachSupport(p);
      await waitReady(p, 600_000);
      return {
        readyz: 200,
        ps: psAll(p).map((r) => `${r.service} ${r.state}`),
        images: recordImages("recover", p).containers,
      };
    },
  );
  await step(
    {
      ...meta,
      action:
        "Recovery target matches the pre-upgrade inventory: journal, counts, row digests, file hashes, sealed settings",
      critical: true,
    },
    async () => {
      const inv = await inventory(p, "recover");
      const cmp = compareInventories(state.inventories.before, state.inventories.recover);
      check(
        inv.journal.rows === state.inventories.before.journal.rows &&
          cmp.fileHashMismatches === 0 &&
          cmp.sealedChanged.length === 0,
        JSON.stringify({ j: inv.journal, cmp }),
      );
      return { journal: inv.journal, ...cmp };
    },
  );
  const { ADMIN } = await seedData();
  const s = await browserSignIn(p.base, ADMIN.email, labPassword());
  try {
    await step(
      {
        ...meta,
        role: "administrator",
        method: "browser-walkthrough",
        page: "/contracts",
        action:
          "Recovery target: sign in; hashes match; work accepted after the backup is absent; a Legal Team Member stays refused on the Confidential record",
      },
      async () => {
        const hashes = await downloadHashes(s.request, state.repHashes);
        const bad = hashes.filter((v, i) => v.sha256 !== state.repHashes[i].sha256);
        const later = state.postUpgradeUpload;
        const docs =
          (await s.request("GET", `/api/v1/contracts/${later.contract}/documents`)).body
            ?.documents ?? [];
        const present = docs.some((d) => d.id === later.id);
        const ltm = await browserSignIn(p.base, state.fx.ltm, labPassword());
        const conf = await ltm.request("GET", `/api/v1/contracts/${state.fx.confLtm[0]}`);
        await ltm.context.close();
        const t0 = Date.now();
        const test = await s.request("POST", "/api/v1/email-settings/test");
        const mail = await waitMail(
          p,
          (m) => toAddress(m, ADMIN.email) && m.Subject === "OpenLaw test email" && since(m, t0),
        );
        check(
          s.role === "administrator" && bad.length === 0 && !present && conf.status !== 200 && mail,
          JSON.stringify({
            role: s.role,
            bad: bad.length,
            present,
            conf: conf.status,
            test: test.status,
          }),
        );
        return `Administrator signed in at ${p.base}; ${hashes.length} representative Version hashes match; the Document uploaded after the backup is absent; Legal Team Member on Confidential C-${state.fx.confLtm[0]} answered ${conf.status}; test email through the restored relay ${test.status} and delivered; app image ${containerImage(p, "app")} is the starting build; ${U.project} was never started on an older image`;
      },
    );
  } finally {
    await s.context.close();
  }
};

// ---------------------------------------------------------------- findings

phases.findings = async () => {
  log.publicationBlockers = [];
  log.observations = [
    {
      article: "install",
      note: "At ad345da5 the guide's git clone from GitHub and git checkout --detach worked (the pin is on origin/dev). The 4ca41822 run's checkout failure is gone; that run is kept in walkthrough-4ca41822.json.",
    },
    {
      article: "upgrade",
      note: "Start step 5: a tab opened before the upgrade navigated Matters, Entities, Knowledge, Documents, Settings and Contracts after it without showing 'This part of OpenLaw was updated. Reload to continue.'. The guide says an old tab can show it.",
    },
    {
      article: "upgrade",
      note: "The starting build has no Team or Administration Tools, so the API key listed none before the upgrade. After it the ceiling lacks both and the key lists none; after an Administrator selects them again the same key lists openlaw_audit_log_query and openlaw_settings_get.",
    },
    {
      article: "upgrade",
      note: "This run's seed left 4 Envelopes (2 sent, 1 declined, 1 voided; the seed's outcomes depend on timing, and the 4ca41822 run had 2 signed). After the upgrade each has completes_contract=true and no Version became Partially signed.",
    },
    {
      article: "upgrade",
      note: "Fixture deviations on the starting build, not guide steps: 00528360's contracts.mjs fix and a network-alias base_uri in a scratch copy of the 067c1646 seed; the lab overlay's seed-only settings were removed and the containers recreated before the baseline; the baseline waits until no pg-boss job is due.",
    },
  ];
  log.supersededAttempts =
    "The first upgrade attempt in this log took its baseline while 63 seeded processing jobs were still queued, so 4 derived files appeared before the pause and the file-count check failed (all 175 baseline file hashes still matched); its recovery step then had no post-upgrade upload to look for. Both upgrade projects were removed with docker compose -p ... down -v and the whole scenario was rerun with the baseline taken after the queue drained. The last run of each step is the result.";
  log.summary = {
    install:
      "V-C44 operator/container-operation at ad345da5 on openlaw-doc032-opinst: every step passed, including the GitHub clone and checkout.",
    upgrade:
      "V-C46 operator/container-operation from 067c1646 to ad345da5 on openlaw-doc032-opup, recovery on openlaw-doc032-oprecover: every step passed.",
  };
  saveLog();
  console.log("findings saved");
};

// ---------------------------------------------------------------- teardown

phases.destroy = async () => {
  await step(
    {
      scenario: "teardown",
      action: "Tear down every owned project, support container, and the private scratch directory",
    },
    () => {
      const out = [];
      for (const p of Object.values(PROJECTS)) {
        if (!existsSync(path.join(p.dir, ".env"))) {
          const vols = sh(
            `docker volume ls -q --filter label=com.docker.compose.project=${p.project}`,
            root,
          ).stdout.trim();
          out.push(`${p.project}: no installation directory; volumes ${vols || "none"}`);
          continue;
        }
        const r = sh(`docker compose -p ${p.project} down -v --remove-orphans`, p.dir, {
          timeout: 300_000,
        });
        out.push(`${p.project}: down -v exit ${r.code}`);
      }
      for (const s of [
        ...Object.values(SUPPORT).map((x) => x.name),
        "openlaw-doc032-op-seed",
        "openlaw-doc032-op-seedproxy",
      ]) {
        const r = sh(`docker rm -f ${s}`, root);
        out.push(`${s}: rm exit ${r.code}`);
      }
      const left = sh(
        "docker ps -a --format '{{.Names}}' | grep -E '^openlaw-doc032-op(inst|up|recover|-)' || true",
        root,
      ).stdout.trim();
      const nets = sh(
        "docker network ls --format '{{.Name}}' | grep -E '^openlaw-doc032-op(inst|up|recover)_' || true",
        root,
      ).stdout.trim();
      const vols = sh(
        "docker volume ls --format '{{.Name}}' | grep -E '^openlaw-doc032-op(inst|up|recover)_' || true",
        root,
      ).stdout.trim();
      return `${out.join("; ")}; remaining containers: ${left || "none"}; networks: ${nets || "none"}; volumes: ${vols || "none"}`;
    },
  );
};
phases["scratch-remove"] = async () => {
  rmSync(WORK, { recursive: true, force: true });
  console.log(`removed ${WORK}`);
};

// ---------------------------------------------------------------- browser record helpers

async function createContractInBrowser(page, base, title) {
  await page.goto(`${base}/contracts`);
  await page.getByRole("button", { name: "Create contract" }).first().click();
  const dialog = page.getByRole("dialog").first();
  await dialog.waitFor({ timeout: 15_000 });
  await dialog.getByLabel(/^Title/).fill(title);
  const typeShown = await dialog
    .getByLabel(/^Contract type/)
    .evaluate((el) =>
      el.tagName === "SELECT" ? el.options[el.selectedIndex]?.textContent : el.textContent,
    )
    .catch(() => null);
  await dialog.getByRole("button", { name: "Create", exact: true }).click();
  await page.waitForURL(/\/contracts\/\d+/, { timeout: 30_000 });
  const number = Number(new URL(page.url()).pathname.match(/\/contracts\/(\d+)/)[1]);
  return {
    number,
    title,
    how: `Contracts, Create contract, Title "${title}", Contract type "${typeShown}", Create opened /contracts/${number}`,
  };
}

async function uploadInBrowser(page, base, number, filename, bytes) {
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
  const response = await waitCreate;
  const doc = (await response.json()).document;
  const version = doc.versions.find((v) => v.isCurrent) ?? doc.versions[0];
  return {
    documentId: doc.id,
    versionId: version.id,
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
  articleHashes: Object.fromEntries(
    Object.entries(log.articles).map(([k, v]) => [k, v.contentSha256.slice(0, 16)]),
  ),
  startedAt: new Date().toISOString(),
  finishedAt: null,
};
if (phase !== "scratch-remove") log.runs.push(run);
try {
  await phases[phase](process.argv[3]);
} catch (error) {
  console.error(redact(error?.stack ?? error));
  run.error = redact(error?.message ?? String(error)).slice(0, 800);
} finally {
  run.finishedAt = new Date().toISOString();
  if (phase !== "scratch-remove") {
    saveLog();
    saveState();
  }
  await closeBrowser();
}
process.exit(run.error ? 1 : 0);

export { guideFailure, productBug, observe, attach };
