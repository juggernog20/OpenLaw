// SPDX-License-Identifier: AGPL-3.0-only

/**
 * M21 milestone acceptance (#423): the demo, end to end, in two browser
 * sessions.
 *
 * A submitted request appears in the Inbox, converts into a contract
 * with the collected values carried straight through, and the requester
 * sees the update in their thread — #411's demo sentence, run through
 * the real screens.
 *
 * **Two people, two contexts.** The requester is a JIT-provisioned
 * Business User (DD-010) who never leaves the portal; the triager is the
 * instance Administrator, who never leaves the staff side until the
 * conversion is done. Neither can be the other, and that is what makes
 * the arrival honest: group 4 is actor-excluded (INT-006), so the
 * Administrator hears about a Request somebody else raised.
 *
 * **The carry-through is the milestone, so the demo sets up a value to
 * carry.** M19's seed puts no catalog field on the NDA form and none on
 * the NDA contract type, so the journey starts by attaching one to each
 * — the same `governing_law` slug on both sides — and then proves that
 * what the requester typed into the portal box is what the contract's
 * field holds. Nothing is re-keyed, and nothing in between is faked.
 *
 * **What conversion moves and what it copies.** The Request's paper is
 * promoted into a document at version 1 and the Request's own download
 * goes on answering (INT-002's M21/10 addendum): promotion copies. The
 * thread moves (CMT-001's M21/11 addendum): the requester's reply is on
 * the contract afterwards, the portal window still draws it, and a Full
 * Thread answer on the record still reaches the requester's bell and
 * their email. That last one is the reply promise following the thread.
 *
 * **What the sweep can and cannot take back.** The two field
 * attachments are put back the way the run found them, the contract is
 * archived, and the requester is archived. The Request itself stays:
 * no route deletes one, and a converted Request is out of the Inbox
 * queue by definition, so it reaches no later run's screens.
 */

import {
  test,
  expect,
  type APIRequestContext,
  type BrowserContext,
  type Locator,
  type Page,
} from "@playwright/test";
import { z } from "zod";
import { ADMIN, ensureAdminExists, ensureMemberInert, signInAs, sweepOrSay } from "./helpers.js";
import { extractLink, waitForMailTo } from "./mailpit.js";

/**
 * Generous timeout: two sessions, four real emails through SMTP, a file
 * upload, a conversion that writes a contract and promotes a document,
 * and a conversation with a turn on each side of it.
 */
test.setTimeout(240_000);

/** The run's own domain and requester. The shape matches the one
 * `04-magic-link` prunes on its way in, so this run's allowlist entry is
 * swept by the next run rather than accumulating. */
const RUN_DOMAIN = `e2e-${Date.now()}.example`;
const REQUESTER = `requester@${RUN_DOMAIN}`;

/** The seeded front door this demo submits through (INT-002, migration
 * 0057). It names the NDA contract type, so triage confirms the routing
 * rather than choosing it (DD-018). */
const REQUEST_TYPE_SLUG = "nda_request";
const REQUEST_TYPE_NAME = "NDA request";

/** The contract type that front door targets (migration 0008). */
const CONTRACT_TYPE_SLUG = "nda";
const CONTRACT_TYPE_NAME = "NDA";

/** The one catalog field this run puts on both sides — the request form
 * that collects it and the contract type that has somewhere to put it.
 * One slug, two attachments, and the carry-through is the join between
 * them (INT-002, CTR-016). */
const FIELD_SLUG = "governing_law";
const FIELD_NAME = "Governing law";
const FIELD_ANSWER = "England and Wales";

/** What the requester asks for. The summary is per-run, so the mail
 * filter, the Inbox row, and the bell items all pin to this run. */
const SUMMARY = `E2E M21 NDA with Northwind ${Date.now()}`;
const DESCRIPTION = "One-way NDA ahead of the diligence call. Their paper, our review.";
const ATTACHMENT = "nda-redline.txt";
const ATTACHMENT_BODY = "Clause 7.2 — governing law, marked up.\n";

/** The two turns of the conversation: one before the conversion, one
 * after it. The first is what has to survive the re-parent; the second
 * is what has to reach the requester once the thread has moved. */
const REQUESTER_REPLY = "Adding that we need this before Friday's call.";
const STAFF_REPLY = "Converted it — the redline is on the contract now.";

