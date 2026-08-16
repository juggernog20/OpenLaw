// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Voiding a live envelope (#248): CTR-013's withdrawal at the HTTP
 * seam, through the real-Postgres harness and the deterministic fake
 * provider.
 *
 * **The act** — the sender, the contract's Owner, or an Administrator
 * withdraws a round that should not have gone out. The provider is told,
 * the row ends as `voided` with the reason the voider typed, and
 * `envelope.voided` is narrated on the contract **with the voider as its
 * actor** — which is what tells the feed a person did this rather than
 * the integration.
 *
 * **The audience** — the approvals-cancellation shape, and nothing
 * wider. A Member+ on the team who neither sent it nor owns the record
 * is refused 403 and the envelope is untouched at the provider, which is
 * what the record's absent control is the drawn half of.
 *
 * **The refusals** — an envelope that has already ended, an archived
 * contract, an install with no connector, an envelope on a record this
 * viewer cannot reach, and a void with no words are each refused, and
 * each in the shape the rest of the record uses.
 *
 * **The round trip** — after a void, and after a decline, the contract
 * sends again. That is the whole point of the one-live-envelope index
 * holding only while an envelope is `sent`, and it is asserted both
 * ways round.
 *
 * Activity is read straight from the table, as the approvals and send
 * suites do. Nothing here opens the provider's internals: the fake is
 * driven, and what it holds is read back through the questions it
 * answers.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  activityLog,
  and,
  asc,
  contractEnvelopes,
  contracts,
  eq,
  inArray,
  signingConnectors,
  users,
} from "@openlaw/db";
import { SIGNING_NOT_CONFIGURED_PROBLEM_TYPE } from "@openlaw/shared";
import { provisionUser } from "../../auth/instance.js";
import { FAKE_SIGNATURE_HEADER, FAKE_VALID_INTEGRATION_KEY } from "../../lib/signing/fake.js";
import type { WebhookDelivery } from "../../lib/signing/provider.js";
import {
  signInCookies,
  startHarness,
  TEST_ADMIN as ADMIN,
  type TestHarness,
} from "../../testing/harness.js";

/** The person who sends every envelope here, and who therefore holds
 * the record's `creator` team row. */
const SENDER = {
  email: "void-sender@example.com",
  displayName: "Nadia Counsel",
  password: "correct-horse-battery",
} as const;
/** CTR-004's Owner — the second of the three actors, and somebody who
 * sent nothing. */
const OWNER = {
  email: "void-owner@example.com",
  displayName: "Omar Owner",
  password: "correct-horse-battery",
} as const;
/** A Member+ on the team who neither sent it nor owns the record. Reach
 * is not the same as standing, and this is the person who proves it. */
const BYSTANDER = {
  email: "void-bystander@example.com",
  displayName: "Bea Bystander",
  password: "correct-horse-battery",
} as const;
/** A Legal Team Member on no record at all. */
const OUTSIDER = {
  email: "void-outsider@example.com",
  displayName: "Otto Outside",
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

const CONNECTOR = {
  environment: "demo",
  integrationKey: FAKE_VALID_INTEGRATION_KEY,
  apiUserId: "99999999-8888-7777-6666-555555555555",
  privateKey: RSA_KEY,
  webhookSecret: HMAC_SECRET,
} as const;

const WEBHOOK_URL = "/api/v1/signing/docusign/webhook";

/** The two signers every send here names. */
const SIGNERS = [
  { name: "Sarah Chen", email: "sarah@meridianbio.example" },
  { name: "J. Malone", email: "j.malone@orioncloud.example" },
] as const;

/** The words a void carries. Stated once, so the row, the provider, and
 * the activity entry are all asserted against the same sentence. */
const REASON = "We sent the wrong redline.";

let harness: TestHarness;
const cookies = new Map<string, Record<string, string>>();
const userIds = new Map<string, string>();

const idOf = (fixture: { email: string }): string => {
  const id = userIds.get(fixture.email);
  expect(id, fixture.email).toBeDefined();
  return id!;
};
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
}

