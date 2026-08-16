// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The signing stand-in the M15 demo runs against (CTR-013, TECH-013).
 *
 * The suite runs on the built Compose stack (TECH-018), so it cannot
 * inject the API's own deterministic fake provider: the container
 * resolves its driver for itself from the stored connector. What the
 * dev/E2E overlay does instead is point that driver at this server —
 * `DOCUSIGN_BASE_URL` plus `SIGNING_STANDIN` on both the app and the
 * worker, and either one alone stops the boot — so the whole
 * production path runs, the real DocuSign driver included, and no test
 * send can reach a real DocuSign account.
 *
 * It speaks DocuSign's own shapes, on the same handful of calls the
 * driver makes: the JWT grant, userinfo, and the four envelope calls.
 * It is not a claim about DocuSign's behaviour beyond those shapes, and
 * it is deliberately the same stand-in the driver's own suite runs
 * against — one description of the counterpart, in two places that
 * cannot afford to disagree.
 *
 * It is **scriptable**, which is the whole reason it lives in the
 * suite's process: a demo completes or declines an envelope on demand
 * instead of waiting for somebody to sign one.
 *
 * It listens on every interface, because the containers reach it as
 * `host.docker.internal` (the overlay maps the name to the host
 * gateway). The port is fixed rather than ephemeral: the stack is
 * brought up before the suite starts, so both ends have to agree on it
 * in advance.
 */

import { createHmac } from "node:crypto";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";

/**
 * Where the stand-in listens, matching the overlay's own default. The
 * local runner passes both halves from one variable so the stack and
 * the suite cannot disagree (e2e/scripts/local-stack.sh).
 *
 * A value that is not a port is refused here rather than at `listen`:
 * the containers were told an address before the suite started, and a
 * suite that listened somewhere else would fail as a signing outage
 * ten minutes later instead of as the typo it is.
 */
export const SIGNING_STUB_PORT = ((): number => {
  const named = process.env.E2E_SIGNING_STUB_PORT?.trim();
  if (!named) return 8129;
  const port = Number(named);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error(`E2E_SIGNING_STUB_PORT must be a TCP port number, not ${named}.`);
  }
  return port;
})();

/** The account the credentials reach. Fixed, so the demo states the
 * name the pane must print rather than reading one back. */
export const STUB_ACCOUNT_ID = "e2e-account-0001";
export const STUB_ACCOUNT_NAME = "OpenLaw E2E Signing";
export const STUB_USER_EMAIL = "integration@openlaw.example";

/** The header DocuSign Connect signs each delivery with. */
export const CONNECT_SIGNATURE_HEADER = "x-docusign-signature-1";

/** One envelope the stand-in is holding, in DocuSign's own vocabulary
 * — `completed` is what DocuSign calls a signed envelope. */
interface StubEnvelope {
  status: "sent" | "completed" | "declined" | "voided";
  signers: { name: string; email: string }[];
  emailSubject: string;
  /** The bytes that were sent, so the demo can prove the round it
   * picked is the round that went out. */
  document: Buffer;
  voidedReason?: string;
  declinedReason?: string;
  completedDateTime?: string;
}

/** What one Connect delivery says. */
export interface Delivery {
  providerEnvelopeId: string;
  status: "sent" | "completed" | "declined" | "voided";
  reason?: string;
  completedAt?: string;
}

/** Reads a whole request body. */
async function readBody(request: IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(Buffer.from(chunk as Buffer));
  return Buffer.concat(chunks);
}

/** Answers JSON with a status. */
function sendJson(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, { "content-type": "application/json" });
  response.end(JSON.stringify(body));
}

/** One JWT assertion's claim set, decoded without verifying it. The
 * signature is the driver's own business and is proved in the driver's
 * suite; what this server needs from the assertion is who is asking. */
function assertionClaims(assertion: string): { iss?: string; sub?: string } {
  const payload = assertion.split(".")[1];
  if (!payload) return {};
  try {
    return JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as {
      iss?: string;
      sub?: string;
    };
  } catch {
    return {};
  }
}

/** The executed PDF the stand-in answers for one envelope. Real enough
 * to be a PDF and marked with the envelope it belongs to, so the demo
 * can prove the file on the chain is the file that came back. */
export function stubExecutedPdf(providerEnvelopeId: string): Buffer {
  return Buffer.from(`%PDF-1.7\n% openlaw-e2e: executed ${providerEnvelopeId}\n%%EOF\n`, "utf8");
}

