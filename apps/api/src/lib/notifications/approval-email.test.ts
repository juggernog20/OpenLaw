// SPDX-License-Identifier: AGPL-3.0-only
import { expect, it } from "vitest";
import { renderNotificationMail } from "./email.js";

it.each(["legal_team_member", "business_user"])(
  "sends the approval layout and unchanged text to %s",
  (recipientRole) => {
    const portal = recipientRole === "business_user";
    const link = portal
      ? "https://legal.example.com/portal/approvals/approval-42"
      : "https://legal.example.com/contracts/42";
    const message = renderNotificationMail(
      {
        eventType: "approval.requested",
        record: { entityType: "contract", number: 42, title: "Budget contract" },
        actorName: "Legal Counsel",
        recipientName: "Finance Reviewer",
        recipientRole,
        details: { approvalId: "approval-42" },
      },
      "finance@example.com",
      `https://legal.example.com${portal ? "/portal" : ""}`,
      { name: "Northwind" },
    );
    expect(message?.subject).toBe("Approval requested: Budget contract");
    expect(message?.text).toBe(
      [
        "Hello Finance Reviewer,",
        "",
        "Legal Counsel has asked you to approve Budget contract.",
        "",
        link,
        "",
        "You can approve or reject it, with a note, on the record.",
      ].join("\n"),
    );
    for (const fact of [
      "Northwind",
      "Approval requested",
      "Legal Counsel asked you to approve a contract",
      "Hello Finance Reviewer,",
      "Contract",
      "C-42",
      "Budget contract",
      "Pending approval",
      "LC",
      "Review approval",
      link,
      "You are an approver on this contract.",
      "Northwind · sent by OpenLaw",
      portal ? "Legal portal" : "/ Legal",
      portal ? "/portal/settings" : "/settings/notifications",
      portal ? "on the approval page." : "on the record.",
    ]) {
      expect(message?.html).toContain(fact);
    }
    expect(message?.html).not.toMatch(/<script|src=["']data:|calc\(/i);
    expect(message?.attachments).toHaveLength(1);
    expect(message?.html).toContain(`cid:${message?.attachments?.[0]?.cid}`);
  },
);

it("escapes approval and brand text, with an OpenLaw fallback", () => {
  const message = renderNotificationMail(
    {
      eventType: "approval.requested",
      record: { entityType: "contract", number: 1, title: '<script>alert("x")</script>' },
      actorName: null,
      recipientName: "A & B",
    },
    "a@example.com",
    "https://legal.example.com",
  );
  expect(message?.html).toContain("Somebody asked you to approve a contract");
  expect(message?.html).toContain("A &amp; B");
  expect(message?.html).toContain("&lt;script&gt;");
  expect(message?.html).toContain("Sent by OpenLaw");
  expect(message?.html).not.toMatch(/<script|src=["']data:|calc\(/i);
});
