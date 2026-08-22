// SPDX-License-Identifier: AGPL-3.0-only

/**
 * M11 milestone acceptance (#169): the demo, end to end.
 *
 * Upload a draft to a contract, upload a revision, and see the linear
 * immutable chain with the current version pinned.
 *
 * The journey is one Legal Team Member and one contract. They make the
 * record, put the first draft on it, and then put the counterparty's
 * redline on the same document rather than beside it — which is what the
 * chain is for: the new round supersedes the old one without destroying
 * it (DOC-001). The section then has to answer the question the
 * milestone exists for, "which file matters now". Version 2 is the head
 * of the chain, version 1 is still there under it, and both still
 * download.
 *
 * **How the head row says it is the head** (2026-08-18). The section
 * used to draw a "Current" badge beside the newest round. It does not
 * any more: `chainOf` defines the head row as the version the API
 * already flagged current, so the badge could only repeat what the
 * row's own position — above rather than under "Show earlier versions"
 * — already says. This spec asserts that position instead: the head row
 * is the one carrying the chain disclosure, and its name link
 * downloads the round the API pinned.
 *
 * Each leg is proved twice, on the M9 and M10 specs' rule: once on what
 * the screen draws, and once on what the seam answers. A section that
 * put its newest row on top by its own arithmetic would pass the first
 * check and fail the second, because the pin is the server's answer.
 *
 * "Immutable" is asserted rather than described. No route edits or
 * deletes one version — corrections append — so the version's own
 * address is asked for a write, and the chain is read again after.
 *
 * **The deployer leg (DOC-009).** This is the first milestone that puts
 * a file anywhere, so the demo also proves what a deployer was promised:
 * version files sit on the named volume in the default Compose stack and
 * survive a container restart, with no extra service to run. The proof
 * is made against the running stack rather than described:
 *
 * 1. The app container's mount at STORAGE_PATH is a named volume, read
 *    off `docker inspect` — not a bind mount, and not the container's
 *    own writable layer, which is the one a restart discards.
 * 2. The uploaded bytes are found on that volume, by their own per-run
 *    marker, from inside the container.
 * 3. The container is restarted, and both versions download byte for
 *    byte identical to what was uploaded, with the chain unchanged.
 *
 * The container is found by the host port the suite is talking to, so a
 * run restarts the stack it is testing and never the other one — the
 * suite's own instance and the human testing ground run at the same time
 * (TECH-018). `E2E_APP_CONTAINER` names it outright for a stack that
 * publishes its port some other way.
 *
 * The never-reset instance (TECH-018) is left as the run found it, on
 * the earlier demo specs' convention: per-run rows carry this spec's own
 * prefix and are swept before the journey starts. The sweep erases the
 * paper before it archives the contract, because a document is the one
 * thing here with a hard delete (DOC-010) — leaving the blobs would grow
 * the volume by every run, forever.
 */

import { execFile } from "node:child_process";
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
 * The journey restarts a container and waits for the app to boot again,
 * which no other spec does. The default per-test budget is written for
 * journeys that only talk to a stack already running.
 *
 * It is deliberately more than the journey plus the readiness budget
 * below. An app that never comes back should fail saying exactly that,
 * and a test timeout that fired first would take the sentence away and
 * leave a stopwatch in its place.
 */
test.setTimeout(300_000);

/** Per-run contracts carry this prefix, so a crashed earlier run's
 * leftovers can be swept before the journey starts. It is this spec's
 * own: the demo specs sweep their own rows and must not reach into each
 * other's. */
const CONTRACT_PREFIX = "E2E M11 Meridian supply agreement";

/** The person the milestone is written for (stories 1 to 4). */
const UPLOADER_NAME = "Nadia Counsel";

/** What each round is in the negotiation, as the section writes it out
 * (CTR-014). Asserted as literals: the chain only reads as a negotiation
 * if each round says which round it is. */
const DRAFT_KIND_LABEL = "Draft · ours";
const REDLINE_KIND_LABEL = "Redline · theirs";

/** What the uploader writes about each round (story 6). Distinct on
 * purpose: each note is what tells its own row apart from the other. */
const DRAFT_NOTE = "First draft off our own paper.";
const REDLINE_NOTE = "Their mark-up: indemnity capped, term cut to two years.";

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
 * OpenLaw stacks run side by side (TECH-018) and restarting the wrong
 * one would take down somebody's testing ground. `E2E_APP_CONTAINER`
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

