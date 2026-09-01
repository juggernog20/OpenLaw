// SPDX-License-Identifier: AGPL-3.0-only

/** M29 close (#625): a Member lands on their whole day at Home. */
import { expect, test, type BrowserContext } from "@playwright/test";
import { z } from "zod";
import { ADMIN, ensureAdminExists, ensureMemberInert, signInAs, sweepOrSay } from "./helpers.js";
import { createPopulatedHomeFixture, type PopulatedHomeFixture } from "./home-fixture.js";
import { extractLink, waitForMailTo } from "./mailpit.js";

test.setTimeout(240_000);

const RUN = Date.now();
const MEMBER = {
  email: `m29-member-${RUN}@e2e.example`,
  displayName: "M29 Demo Member",
  role: "legal_team_member",
  password: "m29-demo-member-password",
} as const;

const InvitedUser = z.object({ user: z.object({ id: z.string() }) });

test.describe.serial("M29 deployer journey", () => {
  test.beforeAll(async ({ request }) => ensureAdminExists(request));

  test("lands on every assigned and managed item without leaving Home", async ({
    page,
    browser,
  }) => {
    await signInAs(page, ADMIN.email, ADMIN.password, ADMIN.displayName);

    let fixture: PopulatedHomeFixture | undefined;
    let memberContext: BrowserContext | undefined;
    const cleanup = async () => {
      const failures: unknown[] = [];
      const settle = async (step: () => Promise<void>) => {
        await step().catch((error: unknown) => failures.push(error));
      };
      if (memberContext) await settle(() => memberContext!.close());
      if (fixture) await settle(() => fixture!.cleanup());
      await settle(() => ensureMemberInert(page.request, MEMBER.email));
      if (failures.length > 0) throw new AggregateError(failures, "M29 demo cleanup failed");
    };

    try {
      const invited = await page.request.post("/api/v1/auth/invites", {
        data: {
          email: MEMBER.email,
          displayName: MEMBER.displayName,
          role: MEMBER.role,
        },
      });
      expect(invited.status(), await invited.text()).toBe(201);
      const memberId = InvitedUser.parse(await invited.json()).user.id;
      fixture = await createPopulatedHomeFixture(page.request, memberId, String(RUN));

      const invitation = await waitForMailTo(
        page.request,
        MEMBER.email,
        /^Set your OpenLaw password$/,
      );
      memberContext = await browser.newContext();
      const memberPage = await memberContext.newPage();
      await memberPage.goto(extractLink(invitation.text, "/auth/set-password"));
      await memberPage.getByLabel("New password").fill(MEMBER.password);
      await memberPage.getByLabel("Confirm password").fill(MEMBER.password);
      await memberPage.getByRole("button", { name: "Set password" }).click();
      await expect(memberPage.getByText("Password set")).toBeVisible();

      await signInAs(memberPage, MEMBER.email, MEMBER.password, MEMBER.displayName);
      await expect(memberPage).toHaveURL("/");
      await expect(memberPage.getByRole("heading", { level: 1, name: "Home" })).toBeVisible();

      const approvals = memberPage.getByRole("region", { name: "Approvals waiting on you" });
      const tasks = memberPage.getByRole("region", { name: "Tasks assigned to you" });
      const dates = memberPage.getByRole("region", { name: "Dates approaching" });
      const obligations = memberPage.getByRole("region", { name: "Entity obligations" });
      const contracts = memberPage.getByRole("region", { name: "Your contracts" });
      const matters = memberPage.getByRole("region", { name: "Your matters" });

      await expect(approvals.getByRole("link", { name: fixture.contract.title })).toBeVisible();
      await expect(tasks.getByText(fixture.taskTitle)).toBeVisible();
      await expect(dates.getByText(fixture.keyDateLabel)).toBeVisible();
      await expect(obligations.getByText(fixture.obligationLabel)).toBeVisible();
      await expect(contracts.getByText(fixture.contract.title)).toBeVisible();
      await expect(matters.getByText(fixture.matter.title)).toBeVisible();
      await expect(memberPage).toHaveURL("/");
    } catch (error) {
      await sweepOrSay("the M29 demo", cleanup);
      throw error;
    }
    await cleanup();
  });
});
