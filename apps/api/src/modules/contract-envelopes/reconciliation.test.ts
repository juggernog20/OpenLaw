// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The reconciliation sweep (#250): the fallback status feed, at the HTTP
 * seam, through the real-Postgres harness, the real pg-boss pipeline,
 * and the deterministic fake provider.
 *
 * **The install the internet cannot reach.** Every convergence here
 * happens with the webhook never firing: the envelope is signed,
 * declined, or voided at the provider, nobody delivers anything, and the
 * sweep is what makes the record agree — the executed copy included,
 * through the same completion path a delivery would have used.
 *
 * **The two feeds together.** An envelope the webhook already moved is
 * left alone, and two rounds racing on one envelope write one ending
 * between them. Both are asserted from the **activity table**, because
 * "no duplicate activity" is a fact about the feed a person reads and
 * not about a counter.
 *
 * **The delivery that was dropped rather than retried.** A Connect
 * delivery arriving before the send transaction commits names an
 * envelope this install does not hold yet; the route acknowledges it and
 * the provider never sends it again. That envelope is stranded, and the
 * sweep is what recovers it.
 *
 * **The outage.** A provider that cannot be reached is the moment's, not
 * the envelope's: the round says so in the log, marks nothing, and the
 * next round converges what the outage hid.
 *
 * Nothing here opens the sweep's internals or the provider's. The fake
 * is scripted, the record is read back over HTTP, and the entries are
 * read straight from the table — as the send, void, and completion
 * suites do.
 */

import { PgBoss } from "pg-boss";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  activityLog,
  and,
  asc,
  contractEnvelopes,
  contracts,
  contractStatuses,
  eq,
  sql,
  users,
  type ContractStage,
} from "@openlaw/db";
import { provisionUser } from "../../auth/instance.js";
import type { ActivityAction } from "../../lib/activity.js";
import { FAKE_SIGNATURE_HEADER, FAKE_VALID_INTEGRATION_KEY } from "../../lib/signing/fake.js";
import type { WebhookDelivery } from "../../lib/signing/provider.js";
import { JOB_QUEUES } from "../../pipeline/jobs.js";
import { startPipeline } from "../../pipeline/pg-boss.js";
import {
  runReconciliationSweep,
  RECONCILIATION_REFUSAL_LIMIT,
  RECONCILIATION_SWEEP_CRON,
  type ReconciliationDeps,
  type ReconciliationSummary,
} from "../../pipeline/reconciliation.js";
import {
  signInCookies,
  startHarness,
  TEST_ADMIN as ADMIN,
  type JobLogLine,
  type TestHarness,
} from "../../testing/harness.js";

