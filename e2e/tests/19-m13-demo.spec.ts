// SPDX-License-Identifier: AGPL-3.0-only

/**
 * M13 milestone acceptance (#219): the demo, end to end.
 *
 * Drag a folder of legacy contract files onto a contract and watch the
 * nested structure survive the drop.
 *
 * The journey is one Legal Team Member and one contract. They drop a
 * handful of files on the record's Documents section and cancel, which
 * creates nothing. Then they bring in a whole legacy folder — six files
 * across six folders three levels deep — as one import with one version
 * kind, and the tree that arrives is the tree they had. Then they drop a
 * seventh file straight onto a folder row, and it is filed there because
 * that is where it landed. Finally the same import path is run at
 * volume: a 200-file legacy book, every file in its folder, the
 * derivations draining behind it, and the section still answering while
 * they do.
 *
 * Each leg is proved twice, on the M9 to M12 specs' rule: once on what
 * the screen draws, and once on what the seam answers. The two halves
 * catch different lies here. A tree drawn from the client's own reading
 * of the dropped paths would satisfy the screen and fail the seam,
 * because the seam is asked which folder each document is actually filed
 * in. A server that filed everything correctly and a section that drew
 * one flat list would pass the seam and fail the screen.
 *
 * **How the folder gets into the browser, said plainly.**
 *
 * Playwright cannot perform an operating-system drag of a directory.
 * Two routes were measured before this spec was written, and both
 * failures are recorded here so the next person does not measure them
 * again:
 *
 * 1. A `DataTransfer` built in the page carries real files, and its
 *    items answer `webkitGetAsEntry()` with null — so a drop of one is
 *    the flat reading `filesFromDrop` documents as its fallback. Real
 *    bytes, real drop event, no structure.
 * 2. Chrome DevTools Protocol `Input.dispatchDragEvent` with a directory
 *    path does produce a real `FileSystemDirectoryEntry`, and its
 *    `readEntries` then fails with `EncodingError` — the renderer is
 *    never granted the isolated file system a genuine drag would carry.
 *    The app reads that correctly as **unreadable, not empty**, which is
 *    #218's own distinction working, and it imports nothing.
 *
 * So the structure travels by the **directory picker** — folder drop's
 * pointer-free twin (DES-033 §7), which is a shipped path and not a test
 * hook. Playwright hands a real directory to a `webkitdirectory` input,
 * the browser fills in `webkitRelativePath` on every file, and
 * `filesFromDirectoryPicker` turns that into the same `DroppedFile[]` a
 * dropped tree produces. From there it is the same batch dialog, the
 * same per-file upload carrying `folderPath`, and the same server
 * find-or-create under the contract's row lock.
 *
 * **What that proves**: the confirmation, the one-kind rule, the N
 * uploads with their paths, the find-or-create, the tree the section
 * draws, and every document filed where its path said — the whole of the
 * demo sentence from the picked structure onwards.
 *
 * **What it does not prove**: the `webkitGetAsEntry` walk of a dropped
 * directory (`filesFromDrop`'s recursion, its paged `readEntries`, and
 * the empty directories it recreates). Those have API and web coverage
 * from #218 and no e2e coverage, because no browser automation can
 * deliver them. The **gesture** is still proved here — two drops run
 * through a real drop event on the real surface, one on the section and
 * one on a folder row, and the second is filed by where it landed.
 *
 * **The volume leg** (DOC-011, DOC-005, and #213's Further Notes). Two
 * hundred files, the number the milestone is written about, in ten
 * folders of twenty under one root. Every file is a PDF with a real text
 * layer, so each landing enqueues a real extraction rather than a job
 * with nothing to do. The leg asserts three things: every file is filed
 * in its own folder, every version's text arrives without anybody asking
 * for it, and the section keeps answering while the queue works — the
 * responsiveness check runs against the record while the drain is still
 * in flight, and its budget is a bound rather than a stopwatch.
 *
 * The fixture is the repository's own `native-text.pdf`, read from where
 * it is committed rather than copied here. It is the page M12's scan is
 * a picture of, with its text layer intact, and a second copy of a
 * binary would be a copy that drifts.
 * `apps/api/scripts/build-doc-engine-fixtures.ts` is how it was made.
 *
 * The never-reset instance (TECH-018) is left as the run found it, on
 * the earlier demo specs' convention: per-run rows carry this spec's own
 * prefix and are swept before the journey starts. The sweep erases the
 * paper before it archives the contract, because a document is the one
 * thing here with a hard delete (DOC-010) — and this spec makes two
 * hundred of them, so leaving the blobs would grow the volume by a
 * legacy book per run, forever. The folders go with the contract: a
 * folder has no hard delete, and an archived contract's tree is inert.
 */

import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { test, expect, type APIRequestContext, type Locator, type Page } from "@playwright/test";
import { z } from "zod";
import {
  ADMIN,
  ensureAdminExists,
  ensureMemberInert,
  onboardActivatedMember,
  reportAxeViolations,
  signInAs,
  sweepOrSay,
  type OnboardedMember,
} from "./helpers.js";

/**
 * The journey imports two hundred files and then waits for two hundred
 * text extractions to drain, on a runner that is also running Postgres,
 * the app, the worker, the doc engine, and a browser.
 *
 * It is deliberately more than every budget below can add up to: the
 * import (300s), the drain (600s), the surfaces, and the onboarding, the
 * small legs, and the sweep of two hundred documents around them. A
 * pipeline that never delivers should fail saying exactly that, and a
 * test timeout that fired first would take the sentence away and leave a
 * stopwatch in its place.
 */
