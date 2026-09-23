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

// DD-028: preserve the full destination tree while this journey edits its Rows.
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

test("NDA Branch answers reach the converted Contract and its Portal record", async ({
  page,
  browser,
}) => {
  await signInAs(page, ADMIN.email, ADMIN.password, ADMIN.displayName);
  page.setDefaultTimeout(15_000);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await ensureIntakeDepartment(page.request);
  const types = await page.request.get("/api/v1/contract-types");
  expect(types.status()).toBe(200);
  const nda = z
    .object({ contractTypes: z.array(z.object({ id: z.string(), slug: z.string() })) })
    .parse(await types.json())
    .contractTypes.find((type) => type.slug === "nda");
  expect(nda).toBeDefined();
  const formPath = `/api/v1/contract-types/${nda!.id}/form`;
  const original = await page.request.get(formPath);
  expect(original.status()).toBe(200);
  const savedForm = z.object({ form: z.array(NodeSchema) }).parse(await original.json());
  const run = Date.now();
  const title = `E2E M39 conditional NDA ${run}`;
  const requester = {
    email: `m39-${run}@example.com`,
    displayName: `M39 requester ${run}`,
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
          data: { reply: "M39 journey cleanup" },
        });
        expect(resolved.status(), await resolved.text()).toBe(200);
      }
    });
    await attempt(async () => {
      const restored = await page.request.put(formPath, { data: savedForm });
      expect(restored.status(), await restored.text()).toBe(200);
    });
    await attempt(async () => {
      if (!requestTypeId) return;
      const listed = await page.request.get("/api/v1/request-types");
      expect(listed.status()).toBe(200);
      const replacement = z
        .object({ requestTypes: z.array(z.object({ id: z.string(), slug: z.string() })) })
        .parse(await listed.json())
        .requestTypes.find((type) => type.slug === "nda_request");
      expect(replacement).toBeDefined();
      const archived = await page.request.post(`/api/v1/request-types/${requestTypeId}/archive`, {
        data: { reassignToId: replacement!.id },
      });
      expect(archived.status(), await archived.text()).toBe(200);
    });
    await attempt(() => ensureMemberInert(page.request, requester.email));
    await attempt(async () => member?.context.close());
    if (failures.length) throw new AggregateError(failures, "M39 journey cleanup failed");
  };

  try {
    // Start with built-ins only; restore every prior Field, switch and Branch afterwards.
    const baseline = rows(savedForm.form)
      .filter((row) => row.id === row.rowRef)
      .map((row) =>
        ["title", "contract_type"].includes(row.id)
          ? row
          : { ...row, onIntakeForm: false, isRequired: false },
      );
    const prepared = await page.request.put(formPath, { data: { form: baseline } });
    expect(prepared.status(), await prepared.text()).toBe(200);
    await page.goto(`/settings/contracts/types/${nda!.id}/form`);
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

    const createdType = await page.request.post("/api/v1/request-types", {
      data: { displayName: `M39 NDA ${run}` },
    });
    expect(createdType.status(), await createdType.text()).toBe(201);
    const requestType = z
      .object({ requestType: z.object({ id: z.string(), slug: z.string() }) })
      .parse(await createdType.json()).requestType;
    requestTypeId = requestType.id;
    const targeted = await page.request.patch(`/api/v1/request-types/${requestType.id}`, {
      data: { targetModule: "contract", targetTypeId: nda!.id },
    });
    expect(targeted.status(), await targeted.text()).toBe(200);
    await page.goto(`/settings/intake/request-types/${requestType.id}`);
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
    await expect(portal.getByText("Expiry date is required.", { exact: true })).toBeVisible();
    await portal.getByLabel("Expiry date").fill("2030-12-31");
    await portal.getByLabel(/^Governing law/).fill("England and Wales");
    await portal.getByLabel("Term type").selectOption("evergreen");
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
  } catch (error) {
    await sweepOrSay("M39", cleanup);
    throw error;
  }
  await cleanup();
});

async function saveForm(page: Page, path: string, change: () => Promise<void>) {
  const saved = page.waitForResponse(
    (response) => response.url().endsWith(path) && response.request().method() === "PUT",
  );
  await change();
  const response = await saved;
  expect(response.status(), await response.text()).toBe(200);
}
