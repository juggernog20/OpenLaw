// SPDX-License-Identifier: AGPL-3.0-only

/**
 * M10 milestone acceptance (#150): the demo, end to end.
 *
 * Mark a contract confidential; a Legal Team Member who isn't on it
 * can't see it in the list, in search, or anywhere else — with no
 * placeholder revealing that it exists.
 *
 * The viewer this milestone is about is new (DD-014, CTR-021). Until
 * M10 a Legal Team Member read every contract in the company, and the
 * flag is the one thing that takes a record away from them. So the
 * journey walks two people through the same record:
 *
 * - The **included** side is the contract's creator, who is therefore
 *   one of the three actors who may decide the audience (CTR-022). They
 *   flip the switch on the record, and the three DES-009 affordances
 *   answer: the Tier 2 banner on the record page, the Tier 1 marker
 *   beside the title in the list, and the Tier 3 notice at the comment
 *   composer.
 * - The **excluded** side is a Legal Team Member with no team row and no
 *   Owner claim. The record leaves their world entirely: no row, no
 *   count, and a record URL that draws exactly the page a contract
 *   nobody ever made draws — compared character for character, because
 *   "no placeholder" is the acceptance criterion and a difference of one
 *   word would be the leak.
 *
 * The demo sentence says "in search". No search exists yet, so this
 * spec proves the leg the product can prove today: the header search
 * chip stays inert — it takes the `/` binding and the typing, and
 * nothing answers — while the list, the count, and the record URL carry
 * the proof. M25 builds search against this same gate and inherits the
 * obligation.
 *
 * Every "nothing here" assertion is made twice, on the M9 spec's rule:
 * once on what the excluded viewer's screen draws, and once on what the
 * seam answers them. The gate is a query-time predicate, so the seam is
 * where it lives; a screen that merely hides a row would pass the first
 * check and fail the second.
 *
 * The accessibility sweep the milestone owes runs over the two surfaces
 * M10 added to the chrome — the banner and the marker's own list row.
 * Those two scans are asserted rather than reported: they are this
 * milestone's own surfaces, so a violation in them is this milestone's
 * to fix. The whole-page scans around them stay advisory, as the
 * accessibility floor spec (#48) reports them.
 *
 * The never-reset instance (TECH-018) is left as the run found it, on
 * the M8 and M9 specs' conventions: per-run rows carry this spec's own
 * prefix, are swept before the journey starts, and end archived, which
 * is the resting state a contract has because it has no hard delete.
 * The two per-run people end archived too.
 */

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

/** Per-run contracts carry this prefix, so a crashed earlier run's
 * leftovers can be swept before the journey starts. It is this spec's
 * own: the demo specs sweep their own rows and must not reach into each
 * other's. */
const CONTRACT_PREFIX = "E2E M10 Meridian acquisition";

/** The two people the demo needs, both Legal Team Members. Until the
 * flag is set they read the same company; the flag is what separates
 * them. */
const CREATOR_NAME = "Priya Counsel";
const OUTSIDER_NAME = "Otto Outsider";

/** What is said inside the wall. The excluded viewer must find no trace
 * of it, so it is distinctive enough that a substring search for it
 * cannot match anything else. */
const INSIDE_COMMENT = "The board paper lands Thursday; hold it off the shared drive.";

/** A contract reference nothing was ever created under. The excluded
 * viewer's answers at the walled record are compared against this one,
 * on every surface, and the two must be one answer. */
const MISSING_NUMBER = 999_999;
/** An entity id that names nothing — the same comparison for the four
 * side doors, which are addressed by id rather than by reference. */
const MISSING_ID = "00000000-0000-7000-8000-000000000000";

/** DES-009's copy, as DES-028 and DES-029 settled it. Asserted as
 * literals: a reminder that misstates who can see the record is worse
 * than none, so the words are part of the acceptance. */
const BANNER_COPY =
  "Confidential contract — the contract team, the Owner, and Administrators see it.";
const COMPOSER_NOTICE =
  "Confidential contract — whichever audience you pick, only the contract team, the Owner, and Administrators can read it.";
const FLAG_LABEL = "Confidential — restrict to the contract team";

/** Only what the sweep reads: the title it matches on and the reference
 * it archives by. */
