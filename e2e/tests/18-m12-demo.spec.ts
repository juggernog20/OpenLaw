// SPDX-License-Identifier: AGPL-3.0-only

/**
 * M12 milestone acceptance (#190): the demo, end to end.
 *
 * Preview a Word draft in-app without downloading it, then upload a
 * scanned PDF and watch OCR make its text available.
 *
 * The journey is one Legal Team Member and one contract. They put the
 * counterparty's Word redline on the record and read it where it lives —
 * tracked changes, deletions, and the margin comment all on screen,
 * drawn from a conversion nobody asked for by hand. Then they upload a
 * scan: a PDF that is a picture of a page with no words in it at all.
 * The panel keeps showing that picture, because the original scan is
 * always what renders (DOC-005), while the pipeline reads it behind them
 * and the version's text arrives on its own.
 *
 * Each leg is proved twice, on the M9, M10, and M11 specs' rule: once on
 * what the screen draws, and once on what the seam answers. The two
 * halves catch different lies here. A panel that drew a picture of a
 * Word document would satisfy the screen and fail the seam, because the
 * seam is asked whether the bytes it served are a PDF that is not the
 * uploaded file. A pipeline that quietly OCR'd nothing would satisfy the
 * seam's `ready` and fail the words.
 *
 * **"Without downloading it" is asserted, not described.** Every request
 * the browser makes is recorded for the whole Word leg. Reading the
 * draft must have fetched the preview address and must never have
 * fetched the download address, and no browser download may have
 * started. That is the milestone's own sentence, measured.
 *
 * **The deployer leg (stories 21 and 22).** This is the first milestone
 * whose stack is more than an app and a database, so the demo also
 * proves what a deployer was promised, against the running stack rather
 * than by describing it:
 *
 * 1. All four services of the blessed stack are up in one Compose
 *    project — app, worker, doc-engine, and Postgres — read off
 *    `docker ps`. The three with a readiness probe are healthy; the
 *    worker has none by design, because it listens on nothing.
 * 2. The worker is the same image as the app with a different command
 *    (TECH-007), read off `docker inspect` — not a fifth thing to build.
 * 3. Nothing about M12 was configured. The app and the worker carry the
 *    compose file's own default for the doc engine and no timeout
 *    override, so this stack reached healthy on M11's configuration.
 * 4. The doc engine publishes no host port, exactly as Postgres does not
 *    (TECH-010). A conversion service is never an attack surface.
 *
 * The stack is found by the host port the suite is talking to, so a run
 * inspects the stack it is testing and never the other one — the suite's
 * own instance and the human testing ground run at the same time
 * (TECH-018). `E2E_APP_CONTAINER` names it outright for a stack that
 * publishes its port some other way.
 *
 * The fixtures are the repository's own doc-engine fixtures, read from
 * where they are committed rather than copied here. They are the two
 * files this milestone is about — a Word document carrying a tracked
 * insertion, a tracked deletion, and a comment, and a page rasterised
 * into a PDF with no text layer at all — and a second copy of a binary
 * would be a copy that drifts. `apps/api/scripts/build-doc-engine-fixtures.ts`
 * is how they were made.
 *
 * The never-reset instance (TECH-018) is left as the run found it, on
 * the earlier demo specs' convention: per-run rows carry this spec's own
 * prefix and are swept before the journey starts. The sweep erases the
 * paper before it archives the contract, because a document is the one
 * thing here with a hard delete (DOC-010) — and in this milestone that
 * erasure takes the renditions with it, so leaving the blobs would grow
 * the volume by two files per run, forever.
 */

import { readFileSync } from "node:fs";
import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { test, expect, type APIRequestContext, type Locator, type Page } from "@playwright/test";
import { z } from "zod";
import {
  ADMIN,
  BASE_URL,
  ensureAdminExists,
  ensureMemberInert,
  onboardActivatedMember,
  reportAxeViolations,
  signInAs,
  sweepOrSay,
  type OnboardedMember,
} from "./helpers.js";

/**
 * The journey waits on two background jobs — a LibreOffice conversion
 * and an OCR pass over a rasterised page — on a runner that is also
 * running Postgres, the app, and a browser.
 *
 * It is deliberately more than every budget below can add up to: both
 * derivations (2 × 180s), both surfaces (2 × 30s), and the onboarding
 * and uploads around them. A pipeline that never delivers should fail
 * saying exactly that, and a test timeout that fired first would take
 * the sentence away and leave a stopwatch in its place.
 */
test.setTimeout(480_000);

/** Per-run contracts carry this prefix, so a crashed earlier run's
 * leftovers can be swept before the journey starts. It is this spec's
 * own: the demo specs sweep their own rows and must not reach into each
 * other's. */
