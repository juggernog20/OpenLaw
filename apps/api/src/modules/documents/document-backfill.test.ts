// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The upgrade backfill sweep (M12/6), against paper the pipeline never
 * saw.
 *
 * An install that upgrades from M11 has documents on the record that
 * nothing has ever read. Story 23 is that the milestone reaches them
 * without anybody re-uploading anything, and this suite is that
 * sentence: the sweep runs, and afterwards the same reads the doc panel
 * polls answer with a preview and with text.
 *
 * **The old paper is acted out, never faked.** A version that predates
 * the derivation tables is a version with no derivation row, so the
 * suite uploads through an app whose queue refuses everything — nothing
 * is enqueued — and then removes the rows the upload committed. What is
 * left on the record is exactly what M11 left: bytes, a chain, and
 * nothing derived.
 *
 * **The outcome is read where a client reads it.** Nothing here waits on
 * a handler's promise or asserts a row's contents. The sweep is asked to
 * run, and then the text and rendition reads are polled until they stop
 * saying the work is owed — the same shape every other M12 suite takes.
 *
 * **Asking twice must cost nothing.** Two cases hold the sweep to that:
 * one where every derivation has landed, and one where a derivation gave
 * up for good. Neither may enqueue anything, because a sweep that
 * re-asked on every boot would convert the same file for ever.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  count,
  documentVersionRenditions,
  documentVersions,
  documentVersionText,
  eq,
  sql,
  users,
} from "@openlaw/db";
import { provisionUser } from "../../auth/instance.js";
import { buildApp } from "../../app.js";
import {
  fakeConversionText,
  fakeExtractedText,
  fakeImageOnlyPdf,
  fakeOcrText,
} from "../../lib/doc-engine/fake.js";
import {
  BACKFILL_REFUSAL_LIMIT,
  runBackfillSweep,
  type BackfillOptions,
  type BackfillSummary,
} from "../../pipeline/backfill.js";
import { JOB_QUEUES, createUnconfiguredJobQueue, type JobQueue } from "../../pipeline/jobs.js";
import { BACKFILL_SWEEP_CRON } from "../../pipeline/pg-boss.js";
import { DOCX_MIME_TYPE, officePackage } from "../../testing/fixtures/office.js";
import { testDeps } from "../../testing/deps.js";
import {
  signInCookies,
  startHarness,
  TEST_ADMIN as ADMIN,
  type JobLogLine,
  type TestHarness,
} from "../../testing/harness.js";

/** A Legal Team Member on the contract's team, who uploads everything
 * here and reads it back. */
const MEMBER = {
  email: "backfill-member@example.com",
  displayName: "Nadia Counsel",
  password: "correct-horse-battery", // NOSONAR — fixture for a throwaway container
} as const;

let harness: TestHarness;
/** The app every upload here goes through: the harness's database,
 * storage, and doc engine, behind a queue that refuses everything. It is
 * an M11 install — the file lands, the chain is written, and no
 * derivation is ever asked for. */
let m11: Awaited<ReturnType<typeof buildApp>>;
let adminCookies: Record<string, string>;
let memberCookies: Record<string, string>;
let memberId: string;

interface ContractRow {
  id: string;
  number: number;
}

interface VersionRow {
  id: string;
  versionNumber: number;
  isCurrent: boolean;
}

interface DocumentRow {
  id: string;
  title: string;
  versions: VersionRow[];
}

/** What the extracted-text read answers. */
interface TextRow {
  state: "pending" | "ready" | "failed" | "unsupported";
  source: "native_layer" | "ocr" | "rendition" | "email_body" | null;
  text: string | null;
}

/** What the rendition read answers. */
interface RenditionRow {
  state: "pending" | "ready" | "failed" | "unsupported";
}

beforeAll(async () => {
  harness = await startHarness();
  const setup = await harness.app.inject({
    method: "POST",
    url: "/api/v1/auth/setup",
    payload: ADMIN,
  });
  expect(setup.statusCode, setup.body).toBe(201);

  const member = await provisionUser(harness.app.auth, MEMBER);
  await harness.db.update(users).set({ role: "legal_team_member" }).where(eq(users.id, member.id));
  memberId = member.id;
  adminCookies = await signInCookies(harness.app, ADMIN.email, ADMIN.password);
  memberCookies = await signInCookies(harness.app, MEMBER.email, MEMBER.password);

  m11 = await buildApp({
    ...testDeps({
      db: harness.db,
      storage: harness.storage,
      docEngine: harness.docEngine,
      // Named rather than left to the default: a queue that refuses
      // everything is the point of this app, not an incidental stand-in.
      jobs: createUnconfiguredJobQueue(),
    }),
  });
  await m11.ready();
});

