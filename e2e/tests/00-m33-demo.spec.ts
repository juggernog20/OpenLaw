// SPDX-License-Identifier: AGPL-3.0-only

// This journey owns the first-run window before 01-bootstrap. The shared
// instance never reopens the wizard after Finish (SET-004).
import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import { z } from "zod";
import {
  ADMIN,
  ensureAdminExists,
  ensureMemberInert,
  needsSetup,
  reportAxeViolations,
  signInAs,
  signOut,
  sweepOrSay,
  uniqueEmail,
} from "./helpers.js";
import { extractLink, waitForMailTo } from "./mailpit.js";

const ORGANIZATION = "M33 Legal";
const LOGO =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><path fill="#154e41" d="M0 0h32v32H0z"/></svg>';
const STEP_LABELS = {
  organization: "Organization",
  authentication: "Authentication",
  portal: "Business-user portal",
  email: "Email",
  invites: "Invite your team",
  "e-signature": "E-signature",
  "ai-analysis": "AI analysis",
  review: "Review seeded types",
} as const;
const SETTINGS_PATHS = {
  organization: "/settings/general",
  authentication: "/settings/authentication",
  portal: "/settings/authentication",
  email: null,
  invites: "/settings/users",
  "e-signature": "/settings/integrations/e-signature",
  "ai-analysis": "/settings/ai-analysis",
  review: null,
} as const;
const Step = z.object({ done: z.boolean(), settingsPath: z.string().nullable() });
const Status = z.object({
  completed: z.boolean(),
  steps: z.object({
    organization: Step,
    authentication: Step,
    portal: Step,
    email: Step,
    invites: Step,
    "e-signature": Step,
    "ai-analysis": Step,
    review: Step,
  }),
});

async function readStatus(request: APIRequestContext) {
  const response = await request.get("/api/v1/onboarding");
  expect(response.status(), await response.text()).toBe(200);
  return Status.parse(await response.json());
}

async function expectChecklist(page: Page, status: z.infer<typeof Status>) {
  const outstanding = (Object.keys(STEP_LABELS) as (keyof typeof STEP_LABELS)[]).filter(
    (step) => !status.steps[step].done,
  );
  const list = page.getByRole("list", { name: "Outstanding setup steps" });
  if (outstanding.length === 0) {
    await expect(page.getByRole("heading", { name: "Setup checklist" })).toHaveCount(0);
    await expect(list).toHaveCount(0);
    return;
  }
  await expect(list.getByRole("listitem")).toHaveCount(outstanding.length);
  for (const step of outstanding) {
    const row = list.getByRole("listitem").filter({ hasText: STEP_LABELS[step] });
    await expect(row).toBeVisible();
    await expect(row).toContainText(STEP_LABELS[step]);
    const path = SETTINGS_PATHS[step];
    expect(status.steps[step].settingsPath).toBe(path);
    if (path === null) {
      // Email has no Settings pane. Review carries an action in this card.
      await expect(row.getByRole("link")).toHaveCount(0);
      if (step === "review") {
        await expect(row.getByRole("button", { name: "Mark as reviewed" })).toBeVisible();
      } else {
        await expect(row).toHaveText(STEP_LABELS[step]);
      }
    } else {
      await expect(row.getByRole("link", { name: STEP_LABELS[step] })).toHaveAttribute(
        "href",
        path,
      );
    }
  }
}