/** Where the app was told to keep its files, from the container's own
 * environment rather than from a copy of the default kept here. */
async function storagePath(container: string): Promise<string> {
  const env = z
    .array(z.string())
    .parse(JSON.parse(await docker("inspect", container, "--format", "{{json .Config.Env}}")));
  const set = env.find((entry) => entry.startsWith("STORAGE_PATH="));
  expect(set, "the app container declares no STORAGE_PATH").toBeDefined();
  return set!.slice("STORAGE_PATH=".length);
}

/** One row of `docker inspect`'s mount table — only what the deployer
 * leg reads. */
const Mounts = z.array(
  z.object({
    Type: z.string(),
    Name: z.string().optional(),
    Destination: z.string(),
  }),
);

/**
 * The named volume the files sit on, or a failure naming what is there
 * instead.
 *
 * This is the DOC-009 promise itself: a volume, not a bind mount to
 * whatever directory the deployer's shell was in, and not the
 * container's own writable layer — which is the one a restart discards.
 */
async function namedFilesVolume(container: string, root: string): Promise<string> {
  const mounts = Mounts.parse(
    JSON.parse(await docker("inspect", container, "--format", "{{json .Mounts}}")),
  );
  const files = mounts.find((mount) => mount.Destination === root);
  expect(
    files,
    `nothing is mounted at ${root}, so the files live in the container's own layer`,
  ).toBeDefined();
  expect(files!.Type, `${root} is a ${files!.Type} mount, not a named volume`).toBe("volume");
  expect(files!.Name ?? "").toContain("openlaw-files");
  return files!.Name!;
}

/**
 * Every stored file under the storage root whose bytes carry a marker.
 *
 * Read from inside the container, so the answer is about the mount the
 * app actually writes through. Matched as bytes rather than as text: the
 * store holds whatever the counterparty sent (DOC-004), binary included,
 * and decoding it would be a decode this proof does not need.
 */
async function storedFilesCarrying(
  container: string,
  root: string,
  marker: string,
): Promise<string[]> {
  const script = `
    const fs = require("node:fs");
    const path = require("node:path");
    // argv[0] is the interpreter, even under -e; the two after it are
    // the ones handed in below.
    const [root, marker] = process.argv.slice(1);
    const hits = [];
    const walk = (dir) => {
      // A storage root that is not there is the assertion's answer, not
      // a crash: returning empty lets the caller report "no stored file
      // holds these bytes", where an ENOENT out of readdir would report
      // only itself.
      if (!fs.existsSync(dir)) return;
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(full);
        else if (fs.readFileSync(full).includes(marker)) hits.push(full);
      }
    };
    walk(root);
    process.stdout.write(JSON.stringify(hits.sort()));
  `;
  return z
    .array(z.string())
    .parse(JSON.parse(await docker("exec", container, "node", "-e", script, root, marker)));
}

/**
 * Restarts the container and waits for the app to answer again.
 *
 * The probe is a plain fetch rather than a request fixture: it has to
 * survive a refused connection while the container is down, which is the
 * state it is watching for the end of.
 */
async function restartAndWait(container: string): Promise<void> {
  await docker("restart", container);
  await expect
    .poll(
      async () => {
        try {
          return (await fetch(`${BASE_URL}/readyz`)).ok;
        } catch {
          return false;
        }
      },
      {
        message: `the app never answered ${BASE_URL}/readyz after the restart`,
        timeout: 120_000,
        intervals: [1000],
      },
    )
    .toBe(true);
}

/** Only what the sweep reads: the title it matches on and the reference
 * it archives by. */
const ContractRows = z.object({
  contracts: z.array(z.object({ number: z.number().int(), title: z.string() })),
});

/** The chain as the seam answers it — the fields the demo sentence is
 * about, and nothing else. */
const DocumentRows = z.object({
  documents: z.array(
    z.object({
      id: z.string(),
      title: z.string(),
      isPrimary: z.boolean(),
      versions: z.array(
        z.object({
          id: z.string(),
          versionNumber: z.number().int(),
          kind: z.string(),
          note: z.string().nullable(),
          originalFilename: z.string(),
          byteSize: z.number().int(),
          isCurrent: z.boolean(),
        }),
      ),
    }),
  ),
});

