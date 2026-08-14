// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The doc panel's PDF surface (M12/2, DOC-004): one page drawn into a
 * canvas by pdf.js, with a transparent text layer over it so the words
 * can be selected and copied.
 *
 * **Ours, never the browser's.** A PDF handed to the browser's own
 * plugin viewer looks different in every browser, carries its own
 * toolbar with its own download button, and cannot be reached by
 * anything around it. Drawing the pages ourselves is what makes one
 * preview across browsers, and what will let the annotation surface
 * CMT-001 anchors land on top of it later.
 *
 * **The text layer is the point, not decoration.** Quoting a clause into
 * a comment has to be copy-paste (story 15), so every page renders the
 * canvas and then positions pdf.js's own text runs over it, invisible
 * and selectable. Without it a preview is a picture of a contract.
 *
 * **pdf.js is loaded on demand.** It is a megabyte of parser, and a
 * record page that shows no PDF should not pay for it. The import
 * happens inside the effect that needs it, so opening the panel on a
 * PNG never touches it at all.
 *
 * **The original is what renders** (DOC-005). These bytes are the stored
 * file, streamed from the preview read behind the session — never a
 * conversion, and never an OCR'd re-rendering of a scan.
 *
 * A failure here is a preview that could not be drawn, not a file that
 * is gone: the surface says so and the panel's download is still one
 * click away.
 */

import { useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, ZoomIn, ZoomOut } from "lucide-react";
import { FormattedMessage, useIntl } from "react-intl";
// pdf.js's own stylesheet, which is what positions the text runs over
// the canvas. It is imported rather than copied because the rules are
// coupled to the library's internals — the layer reads custom
// properties this file declares — and a copy would drift on the next
// upgrade. Nothing in it is loaded until a PDF is opened: this whole
// module is imported lazily by the panel.
import "pdfjs-dist/web/pdf_viewer.css";
// The parser's own thread, emitted by the bundler and addressed by the
// URL it emitted — `?url` asks for the file's address rather than its
// code, so nothing here pulls two megabytes into this chunk. Written
// this way rather than resolved by hand, so a deployment under a
// sub-path gets an address that still works (DD-001: it is ours, never
// a CDN's).
import pdfWorkerUrl from "pdfjs-dist/build/pdf.worker.mjs?url";
import type { PDFDocumentProxy } from "pdfjs-dist";
import { Button } from "../ui/button";

/** The zoom steps the toolbar walks, as percentages of the page's own
 * size. Discrete rather than continuous: a preview is read at a handful
 * of useful sizes, and a stepped control is operable from the keyboard
 * without a slider's ceremony. */
const ZOOM_STEPS = [0.5, 0.75, 1, 1.25, 1.5, 2, 3] as const;

/** Where a freshly opened page starts: the page at its own size. */
const DEFAULT_ZOOM_INDEX = 2;

/** What the surface is doing, for the reader and for the tests. */
type Stage = "loading" | "ready" | "failed";

/** One open document, as pdf.js hands it back. The type is imported;
 * the module behind it still is not, because a type import carries no
 * code and this file is itself loaded only when a PDF opens. */
type LoadedDocument = PDFDocumentProxy;

