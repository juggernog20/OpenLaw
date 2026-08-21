// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The executed copy landing on the record (#249): the second half of
 * M15's demo sentence, at the HTTP seam, through the real-Postgres
 * harness, the real pg-boss pipeline, and the deterministic fake
 * provider.
 *
 * **The act** — a signer signs, the Connect delivery arrives, and
 * without anybody fetching anything the signed PDF is on the primary
 * document's chain as a new round of kind `executed`, pinned as the
 * document's signed copy, drawn on the envelope's own row, and narrated
 * on the record's feed.
 *
 * **The status advance** — from the signature stage the contract moves
 * to the first live status by display order that maps to `active`,
 * narrated as its own entry with **no actor**. From anywhere else the
 * paper still files, the pin is still set, the completion is still
 * narrated, and the status is left exactly where it was. Both arms are
 * asserted, because "the integration never drags a draft forward and
 * never pulls a finished record back" is one sentence with two halves.
 *
 * **The soft gate** — the advance runs from `signature`, which is
 * already past `approval`, so CTR-012's gate cannot fire on it. It is
 * asserted on a record that holds an unresolved approval: the status
 * still moves, and no override entry is written.
 *
 * **The failure** — a fetch that cannot succeed records a terminal
 * failure on the envelope's own state, the M12 pattern; and a job that
 * was lost between the transition's commit and the queue send is
 * recovered by the boot sweep.
 *
 * Nothing here opens the pipeline's internals or the provider's. The
 * fake is driven, the record is read back over HTTP, and the activity
 * rows are read straight from the table — as the approvals, send, and
 * void suites do.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  activityLog,
  and,
  asc,
  contractEnvelopes,
  contracts,
  contractStatuses,
  desc,
  eq,
  gt,
  inArray,
  users,
  type ContractStage,
} from "@openlaw/db";
import { provisionUser } from "../../auth/instance.js";
import { crossesApprovalGate } from "../../lib/soft-gate.js";
import { FAKE_SIGNATURE_HEADER, FAKE_VALID_INTEGRATION_KEY } from "../../lib/signing/fake.js";
import type { WebhookDelivery } from "../../lib/signing/provider.js";
import { handleExecutedCopyFetch, runExecutedCopySweep } from "../../pipeline/executed-copy.js";
import {
  signInCookies,
  startHarness,
  TEST_ADMIN as ADMIN,
  type TestHarness,
} from "../../testing/harness.js";

/** The person who sends every envelope here, and who therefore holds
 * the record's `creator` team row. */
const SENDER = {
  email: "completion-sender@example.com",
  displayName: "Nadia Counsel",
  password: "correct-horse-battery",
} as const;

/** Somebody who has to sign off, so the soft gate has something to be
 * unresolved about. */
const APPROVER = {
  email: "completion-approver@example.com",
  displayName: "Ada Approver",
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

const SIGNERS = [
  { name: "Sarah Chen", email: "sarah@meridianbio.example" },
  { name: "J. Malone", email: "j.malone@orioncloud.example" },
] as const;

/** How long the executed copy is given before the suite calls it stuck.
 * The fake answers a few bytes, so this is slack for the queue, not for
 * the work. */
const SETTLE_TIMEOUT_MS = 20_000;

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
  executedFetch: string;
  executedCopy: {
    documentId: string;
    versionId: string;
    versionNumber: number;
    originalFilename: string;
  } | null;
}

interface VersionRow {
  id: string;
  versionNumber: number;
  kind: string;
  isCurrent: boolean;
  isExecuted: boolean;
  originalFilename: string;
}

interface DocumentRow {
  id: string;
  isPrimary: boolean;
  versions: VersionRow[];
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

  for (const fixture of [SENDER, APPROVER]) {
    const user = await provisionUser(harness.app.auth, fixture);
    await harness.db.update(users).set({ role: "legal_team_member" }).where(eq(users.id, user.id));
    userIds.set(fixture.email, user.id);
    cookies.set(fixture.email, await signInCookies(harness.app, fixture.email, fixture.password));
  }

