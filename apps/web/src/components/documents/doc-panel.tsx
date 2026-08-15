// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The doc panel (M12/2), drawn from the DOC2 mock in
 * `designs/documents.pen`: a document opens beside the record it lives
 * on and is read there, without a download.
 *
 * **It is DES-016's wider sibling layer, not the applet panel.** The
 * activity bar hosts one 320px applet at a time; a contract does not fit
 * in that, so the doc panel takes its own wider column beside it and the
 * two can be open together. Below the docking threshold it overlays the
 * record region, pinned to the inner edge of the activity bar, which
 * never disappears — the same behaviour DES-016 gave the applet panel,
 * at a wider threshold because it is a wider thing.
 *
 * **Three parts, from the mock.** The 44px header carries the document's
 * name, the version being read, and the close control (K.H1–H3, H6). The
 * 40px toolbar under it carries the file's own name and its download
 * (K.T8). The well below is the surface, and which surface it is comes
 * from the version's family.
 *
 * **The family decides the surface, and the server decides the family.**
 * `renderFamily` is routed on the server from the declared type and the
 * filename together (DOC-004), so this component holds no MIME table.
 * PDFs get pdf.js, raster images get an `img`, and everything else gets
 * an honest download card that says plainly why — never a broken
 * preview.
 *
 * **Word and PowerPoint are read from a conversion** (M12/4). No browser
 * draws a DOCX, so the pipeline converts each one to a PDF and this
 * panel draws that with the same surface it draws a stored PDF with —
 * tracked changes and comments included, because they are in the
 * conversion. The panel does not fetch those bytes until the server says
 * they are there: it polls the rendition read, shows a preparing state
 * while the job runs, and offers the download if the job gave up. Live
 * push is M30's job.
 *
 * **An email is read as a message** (M12/5). An uploaded MSG or EML is
 * parsed on the server and drawn here as headers, a sanitized body, and
 * an attachment list — and an attachment that is itself a PDF or an
 * image opens on this panel's own surfaces rather than in a Downloads
 * folder.
 *
 * **Any version in the chain opens**, superseded rounds included: the
 * panel is handed one version and reads that one, so round two of a
 * negotiation is as readable as round five.
 *
 * **Esc closes it and focus comes back.** The panel is a plain aside
 * rather than a Radix overlay, so DES-010's rules are wired by hand:
 * focus moves into the panel when it opens, Esc closes it, and the
 * caller puts focus back where it came from.
 */

import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { Download, FileText, X } from "lucide-react";
import { FormattedMessage, useIntl } from "react-intl";
import { formatFileSize } from "../../lib/format";
import {
  documentDownloadHref,
  documentPreviewHref,
  isConverted,
  readRenditionState,
  type DocumentVersion,
  type RenditionState,
} from "../../lib/documents";

/**
 * The PDF surface, loaded only when a PDF is opened.
 *
 * pdf.js is a megabyte of parser and it brings its own stylesheet. A
 * record page that never opens a PDF should pay for neither, and a
 * record page that never opens the panel should not even resolve them.
 */
const PdfPreview = lazy(async () => ({
  default: (await import("./pdf-preview")).PdfPreview,
}));

/**
 * The email surface, loaded only when an email is opened.
 *
 * It brings the PDF surface with it — an attached PDF opens in the panel
 * — so a record page that never opens a message pays for neither.
 */
const EmailPreview = lazy(async () => ({
  default: (await import("./email-preview")).EmailPreview,
}));