const ContractRows = z.object({
  contracts: z.array(z.object({ number: z.number().int(), title: z.string() })),
});

const ActivityEntries = z.object({
  entries: z.array(z.object({ action: z.string(), visibility: z.string() })),
});

async function listContracts(request: APIRequestContext) {
  const listed = await request.get("/api/v1/contracts");
  expect(listed.ok()).toBe(true);
  return ContractRows.parse(await listed.json()).contracts;
}

/** Archives every live per-run contract — the resting state a contract
 * has (TECH-018 cleanup; there is no hard delete). The default list
 * leaves archived rows out, so nothing here is archived twice. The
 * Administrator runs it, and an Administrator reaches every contract
 * confidential or not (DD-014), so the flag never strands a row. */
async function ensureDemoContractsInert(request: APIRequestContext) {
  for (const row of (await listContracts(request)).filter((contract) =>
    contract.title.startsWith(CONTRACT_PREFIX),
  )) {
    const archived = await request.post(`/api/v1/contracts/${row.number}/archive`);
    expect(archived.ok()).toBe(true);
  }
}

/** A seed contract type that demands no field, named as the create
 * dialog names it. The demo is about the audience, not about the field
 * catalog — M8's spec is where the dialog's hard-required field is
 * proved. */
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

/** The contracts list's own count, from the sub-bar summary line. The
 * excluded viewer's copy of this number is the one DD-014 cares about:
 * a total that still counted the walled record would leak what the list
 * hides. */
async function listedCount(page: Page): Promise<number> {
  const summary = page.getByRole("region", { name: "Contracts" }).getByText(/^[\d,]+ contracts?$/);
  await expect(summary).toBeVisible();
  return Number((await summary.innerText()).replace(/[^\d]/g, ""));
}

/** One applet's slot on the record's activity bar (DES-016). */
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

/** The rows a panel is drawing, whichever applet it is. */
function panelRows(panel: Locator, label: "Comments" | "History"): Locator {
  return panel.getByRole("list", { name: label }).getByRole("listitem");
}

/**
 * DES-009's Tier 1 micro-marker inside a panel row: the lock alone, in
 * the confidential foreground token, beside the timestamp. It is
 * decorative by decision (DES-029 point 5) — the banner above already
 * names the restriction out loud — so it is matched on the token that
 * carries its meaning rather than on an accessible name it must not
 * have.
 */
function microMarkers(row: Locator): Locator {
  return row.locator("svg.text-confidential");
}

/** The problem document minus the one field two different requests are
 * entitled to differ on: `instance` is the URL the client itself asked
 * for, so the reference in it came from the client, not from us. */
function withoutInstance(body: unknown): Record<string, unknown> {
  return { ...(body as Record<string, unknown>), instance: undefined };
}

