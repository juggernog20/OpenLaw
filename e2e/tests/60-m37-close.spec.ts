// SPDX-License-Identifier: AGPL-3.0-only

import { expect, test } from "@playwright/test";
import { z } from "zod";
import { ADMIN, ensureAdminExists, signInAs } from "./helpers.js";

const Connector = z.object({
  connector: z.object({
    configured: z.boolean(),
    answerStyle: z.enum(["few_words", "sentence", "full_clause"]),
  }),
});
const CreatedField = z.object({ field: z.object({ id: z.string() }) });

test.beforeAll(async ({ request }) => ensureAdminExists(request));

test("M37: an Administrator chooses an Answer style and a Field override, reads the fixed format, and sees type restrictions", async ({
  page,
}) => {
  test.setTimeout(90_000);
  await signInAs(page, ADMIN.email, ADMIN.password, ADMIN.displayName);
  const api = page.request;
  const initial = await api.get("/api/v1/ai-connector");
  expect(initial.status(), await initial.text()).toBe(200);
  const original = Connector.parse(await initial.json()).connector;
  const fields: string[] = [];
  const suffix = Date.now();
  const names = {
    long_text: `M37 clause ${suffix}`,
    text: `M37 position ${suffix}`,
    user: `M37 contact ${suffix}`,
  };

  try {
    // This journey configures styles without sending an extraction to a provider.
    if (!original.configured) {
      const configured = await api.put("/api/v1/ai-connector", {
        data: { preset: "ollama", model: "m37-journey" },
      });
      expect(configured.status(), await configured.text()).toBe(200);
    }
    const reset = await api.patch("/api/v1/ai-connector", { data: { answerStyle: "sentence" } });
    expect(reset.status(), await reset.text()).toBe(200);
    for (const fieldType of ["long_text", "text", "user"] as const) {
      const created = await api.post("/api/v1/fields", {
        data: {
          moduleScope: "contract",

          displayName: names[fieldType],
          fieldType,
          ...(fieldType === "user" ? {} : { aiPrompt: "Find the termination position." }),
        },
      });
      expect(created.status(), await created.text()).toBe(201);
      fields.push(CreatedField.parse(await created.json()).field.id);
    }

    await page.goto("/settings/general");
    const rail = page.getByRole("navigation", { name: "Settings sections" });
    await rail.getByRole("link", { name: "AI analysis", exact: true }).click();
    await expect(page).toHaveURL(/\/settings\/ai-analysis$/);
    await page.getByRole("button", { name: "Answer style", exact: true }).click();
    const styleCard = page.getByRole("region", { name: "Answer style", exact: true });
    const saved = page.waitForResponse(
      (response) =>
        response.url().endsWith("/api/v1/ai-connector") && response.request().method() === "PATCH",
    );
    await styleCard.getByRole("radio", { name: "Few word summary", exact: true }).click();
    expect((await saved).status()).toBe(200);
    await expect(
      styleCard.getByRole("radio", { name: "Few word summary", exact: true }),
    ).toBeChecked();
    await page.reload();
    await page.getByRole("button", { name: "Answer style", exact: true }).click();
    await expect(
      styleCard.getByRole("radio", { name: "Few word summary", exact: true }),
    ).toBeChecked();

    await page.getByRole("button", { name: "Contract analysis prompts", exact: true }).click();
    const prompts = page.getByRole("region", { name: "Contract analysis prompts", exact: true });
    const datePrompt = prompts.getByRole("textbox", { name: "Effective date prompt", exact: true });
    await expect(datePrompt).toBeEditable();
    await expect(prompts.getByText("Return a date as YYYY-MM-DD.", { exact: true })).toHaveCount(0);

    await prompts.getByRole("link", { name: "Contracts → Fields", exact: true }).click();
    await expect(page).toHaveURL(/\/settings\/contracts\/fields$/);
    await page.getByRole("button", { name: `Edit ${names.long_text}`, exact: true }).click();
    const dialog = page.getByRole("dialog");
    const style = dialog.getByRole("combobox", { name: "Answer style", exact: true });
    await expect(
      style.getByRole("option", { name: "Organisation default (Few word summary)", exact: true }),
    ).toHaveCount(1);
    await style.selectOption({ label: "Full clause text" });
    const fieldSaved = page.waitForResponse(
      (response) =>
        response.url().endsWith(`/api/v1/fields/${fields[0]!}`) &&
        response.request().method() === "PATCH",
    );
    await dialog.getByRole("button", { name: "Save", exact: true }).click();
    expect((await fieldSaved).status()).toBe(200);
    await expect(dialog).toBeHidden();
    await page.reload();
    await page.getByRole("button", { name: `Edit ${names.long_text}`, exact: true }).click();
    await expect(style).toHaveValue("full_clause");
    await dialog.getByRole("button", { name: "Cancel", exact: true }).click();

    await page.getByRole("button", { name: `Edit ${names.text}`, exact: true }).click();
    await expect(
      style.getByRole("option", { name: "Full clause text", exact: true }),
    ).toBeDisabled();
    await style.hover();
    await expect(dialog.getByRole("tooltip")).toHaveText(
      "Full clause text needs a long text Field.",
    );
    await expect(dialog.getByRole("tooltip")).toBeVisible();
    await dialog.getByRole("button", { name: "Cancel", exact: true }).click();

    await page.getByRole("button", { name: `Edit ${names.user}`, exact: true }).click();
    await expect(dialog).toBeVisible();
    await expect(dialog.getByLabel("AI prompt", { exact: true })).toHaveCount(0);
    await expect(style).toHaveCount(0);
    await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
  } finally {
    const cleanup = await Promise.allSettled([
      ...fields.map(async (id) => {
        const archived = await api.post(`/api/v1/fields/${id}/archive`);
        expect(archived.status(), await archived.text()).toBe(200);
      }),
      (async () => {
        const restored = original.configured
          ? await api.patch("/api/v1/ai-connector", { data: { answerStyle: original.answerStyle } })
          : await api.delete("/api/v1/ai-connector");
        expect(restored.status(), await restored.text()).toBe(200);
      })(),
    ]);
    expect(cleanup.filter((result) => result.status === "rejected")).toEqual([]);
  }
});
