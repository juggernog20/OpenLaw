// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The email surface (M12/5), drawn from the DOC6 mock in
 * `designs/documents.pen`: an uploaded MSG or EML reads as a message,
 * not as a binary blob (DOC-004).
 *
 * **Three parts, from the mock.** A header of labelled rows — subject,
 * from, to, cc, date. The body below it. An attachment strip along the
 * bottom, one chip per file. The header and the strip stay put and the
 * body scrolls, because a reader working through a long thread should
 * not lose sight of who sent it.
 *
 * **The body is drawn inside a sandboxed frame, and that is the second
 * wall.** The server already cut the sender's HTML down to an allow-list
 * before it left the API. This frame is what makes a hole in that
 * sanitizer cost nothing: it runs no scripts, it reaches no origin, and
 * its own policy blocks every request it could make. A sanitizer is a
 * parser, parsers have bugs, and one bug should not be one origin.
 *
 * **The body is a sheet of paper, not a piece of the application.** It
 * is drawn light whatever theme the app is in, exactly as the PDF
 * surface draws a white page in the dark theme. An email was written
 * against a white background — its own colours say so — and re-tinting
 * somebody else's message is how a signature block ends up black on
 * black.
 *
 * **An attachment that reads in the app opens here.** A PDF or a raster
 * image swaps the message for the panel's own surface, with one control
 * back to it; everything else is a download. There is no conversion path
 * for an attachment, so a Word file inside an email downloads.
 */

import { lazy, Suspense, useEffect, useState } from "react";
import { ArrowLeft, Download, Paperclip } from "lucide-react";
import { FormattedMessage, useIntl } from "react-intl";
import { formatFileSize, formatLongDateTime } from "../../lib/format";
import { ChunkBoundary } from "../chunk-boundary";
import {
  emailAttachmentDownloadHref,
  emailAttachmentPreviewHref,
  isPreviewableAttachment,
  readEmail,
  type EmailAttachment,
  type ParsedEmail,
} from "../../lib/documents";

/** The PDF surface, loaded only when an attached PDF is opened — the
 * same lazy import the panel makes for a stored PDF, so a reader who
 * never opens one never fetches the parser. */
const PdfPreview = lazy(async () => ({
  default: (await import("./pdf-preview")).PdfPreview,
}));

/** What the panel is waiting on, or what it got. */
type Loaded = { state: "loading" } | { state: "failed" } | { state: "ready"; email: ParsedEmail };

export function EmailPreview({
  documentId,
  versionId,
  onUnreadable,
}: Readonly<{
  documentId: string;
  versionId: string;
  /** Called when the message cannot be read at all, so the panel can
   * offer the download it always offers when a preview is not coming. */
  onUnreadable: () => void;
}>) {
  const [loaded, setLoaded] = useState<Loaded>({ state: "loading" });
  // Which attachment is open, by its position in the message. `null` is
  // the message itself.
  const [open, setOpen] = useState<number | null>(null);
  // Which message the state above is about. The panel can move from one
  // version to another without unmounting, so a new address resets both
  // during render, before the read below starts.
  const address = `${documentId}/${versionId}`;
  const [shownAddress, setShownAddress] = useState(address);
  if (shownAddress !== address) {
    setShownAddress(address);
    setLoaded({ state: "loading" });
    setOpen(null);
  }

  useEffect(() => {
    let live = true;
    void readEmail(documentId, versionId).then((outcome) => {
      // The panel closed, or moved to another version, while the answer
      // was in flight.
      if (!live) return;
      setLoaded(outcome.ok ? { state: "ready", email: outcome.email } : { state: "failed" });
    });
    return () => {
      live = false;
    };
  }, [documentId, versionId]);

  // Reported to the panel rather than drawn here, so every "there is no
  // preview" path in the panel ends at one card.
  useEffect(() => {
    if (loaded.state === "failed") onUnreadable();
  }, [loaded.state, onUnreadable]);

  if (loaded.state !== "ready") {
    // Both states draw the same line. A failed read is already on its
    // way to the panel's own card through the effect above, and this is
    // the frame before that lands — so it says what the loading state
    // says rather than flashing a second sentence nobody finishes
    // reading.
    return (
      <p role="status" className="px-4 py-6 text-base text-muted">
        <FormattedMessage id="docPanel.email.loading" defaultMessage="Opening…" />
      </p>
    );
  }

  const attachment = open === null ? undefined : loaded.email.attachments[open];
  if (attachment) {
    return (
      <OpenAttachment
        documentId={documentId}
        versionId={versionId}
        attachment={attachment}
        onBack={() => setOpen(null)}
      />
    );
  }
  return (
    <Message documentId={documentId} versionId={versionId} email={loaded.email} onOpen={setOpen} />
  );
}

