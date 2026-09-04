/* A DocuSign-shaped stand-in, so the seeded instance holds real
 * Envelopes (CTR-013, TECH-013).
 *
 * The signature stage is a whole third of the contract pipeline, and
 * none of it exists without a signing connector: no envelope panel, no
 * signer list, no declined round, no executed copy pinned to the chain.
 * Sending real paper to a real DocuSign account to fill a demo database
 * is obviously out, so the seed brings its own provider.
 *
 * Unlike the AI stand-in, this one cannot be reached by configuration
 * alone. The DocuSign driver takes its host from the environment
 * (`DOCUSIGN_BASE_URL` plus `SIGNING_STANDIN`, and either one alone
 * stops the boot), which is a deliberate guard: one line in the wrong
 * `.env` would otherwise send a real install's contracts somewhere
 * nobody chose. So the dev loop has to be started with both, and the
 * seed's `--with-signing` phase checks that it was.
 *
 * It speaks DocuSign's own shapes on the calls the driver makes: the JWT
 * grant, userinfo, create, read, void, and the combined document. It is
 * the same conversation the E2E stand-in holds, kept separate because
 * this one is scripted by a seed rather than by a test.
 */

import { createHmac } from "node:crypto";
import { createServer } from "node:http";

/** The account the credentials reach. Fixed, so the pane has a name. */
const ACCOUNT_ID = "seed-account-0001";
const ACCOUNT_NAME = "Helix Software Group (demo)";
const USER_EMAIL = "esign@helix.example";
const ACCESS_TOKEN = "seed-access-token";

/** The header DocuSign Connect signs each delivery with. */
export const CONNECT_SIGNATURE_HEADER = "x-docusign-signature-1";

function sendJson(response, status, body) {
  response.writeHead(status, { "content-type": "application/json" });
  response.end(JSON.stringify(body));
}

async function readBody(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks);
}

/** One JWT's claims, decoded without verifying: the stand-in only needs
 * to know who is asking, and the signature is the driver's own business. */
function claimsOf(assertion) {
  const payload = assertion.split(".")[1];
  if (!payload) return {};
  try {
    return JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
  } catch {
    return {};
  }
}

/** The executed paper the provider hands back once an envelope is signed. */
function executedPdf(envelopeId) {
  return Buffer.from(`%PDF-1.7\n% openlaw-seed: executed copy for ${envelopeId}\n%%EOF\n`, "utf8");
}

/**
 * Starts the stand-in and answers until it is closed.
 *
 * `port` has to match the `DOCUSIGN_BASE_URL` the app was started with;
 * both ends were told an address before either was running.
 */