test.setTimeout(1_200_000);

/** Per-run contracts carry this prefix, so a crashed earlier run's
 * leftovers can be swept before the journey starts. It is this spec's
 * own: the demo specs sweep their own rows and must not reach into each
 * other's. */
const CONTRACT_PREFIX = "E2E M13 Ashworth acquisition";

/** The person the milestone is written for (stories 8, 10 and 12). */
const IMPORTER_NAME = "Rhea Counsel";

/** The kind the batch applies to every file in it, as the confirmation
 * offers it and the seam records it. One batch, one kind (DOC-011). */
const BATCH_KIND = "draft_ours";

/**
 * How long the 200-file import may take before the demo calls it broken.
 *
 * Generous on purpose. It is two hundred multipart uploads three at a
 * time, each one taking the contract's row lock to find-or-create its
 * folder and to number its version, on a shared runner. What is being
 * proved is that a legacy book arrives whole, not that it arrives
 * quickly.
 */
const VOLUME_IMPORT_TIMEOUT_MS = 300_000;

/** The same bound for the small imports of the demo leg, where the whole
 * batch is a handful of files. */
const IMPORT_TIMEOUT_MS = 120_000;

/**
 * How long the derivations may take to drain.
 *
 * The worker takes one job at a time on purpose (M12), so two hundred
 * extractions are two hundred round trips to the doc engine, one after
 * another, behind whatever the sweep at boot left. Again: what is proved
 * is that the queue empties on its own, not how fast.
 */
const DRAIN_TIMEOUT_MS = 600_000;

/** How often the demo asks whether the queue has drained. The panel's
 * own poll is 1.5s; this is the same order, so the wait the test
 * measures is the wait a reader would have. */
const DRAIN_POLL_MS = 2_000;

/**
 * What "the app stays responsive" is allowed to mean.
 *
 * A ceiling rather than a measurement: the record is loaded again and a
 * folder of twenty documents is opened while the queue is still
 * draining, and both have to answer inside it. Fifteen seconds is
 * unusable for a person and generous for a CI runner that is at the same
 * time extracting text from a two-hundred-file backlog — which is the
 * point. A section that had been taken down by the backlog fails this by
 * minutes, not by seconds.
 */
const RESPONSIVE_TIMEOUT_MS = 15_000;

/**
 * How long a surface that already has its bytes may take to finish
 * drawing.
 *
 * Nothing here is waiting on a job — the file is in the browser. It is
 * pdf.js parsing a page, rasterising it, and laying its text runs over
 * the canvas, which is work a slow runner can still make take seconds.
 */
const SURFACE_TIMEOUT_MS = 30_000;

/** What the fixture's text layer says (DOC-005). The same phrases M12
 * states OCR's reading over, because they are facts about the same page
 * — this is that page with its words still in it. */
const PAGE_WORDS = [
  "DEED OF ASSIGNMENT",
  "This deed is dated the first of March.",
  "The assignor transfers the whole of the rights.",
] as const;

/** The repository's committed doc-engine fixture, read where it lives.
 * A PDF with a real text layer: it renders in the panel and it gives the
 * extraction something to find. See
 * apps/api/scripts/build-doc-engine-fixtures.ts. */
const PAGE_PDF = readFileSync(
  fileURLToPath(
    new URL("../../apps/api/src/testing/fixtures/doc-engine/native-text.pdf", import.meta.url),
  ),
);

const PDF_MIME = "application/pdf";

/** The folder the legacy book sits in on the importer's drive, and
 * therefore the folder the record grows at its root: the picker carries
 * the chosen directory's own name on every file under it. */
const BOOK = "Ashworth acquisition";

/**
 * The tree that is picked, exactly as it sits on disk.
 *
 * Six files across six folders, three levels deep, with a file at every
 * level including the root of the picked folder. `Correspondence` is
 * deliberately spelt in title case beside `Executed` and `Schedules` so
 * the case-insensitive sibling sort has something to sort.
 */
const BOOK_FILES = [
  `${BOOK}/cover-note.pdf`,
  `${BOOK}/Correspondence/opening-letter.pdf`,
  `${BOOK}/Correspondence/2025/november-thread.pdf`,
  `${BOOK}/Executed/signed-spa.pdf`,
  `${BOOK}/Schedules/schedule-1.pdf`,
  `${BOOK}/Schedules/Disclosure/disclosure-letter.pdf`,
] as const;

/** Where each of them has to end up: the file's own name, and the folder
 * path the record must file it in. This is the demo sentence, written
 * down. */
const BOOK_DESTINATIONS: ReadonlyMap<string, string> = new Map(
  BOOK_FILES.map((path) => {
    const segments = path.split("/");
    return [segments.at(-1)!, segments.slice(0, -1).join("/")] as const;
  }),
);

/** Every folder the picked tree must create, root-first paths. */
const BOOK_FOLDERS = [
  BOOK,
  `${BOOK}/Correspondence`,
  `${BOOK}/Correspondence/2025`,
  `${BOOK}/Executed`,
  `${BOOK}/Schedules`,
  `${BOOK}/Schedules/Disclosure`,
] as const;

