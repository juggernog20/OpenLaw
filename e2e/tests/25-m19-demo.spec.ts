// SPDX-License-Identifier: AGPL-3.0-only

/**
 * M19 milestone acceptance (#357): the demo, end to end, in one browser
 * session.
 *
 * An Administrator builds an "NDA" request form targeting the NDA
 * contract type, attaches two catalog fields, and adds a deflection link
 * above it — #350's demo sentence, run through the real screens.
 *
 * The journey is the whole front door being configured. The rail's
 * **Intake** section opens on Request types (ST12), where the three
 * seeded rows already read their targets — `Contract · NDA`, `Contract`,
 * and `No target` — which is the three-state model (INT-002 addendum)
 * drawn as a fact. A new request type is added from the inline draft row,
 * pointed at the NDA contract type in its editor (ST14), given two
 * catalog fields from the M6 catalog, and one of them is marked required
 * **on this form** — the per-attachment flag that makes a form definition
 * more than a list. Then a deflection link is placed on that request type
 * from the Deflection links pane (ST13), and the browser is reloaded so
 * every one of those facts is read back from the database rather than
 * from a screen that never re-rendered.
 *
 * **The scope rule is proved, not assumed.** The four basics stay locked
 * and unattachable, and re-pointing a form whose fields the new target
 * would not admit is refused by name rather than detached quietly —
 * CTR-016's scope rule applied one level out, and SET-003's house style
 * applied to it.
 *
 * The second journey is SET-002 from the intake side: a Legal Team
 * Member's settings rail carries no Intake section, its three URLs
 * bounce, and the API's 403 stands behind the bounce.
 *
 * The seed sweep at the top proves the M19 migrations (0056–0058) landed
 * on the running stack — the `docker compose up` acceptance, asserted
 * from inside the demo.
 *
 * Everything per-run ends deleted, so the never-reset instance
 * (TECH-018) stays clean. A request type is hard-deletable — this mount
 * has no system-protected row — and deleting one takes its form
 * definition and any link placed on it with it.
 */

import { test, expect, type APIRequestContext, type Page } from "@playwright/test";
import { z } from "zod";
import {
  ADMIN,
  ensureAdminExists,
  ensureMemberInert,
  onboardActivatedMember,
  signInAs,
  sweepOrSay,
  type OnboardedMember,
} from "./helpers.js";

/**
 * Generous timeout: a settings journey across three panes and an editor,
 * every write waited on at the seam, and a reload that re-reads all of
 * it.
 */
test.setTimeout(180_000);

/** Per-run rows carry these prefixes, so a crashed earlier run's
 * leftovers can be swept before the journey starts. */
const TYPE_PREFIX = "E2E M19 NDA form";
const LINK_PREFIX = "E2E M19 NDA FAQ";

/** The seeded contract type this milestone's demo points at (CTR-002). */
const TARGET_TYPE_SLUG = "nda";

/** The two catalog fields the form collects (the M6 seed, CTR-016). Both
 * are contract-scoped, which is what the Contract target admits. */
const FIRST_FIELD = "Governing law";
const SECOND_FIELD = "Jurisdiction";

/** Where the deflection link points. Stored as entered and rendered
 * without its scheme, as ST13 draws it (INT-004). */
const LINK_URL = "https://wiki.example.com/legal/nda-faq";
const LINK_URL_SHOWN = "wiki.example.com/legal/nda-faq";

/** One request type, as the seam answers it. */
const RequestTypeRows = z.object({
  requestTypes: z.array(
    z.object({
      id: z.string(),
      slug: z.string(),
      displayName: z.string(),
      targetModule: z.enum(["matter", "contract"]).nullable(),
      targetTypeId: z.string().nullable(),
      formFieldCount: z.number().int(),
      archivedAt: z.string().nullable(),
    }),
  ),
});

/** One deflection link, as the seam answers it. */
const IntakeLinkRows = z.object({
  intakeLinks: z.array(
    z.object({
      id: z.string(),
      label: z.string(),
      url: z.string(),
      requestTypeId: z.string().nullable(),
    }),
  ),
});

/** The contract taxonomy this demo targets. */
const ContractTypeRows = z.object({
  contractTypes: z.array(z.object({ id: z.string(), slug: z.string(), displayName: z.string() })),
});

/** One request type's form definition, as the seam answers it. */
const AttachedFields = z.object({
  attachedFields: z.array(
    z.object({ slug: z.string(), displayName: z.string(), isRequired: z.boolean() }),
  ),
});