afterAll(async () => {
  await m11.close();
  await harness.stop();
});

/** The `nda` seed type, which every contract here is created as. */
async function ndaTypeId(): Promise<string> {
  const res = await harness.app.inject({
    method: "GET",
    url: "/api/v1/contracts/options",
    cookies: adminCookies,
  });
  expect(res.statusCode, res.body).toBe(200);
  const nda = (res.json().contractTypes as { id: string; slug: string }[]).find(
    (row) => row.slug === "nda",
  );
  expect(nda, "the nda seed type").toBeDefined();
  return nda!.id;
}

/** A contract with the Member on its team. */
async function newContract(title: string): Promise<ContractRow> {
  const res = await harness.app.inject({
    method: "POST",
    url: "/api/v1/contracts",
    cookies: adminCookies,
    payload: { title, contractTypeId: await ndaTypeId() },
  });
  expect(res.statusCode, res.body).toBe(201);
  const contract = res.json().contract as ContractRow;
  const team = await harness.app.inject({
    method: "POST",
    url: `/api/v1/contracts/${contract.number}/team`,
    cookies: adminCookies,
    payload: { userId: memberId, role: "member" },
  });
  expect(team.statusCode, team.body).toBe(201);
  return contract;
}

const BOUNDARY = "openlaw-test-boundary-4d6f636b";

/** What one upload declares about itself: a name, a type, and bytes. */
interface FileSpec {
  filename: string;
  contentType: string;
  content: Buffer;
}

function uploadBody(file: FileSpec): { payload: Buffer; headers: Record<string, string> } {
  const payload = Buffer.concat([
    Buffer.from(`--${BOUNDARY}\r\n`),
    Buffer.from('content-disposition: form-data; name="kind"\r\n\r\ndraft_ours\r\n'),
    Buffer.from(`--${BOUNDARY}\r\n`),
    Buffer.from(
      `content-disposition: form-data; name="file"; filename="${file.filename}"\r\n` +
        `content-type: ${file.contentType}\r\n\r\n`,
    ),
    file.content,
    Buffer.from("\r\n"),
    Buffer.from(`--${BOUNDARY}--\r\n`),
  ]);
  return { payload, headers: { "content-type": `multipart/form-data; boundary=${BOUNDARY}` } };
}

type App = TestHarness["app"];

/** Uploads one document to a contract, requiring success. */
async function uploaded(number: number, file: FileSpec, app: App): Promise<DocumentRow> {
  const { payload, headers } = uploadBody(file);
  const res = await app.inject({
    method: "POST",
    url: `/api/v1/contracts/${number}/documents`,
    cookies: memberCookies,
    headers,
    payload,
  });
  expect(res.statusCode, res.body).toBe(201);
  return res.json().document as DocumentRow;
}

const currentOf = (document: DocumentRow): VersionRow => {
  const current = document.versions.filter((version) => version.isCurrent);
  expect(current.length, "exactly one current version").toBe(1);
  return current[0]!;
};

const readText = (documentId: string, versionId: string) =>
  harness.app.inject({
    method: "GET",
    url: `/api/v1/documents/${documentId}/versions/${versionId}/text`,
    cookies: memberCookies,
  });

const readRendition = (documentId: string, versionId: string) =>
  harness.app.inject({
    method: "GET",
    url: `/api/v1/documents/${documentId}/versions/${versionId}/rendition`,
    cookies: memberCookies,
  });

/** How long a derivation is given before the suite calls it stuck. The
 * fake engine is a memcpy, so this is slack for the queue, not for the
 * work. */
const SETTLE_TIMEOUT_MS = 20_000;

/** Polls the extracted-text read the way the doc panel does, until the
 * derivation stops being owed. */
