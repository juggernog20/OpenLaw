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
 * **Every family is routed here, and each one has flipped to a rendered
 * surface without the table changing shape.** Word, PowerPoint, and
 * email each got their own family in M12/2 with an honest download card
 * in the panel. M12/4 flipped the first two by adding what the doc
 * engine converts each one from, beside the type each row already
 * carried. M12/5 flipped email by adding nothing at all: an email needs
 * neither a preview type nor a conversion, because it is parsed in
 * process and answered as a message rather than streamed as bytes. A
 * family the table does not name is `other`, which is download-only for
 * good.
 *
 * **A row says how a file is previewed, and it says it once.** Either
 * the stored file is what a preview streams — `previewType` names what
 * to call it — or a converted PDF rendition is, and `convertFrom` names
 * the format the engine converts from. No row carries both, and a row
 * with neither is download-only.
 *
 * **SVG is deliberately not an image here.** An inline SVG is a script:
 * it can carry `<script>` and external references, and rendering one in
 * the panel would run it on our origin. It routes to `other` and gets
 * the download card, which is the whole of the decision.
 */

import type { ConvertibleFormat } from "./doc-engine/engine.js";
import { sql, type AnyPgColumn, type SQL } from "@openlaw/db";

/**
 * DOC-004's families, plus the catch-all.
 *
 * `pdf` and `image` render natively (M12/2). `word` and `presentation`
 * are drawn from a converted PDF rendition (M12/4). `email` is parsed in
 * process and drawn as a message (M12/5). `other` is everything else —
 * the spreadsheets and the archives DOC-004 leaves download-only.
 */
export const RENDER_FAMILIES = ["pdf", "image", "word", "presentation", "email", "other"] as const;

/** One of DOC-004's families. */
export type RenderFamily = (typeof RENDER_FAMILIES)[number];

/** What the table knows about one declared type or one extension. */
interface Route {
  family: RenderFamily;
  /**
   * The type a preview response sets for **this stored file**, or
   * `undefined` when the file itself is not what a preview streams.
   *
   * It is a constant from this table and never the uploader's own
   * string. A raster image needs the exact one — a PNG served as a JPEG
   * draws nothing — so the type rides with the route rather than being
   * derived from the family.
   */
  previewType?: string;
  /**
   * The source format the doc engine converts this file from (M12/4),
   * or `undefined` when the file needs no conversion.
   *
   * Present on exactly the families DOC-004 promises are "converted for
   * display": Word and PowerPoint. Their preview is a PDF rendition the
   * pipeline made, so they carry a conversion format instead of a
   * preview type — the two are alternatives, and no route has both.
   *
   * The format rides on the route rather than being read off the
   * filename, because the declared type is what chose the family and the
   * engine must be told the same story: a DOCX named `.pdf` is still
   * converted as a DOCX.
   *
   * Typed as the engine's own list rather than as a string, so a route
   * naming a format the engine does not convert is a compile error here
   * instead of a conversion that fails terminally in production.
   */
  convertFrom?: ConvertibleFormat;
}

const PDF: Route = { family: "pdf", previewType: "application/pdf" };
const EMAIL: Route = { family: "email" };

/** A Word-family document, named by the format the engine converts it
 * from. Every one of these is in the engine's `CONVERTIBLE_FORMATS`, and
 * the suite holds the two lists together. */
const word = (convertFrom: ConvertibleFormat): Route => ({ family: "word", convertFrom });

/** A PowerPoint-family deck, the same way. */
const presentation = (convertFrom: ConvertibleFormat): Route => ({
  family: "presentation",
  convertFrom,
});

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

  "application/msword": word("doc"),
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": word("docx"),
  "application/vnd.oasis.opendocument.text": word("odt"),
  "application/rtf": word("rtf"),
  "text/rtf": word("rtf"),

  "application/vnd.ms-powerpoint": presentation("ppt"),
  "application/vnd.openxmlformats-officedocument.presentationml.presentation": presentation("pptx"),
  "application/vnd.oasis.opendocument.presentation": presentation("odp"),

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

  doc: word("doc"),
  docx: word("docx"),
  odt: word("odt"),
  rtf: word("rtf"),

  ppt: presentation("ppt"),
  pptx: presentation("pptx"),
  odp: presentation("odp"),

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
 * The same routing table as a database expression for repository filters
 * and sorts. MIME arms come first, so a declared family keeps the same
 * precedence over the filename that {@link renderFamilyOf} applies.
 */
export function renderFamilySql(mimeType: AnyPgColumn, filename: AnyPgColumn): SQL<RenderFamily> {
  // The same whitespace set String.prototype.trim strips in {@link mediaType}:
  // btrim alone strips spaces only, so a tab before the `;` would split
  // the two classifications.
  const declared = sql`lower(btrim(split_part(${mimeType}, ';', 1), ' ' || chr(9) || chr(10) || chr(13)))`;
  const basename = sql`regexp_replace(${filename}, '^.*[/\\\\]', '')`;
  const extension = sql`lower(coalesce(substring(${basename} from '^.+\\.([^.]+)$'), ''))`;
  const arms = [
    ...Object.entries(BY_MIME_TYPE).map(
      ([key, route]) => sql`when ${declared} = ${key} then ${route.family}`,
    ),
    ...Object.entries(BY_EXTENSION).map(
      ([key, route]) => sql`when ${extension} = ${key} then ${route.family}`,
    ),
  ];
  // Every arm names a family and the fallback is 'other', so the CASE
  // can only yield a RenderFamily.
  return sql<RenderFamily>`case ${sql.join(arms, sql` `)} else 'other' end`;
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

/**
 * The type every display rendition is served as (DOC-004, M12/4).
 *
 * One constant, because there is one conversion target: a Word document
 * and a PowerPoint deck both become a PDF, and the panel draws both with
 * the same surface it draws a stored PDF with.
 */
export const RENDITION_CONTENT_TYPE = "application/pdf";

/**
 * The source format the doc engine converts this file from, or `null`
 * when the file needs no conversion (M12/4, DOC-004).
 *
 * Non-null is exactly the answer to "is this file's preview a rendition
 * rather than the file itself". The upload reads it to decide whether a
 * conversion is owed, the pipeline reads it to tell the engine what it
 * is holding, and the preview route reads it to decide which blob to
 * stream.
 *
 * It is a hint about the bytes and never a decision about them, in the
 * same way the family is: the engine opens the file to find out what it
 * really is, and a mismatch shows up as a conversion that fails
 * terminally, not as a file that is trusted.
 */
export function conversionFormatOf(mimeType: string, filename: string): ConvertibleFormat | null {
  return routeOf(mimeType, filename).convertFrom ?? null;
}
