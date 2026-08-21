// SPDX-License-Identifier: AGPL-3.0-only

/**
 * M20 milestone acceptance (#384): the demo, end to end, in two browser
 * sessions.
 *
 * A business user requests a magic link, lands in the portal, submits an
 * NDA request with an attachment, and sees it in their list with a live
 * thread — #373's demo sentence, run through the real screens.
 *
 * **Two people, two contexts.** The Administrator configures the front
 * door and answers from the staff side; the requester is a
 * JIT-provisioned Business User (DD-010) with a session of their own.
 * Neither can be the other, which is the point: every portal read puts
 * the requester in the `where` clause (DD-013), so an Administrator
 * asking for the requester's own Request gets the same 404, word for
 * word, as one asking for a number nobody has.
 *
 * **The arc, not the surface.** M19 built the front door's configuration
 * and nothing a requester could see. So the journey starts by attaching a
 * catalog field to the seeded "NDA request" type and marking it required
 * **on that form** — the per-attachment flag that makes a form definition
 * more than a list (INT-002) — and then walks the requester through the
 * portal that renders it. The refusal on the empty form names the basics
 * and the attached field in one sentence, which is the INT-002 M20/4
 * rule that nobody should press Submit twice to learn two halves of one
 * answer.
 *
 * **Everything after the submission is the paper and the thread.** The
 * file rides the upload seam and comes back as a download link on the
 * detail; the requester replies; the Administrator replies at Full
 * Thread; and that reply reaches the portal three ways — on the thread,
 * on the portal bell, and as the group 5 email a requester who does not
 * live in the app depends on (INT-003).
 *
 * **What the sweep can and cannot take back.** The attached field is
 * detached and the requester is archived, so the never-reset instance
 * (TECH-018) is left as the run found it. The Request itself stays: there
 * is no route that deletes one, because M21 is where a Request's fate is
 * decided. Its requester is archived and its summary is per-run, so it
 * reaches no later run's screens.
 */

import {
  test,
  expect,
  type APIRequestContext,
  type BrowserContext,
  type Page,
} from "@playwright/test";
import { z } from "zod";
import { ADMIN, ensureAdminExists, ensureMemberInert, signInAs, sweepOrSay } from "./helpers.js";
import { extractLink, waitForMailTo } from "./mailpit.js";

/**
 * Generous timeout: two sessions, three real emails through SMTP, a file
 * upload, and a conversation with a turn on each side.
 */
test.setTimeout(180_000);

/** The run's own domain and requester. The shape matches the one
 * `04-magic-link` prunes on its way in, so this run's allowlist entry is
 * swept by the next run rather than accumulating. */
const RUN_DOMAIN = `e2e-${Date.now()}.example`;
const REQUESTER = `requester@${RUN_DOMAIN}`;

/** The seeded front door this demo submits through (INT-002, migration
 * 0057). It targets the NDA contract type, which is what makes a
 * contract-scoped catalog field attachable to it. */
const TYPE_SLUG = "nda_request";
const TYPE_NAME = "NDA request";

/** The catalog field the Administrator puts on that form for this run
 * (the M6 seed, CTR-016). */
const FIELD_SLUG = "governing_law";
const FIELD_NAME = "Governing law";
const FIELD_ANSWER = "England and Wales";

/** What the requester asks for. The summary is per-run, so the mail
 * filter and the bell items pin to this run's Request. */
const SUMMARY = `E2E M20 NDA with Northwind ${Date.now()}`;
const DESCRIPTION = "One-way NDA ahead of the diligence call. Their paper, our review.";
const ATTACHMENT = "nda-redline.txt";

/** The two turns of the conversation. */
const REQUESTER_REPLY = "Adding that we need this before Friday's call.";
const STAFF_REPLY = "Picked it up — I will have the redline back to you on Thursday.";

const DomainsEnvelope = z.object({ domains: z.array(z.string()) });

