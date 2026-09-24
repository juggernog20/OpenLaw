// SPDX-License-Identifier: AGPL-3.0-only
import { parseKnowledgeMarkdown } from "@openlaw/shared";
import { expect, it } from "vitest";
import { renderEmailLayout, type EmailModel } from "./email-layout.js";

const base: EmailModel = {
  subject: "Subject",
  baseUrl: "https://legal.example.com",
  surface: "staff",
};

it("omits absent blocks and falls back to OpenLaw", () => {
  const { html, attachments } = renderEmailLayout(base, { name: " " });
  expect(html).toContain("OpenLaw");
  expect(html).toContain("Sent by OpenLaw");
  expect(html).not.toMatch(/<h1|<h2|notification settings|Review approval|Note from|Attached ·/);
  expect(attachments[0]?.content.subarray(0, 8).toString("hex")).toBe("89504e470d0a1a0a");
  expect(html).toContain(`cid:${attachments[0]?.cid}`);
});

it("renders the optional record blocks and marks only the reader's supplied mention", () => {
  const { html } = renderEmailLayout(
    {
      ...base,
      label: "New comment",
      headline: "A reply",
      greeting: "Hello Dana,",
      body: ["First sentence.", "Second sentence."],
      record: {
        kind: "Contract",
        ref: "C-42",
        title: "Northwind MSA",
        href: "https://legal.example.com/contracts/42",
        status: { label: "Signing", tone: "info" },
        previousStatus: "Review",
        actor: "Hidden actor",
        document: { name: "MSA.docx", version: "v4", type: "word" },
        facts: [{ label: "Owner", value: "Priya Shah" }],
        steps: { labels: ["Received", "In progress", "Finished"], current: 1 },
        comment: {
          author: "Marcus Lee",
          tier: "Working Team",
          words: [
            { text: "Hello " },
            { text: "@Dana", mention: true },
            { text: " and @Priya <script>" },
          ],
          cut: true,
        },
      },
      action: { label: "Reply", href: "https://legal.example.com/reply", line: "On the record." },
    },
    { name: "Northwind & Co" },
  );
  for (const fact of [
    "New comment",
    "A reply",
    "Hello Dana,",
    "First sentence.",
    "Second sentence.",
    "C-42",
    "Northwind MSA",
    "Signing",
    "Review",
    "MSA.docx",
    "v4",
    "Owner",
    "Priya Shah",
    "Received",
    "In progress",
    "· now",
    "Finished",
    "Marcus Lee",
    "Working Team",
    "@Dana",
    "and @Priya &lt;script&gt;",
    "Read the full comment",
    "https://legal.example.com/reply",
    "Northwind &amp; Co",
  ]) {
    expect(html).toContain(fact);
  }
  expect(html).not.toContain("Hidden actor");
  expect(html).toMatch(/<span[^>]*>@Dana<\/span>/);
  expect(html).not.toMatch(/<script|src=["']data:|calc\(/i);
});

it("omits a comment tier on the portal", () => {
  const { html } = renderEmailLayout(
    {
      ...base,
      surface: "portal",
      record: {
        kind: "Request",
        ref: "R-2",
        title: "Help",
        href: "https://legal.example.com/portal/requests/2",
        comment: { author: "Legal", tier: "Full Thread", words: [{ text: "Answer" }] },
      },
      footer: { kind: "notification", why: "You asked." },
    },
    { name: "Northwind" },
  );
  expect(html).toContain("Legal portal");
  expect(html).toContain("https://legal.example.com/portal/settings");
  expect(html).not.toContain("Full Thread");
});

it("renders decline, Legal note, attachment list, standalone action and fallback link", () => {
  const { html } = renderEmailLayout(
    {
      ...base,
      declineReason: "Outside scope",
      legalNote: parseKnowledgeMarkdown(
        "## Instructions\n\nRead **clause 7**.\n\n- [Read the policy](/policy)\n- Email [Legal](mailto:legal@example.com)\n\n```\nCode <tag>\n```",
      ),
      attachments: [{ name: "NDA.pdf", size: "12 KB", type: "pdf" }],
      action: {
        label: "Set password",
        href: "https://legal.example.com/reset?a=1&b=2",
        line: "Expires in 1 hour.",
      },
      fallbackLink: "https://legal.example.com/reset?a=1&b=2",
      footer: { kind: "security" },
    },
    { name: "Northwind" },
  );
  for (const fact of [
    "Outside scope",
    "Note from Northwind Legal",
    "Read <strong>clause 7</strong>.",
    "Instructions",
    "https://legal.example.com/policy",
    "mailto:legal@example.com",
    "Code &lt;tag&gt;",
    "NDA.pdf",
    "Attached · 12 KB",
    "Set password",
    "Expires in 1 hour.",
    "Button not working?",
    "reset?a=1&amp;b=2",
    "Nobody at Northwind will ask you for this link.",
  ])
    expect(html).toContain(fact);
  expect(html).not.toMatch(/<script|src=["']data:|calc\(/i);
});

it("renders briefing counts, overflow links and dated rows", () => {
  const { html } = renderEmailLayout(
    {
      ...base,
      dateline: "Sep 24, 2026",
      label: "Daily briefing",
      sections: [
        {
          heading: "Tasks",
          total: 3,
          href: "https://legal.example.com/tasks",
          rows: [
            {
              title: "Review cap",
              href: "https://legal.example.com/contracts/1/tasks",
              ref: "C-1",
              meta: "Northwind",
              due: "Tomorrow",
              tone: "warning",
            },
          ],
        },
        {
          heading: "Dates",
          total: 1,
          href: "https://legal.example.com/dates",
          rows: [
            {
              title: "Expiry",
              href: "https://legal.example.com/contracts/2",
              ref: "C-2",
              when: "In 7 days",
              date: "Oct 1",
              meta: "Unverified",
            },
          ],
        },
      ],
      footer: { kind: "system" },
    },
    {},
  );
  for (const fact of [
    "Sep 24, 2026",
    "Tasks",
    "View all 3",
    "Review cap",
    "C-1",
    "Northwind",
    "Tomorrow",
    "Dates",
    "Expiry",
    "In 7 days",
    "Oct 1",
    "Unverified",
    "Only Administrators can send this email.",
  ])
    expect(html).toContain(fact);
  expect(html).not.toContain("View all 1");
  expect(html).not.toMatch(/<script|src=["']data:|calc\(/i);
});

it("rejects unsafe action URLs and escapes hostile values in every attribute", () => {
  expect(() =>
    renderEmailLayout({ ...base, action: { label: "Open", href: "javascript:alert(1)" } }, {}),
  ).toThrow("HTTP or HTTPS");
  const { html } = renderEmailLayout(
    {
      ...base,
      record: {
        kind: "Contract",
        ref: "C-1",
        title: 'A "quoted" & <tag> title',
        href: 'https://legal.example.com/?q="quoted"&next=1',
        actor: '<img src="x">',
      },
    },
    { name: '<script>alert("brand")</script>' },
  );
  expect(html).toContain("&lt;script&gt;");
  expect(html).toContain("&quot;quoted&quot; &amp; &lt;tag&gt;");
  expect(html).not.toMatch(/<script|src=["']data:|calc\(/i);
});