beforeAll(async () => {
  harness = await startHarness();
  const setup = await harness.app.inject({
    method: "POST",
    url: "/api/v1/auth/setup",
    payload: ADMIN,
  });
  expect(setup.statusCode, setup.body).toBe(201);
  const [admin] = await harness.db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.email, ADMIN.email));
  userIds.set(ADMIN.email, admin!.id);
  cookies.set(ADMIN.email, await signInCookies(harness.app, ADMIN.email, ADMIN.password));

  for (const fixture of [SENDER, OWNER, BYSTANDER, OUTSIDER]) {
    const user = await provisionUser(harness.app.auth, fixture);
    await harness.db.update(users).set({ role: "legal_team_member" }).where(eq(users.id, user.id));
    userIds.set(fixture.email, user.id);
    cookies.set(fixture.email, await signInCookies(harness.app, fixture.email, fixture.password));
  }
  await configureConnector();
}, 120_000);

afterAll(async () => {
  await harness.stop();
});

/** Saves the connector, so the resolver answers a provider. */
async function configureConnector(): Promise<void> {
  const res = await harness.app.inject({
    method: "PUT",
    url: "/api/v1/signing-connectors/docusign",
    cookies: as(ADMIN),
    payload: CONNECTOR,
  });
  expect(res.statusCode, res.body).toBe(200);
}

/** Takes the connector away, which is what an install that never
 * configured one looks like. */
const clearConnector = () => harness.db.delete(signingConnectors);

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

const BOUNDARY = "openlaw-void-boundary-766f6964";

/** One upload, as `multipart/form-data`. Built by hand, as the
 * documents suite builds its own: the route reads `kind` before the
 * file, so the order the parts are written in matters. */
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

/** One record with paper on it, made by the sender. */
async function recordWithPaper(title: string): Promise<{ id: string; number: number }> {
  const created = await harness.app.inject({
    method: "POST",
    url: "/api/v1/contracts",
    cookies: as(SENDER),
    payload: { title, contractTypeId: await ndaTypeId() },
  });
  expect(created.statusCode, created.body).toBe(201);
  const contract = created.json().contract as { id: string; number: number };

  const upload = uploadBody("draft.pdf", Buffer.from(`%PDF-1.7 ${title}`, "utf8"));
  const paper = await harness.app.inject({
    method: "POST",
    url: `/api/v1/contracts/${String(contract.number)}/documents`,
    cookies: as(SENDER),
    headers: upload.headers,
    payload: upload.payload,
  });
  expect(paper.statusCode, paper.body).toBe(201);
  return contract;
}

/** The signing state of one record, requiring success. */
async function signingState(jar: Record<string, string>, number: number) {
  const res = await harness.app.inject({
    method: "GET",
    url: `/api/v1/contracts/${String(number)}/envelopes`,
    cookies: jar,
  });
  expect(res.statusCode, res.body).toBe(200);
  return res.json() as {
    envelopes: EnvelopeRow[];
    signingConfigured: boolean;
    primaryDocument: { versions: { id: string }[] } | null;
  };
}

/** Sends the record's current round, and answers the envelope it wrote.
 * Every void in this suite starts from one of these. */
async function sendFrom(number: number): Promise<EnvelopeRow> {
  const state = await signingState(as(SENDER), number);
  const versionId = state.primaryDocument!.versions[0]!.id;
  const sent = await harness.app.inject({
    method: "POST",
    url: `/api/v1/contracts/${String(number)}/envelopes`,
    cookies: as(SENDER),
    payload: { documentVersionId: versionId, signers: [...SIGNERS] },
  });
  expect(sent.statusCode, sent.body).toBe(201);
  const rows = (sent.json() as { envelopes: EnvelopeRow[] }).envelopes;
  expect(rows[0], "the envelope this send wrote").toBeDefined();
  return rows[0]!;
}

/** A record with paper on it and one envelope out — the state every
 * void in this suite arrives into. */