const CONTRACT_PREFIX = "E2E M12 Ashworth services agreement";

/** The person the milestone is written for (stories 2 and 9). */
const READER_NAME = "Priya Counsel";

/** What the uploader writes about each file (story 6 of M11). Distinct
 * on purpose: each note is what tells its own row apart from the
 * other. */
const REDLINE_NOTE = "Their mark-up of round three, in Word.";
const SCAN_NOTE = "The signed 2019 assignment, scanned from the file room.";

/**
 * How long a derivation may take before the demo calls it broken.
 *
 * Generous on purpose. A conversion is LibreOffice starting up, and an
 * extraction over a scan is Tesseract reading a picture of a page — both
 * on a shared CI runner. What is being proved is that the text arrives
 * without anybody asking for it, not that it arrives quickly.
 */
const DERIVATION_TIMEOUT_MS = 180_000;

/** How often the demo asks whether a derivation has landed. The panel's
 * own poll is 1.5s; this is the same order, so the wait the test
 * measures is the wait a reader would have. */
const DERIVATION_POLL_MS = 1_000;

/**
 * How long a surface that already has its bytes may take to finish
 * drawing.
 *
 * Nothing here is waiting on a job — the file is in the browser. It is
 * pdf.js parsing a page, rasterising it, and laying its text runs over
 * the canvas, which is work a slow runner can still make take seconds.
 */
const SURFACE_TIMEOUT_MS = 30_000;

/** What the doc engine's conversion must show a reader (DOC-004): the
 * counterparty's deletion, their insertion, and the comment they left.
 * The same three phrases the doc-engine contract suite states its
 * fidelity tier over, because they are facts about the same fixture. */
const TRACKED_CHANGES = [
  "England and Wales",
  "Dubai International Financial Centre",
  "DIFC Courts have exclusive jurisdiction",
] as const;

/** What OCR must find in the scan (DOC-005). Also the contract suite's,
 * for the same reason. */
const SCANNED_WORDS = [
  "DEED OF ASSIGNMENT",
  "This deed is dated the first of March.",
  "The assignor transfers the whole of the rights.",
] as const;

/** The repository's committed doc-engine fixtures, read where they live.
 * See apps/api/scripts/build-doc-engine-fixtures.ts. */
function fixture(name: string): Buffer {
  return readFileSync(
    fileURLToPath(
      new URL(`../../apps/api/src/testing/fixtures/doc-engine/${name}`, import.meta.url),
    ),
  );
}

/** The Word document the milestone promises reads in place, tracked
 * changes and comment included. */
const TRACKED_CHANGES_DOCX = fixture("tracked-changes.docx");

/** A page as a picture of itself: an image-only PDF with no text layer
 * at all, which is what OCR is for. */
const SCAN_PDF = fixture("scan.pdf");

const DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

const run = promisify(execFile);

/** One `docker` call, answering its trimmed output. */
async function docker(...args: readonly string[]): Promise<string> {
  const { stdout } = await run("docker", [...args], { encoding: "utf8" });
  return stdout.trim();
}

/**
 * The app container this run is talking to.
 *
 * Found by the host port in the suite's own base URL, because two
 * OpenLaw stacks run side by side (TECH-018) and inspecting the wrong
 * one would report on somebody's testing ground. `E2E_APP_CONTAINER`
 * names it outright when the port cannot identify it.
 */
async function appContainer(): Promise<string> {
  const named = process.env.E2E_APP_CONTAINER;
  if (named) return named;
  const port = new URL(BASE_URL).port || "80";
  const found = await docker(
    "ps",
    "--filter",
    `publish=${port}`,
    "--filter",
    "label=com.docker.compose.service=app",
    "--format",
    "{{.ID}}",
  );
  const ids = found.split("\n").filter((line) => line.length > 0);
  expect(
    ids,
    `exactly one Compose app container must publish port ${port} — set E2E_APP_CONTAINER to name it`,
  ).toHaveLength(1);
  return ids[0]!;
}

/** Only the parts of `docker inspect` the deployer leg reads. */
const ContainerState = z.object({
  Image: z.string(),
  Path: z.string(),
  Args: z.array(z.string()),
  State: z.object({
    Status: z.string(),
    // Absent for a container with no probe, which is the worker's own
    // answer and not a gap: it listens on nothing.
    Health: z.object({ Status: z.string() }).optional(),
  }),
  Config: z.object({ Env: z.array(z.string()) }),
  NetworkSettings: z.object({
    // A published port is a key with bindings under it; an unpublished
    // one is the same key with null.
    Ports: z.record(
      z.string(),
      z.array(z.object({ HostIp: z.string(), HostPort: z.string() })).nullable(),
    ),
  }),
});

type Container = z.infer<typeof ContainerState>;