const DomainsEnvelope = z.object({ domains: z.array(z.string()) });

const FieldRows = z.object({ fields: z.array(z.object({ id: z.string(), slug: z.string() })) });

const RequestTypeRows = z.object({
  requestTypes: z.array(z.object({ id: z.string(), slug: z.string() })),
});

const ContractTypeRows = z.object({
  contractTypes: z.array(z.object({ id: z.string(), slug: z.string() })),
});

const AttachedFields = z.object({
  attachedFields: z.array(z.object({ slug: z.string(), isRequired: z.boolean() })),
});

const MyRequest = z.object({ request: z.object({ id: z.string(), number: z.number().int() }) });

const StaffRequest = z.object({
  request: z.object({
    number: z.number().int(),
    status: z.string(),
    convertedContract: z.object({ number: z.number().int() }).nullable(),
  }),
  attachments: z.array(z.object({ id: z.string(), filename: z.string() })),
});

const ContractRecord = z.object({
  contract: z.object({
    number: z.number().int(),
    title: z.string(),
    priority: z.string(),
    risk: z.string().nullable(),
    stage: z.string(),
    manager: z.object({ displayName: z.string() }).nullable(),
    isConfidential: z.boolean(),
    customFields: z.record(z.string(), z.unknown()),
  }),
  team: z.array(z.object({ displayName: z.string(), role: z.string() })),
});

const ContractRows = z.object({
  contracts: z.array(z.object({ number: z.number().int(), title: z.string() })),
});

const DocumentRows = z.object({
  documents: z.array(
    z.object({
      id: z.string(),
      title: z.string(),
      versions: z.array(
        z.object({ versionNumber: z.number().int(), originalFilename: z.string() }),
      ),
    }),
  ),
});

const CommentRows = z.object({
  comments: z.array(z.object({ body: z.string(), visibility: z.string() })),
});

/** One taxonomy row read by slug — never by the seeded id, so an install
 * that renamed the row still runs. */
async function requestTypeId(request: APIRequestContext): Promise<string> {
  const listed = await request.get("/api/v1/request-types?includeArchived=true");
  expect(listed.status(), await listed.text()).toBe(200);
  const row = RequestTypeRows.parse(await listed.json()).requestTypes.find(
    (type) => type.slug === REQUEST_TYPE_SLUG,
  );
  expect(row, `the ${REQUEST_TYPE_SLUG} request-type seed is missing`).toBeDefined();
  return row!.id;
}

async function contractTypeId(request: APIRequestContext): Promise<string> {
  const listed = await request.get("/api/v1/contract-types?includeArchived=true");
  expect(listed.status(), await listed.text()).toBe(200);
  const row = ContractTypeRows.parse(await listed.json()).contractTypes.find(
    (type) => type.slug === CONTRACT_TYPE_SLUG,
  );
  expect(row, `the ${CONTRACT_TYPE_SLUG} contract-type seed is missing`).toBeDefined();
  return row!.id;
}

async function catalogFieldId(request: APIRequestContext): Promise<string> {
  const listed = await request.get("/api/v1/fields");
  expect(listed.status(), await listed.text()).toBe(200);
  const row = FieldRows.parse(await listed.json()).fields.find(
    (field) => field.slug === FIELD_SLUG,
  );
  expect(
    row,
    `no live ${FIELD_SLUG} field: the seed is missing, or this install archived it`,
  ).toBeDefined();
  return row!.id;
}

/**
 * Both taxonomies attach catalog fields through the same machinery
 * (TECH-023), so one pair of helpers serves the request type and the
 * contract type. `base` is the collection the type lives in.
 */
type TypeCollection = "request-types" | "contract-types";

/**
 * Whether this run's field is on that type right now, and with what
 * required flag. `null` means it is not attached at all.
 *
 * The demo mutates **seeded** rows rather than ones of its own, so it
 * reads the state it is about to change and puts that state back — not
 * the state it happens to want. An install whose Administrator attached
 * this field on purpose must survive a test run untouched (TECH-018).
 */
async function attachmentState(
  request: APIRequestContext,
  base: TypeCollection,
  typeId: string,
): Promise<boolean | null> {
  const read = await request.get(`/api/v1/${base}/${typeId}/fields`);
  expect(read.status(), await read.text()).toBe(200);
  const row = AttachedFields.parse(await read.json()).attachedFields.find(
    (field) => field.slug === FIELD_SLUG,
  );
  return row ? row.isRequired : null;
}

