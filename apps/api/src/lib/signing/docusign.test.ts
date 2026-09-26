// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The DocuSign driver, proved without DocuSign.
 *
 * No test in this file calls DocuSign. Three of the driver's four jobs
 * are arithmetic over their inputs: assembling the JWT assertion,
 * verifying a Connect signature, and mapping payloads. Those are held
 * against known-good fixtures and a decoded assertion. The fourth, the
 * conversation itself, runs against a stub server that speaks
 * DocuSign's shapes. The stub lets the driver take the same shared
 * contract suite the deterministic fake takes, which is the only way to
 * know the two agree.
 */

import { createHmac, createPublicKey, createVerify, generateKeyPairSync } from "node:crypto";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { Readable } from "node:stream";
import { describe, expect, it } from "vitest";
import { describeSigningContract } from "../../testing/signing-contract.js";
import {
  SigningConfigError,
  EnvelopeEditConflictError,
  EnvelopeAccessError,
  EnvelopeNotFoundError,
  SigningRefusedError,
  SigningTimeoutError,
  SigningUnavailableError,
  WebhookSignatureError,
} from "./provider.js";
import {
  buildEnvelopeDefinition,
  buildSenderViewRequest,
  buildJwtAssertion,
  checkedBaseUri,
  createDocuSignProvider,
  mapEnvelopeStatus,
  parseConnectDelivery,
  verifyConnectSignature,
} from "./docusign.js";

/** One RSA key pair for the whole file: generating 2048 bits is slow
 * enough to be worth doing once. */
const KEYS = generateKeyPairSync("rsa", {
  modulusLength: 2048,
  publicKeyEncoding: { type: "spki", format: "pem" },
  privateKeyEncoding: { type: "pkcs8", format: "pem" },
});

const INTEGRATION_KEY = "11111111-2222-3333-4444-555555555555";
const API_USER_ID = "99999999-8888-7777-6666-555555555555";
const WEBHOOK_SECRET = "connect-hmac-secret";
const ACCOUNT_ID = "acct-0001";

/** An assertion split into header, claims, the signed input, and the
 * raw signature, so a test can check each part. */
function decodeAssertion(assertion: string): {
  header: Record<string, unknown>;
  payload: Record<string, unknown>;
  signed: string;
  signature: Buffer;
} {
  const [header, payload, signature] = assertion.split(".");
  return {
    header: JSON.parse(Buffer.from(header!, "base64url").toString("utf8")) as Record<
      string,
      unknown
    >,
    payload: JSON.parse(Buffer.from(payload!, "base64url").toString("utf8")) as Record<
      string,
      unknown
    >,
    signed: `${header}.${payload}`,
    signature: Buffer.from(signature!, "base64url"),
  };
}

describe("the JWT assertion (TECH-013's grant)", () => {
  const NOW = Date.UTC(2026, 7, 16, 9, 0, 0);

  /** The assertion the stored connector produces at a fixed instant. */
  function assertion(overrides: { privateKey?: string } = {}): string {
    return buildJwtAssertion({
      integrationKey: INTEGRATION_KEY,
      apiUserId: API_USER_ID,
      privateKey: overrides.privateKey ?? KEYS.privateKey,
      audience: "account-d.docusign.com",
      now: NOW,
    });
  }

  it("is an RS256 JWT", () => {
    expect(decodeAssertion(assertion()).header).toEqual({ alg: "RS256", typ: "JWT" });
  });

  it("names the integration as issuer and the integration user as subject", () => {
    const { payload } = decodeAssertion(assertion());
    expect(payload.iss).toBe(INTEGRATION_KEY);
    expect(payload.sub).toBe(API_USER_ID);
  });

  it("is addressed to the auth host it will be exchanged at", () => {
    expect(decodeAssertion(assertion()).payload.aud).toBe("account-d.docusign.com");
  });

  it("asks for signature and impersonation, which is what consent grants", () => {
    expect(decodeAssertion(assertion()).payload.scope).toBe("signature impersonation");
  });

  it("is short-lived, so a leaked assertion is nearly worthless", () => {
    const { payload } = decodeAssertion(assertion());
    expect(payload.iat).toBe(Math.floor(NOW / 1000));
    expect(Number(payload.exp) - Number(payload.iat)).toBe(600);
  });

  it("is signed by the stored key", () => {
    const { signed, signature } = decodeAssertion(assertion());
    const verified = createVerify("RSA-SHA256")
      .update(signed)
      .verify(createPublicKey(KEYS.publicKey), signature);
    expect(verified).toBe(true);
  });

  it("refuses a stored key that is not a readable private key", () => {
    expect(() => assertion({ privateKey: "not a key" })).toThrow(SigningConfigError);
  });

  it("refuses a private key that is not RSA", () => {
    const ec = generateKeyPairSync("ec", {
      namedCurve: "prime256v1",
      publicKeyEncoding: { type: "spki", format: "pem" },
      privateKeyEncoding: { type: "pkcs8", format: "pem" },
    });
    expect(() => assertion({ privateKey: ec.privateKey })).toThrow(SigningConfigError);
  });
});