async function inspect(container: string): Promise<Container> {
  const [only] = z
    .array(ContainerState)
    .parse(JSON.parse(await docker("inspect", container)))
    .slice(0, 1);
  expect(only, `docker inspect answered nothing for ${container}`).toBeDefined();
  return only!;
}

/** One environment entry's value, or undefined when the container was
 * never given it. */
function env(container: Container, name: string): string | undefined {
  const set = container.Config.Env.find((entry) => entry.startsWith(`${name}=`));
  return set?.slice(name.length + 1);
}

/** Every host port a container publishes. Empty is the promise TECH-010
 * makes about the doc engine and TECH-004 makes about Postgres. */
function publishedPorts(container: Container): string[] {
  return Object.values(container.NetworkSettings.Ports)
    .flatMap((bindings) => bindings ?? [])
    .map((binding) => `${binding.HostIp}:${binding.HostPort}`);
}

/** The containers of one Compose project, by the service each one is. */
async function servicesOf(project: string): Promise<Map<string, string>> {
  const listed = await docker(
    "ps",
    "--filter",
    `label=com.docker.compose.project=${project}`,
    "--format",
    '{{.Label "com.docker.compose.service"}}\t{{.ID}}',
  );
  return new Map(
    listed
      .split("\n")
      .filter((line) => line.length > 0)
      .map((line) => {
        const [service, id] = line.split("\t");
        return [service!, id!] as const;
      }),
  );
}

/** Only what the sweep reads: the title it matches on and the reference
 * it archives by. */
const ContractRows = z.object({
  contracts: z.array(z.object({ number: z.number().int(), title: z.string() })),
});

/** One document with its chain, as the seam answers it — the fields this
 * demo is about, and nothing else. `renderFamily` is here because it is
 * the routing decision M12 added, and the panel's whole behaviour hangs
 * off it. */
const DocumentSchema = z.object({
  id: z.string(),
  title: z.string(),
  versions: z.array(
    z.object({
      id: z.string(),
      versionNumber: z.number().int(),
      originalFilename: z.string(),
      byteSize: z.number().int(),
      renderFamily: z.string(),
      isCurrent: z.boolean(),
    }),
  ),
});

const DocumentRows = z.object({ documents: z.array(DocumentSchema) });

/** What one upload answers: the document it created, chain and all. */
const DocumentEnvelope = z.object({ document: DocumentSchema });

type DocumentRow = z.infer<typeof DocumentSchema>;

/** The display conversion's state (DOC-004): a state, never a status
 * code, so a caller can tell a job that is running from one that will
 * never run. */
const RenditionEnvelope = z.object({
  rendition: z.object({ state: z.string(), updatedAt: z.string().nullable() }),
});

/** The extracted text (DOC-005), with where it came from — a PDF's own
 * layer, OCR over pictures of pages, or a converted rendition. */
const TextEnvelope = z.object({
  text: z.object({
    state: z.string(),
    source: z.string().nullable(),
    text: z.string().nullable(),
    updatedAt: z.string().nullable(),
  }),
});

async function listContracts(request: APIRequestContext) {
  const listed = await request.get("/api/v1/contracts");
  expect(listed.ok()).toBe(true);
  return ContractRows.parse(await listed.json()).contracts;
}

/** One contract's whole paper, archived rows included, as the seam
 * answers it. */
async function readPaper(
  request: APIRequestContext,
  number: number,
): Promise<readonly DocumentRow[]> {
  const listed = await request.get(`/api/v1/contracts/${number}/documents?includeArchived=true`);
  expect(listed.status(), await listed.text()).toBe(200);
  return DocumentRows.parse(await listed.json()).documents;
}

/**
 * Leaves every per-run contract inert, paper first (TECH-018 cleanup).
 *
 * A document is the one thing this demo creates that has a real hard
 * delete (DOC-010), and in this milestone that erasure reaches further
 * than it did in M11: the display rendition the pipeline converted goes
 * with the source blob, and the extracted text goes with the version
 * rows. The contract has no hard delete, so archived is its resting
 * state. The Administrator runs both.
 */
async function ensureDemoContractsInert(request: APIRequestContext) {
  for (const row of (await listContracts(request)).filter((contract) =>
    contract.title.startsWith(CONTRACT_PREFIX),
  )) {
    for (const document of await readPaper(request, row.number)) {
      const erased = await request.delete(`/api/v1/documents/${document.id}`, {
        data: { confirmTitle: document.title },
      });
      expect(erased.status(), await erased.text()).toBe(200);
    }
    const archived = await request.post(`/api/v1/contracts/${row.number}/archive`);
    expect(archived.ok()).toBe(true);
  }
}

/** A seed contract type that demands no field, named as the create
 * dialog names it. The demo is about reading the record's paper, not
 * about the field catalog. */
