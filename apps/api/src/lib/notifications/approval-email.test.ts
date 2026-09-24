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

it("names the acting Client in notification email text", () => {
  const message = renderNotificationMail(
    {
      eventType: "contract.owner_assigned",
      record: { entityType: "contract", number: 42, title: "Budget contract" },
      actorName: "Sarah Chen",
      recipientName: "Finance Reviewer",
      recipientRole: "legal_team_member",
      details: { viaKind: "api_key", viaClientName: "Claude Code" },
    },
    "finance@example.com",
    "https://legal.example.com",
  );
  expect(message?.text).toContain("Sarah Chen, via Claude Code,");
});

it("names the acting Client on the Request receipt", () => {
  const message = renderNotificationMail(
    {
      eventType: "request.created",
      record: { entityType: "request", number: 42, title: "Review" },
      actorName: "Sarah Chen",
      recipientName: "Sarah Chen",
      recipientRole: "business_user",
      details: { viaKind: "api_key", viaClientName: "Claude Code" },
    },
    "sarah@example.com",
    "https://legal.example.com",
  );
  expect(message?.text).toContain("Sarah Chen, via Claude Code, submitted your request");
});