test("M33: the first run leaves a named, populated system and skipped steps in Settings", async ({
  page,
  request,
}, testInfo) => {
  test.setTimeout(120_000);
  const fresh = await needsSetup(request);
  const inviteEmail = uniqueEmail("m33-team");
  let createdConnector = false;
  const cleanup = async () => {
    try {
      if (createdConnector) {
        const removed = await page.request.delete("/api/v1/ai-connector");
        expect(removed.status(), await removed.text()).toBe(200);
      }
    } finally {
      if (fresh) await ensureMemberInert(page.request, inviteEmail);
    }
  };

  try {
    if (fresh) {
      await test.step("create the Administrator and walk all nine wizard steps", async () => {
        await page.goto("/");
        await expect(page).toHaveURL("/auth/setup");
        await page.getByLabel("Name").fill(ADMIN.displayName);
        await page.getByLabel("Email").fill(ADMIN.email);
        await page.getByLabel("Password", { exact: true }).fill(ADMIN.password);
        await page.getByLabel("Confirm password").fill(ADMIN.password);
        await page.getByRole("button", { name: "Create Administrator" }).click();
        await expect(page).toHaveURL("/welcome");

        async function step(heading: string, number: number) {
          await expect(page.getByRole("heading", { name: heading, exact: true })).toBeVisible();
          await expect(page.getByText(`Step ${number} of 9`, { exact: true })).toBeVisible();
        }
        const next = () => page.getByRole("button", { name: "Continue", exact: true }).click();
        await step("Welcome to OpenLaw", 1);
        await page.getByRole("button", { name: "Get started" }).click();
        await step("Your organization", 2);
        await page.getByLabel("Organization name").fill(ORGANIZATION);
        await page.getByLabel("Upload a logo").setInputFiles({
          name: "m33-logo.svg",
          mimeType: "image/svg+xml",
          buffer: Buffer.from(LOGO),
        });
        await expect(page.getByRole("img", { name: "Organization logo" })).toBeVisible();
        await page.getByLabel("Default locale").selectOption("en-US");
        await page.getByLabel("Default timezone").fill("");
        await page.getByLabel("Default timezone").fill("UTC");
        await page.getByLabel("Default timezone").press("Enter");
        await next();
        await step("Authentication", 3);
        await page.getByRole("button", { name: /^Built-in sign-in/ }).click();
        await expect(page.getByRole("button", { name: /^Built-in sign-in/ })).toHaveAttribute(
          "aria-pressed",
          "true",
        );
        await next();
        await step("Business-user portal", 4);
        await page.getByLabel("Allowed email domains").fill("example.com");
        await page.getByRole("button", { name: "Add", exact: true }).click();
        await expect(
          page.getByRole("button", { name: /^Magic-link sign-in is on/ }),
        ).toHaveAttribute("aria-pressed", "true");
        await next();
        await step("Outbound email", 5);
        // Compose supplies the relay. The invite below proves real delivery.
        await expect(
          page.getByText(/^Outbound email is set by the deployment environment\./),
        ).toBeVisible();
        await next();
        await step("Invite your team", 6);
        await page.getByLabel("Name", { exact: true }).fill("M33 Counsel");
        await page.getByLabel("Email", { exact: true }).fill(inviteEmail);
        await page.getByRole("button", { name: "Legal team member", exact: true }).click();
        await page.getByRole("button", { name: "Send invite" }).click();
        await expect(
          page.getByText(`1 invite sent: ${inviteEmail}`, { exact: true }),
        ).toBeVisible();
        const mail = await waitForMailTo(request, inviteEmail);
        expect(extractLink(mail.text, "/auth/set-password")).toBeTruthy();
        await next();
        await step("E-signature", 7);
        await page.getByRole("button", { name: "Set up later" }).click();
        await step("AI analysis", 8);
        await page.getByRole("button", { name: "Set up later" }).click();
        await step("Review", 9);
        const review = page.getByRole("region", { name: "Review", exact: true });
        await expect(review.getByRole("link")).toHaveCount(10);
        for (const label of [
          "Matter types",
          "Contract types",
          "Entity types",
          "Knowledge types",
          "Request types",
        ]) {
          const row = review
            .getByRole("row")
            .filter({ has: page.getByRole("link", { name: label, exact: true }) });
          expect(Number(await row.getByRole("cell").innerText())).toBeGreaterThan(0);
        }
        await expect(review.getByText("7 days before, 1 day before, and On the day")).toBeVisible();
        expect(
          await reportAxeViolations(page, testInfo, "m33-review", { include: "main" }),
        ).toEqual([]);
        await page.getByRole("button", { name: "Finish", exact: true }).click();
        await expect(page).toHaveURL("/");
        const status = await readStatus(page.request);
        expect(status.completed).toBe(true);
        expect(
          Object.entries(status.steps)
            .filter(([, value]) => !value.done)
            .map(([key]) => key),
        ).toEqual(["e-signature", "ai-analysis"]);
        await signOut(page, ADMIN.displayName);
        await signInAs(page, ADMIN.email, ADMIN.password, ADMIN.displayName);
        await page.goto("/welcome");
        await expect(page).toHaveURL("/");
        const methods = await page.request.get("/api/v1/auth/methods");
        expect(methods.status()).toBe(200);
        expect(z.object({ mode: z.string() }).parse(await methods.json()).mode).toBe("built_in");
        await page.goto("/settings/contracts/types");
        await expect(
          page
            .getByRole("listitem")
            .filter({ has: page.getByRole("button", { name: "Rename NDA", exact: true }) }),
        ).toBeVisible();
        await page.goto("/settings/users");
        await expect(page.getByRole("row").filter({ hasText: inviteEmail })).toBeVisible();
      });
    } else {
      testInfo.annotations.push({
        type: "first run",
        description: "Warm instance: wizard already consumed; inspect its current checklist.",
      });
      await ensureAdminExists(request);
      await signInAs(page, ADMIN.email, ADMIN.password, ADMIN.displayName);
    }

    await test.step("finish a skipped connector in its Settings pane", async () => {
      const before = await readStatus(page.request);
      await page.goto("/settings/general");
      await expectChecklist(page, before);
      if (fresh) {
        await expect(page.getByLabel("Organization name")).toHaveValue(ORGANIZATION);
        await expect(page.getByRole("main").locator("img")).toHaveAttribute(
          "src",
          `data:image/svg+xml;base64,${Buffer.from(LOGO).toString("base64")}`,
        );
        await page.goto("/settings/authentication");
        await expect(page.getByLabel("Allowed email domains")).toBeVisible();
        const domains = page.getByRole("list").filter({
          has: page.getByRole("button", { name: "Remove example.com", exact: true }),
        });
        await expect(domains.getByRole("listitem")).toHaveText(["example.com"]);
        await page.goto("/settings/general");
      }
      if (before.steps["ai-analysis"].done) {
        testInfo.annotations.push({
          type: "checklist",
          description: "Warm instance already has an AI connector; preserve its credentials.",
        });
        return;
      }
      expect(
        await reportAxeViolations(page, testInfo, "m33-checklist", {
          include: '[aria-label="Outstanding setup steps"]',
        }),
      ).toEqual([]);
      await page
        .getByRole("list", { name: "Outstanding setup steps" })
        .getByRole("link", { name: "AI analysis" })
        .click();
      await expect(page).toHaveURL("/settings/ai-analysis");
      const provider = page.getByRole("button", { name: "Provider", exact: true });
      if ((await provider.getAttribute("aria-expanded")) === "false") await provider.click();
      await page.getByLabel("Provider").selectOption({ label: "Custom endpoint" });
      await page
        .getByLabel("Protocol")
        .selectOption({ label: "OpenAI-compatible chat completions" });
      await page.getByLabel("Base URL").fill("http://127.0.0.1:9/v1");
      await page.getByLabel("Model").fill("m33-configuration-only");
      await page.getByLabel("API key").fill("m33-configuration-only");
      // Saving validates and stores configuration locally; no provider is called.
      createdConnector = true;
      const saving = page.waitForResponse(
        (response) =>
          response.url().endsWith("/api/v1/ai-connector") && response.request().method() === "PUT",
      );
      await page.getByRole("button", { name: "Save connector" }).click();
      expect((await saving).status()).toBe(200);
      await page.goto("/settings/general");
      await page.reload();
      await expectChecklist(page, {
        ...before,
        steps: { ...before.steps, "ai-analysis": { ...before.steps["ai-analysis"], done: true } },
      });
      expect((await readStatus(page.request)).steps["ai-analysis"].done).toBe(true);
      await expect(
        page
          .getByRole("list", { name: "Outstanding setup steps" })
          .getByRole("link", { name: "AI analysis" }),
      ).toHaveCount(0);
    });
  } catch (error) {
    await sweepOrSay("the M33 demo", cleanup);
    throw error;
  }
  await cleanup();
});
