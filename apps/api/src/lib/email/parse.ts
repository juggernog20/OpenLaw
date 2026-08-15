// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Reading an uploaded email (DOC-004, TECH-010, M12/5).
 *
 * A Legal Team Member uploads the message a deal was agreed in and opens
 * it on the record. What they must see is an email — who sent it, who it
 * went to, when, what it said, and what came with it — rather than the
 * binary blob M11 could only offer as a download.
 *
 * **Parsing is in process, and the doc engine is not involved**
 * (TECH-010). An email is a text format with a text format inside it; no
 * LibreOffice, no OCR, and no round trip to the sidecar. Two libraries do
 * the reading, one per container format, and both are permissively
 * licensed: `postal-mime` (MIT-0, no dependencies of its own) for the
 * RFC 822 messages an EML holds, and `@kenjiuno/msgreader` (Apache-2.0)
 * for the compound-file format Outlook's MSG is.
 *
 * **Two formats, one shape.** Everything above this file sees
 * {@link ParsedEmail} and never learns which library read it. The two
 * containers say the same things in different words — MSG has a sender
 * name beside a sender address and a recipient table with a type column;
 * EML has header lines — and the mapping between them lives here, once.
 *
 * **The whole file is read into memory, and that is bounded on purpose.**
 * Neither container can be parsed as a stream: a MSG is a random-access
 * filesystem and a MIME tree is only whole once its last boundary is
 * read. So a size ceiling stands in front of the parse rather than a
 * stream behind it, and an email past it is refused with the same
 * terminal error a corrupt one gets — no retry reads it any smaller.
 *
 * **The HTML body leaves here sanitized, always.** There is no accessor
 * on {@link ParsedEmail} that answers the sender's own markup: the field
 * holds what {@link sanitizeEmailHtml} left, so no caller can render the
 * raw form by forgetting a step.
 *
 * **What comes out is a hint, exactly as the routing table is.** An
 * attachment's declared type and filename were written by whoever sent
 * the message, so they route it to a family and never decide what a
 * response says the bytes are (DOC-004).
 */

import msgReaderModule from "@kenjiuno/msgreader";
import type { FieldsData } from "@kenjiuno/msgreader";
import PostalMime from "postal-mime";
import { extensionOf, renderFamilyOf } from "../render-family.js";
import { emailHtmlToText, sanitizeEmailHtml } from "./sanitize.js";

/**
 * The MSG reader, through the one interop step a CommonJS package needs.
 *
 * The package is CommonJS with a TypeScript `export default`. Node hands
 * an ESM importer the whole `module.exports`, which is an object holding
 * the class under `default`; a bundler that understands the same package
 * hands over the class itself. Both are answered here rather than at
 * every call site, and neither is guessed at — the shape is asked, and
 * anything else stops the process at import rather than at the first
 * email somebody opens.
 */
type MsgReaderClass = typeof msgReaderModule.default;
const imported: unknown = msgReaderModule;
const exported =
  typeof imported === "object" && imported !== null && "default" in imported
    ? (imported as { default: unknown }).default
    : imported;
if (typeof exported !== "function") {
  // Loudly, at import time. A cast that guessed wrong here would fail
  // later as "MsgReader is not a constructor" on the first email
  // somebody opened, which is a long way from the line that caused it.
  throw new TypeError("@kenjiuno/msgreader did not export a constructor.");
}
const MsgReader = exported as MsgReaderClass;

/**
 * The largest email this parser will open.
 *
 * The bound exists because the parse is in memory: a worker reading a
 * queue of them must not be one upload away from being killed by the
 * kernel. Twenty-five mebibytes is past what most relays will carry — a
 * great many refuse a message at ten — and it is a ceiling rather than a
 * guarantee: a message with large attachments, or one an internal
 * Exchange carried without a relay's limits, really can be bigger.
 *
 * A file past the bound is not a broken upload and not a lost one. It is
 * stored, it downloads, and it is refused only the parsed reading of
 * itself.
 */
export const MAX_PARSEABLE_EMAIL_BYTES = 25 * 1024 * 1024;

/**
 * The bytes are not readable as the email they claim to be, or there are
 * too many of them to read.
 *
 * Terminal, on the doc engine's own terms: a retry parses the same bytes
 * and fails the same way, so the derivation is marked failed rather than
 * handed back to the queue.
 */
export class EmailUnreadableError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "EmailUnreadableError";
  }
}

/** One mailbox on an email, as a header or a MSG recipient row gives
 * it. Either half can be missing: a sender with no display name is
 * ordinary, and an Exchange recipient with no resolvable address is
 * not rare. */
export interface EmailAddress {
  name: string | null;
  address: string | null;
}