async function listRequestTypes(request: APIRequestContext) {
  const listed = await request.get("/api/v1/request-types?includeArchived=true");
  expect(listed.status(), await listed.text()).toBe(200);
  return RequestTypeRows.parse(await listed.json()).requestTypes;
}

async function listIntakeLinks(request: APIRequestContext) {
  const listed = await request.get("/api/v1/intake-links");
  expect(listed.status(), await listed.text()).toBe(200);
  return IntakeLinkRows.parse(await listed.json()).intakeLinks;
}

async function listContractTypes(request: APIRequestContext) {
  const listed = await request.get("/api/v1/contract-types");
  expect(listed.status(), await listed.text()).toBe(200);
  return ContractTypeRows.parse(await listed.json()).contractTypes;
}

async function readForm(request: APIRequestContext, typeId: string) {
  const read = await request.get(`/api/v1/request-types/${typeId}/fields`);
  expect(read.status(), await read.text()).toBe(200);
  return AttachedFields.parse(await read.json()).attachedFields;
}

/** Removes every per-run deflection link this suite ever created — a
 * link is removed outright, never archived (INT-004). */
async function ensureDemoLinksAbsent(request: APIRequestContext) {
  for (const row of (await listIntakeLinks(request)).filter((link) =>
    link.label.startsWith(LINK_PREFIX),
  )) {
    const removed = await request.delete(`/api/v1/intake-links/${row.id}`);
    expect(removed.status(), await removed.text()).toBe(204);
  }
}

/** Hard-deletes every per-run request type this suite ever created. The
 * delete takes the form definition with it, and any deflection link
 * placed on the type goes too — a link's placement is its audience, so
 * the row cannot outlive the form it was written for. */
async function ensureDemoTypesAbsent(request: APIRequestContext) {
  for (const row of (await listRequestTypes(request)).filter((type) =>
    type.displayName.startsWith(TYPE_PREFIX),
  )) {
    const deleted = await request.delete(`/api/v1/request-types/${row.id}`);
    expect(deleted.status(), await deleted.text()).toBe(204);
  }
}

/** The row the Administrator reads on ST12's list. */
function requestTypeRow(page: Page, name: string) {
  return page.getByRole("listitem").filter({ hasText: name });
}

/**
 * One of the pane's own cells, read exactly.
 *
 * Each meta cell is one element carrying its screen-reader prefix and
 * then the value — "Target: Contract · NDA" — so matching the pair
 * exactly is what tells the module-only `Contract` from the
 * type-targeting `Contract · NDA`. A substring of the row would not.
 */
function cell(row: ReturnType<typeof requestTypeRow>, prefix: string, value: string) {
  return row.getByText(`${prefix}: ${value}`, { exact: true });
}