export async function startSigningStub({
  port = 8129,
  integrationKey = "seed-integration-key",
  webhookSecret = "seed-webhook-secret",
} = {}) {
  const envelopes = new Map();
  let minted = 0;
  // A provider envelope id is unique for good, so a re-seed against a
  // database that kept its rows must not mint one twice.
  const prefix = `seed-envelope-${Date.now()}`;

  async function handle(request, response) {
    const path = new URL(request.url ?? "/", "http://stub.invalid").pathname;

    if (path === "/oauth/token" && request.method === "POST") {
      const form = new URLSearchParams((await readBody(request)).toString("utf8"));
      const claims = claimsOf(form.get("assertion") ?? "");
      if (claims.iss !== integrationKey) {
        sendJson(response, 400, { error: "invalid_grant" });
        return;
      }
      sendJson(response, 200, {
        access_token: ACCESS_TOKEN,
        token_type: "Bearer",
        expires_in: 3600,
      });
      return;
    }

    if (request.headers.authorization !== `Bearer ${ACCESS_TOKEN}`) {
      sendJson(response, 401, { error: "unauthorized" });
      return;
    }

    if (path === "/oauth/userinfo") {
      sendJson(response, 200, {
        email: USER_EMAIL,
        accounts: [
          {
            account_id: ACCOUNT_ID,
            account_name: ACCOUNT_NAME,
            base_uri: `http://127.0.0.1:${port}`,
            is_default: true,
          },
        ],
      });
      return;
    }

    const base = `/restapi/v2.1/accounts/${ACCOUNT_ID}/envelopes`;
    if (path === base && request.method === "POST") {
      const definition = JSON.parse((await readBody(request)).toString("utf8"));
      const signers = definition.recipients?.signers ?? [];
      if (signers.length === 0) {
        sendJson(response, 400, { errorCode: "RECIPIENT_NOT_PROVIDED" });
        return;
      }
      minted += 1;
      const id = `${prefix}-${String(minted).padStart(4, "0")}`;
      envelopes.set(id, {
        status: "sent",
        signers: signers.map((signer) => ({ name: signer.name, email: signer.email })),
        emailSubject: definition.emailSubject ?? "",
      });
      sendJson(response, 201, { envelopeId: id, status: "sent" });
      return;
    }

    if (path.startsWith(`${base}/`)) {
      const [rawId, ...tail] = path.slice(base.length + 1).split("/");
      const id = decodeURIComponent(rawId ?? "");
      const envelope = envelopes.get(id);
      if (!envelope) {
        sendJson(response, 404, { errorCode: "ENVELOPE_DOES_NOT_EXIST" });
        return;
      }
      if (tail.join("/") === "documents/combined") {
        if (envelope.status !== "completed") {
          sendJson(response, 400, { errorCode: "ENVELOPE_NOT_COMPLETED" });
          return;
        }
        response.writeHead(200, { "content-type": "application/pdf" });
        response.end(executedPdf(id));
        return;
      }
      if (tail.length === 0 && request.method === "GET") {
        sendJson(response, 200, {
          envelopeId: id,
          status: envelope.status,
          ...(envelope.voidedReason ? { voidedReason: envelope.voidedReason } : {}),
          ...(envelope.declinedReason ? { declinedReason: envelope.declinedReason } : {}),
          ...(envelope.completedDateTime ? { completedDateTime: envelope.completedDateTime } : {}),
        });
        return;
      }
      if (tail.length === 0 && request.method === "PUT") {
        const update = JSON.parse((await readBody(request)).toString("utf8"));
        if (update.status !== "voided" || envelope.status !== "sent") {
          sendJson(response, 400, { errorCode: "ENVELOPE_CANNOT_BE_VOIDED" });
          return;
        }
        envelope.status = "voided";
        envelope.voidedReason = update.voidedReason;
        envelope.completedDateTime = new Date().toISOString();
        sendJson(response, 200, { envelopeId: id, status: "voided" });
        return;
      }
    }

    sendJson(response, 404, { errorCode: "ROUTE_NOT_FOUND" });
  }

  const server = createServer((request, response) => {
    handle(request, response).catch((error) => {
      if (response.headersSent) {
        response.end();
        return;
      }
      sendJson(response, error instanceof SyntaxError ? 400 : 500, {
        errorCode: error instanceof SyntaxError ? "INVALID_REQUEST" : "STUB_FAILED",
      });
    });
  });

  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "0.0.0.0", () => {
      server.off("error", reject);
      resolve();
    });
  });

  return {
    integrationKey,
    webhookSecret,
    accountName: ACCOUNT_NAME,
    /** The ids it has minted, oldest first. */
    ids: () => [...envelopes.keys()],
    /**
     * The id of the envelope sent under one subject line.
     *
     * The provider's own id is the only handle a Connect delivery has,
     * and OpenLaw does not put it on the wire. The subject, which both
     * ends can see, is what ties one to the other. The seed makes it
     * unique by putting the contract's reference in it.
     */
    idBySubject(subject) {
      for (const [id, envelope] of envelopes) {
        if (envelope.emailSubject === subject) return id;
      }
      return null;
    },
    /** Signs the envelope, as its last signer would. */
    complete(id) {
      const envelope = envelopes.get(id);
      if (!envelope) return;
      envelope.status = "completed";
      envelope.completedDateTime = new Date().toISOString();
    },
    /** Declines it, with the signer's stated reason. */
    decline(id, reason) {
      const envelope = envelopes.get(id);
      if (!envelope) return;
      envelope.status = "declined";
      envelope.declinedReason = reason;
      envelope.completedDateTime = new Date().toISOString();
    },
    /**
     * One Connect delivery, signed the way DocuSign signs one.
     *
     * The bytes come back beside the header because the HMAC is over
     * exactly these bytes; a caller that re-serialized the object would
     * sign one body and post another.
     */
    delivery(id, status, reason) {
      const envelope = envelopes.get(id);
      const body = JSON.stringify({
        event: `envelope-${status}`,
        data: {
          envelopeId: id,
          envelopeSummary: {
            status,
            ...(status === "declined" ? { declinedReason: reason } : {}),
            ...(status === "voided" ? { voidedReason: reason } : {}),
            ...(envelope?.completedDateTime
              ? { completedDateTime: envelope.completedDateTime }
              : {}),
          },
        },
      });
      return {
        body,
        headers: {
          "content-type": "application/json",
          [CONNECT_SIGNATURE_HEADER]: createHmac("sha256", webhookSecret)
            .update(body)
            .digest("base64"),
        },
      };
    },
    close: () => new Promise((resolve) => server.close(() => resolve())),
  };
}

// Run standalone (`node scripts/seed/signing-stub.mjs`) to bring the
// provider back after a seed, so the send, void and completion controls
// work while you review. Turn the connector back on in Settings →
// Signing; the seed leaves it configured but off, because a connector
// pointing at a server nobody is running would only fail.
if (import.meta.url === `file://${process.argv[1]}`) {
  const port = Number(process.env.SEED_SIGNING_PORT ?? 8129);
  const stub = await startSigningStub({ port });
  process.stdout.write(
    `signing stand-in on http://127.0.0.1:${port} as ${stub.accountName}. Ctrl-C to stop.\n`,
  );
}