  const connector = await harness.app.inject({
    method: "PUT",
    url: "/api/v1/signing-connectors/docusign",
    cookies: as(ADMIN),
    payload: CONNECTOR,
  });
  expect(connector.statusCode, connector.body).toBe(200);
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

const BOUNDARY = "openlaw-completion-boundary-6578";

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

  const upload = uploadBody("agreement.pdf", Buffer.from(`%PDF-1.7 ${title}`, "utf8"));
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
async function signingState(number: number) {
  const res = await harness.app.inject({
    method: "GET",
    url: `/api/v1/contracts/${String(number)}/envelopes`,
    cookies: as(SENDER),
  });
  expect(res.statusCode, res.body).toBe(200);
  return res.json() as {
    envelopes: EnvelopeRow[];
    primaryDocument: { id: string; versions: { id: string }[] } | null;
  };
}

/** The record's paper, as the documents section draws it. */
async function paperOf(number: number): Promise<DocumentRow[]> {
  const res = await harness.app.inject({
    method: "GET",
    url: `/api/v1/contracts/${String(number)}/documents`,
    cookies: as(SENDER),
  });
  expect(res.statusCode, res.body).toBe(200);
  return (res.json() as { documents: DocumentRow[] }).documents;
}

/** The record's primary document, which is where every executed copy in
 * this suite has to land. */
async function primaryOf(number: number): Promise<DocumentRow> {
  const primary = (await paperOf(number)).find((document) => document.isPrimary);
  expect(primary, "the record's primary document").toBeDefined();
  return primary!;
}

/** Sends the record's current round and answers the envelope it wrote. */
async function sendFrom(number: number): Promise<EnvelopeRow> {
  const state = await signingState(number);
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

/** The fake this app resolved. */
function provider() {
  expect(harness.signing, "the harness's fake provider").not.toBeNull();
  return harness.signing!;
}

/** The provider's own id for one of our envelope rows. */
async function providerIdOf(envelopeId: string): Promise<string> {
  const [row] = await harness.db
    .select({ providerEnvelopeId: contractEnvelopes.providerEnvelopeId })
    .from(contractEnvelopes)
    .where(eq(contractEnvelopes.id, envelopeId));
  expect(row, "the envelope row").toBeDefined();
  return row!.providerEnvelopeId;
}

/** Pushes one delivery at the webhook route, signed by this install's
 * own Connect secret — the way a signature reaches the record. */
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

/** One envelope row, read back over HTTP. */
async function envelopeRow(number: number, envelopeId: string): Promise<EnvelopeRow> {
  const row = (await signingState(number)).envelopes.find((entry) => entry.id === envelopeId);
  expect(row, "the envelope row").toBeDefined();
  return row!;
}

/**
 * Polls the record's own signing answer until the fetch stops being
 * owed — the way a person watching the record would.
 *
 * It reads the seam rather than the table, because "the executed copy
 * landed" is a fact the record has to be able to answer.
 */
async function settledFetch(number: number, envelopeId: string): Promise<EnvelopeRow> {
  const deadline = Date.now() + SETTLE_TIMEOUT_MS;
  let last: EnvelopeRow | undefined;
  while (Date.now() < deadline) {
    last = await envelopeRow(number, envelopeId);
    if (last.executedFetch !== "pending") return last;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(
    `the executed copy for ${envelopeId} was still owed after ${SETTLE_TIMEOUT_MS}ms: ` +
      `${JSON.stringify(last)}\n${JSON.stringify(harness.jobLog, null, 2)}`,
  );
}

/** Signs the envelope at the provider and tells the record, exactly as
 * a signer plus Connect would. */
async function signIt(envelope: EnvelopeRow): Promise<string> {
  const providerEnvelopeId = await providerIdOf(envelope.id);
  provider().complete(providerEnvelopeId);
  const delivered = await deliver({ providerEnvelopeId, status: "signed" });
  expect(delivered.statusCode, delivered.body).toBe(204);
  return providerEnvelopeId;
}

/** The contract's status and the stage behind it, as the record holds
 * them. */
async function statusOf(contractId: string): Promise<{ displayName: string; stage: string }> {
  const [row] = await harness.db
    .select({ displayName: contractStatuses.displayName, stage: contractStatuses.stage })
    .from(contracts)
    .innerJoin(contractStatuses, eq(contracts.statusId, contractStatuses.id))
    .where(eq(contracts.id, contractId));
  expect(row, "the contract's status").toBeDefined();
  return row!;
}

/** Every live status mapped to one stage, in the display order the
 * integration reads. */
async function statusesAt(stage: ContractStage) {
  return harness.db
    .select({ id: contractStatuses.id, displayName: contractStatuses.displayName })
    .from(contractStatuses)
    .where(eq(contractStatuses.stage, stage))
    .orderBy(asc(contractStatuses.displayOrder), asc(contractStatuses.createdAt));
}

/** Moves a record onto the first live status at one stage. */
async function moveTo(number: number, stage: ContractStage): Promise<string> {
  const [target] = await statusesAt(stage);
  expect(target, `a live status at the ${stage} stage`).toBeDefined();
  const res = await harness.app.inject({
    method: "PATCH",
    url: `/api/v1/contracts/${String(number)}`,
    cookies: as(SENDER),
    payload: { statusId: target!.id },
  });
  expect(res.statusCode, res.body).toBe(200);
  return target!.displayName;
}

/**
 * The newest activity id in the whole install, or `""` when there is
 * none.
 *
 * Every fixture in this suite writes to the feed on its way to the
 * state under test — creating a record, uploading paper, moving a
 * status by hand. Taking the mark just before the signature is what
 * lets the assertions read **the completion's** entries rather than
 * everything the record has ever said. Activity ids are uuidv7, so
 * "after this one" is "after this moment".
 */
async function activityMark(): Promise<string> {
  const [row] = await harness.db
    .select({ id: activityLog.id })
    .from(activityLog)
    .orderBy(desc(activityLog.id))
    .limit(1);
  return row?.id ?? "";
}

/** One record's entries written since a mark, oldest first — every
 * action, because the order the completion narrates in is part of what
 * is asserted. */
const entriesOn = (contractId: string, since: string) =>
  harness.db
    .select()
    .from(activityLog)
    .where(and(eq(activityLog.entityId, contractId), gt(activityLog.id, since)))
    .orderBy(asc(activityLog.createdAt), asc(activityLog.id));

/** The completion's own entries, in order. */
function completionEntries(contractId: string, since: string) {
  return harness.db
    .select()
    .from(activityLog)
    .where(
      and(
        eq(activityLog.entityId, contractId),
        gt(activityLog.id, since),
        inArray(activityLog.action, [
          "document.version_added",
          "document.executed_set",
          "contract.status_changed",
        ]),
      ),
    )
    .orderBy(asc(activityLog.createdAt), asc(activityLog.id));
}

describe("a signed envelope files its executed copy", () => {
  let contract: { id: string; number: number };
  let envelope: EnvelopeRow;
  let providerEnvelopeId: string;
  let settled: EnvelopeRow;
  /** Everything after this id is the completion's own story. */
  let mark: string;

  beforeAll(async () => {
    contract = await recordWithPaper("Meridian Bio supply agreement");
    await moveTo(contract.number, "signature");
    envelope = await sendFrom(contract.number);
    mark = await activityMark();
    providerEnvelopeId = await signIt(envelope);
    settled = await settledFetch(contract.number, envelope.id);
  });

  it("appends it to the primary chain as the next executed round", async () => {
    expect(settled.executedFetch).toBe("ready");
    const primary = await primaryOf(contract.number);
    expect(primary.versions).toHaveLength(2);
    const executed = primary.versions[1]!;
    expect(executed.versionNumber).toBe(2);
    expect(executed.kind).toBe("executed");
    expect(executed.isCurrent).toBe(true);
    // Named after the paper that went out, so the chain reads as one
    // negotiation rather than as two unrelated files.
    expect(executed.originalFilename).toBe("agreement (executed).pdf");
  });

  it("pins it, and the record answers the pin", async () => {
    const primary = await primaryOf(contract.number);
    expect(primary.versions.map((version) => version.isExecuted)).toEqual([false, true]);
  });

  it("is downloadable — the pinned bytes are the provider's own", async () => {
    const primary = await primaryOf(contract.number);
    const executed = primary.versions[1]!;
    const res = await harness.app.inject({
      method: "GET",
      url: `/api/v1/documents/${primary.id}/versions/${executed.id}/download`,
      cookies: as(SENDER),
    });
    expect(res.statusCode, res.body).toBe(200);
    expect(res.rawPayload.toString("utf8")).toContain(`executed ${providerEnvelopeId}`);
  });

  it("draws the file on the envelope's own row", async () => {
    const primary = await primaryOf(contract.number);
    expect(settled.executedCopy).toEqual({
      documentId: primary.id,
      versionId: primary.versions[1]!.id,
      versionNumber: 2,
      originalFilename: "agreement (executed).pdf",
    });
  });

  it("narrates the round and the pin, both as the integration", async () => {
    const entries = await completionEntries(contract.id, mark);
    const actions = entries.map((entry) => entry.action);
    expect(actions.slice(0, 2)).toEqual(["document.version_added", "document.executed_set"]);
    for (const entry of entries) {
      // No actor is how the feed says the integration spoke rather than
      // a person — the whole point of an automatic filing.
      expect(entry.actorId, entry.action).toBeNull();
      expect(entry.visibility, entry.action).toBe("working_team");
    }
    expect(entries[0]!.payload).toMatchObject({ versionNumber: 2, kind: "executed" });
    expect(entries[1]!.payload).toMatchObject({ versionNumber: 2 });
  });

  it("advances the status to the first live active-mapped one", async () => {
    const [firstActive] = await statusesAt("active");
    const status = await statusOf(contract.id);
    expect(status.stage).toBe("active");
    expect(status.displayName).toBe(firstActive!.displayName);
  });

  it("narrates the advance as its own entry, attributed to the integration", async () => {
    const entries = await completionEntries(contract.id, mark);
    const advance = entries.find((entry) => entry.action === "contract.status_changed");
    expect(advance, "the status advance entry").toBeDefined();
    expect(advance!.actorId).toBeNull();
    expect(advance!.payload).toMatchObject({ fromStage: "signature", toStage: "active" });
  });

  it("changes nothing when the same delivery arrives again", async () => {
    const before = await primaryOf(contract.number);
    const again = await deliver({ providerEnvelopeId, status: "signed" });
    expect(again.statusCode, again.body).toBe(204);
    // Long enough for a second job to have run, had one been enqueued.
    await new Promise((resolve) => setTimeout(resolve, 500));
    const after = await primaryOf(contract.number);
    expect(after.versions).toHaveLength(before.versions.length);
    expect((await envelopeRow(contract.number, envelope.id)).executedFetch).toBe("ready");
  });
});

describe("a signed envelope on a record that is not at the signature stage", () => {
  let contract: { id: string; number: number };
  let envelope: EnvelopeRow;
  let statusBefore: string;
  let mark: string;

  beforeAll(async () => {
    contract = await recordWithPaper("Orion Cloud reseller agreement");
    // Somebody moved it themselves while the envelope was out. Sending
    // is legal at any stage (CTR-001), so this is an ordinary record.
    statusBefore = await moveTo(contract.number, "review");
    envelope = await sendFrom(contract.number);
    mark = await activityMark();
    await signIt(envelope);
    await settledFetch(contract.number, envelope.id);
  });

  it("still files and pins the executed copy", async () => {
    const primary = await primaryOf(contract.number);
    expect(primary.versions).toHaveLength(2);
    expect(primary.versions[1]!.kind).toBe("executed");
    expect(primary.versions[1]!.isExecuted).toBe(true);
  });

  it("still narrates the completion", async () => {
    const actions = (await completionEntries(contract.id, mark)).map((entry) => entry.action);
    expect(actions).toEqual(["document.version_added", "document.executed_set"]);
  });

  it("leaves the status exactly where it was", async () => {
    const status = await statusOf(contract.id);
    expect(status.stage).toBe("review");
    expect(status.displayName).toBe(statusBefore);
  });
});

describe("the soft gate", () => {
  it("cannot be crossed by the advance, because it starts past approval", () => {
    // CTR-012 fires on a move from at-or-before `approval` to after it.
    // The advance runs signature → active, and both are past the line.
    expect(crossesApprovalGate("signature", "active")).toBe(false);
  });

  it("does not fire on a record that still holds an unresolved approval", async () => {
    const contract = await recordWithPaper("Northwind services agreement");
    // The record is at signature first, so the by-hand move is not what
    // is under test here: the gate would fire on that one, and rightly.
    await moveTo(contract.number, "signature");
    // Somebody has to sign off, and nobody has.
    const asked = await harness.app.inject({
      method: "POST",
      url: `/api/v1/contracts/${String(contract.number)}/approvals`,
      cookies: as(SENDER),
      payload: { approverIds: [idOf(APPROVER)] },
    });
    expect(asked.statusCode, asked.body).toBe(201);

    const envelope = await sendFrom(contract.number);
    const mark = await activityMark();
    await signIt(envelope);
    await settledFetch(contract.number, envelope.id);

    // The record moved anyway, and nothing was recorded as an override:
    // there was no line to cross, so there is nothing to account for.
    expect((await statusOf(contract.id)).stage).toBe("active");
    const overrides = (await entriesOn(contract.id, mark)).filter(
      (entry) => entry.action === "contract.stage_gate_overridden",
    );
    expect(overrides).toEqual([]);
  });
});

describe("a fetch that cannot succeed", () => {
  let contract: { id: string; number: number };
  let envelope: EnvelopeRow;

  beforeAll(async () => {
    contract = await recordWithPaper("Halcyon licence agreement");
    await moveTo(contract.number, "signature");
    envelope = await sendFrom(contract.number);
    // The record is told the envelope is signed, and the provider is
    // not: it still holds a live envelope, so it refuses to hand over an
    // executed copy that does not exist. That refusal is terminal by the
    // seam's own taxonomy — asking again would be refused the same way.
    const providerEnvelopeId = await providerIdOf(envelope.id);
    const delivered = await deliver({ providerEnvelopeId, status: "signed" });
    expect(delivered.statusCode, delivered.body).toBe(204);
  });

  it("records a terminal failure on the envelope's fetch state", async () => {
    const settled = await settledFetch(contract.number, envelope.id);
    expect(settled.executedFetch).toBe("failed");
    expect(settled.executedCopy).toBeNull();
  });

  it("leaves the chain and the status untouched", async () => {
    const primary = await primaryOf(contract.number);
    expect(primary.versions).toHaveLength(1);
    expect(primary.versions[0]!.isExecuted).toBe(false);
    expect((await statusOf(contract.id)).stage).toBe("signature");
  });

  it("is settled, so the boot sweep walks past it", async () => {
    const summary = await runExecutedCopySweep(
      { db: harness.db, log: sweepLog() },
      harness.pipeline,
    );
    expect(summary.scanned).toBe(0);
    expect(summary.requested).toBe(0);
  });
});

describe("a job that was lost between the commit and the queue send", () => {
  it("is recovered by the boot sweep", async () => {
    const contract = await recordWithPaper("Caledon distribution agreement");
    await moveTo(contract.number, "signature");
    const envelope = await sendFrom(contract.number);
    const providerEnvelopeId = await providerIdOf(envelope.id);
    provider().complete(providerEnvelopeId);

    // The transition, applied with nothing asked of the queue after it —
    // which is exactly what a process that died between the commit and
    // the send leaves behind. The row is the record of the work owed.
    await harness.db
      .update(contractEnvelopes)
      .set({ status: "signed", completedAt: new Date() })
      .where(eq(contractEnvelopes.id, envelope.id));
    expect((await envelopeRow(contract.number, envelope.id)).executedFetch).toBe("pending");

    const summary = await runExecutedCopySweep(
      { db: harness.db, log: sweepLog() },
      harness.pipeline,
    );
    expect(summary.scanned).toBe(1);
    expect(summary.requested).toBe(1);
    expect(summary.notEnqueued).toBe(0);

    const settled = await settledFetch(contract.number, envelope.id);
    expect(settled.executedFetch).toBe("ready");
    const primary = await primaryOf(contract.number);
    expect(primary.versions[1]!.isExecuted).toBe(true);
  });

  it("asks for nothing when nothing is owed", async () => {
    const summary = await runExecutedCopySweep(
      { db: harness.db, log: sweepLog() },
      harness.pipeline,
    );
    expect(summary.scanned).toBe(0);
    expect(summary.requested).toBe(0);
    expect(summary.stopped).toBe(false);
  });
});

describe("an executed copy larger than this install accepts", () => {
  // The ceiling is passed to the handler rather than scripted onto the
  // provider, because the fake answers one small PDF and a test that
  // needed a hundred-megabyte one would be a hundred-megabyte test. The
  // bound is a number the job is built with, so a small number and the
  // ordinary file prove the same thing.
  const CEILING = 8;

  let contract: { id: string; number: number };
  let envelope: EnvelopeRow;

  beforeAll(async () => {
    contract = await recordWithPaper("Ardent Health services agreement");
    await moveTo(contract.number, "signature");
    envelope = await sendFrom(contract.number);
    provider().complete(await providerIdOf(envelope.id));
    // Signed on the record with nothing asked of the queue, the
    // lost-job shape above — so this suite runs the fetch itself,
    // under its own ceiling, rather than racing the pipeline for it.
    await harness.db
      .update(contractEnvelopes)
      .set({ status: "signed", completedAt: new Date() })
      .where(eq(contractEnvelopes.id, envelope.id));

    await handleExecutedCopyFetch(
      {
        db: harness.db,
        storage: harness.storage,
        log: sweepLog(),
        resolveSigningProvider: harness.resolveSigningProvider,
        jobs: harness.pipeline,
        notifier: harness.notifier,
        maxUploadBytes: CEILING,
      },
      // First attempt of several. A retry bound that has not run out is
      // what makes the next assertion mean something: the fetch settles
      // because the failure is terminal, not because it gave up.
      { envelopeId: envelope.id, retryCount: 0, retryLimit: 3 },
    );
  });

  it("records a terminal failure rather than retrying the same bytes", async () => {
    const row = await envelopeRow(contract.number, envelope.id);
    expect(row.executedFetch).toBe("failed");
    expect(row.executedCopy).toBeNull();
  });

  it("files nothing, so the chain and the status are as they were", async () => {
    const primary = await primaryOf(contract.number);
    expect(primary.versions).toHaveLength(1);
    expect(primary.versions[0]!.isExecuted).toBe(false);
    expect((await statusOf(contract.id)).stage).toBe("signature");
  });

  it("is settled, so the boot sweep walks past it", async () => {
    const summary = await runExecutedCopySweep(
      { db: harness.db, log: sweepLog() },
      harness.pipeline,
    );
    expect(summary.scanned).toBe(0);
    expect(summary.requested).toBe(0);
  });
});

/** Somewhere for the sweep's own lines to go. The suite asserts what
 * the sweep did rather than what it said, so they are dropped. */
function sweepLog() {
  return { info: () => {}, warn: () => {}, error: () => {} };
}