test.describe.serial("M19 demo path", () => {
  test.beforeAll(async ({ request }) => {
    await ensureAdminExists(request);
  });

  test("build an NDA request form on the NDA contract type, put two catalog fields on it, and deflect above it — one journey", async ({
    page,
  }) => {
    await signInAs(page, ADMIN.email, ADMIN.password, ADMIN.displayName);

    // Known starting state on the never-reset instance (TECH-018): a
    // crashed earlier run may have left per-run rows behind.
    await ensureDemoLinksAbsent(page.request);
    await ensureDemoTypesAbsent(page.request);

    // The compose-up acceptance, from inside the running stack: the M19
    // seeds (migrations 0056–0058) answer over the API, each carrying
    // one of the three target states INT-002's addendum records. Subset
    // checks — the accumulated instance holds more than the seeds.
    const seeded = await listRequestTypes(page.request);
    const seededBySlug = new Map(seeded.map((row) => [row.slug, row]));
    for (const slug of ["nda_request", "contract_review", "legal_question"]) {
      expect(seededBySlug.get(slug), `request-types is missing ${slug}`).toBeDefined();
    }
    const ndaType = (await listContractTypes(page.request)).find(
      (type) => type.slug === TARGET_TYPE_SLUG,
    );
    expect(ndaType, "the NDA contract type seed is missing").toBeDefined();
    // A type target, a module-only target, and no target at all.
    expect(seededBySlug.get("nda_request")).toMatchObject({
      targetModule: "contract",
      targetTypeId: ndaType!.id,
    });
    expect(seededBySlug.get("contract_review")).toMatchObject({
      targetModule: "contract",
      targetTypeId: null,
    });
    expect(seededBySlug.get("legal_question")).toMatchObject({
      targetModule: null,
      targetTypeId: null,
    });

    const stamp = Date.now();
    const typeName = `${TYPE_PREFIX} ${stamp}`;
    const linkLabel = `${LINK_PREFIX} ${stamp}`;

    /** Leaves the shared instance as the run found it (TECH-018). */
    const leaveInert = async () => {
      await ensureDemoLinksAbsent(page.request);
      await ensureDemoTypesAbsent(page.request);
    };

    try {
      // Into settings from its way in (SET-001), then the Organization
      // rail's Intake section — its URL forwards to the Request types
      // pane, the section's first (INT-002).
      await page.getByRole("banner").getByRole("button", { name: ADMIN.displayName }).click();
      await page.getByRole("menu").getByRole("menuitem", { name: "Settings" }).click();
      await expect(page).toHaveURL(/\/settings\/profile$/);
      const rail = page.getByRole("navigation", { name: "Settings sections" });
      await rail.getByRole("link", { name: "Intake" }).click();
      await expect(page).toHaveURL(/\/settings\/intake\/request-types$/);

      // The seeded list draws all three target states in the Target
      // column, so routing is auditable without opening an editor
      // (story 16).
      await expect(
        cell(requestTypeRow(page, "NDA request"), "Target", "Contract · NDA"),
      ).toBeVisible();
      await expect(
        cell(requestTypeRow(page, "Contract review"), "Target", "Contract"),
      ).toBeVisible();
      await expect(
        cell(requestTypeRow(page, "Legal question"), "Target", "No target"),
      ).toBeVisible();

      // Adds a request type: the inline draft row is the form
      // (DES-020) — Enter creates, immediately (SET-003).
      await page.getByRole("button", { name: "Add request type" }).click();
      const created = page.waitForResponse(
        (response) =>
          response.url().includes("/api/v1/request-types") &&
          response.request().method() === "POST",
      );
      await page.getByRole("textbox", { name: "New request type name" }).fill(typeName);
      await page.keyboard.press("Enter");
      expect((await created).ok()).toBe(true);
      await expect(page.getByRole("button", { name: `Rename ${typeName}` })).toBeVisible();

      // A brand-new type has no target and no fields yet — the row says
      // so on both new columns.
      const row = requestTypeRow(page, typeName);
      await expect(cell(row, "Target", "No target")).toBeVisible();
      await expect(cell(row, "Form fields", "0 fields")).toBeVisible();

      // Its pencil opens the type's own editor screen (DES-022), where
      // identity, target, and form live together (story 19).
      await row.getByRole("button", { name: `Edit ${typeName}` }).click();
      await expect(page).toHaveURL(/\/settings\/intake\/request-types\/[^/]+$/);
      const typeId = new URL(page.url()).pathname.split("/").pop()!;
      await expect(page.getByLabel("Display name")).toHaveValue(typeName);

      // ---- The target: the routing decision, pre-encoded ----
      //
      // One select, grouped by module, whose value carries both halves
      // of the model — the module and the optional type id.
      const targeted = page.waitForResponse(
        (response) =>
          response.url().includes(`/api/v1/request-types/${typeId}`) &&
          response.request().method() === "PATCH",
      );
      await page.getByLabel("Target").selectOption(`contract:${ndaType!.id}`);
      expect((await targeted).ok()).toBe(true);
      // The help line says what conversion will do, in the reviewer's
      // own words (INT-006: triage confirms, it does not classify).
      await expect(
        page.getByText(
          `Converting a request of this type creates a contract of the ${ndaType!.displayName} type.`,
        ),
      ).toBeVisible();

      // ---- The form: four locked basics, then the catalog ----
      //
      // The basics state what every form always collects, drawn as
      // facts rather than as choices (story 20). Urgency wears the
      // DES-018 severity ramp, which is what ST14's redrawn row reads.
      const basics = page.getByRole("list", { name: "Basics are always on the form" });
      for (const [name, caption] of [
        ["Summary", "Text"],
        ["Description", "Long text"],
        ["Attachments", "Files"],
        ["Urgency", "Low · medium · high · critical"],
      ] as const) {
        await expect(basics.getByText(caption, { exact: true })).toBeVisible();
        await expect(basics.getByRole("checkbox", { name: `${name} required` })).toBeDisabled();
      }
      // Summary, Description, and Urgency are required on every form;
      // Attachments are optional. Nobody may change any of the four.
      expect(await basics.getByRole("checkbox", { checked: true }).count()).toBe(3);

      // Attaches two catalog fields. The Attach menu offers the
      // catalog's unattached fields the target allows — contract-scoped
      // and global under a Contract target (story 22).
      for (const fieldName of [FIRST_FIELD, SECOND_FIELD]) {
        const attached = page.waitForResponse(
          (response) =>
            /\/api\/v1\/request-types\/[^/]+\/fields$/.test(response.url()) &&
            response.request().method() === "POST",
        );
        await page.getByRole("button", { name: "Attach field" }).click();
        await page.getByRole("menuitem", { name: new RegExp(fieldName) }).click();
        expect((await attached).ok()).toBe(true);
        await expect(page.getByRole("button", { name: `Detach ${fieldName}` })).toBeVisible();
      }

      // The required flag is per form, not per field: Governing law is
      // required on this form and untouched everywhere else (story 23).
      const requiredHere = page.waitForResponse(
        (response) =>
          /\/api\/v1\/request-types\/[^/]+\/fields\/[^/]+$/.test(response.url()) &&
          response.request().method() === "PATCH",
      );
      const attachedList = page.getByRole("list", { name: "Form fields" });
      await attachedList.getByRole("checkbox", { name: `${FIRST_FIELD} required` }).click();
      expect((await requiredHere).ok()).toBe(true);
      await expect(
        attachedList.getByRole("checkbox", { name: `${FIRST_FIELD} required` }),
      ).toBeChecked();

      // ---- The scope rule bites (story 18) ----
      //
      // Re-pointing this form at nothing would leave two contract-scoped
      // fields with nowhere to land, so the change is refused and the
      // refusal names them — SET-003's house style: guards refuse and
      // explain, they do not detach quietly.
      //
      // This is where the rule is visible from a browser. The offered
      // set cannot show the other half today: no matter-scoped field can
      // exist until M22 opens that scope, and the seed defines no
      // global field, so there is nothing to assert as present-or-absent
      // that the two attachments above have not already shown.
      const refused = page.waitForResponse(
        (response) =>
          response.url().includes(`/api/v1/request-types/${typeId}`) &&
          response.request().method() === "PATCH",
      );
      await page.getByLabel("Target").selectOption("");
      expect((await refused).status()).toBe(409);
      await expect(
        page.getByText(
          `${FIRST_FIELD} and ${SECOND_FIELD} do not fit that target. Detach them from the form first.`,
        ),
      ).toBeVisible();
      // Nothing moved: the control goes back to what the server still
      // holds rather than showing a pick that never landed.
      await expect(page.getByLabel("Target")).toHaveValue(`contract:${ndaType!.id}`);

      // ---- The deflection link, above the form (INT-004) ----

      await page.getByRole("link", { name: "All request types" }).click();
      await expect(page).toHaveURL(/\/settings\/intake\/request-types$/);
      const tabs = page.getByRole("navigation", { name: "Intake panes" });
      await tabs.getByRole("link", { name: "Deflection links" }).click();
      await expect(page).toHaveURL(/\/settings\/intake\/links$/);

      // Three fields is more than an inline add row carries, so Add
      // opens a dialog (DES-021).
      await page.getByRole("button", { name: "Add link" }).click();
      const dialog = page.getByRole("dialog", { name: "Add link" });
      await dialog.getByLabel("Label").fill(linkLabel);
      await dialog.getByLabel("Address").fill(LINK_URL);
      await dialog.getByLabel("Placement").selectOption({ label: typeName });
      const linked = page.waitForResponse(
        (response) =>
          response.url().endsWith("/api/v1/intake-links") && response.request().method() === "POST",
      );
      await dialog.getByRole("button", { name: "Add link" }).click();
      expect((await linked).status()).toBe(201);
      await expect(dialog).toBeHidden();

      // The row reads as an answer rather than an address: the label,
      // the URL without its scheme, and where it will be shown.
      const linkRow = page.getByRole("listitem").filter({ hasText: linkLabel });
      await expect(linkRow).toContainText(LINK_URL_SHOWN);
      await expect(linkRow).toContainText(typeName);

      // ---- Everything survives a reload ----
      //
      // Read back from the database rather than from a screen that
      // never re-rendered: no draft-and-publish step exists, so a save
      // is the whole of the change (story 37).
      await page.reload();
      const reloadedLink = page.getByRole("listitem").filter({ hasText: linkLabel });
      await expect(reloadedLink).toContainText(LINK_URL_SHOWN);
      await expect(reloadedLink).toContainText(typeName);

      await tabs.getByRole("link", { name: "Request types" }).click();
      await expect(page).toHaveURL(/\/settings\/intake\/request-types$/);
      const reloadedRow = requestTypeRow(page, typeName);
      await expect(cell(reloadedRow, "Target", "Contract · NDA")).toBeVisible();
      // Two catalog fields — the four basics are on every form and are
      // never counted here.
      await expect(cell(reloadedRow, "Form fields", "2 fields")).toBeVisible();

      await reloadedRow.getByRole("button", { name: `Edit ${typeName}` }).click();
      await expect(page.getByLabel("Target")).toHaveValue(`contract:${ndaType!.id}`);
      const reloadedFields = page.getByRole("list", { name: "Form fields" });
      await expect(
        reloadedFields.getByRole("checkbox", { name: `${FIRST_FIELD} required` }),
      ).toBeChecked();
      await expect(
        reloadedFields.getByRole("checkbox", { name: `${SECOND_FIELD} required` }),
      ).not.toBeChecked();

      // And behind the screen, at the seam the portal will read in M20:
      // the form definition in its order, and the link on this form.
      const form = await readForm(page.request, typeId);
      expect(form.map((field) => field.displayName)).toEqual([FIRST_FIELD, SECOND_FIELD]);
      expect(form.map((field) => field.isRequired)).toEqual([true, false]);
      const links = await listIntakeLinks(page.request);
      expect(links.find((link) => link.label === linkLabel)).toMatchObject({
        url: LINK_URL,
        requestTypeId: typeId,
      });
    } catch (error) {
      // A cleanup that throws here would replace the failure that caused
      // it, and the failure is the one worth reading.
      await sweepOrSay("M19 demo", leaveInert);
      throw error;
    }
    // The journey passed, so a cleanup that fails is a failure of its
    // own: it leaves the shared instance dirty for the next run.
    await leaveInert();
  });

  test("a Legal Team Member sees no Intake section and is refused on its URLs", async ({
    page,
    browser,
  }) => {
    // The Administrator exists only to onboard the member; the journey
    // itself runs in the member's own context.
    await signInAs(page, ADMIN.email, ADMIN.password, ADMIN.displayName);

    const email = `e2e-m19-member-${Date.now()}@e2e.example`;
    let member: OnboardedMember | undefined;

    const leaveInert = async () => {
      await member?.context.close();
      await ensureMemberInert(page.request, email);
    };

    try {
      member = await onboardActivatedMember(page.request, browser, {
        email,
        displayName: "Nadia Counsel",
        role: "legal_team_member",
        password: "their-own-e2e-password",
      });
      const memberPage = member.page;

      // Their rail carries no Intake section — absent, not disabled
      // (SET-002): the shape of intake is one person's decision.
      await memberPage.goto("/settings");
      await expect(memberPage).toHaveURL(/\/settings\/profile$/);
      const rail = memberPage.getByRole("navigation", { name: "Settings sections" });
      await expect(rail.getByRole("link", { name: "Profile" })).toBeVisible();
      await expect(rail.getByRole("link", { name: "Intake" })).toHaveCount(0);

      // Every Intake URL bounces them to their own settings home — the
      // section index and both shipped panes.
      for (const path of [
        "/settings/intake",
        "/settings/intake/request-types",
        "/settings/intake/links",
      ]) {
        await memberPage.goto(path);
        await expect(memberPage).toHaveURL(/\/settings\/profile$/);
      }

      // The client bounce is convenience; the API's role gate is the
      // real refusal (SET-002) — on every M19 surface, including the
      // form definition behind a request type.
      const seeded = await listRequestTypes(page.request);
      const anyType = seeded[0];
      expect(anyType, "the request-type seeds are missing").toBeDefined();
      for (const path of ["request-types", "intake-links", `request-types/${anyType!.id}/fields`]) {
        const refused = await memberPage.request.get(`/api/v1/${path}`);
        expect(refused.status(), `/api/v1/${path} must refuse a Legal Team Member`).toBe(403);
      }
    } catch (error) {
      await sweepOrSay("M19 demo", leaveInert);
      throw error;
    }
    await leaveInert();
  });
});
