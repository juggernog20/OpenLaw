// SPDX-License-Identifier: AGPL-3.0-only

/**
 * M15 milestone acceptance (#251): the demo, end to end.
 *
 * Send a contract for signature through DocuSign, sign it, and watch
 * the executed PDF land back as a pinned version.
 *
 * The journey is two contracts and two people. An Administrator
 * configures the DocuSign connector once, in the new Integrations
 * section, and green-checks it. A Legal Team Member then does
 * everything the milestone is written about, on the record: two rounds
 * of paper, the move to the signature stage, a send to two named
 * signers, a withdrawal of that round, a second send — and then the
 * paper comes back on its own. The executed PDF files itself onto the
 * chain, pins itself, and the stage marker moves to Active without
 * anybody touching the record.
 *
 * Beside it, the second contract walks CTR-013's manual hand-off with
 * no connector anywhere: upload the executed PDF, pin it by hand, set
 * the status by hand. It ends in the same place, and it never touches
 * a connector — which is the promise that an install that configures
 * nothing loses nothing it has today.
 *
 * Each leg is proved twice, on the M9 to M14 specs' rule: once on what
 * the screen draws, and once on what the seam answers. The two halves
 * catch different lies here.
 *
 * - A row drawn from what the browser just sent would show two signers
 *   and prove nothing about what left the building. So the send is read
 *   back three ways: the record's own seam, the screen, and the
 *   **provider's** account of what it received — the signers, the
 *   subject, and the bytes of the version that was picked.
 * - An executed copy the record filed from the version it sent would
 *   pass every assertion about a chain and be the wrong file. So the
 *   bytes on the new round are compared with the bytes the provider
 *   answered, which nothing in OpenLaw has ever held before the fetch.
 * - A pin inferred from the kind would look identical on screen
 *   (CTR-014's own warning). So the pin is read at the seam, where it
 *   is a column of its own, and on the row of the version it names.
 * - A stage marker following a status **label** would follow this demo
 *   perfectly and still be wrong (CTR-001). So the marker is read on
 *   screen and the stage is read at the seam.
 *
 * **How a Compose stack meets a provider that will not exist.** The
 * suite runs on built images (TECH-018), so it cannot inject the API's
 * own deterministic fake: the container resolves its signing driver for
 * itself from the stored connector. The dev/E2E overlay instead points
 * that driver at a stand-in this suite runs on the host —
 * `DOCUSIGN_BASE_URL` plus `SIGNING_STANDIN` on the app and the worker
 * both, and either one alone stops the boot — so the whole
 * production path runs, the real DocuSign driver included, and no test
 * send can reach a real DocuSign account. That is the Mailpit rule
 * applied to signing. See `docusign.ts`.
 *
 * **Why the manual half runs first.** It is the half that needs an
 * install with **no connector at all**, and this spec is the thing that
 * gives the instance one. On the never-reset instance (TECH-018) a
 * second run of this file therefore starts with the connector an
 * earlier run saved, and it **puts the instance back** rather than
 * standing down: the half removes the connector before it begins
 * (#273). It used to skip itself instead, which was honest and meant
 * the zero-config promise was only ever proved on CI's fresh volumes.
 * The two halves are still two tests rather than one journey, and the
 * file is still deliberately not `serial`.
 *
 * The instance is otherwise left as the run found it, on the earlier
 * demo specs' convention: per-run rows carry this spec's own prefixes
 * and are swept before each half starts. The paper is erased before the
 * contract is archived, because a document is the one thing here with a
 * hard delete (DOC-010) and the blobs would otherwise grow the volume
 * by every run.
 */

import { test, expect, request as apiRequest, type Locator, type Page } from "@playwright/test";
import type { APIRequestContext } from "@playwright/test";
import { generateKeyPairSync } from "node:crypto";
import { z } from "zod";
import {
  ADMIN,
  BASE_URL,
  ensureAdminExists,
  ensureMemberInert,
  onboardActivatedMember,
  reportAxeViolations,
  signInAs,
  startsWithName,
  sweepOrSay,
  type OnboardedMember,
} from "./helpers.js";
import {
  SigningStub,
  STUB_ACCOUNT_ID,
  STUB_ACCOUNT_NAME,
  STUB_USER_EMAIL,
  stubExecutedPdf,
  type Delivery,
} from "./docusign.js";

/**
 * Each half onboards a person through the real invite flow, walks a
 * contract through three statuses, uploads three rounds of paper, and —
 * in the connector half — waits for a background worker to fetch a file
 * and file it. Generous rather than tight: what is proved is that the
 * sentence holds, and a test timeout that fired first would take the
 * sentence away and leave a stopwatch in its place.
 */
test.setTimeout(300_000);

/** Per-run contracts carry these prefixes, so a crashed earlier run's
 * leftovers can be swept before the journey starts. They are this
 * spec's own: the demo specs sweep their own rows and must not reach
 * into each other's. */
const CONNECTOR_PREFIX = "E2E M15 Halberd services agreement";
const MANUAL_PREFIX = "E2E M15 Halberd manual hand-off";

/** Every per-run person's address starts here, so a run that died
 * before its own sweep leaves nothing live behind two people of the
 * same name. */
const MEMBER_EMAIL_PREFIX = "e2e-m15-";

/** The Legal Team Member the milestone is written for: they send, they
 * withdraw, and they send again. The Administrator configures the
 * connector and nothing else, so "a Member+ user sends" is an assertion
 * and not a coincidence. */
const SENDER_NAME = "Priya Raman";

/** The two people on the other side of the deal. They have no account
 * here — a signer is a name and an address (CTR-013). */
const SIGNERS = [
  { name: "Elena Marsh", email: "elena.marsh@counterparty.example" },
  { name: "Tomas Vogel", email: "tomas.vogel@counterparty.example" },
] as const;

/** What the signers are shown on the invitation. Written out so the
 * provider's copy of it can be compared with what was typed. */
const SUBJECT = "Halberd services agreement — please sign";

/** Why the first round is withdrawn (CTR-013's void). A whole sentence,
 * so a search for it on the row cannot match anything else. */
const VOID_REASON = "The wrong signatory was named on the first round.";

/** The adapter v1 ships, as every signing address names it. */
const PROVIDER = "docusign";