export function DocPanel({
  documentId,
  title,
  version,
  onClose,
}: Readonly<{
  documentId: string;
  /** What the record calls this document, which is what the header
   * says — the file's own name goes on the toolbar below it. */
  title: string;
  /** The one version being read. Any round in the chain may be it. */
  version: DocumentVersion;
  onClose: () => void;
}>) {
  const intl = useIntl();
  const panel = useRef<HTMLElement>(null);

  // Focus moves into the panel when it opens, so the next Tab is inside
  // it and a screen reader reads what just appeared (DES-010). The
  // container takes it rather than the close button: landing on Close
  // reads as "you probably want to leave".
  useEffect(() => {
    panel.current?.focus();
  }, [documentId, version.id]);

  const previewHref = documentPreviewHref(documentId, version.id);
  return (
    <aside // NOSONAR — the listener serves DES-010's Esc rule, not interactivity
      ref={panel}
      tabIndex={-1}
      aria-label={intl.formatMessage(
        { id: "docPanel.label", defaultMessage: "{title}, version {version}" },
        { title, version: version.versionNumber },
      )}
      onKeyDown={(event) => {
        if (event.key === "Escape" && !event.defaultPrevented) onClose();
      }}
      className="absolute inset-y-0 start-0 end-(--width-activitybar) z-20 flex flex-col border-s border-border-default bg-raised outline-none @min-[1400px]/record:static @min-[1400px]/record:z-auto @min-[1400px]/record:w-(--width-docpanel) @min-[1400px]/record:shrink-0"
    >
      <header className="flex h-11 shrink-0 items-center justify-between gap-2 border-b border-border-muted px-4">
        <div className="flex min-w-0 items-center gap-2">
          <FileText size={16} aria-hidden="true" className="shrink-0 text-muted" />
          <h2 className="truncate text-base font-semibold">{title}</h2>
          {/* The version being read (K.H3). The chain is what a
              contract's history is, so the panel never leaves it
              ambiguous which round is on screen. */}
          <span className="shrink-0 rounded-chip bg-badge-count-bg px-1.5 py-px text-xs font-medium text-badge-count-fg">
            <FormattedMessage
              id="docPanel.version"
              defaultMessage="v{number}"
              values={{ number: version.versionNumber }}
            />
          </span>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label={intl.formatMessage({
            id: "docPanel.close",
            defaultMessage: "Close the document",
          })}
          className="-me-1 flex size-6 shrink-0 items-center justify-center text-muted hover:text-primary"
        >
          <X size={16} aria-hidden="true" />
        </button>
      </header>
      {/* The toolbar the DOC2 mock draws: the file's own name on the
          left, and the one control that is true of every family on the
          right. Reading controls belong to the surface that has them,
          so page and zoom live inside the PDF view rather than here. */}
      <div className="flex h-10 shrink-0 items-center justify-between gap-2 border-b border-border-muted bg-canvas px-3">
        <span className="truncate text-sm text-muted">{version.originalFilename}</span>
        <a
          href={documentDownloadHref(documentId, version.id)}
          download={version.originalFilename}
          className="flex shrink-0 items-center gap-1 rounded-button px-2 py-1 text-sm text-muted hover:text-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-link"
        >
          <Download size={16} aria-hidden="true" />
          <FormattedMessage id="docPanel.download" defaultMessage="Download" />
        </a>
      </div>
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        <Surface documentId={documentId} version={version} previewHref={previewHref} />
      </div>
    </aside>
  );
}

/** Which surface this file reads on, from the family the server routed
 * it to (DOC-004). */
function Surface({
  documentId,
  version,
  previewHref,
}: Readonly<{
  documentId: string;
  version: DocumentVersion;
  previewHref: string;
}>) {
  if (isConverted(version)) {
    return <ConvertedSurface documentId={documentId} version={version} previewHref={previewHref} />;
  }
  switch (version.renderFamily) {
    case "pdf":
      return <PdfSurface src={previewHref} filename={version.originalFilename} />;
    case "email":
      return <EmailSurface documentId={documentId} version={version} />;
    case "image":
      return (
        // The well takes focus and a name of its own, so a keyboard can
        // scroll a page-sized scan: an image is not focusable, and a
        // scrolling region with nothing focusable in it cannot be
        // reached (M4).
        <div
          tabIndex={0}
          role="region"
          aria-label={version.originalFilename}
          className="min-h-0 flex-1 overflow-auto bg-canvas p-4 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-link"
        >
          {/* The file itself, drawn by the browser from bytes the
              preview read served under a type this server chose. The
              name is the alternative text: a photographed signature
              page has no caption but its filename. */}
          <img
            src={previewHref}
            alt={version.originalFilename}
            className="mx-auto block max-w-full bg-raised shadow-sm"
          />
        </div>
      );
    default:
      return <DownloadCard documentId={documentId} version={version} />;
  }
}