/** The message itself: headers, body, attachments. */
function Message({
  documentId,
  versionId,
  email,
  onOpen,
}: Readonly<{
  documentId: string;
  versionId: string;
  email: ParsedEmail;
  onOpen: (index: number) => void;
}>) {
  const intl = useIntl();
  return (
    <div className="min-h-0 flex-1 overflow-auto bg-canvas p-4">
      <div className="mx-auto flex h-full min-h-0 w-full flex-col rounded-card border border-border-default bg-raised">
        <div className="flex shrink-0 flex-col gap-2 border-b border-border-muted px-5 py-4">
          <HeaderRow
            label={intl.formatMessage({ id: "docPanel.email.subject", defaultMessage: "Subject" })}
          >
            {/* The one row that is the message's own words, so it is set
                like a title rather than like a field value. */}
            <span className="font-semibold">
              {email.subject ?? (
                <FormattedMessage id="docPanel.email.noSubject" defaultMessage="No subject" />
              )}
            </span>
          </HeaderRow>
          <HeaderRow
            label={intl.formatMessage({ id: "docPanel.email.from", defaultMessage: "From" })}
          >
            <Addresses addresses={email.from === null ? [] : [email.from]} />
          </HeaderRow>
          {email.to.length > 0 && (
            <HeaderRow
              label={intl.formatMessage({ id: "docPanel.email.to", defaultMessage: "To" })}
            >
              <Addresses addresses={email.to} />
            </HeaderRow>
          )}
          {email.cc.length > 0 && (
            <HeaderRow
              label={intl.formatMessage({ id: "docPanel.email.cc", defaultMessage: "Cc" })}
            >
              <Addresses addresses={email.cc} />
            </HeaderRow>
          )}
          {/* A message read out of a recipient's mailbox carries no Bcc,
              but one saved from the sender's own — which is what a MSG
              dragged out of Sent Items is — names everybody it was
              blind-copied to. The server hands the list over either way,
              and a row the panel held back would be the one recipient
              class a reader could not see. */}
          {email.bcc.length > 0 && (
            <HeaderRow
              label={intl.formatMessage({ id: "docPanel.email.bcc", defaultMessage: "Bcc" })}
            >
              <Addresses addresses={email.bcc} />
            </HeaderRow>
          )}
          {email.date !== null && (
            <HeaderRow
              label={intl.formatMessage({ id: "docPanel.email.date", defaultMessage: "Date" })}
            >
              {formatLongDateTime(email.date)}
            </HeaderRow>
          )}
        </div>
        <Body email={email} />
        {email.attachments.length > 0 && (
          <Attachments
            documentId={documentId}
            versionId={versionId}
            attachments={email.attachments}
            onOpen={onOpen}
          />
        )}
      </div>
    </div>
  );
}

/** One labelled row of the header block (DOC6's EhSubj…EhDate). */
function HeaderRow({ label, children }: Readonly<{ label: string; children: React.ReactNode }>) {
  return (
    <div className="flex gap-2 text-sm">
      <span className="w-13 shrink-0 font-medium text-subtle">{label}</span>
      <span className="min-w-0 flex-1 break-words text-primary">{children}</span>
    </div>
  );
}

