// SPDX-License-Identifier: AGPL-3.0-only

/** M35/13: the complete Auto-Docs demo across Legal, the Portal, Mailpit, and the Inbox. */
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { expect, test, request as playwrightRequest, type Page } from "@playwright/test";
import {
  ADMIN,
  ensureAdminExists,
  ensureMemberInert,
  onboardActivatedMember,
  reportAxeViolations,
  signInAs,
  submitLogin,
} from "./helpers.js";
import { waitForMailDetails } from "./mailpit.js";

test.setTimeout(360_000);
test.use({ actionTimeout: 15_000 });
test.beforeAll(async ({ request }) => ensureAdminExists(request));
test("M35: Legal publishes, Sales generates, a Member claims, and a changed live pair refuses stale answers", async ({
  page,
  browser,
}, testInfo) => {
  await signInAs(page, ADMIN.email, ADMIN.password, ADMIN.displayName);
  const suffix = Date.now();
  const name = `Demo NDA ${suffix}`;
  const salesName = `Sales ${suffix}`;
  const procurementName = `Procurement ${suffix}`;
  const lawyerName = `Jurisdiction lawyer ${suffix}`;
  const password = "correct-horse-battery";
  const emails = [
    `demo-lawyer-${suffix}@example.com`,
    `demo-procurement-${suffix}@example.com`,
    `demo-executive-${suffix}@example.com`,
  ];
  const cleanup = await playwrightRequest.newContext({
    baseURL: testInfo.project.use.baseURL,
    storageState: await page.context().storageState(),
  });
  const colleagues: Awaited<ReturnType<typeof onboardActivatedMember>>[] = [];
  const departmentIds: string[] = [];
  try {
    for (const displayName of [salesName, procurementName]) {
      const made = await page.request.post("/api/v1/departments", { data: { displayName } });
      expect(made.status(), await made.text()).toBe(201);
      departmentIds.push((await made.json()).department.id);
    }
    for (const [index, displayName] of [
      lawyerName,
      procurementName,
      `Account executive ${suffix}`,
    ].entries()) {
      colleagues.push(
        await onboardActivatedMember(page.request, browser, {
          email: emails[index]!,
          displayName,
          password,
          role: index === 2 ? "business_user" : "legal_team_member",
          completePortalOnboarding: false,
        }),
      );
    }
    const usersResponse = await page.request.get("/api/v1/users");
    expect(usersResponse.status(), await usersResponse.text()).toBe(200);
    const { users: people } = z
      .object({ users: z.array(z.object({ id: z.string(), email: z.string() })) })
      .parse(await usersResponse.json());
    const personIds = emails.map((email) => {
      const person = people.find((candidate) => candidate.email === email);
      expect(person, `Missing invited user ${email}`).toBeDefined();
      return person!.id;
    });
    const lawyer = colleagues[0]!.page;
    const portal = colleagues[2]!.page;
    const type = await page.request.post("/api/v1/contract-types", { data: { displayName: name } });
    expect(type.status()).toBe(201);
    const contractTypeId = (await type.json()).contractType.id;
    expect(
      (
        await page.request.post(`/api/v1/contract-types/${contractTypeId}/people`, {
          data: { userId: personIds[1] },
        })
      ).status(),
    ).toBe(201);
    const entityTypes = (await (await page.request.get("/api/v1/entities/types")).json())
      .entityTypes;
    const entityReply = await page.request.post("/api/v1/entities", {
      data: { legalName: `Signing Entity ${suffix}`, entityTypeId: entityTypes[0].id },
    });
    expect(entityReply.status()).toBe(201);
    const entity = (await entityReply.json()).entity;
    expect(
      (
        await page.request.patch(`/api/v1/entities/${entity.id}`, { data: { portalListed: true } })
      ).status(),
    ).toBe(200);

    await page.goto("/auto-docs");
    await page.getByRole("button", { name: "Create Auto-Doc", exact: true }).click();
    await page.getByRole("textbox", { name: "Name", exact: true }).fill(name);
    await page.getByRole("button", { name: "Create", exact: true }).click();
    await expect(page.getByRole("heading", { name, exact: true })).toBeVisible();
    const autoDocUrl = page.url();
    const id = autoDocUrl.split("/").at(-1)!;
    const fixture = (version: number) =>
      fileURLToPath(
        new URL(
          `../../apps/api/src/testing/fixtures/auto-docs/demo-nda-v${version}.docx`,
          import.meta.url,
        ),
      );
    await page.getByLabel("Word template", { exact: true }).setInputFiles(fixture(1));
    await page.getByRole("button", { name: "Upload template", exact: true }).click();
    const counterparty = page.getByRole("group", { name: "counterparty_name", exact: true });
    await expect(counterparty).toBeVisible();
    await counterparty.getByRole("checkbox", { name: "Required", exact: true }).check();
    await counterparty
      .getByRole("combobox", { name: "Map to", exact: true })
      .selectOption("attribute:primary_counterparty_name");
    async function addField(slug: string, label: string, fieldType: string) {
      await page.getByRole("button", { name: "Add field", exact: true }).click();
      await page.getByLabel("Slug", { exact: true }).last().fill(slug);
      const field = page.getByRole("group", { name: slug, exact: true });
      await field.getByLabel("Label", { exact: true }).fill(label);
      await field.getByRole("combobox", { name: "Type", exact: true }).selectOption(fieldType);
      return field;
    }
    const jurisdiction = await addField("jurisdiction", "Jurisdiction", "single_select");
    await jurisdiction
      .getByLabel("Options, one per line", { exact: true })
      .fill("United States\nUnited Kingdom");
    const signingEntity = await addField("signing_entity", "Signing Entity", "entity");
    await signingEntity
      .getByRole("combobox", { name: "Map to", exact: true })
      .selectOption("attribute:entity_id");
    const owningDepartment = await addField("owning_department", "Owning department", "text");
    await owningDepartment
      .getByRole("combobox", { name: "Map to", exact: true })
      .selectOption("attribute:owning_department_id");
    const clause = page.getByRole("group", { name: "arbitration", exact: true });
    await clause
      .getByRole("combobox", { name: "Include this Block", exact: true })
      .selectOption("conditional");
    await clause
      .getByRole("combobox", { name: "Form field", exact: true })
      .selectOption("jurisdiction");
    await clause.getByRole("combobox", { name: "Operator", exact: true }).selectOption("equals");
    await clause
      .getByRole("combobox", { name: "Value", exact: true })
      .selectOption("United States");
    await page.getByRole("button", { name: "Save form", exact: true }).click();
    await expect(
      page
        .getByRole("region", { name: "Form versions", exact: true })
        .getByText("Form version 2", { exact: true }),
    ).toBeVisible();
    const assignment = page.getByRole("region", { name: "Assignment rules", exact: true });
    await assignment.getByRole("button", { name: "Add rule", exact: true }).click();
    const rule = assignment.getByRole("group", { name: "Assignment rule 1", exact: true });
    await rule
      .getByRole("combobox", { name: "Form field", exact: true })
      .selectOption("jurisdiction");
    await rule.getByRole("combobox", { name: "Operator", exact: true }).selectOption("equals");
    await rule.getByRole("combobox", { name: "Value", exact: true }).selectOption("United States");
    await rule
      .getByRole("combobox", { name: "Legal Owner", exact: true })
      .selectOption(personIds[0]!);
    await assignment.getByRole("button", { name: "Save assignment", exact: true }).click();
    await expect(assignment.getByText("Assignment settings saved.", { exact: true })).toBeVisible();
    const settings = page.getByRole("region", { name: "Settings", exact: true });
    await settings
      .getByRole("combobox", { name: "Audience", exact: true })
      .selectOption("selected");
    await settings
      .getByRole("listbox", { name: "Selected Departments", exact: true })
      .selectOption(departmentIds[0]!);
    await settings
      .getByRole("combobox", { name: "Target Contract Type", exact: true })
      .selectOption(contractTypeId);
    await settings
      .getByLabel("Title pattern", { exact: true })
      .fill(`${name} - {{counterparty_name}}`);
    await settings.getByRole("combobox", { name: "Formats", exact: true }).selectOption("both");
    await settings
      .getByRole("combobox", { name: "Acknowledgement frequency", exact: true })
      .selectOption("every_use");
    await settings
      .getByRole("checkbox", { name: "Use the organisation's acknowledgement text", exact: true })
      .uncheck();
    await settings
      .getByRole("textbox", { name: "Acknowledgement text", exact: true })
      .fill("Do not edit the generated NDA. Ask Legal for changes.");
    await settings.getByRole("button", { name: "Save settings", exact: true }).click();
    await page.getByRole("button", { name: "Publish", exact: true }).click();
    await expect(
      page.getByText("Live: file version 1 and form version 2.", { exact: true }),
    ).toBeVisible();
    expect(await reportAxeViolations(page, testInfo, "M35-published-Auto-Doc")).toEqual([]);

    await portal.goto(`/portal/auto-docs/${id}/generate`);
    await expect(portal).toHaveURL(/\/portal\/onboarding$/);
    await portal
      .getByRole("combobox", { name: "Department", exact: true })
      .selectOption(departmentIds[0]!);
    await portal.getByRole("button", { name: "Continue", exact: true }).click();
    for (const region of ["Name and photo", "Theme", "Notifications"]) {
      await expect(portal.getByRole("region", { name: region, exact: true })).toBeVisible();
      await portal.getByRole("button", { name: "Skip", exact: true }).click();
    }
    await portal.getByRole("button", { name: "Finish", exact: true }).click();
    await expect(portal).toHaveURL(/\/portal$/);
    const firstRunStamp = (await (await portal.request.get("/api/v1/me")).json()).user
      .portalOnboardingCompletedAt;
    expect(firstRunStamp).toBeTruthy();
    await portal.getByRole("button", { name: "Sign out", exact: true }).click();
    await submitLogin(portal, emails[2]!, password);
    await expect(portal).toHaveURL(/\/portal$/);
    expect(
      (await (await portal.request.get("/api/v1/me")).json()).user.portalOnboardingCompletedAt,
    ).toBe(firstRunStamp);
    async function openForm(target: Page) {
      await target.goto(`/portal/auto-docs/${id}/generate`);
      await expect(
        target.getByRole("heading", { name: "Before you generate", exact: true }),
      ).toBeVisible();
      await expect(
        target.getByText("Do not edit the generated NDA. Ask Legal for changes.", { exact: true }),
      ).toBeVisible();
      await target
        .getByRole("checkbox", { name: "I acknowledge this statement.", exact: true })
        .check();
      await target.getByRole("button", { name: "Acknowledge and continue", exact: true }).click();
      await expect(
        target.getByRole("heading", { name: `Generate ${name}`, exact: true }),
      ).toBeVisible();
    }
    async function answer(counterpartyName: string, jurisdictionValue: string) {
      await portal
        .getByRole("textbox", { name: "Counterparty name", exact: true })
        .fill(counterpartyName);
      await portal.getByRole("textbox", { name: "Seat", exact: true }).fill("New York");
      await portal
        .getByRole("combobox", { name: "Jurisdiction", exact: true })
        .selectOption(jurisdictionValue);
      await portal
        .getByRole("combobox", { name: "Signing Entity", exact: true })
        .selectOption(entity.id);
      await portal
        .getByRole("textbox", { name: "Owning department", exact: true })
        .fill(procurementName);
    }
    await openForm(portal);
    await answer("Sales supplier", "United States");
    const firstSubmission = portal.waitForResponse(
      (response) =>
        response.request().method() === "POST" &&
        response.url().endsWith(`/auto-docs/${id}/generations`),
    );
    await portal.getByRole("button", { name: "Generate", exact: true }).click();
    const firstResponse = await firstSubmission;
    expect(firstResponse.status()).toBe(201);
    const first = (await firstResponse.json()).generation;
    await expect(portal.getByRole("link", { name: "Download Word", exact: true })).toBeVisible();
    await expect(portal.getByRole("link", { name: "Download PDF", exact: true })).toBeVisible({
      timeout: 30_000,
    });
    const message = await waitForMailDetails(page.request, emails[2]!, new RegExp(name));
    expect(message.attachments.map((attachment) => attachment.filename).sort()).toEqual([
      `${name}.docx`,
      `${name}.pdf`,
    ]);
    const contractResponse = await page.request.get(
      `/api/v1/contracts/${first.createdContract.number}`,
    );
    expect(contractResponse.status()).toBe(200);
    const { contract, team } = await contractResponse.json();
    expect(contract).toMatchObject({
      stage: "draft",
      businessOwner: { id: personIds[2] },
      manager: { id: personIds[0] },
      entity: { id: entity.id },
      owningDepartmentId: departmentIds[1],
    });
    expect(team).toEqual(expect.arrayContaining([expect.objectContaining({ id: personIds[1] })]));
    await portal.goto("/portal/contracts");
    await expect(portal.getByRole("link", { name: contract.title, exact: true })).toBeVisible();
    await page.goto(`/contracts/${contract.number}`);
    await expect(page.getByRole("heading", { name: contract.title, exact: true })).toBeVisible();

    await openForm(portal);
    await answer("Unmatched supplier", "United Kingdom");
    const secondSubmission = portal.waitForResponse(
      (response) =>
        response.request().method() === "POST" &&
        response.url().endsWith(`/auto-docs/${id}/generations`),
    );
    await portal.getByRole("button", { name: "Generate", exact: true }).click();
    const secondResponse = await secondSubmission;
    expect(secondResponse.status()).toBe(201);
    const second = (await secondResponse.json()).generation;
    const secondContract = (
      await (await page.request.get(`/api/v1/contracts/${second.createdContract.number}`)).json()
    ).contract;
    expect(secondContract.manager).toBeNull();
    await lawyer.goto("/inbox?tab=unassigned-contracts");
    const row = lawyer
      .getByRole("row")
      .filter({ has: lawyer.getByRole("link", { name: secondContract.title, exact: true }) });
    await expect(row).toBeVisible();
    await row.getByRole("button", { name: "Claim", exact: true }).click();
    await expect(row).toHaveCount(0);
    expect(
      (await (await lawyer.request.get(`/api/v1/contracts/${secondContract.number}`)).json())
        .contract.manager.id,
    ).toBe(personIds[0]);

    await openForm(portal);
    await answer("Stale supplier", "United States");
    await page.goto(autoDocUrl);
    await page.getByLabel("Word template", { exact: true }).setInputFiles(fixture(2));
    await page.getByRole("button", { name: "Upload template", exact: true }).click();
    await expect(page.getByRole("button", { name: "Open version 2", exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Compare forms", exact: true }).click();
    await expect(
      page
        .getByRole("region", { name: "Version comparisons", exact: true })
        .getByText(/Added confidentiality_period/),
    ).toBeVisible();
    await page.getByRole("link", { name: "Compare files", exact: true }).click();
    await expect(page.getByRole("region", { name: "Compared document", exact: true })).toBeVisible({
      timeout: 180_000,
    });
    await page.getByRole("link", { name: "Close comparison", exact: true }).click();
    await page.getByRole("button", { name: "Publish", exact: true }).click();
    await expect(
      page.getByText("Live: file version 2 and form version 3.", { exact: true }),
    ).toBeVisible();
    const staleSubmission = portal.waitForResponse(
      (response) =>
        response.request().method() === "POST" &&
        response.url().endsWith(`/auto-docs/${id}/generations`),
    );
    await portal.getByRole("button", { name: "Generate", exact: true }).click();
    expect((await staleSubmission).status()).toBe(409);
    await expect(portal.getByRole("alert")).toContainText("changed");
    await expect(
      portal.getByRole("textbox", { name: "Counterparty name", exact: true }),
    ).toHaveValue("Stale supplier");
    await portal.getByRole("button", { name: "Review current form", exact: true }).click();
    await expect(
      portal.getByRole("textbox", { name: "Confidentiality period", exact: true }),
    ).toBeVisible();
    await portal
      .getByRole("textbox", { name: "Confidentiality period", exact: true })
      .fill("24 months");
    const finalSubmission = portal.waitForResponse(
      (response) =>
        response.request().method() === "POST" &&
        response.url().endsWith(`/auto-docs/${id}/generations`),
    );
    await portal.getByRole("button", { name: "Generate", exact: true }).click();
    const finalResponse = await finalSubmission;
    expect(finalResponse.status()).toBe(201);
    const finalGeneration = (await finalResponse.json()).generation;
    expect(finalGeneration).toMatchObject({
      documentVersionNumber: 2,
      formVersionNumber: 3,
      answers: { counterparty_name: "Stale supplier", confidentiality_period: "24 months" },
    });
    expect(finalGeneration.createdContract).not.toBeNull();
    expect(await reportAxeViolations(portal, testInfo, "M35-final-Generation")).toEqual([]);
    await testInfo.attach("M35 final Generation", {
      body: await portal.screenshot({ fullPage: true }),
      contentType: "image/png",
    });
  } finally {
    await Promise.all(
      colleagues.map((colleague) => colleague.context.close().catch(() => undefined)),
    );
    try {
      for (const email of emails) await ensureMemberInert(cleanup, email);
      for (const departmentId of departmentIds)
        expect(
          (
            await cleanup.post(`/api/v1/departments/${departmentId}/archive`, { data: {} })
          ).status(),
        ).toBe(200);
    } finally {
      await cleanup.dispose();
    }
  }
});
