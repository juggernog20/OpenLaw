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
 * filename together (DOC-004), so this component holds no MIME table and
 * a family added in M12/3 or M12/4 arrives without a change here. PDFs
 * get pdf.js, raster images get an `img`, and everything else gets an
 * honest download card that says plainly why — never a broken preview.
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

import { lazy, Suspense, useEffect, useRef } from "react";
import { Download, FileText, X } from "lucide-react";
import { FormattedMessage, useIntl } from "react-intl";
import { formatFileSize } from "../../lib/format";
import {
  documentDownloadHref,
  documentPreviewHref,
  type DocumentVersion,
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
      className="absolute inset-y-0 start-0 end-(--width-activitybar) z-20 flex flex-col border-s border-default bg-raised outline-none @min-[1400px]/record:static @min-[1400px]/record:z-auto @min-[1400px]/record:w-(--width-docpanel) @min-[1400px]/record:shrink-0"
    >
      <header className="flex h-11 shrink-0 items-center justify-between gap-2 border-b border-muted px-4">
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
      <div className="flex h-10 shrink-0 items-center justify-between gap-2 border-b border-muted bg-canvas px-3">
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
  switch (version.renderFamily) {
    case "pdf":
      return (
        <Suspense
          fallback={
            <p role="status" className="px-4 py-6 text-base text-muted">
              <FormattedMessage id="docPanel.pdf.loading" defaultMessage="Opening…" />
            </p>
          }
        >
          <PdfPreview src={previewHref} filename={version.originalFilename} />
        </Suspense>
      );
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
 * The honest card a file outside the render set gets (DOC-004).
 *
 * It says what the file is, why it is not on screen, and offers the
 * download. Never a broken preview and never a silent blank: a
 * spreadsheet that shows nothing reads as a bug, and a spreadsheet that
 * says it downloads reads as a decision.
 *
 * Word, PowerPoint, and email each get their own sentence, because each
 * of them becomes a rendered surface in a later ticket and "not yet" is
 * a different fact from "not ever".
 */
function DownloadCard({
  documentId,
  version,
}: Readonly<{ documentId: string; version: DocumentVersion }>) {
  return (
    <div className="flex min-h-0 flex-1 items-center justify-center overflow-auto bg-canvas p-6">
      <div className="flex max-w-sm flex-col items-center gap-3 rounded-card border border-border-default bg-raised px-6 py-8 text-center">
        <FileText size={24} aria-hidden="true" className="text-muted" />
        <p className="text-md font-semibold break-all">{version.originalFilename}</p>
        <p className="text-base text-muted">
          <FormattedMessage
            id="docPanel.downloadOnly"
            defaultMessage="{family, select, word {Word documents do not open here yet. Download it to read it.} presentation {Presentations do not open here yet. Download it to read it.} email {Emails do not open here yet. Download it to read it.} other {This file type does not open here. Download it to read it.}}"
            values={{ family: version.renderFamily }}
          />
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