/** Puts the field on the type at the flag this run needs, whatever it
 * found. Attaching and re-flagging are two calls because they are two
 * facts: one is membership, the other is what the form demands. */
async function ensureAttached(
  request: APIRequestContext,
  base: TypeCollection,
  typeId: string,
  fieldId: string,
  required: boolean,
): Promise<void> {
  const now = await attachmentState(request, base, typeId);
  if (now === null) {
    const attached = await request.post(`/api/v1/${base}/${typeId}/fields`, {
      data: { fieldId, isRequired: required },
    });
    expect(attached.status(), await attached.text()).toBe(201);
    return;
  }
  if (now === required) return;
  const flagged = await request.patch(`/api/v1/${base}/${typeId}/fields/${fieldId}`, {
    data: { isRequired: required },
  });
  expect(flagged.status(), await flagged.text()).toBe(200);
}

/**
 * Puts the type back the way the run found it: attached with the flag it
 * had, or off it when it was never on it. The catalog definition and the
 * values already written under its slug stay either way (MTR-014); only
 * the join row moves.
 */
async function restoreAttachment(
  request: APIRequestContext,
  base: TypeCollection,
  typeId: string,
  fieldId: string,
  was: boolean | null,
): Promise<void> {
  if (was === null) {
    const detached = await request.delete(`/api/v1/${base}/${typeId}/fields/${fieldId}`);
    // 404 is an answer too: a run that failed before it attached has
    // nothing to take off.
    expect([204, 404], await detached.text()).toContain(detached.status());
    return;
  }
  if ((await attachmentState(request, base, typeId)) === was) return;
  const restored = await request.patch(`/api/v1/${base}/${typeId}/fields/${fieldId}`, {
    data: { isRequired: was },
  });
  expect(restored.status(), await restored.text()).toBe(200);
}

/**
 * What the instance calls the requester.
 *
 * A magic-link sign-in provisions the row (DD-010), and what lands in
 * its display name is better-auth's business rather than this spec's —
 * so the Inbox row is checked against the name the API answers, not
 * against a name this run assumed.
 */
async function requesterDisplayName(request: APIRequestContext): Promise<string> {
  const listed = await request.get("/api/v1/users");
  expect(listed.status(), await listed.text()).toBe(200);
  const row = z
    .object({ users: z.array(z.object({ email: z.string(), displayName: z.string() })) })
    .parse(await listed.json())
    .users.find((user) => user.email === REQUESTER);
  expect(row, `no user is registered under ${REQUESTER}`).toBeDefined();
  return row!.displayName;
}

/** Leaves every contract this run's summary named inert (TECH-018). */
async function ensureDemoContractsInert(request: APIRequestContext): Promise<void> {
  const listed = await request.get("/api/v1/contracts?includeEnded=true");
  expect(listed.status(), await listed.text()).toBe(200);
  for (const row of ContractRows.parse(await listed.json()).contracts.filter((contract) =>
    contract.title.startsWith(SUMMARY),
  )) {
    const archived = await request.post(`/api/v1/contracts/${String(row.number)}/archive`);
    expect(archived.status(), await archived.text()).toBe(200);
  }
}

/**
 * Signs a fresh Business User in through the real magic-link flow: the
 * portal's own door, the mail, and the redemption that provisions them
 * (DD-010, INT-001).
 */
async function enterPortalByMagicLink(
  context: BrowserContext,
  api: APIRequestContext,
): Promise<Page> {
  const page = await context.newPage();
  await page.goto("/portal/enter");
  await expect(page.getByText("Legal request portal")).toBeVisible();
  await page.getByLabel("Email").fill(REQUESTER);
  await page.getByRole("button", { name: "Send link" }).click();
  await expect(page.getByText("Check your email")).toBeVisible();

  const mail = await waitForMailTo(api, REQUESTER, /^Sign in to OpenLaw$/);
  await page.goto(extractLink(mail.text, "/api/auth/magic-link/verify"));
  // Landing is by role, not by callback URL (the INT-001 M20/2
  // addendum).
  await expect(page).toHaveURL(/\/portal$/);
  return page;
}

