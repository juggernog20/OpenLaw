// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The Connect webhook (#247): the envelope's fate coming back to the
 * record, at the HTTP seam, through the real-Postgres harness and the
 * deterministic fake provider.
 *
 * **The gate** — a delivery signed with this install's Connect secret
 * moves the envelope. One that carries no signature, one signed with
 * another secret, one whose body was changed after signing, and one
 * arriving at an install with no connector are each refused 401 and
 * each leave the record exactly as it was. The route is driven
 * directly, as an unauthenticated caller drives it: no cookie, no
 * session, nothing but bytes and a header.
 *
 * **The funnel** — every delivery goes through one status transition,
 * so a replay changes nothing the first one did not. That is asserted
 * on the envelope row and on the activity table, and again with two
 * identical deliveries racing.
 *
 * **The endings** — a signed envelope shows `signed` with the moment it
 * ended; a declined one shows its reason. Both are read back through
 * the record's own envelope route, which is where the row draws from,
 * and both are narrated with no actor, which is what attributes them to
 * the integration rather than to a person.
 *
 * The HMAC arithmetic itself is proved in `lib/signing/docusign.test.ts`
 * against known-good and known-bad fixtures. Nothing here calls
 * DocuSign, and nothing here opens the provider's internals.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  activityLog,
  and,
  asc,
  contractEnvelopes,
  eq,
  inArray,
  signingConnectors,
  users,
} from "@openlaw/db";
import { MAX_ENVELOPE_REASON_LENGTH } from "@openlaw/shared";
import { provisionUser } from "../../auth/instance.js";
import {
  createFakeSigningProvider,
  FAKE_SIGNATURE_HEADER,
  FAKE_VALID_INTEGRATION_KEY,
} from "../../lib/signing/fake.js";
import type { WebhookDelivery } from "../../lib/signing/provider.js";
import {
  signInCookies,
  startHarness,
  TEST_ADMIN as ADMIN,
  type TestHarness,
} from "../../testing/harness.js";

/** The person who sends every envelope here. */
const MEMBER = {
  email: "wh-member@example.com",
  displayName: "Nadia Counsel",
  password: "correct-horse-battery",
} as const;

/** A private key shaped like the one an Administrator pastes. Inert:
 * the body says in words that it is neither a key nor real, and nothing
 * in this suite parses it. */
const RSA_KEY = [
  "-----BEGIN RSA PRIVATE KEY-----",
  "MIIEowIBAAKCAQEAopenlawfixturekeyneverusedanywhereexceptthissuite",
  "-----END RSA PRIVATE KEY-----",
].join("\n"); // NOSONAR — inert fixture, not a credential

const HMAC_SECRET = "connect-hmac-fixture-secret"; // NOSONAR — inert fixture
const WRONG_SECRET = "connect-hmac-fixture-imposter"; // NOSONAR — inert fixture

const CONNECTOR = {
  environment: "demo",
  integrationKey: FAKE_VALID_INTEGRATION_KEY,
  apiUserId: "99999999-8888-7777-6666-555555555555",
  privateKey: RSA_KEY,
  webhookSecret: HMAC_SECRET,
} as const;

const SIGNERS = [
  { name: "Sarah Chen", email: "sarah@meridianbio.example" },
  { name: "J. Malone", email: "j.malone@orioncloud.example" },
] as const;

/** The address the Settings pane tells an Administrator to paste into
 * DocuSign Connect. Written out rather than built, so a change to the
 * path is a failing test here and not a silently dead endpoint. */
const WEBHOOK_URL = "/api/v1/signing/docusign/webhook";

/** An impostor holding the wrong Connect secret. Signs the same bodies
 * the real one does, which is the whole point. */
const IMPOSTOR = createFakeSigningProvider({ webhookSecret: WRONG_SECRET });

let harness: TestHarness;
const cookies = new Map<string, Record<string, string>>();

const as = (fixture: { email: string }): Record<string, string> => {
  const jar = cookies.get(fixture.email);
  expect(jar, fixture.email).toBeDefined();
  return jar!;
};

interface EnvelopeRow {
  id: string;
  status: string;
  reason: string | null;
  completedAt: string | null;
  sentAt: string;
  /** Where this round's executed copy has got to (M15/5). Nothing here
   * is about the copy, but it is on the row and it settles a moment
   * after a `signed` delivery — see {@link settledFetch}. */
  executedFetch: string;
}

