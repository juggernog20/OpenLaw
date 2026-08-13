// SPDX-License-Identifier: AGPL-3.0-only

/**
 * M9 milestone acceptance (#134): the demo, end to end.
 *
 * A Legal Team Member opens a contract, posts a Legal Only comment and a
 * Full Thread comment in the chat applet, edits a field on the record,
 * opens the history applet, and reads the field edit narrated as a
 * sentence at the tier the record writes it at.
 *
 * A second journey is what makes the tier model real rather than
 * notional (DD-016): a Contributor on that contract's team opens the
 * same record and the Legal Only comment leaves no trace — not in the
 * thread, not in the feed, and not in the unread badge. The Full Thread
 * comment and the field edit are both there, so the absence is the
 * predicate working and not the panel being empty.
 *
 * The tier is filtered at query time, never at display time (DD-016,
 * DD-017), so every "no trace" assertion is made twice: once on what the
 * Contributor's screen draws, and once on what the seam answers them.
 * A count that came down right cannot leak; a count filtered in the
 * browser could.
 *
 * The never-reset instance (TECH-018) is left as the run found it, on
 * the M8 spec's conventions:
 *
 * - Per-run rows carry a prefix, are swept before the journey starts,
 *   and end archived — the resting state a contract has, because it has
 *   no hard delete. The prefix is this spec's own, not M8's: the two
 *   specs sweep their own rows and must not reach into each other's.
 * - The two per-run people end archived too, which is an activated
 *   user's resting state.
 * - Comments need no sweep of their own. They hang off the per-run
 *   contract, which ends archived and inert with them on it.
 */

import { test, expect, type APIRequestContext, type Locator, type Page } from "@playwright/test";
import { z } from "zod";
import {
  ADMIN,
  ensureAdminExists,
  ensureMemberInert,
  onboardActivatedMember,
  signInAs,
  type OnboardedMember,
} from "./helpers.js";

/** Per-run contracts carry this prefix, so a crashed earlier run's
 * leftovers can be swept before the journey starts. */
const CONTRACT_PREFIX = "E2E M9 Helix supply agreement";

/** The two people the demo needs: the lawyer who says both things, and
 * the second audience who must hear only one of them. */
const LAWYER_NAME = "Priya Counsel";
const CONTRIBUTOR_NAME = "Rowan Contributor";

/** What is said at each tier. The Legal Only line is the one the
 * Contributor must find no trace of, so it is distinctive enough that a
 * substring search for it cannot match anything else on the page. */
const LEGAL_ONLY_COMMENT = "Hold the 1x liability cap; their redline is a negotiating position.";
const FULL_THREAD_COMMENT = "Their signatory is confirmed for Friday.";

/** Only what the sweep reads: the title it matches on and the reference
 * it archives by. */
const ContractRows = z.object({
  contracts: z.array(z.object({ number: z.number().int(), title: z.string() })),
});

const ActivityEntries = z.object({
  entries: z.array(
    z.object({
      action: z.string(),
      visibility: z.string(),
      payload: z.record(z.string(), z.unknown()),
    }),
  ),
  nextCursor: z.string().nullable(),
});

async function listContracts(request: APIRequestContext) {
  const listed = await request.get("/api/v1/contracts");
  expect(listed.ok()).toBe(true);
  return ContractRows.parse(await listed.json()).contracts;
}

/** Archives every live per-run contract — the resting state a contract
 * has (TECH-018 cleanup; there is no hard delete). The default list
 * leaves archived rows out, so nothing here is archived twice. */
async function ensureDemoContractsInert(request: APIRequestContext) {
  for (const row of (await listContracts(request)).filter((contract) =>
    contract.title.startsWith(CONTRACT_PREFIX),
  )) {
    const archived = await request.post(`/api/v1/contracts/${row.number}/archive`);
    expect(archived.ok()).toBe(true);
  }
}

/**
 * Creates a per-run contract on a seed type that demands no fields, and
 * answers the two references the journey needs: the CTR-003 number the
 * record page is addressed by, and the id the two applets are keyed by.
 * The demo is about the conversation and the feed, so the record needs
 * no custom field of its own — M8's spec is where the create dialog and
 * its hard-required field are proved.
 */
async function createDemoContract(
  request: APIRequestContext,
  title: string,
): Promise<{ id: string; number: number }> {
  const options = await request.get("/api/v1/contracts/options");
  expect(options.ok()).toBe(true);
  const bare = z
    .object({
      contractTypes: z.array(
        z.object({ id: z.string(), fields: z.array(z.object({ isRequired: z.boolean() })) }),
      ),
    })
    .parse(await options.json())
    .contractTypes.find((type) => type.fields.every((field) => !field.isRequired));
  expect(bare, "no contract type without a hard-required field is configured").toBeDefined();

  const created = await request.post("/api/v1/contracts", {
    data: { title, contractTypeId: bare!.id },
  });
  expect(created.status(), await created.text()).toBe(201);
  return z
    .object({ contract: z.object({ id: z.string(), number: z.number().int() }) })
    .parse(await created.json()).contract;
}

