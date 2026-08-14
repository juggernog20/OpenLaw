// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Emails to upload in a test (M12/5).
 *
 * Both builders write real files rather than stubs. An EML is text, so
 * it is written as text. A MSG is a compound file — Outlook's own
 * on-disk filesystem — so it is burned as one, from the same CFBF writer
 * the reader ships beside its parser.
 *
 * That is deliberate and it is the only honest option here. A fixture
 * that faked the container would prove the mapping and nothing about the
 * reading, and the one thing a suite must not do is pass while the
 * format it claims to support fails. It is the ZIP the rendition suite
 * builds by hand, one format up.
 */

import { burn, type Entry } from "@kenjiuno/msgreader/lib/Burner.js";
import { TypeEnum } from "@kenjiuno/msgreader/lib/Reader.js";

/** One file inside a message. */
export interface FixtureAttachment {
  filename: string;
  mimeType: string;
  content: Buffer;
  /** A content id makes it a part the body refers to rather than an
   * enclosure beside it. */
  contentId?: string;
  /**
   * MSG only: name the file but write no content stream, which is what a
   * damaged compound file looks like to the reader — an attachment entry
   * whose bytes cannot be given up. It is the case the parser must keep
   * at its own position rather than drop, so every attachment after it
   * keeps its address.
   */
  omitContent?: boolean;
}

/** What either builder is told. Every field is optional, because half
 * the cases here are about a message that left one out. */
export interface EmailFixture {
  subject?: string;
  from?: { name?: string; address: string };
  to?: { name?: string; address: string }[];
  cc?: { name?: string; address: string }[];
  date?: string;
  text?: string;
  html?: string;
  /**
   * MSG only: write the HTML body as the binary `PidTagHtml` property
   * rather than the string one.
   *
   * Outlook writes either, depending on its version, and a reader has to
   * take both. The default writes the string form; this flag is what
   * covers the other path.
   */
  htmlAsBinary?: boolean;
  attachments?: FixtureAttachment[];
}

/** One RFC 822 message, as a mail client would write it. */
export function emlFixture(email: EmailFixture): Buffer {
  const boundary = "openlaw-fixture-boundary";
  const lines: string[] = [];
  if (email.from) lines.push(`From: ${addressLine(email.from)}`);
  if (email.to?.length) lines.push(`To: ${email.to.map(addressLine).join(", ")}`);
  if (email.cc?.length) lines.push(`Cc: ${email.cc.map(addressLine).join(", ")}`);
  if (email.subject !== undefined) lines.push(`Subject: ${email.subject}`);
  if (email.date !== undefined) lines.push(`Date: ${email.date}`);
  lines.push("MIME-Version: 1.0");
  lines.push(`Content-Type: multipart/mixed; boundary="${boundary}"`, "");

  // Two bodies are two tellings of one message, so they go inside a
  // `multipart/alternative` exactly as a mail client writes them. Beside
  // one another in the `mixed` part they would be two pieces of content,
  // and a reader — ours included — would show both.
  const alternative = "openlaw-fixture-alternative";
  const bodies = [
    ...(email.text === undefined
      ? []
      : [["Content-Type: text/plain; charset=utf-8", "", email.text]]),
    ...(email.html === undefined
      ? []
      : [["Content-Type: text/html; charset=utf-8", "", email.html]]),
  ];
  if (bodies.length === 1) {
    lines.push(`--${boundary}`, ...bodies[0]!);
  } else if (bodies.length === 2) {
    lines.push(
      `--${boundary}`,
      `Content-Type: multipart/alternative; boundary="${alternative}"`,
      "",
      ...bodies.flatMap((body) => [`--${alternative}`, ...body]),
      `--${alternative}--`,
    );
  }
  for (const attachment of email.attachments ?? []) {
    lines.push(
      `--${boundary}`,
      `Content-Type: ${attachment.mimeType}; name="${attachment.filename}"`,
      "Content-Transfer-Encoding: base64",
      attachment.contentId === undefined
        ? `Content-Disposition: attachment; filename="${attachment.filename}"`
        : `Content-Disposition: inline; filename="${attachment.filename}"`,
      ...(attachment.contentId === undefined ? [] : [`Content-ID: <${attachment.contentId}>`]),
      "",
      attachment.content.toString("base64"),
    );
  }
  lines.push(`--${boundary}--`, "");
  return Buffer.from(lines.join("\r\n"), "utf8");
}

function addressLine(address: { name?: string; address: string }): string {
  return address.name === undefined ? address.address : `${address.name} <${address.address}>`;
}

