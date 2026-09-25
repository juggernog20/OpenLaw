// SPDX-License-Identifier: AGPL-3.0-only
// DOC-030 contracts-c copy of DOC-029/rewalk/signing/server.mjs, which copies
// DOC-029/signing-standin/fixture/server.mjs and keeps each Signer's posted `tabs`. This copy changes
// only the fictional names (integration key, account name, ids) from DOC-029 to DOC-030.
// DOC-029 signing-standin: a local DocuSign protocol stand-in for the V-C17-electronic walkthrough.
// It is a plain-JS port of e2e/tests/docusign.ts at app commit 3fa407e3 (the same calls the driver
// makes: JWT grant, userinfo, envelope create/read/void, combined documents), plus a control API
// under /__control that only the walkthrough uses. It never talks to a real provider.
// It holds no secrets: it accepts one fictional integration key and does not sign deliveries.
import { createHash } from "node:crypto";
import { createServer } from "node:http";

const PORT = Number(process.env.STANDIN_PORT ?? 8129);
const PUBLIC_BASE = process.env.STANDIN_PUBLIC_BASE ?? `http://signing-standin:${PORT}`;
const INTEGRATION_KEY = "doc030-standin-integration-key";
const ACCOUNT_ID = "doc030-standin-account";
const ACCOUNT_NAME = "DOC-030 signing stand-in";
const USER_EMAIL = "integration@standin.example";
const TOKEN = "doc030-standin-access-token";

const envelopes = new Map();
const faults = { outage: false, combinedRefused: false };
const counters = { tokenGrants: 0, envelopePosts: 0 };
let minted = 0;
const idPrefix = `doc030-env-${Date.now()}`;

const executedPdf = (id) =>
  Buffer.from(`%PDF-1.7\n% DOC-030 stand-in executed copy for ${id}\n%%EOF\n`, "utf8");

async function readBody(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks);
}
function sendJson(response, status, body) {
  response.writeHead(status, { "content-type": "application/json" });
  response.end(JSON.stringify(body));
}
function claims(assertion) {
  try {
    return JSON.parse(Buffer.from(assertion.split(".")[1] ?? "", "base64url").toString("utf8"));
  } catch {
    return {};
  }
}
const sha = (buffer) => createHash("sha256").update(buffer).digest("hex");

async function control(path, request, response) {
  const body =
    request.method === "POST" ? JSON.parse((await readBody(request)).toString() || "{}") : {};
  if (path === "/__control/state") {
    return sendJson(response, 200, {
      faults,
      counters,
      envelopes: [...envelopes.entries()].map(([id, e]) => ({
        id,
        status: e.status,
        subject: e.emailSubject,
        signers: e.signers,
        documentSha256: sha(e.document),
        documentBytes: e.document.length,
        documentCount: e.documentCount,
        voidedReason: e.voidedReason ?? null,
        declinedReason: e.declinedReason ?? null,
        executedSha256: sha(executedPdf(id)),
      })),
    });
  }
  if (path === "/__control/faults") {
    if (typeof body.outage === "boolean") faults.outage = body.outage;
    if (typeof body.combinedRefused === "boolean") faults.combinedRefused = body.combinedRefused;
    return sendJson(response, 200, { faults });
  }
  const envelope = envelopes.get(body.id);
  if (!envelope) return sendJson(response, 404, { error: "no such envelope" });
  const now = new Date().toISOString();
  if (path === "/__control/complete") {
    envelope.status = "completed";
    envelope.completedDateTime = now;
    return sendJson(response, 200, {
      id: body.id,
      status: envelope.status,
      completedDateTime: now,
    });
  }
  if (path === "/__control/decline") {
    envelope.status = "declined";
    envelope.declinedReason = body.reason;
    envelope.completedDateTime = now;
    return sendJson(response, 200, {
      id: body.id,
      status: envelope.status,
      completedDateTime: now,
    });
  }
  return sendJson(response, 404, { error: "unknown control" });
}

