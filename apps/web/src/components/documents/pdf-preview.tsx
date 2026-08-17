// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The doc panel's PDF surface (M12/2, DOC-004): every page drawn into
 * its own canvas by pdf.js, stacked in one scrolling column, each with a
 * transparent text layer over it so the words can be selected and
 * copied.
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
 * **The well scrolls through the whole document, not one page at a
 * time** (2026-08-18 fix). Every page takes its own box in one column
 * the reader scrolls — the way every other PDF viewer reads — and the
 * pages near the reader draw into their own canvas. A page that scrolls
 * far enough away hands its drawing back and keeps its box, so a
 * three-hundred-page agreement costs a few pages of memory rather than
 * three hundred. "Page X of Y" and the page turn buttons
 * still work, but they are a position in that scroll, read from an
 * `IntersectionObserver` on each page rather than a state that decides
 * what to draw: a page turn scrolls the target page to the top of the
 * well, and the label follows whichever page the reader actually
 * scrolled to, turn button or not.
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

import { memo, useCallback, useEffect, useRef, useState, type RefObject } from "react";
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

/**
 * How far outside the well a page is still drawn, as a share of the
 * well's own height.
 *
 * A canvas holds a bitmap the size of the page it drew, and a long
 * agreement has hundreds of pages — drawn all at once that is a browser
 * tab that runs out of memory reading one contract. So only the pages
 * near the reader keep a drawing, and the rest give theirs back. Two
 * wells of slack either side is enough that a fast scroll lands on a
 * page that is already drawn rather than on a blank one.
 */