async function bareContractTypeName(request: APIRequestContext): Promise<string> {
  const options = await request.get("/api/v1/contracts/options");
  expect(options.ok()).toBe(true);
  const bare = z
    .object({
      contractTypes: z.array(
        z.object({
          displayName: z.string(),
          fields: z.array(z.object({ isRequired: z.boolean() })),
        }),
      ),
    })
    .parse(await options.json())
    .contractTypes.find((type) => type.fields.every((field) => !field.isRequired));
  expect(bare, "no contract type without a hard-required field is configured").toBeDefined();
  return bare!.displayName;
}

/** The Documents section of the record. */
function documentsSection(page: Page): Locator {
  return page.getByRole("region", { name: "Documents" });
}

/**
 * Crosses from the record to its paper, the way a reader does it.
 *
 * The paper is one section of the record now, behind its own tab
 * (DES-032). The strip is a nav of routed links, so the move is a click
 * and the address is the proof it landed. It is also a client-side
 * navigation, so it fetches nothing — which matters here, because this
 * journey counts every request the browser makes.
 */
async function openDocumentsSection(page: Page, number: number): Promise<void> {
  await page
    .getByRole("navigation", { name: "Contract sections" })
    .getByRole("link", { name: "Documents" })
    .click();
  await expect(page).toHaveURL(new RegExp(`/contracts/${number}/documents$`));
}

/** One row of the section, found by the note its round carries. */
function roundRow(page: Page, note: string): Locator {
  return documentsSection(page).getByRole("row").filter({ hasText: note });
}

/** What one file is uploaded as: the bytes, what to call them, and what
 * the composer collects beside them. */
interface Upload {
  name: string;
  body: Buffer;
  mimeType: string;
  kind: string;
  note: string;
}

/**
 * Puts one file through the composer, the way a person does it: the
 * picker, the kind, the note, and the confirm.
 *
 * It answers the document the upload created, read out of the upload's
 * own 201. That is not a shortcut: the version's derivations are
 * requested the moment that response is sent, so a demo that had to list
 * the record again before it knew the address would be asking about the
 * pipeline seconds after the race it wants to observe.
 */
async function uploadThroughComposer(page: Page, upload: Upload): Promise<DocumentRow> {
  await documentsSection(page).getByRole("button", { name: "Upload" }).click();
  const dialog = page.getByRole("dialog");
  const chooser = page.waitForEvent("filechooser");
  // The button carries the field's label as well as its own, because the
  // input the label points at is out of the tab order and this is the
  // control a keyboard reaches.
  await dialog.getByRole("button", { name: "File Choose file" }).click();
  await (
    await chooser
  ).setFiles({ name: upload.name, mimeType: upload.mimeType, buffer: upload.body });
  await expect(dialog.getByText(upload.name)).toBeVisible();
  await dialog.getByLabel("Kind").selectOption(upload.kind);
  await dialog.getByLabel("Note").fill(upload.note);
  const uploaded = page.waitForResponse(
    (response) =>
      /\/api\/v1\/contracts\/\d+\/documents$/.test(response.url()) &&
      response.request().method() === "POST",
  );
  await dialog.getByRole("button", { name: "Upload", exact: true }).click();
  const answered = await uploaded;
  expect(answered.status(), await answered.text()).toBe(201);
  return DocumentEnvelope.parse(await answered.json()).document;
}

/** Where one version's derived artifacts and bytes are read from — the
 * same addresses the panel itself uses. */
function versionAddress(document: DocumentRow, versionId: string, leaf: string): string {
  return `/api/v1/documents/${document.id}/versions/${versionId}/${leaf}`;
}

/** The doc panel, by the name it gives itself. */
function docPanel(page: Page, title: string, versionNumber: number): Locator {
  return page.getByRole("complementary", { name: `${title}, version ${versionNumber}` });
}

/**
 * How far one version's display conversion has got.
 *
 * The status is asserted before the body is parsed, so a read that was
 * refused reports the server's own words rather than a schema complaint
 * about a problem document.
 */
async function readRendition(page: Page, address: string): Promise<string> {
  const answered = await page.request.get(address);
  expect(answered.status(), await answered.text()).toBe(200);
  return RenditionEnvelope.parse(await answered.json()).rendition.state;
}