/** The file dropped straight onto a folder row, and the folder it is
 * dropped on. Its destination is decided by where the gesture landed and
 * by nothing the file itself carries. */
const DROPPED_ON_ROW = "board-minutes.pdf";
const DROP_TARGET_FOLDER = "Executed";

/** The two files of the cancelled drop. They never reach the record, so
 * their names only ever appear in the confirmation. */
const CANCELLED_FILES = ["term-sheet.pdf", "heads-of-terms.pdf"] as const;

/** The legacy book of #213's own sentence: two hundred files, in ten
 * folders of twenty, under one root. */
const VOLUME_ROOT = "Legacy book";
const VOLUME_FOLDERS = 10;
const VOLUME_PER_FOLDER = 20;
const VOLUME_FILES = VOLUME_FOLDERS * VOLUME_PER_FOLDER;

/** Only what the sweep reads: the title it matches on and the reference
 * it archives by. */
const ContractRows = z.object({
  contracts: z.array(z.object({ number: z.number().int(), title: z.string() })),
});

/** One document, as the seam answers it — the fields this demo is about,
 * and nothing else. `folderId` is here because it is the whole question
 * the milestone asks: where did this file actually end up. */
const DocumentSchema = z.object({
  id: z.string(),
  title: z.string(),
  folderId: z.string().nullable(),
  isPrimary: z.boolean(),
  versions: z.array(
    z.object({
      id: z.string(),
      versionNumber: z.number().int(),
      kind: z.string(),
      originalFilename: z.string(),
      isCurrent: z.boolean(),
    }),
  ),
});

const DocumentRows = z.object({
  documents: z.array(DocumentSchema),
  nextCursor: z.string().nullable(),
});

type DocumentRow = z.infer<typeof DocumentSchema>;

/** One folder on the record, as the folder routes answer it (DOC-006).
 * The count is scoped to the viewer, which is what makes it the number
 * the row draws. */
const FolderSchema = z.object({
  id: z.string(),
  name: z.string(),
  parentId: z.string().nullable(),
  documentCount: z.number().int(),
});

const FolderRows = z.object({ folders: z.array(FolderSchema) });

type FolderRow = z.infer<typeof FolderSchema>;

/** The extracted text (DOC-005), with where it came from. */
const TextEnvelope = z.object({
  text: z.object({ state: z.string(), source: z.string().nullable(), text: z.string().nullable() }),
});

async function listContracts(request: APIRequestContext) {
  const listed = await request.get("/api/v1/contracts");
  expect(listed.ok()).toBe(true);
  return ContractRows.parse(await listed.json()).contracts;
}

/**
 * One contract's whole paper, archived rows included, paged to the end.
 *
 * Paged rather than read once, because this spec makes four times a page
 * of documents on one record and a first page would quietly answer the
 * newest fifty (CTR-024).
 */
async function readPaper(
  request: APIRequestContext,
  number: number,
): Promise<readonly DocumentRow[]> {
  const all: DocumentRow[] = [];
  let cursor: string | null = null;
  do {
    const query = new URLSearchParams({ includeArchived: "true" });
    if (cursor !== null) query.set("cursor", cursor);
    const listed = await request.get(`/api/v1/contracts/${number}/documents?${query.toString()}`);
    expect(listed.status(), await listed.text()).toBe(200);
    const page = DocumentRows.parse(await listed.json());
    all.push(...page.documents);
    cursor = page.nextCursor;
  } while (cursor !== null);
  return all;
}

/** One contract's folders, whole — the set the tree is drawn from. */
async function readFolders(
  request: APIRequestContext,
  number: number,
): Promise<readonly FolderRow[]> {
  const listed = await request.get(`/api/v1/contracts/${number}/folders`);
  expect(listed.status(), await listed.text()).toBe(200);
  return FolderRows.parse(await listed.json()).folders;
}

/**
 * Every folder's path from the record root, by its id.
 *
 * The set comes back flat with a parent reference on each row, and the
 * question this demo asks is about paths — so the paths are built once
 * and the assertions read like the tree that was picked.
 */
function pathsById(folders: readonly FolderRow[]): Map<string, string> {
  const byId = new Map(folders.map((folder) => [folder.id, folder]));
  const paths = new Map<string, string>();
  for (const folder of folders) {
    const names: string[] = [];
    let at: FolderRow | undefined = folder;
    // Bounded by the set's own size: the seam refuses a cycle, and a
    // walk that trusted that without a bound would hang rather than
    // report a wrong path.
    for (let step = 0; at !== undefined && step <= folders.length; step += 1) {
      names.unshift(at.name);
      at = at.parentId === null ? undefined : byId.get(at.parentId);
    }
    paths.set(folder.id, names.join("/"));
  }
  return paths;
}

/** Where each document is filed, as a path from the record root, by the
 * document's own title. The record root itself is the empty string. */
function filingByTitle(
  documents: readonly DocumentRow[],
  folders: readonly FolderRow[],
): Map<string, string> {
  const paths = pathsById(folders);
  return new Map(
    documents.map((document) => [
      document.title,
      document.folderId === null ? "" : (paths.get(document.folderId) ?? "unknown folder"),
    ]),
  );
}

