// SPDX-License-Identifier: AGPL-3.0-only

import { expect, test } from "@playwright/test";
import { ADMIN, ensureAdminExists, signInAs } from "./helpers.js";

test("Answer style saves on choice and survives reload", async ({ page, request }) => {
  await ensureAdminExists(request);
  await signInAs(page, ADMIN.email, ADMIN.password, ADMIN.displayName);
  const initialResponse = await page.request.get("/api/v1/ai-connector");
  expect(initialResponse.ok()).toBe(true);
  const initial = (await initialResponse.json()).connector as {
    configured: boolean;
    answerStyle: string;
  };
  if (!initial.configured) {
    const saved = await page.request.put("/api/v1/ai-connector", {
      data: { preset: "ollama", model: "answer-style-browser-test" },
    });
    expect(saved.ok()).toBe(true);
  }
  try {
    const baseline = await page.request.patch("/api/v1/ai-connector", {
      data: { answerStyle: "sentence" },
    });
    expect(baseline.ok()).toBe(true);
    await page.goto("/settings/ai-analysis");
    await expect(page.getByRole("heading", { name: "System prompts" })).toHaveCount(0);
    for (const [value, label] of [
      ["few_words", "Few word summary"],
      ["full_clause", "Full clause text"],
      ["sentence", "1-2 sentence summary"],
    ]) {
      await page.getByRole("button", { name: "Answer style", exact: true }).click();
      const card = page.getByRole("region", { name: "Answer style", exact: true });
      await card.getByRole("radio", { name: label, exact: true }).click();
      await expect(card.getByText("Saved", { exact: true })).toBeVisible();
      await page.reload();
      await page.getByRole("button", { name: "Answer style", exact: true }).click();
      await expect(card.getByRole("radio", { name: label, exact: true })).toBeChecked();
      const saved = await page.request.get("/api/v1/ai-connector");
      expect((await saved.json()).connector.answerStyle).toBe(value);
      await page.getByRole("button", { name: "Answer style", exact: true }).click();
    }
  } finally {
    if (initial.configured) {
      const restored = await page.request.patch("/api/v1/ai-connector", {
        data: { answerStyle: initial.answerStyle },
      });
      expect(restored.ok()).toBe(true);
    } else {
      const removed = await page.request.delete("/api/v1/ai-connector");
      expect(removed.ok()).toBe(true);
    }
  }
});

test("Field answer style survives reload and explains the short text restriction", async ({
  page,
  request,
}) => {
  await ensureAdminExists(request);
  await signInAs(page, ADMIN.email, ADMIN.password, ADMIN.displayName);
  const created: { id: string; displayName: string }[] = [];
  try {
    for (const fieldType of ["long_text", "text"]) {
      const response = await page.request.post("/api/v1/fields", {
        data: {
          displayName: `Style ${fieldType} ${Date.now()}`,
          moduleScope: "contract",
          fieldType,
          aiPrompt: "Extract the provision.",
        },
      });
      expect(response.ok()).toBe(true);
      created.push((await response.json()).field);
    }
    const [longField, shortField] = created;
    await page.goto("/settings/contracts/fields");
    await page.getByRole("button", { name: `Edit ${longField!.displayName}`, exact: true }).click();
    const select = page.getByRole("combobox", { name: "Answer style", exact: true });
    const connector = await page.request.get("/api/v1/ai-connector");
    const defaultStyle = (await connector.json()).connector.answerStyle as
      "few_words" | "sentence" | "full_clause";
    const label = {
      few_words: "Few word summary",
      sentence: "1-2 sentence summary",
      full_clause: "Full clause text",
    }[defaultStyle];
    await expect(
      select.getByRole("option", { name: `Organisation default (${label})`, exact: true }),
    ).toBeAttached();
    await select.selectOption("full_clause");
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await page.reload();
    await page.getByRole("button", { name: `Edit ${longField!.displayName}`, exact: true }).click();
    await expect(select).toHaveValue("full_clause");
    await page.getByRole("button", { name: "Cancel", exact: true }).click();
    await page
      .getByRole("button", { name: `Edit ${shortField!.displayName}`, exact: true })
      .click();
    await expect(
      select.getByRole("option", { name: "Full clause text", exact: true }),
    ).toBeDisabled();
    await select.hover();
    await expect(page.getByRole("tooltip")).toHaveText("Full clause text needs a long text Field.");
    await page
      .getByRole("heading", { name: `Edit ${shortField!.displayName}`, exact: true })
      .hover();
    await expect(page.getByRole("tooltip")).toBeHidden();
    await select.focus();
    await expect(page.getByRole("tooltip")).toBeVisible();
    await expect(select).toHaveAccessibleDescription("Full clause text needs a long text Field.");
    await select.press("Escape");
    await expect(page.getByRole("tooltip")).toBeHidden();
    await expect(page.getByRole("dialog")).toBeVisible();
  } finally {
    for (const field of created) {
      const archived = await page.request.post(`/api/v1/fields/${field.id}/archive`);
      expect(archived.ok()).toBe(true);
    }
  }
});