/** CTR-001's six fixed stages, as the pipeline names them on screen. */
const STAGE_NAMES = ["Draft", "Review", "Approval", "Signature", "Active", "Ended"] as const;

type StageName = (typeof STAGE_NAMES)[number];

/** Only what the sweep reads. */
const ContractRows = z.object({
  contracts: z.array(z.object({ number: z.number().int(), title: z.string() })),
});

/** One contract as the seam answers it. `stage` is derived from the
 * status and stored nowhere (CTR-001). */
const ContractEnvelope = z.object({
  contract: z.object({
    id: z.string(),
    number: z.number().int(),
    statusId: z.string(),
    statusName: z.string(),
    stage: z.string(),
  }),
});

/** The record's pickers: the type a contract is born on and the
 * statuses it moves through. */
const ContractOptions = z.object({
  contractTypes: z.array(
    z.object({
      displayName: z.string(),
      fields: z.array(z.object({ isRequired: z.boolean() })),
    }),
  ),
  contractStatuses: z.array(
    z.object({ id: z.string(), displayName: z.string(), stage: z.string() }),
  ),
});

type StatusOption = z.infer<typeof ContractOptions>["contractStatuses"][number];

/** The chain as the seam answers it — the fields this demo is about. */
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
          originalFilename: z.string(),
          isCurrent: z.boolean(),
          isExecuted: z.boolean(),
        }),
      ),
    }),
  ),
});

type DocumentRow = z.infer<typeof DocumentRows>["documents"][number];

/** One contract's whole signing state, as the card and the record read
 * it in one call. */
const SigningState = z.object({
  envelopes: z.array(
    z.object({
      id: z.string(),
      provider: z.string(),
      status: z.enum(["sent", "signed", "declined", "voided"]),
      signers: z.array(z.object({ name: z.string(), email: z.string() })),
      documentTitle: z.string().nullable(),
      documentVersionNumber: z.number().int().nullable(),
      reason: z.string().nullable(),
      sentBy: z.object({ id: z.string(), displayName: z.string() }),
      sentAt: z.string(),
      completedAt: z.string().nullable(),
      executedFetch: z.enum(["pending", "ready", "failed"]),
      executedCopy: z
        .object({
          documentId: z.string(),
          versionId: z.string(),
          versionNumber: z.number().int(),
          originalFilename: z.string(),
        })
        .nullable(),
    }),
  ),
  signingConfigured: z.boolean(),
  primaryDocument: z
    .object({
      id: z.string(),
      title: z.string(),
      versions: z.array(
        z.object({ id: z.string(), versionNumber: z.number().int(), originalFilename: z.string() }),
      ),
    })
    .nullable(),
});

/** The connector as the pane reads it. Note what is absent: both
 * secrets, which are write-only (TECH-013). */
const ConnectorState = z.object({
  connector: z.object({
    provider: z.string(),
    configured: z.boolean(),
    enabled: z.boolean(),
    environment: z.string().nullable(),
    integrationKey: z.string().nullable(),
    apiUserId: z.string().nullable(),
    hasPrivateKey: z.boolean(),
    hasWebhookSecret: z.boolean(),
    webhookUrl: z.string(),
  }),
});

/** What the connection test answers. */
const ConnectionCheck = z.object({
  connected: z.literal(true),
  accountName: z.string(),
  accountId: z.string(),
  userEmail: z.string(),
});

/** The record's own feed (DD-017), read at the seam beside the panel
 * that draws it. */
const ActivityEntries = z.object({
  entries: z.array(
    z.object({
      action: z.string(),
      visibility: z.string(),
      actor: z.object({ displayName: z.string() }).nullable(),
      payload: z.record(z.string(), z.unknown()),
    }),
  ),
});

type ActivityEntry = z.infer<typeof ActivityEntries>["entries"][number];

async function listContracts(request: APIRequestContext) {
  const listed = await request.get("/api/v1/contracts");
  expect(listed.status(), await listed.text()).toBe(200);
  return ContractRows.parse(await listed.json()).contracts;
}

/** One contract's whole paper, archived rows included. */
async function readPaper(
  request: APIRequestContext,
  number: number,
): Promise<readonly DocumentRow[]> {
  const listed = await request.get(`/api/v1/contracts/${number}/documents?includeArchived=true`);
  expect(listed.status(), await listed.text()).toBe(200);
  return DocumentRows.parse(await listed.json()).documents;
}

/**
 * Leaves every per-run contract of one half inert, paper first
 * (TECH-018 cleanup).
 *
 * A document is the one thing this demo creates with a real hard delete
 * (DOC-010), and it is the one that costs disk — an executed copy is a
 * file the pipeline fetched and stored, so a run that left it would
 * grow the volume forever. A contract has no hard delete, so archived
 * is its resting state; its envelopes go inert with it.
 */
async function ensureDemoContractsInert(request: APIRequestContext, prefix: string) {
  for (const row of (await listContracts(request)).filter((contract) =>
    contract.title.startsWith(prefix),
  )) {
    for (const document of await readPaper(request, row.number)) {
      const erased = await request.delete(`/api/v1/documents/${document.id}`, {
        data: { confirmTitle: document.title },
      });
      expect(erased.status(), await erased.text()).toBe(200);
    }
    const archived = await request.post(`/api/v1/contracts/${row.number}/archive`);
    expect(archived.status(), await archived.text()).toBe(200);
  }
}

/**
 * Leaves every per-run person of this spec inert, whatever run made
 * them. Wider than the address this run creates on purpose: the journey
 * names the sender on screen, and two live people of one name would
 * make the record unreadable.
 */
async function ensureDemoMembersInert(request: APIRequestContext) {
  const listed = await request.get("/api/v1/users");
  expect(listed.status(), await listed.text()).toBe(200);
  const { users } = z
    .object({ users: z.array(z.object({ email: z.string(), status: z.string() })) })
    .parse(await listed.json());
  for (const user of users.filter(
    (row) => row.email.startsWith(MEMBER_EMAIL_PREFIX) && row.status !== "archived",
  )) {
    await ensureMemberInert(request, user.email);
  }
}

/** The record's pickers, as the seam answers them. */
async function readOptions(request: APIRequestContext) {
  const options = await request.get("/api/v1/contracts/options");
  expect(options.status(), await options.text()).toBe(200);
  return ContractOptions.parse(await options.json());
}