const FieldRows = z.object({ fields: z.array(z.object({ id: z.string(), slug: z.string() })) });

const RequestTypeRows = z.object({
  requestTypes: z.array(z.object({ id: z.string(), slug: z.string() })),
});

const MyRequests = z.object({ requests: z.array(z.object({ number: z.number().int() })) });

const AttachedFields = z.object({
  attachedFields: z.array(z.object({ slug: z.string(), isRequired: z.boolean() })),
});

const MyRequest = z.object({ request: z.object({ id: z.string(), number: z.number().int() }) });

/** An RFC 9457 problem, loosely — enough of it to compare two refusals. */
const Problem = z.looseObject({
  title: z.string(),
  status: z.number().int(),
  detail: z.string(),
});

/** The seeded request type this demo submits through, read by slug —
 * never by the seeded id, so an install that renamed the row still
 * runs. */
async function ndaRequestTypeId(request: APIRequestContext): Promise<string> {
  const listed = await request.get("/api/v1/request-types?includeArchived=true");
  expect(listed.status(), await listed.text()).toBe(200);
  const row = RequestTypeRows.parse(await listed.json()).requestTypes.find(
    (type) => type.slug === TYPE_SLUG,
  );
  expect(row, `the ${TYPE_SLUG} request-type seed is missing`).toBeDefined();
  return row!.id;
}

/** The catalog field this run attaches, by slug. */
async function governingLawFieldId(request: APIRequestContext): Promise<string> {
  const listed = await request.get("/api/v1/fields");
  expect(listed.status(), await listed.text()).toBe(200);
  const row = FieldRows.parse(await listed.json()).fields.find(
    (field) => field.slug === FIELD_SLUG,
  );
  expect(row, `the ${FIELD_SLUG} field seed is missing`).toBeDefined();
  return row!.id;
}

/**
 * Whether the run's field is on the seeded form right now, and with what
 * required flag. `null` means it is not attached at all.
 *
 * The demo mutates a **seeded** row rather than one of its own, so it
 * reads the state it is about to change and puts that state back — not
 * the state it happens to want. A seed that ever ships this field
 * attached, or an install whose Administrator attached it on purpose,
 * must survive a test run untouched (TECH-018).
 */
async function attachmentState(
  request: APIRequestContext,
  typeId: string,
): Promise<boolean | null> {
  const read = await request.get(`/api/v1/request-types/${typeId}/fields`);
  expect(read.status(), await read.text()).toBe(200);
  const row = AttachedFields.parse(await read.json()).attachedFields.find(
    (field) => field.slug === FIELD_SLUG,
  );
  return row ? row.isRequired : null;
}

/**
 * Puts the form back the way the run found it: attached with the flag it
 * had, or off the form when it was never on it. The catalog definition
 * and the values already collected under its slug stay either way
 * (MTR-014); only the join row moves.
 */
async function restoreAttachment(
  request: APIRequestContext,
  typeId: string,
  fieldId: string,
  was: boolean | null,
): Promise<void> {
  if (was === null) {
    const detached = await request.delete(`/api/v1/request-types/${typeId}/fields/${fieldId}`);
    // 404 is an answer too: a run that failed before it attached has
    // nothing to take off.
    expect([204, 404], await detached.text()).toContain(detached.status());
    return;
  }
  if ((await attachmentState(request, typeId)) === was) return;
  const restored = await request.patch(`/api/v1/request-types/${typeId}/fields/${fieldId}`, {
    data: { isRequired: was },
  });
  expect(restored.status(), await restored.text()).toBe(200);
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
  // The sent screen says the same thing whether or not mail goes out;
  // Mailpit is what proves delivery.
  await expect(page.getByText("Check your email")).toBeVisible();

  const mail = await waitForMailTo(api, REQUESTER, /^Sign in to OpenLaw$/);
  await page.goto(extractLink(mail.text, "/api/auth/magic-link/verify"));
  // The callback is "/" and the root loader lands a Business User in the
  // portal: landing is by role, not by callback URL (the INT-001 M20/2
  // addendum).
  await expect(page).toHaveURL(/\/portal$/);
  return page;
}

