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
      await expect(card.locator('[aria-live="polite"]')).toHaveText("Saved");
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
