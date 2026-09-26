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

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
  activityLog,
  and,
  asc,
  contractEnvelopes,
  envelopeLaunches,
  isNull,
  contractEnvelopeSigners,
  contracts,
  contractStatuses,
  desc,
  documentVersions,
  eq,
  signingConnectors,
  users,
  sql,
} from "@openlaw/db";
import { ENVELOPE_LIVE_PROBLEM_TYPE, SIGNING_NOT_CONFIGURED_PROBLEM_TYPE } from "@openlaw/shared";
import { recoverEnvelope } from "../../lib/signing/recovery.js";
import { checkEnvelopeStatus } from "../../lib/signing/status-check.js";
import { runReconciliationSweep } from "../../pipeline/reconciliation.js";
import { applyEnvelopeStatus } from "../../lib/signing/transitions.js";
import { provisionUser } from "../../auth/instance.js";
import { ERASED, signerAppearances } from "../../lib/signer-erasure.js";
import {
  type SendEnvelopeInput,
  SigningConfigError,
  SigningNotSubmittedError,
  SigningRefusedError,
  EnvelopeNotFoundError,
  EnvelopeAccessError,
  EnvelopeEditConflictError,
  SigningTimeoutError,
  SigningUnavailableError,
} from "../../lib/signing/provider.js";
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
  updateMode: "webhook",
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
  preparationState: "pending" | "uncertain" | "created" | "failed" | null;
  recoveryAttempts: number;
  nextRecoveryAt: string | null;
  recoveryStopped: "lookup_expired" | "attempts_exhausted" | "identity_missing" | null;
  id: string;
  provider: string;
  status: string;
  signers: { name: string; email: string }[];
  documentTitle: string | null;
  documentVersionNumber: number | null;
  sentBy: { id: string; displayName: string; image: string | null };
  sentAt: string | null;
  completedAt: string | null;
}

interface SendableDocument {
  id: string;
  title: string;
  versions: { id: string; versionNumber: number; kind: string; originalFilename: string }[];
}