/** One file that came with the message. */
export interface EmailAttachment {
  /**
   * Where it sits in the message, counted from zero.
   *
   * It is the attachment's identity in every address the API hands out,
   * and it is stable because the thing it indexes into is: a version's
   * bytes are immutable (DOC-001), so parsing the same blob twice always
   * produces the same list in the same order.
   */
  index: number;
  /** What the message called it, or a name made up here when it called
   * it nothing — a file with no name cannot be offered as a download. */
  filename: string;
  /** What the message declared it was. A hint, never a decision. */
  mimeType: string;
  byteSize: number;
  /**
   * Whether the body referred to this file rather than presenting it —
   * a signature logo, an inlined screenshot.
   *
   * It is listed either way, because the sanitized body never draws a
   * remote or embedded image and an inline attachment nobody listed
   * would be unreachable. The flag is what lets the panel say which is
   * which.
   */
  isInline: boolean;
  /**
   * The file itself, or NULL when the message named it and the container
   * could not give up its bytes.
   *
   * The entry stays in the list either way, and at its own position:
   * dropping it would lose the message's account of what was attached,
   * and — worse — would shift every attachment after it onto an address
   * that used to mean another file. A reader is told the file is there
   * and that this copy of it cannot be opened, which is what is true.
   */
  content: Buffer | null;
}

/** One email, however it was stored. */
export interface ParsedEmail {
  subject: string | null;
  from: EmailAddress | null;
  to: EmailAddress[];
  cc: EmailAddress[];
  bcc: EmailAddress[];
  /** When it was sent, as an ISO 8601 instant, or NULL when the message
   * carried no readable date. */
  date: string | null;
  /** The HTML body, **already sanitized** — never the sender's own
   * markup. NULL when the message had no HTML body at all. */
  html: string | null;
  /** The plain-text body as the message carried it, or NULL when it
   * carried only HTML. */
  text: string | null;
  attachments: EmailAttachment[];
}

/**
 * Whether this stored file is an email at all (DOC-004).
 *
 * Asked of the routing table rather than of a list kept here, so the
 * families stay decided in one place and an extension added there
 * reaches this parser without a second edit.
 */
export function isEmail(mimeType: string, filename: string): boolean {
  return renderFamilyOf(mimeType, filename) === "email";
}

/**
 * Reads one stored email.
 *
 * `mimeType` and `filename` choose the container — Outlook's MSG or a
 * MIME message — and nothing else. They are the uploader's own strings,
 * so a file that lies about itself gets the wrong reader and fails
 * terminally; it never gets a trusted one.
 */
export async function parseEmail(
  bytes: Buffer,
  mimeType: string,
  filename: string,
): Promise<ParsedEmail> {
  if (bytes.byteLength > MAX_PARSEABLE_EMAIL_BYTES) {
    throw new EmailUnreadableError(
      `This email is ${bytes.byteLength} bytes, past the ${MAX_PARSEABLE_EMAIL_BYTES}-byte parsing limit.`,
    );
  }
  return isOutlookMessage(mimeType, filename)
    ? parseOutlookMessage(bytes)
    : parseMimeMessage(bytes);
}

/**
 * Reads one email out of the stream a stored blob opens as.
 *
 * The bound is applied while the bytes arrive rather than after they are
 * all here, which is the point: a hundred-megabyte upload declaring
 * itself an email must not be held in memory on its way to being
 * refused. The stream is left to the caller to close — the two callers
 * both open it through something that closes it whatever happens.
 */
export async function parseStoredEmail(
  blob: AsyncIterable<Buffer | string>,
  mimeType: string,
  filename: string,
): Promise<ParsedEmail> {
  const chunks: Buffer[] = [];
  let byteSize = 0;
  for await (const chunk of blob) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    byteSize += buffer.byteLength;
    if (byteSize > MAX_PARSEABLE_EMAIL_BYTES) {
      throw new EmailUnreadableError(
        `This email is past the ${MAX_PARSEABLE_EMAIL_BYTES}-byte parsing limit.`,
      );
    }
    chunks.push(buffer);
  }
  return parseEmail(Buffer.concat(chunks), mimeType, filename);
}

/**
 * RFC 5322's field name, and the colon that ends it: printable ASCII
 * without spaces or the colon itself. Compiled once, because it is asked
 * of every header line of every message.
 */
const HEADER_LINE = /^[\x21-\x39\x3b-\x7e]+:/;

/** Whether the container is Outlook's rather than MIME's. The two
 * declared types and the two extensions both route to the same family,
 * so the split is made here and only here. */
function isOutlookMessage(mimeType: string, filename: string): boolean {
  return (
    mimeType.split(";")[0]!.trim().toLowerCase() === "application/vnd.ms-outlook" ||
    extensionOf(filename) === "msg"
  );
}