/**
 * The live status this demo moves a contract to for one stage.
 *
 * Picked by **stage** rather than by name, because the name is the one
 * thing an Administrator may change (CTR-001) — and because picking it
 * by stage is what lets the assertions say the marker followed the
 * stage and not the label.
 */
function statusAt(options: z.infer<typeof ContractOptions>, stage: string): StatusOption {
  const found = options.contractStatuses.find((status) => status.stage === stage);
  expect(found, `no live contract status sits at the ${stage} stage`).toBeDefined();
  return found!;
}

/** A seed contract type that demands no field, named as the create
 * dialog names it. The demo is about signature, not about the field
 * catalog. */
function bareContractTypeName(options: z.infer<typeof ContractOptions>): string {
  const bare = options.contractTypes.find((type) =>
    type.fields.every((field) => !field.isRequired),
  );
  expect(bare, "no contract type without a hard-required field is configured").toBeDefined();
  return bare!.displayName;
}

/** One contract as the seam answers it, by its CTR-003 number. */
async function readContract(request: APIRequestContext, number: number) {
  const read = await request.get(`/api/v1/contracts/${number}`);
  expect(read.status(), await read.text()).toBe(200);
  return ContractEnvelope.parse(await read.json()).contract;
}

/** One contract's signing state, as the card is drawn from. */
async function readSigning(request: APIRequestContext, number: number) {
  const read = await request.get(`/api/v1/contracts/${number}/envelopes`);
  expect(read.status(), await read.text()).toBe(200);
  return SigningState.parse(await read.json());
}

/** The install's connector, as the Administrator's pane reads it. */
async function readConnector(request: APIRequestContext) {
  const read = await request.get(`/api/v1/signing-connectors/${PROVIDER}`);
  expect(read.status(), await read.text()).toBe(200);
  return ConnectorState.parse(await read.json()).connector;
}

/**
 * Puts the instance back to resolving no signing provider (#273).
 *
 * **Removal first, because that is the true starting state**: no row,
 * no credentials, exactly what a team that has never configured
 * anything has. It is refused while a round is still out — deleting the
 * credentials would strand it — and the honest fallback there is the
 * switch, which reaches the same answer from every surface that asks
 * "is signing configured" and leaves the stranded round recoverable.
 *
 * A leftover live round is the only way the fallback is reached, and it
 * means a previous run of the connector half died between a send and
 * its ending. Said out loud rather than swallowed, because it is also
 * the one case where this run's starting state is not quite a virgin
 * install's.
 */
async function ensureNoSigningConnector(request: APIRequestContext): Promise<void> {
  const connector = await readConnector(request);
  if (!connector.configured) return;

  const removed = await request.delete(`/api/v1/signing-connectors/${PROVIDER}`);
  if (removed.status() === 200) {
    expect((await readConnector(request)).configured).toBe(false);
    return;
  }
  expect(removed.status(), await removed.text()).toBe(409);
  console.warn(
    "[m15-demo] a round is still out from an earlier run, so the connector was turned off " +
      "rather than removed — the zero-config half still runs, on an install that holds " +
      "credentials it cannot use",
  );
  if (connector.enabled) {
    const off = await request.post(`/api/v1/signing-connectors/${PROVIDER}/disable`);
    expect(off.status(), await off.text()).toBe(200);
  }
  expect((await readConnector(request)).enabled).toBe(false);
}

/** One record's own feed (DD-017). */
async function readFeed(
  request: APIRequestContext,
  contractId: string,
): Promise<readonly ActivityEntry[]> {
  const read = await request.get(`/api/v1/activity?entityType=contract&entityId=${contractId}`);
  expect(read.status(), await read.text()).toBe(200);
  return ActivityEntries.parse(await read.json()).entries;
}

/** Where one version's bytes are read from — the same address the
 * section's own download link carries. */