/**
 * The email surface (M12/5), and the card a message that cannot be read
 * falls back to.
 *
 * The fallback is here rather than inside the surface so that every path
 * in this panel with no preview ends at one card: a spreadsheet, a
 * conversion that failed, and an email whose bytes are not the message
 * they claimed to be all say the same thing to a reader — this is not
 * going to appear, and the download is here.
 */
function EmailSurface({
  documentId,
  version,
}: Readonly<{ documentId: string; version: DocumentVersion }>) {
  const [unreadable, setUnreadable] = useState(false);

  // Reset on the way in: the panel can move from one version to another
  // without unmounting, and a refusal carried over would hide a message
  // that reads perfectly well.
  useEffect(() => {
    setUnreadable(false);
  }, [documentId, version.id]);

  if (unreadable) {
    return <DownloadCard documentId={documentId} version={version} reason="conversionFailed" />;
  }
  return (
    <Suspense
      fallback={
        <p role="status" className="px-4 py-6 text-base text-muted">
          <FormattedMessage id="docPanel.email.loading" defaultMessage="Opening…" />
        </p>
      }
    >
      <EmailPreview
        documentId={documentId}
        versionId={version.id}
        onUnreadable={() => setUnreadable(true)}
      />
    </Suspense>
  );
}

/** The PDF surface, and the one line shown while its parser is being
 * fetched. Shared by a stored PDF and by a converted rendition, because
 * a rendition is a PDF and reads exactly like one. */
function PdfSurface({ src, filename }: Readonly<{ src: string; filename: string }>) {
  return (
    <Suspense
      fallback={
        <p role="status" className="px-4 py-6 text-base text-muted">
          <FormattedMessage id="docPanel.pdf.loading" defaultMessage="Opening…" />
        </p>
      }
    >
      <PdfPreview src={src} filename={filename} />
    </Suspense>
  );
}

/**
 * How often the panel asks whether a conversion has landed (M12/4).
 *
 * Short enough that a Word document that converted in two seconds does
 * not sit behind a preparing state for five, long enough that a panel
 * left open on a long deck is not a load. Polling is the mechanism on
 * purpose: live push is M30's job, and a panel that waited for it would
 * ship nothing until then.
 */
const RENDITION_POLL_MS = 1500;

/**
 * How many polls in a row may go unanswered before the panel stops
 * asking.
 *
 * A dropped request says nothing about the conversion, so one of them is
 * worth waiting through — but a reader must never be left in front of a
 * preparing state that will never resolve, so the asking is bounded.
 * When it runs out the panel says what a failed conversion says and
 * offers the download, which is the honest end of every path that does
 * not produce a preview.
 */
const MAX_UNANSWERED_POLLS = 3;

/**
 * The surface for a file that had to be converted before it could be
 * read (DOC-004, M12/4): Word documents and PowerPoint decks.
 *
 * Three states and nothing else. While the conversion runs the panel
 * says so and keeps asking. When it lands the panel draws the PDF, which
 * is where DOC-004's promise about tracked changes and comments is kept
 * — they are in the conversion. When it fails terminally the panel says
 * that plainly and offers the download, because a LibreOffice failure
 * should cost one click, not a support ticket.
 *
 * Nothing here fetches the rendition's bytes. `src` is an address the
 * browser fetches once the state says the bytes are there.
 */
