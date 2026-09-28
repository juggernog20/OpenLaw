// SPDX-License-Identifier: AGPL-3.0-only
// DOC-032 contracts-2: start the e2e signing stand-in (e2e/tests/docusign.ts at the pinned
// commit) inside the owned lab's backend network, plus a small control port for the walkthrough.
// Adapted from DOC-032 contracts/fixture/standin-entry.mjs. up.sh bundles this file with esbuild
// into /tmp. The stand-in never talks to a real provider; its keys are fictional.
//
// Control port 8130 (published on loopback by signing-overlay.yml):
//   GET  /list                         envelope ids and stand-in statuses
//   POST /complete?id=<providerId>     marks it completed and answers a signed Connect delivery
//   POST /fault?create=500|off         answer 500 to the next envelope creations (uncertain send)
//   POST /fault?combined=503|400|off&id=<providerId>
//                                      answer that envelope's executed-document download with
//                                      this status (off restores the stand-in's own answer)
import { createServer } from "node:http";
import { SigningStub } from "../../../../../../e2e/tests/docusign.ts";

const stub = await SigningStub.start({
  integrationKey: "doc032-contracts-2-standin-integration-key",
  webhookSecret: "doc032-contracts-2-standin-connect-secret",
  port: 8129,
});
const faults = { create: "off", combined: {} };
const server = stub.server;
const [original] = server.listeners("request");
server.removeAllListeners("request");
server.on("request", (request, response) => {
  const path = new URL(request.url ?? "/", "http://stub.invalid").pathname;
  if (faults.create !== "off" && request.method === "POST" && /\/envelopes$/.test(path)) {
    request.resume();
    request.on("end", () => {
      response.writeHead(Number(faults.create), { "content-type": "application/json" });
      response.end(JSON.stringify({ errorCode: "STANDIN_FAULT" }));
    });
    return;
  }
  const combined = path.match(/\/envelopes\/([^/]+)\/documents\/combined$/);
  const fault = combined && faults.combined[decodeURIComponent(combined[1])];
  if (fault) {
    const status = Number(fault);
    response.writeHead(status, { "content-type": "application/json" });
    response.end(
      JSON.stringify({ errorCode: status === 400 ? "ENVELOPE_NOT_COMPLETED" : "STANDIN_FAULT" }),
    );
    return;
  }
  original.call(server, request, response);
});

createServer((request, response) => {
  const url = new URL(request.url ?? "/", "http://control.invalid");
  const json = (status, body) => {
    response.writeHead(status, { "content-type": "application/json" });
    response.end(JSON.stringify(body));
  };
  try {
    if (url.pathname === "/list")
      return json(200, {
        faults,
        envelopes: stub.sentEnvelopeIds().map((id) => ({ id, status: stub.statusOf(id) })),
      });
    if (url.pathname === "/complete" && request.method === "POST") {
      const id = url.searchParams.get("id");
      stub.complete(id);
      return json(
        200,
        stub.signedDelivery({
          providerEnvelopeId: id,
          status: "completed",
          completedAt: new Date().toISOString(),
        }),
      );
    }
    if (url.pathname === "/fault" && request.method === "POST") {
      if (url.searchParams.has("create")) faults.create = url.searchParams.get("create");
      const id = url.searchParams.get("id");
      if (url.searchParams.has("combined") && id) {
        const value = url.searchParams.get("combined");
        if (value === "off") delete faults.combined[id];
        else faults.combined[id] = value;
      }
      return json(200, { faults });
    }
    json(404, { error: "unknown" });
  } catch (error) {
    json(500, { error: String(error?.message ?? error) });
  }
}).listen(8130, "0.0.0.0");
console.log(`DOC-032 contracts-2 signing stand-in on ${stub.port}, control on 8130`);
