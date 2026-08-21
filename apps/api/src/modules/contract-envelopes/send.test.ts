// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Sending a contract's primary document for signature (#246): CTR-013's
 * send at the HTTP seam, through the real-Postgres harness and the
 * deterministic fake provider.
 *
 * **The act** — a Member+ user picks a round of the primary document,
 * names the signers, and sends. The envelope lands on the record with
 * its signers, the version that went out is the one that reached the
 * provider, and `envelope.sent` is narrated on the contract.
 *
 * **The refusals** — an install with no connector and a contract that
 * already has an envelope out are each refused with their own RFC 9457
 * type, because those are the two the record branches on. A record with
 * no primary document, a version from another document, an archived
 * contract, and a Contributor are each refused too, and each in the
 * shape the rest of the record uses.
 *
 * **The one-live-envelope rule is the database's** — the partial unique
 * index is asserted directly, and two sends racing for one record are
 * asserted to leave exactly one envelope, with anything the loser
 * managed to send taken back at the provider.
 *
 * **Confidentiality inherits** — a viewer outside a walled record's
 * audience gets the missing-record 404 on the read and on the send, so
 * an envelope leaks no more than the record does.
 *
 * Activity is read straight from the table, as the approvals suites do.
 * Nothing here opens the provider's internals: the fake is driven, and
 * what it was handed is read back through the questions it answers.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  activityLog,
  and,
  asc,
  contractEnvelopes,
  contracts,
  desc,
  eq,
  signingConnectors,
  users,
} from "@openlaw/db";
import { ENVELOPE_LIVE_PROBLEM_TYPE, SIGNING_NOT_CONFIGURED_PROBLEM_TYPE } from "@openlaw/shared";
import { provisionUser } from "../../auth/instance.js";
import { ERASED, signerAppearances } from "../../lib/signer-erasure.js";
import { FAKE_VALID_INTEGRATION_KEY } from "../../lib/signing/fake.js";
import {
  signInCookies,
  startHarness,
  TEST_ADMIN as ADMIN,
  type TestHarness,
} from "../../testing/harness.js";

/** The person who sends, on the team of every record here. */
const MEMBER = {
  email: "env-member@example.com",
  displayName: "Nadia Counsel",
  password: "correct-horse-battery",
} as const;
/** A Legal Team Member who is on no record: reach, not role, is what
 * a confidential record refuses. */
const OUTSIDER = {
  email: "env-outsider@example.com",
  displayName: "Otto Outside",
  password: "correct-horse-battery",
} as const;
/** Reads the record and sends nothing (DD-015). */
const CONTRIBUTOR = {
  email: "env-contributor@example.com",
  displayName: "Casey Contributor",
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

/** The connector an Administrator saves, with the integration key the
 * fake accepts. */
const CONNECTOR = {
  environment: "demo",
  integrationKey: FAKE_VALID_INTEGRATION_KEY,
  apiUserId: "99999999-8888-7777-6666-555555555555",
  privateKey: RSA_KEY,
  webhookSecret: HMAC_SECRET,
} as const;

/** The two signers every send here names. */
const SIGNERS = [
  { name: "Sarah Chen", email: "sarah@meridianbio.example" },
  { name: "J. Malone", email: "j.malone@orioncloud.example" },
] as const;

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

interface ContractRow {
  id: string;
  number: number;
  title: string;
}

interface EnvelopeRow {
  id: string;
  provider: string;
  status: string;
  signers: { name: string; email: string }[];
  documentTitle: string | null;
  documentVersionNumber: number | null;
  sentBy: { id: string; displayName: string; image: string | null };
  sentAt: string;
  completedAt: string | null;
}

interface SendableDocument {
  id: string;
  title: string;
  versions: { id: string; versionNumber: number; kind: string; originalFilename: string }[];
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

  for (const [fixture, role] of [
    [MEMBER, "legal_team_member"],
    [OUTSIDER, "legal_team_member"],
    [CONTRIBUTOR, "contributor"],
  ] as const) {
    const user = await provisionUser(harness.app.auth, fixture);
    await harness.db.update(users).set({ role }).where(eq(users.id, user.id));
    userIds.set(fixture.email, user.id);
    cookies.set(fixture.email, await signInCookies(harness.app, fixture.email, fixture.password));
  }
});

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