async function recordWithEnvelopeOut(
  title: string,
): Promise<{ id: string; number: number; envelope: EnvelopeRow }> {
  const contract = await recordWithPaper(title);
  return { ...contract, envelope: await sendFrom(contract.number) };
}

/** The withdrawal itself. The whole body is the argument rather than
 * the reason inside it, so a request that carries no reason at all can
 * be made as plainly as one that carries a blank one. */
const voidEnvelope = (
  jar: Record<string, string>,
  envelopeId: string,
  body: Record<string, unknown> = { reason: REASON },
) =>
  harness.app.inject({
    method: "POST",
    url: `/api/v1/envelopes/${envelopeId}/void`,
    cookies: jar,
    payload: body,
  });

/** The provider's own id for one of our envelope rows — the correlation
 * key, read from the record rather than guessed. */
async function providerIdOf(envelopeId: string): Promise<string> {
  const [row] = await harness.db
    .select({ providerEnvelopeId: contractEnvelopes.providerEnvelopeId })
    .from(contractEnvelopes)
    .where(eq(contractEnvelopes.id, envelopeId));
  expect(row, "the envelope row").toBeDefined();
  return row!.providerEnvelopeId;
}

/** The fake this app resolved. Non-null once a request has resolved the
 * configured connector, which the send above always has. */
function provider() {
  expect(harness.signing, "the harness's fake provider").not.toBeNull();
  return harness.signing!;
}

/** Pushes one delivery at the webhook route, signed by this install's
 * own Connect secret — how a decline reaches the record. */
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

/** Makes somebody the contract's Owner (CTR-004). */
const makeOwner = (number: number, userId: string) =>
  harness.app.inject({
    method: "PATCH",
    url: `/api/v1/contracts/${String(number)}`,
    cookies: as(SENDER),
    payload: { managerId: userId },
  });

/** Puts somebody on a contract's team, which is what grants them
 * reach. */
const addToTeam = (number: number, userId: string) =>
  harness.app.inject({
    method: "POST",
    url: `/api/v1/contracts/${String(number)}/team`,
    cookies: as(SENDER),
    payload: { userId, role: "member" },
  });

/** Walls a record off straight in the column: a fixture that makes a
 * record confidential is not the subject of a void test. */
const wallOff = (contractId: string) =>
  harness.db.update(contracts).set({ isConfidential: true }).where(eq(contracts.id, contractId));

describe("the sender withdrawing their own send", () => {
  let contract: { id: string; number: number };
  let envelope: EnvelopeRow;
  let providerEnvelopeId: string;

  beforeAll(async () => {
    const record = await recordWithEnvelopeOut("Orion Cloud master services agreement");
    contract = { id: record.id, number: record.number };
    envelope = record.envelope;
    providerEnvelopeId = await providerIdOf(envelope.id);
  });

  it("ends the row with the reason, and the moment it ended", async () => {
    const res = await voidEnvelope(as(SENDER), envelope.id);
    expect(res.statusCode, res.body).toBe(200);

    const rows = (res.json() as { envelopes: EnvelopeRow[] }).envelopes;
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ id: envelope.id, status: "voided", reason: REASON });
    expect(rows[0]!.completedAt).not.toBeNull();
  });

  it("told the provider, so the envelope is not still out there", async () => {
    expect((await provider().readEnvelope(providerEnvelopeId)).status).toBe("voided");
  });

  it("narrates envelope.voided, attributed to the voider", async () => {
    const entries = await entriesOn(contract.id);
    expect(entries.map((entry) => entry.action)).toEqual(["envelope.sent", "envelope.voided"]);
    const voided = entries[1]!;
    expect(voided.actorId).toBe(idOf(SENDER));
    expect(voided.visibility).toBe("working_team");
    expect(voided.payload).toMatchObject({
      envelopeId: envelope.id,
      provider: "docusign",
      providerEnvelopeId,
      status: "voided",
      reason: REASON,
    });
  });

  it("refuses a second void, because an ending is part of the record", async () => {
    const res = await voidEnvelope(as(SENDER), envelope.id);
    expect(res.statusCode, res.body).toBe(409);
    expect(res.json().detail).toContain("already ended");
  });

  it("frees the contract to send again", async () => {
    const again = await sendFrom(contract.number);
    expect(again.status).toBe("sent");
    expect(again.id).not.toBe(envelope.id);

    // Both rounds stay on the record: the void ended one, it did not
    // erase it.
    const state = await signingState(as(SENDER), contract.number);
    expect(state.envelopes.map((row) => row.status).sort()).toEqual(["sent", "voided"]);
  });
});