beforeAll(async () => {
  harness = await startHarness();
  const setup = await harness.app.inject({
    method: "POST",
    url: "/api/v1/auth/setup",
    payload: ADMIN,
  });
  expect(setup.statusCode, setup.body).toBe(201);
  cookies.set(ADMIN.email, await signInCookies(harness.app, ADMIN.email, ADMIN.password));

  const member = await provisionUser(harness.app.auth, MEMBER);
  await harness.db.update(users).set({ role: "legal_team_member" }).where(eq(users.id, member.id));
  cookies.set(MEMBER.email, await signInCookies(harness.app, MEMBER.email, MEMBER.password));

  const saved = await harness.app.inject({
    method: "PUT",
    url: "/api/v1/signing-connectors/docusign",
    cookies: as(ADMIN),
    payload: CONNECTOR,
  });
  expect(saved.statusCode, saved.body).toBe(200);
});

afterAll(async () => {
  await harness.stop();
});

/** The `nda` seed type, which every contract here is created as. */
async function ndaTypeId(): Promise<string> {
  const res = await harness.app.inject({
    method: "GET",
    url: "/api/v1/contracts/options",
    cookies: as(ADMIN),
  });
  expect(res.statusCode, res.body).toBe(200);
  const nda = (res.json().contractTypes as { id: string; slug: string }[]).find(
    (row) => row.slug === "nda",
  );
  expect(nda, "the nda seed type").toBeDefined();
  return nda!.id;
}

const BOUNDARY = "openlaw-test-boundary-776562";

/** One upload, as `multipart/form-data`. The route reads `kind` before
 * the file, so the order the parts are written in matters. */
function uploadBody(filename: string, content: Buffer) {
  const chunks = [
    Buffer.from(`--${BOUNDARY}\r\ncontent-disposition: form-data; name="kind"\r\n\r\n`),
    Buffer.from("draft_ours"),
    Buffer.from(`\r\n--${BOUNDARY}\r\n`),
    Buffer.from(
      `content-disposition: form-data; name="file"; filename="${filename}"\r\n` +
        "content-type: application/pdf\r\n\r\n",
    ),
    content,
    Buffer.from(`\r\n--${BOUNDARY}--\r\n`),
  ];
  return {
    payload: Buffer.concat(chunks),
    headers: { "content-type": `multipart/form-data; boundary=${BOUNDARY}` },
  };
}

/** One record with paper on it and an envelope out — the state every
 * delivery in this suite arrives into. */
async function recordWithEnvelopeOut(title: string): Promise<{
  contractId: string;
  number: number;
  providerEnvelopeId: string;
}> {
  const created = await harness.app.inject({
    method: "POST",
    url: "/api/v1/contracts",
    cookies: as(MEMBER),
    payload: { title, contractTypeId: await ndaTypeId() },
  });
  expect(created.statusCode, created.body).toBe(201);
  const contract = created.json().contract as { id: string; number: number };

  const upload = uploadBody("draft.pdf", Buffer.from(`%PDF-1.7 ${title}`, "utf8"));
  const paper = await harness.app.inject({
    method: "POST",
    url: `/api/v1/contracts/${String(contract.number)}/documents`,
    cookies: as(MEMBER),
    headers: upload.headers,
    payload: upload.payload,
  });
  expect(paper.statusCode, paper.body).toBe(201);

  // The version to send is read from the signing route itself, because
  // that is the chain the send dialog offers and the send refuses
  // anything outside it.
  const offered = await harness.app.inject({
    method: "GET",
    url: `/api/v1/contracts/${String(contract.number)}/envelopes`,
    cookies: as(MEMBER),
  });
  expect(offered.statusCode, offered.body).toBe(200);
  const chain = (offered.json().primaryDocument as { versions: { id: string }[] }).versions;
  const versionId = chain[0]!.id;

  const sent = await harness.app.inject({
    method: "POST",
    url: `/api/v1/contracts/${String(contract.number)}/envelopes`,
    cookies: as(MEMBER),
    payload: { documentVersionId: versionId, signers: [...SIGNERS] },
  });
  expect(sent.statusCode, sent.body).toBe(201);

  const [row] = await harness.db
    .select({ providerEnvelopeId: contractEnvelopes.providerEnvelopeId })
    .from(contractEnvelopes)
    .where(eq(contractEnvelopes.contractId, contract.id));
  expect(row, "the envelope this send wrote").toBeDefined();
  return {
    contractId: contract.id,
    number: contract.number,
    providerEnvelopeId: row!.providerEnvelopeId,
  };
}

/** The fake this app resolved. Non-null once a request has resolved the
 * configured connector, which the send above always has. */
function provider() {
  expect(harness.signing, "the harness's fake provider").not.toBeNull();
  return harness.signing!;
}

/** Pushes one delivery at the route, signed by this install's own
 * Connect secret, exactly as the provider would: no cookie, no session,
 * bytes and a header. */