const ActivityEntries = z.object({
  entries: z.array(z.object({ action: z.string(), visibility: z.string() })),
});

type DocumentRow = z.infer<typeof DocumentRows>["documents"][number];

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
 * delete (DOC-010), and it is the one that costs disk. Erasing it takes
 * the version rows and the stored blobs with it, so the volume ends a
 * run the size it started. The contract has no hard delete, so archived
 * is its resting state. The Administrator runs both.
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

/** The Documents section of the record. Story 22's count lives in its
 * header. */
function documentsSection(page: Page): Locator {
  return page.getByRole("region", { name: "Documents" });
}

/**
 * Crosses from the record to its paper, the way a reader does it.
 *
 * The paper is one section of the record now, behind its own tab
 * (DES-032). The strip is a nav of routed links, so the move is a click
 * and the address is the proof it landed — which is the whole point of
 * routing the sections rather than holding them in state.
 */
async function openDocumentsSection(page: Page, number: number): Promise<void> {
  await page
    .getByRole("navigation", { name: "Contract sections" })
    .getByRole("link", { name: "Documents" })
    .click();
  await expect(page).toHaveURL(new RegExp(`/contracts/${number}/documents$`));
}

/** How much paper the section says is on the record. The badge draws a
 * number and says a phrase, so it is found the way a screen reader finds
 * it — by its name, not by a shape the markup happens to have. */
function documentCount(page: Page): Locator {
  return documentsSection(page).getByRole("img", { name: /^\d+ documents?$/ });
}

/** One row of the section, found by the note its round carries. The note
 * is what tells the current round from the one it superseded, because
 * both rows name the same file. */
function roundRow(page: Page, note: string): Locator {
  return documentsSection(page).getByRole("row").filter({ hasText: note });
}

/** What a round is uploaded as: the file, and what the composer collects
 * beside it. */
interface Round {
  name: string;
  body: string;
  kind: string;
  note: string;
}

/**
 * Puts one round through the composer, the way a person does it: the
 * picker, the kind, the note, and the confirm.
 *
 * `open` is what puts the dialog on screen — the section's own Upload
 * button for the record's first file, or the document's Add version item
 * for the next round.
 */
async function uploadThroughComposer(
  page: Page,
  open: () => Promise<void>,
  round: Round,
): Promise<void> {
  await open();
  const dialog = page.getByRole("dialog");
  const chooser = page.waitForEvent("filechooser");
  // The button carries the field's label as well as its own, because the
  // input the label points at is out of the tab order and this is the
  // control a keyboard reaches.
  await dialog.getByRole("button", { name: "File Choose file" }).click();
  await (
    await chooser
  ).setFiles({ name: round.name, mimeType: "text/plain", buffer: Buffer.from(round.body, "utf8") });
  await expect(dialog.getByText(round.name)).toBeVisible();
  await dialog.getByLabel("Kind").selectOption(round.kind);
  await dialog.getByLabel("Note").fill(round.note);
  const uploaded = page.waitForResponse(
    (response) =>
      /\/api\/v1\/(contracts\/\d+\/documents|documents\/[^/]+\/versions)$/.test(response.url()) &&
      response.request().method() === "POST",
  );
  await dialog.getByRole("button", { name: "Upload", exact: true }).click();
  expect((await uploaded).status(), await (await uploaded).text()).toBe(201);
  await expect(dialog).toBeHidden();
}

/**
 * Re-opens a request context's connection to the stack.
 *
 * A pooled socket belongs to the process that was listening when it was
 * opened, so the first call after a restart can meet a closed one. This
 * is where that is absorbed, rather than in every caller after it.
 */
async function warmUp(page: Page): Promise<void> {
  await expect
    .poll(
      async () => {
        try {
          return (await page.request.get("/readyz")).status();
        } catch {
          return 0;
        }
      },
      {
        message: "the request context never reached the restarted app",
        timeout: 30_000,
        intervals: [500],
      },
    )
    .toBe(200);
}

/** Reads one version's bytes back, from the address the row's own link
 * points at. */
async function downloadVersion(page: Page, address: string): Promise<string> {
  const answered = await page.request.get(address);
  expect(answered.status(), await answered.text()).toBe(200);
  return (await answered.body()).toString("utf8");
}