function downloadAddress(documentId: string, versionId: string): string {
  return `/api/v1/documents/${documentId}/versions/${versionId}/download`;
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

/** The record's "Approvals & signing" card — the name DES-035 clause 3
 * reserved, taken now that envelope rows join the approval rows. */
function signingCard(page: Page): Locator {
  return page.getByRole("region", { name: "Approvals & signing" });
}

/**
 * One envelope's row, found by the status it is in.
 *
 * The status rather than a signer, because both rounds of this demo go
 * to the same two people: what tells the withdrawn round from the live
 * one on screen is the pill, which is the fact the row is being read
 * for.
 */
function envelopeRow(page: Page, status: string): Locator {
  return signingCard(page).getByRole("row").filter({ hasText: status });
}

/**
 * Crosses from one record section to another, the way a reader does it
 * (DES-032). The strip is a nav of routed links, so the move is a click
 * and the address is the proof it landed.
 */
async function openSection(page: Page, number: number, name: string, path: string): Promise<void> {
  await page
    .getByRole("navigation", { name: "Contract sections" })
    .getByRole("link", { name, exact: true })
    .click();
  await expect(page).toHaveURL(new RegExp(`/contracts/${number}${path}$`));
}

/** What each round is: the file, and what the composer collects beside
 * it. */
interface Round {
  name: string;
  body: string;
  kind: string;
  note: string;
}

/**
 * Puts one round through the composer, the way a person does it: the
 * picker, the kind, the note, and the confirm (M11's shape).
 *
 * `open` is what puts the dialog on screen — the section's own Upload
 * button for the record's first file, or the document's Add version
 * item for the next round.
 */
async function uploadThroughComposer(
  page: Page,
  open: () => Promise<void>,
  round: Round,
): Promise<void> {
  await open();
  const dialog = page.getByRole("dialog");
  const chooser = page.waitForEvent("filechooser");
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

/** Adds a round to a document that already has one. */
async function addVersion(page: Page, fileName: string, round: Round): Promise<void> {
  await uploadThroughComposer(
    page,
    async () => {
      await documentsSection(page)
        .getByRole("button", { name: `Actions for ${fileName}` })
        .click();
      await page.getByRole("menuitem", { name: "Add version" }).click();
    },
    round,
  );
}

/** CTR-001's six-stage backbone on the record's sub-bar (DES-034). */
function pipeline(page: Page): Locator {
  return page.getByRole("list", { name: "Stage" });
}

/** One stage's place in the strip. Matched on the name it starts with,
 * because a stage behind the marker carries a screen-reader "done"
 * after it. */
function stageStep(page: Page, stage: StageName): Locator {
  return pipeline(page)
    .getByRole("listitem")
    .filter({ hasText: new RegExp(`^${stage}\\b`) });
}

/**
 * The marker on one stage, and the stage behind it marked done.
 *
 * Two statements rather than one, because the strip renders **position,
 * not progress** (CTR-001, DES-034) and this demo's whole question is
 * where the marker is. The strip read as a whole is M14's assertion;
 * what M15 adds is that the marker moves without anybody moving it.
 */
async function expectStageMarker(page: Page, stage: StageName): Promise<void> {
  const position = STAGE_NAMES.indexOf(stage);
  const current = stageStep(page, stage);
  await expect(current, `the pipeline draws no ${stage} step`).toHaveCount(1);
  await expect(current, `the marker is not on ${stage}`).toHaveAttribute("aria-current", "step");
  for (const [index, name] of STAGE_NAMES.entries()) {
    if (index === position) continue;
    const step = stageStep(page, name);
    await expect(step, `${name} is marked as the current stage`).not.toHaveAttribute(
      "aria-current",
      "step",
    );
    if (index < position) {
      await expect(step, `${name} is behind the marker and is not marked done`).toContainText(
        "done",
      );
    }
  }
}

/**
 * The record's own move control (DES-053) — the current stage's pill in
 * the strip, which is the one item of the six that can be pressed.
 */
function moveControl(page: Page): Locator {
  return page.getByRole("button", { name: /move contract$/ });
}

/** Opens the move menu and picks one status by the label it wears. */
async function pickFrom(page: Page, status: StatusOption): Promise<void> {
  await moveControl(page).click();
  await page
    .getByRole("menuitemradio")
    .filter({ hasText: startsWithName(status.displayName) })
    .first()
    .click();
}

/**
 * Which status the record holds, read from the menu's checked row. The
 * sub-bar pill says it too, but a status label and a stage name are
 * often the same word, so the pill can only be told from the strip's own
 * current-stage pill structurally.
 */
async function expectStatus(page: Page, status: StatusOption): Promise<void> {
  await moveControl(page).click();
  await expect(
    page
      .getByRole("menuitemradio")
      .filter({ hasText: startsWithName(status.displayName) })
      .first(),
  ).toBeChecked();
  // Back to where the leg found the page: a menu left open would sit
  // over whatever the next step reads.
  await page.keyboard.press("Escape");
  await expect(page.getByRole("menu")).toBeHidden();
}

/**
 * Moves the contract to one status through the record's own strip, and
 * answers what the seam said about it.
 */
async function pickStatus(page: Page, number: number, status: StatusOption) {
  const answered = page.waitForResponse(
    (response) =>
      response.url().endsWith(`/api/v1/contracts/${number}`) &&
      response.request().method() === "PATCH",
  );
  await pickFrom(page, status);
  const settled = await answered;
  expect(settled.status(), await settled.text()).toBe(200);
}

/**
 * Sends the current version of the primary document to both signers,
 * through the record's own dialog (CTR-013).
 *
 * The dialog's default is asserted rather than chosen: "the current
 * version" is what the milestone sentence sends, and a demo that picked
 * it from the list by hand would prove nothing about the default.
 */
async function sendForSignature(page: Page, number: number, currentOption: string): Promise<void> {
  await signingCard(page).getByRole("button", { name: "Send for signature" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByText("Send for signature")).toBeVisible();
  await expect(dialog.getByLabel("Version")).toHaveValue(currentOption);
  await dialog.getByLabel("Signer 1 name").fill(SIGNERS[0].name);
  await dialog.getByLabel("Signer 1 email").fill(SIGNERS[0].email);
  await dialog.getByRole("button", { name: "Add signer" }).click();
  await dialog.getByLabel("Signer 2 name").fill(SIGNERS[1].name);
  await dialog.getByLabel("Signer 2 email").fill(SIGNERS[1].email);
  await dialog.getByLabel("Subject (optional)").fill(SUBJECT);
  const sent = page.waitForResponse(
    (response) =>
      response.url().endsWith(`/api/v1/contracts/${number}/envelopes`) &&
      response.request().method() === "POST",
  );
  await dialog.getByRole("button", { name: "Send envelope" }).click();
  const answered = await sent;
  expect(answered.status(), await answered.text()).toBe(201);
  await expect(dialog).toBeHidden();
}

/**
 * Pushes one Connect delivery at the install, as the provider would.
 *
 * Through a request context with no session at all, because DocuSign
 * has none: the webhook is this install's first unauthenticated inbound
 * write path, and the HMAC is the whole gate (TECH-013).
 */
async function pushDelivery(
  stub: SigningStub,
  delivery: Delivery,
): Promise<{ status: number; body: string }> {
  const signed = stub.signedDelivery(delivery);
  const anonymous = await apiRequest.newContext({ baseURL: BASE_URL });
  try {
    const answered = await anonymous.post(`/api/v1/signing/${PROVIDER}/webhook`, {
      headers: signed.headers,
      data: signed.body,
    });
    return { status: answered.status(), body: await answered.text() };
  } finally {
    await anonymous.dispose();
  }
}

test.describe("M15 demo path", () => {
  test.beforeAll(async ({ request }) => {
    await ensureAdminExists(request);
  });

  test("file an executed copy by hand, with no e-signature connector anywhere", async ({
    page,
    browser,
  }) => {
    await signInAs(page, ADMIN.email, ADMIN.password, ADMIN.displayName);

    // Known starting state on the never-reset instance (TECH-018).
    await ensureDemoContractsInert(page.request, MANUAL_PREFIX);
    await ensureDemoMembersInert(page.request);

    // The precondition this half exists for: CTR-013 promises the
    // manual hand-off is **zero-config**, so it is proved on an install
    // that resolves no signing provider at all.
    //
    // This used to be a skip. An earlier run left the instance a
    // connector and M15 shipped no way to take one away, so on the
    // never-reset instance (TECH-018) the half that proves the
    // zero-config promise simply did not run, and the coverage was real
    // only on CI's fresh volumes. #273 gave the connector a removal, so
    // the half now puts the instance back rather than standing down.
    await ensureNoSigningConnector(page.request);

    const stamp = Date.now();
    const title = `${MANUAL_PREFIX} ${stamp}`;
    const memberEmail = `${MEMBER_EMAIL_PREFIX}manual-${stamp}@e2e.example`;
    const draft: Round = {
      name: `halberd-manual-draft-${stamp}.txt`,
      body: `Halberd manual hand-off — our draft.\n`,
      kind: "draft_ours",
      note: "The draft that went out to be signed on paper.",
    };
    const executed: Round = {
      name: `halberd-manual-executed-${stamp}.txt`,
      body: `Halberd manual hand-off — signed by both sides.\n`,
      kind: "executed",
      note: "Signed copy, scanned back from the counterparty.",
    };
    let member: OnboardedMember | undefined;

    const leaveInert = async () => {
      await member?.context.close();
      await ensureDemoContractsInert(page.request, MANUAL_PREFIX);
      await ensureMemberInert(page.request, memberEmail);
    };

    try {
      member = await onboardActivatedMember(page.request, browser, {
        email: memberEmail,
        displayName: SENDER_NAME,
        role: "legal_team_member",
        password: "their-own-e2e-password",
      });
      const memberPage = member.page;
      const options = await readOptions(page.request);
      const signature = statusAt(options, "signature");
      const active = statusAt(options, "active");

      // ---- A record, its paper, and the signature stage ----

      const number = await createContract(memberPage, title, bareContractTypeName(options));
      await memberPage.goto(`/contracts/${number}`);
      await expect(memberPage.getByRole("heading", { level: 1, name: title })).toBeVisible();
      await openSection(memberPage, number, "Documents", "/documents");
      await uploadThroughComposer(
        memberPage,
        () => documentsSection(memberPage).getByRole("button", { name: "Upload" }).click(),
        draft,
      );

      await memberPage.goto(`/contracts/${number}`);
      await pickStatus(memberPage, number, signature);
      await expectStageMarker(memberPage, "Signature");
      expect((await readContract(memberPage.request, number)).stage).toBe("signature");

      // ---- Story 19: nothing on the record advertises a connector ----
      //
      // The screen half: a record with paper on it, at the signature
      // stage, and no send control at all — absent rather than disabled
      // (DES-035's absence rule) — no signing block, and no envelope
      // chip beside the pipeline.
      await openSection(memberPage, number, "Approvals", "/approvals");
      await expect(
        signingCard(memberPage).getByRole("button", { name: "Send for signature" }),
      ).toHaveCount(0);
      await expect(signingCard(memberPage).getByText("Signing", { exact: true })).toHaveCount(0);
      await expect(memberPage.getByText("Envelope sent")).toHaveCount(0);

      // The seam half: no connector, no envelopes — and a primary
      // document that would have been sendable if there had been one.
      const before = await readSigning(memberPage.request, number);
      expect(before.signingConfigured).toBe(false);
      expect(before.envelopes).toEqual([]);
      expect(before.primaryDocument?.title).toBe(draft.name);

      // ---- Story 18: the executed copy, filed by hand ----

      await openSection(memberPage, number, "Documents", "/documents");
      await addVersion(memberPage, draft.name, executed);

      // The pin is its own act, on the version's own row (CTR-014): a
      // round tagged `executed` is what its uploader called it, and the
      // pin is what names the signed copy. It is a row-menu item rather
      // than an inline toggle since 2026-08-18 — an icon-only pin told
      // nobody what it did — so the act is: open the row's menu, pick
      // the verb.
      const pinned = memberPage.waitForResponse(
        (response) =>
          response.url().includes("/executed-version") && response.request().method() === "POST",
      );
      await documentsSection(memberPage)
        .getByRole("button", { name: `Actions for ${draft.name}` })
        .click();
      await memberPage.getByRole("menuitem", { name: "Mark as executed copy" }).click();
      expect((await pinned).status(), await (await pinned).text()).toBe(200);

      // The screen half: the round that matters now, and the round the
      // record calls signed, are the same row and say so separately.
      const executedRow = documentsSection(memberPage)
        .getByRole("row")
        .filter({ hasText: executed.note });
      await expect(executedRow).toHaveCount(1);
      await expect(executedRow).toContainText("v2");
      // The head of the chain, said by position: this row owns the
      // disclosure the earlier round is folded under. The "Current"
      // badge that used to say it was dropped on 2026-08-18 as a
      // restatement of exactly this.
      await expect(
        executedRow.getByRole("button", { name: /^Show the 1 earlier version of / }),
      ).toHaveCount(1);
      // The pin itself, read where it now lives. The menu names what a
      // second pick would do, so "Unmark" is the pinned state — and it
      // is the pin talking, not the kind: a row drawn from the kind
      // would still offer "Mark".
      await documentsSection(memberPage)
        .getByRole("button", { name: `Actions for ${draft.name}` })
        .click();
      await expect(
        memberPage.getByRole("menuitem", { name: "Unmark as executed copy" }),
      ).toBeVisible();
      await memberPage.keyboard.press("Escape");

      // The seam half: two rounds, the pin on the second, and it is a
      // column of its own rather than a reading of the kind.
      const paper = await readPaper(memberPage.request, number);
      expect(paper).toHaveLength(1);
      const chain = [...paper[0]!.versions].sort((a, b) => a.versionNumber - b.versionNumber);
      expect(chain.map((version) => version.kind)).toEqual(["draft_ours", "executed"]);
      expect(chain.map((version) => version.isExecuted)).toEqual([false, true]);
      expect(chain.map((version) => version.isCurrent)).toEqual([false, true]);

      // ---- And the status, by hand ----

      await memberPage.goto(`/contracts/${number}`);
      await pickStatus(memberPage, number, active);
      await expectStatus(memberPage, active);
      await expectStageMarker(memberPage, "Active");
      const ended = await readContract(memberPage.request, number);
      expect(ended.stage).toBe("active");

      // The same end state the connector half reaches, and nothing
      // about signing was involved in reaching it: the record holds no
      // envelope, and this install still has no connector.
      const after = await readSigning(memberPage.request, number);
      expect(after.envelopes).toEqual([]);
      expect(after.signingConfigured).toBe(false);
      expect((await readConnector(page.request)).configured).toBe(false);
    } catch (error) {
      await sweepOrSay("M15 manual half", leaveInert);
      throw error;
    }
    await leaveInert();
  });

  test("configure the connector, send for signature, and watch the executed PDF land pinned", async ({
    page,
    browser,
  }, testInfo) => {
    await signInAs(page, ADMIN.email, ADMIN.password, ADMIN.displayName);

    await ensureDemoContractsInert(page.request, CONNECTOR_PREFIX);
    await ensureDemoMembersInert(page.request);

    const stamp = Date.now();
    const title = `${CONNECTOR_PREFIX} ${stamp}`;
    const senderEmail = `${MEMBER_EMAIL_PREFIX}sender-${stamp}@e2e.example`;
    // Per-run credentials. The integration key is what the stand-in
    // accepts and the RSA key is what the driver's assertions are
    // signed with — generated here, so nothing that could authenticate
    // anywhere is committed.
    const integrationKey = `e2e-integration-${stamp}`;
    const apiUserId = `e2e-user-${stamp}`;
    const webhookSecret = `e2e-connect-secret-${stamp}`;
    const privateKey = generateKeyPairSync("rsa", {
      modulusLength: 2048,
      publicKeyEncoding: { type: "spki", format: "pem" },
      privateKeyEncoding: { type: "pkcs8", format: "pem" },
    }).privateKey;
    const draft: Round = {
      name: `halberd-draft-${stamp}.txt`,
      body: `Halberd services agreement — our first draft.\n`,
      kind: "draft_ours",
      note: "First draft off our own paper.",
    };
    const redline: Round = {
      name: `halberd-redline-${stamp}.txt`,
      body: `Halberd services agreement — agreed text, ready to sign.\n`,
      kind: "redline_theirs",
      note: "Their mark-up, agreed. This is the round that goes out.",
    };
    let sender: OnboardedMember | undefined;
    let stub: SigningStub | undefined;

    const leaveInert = async () => {
      await sender?.context.close();
      await stub?.close();
      await ensureDemoContractsInert(page.request, CONNECTOR_PREFIX);
      await ensureMemberInert(page.request, senderEmail);
    };

    try {
      // The provider this install will talk to. Started before the
      // connector is saved, so the connection test below has somebody
      // to reach.
      stub = await SigningStub.start({ integrationKey, webhookSecret });

      // ---- Stories 1 to 4: the Administrator configures the connector ----

      await page.goto("/settings/integrations/e-signature");
      await expect(
        page
          .getByRole("navigation", { name: "Settings sections" })
          .getByRole("link", { name: "Integrations" }),
      ).toBeVisible();
      // The card is a disclosure (DES-054) and starts closed, so the
      // form is one click behind its header. The state is not stored,
      // but a rerun in the same tab may already have opened it.
      const docusign = page.getByRole("button", { name: "DocuSign", exact: true });
      if ((await docusign.getAttribute("aria-expanded")) === "false") await docusign.click();
      await page.getByLabel("Environment").selectOption("demo");
      await page.getByLabel("Integration key").fill(integrationKey);
      await page.getByLabel("User ID").fill(apiUserId);
      await page.getByLabel("RSA private key").fill(privateKey);
      await page.getByLabel("Connect HMAC secret").fill(webhookSecret);
      const saved = page.waitForResponse(
        (response) =>
          response.url().endsWith(`/api/v1/signing-connectors/${PROVIDER}`) &&
          response.request().method() === "PUT",
      );
      await page.getByRole("button", { name: "Save connector" }).click();
      expect((await saved).status(), await (await saved).text()).toBe(200);
      await expect(page.getByText("Saved")).toBeVisible();

      // A save rotates credentials; it does not throw the switch. The
      // manual half above turns the connector off rather than removing
      // it when a round from an earlier run is still out, so this run
      // may have saved onto a connector that is switched off — and
      // everything below needs it on.
      if (!(await readConnector(page.request)).enabled) {
        await page.getByRole("switch", { name: "Send for signature from records" }).click();
        await expect.poll(async () => (await readConnector(page.request)).enabled).toBe(true);
      }

      // Story 4: the address this install answers deliveries on, shown
      // rather than looked up in source.
      await expect(page.getByLabel("Webhook URL")).toHaveValue(
        new RegExp(`/api/v1/signing/${PROVIDER}/webhook$`),
      );

      // Story 2: the green check. The screen half is the sentence the
      // pane prints; the seam half is the account the provider named.
      const tested = page.waitForResponse(
        (response) =>
          response.url().endsWith(`/api/v1/signing-connectors/${PROVIDER}/test`) &&
          response.request().method() === "POST",
      );
      await page.getByRole("button", { name: "Test connection" }).click();
      const check = await tested;
      expect(check.status(), await check.text()).toBe(200);
      // The whole answer, because the account is **discovered, not
      // configured** (TECH-013): the pane asked for no account id, and
      // this is where the one the credentials reach is named.
      expect(ConnectionCheck.parse(await check.json())).toEqual({
        connected: true,
        accountId: STUB_ACCOUNT_ID,
        accountName: STUB_ACCOUNT_NAME,
        userEmail: STUB_USER_EMAIL,
      });
      await expect(page.getByText(`Connected to ${STUB_ACCOUNT_NAME}.`)).toBeVisible();

      // Story 3: the two secrets went in and cannot come back out.
      const connector = await readConnector(page.request);
      expect(connector.configured).toBe(true);
      expect(connector.environment).toBe("demo");
      expect(connector.integrationKey).toBe(integrationKey);
      expect(connector.hasPrivateKey).toBe(true);
      expect(connector.hasWebhookSecret).toBe(true);
      expect(JSON.stringify(connector)).not.toContain(webhookSecret);
      expect(JSON.stringify(connector)).not.toContain("PRIVATE KEY");

      // The pane is this milestone's own surface, so it is scanned and
      // asserted rather than reported (#48, DES-011).
      expect(
        await reportAxeViolations(page, testInfo, "m15-e-signature-pane", { include: "main" }),
      ).toEqual([]);

      // ---- The record, its paper, and the signature stage ----
      //
      // Everything from here is the Legal Team Member's, from their own
      // session: sending is Member+ and is not an Administrator's
      // privilege (CTR-013).

      sender = await onboardActivatedMember(page.request, browser, {
        email: senderEmail,
        displayName: SENDER_NAME,
        role: "legal_team_member",
        password: "her-own-e2e-password",
      });
      const senderPage = sender.page;
      const options = await readOptions(page.request);
      const signature = statusAt(options, "signature");

      const number = await createContract(senderPage, title, bareContractTypeName(options));
      await senderPage.goto(`/contracts/${number}/documents`);
      await uploadThroughComposer(
        senderPage,
        () => documentsSection(senderPage).getByRole("button", { name: "Upload" }).click(),
        draft,
      );
      await addVersion(senderPage, draft.name, redline);

      await senderPage.goto(`/contracts/${number}`);
      await pickStatus(senderPage, number, signature);
      await expectStageMarker(senderPage, "Signature");
      const atSignature = await readContract(senderPage.request, number);
      expect(atSignature.stage).toBe("signature");
      // Said out loud, because it is what makes the marker worth
      // asserting: the label the record holds is not the stage's name,
      // so nothing here followed a word.
      expect(atSignature.statusName).not.toBe("Signature");

      const sendable = await readSigning(senderPage.request, number);
      expect(sendable.signingConfigured).toBe(true);
      expect(sendable.envelopes).toEqual([]);
      // Newest round first, so the dialog's default is the round the
      // team is on.
      expect(sendable.primaryDocument?.versions.map((version) => version.versionNumber)).toEqual([
        2, 1,
      ]);
      const current = sendable.primaryDocument!.versions[0]!;
      const documentId = sendable.primaryDocument!.id;

      // ---- Stories 6 to 10: the send, and the round withdrawn ----

      await openSection(senderPage, number, "Approvals", "/approvals");
      await sendForSignature(senderPage, number, current.id);

      // The first round is a mistake, and it is withdrawn where it was
      // made (story 14). The row's own act, in the menu the card's rows
      // put their acts in.
      const firstRow = envelopeRow(senderPage, "Out for signature");
      await expect(firstRow).toHaveCount(1);
      await expect(firstRow).toContainText(SIGNERS[0].name);
      await firstRow.getByRole("button", { name: /^Actions for the envelope sent on/ }).click();
      await senderPage.getByRole("menuitem", { name: "Void envelope" }).click();
      const voidDialog = senderPage.getByRole("dialog");
      await expect(voidDialog.getByText("Void envelope").first()).toBeVisible();
      await voidDialog.getByLabel("Reason").fill(VOID_REASON);
      const voided = senderPage.waitForResponse(
        (response) =>
          response.url().includes("/api/v1/envelopes/") &&
          response.url().endsWith("/void") &&
          response.request().method() === "POST",
      );
      await voidDialog.getByRole("button", { name: "Void envelope" }).click();
      expect((await voided).status(), await (await voided).text()).toBe(200);
      await expect(voidDialog).toBeHidden();

      // The screen half: the round ended, and it says why. The seam
      // half: the provider was told first, so the two systems agree
      // about a round that is no longer collecting signatures.
      const voidedRow = envelopeRow(senderPage, "Voided");
      await expect(voidedRow).toHaveCount(1);
      await expect(voidedRow).toContainText(VOID_REASON);
      const withdrawn = await readSigning(senderPage.request, number);
      expect(withdrawn.envelopes).toHaveLength(1);
      expect(withdrawn.envelopes[0]!.status).toBe("voided");
      expect(withdrawn.envelopes[0]!.reason).toBe(VOID_REASON);
      expect(stub.statusOf(stub.sentEnvelopeIds()[0]!)).toBe("voided");

      // ---- The round that counts (story 16: send again) ----

      await sendForSignature(senderPage, number, current.id);

      // The screen half: the row the milestone is about — who was
      // asked, what went out, and where it stands — plus the chip
      // beside the pipeline, and no second send control while a round
      // is live (story 17).
      const liveRow = envelopeRow(senderPage, "Out for signature");
      await expect(liveRow).toHaveCount(1);
      await expect(liveRow).toContainText(SIGNERS[0].name);
      await expect(liveRow).toContainText(SIGNERS[0].email);
      await expect(liveRow).toContainText(SIGNERS[1].email);
      await expect(liveRow).toContainText(draft.name);
      await expect(liveRow).toContainText("Version 2");
      await expect(liveRow).toContainText("Out for signature");
      await expect(liveRow).toContainText(`by ${SENDER_NAME}`);
      await expect(senderPage.getByText("Envelope sent")).toBeVisible();
      await expect(
        signingCard(senderPage).getByRole("button", { name: "Send for signature" }),
      ).toHaveCount(0);

      // The card is this milestone's own surface now that it holds an
      // envelope row (#48, DES-011).
      expect(
        await reportAxeViolations(senderPage, testInfo, "m15-signing-card", {
          include: 'section[aria-labelledby="contract-approvals-heading"]',
        }),
      ).toEqual([]);

      // The seam half, on the record and at the provider both. The
      // provider's copy is what says the right paper reached the right
      // people: nothing in OpenLaw wrote it.
      const outbound = await readSigning(senderPage.request, number);
      expect(outbound.envelopes).toHaveLength(2);
      const live = outbound.envelopes[0]!;
      expect(live.status).toBe("sent");
      expect(live.provider).toBe(PROVIDER);
      expect(live.signers).toEqual(SIGNERS.map((signer) => ({ ...signer })));
      expect(live.documentVersionNumber).toBe(2);
      expect(live.completedAt).toBeNull();
      expect(live.executedFetch).toBe("pending");
      expect(live.executedCopy).toBeNull();
      expect(live.sentBy.displayName).toBe(SENDER_NAME);

      const providerEnvelopeId = stub.sentEnvelopeIds()[1]!;
      expect(stub.signersOf(providerEnvelopeId)).toEqual(SIGNERS.map((signer) => ({ ...signer })));
      expect(stub.subjectOf(providerEnvelopeId)).toBe(SUBJECT);
      // The bytes of the version that was picked, and not of the one
      // under it: a dialog that defaulted to the wrong round would be
      // invisible everywhere else.
      expect(stub.documentOf(providerEnvelopeId).toString("utf8")).toBe(redline.body);

      // ---- Stories 11 to 13: everybody signs, and the paper comes back ----

      stub.complete(providerEnvelopeId);
      const delivered = await pushDelivery(stub, {
        providerEnvelopeId,
        status: "completed",
        completedAt: new Date().toISOString(),
      });
      expect(delivered.status, delivered.body).toBe(204);

      // The fetch runs on the worker (M15/5), so the record is polled
      // rather than assumed: what is being proved is that it lands
      // without anybody asking for it.
      await expect
        .poll(
          async () => (await readSigning(senderPage.request, number)).envelopes[0]!.executedFetch,
          { message: "the executed copy never landed on the record", timeout: 120_000 },
        )
        .toBe("ready");

      // The seam half: the round came back signed, and it names the
      // file it produced.
      const completed = (await readSigning(senderPage.request, number)).envelopes[0]!;
      expect(completed.status).toBe("signed");
      expect(completed.completedAt).not.toBeNull();
      expect(completed.executedCopy).not.toBeNull();
      expect(completed.executedCopy!.documentId).toBe(documentId);
      expect(completed.executedCopy!.versionNumber).toBe(3);
      expect(completed.executedCopy!.originalFilename).toBe(
        `${redline.name.replace(/\.[^.]+$/, "")} (executed).pdf`,
      );

      // The chain: a third round of kind `executed`, and the pin on it
      // — set explicitly and never inferred from the kind (CTR-014).
      const filed = await readPaper(senderPage.request, number);
      expect(filed).toHaveLength(1);
      const chain = [...filed[0]!.versions].sort((a, b) => a.versionNumber - b.versionNumber);
      expect(chain.map((version) => version.kind)).toEqual([
        "draft_ours",
        "redline_theirs",
        "executed",
      ]);
      expect(chain.map((version) => version.isExecuted)).toEqual([false, false, true]);
      expect(chain[2]!.id).toBe(completed.executedCopy!.versionId);

      // And it is the provider's file: these bytes were never in this
      // install until the pipeline fetched them.
      const downloaded = await senderPage.request.get(downloadAddress(documentId, chain[2]!.id));
      expect(downloaded.status(), await downloaded.text()).toBe(200);
      expect((await downloaded.body()).toString("utf8")).toBe(
        stubExecutedPdf(providerEnvelopeId).toString("utf8"),
      );

      // Story 13: the status advanced from the signature stage, and
      // nobody moved it.
      const advanced = await readContract(senderPage.request, number);
      expect(advanced.stage).toBe("active");
      expect(advanced.statusId).not.toBe(signature.id);

      // ---- The screen, after the record moved on its own ----

      await senderPage.goto(`/contracts/${number}/approvals`);
      const signedRow = envelopeRow(senderPage, "Signed");
      await expect(signedRow).toHaveCount(1);
      await expect(signedRow).toContainText(SIGNERS[1].name);
      await expect(signedRow.getByRole("link", { name: "Executed copy" })).toHaveAttribute(
        "href",
        downloadAddress(documentId, chain[2]!.id),
      );
      await expect(senderPage.getByText("Envelope signed")).toBeVisible();
      await expectStageMarker(senderPage, "Active");

      await senderPage.goto(`/contracts/${number}/documents`);
      // The chain's head is the round that came back. The row is found
      // by the document's own title, which is what the section draws —
      // a version's file name is on its download link, not on the row.
      const executedRow = documentsSection(senderPage)
        .getByRole("row")
        .filter({ hasText: draft.name });
      await expect(executedRow).toHaveCount(1);
      await expect(executedRow).toContainText("v3");
      // The head of the chain, said by position rather than by a badge
      // (2026-08-18): this row owns the disclosure the two earlier
      // rounds are folded under.
      await expect(
        executedRow.getByRole("button", { name: /^Show the 2 earlier versions of / }),
      ).toHaveCount(1);
      // The pin itself, on the version it names. It is a row-menu item
      // now, and the menu names what a second pick would do — so
      // "Unmark" is the pinned state, and a section that drew
      // "Executed" off the kind would still be offering "Mark".
      await documentsSection(senderPage)
        .getByRole("button", { name: `Actions for ${draft.name}` })
        .click();
      await expect(
        senderPage.getByRole("menuitem", { name: "Unmark as executed copy" }),
      ).toBeVisible();
      await senderPage.keyboard.press("Escape");

      // ---- Story 20: the signing story, in order, on the record ----

      await senderPage
        .getByRole("toolbar", { name: "Applets" })
        .getByRole("button", { name: /^History/ })
        .click();
      const feedPanel = senderPage.getByRole("complementary", { name: "History" });
      await expect(feedPanel).toBeVisible();
      await expect(feedPanel).toContainText(`${SENDER_NAME} sent this contract for signature`);
      await expect(feedPanel).toContainText(
        `${SENDER_NAME} voided this contract's envelope — ${VOID_REASON}`,
      );
      await expect(feedPanel).toContainText("This contract's envelope was signed");

      // The seam half: each envelope event is its own entry at the
      // record tier, and the two the integration wrote name nobody —
      // an entry with no actor is how the feed says the integration
      // spoke rather than a person.
      const feed = await readFeed(senderPage.request, atSignature.id);
      const envelopeEntries = feed.filter((entry) => entry.action.startsWith("envelope."));
      expect(envelopeEntries.map((entry) => entry.action).sort()).toEqual([
        "envelope.sent",
        "envelope.sent",
        "envelope.signed",
        "envelope.voided",
      ]);
      for (const entry of envelopeEntries) {
        expect(entry.visibility).toBe("working_team");
      }
      expect(feed.find((entry) => entry.action === "envelope.signed")!.actor).toBeNull();
      const autoPinned = feed.find((entry) => entry.action === "document.executed_set");
      expect(autoPinned, "the record does not narrate the automatic pin").toBeDefined();
      expect(autoPinned!.actor).toBeNull();
      const moved = feed.find(
        (entry) =>
          entry.action === "contract.status_changed" && entry.payload.fromStage === "signature",
      );
      expect(
        moved,
        "the record does not narrate the advance out of the signature stage",
      ).toBeDefined();
      expect(moved!.actor).toBeNull();
      expect(moved!.payload.toStage).toBe("active");
    } catch (error) {
      // A cleanup that throws here would replace the failure that
      // caused it, and the failure is the one worth reading.
      await sweepOrSay("M15 connector half", leaveInert);
      throw error;
    }
    await leaveInert();
  });
});