/** A contract the sending Member made, so they hold its `creator` row. */
async function newContract(title: string): Promise<ContractRow> {
  const res = await harness.app.inject({
    method: "POST",
    url: "/api/v1/contracts",
    cookies: as(MEMBER),
    payload: { title, contractTypeId: await ndaTypeId() },
  });
  expect(res.statusCode, res.body).toBe(201);
  return res.json().contract as ContractRow;
}

const BOUNDARY = "openlaw-test-boundary-656e76";

/** One upload, as `multipart/form-data`. Built by hand, as the
 * documents suite builds its own: the route reads `kind` before the
 * file, so the order the parts are written in matters. */
function uploadBody(kind: string, filename: string, content: Buffer) {
  const chunks = [
    Buffer.from(`--${BOUNDARY}\r\ncontent-disposition: form-data; name="kind"\r\n\r\n`),
    Buffer.from(kind),
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

/** Puts the first document on a record, which takes the primary
 * designation (CTR-014), and appends a second round to its chain. */
async function paperOn(number: number, first: Buffer, second: Buffer): Promise<string> {
  const create = uploadBody("draft_ours", "draft.pdf", first);
  const created = await harness.app.inject({
    method: "POST",
    url: `/api/v1/contracts/${number}/documents`,
    cookies: as(MEMBER),
    headers: create.headers,
    payload: create.payload,
  });
  expect(created.statusCode, created.body).toBe(201);
  const documentId = (created.json().document as { id: string }).id;

  const round = uploadBody("redline_theirs", "redline.pdf", second);
  const appended = await harness.app.inject({
    method: "POST",
    url: `/api/v1/documents/${documentId}/versions`,
    cookies: as(MEMBER),
    headers: round.headers,
    payload: round.payload,
  });
  expect(appended.statusCode, appended.body).toBe(201);
  return documentId;
}

const listEnvelopes = (jar: Record<string, string>, number: number) =>
  harness.app.inject({ method: "GET", url: `/api/v1/contracts/${number}/envelopes`, cookies: jar });

const send = (
  jar: Record<string, string>,
  number: number,
  documentVersionId: string,
  signers: readonly { name: string; email: string }[] = SIGNERS,
  subject?: string,
) =>
  harness.app.inject({
    method: "POST",
    url: `/api/v1/contracts/${number}/envelopes`,
    cookies: jar,
    payload: {
      documentVersionId,
      signers: [...signers],
      ...(subject === undefined ? {} : { subject }),
    },
  });

/** The signing state of one record, requiring success. */
async function signingState(jar: Record<string, string>, number: number) {
  const res = await listEnvelopes(jar, number);
  expect(res.statusCode, res.body).toBe(200);
  return res.json() as {
    envelopes: EnvelopeRow[];
    signingConfigured: boolean;
    primaryDocument: SendableDocument | null;
  };
}

/** Every envelope entry on one contract, oldest first. */
const entriesOn = (contractId: string) =>
  harness.db
    .select()
    .from(activityLog)
    .where(and(eq(activityLog.entityId, contractId), eq(activityLog.action, "envelope.sent")))
    .orderBy(asc(activityLog.createdAt), asc(activityLog.id));

/** Walls a record off straight in the column: a fixture that makes a
 * record confidential is not the subject of a send test. */
const wallOff = (contractId: string) =>
  harness.db.update(contracts).set({ isConfidential: true }).where(eq(contracts.id, contractId));

/** Puts somebody on a contract's team, which is what grants a
 * Contributor their reach. */
const addToTeam = (number: number, userId: string) =>
  harness.app.inject({
    method: "POST",
    url: `/api/v1/contracts/${number}/team`,
    cookies: as(MEMBER),
    payload: { userId, role: "member" },
  });

/** The fake this app resolved. Non-null from the first request that
 * resolved a configured connector. */
function provider() {
  expect(harness.signing, "the harness's fake provider").not.toBeNull();
  return harness.signing!;
}

describe("sending the primary document for signature", () => {
  let contract: ContractRow;
  let paper: SendableDocument;

  beforeAll(async () => {
    await configureConnector();
    contract = await newContract("Orion Cloud master services agreement");
    await paperOn(contract.number, Buffer.from("the first draft"), Buffer.from("their redline"));
    const state = await signingState(as(MEMBER), contract.number);
    expect(state.primaryDocument, "the record's instrument").not.toBeNull();
    paper = state.primaryDocument!;
  });

  it("offers the primary document's chain, newest round first", () => {
    expect(paper.versions.map((round) => round.versionNumber)).toEqual([2, 1]);
    expect(paper.versions[0]!.originalFilename).toBe("redline.pdf");
  });

  it("says the install has a connector, and holds no envelope yet", async () => {
    const state = await signingState(as(MEMBER), contract.number);
    expect(state.signingConfigured).toBe(true);
    expect(state.envelopes).toEqual([]);
  });

  it("sends the chosen round, records the envelope, and narrates it", async () => {
    // The older round, not the current one: what proves the dialog's
    // choice reaches the provider is sending something other than the
    // version a defaulted send would have picked.
    const chosen = paper.versions.find((round) => round.versionNumber === 1)!;
    const res = await send(as(MEMBER), contract.number, chosen.id);
    expect(res.statusCode, res.body).toBe(201);

    const envelopes = (res.json() as { envelopes: EnvelopeRow[] }).envelopes;
    expect(envelopes).toHaveLength(1);
    expect(envelopes[0]).toMatchObject({
      provider: "docusign",
      status: "sent",
      documentTitle: paper.title,
      documentVersionNumber: 1,
      completedAt: null,
    });
    expect(envelopes[0]!.signers).toEqual([...SIGNERS]);
    expect(envelopes[0]!.sentBy.id).toBe(idOf(MEMBER));

    // What the provider was actually handed. Read back through the
    // questions the fake answers, never through its internals.
    const ids = provider().sentEnvelopeIds();
    expect(ids).toHaveLength(1);
    expect(provider().documentOf(ids[0]!).toString("utf8")).toBe("the first draft");
    expect(provider().signersOf(ids[0]!)).toEqual([...SIGNERS]);

    const entries = await entriesOn(contract.id);
    expect(entries).toHaveLength(1);
    expect(entries[0]!.actorId).toBe(idOf(MEMBER));
    expect(entries[0]!.visibility).toBe("working_team");
    expect(entries[0]!.payload).toMatchObject({
      provider: "docusign",
      providerEnvelopeId: ids[0],
      documentTitle: paper.title,
      documentVersionNumber: 1,
      signers: [...SIGNERS],
    });
  });

  it("reads the envelope back on the record, signers and all", async () => {
    const state = await signingState(as(MEMBER), contract.number);
    expect(state.envelopes).toHaveLength(1);
    expect(state.envelopes[0]!.signers).toEqual([...SIGNERS]);
  });

  it("shows the envelope to a Contributor on the team, who cannot send", async () => {
    const added = await addToTeam(contract.number, idOf(CONTRIBUTOR));
    expect(added.statusCode, added.body).toBe(201);

    const state = await signingState(as(CONTRIBUTOR), contract.number);
    expect(state.envelopes).toHaveLength(1);

    const refused = await send(as(CONTRIBUTOR), contract.number, paper.versions[0]!.id);
    expect(refused.statusCode).toBe(403);
  });

  it("refuses a second send while the envelope is live, by its own type", async () => {
    const res = await send(as(MEMBER), contract.number, paper.versions[0]!.id);
    expect(res.statusCode, res.body).toBe(409);
    expect(res.json().type).toBe(ENVELOPE_LIVE_PROBLEM_TYPE);
    // The refused send never reached the provider.
    expect(provider().sentEnvelopeIds()).toHaveLength(1);
  });

  it("holds the one-live-envelope rule in the database", async () => {
    const [live] = await harness.db
      .select()
      .from(contractEnvelopes)
      .where(eq(contractEnvelopes.contractId, contract.id));
    expect(live, "the live envelope").toBeDefined();
    await expect(
      harness.db.insert(contractEnvelopes).values({
        contractId: contract.id,
        provider: "docusign",
        providerEnvelopeId: "a-second-live-envelope",
        documentVersionId: live!.documentVersionId,
        sentBy: idOf(MEMBER),
      }),
      // The constraint by name, and 23505 beside it: any other error
      // would mean the row was refused for a reason that is not the
      // one-live-envelope rule. Drizzle wraps the driver's error, so
      // the database's own answer is on the cause.
    ).rejects.toMatchObject({
      cause: { code: "23505", constraint: "contract_envelopes_live_idx" },
    });
  });
});

describe("what a send is refused for", () => {
  beforeAll(configureConnector);

  it("refuses a record with no primary document", async () => {
    const bare = await newContract("Nothing uploaded yet");
    const state = await signingState(as(MEMBER), bare.number);
    expect(state.primaryDocument).toBeNull();

    const res = await send(as(MEMBER), bare.number, "any-version-id");
    expect(res.statusCode, res.body).toBe(422);
    expect(res.json().detail).toContain("no primary document");
  });

  it("refuses a version that is not a round of this contract's chain", async () => {
    const mine = await newContract("Mine");
    await paperOn(mine.number, Buffer.from("mine v1"), Buffer.from("mine v2"));
    const other = await newContract("Somebody else's");
    await paperOn(other.number, Buffer.from("theirs v1"), Buffer.from("theirs v2"));
    const theirs = (await signingState(as(MEMBER), other.number)).primaryDocument!;

    const res = await send(as(MEMBER), mine.number, theirs.versions[0]!.id);
    expect(res.statusCode, res.body).toBe(422);
    expect(res.json().detail).toContain("not a round of this contract's primary document");
  });

  it("refuses the same signer twice", async () => {
    const twice = await newContract("Named twice");
    await paperOn(twice.number, Buffer.from("v1"), Buffer.from("v2"));
    const paper = (await signingState(as(MEMBER), twice.number)).primaryDocument!;

    const res = await send(as(MEMBER), twice.number, paper.versions[0]!.id, [
      { name: "Sarah Chen", email: "sarah@meridianbio.example" },
      { name: "Sarah C.", email: "SARAH@meridianbio.example" },
    ]);
    expect(res.statusCode, res.body).toBe(422);
    expect(res.json().detail).toContain("own email address");
  });

  it("refuses an archived contract", async () => {
    const frozen = await newContract("Archived before it went out");
    await paperOn(frozen.number, Buffer.from("v1"), Buffer.from("v2"));
    const paper = (await signingState(as(MEMBER), frozen.number)).primaryDocument!;
    const archived = await harness.app.inject({
      method: "POST",
      url: `/api/v1/contracts/${frozen.number}/archive`,
      cookies: as(MEMBER),
    });
    expect(archived.statusCode, archived.body).toBe(200);

    const res = await send(as(MEMBER), frozen.number, paper.versions[0]!.id);
    expect(res.statusCode, res.body).toBe(409);
    expect(res.json().detail).toContain("archived");
  });

  it("answers a contract that does not exist as one that does not exist", async () => {
    const res = await listEnvelopes(as(MEMBER), 999_999);
    expect(res.statusCode).toBe(404);
  });
});

describe("the invitation's subject line", () => {
  beforeAll(configureConnector);

  it("carries the sender's subject verbatim", async () => {
    const contract = await newContract("Subject as typed");
    await paperOn(contract.number, Buffer.from("v1"), Buffer.from("v2"));
    const paper = (await signingState(as(MEMBER), contract.number)).primaryDocument!;

    const res = await send(
      as(MEMBER),
      contract.number,
      paper.versions[0]!.id,
      SIGNERS,
      "Please sign the Orion MSA",
    );
    expect(res.statusCode, res.body).toBe(201);
    const id = provider().sentEnvelopeIds().at(-1)!;
    expect(provider().subjectOf(id)).toBe("Please sign the Orion MSA");
  });

  it("names the record when the subject is blank, exactly as when it is omitted", async () => {
    // Blank, not absent: the schema trims, so a subject of spaces
    // arrives as an empty string — and an empty subject line forwarded
    // to the provider would be refused there. Blank has to mean what
    // omitted means, which is the promise the dialog's help text makes.
    const contract = await newContract("Subject left blank");
    await paperOn(contract.number, Buffer.from("v1"), Buffer.from("v2"));
    const paper = (await signingState(as(MEMBER), contract.number)).primaryDocument!;

    const res = await send(as(MEMBER), contract.number, paper.versions[0]!.id, SIGNERS, "   ");
    expect(res.statusCode, res.body).toBe(201);
    const id = provider().sentEnvelopeIds().at(-1)!;
    expect(provider().subjectOf(id)).toBe(`C-${String(contract.number)} ${contract.title}`);
  });
});

describe("an install with no connector", () => {
  let contract: ContractRow;
  let paper: SendableDocument;

  beforeAll(async () => {
    contract = await newContract("Signed by hand");
    await paperOn(contract.number, Buffer.from("v1"), Buffer.from("v2"));
    paper = (await signingState(as(MEMBER), contract.number)).primaryDocument!;
    await clearConnector();
  });

  afterAll(configureConnector);

  it("says so on the record rather than by omission", async () => {
    const state = await signingState(as(MEMBER), contract.number);
    expect(state.signingConfigured).toBe(false);
    expect(state.envelopes).toEqual([]);
    // The paper is still there. Manual hand-off needs no connector, and
    // the record must not read as though it had nothing to sign.
    expect(state.primaryDocument).not.toBeNull();
  });

  it("refuses the send by its own type", async () => {
    const res = await send(as(MEMBER), contract.number, paper.versions[0]!.id);
    expect(res.statusCode, res.body).toBe(409);
    expect(res.json().type).toBe(SIGNING_NOT_CONFIGURED_PROBLEM_TYPE);
  });
});

describe("a confidential record", () => {
  let contract: ContractRow;
  let paper: SendableDocument;

  beforeAll(async () => {
    await configureConnector();
    contract = await newContract("Project Nightingale");
    await paperOn(contract.number, Buffer.from("v1"), Buffer.from("v2"));
    paper = (await signingState(as(MEMBER), contract.number)).primaryDocument!;
    const sent = await send(as(MEMBER), contract.number, paper.versions[0]!.id);
    expect(sent.statusCode, sent.body).toBe(201);
    await wallOff(contract.id);
  });

  it("answers its audience", async () => {
    const state = await signingState(as(MEMBER), contract.number);
    expect(state.envelopes).toHaveLength(1);
  });

  it("answers everybody else exactly as for a record that is not there", async () => {
    const read = await listEnvelopes(as(OUTSIDER), contract.number);
    expect(read.statusCode).toBe(404);

    const write = await send(as(OUTSIDER), contract.number, paper.versions[0]!.id);
    expect(write.statusCode).toBe(404);
  });
});

describe("two sends racing for one record", () => {
  it("leaves one envelope, and takes back anything the loser sent", async () => {
    await configureConnector();
    const contract = await newContract("Sent twice at once");
    await paperOn(contract.number, Buffer.from("v1"), Buffer.from("v2"));
    const paper = (await signingState(as(MEMBER), contract.number)).primaryDocument!;
    const before = new Set(provider().sentEnvelopeIds());

    const [first, second] = await Promise.all([
      send(as(MEMBER), contract.number, paper.versions[0]!.id),
      send(as(MEMBER), contract.number, paper.versions[0]!.id),
    ]);
    const codes = [first.statusCode, second.statusCode].sort((a, b) => a - b);
    expect(codes, `${first.body} / ${second.body}`).toEqual([201, 409]);
    const refusal = first.statusCode === 409 ? first : second;
    expect(refusal.json().type).toBe(ENVELOPE_LIVE_PROBLEM_TYPE);

    const rows = await harness.db
      .select()
      .from(contractEnvelopes)
      .where(eq(contractEnvelopes.contractId, contract.id));
    expect(rows).toHaveLength(1);

    // Whatever the loser managed to send is not still out there. The
    // compensating void runs only when the loser got as far as the
    // provider, which is why this asks the invariant rather than the
    // count: every envelope this record's sends produced is either the
    // one the record kept, or one that was taken back.
    const produced = provider()
      .sentEnvelopeIds()
      .filter((id) => !before.has(id));
    for (const id of produced) {
      if (id === rows[0]!.providerEnvelopeId) continue;
      expect((await provider().readEnvelope(id)).status).toBe("voided");
    }
  });
});

/**
 * The erasure a person who is only ever a signer can ask for (#280).
 *
 * It lives in this file because this is where a real send happens: the
 * property is that the address the send wrote into the payload is not
 * readable afterwards, and asserting that needs the payload a real send
 * produced.
 */
describe("erasing an external signer", () => {
  const ERASE_URL = "/api/v1/signer-erasures";

  /** The person who asks to be forgotten. Their own address, so the
   * assertions cannot pass on somebody else's row. */
  const LEAVING = { name: "Iris Bakker", email: "iris.bakker@vantagepartners.example" } as const;
  const STAYING = { name: "Owen Reid", email: "owen.reid@vantagepartners.example" } as const;

  const erase = (jar: Record<string, string>, email: string) =>
    harness.app.inject({ method: "POST", url: ERASE_URL, cookies: jar, payload: { email } });

  let contract: ContractRow;

  beforeAll(async () => {
    await configureConnector();
    contract = await newContract("Vantage master services agreement");
    await paperOn(contract.number, Buffer.from("v1"), Buffer.from("v2"));
    const paper = (await signingState(as(MEMBER), contract.number)).primaryDocument!;
    const sent = await send(as(MEMBER), contract.number, paper.versions[0]!.id, [LEAVING, STAYING]);
    expect(sent.statusCode, sent.body).toBe(201);
  });

  it("is the Administrator's alone", async () => {
    // A valid body on the anonymous call too: Fastify validates before
    // it reaches a preHandler, so a malformed one would answer 400 and
    // prove nothing about who may ask.
    const anonymous = await harness.app.inject({
      method: "POST",
      url: ERASE_URL,
      payload: { email: LEAVING.email },
    });
    expect(anonymous.statusCode, anonymous.body).toBe(401);
    expect((await erase(as(MEMBER), LEAVING.email)).statusCode).toBe(403);
  });

  it("refuses an address that belongs to a user of this install", async () => {
    // Their address is in payloads that are about them as a colleague,
    // and those have a different answer.
    const res = await erase(as(ADMIN), MEMBER.email);
    expect(res.statusCode, res.body).toBe(409);
    expect(res.json().detail).toContain("belongs to a user of this install");
  });

  it("answers zeros for an address that was never a signer's", async () => {
    // A satisfied request, not a missing one: there was nothing to
    // erase, and refusing would make this a way to ask whether an
    // address is in the record.
    const res = await erase(as(ADMIN), "nobody.here@vantagepartners.example");
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json().erasure).toEqual({ entriesRedacted: 0, signerRowsDeleted: 0 });
  });

  it("takes the name and the address out and leaves the shape behind", async () => {
    const before = await entriesOn(contract.id);
    expect(before).toHaveLength(1);
    expect(before[0]!.payload).toMatchObject({ signers: [LEAVING, STAYING] });

    const res = await erase(as(ADMIN), LEAVING.email.toUpperCase());
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json().erasure).toEqual({ entriesRedacted: 1, signerRowsDeleted: 1 });

    const after = await entriesOn(contract.id);
    expect(after).toHaveLength(1);
    // The array keeps its length and its order: how many were asked,
    // and in what position, is about the contract rather than about
    // the person. Only the two keys about the person are gone.
    expect(after[0]!.payload).toMatchObject({
      signers: [{ name: ERASED, email: ERASED }, STAYING],
    });
    // Nothing else on the entry moved — this is a rewrite of two keys,
    // not a new entry standing in for the old one.
    expect(after[0]!.id).toBe(before[0]!.id);
    expect(after[0]!.createdAt).toEqual(before[0]!.createdAt);
    expect(after[0]!.payload).toMatchObject({
      envelopeId: (before[0]!.payload as { envelopeId: string }).envelopeId,
    });

    expect(await signerAppearances(harness.db, LEAVING.email)).toBe(0);
    // The other signer on the same envelope is untouched, in both
    // places the record holds them.
    expect(await signerAppearances(harness.db, STAYING.email)).toBe(2);
  });

  it("appends its own entry, carrying counts and no address", async () => {
    // The most recent one: the request that found nothing above is
    // also on the log, and an erasure that reached nothing is still an
    // erasure somebody performed. Ordered by id, a uuidv7, so the
    // sort is the order they were minted rather than a timestamp that
    // can tie.
    const [entry] = await harness.db
      .select()
      .from(activityLog)
      .where(eq(activityLog.action, "signer.erased"))
      .orderBy(desc(activityLog.id))
      .limit(1);
    expect(entry).toBeDefined();
    expect(entry!.visibility).toBe("admin_only");
    expect(entry!.entityType).toBe("system");
    expect(entry!.actorId).toBe(idOf(ADMIN));
    expect(entry!.payload).toEqual({ entriesRedacted: 1, signerRowsDeleted: 1 });
    // The one thing this entry must never do: an entry naming the
    // person who asked to be forgotten would put the address straight
    // back into the table the erasure just took it out of.
    expect(JSON.stringify(entry!.payload)).not.toContain(LEAVING.email);
    expect(JSON.stringify(entry!.payload)).not.toContain(LEAVING.name);
  });

  it("leaves the record's own answer readable, with the signer erased", async () => {
    // The envelope is still there and still says a round went out. The
    // signer rows for the erased person are gone, so the row draws the
    // people it still holds.
    const state = await signingState(as(MEMBER), contract.number);
    expect(state.envelopes).toHaveLength(1);
    expect(state.envelopes[0]!.signers).toEqual([STAYING]);
  });
});