describe("the Connect HMAC check", () => {
  const BODY = Buffer.from('{"event":"envelope-completed"}', "utf8");
  /** The signature DocuSign would send for BODY under WEBHOOK_SECRET. */
  const SIGNATURE = createHmac("sha256", WEBHOOK_SECRET).update(BODY).digest("base64");

  it("accepts the signature the secret produces", () => {
    expect(
      verifyConnectSignature(BODY, { "x-docusign-signature-1": SIGNATURE }, WEBHOOK_SECRET),
    ).toBe(true);
  });

  it("is case-insensitive about the header name, as HTTP is", () => {
    expect(
      verifyConnectSignature(BODY, { "X-DocuSign-Signature-1": SIGNATURE }, WEBHOOK_SECRET),
    ).toBe(true);
  });

  it("accepts a rotation window, where one of several headers matches", () => {
    const headers = {
      "x-docusign-signature-1": createHmac("sha256", "the-old-secret")
        .update(BODY)
        .digest("base64"),
      "x-docusign-signature-2": SIGNATURE,
    };
    expect(verifyConnectSignature(BODY, headers, WEBHOOK_SECRET)).toBe(true);
  });

  it("refuses a body changed after signing", () => {
    const tampered = Buffer.from('{"event":"envelope-voided"}', "utf8");
    expect(
      verifyConnectSignature(tampered, { "x-docusign-signature-1": SIGNATURE }, WEBHOOK_SECRET),
    ).toBe(false);
  });

  it("refuses a signature made with another secret", () => {
    expect(
      verifyConnectSignature(BODY, { "x-docusign-signature-1": SIGNATURE }, "a-different-secret"),
    ).toBe(false);
  });

  it("refuses a delivery carrying no signature header at all", () => {
    expect(
      verifyConnectSignature(BODY, { "content-type": "application/json" }, WEBHOOK_SECRET),
    ).toBe(false);
  });

  it("refuses a signature of the wrong length rather than throwing", () => {
    expect(
      verifyConnectSignature(BODY, { "x-docusign-signature-1": "c2hvcnQ=" }, WEBHOOK_SECRET),
    ).toBe(false);
  });
});

describe("the Connect delivery body", () => {
  /** One Connect envelope event, in DocuSign's own JSON shape. */
  function delivery(summary: Record<string, unknown>): Buffer {
    return Buffer.from(
      JSON.stringify({
        event: "envelope-completed",
        data: { envelopeId: "de305d54-75b4-431b-adb2-eb6b9e546014", envelopeSummary: summary },
      }),
      "utf8",
    );
  }

  it("reduces a completed event to a signed envelope with its date", () => {
    const parsed = parseConnectDelivery(
      delivery({ status: "completed", completedDateTime: "2026-08-16T09:30:00.0000000Z" }),
    );
    expect(parsed.providerEnvelopeId).toBe("de305d54-75b4-431b-adb2-eb6b9e546014");
    expect(parsed.status).toBe("signed");
    expect(parsed.completedAt?.toISOString()).toBe("2026-08-16T09:30:00.000Z");
  });

  it("carries a decline's reason", () => {
    const parsed = parseConnectDelivery(
      delivery({ status: "declined", declinedReason: "Not our paper." }),
    );
    expect(parsed.status).toBe("declined");
    expect(parsed.reason).toBe("Not our paper.");
  });

  it("carries a void's reason", () => {
    const parsed = parseConnectDelivery(
      delivery({ status: "voided", voidedReason: "Superseded by a new draft." }),
    );
    expect(parsed.status).toBe("voided");
    expect(parsed.reason).toBe("Superseded by a new draft.");
  });

  it("reads delivered as still out — nobody has signed yet", () => {
    expect(parseConnectDelivery(delivery({ status: "delivered" })).status).toBe("sent");
  });

  it.each(["created", "deleted"])("acknowledges verified %s without a transition", (status) => {
    expect(parseConnectDelivery(delivery({ status })).status).toBeNull();
  });

  it("keeps DocuSign signed intermediate until completed", () => {
    expect(parseConnectDelivery(delivery({ status: "signed" })).status).toBe("sent");
    expect(mapEnvelopeStatus("signed")).toBe("sent");
  });

  it("refuses a body that is not JSON", () => {
    expect(() => parseConnectDelivery(Buffer.from("<xml/>", "utf8"))).toThrow(
      WebhookSignatureError,
    );
  });

  it("refuses a body that is not an envelope event", () => {
    expect(() => parseConnectDelivery(Buffer.from('{"data":{}}', "utf8"))).toThrow(
      WebhookSignatureError,
    );
  });

  it("refuses a status the record does not track", () => {
    expect(() => parseConnectDelivery(delivery({ status: "unknown" }))).toThrow(
      WebhookSignatureError,
    );
  });

  it("maps every status DocuSign reports onto the four CTR-013 tracks", () => {
    expect(mapEnvelopeStatus("Completed")).toBe("signed");
    expect(mapEnvelopeStatus("sent")).toBe("sent");
    expect(mapEnvelopeStatus("Declined")).toBe("declined");
    expect(mapEnvelopeStatus("voided")).toBe("voided");
    expect(mapEnvelopeStatus("deleted")).toBeUndefined();
  });

  it("answers nothing for a key that only Object.prototype has", () => {
    // A forged delivery must not turn `constructor` into a status.
    expect(mapEnvelopeStatus("constructor")).toBeUndefined();
    expect(mapEnvelopeStatus("toString")).toBeUndefined();
  });

  it("keeps a file name with no extension out of the extension field", () => {
    const definition = buildEnvelopeDefinition(
      {
        document: Readable.from([]),
        fileName: "agreement",
        subject: "Please sign",
        signers: [{ name: "Dana Signer", email: "dana@counterparty.example" }],
      },
      Buffer.from("%PDF-1.7\n", "utf8"),
    );
    expect((definition.documents as { fileExtension: string }[])[0]!.fileExtension).toBe("pdf");
  });
});