/** One person's id by email, read from the Administrator-only user
 * list — the id every team route is addressed by. */
async function userIdOf(request: APIRequestContext, email: string): Promise<string> {
  const listed = await request.get("/api/v1/users");
  expect(listed.ok()).toBe(true);
  const found = z
    .object({ users: z.array(z.object({ id: z.string(), email: z.string() })) })
    .parse(await listed.json())
    .users.find((user) => user.email === email);
  expect(found, `no user is registered under ${email}`).toBeDefined();
  return found!.id;
}

/** One applet's slot on the record's activity bar (DES-016). The name
 * carries the badge count when there is one — "Comments (1)" — so the
 * slot is matched on its prefix and the count asserted separately. */
function appletSlot(page: Page, label: "Comments" | "History"): Locator {
  return page.getByRole("toolbar", { name: "Applets" }).getByRole("button", {
    name: new RegExp(`^${label}`),
  });
}

/** Expands an applet and answers its panel. */
async function openApplet(page: Page, label: "Comments" | "History"): Promise<Locator> {
  await appletSlot(page, label).click();
  const panel = page.getByRole("complementary", { name: label });
  await expect(panel).toBeVisible();
  return panel;
}

/**
 * Says one thing at one tier, through the composer.
 *
 * The tier segments are radios with visually hidden inputs inside their
 * labels (DES-023), so the gesture is a click on the segment and the
 * assertion is on the radio it checks — which is what a person does and
 * what the form records.
 */
async function postComment(page: Page, panel: Locator, tier: string, body: string) {
  // The segments live in the composer's own fieldset, which its legend
  // names "Audience" — a fieldset is a `group`, so that is what a person
  // reaches for and what the query asks for.
  const audience = panel.getByRole("group", { name: "Audience" });
  await audience.getByText(tier, { exact: true }).click();
  await expect(panel.getByRole("radio", { name: tier })).toBeChecked();
  await panel.getByLabel("New comment").fill(body);
  const posted = page.waitForResponse(
    (response) =>
      response.url().endsWith("/api/v1/comments") && response.request().method() === "POST",
  );
  await panel.getByRole("button", { name: "Comment", exact: true }).click();
  expect((await posted).status(), await (await posted).text()).toBe(201);
  // The box empties on a post and keeps what was typed on a refusal, so
  // an empty box is the one state that means the comment landed.
  await expect(panel.getByLabel("New comment")).toHaveValue("");
}

/** The rows a panel is drawing, whichever applet it is. */
function panelRows(panel: Locator, label: "Comments" | "History"): Locator {
  return panel.getByRole("list", { name: label }).getByRole("listitem");
}