/**
 * Every word the PDF surface put on screen, flattened.
 *
 * pdf.js draws the page into a canvas and lays its own text runs over
 * it, one element per run — that layer is what makes a clause
 * selectable, and it is also the only place the page's words exist in
 * the DOM. The runs are joined with a space and the whitespace
 * flattened, because a conversion wraps a line wherever the page ends
 * and a phrase in the source can arrive split across two runs.
 *
 * It is found by the library's own class rather than by a role, because
 * the layer is deliberately unreachable to a screen reader: pdf.js marks
 * every run `role="presentation"`, so the words are selectable by a
 * mouse and are never read twice. Every page in the well draws its own
 * layer (2026-08-18: the well scrolls through the whole document rather
 * than swapping one page's canvas), so this reads all of them rather
 * than assuming one — at least one is asserted to be there before its
 * runs are read, so a pdf.js upgrade that renames the class fails
 * saying so — rather than answering "no words on the page", which is the
 * assertion the scan makes and would then pass for the wrong reason.
 */
async function wordsOnScreen(panel: Locator): Promise<string> {
  const layers = panel.locator(".textLayer");
  await expect(layers.first(), "the PDF surface has no pdf.js text layer").toBeAttached();
  const runs = await layers.locator("> *").allTextContents();
  return runs.join(" ").replaceAll(/\s+/g, " ").trim();
}

/** Whether any letter or digit is on the surface at all — the question
 * an image-only page answers "no" to. */
function hasWords(text: string): boolean {
  return /[\p{L}\p{N}]/u.test(text);
}

