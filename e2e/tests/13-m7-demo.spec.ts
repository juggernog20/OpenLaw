// SPDX-License-Identifier: AGPL-3.0-only

/**
 * M7 milestone acceptance (#98): the demo, end to end, in one browser
 * session. An Administrator opens the new Entities destination and
 * registers the company's UK subsidiary with its full identity card;
 * it appears in the registry, ordered by legal name, showing name,
 * type, jurisdiction, and status. A second journey proves ENT-004: a
 * Business User's nav carries no Entities item, the URL bounces them
 * home, and the API's 403 stands behind the bounce. ("Selectable as
 * the signing entity on a contract" — the demo sentence's other half —
 * is asserted in M8's spec, when a contract form exists to select it
 * on.) Per-run entities are archived afterwards, so the never-reset
 * instance (TECH-018) stays clean — archived rows are the suite's
 * resting state, like fields; #99 ships restore and the archive UI.
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

/** Archives every live per-run entity — the soft-delete resting state
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
    try {
      // The new Entities destination, from the nav.
      await page.goto("/");
      await page
        .getByRole("navigation", { name: "Primary" })
        .getByRole("link", { name: "Entities" })
        .click();
      await expect(page).toHaveURL(/\/entities$/);
      await expect(page.getByRole("heading", { level: 1, name: "Entities" })).toBeVisible();

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
          response.url().includes("/api/v1/entities") &&
          response.request().method() === "POST",
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

      // Ordered by legal name — the API's answer is sorted, and the
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
    } finally {
      // Leave the shared instance as the run found it (TECH-018): the
      // per-run entity archived out of the list and the M8 picker seam.
      await ensureDemoEntitiesInert(page.request);
    }
  });

  test("a Business User has no Entities module at all (ENT-004)", async ({ page, browser }) => {
    await signInAs(page, ADMIN.email, ADMIN.password, ADMIN.displayName);

    const email = `e2e-m7-business-${Date.now()}@e2e.example`;
    let member: OnboardedMember | undefined;
    try {
      member = await onboardActivatedMember(page.request, browser, {
        email,
        displayName: "Bao Business",
        role: "business_user",
        password: "their-own-e2e-password",
      });
      const businessPage = member.page;

      // No Entities nav item — absent, not disabled.
      await businessPage.goto("/");
      const nav = businessPage.getByRole("navigation", { name: "Primary" });
      await expect(nav.getByRole("link", { name: "Home" })).toBeVisible();
      await expect(nav.getByRole("link", { name: "Entities" })).toHaveCount(0);

      // The URL bounces them home.
      await businessPage.goto("/entities");
      await expect(businessPage).toHaveURL(/\/$/);

      // The client bounce is convenience; the API's refusal is real —
      // on the list, the picker read, and the write.
      for (const [method, path] of [
        ["get", "/api/v1/entities"],
        ["get", "/api/v1/entities/types"],
        ["post", "/api/v1/entities"],
      ] as const) {
        const refused = await businessPage.request[method](path);
        expect(refused.status(), `${method.toUpperCase()} ${path} must refuse a Business User`).toBe(
          403,
        );
      }
    } finally {
      await member?.context.close();
      await ensureMemberInert(page.request, email);
    }
  });
});