function deliver(delivery: WebhookDelivery) {
  const signed = provider().signedDelivery(delivery);
  return harness.app.inject({
    method: "POST",
    url: WEBHOOK_URL,
    headers: {
      "content-type": "application/json",
      [FAKE_SIGNATURE_HEADER]: signed.headers[FAKE_SIGNATURE_HEADER]!,
    },
    payload: signed.body,
  });
}

/** The envelope as the record's own route answers it — the shape the
 * card's row draws from. */
async function envelopeOn(number: number): Promise<EnvelopeRow> {
  const res = await harness.app.inject({
    method: "GET",
    url: `/api/v1/contracts/${String(number)}/envelopes`,
    cookies: as(MEMBER),
  });
  expect(res.statusCode, res.body).toBe(200);
  const rows = res.json().envelopes as EnvelopeRow[];
  expect(rows, "one envelope on the record").toHaveLength(1);
  return rows[0]!;
}

/**
 * Waits until the executed-copy fetch a `signed` delivery set going has
 * settled (M15/5).
 *
 * The fetch runs on the pipeline, so it lands on the row a moment after
 * the delivery is acknowledged. Nothing in this suite is about the
 * copy — it is about the transition — but a snapshot of the row taken
 * while the fetch is still running would not be the row a moment later.
 * Waiting for it is what makes "nothing changed" a fact rather than a
 * race.
 */
async function settledFetch(number: number): Promise<EnvelopeRow> {
  const deadline = Date.now() + 20_000;
  let last: EnvelopeRow | undefined;
  while (Date.now() < deadline) {
    last = await envelopeOn(number);
    if (last.executedFetch !== "pending") return last;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`the executed copy was still owed: ${JSON.stringify(last)}`);
}

/** Every envelope entry on one contract, oldest first. */
const entriesOn = (contractId: string) =>
  harness.db
    .select()
    .from(activityLog)
    .where(
      and(
        eq(activityLog.entityId, contractId),
        inArray(activityLog.action, [
          "envelope.sent",
          "envelope.signed",
          "envelope.declined",
          "envelope.voided",
        ]),
      ),
    )
    .orderBy(asc(activityLog.createdAt), asc(activityLog.id));

describe("a delivery the install can believe", () => {
  it("moves an envelope to signed, with the moment the provider says it ended", async () => {
    const record = await recordWithEnvelopeOut("Signed by webhook");
    const endedAt = new Date("2026-08-14T09:30:00.000Z");

    const res = await deliver({
      providerEnvelopeId: record.providerEnvelopeId,
      status: "signed",
      completedAt: endedAt,
    });
    expect(res.statusCode, res.body).toBe(204);

    const envelope = await envelopeOn(record.number);
    expect(envelope.status).toBe("signed");
    expect(envelope.completedAt).toBe(endedAt.toISOString());
    // A signed envelope ended with no words, and the record does not
    // invent any.
    expect(envelope.reason).toBeNull();
  });

  it("narrates the signature with no actor, so the feed reads it as the integration", async () => {
    const record = await recordWithEnvelopeOut("Narrated signature");
    await deliver({ providerEnvelopeId: record.providerEnvelopeId, status: "signed" });

    const entries = await entriesOn(record.contractId);
    expect(entries.map((entry) => entry.action)).toEqual(["envelope.sent", "envelope.signed"]);
    const signed = entries[1]!;
    expect(signed.actorId).toBeNull();
    expect(signed.visibility).toBe("working_team");
    expect(signed.payload).toMatchObject({
      providerEnvelopeId: record.providerEnvelopeId,
      provider: "docusign",
      status: "signed",
    });
  });

  it("keeps a decline's reason on the record and narrates it", async () => {
    const record = await recordWithEnvelopeOut("Declined by webhook");
    const reason = "The indemnity cap is wrong.";

    const res = await deliver({
      providerEnvelopeId: record.providerEnvelopeId,
      status: "declined",
      reason,
    });
    expect(res.statusCode, res.body).toBe(204);

    const envelope = await envelopeOn(record.number);
    expect(envelope.status).toBe("declined");
    expect(envelope.reason).toBe(reason);
    expect(envelope.completedAt).not.toBeNull();

    const entries = await entriesOn(record.contractId);
    expect(entries.map((entry) => entry.action)).toEqual(["envelope.sent", "envelope.declined"]);
    expect(entries[1]!.actorId).toBeNull();
    expect(entries[1]!.payload).toMatchObject({ reason });
  });

  it("bounds a reason, so one cell cannot be made unreadable", async () => {
    const record = await recordWithEnvelopeOut("Long-winded decline");
    await deliver({
      providerEnvelopeId: record.providerEnvelopeId,
      status: "declined",
      reason: "no ".repeat(MAX_ENVELOPE_REASON_LENGTH),
    });

    const envelope = await envelopeOn(record.number);
    expect(envelope.reason).toHaveLength(MAX_ENVELOPE_REASON_LENGTH);
  });

  it("drops whole a character the bound would cut in half", async () => {
    const record = await recordWithEnvelopeOut("Astral decline");
    // The last character is an astral one — two UTF-16 units — placed
    // so the bound falls between its halves. Half a character is not a
    // character, and a stranded half would store as U+FFFD.
    await deliver({
      providerEnvelopeId: record.providerEnvelopeId,
      status: "declined",
      reason: "x".repeat(MAX_ENVELOPE_REASON_LENGTH - 1) + "\u{1F4B0}",
    });

    const envelope = await envelopeOn(record.number);
    expect(envelope.reason).toBe("x".repeat(MAX_ENVELOPE_REASON_LENGTH - 1));
  });

  it("stamps the moment we were told when the provider names no date", async () => {
    const record = await recordWithEnvelopeOut("Undated ending");
    const before = Date.now();

    await deliver({ providerEnvelopeId: record.providerEnvelopeId, status: "signed" });

    const envelope = await envelopeOn(record.number);
    expect(envelope.completedAt).not.toBeNull();
    expect(new Date(envelope.completedAt!).getTime()).toBeGreaterThanOrEqual(before - 1000);
  });
});

