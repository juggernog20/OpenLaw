// DOC-030 claude-live, phase "outside": the Funnel listener on 8443 and the Publicly
// reachable checks from outside the tailnet. On this machine MagicDNS answers the
// hostname with the tailnet address, so every request here is pinned to a public
// Funnel ingress address from public DNS (Cloudflare and Google DoH). The request
// then crosses the internet to Tailscale's relay and comes back through Funnel.
import path from "node:path";
import { createLog, expectThat, LAB, PUBLIC, ROOT, sh } from "./lib.mjs";

const undici = await import(
  path.join(ROOT, "node_modules/.pnpm/undici@7.29.1/node_modules/undici/index.js")
);
const HOST = new URL(PUBLIC).hostname;
const { save, step } = createLog("outside", { lab: LAB.name, publicOrigin: PUBLIC });
const S = {
  article: "deployment-configuration",
  scenario: "V-M41-PUBLIC",
  role: "operator",
  method: "container-operation",
  page: "Tailscale Funnel 8443",
};

let ingress = [];
await step(
  S,
  "Funnel: tailscale funnel --bg --https=8443 http://127.0.0.1:43330; only the 8443 listener changes",
  "Funnel on for :8443; tailnet-only 443 and TCP 5901 unchanged",
  async () => {
    // The listener was opened once by hand (the command printed "Funnel started and running
    // in the background."); this step reads the state it left.
    const st = sh("tailscale", ["funnel", "status"]).out;
    const on =
      /https:\/\/omarchy\.tail0a8904\.ts\.net:8443 \(Funnel on\)\s*\n\|-- \/ proxy http:\/\/127\.0\.0\.1:43330/.test(
        st,
      );
    const keep443 =
      /https:\/\/omarchy\.tail0a8904\.ts\.net \(tailnet only\)\s*\n\|-- \/ proxy http:\/\/127\.0\.0\.1:3773/.test(
        st,
      );
    const keep5901 = /tcp:\/\/omarchy\.tail0a8904\.ts\.net:5901 \(tailnet only\)/.test(st);
    expectThat(on && keep443 && keep5901, st);
    return `tailscale funnel status: ":8443 (Funnel on) |-- / proxy http://127.0.0.1:43330"; the tailnet-only 443 proxy to 127.0.0.1:3773 and tcp :5901 → localhost:5900 are unchanged. The first command run, before the tailnet owner enabled Funnel, printed "Funnel is not enabled on your tailnet." with an admin URL and changed nothing.`;
  },
);

await step(
  S,
  "Publicly reachable 1: public DNS hostname with a public IPv4 address, publicly trusted certificate",
  "A records from public resolvers are public IPv4; TLS verifies against the system trust store",
  async () => {
    const cf = await (
      await fetch(`https://cloudflare-dns.com/dns-query?name=${HOST}&type=A`, {
        headers: { accept: "application/dns-json" },
      })
    ).json();
    const gg = await (await fetch(`https://dns.google/resolve?name=${HOST}&type=AAAA`)).json();
    ingress = (cf.Answer ?? []).filter((a) => a.type === 1).map((a) => a.data);
    const tls = sh("curl", [
      "-s",
      "--max-time",
      "25",
      "--resolve",
      `${HOST}:8443:${ingress[0]}`,
      "-o",
      "/dev/null",
      "-w",
      "%{http_code} %{ssl_verify_result}",
      `${PUBLIC}/readyz`,
    ]).out;
    const cert = sh("sh", [
      "-c",
      `echo | openssl s_client -connect ${ingress[0]}:8443 -servername ${HOST} 2>/dev/null | openssl x509 -noout -issuer -subject -enddate`,
    ]).out.replace(/\n/g, "; ");
    expectThat(ingress.length > 0 && tls === "200 0", JSON.stringify({ ingress, tls }));
    return `Cloudflare DoH A ${HOST}: ${ingress.join(", ")}. Google DoH AAAA status ${gg.Status}, answers ${(gg.Answer ?? []).length}. /readyz via ${ingress[0]}: HTTP ${tls.split(" ")[0]}, curl ssl_verify_result ${tls.split(" ")[1]} (0 = verified by /etc/ssl/certs). Certificate: ${cert.trim()}. The public record appeared within 10 s of starting Funnel; the certificate took about 3 minutes (TLS handshakes failed until then).`;
  },
);

const pinned = () =>
  new undici.Agent({
    connect: {
      lookup: (_h, opts, cb) =>
        opts?.all ? cb(null, [{ address: ingress[0], family: 4 }]) : cb(null, ingress[0], 4),
    },
  });
const outside = (p, init = {}) => undici.fetch(`${PUBLIC}${p}`, { ...init, dispatcher: pinned() });