describe("the discovered base_uri", () => {
  const TRUSTED = ["http://127.0.0.1:4000"];

  it("accepts DocuSign's own hosts over https and answers the origin", () => {
    expect(checkedBaseUri("https://demo.docusign.net", TRUSTED)).toBe("https://demo.docusign.net");
    expect(checkedBaseUri("https://na3.docusign.net/", TRUSTED)).toBe("https://na3.docusign.net");
    expect(checkedBaseUri("https://eu.docusign.com/restapi", TRUSTED)).toBe(
      "https://eu.docusign.com",
    );
  });

  it("accepts a configured host origin, which is how the stub is reached", () => {
    expect(checkedBaseUri("http://127.0.0.1:4000", TRUSTED)).toBe("http://127.0.0.1:4000");
  });

  it("refuses every other host, a look-alike, plain http, and embedded credentials", () => {
    for (const baseUri of [
      "https://sink.attacker.example",
      "https://docusign.net.attacker.example",
      "https://notdocusign.net",
      "http://demo.docusign.net",
      "https://user:pass@demo.docusign.net", // secretlint-disable-line -- fictional credential-in-URL refusal check
      "not a url",
    ]) {
      expect(() => checkedBaseUri(baseUri, TRUSTED), baseUri).toThrow(SigningConfigError);
    }
  });
});

describe("the envelope payload", () => {
  const definition = buildEnvelopeDefinition(
    {
      document: Readable.from([]),
      fileName: "msa-v5.pdf",
      subject: "Please sign the MSA",
      signers: [
        { name: "Dana Signer", email: "dana@counterparty.example" },
        { name: "Rowan Signer", email: "rowan@counterparty.example" },
      ],
    },
    Buffer.from("%PDF-1.7\n", "utf8"),
  );

  it("creates an interactive draft with a transaction identity and no shared signature anchors", () => {
    const input = {
      document: Readable.from([]),
      fileName: "agreement.pdf",
      subject: "Draft",
      signers: [{ name: "Signer", email: "signer@example.test" }],
      transactionId: "durable-transaction",
    };
    const draft = buildEnvelopeDefinition(input, Buffer.from("paper"), true);
    expect(draft).toMatchObject({
      status: "created",
      transactionId: "durable-transaction",
      emailSubject: "Draft",
      messageLock: "true",
      recipientsLock: "true",
    });
    expect((draft.recipients as { signers: unknown[] }).signers).toEqual([
      { recipientId: "1", routingOrder: "1", name: "Signer", email: "signer@example.test" },
    ]);
    expect(JSON.stringify(draft)).not.toContain("/sig/");
  });

  it("goes out already sent, not as a draft in DocuSign's own console", () => {
    expect(definition.status).toBe("sent");
  });

  it("carries the file, its name, and its extension", () => {
    expect(definition.documents).toEqual([
      {
        documentId: "1",
        name: "msa-v5.pdf",
        fileExtension: "pdf",
        documentBase64: Buffer.from("%PDF-1.7\n", "utf8").toString("base64"),
      },
    ]);
  });

  it("asks every signer at once — v1 has no routing order", () => {
    const signers = (definition.recipients as { signers: { routingOrder: string }[] }).signers;
    expect(signers).toHaveLength(2);
    expect(signers.map((signer) => signer.routingOrder)).toEqual(["1", "1"]);
  });

  it("names each signer with their own recipient id", () => {
    const signers = (definition.recipients as { signers: Record<string, unknown>[] }).signers;
    expect(signers.map((signer) => [signer.recipientId, signer.name, signer.email])).toEqual([
      ["1", "Dana Signer", "dana@counterparty.example"],
      ["2", "Rowan Signer", "rowan@counterparty.example"],
    ]);
  });
});