async function settledText(documentId: string, versionId: string): Promise<TextRow> {
  const deadline = Date.now() + SETTLE_TIMEOUT_MS;
  let last: TextRow | undefined;
  while (Date.now() < deadline) {
    const res = await readText(documentId, versionId);
    expect(res.statusCode, res.body).toBe(200);
    last = res.json().text as TextRow;
    if (last.state !== "pending") return last;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(
    `the text for version ${versionId} was still owed after ${SETTLE_TIMEOUT_MS}ms: ` +
      `${JSON.stringify(last)}\n${JSON.stringify(harness.jobLog, null, 2)}`,
  );
}

/** The same, for the display rendition. */
async function settledRendition(documentId: string, versionId: string): Promise<RenditionRow> {
  const deadline = Date.now() + SETTLE_TIMEOUT_MS;
  let last: RenditionRow | undefined;
  while (Date.now() < deadline) {
    const res = await readRendition(documentId, versionId);
    expect(res.statusCode, res.body).toBe(200);
    last = res.json().rendition as RenditionRow;
    if (last.state !== "pending") return last;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(
    `the rendition for version ${versionId} was still owed after ${SETTLE_TIMEOUT_MS}ms: ` +
      `${JSON.stringify(last)}\n${JSON.stringify(harness.jobLog, null, 2)}`,
  );
}

/**
 * Strips a version back to what M11 left behind: bytes on the record and
 * nothing derived from them.
 *
 * The upload wrote its `pending` rows inside its own transaction, which
 * is right for an install that has the pipeline. A version uploaded
 * before the derivation tables existed has no row at all, and that
 * absence is the case the sweep exists for — so it is acted out by
 * removing them rather than by pretending the state is the same.
 */
async function forgetDerivations(versionId: string): Promise<void> {
  await harness.db.delete(documentVersionText).where(eq(documentVersionText.versionId, versionId));
  await harness.db
    .delete(documentVersionRenditions)
    .where(eq(documentVersionRenditions.versionId, versionId));
}

/** Lines the sweep itself wrote, so the refusal case can read why. */
const sweepLog: JobLogLine[] = [];

/** Runs one sweep, exactly as the worker runs it at boot. */
function sweep(
  jobs: JobQueue = harness.pipeline,
  options: BackfillOptions = {},
): Promise<BackfillSummary> {
  return runBackfillSweep(
    {
      db: harness.db,
      log: {
        info: (fields, message) => sweepLog.push({ level: "info", message, fields }),
        warn: (fields, message) => sweepLog.push({ level: "warn", message, fields }),
        error: (fields, message) => sweepLog.push({ level: "error", message, fields }),
      },
    },
    jobs,
    options,
  );
}

/** Waits until no derivation anywhere in the install is still owed, so a
 * case about "nothing is missing" can say that and mean it. It reads the
 * tables because that is the question — every version's outcome, not one
 * client's. */
async function untilNothingIsOwed(): Promise<void> {
  const deadline = Date.now() + SETTLE_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const [texts] = await harness.db
      .select({ owed: count() })
      .from(documentVersionText)
      .where(eq(documentVersionText.state, "pending"));
    const [renditions] = await harness.db
      .select({ owed: count() })
      .from(documentVersionRenditions)
      .where(eq(documentVersionRenditions.state, "pending"));
    if ((texts?.owed ?? 0) === 0 && (renditions?.owed ?? 0) === 0) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(
    `derivations were still owed after ${SETTLE_TIMEOUT_MS}ms\n` +
      JSON.stringify(harness.jobLog, null, 2),
  );
}

/** A PDF that carries its own words — a born-digital contract. */
const nativeTextPdf = (label: string) => Buffer.from(`%PDF-1.7 ${label}`);

describe("paper uploaded before the derivation tables existed", () => {
  it("gets its text after the worker boots", async () => {
    // Story 23, in one case. The bytes are on the record from M11 and
    // nothing has ever read them; nobody re-uploads anything.
    const bytes = nativeTextPdf("a master services agreement, filed in 2024");
    const contract = await newContract("Backfill · legacy PDF");
    const document = await uploaded(
      contract.number,
      { filename: "msa.pdf", contentType: "application/pdf", content: bytes },
      m11,
    );
    const version = currentOf(document);
    await forgetDerivations(version.id);

    // What an upgrading install looks like before the sweep: the read
    // says the text is coming, because it is — the sweep has not run.
    const before = await readText(document.id, version.id);
    expect(before.statusCode, before.body).toBe(200);
    expect((before.json().text as TextRow).state).toBe("pending");

    const summary = await sweep();
    expect(summary.textExtraction).toBeGreaterThan(0);

    const text = await settledText(document.id, version.id);
    expect(text.state).toBe("ready");
    expect(text.source).toBe("native_layer");
    expect(text.text).toBe(fakeExtractedText(bytes));
  });

  it("gets a preview and its text where its family calls for one", async () => {
    // A Word draft cannot be drawn by a browser, so the sweep has to ask
    // for the conversion as well — and that one job delivers both the
    // rendition and the text read out of it (M12/4).
    const bytes = officePackage("a counterparty's redline, filed in 2024");
    const contract = await newContract("Backfill · legacy Word draft");
    const document = await uploaded(
      contract.number,
      { filename: "nda-redline.docx", contentType: DOCX_MIME_TYPE, content: bytes },
      m11,
    );
    const version = currentOf(document);
    await forgetDerivations(version.id);

    const summary = await sweep();
    expect(summary.displayConversion).toBeGreaterThan(0);

    expect((await settledRendition(document.id, version.id)).state).toBe("ready");
    const text = await settledText(document.id, version.id);
    expect(text.state).toBe("ready");
    expect(text.source).toBe("rendition");
    expect(text.text).toBe(fakeConversionText("docx", bytes));
  });
});

describe("a request that never reached the queue", () => {
  it("is asked for again, and the scan is read", async () => {
    // The upload committed its `pending` row and the send was lost — a
    // worker that was down, or a job that expired against a wedged one
    // on its last attempt. Nothing wrote an outcome either way, and the
    // sweep cannot tell them apart: both are work owed, and both are
    // asked for again.
    const scan = fakeImageOnlyPdf("a countersigned NDA, photographed");
    const contract = await newContract("Backfill · lost send");
    const document = await uploaded(
      contract.number,
      { filename: "signed-nda-scan.pdf", contentType: "application/pdf", content: scan },
      m11,
    );
    const version = currentOf(document);

    // The row survived the send that never happened.
    const before = await readText(document.id, version.id);
    expect((before.json().text as TextRow).state).toBe("pending");

    await sweep();

    const text = await settledText(document.id, version.id);
    expect(text.state).toBe("ready");
    expect(text.source).toBe("ocr");
    expect(text.text).toBe(fakeOcrText(scan));
  });
});

describe("asking twice", () => {
  it("enqueues nothing the second time, when nothing is missing", async () => {
    // The idempotence the ticket asks for, stated where it matters: a
    // worker that restarts must not put the whole back catalogue through
    // the doc engine again.
    await sweep();
    await untilNothingIsOwed();

    const again = await sweep();
    expect(again.scanned).toBeGreaterThan(0);
    expect(again.textExtraction).toBe(0);
    expect(again.displayConversion).toBe(0);
  });

  it("reads every version exactly once, however small its pages", async () => {
    // The default page holds an entire test install, so this is the one
    // case that makes the sweep turn pages. The cursor is keyset on the
    // version id: a boundary that skipped a row would leave paper
    // unswept for ever, and one that re-read a row would double the
    // scan. Scanning exactly the table, in pages of two, pins both.
    await sweep();
    await untilNothingIsOwed();
    const [versions] = await harness.db.select({ total: count() }).from(documentVersions);
    const total = versions?.total ?? 0;
    expect(total, "a back catalogue of more than one page").toBeGreaterThan(2);

    const paged = await sweep(harness.pipeline, { pageSize: 2 });
    expect(paged.scanned).toBe(total);
    expect(paged.textExtraction).toBe(0);
    expect(paged.displayConversion).toBe(0);
    expect(paged.stopped).toBe(false);
  });

  it("leaves a version alone whose derivation gave up", async () => {
    // A file that says it is a PDF and is not. The job runs, decides no
    // retry reads the same bytes differently, and records the failure —
    // and from then on the sweep must walk past it at every boot.
    const contract = await newContract("Backfill · terminal failure");
    const document = await uploaded(
      contract.number,
      {
        filename: "agreement.pdf",
        contentType: "application/pdf",
        content: Buffer.from("this was never a PDF"),
      },
      harness.app,
    );
    const version = currentOf(document);
    expect((await settledText(document.id, version.id)).state).toBe("failed");

    await untilNothingIsOwed();
    const again = await sweep();
    expect(again.textExtraction).toBe(0);
    expect(again.displayConversion).toBe(0);

    // And the failure still stands: the sweep did not reopen it.
    const after = await readText(document.id, version.id);
    expect((after.json().text as TextRow).state).toBe("failed");
  });

  it("asks for nothing for a family that will never have a derivation", async () => {
    // An image renders as it is and yields no text in v1 (DOC-005 is
    // image-only PDFs, not photographs). It has no derivation row and
    // never will, and a sweep that enqueued for it would ask the
    // pipeline to do work it would only refuse.
    const contract = await newContract("Backfill · image");
    const document = await uploaded(
      contract.number,
      {
        filename: "signature-page.png",
        contentType: "image/png",
        content: Buffer.from("\x89PNG\r\n\x1a\n a photographed signature page"),
      },
      m11,
    );
    const version = currentOf(document);

    await untilNothingIsOwed();
    const summary = await sweep();
    expect(summary.textExtraction).toBe(0);
    expect(summary.displayConversion).toBe(0);

    // And the read still says so plainly, rather than leaving a client
    // polling for an answer that is never coming.
    const text = await readText(document.id, version.id);
    expect((text.json().text as TextRow).state).toBe("unsupported");
  });
});

describe("when the queue cannot be reached", () => {
  it("gives up after a few refusals, says so once, and leaves the work owed", async () => {
    // A sweep is best effort. A boot that could not reach the queue must
    // not fail, must not write one line per version, and must not walk a
    // whole back catalogue to be told the same thing — a queue refusing
    // several requests back to back is down, not busy.
    const contract = await newContract("Backfill · no queue");
    const versions: { documentId: string; versionId: string }[] = [];
    for (let round = 0; round <= BACKFILL_REFUSAL_LIMIT; round += 1) {
      const document = await uploaded(
        contract.number,
        {
          filename: `msa-${round}.pdf`,
          contentType: "application/pdf",
          content: nativeTextPdf(`uploaded while everything was down, ${round}`),
        },
        m11,
      );
      const version = currentOf(document);
      await forgetDerivations(version.id);
      versions.push({ documentId: document.id, versionId: version.id });
    }

    const before = sweepLog.length;
    const summary = await sweep(createUnconfiguredJobQueue());
    expect(summary.notEnqueued).toBe(BACKFILL_REFUSAL_LIMIT);
    expect(summary.stopped).toBe(true);
    expect(summary.textExtraction).toBe(0);

    const refusals = sweepLog
      .slice(before)
      .filter((line) => line.message === "the backfill sweep could not reach the job queue");
    expect(refusals.length, "one line, however many versions were refused").toBe(1);

    // Nothing was lost by giving up: every one of them is still owed,
    // and a sweep against a queue that works delivers them all.
    for (const { documentId, versionId } of versions) {
      const owed = await readText(documentId, versionId);
      expect((owed.json().text as TextRow).state).toBe("pending");
    }
    await sweep();
    for (const { documentId, versionId } of versions) {
      expect((await settledText(documentId, versionId)).state).toBe("ready");
    }
  });
});

describe("when the worker is shut down", () => {
  it("stops before reading anything, and says it was stopped", async () => {
    // The worker aborts the sweep on SIGTERM and waits a bounded few
    // seconds for it. That wait is only bounded because the sweep
    // checks the signal before every page and every version — a sweep
    // that read one more page first would be what holds a container
    // past its grace period.
    const stopped = new AbortController();
    stopped.abort();
    const summary = await sweep(harness.pipeline, { signal: stopped.signal });
    expect(summary.stopped).toBe(true);
    expect(summary.scanned).toBe(0);
  });
});

describe("when the install is never restarted", () => {
  // The sweep used to run at boot and nowhere else, so an install that
  // nobody restarts could carry a document with no extracted text for
  // ever — the upgrade that would have reached it only ran on a reboot
  // that never came. The boot run is still there, because a fresh
  // install should not wait until the small hours for its first sweep;
  // this is the second trigger, not a replacement.
  it("registers the sweep on a recurring schedule", async () => {
    const rows = await harness.db
      .execute<{ name: string; cron: string }>(
        sql`select name, cron from pgboss.schedule where name = ${JOB_QUEUES.backfillSweep}`,
      )
      .then((result) => result.rows);

    expect(rows).toHaveLength(1);
    expect(rows[0]?.cron).toBe(BACKFILL_SWEEP_CRON);
  });
});
