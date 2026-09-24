// SPDX-License-Identifier: AGPL-3.0-only

import { expect, it } from "vitest";
import { commentExcerpt } from "./comment-email.js";
import { renderNotificationMail } from "./email.js";

const wordsOf = (body: string) => {
  const excerpt = commentExcerpt(body, [], "reader");
  return { text: excerpt.words.map((word) => word.text).join(""), cut: excerpt.cut };
};

it("keeps exactly 280 characters and cuts longer text at its last word break", () => {
  const prefix = "a ".repeat(139) + "ab";
  expect(wordsOf(prefix)).toEqual({ text: prefix, cut: false });
  expect(wordsOf(prefix + "c")).toEqual({ text: "a ".repeat(139).trimEnd(), cut: true });
  expect(wordsOf(prefix + " next")).toEqual({ text: prefix, cut: true });
});
it("counts Unicode characters, handles whitespace, and bounds an unbroken word", () => {
  expect(wordsOf("😀".repeat(281))).toEqual({ text: "😀".repeat(280), cut: true });
  const prefix = "a".repeat(270);
  expect(wordsOf(prefix + "\n\t longerword after")).toEqual({ text: prefix, cut: true });
});
it("marks only the recipient's recorded mention and leaves longer names intact", () => {
  const mentions = [
    { id: "reader", name: "Sam (Legal)" },
    { id: "other", name: "Sam (Legal) Jones" },
  ];
  const body = "@Sam (Legal) Jones and @Sam (Legal), review this. @Unlisted";
  const excerpt = commentExcerpt(body, mentions, "reader");
  expect(excerpt.words.map((word) => word.text).join("")).toBe(body);
  expect(excerpt.words.filter((word) => word.mention)).toEqual([
    { text: "@Sam (Legal)", mention: true },
  ]);
  expect(commentExcerpt(body, [], "reader").words).toEqual([{ text: body }]);
});

it.each(["legal_team_member", "business_user"])(
  "omits tiers on a Requester's portal email for %s",
  (recipientRole) => {
    const mail = renderNotificationMail(
      {
        eventType: "request.replied",
        record: { entityType: "request", number: 4, title: "Advice" },
        actorName: "Alex Counsel",
        recipientName: "Sam Reader",
        recipientRole,
        comment: {
          author: "Alex Counsel",
          tier: "Full Thread",
          words: [{ text: "Current answer." }],
        },
      },
      "reader@example.com",
      "https://legal.example.com",
      { name: "Northwind" },
    );
    expect(mail?.html).toContain("Northwind");
    expect(mail?.html).toContain("/ Legal portal");
    expect(mail?.html).toContain("Current answer.");
    expect(mail?.html).not.toContain("Full Thread");
    expect(mail?.html).toContain("https://legal.example.com/portal/requests/4");
  },
);

it("does not read words or tiers from a notification payload when the comment is absent", () => {
  const mail = renderNotificationMail(
    {
      eventType: "comment.mentioned",
      record: { entityType: "contract", number: 4, title: "Advice" },
      actorName: "Alex Counsel",
      recipientName: "Sam Reader",
      details: { commentId: "missing", body: "Stale words", visibility: "legal_only" },
    },
    "reader@example.com",
    "https://legal.example.com",
  );
  expect(mail?.text).toBe(
    "Hello Sam Reader,\n\nAlex Counsel mentioned you in a comment on Advice.\n\nhttps://legal.example.com/contracts/4\n\nThe comment is on the record.",
  );
  expect(mail?.html).not.toMatch(/Stale words|Legal Only/);
  expect(mail?.html).toContain("Reply on the contract");
});