// ---- The conversation, against a stub that speaks DocuSign's shapes ----

/** What the stub is holding, in DocuSign's own vocabulary. */
interface StubEnvelope {
  transactionId?: string;
  status: "created" | "sent" | "signed" | "completed" | "declined" | "voided";
  workflow?: { scheduledSending: { status: string; resumeDate?: string } };
  folders?: { type: string }[];
  sentDateTime?: string;
  refusal?: { status: number; errorCode: string };
  voidedReason?: string;
  declinedReason?: string;
  completedDateTime?: string;
}

/** The stub server plus the handles the contract suite drives it with. */
interface Stub {
  origin: string;
  envelopes: Map<string, StubEnvelope>;
  close: () => Promise<void>;
}

/** Ways a test can make the stub misbehave. */
interface StubOptions {
  lookupResult?: unknown;
  /** What userinfo names as the account's base_uri. Default: the stub itself. */
  baseUri?: string;
  tokenForbidden?: boolean;
  /** Answer the token exchange with a redirect to this path. */
  redirectTokenTo?: string;
  /** Send the executed copy's headers and one chunk, then never finish. */
  stallExecutedCopy?: boolean;
}

async function readBody(request: IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(Buffer.from(chunk as Buffer));
  return Buffer.concat(chunks);
}

function sendJson(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, { "content-type": "application/json" });
  response.end(JSON.stringify(body));
}

/**
 * A stand-in DocuSign: the JWT grant, userinfo, and the four envelope
 * calls, in the shapes and status codes DocuSign uses. It exists so the
 * driver can run the shared contract; it is not a claim about DocuSign's
 * behaviour beyond those shapes.
 */
