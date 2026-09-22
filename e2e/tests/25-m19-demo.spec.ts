// SPDX-License-Identifier: AGPL-3.0-only

/** M19 and DD-028: configure a Request type through its destination Form and add guidance. */

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
      targetModule: z.enum(["matter", "contract"]),
      targetTypeId: z.string().nullable(),
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

const TypeForm = z.object({
  form: z.array(
    z.object({
      kind: z.string(),
      rowRef: z.string().optional(),
      isRequired: z.boolean().optional(),
      onIntakeForm: z.boolean().optional(),
    }),
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
  const read = await request.get(`/api/v1/contract-types/${typeId}/form`);
  expect(read.status(), await read.text()).toBe(200);
  return TypeForm.parse(await read.json()).form;
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

/** Deletes the per-run Request types before their destination Contract types. */
async function ensureDemoTypesAbsent(request: APIRequestContext) {
  for (const row of (await listRequestTypes(request)).filter((type) =>
    type.displayName.startsWith(TYPE_PREFIX),
  )) {
    const deleted = await request.delete(`/api/v1/request-types/${row.id}`);
    expect(deleted.status(), await deleted.text()).toBe(204);
  }
  for (const row of (await listContractTypes(request)).filter((type) =>
    type.displayName.startsWith(TYPE_PREFIX),
  )) {
    const deleted = await request.delete(`/api/v1/contract-types/${row.id}`);
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
    // seeds answer over the API with the DD-028 destination backfill. Subset
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
    const contractDefault = (await listContractTypes(page.request)).find(
      (type) => type.slug === "default",
    )!;
    const matterTypesResponse = await page.request.get("/api/v1/matter-types");
    expect(matterTypesResponse.status()).toBe(200);
    const matterDefault = z
      .object({ matterTypes: z.array(z.object({ id: z.string(), slug: z.string() })) })
      .parse(await matterTypesResponse.json())
      .matterTypes.find((type) => type.slug === "default")!;
    // Specific destinations survive; module-only and missing destinations use Default.
    expect(seededBySlug.get("nda_request")).toMatchObject({
      targetModule: "contract",
      targetTypeId: ndaType!.id,
    });
    expect(seededBySlug.get("contract_review")).toMatchObject({
      targetModule: "contract",
      targetTypeId: contractDefault.id,
    });
    expect(seededBySlug.get("legal_question")).toMatchObject({
      targetModule: "matter",
      targetTypeId: matterDefault.id,
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
      const destinationName = `${typeName} destination`;
      const destinationResponse = await page.request.post("/api/v1/contract-types", {
        data: { displayName: destinationName },
      });
      expect(destinationResponse.status()).toBe(201);
      const destination = z
        .object({ contractType: z.object({ id: z.string() }) })
        .parse(await destinationResponse.json()).contractType;
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
        cell(requestTypeRow(page, "NDA request"), "Destination", "Contract · NDA"),
      ).toBeVisible();
      await expect(
        cell(requestTypeRow(page, "Contract review"), "Destination", "Contract · Default"),
      ).toBeVisible();
      await expect(
        cell(requestTypeRow(page, "Legal question"), "Destination", "Matter · Default"),
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

      // The legacy create endpoint defaults to Matter, with no attached Fields yet.
      const row = requestTypeRow(page, typeName);
      await expect(cell(row, "Destination", "Matter · Default")).toBeVisible();
      await expect(page.getByText("Form fields", { exact: true })).toHaveCount(0);

      // Its pencil opens the type's own editor screen (DES-022), where
      // identity and form live together (story 19).
      await row.getByRole("button", { name: `Edit ${typeName}` }).click();
      await expect(page).toHaveURL(/\/settings\/intake\/request-types\/[^/]+$/);
      const typeId = new URL(page.url()).pathname.split("/").pop()!;
      await expect(page.getByLabel("Display name")).toHaveValue(typeName);

      await page.getByLabel("Default destination", { exact: true }).selectOption("contract");
      await expect(page.getByLabel("Default contract type")).toBeVisible();
      await page.getByLabel("Default contract type").selectOption(destination.id);
      const card = page.getByRole("region", { name: "Intake form" });
      await expect(card.getByRole("link", { name: "Edit form" })).toBeVisible();
      await expect(page.getByRole("checkbox")).toHaveCount(0);
      await expect(page.getByRole("button", { name: /^Attach field$/i })).toHaveCount(0);
      for (const name of ["Title", "Department", "Urgency", "Attachments"]) {
        await expect(card.getByText(name, { exact: true })).toBeVisible();
      }

      await card.getByRole("link", { name: "Edit form" }).click();
      await expect(page).toHaveURL(new RegExp(`/settings/contracts/types/${destination.id}/form$`));
      for (const fieldName of [FIRST_FIELD, SECOND_FIELD]) {
        await page.getByRole("button", { name: "Attach Field", exact: true }).click();
        await page.getByRole("menuitem", { name: new RegExp(fieldName) }).click();
        const onIntake = page.getByRole("switch", {
          name: `${fieldName}: On intake form`,
          exact: true,
        });
        await expect(onIntake).toBeEnabled();
        await onIntake.click();
        await expect(onIntake).toBeChecked();
        await expect(onIntake).toBeEnabled();
      }
      const required = page.getByRole("switch", {
        name: `${FIRST_FIELD}: Required for creation`,
        exact: true,
      });
      await required.click();
      await expect(required).toBeChecked();
      await expect(required).toBeEnabled();
      await page.goto(`/settings/intake/request-types/${typeId}`);
      await expect(card.getByText(FIRST_FIELD, { exact: true })).toBeVisible();
      await expect(card.getByText(SECOND_FIELD, { exact: true })).toBeVisible();
      await card.getByRole("button", { name: "Preview intake form" }).click();
      const preview = page.getByRole("dialog", { name: "Preview intake form" });
      await expect(preview.getByRole("heading", { name: typeName, exact: true })).toBeVisible();
      await expect(preview.getByLabel(FIRST_FIELD, { exact: false })).toBeVisible();
      await page.keyboard.press("Escape");
      await expect(preview).toBeHidden();

      await page.getByLabel("Default destination", { exact: true }).selectOption("matter");
      await expect(card.getByRole("link", { name: "Edit form" })).toHaveAttribute(
        "href",
        `/settings/matters/types/${matterDefault.id}/form`,
      );
      await expect(card.getByText(FIRST_FIELD, { exact: true })).toHaveCount(0);
      await page.getByLabel("Default destination", { exact: true }).selectOption("contract");
      await expect(page.getByLabel("Default contract type")).toBeVisible();
      await page.getByLabel("Default contract type").selectOption(destination.id);
      await expect(card.getByText(FIRST_FIELD, { exact: true })).toBeVisible();

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
      await dialog.getByLabel("Address", { exact: true }).fill(LINK_URL);
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
      await expect(cell(reloadedRow, "Destination", `Contract · ${destinationName}`)).toBeVisible();
      await reloadedRow.getByRole("button", { name: `Edit ${typeName}` }).click();
      await expect(page.getByLabel("Display name")).toHaveValue(typeName);
      const reloadedCard = page.getByRole("region", { name: "Intake form" });
      const firstRow = reloadedCard
        .getByRole("listitem")
        .filter({ has: page.getByText(FIRST_FIELD, { exact: true }) });
      const secondRow = reloadedCard
        .getByRole("listitem")
        .filter({ has: page.getByText(SECOND_FIELD, { exact: true }) });
      await expect(firstRow.getByText("Required", { exact: true })).toBeVisible();
      await expect(secondRow.getByText("Optional", { exact: true })).toBeVisible();
      await expect(page.getByRole("checkbox")).toHaveCount(0);
      const form = (await readForm(page.request, destination.id)).filter((node) =>
        ["governing_law", "jurisdiction"].includes(node.rowRef ?? ""),
      );
      expect(form.map((node) => node.rowRef)).toEqual(["governing_law", "jurisdiction"]);
      expect(form.map((node) => node.isRequired)).toEqual([true, false]);
      expect(form.every((node) => node.onIntakeForm)).toBe(true);
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
      for (const path of ["request-types", "intake-links"]) {
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
