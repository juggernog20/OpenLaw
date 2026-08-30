// SPDX-License-Identifier: AGPL-3.0-only

/**
 * M7 milestone acceptance (#98): the demo, end to end, in one browser
 * session. An Administrator opens the new Entities destination and
 * registers the company's UK subsidiary with its full identity card.
 * It appears in the registry, ordered by legal name, showing name,
 * type, jurisdiction, and status. A second journey proves ENT-004: a
 * Contributor's nav carries no Entities item, the URL bounces them
 * home, and the API's 403 stands behind the bounce. A Business User
 * is refused the same way, but cannot exist yet. Portal accounts
 * arrive with intake, and invites stop at Contributor. The demo
 * sentence's other half, "selectable as the signing entity on a
 * contract", is asserted in M8's spec, when a contract form exists to
 * select it on. Per-run entities are archived afterwards, so the
 * never-reset instance (TECH-018) stays clean. Archived rows are the
 * suite's resting state, like fields. #99 ships restore and the
 * archive UI.
 */

import { test, expect, type APIRequestContext } from "@playwright/test";
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

/** Per-run rows carry this prefix so a crashed earlier run's leftovers
 * can be swept before the journey starts. */
const ENTITY_PREFIX = "E2E Aldgate";

const EntityRows = z.object({
  entities: z.array(
    z.object({
      id: z.string(),
      legalName: z.string(),
      entityTypeName: z.string(),
      jurisdiction: z.string().nullable(),
      status: z.string(),
      archivedAt: z.string().nullable(),
    }),
  ),
});

async function listEntities(request: APIRequestContext, includeArchived = false) {
  const listed = await request.get(
    `/api/v1/entities${includeArchived ? "?includeArchived=true" : ""}`,
  );
  expect(listed.ok()).toBe(true);
  return EntityRows.parse(await listed.json()).entities;
}

/** Archives every live per-run entity, the soft-delete resting state
 * (TECH-018 cleanup; hard delete does not exist on the registry). */
async function ensureDemoEntitiesInert(request: APIRequestContext) {
  const rows = await listEntities(request);
  for (const row of rows.filter((entity) => entity.legalName.startsWith(ENTITY_PREFIX))) {
    const archived = await request.post(`/api/v1/entities/${row.id}/archive`);
    expect(archived.ok()).toBe(true);
  }
}