/** A header's people, as a message names them: the display name when
 * there is one, and the address either way. */
function Addresses({ addresses }: Readonly<{ addresses: ParsedEmail["to"] }>) {
  if (addresses.length === 0) {
    return <FormattedMessage id="docPanel.email.noAddress" defaultMessage="Not recorded" />;
  }
  return (
    <>
      {addresses
        .map((address) =>
          address.name && address.address
            ? `${address.name} <${address.address}>`
            : (address.name ?? address.address ?? ""),
        )
        .join(", ")}
    </>
  );
}

/**
 * The policy the body's own document carries.
 *
 * It reaches nothing. Images, frames, fonts, and scripts are all
 * refused, so a message that got a remote reference past the server's
 * sanitizer still cannot fetch one. Inline style is the single
 * exception, because it is what an email's appearance is made of and the
 * server bounded which properties survive.
 */
const BODY_POLICY = "default-src 'none'; style-src 'unsafe-inline'";

/**
 * The paper an email is set on.
 *
 * Light whatever theme the application is in, for the reason a PDF page
 * is: this is somebody else's document, its own colours were chosen
 * against a white background, and re-tinting it is how a signature block
 * ends up black on black.
 */
const BODY_STYLE = `
  html { color-scheme: light; }
  body {
    margin: 0;
    padding: 20px;
    background: #ffffff;
    color: #1f2328;
    font-family: Inter, system-ui, sans-serif;
    font-size: 13px;
    line-height: 1.6;
    overflow-wrap: break-word;
  }
  a { color: #0a58ca; }
  table { border-collapse: collapse; max-width: 100%; }
  blockquote { margin: 0 0 0 12px; padding-left: 12px; border-left: 2px solid #d0d7de; }
`;

/** The message's body, drawn where it cannot reach anything. */
function Body({ email }: Readonly<{ email: ParsedEmail }>) {
  const intl = useIntl();
  const title = intl.formatMessage({
    id: "docPanel.email.body",
    defaultMessage: "Message body",
  });

  if (email.html !== null) {
    return (
      <iframe
        title={title}
        // Nothing runs and nothing shares this origin. `allow-popups`
        // is the one thing granted, and only so that a link a reader
        // clicks opens: with no scripts there is nothing else that could
        // open a window. The escape clause is what keeps the opened tab
        // an ordinary page rather than a sandboxed one — the server
        // already put `rel="noopener"` on every link that survived it.
        sandbox="allow-popups allow-popups-to-escape-sandbox"
        srcDoc={`<!doctype html><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${BODY_POLICY}"><style>${BODY_STYLE}</style>${email.html}`}
        className="min-h-0 w-full flex-1 border-0 bg-white"
      />
    );
  }
  return (
    // A plain-text body is the one that is not somebody's document: it
    // carries no colours of its own, so it is set in the application's
    // own type and follows the theme, where an HTML body is paper.
    <div
      tabIndex={0}
      role="region"
      aria-label={title}
      className="min-h-0 flex-1 overflow-auto px-5 py-4 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-link"
    >
      {/* React writes it as a text node, so there is nothing in it to
          sanitize and nothing in it to run. The sender's own line breaks
          are what shape it. */}
      <p className="text-base whitespace-pre-wrap text-primary">
        {email.text ??
          intl.formatMessage({
            id: "docPanel.email.empty",
            defaultMessage: "This message has no body.",
          })}
      </p>
    </div>
  );
}

