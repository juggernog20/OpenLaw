// SPDX-License-Identifier: AGPL-3.0-only
import { test, expect } from "@playwright/test";
import { z } from "zod";
import {
  ADMIN,
  ensureAdminExists,
  ensureMemberInert,
  onboardActivatedMember,
  signInAs,
  type OnboardedMember,
} from "./helpers.js";
import { htmlSupportScore, rawMail, waitForMailDetails } from "./mailpit.js";

test.setTimeout(180_000);

for (const role of ["legal_team_member", "business_user"] as const) {
  for (const hasLogo of [true, false]) {
    test(`approval email reaches ${role} with ${hasLogo ? "the org logo" : "the OpenLaw mark"} as compatible multipart mail`, async ({
      page,
      browser,
      request,
    }, testInfo) => {
      await ensureAdminExists(request);
      await signInAs(page, ADMIN.email, ADMIN.password, ADMIN.displayName);
      const stamp = Date.now();
      const email = `e2e-m43-${role}-${stamp}@example.com`;
      const branding = await page.request.get("/api/v1/org/branding");
      expect(branding.ok()).toBe(true);
      const { logo: originalLogo } = z
        .object({ logo: z.string().nullable() })
        .parse(await branding.json());
      let recipient: OnboardedMember | undefined;
      let number: number | undefined;
      try {
        recipient = await onboardActivatedMember(page.request, browser, {
          email,
          displayName: "M43 Approver",
          role,
          password: "their-own-e2e-password",
        });
        const options = await page.request.get("/api/v1/contracts/options");
        expect(options.ok()).toBe(true);
        const types = z
          .object({ contractTypes: z.array(z.object({ id: z.string(), slug: z.string() })) })
          .parse(await options.json());
        const nda = types.contractTypes.find((type) => type.slug === "nda");
        expect(nda).toBeDefined();
        const title = `E2E M43 approval ${stamp}`;
        const made = await page.request.post("/api/v1/contracts", {
          data: { title, contractTypeId: nda!.id },
        });
        expect(made.status(), await made.text()).toBe(201);
        number = z.object({ contract: z.object({ number: z.number() }) }).parse(await made.json())
          .contract.number;
        const me = await recipient.page.request.get("/api/v1/me");
        expect(me.ok()).toBe(true);
        const userId = z.object({ user: z.object({ id: z.string() }) }).parse(await me.json())
          .user.id;
        const logo = hasLogo
          ? "data:image/svg+xml;base64," +
            Buffer.from(
              '<svg xmlns="http://www.w3.org/2000/svg" width="96" height="48"><rect width="96" height="48" fill="red"/></svg>',
            ).toString("base64")
          : null;
        const saved = await page.request.patch("/api/v1/org/general", { data: { logo } });
        expect(saved.ok(), await saved.text()).toBe(true);
        const asked = await page.request.post(`/api/v1/contracts/${number}/approvals`, {
          data: { approverIds: [userId] },
        });
        expect(asked.status(), await asked.text()).toBe(201);
        const mail = await waitForMailDetails(page.request, email, /^Approval requested:/);
        expect(mail.subject).toBe(`Approval requested: ${title}`);
        expect(mail.text).toContain(`${ADMIN.displayName} has asked you to approve ${title}.`);
        expect(mail.html).toContain(`C-${number}`);
        expect(mail.html).toContain("Review approval");
        expect(mail.html).toContain(
          role === "business_user" ? "/portal/settings" : "/settings/notifications",
        );
        expect(mail.html).not.toMatch(/<script|src=["']data:|calc\(/i);
        const mime = await rawMail(page.request, mail.id);
        expect(mime).toContain("multipart/alternative");
        const cid = hasLogo ? "org-logo@openlaw" : "openlaw-mark@openlaw";
        expect(mime).toContain(`Content-ID: <${cid}>`);
        expect(mail.html).toContain(`src="cid:${cid}"`);
        expect(mime).toMatch(/Content-Disposition: inline;/i);
        expect(mime).toContain("image/png");
        const supported = await htmlSupportScore(page.request, mail.id);
        await testInfo.attach("Mailpit HTML support", {
          body: JSON.stringify({ supported }),
          contentType: "application/json",
        });
        expect(supported).toBeGreaterThanOrEqual(90);

        await page.setViewportSize({ width: 375, height: 812 });
        await page.setContent(mail.html);
        const button = page.getByRole("link", { name: "Review approval", exact: true });
        const line = page.getByText(
          role === "business_user"
            ? "You can approve or reject it, with a note, on the approval page."
            : "You can approve or reject it, with a note, on the record.",
          { exact: true },
        );
        const buttonBox = await button.boundingBox();
        const lineBox = await line.boundingBox();
        expect(buttonBox).not.toBeNull();
        expect(lineBox).not.toBeNull();
        expect(lineBox!.y).toBeGreaterThanOrEqual(buttonBox!.y + buttonBox!.height);
        expect(Math.abs(buttonBox!.width - lineBox!.width)).toBeLessThanOrEqual(3);
        expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
          375,
        );
        await testInfo.attach("Approval email at 375px", {
          body: await page.screenshot({ fullPage: true }),
          contentType: "image/png",
        });
      } finally {
        const restored = await page.request.patch("/api/v1/org/general", {
          data: { logo: originalLogo },
        });
        expect(restored.ok(), await restored.text()).toBe(true);
        await recipient?.context.close();
        if (number !== undefined) {
          const archived = await page.request.post(`/api/v1/contracts/${number}/archive`);
          expect(archived.ok(), await archived.text()).toBe(true);
        }
        await ensureMemberInert(page.request, email);
      }
    });
  }
}