beforeAll(async () => {
  harness = await startHarness({ signingPreparationEnabled: true });
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
    [CONTRIBUTOR, "business_user"],
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
  signers: readonly ({ name: string; email: string } | { personId: string })[] = SIGNERS,
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

async function signingState(jar: Record<string, string>, number: number) {
  const res = await listEnvelopes(jar, number);
  expect(res.statusCode, res.body).toBe(200);
  return res.json() as {
    envelopes: EnvelopeRow[];
    signingConfigured: boolean;
    updateMode: "polling" | "webhook" | null;
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
    payload: { userId },
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
    expect(state.updateMode).toBe("webhook");
    expect(state.envelopes).toEqual([]);
    await harness.db.update(signingConnectors).set({ updateMode: "polling" });
    try {
      expect((await signingState(as(MEMBER), contract.number)).updateMode).toBe("polling");
    } finally {
      await harness.db.update(signingConnectors).set({ updateMode: "webhook" });
    }
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

  it("moves the contract from Draft to Out for signature and records the change", async () => {
    const res = await harness.app.inject({
      method: "GET",
      url: `/api/v1/contracts/${contract.number}`,
      cookies: as(MEMBER),
    });
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json().contract).toMatchObject({
      stage: "signature",
      statusName: "Out for signature",
    });
    const changes = await harness.db
      .select()
      .from(activityLog)
      .where(
        and(
          eq(activityLog.entityId, contract.id),
          eq(activityLog.action, "contract.status_changed"),
        ),
      );
    expect(changes).toHaveLength(1);
    expect(changes[0]).toMatchObject({
      actorId: idOf(MEMBER),
      payload: { from: "Draft", to: "Out for signature", fromStage: "draft", toStage: "signature" },
    });
  });

  it("reads the envelope back on the record, signers and all", async () => {
    const state = await signingState(as(MEMBER), contract.number);
    expect(state.envelopes).toHaveLength(1);
    expect(state.envelopes[0]!.signers).toEqual([...SIGNERS]);
  });

  it("refuses envelope reads and sends for a Business User on the team", async () => {
    const added = await addToTeam(contract.number, idOf(CONTRIBUTOR));
    expect(added.statusCode, added.body).toBe(201);

    const state = await listEnvelopes(as(CONTRIBUTOR), contract.number);
    expect(state.statusCode).toBe(403);

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

  /**
   * The route already refuses a repeated address (CTR-013's #391
   * addendum), so this asks the other half of the question: what stops
   * a writer that forgot to. The position was protected and the person
   * was not until this index landed.
   */
  it("holds the one-address-one-signer rule in the database", async () => {
    const [live] = await harness.db
      .select()
      .from(contractEnvelopes)
      .where(eq(contractEnvelopes.contractId, contract.id));
    expect(live, "the live envelope").toBeDefined();
    await expect(
      harness.db.insert(contractEnvelopeSigners).values({
        envelopeId: live!.id,
        name: "Sarah C.",
        // The same address in another case. Addresses are stored
        // verbatim and compared case-insensitively, which is what the
        // index reads and what the erasure path matches on.
        email: SIGNERS[0].email.toUpperCase(),
        // A free position, so the row can only be refused by the
        // address: the order index would have caught a repeated one and
        // said nothing about the person.
        signingOrder: SIGNERS.length + 1,
      }),
    ).rejects.toMatchObject({
      cause: { code: "23505", constraint: "contract_envelope_signers_email_idx" },
    });
  });
});

describe("the contract status follows a successful send", () => {
  beforeAll(configureConnector);

  async function readyContract(title: string) {
    const contract = await newContract(title);
    await paperOn(contract.number, Buffer.from("v1"), Buffer.from("v2"));
    const paper = (await signingState(as(MEMBER), contract.number)).primaryDocument!;
    return { contract, versionId: paper.versions[0]!.id };
  }

  async function storedContract(id: string) {
    const [row] = await harness.db.select().from(contracts).where(eq(contracts.id, id));
    return row!;
  }

  it("keeps Draft when the provider cannot accept the send", async () => {
    const { contract, versionId } = await readyContract("Provider unavailable");
    const before = await storedContract(contract.id);
    provider().outage();
    try {
      const res = await send(as(MEMBER), contract.number, versionId);
      expect(res.statusCode, res.body).toBe(502);
    } finally {
      provider().online();
    }
    expect((await storedContract(contract.id)).statusId).toBe(before.statusId);
    expect((await signingState(as(MEMBER), contract.number)).envelopes).toEqual([]);
  });

  it("rolls back the status, voids the provider send, and ends the round on failure", async () => {
    const { contract, versionId } = await readyContract("Send transaction rollback");
    const before = await storedContract(contract.id);
    const idsBefore = new Set(provider().sentEnvelopeIds());
    const notification = vi
      .spyOn(harness.app.notifier, "statusChanged")
      .mockRejectedValueOnce(new Error("Status notification could not be recorded"));
    try {
      const res = await send(as(MEMBER), contract.number, versionId);
      expect(res.statusCode, res.body).toBe(500);
    } finally {
      notification.mockRestore();
    }
    expect((await storedContract(contract.id)).statusId).toBe(before.statusId);
    // The provider confirmed the void, so the round has a terminal
    // outcome: it stays on the record as voided and reserves nothing.
    expect((await signingState(as(MEMBER), contract.number)).envelopes).toMatchObject([
      { status: "voided", reason: "OpenLaw could not record this send." },
    ]);
    expect(await entriesOn(contract.id)).toEqual([]);
    const produced = provider()
      .sentEnvelopeIds()
      .filter((id) => !idsBefore.has(id));
    expect(produced).toHaveLength(1);
    expect((await provider().readEnvelope(produced[0]!)).status).toBe("voided");
    const later = await send(as(MEMBER), contract.number, versionId);
    expect(later.statusCode, later.body).toBe(201);
  });

  it("uses the first live configured Signature status and clears an ended date", async () => {
    const { contract, versionId } = await readyContract("Configured Signature status");
    const [custom] = await harness.db
      .insert(contractStatuses)
      .values({
        slug: "awaiting_signatures_test",
        displayName: "Awaiting signatures",
        stage: "signature",
        displayOrder: -1,
      })
      .returning();
    const [ended] = await harness.db
      .select()
      .from(contractStatuses)
      .where(eq(contractStatuses.stage, "ended"));
    await harness.db
      .update(contracts)
      .set({ statusId: ended!.id, endedAt: new Date() })
      .where(eq(contracts.id, contract.id));
    try {
      const res = await send(as(MEMBER), contract.number, versionId);
      expect(res.statusCode, res.body).toBe(201);
      expect(await storedContract(contract.id)).toMatchObject({
        statusId: custom!.id,
        endedAt: null,
      });
      const again = await send(as(MEMBER), contract.number, versionId);
      expect(again.statusCode).toBe(409);
      const changes = await harness.db
        .select()
        .from(activityLog)
        .where(
          and(
            eq(activityLog.entityId, contract.id),
            eq(activityLog.action, "contract.status_changed"),
          ),
        );
      expect(changes).toHaveLength(1);
    } finally {
      await harness.db
        .update(contractStatuses)
        .set({ archivedAt: new Date() })
        .where(eq(contractStatuses.id, custom!.id));
    }
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

  it("sends to a picked user by the name and address their account holds", async () => {
    const picked = await newContract("Signed in house");
    await paperOn(picked.number, Buffer.from("v1"), Buffer.from("v2"));
    const paper = (await signingState(as(MEMBER), picked.number)).primaryDocument!;

    const res = await send(as(MEMBER), picked.number, paper.versions[0]!.id, [
      { personId: idOf(OUTSIDER) },
      SIGNERS[0],
    ]);
    expect(res.statusCode, res.body).toBe(201);
    const expected = [{ name: OUTSIDER.displayName, email: OUTSIDER.email }, { ...SIGNERS[0] }];
    const envelope = (res.json() as { envelopes: EnvelopeRow[] }).envelopes[0]!;
    expect(envelope.signers).toEqual(expected);
    expect(provider().signersOf(provider().sentEnvelopeIds().at(-1)!)).toEqual(expected);
  });

  it("refuses a picked user who is archived", async () => {
    const leaver = await newContract("Sent to a leaver");
    await paperOn(leaver.number, Buffer.from("v1"), Buffer.from("v2"));
    const paper = (await signingState(as(MEMBER), leaver.number)).primaryDocument!;
    await harness.db
      .update(users)
      .set({ archivedAt: new Date() })
      .where(eq(users.id, idOf(OUTSIDER)));
    try {
      const res = await send(as(MEMBER), leaver.number, paper.versions[0]!.id, [
        { personId: idOf(OUTSIDER) },
      ]);
      expect(res.statusCode, res.body).toBe(422);
      expect(res.json().detail).toContain("not an active user");
      expect((await signingState(as(MEMBER), leaver.number)).envelopes).toEqual([]);
    } finally {
      await harness.db
        .update(users)
        .set({ archivedAt: null })
        .where(eq(users.id, idOf(OUTSIDER)));
    }
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

describe("durable Envelope preparation", () => {
  it("keeps the exact Version and Signers as an unsent draft, and reuses the key", async () => {
    await configureConnector();
    const contract = await newContract("Durable preparation");
    await paperOn(contract.number, Buffer.from("first"), Buffer.from("second"));
    const before = await signingState(as(MEMBER), contract.number);
    const version = before.primaryDocument!.versions[1]!;
    const payload = {
      documentVersionId: version.id,
      signers: [...SIGNERS],
      subject: "Review and sign",
      idempotencyKey: "draft-one",
    };
    const prepare = () =>
      harness.app.inject({
        method: "POST",
        url: `/api/v1/contracts/${contract.number}/envelopes/prepare`,
        cookies: as(MEMBER),
        payload,
      });
    const response = await prepare();
    expect(response.statusCode, response.body).toBe(201);
    const draft = response.json().envelopes[0];
    expect(draft).toMatchObject({
      status: "draft",
      sentAt: null,
      documentVersionNumber: version.versionNumber,
      signers: SIGNERS,
      sentBy: { id: idOf(MEMBER) },
    });
    const [stored] = await harness.db
      .select()
      .from(contractEnvelopes)
      .where(eq(contractEnvelopes.id, draft.id));
    expect(stored!.providerEnvelopeId).toBeTruthy();
    expect(await harness.signing!.readEnvelope(stored!.providerEnvelopeId!)).toMatchObject({
      status: "draft",
    });
    expect(harness.signing!.documentOf(stored!.providerEnvelopeId!)).toEqual(Buffer.from("first"));
    expect(await entriesOn(contract.id)).toHaveLength(0);
    expect((await prepare()).json().envelopes[0].id).toBe(draft.id);
    const changed = await harness.app.inject({
      method: "POST",
      url: `/api/v1/contracts/${contract.number}/envelopes/prepare`,
      cookies: as(MEMBER),
      payload: { ...payload, subject: "Different" },
    });
    expect(changed.statusCode).toBe(409);
    expect(changed.json().type).toBe("urn:openlaw:problem:envelope-idempotency-conflict");
    const changedVersion = await harness.app.inject({
      method: "POST",
      url: `/api/v1/contracts/${contract.number}/envelopes/prepare`,
      cookies: as(MEMBER),
      payload: { ...payload, documentVersionId: "another-version" },
    });
    expect(changedVersion.statusCode).toBe(409);
    expect(changedVersion.json().type).toBe("urn:openlaw:problem:envelope-idempotency-conflict");
    expect((await send(as(MEMBER), contract.number, version.id)).statusCode).toBe(409);
  });
});

describe("preparation refusals and reservations", () => {
  async function ready() {
    await configureConnector();
    const contract = await newContract("Preparation checks");
    await paperOn(contract.number, Buffer.from("one"), Buffer.from("two"));
    const state = await signingState(as(MEMBER), contract.number);
    const payload = {
      documentVersionId: state.primaryDocument!.versions[0]!.id,
      signers: [...SIGNERS],
      subject: "Please review",
      idempotencyKey: crypto.randomUUID(),
    };
    const prepare = (patch = {}, actor = MEMBER) =>
      harness.app.inject({
        method: "POST",
        url: `/api/v1/contracts/${contract.number}/envelopes/prepare`,
        cookies: as(actor),
        payload: { ...payload, ...patch },
      });
    return { contract, payload, prepare };
  }

  it("refuses Business Users, unreachable or archived Contracts, foreign Versions and duplicate Signers", async () => {
    const { contract, payload, prepare } = await ready();
    const denied = await harness.app.inject({
      method: "POST",
      url: `/api/v1/contracts/${contract.number}/envelopes/prepare`,
      cookies: as(CONTRIBUTOR),
      payload,
    });
    expect(denied.statusCode).toBe(403);
    expect((await prepare({ documentVersionId: "other-version" })).statusCode).toBe(422);
    expect(
      (
        await prepare({
          signers: [SIGNERS[0], { ...SIGNERS[0], email: SIGNERS[0].email.toUpperCase() }],
        })
      ).statusCode,
    ).toBe(422);
    expect(
      (
        await prepare({
          signers: [{ personId: idOf(MEMBER) }, { name: MEMBER.displayName, email: MEMBER.email }],
        })
      ).statusCode,
    ).toBe(422);
    await harness.db
      .update(contracts)
      .set({ isConfidential: true })
      .where(eq(contracts.id, contract.id));
    const outsider = await harness.app.inject({
      method: "POST",
      url: `/api/v1/contracts/${contract.number}/envelopes/prepare`,
      cookies: as(OUTSIDER),
      payload,
    });
    expect(outsider.statusCode).toBe(404);
    await harness.db
      .update(contracts)
      .set({ archivedAt: new Date() })
      .where(eq(contracts.id, contract.id));
    expect((await prepare()).statusCode).toBe(409);
    expect((await signingState(as(MEMBER), contract.number)).envelopes).toEqual([]);
  });

  it("keeps preparation off until enabled and requires the Signing connector", async () => {
    const { prepare } = await ready();
    harness.app.signingPreparationEnabled = false;
    try {
      expect((await prepare()).statusCode).toBe(404);
    } finally {
      harness.app.signingPreparationEnabled = true;
    }
    await clearConnector();
    const refusal = await prepare();
    expect(refusal.statusCode).toBe(409);
    expect(refusal.json().type).toBe(SIGNING_NOT_CONFIGURED_PROBLEM_TYPE);
  });

  it("resolves an internal Signer and keeps the Contract Stage", async () => {
    const { contract, prepare } = await ready();
    const [before] = await harness.db.select().from(contracts).where(eq(contracts.id, contract.id));
    const response = await prepare({ signers: [{ personId: idOf(MEMBER) }, SIGNERS[0]] });
    expect(response.statusCode, response.body).toBe(201);
    expect(response.json().envelopes[0].signers).toEqual([
      { name: MEMBER.displayName, email: MEMBER.email },
      SIGNERS[0],
    ]);
    const [after] = await harness.db.select().from(contracts).where(eq(contracts.id, contract.id));
    expect(after!.statusId).toBe(before!.statusId);
    expect(await entriesOn(contract.id)).toEqual([]);
  });

  it("reserves before creation, against concurrent preparations and direct send", async () => {
    // Isolate the removal check from sent rounds left by earlier cases.
    await harness.db.delete(contractEnvelopes);
    const { contract, payload, prepare } = await ready();
    let release!: () => void;
    let entered!: () => void;
    const started = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const wait = new Promise<void>((resolve) => {
      release = resolve;
    });
    const original = provider().prepareEnvelope.bind(provider());
    const hold = vi.spyOn(provider(), "prepareEnvelope").mockImplementationOnce(async (input) => {
      entered();
      await wait;
      return original(input);
    });
    const pending = prepare().then((response) => response);
    try {
      await started;
      const reading = await signingState(as(MEMBER), contract.number);
      expect(reading.envelopes[0]).toMatchObject({ status: "preparing", sentAt: null });
      const [intent] = await harness.db
        .select()
        .from(contractEnvelopes)
        .where(eq(contractEnvelopes.contractId, contract.id));
      expect(intent).toMatchObject({
        providerEnvelopeId: null,
        providerAccountId: "fake-account-0001",
        providerEnvironment: "demo",
        subject: payload.subject,
      });
      expect(intent!.providerTransactionId).toBeTruthy();
      expect((await prepare({ idempotencyKey: "another-key" })).statusCode).toBe(409);
      expect((await send(as(MEMBER), contract.number, payload.documentVersionId)).statusCode).toBe(
        409,
      );
      expect((await prepare()).json().envelopes[0].id).toBe(intent!.id);
      const removal = await harness.app.inject({
        method: "DELETE",
        url: "/api/v1/signing-connectors/docusign",
        cookies: as(ADMIN),
      });
      expect(removal.statusCode).toBe(409);
    } finally {
      release();
      hold.mockRestore();
    }
    expect((await pending).statusCode).toBe(201);
    expect((await signingState(as(MEMBER), contract.number)).envelopes).toHaveLength(1);
    const draftRemoval = await harness.app.inject({
      method: "DELETE",
      url: "/api/v1/signing-connectors/docusign",
      cookies: as(ADMIN),
    });
    expect(draftRemoval.statusCode).toBe(409);
  });

  it("keeps an uncertain creation reserved and never creates again for a matching retry", async () => {
    const { contract, payload, prepare } = await ready();
    const original = provider().prepareEnvelope.bind(provider());
    const lost = vi.spyOn(provider(), "prepareEnvelope").mockImplementationOnce(async (input) => {
      await original(input);
      throw new SigningTimeoutError("The response was lost.");
    });
    try {
      expect((await prepare()).statusCode).toBe(502);
    } finally {
      lost.mockRestore();
    }
    const [intent] = await harness.db
      .select()
      .from(contractEnvelopes)
      .where(eq(contractEnvelopes.contractId, contract.id));
    expect(intent).toMatchObject({
      status: "preparing",
      preparationState: "uncertain",
      providerEnvelopeId: null,
      sentAt: null,
    });
    const count = provider().sentEnvelopeIds().length;
    expect((await prepare()).json().envelopes[0].id).toBe(intent!.id);
    expect(provider().sentEnvelopeIds()).toHaveLength(count);
    expect((await prepare({ idempotencyKey: "new-try" })).statusCode).toBe(409);
    expect((await send(as(MEMBER), contract.number, payload.documentVersionId)).statusCode).toBe(
      409,
    );
    expect(await entriesOn(contract.id)).toEqual([]);
  });

  const recover = (id: string) =>
    recoverEnvelope(
      {
        db: harness.db,
        notifier: harness.notifier,
        resolveSigningProvider: harness.resolveSigningProvider,
        log: { info() {}, warn() {}, error() {} },
      },
      harness.pipeline,
      id,
    );
  const publishedRound = async (contractId: string) => {
    const [record] = await harness.db
      .select({ number: contracts.number })
      .from(contracts)
      .where(eq(contracts.id, contractId));
    return (await signingState(as(MEMBER), record!.number)).envelopes[0]!;
  };
  const due = (id: string) =>
    harness.db
      .update(contractEnvelopes)
      .set({ nextRecoveryAt: new Date(0) })
      .where(eq(contractEnvelopes.id, id));

  it.each(["draft", "sent"] as const)(
    "recovers a lost %s response once across workers and preserves snapshots",
    async (status) => {
      const { contract, payload, prepare } = await ready();
      const key = crypto.randomUUID();
      const method = status === "draft" ? "prepareEnvelope" : "sendEnvelope";
      const original = provider()[method].bind(provider());
      const lost = vi
        .spyOn(provider(), method)
        .mockImplementationOnce(async (input: SendEnvelopeInput) => {
          await original({ ...input, transactionId: input.transactionId! });
          throw new SigningTimeoutError("Lost answer");
        });
      const request = () =>
        status === "draft" ? prepare() : sendKeyed(contract.number, payload.documentVersionId, key);
      try {
        expect((await request()).statusCode).toBe(502);
      } finally {
        lost.mockRestore();
      }
      const before = await storedRound(contract.id);
      const signers = await harness.db
        .select()
        .from(contractEnvelopeSigners)
        .where(eq(contractEnvelopeSigners.envelopeId, before.id));
      const count = provider().sentEnvelopeIds().length;
      const lookup = vi.spyOn(provider(), "findEnvelope");
      await recover(before.id);
      expect(lookup).not.toHaveBeenCalled();
      await due(before.id);
      await Promise.all([recover(before.id), recover(before.id), recover(before.id)]);
      expect(lookup).toHaveBeenCalledTimes(1);
      lookup.mockRestore();
      const after = await storedRound(contract.id);
      expect(after).toMatchObject({
        id: before.id,
        status,
        preparationState: "created",
        recoveryAttempts: 1,
        subject: before.subject,
        documentVersionId: before.documentVersionId,
        requestFingerprint: before.requestFingerprint,
        providerTransactionId: before.providerTransactionId,
        idempotencyKey: before.idempotencyKey,
      });
      expect(
        await harness.db
          .select()
          .from(contractEnvelopeSigners)
          .where(eq(contractEnvelopeSigners.envelopeId, before.id)),
      ).toEqual(signers);
      expect(await publishedRound(contract.id)).toMatchObject({
        id: before.id,
        status,
        preparationState: "created",
        recoveryAttempts: 1,
        nextRecoveryAt: null,
        recoveryStopped: null,
        signers: SIGNERS,
      });
      expect((await request()).json().envelopes[0].id).toBe(before.id);
      expect(provider().sentEnvelopeIds()).toHaveLength(count);
      const [record] = await harness.db
        .select({ stage: contractStatuses.stage })
        .from(contracts)
        .innerJoin(contractStatuses, eq(contractStatuses.id, contracts.statusId))
        .where(eq(contracts.id, contract.id));
      expect(record!.stage).toBe(status === "sent" ? "signature" : "draft");
    },
  );

  async function interruptedDraft() {
    const readyRound = await ready();
    const original = provider().prepareEnvelope.bind(provider());
    const lost = vi.spyOn(provider(), "prepareEnvelope").mockImplementationOnce(async (input) => {
      await original(input);
      throw new SigningTimeoutError("Lost response");
    });
    try {
      expect((await readyRound.prepare()).statusCode).toBe(502);
    } finally {
      lost.mockRestore();
    }
    const row = await storedRound(readyRound.contract.id);
    await due(row.id);
    return { ...readyRound, row };
  }

  it("retains uncertainty through empty lookup, outage and credential errors with durable backoff", async () => {
    const { row, prepare } = await interruptedDraft();
    const lookup = vi
      .spyOn(provider(), "findEnvelope")
      .mockResolvedValueOnce(null)
      .mockRejectedValueOnce(new SigningUnavailableError("secret response must not be logged"))
      .mockRejectedValueOnce(new SigningConfigError("account unavailable"));
    for (let attempt = 1; attempt <= 3; attempt++) {
      await due(row.id);
      await recover(row.id);
      const held = await storedRound(row.contractId);
      expect(held).toMatchObject({
        status: "preparing",
        recoveryAttempts: attempt,
        recoveryStopped: null,
      });
      const published = await publishedRound(row.contractId);
      expect(published).toMatchObject({
        status: "preparing",
        preparationState: "uncertain",
        recoveryAttempts: attempt,
        recoveryStopped: null,
        signers: SIGNERS,
      });
      expect(new Date(published.nextRecoveryAt!).getTime()).toBeGreaterThan(
        Date.now() + (15 * 2 ** (attempt - 1) - 1) * 60_000,
      );
      await recover(row.id);
      expect(lookup).toHaveBeenCalledTimes(attempt);
      expect((await prepare({ idempotencyKey: crypto.randomUUID() })).statusCode).toBe(409);
    }
    lookup.mockRestore();
    await due(row.id);
    await recover(row.id);
    expect(await storedRound(row.contractId)).toMatchObject({
      status: "draft",
      recoveryAttempts: 4,
    });
  });

  it("logs operation identity without provider errors or Signer details", async () => {
    const { row } = await interruptedDraft();
    const failure = vi
      .spyOn(provider(), "findEnvelope")
      .mockRejectedValueOnce(new Error("credential-and-launch-url-sentinel"));
    const info = vi.fn();
    try {
      await recoverEnvelope(
        {
          db: harness.db,
          notifier: harness.notifier,
          resolveSigningProvider: harness.resolveSigningProvider,
          log: { info, warn() {}, error() {} },
        },
        harness.pipeline,
        row.id,
      );
    } finally {
      failure.mockRestore();
    }
    expect(info).toHaveBeenCalledWith(
      expect.objectContaining({
        envelopeId: row.id,
        providerTransactionId: row.providerTransactionId,
        providerAccountId: row.providerAccountId,
        outcome: "unavailable",
        attempt: 1,
      }),
      "signing creation recovery",
    );
    const output = JSON.stringify(info.mock.calls);
    expect(output).not.toContain("credential-and-launch-url-sentinel");
    for (const signer of SIGNERS) {
      expect(output).not.toContain(signer.name);
      expect(output).not.toContain(signer.email);
    }
  });

  it("does not look up an operation in a different account or environment", async () => {
    const { row } = await interruptedDraft();
    const lookup = vi.spyOn(provider(), "findEnvelope");
    await harness.db
      .update(contractEnvelopes)
      .set({ providerAccountId: "different-account" })
      .where(eq(contractEnvelopes.id, row.id));
    await recover(row.id);
    await harness.db
      .update(contractEnvelopes)
      .set({
        providerAccountId: row.providerAccountId,
        providerEnvironment: "production",
        nextRecoveryAt: new Date(0),
      })
      .where(eq(contractEnvelopes.id, row.id));
    await recover(row.id);
    expect(lookup).not.toHaveBeenCalled();
    lookup.mockRestore();
    expect(await storedRound(row.contractId)).toMatchObject({
      status: "preparing",
      providerEnvelopeId: null,
    });
  });

  it("keeps expired and exhausted operations reserved for an operator, including matching retries", async () => {
    const { row, prepare, payload, contract } = await interruptedDraft();
    await harness.db
      .update(contractEnvelopes)
      .set({ createdAt: new Date(Date.now() - 8 * 86_400_000) })
      .where(eq(contractEnvelopes.id, row.id));
    const lookup = vi.spyOn(provider(), "findEnvelope");
    await recover(row.id);
    expect(lookup).not.toHaveBeenCalled();
    expect(await publishedRound(row.contractId)).toMatchObject({
      signers: SIGNERS,
      recoveryStopped: "lookup_expired",
      nextRecoveryAt: null,
      status: "preparing",
    });
    expect((await prepare()).json().envelopes[0].id).toBe(row.id);
    expect((await prepare({ idempotencyKey: crypto.randomUUID() })).statusCode).toBe(409);
    expect((await send(as(MEMBER), contract.number, payload.documentVersionId)).statusCode).toBe(
      409,
    );
    // An operator supplies a provider-verified id. Its status remains readable after seven days.
    const found = await provider().findEnvelope(row.providerTransactionId!);
    await harness.db
      .update(contractEnvelopes)
      .set({
        providerEnvelopeId: found!.providerEnvelopeId,
        recoveryStopped: null,
        nextRecoveryAt: new Date(0),
      })
      .where(eq(contractEnvelopes.id, row.id));
    lookup.mockClear();
    await recover(row.id);
    expect(lookup).not.toHaveBeenCalled();
    lookup.mockRestore();
    expect(await storedRound(row.contractId)).toMatchObject({ status: "draft" });
    const second = await interruptedDraft();
    await harness.db
      .update(contractEnvelopes)
      .set({ recoveryAttempts: 31 })
      .where(eq(contractEnvelopes.id, second.row.id));
    const empty = vi.spyOn(provider(), "findEnvelope").mockResolvedValue(null);
    await recover(second.row.id);
    await due(second.row.id);
    await recover(second.row.id);
    expect(empty).toHaveBeenCalledTimes(1);
    empty.mockRestore();
    expect(await storedRound(second.row.contractId)).toMatchObject({
      recoveryStopped: "attempts_exhausted",
      recoveryAttempts: 32,
      status: "preparing",
    });
  });

  it.each(["draft", "sent"] as const)(
    "recovers the pending %s left at a process stop boundary before local finalization",
    async (status) => {
      const { row } = await interruptedDraft();
      const found = await provider().findEnvelope(row.providerTransactionId!);
      if (status === "sent") provider().sendDraft(found!.providerEnvelopeId);
      // The durable image left when the process exits after the provider accepts,
      // before either a success or an uncertainty write reaches PostgreSQL.
      await harness.db
        .update(contractEnvelopes)
        .set({ preparationState: "pending" })
        .where(eq(contractEnvelopes.id, row.id));
      await runReconciliationSweep(
        {
          db: harness.db,
          notifier: harness.notifier,
          resolveSigningProvider: harness.resolveSigningProvider,
          log: { info() {}, warn() {}, error() {} },
        },
        harness.pipeline,
      );
      expect(await storedRound(row.contractId)).toMatchObject({
        status,
        providerEnvelopeId: found!.providerEnvelopeId,
      });
      expect(await publishedRound(row.contractId)).toMatchObject({
        status,
        preparationState: "created",
        recoveryAttempts: 1,
        nextRecoveryAt: null,
        recoveryStopped: null,
        signers: SIGNERS,
      });
    },
  );

  it("recovers a provider draft after PostgreSQL rejects the local finalization", async () => {
    const { contract, prepare } = await ready();
    await harness.db.execute(
      sql`CREATE FUNCTION fail_draft_finalization() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.status = 'draft' THEN RAISE EXCEPTION 'simulated commit failure'; END IF; RETURN NEW; END $$`,
    );
    await harness.db.execute(
      sql`CREATE TRIGGER fail_draft_finalization BEFORE UPDATE ON contract_envelopes FOR EACH ROW EXECUTE FUNCTION fail_draft_finalization()`,
    );
    try {
      expect((await prepare()).statusCode).toBe(500);
    } finally {
      await harness.db.execute(sql`DROP TRIGGER fail_draft_finalization ON contract_envelopes`);
      await harness.db.execute(sql`DROP FUNCTION fail_draft_finalization()`);
    }
    const row = await storedRound(contract.id);
    expect(row).toMatchObject({
      status: "preparing",
      preparationState: "pending",
      providerEnvelopeId: null,
    });
    const count = provider().sentEnvelopeIds().length;
    await due(row.id);
    await recover(row.id);
    expect(await storedRound(contract.id)).toMatchObject({
      id: row.id,
      status: "draft",
      subject: row.subject,
      documentVersionId: row.documentVersionId,
    });
    expect(provider().sentEnvelopeIds()).toHaveLength(count);
  });

  it("refuses to void a draft, which has not been sent", async () => {
    const { contract, prepare } = await ready();
    expect((await prepare()).statusCode).toBe(201);
    const [draft] = await harness.db
      .select()
      .from(contractEnvelopes)
      .where(eq(contractEnvelopes.contractId, contract.id));
    const voided = await harness.app.inject({
      method: "POST",
      url: `/api/v1/envelopes/${draft!.id}/void`,
      cookies: as(MEMBER),
      payload: { reason: "Not needed" },
    });
    expect(voided.statusCode).toBe(409);
    expect(voided.json().detail).toContain("has not been sent");
    expect(await harness.signing!.readEnvelope(draft!.providerEnvelopeId!)).toMatchObject({
      status: "draft",
    });
  });

  it("leaves no row for a direct send the provider refuses, and sends on the retry", async () => {
    const { contract, payload } = await ready();
    const refusal = vi
      .spyOn(provider(), "sendEnvelope")
      .mockRejectedValueOnce(new SigningRefusedError("Rejected"));
    try {
      expect((await send(as(MEMBER), contract.number, payload.documentVersionId)).statusCode).toBe(
        502,
      );
    } finally {
      refusal.mockRestore();
    }
    expect((await signingState(as(MEMBER), contract.number)).envelopes).toEqual([]);
    const retry = await send(as(MEMBER), contract.number, payload.documentVersionId);
    expect(retry.statusCode, retry.body).toBe(201);
    expect(retry.json().envelopes).toMatchObject([{ status: "sent" }]);
  });

  const sendKeyed = (number: number, documentVersionId: string, idempotencyKey: string) =>
    harness.app.inject({
      method: "POST",
      url: `/api/v1/contracts/${number}/envelopes`,
      cookies: as(MEMBER),
      payload: { documentVersionId, signers: [...SIGNERS], idempotencyKey },
    });

  const storedRound = async (contractId: string) => {
    const rows = await harness.db
      .select()
      .from(contractEnvelopes)
      .where(eq(contractEnvelopes.contractId, contractId));
    expect(rows).toHaveLength(1);
    return rows[0]!;
  };

  it("leaves no row when the stored file cannot be read, and sends on the retry", async () => {
    const { contract, payload } = await ready();
    const idsBefore = provider().sentEnvelopeIds().length;
    const [source] = await harness.db
      .select({ fileRef: documentVersions.fileRef })
      .from(documentVersions)
      .where(eq(documentVersions.id, payload.documentVersionId));
    // Only this version's file fails, for as long as the send runs. A
    // one-shot rejection could be spent by a pipeline job still reading
    // the upload, and the send would then go out.
    const storage = harness.app.storage;
    const read = storage.get.bind(storage);
    const unreadable = vi
      .spyOn(storage, "get")
      .mockImplementation((ref) =>
        ref === source!.fileRef ? Promise.reject(new Error("The disk went away.")) : read(ref),
      );
    try {
      const response = await send(as(MEMBER), contract.number, payload.documentVersionId);
      expect(response.statusCode).toBe(500);
    } finally {
      unreadable.mockRestore();
    }
    expect(provider().sentEnvelopeIds()).toHaveLength(idsBefore);
    expect((await signingState(as(MEMBER), contract.number)).envelopes).toEqual([]);
    const retry = await send(as(MEMBER), contract.number, payload.documentVersionId);
    expect(retry.statusCode, retry.body).toBe(201);
  });

  it.each([
    ["timeout", () => new SigningTimeoutError("The answer was lost.")],
    ["unavailable", () => new SigningUnavailableError("The connection dropped.")],
  ])(
    "keeps a direct send reserved when the provider accepts it and the answer is lost (%s)",
    async (_, lostAnswer) => {
      const { contract, payload, prepare } = await ready();
      const [before] = await harness.db
        .select()
        .from(contracts)
        .where(eq(contracts.id, contract.id));
      const idsBefore = new Set(provider().sentEnvelopeIds());
      const created = () =>
        provider()
          .sentEnvelopeIds()
          .filter((id) => !idsBefore.has(id));
      const key = crypto.randomUUID();
      // The fake really takes the envelope, and only the answer is lost.
      const original = provider().sendEnvelope.bind(provider());
      const lost = vi.spyOn(provider(), "sendEnvelope").mockImplementationOnce(async (input) => {
        await original(input);
        throw lostAnswer();
      });
      let response;
      try {
        response = await sendKeyed(contract.number, payload.documentVersionId, key);
      } finally {
        lost.mockRestore();
      }
      expect(response.statusCode, response.body).toBe(502);
      expect(response.json().detail).toContain("stays reserved");
      expect(created()).toHaveLength(1);
      expect(await provider().readEnvelope(created()[0]!)).toMatchObject({ status: "sent" });

      // The reservation and its recovery evidence are all still there.
      const intent = await storedRound(contract.id);
      expect(intent).toMatchObject({
        status: "preparing",
        preparationState: "uncertain",
        providerEnvelopeId: null,
        sentAt: null,
        idempotencyKey: key,
        providerAccountId: "fake-account-0001",
        providerEnvironment: "demo",
        documentVersionId: payload.documentVersionId,
        sentBy: idOf(MEMBER),
      });
      expect(intent.providerTransactionId).toBeTruthy();
      expect(intent.documentId).toBeTruthy();
      expect(intent.requestFingerprint).toBeTruthy();
      expect(
        await harness.db
          .select()
          .from(contractEnvelopeSigners)
          .where(eq(contractEnvelopeSigners.envelopeId, intent.id)),
      ).toHaveLength(SIGNERS.length);

      // A matching keyed retry answers with the same round and creates nothing.
      const retry = await sendKeyed(contract.number, payload.documentVersionId, key);
      expect(retry.statusCode, retry.body).toBe(201);
      expect(retry.json().envelopes).toMatchObject([
        { id: intent.id, status: "preparing", preparationState: "uncertain" },
      ]);
      // Another direct send and a new preparation are both refused.
      const again = await send(as(MEMBER), contract.number, payload.documentVersionId);
      expect(again.statusCode).toBe(409);
      expect(again.json().type).toBe(ENVELOPE_LIVE_PROBLEM_TYPE);
      const prepared = await prepare({ idempotencyKey: crypto.randomUUID() });
      expect(prepared.statusCode).toBe(409);
      expect(prepared.json().type).toBe(ENVELOPE_LIVE_PROBLEM_TYPE);

      expect(created()).toHaveLength(1);
      expect(await storedRound(contract.id)).toMatchObject({ id: intent.id, status: "preparing" });
      expect(await entriesOn(contract.id)).toEqual([]);
      const [after] = await harness.db
        .select()
        .from(contracts)
        .where(eq(contracts.id, contract.id));
      expect(after!.statusId).toBe(before!.statusId);
    },
  );

  it("keeps the provider id and the reservation when a failed send's void is not confirmed", async () => {
    const { contract, payload, prepare } = await ready();
    const [before] = await harness.db.select().from(contracts).where(eq(contracts.id, contract.id));
    const idsBefore = new Set(provider().sentEnvelopeIds());
    const notification = vi
      .spyOn(harness.app.notifier, "statusChanged")
      .mockRejectedValueOnce(new Error("Status notification could not be recorded"));
    const compensation = vi
      .spyOn(provider(), "voidEnvelope")
      .mockRejectedValueOnce(new SigningUnavailableError("The provider went away."));
    let response;
    try {
      response = await send(as(MEMBER), contract.number, payload.documentVersionId);
    } finally {
      notification.mockRestore();
      compensation.mockRestore();
    }
    expect(response.statusCode, response.body).toBe(500);
    const created = provider()
      .sentEnvelopeIds()
      .filter((id) => !idsBefore.has(id));
    expect(created).toHaveLength(1);
    expect(await provider().readEnvelope(created[0]!)).toMatchObject({ status: "sent" });

    const kept = await storedRound(contract.id);
    expect(kept).toMatchObject({
      status: "preparing",
      preparationState: "uncertain",
      providerEnvelopeId: created[0],
      sentAt: null,
      completedAt: null,
      providerAccountId: "fake-account-0001",
      documentVersionId: payload.documentVersionId,
    });
    expect(kept.providerTransactionId).toBeTruthy();

    const again = await send(as(MEMBER), contract.number, payload.documentVersionId);
    expect(again.statusCode).toBe(409);
    expect(again.json().type).toBe(ENVELOPE_LIVE_PROBLEM_TYPE);
    const prepared = await prepare({ idempotencyKey: crypto.randomUUID() });
    expect(prepared.statusCode).toBe(409);
    expect(prepared.json().type).toBe(ENVELOPE_LIVE_PROBLEM_TYPE);
    expect(
      provider()
        .sentEnvelopeIds()
        .filter((id) => !idsBefore.has(id)),
    ).toHaveLength(1);
    expect(await entriesOn(contract.id)).toEqual([]);
    const [after] = await harness.db.select().from(contracts).where(eq(contracts.id, contract.id));
    expect(after!.statusId).toBe(before!.statusId);
  });

  it.each(["sent", "voided"] as const)(
    "settles an unconfirmed compensating Void from provider evidence: %s",
    async (status) => {
      const { contract, payload } = await ready();
      const failure = vi
        .spyOn(harness.notifier, "statusChanged")
        .mockRejectedValueOnce(new Error("commit failed"));
      const originalVoid = provider().voidEnvelope.bind(provider());
      const voiding = vi
        .spyOn(provider(), "voidEnvelope")
        .mockImplementationOnce(async (...args) => {
          if (status === "voided") await originalVoid(...args);
          throw new SigningTimeoutError("Lost Void response");
        });
      try {
        expect(
          (await sendKeyed(contract.number, payload.documentVersionId, "compensation")).statusCode,
        ).toBe(500);
      } finally {
        failure.mockRestore();
        voiding.mockRestore();
      }
      const row = await storedRound(contract.id);
      expect(row.providerEnvelopeId).toBeTruthy();
      await due(row.id);
      const lookup = vi.spyOn(provider(), "findEnvelope");
      await recover(row.id);
      expect(lookup).not.toHaveBeenCalled();
      lookup.mockRestore();
      const [record] = await harness.db
        .select({ stage: contractStatuses.stage })
        .from(contracts)
        .innerJoin(contractStatuses, eq(contractStatuses.id, contracts.statusId))
        .where(eq(contracts.id, contract.id));
      expect(record!.stage).toBe(status === "sent" ? "signature" : "draft");
      expect(await storedRound(contract.id)).toMatchObject({
        status,
        providerEnvelopeId: row.providerEnvelopeId,
      });
    },
  );

  it("files a recovered direct send that already completed and advances through Signature to Active", async () => {
    const { contract, payload } = await ready();
    const original = provider().sendEnvelope.bind(provider());
    const lost = vi.spyOn(provider(), "sendEnvelope").mockImplementationOnce(async (input) => {
      const result = await original(input);
      provider().complete(result.providerEnvelopeId);
      throw new SigningTimeoutError("Lost completed send response");
    });
    try {
      expect(
        (await sendKeyed(contract.number, payload.documentVersionId, "completed-intent"))
          .statusCode,
      ).toBe(502);
    } finally {
      lost.mockRestore();
    }
    const row = await storedRound(contract.id);
    await due(row.id);
    await recover(row.id);
    await vi.waitFor(
      async () => {
        expect(await storedRound(contract.id)).toMatchObject({
          status: "signed",
          executedFetch: "ready",
        });
      },
      { timeout: 30_000, interval: 50 },
    );
    const [after] = await harness.db
      .select({ stage: contractStatuses.stage })
      .from(contracts)
      .innerJoin(contractStatuses, eq(contractStatuses.id, contracts.statusId))
      .where(eq(contracts.id, contract.id));
    expect(after!.stage).toBe("active");
  });

  it.each(["changed", "changed-back", "unrelated-edit", "unknown-kind"] as const)(
    "respects original direct-send intent and newer Status choices: %s",
    async (scenario) => {
      const { contract, payload } = await ready();
      const original = provider().sendEnvelope.bind(provider());
      const lost = vi.spyOn(provider(), "sendEnvelope").mockImplementationOnce(async (input) => {
        await original(input);
        throw new SigningTimeoutError("Lost send response");
      });
      try {
        expect(
          (await sendKeyed(contract.number, payload.documentVersionId, "intent")).statusCode,
        ).toBe(502);
      } finally {
        lost.mockRestore();
      }
      const row = await storedRound(contract.id);
      const [initial] = await harness.db
        .select()
        .from(contracts)
        .where(eq(contracts.id, contract.id));
      const [review] = await harness.db
        .select()
        .from(contractStatuses)
        .where(eq(contractStatuses.stage, "review"));
      const patch = async (payload: Record<string, unknown>) => {
        const response = await harness.app.inject({
          method: "PATCH",
          url: `/api/v1/contracts/${contract.number}`,
          cookies: as(MEMBER),
          payload,
        });
        expect(response.statusCode, response.body).toBe(200);
      };
      if (scenario === "changed" || scenario === "changed-back") {
        await patch({ statusId: review!.id });
        if (scenario === "changed-back") await patch({ statusId: initial!.statusId });
      } else if (scenario === "unrelated-edit") await patch({ title: "An unrelated edit" });
      else
        await harness.db
          .update(contractEnvelopes)
          .set({ creationKind: null, creationStatusId: null, creationStatusRevision: null })
          .where(eq(contractEnvelopes.id, row.id));
      await due(row.id);
      await recover(row.id);
      expect(await storedRound(contract.id)).toMatchObject({ status: "sent" });
      const [after] = await harness.db
        .select({ statusId: contracts.statusId, stage: contractStatuses.stage })
        .from(contracts)
        .innerJoin(contractStatuses, eq(contractStatuses.id, contracts.statusId))
        .where(eq(contracts.id, contract.id));
      if (scenario === "unrelated-edit") expect(after!.stage).toBe("signature");
      else expect(after!.statusId).toBe(scenario === "changed" ? review!.id : initial!.statusId);
    },
  );

  it.each(["draft", "send"] as const)(
    "settles proven pre-submission %s failures without retaining the live reservation",
    async (kind) => {
      const { contract, payload, prepare } = await ready();
      const method = kind === "draft" ? "prepareEnvelope" : "sendEnvelope";
      const failed = vi.spyOn(provider(), method).mockRejectedValueOnce(
        new SigningNotSubmittedError("Not submitted", {
          cause: new SigningConfigError("Refresh refused"),
        }),
      );
      const before = provider().sentEnvelopeIds().length;
      try {
        const response =
          kind === "draft"
            ? await prepare()
            : await sendKeyed(contract.number, payload.documentVersionId, "pre-submit");
        expect(response.statusCode).toBe(502);
      } finally {
        failed.mockRestore();
      }
      expect(provider().sentEnvelopeIds()).toHaveLength(before);
      const state = await signingState(as(MEMBER), contract.number);
      if (kind === "draft")
        expect(state.envelopes).toMatchObject([
          { status: "preparation_failed", preparationState: "failed" },
        ]);
      else expect(state.envelopes).toEqual([]);
      expect((await prepare({ idempotencyKey: "new-after-nonsubmission" })).statusCode).toBe(201);
    },
  );

  it.each(["draft", "send"] as const)(
    "retains a submitted %s when a generic credential error hides the response",
    async (kind) => {
      const { contract, payload, prepare } = await ready();
      const method = kind === "draft" ? "prepareEnvelope" : "sendEnvelope";
      const original = provider()[method].bind(provider());
      const failed = vi
        .spyOn(provider(), method)
        .mockImplementationOnce(async (input: SendEnvelopeInput) => {
          await original({ ...input, transactionId: input.transactionId! });
          throw new SigningConfigError("Ambiguous credentials error");
        });
      try {
        const response =
          kind === "draft"
            ? await prepare()
            : await sendKeyed(contract.number, payload.documentVersionId, "post-submit");
        expect(response.statusCode).toBe(502);
      } finally {
        failed.mockRestore();
      }
      expect(await publishedRound(contract.id)).toMatchObject({
        status: "preparing",
        preparationState: "uncertain",
        signers: SIGNERS,
      });
      expect((await prepare({ idempotencyKey: "cannot-bypass" })).statusCode).toBe(409);
      const row = await storedRound(contract.id);
      await due(row.id);
      await recover(row.id);
      expect(await publishedRound(contract.id)).toMatchObject({
        id: row.id,
        status: kind === "draft" ? "draft" : "sent",
        preparationState: "created",
        recoveryAttempts: 1,
      });
    },
  );

  it("keeps embedded preparation Stage behavior when the recovered provider Envelope was sent", async () => {
    const { row, contract } = await interruptedDraft();
    const found = await provider().findEnvelope(row.providerTransactionId!);
    provider().sendDraft(found!.providerEnvelopeId);
    await recover(row.id);
    expect(await publishedRound(contract.id)).toMatchObject({
      status: "sent",
      preparationState: "created",
      signers: SIGNERS,
    });
    const [record] = await harness.db
      .select({ stage: contractStatuses.stage })
      .from(contracts)
      .innerJoin(contractStatuses, eq(contractStatuses.id, contracts.statusId))
      .where(eq(contracts.id, contract.id));
    expect(record!.stage).toBe("draft");
  });

  it("records a confirmed refusal without keeping the live reservation", async () => {
    const { prepare } = await ready();
    const refusal = vi
      .spyOn(provider(), "prepareEnvelope")
      .mockRejectedValueOnce(new SigningRefusedError("Rejected"));
    try {
      expect((await prepare()).statusCode).toBe(502);
    } finally {
      refusal.mockRestore();
    }
    const same = await prepare();
    expect(same.json().envelopes[0]).toMatchObject({
      status: "preparation_failed",
      preparationState: "failed",
      sentAt: null,
    });
    expect((await prepare({ idempotencyKey: "corrected-attempt" })).statusCode).toBe(201);
  });
});

describe("authenticated Sender View launch and return", () => {
  async function draft() {
    await configureConnector();
    const contract = await newContract("Sender View return");
    await paperOn(contract.number, Buffer.from("one"), Buffer.from("two"));
    const before = await signingState(as(MEMBER), contract.number);
    const response = await harness.app.inject({
      method: "POST",
      url: `/api/v1/contracts/${contract.number}/envelopes/prepare`,
      cookies: as(MEMBER),
      payload: {
        documentVersionId: before.primaryDocument!.versions[0]!.id,
        signers: [...SIGNERS],
        idempotencyKey: "launch-round",
      },
    });
    expect(response.statusCode, response.body).toBe(201);
    const [envelope] = await harness.db
      .select()
      .from(contractEnvelopes)
      .where(eq(contractEnvelopes.id, response.json().envelopes[0].id));
    return { contract, envelope: envelope! };
  }
  async function launch(id: string) {
    return harness.app.inject({
      method: "POST",
      url: `/api/v1/envelopes/${id}/launch`,
      cookies: as(MEMBER),
    });
  }
  async function returned(event: string, returnUrl = harness.signing!.launches.at(-1)!.returnUrl) {
    const url = new URL(returnUrl);
    url.searchParams.set("event", event);
    const response = await harness.app.inject({ method: "GET", url: url.pathname + url.search });
    expect(response.statusCode).toBe(302);
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(response.headers["referrer-policy"]).toBe("no-referrer");
    expect(response.headers.location).toBe("/signing/return");
    const cookie = response.cookies.find((item) => item.name === "openlaw-signing-return")!;
    return { "openlaw-signing-return": cookie.value };
  }
  const confirm = (cookies: Record<string, string>) =>
    harness.app.inject({ method: "POST", url: "/api/v1/signing/return", cookies });

  it("resumes saved fields on the same Envelope with a fresh URL and no upload", async () => {
    const { envelope, contract } = await draft();
    const first = await launch(envelope.id);
    const provider = harness.signing!;
    provider.saveFields(envelope.providerEnvelopeId!, [{ signer: 1, page: 2, value: "Approved" }]);
    await confirm({ ...as(MEMBER), ...(await returned("save")) });
    const second = await launch(envelope.id);
    expect(second.statusCode, second.body).toBe(200);
    expect(second.json().url).not.toBe(first.json().url);
    expect(provider.fieldsOf(envelope.providerEnvelopeId!)).toEqual([
      { signer: 1, page: 2, value: "Approved" },
    ]);
    expect((await signingState(as(MEMBER), contract.number)).envelopes).toHaveLength(1);
    expect(provider.launches.slice(-2).map((item) => item.providerEnvelopeId)).toEqual([
      envelope.providerEnvelopeId,
      envelope.providerEnvelopeId,
    ]);
  });

  it("coordinates concurrent launch requests but does not revoke an earlier browser session", async () => {
    const { envelope } = await draft();
    let release!: () => void;
    let entered!: () => void;
    const started = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const original = harness.signing!.launchEnvelope.bind(harness.signing!);
    const opening = vi
      .spyOn(harness.signing!, "launchEnvelope")
      .mockImplementationOnce(async (...args) => {
        entered();
        await gate;
        return original(...args);
      });
    const first = launch(envelope.id);
    await started;
    const second = await launch(envelope.id);
    release();
    expect((await first).statusCode).toBe(200);
    expect(second.statusCode, second.body).toBe(409);
    opening.mockRestore();
    expect((await launch(envelope.id)).statusCode).toBe(200);
  });

  it("retains cancel and missing outcomes, and records only confirmed native discard", async () => {
    const { envelope, contract } = await draft();
    await launch(envelope.id);
    await confirm({ ...as(MEMBER), ...(await returned("cancel")) });
    expect((await signingState(as(MEMBER), contract.number)).envelopes[0]!.status).toBe("draft");
    harness.signing!.discardDraft(envelope.providerEnvelopeId!);
    await harness.db
      .update(contractEnvelopes)
      .set({ nextReconcileAt: null })
      .where(eq(contractEnvelopes.id, envelope.id));
    await launch(envelope.id);
    const history = (await signingState(as(MEMBER), contract.number)).envelopes;
    expect(history).toHaveLength(1);
    expect(history[0]).toMatchObject({
      status: "discarded",
      sentAt: null,
      confirmationPending: false,
    });
    const activity = await harness.db
      .select()
      .from(activityLog)
      .where(eq(activityLog.entityId, contract.id));
    expect(activity.filter((row) => row.action === "envelope.discarded")).toHaveLength(1);
    expect(activity.filter((row) => row.action === "envelope.sent")).toHaveLength(0);
  });

  it("keeps a send that wins the native discard race on its existing history", async () => {
    const { envelope, contract } = await draft();
    await launch(envelope.id);
    harness.signing!.sendDraft(envelope.providerEnvelopeId!);
    expect(() => harness.signing!.discardDraft(envelope.providerEnvelopeId!)).toThrow();
    await confirm({ ...as(MEMBER), ...(await returned("cancel")) });
    expect((await signingState(as(MEMBER), contract.number)).envelopes[0]!.status).toBe("sent");
    expect((await launch(envelope.id)).statusCode).toBe(409);
  });

  it("enforces role, eligibility and Confidential reach on Resume", async () => {
    const { envelope, contract } = await draft();
    const openAs = (who: typeof MEMBER | typeof OUTSIDER | typeof ADMIN | typeof CONTRIBUTOR) =>
      harness.app.inject({
        method: "POST",
        url: `/api/v1/envelopes/${envelope.id}/launch`,
        cookies: as(who),
      });
    expect((await openAs(CONTRIBUTOR)).statusCode).toBe(403);
    expect((await openAs(OUTSIDER)).statusCode).toBe(403);
    expect((await openAs(ADMIN)).statusCode).toBe(200);
    await harness.db
      .update(contracts)
      .set({ isConfidential: true })
      .where(eq(contracts.id, contract.id));
    expect((await openAs(ADMIN)).statusCode).toBe(404);
    expect((await openAs(MEMBER)).statusCode).toBe(200);
  });

  it.each([
    [new EnvelopeNotFoundError("missing"), 409, "could not find"],
    [
      new EnvelopeAccessError("The Signing user cannot access this Envelope."),
      403,
      "cannot access",
    ],
    [new EnvelopeEditConflictError("locked"), 409, "another editing session"],
    [new EnvelopeEditConflictError("not_draft"), 409, "no longer editable"],
    [new SigningUnavailableError("offline"), 502, "temporarily unavailable"],
  ])("retains the same reservation after %s", async (error, status, detail) => {
    const { envelope, contract } = await draft();
    const opening = vi.spyOn(harness.signing!, "launchEnvelope").mockRejectedValueOnce(error);
    try {
      const response = await launch(envelope.id);
      expect(response.statusCode).toBe(status);
      expect(response.json().detail).toContain(detail);
      const state = await signingState(as(MEMBER), contract.number);
      expect(state.envelopes).toHaveLength(1);
      expect(state.envelopes[0]).toMatchObject({ status: "draft", sentAt: null });
    } finally {
      opening.mockRestore();
    }
    expect((await launch(envelope.id)).statusCode).toBe(200);
  });

  it("recovers an abandoned launch claim and lets the current Legal Owner resume", async () => {
    const { envelope, contract } = await draft();
    await harness.db
      .update(contractEnvelopes)
      .set({ launchClaimExpiresAt: new Date(0) })
      .where(eq(contractEnvelopes.id, envelope.id));
    await harness.db
      .update(contracts)
      .set({ managerId: idOf(OUTSIDER) })
      .where(eq(contracts.id, contract.id));
    const response = await harness.app.inject({
      method: "POST",
      url: `/api/v1/envelopes/${envelope.id}/launch`,
      cookies: as(OUTSIDER),
    });
    expect(response.statusCode, response.body).toBe(200);
  });

  it("does not regress a sent Envelope when a delayed discard observation arrives", async () => {
    const { envelope, contract } = await draft();
    await applyEnvelopeStatus(harness.app.notifier, {
      provider: "docusign",
      providerEnvelopeId: envelope.providerEnvelopeId!,
      status: "sent",
    });
    await applyEnvelopeStatus(harness.app.notifier, {
      provider: "docusign",
      providerEnvelopeId: envelope.providerEnvelopeId!,
      status: "discarded",
    });
    expect((await signingState(as(MEMBER), contract.number)).envelopes[0]!.status).toBe("sent");
  });

  it("launches only after durable creation, preserves the read allowance, and confirms one send without changing Stage", async () => {
    const { envelope, contract } = await draft();
    const [initialContract] = await harness.db
      .select()
      .from(contracts)
      .where(eq(contracts.id, contract.id));
    const envelopeStatusBefore = initialContract!.statusId;
    const confirmedSentAt = new Date("2026-09-25T12:00:00Z");
    const read = vi
      .spyOn(harness.signing!, "readEnvelope")
      .mockResolvedValueOnce({ status: "sent", sentAt: confirmedSentAt });
    const response = await launch(envelope.id);
    expect(response.statusCode, response.body).toBe(200);
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(read).not.toHaveBeenCalled();
    expect(harness.signing!.launches.at(-1)!.providerEnvelopeId).toBe(envelope.providerEnvelopeId);
    harness.signing!.sendDraft(envelope.providerEnvelopeId!);
    const cookies = { ...as(MEMBER), ...(await returned("SeNd")) };
    const result = await confirm(cookies);
    expect(result.statusCode, result.body).toBe(200);
    expect(result.json()).toEqual({
      destination: `/contracts/${contract.number}/signatures`,
      waiting: false,
    });
    expect(read).toHaveBeenCalledTimes(1);
    const [stored] = await harness.db
      .select()
      .from(contractEnvelopes)
      .where(eq(contractEnvelopes.id, envelope.id));
    expect(stored).toMatchObject({ status: "sent", confirmationPending: false });
    expect(stored!.sentAt).toEqual(confirmedSentAt);
    expect(await entriesOn(contract.id)).toHaveLength(1);
    const [record] = await harness.db.select().from(contracts).where(eq(contracts.id, contract.id));
    expect(record!.statusId).toBe(envelopeStatusBefore);
    expect((await confirm(cookies)).statusCode).toBe(404);
    expect(read).toHaveBeenCalledTimes(1);
    read.mockRestore();
  });

  it("refuses a sibling-origin return before consuming its correlation or read allowance", async () => {
    const { envelope, contract } = await draft();
    await launch(envelope.id);
    harness.signing!.sendDraft(envelope.providerEnvelopeId!);
    const cookies = { ...as(MEMBER), ...(await returned("send")) };
    const read = vi.spyOn(harness.signing!, "readEnvelope");
    const denied = await harness.app.inject({
      method: "POST",
      url: "/api/v1/signing/return",
      cookies,
      headers: { origin: "https://sibling.example.test", "sec-fetch-site": "same-site" },
    });
    expect(denied.statusCode).toBe(403);
    expect(read).not.toHaveBeenCalled();
    expect(await entriesOn(contract.id)).toHaveLength(0);
    const [correlation] = await harness.db
      .select()
      .from(envelopeLaunches)
      .where(eq(envelopeLaunches.envelopeId, envelope.id));
    expect(correlation!.consumedAt).toBeNull();
    const [unchanged] = await harness.db
      .select()
      .from(contractEnvelopes)
      .where(eq(contractEnvelopes.id, envelope.id));
    expect(unchanged!.nextReconcileAt).toBeNull();
    expect((await confirm(cookies)).statusCode).toBe(200);
    expect(read).toHaveBeenCalledTimes(1);
    expect(await entriesOn(contract.id)).toHaveLength(1);
    read.mockRestore();
  });

  it("keeps a premature Send return waiting without spending another read", async () => {
    const { envelope, contract } = await draft();
    await launch(envelope.id);
    const read = vi.spyOn(harness.signing!, "readEnvelope");
    const response = await confirm({ ...as(MEMBER), ...(await returned("SeNd")) });
    expect(response.statusCode, response.body).toBe(200);
    expect(response.json().waiting).toBe(true);
    expect((await signingState(as(MEMBER), contract.number)).envelopes[0]).toMatchObject({
      status: "draft",
      confirmationPending: true,
      sentAt: null,
    });
    expect(await entriesOn(contract.id)).toHaveLength(0);
    expect((await launch(envelope.id)).statusCode).toBe(200);
    harness.signing!.sendDraft(envelope.providerEnvelopeId!);
    expect((await confirm({ ...as(MEMBER), ...(await returned("send")) })).json().waiting).toBe(
      true,
    );
    expect(read).toHaveBeenCalledTimes(1);
    read.mockRestore();
  });

  it("does not spend another read for a delayed confirmation, including after a failed check", async () => {
    const { envelope } = await draft();
    await launch(envelope.id);
    const read = vi
      .spyOn(harness.signing!, "readEnvelope")
      .mockRejectedValueOnce(new SigningTimeoutError("timeout"));
    expect((await confirm({ ...as(MEMBER), ...(await returned("SAVE")) })).json().waiting).toBe(
      true,
    );
    await launch(envelope.id);
    expect((await confirm({ ...as(MEMBER), ...(await returned("send")) })).json().waiting).toBe(
      true,
    );
    expect(read).toHaveBeenCalledTimes(1);
    const state = await harness.db
      .select()
      .from(contractEnvelopes)
      .where(eq(contractEnvelopes.id, envelope.id));
    expect(state[0]).toMatchObject({ status: "draft", confirmationPending: true, sentAt: null });
    read.mockRestore();
  });

  it.each(["SAVE", "Cancel", "error", "SessionEnd"])(
    "treats %s only as a hint with no provider ID",
    async (event) => {
      const { envelope, contract } = await draft();
      await launch(envelope.id);
      expect((await confirm({ ...as(MEMBER), ...(await returned(event)) })).statusCode).toBe(200);
      const state = await signingState(as(MEMBER), contract.number);
      expect(state.envelopes[0]).toMatchObject({
        status: "draft",
        sentAt: null,
        confirmationPending: false,
      });
      expect(await entriesOn(contract.id)).toHaveLength(0);
    },
  );

  it("requires sign-in and the original user; altered, expired and unknown returns cannot send", async () => {
    const { envelope, contract } = await draft();
    await launch(envelope.id);
    const cookies = await returned("send");
    expect((await confirm(cookies)).statusCode).toBe(401);
    expect((await confirm({ ...as(OUTSIDER), ...cookies })).statusCode).toBe(404);
    expect(
      (await confirm({ ...as(MEMBER), "openlaw-signing-return": "A".repeat(43) + ".known" }))
        .statusCode,
    ).toBe(404);
    expect((await confirm({ ...as(MEMBER), ...cookies })).statusCode).toBe(200);
    await launch(envelope.id);
    const read = vi.spyOn(harness.signing!, "readEnvelope");
    expect(
      (await confirm({ ...as(MEMBER), ...(await returned("not-a-provider-event")) })).statusCode,
    ).toBe(200);
    expect(read).not.toHaveBeenCalled();
    read.mockRestore();
    await launch(envelope.id);
    await harness.db
      .update(envelopeLaunches)
      .set({ expiresAt: new Date(0) })
      .where(eq(envelopeLaunches.envelopeId, envelope.id));
    const expired = await confirm({ ...as(MEMBER), ...(await returned("send")) });
    expect(expired.statusCode).toBe(200);
    expect(expired.json().destination).toBe(`/contracts/${contract.number}/signatures`);
    expect(expired.body).not.toContain(contract.title);
    expect(await entriesOn(contract.id)).toHaveLength(0);
  });

  it("rejects a changed provider account before checking or revealing a return destination", async () => {
    const { envelope, contract } = await draft();
    await launch(envelope.id);
    const cookies = { ...as(MEMBER), ...(await returned("send")) };
    const original = await harness.signing!.testConnection();
    const account = vi
      .spyOn(harness.signing!, "testConnection")
      .mockResolvedValue({ ...original, accountId: "other-account" });
    const read = vi.spyOn(harness.signing!, "readEnvelope");
    const response = await confirm(cookies);
    expect(response.statusCode).toBe(404);
    expect(response.body).not.toContain(contract.title);
    expect(read).not.toHaveBeenCalled();
    expect((await launch(envelope.id)).statusCode).toBe(409);
    read.mockRestore();
    account.mockRestore();
  });

  it("launch failure leaves the one draft and never falls back to sending", async () => {
    const { envelope, contract } = await draft();
    const failure = vi
      .spyOn(harness.signing!, "launchEnvelope")
      .mockRejectedValueOnce(new Error("private provider session"));
    const response = await launch(envelope.id);
    expect(response.statusCode).toBe(502);
    expect(response.body).not.toContain("private provider session");
    expect((await signingState(as(MEMBER), contract.number)).envelopes[0]!.status).toBe("draft");
    expect(await entriesOn(contract.id)).toHaveLength(0);
    failure.mockRestore();
  });
});

describe("shared browser and worker status allowance", () => {
  it("claims a draft read once across concurrent callers and keeps the full interval", async () => {
    await configureConnector();
    const contract = await newContract("Shared confirmation allowance");
    await paperOn(contract.number, Buffer.from("one"), Buffer.from("two"));
    const before = await signingState(as(MEMBER), contract.number);
    const prepared = await harness.app.inject({
      method: "POST",
      url: `/api/v1/contracts/${contract.number}/envelopes/prepare`,
      cookies: as(MEMBER),
      payload: {
        documentVersionId: before.primaryDocument!.versions[0]!.id,
        signers: [...SIGNERS],
        idempotencyKey: "shared-claim",
      },
    });
    const id = prepared.json().envelopes[0].id as string;
    const read = vi.spyOn(harness.signing!, "readEnvelope");
    const outcomes = await Promise.all([
      checkEnvelopeStatus(harness.db, harness.signing!, id),
      checkEnvelopeStatus(harness.db, harness.signing!, id),
    ]);
    expect(outcomes.filter(Boolean)).toHaveLength(1);
    expect(read).toHaveBeenCalledTimes(1);
    const [stored] = await harness.db
      .select()
      .from(contractEnvelopes)
      .where(eq(contractEnvelopes.id, id));
    expect(stored!.nextReconcileAt!.getTime()).toBeGreaterThan(Date.now() + 14 * 60_000);
    read.mockRestore();
  });

  /** One prepared draft with a fresh launch, as the sweep tests need it. */
  async function launchedDraft(title: string, idempotencyKey: string, launch = true) {
    await configureConnector();
    const contract = await newContract(title);
    await paperOn(contract.number, Buffer.from("one"), Buffer.from("two"));
    const before = await signingState(as(MEMBER), contract.number);
    const prepared = await harness.app.inject({
      method: "POST",
      url: `/api/v1/contracts/${contract.number}/envelopes/prepare`,
      cookies: as(MEMBER),
      payload: {
        documentVersionId: before.primaryDocument!.versions[0]!.id,
        signers: [...SIGNERS],
        idempotencyKey,
      },
    });
    expect(prepared.statusCode, prepared.body).toBe(201);
    const id = prepared.json().envelopes[0].id as string;
    const [row] = await harness.db
      .select()
      .from(contractEnvelopes)
      .where(eq(contractEnvelopes.id, id));
    if (!launch) return { contract, id, providerEnvelopeId: row!.providerEnvelopeId! };
    const launched = await harness.app.inject({
      method: "POST",
      url: `/api/v1/envelopes/${id}/launch`,
      cookies: as(MEMBER),
    });
    expect(launched.statusCode, launched.body).toBe(200);
    return { contract, id, providerEnvelopeId: row!.providerEnvelopeId! };
  }
  const quiet = { info() {}, warn() {}, error() {} };
  const sweep = () =>
    runReconciliationSweep(
      {
        db: harness.db,
        log: quiet,
        resolveSigningProvider: harness.resolveSigningProvider,
        notifier: harness.notifier,
      },
      harness.pipeline,
    );
  const held = async (id: string) =>
    (await harness.db.select().from(contractEnvelopes).where(eq(contractEnvelopes.id, id)))[0]!;
  const openCorrelations = (id: string) =>
    harness.db
      .select()
      .from(envelopeLaunches)
      .where(and(eq(envelopeLaunches.envelopeId, id), isNull(envelopeLaunches.consumedAt)));
  /** Moves the Envelope's open correlation back in time, as if the launch
   * had happened that many minutes ago. Still unconsumed, still valid. */
  const ageLaunch = (id: string, minutes: number) =>
    harness.db
      .update(envelopeLaunches)
      .set({ expiresAt: new Date(Date.now() + (120 - minutes) * 60_000) })
      .where(eq(envelopeLaunches.envelopeId, id));
  /** Moves the Envelope's creation back in time, past the first-read grace. */
  const ageCreation = (id: string, minutes: number) =>
    harness.db
      .update(contractEnvelopes)
      .set({ createdAt: new Date(Date.now() - minutes * 60_000) })
      .where(eq(contractEnvelopes.id, id));

  it("leaves a fresh launch to the browser return, which spends the first read", async () => {
    const { id, providerEnvelopeId } = await launchedDraft("Sweep waits for the return", "grace");
    const read = vi.spyOn(harness.signing!, "readEnvelope");
    const readsOfDraft = () => read.mock.calls.filter(([asked]) => asked === providerEnvelopeId);
    await sweep();
    expect(readsOfDraft()).toHaveLength(0);
    expect(await held(id)).toMatchObject({
      status: "draft",
      confirmationPending: true,
      nextReconcileAt: null,
    });
    // The return consumes the correlation and spends the first read.
    const returnUrl = new URL(harness.signing!.launches.at(-1)!.returnUrl);
    returnUrl.searchParams.set("event", "Save");
    const navigated = await harness.app.inject({
      method: "GET",
      url: returnUrl.pathname + returnUrl.search,
    });
    const cookie = navigated.cookies.find((item) => item.name === "openlaw-signing-return")!;
    const confirmed = await harness.app.inject({
      method: "POST",
      url: "/api/v1/signing/return",
      cookies: { ...as(MEMBER), "openlaw-signing-return": cookie.value },
    });
    expect(confirmed.statusCode, confirmed.body).toBe(200);
    expect(readsOfDraft()).toHaveLength(1);
    // The sweep owns the draft again on the same fifteen-minute allowance.
    await sweep();
    expect(readsOfDraft()).toHaveLength(1);
    await ageCreation(id, 16);
    await harness.db
      .update(contractEnvelopes)
      .set({ nextReconcileAt: new Date(0) })
      .where(eq(contractEnvelopes.id, id));
    await sweep();
    expect(readsOfDraft()).toHaveLength(2);
    expect(await held(id)).toMatchObject({ status: "draft", confirmationPending: false });
    harness.signing!.sendDraft(providerEnvelopeId);
    await harness.db
      .update(contractEnvelopes)
      .set({ nextReconcileAt: new Date(0) })
      .where(eq(contractEnvelopes.id, id));
    await sweep();
    expect(await held(id)).toMatchObject({ status: "sent", confirmationPending: false });
    expect(readsOfDraft()).toHaveLength(3);
    read.mockRestore();
  });

  it("spends no read on a just-created draft, then polls it unlaunched after the grace", async () => {
    const { contract, id, providerEnvelopeId } = await launchedDraft(
      "Created, never opened",
      "unlaunched",
      false,
    );
    expect(await openCorrelations(id)).toHaveLength(0);
    const read = vi.spyOn(harness.signing!, "readEnvelope");
    const readsOfDraft = () => read.mock.calls.filter(([asked]) => asked === providerEnvelopeId);
    // Its creation response is the evidence that it is a draft (#1170 §7):
    // the first tick after creation spends nothing on it.
    await sweep();
    expect(readsOfDraft()).toHaveLength(0);
    expect(await held(id)).toMatchObject({
      status: "draft",
      confirmationPending: false,
      nextReconcileAt: null,
    });
    // Sent through the provider account with no browser session and no
    // webhook. Once the creation grace has passed, the sweep alone learns it.
    harness.signing!.sendDraft(providerEnvelopeId);
    await ageCreation(id, 16);
    const summary = await sweep();
    expect(readsOfDraft()).toHaveLength(1);
    expect(summary.converged).toBeGreaterThanOrEqual(1);
    const row = await held(id);
    expect(row).toMatchObject({ status: "sent", confirmationPending: false });
    expect(row.sentAt).not.toBeNull();
    expect(await entriesOn(contract.id)).toHaveLength(1);
    expect(await openCorrelations(id)).toHaveLength(0);
    read.mockRestore();
  });

  it("keeps a saved draft pollable after a later launch fails", async () => {
    const { id, providerEnvelopeId } = await launchedDraft("Saved, then reopen fails", "reopen");
    // Returned with Save: the correlation is consumed, the draft is saved.
    const returnUrl = new URL(harness.signing!.launches.at(-1)!.returnUrl);
    returnUrl.searchParams.set("event", "Save");
    const navigated = await harness.app.inject({
      method: "GET",
      url: returnUrl.pathname + returnUrl.search,
    });
    const cookie = navigated.cookies.find((item) => item.name === "openlaw-signing-return")!;
    const confirmed = await harness.app.inject({
      method: "POST",
      url: "/api/v1/signing/return",
      cookies: { ...as(MEMBER), "openlaw-signing-return": cookie.value },
    });
    expect(confirmed.statusCode, confirmed.body).toBe(200);
    // A reopen the provider refuses leaves the rows that were there before.
    const failure = vi
      .spyOn(harness.signing!, "launchEnvelope")
      .mockRejectedValueOnce(new Error("session refused"));
    expect(
      (
        await harness.app.inject({
          method: "POST",
          url: `/api/v1/envelopes/${id}/launch`,
          cookies: as(MEMBER),
        })
      ).statusCode,
    ).toBe(502);
    failure.mockRestore();
    expect(
      await harness.db.select().from(envelopeLaunches).where(eq(envelopeLaunches.envelopeId, id)),
    ).toHaveLength(1);
    // Sent from the provider's own console later: the sweep still learns it.
    harness.signing!.sendDraft(providerEnvelopeId);
    await ageCreation(id, 16);
    await harness.db
      .update(contractEnvelopes)
      .set({ nextReconcileAt: new Date(0) })
      .where(eq(contractEnvelopes.id, id));
    await sweep();
    expect(await held(id)).toMatchObject({ status: "sent", confirmationPending: false });
  });

  it("confirms a draft sent without a return once the grace has passed", async () => {
    const { contract, id, providerEnvelopeId } = await launchedDraft(
      "Sent and closed the browser",
      "lost-return-draft",
    );
    // Sent in the provider's screen, browser closed, no return ever comes.
    harness.signing!.sendDraft(providerEnvelopeId);
    await ageCreation(id, 16);
    await ageLaunch(id, 16);
    const read = vi.spyOn(harness.signing!, "readEnvelope");
    const readsOfDraft = () => read.mock.calls.filter(([asked]) => asked === providerEnvelopeId);
    const summary = await sweep();
    expect(readsOfDraft()).toHaveLength(1);
    expect(summary.converged).toBeGreaterThanOrEqual(1);
    const row = await held(id);
    expect(row).toMatchObject({ status: "sent", confirmationPending: false });
    expect(row.sentAt).not.toBeNull();
    expect(row.nextReconcileAt!.getTime()).toBeGreaterThan(Date.now() + 14 * 60_000);
    expect(await entriesOn(contract.id)).toHaveLength(1);
    // The correlation is still open and valid; it was never a lock.
    const [correlation] = await openCorrelations(id);
    expect(correlation!.expiresAt.getTime()).toBeGreaterThan(Date.now());
    read.mockRestore();
  });

  it("keeps polling a sent Envelope to completion while a correlation is still open", async () => {
    const { contract, id, providerEnvelopeId } = await launchedDraft(
      "Notified sent, return lost",
      "lost-return-sent",
    );
    // A verified notification moved the row to sent while the launch is
    // still fresh and its correlation unconsumed.
    harness.signing!.sendDraft(providerEnvelopeId);
    const moved = await applyEnvelopeStatus(harness.notifier, {
      provider: "docusign",
      providerEnvelopeId,
      status: "sent",
    });
    expect(moved.outcome).toBe("applied");
    expect(await held(id)).toMatchObject({ status: "sent", confirmationPending: false });
    expect(await openCorrelations(id)).toHaveLength(1);
    // Then the signers finished. The sweep must learn that now, not in two hours.
    harness.signing!.complete(providerEnvelopeId);
    const read = vi.spyOn(harness.signing!, "readEnvelope");
    const readsOfDraft = () => read.mock.calls.filter(([asked]) => asked === providerEnvelopeId);
    await sweep();
    expect(readsOfDraft()).toHaveLength(1);
    expect(await held(id)).toMatchObject({ status: "signed" });
    // One sent entry from the notification; the signed entry has its own verb.
    expect(await entriesOn(contract.id)).toHaveLength(1);
    const [correlation] = await openCorrelations(id);
    expect(correlation!.expiresAt.getTime()).toBeGreaterThan(Date.now());
    read.mockRestore();
  });

  it("refuses an Envelope from another account without spending the round", async () => {
    await configureConnector();
    const contract = await newContract("Another account's draft");
    await paperOn(contract.number, Buffer.from("one"), Buffer.from("two"));
    const before = await signingState(as(MEMBER), contract.number);
    const prepared = await harness.app.inject({
      method: "POST",
      url: `/api/v1/contracts/${contract.number}/envelopes/prepare`,
      cookies: as(MEMBER),
      payload: {
        documentVersionId: before.primaryDocument!.versions[0]!.id,
        signers: [...SIGNERS],
        idempotencyKey: "other-account",
      },
    });
    const id = prepared.json().envelopes[0].id as string;
    const original = await harness.signing!.testConnection();
    const account = vi
      .spyOn(harness.signing!, "testConnection")
      .mockResolvedValue({ ...original, accountId: "other-account" });
    const read = vi.spyOn(harness.signing!, "readEnvelope");
    await expect(checkEnvelopeStatus(harness.db, harness.signing!, id)).rejects.toBeInstanceOf(
      SigningRefusedError,
    );
    expect(read).not.toHaveBeenCalled();
    read.mockRestore();
    account.mockRestore();
  });
});