/** The one conversation card the portal draws. */
function conversation(page: Page) {
  return page.getByRole("region", { name: "Conversation" });
}

test.describe.serial("M20 demo path", () => {
  test.beforeAll(async ({ request }) => {
    await ensureAdminExists(request);
  });

  test("a business user magic-links into the portal, submits an NDA request with an attachment, and holds a conversation on it — one journey", async ({
    page,
    browser,
  }) => {
    await signInAs(page, ADMIN.email, ADMIN.password, ADMIN.displayName);

    // The compose-up acceptance, from inside the running stack: the M20
    // migrations (0061, 0062) landed, so the requests seam answers a
    // list rather than a 500. It answers empty, which is the second
    // fact — Member+ staff get DD-013's rule applied to themselves, and
    // this Administrator has asked Legal for nothing.
    const staffList = await page.request.get("/api/v1/portal/requests");
    expect(staffList.status(), await staffList.text()).toBe(200);
    expect(MyRequests.parse(await staffList.json()).requests).toEqual([]);

    // Replace-the-list semantics (#22): read what is there, prune the
    // domains earlier runs left behind, and add this run's. The run's
    // own entry is left standing rather than restored on the way out —
    // it is `04-magic-link`'s pattern and its filter, so the next run's
    // prune is what removes this one's and the list cannot grow without
    // bound.
    const read = await page.request.get("/api/v1/auth/allowed-domains");
    expect(read.status(), await read.text()).toBe(200);
    const { domains: existing } = DomainsEnvelope.parse(await read.json());
    const written = await page.request.put("/api/v1/auth/allowed-domains", {
      data: {
        domains: [...existing.filter((domain) => !/^e2e-\d+\.example$/.test(domain)), RUN_DOMAIN],
      },
    });
    expect(written.status(), await written.text()).toBe(200);

    const typeId = await ndaRequestTypeId(page.request);
    const fieldId = await governingLawFieldId(page.request);

    // Read before writing: the form this demo configures is a seeded row
    // that an install may have configured for itself, so what the sweep
    // puts back is what was there and not what this run wanted.
    const attachedBefore = await attachmentState(page.request, typeId);

    const context = await browser.newContext();
    /** Leaves the shared instance as the run found it (TECH-018). */
    const leaveInert = async () => {
      await context.close();
      await restoreAttachment(page.request, typeId, fieldId, attachedBefore);
      await ensureMemberInert(page.request, REQUESTER);
    };

    try {
      // ---- M19's configuration, one screen back from the portal ----
      //
      // The seeded NDA form collects the four basics and nothing else
      // until an Administrator puts a catalog field on it. Required
      // here means required **on this form**. Attached if it was not
      // there, and flagged if it was, so a run on an install that had
      // already attached it starts from the same screen.
      if (attachedBefore === null) {
        const attached = await page.request.post(`/api/v1/request-types/${typeId}/fields`, {
          data: { fieldId, isRequired: true },
        });
        expect(attached.status(), await attached.text()).toBe(201);
      } else if (!attachedBefore) {
        const flagged = await page.request.patch(
          `/api/v1/request-types/${typeId}/fields/${fieldId}`,
          { data: { isRequired: true } },
        );
        expect(flagged.status(), await flagged.text()).toBe(200);
      }
      expect(await attachmentState(page.request, typeId)).toBe(true);

      // ---- The requester arrives ----

      const portal = await enterPortalByMagicLink(context, page.request);
      await expect(
        portal.getByRole("heading", { name: "What do you need from Legal?" }),
      ).toBeVisible();
      // The portal is a place with a chrome of its own (INT-001, the
      // M20/2 and M20/9 addenda): the surface name, the identity and the
      // way out, and exactly two destinations — a bell and a gear.
      const banner = portal.getByRole("banner");
      await expect(banner.getByText("Legal request portal")).toBeVisible();
      await expect(banner.getByText(REQUESTER)).toBeVisible();
      await expect(banner.getByRole("button", { name: "Sign out" })).toBeVisible();
      await expect(banner.getByRole("link", { name: "Notification settings" })).toBeVisible();

      // Their list is empty, and it says so rather than drawing nothing.
      const myRequests = portal.getByRole("region", { name: "Your requests" });
      await expect(
        myRequests.getByText("You have not asked Legal for anything yet."),
      ).toBeVisible();

      // ---- The form the Administrator configured ----

      const picker = portal.getByRole("list", { name: "Request types" });
      await picker.getByRole("link", { name: new RegExp(TYPE_NAME) }).click();
      await expect(portal).toHaveURL(new RegExp(`/portal/new/${TYPE_SLUG}$`));
      await expect(portal.getByRole("heading", { name: TYPE_NAME })).toBeVisible();

      // The four basics are drawn as facts about every form (INT-002's
      // M19/4 addendum), and the attached field follows them.
      await expect(portal.getByLabel("Summary")).toBeVisible();
      await expect(portal.getByLabel("Description")).toBeVisible();
      await expect(portal.getByRole("button", { name: "Choose files" })).toBeVisible();
      await expect(portal.getByLabel("Urgency")).toBeVisible();
      await expect(portal.getByLabel(FIELD_NAME)).toBeVisible();

      // One refusal names every gap, basics and attached field together
      // (the INT-002 M20/4 addendum). Urgency is answered already: it is
      // born `medium`, as a contract's priority is.
      await portal.getByRole("button", { name: "Submit request" }).click();
      await expect(
        portal.getByRole("alert").filter({ hasText: `Summary, Description, and ${FIELD_NAME}` }),
      ).toBeVisible();
      // And again on each box, because a sentence cannot point at one.
      await expect(portal.getByText("Summary is required.")).toBeVisible();
      await expect(portal.getByText(`${FIELD_NAME} is required.`)).toBeVisible();

      // ---- The ask, with its paper ----

      await portal.getByLabel("Summary").fill(SUMMARY);
      await portal.getByLabel("Description").fill(DESCRIPTION);
      await portal.getByLabel("Urgency").selectOption("high");
      await portal.getByLabel(FIELD_NAME).fill(FIELD_ANSWER);
      // The dropzone's input is out of the tab order and out of sight,
      // and its label still points at it — so the file goes in by the
      // name on the screen rather than by an id only the markup knows.
      await portal.getByLabel("Attachments").setInputFiles({
        name: ATTACHMENT,
        mimeType: "text/plain",
        buffer: Buffer.from("Clause 7.2 — governing law, marked up.\n"),
      });
      // Picked, listed, and takeable back — the I6 normalization the
      // INT-002 M20/6 addendum records, because a mis-picked file that
      // cannot be unpicked is a form that has to be started again.
      await expect(portal.getByRole("button", { name: `Remove ${ATTACHMENT}` })).toBeVisible();

      const created = portal.waitForResponse(
        (response) =>
          response.url().endsWith("/api/v1/requests") && response.request().method() === "POST",
      );
      await portal.getByRole("button", { name: "Submit request" }).click();
      expect((await created).status()).toBe(201);

      // The confirmation carries R-###, which is the handle a requester
      // quotes (INT-002). It is read off the screen, so what the rest of
      // this journey follows is what the requester was told.
      const confirmation = portal.getByRole("heading", { name: /^Request R-\d+ is with Legal$/ });
      await expect(confirmation).toBeVisible();
      const reference = /R-\d+/.exec((await confirmation.textContent()) ?? "")![0];
      const number = Number(reference.slice(2));
      // The files go up after the submission, one call at a time (the
      // INT-002 M20/6 addendum), and none of them was named as failing.
      await expect(portal.getByText("Attaching your files…")).toBeHidden();
      await expect(portal.getByRole("alert")).toHaveCount(0);

      // The receipt — the one message in the catalog addressed to the
      // person who caused the event (INT-001, the INT-003 M20/8
      // addendum). Group 5's email default is on and nothing in this run
      // expressed a preference, so the default is what fires.
      const receipt = await waitForMailTo(
        page.request,
        REQUESTER,
        new RegExp(`^We have your request: ${reference} · `),
      );
      expect(receipt.text).toContain(`/portal/requests/${String(number)}`);

      // ---- It is in their list ----

      await portal.getByRole("link", { name: "Back to the portal" }).click();
      await expect(portal).toHaveURL(/\/portal$/);
      const row = myRequests.getByRole("link", { name: new RegExp(SUMMARY) });
      await expect(row).toContainText(reference);
      await expect(row).toContainText(TYPE_NAME);
      await expect(row).toContainText("New");

      // ---- The detail says what was submitted ----

      await row.click();
      await expect(portal).toHaveURL(new RegExp(`/portal/requests/${String(number)}$`));
      await expect(portal.getByRole("heading", { name: SUMMARY })).toBeVisible();
      await expect(portal.getByText(`${reference} · ${TYPE_NAME} · Submitted`)).toBeVisible();
      await expect(
        portal.getByText("Legal has received your request.", { exact: false }),
      ).toBeVisible();

      const submitted = portal.getByRole("region", { name: "What you submitted" });
      await expect(submitted.getByText(DESCRIPTION)).toBeVisible();
      await expect(submitted.getByText("High", { exact: true })).toBeVisible();
      // The value the M19 form definition collected, under the label the
      // box that collected it wore.
      await expect(submitted.getByText(FIELD_NAME, { exact: true })).toBeVisible();
      await expect(submitted.getByText(FIELD_ANSWER)).toBeVisible();
      // The paper came back as a link, because a name a requester cannot
      // open is a label rather than a document.
      const download = submitted.getByRole("link", { name: ATTACHMENT });
      const fetched = await portal.request.get((await download.getAttribute("href"))!);
      expect(fetched.status(), await fetched.text()).toBe(200);

      // ---- The conversation, both ways ----
      //
      // The card draws before anybody has replied: it is the way to
      // start the conversation rather than a claim about one (the
      // INT-001 M20/7 addendum).
      const thread = conversation(portal);
      await expect(thread).toBeVisible();
      const posted = portal.waitForResponse(
        (response) =>
          response.url().endsWith("/api/v1/comments") && response.request().method() === "POST",
      );
      await thread.getByLabel("Reply to Legal").fill(REQUESTER_REPLY);
      await thread.getByRole("button", { name: "Send" }).click();
      expect((await posted).status()).toBe(201);
      await expect(thread.getByText(REQUESTER_REPLY)).toBeVisible();
      await expect(thread.getByText("You", { exact: true })).toBeVisible();

      // Legal answers. There is no staff surface for a Request until
      // M21's Inbox, so the Administrator posts at the seam — the same
      // seam the portal composer posts at, through the one arm that
      // resolves a Request's audience (the CMT-010 M20/7 addendum).
      const detail = await portal.request.get(`/api/v1/portal/requests/${String(number)}`);
      expect(detail.status(), await detail.text()).toBe(200);
      const requestId = MyRequest.parse(await detail.json()).request.id;
      const answered = await page.request.post("/api/v1/comments", {
        data: {
          entityType: "request",
          entityId: requestId,
          body: STAFF_REPLY,
          visibility: "full_thread",
        },
      });
      expect(answered.status(), await answered.text()).toBe(201);

      // A Request is its requester's alone (DD-013): the same
      // Administrator who just replied on the thread cannot read the
      // Request through the portal, and the refusal is word for word the
      // one a number nobody has earns. A reference is not an oracle.
      //
      // Everything but `instance` is compared: RFC 9457 makes that
      // member the address that was asked, so it differs by definition
      // and says nothing about the two Requests.
      const refusal = async (askedFor: number) => {
        const answer = await page.request.get(`/api/v1/portal/requests/${String(askedFor)}`);
        expect(answer.status()).toBe(404);
        const problem = Problem.parse(await answer.json());
        return { title: problem.title, status: problem.status, detail: problem.detail };
      };
      expect(await refusal(number)).toEqual(await refusal(999_999_999));

      // The reply reaches the portal three ways. First on the thread,
      // where anybody who is not the reader is Legal.
      await portal.reload();
      await expect(conversation(portal).getByText(STAFF_REPLY)).toBeVisible();
      await expect(conversation(portal).getByText("Legal", { exact: true })).toBeVisible();

      // Second as email, because a requester does not live in the app and
      // INT-003 declined the poke button on that basis.
      const replyMail = await waitForMailTo(
        page.request,
        REQUESTER,
        new RegExp(`^Legal replied on ${reference} · `),
      );
      expect(replyMail.text).toContain(`/portal/requests/${String(number)}`);

      // Third on the portal bell — the requester's own rows, on a second
      // mount of the staff bell (the NOT-005 M20/9 addendum). The receipt
      // and the reply are both unread, and both address the Request's one
      // page: a Request has no sections to name.
      await expect(portal.getByRole("button", { name: /^Notifications, 2 unread$/ })).toBeVisible();
      await portal.getByRole("button", { name: /^Notifications, 2 unread$/ }).click();
      const centre = portal.getByRole("dialog", { name: "Notifications" });
      await expect(
        centre.getByRole("link", { name: new RegExp(`replied on your request ${SUMMARY}`) }),
      ).toHaveAttribute("href", `/portal/requests/${String(number)}`);
      await expect(
        centre.getByRole("link", { name: new RegExp(`received your request ${SUMMARY}`) }),
      ).toBeVisible();
      await portal.keyboard.press("Escape");

      // ---- And the portal's other destination ----
      //
      // NOT-002's group 5 and nothing else: the other four groups are
      // about contracts, records, dates, and the Inbox, none of which a
      // Business User can open (DD-013).
      await portal.getByRole("link", { name: "Notification settings" }).click();
      await expect(portal).toHaveURL(/\/portal\/settings$/);
      const prefs = portal.getByRole("region", { name: "How we tell you about your requests" });
      await expect(prefs.getByRole("switch")).toHaveCount(2);
      await expect(prefs.getByRole("switch", { name: "Request updates Email" })).toBeChecked();
    } catch (error) {
      // A cleanup that throws here would replace the failure that caused
      // it, and the failure is the one worth reading.
      await sweepOrSay("M20 demo", leaveInert);
      throw error;
    }
    // The journey passed, so a cleanup that fails is a failure of its
    // own: it leaves the shared instance dirty for the next run.
    await leaveInert();
  });

  test("staff keep the full app and may still visit the portal", async ({ page }) => {
    // Landing is by role, so the Administrator's own root is the staff
    // shell — `signInAs` asserts that. The portal is not closed to them,
    // though: an Administrator who opens a requester's deep link has to
    // reach a page rather than a bounce (the INT-001 M20/2 addendum).
    await signInAs(page, ADMIN.email, ADMIN.password, ADMIN.displayName);

    await page.goto("/portal");
    await expect(page).toHaveURL(/\/portal$/);
    await expect(page.getByRole("heading", { name: "What do you need from Legal?" })).toBeVisible();
    // Theirs is the same portal and their own list is empty, which is
    // DD-013 read from the other side: staff standing opens no Request
    // that was never theirs to raise.
    await expect(
      page
        .getByRole("region", { name: "Your requests" })
        .getByText("You have not asked Legal for anything yet."),
    ).toBeVisible();
  });
});
