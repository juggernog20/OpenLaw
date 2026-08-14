// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Which of DOC-004's families a stored file belongs to, and what a
 * preview response may call it.
 *
 * **The routing is a hint, never a security decision.** It reads the
 * MIME type the upload declared and the extension on the filename the
 * uploader chose. Neither is verified, and nothing here opens the bytes.
 * What keeps that safe is the other half of this module: a preview never
 * echoes the declared type back. It answers a type this table chose, or
 * it answers no preview at all — so a file that lies about itself can
 * change which card it gets and can never change what the browser is
 * told to do with it.
 *
 * **The declared type decides when it names a family; the extension
 * decides otherwise.** A browser's declaration is the more specific of
 * the two — it tells an SVG from a PNG without guessing — and an upload
 * that declared nothing arrives as `application/octet-stream` (M11),
 * which names no family and falls through to the name. That ordering is
 * why a `.png` dragged out of an archive still routes as an image.
 *
 * **Every family is routed here, not only the two that render now.**
 * Word, PowerPoint, and email each get their own family in M12/2 and an
 * honest download card in the panel; M12/3 and M12/4 flip those cards to
 * rendered surfaces without touching this table. A family the table does
 * not name is `other`, which is download-only for good.
 *
 * **SVG is deliberately not an image here.** An inline SVG is a script:
 * it can carry `<script>` and external references, and rendering one in
 * the panel would run it on our origin. It routes to `other` and gets
 * the download card, which is the whole of the decision.
 */

/**
 * DOC-004's families, plus the catch-all.
 *
 * `pdf` and `image` render natively in M12/2. `word`, `presentation`,
 * and `email` are named because the panel must say something true about
 * them today and something different in M12/3 and M12/4. `other` is
 * everything else — the spreadsheets and the archives DOC-004 leaves
 * download-only.
 */
export const RENDER_FAMILIES = ["pdf", "image", "word", "presentation", "email", "other"] as const;

/** One of DOC-004's families. */
export type RenderFamily = (typeof RENDER_FAMILIES)[number];

/** What the table knows about one declared type or one extension. */
interface Route {
  family: RenderFamily;
  /**
   * The type a preview response sets for this file, or `undefined` when
   * the family has no in-app preview yet.
   *
   * It is a constant from this table and never the uploader's own
   * string. A raster image needs the exact one — a PNG served as a JPEG
   * draws nothing — so the type rides with the route rather than being
   * derived from the family.
   */
  previewType?: string;
}

const PDF: Route = { family: "pdf", previewType: "application/pdf" };
const WORD: Route = { family: "word" };
const PRESENTATION: Route = { family: "presentation" };
const EMAIL: Route = { family: "email" };

/** An image the browsers we target draw from bytes alone. */
const raster = (previewType: string): Route => ({ family: "image", previewType });

/**
 * `other` stated rather than left to the fallback, for the formats where
 * the reason matters and a reader of this table should see it.
 */
const DOWNLOAD_ONLY: Route = { family: "other" };

/**
 * By declared MIME type, lowercased and with its parameters stripped.
 *
 * TIFF is absent on purpose: it is an image, and no browser draws one.
 * A download card is the honest answer, and a family that promised a
 * preview would produce the broken one DOC-004 rules out.
 */
const BY_MIME_TYPE: Readonly<Record<string, Route>> = {
  "application/pdf": PDF,

  "image/png": raster("image/png"),
  "image/jpeg": raster("image/jpeg"),
  "image/gif": raster("image/gif"),
  "image/webp": raster("image/webp"),
  "image/bmp": raster("image/bmp"),
  "image/avif": raster("image/avif"),
  // An inline SVG is a script. Download-only, and said here so the
  // table itself carries the reason.
  "image/svg+xml": DOWNLOAD_ONLY,

  "application/msword": WORD,
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": WORD,
  "application/vnd.oasis.opendocument.text": WORD,
  "application/rtf": WORD,
  "text/rtf": WORD,

  "application/vnd.ms-powerpoint": PRESENTATION,
  "application/vnd.openxmlformats-officedocument.presentationml.presentation": PRESENTATION,
  "application/vnd.oasis.opendocument.presentation": PRESENTATION,

  "message/rfc822": EMAIL,
  "application/vnd.ms-outlook": EMAIL,
};

/** By lowercase filename extension, for the uploads that declared
 * nothing useful. */
const BY_EXTENSION: Readonly<Record<string, Route>> = {
  pdf: PDF,

  png: raster("image/png"),
  jpg: raster("image/jpeg"),
  jpeg: raster("image/jpeg"),
  gif: raster("image/gif"),
  webp: raster("image/webp"),
  bmp: raster("image/bmp"),
  avif: raster("image/avif"),
  svg: DOWNLOAD_ONLY,
  svgz: DOWNLOAD_ONLY,
  tif: DOWNLOAD_ONLY,
  tiff: DOWNLOAD_ONLY,

  doc: WORD,
  docx: WORD,
  odt: WORD,
  rtf: WORD,

  ppt: PRESENTATION,
  pptx: PRESENTATION,
  odp: PRESENTATION,

  msg: EMAIL,
  eml: EMAIL,
};

/** The declared type without its parameters, lowercased — `text/rtf`
 * out of `Text/RTF; charset=utf-8`. */
function mediaType(declared: string): string {
  return declared.split(";")[0]!.trim().toLowerCase();
}

/**
 * The lowercase extension of a filename, or `""` when it has none.
 *
 * Read off the last dot of the last path segment, so a name carrying a
 * directory separator cannot borrow an extension from a folder above it.
 * A leading-dot name (`.gitignore`) has no extension, not one called
 * `gitignore`.
 */
export function extensionOf(filename: string): string {
  const name = filename.split(/[/\\]/).pop() ?? "";
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : "";
}

/**
 * One route out of one table, by own key only.
 *
 * The tables are object literals, so a bare index would answer for keys
 * nobody wrote: a file called `notes.__proto__` would read
 * `Object.prototype`, and one declaring itself `constructor` would read
 * a function. Neither is a route, and both would leave `family`
 * undefined on a row the API hands out. The key here comes from a
 * filename and a header, which are the two values a caller supplies.
 */
function routeIn(table: Readonly<Record<string, Route>>, key: string): Route | undefined {
  return Object.hasOwn(table, key) ? table[key] : undefined;
}

/** The route for one stored file: the declared type first, then the
 * name, then the catch-all. */
function routeOf(mimeType: string, filename: string): Route {
  return (
    routeIn(BY_MIME_TYPE, mediaType(mimeType)) ??
    routeIn(BY_EXTENSION, extensionOf(filename)) ??
    DOWNLOAD_ONLY
  );
}

/**
 * Which family a stored file belongs to (DOC-004).
 *
 * Answered for every version the API hands out, so the panel routes to
 * a renderer or to a download card without holding a copy of this table.
 */
export function renderFamilyOf(mimeType: string, filename: string): RenderFamily {
  return routeOf(mimeType, filename).family;
}

/**
 * The content type a preview response sets for one stored file, or
 * `null` when this file has no in-app preview.
 *
 * `null` is what the preview route refuses on. It is not an access
 * answer: the reader can see the document, and being told plainly that
 * a spreadsheet does not preview is the honest card DOC-004 asks for.
 */
export function previewContentType(mimeType: string, filename: string): string | null {
  return routeOf(mimeType, filename).previewType ?? null;
}