/** The attachment strip along the bottom of the card (DOC6's AttSec). */
function Attachments({
  documentId,
  versionId,
  attachments,
  onOpen,
}: Readonly<{
  documentId: string;
  versionId: string;
  attachments: readonly EmailAttachment[];
  onOpen: (index: number) => void;
}>) {
  return (
    <div className="flex shrink-0 flex-col gap-2 border-t border-border-muted px-5 py-4">
      <p className="text-sm font-semibold text-muted">
        <FormattedMessage
          id="docPanel.email.attachments"
          defaultMessage="{count, plural, one {# attachment} other {# attachments}}"
          values={{ count: attachments.length }}
        />
      </p>
      <ul className="flex flex-wrap gap-2">
        {attachments.map((attachment) => (
          <li key={attachment.index}>
            <Attachment
              documentId={documentId}
              versionId={versionId}
              attachment={attachment}
              onOpen={onOpen}
            />
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * One attachment chip.
 *
 * A file that reads in the app is a button, and pressing it opens the
 * file here. A file that does not is a download link, which is the same
 * split the record's own document list makes — so what a control looks
 * like says what it will do.
 */
function Attachment({
  documentId,
  versionId,
  attachment,
  onOpen,
}: Readonly<{
  documentId: string;
  versionId: string;
  attachment: EmailAttachment;
  onOpen: (index: number) => void;
}>) {
  const chip =
    "flex items-center gap-2 rounded-button border border-border-default px-2.5 py-1.5 text-sm font-medium text-link hover:bg-canvas focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-link";
  const inside = (
    <>
      <Paperclip size={16} aria-hidden="true" className="shrink-0 text-muted" />
      <span className="truncate">{attachment.filename}</span>
      <span className="shrink-0 text-xs font-normal text-subtle">
        {formatFileSize(attachment.byteSize)}
      </span>
    </>
  );

  if (isPreviewableAttachment(attachment)) {
    return (
      <button type="button" onClick={() => onOpen(attachment.index)} className={chip}>
        {inside}
      </button>
    );
  }
  return (
    <a
      href={emailAttachmentDownloadHref(documentId, versionId, attachment.index)}
      download={attachment.filename}
      className={chip}
    >
      {inside}
    </a>
  );
}

/**
 * One attachment, open on the panel's own surfaces.
 *
 * The bar above it is the way back to the message, and the download
 * beside it is the same one the chip would have been — a reader who
 * opened a file and then wanted it on disk should not have to go back
 * for it.
 */
function OpenAttachment({
  documentId,
  versionId,
  attachment,
  onBack,
}: Readonly<{
  documentId: string;
  versionId: string;
  attachment: EmailAttachment;
  onBack: () => void;
}>) {
  const src = emailAttachmentPreviewHref(documentId, versionId, attachment.index);
  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <div className="flex h-10 shrink-0 items-center justify-between gap-2 border-b border-border-muted bg-canvas px-3">
        <button
          type="button"
          onClick={onBack}
          className="flex items-center gap-1 rounded-button px-2 py-1 text-sm text-muted hover:text-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-link"
        >
          <ArrowLeft size={16} aria-hidden="true" />
          <FormattedMessage id="docPanel.email.back" defaultMessage="Back to the message" />
        </button>
        <a
          href={emailAttachmentDownloadHref(documentId, versionId, attachment.index)}
          download={attachment.filename}
          className="flex shrink-0 items-center gap-1 rounded-button px-2 py-1 text-sm text-muted hover:text-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-link"
        >
          <Download size={16} aria-hidden="true" />
          <FormattedMessage id="docPanel.download" defaultMessage="Download" />
        </a>
      </div>
      {attachment.renderFamily === "image" ? (
        <div
          tabIndex={0}
          role="region"
          aria-label={attachment.filename}
          className="min-h-0 flex-1 overflow-auto bg-canvas p-4 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-link"
        >
          <img
            src={src}
            alt={attachment.filename}
            className="mx-auto block max-w-full bg-raised shadow-sm"
          />
        </div>
      ) : (
        <Suspense
          fallback={
            <p role="status" className="px-4 py-6 text-base text-muted">
              <FormattedMessage id="docPanel.pdf.loading" defaultMessage="Opening…" />
            </p>
          }
        >
          <ChunkBoundary resetKey={src}>
            <PdfPreview src={src} filename={attachment.filename} />
          </ChunkBoundary>
        </Suspense>
      )}
    </div>
  );
}