/** The one conversation card the portal draws. */
function conversation(page: Page): Locator {
  return page.getByRole("region", { name: "Conversation" });
}

/** One applet's slot on a record's activity bar (DES-016). The staff
 * request detail and the contract record wear the same bar, which is
 * DES-057's whole claim: a Request reads as a record page even though it
 * is not a record. */
function appletSlot(page: Page, label: "Comments"): Locator {
  return page
    .getByRole("toolbar", { name: "Applets" })
    .getByRole("button", { name: new RegExp(`^${label}`) });
}

/** Expands an applet and answers its panel. */
async function openApplet(page: Page, label: "Comments"): Promise<Locator> {
  await appletSlot(page, label).click();
  const panel = page.getByRole("complementary", { name: label });
  await expect(panel).toBeVisible();
  return panel;
}

test.describe.serial("M21 demo path", () => {
  test.beforeAll(async ({ request }) => {
    await ensureAdminExists(request);
  });

  test("a submitted request arrives in the Inbox, converts into a contract with the collected values carried through, and the requester sees it — one journey", async ({
    page,
    browser,
  }) => {
    await signInAs(page, ADMIN.email, ADMIN.password, ADMIN.displayName);

    // The compose-up acceptance, from inside the running stack: M21's
    // migration (0067) landed and the staff read answers, so the Inbox
    // is a queue rather than a 500. Member+ is who may ask (INT-006).
    const queue = await page.request.get("/api/v1/requests");
    expect(queue.status(), await queue.text()).toBe(200);

    // Replace-the-list semantics (#22): read what is there, prune the
    // domains earlier runs left behind, and add this run's. The run's
    // own entry is left standing rather than restored on the way out —
    // it is `04-magic-link`'s pattern and its filter, so the next run's
    // prune is what removes this one's.
    const read = await page.request.get("/api/v1/auth/allowed-domains");
    expect(read.status(), await read.text()).toBe(200);
    const { domains: existing } = DomainsEnvelope.parse(await read.json());
    const written = await page.request.put("/api/v1/auth/allowed-domains", {
      data: {
        domains: [...existing.filter((domain) => !/^e2e-\d+\.example$/.test(domain)), RUN_DOMAIN],
      },
    });
    expect(written.status(), await written.text()).toBe(200);

    const formTypeId = await requestTypeId(page.request);
    const targetTypeId = await contractTypeId(page.request);
    const fieldId = await catalogFieldId(page.request);

    // Read before writing, on both sides.
    const onFormBefore = await attachmentState(page.request, "request-types", formTypeId);
    const onTargetBefore = await attachmentState(page.request, "contract-types", targetTypeId);

    const context = await browser.newContext();
    /**
     * Leaves the shared instance as the run found it (TECH-018).
     *
     * Every step runs, whatever the ones before it did. The four are
     * independent — a contract, two seeded join rows, and a person — so
     * a sweep that stopped at the first refusal would strand the other
     * three for the next run, which is the failure this whole function
     * exists to prevent. What went wrong is reported together at the
     * end rather than swallowed.
     */
    const leaveInert = async () => {
      await context.close();
      const failures: unknown[] = [];
      const settle = async (step: () => Promise<void>) => {
        await step().catch((error: unknown) => failures.push(error));
      };
      await settle(() => ensureDemoContractsInert(page.request));
      await settle(() =>
        restoreAttachment(page.request, "request-types", formTypeId, fieldId, onFormBefore),
      );
      await settle(() =>
        restoreAttachment(page.request, "contract-types", targetTypeId, fieldId, onTargetBefore),
      );
      await settle(() => ensureMemberInert(page.request, REQUESTER));
      if (failures.length > 0) throw new AggregateError(failures, "M21 demo cleanup failed");
    };

    try {
      // ---- One field, both sides of the door ----
      //
      // The form collects it, required, because that is what makes it an
      // answer worth carrying. The contract type attaches it optional:
      // the carry-through is a slug match, and the required flag is the
      // gap rule rather than the carry rule (INT-002, CTR-016).
      await ensureAttached(page.request, "request-types", formTypeId, fieldId, true);
      await ensureAttached(page.request, "contract-types", targetTypeId, fieldId, false);

      // ---- The ask ----

      const portal = await enterPortalByMagicLink(context, page.request);
      const picker = portal.getByRole("list", { name: "Request types" });
      await picker.getByRole("link", { name: new RegExp(REQUEST_TYPE_NAME) }).click();
      await expect(portal).toHaveURL(new RegExp(`/portal/new/${REQUEST_TYPE_SLUG}$`));

      await portal.getByLabel("Summary").fill(SUMMARY);
      await portal.getByLabel("Description").fill(DESCRIPTION);
      await portal.getByLabel("Urgency").selectOption("high");
      await portal.getByLabel(FIELD_NAME).fill(FIELD_ANSWER);
      await portal.getByLabel("Attachments").setInputFiles({
        name: ATTACHMENT,
        mimeType: "text/plain",
        buffer: Buffer.from(ATTACHMENT_BODY),
      });

      const created = portal.waitForResponse(
        (response) =>
          response.url().endsWith("/api/v1/requests") && response.request().method() === "POST",
      );
      // The files go up after the submission, one call at a time (the
      // INT-002 M20/6 addendum). The demo waits on that call rather than
      // on the copy that reports it: the paper has to be on the Request
      // before triage opens it, and a spinner going away is a weaker
      // statement than a 201.
      const uploaded = portal.waitForResponse(
        (response) =>
          /\/api\/v1\/requests\/\d+\/attachments$/.test(response.url()) &&
          response.request().method() === "POST",
      );
      await portal.getByRole("button", { name: "Submit request" }).click();
      expect((await created).status(), await (await created).text()).toBe(201);
      expect((await uploaded).status(), await (await uploaded).text()).toBe(201);

      // The reference is read off the screen, so what the rest of this
      // journey follows is what the requester was told (INT-002).
      const confirmation = portal.getByRole("heading", { name: /^Request R-\d+ is with Legal$/ });
      await expect(confirmation).toBeVisible();
      const confirmed = /R-(\d+)/.exec((await confirmation.textContent()) ?? "");
      expect(confirmed, "the confirmation heading carries no R-### reference").not.toBeNull();
      const reference = confirmed![0];
      const number = Number(confirmed![1]);
      await expect(portal.getByText("Attaching your files…")).toBeHidden();
      await expect(portal.getByRole("alert")).toHaveCount(0);

      // One turn on the thread before anybody triages it, so there is a
      // conversation for the conversion to move (CMT-001).
      await portal.goto(`/portal/requests/${String(number)}`);
      const askThread = conversation(portal);
      const posted = portal.waitForResponse(
        (response) =>
          response.url().endsWith("/api/v1/comments") && response.request().method() === "POST",
      );
      await askThread.getByLabel("Reply to Legal").fill(REQUESTER_REPLY);
      await askThread.getByRole("button", { name: "Send" }).click();
      expect((await posted).status()).toBe(201);
      await expect(askThread.getByText(REQUESTER_REPLY)).toBeVisible();

      // ---- It arrives, and the staff side hears about it ----
      //
      // Group 4, on the bell rather than by polling the queue (NOT-002's
      // M21/4 addendum). The item addresses the **staff** detail: the
      // reader is a triager, and the Request is work rather than news
      // about their own ask.
      await page.goto("/");
      await page.getByRole("button", { name: /^Notifications/ }).click();
      const centre = page.getByRole("dialog", { name: "Notifications" });
      await expect(
        centre.getByRole("link", { name: new RegExp(`submitted a new request: ${SUMMARY}`) }),
      ).toHaveAttribute("href", `/inbox/${String(number)}`);
      await page.keyboard.press("Escape");

      // ---- The Inbox: nav slot one ----

      await page
        .getByRole("navigation", { name: "Primary" })
        .getByRole("link", { name: "Inbox" })
        .click();
      await expect(page).toHaveURL(/\/inbox$/);

      // I1's row, as INT-007 revised it: the reference, the ask, the
      // front door with the routing bound to it, who asked, how urgent
      // they said it is, its status, and the Assign button.
      const row = page.getByRole("row").filter({ hasText: SUMMARY });
      await expect(row).toBeVisible();
      await expect(row).toContainText(reference);
      await expect(row).toContainText(REQUEST_TYPE_NAME);
      await expect(row).toContainText(`Contract · ${CONTRACT_TYPE_NAME}`);
      await expect(row).toContainText(await requesterDisplayName(page.request));
      await expect(row).toContainText("High");
      // The ordering is a product decision, so the page says it rather
      // than leaving the reader to infer it (INT-006).
      await expect(page.getByText("Ordered by urgency, then age")).toBeVisible();

      // Open the Request from its summary; Assign now chooses its triager.
      await expect(row.getByRole("button", { name: `Assign ${reference}` })).toBeVisible();
      await row.getByRole("link", { name: SUMMARY, exact: true }).click();
      await expect(page).toHaveURL(new RegExp(`/inbox/${String(number)}$`));

      // ---- The staff detail (I2) ----

      await expect(page.getByRole("heading", { level: 1, name: SUMMARY })).toBeVisible();
      // The hero's envelope. The routing sits beside the front door
      // rather than inside it, because "Contract · NDA" and "NDA
      // request" answer different questions: one is the form the
      // requester filled in, the other is how much of the conversion is
      // already decided (DD-018, INT-002).
      await expect(page.getByText(`Contract · ${CONTRACT_TYPE_NAME}`)).toBeVisible();
      // What the requester answered, under the label the box that
      // collected it wore.
      await expect(page.getByText(DESCRIPTION)).toBeVisible();
      await expect(page.getByText(FIELD_NAME, { exact: true })).toBeVisible();
      await expect(page.getByText(FIELD_ANSWER)).toBeVisible();
      // The paper that travelled with the ask, in reach before the
      // decision — a name a triager cannot open is a label.
      const download = page.getByRole("link", { name: ATTACHMENT });
      const attachmentHref = await download.getAttribute("href");
      expect(attachmentHref, `the ${ATTACHMENT} row is a label rather than a link`).not.toBeNull();
      const fetched = await page.request.get(attachmentHref!);
      expect(fetched.status(), await fetched.text()).toBe(200);
      // And the conversation, at every tier, on the same activity bar a
      // contract wears (DES-057, CMT-010).
      const staffThread = await openApplet(page, "Comments");
      await expect(staffThread.getByText(REQUESTER_REPLY)).toBeVisible();
      await staffThread.getByRole("button", { name: "Close" }).click();

      // ---- Convert ----

      await page.getByRole("button", { name: "Triage", exact: true }).click();
      await page.getByRole("menuitem", { name: "Convert to contract", exact: true }).click();
      const dialog = page.getByRole("dialog", { name: `Convert ${reference} to a contract` });
      await expect(dialog).toBeVisible();

      // I3's prefill, whole (INT-002, MTR-012): the summary as the
      // title, the routing stated rather than offered, the urgency
      // mapped 1:1 to priority with no risk beside it, and the collected
      // value named as carrying.
      await expect(dialog.getByLabel(/^Title/)).toHaveValue(SUMMARY);
      await expect(dialog.getByText(`${REQUEST_TYPE_NAME} · submitted by`)).toBeVisible();
      await expect(dialog.getByText(CONTRACT_TYPE_NAME, { exact: true })).toBeVisible();
      await expect(
        dialog.getByText("Set by the request type. Triage confirms the routing rather than"),
      ).toBeVisible();
      await expect(dialog.getByText("Carries into the contract")).toBeVisible();
      await expect(dialog.getByText(FIELD_NAME, { exact: true })).toBeVisible();
      await expect(dialog.getByText(FIELD_ANSWER)).toBeVisible();
      await expect(dialog.getByText(/Risk stays yours to set on the record/)).toBeVisible();

      const converted = page.waitForResponse(
        (response) =>
          response.url().endsWith(`/api/v1/requests/${String(number)}/convert`) &&
          response.request().method() === "POST",
      );
      await dialog.getByRole("button", { name: "Convert to contract", exact: true }).click();
      expect((await converted).status(), await (await converted).text()).toBe(200);
      await expect(dialog).toBeHidden();

      // The Request now states what became of it, and the reference is
      // one click from the ask (INT-007).
      const outcome = page.getByRole("region", { name: "Outcome" });
      await expect(outcome.getByText("Converted")).toBeVisible();
      const contractLink = outcome.getByRole("link", { name: /^C-\d+$/ });
      await expect(contractLink).toBeVisible();
      const became = /C-(\d+)/.exec((await contractLink.textContent()) ?? "");
      expect(became, "the Outcome card names no C-###").not.toBeNull();
      const contractNumber = Number(became![1]);
      // A decided Request no longer offers the Triage menu.
      await expect(page.getByRole("button", { name: "Triage", exact: true })).toHaveCount(0);
      await expect(page.getByRole("button", { name: "Convert to contract" })).toHaveCount(0);
      await expect(page.getByRole("button", { name: "Resolve" })).toHaveCount(0);
      await expect(page.getByRole("button", { name: "Decline" })).toHaveCount(0);

      // ---- The record it became ----

      await contractLink.click();
      await expect(page).toHaveURL(new RegExp(`/contracts/${String(contractNumber)}$`));
      await expect(page.getByRole("heading", { level: 1, name: SUMMARY })).toBeVisible();

      // An ordinary contract, born with the values carried: the C-###
      // sequence, the draft-stage seed, no Owner, no team beyond the
      // triager's own creator row, no Confidential flag — the M16
      // successor rule's sibling — with the urgency landed as priority
      // and the collected value in its real field.
      const record = await page.request.get(`/api/v1/contracts/${String(contractNumber)}`);
      expect(record.status(), await record.text()).toBe(200);
      const parsed = ContractRecord.parse(await record.json());
      expect(parsed.contract.title).toBe(SUMMARY);
      expect(parsed.contract.priority).toBe("high");
      expect(parsed.contract.risk).toBeNull();
      expect(parsed.contract.stage).toBe("draft");
      expect(parsed.contract.manager).toBeNull();
      expect(parsed.contract.isConfidential).toBe(false);
      expect(parsed.contract.customFields[FIELD_SLUG]).toBe(FIELD_ANSWER);
      // One row, and it is provenance rather than a team: the triager
      // who converted (CTR-004). Nothing was inherited from the Request.
      expect(parsed.team.map((member) => `${member.displayName} ${member.role}`)).toEqual([
        `${ADMIN.displayName} creator`,
      ]);

      // The same value, on the screen a person reads it from.
      await page.goto(`/contracts/${String(contractNumber)}/fields`);
      await expect(page.getByLabel(FIELD_NAME)).toHaveValue(FIELD_ANSWER);

      // The paper is real paper: one document at version 1, filed at the
      // record root (INT-002's M21/10 addendum, DOC-008).
      const documents = await page.request.get(
        `/api/v1/contracts/${String(contractNumber)}/documents`,
      );
      expect(documents.status(), await documents.text()).toBe(200);
      const promoted = DocumentRows.parse(await documents.json()).documents.filter(
        (doc) => doc.title === ATTACHMENT,
      );
      expect(promoted).toHaveLength(1);
      expect(promoted[0]!.versions.map((version) => version.versionNumber)).toEqual([1]);
      expect(promoted[0]!.versions[0]!.originalFilename).toBe(ATTACHMENT);

      // Promotion copies rather than moves: the Request's own download
      // still answers, with the bytes the requester uploaded.
      const stillThere = await page.request.get(attachmentHref!);
      expect(stillThere.status(), await stillThere.text()).toBe(200);
      expect(await stillThere.text()).toBe(ATTACHMENT_BODY);

      // The thread moved, tier intact, and it is on the record now
      // (CMT-001's M21/11 addendum).
      const recordThread = await openApplet(page, "Comments");
      await expect(recordThread.getByText(REQUESTER_REPLY)).toBeVisible();

      // Legal answers on the record, at the tier the requester can hear
      // (DD-016). From here on there is exactly one place to answer.
      const audience = recordThread.getByRole("group", { name: "Audience" });
      await audience.getByText("Full thread", { exact: true }).click();
      await expect(recordThread.getByRole("radio", { name: "Full thread" })).toBeChecked();
      await recordThread.getByLabel("New comment").fill(STAFF_REPLY);
      const answered = page.waitForResponse(
        (response) =>
          response.url().endsWith("/api/v1/comments") && response.request().method() === "POST",
      );
      await recordThread.getByRole("button", { name: "Comment", exact: true }).click();
      expect((await answered).status(), await (await answered).text()).toBe(201);

      // ---- And the requester sees the update in their thread ----

      await portal.reload();
      // One vocabulary, on the pill and in the banner (the INT-003 M21/6
      // addendum): `converted` is a fact about Legal's machinery, and
      // "In progress" is what it means to the person who asked.
      await expect(portal.getByText("In progress", { exact: true })).toBeVisible();
      await expect(portal.getByText("Legal is working on this. Follow it here.")).toBeVisible();
      // Their window survives the conversion: the same address, the same
      // card, and the conversation is the record's thread filtered to
      // Full Thread (CMT-001, DD-018).
      await expect(portal).toHaveURL(new RegExp(`/portal/requests/${String(number)}$`));
      const movedThread = conversation(portal);
      await expect(movedThread.getByText(REQUESTER_REPLY)).toBeVisible();
      await expect(movedThread.getByText(STAFF_REPLY)).toBeVisible();
      // Their own paper is still theirs to open, because promotion
      // copied it.
      await expect(
        portal
          .getByRole("region", { name: "What you submitted" })
          .getByRole("link", { name: ATTACHMENT }),
      ).toBeVisible();

      // The outcome reached them where they are: the status change as
      // email, in the same words the pill uses (INT-003, NOT-002 group
      // 5).
      const statusMail = await waitForMailTo(
        page.request,
        REQUESTER,
        new RegExp(`^Your request is in progress: ${reference} · `),
      );
      expect(statusMail.text).toContain(`/portal/requests/${String(number)}`);

      // And the reply promise followed the thread onto the record (the
      // NOT-002 M21/11 addendum): a Full Thread comment on the contract
      // still reaches the Requester's email and their portal bell, one
      // person told once.
      const replyMail = await waitForMailTo(
        page.request,
        REQUESTER,
        new RegExp(`^Legal replied on ${reference} · `),
      );
      expect(replyMail.text).toContain(`/portal/requests/${String(number)}`);
      await portal.getByRole("button", { name: /^Notifications/ }).click();
      const portalCentre = portal.getByRole("dialog", { name: "Notifications" });
      await expect(
        portalCentre.getByRole("link", { name: new RegExp(`replied on your request ${SUMMARY}`) }),
      ).toHaveAttribute("href", `/portal/requests/${String(number)}`);
      await expect(
        portalCentre.getByRole("link", {
          name: new RegExp(`status of your request ${SUMMARY} changed`),
        }),
      ).toBeVisible();
      await portal.keyboard.press("Escape");

      // ---- Behind the screens ----
      //
      // The Request survives whole: it is the portal's shell, so it
      // keeps its status, its link to the record, and its paper. The
      // thread moved rather than copying — the Request's own address now
      // answers the record's conversation, which is why the two comments
      // read the same from both sides.
      const staff = await page.request.get(`/api/v1/requests/${String(number)}`);
      expect(staff.status(), await staff.text()).toBe(200);
      const shell = StaffRequest.parse(await staff.json());
      expect(shell.request.status).toBe("converted");
      expect(shell.request.convertedContract?.number).toBe(contractNumber);
      expect(shell.attachments.map((file) => file.filename)).toEqual([ATTACHMENT]);

      // The Request's own thread address now answers the record's
      // conversation — the arm answering for a record it is not (the
      // CMT-010 M21/11 addendum). Both turns are there, at the tier they
      // were said in, which is what "the thread moved" means.
      const detail = await portal.request.get(`/api/v1/portal/requests/${String(number)}`);
      expect(detail.status(), await detail.text()).toBe(200);
      const requestId = MyRequest.parse(await detail.json()).request.id;
      const throughTheRequest = await page.request.get("/api/v1/comments", {
        params: { entityType: "request", entityId: requestId },
      });
      expect(throughTheRequest.status(), await throughTheRequest.text()).toBe(200);
      const carried = CommentRows.parse(await throughTheRequest.json()).comments;
      expect(carried.map((comment) => comment.body)).toEqual([REQUESTER_REPLY, STAFF_REPLY]);
      expect(carried.every((comment) => comment.visibility === "full_thread")).toBe(true);
    } catch (error) {
      // A cleanup that throws here would replace the failure that caused
      // it, and the failure is the one worth reading.
      await sweepOrSay("M21 demo", leaveInert);
      throw error;
    }
    // The journey passed, so a cleanup that fails is a failure of its
    // own: it leaves the shared instance dirty for the next run.
    await leaveInert();
  });
});