describe("who else may withdraw a send", () => {
  it("lets the contract's Owner void a send they did not make", async () => {
    const record = await recordWithEnvelopeOut("Owned by somebody else");
    expect((await makeOwner(record.number, idOf(OWNER))).statusCode).toBe(200);
    // The Owner reaches the record through the ownership itself, so
    // nothing here puts them on the team.
    const res = await voidEnvelope(as(OWNER), record.envelope.id);
    expect(res.statusCode, res.body).toBe(200);

    const entries = await entriesOn(record.id);
    expect(entries.at(-1)!.actorId).toBe(idOf(OWNER));
  });

  it("lets an Administrator void any send", async () => {
    const record = await recordWithEnvelopeOut("Withdrawn by an Administrator");
    const res = await voidEnvelope(as(ADMIN), record.envelope.id);
    expect(res.statusCode, res.body).toBe(200);

    const entries = await entriesOn(record.id);
    expect(entries.at(-1)!.actorId).toBe(idOf(ADMIN));
  });

  it("refuses a Member+ who reaches the record but neither sent it nor owns it", async () => {
    const record = await recordWithEnvelopeOut("Reachable, not voidable");
    expect((await addToTeam(record.number, idOf(BYSTANDER))).statusCode).toBe(201);
    // They can read the round; that is what makes the refusal a 403
    // rather than a 404.
    const state = await signingState(as(BYSTANDER), record.number);
    expect(state.envelopes).toHaveLength(1);

    const res = await voidEnvelope(as(BYSTANDER), record.envelope.id);
    expect(res.statusCode, res.body).toBe(403);

    // Refused at the seam means refused before the provider: the
    // envelope is still out.
    const providerEnvelopeId = await providerIdOf(record.envelope.id);
    expect((await provider().readEnvelope(providerEnvelopeId)).status).toBe("sent");
    expect((await signingState(as(SENDER), record.number)).envelopes[0]!.status).toBe("sent");
  });

  it("answers somebody outside a walled record exactly as for an envelope that is not there", async () => {
    const record = await recordWithEnvelopeOut("Project Nightingale");
    await wallOff(record.id);

    const res = await voidEnvelope(as(OUTSIDER), record.envelope.id);
    expect(res.statusCode, res.body).toBe(404);
  });

  it("answers an envelope id nobody holds as one that does not exist", async () => {
    const res = await voidEnvelope(as(SENDER), "no-such-envelope-id");
    expect(res.statusCode, res.body).toBe(404);
  });
});

