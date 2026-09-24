// SPDX-License-Identifier: AGPL-3.0-only
import { expect, it } from "vitest";
import { renderNotificationMail, type NotificationMail } from "./email.js";

const baseUrl = "https://legal.example.com";
const contractLink = `${baseUrl}/contracts/42`;
const activityWhy = "You turned on activity emails.";
const ownerWhy = "You are the owner of this contract.";
const checklist = "The checklist is on the record.";
const history = "The record's own feed has the full history.";
const documents = "The document list is on the record.";
const versions = "The version history is on the record.";
const signatures = "The signature panel on the record has the detail.";

interface Example {
  eventType: NotificationMail["eventType"];
  entityType?: "matter";
  details?: Record<string, unknown>;
  subject: string;
  sentences: string[];
  label: string;
  headline: string;
  button: string;
  line?: string;
  textLine?: string;
  why: string;
  facts?: string[];
}

const examples: Example[] = [
  {
    eventType: "contract.owner_assigned",
    subject: "You are now the owner of Supply terms",
    sentences: ["Alex Chen has made you the owner of Supply terms."],
    label: "Owner assigned",
    headline: "You are now the owner",
    button: "Open contract",
    line: "The owner is the accountable person on a contract.",
    why: ownerWhy,
  },
  {
    eventType: "contract.team_added",
    subject: "You were added to Supply terms",
    sentences: ["Alex Chen added you to the team on Supply terms."],
    label: "Added to team",
    headline: "You were added to a contract team",
    button: "Open contract",
    why: "You are on the team for this contract.",
  },
  {
    eventType: "contract.task_assigned",
    details: { taskTitle: "Check liability" },
    subject: "Task assigned: Check liability (Supply terms)",
    sentences: ["Alex Chen has given you a task on Supply terms: Check liability."],
    label: "Task assigned",
    headline: "Check liability",
    button: "Open tasks",
    line: checklist,
    why: "The task is assigned to you.",
    facts: ["Task", "Check liability"],
  },
  {
    eventType: "matter.task_assigned",
    entityType: "matter",
    details: { taskTitle: "Check liability" },
    subject: "Task assigned: Check liability (M-42 · Supply terms)",
    sentences: ["Alex Chen has given you a Task on M-42 · Supply terms: Check liability."],
    label: "Task assigned",
    headline: "Check liability",
    button: "Open tasks",
    line: "The checklist is on the Matter record.",
    why: "The task is assigned to you.",
    facts: ["Task", "Check liability"],
  },
  {
    eventType: "contract.generated",
    details: { autoDocName: "Supplier form" },
    subject: "Generated Contract assigned to you: Supply terms",
    sentences: [
      "Alex Chen generated Supply terms from Supplier form.",
      "You are the Owner of this Contract.",
    ],
    label: "Generated contract",
    headline: "A generated contract is yours",
    button: "Open contract",
    why: ownerWhy,
    facts: ["Auto-Doc", "Supplier form"],
  },
  {
    eventType: "contract.generated_unassigned",
    details: { autoDocName: "Supplier form" },
    subject: "Unassigned generated Contract: Supply terms",
    sentences: [
      "Alex Chen generated Supply terms from Supplier form.",
      "This Contract needs an Owner. Claim it in the Inbox.",
    ],
    label: "Needs an owner",
    headline: "A generated contract needs an owner",
    button: "Claim it",
    why: "You triage generated contracts.",
    facts: ["Auto-Doc", "Supplier form"],
  },
  {
    eventType: "contract.status_changed",
    details: { from: "With supplier", to: "Ready for signature" },
    subject: "Supply terms moved to Ready for signature",
    sentences: ["Alex Chen moved Supply terms to Ready for signature."],
    label: "Status changed",
    headline: "Moved to Ready for signature",
    button: "Open contract",
    line: history,
    why: activityWhy,
    facts: ["Status", "With supplier", "&rarr;", "Ready for signature"],
  },
  {
    eventType: "document.added",
    details: { documentTitle: "Processing addendum" },
    subject: "New document: Processing addendum (Supply terms)",
    sentences: ["Alex Chen added Processing addendum to Supply terms."],
    label: "New document",
    headline: "Processing addendum",
    button: "Open documents",
    line: `${documents} Files are never attached, so the record's access rules still apply.`,
    textLine: documents,
    why: activityWhy,
    facts: ["Document", "Processing addendum"],
  },
  {
    eventType: "document.version_added",
    details: { documentTitle: "Supplier redline", versionNumber: 7 },
    subject: "New version of Supplier redline (Supply terms)",
    sentences: ["Alex Chen added v7 of Supplier redline on Supply terms."],
    label: "New version",
    headline: "v7 of Supplier redline",
    button: "Open version history",
    line: versions,
    why: activityWhy,
    facts: ["Document", "Supplier redline", "v7"],
  },
  ...(["signed", "declined", "voided"] as const).map((status): Example => ({
    eventType: "envelope.ended",
    details: { status },
    subject: `Signature ${status === "signed" ? "complete" : "update"}: Supply terms`,
    sentences: [
      `The signature envelope on Supply terms ${status === "signed" ? "has been signed" : `was ${status}`}.`,
    ],
    label: status === "signed" ? "Signed" : `Signature ${status}`,
    headline:
      status === "signed" ? "Supply terms is signed" : `The signature envelope was ${status}`,
    button: "Open contract",
    line: signatures,
    why: activityWhy,
  })),
];