test.describe.serial("M12 demo path", () => {
  test.beforeAll(async ({ request }) => {
    await ensureAdminExists(request);
  });

  test("preview a Word draft in-app without downloading it, then watch OCR read a scan", async ({
    page,
    browser,
  }, testInfo) => {
    await signInAs(page, ADMIN.email, ADMIN.password, ADMIN.displayName);

    // Known starting state on the never-reset instance (TECH-018): a
    // crashed earlier run may have left per-run rows — and per-run files
    // — behind.
    await ensureDemoContractsInert(page.request);
    const typeName = await bareContractTypeName(page.request);

    // The stack under test. Read before the journey so a run that cannot
    // see its own containers fails saying so, rather than after an
    // upload it cannot explain.
    const container = await appContainer();
    const app = await inspect(container);

    const stamp = Date.now();
    const readerEmail = `e2e-m12-reader-${stamp}@e2e.example`;
    const title = `${CONTRACT_PREFIX} ${stamp}`;
    const redline: Upload = {
      name: `ashworth-msa-round-three-${stamp}.docx`,
      body: TRACKED_CHANGES_DOCX,
      mimeType: DOCX_MIME,
      kind: "redline_theirs",
      note: REDLINE_NOTE,
    };
    const scan: Upload = {
      name: `ashworth-assignment-scan-${stamp}.pdf`,
      body: SCAN_PDF,
      mimeType: "application/pdf",
      kind: "executed",
      note: SCAN_NOTE,
    };
    let reader: OnboardedMember | undefined;

    /**
     * Leaves the shared instance as the run found it (TECH-018): the
     * per-run paper erased and its blobs and renditions with it, the
     * per-run contract archived, and the per-run person archived.
     */
    const leaveInert = async () => {
      await reader?.context.close();
      await ensureDemoContractsInert(page.request);
      await ensureMemberInert(page.request, readerEmail);
    };

    try {
      reader = await onboardActivatedMember(page.request, browser, {
        email: readerEmail,
        displayName: READER_NAME,
        role: "legal_team_member",
        password: "their-own-e2e-password",
      });
      const readerPage = reader.page;

      // Everything the browser fetches, from here to the end of the Word
      // leg. The milestone's sentence is "without downloading it", and
      // this is what measures it.
      const fetched: string[] = [];
      readerPage.on("request", (request) => fetched.push(request.url()));
      const downloads: string[] = [];
      readerPage.on("download", (download) => downloads.push(download.url()));

      // ---- A contract to put the paper on ----

      await readerPage.goto("/contracts");
      await readerPage.getByRole("button", { name: "Create contract" }).first().click();
      const create = readerPage.getByRole("dialog");
      await create.getByLabel("Title").fill(title);
      await create.getByLabel("Contract type").selectOption({ label: typeName });
      const created = readerPage.waitForResponse(
        (response) =>
          response.url().endsWith("/api/v1/contracts") && response.request().method() === "POST",
      );
      await create.getByRole("button", { name: "Create", exact: true }).click();
      const contract = z
        .object({ contract: z.object({ id: z.string(), number: z.number().int() }) })
        .parse(await (await created).json()).contract;
      await expect(create).toBeHidden();

      await readerPage.goto(`/contracts/${contract.number}`);
      await expect(readerPage.getByRole("heading", { level: 1, name: title })).toBeVisible();
      await openDocumentsSection(readerPage, contract.number);

      // ---- Stories 2 and 12: the Word redline lands, and converts ----

      const wordDocument = await uploadThroughComposer(readerPage, redline);
      await expect(roundRow(readerPage, REDLINE_NOTE)).toHaveCount(1);

      const wordVersion = wordDocument.versions[0]!;
      // The server routed the file, not the client (DOC-004). A Word
      // document is its own family, which is what puts it on the
      // converted path rather than on the download card.
      expect(wordVersion.renderFamily).toBe("word");
      expect(wordVersion.originalFilename).toBe(redline.name);

      // ---- The screen half: the draft reads in the panel ----
      //
      // The document's name is a button rather than a download link,
      // which is the whole difference M12 made to this row: a file the
      // app can read opens, and a file it cannot still downloads.
      const openIt = roundRow(readerPage, REDLINE_NOTE).getByRole("button", {
        name: wordDocument.title,
        exact: true,
      });
      await expect(openIt).toHaveCount(1);
      await openIt.click();

      const panel = docPanel(readerPage, wordDocument.title, 1);
      await expect(panel).toBeVisible();
      // The panel says which document is on screen and which round of it.
      await expect(
        panel.getByRole("heading", { level: 2, name: wordDocument.title }),
      ).toBeVisible();
      await expect(panel.getByText("v1", { exact: true })).toBeVisible();

      // The conversion is background work, so the surface arrives when
      // it arrives. Until then the panel says so rather than showing a
      // broken preview — and what lands is a PDF surface with page
      // controls, because a rendition is a PDF and reads exactly like
      // one.
      const pdfSurface = panel.getByRole("region", { name: `${redline.name}, pages` });
      await expect(pdfSurface).toBeVisible({ timeout: DERIVATION_TIMEOUT_MS });
      // Where the reader is moved off the well and onto the toolbar
      // above it (2026-08-18): the well scrolls through the whole
      // document now, so a name carrying the page number would change
      // under every scroll tick and a screen reader would announce the
      // region again on each one. The count is still the proof pdf.js
      // read the file rather than failed on it — the same spot says
      // "Opening…" until it has.
      await expect(panel.getByText(/^Page \d+ of \d+$/)).toBeVisible({
        timeout: SURFACE_TIMEOUT_MS,
      });
      await expect(panel.getByRole("button", { name: "Next page" })).toBeVisible();

      // DOC-004's promise, on screen: the counterparty's deletion, their
      // insertion, and the comment they left are all in what the reader
      // sees. A conversion that quietly dropped any of them would look
      // correct and hide the negotiation.
      //
      // Waited for rather than read once. The surface appears as soon as
      // pdf.js has the file; the page is drawn and its words laid over
      // it a moment later, and reading the layer in between would ask
      // the question before the answer exists.
      await expect
        .poll(
          async () => {
            const drawn = await wordsOnScreen(panel);
            return TRACKED_CHANGES.filter((change) => !drawn.includes(change));
          },
          {
            message: "the conversion never showed these tracked changes",
            timeout: SURFACE_TIMEOUT_MS,
            intervals: [500],
          },
        )
        .toEqual([]);

      // ---- The seam half: what the panel was actually served ----

      const renditionAddress = versionAddress(wordDocument, wordVersion.id, "rendition");
      expect(await readRendition(readerPage, renditionAddress)).toBe("ready");

      const previewed = await readerPage.request.get(
        versionAddress(wordDocument, wordVersion.id, "preview"),
      );
      expect(previewed.status(), await previewed.text()).toBe(200);
      // The two headers the preview differs from the download in, plus
      // the two that keep a browser navigated straight at it inert.
      expect(previewed.headers()["content-type"]).toBe("application/pdf");
      expect(previewed.headers()["content-disposition"]).toContain("inline");
      expect(previewed.headers()["x-content-type-options"]).toBe("nosniff");
      const rendition = await previewed.body();
      // What was served is a PDF, and it is not the file that was
      // uploaded. "Converted for display" is exactly this difference.
      expect(rendition.subarray(0, 5).toString("latin1")).toBe("%PDF-");
      expect(rendition.equals(TRACKED_CHANGES_DOCX)).toBe(false);

      // Story 20: the same conversion is where the version's text comes
      // from — one extraction path, over PDF.
      const wordText = await pollText(
        readerPage,
        versionAddress(wordDocument, wordVersion.id, "text"),
      );
      expect(wordText.source).toBe("rendition");
      for (const change of TRACKED_CHANGES) {
        expect(flat(wordText.text ?? ""), `the extracted text is missing "${change}"`).toContain(
          change,
        );
      }

      // ---- "Without downloading it", measured ----
      //
      // The browser fetched the preview and never once fetched the
      // download, and no download ever started. The affordance is still
      // there — the panel offers it — and reading the draft did not need
      // it.
      const downloadAddress = versionAddress(wordDocument, wordVersion.id, "download");
      expect(fetched.some((url) => url.endsWith(`${wordVersion.id}/preview`))).toBe(true);
      expect(fetched.filter((url) => url.includes("/download"))).toEqual([]);
      expect(downloads).toEqual([]);
      await expect(panel.getByRole("link", { name: "Download" })).toHaveAttribute(
        "href",
        downloadAddress,
      );

      // The original is still the record (DOC-004): the download answers
      // the bytes a person uploaded, byte for byte, whatever the panel
      // drew from.
      const downloaded = await readerPage.request.get(downloadAddress);
      expect(downloaded.status(), await downloaded.text()).toBe(200);
      expect((await downloaded.body()).equals(TRACKED_CHANGES_DOCX)).toBe(true);

      // The one surface this milestone added, scanned and asserted
      // rather than reported: it is this milestone's own, so a finding
      // in it is this milestone's to fix (#48, DES-011).
      expect(
        await reportAxeViolations(readerPage, testInfo, "m12-doc-panel", {
          include: `aside[aria-label="${wordDocument.title}, version 1"]`,
        }),
      ).toEqual([]);

      // Esc closes the panel and focus comes back to the row that opened
      // it (story 25, DES-010).
      await readerPage.keyboard.press("Escape");
      await expect(panel).toBeHidden();
      await expect(openIt).toBeFocused();

      // ---- Stories 9, 10, and 11: the scan, and the OCR behind it ----

      const scanDocument = await uploadThroughComposer(readerPage, scan);
      const scanVersion = scanDocument.versions[0]!;
      expect(scanVersion.renderFamily).toBe("pdf");

      const scanTextAddress = versionAddress(scanDocument, scanVersion.id, "text");
      // Story 11: nothing waits on the pipeline. The upload has already
      // answered 201 and the words are not there yet — reading a
      // photograph of a page is seconds of work, and none of it happened
      // while the uploader was waiting.
      //
      // This is a fact, not a race. The only way it could read `ready`
      // is for the whole extraction — the blob off the volume, a call to
      // the doc engine for the text layer, an OCR pass over a
      // rasterised page, and the write — to finish inside the one
      // round trip between the upload's answer and this question. OCR
      // alone is hundreds of milliseconds. If a run ever does see
      // `ready` here, the interesting thing that changed is the
      // pipeline, not the assertion.
      const owedText = await readerPage.request.get(scanTextAddress);
      expect(owedText.status(), await owedText.text()).toBe(200);
      expect(TextEnvelope.parse(await owedText.json()).text.state).toBe("pending");

      await expect(roundRow(readerPage, SCAN_NOTE)).toHaveCount(1);
      expect(await readPaper(readerPage.request, contract.number)).toHaveLength(2);

      // Story 10: the preview is the scan itself, byte for byte. A PDF
      // is not converted at all, so there is no rendition to be tempted
      // by — the read says so plainly rather than leaving a caller to
      // poll for something that is not coming.
      const scanPreview = await readerPage.request.get(
        versionAddress(scanDocument, scanVersion.id, "preview"),
      );
      expect(scanPreview.status(), await scanPreview.text()).toBe(200);
      expect(scanPreview.headers()["content-type"]).toBe("application/pdf");
      expect((await scanPreview.body()).equals(SCAN_PDF)).toBe(true);
      expect(
        await readRendition(readerPage, versionAddress(scanDocument, scanVersion.id, "rendition")),
      ).toBe("unsupported");

      // ---- The screen half: what renders is the picture ----

      const openScan = roundRow(readerPage, SCAN_NOTE).getByRole("button", {
        name: scan.name,
        exact: true,
      });
      await openScan.click();
      const scanPanel = docPanel(readerPage, scan.name, 1);
      await expect(scanPanel).toBeVisible();
      // The page count is the proof pdf.js read the file rather than
      // failed on it: a surface that could not open the PDF says so
      // instead, and one still opening says "Opening…". It reads off
      // the toolbar rather than off the well's own name, which carries
      // the file alone since 2026-08-18.
      await expect(scanPanel.getByRole("region", { name: `${scan.name}, pages` })).toBeVisible({
        timeout: SURFACE_TIMEOUT_MS,
      });
      await expect(scanPanel.getByText("Page 1 of 1")).toBeVisible({
        timeout: SURFACE_TIMEOUT_MS,
      });

      // ---- The seam half: OCR made the text available ----

      const scanText = await pollText(readerPage, scanTextAddress);
      // Where the words came from is recorded rather than inferred: OCR
      // text is a machine's reading of a photograph, and the search
      // index M25 builds has to know which it holds.
      expect(scanText.source).toBe("ocr");
      for (const words of SCANNED_WORDS) {
        expect(flat(scanText.text ?? ""), `OCR did not read "${words}"`).toContain(words);
      }

      // DOC-005's rule, asserted rather than described: the original
      // scan is always what renders, and the extracted text is an index
      // and never a displayed conversion. The page on screen is a
      // picture of a page, so it has no words in it at all — while the
      // seam above has every one of them. Asked after the text landed,
      // so this is an emptiness that outlasted the OCR rather than one
      // the test caught the surface in.
      expect(hasWords(await wordsOnScreen(scanPanel))).toBe(false);

      // ---- Stories 21 and 22: the deployer's four services ----

      // The project this run's app belongs to, off the container's own
      // Compose label — so the four services counted are the four this
      // suite is talking to and not another stack's.
      const project = await docker(
        "inspect",
        container,
        "--format",
        '{{index .Config.Labels "com.docker.compose.project"}}',
      );
      expect(project, "the app container carries no Compose project label").not.toBe("");
      const services = await servicesOf(project);
      for (const service of ["app", "worker", "doc-engine", "postgres"] as const) {
        expect(services.has(service), `the ${service} service is not up`).toBe(true);
      }

      // The three services with a readiness probe are healthy. The
      // worker has none, and that is its own answer rather than a gap:
      // it listens on nothing, so it is up when it is running.
      for (const service of ["app", "doc-engine", "postgres"] as const) {
        const inspected = await inspect(services.get(service)!);
        expect(inspected.State.Health?.Status, `the ${service} service is not healthy`).toBe(
          "healthy",
        );
      }
      const worker = await inspect(services.get("worker")!);
      expect(worker.State.Status).toBe("running");
      expect(worker.State.Health).toBeUndefined();
      // TECH-007: the same image as the app, run with a different
      // command. Not a fifth thing to build, and not a second thing to
      // keep in step.
      expect(worker.Image).toBe(app.Image);
      expect([worker.Path, ...worker.Args].join(" ")).toContain("apps/worker/dist/index.js");

      // Nothing about M12 was configured. The app and the worker carry
      // the compose file's own default for the doc engine and no timeout
      // override, so this stack reached healthy on M11's configuration.
      //
      // "No override" is an empty string rather than an absent variable:
      // compose interpolates every optional setting into the container
      // either way, and empty is how the app is told nothing was set.
      for (const inspected of [app, worker]) {
        expect(env(inspected, "DOC_ENGINE_URL")).toBe("http://doc-engine:8080");
        expect(env(inspected, "DOC_ENGINE_TIMEOUT_MS") ?? "").toBe("");
      }

      // Story 22: the doc engine is reachable only on the compose
      // network, exactly as Postgres is. It carries no authentication
      // because it has nothing to authorise — the app decided who may
      // read a file long before it sent the bytes — and a published port
      // would turn that into an open conversion service.
      for (const service of ["doc-engine", "postgres"] as const) {
        const inspected = await inspect(services.get(service)!);
        expect(publishedPorts(inspected), `the ${service} service publishes a host port`).toEqual(
          [],
        );
      }
    } catch (error) {
      // A cleanup that throws here would replace the failure that caused
      // it, and the failure is the one worth reading. It says so out
      // loud instead.
      await sweepOrSay("M12 demo", leaveInert);
      throw error;
    }
    // The journey passed, so a cleanup that fails is a failure of its
    // own: it leaves the shared instance dirty for the next run.
    await leaveInert();
  });
});