/** Where one version's bytes are read from — the same address the
 * section's own download link carries. */
function downloadAddress(documentId: string, versionId: string): string {
  return `/api/v1/documents/${documentId}/versions/${versionId}/download`;
}

test.describe.serial("M11 demo path", () => {
  test.beforeAll(async ({ request }) => {
    await ensureAdminExists(request);
  });

  test("upload a draft, upload a revision, and read the chain with the current version pinned", async ({
    page,
    browser,
  }, testInfo) => {
    await signInAs(page, ADMIN.email, ADMIN.password, ADMIN.displayName);

    // Known starting state on the never-reset instance (TECH-018): a
    // crashed earlier run may have left per-run rows — and per-run files
    // — behind.
    await ensureDemoContractsInert(page.request);
    const typeName = await bareContractTypeName(page.request);

    // The stack under test, and where it was told to put its files. Read
    // before the journey so a run that cannot see its own container
    // fails saying so, rather than after an upload it cannot check.
    const container = await appContainer();
    const root = await storagePath(container);

    const stamp = Date.now();
    const uploaderEmail = `e2e-m11-uploader-${stamp}@e2e.example`;
    const title = `${CONTRACT_PREFIX} ${stamp}`;
    // The per-run token both files carry, so a search of the volume
    // finds this run's blobs and nothing else on it.
    const marker = `E2E-M11-MARKER-${stamp}`;
    const draft: Round = {
      name: `meridian-supply-draft-${stamp}.txt`,
      body: `Meridian supply agreement — our first draft.\n${marker}\n`,
      kind: "draft_ours",
      note: DRAFT_NOTE,
    };
    const redline: Round = {
      name: `meridian-supply-redline-${stamp}.txt`,
      body: `Meridian supply agreement — their redline.\n${marker}\n`,
      kind: "redline_theirs",
      note: REDLINE_NOTE,
    };
    let uploader: OnboardedMember | undefined;

    /**
     * Leaves the shared instance as the run found it (TECH-018): the
     * per-run paper erased and its blobs with it, the per-run contract
     * archived, and the per-run person archived.
     *
     * It waits for the app first, because the journey can die with the
     * container mid-restart and the sweep is the one thing that still
     * has to reach it.
     */
    const leaveInert = async () => {
      await uploader?.context.close();
      await warmUp(page);
      await ensureDemoContractsInert(page.request);
      await ensureMemberInert(page.request, uploaderEmail);
    };

    try {
      uploader = await onboardActivatedMember(page.request, browser, {
        email: uploaderEmail,
        displayName: UPLOADER_NAME,
        role: "legal_team_member",
        password: "their-own-e2e-password",
      });
      const uploaderPage = uploader.page;

      // ---- A contract with no paper on it ----

      await uploaderPage.goto("/contracts");
      await uploaderPage.getByRole("button", { name: "Create contract" }).first().click();
      const create = uploaderPage.getByRole("dialog");
      await create.getByLabel("Title").fill(title);
      await create.getByLabel("Contract type").selectOption({ label: typeName });
      const created = uploaderPage.waitForResponse(
        (response) =>
          response.url().endsWith("/api/v1/contracts") && response.request().method() === "POST",
      );
      await create.getByRole("button", { name: "Create", exact: true }).click();
      const contract = z
        .object({ contract: z.object({ id: z.string(), number: z.number().int() }) })
        .parse(await (await created).json()).contract;
      await expect(create).toBeHidden();

      await uploaderPage.goto(`/contracts/${contract.number}`);
      await expect(uploaderPage.getByRole("heading", { level: 1, name: title })).toBeVisible();
      await openDocumentsSection(uploaderPage, contract.number);
      // The section says there is no paper, and says it as a fact about
      // this record rather than as a shrug.
      await expect(documentCount(uploaderPage)).toHaveText("0");
      await expect(
        documentsSection(uploaderPage).getByText("No documents on this contract yet."),
      ).toBeVisible();
      expect(await readPaper(uploaderPage.request, contract.number)).toEqual([]);

      // ---- Story 1: the draft lands on the record ----

      await uploadThroughComposer(
        uploaderPage,
        () => documentsSection(uploaderPage).getByRole("button", { name: "Upload" }).click(),
        draft,
      );

      const firstRound = roundRow(uploaderPage, DRAFT_NOTE);
      await expect(firstRound).toHaveCount(1);
      await expect(documentCount(uploaderPage)).toHaveText("1");
      // The badge draws "1" and says what the 1 counts, so a reader who
      // never sees the heading beside it still learns what it is.
      await expect(documentCount(uploaderPage)).toHaveAccessibleName("1 document");
      // What the row says: the file, this round of the negotiation, and
      // its number. One round in, there is nothing under it to be the
      // head of, so the chain disclosure is absent and the row is the
      // document.
      await expect(firstRound).toContainText(draft.name);
      await expect(firstRound).toContainText(DRAFT_KIND_LABEL);
      await expect(firstRound).toContainText("v1");
      // The record's first document is its instrument (CTR-014).
      await expect(firstRound).toContainText("Primary");
      await expect(firstRound.getByText(`Uploaded by ${UPLOADER_NAME}`)).toBeAttached();

      // ---- Story 2: the next round supersedes it, and destroys nothing ----

      await uploadThroughComposer(
        uploaderPage,
        async () => {
          await documentsSection(uploaderPage)
            .getByRole("button", { name: `Actions for ${draft.name}` })
            .click();
          await uploaderPage.getByRole("menuitem", { name: "Add version" }).click();
        },
        redline,
      );

      // ---- Stories 3 and 4: the chain, with the current version pinned ----

      const currentRound = roundRow(uploaderPage, REDLINE_NOTE);
      await expect(currentRound).toHaveCount(1);
      await expect(currentRound).toContainText(REDLINE_KIND_LABEL);
      await expect(currentRound).toContainText("v2");
      // The screen half of "which file matters now": this row is the
      // head of the chain, and the section says so by putting the
      // earlier round underneath it behind a disclosure this row owns.
      await expect(
        currentRound.getByRole("button", {
          name: `Show the 1 earlier version of ${draft.name}`,
        }),
      ).toHaveAttribute("aria-expanded", "false");
      // The document is still one document, so the count is still one:
      // a round is not a second file on the record.
      await expect(documentCount(uploaderPage)).toHaveText("1");
      // The name is the download, and it now downloads the round that
      // matters — which is what "pinned" buys the reader.
      const paper = await readPaper(uploaderPage.request, contract.number);
      expect(paper).toHaveLength(1);
      const document = paper[0]!;
      const versions = [...document.versions].sort((a, b) => a.versionNumber - b.versionNumber);
      expect(versions.map((version) => version.versionNumber)).toEqual([1, 2]);
      expect(versions.map((version) => version.kind)).toEqual(["draft_ours", "redline_theirs"]);
      expect(versions.map((version) => version.note)).toEqual([DRAFT_NOTE, REDLINE_NOTE]);
      expect(versions.map((version) => version.originalFilename)).toEqual([
        draft.name,
        redline.name,
      ]);
      // One pin, on the highest number: the section cannot disagree with
      // the record about which file matters, because it is told.
      expect(versions.map((version) => version.isCurrent)).toEqual([false, true]);
      expect(document.isPrimary).toBe(true);
      await expect(currentRound.getByRole("link", { name: draft.name })).toHaveAttribute(
        "href",
        downloadAddress(document.id, versions[1]!.id),
      );

      // The earlier round is one click away, not gone. It keeps its own
      // number, its own kind, and the note its uploader wrote about it —
      // and it stays underneath the head row rather than becoming one,
      // which is the section's whole answer to "which round is this".
      await currentRound
        .getByRole("button", { name: `Show the 1 earlier version of ${draft.name}` })
        .click();
      const supersededRound = roundRow(uploaderPage, DRAFT_NOTE);
      await expect(supersededRound).toHaveCount(1);
      await expect(supersededRound).toContainText("v1");
      await expect(supersededRound).toContainText(DRAFT_KIND_LABEL);
      // A superseded round owns no chain disclosure: it is under one.
      await expect(
        supersededRound.getByRole("button", { name: /^(Show|Hide) the .* earlier version/ }),
      ).toHaveCount(0);
      await expect(supersededRound.getByRole("link", { name: draft.name })).toHaveAttribute(
        "href",
        downloadAddress(document.id, versions[0]!.id),
      );

      // Every round downloads, superseded ones included (story 7).
      expect(
        await downloadVersion(uploaderPage, downloadAddress(document.id, versions[0]!.id)),
      ).toBe(draft.body);
      expect(
        await downloadVersion(uploaderPage, downloadAddress(document.id, versions[1]!.id)),
      ).toBe(redline.body);

      // ---- Immutable, at the seam that would have to allow it ----
      //
      // A correction appends a round; nothing replaces or removes one
      // (story 12, DOC-001). PATCH at this address is the narrow CTR-014
      // kind correction, covered at the API seam; PUT and DELETE remain
      // absent, and the chain is unchanged for having been asked.
      for (const method of ["PUT", "DELETE"] as const) {
        const refused = await uploaderPage.request.fetch(
          `/api/v1/documents/${document.id}/versions/${versions[0]!.id}`,
          { method },
        );
        expect([404, 405], `${method} on a version answered ${refused.status()}`).toContain(
          refused.status(),
        );
      }
      expect(await readPaper(uploaderPage.request, contract.number)).toEqual(paper);

      // The record's narrative includes its paper (story 21, DD-017), at
      // the record-action tier that also puts it in the audit log.
      const feed = ActivityEntries.parse(
        await (
          await uploaderPage.request.get(
            `/api/v1/activity?entityType=contract&entityId=${contract.id}`,
          )
        ).json(),
      ).entries;
      for (const action of ["document.created", "document.version_added"] as const) {
        const entry = feed.find((row) => row.action === action);
        expect(entry, `${action} is missing from the record's own feed`).toBeDefined();
        expect(entry!.visibility).toBe("working_team");
      }

      // The one surface this milestone added to the record body, scanned
      // and asserted rather than reported: it is this milestone's own, so
      // a finding in it is this milestone's to fix. The page around it is
      // reported the way the accessibility floor spec reports every page
      // (#48, DES-011).
      expect(
        await reportAxeViolations(uploaderPage, testInfo, "m11-documents", {
          include: 'section[aria-labelledby="contract-documents-heading"]',
        }),
      ).toEqual([]);
      await reportAxeViolations(uploaderPage, testInfo, "m11-record");

      // ---- Story 25: the files are on the named volume ----

      const volume = await namedFilesVolume(container, root);
      const stored = await storedFilesCarrying(container, root, marker);
      expect(stored, `both rounds must be stored under ${root} on volume ${volume}`).toHaveLength(
        2,
      );

      // ---- Story 25: and they survive the container going away ----

      await restartAndWait(container);
      await warmUp(uploaderPage);

      // The same two files, on the same volume, after a container that
      // is not the one that wrote them.
      expect(await storedFilesCarrying(container, root, marker)).toEqual(stored);
      expect(
        await downloadVersion(uploaderPage, downloadAddress(document.id, versions[0]!.id)),
      ).toBe(draft.body);
      expect(
        await downloadVersion(uploaderPage, downloadAddress(document.id, versions[1]!.id)),
      ).toBe(redline.body);
      expect(await readPaper(uploaderPage.request, contract.number)).toEqual(paper);

      // And the record draws the same chain it drew before, because the
      // deployer story is about the record and not about a byte count.
      // Straight to the section's own address (DES-032): the reader's
      // crossing is proved at the top of the journey, and what this leg
      // asks about is the chain.
      await uploaderPage.goto(`/contracts/${contract.number}/documents`);
      const afterRestart = roundRow(uploaderPage, REDLINE_NOTE);
      await expect(afterRestart).toContainText("v2");
      // Still the head of the chain, with the earlier round still
      // folded underneath it — a fresh page load collapses the
      // disclosure, so this is the closed one again.
      await expect(
        afterRestart.getByRole("button", {
          name: `Show the 1 earlier version of ${draft.name}`,
        }),
      ).toHaveAttribute("aria-expanded", "false");
      await expect(documentCount(uploaderPage)).toHaveText("1");
    } catch (error) {
      // A cleanup that throws here would replace the failure that caused
      // it, and the failure is the one worth reading. It says so out
      // loud instead.
      await sweepOrSay("M11 demo", leaveInert);
      throw error;
    }
    // The journey passed, so a cleanup that fails is a failure of its
    // own: it leaves the shared instance dirty for the next run.
    await leaveInert();
  });
});