describe("what a void is refused for", () => {
  it("refuses an envelope that has already been declined", async () => {
    const record = await recordWithEnvelopeOut("Declined before it was voided");
    const providerEnvelopeId = await providerIdOf(record.envelope.id);
    const delivered = await deliver({
      providerEnvelopeId,
      status: "declined",
      reason: "The indemnity cap is wrong.",
    });
    expect(delivered.statusCode, delivered.body).toBe(204);

    const res = await voidEnvelope(as(SENDER), record.envelope.id);
    expect(res.statusCode, res.body).toBe(409);
    expect(res.json().detail).toContain("already ended");

    // The decline's own reason stands. A refused void writes nothing.
    const state = await signingState(as(SENDER), record.number);
    expect(state.envelopes[0]).toMatchObject({
      status: "declined",
      reason: "The indemnity cap is wrong.",
    });
  });

  it("refuses a void with no words", async () => {
    const record = await recordWithEnvelopeOut("Voided for no stated reason");
    const blank = await voidEnvelope(as(SENDER), record.envelope.id, { reason: "   " });
    expect(blank.statusCode, blank.body).toBe(400);
    const absent = await voidEnvelope(as(SENDER), record.envelope.id, {});
    expect(absent.statusCode, absent.body).toBe(400);

    expect((await signingState(as(SENDER), record.number)).envelopes[0]!.status).toBe("sent");
  });

  it("refuses an archived contract", async () => {
    const record = await recordWithEnvelopeOut("Archived while it was out");
    const archived = await harness.app.inject({
      method: "POST",
      url: `/api/v1/contracts/${String(record.number)}/archive`,
      cookies: as(SENDER),
    });
    expect(archived.statusCode, archived.body).toBe(200);

    const res = await voidEnvelope(as(SENDER), record.envelope.id);
    expect(res.statusCode, res.body).toBe(409);
    expect(res.json().detail).toContain("archived");
  });

  it("refuses an install whose connector has gone, by its own type", async () => {
    const record = await recordWithEnvelopeOut("Connector removed mid-round");
    await clearConnector();
    try {
      const res = await voidEnvelope(as(SENDER), record.envelope.id);
      expect(res.statusCode, res.body).toBe(409);
      expect(res.json().type).toBe(SIGNING_NOT_CONFIGURED_PROBLEM_TYPE);
    } finally {
      await configureConnector();
    }
  });
});

describe("an envelope the provider no longer holds", () => {
  it("ends the record's own row anyway, so the contract is not blocked forever", async () => {
    const record = await recordWithEnvelopeOut("Provider forgot it");
    // The id is rewritten in the column, which is what a connector
    // pointed at another account looks like from here: the row names an
    // envelope this provider has never heard of.
    await harness.db
      .update(contractEnvelopes)
      .set({ providerEnvelopeId: "an-envelope-no-provider-holds" })
      .where(eq(contractEnvelopes.id, record.envelope.id));

    const res = await voidEnvelope(as(SENDER), record.envelope.id);
    expect(res.statusCode, res.body).toBe(200);
    expect((res.json() as { envelopes: EnvelopeRow[] }).envelopes[0]).toMatchObject({
      status: "voided",
      reason: REASON,
    });

    // And the record sends again, which is the reason this path is not
    // a refusal.
    const again = await sendFrom(record.number);
    expect(again.status).toBe("sent");
  });
});

describe("sending again after an ending", () => {
  it("sends again after a decline", async () => {
    const record = await recordWithEnvelopeOut("Declined, then sent again");
    const declined = await deliver({
      providerEnvelopeId: await providerIdOf(record.envelope.id),
      status: "declined",
      reason: "Wrong counterparty entity.",
    });
    expect(declined.statusCode, declined.body).toBe(204);

    const again = await sendFrom(record.number);
    expect(again.status).toBe("sent");
    expect(again.id).not.toBe(record.envelope.id);

    const state = await signingState(as(SENDER), record.number);
    expect(state.envelopes.map((row) => row.status).sort()).toEqual(["declined", "sent"]);
  });

  it("keeps the one-live-envelope rule after the next send", async () => {
    const record = await recordWithEnvelopeOut("Voided, then sent, then refused");
    const voided = await voidEnvelope(as(SENDER), record.envelope.id);
    expect(voided.statusCode, voided.body).toBe(200);
    await sendFrom(record.number);

    // The rule is about the live round, not about the record's history:
    // two endings on the row change nothing about the third send.
    const state = await signingState(as(SENDER), record.number);
    const versionId = state.primaryDocument!.versions[0]!.id;
    const third = await harness.app.inject({
      method: "POST",
      url: `/api/v1/contracts/${String(record.number)}/envelopes`,
      cookies: as(SENDER),
      payload: { documentVersionId: versionId, signers: [...SIGNERS] },
    });
    expect(third.statusCode, third.body).toBe(409);
  });
});