/** Text with its line breaks flattened. A conversion wraps a line where
 * the page ends, so a phrase in the source can arrive split across two.
 * Every assertion about what a document says is made against this
 * form. */
function flat(text: string): string {
  return text.replaceAll(/\s+/g, " ").trim();
}

/**
 * Waits for one version's extracted text to land, and answers it.
 *
 * `pending` is the only state worth asking about again. `ready` is the
 * answer; `failed` and `unsupported` are settled, and polling through
 * either would turn a clear failure into a timeout.
 */
async function pollText(
  page: Page,
  address: string,
): Promise<z.infer<typeof TextEnvelope>["text"]> {
  let last: z.infer<typeof TextEnvelope>["text"] | undefined;
  await expect
    .poll(
      async () => {
        const answered = await page.request.get(address);
        if (answered.status() !== 200) return `HTTP ${answered.status()}`;
        last = TextEnvelope.parse(await answered.json()).text;
        // Settled, and not the answer. Said now rather than asked again
        // until the budget runs out, because a decided extraction
        // reported as a timeout is a clear failure made unreadable.
        if (last.state === "failed" || last.state === "unsupported") {
          throw new Error(`the extraction at ${address} settled as ${last.state}`);
        }
        return last.state;
      },
      {
        message: `the extracted text at ${address} never became ready`,
        timeout: DERIVATION_TIMEOUT_MS,
        intervals: [DERIVATION_POLL_MS],
      },
    )
    .toBe("ready");
  return last!;
}
