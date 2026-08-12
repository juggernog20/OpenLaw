// SPDX-License-Identifier: AGPL-3.0-only

/**
 * M6 milestone acceptance (#86): the demo, end to end, in one browser
 * session. An Administrator adds a contract type, renames a status
 * without breaking anything, defines a custom field, and attaches it
 * to that type. A second journey proves SET-002 from the taxonomy
 * side: a Legal Team Member's settings rail carries no Matters or
 * Contracts sections, their URLs bounce, and the API's 403 stands
 * behind the bounce. The seed sweep at the top proves the M6
 * migrations (0008–0012) landed on the running stack — the
 * `docker compose up` acceptance, asserted from inside the demo.
 * Everything per-run ends deleted, archived, or renamed back, so the
 * never-reset instance (TECH-018) stays clean.
 */

import { test, expect, type APIRequestContext } from "@playwright/test";
import { z } from "zod";
import {
  ADMIN,
  ensureAdminExists,
  ensureMemberInert,
  onboardActivatedMember,
  signInAs,
  type OnboardedMember,
} from "./helpers.js";

/** The CTR-001 seed whose rename the demo performs, and its canonical
 * display name to restore (and start from) on the never-reset instance. */
const RENAMED_SLUG = "redlining";
const CANONICAL_NAME = "Redlining with counterparty";

/** Per-run rows carry these prefixes so a crashed earlier run's
 * leftovers can be swept before the journey starts. */
const TYPE_PREFIX = "E2E demo type";
const FIELD_PREFIX = "E2E demo field";

const TaxonomyRows = (key: string) =>
  z.object({
    [key]: z.array(
      z.object({
        id: z.string(),
        slug: z.string(),
        displayName: z.string(),
        archivedAt: z.string().nullable(),
      }),
    ),
  });

async function listRows(request: APIRequestContext, path: string, key: string) {
  const listed = await request.get(`/api/v1/${path}?includeArchived=true`);
  expect(listed.ok()).toBe(true);
  const rows = TaxonomyRows(key).parse(await listed.json())[key];
  expect(rows).toBeDefined();
  return rows!;
}

/** Puts the renamed seed status back on its canonical display name —
 * the known starting state, and the cleanup (TECH-018). */
async function ensureCanonicalStatusName(request: APIRequestContext) {
  const statuses = await listRows(request, "contract-statuses", "contractStatuses");
  const target = statuses.find((row) => row.slug === RENAMED_SLUG);
  expect(target).toBeDefined();
  if (target!.displayName === CANONICAL_NAME) return;
  const reset = await request.patch(`/api/v1/contract-statuses/${target!.id}`, {
    data: { displayName: CANONICAL_NAME },
  });
  expect(reset.ok()).toBe(true);
}

/** Hard-deletes every per-run contract type this suite ever created —
 * the taxonomy delete cascades the type's field attachments. */
async function ensureDemoTypesAbsent(request: APIRequestContext) {
  const types = await listRows(request, "contract-types", "contractTypes");
  for (const row of types.filter((type) => type.displayName.startsWith(TYPE_PREFIX))) {
    const deleted = await request.delete(`/api/v1/contract-types/${row.id}`);
    expect(deleted.status()).toBe(204);
  }
}

/** Archives every live per-run field — fields have no hard delete
 * (MTR-014 value retention), so archived is their resting state. */
async function ensureDemoFieldsInert(request: APIRequestContext) {
  const fields = await listRows(request, "fields", "fields");
  for (const row of fields.filter(
    (field) => field.displayName.startsWith(FIELD_PREFIX) && field.archivedAt === null,
  )) {
    const archived = await request.post(`/api/v1/fields/${row.id}/archive`);
    expect(archived.ok()).toBe(true);
  }
}