/** The EML route: an RFC 822 message, whatever its nesting. */
async function parseMimeMessage(bytes: Buffer): Promise<ParsedEmail> {
  let email;
  try {
    email = await PostalMime.parse(bytes);
  } catch (error) {
    throw new EmailUnreadableError("These bytes could not be read as an email message.", {
      cause: error,
    });
  }
  // A MIME parser reads anything, because a MIME message is text with a
  // blank line in it — there is no magic number to fail on, the way a
  // MSG's compound-file header fails. So the refusal is made from what
  // came out. A message says at least one of three things: a header, a
  // body, or a file. A header is a field name, a colon, and a value, and
  // RFC 5322 says what a field name may be made of — so a line that is
  // not shaped like one is not a header however willingly the parser
  // filed it as one, which is exactly what a line of prose in a
  // mislabelled text file becomes. Nothing at all means these are bytes with an
  // `.eml` on the end, and it is said terminally, because reading them
  // again reads the same nothing.
  const readable =
    email.headerLines.some((header) => HEADER_LINE.test(header.line)) ||
    email.html !== undefined ||
    email.text !== undefined ||
    email.attachments.length > 0;
  if (!readable) {
    throw new EmailUnreadableError("These bytes could not be read as an email message.");
  }

  const attachments = email.attachments.map((attachment, index) => {
    const content = attachmentBytes(attachment.content, attachment.encoding);
    return {
      index,
      filename: attachment.filename?.trim() || fallbackName(index, attachment.mimeType),
      mimeType: attachment.mimeType || "application/octet-stream",
      byteSize: content.byteLength,
      // `related` marks a part the body refers to by content id; a
      // disposition of `inline` says the same thing in the other
      // vocabulary. Either is enough.
      isInline: attachment.related === true || attachment.disposition === "inline",
      content,
    };
  });

  return {
    subject: nonEmpty(email.subject),
    from: mailbox(email.from),
    to: mailboxes(email.to),
    cc: mailboxes(email.cc),
    bcc: mailboxes(email.bcc),
    date: instant(email.date),
    html: email.html === undefined ? null : sanitizeEmailHtml(email.html),
    text: nonEmpty(email.text),
    attachments,
  };
}

/** The MSG route: Outlook's compound file, read property by property. */
function parseOutlookMessage(bytes: Buffer): ParsedEmail {
  let reader: InstanceType<MsgReaderClass>;
  let fields: FieldsData;
  try {
    // A copy, not a view. `Buffer.buffer` is the pool the allocator
    // handed out and is usually far larger than the buffer sitting in
    // it, so passing it whole would have the reader parse somebody
    // else's bytes.
    reader = new MsgReader(
      bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer,
    );
    fields = reader.getFileData();
  } catch (error) {
    throw new EmailUnreadableError("These bytes could not be read as an Outlook message.", {
      cause: error,
    });
  }
  // The reader reports a file it opened but could not understand in the
  // answer rather than by throwing.
  if (fields.error !== undefined) {
    throw new EmailUnreadableError(`This Outlook message could not be read: ${fields.error}`);
  }

  const recipients = fields.recipients ?? [];
  const html = fields.bodyHtml ?? decodeHtmlProperty(fields.html);

  return {
    subject: nonEmpty(fields.subject),
    from: senderOf(fields),
    // A recipient row with no type is a `To`: Outlook writes the column
    // for everybody it resolved, and a row that lost it is more likely a
    // reader's gap than a message with a nameless recipient.
    to: recipientsOf(recipients, "to"),
    cc: recipientsOf(recipients, "cc"),
    bcc: recipientsOf(recipients, "bcc"),
    // When it was delivered, else when it was sent, else when the file
    // itself was made. The first two are the message's own facts and the
    // third is the container's, so they are asked in that order.
    date:
      instant(fields.messageDeliveryTime) ??
      instant(fields.clientSubmitTime) ??
      instant(fields.creationTime),
    html: html === null ? null : sanitizeEmailHtml(html),
    text: nonEmpty(fields.body),
    attachments: outlookAttachments(reader, fields),
  };
}

/** Every file on an Outlook message, in the order the container holds
 * them. */
