// DOC-030 claude-live, phase "operator": deployment-configuration "Publicly reachable"
// steps 1-2 and "Serve the intended origin" on the owned claudelive lab, before any
// exposure. The lab's .env is edited as the guide says; the original is kept outside
// the repository and restored before lab.mjs destroy (its configuration digest covers .env).
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { compose, createLog, expectThat, LAB, LAB_DIR, PUBLIC, sh, waitHealthy } from "./lib.mjs";

const ENV = path.join(LAB_DIR, "source/.env");
const { save, step } = createLog("operator", {
  lab: LAB.name,
  environment: LAB.project,
  labManifest: JSON.parse(readFileSync(path.join(LAB_DIR, "lab.json"), "utf8")),
});
const S = {
  article: "deployment-configuration",
  scenario: "V-M41-PUBLIC",
  role: "operator",
  method: "container-operation",
  page: "installation directory",
};
const keys = () =>
  Object.fromEntries(
    readFileSync(ENV, "utf8")
      .split("\n")
      .filter((l) => /^[A-Z_]+=/.test(l))
      .map((l) => [l.split("=")[0], l.slice(l.indexOf("=") + 1)]),
  );
function setEnv(key, value) {
  const lines = readFileSync(ENV, "utf8")
    .split("\n")
    .filter((l) => !l.startsWith(`${key}=`));
  while (lines.at(-1) === "") lines.pop();
  lines.push(`${key}=${value}`, "");
  writeFileSync(ENV, lines.join("\n"), { mode: 0o600 });
}
const containerEnv = (service, key) => {
  const id = compose(["ps", "-q", service]).trim();
  return sh("docker", [
    "--context",
    "default",
    "inspect",
    id,
    "--format",
    "{{range .Config.Env}}{{println .}}{{end}}",
  ])
    .out.split("\n")
    .find((l) => l.startsWith(`${key}=`))
    ?.slice(key.length + 1);
};
const createdAt = (service) =>
  sh("docker", [
    "--context",
    "default",
    "inspect",
    compose(["ps", "-q", service]).trim(),
    "--format",
    "{{.Created}}",
  ]).out.trim();

await step(
  { ...S },
  "Publicly reachable 1: set the public HTTPS origin as BASE_URL in .env, no subpath",
  `.env BASE_URL=${PUBLIC}`,
  async () => {
    const before = keys().BASE_URL;
    setEnv("BASE_URL", PUBLIC);
    const after = keys().BASE_URL;
    expectThat(after === PUBLIC, after);
    return `.env BASE_URL was ${before} (lab.mjs default); now ${after}. The origin is the Tailscale Funnel hostname omarchy.tail0a8904.ts.net on port 8443 (Funnel allows 443, 8443 and 10000); Tailscale terminates TLS there with its own publicly trusted certificate. No application subpath.`;
  },
);

await step(
  { ...S },
  "Publicly reachable 1: recreate app and worker (docker compose config --quiet; up -d --no-build --pull never)",
  "Both containers recreated with the new BASE_URL; readyz 200",
  async () => {
    const before = { app: createdAt("app"), worker: createdAt("worker") };
    const q = compose(["config", "--quiet"]);
    compose(["up", "-d", "--no-build", "--pull", "never", "--wait", "--wait-timeout", "180"]);
    await waitHealthy();
    const after = { app: createdAt("app"), worker: createdAt("worker") };
    const env = {
      app: containerEnv("app", "BASE_URL"),
      worker: containerEnv("worker", "BASE_URL"),
    };
    expectThat(
      before.app !== after.app &&
        before.worker !== after.worker &&
        env.app === PUBLIC &&
        env.worker === PUBLIC,
      JSON.stringify({ before, after, env }),
    );
    return `config --quiet printed ${JSON.stringify(q.trim())}. up -d --no-build --pull never recreated app (created ${before.app} → ${after.app}) and worker (${before.worker} → ${after.worker}). Container BASE_URL app ${env.app}, worker ${env.worker}. /readyz 200 on 127.0.0.1:43330.`;
  },
);

let gateway;
await step(
  { ...S },
  "Find the trusted proxy address: docker network inspect <project>_openlaw-backend; set TRUSTED_PROXIES to the gateway; up -d --no-build --pull never",
  "Gateway read; app recreated with TRUSTED_PROXIES; no start warning",
  async () => {
    const r = sh("docker", [
      "--context",
      "default",
      "network",
      "inspect",
      `${LAB.project}_openlaw-backend`,
      "--format",
      "{{range .IPAM.Config}}{{.Gateway}} {{.Subnet}}{{end}}",
    ]);
    [gateway] = r.out.trim().split(" ");
    setEnv("TRUSTED_PROXIES", gateway);
    compose(["up", "-d", "--no-build", "--pull", "never", "--wait", "--wait-timeout", "180"]);
    await waitHealthy();
    const tp = containerEnv("app", "TRUSTED_PROXIES");
    const logs = compose(["logs", "--no-color", "--since", "2m", "app"]);
    const warned = /TRUSTED_PROXIES is not set/.test(logs);
    expectThat(tp === gateway && !warned, JSON.stringify({ tp, warned }));
    return `network inspect printed "${r.out.trim()}". TRUSTED_PROXIES=${gateway} in .env; up -d recreated app; container TRUSTED_PROXIES=${tp}; start log has "TRUSTED_PROXIES is not set": ${warned}.`;
  },
);

await step(
  { ...S },
  "Publicly reachable 2: keep the app port behind the reverse proxy; database and document engine unpublished",
  "docker compose port app 3000 prints 127.0.0.1:43330; postgres and doc-engine publish nothing",
  async () => {
    const app = compose(["port", "app", "3000"]).trim();
    const ps = compose(["ps", "--format", "{{.Service}} {{.Publishers}}"]).trim().split("\n");
    const leaks = ps.filter(
      (l) => /^(postgres|doc-engine) /.test(l) && /PublishedPort:[1-9]/.test(l),
    );
    expectThat(app === "127.0.0.1:43330" && leaks.length === 0, JSON.stringify({ app, leaks }));
    return `docker compose port app 3000 → ${app}. Published ports: ${ps.map((l) => l.replace(/\{[^}]*PublishedPort:0[^}]*\}/g, "").replace(/\s+/g, " ")).join("; ")}. Postgres and doc-engine publish none. Mailpit's UI on 127.0.0.1:48450 is the lab's own mail stand-in, loopback only.`;
  },
);

save();
console.log("operator phase done");