async function startStub(options: StubOptions = {}): Promise<Stub> {
  const envelopes = new Map<string, StubEnvelope>();
  let minted = 0;
  const stalled: ServerResponse[] = [];
  const server: Server = createServer((request, response) => {
    // A throw inside the handler, such as a body that will not parse or
    // an assertion that will not decode, must become an answer. An
    // unhandled rejection would leave the driver waiting forever.
    const answer = (async () => {
      const url = new URL(request.url ?? "/", "http://stub.invalid");
      const path = url.pathname;

      if (path === "/oauth/token" && request.method === "POST") {
        if (options.tokenForbidden) {
          sendJson(response, 403, { error: "forbidden" });
          return;
        }
        if (options.redirectTokenTo) {
          response.writeHead(307, { location: options.redirectTokenTo });
          response.end();
          return;
        }
        const body = new URLSearchParams((await readBody(request)).toString("utf8"));
        const assertion = body.get("assertion") ?? "";
        const { payload } = decodeAssertion(assertion);
        // The credential answer: a wrong integration key is 400
        // invalid_grant, exactly as DocuSign refuses one.
        if (payload.iss !== INTEGRATION_KEY) {
          sendJson(response, 400, { error: "invalid_grant" });
          return;
        }
        sendJson(response, 200, {
          access_token: "stub-access-token",
          token_type: "Bearer",
          expires_in: 3600,
        });
        return;
      }

      if (request.headers.authorization !== "Bearer stub-access-token") {
        sendJson(response, 401, { error: "unauthorized" });
        return;
      }

      if (path === "/oauth/userinfo") {
        sendJson(response, 200, {
          email: "integration@acme.example",
          accounts: [
            {
              account_id: ACCOUNT_ID,
              account_name: "Acme Inc",
              base_uri:
                options.baseUri ??
                `http://127.0.0.1:${String((server.address() as AddressInfo).port)}`,
              is_default: true,
            },
          ],
        });
        return;
      }

      const base = `/restapi/v2.1/accounts/${ACCOUNT_ID}/envelopes`;
      if (path === base && request.method === "GET") {
        if (options.lookupResult !== undefined) {
          sendJson(response, 200, options.lookupResult);
          return;
        }
        const transactionId = new URL(request.url!, "http://stub").searchParams.get(
          "transaction_ids",
        );
        sendJson(response, 200, {
          envelopes: [...envelopes]
            .filter(([, envelope]) => envelope.transactionId === transactionId)
            .map(([envelopeId, envelope]) => ({ envelopeId, ...envelope })),
        });
        return;
      }
      if (path === base && request.method === "POST") {
        const definition = JSON.parse((await readBody(request)).toString("utf8")) as {
          transactionId?: string;
          recipients?: { signers?: unknown[] };
        };
        if (!definition.recipients?.signers?.length) {
          sendJson(response, 400, { errorCode: "RECIPIENT_NOT_PROVIDED" });
          return;
        }
        minted += 1;
        const id = `stub-envelope-${String(minted).padStart(4, "0")}`;
        envelopes.set(id, {
          ...(definition.transactionId ? { transactionId: definition.transactionId } : {}),
          status: (definition as { status?: string }).status === "created" ? "created" : "sent",
        });
        sendJson(response, 201, { envelopeId: id, status: "sent" });
        return;
      }

      if (path.startsWith(`${base}/`)) {
        const rest = path.slice(base.length + 1);
        const [id, ...tail] = rest.split("/");
        const envelope = envelopes.get(decodeURIComponent(id ?? ""));
        if (!envelope) {
          sendJson(response, 404, { errorCode: "ENVELOPE_DOES_NOT_EXIST" });
          return;
        }
        if (envelope.refusal) {
          sendJson(response, envelope.refusal.status, { errorCode: envelope.refusal.errorCode });
          return;
        }
        if (tail.join("/") === "views/sender" && request.method === "POST") {
          if (envelope.status !== "created") {
            sendJson(response, 400, { errorCode: "ENVELOPE_INVALID_STATUS" });
            return;
          }
          const body = JSON.parse((await readBody(request)).toString("utf8"));
          expect(body).toEqual(buildSenderViewRequest(body.returnUrl));
          sendJson(response, 201, {
            url: `https://demo.docusign.net/opaque?return=${encodeURIComponent(body.returnUrl)}`,
          });
          return;
        }
        if (tail.join("/") === "documents/combined") {
          if (envelope.status !== "completed") {
            sendJson(response, 400, { errorCode: "ENVELOPE_NOT_COMPLETED" });
            return;
          }
          response.writeHead(200, { "content-type": "application/pdf" });
          if (options.stallExecutedCopy) {
            response.write(Buffer.from("%PDF-1.7\n", "utf8"));
            stalled.push(response);
            return;
          }
          response.end(Buffer.from("%PDF-1.7\n% stub executed copy\n%%EOF\n", "utf8"));
          return;
        }
        if (tail.length === 0 && request.method === "GET") {
          sendJson(response, 200, { envelopeId: id, ...envelope });
          return;
        }
        if (tail.length === 0 && request.method === "PUT") {
          const update = JSON.parse((await readBody(request)).toString("utf8")) as {
            status?: string;
            folders?: { type: string }[];
            sentDateTime?: string;
            refusal?: { status: number; errorCode: string };
            voidedReason?: string;
          };
          if (update.status !== "voided" || envelope.status !== "sent") {
            sendJson(response, 400, { errorCode: "ENVELOPE_CANNOT_BE_VOIDED" });
            return;
          }
          envelope.status = "voided";
          envelope.voidedReason = update.voidedReason;
          sendJson(response, 200, { envelopeId: id, status: "voided" });
          return;
        }
      }

      sendJson(response, 404, { errorCode: "ROUTE_NOT_FOUND" });
    })();
    answer.catch(() => {
      if (!response.headersSent) sendJson(response, 500, { errorCode: "STUB_FAILED" });
      else response.end();
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  return {
    origin: `http://127.0.0.1:${String(port)}`,
    envelopes,
    close: () => {
      for (const response of stalled) response.destroy();
      server.closeAllConnections();
      return new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}

describeSigningContract("the DocuSign driver", async () => {
  const stub = await startStub();
  const hosts = { auth: stub.origin, api: stub.origin };
  const config = {
    environment: "demo" as const,
    integrationKey: INTEGRATION_KEY,
    apiUserId: API_USER_ID,
    privateKey: KEYS.privateKey,
    webhookSecret: WEBHOOK_SECRET,
  };
  return {
    adapter: "docusign" as const,
    provider: createDocuSignProvider(config, { hosts }),
    refusingProvider: createDocuSignProvider(
      { ...config, integrationKey: "a-key-docusign-never-issued" },
      { hosts },
    ),
    signDelivery: (delivery) => {
      const body = JSON.stringify({
        event: `envelope-${delivery.status}`,
        data: {
          envelopeId: delivery.providerEnvelopeId,
          envelopeSummary: {
            status: delivery.status === "signed" ? "completed" : delivery.status,
            ...(delivery.reason !== undefined
              ? delivery.status === "voided"
                ? { voidedReason: delivery.reason }
                : { declinedReason: delivery.reason }
              : {}),
          },
        },
      });
      return {
        body,
        headers: {
          "x-docusign-signature-1": createHmac("sha256", WEBHOOK_SECRET)
            .update(body)
            .digest("base64"),
        },
      };
    },
    completeEnvelope: (id) => {
      const envelope = stub.envelopes.get(id);
      if (envelope) {
        envelope.status = "completed";
        envelope.completedDateTime = new Date().toISOString();
      }
    },
    declineEnvelope: (id, reason) => {
      const envelope = stub.envelopes.get(id);
      if (envelope) {
        envelope.status = "declined";
        envelope.declinedReason = reason;
      }
    },
    stop: () => stub.close(),
  };
});

describe("the DocuSign driver's own answers", () => {
  it("reads an unreachable host as transient, so a caller retries", async () => {
    // Port 1 on the loopback refuses immediately. That is an outage,
    // not a configuration fault, and the split is what decides the retry.
    const provider = createDocuSignProvider(
      {
        environment: "demo",
        integrationKey: INTEGRATION_KEY,
        apiUserId: API_USER_ID,
        privateKey: KEYS.privateKey,
        webhookSecret: WEBHOOK_SECRET,
      },
      { hosts: { auth: "http://127.0.0.1:1", api: "http://127.0.0.1:1" } },
    );
    await expect(provider.testConnection()).rejects.toBeInstanceOf(SigningUnavailableError);
  });

  it("verifies a delivery against the connector's own Connect secret", async () => {
    const stub = await startStub();
    try {
      const provider = createDocuSignProvider(
        {
          environment: "demo",
          integrationKey: INTEGRATION_KEY,
          apiUserId: API_USER_ID,
          privateKey: KEYS.privateKey,
          webhookSecret: WEBHOOK_SECRET,
        },
        { hosts: { auth: stub.origin, api: stub.origin } },
      );
      const body = Buffer.from(
        JSON.stringify({
          data: { envelopeId: "e-1", envelopeSummary: { status: "completed" } },
        }),
        "utf8",
      );
      const good = createHmac("sha256", WEBHOOK_SECRET).update(body).digest("base64");
      expect(provider.verifyWebhook(body, { "x-docusign-signature-1": good }).status).toBe(
        "signed",
      );
      const bad = createHmac("sha256", "somebody-elses-secret").update(body).digest("base64");
      expect(() => provider.verifyWebhook(body, { "x-docusign-signature-1": bad })).toThrow(
        WebhookSignatureError,
      );
    } finally {
      await stub.close();
    }
  });

  it("refuses a discovered base_uri outside DocuSign's own hosts", async () => {
    // The userinfo answer names where the bearer token and every
    // document go next. A stub that names another host is a connector
    // that would send them there.
    const stub = await startStub({ baseUri: "https://sink.attacker.example" });
    try {
      const provider = createDocuSignProvider(
        {
          environment: "demo",
          integrationKey: INTEGRATION_KEY,
          apiUserId: API_USER_ID,
          privateKey: KEYS.privateKey,
          webhookSecret: WEBHOOK_SECRET,
        },
        { hosts: { auth: stub.origin, api: stub.origin } },
      );
      await expect(provider.testConnection()).rejects.toThrow(
        "DocuSign named an account base URI outside its own hosts.",
      );
      await expect(provider.testConnection()).rejects.toBeInstanceOf(SigningConfigError);
    } finally {
      await stub.close();
    }
  });

  it("does not follow a redirect with the grant assertion", async () => {
    const stub = await startStub({ redirectTokenTo: "/oauth/token-sink" });
    try {
      const provider = createDocuSignProvider(
        {
          environment: "demo",
          integrationKey: INTEGRATION_KEY,
          apiUserId: API_USER_ID,
          privateKey: KEYS.privateKey,
          webhookSecret: WEBHOOK_SECRET,
        },
        { hosts: { auth: stub.origin, api: stub.origin } },
      );
      await expect(provider.testConnection()).rejects.toBeInstanceOf(SigningUnavailableError);
    } finally {
      await stub.close();
    }
  });

  it("refuses an executed copy larger than the document ceiling", async () => {
    const stub = await startStub();
    try {
      const provider = createDocuSignProvider(
        {
          environment: "demo",
          integrationKey: INTEGRATION_KEY,
          apiUserId: API_USER_ID,
          privateKey: KEYS.privateKey,
          webhookSecret: WEBHOOK_SECRET,
        },
        { hosts: { auth: stub.origin, api: stub.origin }, maxDocumentBytes: 8 },
      );
      const { providerEnvelopeId } = await provider.sendEnvelope({
        document: Readable.from([Buffer.from("%PDF-1.7\n")]),
        fileName: "agreement.pdf",
        subject: "Please sign",
        signers: [{ name: "Dana Signer", email: "dana@counterparty.example" }],
      });
      const envelope = stub.envelopes.get(providerEnvelopeId)!;
      envelope.status = "completed";
      const stream = await provider.fetchExecutedDocument(providerEnvelopeId);
      const read = (async () => {
        for await (const chunk of stream) void chunk;
      })();
      await expect(read).rejects.toBeInstanceOf(SigningRefusedError);
      await expect(read).rejects.toThrow("larger than 8 bytes");
    } finally {
      await stub.close();
    }
  });

  it("times out an executed copy whose socket stops sending mid-stream", async () => {
    const stub = await startStub({ stallExecutedCopy: true });
    try {
      const provider = createDocuSignProvider(
        {
          environment: "demo",
          integrationKey: INTEGRATION_KEY,
          apiUserId: API_USER_ID,
          privateKey: KEYS.privateKey,
          webhookSecret: WEBHOOK_SECRET,
        },
        { hosts: { auth: stub.origin, api: stub.origin }, timeoutMs: 300 },
      );
      const { providerEnvelopeId } = await provider.sendEnvelope({
        document: Readable.from([Buffer.from("%PDF-1.7\n")]),
        fileName: "agreement.pdf",
        subject: "Please sign",
        signers: [{ name: "Dana Signer", email: "dana@counterparty.example" }],
      });
      stub.envelopes.get(providerEnvelopeId)!.status = "completed";
      const stream = await provider.fetchExecutedDocument(providerEnvelopeId);
      const chunks: Buffer[] = [];
      const read = (async () => {
        for await (const chunk of stream) chunks.push(chunk as Buffer);
      })();
      await expect(read).rejects.toBeInstanceOf(SigningTimeoutError);
      // The first chunk arrived before the stall. The deadline kept
      // running after it, which is the whole point.
      expect(Buffer.concat(chunks).toString("utf8")).toBe("%PDF-1.7\n");
    } finally {
      await stub.close();
    }
  });

  it("reads a refusal of a bad request as terminal", async () => {
    const stub = await startStub();
    try {
      const provider = createDocuSignProvider(
        {
          environment: "demo",
          integrationKey: INTEGRATION_KEY,
          apiUserId: API_USER_ID,
          privateKey: KEYS.privateKey,
          webhookSecret: WEBHOOK_SECRET,
        },
        { hosts: { auth: stub.origin, api: stub.origin } },
      );
      await expect(
        provider.sendEnvelope({
          document: Readable.from([Buffer.from("%PDF-1.7\n")]),
          fileName: "agreement.pdf",
          subject: "Please sign",
          signers: [],
        }),
      ).rejects.toBeInstanceOf(SigningRefusedError);
    } finally {
      await stub.close();
    }
  });
});

it("requests envelope-scoped Tagger with documented restrictions and ordinary fields", () => {
  expect(
    buildSenderViewRequest("https://openlaw.example/api/v1/signing/return?state=opaque"),
  ).toEqual({
    viewAccess: "envelope",
    returnUrl: "https://openlaw.example/api/v1/signing/return?state=opaque",
    settings: {
      startingScreen: "Tagger",
      sendButtonAction: "send",
      showBackButton: "false",
      showHeaderActions: "false",
      showDiscardAction: "true",
      recipientSettings: { showEditRecipients: "false" },
      documentSettings: {
        showEditDocuments: "false",
        showEditDocumentVisibility: "false",
        showEditPages: "false",
      },
      taggerSettings: { paletteSections: "default" },
    },
  });
});

describe("resume and native discard through DocuSign HTTP", () => {
  it("keeps a forbidden token exchange distinct from Envelope access", async () => {
    const stub = await startStub({ tokenForbidden: true });
    const provider = createDocuSignProvider(
      {
        environment: "demo",
        integrationKey: INTEGRATION_KEY,
        apiUserId: API_USER_ID,
        privateKey: KEYS.privateKey,
        webhookSecret: WEBHOOK_SECRET,
      },
      { hosts: { auth: stub.origin, api: stub.origin } },
    );
    try {
      await expect(provider.testConnection()).rejects.toBeInstanceOf(SigningConfigError);
    } finally {
      await stub.close();
    }
  });

  it("requires an unsent draft and recyclebin evidence together, never missing or sent", async () => {
    const stub = await startStub();
    const provider = createDocuSignProvider(
      {
        environment: "demo",
        integrationKey: INTEGRATION_KEY,
        apiUserId: API_USER_ID,
        privateKey: KEYS.privateKey,
        webhookSecret: WEBHOOK_SECRET,
      },
      { hosts: { auth: stub.origin, api: stub.origin } },
    );
    try {
      stub.envelopes.set("intermediate", { status: "signed" });
      expect((await provider.readEnvelope("intermediate")).status).toBe("sent");
      for (const status of ["pending", "started"]) {
        stub.envelopes.set("scheduled", {
          status: "created",
          workflow: { scheduledSending: { status } },
        });
        expect(await provider.readEnvelope("scheduled")).toMatchObject({
          status: "draft",
          scheduled: true,
        });
      }
      stub.envelopes.set("scheduled", {
        status: "created",
        workflow: { scheduledSending: { status: "completed" } },
      });
      expect(await provider.readEnvelope("scheduled")).toMatchObject({
        status: "draft",
        scheduled: false,
      });
      stub.envelopes.set("saved", { status: "created" });
      expect((await provider.readEnvelope("saved")).status).toBe("draft");
      stub.envelopes.set("saved", { status: "created", folders: [{ type: "recyclebin" }] });
      expect((await provider.readEnvelope("saved")).status).toBe("discarded");
      stub.envelopes.set("saved", { status: "sent", folders: [{ type: "recyclebin" }] });
      expect((await provider.readEnvelope("saved")).status).toBe("sent");
      stub.envelopes.set("saved", {
        status: "created",
        sentDateTime: new Date().toISOString(),
        folders: [{ type: "recyclebin" }],
      });
      expect((await provider.readEnvelope("saved")).status).toBe("draft");
      await expect(provider.readEnvelope("missing")).rejects.toBeInstanceOf(EnvelopeNotFoundError);
    } finally {
      await stub.close();
    }
  });

  it.each([
    [400, "EDIT_LOCK_ENVELOPE_LOCKED", EnvelopeEditConflictError],
    [400, "ENVELOPE_INVALID_STATUS", EnvelopeEditConflictError],
    [403, "USER_LACKS_PERMISSIONS", EnvelopeAccessError],
    [404, "ENVELOPE_DOES_NOT_EXIST", EnvelopeNotFoundError],
    [503, "SERVICE_UNAVAILABLE", SigningUnavailableError],
  ])("classifies a %s %s launch refusal", async (status, errorCode, errorClass) => {
    const stub = await startStub();
    const provider = createDocuSignProvider(
      {
        environment: "demo",
        integrationKey: INTEGRATION_KEY,
        apiUserId: API_USER_ID,
        privateKey: KEYS.privateKey,
        webhookSecret: WEBHOOK_SECRET,
      },
      { hosts: { auth: stub.origin, api: stub.origin } },
    );
    try {
      stub.envelopes.set("saved", { status: "created", refusal: { status, errorCode } });
      await expect(
        provider.launchEnvelope("saved", "https://openlaw.example/return"),
      ).rejects.toBeInstanceOf(errorClass);
    } finally {
      await stub.close();
    }
  });
});

describe("transaction lookup evidence", () => {
  it.each([
    [
      "mismatched identity",
      { envelopes: [{ envelopeId: "other", transactionId: "other-operation" }] },
    ],
    ["multiple matches", { envelopes: [{ envelopeId: "one" }, { envelopeId: "two" }] }],
    ["missing id", { envelopes: [{}] }],
    ["missing result", {}],
  ])("rejects %s without treating it as noncreation", async (_, lookupResult) => {
    const stub = await startStub({ lookupResult });
    try {
      const provider = createDocuSignProvider(
        {
          environment: "demo",
          integrationKey: INTEGRATION_KEY,
          apiUserId: API_USER_ID,
          privateKey: KEYS.privateKey,
          webhookSecret: WEBHOOK_SECRET,
        },
        { hosts: { auth: stub.origin, api: stub.origin } },
      );
      await expect(provider.findEnvelope("original-operation")).rejects.toBeInstanceOf(
        SigningUnavailableError,
      );
    } finally {
      await stub.close();
    }
  });
});

it("identifies a refused token refresh before the creation POST as confirmed non-submission", async () => {
  const options: StubOptions = {};
  const stub = await startStub(options);
  let now = Date.now();
  try {
    const provider = createDocuSignProvider(
      {
        environment: "demo",
        integrationKey: INTEGRATION_KEY,
        apiUserId: API_USER_ID,
        privateKey: KEYS.privateKey,
        webhookSecret: WEBHOOK_SECRET,
      },
      { hosts: { auth: stub.origin, api: stub.origin }, clock: () => now },
    );
    await provider.testConnection();
    now += 3_600_000;
    options.tokenForbidden = true;
    await expect(
      provider.prepareEnvelope({
        document: Readable.from(["paper"]),
        fileName: "paper.pdf",
        subject: "Original",
        signers: [{ name: "Signer", email: "signer@example.test" }],
        transactionId: "never-submitted",
      }),
    ).rejects.toMatchObject({
      name: "SigningNotSubmittedError",
      cause: { name: "SigningConfigError" },
    });
    expect(stub.envelopes.size).toBe(0);
  } finally {
    await stub.close();
  }
});