/**
 * The running stand-in, plus the handles a demo drives it with.
 *
 * The scripting methods are what a signer would otherwise do, and each
 * one is deliberately provider-side only: marking an envelope completed
 * here changes nothing in OpenLaw until the delivery is pushed or the
 * reconciliation sweep asks.
 */
export class SigningStub {
  private readonly server: Server;
  private readonly envelopes = new Map<string, StubEnvelope>();
  private minted = 0;
  /** What this instance's envelope ids start with. Stamped per run,
   * because a provider envelope id is unique for good: the record holds
   * one row per id whatever became of the contract it was sent from,
   * and an id an earlier run already used would be refused by the
   * index that says so. */
  private readonly idPrefix = `e2e-envelope-${String(Date.now())}`;

  private constructor(
    server: Server,
    /** The integration key the stand-in accepts. Anything else is
     * refused with DocuSign's own `invalid_grant`, so a mistyped
     * credential is a scriptable outcome and not an outage. */
    private readonly integrationKey: string,
    /** The Connect secret its deliveries are signed with. */
    private readonly webhookSecret: string,
  ) {
    this.server = server;
  }

  /** Starts the stand-in on the agreed port. */
  static async start(options: {
    integrationKey: string;
    webhookSecret: string;
    port?: number;
  }): Promise<SigningStub> {
    const server = createServer();
    const stub = new SigningStub(server, options.integrationKey, options.webhookSecret);
    server.on("request", (request, response) => {
      // A throw inside the handler — a body that will not parse — must
      // become an answer, not an unhandled rejection that leaves the
      // driver waiting for a reply that is never written.
      stub.handle(request, response).catch((error: unknown) => {
        if (response.headersSent) {
          response.end();
          return;
        }
        // A body that will not parse is DocuSign's 400, not a failure of
        // this server: the driver has to meet the same answer here that
        // it would meet there. Anything else is the stand-in's own bug
        // and says so.
        if (error instanceof SyntaxError) sendJson(response, 400, { errorCode: "INVALID_REQUEST" });
        else sendJson(response, 500, { errorCode: "STUB_FAILED" });
      });
    });
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(options.port ?? SIGNING_STUB_PORT, "0.0.0.0", resolve);
    });
    return stub;
  }

  /** The port it ended up on. */
  get port(): number {
    return (this.server.address() as AddressInfo).port;
  }

  /** Stops listening. */
  close(): Promise<void> {
    return new Promise<void>((resolve) => this.server.close(() => resolve()));
  }

  // ---- Scripting: what a suite does instead of waiting for a signer ----

  /** The envelope ids it has been sent, oldest first. */
  sentEnvelopeIds(): string[] {
    return [...this.envelopes.keys()];
  }

  /** The people one envelope went to, in the order it carried them. */
  signersOf(providerEnvelopeId: string): { name: string; email: string }[] {
    return this.require(providerEnvelopeId).signers;
  }

  /** The subject line its invitation carried. */
  subjectOf(providerEnvelopeId: string): string {
    return this.require(providerEnvelopeId).emailSubject;
  }

  /** The bytes one envelope carried, so a demo can prove which round
   * went out without opening the record's own storage. */
  documentOf(providerEnvelopeId: string): Buffer {
    return this.require(providerEnvelopeId).document;
  }

  /** Signs the envelope, as its last signer would. */
  complete(providerEnvelopeId: string): void {
    const envelope = this.require(providerEnvelopeId);
    envelope.status = "completed";
    envelope.completedDateTime = new Date().toISOString();
  }

  /** Declines it, with the signer's stated reason. */
  decline(providerEnvelopeId: string, reason: string): void {
    const envelope = this.require(providerEnvelopeId);
    envelope.status = "declined";
    envelope.declinedReason = reason;
    envelope.completedDateTime = new Date().toISOString();
  }

  /** What the record holds for one envelope, in DocuSign's words. */
  statusOf(providerEnvelopeId: string): StubEnvelope["status"] {
    return this.require(providerEnvelopeId).status;
  }

  /**
   * One Connect delivery, in the body shape DocuSign pushes and signed
   * the way DocuSign signs it.
   *
   * The bytes are handed back beside the header, because the HMAC is
   * over exactly these bytes: a caller that re-serialized the object
   * would sign one body and post another.
   */
  signedDelivery(delivery: Delivery): { body: string; headers: Record<string, string> } {
    const body = JSON.stringify({
      event: `envelope-${delivery.status}`,
      data: {
        envelopeId: delivery.providerEnvelopeId,
        envelopeSummary: {
          status: delivery.status,
          ...(delivery.status === "declined" ? { declinedReason: delivery.reason } : {}),
          ...(delivery.status === "voided" ? { voidedReason: delivery.reason } : {}),
          ...(delivery.completedAt === undefined
            ? {}
            : { completedDateTime: delivery.completedAt }),
        },
      },
    });
    return {
      body,
      headers: {
        "content-type": "application/json",
        [CONNECT_SIGNATURE_HEADER]: createHmac("sha256", this.webhookSecret)
          .update(body)
          .digest("base64"),
      },
    };
  }

  private require(providerEnvelopeId: string): StubEnvelope {
    const envelope = this.envelopes.get(providerEnvelopeId);
    if (!envelope) throw new Error(`the signing stand-in holds no envelope ${providerEnvelopeId}`);
    return envelope;
  }

  // ---- The conversation the driver has with it ----

  private async handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const path = new URL(request.url ?? "/", "http://stub.invalid").pathname;

    if (path === "/oauth/token" && request.method === "POST") {
      const form = new URLSearchParams((await readBody(request)).toString("utf8"));
      const claims = assertionClaims(form.get("assertion") ?? "");
      // The credential answer: a wrong integration key is 400
      // invalid_grant, exactly as DocuSign refuses one.
      if (claims.iss !== this.integrationKey) {
        sendJson(response, 400, { error: "invalid_grant" });
        return;
      }
      sendJson(response, 200, {
        access_token: "e2e-access-token",
        token_type: "Bearer",
        expires_in: 3600,
      });
      return;
    }

    if (request.headers.authorization !== "Bearer e2e-access-token") {
      sendJson(response, 401, { error: "unauthorized" });
      return;
    }

    if (path === "/oauth/userinfo") {
      sendJson(response, 200, {
        email: STUB_USER_EMAIL,
        accounts: [
          {
            account_id: STUB_ACCOUNT_ID,
            account_name: STUB_ACCOUNT_NAME,
            // The REST base the driver then addresses envelopes at.
            // This server answers it too, which is what DocuSign does.
            base_uri: `http://host.docker.internal:${String(this.port)}`,
            is_default: true,
          },
        ],
      });
      return;
    }

    const base = `/restapi/v2.1/accounts/${STUB_ACCOUNT_ID}/envelopes`;
    if (path === base && request.method === "POST") {
      const definition = JSON.parse((await readBody(request)).toString("utf8")) as {
        emailSubject?: string;
        documents?: { documentBase64?: string }[];
        recipients?: { signers?: { name?: string; email?: string }[] };
      };
      const signers = definition.recipients?.signers ?? [];
      if (signers.length === 0) {
        sendJson(response, 400, { errorCode: "RECIPIENT_NOT_PROVIDED" });
        return;
      }
      this.minted += 1;
      const id = `${this.idPrefix}-${String(this.minted).padStart(4, "0")}`;
      this.envelopes.set(id, {
        status: "sent",
        signers: signers.map((signer) => ({ name: signer.name ?? "", email: signer.email ?? "" })),
        emailSubject: definition.emailSubject ?? "",
        document: Buffer.from(definition.documents?.[0]?.documentBase64 ?? "", "base64"),
      });
      sendJson(response, 201, { envelopeId: id, status: "sent" });
      return;
    }

    if (path.startsWith(`${base}/`)) {
      const [id, ...tail] = path.slice(base.length + 1).split("/");
      const envelope = this.envelopes.get(decodeURIComponent(id ?? ""));
      if (!envelope) {
        sendJson(response, 404, { errorCode: "ENVELOPE_DOES_NOT_EXIST" });
        return;
      }
      if (tail.join("/") === "documents/combined") {
        // The signed paper plus its certificate of completion — and
        // only once there is one, which is what the driver's own
        // refusal is written against.
        if (envelope.status !== "completed") {
          sendJson(response, 400, { errorCode: "ENVELOPE_NOT_COMPLETED" });
          return;
        }
        response.writeHead(200, { "content-type": "application/pdf" });
        response.end(stubExecutedPdf(decodeURIComponent(id ?? "")));
        return;
      }
      if (tail.length === 0 && request.method === "GET") {
        // The envelope as DocuSign describes one: its state, and
        // nothing about the paper. The bytes it was sent are the
        // stand-in's own record for the demo to read, not part of this
        // answer — DocuSign does not put a document in it either.
        sendJson(response, 200, {
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
        return;
      }
      if (tail.length === 0 && request.method === "PUT") {
        const update = JSON.parse((await readBody(request)).toString("utf8")) as {
          status?: string;
          voidedReason?: string;
        };
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
}