/**
 * Leaves every per-run contract inert, paper first (TECH-018 cleanup).
 *
 * A document is the one thing this demo creates that has a real hard
 * delete (DOC-010), and this spec creates two hundred of them. The
 * contract has no hard delete, so archived is its resting state — and
 * its folders rest with it, since a folder is only ever reachable
 * through the record that owns it. The Administrator runs both.
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
 * dialog names it. The demo is about the record's paper, not about the
 * field catalog. */
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

/** Makes a contract through the create dialog and answers its reference
 * (CTR-003). */
async function createContract(page: Page, title: string, typeName: string): Promise<number> {
  await page.goto("/contracts");
  await page.getByRole("button", { name: "Create contract" }).first().click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Title").fill(title);
  await dialog.getByLabel("Contract type").selectOption({ label: typeName });
  const created = page.waitForResponse(
    (response) =>
      response.url().endsWith("/api/v1/contracts") && response.request().method() === "POST",
  );
  await dialog.getByRole("button", { name: "Create", exact: true }).click();
  const contract = z
    .object({ contract: z.object({ number: z.number().int() }) })
    .parse(await (await created).json()).contract;
  await expect(dialog).toBeHidden();
  return contract.number;
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
 * and the address is the proof it landed — the same helper the M11 and
 * M12 demos gained when the strip arrived.
 */
async function openDocumentsSection(page: Page, number: number): Promise<void> {
  await page
    .getByRole("navigation", { name: "Contract sections" })
    .getByRole("link", { name: "Documents" })
    .click();
  await expect(page).toHaveURL(new RegExp(`/contracts/${number}/documents$`));
}

/**
 * One folder's row, found by the control only a folder row carries.
 *
 * Not by the name it draws: a folder called `Disclosure` and a document
 * called `disclosure-letter.pdf` are two rows of one table, and a row
 * matched on its text would be either of them. Every folder takes the
 * chevron (M13/3), and the chevron says which folder it opens, so it is
 * the one mark that tells the two row kinds apart.
 */
function folderRow(page: Page, name: string): Locator {
  return documentsSection(page)
    .getByRole("row")
    .filter({
      has: page.getByRole("button", {
        name: new RegExp(`^(Expand|Collapse) ${escapeForRegExp(name)}$`),
      }),
    });
}

/** One document's row, found by the file it is. */
function documentRow(page: Page, name: string): Locator {
  return documentsSection(page).getByRole("row").filter({ hasText: name });
}

/**
 * Opens one folder and waits for its documents to arrive.
 *
 * The chevron is on every folder (M13/3), and pressing it loads the
 * folder's own listing through the list route filtered to it. The wait
 * is on the control's own state rather than on a duration: `aria-expanded`
 * flips when the folder opens, and the caller asserts what is inside.
 */
async function expandFolder(page: Page, name: string): Promise<void> {
  const toggle = documentsSection(page).getByRole("button", {
    name: `Expand ${name}`,
    exact: true,
  });
  await toggle.click();
  await expect(
    documentsSection(page).getByRole("button", { name: `Collapse ${name}`, exact: true }),
  ).toHaveAttribute("aria-expanded", "true");
}

/** One file, as a drop carries it into the page. */
interface Carried {
  name: string;
  mimeType: string;
  base64: string;
}

function carried(name: string, bytes: Buffer = PAGE_PDF): Carried {
  return { name, mimeType: PDF_MIME, base64: bytes.toString("base64") };
}

/**
 * Drops files on one element, through a real drop event.
 *
 * The `DataTransfer` is built in the page and carries real bytes. Its
 * items answer `webkitGetAsEntry()` with null, which is the shape
 * `filesFromDrop` documents as its fallback, so what arrives is a flat
 * batch at whatever the gesture landed on. That is the honest limit of
 * browser automation: the gesture and the destination are real, the
 * nesting is not — the picked tree below is where the nesting is proved.
 */
async function dropOn(page: Page, target: Locator, files: readonly Carried[]): Promise<void> {
  const transfer = await page.evaluateHandle((items) => {
    const carrying = new DataTransfer();
    for (const item of items) {
      const binary = atob(item.base64);
      const bytes = new Uint8Array(binary.length);
      for (let at = 0; at < binary.length; at += 1) bytes[at] = binary.charCodeAt(at);
      carrying.items.add(new File([bytes], item.name, { type: item.mimeType }));
    }
    return carrying;
  }, files);
  try {
    await target.dispatchEvent("dragover", { dataTransfer: transfer });
    await target.dispatchEvent("drop", { dataTransfer: transfer });
  } finally {
    // The handler reads every item out of the transfer before it awaits
    // anything, so the files are already in the page's hands by now.
    await transfer.dispose();
  }
}

/**
 * Hands a whole directory to the composer's folder picker, the way a
 * person does it: Upload, Choose folder, pick the folder.
 *
 * This is folder drop's pointer-free twin (DES-033 §7). The browser puts
 * `webkitRelativePath` on every file under the chosen directory, so the
 * structure arrives exactly as a dropped tree's does, and the composer
 * hands the whole pick to the batch confirmation.
 */
async function pickFolder(page: Page, directory: string): Promise<void> {
  await documentsSection(page).getByRole("button", { name: "Upload", exact: true }).click();
  const composer = page.getByRole("dialog");
  await expect(composer.getByText("Upload document")).toBeVisible();
  const chooser = page.waitForEvent("filechooser");
  // The button carries the field's label as well as its own, because the
  // input the label points at is out of the tab order and this is the
  // control a keyboard reaches.
  await composer.getByRole("button", { name: "File Choose folder" }).click();
  await (await chooser).setFiles(directory);
}

/** Writes one tree of identical PDFs to disk, so the picker has
 * something real to pick. */
function writeTree(root: string, relativePaths: readonly string[]): void {
  for (const relative of relativePaths) {
    const at = join(root, relative);
    mkdirSync(dirname(at), { recursive: true });
    writeFileSync(at, PAGE_PDF);
  }
}

/**
 * The legacy book's own paths: ten folders of twenty files, under one
 * root. Numbered with a leading zero so the folder names sort the way
 * they read.
 *
 * Every file's name carries its box as well as its number, so no two
 * files of the book are called the same thing. A document's title is
 * the name it arrived under, and two hundred documents are checked by
 * their titles — a name that repeated across boxes would let two files
 * of one name stand for each other.
 */
function volumeBox(folder: number): string {
  return `Box ${String(folder).padStart(2, "0")}`;
}

function volumePaths(): string[] {
  const paths: string[] = [];
  for (let folder = 1; folder <= VOLUME_FOLDERS; folder += 1) {
    const box = volumeBox(folder);
    for (let file = 1; file <= VOLUME_PER_FOLDER; file += 1) {
      paths.push(
        `${VOLUME_ROOT}/${box}/deed-${String(folder).padStart(2, "0")}-${String(file).padStart(3, "0")}.pdf`,
      );
    }
  }
  return paths;
}

/** Where one version's text is read from — the same address the panel
 * itself uses. */
function textAddress(document: DocumentRow, versionId: string): string {
  return `/api/v1/documents/${document.id}/versions/${versionId}/text`;
}

/**
 * Every word the PDF surface put on screen, flattened.
 *
 * pdf.js draws the page into a canvas and lays its own text runs over
 * it, one element per run — that layer is the only place the page's
 * words exist in the DOM. It is found by the library's own class rather
 * than by a role, because pdf.js marks every run `role="presentation"`
 * so the words are never read twice. Every page in the well draws its
 * own layer (2026-08-18: the well scrolls through the whole document
 * rather than swapping one page's canvas), so this reads all of them
 * rather than assuming one — at least one is asserted to be there
 * before its runs are read, so a pdf.js upgrade that renames the class
 * fails saying so.
 */
async function wordsOnScreen(panel: Locator): Promise<string> {
  const layers = panel.locator(".textLayer");
  await expect(layers.first(), "the PDF surface has no pdf.js text layer").toBeAttached();
  const runs = await layers.locator("> *").allTextContents();
  return runs.join(" ").replaceAll(/\s+/g, " ").trim();
}

/** Text with its line breaks flattened. A page wraps a line where it
 * ends, so a phrase can arrive split across two runs. */
function flat(text: string): string {
  return text.replaceAll(/\s+/g, " ").trim();
}

/** A literal, safe to put inside a regular expression. Filenames carry a
 * dot before their extension. */
function escapeForRegExp(literal: string): string {
  return literal.replaceAll(/[.*+?^${}()|[\]\\]/g, String.raw`\$&`);
}

/** How many of the two hundred reads are in flight at once. A bound
 * rather than all of them, because a sweep that opened two hundred
 * connections would be measuring the browser's connection pool rather
 * than the queue it is watching. */
const TEXT_READ_CONCURRENCY = 10;

/**
 * How many of the given versions still owe their text, and where the
 * ones that have it read it from.
 *
 * A settled failure is raised rather than counted: a decided extraction
 * reported as a timeout is a clear failure made unreadable.
 */
async function owedText(
  page: Page,
  addresses: readonly string[],
): Promise<{ pending: number; sources: Set<string> }> {
  const sources = new Set<string>();
  let pending = 0;
  for (let from = 0; from < addresses.length; from += TEXT_READ_CONCURRENCY) {
    const answers = await Promise.all(
      addresses.slice(from, from + TEXT_READ_CONCURRENCY).map(async (address) => {
        const answered = await page.request.get(address);
        expect(answered.status(), await answered.text()).toBe(200);
        return { address, text: TextEnvelope.parse(await answered.json()).text };
      }),
    );
    for (const { address, text } of answers) {
      if (text.state === "failed" || text.state === "unsupported") {
        throw new Error(`the extraction at ${address} settled as ${text.state}`);
      }
      if (text.state === "ready") sources.add(text.source ?? "none");
      else pending += 1;
    }
  }
  return { pending, sources };
}

test.describe.serial("M13 demo path", () => {
  test.beforeAll(async ({ request }) => {
    await ensureAdminExists(request);
  });

  test("drop a folder of legacy contract files onto a contract and watch the structure survive", async ({
    page,
    browser,
  }, testInfo) => {
    await signInAs(page, ADMIN.email, ADMIN.password, ADMIN.displayName);

    // Known starting state on the never-reset instance (TECH-018): a
    // crashed earlier run may have left per-run rows — and per-run files
    // — behind.
    await ensureDemoContractsInert(page.request);
    const typeName = await bareContractTypeName(page.request);

    const stamp = Date.now();
    const importerEmail = `e2e-m13-importer-${stamp}@e2e.example`;
    const title = `${CONTRACT_PREFIX} ${stamp}`;
    const volumeTitle = `${CONTRACT_PREFIX} legacy book ${stamp}`;
    // The trees the picker picks. They live outside the repository
    // because they are made per run, and they are removed with it.
    const disk = mkdtempSync(join(tmpdir(), "openlaw-m13-"));
    let importer: OnboardedMember | undefined;

    /**
     * Leaves the shared instance as the run found it (TECH-018): the
     * per-run paper erased and its blobs and extractions with it, the
     * per-run contracts archived, the per-run person archived, and the
     * per-run trees off the disk.
     */
    const leaveInert = async () => {
      await importer?.context.close();
      await ensureDemoContractsInert(page.request);
      await ensureMemberInert(page.request, importerEmail);
      rmSync(disk, { recursive: true, force: true });
    };

    try {
      writeTree(disk, BOOK_FILES);
      writeTree(disk, volumePaths());

      importer = await onboardActivatedMember(page.request, browser, {
        email: importerEmail,
        displayName: IMPORTER_NAME,
        role: "legal_team_member",
        password: "their-own-e2e-password",
      });
      const importerPage = importer.page;

      // ---- A contract to put the legacy paper on ----

      const number = await createContract(importerPage, title, typeName);
      await importerPage.goto(`/contracts/${number}`);
      await expect(importerPage.getByRole("heading", { level: 1, name: title })).toBeVisible();
      await openDocumentsSection(importerPage, number);
      await expect(
        documentsSection(importerPage).getByText("No documents on this contract yet."),
      ).toBeVisible();

      // ---- Story 13: the drop is real, and cancel creates nothing ----
      //
      // A real drop event on the real surface, carrying real bytes. The
      // confirmation is the safety catch: an accidental drop of the
      // wrong tree writes nothing until it is confirmed.

      await dropOn(
        importerPage,
        documentsSection(importerPage),
        CANCELLED_FILES.map((name) => carried(name)),
      );
      const cancelled = importerPage.getByRole("dialog");
      await expect(
        cancelled.getByRole("heading", { level: 2, name: "Import 2 files" }),
      ).toBeVisible();
      // The gesture said where the files land, and the dialog only
      // reports it (DES-033 §9).
      const landing = cancelled.getByRole("group", { name: "Destination" });
      await expect(landing).toContainText("Record root");
      await expect(landing).toContainText("Set by the drop");
      for (const name of CANCELLED_FILES) {
        await expect(cancelled.getByText(name)).toBeVisible();
      }
      await cancelled.getByRole("button", { name: "Cancel" }).click();
      await expect(cancelled).toBeHidden();
      // Nothing was sent, so nothing exists — asserted at the seam, not
      // by the absence of a row.
      expect(await readPaper(importerPage.request, number)).toEqual([]);
      expect(await readFolders(importerPage.request, number)).toEqual([]);

      // ---- Stories 10 and 12: the legacy folder, in one decision ----

      await pickFolder(importerPage, join(disk, BOOK));
      const batch = importerPage.getByRole("dialog");
      await expect(
        batch.getByRole("heading", { level: 2, name: `Import ${BOOK_FILES.length} files` }),
      ).toBeVisible();
      // The structure is drawn before anything is created, which is what
      // the reader is actually confirming (DES-033 §9).
      await expect(batch.getByText("Folder structure is kept")).toBeVisible();
      const summary = batch.getByRole("list", { name: "What this import will create" });
      for (const folder of BOOK_FOLDERS) {
        await expect(summary.getByText(folder.split("/").at(-1)!, { exact: true })).toBeVisible();
      }
      // One kind for the whole import, defaulting to our own draft, and
      // no note field at all (DOC-011).
      await expect(batch.getByLabel("Version kind")).toHaveValue(BATCH_KIND);
      await expect(batch.getByLabel("Note")).toHaveCount(0);

      // The confirmation is a surface this milestone added, so a finding
      // in it is this milestone's to fix (#48, DES-011).
      expect(
        await reportAxeViolations(importerPage, testInfo, "m13-batch-dialog", {
          include: '[role="dialog"]',
        }),
      ).toEqual([]);

      await batch.getByRole("button", { name: `Import ${BOOK_FILES.length} files` }).click();
      await expect(
        batch.getByRole("heading", {
          level: 2,
          name: `Imported ${BOOK_FILES.length} of ${BOOK_FILES.length} files`,
        }),
      ).toBeVisible({ timeout: IMPORT_TIMEOUT_MS });
      await batch.getByRole("button", { name: "Done" }).click();
      await expect(batch).toBeHidden();

      // ---- The screen half: the tree the reader dropped ----

      const section = documentsSection(importerPage);
      // The record root holds the picked folder and nothing loose: every
      // file of the tree sat inside something.
      await expect(folderRow(importerPage, BOOK)).toHaveCount(1);
      await expandFolder(importerPage, BOOK);
      for (const child of ["Correspondence", "Executed", "Schedules"]) {
        await expect(folderRow(importerPage, child)).toHaveCount(1);
      }
      await expect(documentRow(importerPage, "cover-note.pdf")).toHaveCount(1);

      await expandFolder(importerPage, "Correspondence");
      await expect(documentRow(importerPage, "opening-letter.pdf")).toHaveCount(1);
      await expect(folderRow(importerPage, "2025")).toHaveCount(1);
      await expandFolder(importerPage, "2025");
      await expect(documentRow(importerPage, "november-thread.pdf")).toHaveCount(1);

      await expandFolder(importerPage, "Schedules");
      await expect(documentRow(importerPage, "schedule-1.pdf")).toHaveCount(1);
      await expandFolder(importerPage, "Disclosure");
      await expect(documentRow(importerPage, "disclosure-letter.pdf")).toHaveCount(1);

      // What each folder holds, scoped to this reader. One document
      // each, which is what the picked tree carried.
      for (const folder of BOOK_FOLDERS) {
        await expect(folderRow(importerPage, folder.split("/").at(-1)!)).toContainText(
          "1 document",
        );
      }
      // The section's own count is the record's paper, folders included.
      await expect(
        section.getByRole("img", { name: `${BOOK_FILES.length} documents` }),
      ).toBeVisible();

      // ---- The seam half: where the files are actually filed ----

      const folders = await readFolders(importerPage.request, number);
      expect(new Set(pathsById(folders).values())).toEqual(new Set(BOOK_FOLDERS));

      const paper = await readPaper(importerPage.request, number);
      expect(paper).toHaveLength(BOOK_FILES.length);
      expect(filingByTitle(paper, folders)).toEqual(BOOK_DESTINATIONS);
      for (const document of paper) {
        // Every dropped file is a new document at version 1: a batch
        // never appends a round to a chain it guessed at.
        expect(document.versions.map((version) => version.versionNumber)).toEqual([1]);
        // One batch, one kind (DOC-011).
        expect(document.versions[0]!.kind).toBe(BATCH_KIND);
        expect(document.versions[0]!.originalFilename).toBe(document.title);
      }
      // CTR-014, unchanged by the batch: a record with no primary takes
      // one from the first file the batch lands, and exactly one.
      expect(paper.filter((document) => document.isPrimary)).toHaveLength(1);

      // ---- A filed document opens exactly as an unfiled one ----

      const deepest = documentRow(importerPage, "november-thread.pdf").getByRole("button", {
        name: "november-thread.pdf",
        exact: true,
      });
      await deepest.click();
      const panel = importerPage.getByRole("complementary", {
        name: "november-thread.pdf, version 1",
      });
      await expect(panel).toBeVisible();
      await expect(panel.getByText("v1", { exact: true })).toBeVisible();
      await expect(
        panel.getByRole("region", {
          name: new RegExp(`^${escapeForRegExp("november-thread.pdf")}, page \\d+ of \\d+$`),
        }),
      ).toBeVisible({ timeout: SURFACE_TIMEOUT_MS });
      // The words are waited for rather than read once: the surface
      // appears as soon as pdf.js has the file, and the page's text runs
      // are laid over it a moment later.
      await expect
        .poll(
          async () => {
            const drawn = await wordsOnScreen(panel);
            return PAGE_WORDS.filter((words) => !drawn.includes(words));
          },
          {
            message: "the filed document never showed the page's own words",
            timeout: SURFACE_TIMEOUT_MS,
            intervals: [500],
          },
        )
        .toEqual([]);
      await importerPage.keyboard.press("Escape");
      await expect(panel).toBeHidden();
      await expect(deepest).toBeFocused();

      // ---- Story 9: a drop on a folder row is filed by where it landed ----

      await dropOn(importerPage, folderRow(importerPage, DROP_TARGET_FOLDER), [
        carried(DROPPED_ON_ROW),
      ]);
      const onRow = importerPage.getByRole("dialog");
      await expect(onRow.getByRole("heading", { level: 2, name: "Import 1 file" })).toBeVisible();
      // The destination is the row, not the record root — and nothing in
      // the dropped file said so. Read off the named readout rather than
      // by the folder's name alone, because `Executed` is also the name
      // of a version kind in the select below it.
      const readout = onRow.getByRole("group", { name: "Destination" });
      await expect(readout).toContainText(DROP_TARGET_FOLDER);
      await expect(readout).toContainText("Set by the drop");
      await onRow.getByRole("button", { name: "Import 1 file" }).click();
      await expect(
        onRow.getByRole("heading", { level: 2, name: "Imported 1 of 1 file" }),
      ).toBeVisible({ timeout: IMPORT_TIMEOUT_MS });
      await onRow.getByRole("button", { name: "Done" }).click();
      await expect(onRow).toBeHidden();

      const afterDrop = await readPaper(importerPage.request, number);
      const afterFolders = await readFolders(importerPage.request, number);
      expect(filingByTitle(afterDrop, afterFolders).get(DROPPED_ON_ROW)).toBe(
        `${BOOK}/${DROP_TARGET_FOLDER}`,
      );
      expect(afterFolders.find((folder) => folder.name === DROP_TARGET_FOLDER)?.documentCount).toBe(
        2,
      );
      await expect(folderRow(importerPage, DROP_TARGET_FOLDER)).toContainText("2 documents");

      // The tree is the other surface this milestone added, scanned
      // rather than reported for the same reason as the dialog.
      expect(
        await reportAxeViolations(importerPage, testInfo, "m13-folder-tree", {
          include: 'section[aria-labelledby="contract-documents-heading"]',
        }),
      ).toEqual([]);

      // ---- The volume leg: a 200-file legacy book ----
      //
      // The number #213 asks for, on its own contract so the tree above
      // stays exactly what was picked. Same picker, same dialog, same
      // per-file upload — this is the demo's own path, at the size the
      // milestone is written about.

      const volumeNumber = await createContract(importerPage, volumeTitle, typeName);
      await importerPage.goto(`/contracts/${volumeNumber}`);
      await openDocumentsSection(importerPage, volumeNumber);

      await pickFolder(importerPage, join(disk, VOLUME_ROOT));
      const book = importerPage.getByRole("dialog");
      await expect(
        book.getByRole("heading", { level: 2, name: `Import ${VOLUME_FILES} files` }),
      ).toBeVisible();
      await book.getByRole("button", { name: `Import ${VOLUME_FILES} files` }).click();
      await expect(
        book.getByRole("heading", {
          level: 2,
          name: `Imported ${VOLUME_FILES} of ${VOLUME_FILES} files`,
        }),
      ).toBeVisible({ timeout: VOLUME_IMPORT_TIMEOUT_MS });
      await book.getByRole("button", { name: "Done" }).click();
      await expect(book).toBeHidden();

      // Every file landed, and every one of them in its own folder.
      const shelved = await readPaper(importerPage.request, volumeNumber);
      expect(shelved).toHaveLength(VOLUME_FILES);
      const shelves = await readFolders(importerPage.request, volumeNumber);
      // One root and ten boxes, and not one folder more: two hundred
      // files racing on ten paths converge rather than manufacturing
      // duplicates (story 17).
      expect(shelves).toHaveLength(VOLUME_FOLDERS + 1);
      const shelfPaths = pathsById(shelves);
      expect(new Set(shelfPaths.values())).toEqual(
        new Set([
          VOLUME_ROOT,
          ...Array.from(
            { length: VOLUME_FOLDERS },
            (_, index) => `${VOLUME_ROOT}/${volumeBox(index + 1)}`,
          ),
        ]),
      );
      for (const shelf of shelves) {
        expect(shelf.documentCount).toBe(shelf.parentId === null ? 0 : VOLUME_PER_FOLDER);
      }
      const filed = filingByTitle(shelved, shelves);
      for (const path of volumePaths()) {
        const segments = path.split("/");
        expect(filed.get(segments.at(-1)!)).toBe(segments.slice(0, -1).join("/"));
      }

      // ---- The derivations drain, and the section keeps answering ----

      const owed = shelved.map((document) => textAddress(document, document.versions[0]!.id));
      const before = await owedText(importerPage, owed);
      console.log(
        `M13 volume: ${VOLUME_FILES} files landed, ${before.pending} extractions still owed.`,
      );

      // The responsiveness check runs while the queue is working: the
      // drain is started here and awaited around it, so the reads below
      // are made against a stack with a backlog behind it.
      //
      // Its failure is caught and kept rather than left loose, because a
      // rejection nobody is waiting on yet would be reported as an
      // unhandled one and lose the sentence it came with. And it is
      // waited for in a `finally`, so a responsiveness check that fails
      // does not leave the poll in flight against a browser context the
      // sweep is about to close — the failure worth reading would then
      // arrive underneath a pile of aborted requests.
      let drainFailure: unknown;
      const drained = expect
        .poll(async () => (await owedText(importerPage, owed)).pending, {
          message: "the extraction queue never drained",
          timeout: DRAIN_TIMEOUT_MS,
          intervals: [DRAIN_POLL_MS],
        })
        .toBe(0)
        .catch((failure: unknown) => {
          drainFailure = failure;
        });

      try {
        // The record loads again and a folder of twenty opens, both
        // inside the budget, while the backlog is behind them.
        await importerPage.goto(`/contracts/${volumeNumber}/documents`);
        await expect(folderRow(importerPage, VOLUME_ROOT)).toHaveCount(1, {
          timeout: RESPONSIVE_TIMEOUT_MS,
        });
        await expandFolder(importerPage, VOLUME_ROOT);
        await expect(folderRow(importerPage, "Box 01")).toHaveCount(1, {
          timeout: RESPONSIVE_TIMEOUT_MS,
        });
        await expandFolder(importerPage, "Box 01");
        await expect(documentRow(importerPage, "deed-01-001.pdf")).toHaveCount(1, {
          timeout: RESPONSIVE_TIMEOUT_MS,
        });
        await expect(folderRow(importerPage, "Box 01")).toContainText(
          `${VOLUME_PER_FOLDER} documents`,
        );
      } finally {
        await drained;
      }
      if (drainFailure !== undefined) throw drainFailure;
      // Every one of them read its own text layer, and none of it was
      // asked for by hand (DOC-005, story 19).
      expect((await owedText(importerPage, owed)).sources).toEqual(new Set(["native_layer"]));
      // And the words are the page's own, taken from one of them.
      const sampled = await importerPage.request.get(owed[0]!);
      expect(sampled.status(), await sampled.text()).toBe(200);
      const sampledText = TextEnvelope.parse(await sampled.json()).text;
      for (const words of PAGE_WORDS) {
        expect(flat(sampledText.text ?? ""), `the extraction is missing "${words}"`).toContain(
          words,
        );
      }
    } catch (error) {
      // A cleanup that throws here would replace the failure that caused
      // it, and the failure is the one worth reading. It says so out
      // loud instead.
      await sweepOrSay("M13 demo", leaveInert);
      throw error;
    }
    // The journey passed, so a cleanup that fails is a failure of its
    // own: it leaves the shared instance dirty for the next run.
    await leaveInert();
  });
});