/** The person who sends every envelope here. */
const SENDER = {
  email: "sweep-sender@example.com",
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

const as = (fixture: { email: string }): Record<string, string> => {
  const jar = cookies.get(fixture.email);
  expect(jar, fixture.email).toBeDefined();
  return jar!;
};

interface EnvelopeRow {
  id: string;
  status: string;
  reason: string | null;
  executedFetch: string;
  executedCopy: { versionId: string } | null;
}

interface VersionRow {
  id: string;
  kind: string;
  isExecuted: boolean;
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
  cookies.set(ADMIN.email, await signInCookies(harness.app, ADMIN.email, ADMIN.password));

  const user = await provisionUser(harness.app.auth, SENDER);
  await harness.db.update(users).set({ role: "legal_team_member" }).where(eq(users.id, user.id));
  cookies.set(SENDER.email, await signInCookies(harness.app, SENDER.email, SENDER.password));

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

const BOUNDARY = "openlaw-sweep-boundary-4471";

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

/** One record with paper on it, sitting at the signature stage — where
 * a record with an envelope out ordinarily is. */
async function recordAtSignature(title: string): Promise<{ id: string; number: number }> {
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
  await moveTo(contract.number, "signature");
  return contract;
}

async function moveTo(number: number, stage: ContractStage): Promise<void> {
  const [target] = await harness.db
    .select({ id: contractStatuses.id })
    .from(contractStatuses)
    .where(eq(contractStatuses.stage, stage))
    .orderBy(asc(contractStatuses.displayOrder), asc(contractStatuses.createdAt));
  expect(target, `a live status at the ${stage} stage`).toBeDefined();
  const res = await harness.app.inject({
    method: "PATCH",
    url: `/api/v1/contracts/${String(number)}`,
    cookies: as(SENDER),
    payload: { statusId: target!.id },
  });
  expect(res.statusCode, res.body).toBe(200);
}

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

/** One record with an envelope out, ready to be ended at the provider. */
async function recordWithEnvelopeOut(title: string): Promise<{
  contract: { id: string; number: number };
  envelope: EnvelopeRow;
  providerId: string;
}> {
  const contract = await recordAtSignature(title);
  const envelope = await sendFrom(contract.number);
  return { contract, envelope, providerId: await providerIdOf(envelope.id) };
}

async function envelopeRow(number: number, envelopeId: string): Promise<EnvelopeRow> {
  const row = (await signingState(number)).envelopes.find((entry) => entry.id === envelopeId);
  expect(row, "the envelope row").toBeDefined();
  return row!;
}

async function primaryOf(number: number): Promise<DocumentRow> {
  const res = await harness.app.inject({
    method: "GET",
    url: `/api/v1/contracts/${String(number)}/documents`,
    cookies: as(SENDER),
  });
  expect(res.statusCode, res.body).toBe(200);
  const primary = (res.json() as { documents: DocumentRow[] }).documents.find(
    (document) => document.isPrimary,
  );
  expect(primary, "the record's primary document").toBeDefined();
  return primary!;
}

function provider() {
  expect(harness.signing, "the harness's fake provider").not.toBeNull();
  return harness.signing!;
}

async function providerIdOf(envelopeId: string): Promise<string> {
  const [row] = await harness.db
    .select({ providerEnvelopeId: contractEnvelopes.providerEnvelopeId })
    .from(contractEnvelopes)
    .where(eq(contractEnvelopes.id, envelopeId));
  expect(row, "the envelope row").toBeDefined();
  return row!.providerEnvelopeId;
}

/** Pushes one delivery at the webhook route, signed by this install's
 * own Connect secret. */
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

async function stageOf(contractId: string): Promise<string> {
  const [row] = await harness.db
    .select({ stage: contractStatuses.stage })
    .from(contracts)
    .innerJoin(contractStatuses, eq(contracts.statusId, contractStatuses.id))
    .where(eq(contracts.id, contractId));
  expect(row, "the contract's status").toBeDefined();
  return row!.stage;
}

/** One record's entries for one action, oldest first — read straight
 * from the table, which is where "no duplicate activity" is a fact. */
function entriesFor(contractId: string, action: ActivityAction) {
  return harness.db
    .select()
    .from(activityLog)
    .where(and(eq(activityLog.entityId, contractId), eq(activityLog.action, action)))
    .orderBy(asc(activityLog.createdAt), asc(activityLog.id));
}

/** Somewhere for one round's own lines to go, so a suite can state what
 * the sweep said as well as what it did. */
function recordingLog(): { lines: JobLogLine[]; log: ReconciliationDeps["log"] } {
  const lines: JobLogLine[] = [];
  return {
    lines,
    log: {
      info: (fields, message) => lines.push({ level: "info", message, fields }),
      warn: (fields, message) => lines.push({ level: "warn", message, fields }),
      error: (fields, message) => lines.push({ level: "error", message, fields }),
    },
  };
}

async function sweep(): Promise<{ summary: ReconciliationSummary; lines: JobLogLine[] }> {
  const { lines, log } = recordingLog();
  const summary = await runReconciliationSweep(
    {
      db: harness.db,
      log,
      resolveSigningProvider: harness.resolveSigningProvider,
      notifier: harness.notifier,
    },
    harness.pipeline,
  );
  return { summary, lines };
}

/**
 * Polls the record's own signing answer until the fetch stops being
 * owed — the way a person watching the record would.
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

describe("an envelope signed while the webhook never fires", () => {
  let contract: { id: string; number: number };
  let envelope: EnvelopeRow;
  let summary: ReconciliationSummary;
  let settled: EnvelopeRow;

  beforeAll(async () => {
    const out = await recordWithEnvelopeOut("Meridian Bio supply agreement");
    contract = out.contract;
    envelope = out.envelope;
    // The signer signs on the provider's ceremony. Nothing is delivered
    // to this install — it is the firewalled deployer's whole situation.
    provider().complete(out.providerId);
    summary = (await sweep()).summary;
    settled = await settledFetch(contract.number, envelope.id);
  });

  it("converges the record to signed", async () => {
    expect(summary.converged).toBe(1);
    expect((await envelopeRow(contract.number, envelope.id)).status).toBe("signed");
  });

  it("files its executed copy through the same completion path", async () => {
    expect(settled.executedFetch).toBe("ready");
    const primary = await primaryOf(contract.number);
    expect(primary.versions).toHaveLength(2);
    expect(primary.versions[1]!.kind).toBe("executed");
    expect(primary.versions[1]!.isExecuted).toBe(true);
    expect(settled.executedCopy).toMatchObject({ versionId: primary.versions[1]!.id });
  });

  it("advances the record's status, exactly as a delivery would have", async () => {
    expect(await stageOf(contract.id)).toBe("active");
  });

  it("narrates the ending once, as the integration", async () => {
    const entries = await entriesFor(contract.id, "envelope.signed");
    expect(entries).toHaveLength(1);
    // No actor: a status the provider reported has no person behind it.
    expect(entries[0]!.actorId).toBeNull();
    expect(entries[0]!.visibility).toBe("working_team");
  });

  it("finds nothing left to do on the next round", async () => {
    const { summary: next } = await sweep();
    expect(next.scanned).toBe(0);
    expect(next.converged).toBe(0);
    expect(next.stopped).toBe(false);
  });
});

describe("an envelope declined while the webhook never fires", () => {
  it("converges with the signer's reason, and files nothing", async () => {
    const out = await recordWithEnvelopeOut("Orion Cloud reseller agreement");
    provider().decline(out.providerId, "The indemnity clause is unacceptable.");

    const { summary } = await sweep();
    expect(summary.converged).toBe(1);

    const row = await envelopeRow(out.contract.number, out.envelope.id);
    expect(row.status).toBe("declined");
    expect(row.reason).toBe("The indemnity clause is unacceptable.");

    const entries = await entriesFor(out.contract.id, "envelope.declined");
    expect(entries).toHaveLength(1);
    expect(entries[0]!.actorId).toBeNull();
    expect(entries[0]!.payload).toMatchObject({
      reason: "The indemnity clause is unacceptable.",
    });
    // A decline never touches the version chain, and never advances the
    // record: the paper did not come back.
    expect((await primaryOf(out.contract.number)).versions).toHaveLength(1);
    expect(await stageOf(out.contract.id)).toBe("signature");
  });
});

describe("an envelope voided in the provider's own console", () => {
  it("converges with the reason it was withdrawn for", async () => {
    const out = await recordWithEnvelopeOut("Halcyon licence agreement");
    // Somebody withdrew it on DocuSign's website rather than on the
    // record, so no void route ran and nothing was delivered here.
    await provider().voidEnvelope(out.providerId, "Superseded by the amended draft.");

    const { summary } = await sweep();
    expect(summary.converged).toBe(1);

    const row = await envelopeRow(out.contract.number, out.envelope.id);
    expect(row.status).toBe("voided");
    expect(row.reason).toBe("Superseded by the amended draft.");

    const entries = await entriesFor(out.contract.id, "envelope.voided");
    expect(entries).toHaveLength(1);
    // The one ending that names a person is a void taken **on the
    // record**. This one was taken elsewhere, so the feed says the
    // integration reported it.
    expect(entries[0]!.actorId).toBeNull();
    expect((await primaryOf(out.contract.number)).versions).toHaveLength(1);
  });
});

describe("an envelope the webhook already moved", () => {
  it("is untouched by the sweep — one ending, one entry, one copy", async () => {
    const out = await recordWithEnvelopeOut("Caledon distribution agreement");
    provider().complete(out.providerId);
    const delivered = await deliver({ providerEnvelopeId: out.providerId, status: "signed" });
    expect(delivered.statusCode, delivered.body).toBe(204);
    await settledFetch(out.contract.number, out.envelope.id);

    const { summary } = await sweep();
    // An ended envelope is not live, so the round does not even read it:
    // that is what makes the two feeds cost nothing beside each other.
    expect(summary.scanned).toBe(0);
    expect(summary.converged).toBe(0);

    expect(await entriesFor(out.contract.id, "envelope.signed")).toHaveLength(1);
    expect(await entriesFor(out.contract.id, "document.executed_set")).toHaveLength(1);
    expect((await primaryOf(out.contract.number)).versions).toHaveLength(2);
  });
});

describe("two rounds racing on one envelope", () => {
  it("write one ending between them", async () => {
    const out = await recordWithEnvelopeOut("Northwind services agreement");
    provider().complete(out.providerId);

    // Two workers, or one worker and a round that overran. Whichever
    // reads the row first applies the ending; the other is told the
    // record already says it, and writes nothing.
    const [first, second] = await Promise.all([sweep(), sweep()]);
    const converged = first.summary.converged + second.summary.converged;
    const alreadyEnded = first.summary.alreadyEnded + second.summary.alreadyEnded;
    // Exactly one round applied it. The other either read the row after
    // the first had ended it — and then had nothing to scan — or reached
    // the funnel second and was told the record already said it. Both
    // are the same outcome on the record, which is the point.
    expect(converged).toBe(1);
    expect(alreadyEnded).toBeLessThanOrEqual(1);

    await settledFetch(out.contract.number, out.envelope.id);
    expect(await entriesFor(out.contract.id, "envelope.signed")).toHaveLength(1);
    expect(await entriesFor(out.contract.id, "document.version_added")).toHaveLength(1);
    expect((await primaryOf(out.contract.number)).versions).toHaveLength(2);
  });
});

describe("a delivery that arrived before the send committed", () => {
  it("is recovered by the sweep, because nothing else is coming", async () => {
    const out = await recordWithEnvelopeOut("Sable Trading master agreement");
    provider().complete(out.providerId);

    // The race, staged: Connect delivered the signature while this
    // install did not yet hold the envelope. The route acknowledges an
    // envelope it does not hold — refusing would make our own log the
    // provider's retry queue — so the delivery is dropped and the
    // provider never sends it again. Pointing the row elsewhere for the
    // length of the delivery is what makes the row invisible to it, as
    // an uncommitted send is.
    const stranger = `${out.providerId}-not-yet-committed`;
    await harness.db
      .update(contractEnvelopes)
      .set({ providerEnvelopeId: stranger })
      .where(eq(contractEnvelopes.id, out.envelope.id));
    try {
      const dropped = await deliver({ providerEnvelopeId: out.providerId, status: "signed" });
      expect(dropped.statusCode, dropped.body).toBe(204);
    } finally {
      // Put back whatever the delivery did, so a failure here is one
      // failure and not every later test reading a row that lies.
      await harness.db
        .update(contractEnvelopes)
        .set({ providerEnvelopeId: out.providerId })
        .where(eq(contractEnvelopes.id, out.envelope.id));
    }

    // The record is now stranded: the provider holds a signed envelope,
    // the record says it is still out, and no second delivery is coming.
    expect((await envelopeRow(out.contract.number, out.envelope.id)).status).toBe("sent");
    expect(await entriesFor(out.contract.id, "envelope.signed")).toHaveLength(0);

    const { summary } = await sweep();
    expect(summary.converged).toBe(1);

    const settled = await settledFetch(out.contract.number, out.envelope.id);
    expect(settled.executedFetch).toBe("ready");
    expect(await entriesFor(out.contract.id, "envelope.signed")).toHaveLength(1);
    expect((await primaryOf(out.contract.number)).versions).toHaveLength(2);
  });
});

describe("a provider outage during a round", () => {
  it("logs it, marks nothing, and converges on the next round", async () => {
    const out = await recordWithEnvelopeOut("Vantage facilities agreement");
    provider().complete(out.providerId);
    provider().outage();

    try {
      const outage = await sweep();
      expect(outage.summary.scanned).toBe(1);
      expect(outage.summary.unreachable).toBe(1);
      expect(outage.summary.converged).toBe(0);
      // The sweep said so, once.
      expect(
        outage.lines.filter(
          (line) =>
            line.level === "warn" &&
            line.message === "the reconciliation sweep could not reach the signing provider",
        ),
      ).toHaveLength(1);

      // Nothing was marked. The envelope is still live and its copy is
      // still owed — an outage is the moment's, not the envelope's.
      const held = await envelopeRow(out.contract.number, out.envelope.id);
      expect(held.status).toBe("sent");
      expect(held.executedFetch).toBe("pending");
      expect(await entriesFor(out.contract.id, "envelope.signed")).toHaveLength(0);
    } finally {
      // The provider is shared with every test after this one, so it
      // goes back on the air whatever happened above.
      provider().online();
    }

    const { summary } = await sweep();
    expect(summary.converged).toBe(1);
    const settled = await settledFetch(out.contract.number, out.envelope.id);
    expect(settled.executedFetch).toBe("ready");
  });
});

/**
 * The sweep repeats, so it is on pg-boss's clock rather than on a timer
 * in the worker (#277). Two things follow, and both are asserted here
 * rather than argued: **an install has one schedule however many workers
 * it runs**, and **a tick converges** — the same convergence the rest of
 * this file asserts against a hand-run round, reached the way production
 * reaches it.
 */
describe("the scheduled shape", () => {
  it("leaves one schedule and one singleton queue however many workers boot", async () => {
    // A second worker against the same database — a replica, which is
    // the whole subject. `startPipeline` is what declares the schedule,
    // so booting it twice is the experiment.
    const second = await startPipeline({
      connectionString: harness.databaseUrl,
      handlers: {
        db: harness.db,
        storage: harness.storage,
        docEngine: harness.docEngine,
        resolveSigningProvider: harness.resolveSigningProvider,
        resolveAiProvider: harness.resolveAiProvider,
        resolveMailer: () =>
          Promise.resolve({ source: "unset" as const, from: null, mailer: harness.mailer }),
        baseUrl: "http://localhost",
        log: recordingLog().log,
      },
      log: recordingLog().log,
    });
    try {
      // pg-boss's own tables are the assertion. The schedule is an
      // upsert keyed on the queue name, so two workers declaring it
      // leave one row — which is what makes the cron election produce
      // one round rather than one per replica.
      const schedules = await harness.db.execute<{ name: string; cron: string }>(
        sql`select name, cron from pgboss.schedule where name = ${JOB_QUEUES.reconciliationSweep}`,
      );
      expect(schedules.rows).toHaveLength(1);
      expect(schedules.rows[0]?.cron).toBe(RECONCILIATION_SWEEP_CRON);

      // Singleton, so a tick landing while a round is still walking
      // waits for it rather than joining it: two rounds at once would
      // be two sets of provider requests for one set of answers.
      const queues = await harness.db.execute<{ policy: string }>(
        sql`select policy from pgboss.queue where name = ${JOB_QUEUES.reconciliationSweep}`,
      );
      expect(queues.rows[0]?.policy).toBe("singleton");
    } finally {
      await second.stop();
    }
  });

  it("converges an envelope when a tick runs the round", async () => {
    // The cron is five minutes, which no suite may wait for. What is
    // asserted is the handler the tick reaches: a job on the queue runs
    // a real round against the real record, and the record converges.
    const out = await recordWithEnvelopeOut("Fairhaven consultancy agreement");
    expect((await envelopeRow(out.contract.number, out.envelope.id)).status).toBe("sent");

    provider().complete(out.providerId);
    const boss = new PgBoss({ connectionString: harness.databaseUrl });
    try {
      await boss.start();
      await boss.send(JOB_QUEUES.reconciliationSweep, {});
    } finally {
      await boss.stop();
    }

    // The harness's own pipeline is the worker that takes it — the
    // production registration, not a double.
    await until(
      async () => (await envelopeRow(out.contract.number, out.envelope.id)).status === "signed",
      30_000,
    );
    // Waited for, not read once. The status flips part-way through the
    // round, and the line is written when the handler that flipped it
    // returns — so reading the log the instant the status lands races the
    // tail of the handler. Under load the handler loses that race, which
    // is what made this test flaky (#295).
    await until(
      () =>
        harness.jobLog.some(
          (line) => line.message === "the scheduled reconciliation sweep finished",
        ),
      30_000,
    );
    await settledFetch(out.contract.number, out.envelope.id);
  });
});

describe("a provider that is down for every envelope", () => {
  it("stops the round at the refusal bound rather than walking them all", async () => {
    const live = RECONCILIATION_REFUSAL_LIMIT + 2;
    for (let index = 0; index < live; index += 1) {
      await recordWithEnvelopeOut(`Ridgeline retainer ${String(index + 1)}`);
    }
    provider().outage();
    try {
      const { summary } = await sweep();
      expect(summary.scanned).toBe(RECONCILIATION_REFUSAL_LIMIT);
      expect(summary.unreachable).toBe(RECONCILIATION_REFUSAL_LIMIT);
      expect(summary.stopped).toBe(true);
      expect(summary.converged).toBe(0);
    } finally {
      provider().online();
    }
  });
});

async function until(check: () => boolean | Promise<boolean>, timeoutMs = 10_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await check()) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(`the condition was still false after ${String(timeoutMs)}ms`);
}
