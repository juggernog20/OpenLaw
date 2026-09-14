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
    const typesResponse = await page.request.get("/api/v1/entities/types");
    expect(typesResponse.status(), await typesResponse.text()).toBe(200);
    const entityTypes = (await typesResponse.json()).entityTypes;
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
    async function upload(version: number) {
      await page.getByRole("button", { name: "Upload version", exact: true }).click();
      const dialog = page.getByRole("dialog");
      await dialog.getByLabel("Word template", { exact: true }).setInputFiles(fixture(version));
      await dialog.getByRole("button", { name: "Upload", exact: true }).click();
      await expect(dialog.getByRole("status")).toContainText(`File version ${version}`);
      await dialog.getByRole("button", { name: "Close", exact: true }).click();
    }
    async function publish() {
      await page.getByRole("button", { name: "Publish", exact: true }).first().click();
      const dialog = page.getByRole("dialog");
      await dialog.getByRole("button", { name: "Publish", exact: true }).click();
      await expect(dialog).toHaveCount(0);
    }
    await page.getByRole("link", { name: "Form", exact: true }).click();
    await upload(1);
    const fields = page.getByRole("region", { name: "Fields", exact: true });
    await fields.getByRole("button", { name: "Edit Counterparty name", exact: true }).click();
    const counterparty = page.getByRole("region", { name: "Counterparty name", exact: true });
    await counterparty.getByRole("checkbox", { name: "Required", exact: true }).click();
    await expect(
      counterparty.getByRole("checkbox", { name: "Required", exact: true }),
    ).toBeChecked();
    await counterparty
      .getByRole("combobox", { name: "Map to", exact: true })
      .selectOption("attribute:primary_counterparty_name");
    await expect(
      fields.getByText("counterparty_name · Text · Primary Counterparty name", { exact: true }),
    ).toBeVisible();
    async function addField(slug: string, label: string, fieldType: string) {
      await fields.getByRole("button", { name: "Add field", exact: true }).click();
      const fresh = page.getByRole("region", { name: "New field", exact: true });
      await fresh.getByLabel("Slug", { exact: true }).fill(slug);
      await fresh.getByLabel("Slug", { exact: true }).press("Enter");
      await expect(fields.getByText(`${slug} · Text`, { exact: true })).toBeVisible();
      await fresh.getByLabel("Label", { exact: true }).fill(label);
      await fresh.getByLabel("Label", { exact: true }).press("Enter");
      const field = page.getByRole("region", { name: label, exact: true });
      await expect(field).toBeVisible();
      await field.getByRole("combobox", { name: "Type", exact: true }).selectOption(fieldType);
      await expect(field.getByRole("combobox", { name: "Type", exact: true })).toHaveValue(
        fieldType,
      );
      return field;
    }
    const jurisdiction = await addField("jurisdiction", "Jurisdiction", "single_select");
    await jurisdiction.getByLabel("Options", { exact: true }).fill("United States\nUnited Kingdom");
    await jurisdiction.getByLabel("Options", { exact: true }).blur();
    await expect(fields.getByText("jurisdiction · Single select", { exact: true })).toBeVisible();
    const signingEntity = await addField("signing_entity", "Signing Entity", "entity");
    await signingEntity
      .getByRole("combobox", { name: "Map to", exact: true })
      .selectOption("attribute:entity_id");
    await expect(
      fields.getByText("signing_entity · Entity · Our Entity", { exact: true }),
    ).toBeVisible();
    const owningDepartment = await addField("owning_department", "Owning department", "text");
    await owningDepartment
      .getByRole("combobox", { name: "Map to", exact: true })
      .selectOption("attribute:owning_department_id");
    await expect(
      fields.getByText("owning_department · Text · Owning department", { exact: true }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Edit the rule for arbitration", exact: true }).click();
    const clause = page.getByRole("region", { name: "arbitration", exact: true });
    await clause
      .getByRole("combobox", { name: "Include", exact: true })
      .selectOption("conditional");
    await clause
      .getByRole("combobox", { name: "Form field", exact: true })
      .selectOption("jurisdiction");
    await clause.getByRole("combobox", { name: "Operator", exact: true }).selectOption("equals");
    await clause
      .getByRole("combobox", { name: "Value", exact: true })
      .selectOption("United States");
    await expect(
      page.getByText("Included when Jurisdiction equals United States", { exact: true }),
    ).toBeVisible();
    await page.getByRole("link", { name: "Settings", exact: true }).click();
    const creation = page.getByRole("region", { name: "Contract creation", exact: true });
    await creation
      .getByRole("combobox", { name: "Target Contract Type", exact: true })
      .selectOption(contractTypeId);
    await creation
      .getByLabel("Title pattern", { exact: true })
      .fill(`${name} - {{counterparty_name}}`);
    await creation.getByLabel("Title pattern", { exact: true }).press("Enter");
    const assignment = page.getByRole("region", { name: "Assignment rules", exact: true });
    await assignment.getByRole("button", { name: "Add rule", exact: true }).click();
    const ruleDialog = page.getByRole("dialog");
    await ruleDialog
      .getByRole("combobox", { name: "Form field", exact: true })
      .selectOption("jurisdiction");
    await ruleDialog
      .getByRole("combobox", { name: "Operator", exact: true })
      .selectOption("equals");
    await ruleDialog
      .getByRole("combobox", { name: "Value", exact: true })
      .selectOption("United States");
    await ruleDialog
      .getByRole("combobox", { name: "Legal Owner", exact: true })
      .selectOption(personIds[0]!);
    await ruleDialog.getByRole("button", { name: "Save", exact: true }).click();
    await expect(
      assignment.getByText("Jurisdiction equals United States", { exact: true }),
    ).toBeVisible();
    const reach = page.getByRole("region", { name: "Reach", exact: true });
    await reach.getByRole("combobox", { name: "Audience", exact: true }).selectOption("selected");
    await reach
      .getByRole("listbox", { name: "Departments", exact: true })
      .selectOption(departmentIds[0]!);
    await page
      .getByRole("region", { name: "Output", exact: true })
      .getByRole("combobox", { name: "Formats", exact: true })
      .selectOption("both");
    const acknowledgement = page.getByRole("region", { name: "Acknowledgement", exact: true });
    await acknowledgement
      .getByRole("combobox", { name: "Frequency", exact: true })
      .selectOption("every_use");
    await acknowledgement.getByRole("radio", { name: "Custom text", exact: true }).check();
    const ackText = acknowledgement.getByRole("textbox", {
      name: "Acknowledgement text",
      exact: true,
    });
    await ackText.fill("Do not edit the generated NDA. Ask Legal for changes.");
    await ackText.blur();
    await expect(acknowledgement.getByText("Saved", { exact: true }).last()).toBeVisible();
    await publish();
    await page.getByRole("link", { name: "Overview", exact: true }).click();
    await expect(
      page.getByText(/^Live since .*: file version 1, form version \d+\.$/),
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
    await row.getByRole("button", { name: /^Assign / }).click();
    await lawyer.getByRole("dialog").getByRole("radio", { name: lawyerName, exact: true }).check();
    await lawyer
      .getByRole("dialog")
      .getByRole("button", { name: "Save assignment", exact: true })
      .click();
    await expect(row).toHaveCount(0);
    expect(
      (await (await lawyer.request.get(`/api/v1/contracts/${secondContract.number}`)).json())
        .contract.manager.id,
    ).toBe(personIds[0]);

    await openForm(portal);
    await answer("Stale supplier", "United States");
    await page.goto(`${autoDocUrl}/form`);
    await upload(2);
    await expect(page.getByText("File version 2", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Compare versions", exact: true }).click();
    await expect(page.getByRole("dialog").getByText(/Added confidentiality_period/)).toBeVisible();
    await page.getByRole("dialog").getByRole("button", { name: "Close", exact: true }).click();
    await page.getByRole("link", { name: "Compare files", exact: true }).click();
    await expect(page.getByRole("region", { name: "Compared document", exact: true })).toBeVisible({
      timeout: 180_000,
    });
    await page.getByRole("link", { name: "Close comparison", exact: true }).click();
    await page.getByRole("button", { name: "Auto-Doc actions", exact: true }).click();
    await page.getByRole("menuitem", { name: "Publish new pair", exact: true }).click();
    const republish = page.getByRole("dialog");
    await republish.getByRole("button", { name: "Publish", exact: true }).click();
    await expect(republish).toHaveCount(0);
    await page.getByRole("link", { name: "Overview", exact: true }).click();
    await expect(
      page.getByText(/^Live since .*: file version 2, form version \d+\.$/),
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
      answers: { counterparty_name: "Stale supplier", confidentiality_period: "24 months" },
    });
    // Every builder commit wrote a form version, so the number is not
    // fixed; what matters is that the re-upload's form went live.
    expect(finalGeneration.formVersionNumber).toBeGreaterThan(first.formVersionNumber);
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
    // Members first: the executive holds the Sales Department. Each sweep
    // runs whatever the earlier one did, so one failed step never leaves
    // the never-reset instance (TECH-018) with a live per-run Department.
    try {
      for (const email of emails) await ensureMemberInert(cleanup, email);
    } finally {
      try {
        for (const departmentId of departmentIds) {
          const archived = await cleanup.post(`/api/v1/departments/${departmentId}/archive`, {
            data: {},
          });
          expect(archived.status(), await archived.text()).toBe(200);
        }
      } finally {
        await cleanup.dispose();
      }
    }
  }
});