test.describe.serial("M9 demo path", () => {
  test.beforeAll(async ({ request }) => {
    await ensureAdminExists(request);
  });

  test("post at two tiers, edit a field, and read the feed — and a Contributor hears only one of them", async ({
    page,
    browser,
  }) => {
    await signInAs(page, ADMIN.email, ADMIN.password, ADMIN.displayName);

    // Known starting state on the never-reset instance (TECH-018): a
    // crashed earlier run may have left per-run rows behind.
    await ensureDemoContractsInert(page.request);

    const stamp = Date.now();
    const lawyerEmail = `e2e-m9-lawyer-${stamp}@e2e.example`;
    const contributorEmail = `e2e-m9-contributor-${stamp}@e2e.example`;
    let lawyer: OnboardedMember | undefined;
    let contributor: OnboardedMember | undefined;

    try {
      lawyer = await onboardActivatedMember(page.request, browser, {
        email: lawyerEmail,
        displayName: LAWYER_NAME,
        role: "legal_team_member",
        password: "their-own-e2e-password",
      });
      contributor = await onboardActivatedMember(page.request, browser, {
        email: contributorEmail,
        displayName: CONTRIBUTOR_NAME,
        role: "contributor",
        password: "their-own-e2e-password",
      });
      const lawyerPage = lawyer.page;
      const contributorPage = contributor.page;

      const title = `${CONTRACT_PREFIX} ${stamp}`;
      const contract = await createDemoContract(page.request, title);
      // The second audience: a Contributor on this contract's team is
      // what a Legal Only comment has to exclude (CTR-021, DD-016).
      const joined = await page.request.post(`/api/v1/contracts/${contract.number}/team`, {
        data: { userId: await userIdOf(page.request, contributorEmail), role: "contributor" },
      });
      expect(joined.status(), await joined.text()).toBe(201);

      // ---- The demo sentence, as the Legal Team Member ----

      await lawyerPage.goto(`/contracts/${contract.number}`);
      await expect(lawyerPage.getByRole("heading", { level: 1, name: title })).toBeVisible();

      // The chat applet joins the settings deep-link in the record's
      // activity bar (DES-016) — the slot M8 drew empty.
      const thread = await openApplet(lawyerPage, "Comments");
      await expect(thread.getByText("Nothing has been said about this record yet.")).toBeVisible();

      // Both tiers, from the three-segment composer. Working team is
      // what a record page opens on (DD-016), so each of these is a
      // deliberate move off the preset.
      await postComment(lawyerPage, thread, "Legal only", LEGAL_ONLY_COMMENT);
      await postComment(lawyerPage, thread, "Full thread", FULL_THREAD_COMMENT);

      // The author hears both, and each row wears the room it was said
      // in (CMT-003).
      const saidRows = panelRows(thread, "Comments");
      await expect(saidRows).toHaveCount(2);
      await expect(saidRows.nth(0)).toContainText(LEGAL_ONLY_COMMENT);
      await expect(saidRows.nth(0)).toContainText("Legal only");
      await expect(saidRows.nth(1)).toContainText(FULL_THREAD_COMMENT);
      await expect(saidRows.nth(1)).toContainText("Full thread");

      // A field edit on the record, committed on its own (DES-017).
      const renamed = `${title} — countersigned`;
      const patched = lawyerPage.waitForResponse(
        (response) =>
          /\/api\/v1\/contracts\/\d+$/.test(response.url()) &&
          response.request().method() === "PATCH",
      );
      await lawyerPage.getByLabel("Title").fill(renamed);
      await lawyerPage.getByLabel("Title").press("Enter");
      expect((await patched).ok()).toBe(true);

      // And the history applet reads it back as a sentence, with what
      // the value was and what it became (DES-026).
      await thread.getByRole("button", { name: "Close" }).click();
      const history = await openApplet(lawyerPage, "History");
      const edit = panelRows(history, "History").filter({ hasText: "changed Title" });
      await expect(edit).toHaveCount(1);
      await expect(edit).toContainText(LAWYER_NAME);
      await expect(edit).toContainText(`${title} → ${renamed}`);
      // The conversation is part of the record's narrative too (DD-017):
      // one entry per comment, and no comment text in either of them
      // (CMT-006).
      const commented = panelRows(history, "History").filter({
        hasText: `${LAWYER_NAME} commented`,
      });
      await expect(commented).toHaveCount(2);
      await expect(history.getByText(LEGAL_ONLY_COMMENT)).toHaveCount(0);

      // Behind the screen: the field edit rides Working team, which is
      // what a record action is written at, and each comment entry
      // rides its own comment's tier.
      const lawyerFeed = ActivityEntries.parse(
        await (
          await lawyerPage.request.get(
            `/api/v1/activity?entityType=contract&entityId=${contract.id}`,
          )
        ).json(),
      ).entries;
      const fieldEdit = lawyerFeed.find((entry) => entry.action === "contract.updated");
      expect(fieldEdit, "the field edit is missing from the feed").toBeDefined();
      expect(fieldEdit!.visibility).toBe("working_team");
      expect(
        lawyerFeed
          .filter((entry) => entry.action === "comment.posted")
          .map((entry) => entry.visibility)
          .sort(),
      ).toEqual(["full_thread", "legal_only"]);

      // ---- The second audience: the Legal Only comment leaves no trace ----

      await contributorPage.goto(`/contracts/${contract.number}`);
      await expect(contributorPage.getByRole("heading", { level: 1, name: renamed })).toBeVisible();

      // Not in the badge. The count is taken over the same filtered set
      // the thread is read at (CMT-009), so it counts the one comment
      // this reader is in the room for and never the two that exist.
      // Read before the panel opens, because opening it marks the
      // thread read.
      await expect(appletSlot(contributorPage, "Comments")).toHaveAccessibleName("Comments (1)");

      // Not in the thread. One row, no placeholder, no gap, and a
      // header count that counts what is on screen.
      const theirThread = await openApplet(contributorPage, "Comments");
      const heardRows = panelRows(theirThread, "Comments");
      await expect(heardRows).toHaveCount(1);
      await expect(heardRows.nth(0)).toContainText(FULL_THREAD_COMMENT);
      await expect(theirThread.getByText(LEGAL_ONLY_COMMENT)).toHaveCount(0);
      await expect(theirThread.getByText("Legal only")).toHaveCount(0);
      // And no room they are not in is on offer to post into: the
      // composer has two segments, not three.
      await expect(theirThread.getByRole("radio", { name: "Legal only" })).toHaveCount(0);
      await expect(theirThread.getByRole("radio", { name: "Working team" })).toBeChecked();

      // Not in the feed. The field edit and the Full Thread comment are
      // both there, so the missing entry is the predicate at work and
      // not an empty panel.
      await theirThread.getByRole("button", { name: "Close" }).click();
      const theirHistory = await openApplet(contributorPage, "History");
      await expect(
        panelRows(theirHistory, "History").filter({ hasText: "changed Title" }),
      ).toHaveCount(1);
      await expect(
        panelRows(theirHistory, "History").filter({ hasText: `${LAWYER_NAME} commented` }),
      ).toHaveCount(1);
      await expect(theirHistory.getByText(LEGAL_ONLY_COMMENT)).toHaveCount(0);

      // And the same three answers from the seam, because the filtering
      // is the seam's and not the screen's (DD-016, DD-017).
      const theirThreadRead = await contributorPage.request.get(
        `/api/v1/comments?entityType=contract&entityId=${contract.id}`,
      );
      expect(theirThreadRead.ok()).toBe(true);
      const heard = z
        .object({ comments: z.array(z.object({ body: z.string(), visibility: z.string() })) })
        .parse(await theirThreadRead.json()).comments;
      expect(heard.map((row) => row.visibility)).toEqual(["full_thread"]);
      expect(heard.map((row) => row.body)).toEqual([FULL_THREAD_COMMENT]);

      const theirFeed = ActivityEntries.parse(
        await (
          await contributorPage.request.get(
            `/api/v1/activity?entityType=contract&entityId=${contract.id}`,
          )
        ).json(),
      ).entries;
      expect(theirFeed.some((entry) => entry.action === "contract.updated")).toBe(true);
      expect(theirFeed.filter((entry) => entry.action === "comment.posted").length).toBe(1);
      expect(theirFeed.every((entry) => entry.visibility !== "legal_only")).toBe(true);
      // No payload carries comment text on either side of the tier
      // line (CMT-006), so nothing could leak through the feed even if
      // the tier filter were wrong.
      expect(JSON.stringify(theirFeed)).not.toContain(LEGAL_ONLY_COMMENT);

      // The seam refuses the room outright, whatever a client sends —
      // the absent segment is a courtesy, not the enforcement.
      const refused = await contributorPage.request.post("/api/v1/comments", {
        data: {
          entityType: "contract",
          entityId: contract.id,
          body: "Into a room I am not in.",
          visibility: "legal_only",
          mentions: [],
        },
      });
      expect(refused.status(), "posting Legal Only must be refused for a Contributor").toBe(403);
    } finally {
      // Leave the shared instance as the run found it (TECH-018): the
      // per-run contract archived with its conversation on it, and both
      // per-run people archived (an activated user has no hard delete).
      await ensureDemoContractsInert(page.request);
      await lawyer?.context.close();
      await contributor?.context.close();
      await ensureMemberInert(page.request, lawyerEmail);
      await ensureMemberInert(page.request, contributorEmail);
    }
  });

  test("the Administrator's audit log reads the same table, and its export is itself an entry (DD-017)", async ({
    page,
  }) => {
    await signInAs(page, ADMIN.email, ADMIN.password, ADMIN.displayName);

    // The audit log is the Security group's second pane, beside
    // Authentication (SET-002) — reached the way an Administrator
    // reaches it, so the placement is proved and not assumed.
    await page.goto("/settings/general");
    const rail = page.getByRole("navigation", { name: "Settings sections" });
    await rail.getByRole("button", { name: "Security" }).click();
    await rail.getByRole("link", { name: "Audit log" }).click();
    await expect(page).toHaveURL(/\/settings\/audit-log$/);
    await expect(page).toHaveTitle("Audit log · OpenLaw");

    // The header row plus at least one entry: the journeys above this
    // one administered the instance, so the log is never empty here.
    await expect(page.getByRole("row").nth(1)).toBeVisible();

    // Data leaving the system is itself a security event, so the export
    // lands in the log it exported (DD-017). The control is a link
    // because the response streams.
    const download = page.waitForEvent("download");
    await page.getByRole("link", { name: "Export CSV" }).click();
    expect((await download).suggestedFilename()).toMatch(/\.csv$/);

    const exported = await page.request.get("/api/v1/audit-log?action=export.performed");
    expect(exported.ok()).toBe(true);
    const entries = z
      .object({ entries: z.array(z.object({ action: z.string(), visibility: z.string() })) })
      .parse(await exported.json()).entries;
    expect(entries.length, "the export must be recorded in the log it exported").toBeGreaterThan(0);
    // Never a record feed's business: the log is the only surface that
    // reads `admin_only`.
    expect(entries[0]!.visibility).toBe("admin_only");
  });
});