test.describe.serial("M7 demo path", () => {
  test.beforeAll(async ({ request }) => {
    await ensureAdminExists(request);
  });

  test("register the UK subsidiary and find it in the registry", async ({ page }) => {
    await signInAs(page, ADMIN.email, ADMIN.password, ADMIN.displayName);
    await ensureDemoEntitiesInert(page.request);

    // The compose-up acceptance from inside the demo: the M7 migration
    // landed, the registry answers, and the ENT-001 type seeds feed the
    // Member+ picker read.
    const types = await page.request.get("/api/v1/entities/types");
    expect(types.ok()).toBe(true);
    const typeSlugs = z
      .object({ entityTypes: z.array(z.object({ slug: z.string() })) })
      .parse(await types.json())
      .entityTypes.map((row) => row.slug);
    for (const slug of ["corporation", "llc", "partnership", "branch", "other"]) {
      expect(typeSlugs, `entity types are missing ${slug}`).toContain(slug);
    }

    const legalName = `${ENTITY_PREFIX} UK Ltd ${Date.now()}`;

    /** Leaves the shared instance as the run found it (TECH-018): the
     * per-run entity archived out of the list and the M8 picker seam. */
    const leaveInert = async () => {
      await ensureDemoEntitiesInert(page.request);
    };

    try {
      // The new Entities destination, from the nav.
      await page.goto("/");
      await page
        .getByRole("navigation", { name: "Primary" })
        .getByRole("link", { name: "Entities" })
        .click();
      await expect(page).toHaveURL(/\/entities$/);
      await expect(page.getByRole("heading", { level: 1, name: "Entities" })).toBeVisible();
      await page.getByRole("link", { name: "List", exact: true }).click();
      await expect(page).toHaveURL(/\/entities\?view=list$/);

      // Register the UK subsidiary with its full identity card.
      await page.getByRole("button", { name: "Register entity" }).first().click();
      const dialog = page.getByRole("dialog");
      await dialog.getByLabel("Legal name").fill(legalName);
      await dialog.getByLabel("Entity type").selectOption({ label: "Corporation" });
      await dialog.getByLabel("Formation jurisdiction").fill("England & Wales");
      await dialog.getByLabel("Formed on").fill("2014-03-12");
      await dialog.getByLabel("Registration no.").fill("08841201");
      await dialog.getByLabel("Tax ID").fill("GB 927 4801 33");
      await dialog.getByLabel("Registered agent").fill("Aldgate Corporate Services Ltd");
      await dialog
        .getByLabel("Registered address")
        .fill("1 Gresham Street, London EC2V 7BX, United Kingdom");
      const created = page.waitForResponse(
        (response) =>
          response.url().includes("/api/v1/entities") && response.request().method() === "POST",
      );
      await dialog.getByRole("button", { name: "Register", exact: true }).click();
      expect((await created).ok()).toBe(true);
      await expect(dialog).toBeHidden();

      // It appears in the registry: name, type, jurisdiction, status.
      const row = page.getByRole("row").filter({ hasText: legalName });
      await expect(row).toBeVisible();
      await expect(row).toContainText("Corporation");
      await expect(row).toContainText("England & Wales");
      await expect(row).toContainText("Active");

      // Ordered by legal name. The API's answer is sorted, and the
      // new row sits exactly where that order puts it.
      const listed = await listEntities(page.request);
      const names = listed.map((entity) => entity.legalName);
      expect(names).toContain(legalName);
      const sorted = [...names].sort((a, b) =>
        a.localeCompare(b, undefined, { sensitivity: "base" }),
      );
      expect(names.map((name) => name.toLowerCase())).toEqual(
        sorted.map((name) => name.toLowerCase()),
      );

      // The identity card round-trips: the register form's optional
      // scalars all landed (the record page that renders them is #99).
      const fullRows = await page.request.get("/api/v1/entities");
      const full = z
        .object({
          entities: z.array(
            z.object({
              legalName: z.string(),
              formedOn: z.string().nullable(),
              registrationNumber: z.string().nullable(),
              taxId: z.string().nullable(),
              registeredAgent: z.string().nullable(),
              registeredAddress: z.string().nullable(),
            }),
          ),
        })
        .parse(await fullRows.json())
        .entities.find((entity) => entity.legalName === legalName);
      expect(full).toMatchObject({
        formedOn: "2014-03-12",
        registrationNumber: "08841201",
        taxId: "GB 927 4801 33",
        registeredAgent: "Aldgate Corporate Services Ltd",
        registeredAddress: "1 Gresham Street, London EC2V 7BX, United Kingdom",
      });
    } catch (error) {
      // A cleanup that throws here would replace the failure that caused
      // it, and the failure is the one worth reading.
      await sweepOrSay("M7 demo", leaveInert);
      throw error;
    }
    // The journey passed, so a cleanup that fails is a failure of its
    // own: it leaves the shared instance dirty for the next run.
    await leaveInert();
  });

  test("a Contributor has no Entities module at all (ENT-004)", async ({ page, browser }) => {
    await signInAs(page, ADMIN.email, ADMIN.password, ADMIN.displayName);

    const email = `e2e-m7-contributor-${Date.now()}@e2e.example`;
    let member: OnboardedMember | undefined;

    const leaveInert = async () => {
      await member?.context.close();
      await ensureMemberInert(page.request, email);
    };

    try {
      member = await onboardActivatedMember(page.request, browser, {
        email,
        displayName: "Casey Contributor",
        role: "contributor",
        password: "their-own-e2e-password",
      });
      const contributorPage = member.page;

      // No Entities nav item. Absent, not disabled.
      await contributorPage.goto("/");
      const nav = contributorPage.getByRole("navigation", { name: "Primary" });
      await expect(nav.getByRole("link", { name: "Home" })).toBeVisible();
      await expect(nav.getByRole("link", { name: "Entities" })).toHaveCount(0);

      // The URL bounces them home.
      await contributorPage.goto("/entities");
      await expect(contributorPage).toHaveURL(/\/$/);

      // The client bounce is convenience; the API's refusal is real,
      // on the list, the picker read, and the write. The write carries
      // a shape-valid body: validation answers before the role guard,
      // and the refusal under test is the guard's.
      const refusals = [
        contributorPage.request.get("/api/v1/entities"),
        contributorPage.request.get("/api/v1/entities/types"),
        contributorPage.request.post("/api/v1/entities", {
          data: { legalName: "Sneaky Ltd", entityTypeId: "any" },
        }),
      ];
      for (const refused of await Promise.all(refusals)) {
        expect(refused.status(), "the registry must refuse a Contributor").toBe(403);
      }
    } catch (error) {
      await sweepOrSay("M7 demo", leaveInert);
      throw error;
    }
    await leaveInert();
  });
});