describe("a delivery the install cannot believe", () => {
  it("refuses one carrying no signature at all", async () => {
    const record = await recordWithEnvelopeOut("Unsigned delivery");
    const res = await harness.app.inject({
      method: "POST",
      url: WEBHOOK_URL,
      headers: { "content-type": "application/json" },
      payload: JSON.stringify({
        providerEnvelopeId: record.providerEnvelopeId,
        status: "signed",
      }),
    });

    expect(res.statusCode).toBe(401);
    expect((await envelopeOn(record.number)).status).toBe("sent");
    expect(await entriesOn(record.contractId)).toHaveLength(1);
  });

  it("refuses one signed with another secret", async () => {
    const record = await recordWithEnvelopeOut("Forged delivery");
    const forged = IMPOSTOR.signedDelivery({
      providerEnvelopeId: record.providerEnvelopeId,
      status: "signed",
    });

    const res = await harness.app.inject({
      method: "POST",
      url: WEBHOOK_URL,
      headers: {
        "content-type": "application/json",
        [FAKE_SIGNATURE_HEADER]: forged.headers[FAKE_SIGNATURE_HEADER]!,
      },
      payload: forged.body,
    });

    expect(res.statusCode).toBe(401);
    expect((await envelopeOn(record.number)).status).toBe("sent");
  });

  it("refuses one whose body changed after it was signed", async () => {
    const record = await recordWithEnvelopeOut("Tampered delivery");
    const signed = provider().signedDelivery({
      providerEnvelopeId: record.providerEnvelopeId,
      status: "declined",
    });

    const res = await harness.app.inject({
      method: "POST",
      url: WEBHOOK_URL,
      headers: {
        "content-type": "application/json",
        [FAKE_SIGNATURE_HEADER]: signed.headers[FAKE_SIGNATURE_HEADER]!,
      },
      payload: signed.body.replace('"declined"', '"signed"'),
    });

    expect(res.statusCode).toBe(401);
    expect((await envelopeOn(record.number)).status).toBe("sent");
  });

  it("refuses a correctly-signed body that is not an envelope event", async () => {
    const record = await recordWithEnvelopeOut("Nonsense delivery");
    const signed = provider().signedDelivery({ hello: "world" } as never);

    const res = await harness.app.inject({
      method: "POST",
      url: WEBHOOK_URL,
      headers: {
        "content-type": "application/json",
        [FAKE_SIGNATURE_HEADER]: signed.headers[FAKE_SIGNATURE_HEADER]!,
      },
      payload: signed.body,
    });

    // The same answer a forged delivery gets, on purpose: telling a
    // caller they got the signature right would tell an attacker too.
    expect(res.statusCode).toBe(401);
    expect((await envelopeOn(record.number)).status).toBe("sent");
  });

  it("answers no webhook for a provider this install has no adapter for", async () => {
    const res = await harness.app.inject({
      method: "POST",
      url: "/api/v1/signing/documenso/webhook",
      headers: { "content-type": "application/json" },
      payload: "{}",
    });
    expect(res.statusCode).toBe(404);
  });

  it("believes nothing at an install with no connector to verify against", async () => {
    const record = await recordWithEnvelopeOut("Connector taken away");
    const signed = provider().signedDelivery({
      providerEnvelopeId: record.providerEnvelopeId,
      status: "signed",
    });
    // The one adapter's row, not the table: an install that never
    // configured DocuSign is what this test is about, and clearing
    // whatever else a future adapter has stored is not.
    await harness.db.delete(signingConnectors).where(eq(signingConnectors.provider, "docusign"));
    try {
      const res = await harness.app.inject({
        method: "POST",
        url: WEBHOOK_URL,
        headers: {
          "content-type": "application/json",
          [FAKE_SIGNATURE_HEADER]: signed.headers[FAKE_SIGNATURE_HEADER]!,
        },
        payload: signed.body,
      });
      // The same 401 a forged delivery gets. There is no secret, so
      // nothing here is signed by this install's Connect key — and a
      // different answer would tell a caller whether an install is
      // configured at all.
      expect(res.statusCode).toBe(401);
    } finally {
      const saved = await harness.app.inject({
        method: "PUT",
        url: "/api/v1/signing-connectors/docusign",
        cookies: as(ADMIN),
        payload: CONNECTOR,
      });
      expect(saved.statusCode, saved.body).toBe(200);
    }
    expect((await envelopeOn(record.number)).status).toBe("sent");
  });
});