test.describe.serial("M6 demo path", () => {
  test.beforeAll(async ({ request }) => {
    await ensureAdminExists(request);
  });

  test("add a type, rename a status, define a field, attach it — one journey", async ({
    page,
  }) => {
    await signInAs(page, ADMIN.email, ADMIN.password, ADMIN.displayName);

    // Known starting state on the never-reset instance (TECH-018): a
    // crashed earlier run may have left the rename or per-run rows
    // behind.
    await ensureCanonicalStatusName(page.request);
    await ensureDemoTypesAbsent(page.request);
    await ensureDemoFieldsInert(page.request);

    // The compose-up acceptance, from inside the running stack: every
    // M6 seed row (migrations 0008–0012) answers over the API. Subset
    // checks — the accumulated instance holds more than the seeds.
    const seedSlugs = async (path: string, key: string, expected: string[]) => {
      const slugs = (await listRows(page.request, path, key)).map((row) => row.slug);
      for (const slug of expected) expect(slugs, `${path} is missing ${slug}`).toContain(slug);
    };
    await seedSlugs("contract-types", "contractTypes", [
      "nda",
      "msa",
      "sow",
      "sales",
      "vendor",
      "employment",
      "license",
      "other",
    ]);
    await seedSlugs("contract-statuses", "contractStatuses", [
      "draft",
      "internal_review",
      "redlining",
      "awaiting_approval",
      "out_for_signature",
      "active",
      "expired",
      "terminated",
    ]);
    await seedSlugs("fields", "fields", ["governing_law", "jurisdiction", "our_position"]);
    await seedSlugs("matter-types", "matterTypes", [
      "employment",
      "litigation",
      "regulatory",
      "commercial",
      "corporate",
      "ip",
      "privacy",
      "advisory",
      "other",
    ]);

    const typeName = `${TYPE_PREFIX} ${Date.now()}`;
    const fieldName = `${FIELD_PREFIX} ${Date.now()}`;
    try {
      // Into settings from its way in (SET-001), then the Organization
      // rail's Contracts section — its URL forwards to the Types pane.
      await page.getByRole("banner").getByRole("button", { name: ADMIN.displayName }).click();
      await page.getByRole("menu").getByRole("menuitem", { name: "Settings" }).click();
      await expect(page).toHaveURL(/\/settings\/profile$/);
      const rail = page.getByRole("navigation", { name: "Settings sections" });
      await rail.getByRole("link", { name: "Contracts" }).click();
      await expect(page).toHaveURL(/\/settings\/contracts\/types$/);

      // The seeded list renders with Other locked, not archivable
      // (CTR-002) — the DES-020 lock, drawn as a fact.
      await expect(
        page.getByRole("img", { name: "Other is system-protected and can't be archived" }),
      ).toBeVisible();

      // Adds a contract type: the inline draft row is the form
      // (DES-020) — Enter creates, immediately (SET-003).
      await page.getByRole("button", { name: "Add type" }).click();
      const created = page.waitForResponse(
        (response) =>
          response.url().includes("/api/v1/contract-types") &&
          response.request().method() === "POST",
      );
      await page.getByRole("textbox", { name: "New type name" }).fill(typeName);
      await page.keyboard.press("Enter");
      expect((await created).ok()).toBe(true);
      await expect(page.getByRole("button", { name: `Rename ${typeName}` })).toBeVisible();

      // Renames a status without breaking anything: the name is the
      // editor (DES-017); the stage mapping is immutable (CTR-001).
      const before = await listRows(page.request, "contract-statuses", "contractStatuses");
      const tabs = page.getByRole("navigation", { name: "Contracts panes" });
      await tabs.getByRole("link", { name: "Statuses" }).click();
      await expect(page).toHaveURL(/\/settings\/contracts\/statuses$/);
      await page.getByRole("button", { name: `Rename ${CANONICAL_NAME}` }).click();
      const renamed = page.waitForResponse(
        (response) =>
          response.url().includes("/api/v1/contract-statuses") &&
          response.request().method() === "PATCH",
      );
      await page.getByRole("textbox", { name: `Rename ${CANONICAL_NAME}` }).fill("In redline");
      await page.keyboard.press("Enter");
      expect((await renamed).ok()).toBe(true);

      // "Without breaking anything", on screen: the renamed row keeps
      // its Review stage badge, and the protected seeds keep their
      // locks (CTR-001).
      const renamedRow = page.getByRole("listitem").filter({ hasText: "In redline" });
      await expect(renamedRow.getByRole("button", { name: "Rename In redline" })).toBeVisible();
      await expect(renamedRow).toContainText("Review");
      for (const name of ["Draft", "Active", "Expired"]) {
        await expect(
          page.getByRole("img", { name: `${name} is system-protected and can't be archived` }),
        ).toBeVisible();
      }
      // And behind the screen: only the one display name moved — every
      // slug, stage mapping, and row survives, nothing archived.
      const after = await listRows(page.request, "contract-statuses", "contractStatuses");
      expect(after.length).toBe(before.length);
      expect(after.map((row) => row.slug).sort()).toEqual(before.map((row) => row.slug).sort());
      expect(after.find((row) => row.slug === RENAMED_SLUG)?.displayName).toBe("In redline");
      expect(after.filter((row) => row.archivedAt !== null).length).toBe(
        before.filter((row) => row.archivedAt !== null).length,
      );

      // Defines a custom field: creation is a form, so the form gets a
      // dialog (DES-021) — type Text, contract scope, business tag.
      await tabs.getByRole("link", { name: "Fields" }).click();
      await expect(page).toHaveURL(/\/settings\/contracts\/fields$/);
      await page.getByRole("button", { name: "Add field" }).click();
      const dialog = page.getByRole("dialog");
      await dialog.getByLabel("Name").fill(fieldName);
      await dialog.getByLabel("Type", { exact: true }).selectOption("text");
      const fieldCreated = page.waitForResponse(
        (response) =>
          response.url().includes("/api/v1/fields") && response.request().method() === "POST",
      );
      await dialog.getByRole("button", { name: "Add field" }).click();
      expect((await fieldCreated).ok()).toBe(true);
      await expect(dialog).toBeHidden();
      const fieldRow = page.getByRole("listitem").filter({ hasText: fieldName });
      await expect(fieldRow).toContainText("Text");

      // Attaches it to that type: the row's pencil opens the type's
      // own editor screen (DES-022), and the Attach menu offers the
      // catalog's unattached fields (CTR-016).
      await tabs.getByRole("link", { name: "Types" }).click();
      await page.getByRole("button", { name: `Edit ${typeName}` }).click();
      await expect(page).toHaveURL(/\/settings\/contracts\/types\/[^/]+$/);
      const attached = page.waitForResponse(
        (response) =>
          /\/api\/v1\/contract-types\/[^/]+\/fields/.test(response.url()) &&
          response.request().method() === "POST",
      );
      await page.getByRole("button", { name: "Attach field" }).click();
      await page.getByRole("menuitem", { name: new RegExp(fieldName) }).click();
      expect((await attached).ok()).toBe(true);
      await expect(page.getByRole("checkbox", { name: `${fieldName} required` })).toBeVisible();
      await expect(page.getByRole("button", { name: `Detach ${fieldName}` })).toBeVisible();
    } finally {
      // Leave the shared instance as the run found it (TECH-018):
      // canonical status name back, the per-run type hard-deleted
      // (attachments cascade), the per-run field archived.
      await ensureCanonicalStatusName(page.request);
      await ensureDemoTypesAbsent(page.request);
      await ensureDemoFieldsInert(page.request);
    }
  });

  test("a Legal Team Member sees no Matters or Contracts sections and is refused on their URLs", async ({
    page,
    browser,
  }) => {
    // The Administrator exists only to onboard the member; the journey
    // itself runs in the member's own context.
    await signInAs(page, ADMIN.email, ADMIN.password, ADMIN.displayName);

    const email = `e2e-m6-member-${Date.now()}@e2e.example`;
    let member: OnboardedMember | undefined;
    try {
      member = await onboardActivatedMember(page.request, browser, {
        email,
        displayName: "Nadia Counsel",
        role: "legal_team_member",
        password: "their-own-e2e-password",
      });
      const memberPage = member.page;

      // Their rail carries no Matters or Contracts sections — absent,
      // not disabled (SET-002); taxonomy is Administrator-only.
      await memberPage.goto("/settings");
      await expect(memberPage).toHaveURL(/\/settings\/profile$/);
      const rail = memberPage.getByRole("navigation", { name: "Settings sections" });
      await expect(rail.getByRole("link", { name: "Profile" })).toBeVisible();
      await expect(rail.getByRole("link", { name: "Matters" })).toHaveCount(0);
      await expect(rail.getByRole("link", { name: "Contracts" })).toHaveCount(0);
      await expect(rail.getByText("Organization")).toHaveCount(0);

      // Every taxonomy URL bounces them to their own settings home —
      // the section indexes and every shipped pane.
      for (const path of [
        "/settings/matters",
        "/settings/matters/types",
        "/settings/contracts",
        "/settings/contracts/types",
        "/settings/contracts/statuses",
        "/settings/contracts/fields",
      ]) {
        await memberPage.goto(path);
        await expect(memberPage).toHaveURL(/\/settings\/profile$/);
      }

      // The client bounce is convenience; the API's role gate is the
      // real refusal (SET-002) — on every M6 taxonomy surface.
      for (const path of ["contract-types", "contract-statuses", "fields", "matter-types"]) {
        const refused = await memberPage.request.get(`/api/v1/${path}`);
        expect(refused.status(), `/api/v1/${path} must refuse a Legal Team Member`).toBe(403);
      }
    } finally {
      await member?.context.close();
      await ensureMemberInert(page.request, email);
    }
  });
});