async function handle(request, response) {
  const path = new URL(request.url ?? "/", "http://standin.invalid").pathname;
  if (path.startsWith("/__control/")) return control(path, request, response);

  if (path === "/oauth/token" && request.method === "POST") {
    const form = new URLSearchParams((await readBody(request)).toString("utf8"));
    if (claims(form.get("assertion") ?? "").iss !== INTEGRATION_KEY)
      return sendJson(response, 400, { error: "invalid_grant" });
    counters.tokenGrants += 1;
    return sendJson(response, 200, { access_token: TOKEN, token_type: "Bearer", expires_in: 3600 });
  }
  if (request.headers.authorization !== `Bearer ${TOKEN}`)
    return sendJson(response, 401, { error: "unauthorized" });
  if (path === "/oauth/userinfo") {
    return sendJson(response, 200, {
      email: USER_EMAIL,
      accounts: [
        {
          account_id: ACCOUNT_ID,
          account_name: ACCOUNT_NAME,
          base_uri: PUBLIC_BASE,
          is_default: true,
        },
      ],
    });
  }
  const base = `/restapi/v2.1/accounts/${ACCOUNT_ID}/envelopes`;
  if (path === base && request.method === "POST") {
    counters.envelopePosts += 1;
    const definition = JSON.parse((await readBody(request)).toString("utf8"));
    if (faults.outage) return sendJson(response, 503, { errorCode: "SERVICE_UNAVAILABLE" });
    const signers = definition.recipients?.signers ?? [];
    if (signers.length === 0)
      return sendJson(response, 400, { errorCode: "RECIPIENT_NOT_PROVIDED" });
    minted += 1;
    const id = `${idPrefix}-${String(minted).padStart(4, "0")}`;
    envelopes.set(id, {
      status: "sent",
      signers: signers.map((s) => ({
        name: s.name ?? "",
        email: s.email ?? "",
        routingOrder: s.routingOrder ?? null,
        tabs: s.tabs ?? null,
      })),
      documentCount: definition.documents?.length ?? 0,
      emailSubject: definition.emailSubject ?? "",
      document: Buffer.from(definition.documents?.[0]?.documentBase64 ?? "", "base64"),
    });
    return sendJson(response, 201, { envelopeId: id, status: "sent" });
  }
  if (path.startsWith(`${base}/`)) {
    const [rawId, ...tail] = path.slice(base.length + 1).split("/");
    const id = decodeURIComponent(rawId ?? "");
    const envelope = envelopes.get(id);
    if (!envelope) return sendJson(response, 404, { errorCode: "ENVELOPE_DOES_NOT_EXIST" });
    if (tail.join("/") === "documents/combined") {
      if (envelope.status !== "completed")
        return sendJson(response, 400, { errorCode: "ENVELOPE_NOT_COMPLETED" });
      if (faults.combinedRefused)
        return sendJson(response, 400, { errorCode: "DOC030_STANDIN_REFUSED" });
      response.writeHead(200, { "content-type": "application/pdf" });
      return response.end(executedPdf(id));
    }
    if (tail.length === 0 && request.method === "GET") {
      return sendJson(response, 200, {
        envelopeId: id,
        status: envelope.status,
        ...(envelope.voidedReason === undefined ? {} : { voidedReason: envelope.voidedReason }),
        ...(envelope.declinedReason === undefined
          ? {}
          : { declinedReason: envelope.declinedReason }),
        ...(envelope.completedDateTime === undefined
          ? {}
          : { completedDateTime: envelope.completedDateTime }),
      });
    }
    if (tail.length === 0 && request.method === "PUT") {
      const update = JSON.parse((await readBody(request)).toString("utf8"));
      if (update.status !== "voided" || envelope.status !== "sent")
        return sendJson(response, 400, { errorCode: "ENVELOPE_CANNOT_BE_VOIDED" });
      envelope.status = "voided";
      envelope.voidedReason = update.voidedReason;
      envelope.completedDateTime = new Date().toISOString();
      return sendJson(response, 200, { envelopeId: id, status: "voided" });
    }
  }
  return sendJson(response, 404, { errorCode: "ROUTE_NOT_FOUND" });
}

createServer((request, response) => {
  handle(request, response).catch((error) => {
    if (response.headersSent) return response.end();
    sendJson(response, error instanceof SyntaxError ? 400 : 500, { errorCode: "STANDIN_FAILED" });
  });
}).listen(PORT, "0.0.0.0", () => console.log(`DOC-030 signing stand-in on ${PORT}`));