export function PdfPreview({
  src,
  /** The file's own name, for the label a screen reader hears on the
   * page canvas. */
  filename,
}: Readonly<{ src: string; filename: string }>) {
  const intl = useIntl();
  const [stage, setStage] = useState<Stage>("loading");
  const [pageCount, setPageCount] = useState(0);
  const [pageNumber, setPageNumber] = useState(1);
  const [zoomIndex, setZoomIndex] = useState<number>(DEFAULT_ZOOM_INDEX);
  const canvas = useRef<HTMLCanvasElement>(null);
  const textLayer = useRef<HTMLDivElement>(null);
  /** The open document, kept out of state: it is a handle to close, not
   * a value anything renders from, and putting it in state would redraw
   * the surface every time it is opened. */
  const loaded = useRef<LoadedDocument | null>(null);
  /** The draws, one after another. pdf.js refuses a second `render()`
   * into a canvas whose previous paint is still in flight, so a page
   * turn pressed mid-paint must queue behind the paint it replaces —
   * started concurrently it would reject, and the surface would read
   * that as a PDF that cannot be shown. */
  const draws = useRef<Promise<void>>(Promise.resolve());

  // Opening the file, and closing it again. Keyed on the address alone:
  // a new version in the panel is a new document, and the page and the
  // zoom below reset with it.
  useEffect(() => {
    let live = true;
    setStage("loading");
    setPageNumber(1);
    setZoomIndex(DEFAULT_ZOOM_INDEX);

    const opening = openPdf(src);
    void opening.then(
      (document) => {
        if (!live) {
          void close(document);
          return;
        }
        loaded.current = document;
        setPageCount(document.numPages);
        setStage("ready");
      },
      () => {
        if (live) setStage("failed");
      },
    );

    return () => {
      live = false;
      const open = loaded.current;
      loaded.current = null;
      // The handle may not exist yet — closing has to wait for the open
      // it is cancelling, or a document opened after the panel closed
      // would leak its worker.
      if (open) void close(open);
      else void opening.then(close).catch(() => undefined);
    };
  }, [src]);

  // Drawing the page that is showing, at the zoom that is set. It runs
  // again on every page turn and every zoom step. Each run queues
  // behind the one before it — the canvas takes one paint at a time —
  // and a run that went stale while it waited refuses to write into a
  // canvas that has moved on.
  useEffect(() => {
    if (stage !== "ready") return;
    const document = loaded.current;
    const target = canvas.current;
    if (!document || !target) return;

    let live = true;
    draws.current = draws.current.then(() =>
      drawPage({
        document,
        pageNumber,
        scale: ZOOM_STEPS[zoomIndex] ?? 1,
        canvas: target,
        textLayer: textLayer.current,
        isLive: () => live,
      }).catch(() => {
        if (live) setStage("failed");
      }),
    );
    return () => {
      live = false;
    };
  }, [stage, pageNumber, zoomIndex]);

  if (stage === "failed") {
    return (
      <p role="status" className="px-4 py-6 text-base text-muted">
        <FormattedMessage
          id="docPanel.pdf.failed"
          defaultMessage="This PDF could not be shown here. Download it to read it."
        />
      </p>
    );
  }

  const zoom = ZOOM_STEPS[zoomIndex] ?? 1;
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* The reading controls, over the page rather than in the panel's
          own toolbar: they are facts about this PDF, and a PNG in the
          same panel has none of them. */}
      <div className="flex shrink-0 items-center justify-between gap-2 border-b border-border-muted bg-canvas px-3 py-1.5">
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="icon"
            disabled={pageNumber <= 1}
            onClick={() => setPageNumber((current) => Math.max(1, current - 1))}
            aria-label={intl.formatMessage({
              id: "docPanel.pdf.previousPage",
              defaultMessage: "Previous page",
            })}
          >
            <ChevronLeft size={16} aria-hidden="true" />
          </Button>
          <span className="min-w-24 text-center text-sm tabular-nums text-muted">
            {stage === "ready" ? (
              <FormattedMessage
                id="docPanel.pdf.pageOf"
                defaultMessage="Page {page} of {total}"
                values={{ page: pageNumber, total: pageCount }}
              />
            ) : (
              <FormattedMessage id="docPanel.pdf.loading" defaultMessage="Opening…" />
            )}
          </span>
          <Button
            variant="ghost"
            size="icon"
            disabled={pageNumber >= pageCount}
            onClick={() => setPageNumber((current) => Math.min(pageCount, current + 1))}
            aria-label={intl.formatMessage({
              id: "docPanel.pdf.nextPage",
              defaultMessage: "Next page",
            })}
          >
            <ChevronRight size={16} aria-hidden="true" />
          </Button>
        </div>
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="icon"
            disabled={zoomIndex <= 0}
            onClick={() => setZoomIndex((current) => Math.max(0, current - 1))}
            aria-label={intl.formatMessage({
              id: "docPanel.pdf.zoomOut",
              defaultMessage: "Zoom out",
            })}
          >
            <ZoomOut size={16} aria-hidden="true" />
          </Button>
          <span className="min-w-12 text-center text-sm tabular-nums text-muted">
            {intl.formatNumber(zoom, { style: "percent" })}
          </span>
          <Button
            variant="ghost"
            size="icon"
            disabled={zoomIndex >= ZOOM_STEPS.length - 1}
            onClick={() => setZoomIndex((current) => Math.min(ZOOM_STEPS.length - 1, current + 1))}
            aria-label={intl.formatMessage({
              id: "docPanel.pdf.zoomIn",
              defaultMessage: "Zoom in",
            })}
          >
            <ZoomIn size={16} aria-hidden="true" />
          </Button>
        </div>
      </div>
      {/* The well, and the page floating on it — the ViewerWell and
          DocPage of the DOC2 mock. It takes focus and a name of its
          own: a scrolling region whose only content is a canvas has
          nothing else a keyboard can land on, and a page a keyboard
          cannot scroll is a page a keyboard cannot read (M4). */}
      <div
        tabIndex={0}
        role="region"
        aria-label={intl.formatMessage(
          { id: "docPanel.pdf.pages", defaultMessage: "{filename}, page {page} of {total}" },
          { filename, page: pageNumber, total: pageCount },
        )}
        className="min-h-0 flex-1 overflow-auto bg-canvas p-4 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-link"
      >
        <div className="relative mx-auto w-fit bg-raised shadow-sm">
          <canvas
            ref={canvas}
            // The canvas carries the picture; the layer over it carries
            // the words. Naming the file here is what a reader who
            // cannot see the page is told the region is.
            aria-label={filename}
            role="img"
            className="block"
          />
          {/* pdf.js positions its own absolutely placed runs inside
              this, and its `textLayer` class is what makes them
              transparent, absolutely placed, and selectable — which is
              the whole of "text selection" (story 15). */}
          <div ref={textLayer} className="textLayer" />
        </div>
      </div>
    </div>
  );
}