function ConvertedSurface({
  documentId,
  version,
  previewHref,
}: Readonly<{ documentId: string; version: DocumentVersion; previewHref: string }>) {
  const [state, setState] = useState<RenditionState>("pending");

  useEffect(() => {
    let live = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let unanswered = 0;
    // Reset on the way in: the panel can move from one version to
    // another without unmounting, and a ready state carried over would
    // point pdf.js at a rendition that is not there yet.
    setState("pending");

    const ask = async () => {
      const answer = await readRenditionState(documentId, version.id);
      // The panel closed, or moved to another version, while the answer
      // was in flight. Writing state here would set it on a surface that
      // is gone and schedule a poll nobody is watching.
      if (!live) return;
      if (answer === "unreachable") {
        unanswered += 1;
        // Out of patience: say what a failed conversion says, because a
        // preview that is not coming and a preview nobody can ask about
        // are the same thing to somebody standing in front of the panel.
        if (unanswered >= MAX_UNANSWERED_POLLS) setState("failed");
        else timer = setTimeout(() => void ask(), RENDITION_POLL_MS);
        return;
      }
      unanswered = 0;
      setState(answer);
      // Only a pending conversion is worth asking about again. Ready and
      // failed are both settled, and `unsupported` means this file was
      // never being converted at all.
      if (answer === "pending") timer = setTimeout(() => void ask(), RENDITION_POLL_MS);
    };
    void ask();

    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [documentId, version.id]);

  if (state === "ready") {
    return <PdfSurface src={previewHref} filename={version.originalFilename} />;
  }
  if (state === "pending") {
    return (
      <p role="status" className="px-4 py-6 text-base text-muted">
        <FormattedMessage
          id="docPanel.converting"
          defaultMessage="Preparing this document for reading…"
        />
      </p>
    );
  }
  // Failed, or a file the server says is not being converted at all.
  // Both mean the same thing to a reader standing in front of the
  // panel: this is not going to appear, and the download is here.
  return <DownloadCard documentId={documentId} version={version} reason="conversionFailed" />;
}

/**
 * The honest card a file the panel cannot draw gets (DOC-004).
 *
 * It says what the file is, why it is not on screen, and offers the
 * download. Never a broken preview and never a silent blank: a
 * spreadsheet that shows nothing reads as a bug, and a spreadsheet that
 * says it downloads reads as a decision.
 *
 * Two reasons reach it, and they are different facts. A spreadsheet or
 * an archive does not open here at all. A Word document whose conversion
 * failed, and an email whose bytes cannot be read as the message they
 * claim to be, were each supposed to open here and could not — so they
 * are told that, rather than being told their whole file type is
 * unreadable.
 */
function DownloadCard({
  documentId,
  version,
  reason = "downloadOnly",
}: Readonly<{
  documentId: string;
  version: DocumentVersion;
  /** Why there is no preview: this file type never opens here, or this
   * one file could not be converted. */
  reason?: "downloadOnly" | "conversionFailed";
}>) {
  return (
    <div className="flex min-h-0 flex-1 items-center justify-center overflow-auto bg-canvas p-6">
      <div className="flex max-w-sm flex-col items-center gap-3 rounded-card border border-border-default bg-raised px-6 py-8 text-center">
        <FileText size={24} aria-hidden="true" className="text-muted" />
        <p className="text-md font-semibold break-all">{version.originalFilename}</p>
        <p className="text-base text-muted">
          {reason === "conversionFailed" ? (
            <FormattedMessage
              id="docPanel.conversionFailed"
              defaultMessage="This file could not be prepared for reading here. Download it to read it."
            />
          ) : (
            <FormattedMessage
              id="docPanel.downloadOnly"
              defaultMessage="This file type does not open here. Download it to read it."
            />
          )}
        </p>
        <p className="text-sm text-muted">{formatFileSize(version.byteSize)}</p>
        <a
          href={documentDownloadHref(documentId, version.id)}
          download={version.originalFilename}
          className="flex items-center gap-1.5 rounded-button border border-border-default bg-raised px-3 py-1.5 text-base font-semibold text-primary hover:bg-canvas focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-link"
        >
          <Download size={16} aria-hidden="true" />
          <FormattedMessage id="docPanel.download" defaultMessage="Download" />
        </a>
      </div>
    </div>
  );
}