describe("a delivery about an envelope the record has finished with", () => {
  it("ignores one naming an envelope this install does not hold", async () => {
    const res = await deliver({ providerEnvelopeId: "fake-envelope-9999", status: "signed" });
    // Acknowledged, not refused: refusing would make our own log the
    // provider's retry queue.
    expect(res.statusCode, res.body).toBe(204);
  });

  it("changes nothing on a replay of a delivery already applied", async () => {
    const record = await recordWithEnvelopeOut("Replayed delivery");
    const delivery: WebhookDelivery = {
      providerEnvelopeId: record.providerEnvelopeId,
      status: "declined",
      reason: "Wrong counterparty entity.",
    };

    expect((await deliver(delivery)).statusCode).toBe(204);
    const first = await envelopeOn(record.number);
    expect((await deliver(delivery)).statusCode).toBe(204);
    const second = await envelopeOn(record.number);

    expect(second).toEqual(first);
    const entries = await entriesOn(record.contractId);
    expect(entries.map((entry) => entry.action)).toEqual(["envelope.sent", "envelope.declined"]);
  });

  it("leaves an ending alone when a later delivery reports another one", async () => {
    const record = await recordWithEnvelopeOut("Contradicted ending");
    await deliver({ providerEnvelopeId: record.providerEnvelopeId, status: "signed" });
    const ended = await settledFetch(record.number);

    const res = await deliver({
      providerEnvelopeId: record.providerEnvelopeId,
      status: "voided",
      reason: "Too late.",
    });

    expect(res.statusCode, res.body).toBe(204);
    expect(await envelopeOn(record.number)).toEqual(ended);
    expect((await entriesOn(record.contractId)).map((entry) => entry.action)).toEqual([
      "envelope.sent",
      "envelope.signed",
    ]);
  });

  it("does not drag a finished envelope back out for signature", async () => {
    const record = await recordWithEnvelopeOut("Late sent delivery");
    await deliver({ providerEnvelopeId: record.providerEnvelopeId, status: "signed" });

    await deliver({ providerEnvelopeId: record.providerEnvelopeId, status: "sent" });

    expect((await envelopeOn(record.number)).status).toBe("signed");
  });

  it("writes nothing for a delivery repeating the status the row already holds", async () => {
    const record = await recordWithEnvelopeOut("Delivered, not signed");

    const res = await deliver({ providerEnvelopeId: record.providerEnvelopeId, status: "sent" });

    expect(res.statusCode, res.body).toBe(204);
    expect((await envelopeOn(record.number)).status).toBe("sent");
    expect(await entriesOn(record.contractId)).toHaveLength(1);
  });

  it("lets two identical deliveries race and still narrates the ending once", async () => {
    const record = await recordWithEnvelopeOut("Racing deliveries");
    const delivery: WebhookDelivery = {
      providerEnvelopeId: record.providerEnvelopeId,
      status: "signed",
    };

    const [first, second] = await Promise.all([deliver(delivery), deliver(delivery)]);

    expect(first.statusCode).toBe(204);
    expect(second.statusCode).toBe(204);
    expect((await envelopeOn(record.number)).status).toBe("signed");
    expect((await entriesOn(record.contractId)).map((entry) => entry.action)).toEqual([
      "envelope.sent",
      "envelope.signed",
    ]);
  });
});