/**
 * Opens one PDF through pdf.js, loading the library on the way.
 *
 * The worker is a module worker built from the package's own file, so
 * the parser runs off the main thread and nothing is fetched from a CDN
 * (DD-001). The bytes come from the preview read, same-origin, so the
 * session cookie rides the request without anything being said here.
 */
async function openPdf(src: string): Promise<LoadedDocument> {
  const pdfjs = await import("pdfjs-dist");
  pdfjs.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;
  const task = pdfjs.getDocument({
    url: src,
    // Self-hosted, for the reason the worker is: a fresh install must
    // render a PDF with no network beyond its own origin (DD-001).
    cMapUrl: assetUrl("cmaps/"),
    cMapPacked: true,
    standardFontDataUrl: assetUrl("standard_fonts/"),
    wasmUrl: assetUrl("wasm/"),
    iccUrl: assetUrl("iccs/"),
  });
  return await task.promise;
}

/**
 * Closes one open document and takes its worker down with it.
 *
 * The task rather than the document: pdf.js hangs the teardown off the
 * loading task, and the document proxy has no `destroy` of its own.
 */
function close(document: LoadedDocument): Promise<void> {
  return document.loadingTask.destroy();
}

/** Where pdf.js's own asset folders are served from — copied into the
 * build beside the app by the `pdfjs-assets` plugin in vite.config.ts. */
function assetUrl(folder: string): string {
  // Through the deployment's own base path, which is what the folders
  // are copied under — a sub-path install must not reach for the
  // origin root.
  return new URL(`${import.meta.env.BASE_URL}pdfjs/${folder}`, globalThis.location.href).href;
}

/**
 * Draws one page into the canvas and lays its text over it.
 *
 * `isLive` is asked after every await. A page turn or a zoom step
 * started before this one finished must not paint over the newer one,
 * and pdf.js has no cancellation that reaches this far in.
 */
async function drawPage(options: {
  document: LoadedDocument;
  pageNumber: number;
  scale: number;
  canvas: HTMLCanvasElement;
  textLayer: HTMLDivElement | null;
  isLive: () => boolean;
}): Promise<void> {
  const page = await options.document.getPage(options.pageNumber);
  if (!options.isLive()) return;

  // Drawn at the device's own pixel density, then sized back down in
  // CSS: a page rasterized at 1x on a retina screen reads as a blurred
  // photocopy, which is not a preview of a contract.
  const density = Math.min(globalThis.devicePixelRatio || 1, 2);
  const viewport = page.getViewport({ scale: options.scale * density });
  const layout = page.getViewport({ scale: options.scale });
  options.canvas.width = Math.floor(viewport.width);
  options.canvas.height = Math.floor(viewport.height);
  options.canvas.style.width = `${Math.floor(layout.width)}px`;
  options.canvas.style.height = `${Math.floor(layout.height)}px`;

  await page.render({ canvas: options.canvas, viewport }).promise;
  if (!options.isLive()) return;

  const container = options.textLayer;
  if (!container) return;
  container.replaceChildren();
  // The scale the layer's own stylesheet lays its runs out against.
  // pdf.js sizes the container from these rather than from pixels, so
  // they are set before the layer is built, not after.
  container.style.setProperty("--scale-factor", String(options.scale));
  container.style.setProperty("--total-scale-factor", String(options.scale));
  container.style.setProperty("--scale-round-x", "1px");
  container.style.setProperty("--scale-round-y", "1px");

  const { TextLayer } = await import("pdfjs-dist");
  if (!options.isLive()) return;
  const textContent = await page.getTextContent();
  if (!options.isLive()) return;
  await new TextLayer({ textContentSource: textContent, container, viewport: layout }).render();
}
