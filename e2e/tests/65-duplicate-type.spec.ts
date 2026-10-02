// SPDX-License-Identifier: AGPL-3.0-only

import { expect, test, type Page } from "@playwright/test";
import { z } from "zod";
import {
  ADMIN,
  ensureAdminExists,
  ensureIntakeDepartment,
  ensureMemberInert,
  onboardActivatedMember,
  signInAs,
  sweepOrSay,
} from "./helpers.js";

// Keep the complete Form when preparing the source type.
type Node = Record<string, unknown> & {
  kind: "row" | "branch";
  id: string;
  rowRef?: string;
  children?: Node[];
};
const NodeSchema: z.ZodType<Node> = z.looseObject({
  kind: z.enum(["row", "branch"]),
  id: z.string(),
  rowRef: z.string().optional(),
  get children(): z.ZodOptional<z.ZodArray<typeof NodeSchema>> {
    return z.array(NodeSchema).optional();
  },
});
function rows(nodes: Node[]): Node[] {
  return nodes.flatMap((node) => (node.kind === "branch" ? rows(node.children!) : [node]));
}

test.beforeAll(async ({ request }) => ensureAdminExists(request));
test.setTimeout(180_000);

test("Duplicate preserves the Form through Portal submission and Contract conversion", async ({
  page,
  browser,
}) => {
  await signInAs(page, ADMIN.email, ADMIN.password, ADMIN.displayName);
  page.setDefaultTimeout(15_000);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await ensureIntakeDepartment(page.request);
  const run = Date.now();
  const sourceName = `E2E duplicate NDA ${run}`;
  const renamed = `E2E copied NDA ${run}`;
  const title = `E2E copied Form request ${run}`;
  let sourceId: string | undefined;
  let copyId: string | undefined;
  let groupId: string | undefined;
  const requester = {
    email: `duplicate-${run}@example.com`,
    displayName: `Duplicate requester ${run}`,
    password: "correct-horse-battery",
    role: "business_user",
  };
  let member: Awaited<ReturnType<typeof onboardActivatedMember>> | undefined;
  let requestNumber: number | undefined;
  let contractNumber: number | undefined;
  let requestTypeId: string | undefined;

  const cleanup = async () => {
    const failures: unknown[] = [];
    const attempt = async (action: () => Promise<unknown>) => {
      try {
        await action();
      } catch (error) {
        failures.push(error);
      }
    };
    await attempt(async () => {
      if (contractNumber !== undefined) {
        const archived = await page.request.post(`/api/v1/contracts/${contractNumber}/archive`);
        expect(archived.status(), await archived.text()).toBe(200);
      } else if (requestNumber !== undefined) {
        const resolved = await page.request.post(`/api/v1/requests/${requestNumber}/resolve`, {
          data: { reply: "Duplicate journey cleanup" },
        });
        expect(resolved.status(), await resolved.text()).toBe(200);
      }
    });
    await attempt(async () => {
      if (!requestTypeId) return;
      let replacementId: string | undefined;
      if (requestNumber !== undefined) {
        const listed = await page.request.get("/api/v1/request-types");
        expect(listed.status()).toBe(200);
        replacementId = z
          .object({ requestTypes: z.array(z.object({ id: z.string() })) })
          .parse(await listed.json())
          .requestTypes.find((type) => type.id !== requestTypeId)?.id;
        // Retained Requests need a live type even on a Start blank install.
        if (!replacementId) {
          const created = await page.request.post("/api/v1/request-types", {
            data: { displayName: "E2E retained Requests" },
          });
          expect(created.status(), await created.text()).toBe(201);
          replacementId = z
            .object({ requestType: z.object({ id: z.string() }) })
            .parse(await created.json()).requestType.id;
        }
      }
      const archived = await page.request.post(`/api/v1/request-types/${requestTypeId}/archive`, {
        data: replacementId ? { reassignToId: replacementId } : {},
      });
      expect(archived.status(), await archived.text()).toBe(200);
    });
    for (const id of [copyId, sourceId]) {
      await attempt(async () => {
        if (!id) return;
        const listed = await page.request.get("/api/v1/contract-types");
        expect(listed.status()).toBe(200);
        const replacement = z
          .object({ contractTypes: z.array(z.object({ id: z.string(), isDefault: z.boolean() })) })
          .parse(await listed.json())
          .contractTypes.find((type) => type.isDefault);
        expect(replacement).toBeDefined();
        const archived = await page.request.post(`/api/v1/contract-types/${id}/archive`, {
          data: { reassignToId: replacement!.id },
        });
        expect(archived.status(), await archived.text()).toBe(200);
      });
    }
    await attempt(async () => {
      if (!groupId) return;
      const archived = await page.request.post(`/api/v1/approver-groups/${groupId}/archive`);
      expect(archived.status(), await archived.text()).toBe(200);
    });
    await attempt(() => ensureMemberInert(page.request, requester.email));
    await attempt(async () => member?.context.close());
    if (failures.length) throw new AggregateError(failures, "Duplicate journey cleanup failed");
  };

  try {
    const created = await page.request.post("/api/v1/contract-types", {
      data: { displayName: sourceName },
    });
    expect(created.status(), await created.text()).toBe(201);
    sourceId = z.object({ contractType: z.object({ id: z.string() }) }).parse(await created.json())
      .contractType.id;
    const formPath = `/api/v1/contract-types/${sourceId}/form`;
    const original = await page.request.get(formPath);
    expect(original.status()).toBe(200);
    const savedForm = z.object({ form: z.array(NodeSchema) }).parse(await original.json());
    const group = await page.request.post("/api/v1/approver-groups", {
      data: { name: `E2E duplicate approvers ${run}` },
    });
    expect(group.status(), await group.text()).toBe(201);
    groupId = z.object({ approverGroup: z.object({ id: z.string() }) }).parse(await group.json())
      .approverGroup.id;
    const approval = await page.request.put(`/api/v1/contract-types/${sourceId}/approval-default`, {
      data: { groupId },
    });
    expect(approval.status(), await approval.text()).toBe(200);
    await page.goto(`/settings/contracts/types/${sourceId}/people`);
    await page
      .getByLabel("Default person", { exact: true })
      .selectOption({ label: ADMIN.displayName });
    const added = page.waitForResponse(
      (response) =>
        response.url().endsWith(`/contract-types/${sourceId}/people`) &&
        response.request().method() === "POST",
    );
    await page.getByRole("button", { name: "Add person", exact: true }).click();
    expect((await added).status()).toBe(201);
    await expect(page.getByRole("list", { name: "Default people" })).toContainText(
      ADMIN.displayName,
    );
    await page.getByRole("link", { name: "Approval defaults", exact: true }).click();
    await expect(page.getByLabel("Approver group", { exact: true })).toHaveValue(groupId);

    // Keep optional built-ins off intake so this fixture asks only its own questions.
    const baseline = rows(savedForm.form)
      .filter((row) => row.id === row.rowRef)
      .map((row) =>
        ["title", "contract_type"].includes(row.id)
          ? row
          : { ...row, onIntakeForm: false, isRequired: false },
      );
    const prepared = await page.request.put(formPath, { data: { form: baseline } });
    expect(prepared.status(), await prepared.text()).toBe(200);
    await page.goto(`/settings/contracts/types/${sourceId}/form`);
    for (const name of ["Term type", "Expiry date"]) {
      const control = page.getByRole("switch", { name: `${name}: On intake form`, exact: true });
      if (!(await control.isChecked())) await saveForm(page, formPath, () => control.check());
    }
    if (!(await page.getByRole("group", { name: "Governing law", exact: true }).count())) {
      await page.getByRole("button", { name: "Attach Field", exact: true }).click();
      await saveForm(page, formPath, async () => {
        await page.getByRole("menuitem", { name: /Governing law/ }).click();
      });
    }
    for (const name of [
      "Governing law: On intake form",
      "Governing law: Required for creation",
      "Expiry date: Required for creation",
    ]) {
      const control = page.getByRole("switch", { name, exact: true });
      if (!(await control.isChecked())) await saveForm(page, formPath, () => control.check());
    }
    await expect(
      page.getByRole("switch", { name: "Governing law: Visible on Portal" }),
    ).toBeChecked();
    await page.getByRole("button", { name: "Add condition", exact: true }).click();
    await page.getByRole("combobox", { name: "Row", exact: true }).selectOption("term_type");
    await saveForm(page, formPath, async () => {
      await page.getByRole("combobox", { name: "Value", exact: true }).selectOption("fixed");
    });
    for (const name of ["Expiry date", "Governing law"]) {
      await page.getByRole("button", { name: `Move ${name}`, exact: true }).click();
      await page.getByRole("menuitem", { name: "Put under a condition…", exact: true }).click();
      await saveForm(page, formPath, async () => {
        await page
          .getByRole("button", { name: "Show when all of: Term type is Fixed", exact: true })
          .click();
      });
    }
    await page.reload();
    const branch = page.getByRole("group", {
      name: "Children of Show when all of: Term type is Fixed",
      exact: true,
    });
    await expect(branch.getByRole("group", { name: "Governing law", exact: true })).toBeVisible();

    const sourceForm = await formControls(page);
    await page.getByRole("button", { name: "Preview intake form", exact: true }).click();
    const preview = page.getByRole("dialog");
    await expect(preview.getByLabel("Expiry date")).toHaveCount(0);
    await preview.getByLabel("Term type").selectOption("fixed");
    await expect(preview.getByLabel("Expiry date")).toBeVisible();
    await preview.getByLabel("Term type").selectOption("evergreen");
    await expect(preview.getByLabel("Expiry date")).toHaveCount(0);
    await page.keyboard.press("Escape");
    await expect(preview).toBeHidden();

    await page.goto("/settings/contracts/types");
    const duplicated = page.waitForResponse(
      (response) =>
        response.url().endsWith(`/contract-types/${sourceId}/duplicate`) &&
        response.request().method() === "POST",
    );
    await page.getByRole("button", { name: `Duplicate ${sourceName}`, exact: true }).click();
    const duplicateResponse = await duplicated;
    expect(duplicateResponse.status(), await duplicateResponse.text()).toBe(201);
    copyId = z
      .object({ contractType: z.object({ id: z.string() }) })
      .parse(await duplicateResponse.json()).contractType.id;
    await expect(page).toHaveURL(`/settings/contracts/types/${copyId}`);
    await expect(page.getByLabel("Display name", { exact: true })).toHaveValue(
      `${sourceName} (copy)`,
    );
    await page.getByRole("link", { name: "All types", exact: true }).click();
    await expect(page.getByRole("button", { name: /^Duplicate / }).last()).toHaveAccessibleName(
      `Duplicate ${sourceName} (copy)`,
    );
    await page.getByRole("button", { name: `Edit ${sourceName} (copy)`, exact: true }).click();
    await page.getByRole("link", { name: "Form", exact: true }).click();
    await expect(branch.getByRole("group", { name: "Governing law", exact: true })).toBeVisible();
    expect(await formControls(page)).toEqual(sourceForm);
    await page.getByRole("link", { name: "People", exact: true }).click();
    await expect(page.getByRole("heading", { name: "People", exact: true })).toBeVisible();
    await expect(page.getByText("No default people.", { exact: true })).toBeVisible();
    await expect(
      page.getByRole("list", { name: "Default people" }).getByRole("listitem"),
    ).toHaveCount(0);
    await page.getByRole("link", { name: "Approval defaults", exact: true }).click();
    await expect(
      page.getByRole("heading", { name: "Default approver group", exact: true }),
    ).toBeVisible();
    const approverGroup = page.getByLabel("Approver group", { exact: true });
    await expect(approverGroup).toBeEnabled();
    await expect(approverGroup).toHaveValue("");
    await expect(
      approverGroup.getByRole("option", {
        name: "No default group",
        exact: true,
        selected: true,
      }),
    ).toHaveText("No default group");
    await page.getByRole("link", { name: "Details", exact: true }).click();
    await page.getByLabel("Display name", { exact: true }).fill(renamed);
    await saveChange(page, `/api/v1/contract-types/${copyId}`, "PATCH", () =>
      page.getByLabel("Display name", { exact: true }).press("Tab"),
    );
    await page.reload();
    await expect(page.getByLabel("Display name", { exact: true })).toHaveValue(renamed);

    const createdType = await page.request.post("/api/v1/request-types", {
      data: { displayName: `Duplicate NDA ${run}` },
    });
    expect(createdType.status(), await createdType.text()).toBe(201);
    const requestType = z
      .object({ requestType: z.object({ id: z.string(), slug: z.string() }) })
      .parse(await createdType.json()).requestType;
    requestTypeId = requestType.id;
    await page.goto(`/settings/intake/request-types/${requestType.id}`);
    const destination = page.getByLabel("Default destination", { exact: true });
    if ((await destination.inputValue()) !== "contract") {
      await saveChange(page, `/api/v1/request-types/${requestType.id}`, "PATCH", () =>
        destination.selectOption("contract"),
      );
    }
    await saveChange(page, `/api/v1/request-types/${requestType.id}`, "PATCH", () =>
      page.getByLabel("Default contract type", { exact: true }).selectOption(copyId!),
    );
    await page.reload();
    await expect(page.getByLabel("Default contract type", { exact: true })).toHaveValue(copyId);
    await expect(page.getByRole("heading", { name: "Intake form", exact: true })).toBeVisible();
    await expect(
      page.getByText("Show when all of: Term type is Fixed", { exact: true }),
    ).toBeVisible();

    member = await onboardActivatedMember(page.request, browser, requester);
    const portal = member.page;
    portal.setDefaultTimeout(15_000);
    await portal.goto(`/portal/new/${requestType.slug}`);
    await portal.getByLabel("Title").fill(title);
    await expect(portal.getByLabel("Expiry date")).toHaveCount(0);
    await expect(portal.getByLabel(/^Governing law/)).toHaveCount(0);
    await portal.getByLabel("Term type").selectOption("fixed");
    await portal.getByRole("button", { name: "Submit request", exact: true }).click();
    // Expiry date and Governing law are both required once Term type is Fixed.
    await expect(portal.getByText("Answer this before you submit.", { exact: true })).toHaveCount(
      2,
    );
    // A Date Field is the month calendar, so the date is picked, not typed.
    await portal.getByLabel("Expiry date").click();
    const calendar = portal.getByRole("dialog", { name: "Choose a date" });
    await calendar.getByRole("combobox", { name: "Year", exact: true }).selectOption("2030");
    await calendar.getByRole("combobox", { name: "Month", exact: true }).selectOption("11");
    await calendar.getByRole("button", { name: /December 31st, 2030/ }).click();
    await expect(portal.getByLabel("Expiry date")).toHaveText("Dec 31, 2030");
    await portal.getByLabel(/^Governing law/).fill("England and Wales");
    await portal.getByLabel("Term type").selectOption("evergreen");
    await expect(portal.getByLabel("Expiry date")).toHaveCount(0);
    await expect(portal.getByLabel(/^Governing law/)).toHaveCount(0);
    await portal.getByLabel("Term type").selectOption("fixed");
    await expect(portal.getByLabel(/^Governing law/)).toHaveValue("England and Wales");
    const submitted = portal.waitForResponse(
      (response) =>
        response.url().endsWith("/api/v1/requests") && response.request().method() === "POST",
    );
    await portal.getByRole("button", { name: "Submit request", exact: true }).click();
    const response = await submitted;
    expect(response.status(), await response.text()).toBe(201);
    requestNumber = z
      .object({ request: z.object({ number: z.number() }) })
      .parse(await response.json()).request.number;

    await page.goto(`/inbox/${requestNumber}`);
    await page.getByRole("button", { name: "Triage", exact: true }).click();
    await page.getByRole("menuitem", { name: "Convert to contract", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: `Convert R-${requestNumber} to a contract` });
    await expect(dialog.getByRole("button", { name: "Expiry date", exact: true })).toHaveText(
      "Dec 31, 2030",
    );
    await expect(dialog.getByLabel(/^Governing law/)).toHaveValue("England and Wales");
    await dialog.getByRole("button", { name: "Convert to contract", exact: true }).click();
    await expect(dialog).toBeHidden();
    const link = page
      .getByRole("region", { name: "Status", exact: true })
      .getByRole("link", { name: /^C-\d+$/ });
    contractNumber = Number((await link.innerText()).slice(2));
    await link.click();
    await expect(page.getByRole("heading", { name: title, exact: true })).toBeVisible();
    await expect(page.getByLabel("Contract type", { exact: true })).toHaveValue(copyId);
    await expect(page.getByRole("button", { name: "Expiry date", exact: true })).toHaveText(
      "Dec 31, 2030",
    );
    await page.goto(`/contracts/${contractNumber}/fields`);
    await expect(page.getByLabel(/^Governing law/)).toHaveValue("England and Wales");
    await portal.goto(`/portal/requests/${requestNumber}`);
    await expect(portal).toHaveURL(`/portal/contracts/${contractNumber}`);
    const fields = portal.getByRole("region", { name: "Fields", exact: true });
    await expect(fields.getByText("Governing law", { exact: true })).toBeVisible();
    await expect(fields.getByText("England and Wales", { exact: true })).toBeVisible();
    await expect(fields.getByRole("textbox")).toHaveCount(0);
    await page.goto("/documentation/types-statuses-fields#add-and-maintain-types");
    await expect(
      page.getByRole("heading", { name: "Add and maintain types", exact: true }),
    ).toBeVisible();
    const duplicateGuide = page.getByText("select Duplicate beside Archive", { exact: false });
    await expect(duplicateGuide).toContainText('" (copy)"');
    await expect(duplicateGuide).toContainText("Rows, switches, and Branches");
    await expect(duplicateGuide).toContainText(
      "default people, default approver group, Request types, records, Auto-Docs, and Matter templates stay on the source",
    );
    await expect(duplicateGuide).toContainText("Default type creates a plain type");
    await expect(duplicateGuide).toContainText("Restore an archived type before duplicating it");
  } catch (error) {
    await sweepOrSay("Duplicate type", cleanup);
    throw error;
  }
  await cleanup();
});

async function formControls(page: Page) {
  const form = page.getByRole("region", { name: "Form", exact: true });
  return form
    .getByRole("group")
    .or(form.getByRole("switch"))
    .evaluateAll((elements) =>
      elements.map((element) => ({
        role: element.getAttribute("role"),
        name: element.getAttribute("aria-label"),
        checked: element.getAttribute("aria-checked"),
        disabled: element.hasAttribute("disabled"),
      })),
    );
}

async function saveForm(page: Page, path: string, change: () => Promise<unknown>) {
  await saveChange(page, path, "PUT", change);
}

async function saveChange(
  page: Page,
  path: string,
  method: string,
  change: () => Promise<unknown>,
) {
  const saved = page.waitForResponse(
    (response) => response.url().endsWith(path) && response.request().method() === method,
  );
  await change();
  const response = await saved;
  expect(response.status(), await response.text()).toBe(200);
}