function render(example: Example, overrides: Partial<NotificationMail> = {}, portal = false) {
  return renderNotificationMail(
    {
      eventType: example.eventType,
      record: { entityType: example.entityType ?? "contract", number: 42, title: "Supply terms" },
      actorName: example.eventType === "envelope.ended" ? null : "Alex Chen",
      recipientName: "Sam Patel",
      details: example.details,
      recipientRole: portal ? "business_user" : "legal_team_member",
      ...overrides,
    },
    "sam@example.com",
    `${baseUrl}${portal ? "/portal" : ""}///`,
    { name: "Acme Legal" },
  );
}

it.each(examples)("renders $eventType, $label, with unchanged text", (example) => {
  const message = render(example);
  const link = example.entityType ? `${baseUrl}/matters/42/tasks` : contractLink;
  const textLine = example.textLine ?? example.line;
  expect(message?.to).toBe("sam@example.com");
  expect(message?.subject).toBe(example.subject);
  expect(message?.text).toBe(
    [
      "Hello Sam Patel,",
      "",
      ...example.sentences,
      "",
      link,
      ...(textLine ? ["", textLine] : []),
    ].join("\n"),
  );
  for (const fact of [
    "Acme Legal",
    "Hello Sam Patel,",
    "Supply terms",
    example.entityType ? "Matter" : "Contract",
    example.entityType ? "M-42" : "C-42",
    example.label,
    example.headline,
    example.button,
    example.why,
    ...example.sentences,
    ...(example.line ? [example.line] : []),
    ...(example.facts ?? []),
  ])
    expect(message?.html).toContain(fact.replaceAll("'", "&#39;"));
  expect(message?.html).toContain(`href="${link}"`);
  expect(message?.html).toContain(`${baseUrl}/settings/notifications`);
  expect(message?.html).not.toMatch(/<script|src=["']data:|calc\(/i);
  // Only the inline header logo leaves the server, never a Document's bytes.
  expect(message?.attachments).toHaveLength(1);
  expect(message?.attachments?.[0]?.contentType).toBe("image/png");
  expect(message?.html).toContain(`src="cid:${message?.attachments?.[0]?.cid}"`);
  if (example.eventType === "envelope.ended") expect(message?.html).not.toContain("Somebody");
  else expect(message?.html).toContain("Alex Chen");
  if (example.eventType.startsWith("document.")) {
    expect(message?.html).toMatch(/>Document<\/td>/);
    expect(message?.html).toMatch(/>F<\/td>/);
    if (example.eventType === "document.version_added")
      expect(message?.html).toMatch(/>v7<\/span>/);
  }
  if (example.eventType === "contract.status_changed") {
    expect(message?.html).toMatch(
      />Status<\/td>.*>With supplier<\/span> &rarr; <span[^>]*>Ready for signature<\/span>/,
    );
  }
});

it.each(examples)("keeps $eventType links on the Portal for a Business User", (example) => {
  const message = render(example, {}, true);
  const path = example.entityType ? "/matters/42/tasks" : "/contracts/42";
  expect(message?.html).toContain("/ Legal portal");
  expect(message?.html).toContain(`href="${baseUrl}/portal${path}"`);
  expect(message?.html).toContain(`href="${baseUrl}/portal/settings"`);
  expect(message?.text).toContain(`${baseUrl}/portal${path}`);
});

it.each([
  { from: "Old custom status" },
  { to: "New custom status" },
  {},
  { from: { label: "Invented old" }, to: 3, fromStage: "review", toStage: "signature" },
])("uses only status labels the payload carries: %j", (details) => {
  const example = examples.find((item) => item.eventType === "contract.status_changed")!;
  const message = render(example, { details });
  const status = typeof details.to === "string" ? details.to : null;
  expect(message?.text).toBe(
    [
      "Hello Sam Patel,",
      "",
      status
        ? `Alex Chen moved Supply terms to ${status}.`
        : "Alex Chen moved Supply terms to another status.",
      "",
      contractLink,
      "",
      history,
    ].join("\n"),
  );
  if (typeof details.from === "string") expect(message?.html).toContain(details.from);
  if (status) expect(message?.html).toContain(status);
  expect(message?.html).not.toMatch(
    /&rarr;|Invented old|Signing|Pending approval|\[object Object\]|undefined/,
  );
});

it.each(examples)("does not invent facts in $eventType when details are absent", (example) => {
  const message = render(example, { details: {}, actorName: null });
  expect(message?.html).toContain("Supply terms");
  expect(message?.html).not.toMatch(
    /undefined|\[object Object\]|>Draft<|>Unassigned<|>Pending approval<|>Signing</,
  );
  if (example.eventType.startsWith("document."))
    expect(message?.html).not.toMatch(/>Document<\/td>|>v\d+<\/span>/);
});

it.each([0, -1, 1.5, "7", {}, Number.MAX_SAFE_INTEGER + 1])(
  "omits an invalid Version number %j",
  (versionNumber) => {
    const example = examples.find((item) => item.eventType === "document.version_added")!;
    const message = render(example, {
      details: { documentTitle: "Supplier redline", versionNumber },
    });
    expect(message?.html).toContain("New version of Supplier redline");
    expect(message?.html).not.toMatch(/>v[^<]*<\/span>/);
    expect(message?.text).toBe(
      [
        "Hello Sam Patel,",
        "",
        "Alex Chen added a new version of Supplier redline on Supply terms.",
        "",
        contractLink,
        "",
        versions,
      ].join("\n"),
    );
  },
);

it.each(examples)("escapes payload values in $eventType", (example) => {
  const value = '<script>"A & B"</script>';
  const message = render(example, {
    record: { entityType: example.entityType ?? "contract", number: 42, title: value },
    actorName: value,
    recipientName: value,
    details: {
      ...example.details,
      taskTitle: value,
      documentTitle: value,
      autoDocName: value,
      from: value,
      to: value,
    },
  });
  expect(message?.html).toContain("&lt;script&gt;&quot;A &amp; B&quot;&lt;/script&gt;");
  expect(message?.html).not.toContain("<script>");
  expect(message?.text).toContain(value);
});