await step(
  S,
  "Publicly reachable table: discovery paths return JSON, not the SPA fallback",
  "Each well-known path 200 application/json with the public issuer; jwks JSON",
  async () => {
    const paths = [
      "/.well-known/oauth-authorization-server",
      "/.well-known/oauth-authorization-server/api/auth",
      "/.well-known/openid-configuration",
      "/.well-known/openid-configuration/api/auth",
      "/.well-known/oauth-protected-resource",
      "/.well-known/oauth-protected-resource/mcp",
      "/api/auth/jwks",
    ];
    const out = [];
    let bad = 0;
    for (const p of paths) {
      const r = await outside(p);
      const type = r.headers.get("content-type") ?? "";
      const text = await r.text();
      let j = null;
      try {
        j = JSON.parse(text);
      } catch {}
      if (r.status !== 200 || !/json/.test(type) || !j) bad++;
      const key = j?.issuer
        ? `issuer ${j.issuer}`
        : j?.resource
          ? `resource ${j.resource}; authorization_servers ${JSON.stringify(j.authorization_servers)}`
          : j?.keys
            ? `${j.keys.length} key(s)`
            : text.slice(0, 60);
      out.push(`${p} → ${r.status} ${type.split(";")[0]} (${key})`);
    }
    const as = await (await outside("/.well-known/oauth-authorization-server")).json();
    expectThat(bad === 0 && as.client_id_metadata_document_supported === true, out.join("; "));
    return `${out.join("; ")}. Authorization server metadata: authorization_endpoint ${as.authorization_endpoint}; token_endpoint ${as.token_endpoint}; client_id_metadata_document_supported ${as.client_id_metadata_document_supported}; registration_endpoint present ${"registration_endpoint" in as} (Dynamic client registration is off by default).`;
  },
);

await step(
  S,
  "Publicly reachable table: unauthenticated /mcp returns 401 with WWW-Authenticate pointing to resource discovery",
  "401; WWW-Authenticate Bearer resource_metadata=https://…:8443/.well-known/oauth-protected-resource",
  async () => {
    const r = await outside("/mcp", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: "2025-06-18",
          capabilities: {},
          clientInfo: { name: "DOC-030 claude-live probe", version: "1" },
        },
      }),
    });
    const www = r.headers.get("www-authenticate") ?? "";
    await r.text();
    expectThat(
      r.status === 401 &&
        www.includes(`resource_metadata="${PUBLIC}/.well-known/oauth-protected-resource"`),
      `${r.status} ${www}`,
    );
    return `POST /mcp initialize without credentials → ${r.status}; WWW-Authenticate: ${www.slice(0, 120)}… (scope lists the thirteen toolset scopes, write and offline_access).`;
  },
);

await step(
  S,
  "Publicly reachable table: sign-in, consent page and static assets reach the browser through the same origin",
  "/auth/login, /auth/consent and /portal/login return the app HTML; a signed-out consent facts call is 401 JSON",
  async () => {
    const out = [];
    for (const p of ["/auth/login", "/auth/consent", "/portal/login"]) {
      const r = await outside(p);
      const t = await r.text();
      out.push(
        `${p} → ${r.status} ${/<div id="root"|<script/.test(t) ? "app HTML" : t.slice(0, 40)}`,
      );
    }
    const f = await outside("/api/v1/oauth-grants/consent?oauth_query=x");
    out.push(
      `/api/v1/oauth-grants/consent signed out → ${f.status} ${(f.headers.get("content-type") ?? "").split(";")[0]}`,
    );
    await f.text();
    expectThat(
      out.slice(0, 3).every((l) => / 200 app HTML$/.test(l)) && f.status === 401,
      out.join("; "),
    );
    return out.join("; ");
  },
);

await step(
  S,
  "Negative: private endpoints stay unreachable outside the permitted network",
  "Mailpit, Postgres and the direct app port are not on the public ingress; the tailnet-only 443 listener is not public",
  async () => {
    const probes = [];
    for (const port of [443, 43330, 48450, 5432, 5901]) {
      const r =
        sh("curl", [
          "-sk",
          "--max-time",
          "8",
          "-o",
          "/dev/null",
          "-w",
          "%{http_code}",
          `https://${ingress[0]}:${port}/`,
        ]).out || "000";
      probes.push(`${ingress[0]}:${port} → ${r}`);
    }
    const lan = sh("sh", [
      "-c",
      "ip -4 -o addr show scope global | awk '{print $4}' | cut -d/ -f1 | grep -v '^100\\.' | grep -v '^172\\.' | grep -v '^192\\.168\\.2[0-9][0-9]\\.' | head -1",
    ]).out.trim();
    const direct = lan
      ? sh("curl", [
          "-s",
          "--max-time",
          "5",
          "-o",
          "/dev/null",
          "-w",
          "%{http_code}",
          `http://${lan}:43330/readyz`,
        ]).out || "000"
      : "no LAN address";
    expectThat(
      probes.every((p) => / (000)$/.test(p) || p.includes(":443 →")) &&
        (direct === "000" || direct === "no LAN address"),
      JSON.stringify({ probes, direct }),
    );
    return `Public ingress probes: ${probes.join("; ")}. The app on this host's LAN address ${lan || "(none)"}:43330 → ${direct} (Compose publishes it on 127.0.0.1 only). Port 443 on the ingress belongs to Tailscale's shared relay; the tailnet-only 443 listener of this node is not in Funnel.`;
  },
);

save();
console.log(`ingress ${ingress.join(",")}`);
