// SPDX-License-Identifier: AGPL-3.0-only

import { expect, it } from "vitest";
import { renderGenerationMail } from "./generation-template.js";

const input = {
  to: "dana@example.com",
  personName: "Dana",
  autoDocName: "Mutual NDA",
  organizationName: "Northwind",
  surface: "staff" as const,
  coverNote:
    "Read **clause 7**.\n\nKeep a copy.\n\n- Sign the document\n- [Read the policy](/policy)\n\n1. Send it to Legal\n2. Keep the original",
  baseUrl: "https://legal.example.com",
  autoDocId: "auto-doc-1",
  generationId: "generation-1",
  attachments: [
    {
      filename: "Mutual NDA.docx",
      contentType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      content: Buffer.alloc(1500),
    },
    {
      filename: "Mutual NDA.pdf",
      contentType: "application/pdf",
      content: Buffer.alloc(2_000_000),
    },
  ],
};
const link = "https://legal.example.com/auto-docs/auto-doc-1/generations/generation-1";

it("keeps the authored text, subject and recipient unchanged", () => {
  const mail = renderGenerationMail(input);
  expect(mail.to).toBe(input.to);
  expect(mail.subject).toBe("Mutual NDA is ready");
  expect(mail.text).toBe(
    "Northwind · OpenLaw\n\nHello Dana,\n\nYour generated Mutual NDA is attached.\n\n" +
      "Read clause 7.\n\nKeep a copy.\n\n- Sign the document\n- Read the policy (https://legal.example.com/policy)\n\n" +
      "1. Send it to Legal\n2. Keep the original\n\nDownload your files:\n" +
      link,
  );
});

it("puts the label, headline, greeting and sentence above a formatted Legal note", () => {
  const { html } = renderGenerationMail(input);
  expect(html).toMatch(
    />[^<]*Auto-Doc<\/p>[\s\S]*<h1[^>]*>Mutual NDA<\/h1>[\s\S]*Hello Dana,[\s\S]*Your generated Mutual NDA is attached\./,
  );
  expect(html).toContain(">Your generated Mutual NDA is attached.</div>");
  expect(html).toContain("Note from Northwind Legal");
  expect(html).toMatch(/<p[^>]*>Read <strong>clause 7<\/strong>\.<\/p>/);
  expect(html).toMatch(/<p[^>]*>Keep a copy\.<\/p>/);
  expect(html).toMatch(
    /<ul[^>]*><li>Sign the document<\/li><li><a href="https:\/\/legal.example.com\/policy"/,
  );
  expect(html).toMatch(/<ol[^>]*><li>Send it to Legal<\/li><li>Keep the original<\/li><\/ol>/);
});

it("lists the attached files with badges and sizes, followed by the download button", () => {
  const { html, attachments } = renderGenerationMail(input);
  expect(html).toMatch(/width="28" height="28"[^>]*>W<\/td>/);
  expect(html).toMatch(/width="28" height="28"[^>]*>P<\/td>/);
  expect(html).toContain("Mutual NDA.docx<br>");
  expect(html).toContain("Mutual NDA.pdf<br>");
  expect(html).toContain("Attached · 1.5 kB");
  expect(html).toContain("Attached · 2 MB");
  const button = html!.match(/<a href="([^"]+)"[^>]*>Download your files<\/a>/);
  expect(button?.[1]).toBe(link);
  expect(html!.indexOf("Download your files")).toBeGreaterThan(html!.indexOf("Mutual NDA.pdf<br>"));
  expect(attachments?.filter((attachment) => !attachment.cid)).toEqual(input.attachments);
  expect(attachments?.[0]).toBe(input.attachments[0]);
  expect(attachments?.[1]).toBe(input.attachments[1]);
  const logo = attachments?.find((attachment) => attachment.cid);
  expect(logo?.content.subarray(0, 8).toString("hex")).toBe("89504e470d0a1a0a");
  expect(html).toContain(`cid:${logo?.cid}`);
  expect(html).not.toContain("openlaw-192.png<br>");
});

it.each([null, "", "  \n\n  "])(
  "omits an empty cover note and keeps the empty text part for %s",
  (coverNote) => {
    const mail = renderGenerationMail({ ...input, coverNote, organizationName: "" });
    expect(mail.html).not.toContain("Note from");
    expect(mail.html).toContain("Sent by OpenLaw");
    expect(mail.text).toBe(
      `OpenLaw\n\nHello Dana,\n\nYour generated Mutual NDA is attached.\n\n\n\nDownload your files:\n${link}`,
    );
  },
);

it("uses the organization logo and Portal header without changing the text or download link", () => {
  const logo = Buffer.from("organization logo");
  const mail = renderGenerationMail({
    ...input,
    surface: "portal",
    emailLogoPng: logo.toString("base64"),
  });
  expect(mail.html).toContain("/ Legal portal");
  expect(mail.html).toContain(`href="${link}"`);
  expect(mail.attachments?.find((attachment) => attachment.cid)).toMatchObject({
    filename: "org-logo.png",
    contentType: "image/png",
    content: logo,
    cid: "org-logo@openlaw",
  });
  expect(mail.html).toContain("cid:org-logo@openlaw");
  expect(mail.text).toBe(renderGenerationMail(input).text);
});

it("escapes user-written values and keeps cover-note code and links safe", () => {
  const { html } = renderGenerationMail({
    ...input,
    personName: "Dana <script>",
    autoDocName: "NDA & <img>",
    organizationName: "Northwind <script>",
    coverNote:
      "<script>alert(1)</script>\n\n```\n<tag>\n```\n\n[Unsafe](javascript:alert)\n\n[Legal](mailto:legal@example.com)",
    attachments: [{ ...input.attachments[0]!, filename: 'NDA <img src="x">.docx' }],
  });
  expect(html).toContain("Dana &lt;script&gt;");
  expect(html).toContain("NDA &amp; &lt;img&gt;");
  expect(html).toContain("Note from Northwind &lt;script&gt; Legal");
  expect(html).toContain("NDA &lt;img src=&quot;x&quot;&gt;.docx");
  expect(html).toContain("<code>&lt;tag&gt;</code>");
  expect(html).toContain('href="mailto:legal@example.com"');
  expect(html).not.toMatch(/<script|src=["']data:|href=["']javascript:|calc\(/i);
});