const DRAW_MARGIN = "200%";

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
  /** Which page the well says it is on. Read from the scroll, not the
   * other way around: turning to a page scrolls the well, and it is the
   * scroll landing that sets this. */
  const [pageNumber, setPageNumber] = useState(1);
  const [zoomIndex, setZoomIndex] = useState<number>(DEFAULT_ZOOM_INDEX);
  const well = useRef<HTMLDivElement>(null);
  /** The open document, for every page to draw from. State rather than
   * a ref — every page below is read from it during render, and a ref
   * read there is a value React cannot see change. */
  const [openDocument, setOpenDocument] = useState<LoadedDocument | null>(null);
  /** The same handle, kept a step behind in a ref for the closing
   * effect below: a document opened after the panel already asked to
   * close it must still be found and torn down, and an unmount runs
   * after state has already been thrown away. */
  const loaded = useRef<LoadedDocument | null>(null);
  /** Each page's own most recent intersection ratio, read together to
   * decide which page is "on screen" when more than one straddles the
   * well at once (a short page, a tall well). Cleared on a new
   * document, same as the page and zoom below. */
  const visibility = useRef(new Map<number, number>());

  // Opening the file, and closing it again. Keyed on the address alone:
  // a new version in the panel is a new document, and the page and the
  // zoom below reset with it.
  useEffect(() => {
    let live = true;
    setStage("loading");
    setPageNumber(1);
    setZoomIndex(DEFAULT_ZOOM_INDEX);
    setOpenDocument(null);
    visibility.current.clear();

    const opening = openPdf(src);
    void opening.then(
      (document) => {
        if (!live) {
          void close(document);
          return;
        }
        loaded.current = document;
        setOpenDocument(document);
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

  // The current page, from whichever page's own observer last reported
  // the highest ratio. A `Map` rather than one page's callback winning:
  // a well taller than one page can straddle two of them, and the
  // reader's own idea of "which page am I on" is the one covering the
  // most of it, not whichever fired last.
  const onPageVisible = useCallback((page: number, ratio: number) => {
    visibility.current.set(page, ratio);
    let best = page;
    let bestRatio = 0;
    for (const [candidate, candidateRatio] of visibility.current) {
      if (candidateRatio > bestRatio) {
        bestRatio = candidateRatio;
        best = candidate;
      }
    }
    if (bestRatio > 0) setPageNumber(best);
  }, []);

  function turnTo(page: number) {
    const target = well.current?.querySelector<HTMLElement>(`[data-page-number="${page}"]`);
    target?.scrollIntoView({ block: "start" });
  }

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
            onClick={() => turnTo(Math.max(1, pageNumber - 1))}
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
            onClick={() => turnTo(Math.min(pageCount, pageNumber + 1))}
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
      {/* The well, and every page floating on it — the ViewerWell and
          DocPage of the DOC2 mock, stacked rather than swapped. It
          takes focus and a name of its own: a scrolling region whose
          only content is canvases has nothing else a keyboard can land
          on, and a page a keyboard cannot scroll is a page a keyboard
          cannot read (M4). */}
      <div
        ref={well}
        tabIndex={0}
        role="region"
        // The file, and nothing that moves. A name that carried the
        // page number would change under every scroll tick, and a
        // region whose name keeps changing is one a screen reader keeps
        // announcing. Which page is which is on each page's own canvas,
        // and where the reader is is on the toolbar above.
        aria-label={intl.formatMessage(
          { id: "docPanel.pdf.pages", defaultMessage: "{filename}, pages" },
          { filename },
        )}
        className="flex min-h-0 flex-1 flex-col items-center gap-4 overflow-auto bg-canvas p-4 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-link"
      >
        {openDocument &&
          Array.from({ length: pageCount }, (_, i) => i + 1).map((page) => (
            <PdfPage
              key={page}
              document={openDocument}
              pageNumber={page}
              filename={filename}
              scale={zoom}
              root={well}
              onVisible={onPageVisible}
            />
          ))}
      </div>
    </div>
  );
}

/**
 * One page of the well: its own canvas, its own text layer, and two
 * `IntersectionObserver`s of its own.
 *
 * A page rather than the whole surface owns the observers because each
 * page's visibility is independent of the others — a well tall enough to
 * straddle two pages needs both answers to pick the more-visible one,
 * which `PdfPreview` does across every page's own report.
 *
 * **The box always exists; the drawing does not.** The page measures
 * itself as soon as it mounts and holds that size whether it is drawn or
 * not, so the well's scroll height is the whole document from the start
 * and a page turn lands where it should. Only a page near the reader
 * keeps a canvas and a text layer — the rest hand theirs back, and take
 * them again on the way past. Two observers rather than one: the tight
 * one answers "which page am I on", and the generous one answers "is
 * this worth drawing". Sharing them would make every page within two
 * wells of the reader a candidate for the page number.
 *
 * **Memoized, because the parent re-renders on every scroll tick.**
 * Each page reports its own visibility upward, and that sets the page
 * number, and that renders `PdfPreview` again — so without this a
 * three-hundred-page document reconciles three hundred components for
 * every few pixels scrolled. Every prop below is stable across those
 * renders on purpose: the document is state, the well is a ref object,
 * and `onVisible` is wrapped once.
 */
const PdfPage = memo(function PdfPage({
  document,
  pageNumber,
  filename,
  scale,
  root,
  onVisible,
}: Readonly<{
  document: LoadedDocument;
  pageNumber: number;
  filename: string;
  scale: number;
  /** The well's own scrolling element, watched rather than the
   * viewport — a page "visible" against the window could still be
   * scrolled out of a well shorter than it. */
  root: RefObject<HTMLDivElement | null>;
  onVisible: (page: number, ratio: number) => void;
}>) {
  const intl = useIntl();
  const container = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const textLayer = useRef<HTMLDivElement>(null);
  /** This page's own size in CSS pixels at the scale that is set, read
   * from pdf.js without drawing anything. It is what keeps the box on
   * the well while the drawing is away. */
  const [size, setSize] = useState<{ width: number; height: number } | null>(null);
  /** Whether the reader is close enough that this page is worth
   * drawing. Starts false and the observer answers immediately — an
   * `IntersectionObserver` reports on the first frame after it is
   * given a target, drawn or not. */
  const [near, setNear] = useState(false);
  /** The draws, one after another. pdf.js refuses a second `render()`
   * into a canvas whose previous paint is still in flight, so a zoom
   * step pressed mid-paint must queue behind the paint it replaces —
   * started concurrently it would reject, and the page would read that
   * as a PDF that cannot be shown. Scoped to this page's own canvas:
   * pages draw independently of each other. */
  const draws = useRef<Promise<void>>(Promise.resolve());
  /** The latest callback, relayed through a ref so the observer below
   * is set up once per page rather than torn down and rebuilt on every
   * render — `onVisible` closes over `PdfPreview`'s own state and is a
   * new function most renders. */
  const onVisibleRef = useRef(onVisible);
  useEffect(() => {
    onVisibleRef.current = onVisible;
  });

  // Measuring this page, which costs no raster: pdf.js hands back the
  // page's own viewport and the size falls out of it. It runs again on
  // every zoom step, because the box has to grow with the drawing that
  // will land in it.
  useEffect(() => {
    let live = true;
    void document.getPage(pageNumber).then(
      (page) => {
        if (!live) return;
        const layout = page.getViewport({ scale });
        setSize({ width: Math.floor(layout.width), height: Math.floor(layout.height) });
      },
      () => undefined,
    );
    return () => {
      live = false;
    };
  }, [document, pageNumber, scale]);

  // Drawing this page while the reader is near it, and handing the
  // drawing back when they are not. Both go through the same queue:
  // pdf.js refuses a second `render()` into a canvas whose previous
  // paint is still in flight, and a release that landed mid-paint would
  // resize the canvas out from under it. A run that went stale while it
  // waited refuses to write into a canvas that has moved on.
  useEffect(() => {
    const target = canvas.current;
    if (!target) return;
    if (!near) {
      draws.current = draws.current.then(() => {
        releasePage(target, textLayer.current);
      });
      return;
    }
    let live = true;
    draws.current = draws.current.then(() =>
      drawPage({
        document,
        pageNumber,
        scale,
        canvas: target,
        textLayer: textLayer.current,
        isLive: () => live,
      }).catch(() => undefined),
    );
    return () => {
      live = false;
    };
  }, [document, pageNumber, scale, near]);

  // Reports how much of this page's own container is inside the well —
  // set up once per page and read through the ref above, rather than
  // depending on `onVisible` directly, so a parent re-render (which
  // this callback itself causes, on every scroll) never tears the
  // observer down.
  useEffect(() => {
    const node = container.current;
    const rootNode = root.current;
    if (!node || !rootNode) return;
    const observer = new IntersectionObserver(
      (entries) => {
        const ratio = entries[0]?.intersectionRatio ?? 0;
        onVisibleRef.current(pageNumber, ratio);
      },
      { root: rootNode, threshold: [0, 0.25, 0.5, 0.75, 1] },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [root, pageNumber]);

  // The other question, asked of the same page with the well's own
  // bounds stretched by `DRAW_MARGIN`: is the reader close enough that
  // this page should be holding a drawing at all.
  useEffect(() => {
    const node = container.current;
    const rootNode = root.current;
    if (!node || !rootNode) return;
    const observer = new IntersectionObserver(
      (entries) => setNear(entries[0]?.isIntersecting ?? false),
      { root: rootNode, rootMargin: DRAW_MARGIN },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [root, pageNumber]);

  return (
    <div
      ref={container}
      data-page-number={pageNumber}
      // Sized from the measurement rather than from the canvas, so a
      // page that is holding no drawing still holds its place: the
      // well's scroll bar means the same thing at every scroll
      // position, and turning to page 200 lands on page 200.
      style={size ? { width: size.width, height: size.height } : undefined}
      className="relative shrink-0 bg-raised shadow-sm"
    >
      <canvas
        ref={canvas}
        // The canvas carries the picture; the layer over it carries
        // the words. Naming the file and the page here is what a
        // reader who cannot see the page is told each one is.
        aria-label={intl.formatMessage(
          { id: "docPanel.pdf.page", defaultMessage: "{filename}, page {page}" },
          { filename, page: pageNumber },
        )}
        role="img"
        className="block"
      />
      {/* pdf.js positions its own absolutely placed runs inside
          this, and its `textLayer` class is what makes them
          transparent, absolutely placed, and selectable — which is
          the whole of "text selection" (story 15). */}
      <div ref={textLayer} className="textLayer" />
    </div>
  );
});

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
 * Hands one page's drawing back: the canvas bitmap and the text runs
 * over it.
 *
 * Sizing the canvas to nothing is what frees the bitmap — a canvas keeps
 * its buffer for as long as it has a size, and clearing the pixels does
 * not release a byte. The element itself stays, with its name, and its
 * container keeps the measured size, so nothing on the well moves.
 */
function releasePage(canvas: HTMLCanvasElement, textLayer: HTMLDivElement | null): void {
  canvas.width = 0;
  canvas.height = 0;
  canvas.style.removeProperty("width");
  canvas.style.removeProperty("height");
  textLayer?.replaceChildren();
}

/**
 * Draws one page into the canvas and lays its text over it.
 *
 * `isLive` is asked after every await. A zoom step started before this
 * one finished must not paint over the newer one, and pdf.js has no
 * cancellation that reaches this far in.
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