test.describe.serial("M10 demo path", () => {
  test.beforeAll(async ({ request }) => {
    await ensureAdminExists(request);
  });

  test("mark a contract confidential, and it leaves an excluded Legal Team Member's world entirely", async ({
    page,
    browser,
  }, testInfo) => {
    await signInAs(page, ADMIN.email, ADMIN.password, ADMIN.displayName);

    // Known starting state on the never-reset instance (TECH-018): a
    // crashed earlier run may have left per-run rows behind.
    await ensureDemoContractsInert(page.request);
    const typeName = await bareContractTypeName(page.request);

    const stamp = Date.now();
    const creatorEmail = `e2e-m10-creator-${stamp}@e2e.example`;
    const outsiderEmail = `e2e-m10-outsider-${stamp}@e2e.example`;
    const title = `${CONTRACT_PREFIX} ${stamp}`;
    let creator: OnboardedMember | undefined;
    let outsider: OnboardedMember | undefined;

    /**
     * Leaves the shared instance as the run found it (TECH-018): the
     * per-run contract archived with its conversation on it, and both
     * per-run people archived (an activated user has no hard delete).
     */
    const leaveInert = async () => {
      await creator?.context.close();
      await outsider?.context.close();
      await ensureDemoContractsInert(page.request);
      await ensureMemberInert(page.request, creatorEmail);
      await ensureMemberInert(page.request, outsiderEmail);
    };

    try {
      creator = await onboardActivatedMember(page.request, browser, {
        email: creatorEmail,
        displayName: CREATOR_NAME,
        role: "legal_team_member",
        password: "their-own-e2e-password",
      });
      outsider = await onboardActivatedMember(page.request, browser, {
        email: outsiderEmail,
        displayName: OUTSIDER_NAME,
        role: "legal_team_member",
        password: "their-own-e2e-password",
      });
      const creatorPage = creator.page;
      const outsiderPage = outsider.page;

      // ---- The record is made, in the open ----

      await creatorPage.goto("/contracts");
      await creatorPage.getByRole("button", { name: "Create contract" }).first().click();
      const dialog = creatorPage.getByRole("dialog");
      await dialog.getByLabel("Title").fill(title);
      await dialog.getByLabel("Contract type").selectOption({ label: typeName });
      // The flag can be set here too, so a record that must be walled
      // off is never visible to the wrong audience even briefly
      // (CTR-022). This demo leaves it off on purpose: the excluded
      // viewer has to see the contract first, or their later blindness
      // proves nothing.
      await expect(dialog.getByRole("switch", { name: FLAG_LABEL })).not.toBeChecked();
      const created = creatorPage.waitForResponse(
        (response) =>
          response.url().endsWith("/api/v1/contracts") && response.request().method() === "POST",
      );
      await dialog.getByRole("button", { name: "Create", exact: true }).click();
      const contract = z
        .object({ contract: z.object({ id: z.string(), number: z.number().int() }) })
        .parse(await (await created).json()).contract;
      await expect(dialog).toBeHidden();

      // The excluded viewer reads every contract in the company until
      // the flag is set (CTR-021), so the row and the count are theirs
      // right now. This is the before half of the demo: without it, an
      // empty list later would prove nothing.
      await outsiderPage.goto("/contracts");
      const outsiderRow = outsiderPage.getByRole("row").filter({ hasText: title });
      await expect(outsiderRow).toBeVisible();
      const countBefore = await listedCount(outsiderPage);

      // ---- The flag goes on, from the record page ----

      await creatorPage.goto(`/contracts/${contract.number}`);
      await expect(creatorPage.getByRole("heading", { level: 1, name: title })).toBeVisible();
      // Nothing says "confidential" yet: the banner is drawn by the
      // record's own saved flag, not by the page.
      await expect(creatorPage.getByRole("region", { name: "Confidential contract" })).toHaveCount(
        0,
      );

      // The flag is a field of the record and commits on its own switch
      // (DES-017, DES-028), so the gesture is one flip and the proof is
      // the PATCH it fires.
      const flagged = creatorPage.waitForResponse(
        (response) =>
          /\/api\/v1\/contracts\/\d+$/.test(response.url()) &&
          response.request().method() === "PATCH",
      );
      await creatorPage.getByRole("switch", { name: FLAG_LABEL }).click();
      expect((await flagged).ok(), await (await flagged).text()).toBe(true);
      await expect(creatorPage.getByText("Saved", { exact: true })).toBeVisible();

      // ---- Tier 2: the banner, for the viewers who are inside ----

      const banner = creatorPage.getByRole("region", { name: "Confidential contract" });
      await expect(banner).toBeVisible();
      await expect(banner).toContainText(BANNER_COPY);
      // "Manage team" is offered to the three actors only, and this
      // viewer is the creator. It is a fragment that opens the Team
      // applet, because that is where the audience is changed.
      const manageTeam = banner.getByRole("link", { name: "Manage team" });
      await expect(manageTeam).toHaveAttribute("href", "#contract-team");
      await manageTeam.click();
      await expect(creatorPage.getByRole("complementary", { name: "Team" })).toBeInViewport();
      // Chrome, not a notification: there is no way to close it
      // (DD-014, DES-028).
      await expect(banner.getByRole("button")).toHaveCount(0);

      // The two surfaces M10 added to the chrome, scanned and asserted
      // rather than reported: they are this milestone's own, so a
      // finding in them is this milestone's to fix. The page around
      // them is reported the way the accessibility floor spec reports
      // every page (#48, DES-011).
      expect(
        await reportAxeViolations(creatorPage, testInfo, "m10-banner", {
          include: 'section[aria-label="Confidential contract"]',
        }),
      ).toEqual([]);
      await reportAxeViolations(creatorPage, testInfo, "m10-record");

      // ---- Tier 3: the composer says so at the moment of action ----

      const thread = await openApplet(creatorPage, "Comments");
      await expect(thread.getByText(COMPOSER_NOTICE)).toBeVisible();
      await thread.getByLabel("New comment").fill(INSIDE_COMMENT);
      const posted = creatorPage.waitForResponse(
        (response) =>
          response.url().endsWith("/api/v1/comments") && response.request().method() === "POST",
      );
      await thread.getByRole("button", { name: "Comment", exact: true }).click();
      expect((await posted).status(), await (await posted).text()).toBe(201);
      await expect(thread.getByLabel("New comment")).toHaveValue("");

      // Every row inside a confidential record wears the micro-marker,
      // so a copied snippet visually carries its restriction (DES-029).
      const saidRow = panelRows(thread, "Comments").filter({ hasText: INSIDE_COMMENT });
      await expect(saidRow).toHaveCount(1);
      await expect(microMarkers(saidRow)).toHaveCount(1);

      // The record's own history narrates the walling-off, so the feed
      // explains the record's visibility (CTR-022, DD-017) — and its
      // entries carry the marker too.
      await thread.getByRole("button", { name: "Close" }).click();
      const history = await openApplet(creatorPage, "History");
      const walling = panelRows(history, "History").filter({
        hasText: `${CREATOR_NAME} marked this contract confidential`,
      });
      await expect(walling).toHaveCount(1);
      await expect(microMarkers(walling)).toHaveCount(1);

      // ---- Tier 1: the marker in the list, for the same viewer ----

      await creatorPage.goto("/contracts");
      const creatorRow = creatorPage.getByRole("row").filter({ hasText: title });
      await expect(creatorRow).toBeVisible();
      // The lock and the drawn abbreviation, under the accessible name
      // that is the whole word (DES-029 points 1 and 5).
      await expect(creatorRow.getByRole("img", { name: "Confidential" })).toBeVisible();
      await expect(creatorRow).toContainText("CONFI");
      expect(
        await reportAxeViolations(creatorPage, testInfo, "m10-marker", { include: "table" }),
      ).toEqual([]);
      await reportAxeViolations(creatorPage, testInfo, "m10-list");

      // ---- The excluded viewer: no row, no count, no record ----

      await outsiderPage.goto("/contracts");
      await expect(outsiderPage.getByRole("row").filter({ hasText: title })).toHaveCount(0);
      await expect(outsiderPage.getByText(title)).toHaveCount(0);
      // Numbers do not leak what lists hide: exactly one contract left
      // their world, and nothing else changed in between.
      expect(await listedCount(outsiderPage)).toBe(countBefore - 1);

      // The demo sentence's search leg, as far as the product goes
      // today: the chip takes the `/` binding (DES-010) and takes the
      // typing, and nothing answers. M25 builds search against this
      // same gate.
      await outsiderPage.keyboard.press("/");
      const search = outsiderPage.getByRole("banner").getByRole("searchbox", { name: "Search" });
      await expect(search).toBeFocused();
      await search.fill(title);
      await expect(search).toHaveValue(title);
      await expect(outsiderPage).toHaveURL(/\/contracts$/);
      await expect(outsiderPage.getByRole("listbox")).toHaveCount(0);
      await expect(outsiderPage.getByRole("dialog")).toHaveCount(0);
      await expect(outsiderPage.getByText(title)).toHaveCount(0);

      // The record URL answers exactly the page a contract nobody ever
      // made answers — compared character for character, because "no
      // placeholder revealing that it exists" is the acceptance and one
      // different word would be the leak.
      await outsiderPage.goto(`/contracts/${contract.number}`);
      await expect(outsiderPage).toHaveTitle("Something went wrong · OpenLaw");
      const walledOff = await outsiderPage.locator("body").innerText();
      await outsiderPage.goto(`/contracts/${MISSING_NUMBER}`);
      await expect(outsiderPage).toHaveTitle("Something went wrong · OpenLaw");
      expect(await outsiderPage.locator("body").innerText()).toBe(walledOff);
      expect(walledOff).not.toContain(title);
      expect(walledOff).not.toContain(String(contract.number));
      expect(walledOff.toLowerCase()).not.toContain("confidential");

      // ---- And the same answers from the seam ----
      //
      // The gate is a query-time predicate (DD-014, CTR-021), so the
      // seam is where it lives. A screen that merely hid a row would
      // pass every check above and fail every one below.

      const numbers = (await listContracts(outsiderPage.request)).map((row) => row.number);
      expect(numbers).not.toContain(contract.number);

      const walledRead = await outsiderPage.request.get(`/api/v1/contracts/${contract.number}`);
      const absentRead = await outsiderPage.request.get(`/api/v1/contracts/${MISSING_NUMBER}`);
      expect(walledRead.status(), await walledRead.text()).toBe(404);
      // The control is only a control while nothing stands under that
      // reference — said out loud, so a sequence that ever reached it
      // fails here rather than somewhere confusing.
      expect(absentRead.status(), `C-${MISSING_NUMBER} must name no contract`).toBe(404);
      expect(walledRead.headers()["content-type"]).toContain("application/problem+json");
      expect(withoutInstance(await walledRead.json())).toEqual(
        withoutInstance(await absentRead.json()),
      );

      // The side doors say the same thing as the front one: comments,
      // the unread badge, the mention typeahead, and the activity feed
      // each answer as for a record that is not there.
      const doors = [
        "/api/v1/comments",
        "/api/v1/comments/unread",
        "/api/v1/comments/mention-candidates",
        "/api/v1/activity",
      ] as const;
      for (const door of doors) {
        const refused = await outsiderPage.request.get(
          `${door}?entityType=contract&entityId=${contract.id}`,
        );
        const absent = await outsiderPage.request.get(
          `${door}?entityType=contract&entityId=${MISSING_ID}`,
        );
        expect(refused.status(), `${door}: ${await refused.text()}`).toBe(404);
        expect(withoutInstance(await refused.json()), door).toEqual(
          withoutInstance(await absent.json()),
        );
        // Not the text, not an id, and no count of what was withheld.
        const answer = JSON.stringify(withoutInstance(await refused.json()));
        expect(answer, door).not.toContain(INSIDE_COMMENT);
        expect(answer, door).not.toContain(contract.id);
      }

      // A write leaks no more than a read: the per-field patch is
      // refused as against a record that does not exist, not as a
      // permission (M10/3).
      const walledWrite = await outsiderPage.request.patch(`/api/v1/contracts/${contract.number}`, {
        data: { title: "Renamed from outside the wall" },
      });
      const absentWrite = await outsiderPage.request.patch(`/api/v1/contracts/${MISSING_NUMBER}`, {
        data: { title: "Renamed from outside the wall" },
      });
      expect(walledWrite.status(), await walledWrite.text()).toBe(404);
      expect(withoutInstance(await walledWrite.json())).toEqual(
        withoutInstance(await absentWrite.json()),
      );

      // ---- The flag gates the audience, not the work ----
      //
      // The included viewer's own answers are untouched, so every
      // absence above is the predicate at work and not a broken record.

      const held = await creatorPage.request.get(`/api/v1/contracts/${contract.number}`);
      expect(held.status(), await held.text()).toBe(200);
      expect(
        z.object({ contract: z.object({ isConfidential: z.boolean() }) }).parse(await held.json())
          .contract.isConfidential,
      ).toBe(true);
      const feed = ActivityEntries.parse(
        await (
          await creatorPage.request.get(
            `/api/v1/activity?entityType=contract&entityId=${contract.id}`,
          )
        ).json(),
      ).entries;
      const walled = feed.find((entry) => entry.action === "contract.confidentiality_set");
      expect(walled, "the walling-off is missing from the record's own feed").toBeDefined();
      // A record action, at the record-action tier (DD-017) — which is
      // also what puts it in the Administrator-only audit log.
      expect(walled!.visibility).toBe("working_team");
    } catch (error) {
      // A cleanup that throws here would replace the failure that caused
      // it, and the failure is the one worth reading.
      await sweepOrSay("M10 demo", leaveInert);
      throw error;
    }
    // The journey passed, so a cleanup that fails is a failure of its
    // own: it leaves the shared instance dirty for the next run.
    await leaveInert();
  });
});
