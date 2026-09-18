// SPDX-License-Identifier: AGPL-3.0-only
import { expect, it } from "vitest";
import { renderNotificationMail } from "./email.js";

it("links business approval mail to the assigned Portal packet", () => {
  const message = renderNotificationMail(
    {
      eventType: "approval.requested",
      record: { entityType: "contract", number: 42, title: "Budget contract" },
      actorName: "Legal Counsel",
      recipientName: "Finance Reviewer",
      recipientRole: "business_user",
      details: { approvalId: "approval-42" },
    },
    "finance@example.com",
    "https://legal.example.com/portal",
  );
  expect(message?.text).toContain("https://legal.example.com/portal/approvals/approval-42");
  expect(message?.text).not.toContain("/portal/contracts/");
});