function outlookAttachments(
  reader: InstanceType<MsgReaderClass>,
  fields: FieldsData,
): EmailAttachment[] {
  const attachments: EmailAttachment[] = [];
  (fields.attachments ?? []).forEach((attachment, index) => {
    // One attachment the container cannot give up does not cost the
    // message. Its body, its headers, and every other file on it are
    // still exactly what was sent, and losing all of them because one
    // stream is damaged would be the wrong trade — so the entry is kept
    // at its own position with no bytes behind it.
    let content: Buffer | null;
    try {
      content = Buffer.from(reader.getAttachment(attachment).content);
    } catch {
      content = null;
    }
    const declared = nonEmpty(attachment.attachMimeTag) ?? "application/octet-stream";
    attachments.push({
      index,
      filename:
        nonEmpty(attachment.fileName) ??
        nonEmpty(attachment.fileNameShort) ??
        nonEmpty(attachment.name) ??
        fallbackName(index, declared),
      mimeType: declared,
      // What the container said it was, when the bytes could not be
      // read: the message's own account of the file is still the honest
      // answer to "how big is it".
      byteSize: content?.byteLength ?? attachment.contentLength ?? 0,
      // A content id is what the body's `cid:` reference points at, and
      // a hidden attachment is one Outlook does not show in its own
      // list. Either makes it part of the message rather than an
      // enclosure with it.
      isInline: attachment.pidContentId !== undefined || attachment.attachmentHidden === true,
      content,
    });
  });
  return attachments;
}

/** The sender, preferring the address a mail system could actually
 * deliver to. Outlook stores an internal directory name in
 * `senderEmail` for anybody inside the organisation, and the SMTP
 * address beside it. */
function senderOf(fields: FieldsData): EmailAddress | null {
  const name = nonEmpty(fields.senderName);
  const address = nonEmpty(fields.senderSmtpAddress) ?? nonEmpty(fields.senderEmail);
  return name === null && address === null ? null : { name, address };
}

/** One recipient column of an Outlook message. */
function recipientsOf(recipients: FieldsData[], type: "to" | "cc" | "bcc"): EmailAddress[] {
  return recipients
    .filter((recipient) => (recipient.recipType ?? "to") === type)
    .map((recipient) => ({
      name: nonEmpty(recipient.name),
      address: nonEmpty(recipient.smtpAddress) ?? nonEmpty(recipient.email),
    }));
}

/** Outlook's other HTML body property, which holds the markup as bytes
 * rather than as a string. */
function decodeHtmlProperty(html: Uint8Array | undefined): string | null {
  return html === undefined ? null : nonEmpty(Buffer.from(html).toString("utf8"));
}

/** One MIME part's bytes, whichever way the parser handed them over. */
function attachmentBytes(
  content: ArrayBuffer | Uint8Array | string,
  encoding: "base64" | "utf8" | undefined,
): Buffer {
  if (typeof content === "string") return Buffer.from(content, encoding ?? "utf8");
  return Buffer.from(content instanceof Uint8Array ? content : new Uint8Array(content));
}

/** The name an attachment that carried none is offered under. It says
 * where in the message it came from, so two of them are still two
 * different files to whoever downloads them. */
function fallbackName(index: number, mimeType: string): string {
  const subtype = mimeType.split(";")[0]!.split("/")[1]?.trim().toLowerCase() ?? "";
  const extension = /^[a-z0-9]{1,8}$/.test(subtype) ? `.${subtype}` : "";
  return `attachment-${index + 1}${extension}`;
}

/** One address, or NULL when the field held nothing worth showing. A
 * group with no members reads as no address at all. */
function mailbox(address: { name?: string; address?: string } | undefined): EmailAddress | null {
  if (address === undefined) return null;
  const name = nonEmpty(address.name);
  const value = nonEmpty(address.address);
  return name === null && value === null ? null : { name, address: value };
}

/** A header's whole list, with the groups flattened into the mailboxes
 * they hold — a reader wants the people, not the syntax. */
function mailboxes(
  addresses:
    { name?: string; address?: string; group?: { name: string; address: string }[] }[] | undefined,
): EmailAddress[] {
  const flat: EmailAddress[] = [];
  for (const address of addresses ?? []) {
    if (address.group) {
      for (const member of address.group) {
        const inner = mailbox(member);
        if (inner) flat.push(inner);
      }
      continue;
    }
    const one = mailbox(address);
    if (one) flat.push(one);
  }
  return flat;
}

/** A date string from either container, as an ISO instant — or NULL
 * when it was absent or unreadable. A message with a broken `Date`
 * header is still a message. */
function instant(value: string | undefined): string | null {
  if (value === undefined || value.trim().length === 0) return null;
  const at = new Date(value);
  return Number.isNaN(at.getTime()) ? null : at.toISOString();
}

/** A string that says something, or NULL. The two containers both use
 * an empty property where they mean "not set". */
function nonEmpty(value: string | undefined): string | null {
  const trimmed = value?.trim() ?? "";
  return trimmed.length > 0 ? trimmed : null;
}

/**
 * The words of one email's body, for its extracted text (DOC-005).
 *
 * The plain-text body when the message carried one, and the sanitized
 * HTML read as text otherwise. The plain part is preferred because it is
 * what the sender wrote rather than a reading of their markup — and
 * because a message that carries both says the same thing twice.
 */
export function emailBodyText(email: ParsedEmail): string {
  if (email.text !== null) return email.text.trim();
  return email.html === null ? "" : emailHtmlToText(email.html);
}