/**
 * One Outlook message, as a compound file.
 *
 * The properties are written as `__substg1.0_` streams under the root,
 * which is where a MSG keeps its strings; recipients and attachments are
 * the numbered storages beside them. The property tags are
 * [MS-OXPROPS]'s own — `0037` is the subject, `1000` the plain body, and
 * so on — and `001F` on the end of each says the value is UTF-16.
 */
export function msgFixture(email: EmailFixture): Buffer {
  const root: Stream[] = [];
  if (email.subject !== undefined) root.push(unicode("0037", email.subject));
  if (email.from?.name !== undefined) root.push(unicode("0C1A", email.from.name));
  if (email.from !== undefined) root.push(unicode("0C1F", email.from.address));
  if (email.text !== undefined) root.push(unicode("1000", email.text));
  if (email.html !== undefined) {
    // `1013` is the HTML body. `001F` on the end says the value is a
    // UTF-16 string and `0102` says it is bytes — Outlook writes one or
    // the other, so the fixture can write either.
    root.push(
      email.htmlAsBinary
        ? { name: "__substg1.0_10130102", bytes: new Uint8Array(Buffer.from(email.html, "utf8")) }
        : unicode("1013", email.html),
    );
  }

  const folders: Folder[] = [];
  let recipient = 0;
  for (const [addresses, type] of [
    [email.to ?? [], "to"],
    [email.cc ?? [], "cc"],
  ] as const) {
    for (const address of addresses) {
      const streams: Stream[] = [unicode("3003", address.address)];
      if (address.name !== undefined) streams.push(unicode("3001", address.name));
      // `0C15` is the recipient type, a 32-bit integer: 1 is To and 2 is
      // Cc. Written as a binary property, which is how a numeric one is
      // stored outside the property stream.
      streams.push({ name: "__substg1.0_0C150003", bytes: recipientType(type) });
      folders.push({ name: `__recip_version1.0_#${index(recipient)}`, streams });
      recipient += 1;
    }
  }

  (email.attachments ?? []).forEach((attachment, position) => {
    const streams: Stream[] = [
      unicode("3707", attachment.filename),
      unicode("3704", attachment.filename),
      unicode("370E", attachment.mimeType),
    ];
    if (attachment.omitContent !== true) {
      streams.push({ name: "__substg1.0_37010102", bytes: new Uint8Array(attachment.content) });
    }
    if (attachment.contentId !== undefined) streams.push(unicode("3712", attachment.contentId));
    folders.push({ name: `__attach_version1.0_#${index(position)}`, streams });
  });

  return compoundFile(root, folders);
}

/** One stream inside the compound file: its MSG name and its bytes. */
interface Stream {
  name: string;
  bytes: Uint8Array;
}

/** One storage inside it — a recipient or an attachment. */
interface Folder {
  name: string;
  streams: Stream[];
}

/** A string property, in the UTF-16 a MSG stores its strings as. */
function unicode(tag: string, value: string): Stream {
  return {
    name: `__substg1.0_${tag.toUpperCase()}001F`,
    bytes: new Uint8Array(Buffer.from(value, "utf16le")),
  };
}

/** The recipient-type property's four bytes. */
function recipientType(type: "to" | "cc"): Uint8Array {
  const bytes = Buffer.alloc(4);
  bytes.writeUInt32LE(type === "to" ? 1 : 2, 0);
  return new Uint8Array(bytes);
}

/** The eight-digit hex suffix a numbered storage carries. */
function index(position: number): string {
  return position.toString(16).toUpperCase().padStart(8, "0");
}

/** The container itself: a root, its streams, and its storages. */
function compoundFile(rootStreams: Stream[], folders: Folder[]): Buffer {
  const entries: Entry[] = [{ name: "Root Entry", type: TypeEnum.ROOT, children: [], length: 0 }];
  const add = (parent: number, entry: Entry): number => {
    const position = entries.length;
    entries.push(entry);
    entries[parent]!.children!.push(position);
    return position;
  };
  const document = (stream: Stream): Entry => ({
    name: stream.name,
    type: TypeEnum.DOCUMENT,
    binaryProvider: () => stream.bytes,
    length: stream.bytes.length,
  });

  for (const stream of rootStreams) add(0, document(stream));
  for (const folder of folders) {
    const storage = add(0, {
      name: folder.name,
      type: TypeEnum.DIRECTORY,
      children: [],
      length: 0,
    });
    for (const stream of folder.streams) add(storage, document(stream));
  }
  return Buffer.from(burn(entries));
}
