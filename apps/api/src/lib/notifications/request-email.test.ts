// SPDX-License-Identifier: AGPL-3.0-only
import { expect, it } from "vitest";
import { renderNotificationMail, type NotificationMail } from "./email.js";

const baseUrl = "https://legal.example.com";
const named = "R-42 · NDA for Acme";
const staffLink = `${baseUrl}/inbox/42`;
const portalLink = `${baseUrl}/portal/requests/42`;
const notification: NotificationMail = {
  eventType: "request.submitted",
  record: { entityType: "request", number: 42, title: "NDA for Acme" },
  actorName: "Legal Counsel",
  recipientName: "Alex",
};

it.each<{
  eventType: NotificationMail["eventType"];
  details?: Record<string, unknown>;
  portal: boolean;
  subject: string;
  text: string[];
  facts: string[];
}>([
  {
    eventType: "request.submitted",
    details: { requestType: "NDA", urgency: "high" },
    portal: false,
    subject: `New request: ${named}`,
    text: [
      `Legal Counsel submitted a new request: ${named}.`,
      "",
      "Type: NDA",
      "Urgency: High",
      "",
      staffLink,
      "",
      "The Inbox has everything they sent, and the request is yours to triage from there.",
    ],
    facts: ["New request", "Type", "NDA", "Urgency", "High", "Triage request"],
  },
  {
    eventType: "request.assigned",
    details: { requestType: "Advice", urgency: "critical" },
    portal: false,
    subject: `Request assigned for triage: ${named}`,
    text: [`Legal Counsel assigned you to triage ${named}.`, "", staffLink],
    facts: ["Assigned for triage", "Legal Counsel", "Advice", "Critical", "Triage request"],
  },
  {
    eventType: "request.conversion_draft_finished",
    details: { outcome: "ready", targetModule: "contract", requestType: "NDA", urgency: "medium" },
    portal: false,
    subject: `Conversion draft ready: ${named}`,
    text: [
      `The conversion draft you asked for on ${named} is ready to review.`,
      "",
      `${staffLink}?convert=contract`,
    ],
    facts: [
      "Draft ready",
      "Your conversion draft is ready",
      "Review draft",
      "?convert=contract",
      "NDA",
      "Medium",
    ],
  },
  {
    eventType: "request.conversion_draft_finished",
    details: { outcome: "failed", targetModule: "matter", requestType: "Advice", urgency: "low" },
    portal: false,
    subject: `Conversion draft could not finish: ${named}`,
    text: [
      `The conversion draft you asked for on ${named} could not finish.`,
      "",
      `${staffLink}?convert=matter`,
      "",
      "Retry it from the Convert dialog, or continue manually.",
    ],
    facts: [
      "Draft failed",
      "Your conversion draft could not finish",
      "Open Convert",
      "?convert=matter",
      "Advice",
      "Low",
      "Retry it from the Convert dialog, or continue manually.",
    ],
  },
  {
    eventType: "request.created",
    portal: true,
    subject: `We have your request: ${named}`,
    text: [
      `Your request ${named} has reached Legal.`,
      "",
      portalLink,
      "",
      "You can follow it and reply to Legal here. We will let you know when anything changes.",
    ],
    facts: [
      "Request received",
      "Legal has your request",
      "View request",
      "Received · now",
      "In progress",
      "Resolved",
    ],
  },
  {
    eventType: "request.status_changed",
    details: { to: "converted" },
    portal: true,
    subject: `Your request is in progress: ${named}`,
    text: [
      `Your request ${named} is now in progress.`,
      "",
      portalLink,
      "",
      "The request page has the detail, and your conversation with Legal is on it.",
    ],
    facts: [
      "Status update",
      "Your request is in progress",
      "View request",
      "Received",
      "In progress · now",
      "Resolved",
      "&#10003;",
    ],
  },
  {
    eventType: "request.declined",
    details: { reason: "Use the approved NDA.\nAsk Legal if you need help." },
    portal: true,
    subject: `Your request was declined: ${named}`,
    text: [
      `Legal has declined your request ${named}.`,
      "",
      "Use the approved NDA.\nAsk Legal if you need help.",
      "",
      portalLink,
      "",
      "The reason is on the request, and you can reply to Legal there.",
    ],
    facts: [
      "Declined",
      "Your request was declined",
      "View request",
      "Use the approved NDA.<br>Ask Legal if you need help.",
    ],
  },
])("renders $eventType with its facts and unchanged text ($subject)", (test) => {
  const message = renderNotificationMail(
    { ...notification, eventType: test.eventType, details: test.details },
    "alex@example.com",
    `${baseUrl}///`,
    { name: "Northwind" },
  );
  expect(message?.to).toBe("alex@example.com");
  expect(message?.subject).toBe(test.subject);
  expect(message?.text).toBe(["Hello Alex,", "", ...test.text].join("\n"));
  for (const fact of [
    "Northwind",
    "Request",
    "R-42",
    "NDA for Acme",
    "Hello Alex,",
    ...test.facts,
    test.portal ? "Legal portal" : "/ Legal",
    test.portal ? portalLink : staffLink,
    test.portal ? `${baseUrl}/portal/settings` : `${baseUrl}/settings/notifications`,
  ])
    expect(message?.html).toContain(fact);
  expect(message?.html).not.toContain(test.portal ? staffLink : portalLink);
  // The portal speaks as Legal: no card on that side names the person
  // who acted. The staff card does, the way the sentence does.
  if (test.portal) expect(message?.html).not.toContain("Legal Counsel");
  else expect(message?.html).toContain("Legal Counsel");
  expect(message?.html).not.toMatch(/<script|src=["']data:|calc\(/i);
  expect(message?.attachments).toHaveLength(1);
  expect(message?.html).toContain(`cid:${message?.attachments?.[0]?.cid}`);
});

it.each([
  ["new", "Received", 0],
  ["read", "Received", 0],
  ["converted", "In progress", 1],
  ["resolved", "Resolved", 2],
] as const)("marks the current and completed steps for %s", (status, current, done) => {
  const message = renderNotificationMail(
    { ...notification, eventType: "request.status_changed", details: { to: status } },
    "alex@example.com",
    baseUrl,
  );
  expect(message?.html).toContain(`${current} · now`);
  expect(message?.html?.match(/ · now/g)).toHaveLength(1);
  expect(message?.html?.match(/&#10003;/g) ?? []).toHaveLength(done);
  for (const label of ["Received", "In progress", "Resolved"])
    expect(message?.html).toContain(label);
});

it.each([undefined, { requestType: 4, urgency: "unknown" }])(
  "omits absent or invalid Request facts",
  (details) => {
    const message = renderNotificationMail(
      { ...notification, details },
      "alex@example.com",
      baseUrl,
    );
    expect(message?.html).toBeDefined();
    expect(message?.html).not.toContain(">Type<");
    expect(message?.html).not.toContain(">Urgency<");
    expect(message?.text).toBe(
      [
        "Hello Alex,",
        "",
        `Legal Counsel submitted a new request: ${named}.`,
        "",
        staffLink,
        "",
        "The Inbox has everything they sent, and the request is yours to triage from there.",
      ].join("\n"),
    );
  },
);

it.each([undefined, "future-status", "declined"])(
  "does not invent a progress step for %s",
  (to) => {
    const message = renderNotificationMail(
      { ...notification, eventType: "request.status_changed", details: { to } },
      "alex@example.com",
      baseUrl,
    );
    expect(message?.html).toBeDefined();
    expect(message?.html).not.toContain(" · now");
  },
);

it("escapes Request facts and decline reasons", () => {
  const message = renderNotificationMail(
    {
      ...notification,
      eventType: "request.declined",
      record: { ...notification.record, title: "NDA <script>" },
      details: { reason: "Use <approved> terms & reply." },
    },
    "alex@example.com",
    baseUrl,
  );
  expect(message?.html).toContain("NDA &lt;script&gt;");
  expect(message?.html).toContain("Use &lt;approved&gt; terms &amp; reply.");
  expect(message?.html).not.toContain("<script>");
});

it("does not show the reader as the actor on their own receipt", () => {
  const message = renderNotificationMail(
    { ...notification, eventType: "request.created", actorName: "Alex" },
    "alex@example.com",
    baseUrl,
  );
  expect(message?.html).toContain("Hello Alex,");
  // Once for the greeting. An actor row would name them a second time.
  expect(message?.html?.match(/Alex/g)).toHaveLength(1);
});
