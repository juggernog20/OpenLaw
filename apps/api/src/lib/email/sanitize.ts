// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Making an email's HTML body safe to draw, and reading its words out
 * (DOC-004, M12/5).
 *
 * An email body is the one thing in this system that was written by
 * somebody outside it. A contract, a comment, and a field value were all
 * typed by a person who signed in; an uploaded MSG or EML carries
 * whatever a stranger sent, and the panel is asked to render it. So the
 * body is treated as hostile input and cut down to an allow-list before
 * it leaves the API.
 *
 * **The allow-list is what a letter is made of.** Paragraphs, headings,
 * lists, tables, quotes, emphasis, and links — the tags an email uses to
 * say something. Everything else is discarded, and the tags that carry
 * behaviour rather than text — `script`, `style`, `iframe`, `object`,
 * `form` — are discarded with their contents, so a stripped `<style>`
 * block does not reappear as a paragraph of CSS.
 *
 * **Nothing remote loads.** `img` is not in the list, so a tracking pixel
 * cannot report that a lawyer opened a disclosed email, and no request
 * leaves the reader's browser for a sender's server. Every mail client
 * blocks remote content by default and this one blocks it outright: an
 * image that was attached is in the attachment list, where it is
 * downloadable and — if it is a raster image — openable in the panel.
 *
 * **A link keeps its address and loses its reach.** Only `http`, `https`,
 * `mailto`, and `tel` survive, so `javascript:` and `data:` hrefs are
 * dropped; what is left opens in a new tab with no handle back to the
 * window that opened it.
 *
 * **This is the first of two walls, not the only one.** The panel draws
 * the result inside a sandboxed frame that can run nothing and reach
 * nowhere. A sanitizer is a parser, parsers have bugs, and one bug should
 * not be one origin.
 */

import sanitizeHtml from "sanitize-html";

/**
 * The tags an email body may keep.
 *
 * Read it as "what a letter is made of": structure, emphasis, lists,
 * tables, and links. `font` and `center` are in it because mail clients
 * still emit them and a body that loses them loses its layout for no
 * gain — they carry no behaviour.
 */
const ALLOWED_TAGS = [
  "a",
  "b",
  "big",
  "blockquote",
  "br",
  "caption",
  "center",
  "code",
  "col",
  "colgroup",
  "dd",
  "div",
  "dl",
  "dt",
  "em",
  "font",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "hr",
  "i",
  "li",
  "ol",
  "p",
  "pre",
  "q",
  "s",
  "small",
  "span",
  "strike",
  "strong",
  "sub",
  "sup",
  "table",
  "tbody",
  "td",
  "tfoot",
  "th",
  "thead",
  "tr",
  "u",
  "ul",
] as const;

/**
 * The CSS properties an inline `style` may keep, each bounded by what it
 * is allowed to say.
 *
 * Inline style is most of what an email's appearance is, so dropping it
 * whole would make every message read as a plain-text draft. What is
 * dangerous in CSS is what fetches or positions: `url()` reaches a
 * server, and `position` can lift an element out of the body and over
 * the application around it. Neither property is here, and every value
 * below is matched against a pattern rather than passed through.
 */
const ALLOWED_STYLES: Record<string, RegExp[]> = {
  // Colours, in the notations a mail client writes them in.
  color: [/^#[0-9a-f]{3,8}$/i, /^rgba?\([\d\s.,%]+\)$/i, /^[a-z]+$/i],
  "background-color": [/^#[0-9a-f]{3,8}$/i, /^rgba?\([\d\s.,%]+\)$/i, /^[a-z]+$/i],
  "text-align": [/^(left|right|center|justify|start|end)$/i],
  "font-weight": [/^(normal|bold|bolder|lighter|\d{3})$/i],
  "font-style": [/^(normal|italic|oblique)$/i],
  "font-size": [/^\d+(\.\d+)?(px|pt|em|rem|%)$/i],
  "font-family": [/^[\w\s,'"-]+$/],
  "text-decoration": [/^[a-z\s-]+$/i],
  "white-space": [/^(normal|nowrap|pre|pre-wrap|pre-line)$/i],
  "line-height": [/^\d+(\.\d+)?(px|pt|em|rem|%)?$/i],
};

/** Everything sanitize-html is told, in one place. */
const OPTIONS: sanitizeHtml.IOptions = {
  allowedTags: [...ALLOWED_TAGS],
  allowedAttributes: {
    // `target` and `rel` are on the list because the transform below
    // writes them; an attribute a transform adds is dropped like any
    // other unless it is allowed.
    a: ["href", "title", "target", "rel"],
    td: ["colspan", "rowspan", "align", "valign"],
    th: ["colspan", "rowspan", "align", "valign"],
    table: ["align", "border", "cellpadding", "cellspacing"],
    "*": ["style", "dir", "lang"],
  },
  allowedStyles: { "*": ALLOWED_STYLES },
  // A scheme that is not here is dropped with the attribute it was on.
  // `javascript:` and `data:` are the two that matter: one runs, and one
  // carries a whole document.
  allowedSchemes: ["http", "https", "mailto", "tel"],
  // Every URL-bearing attribute the library knows about, not only the
  // one the allow-list currently admits: a tag added to that list later
  // must not arrive with its scheme unchecked.
  allowedSchemesAppliedToAttributes: ["href", "src", "cite"],
  // A relative href in an email has no base to resolve against, and in
  // the panel it would resolve against our own origin — which is a link
  // out of the message and into the application.
  allowProtocolRelative: false,
  // Their text goes with them. A discarded `<style>` whose CSS came back
  // as a paragraph would be worse than either keeping it or dropping it.
  nonTextTags: ["script", "style", "textarea", "option", "noscript", "title"],
  transformTags: {
    // A message links out. The new tab is the honest destination, and
    // `noopener` is what stops the page it opens from reaching back
    // through `window.opener` into the reader's session.
    a: sanitizeHtml.simpleTransform("a", { target: "_blank", rel: "noopener noreferrer" }),
  },
};

/**
 * One email's HTML body, cut down to what is safe to draw.
 *
 * Answers `""` for a body that had nothing left after the cut — a
 * message whose whole content was a tracking pixel is empty, and saying
 * so is more honest than drawing a blank frame that looks broken.
 */
export function sanitizeEmailHtml(html: string): string {
  return sanitizeHtml(html, OPTIONS);
}

/**
 * The words of an HTML body, for the version's extracted text (DOC-005).
 *
 * Taken from the sanitized HTML rather than the raw source, so nothing a
 * sender hid in a `<style>` block or a script becomes a document's
 * searchable text.
 *
 * The line breaks are put back before the tags come off. A body stripped
 * tag-by-tag answers one run-on line, which reads as a bug to anybody who
 * ever sees it and is worse to search than the paragraphs it came from.
 */
export function emailHtmlToText(html: string): string {
  const withBreaks = sanitizeEmailHtml(html)
    // Every tag that ends a line in a rendered body ends one here.
    .replaceAll(/<br\s*\/?>/gi, "\n")
    .replaceAll(/<\/(p|div|tr|li|h[1-6]|blockquote|pre|table|ul|ol|dl|dt|dd)>/gi, "\n");
  // A second pass with nothing allowed is what takes the tags off: it is
  // the same parser, so a stray `<` in the body is treated as the
  // character it is rather than as the start of something.
  const stripped = sanitizeHtml(withBreaks, { allowedTags: [], allowedAttributes: {} });
  return (
    decodeTextEntities(stripped)
      // Non-breaking spaces are spaces to a reader and to a search
      // index. Written as an escape, because the character itself is
      // invisible in a source file and the next person to read this line
      // would see two identical arguments.
      .replaceAll(/\u00a0/g, " ")
      // Trailing spaces on every line, and any run of blank lines past
      // one, are the debris of markup rather than anything a sender
      // wrote.
      .replaceAll(/[ \t]+$/gm, "")
      .replaceAll(/\n{3,}/g, "\n\n")
      .trim()
  );
}

/**
 * The entity references left in stripped text, as the characters they
 * stand for.
 *
 * The sanitizer writes HTML, so it escapes what it emits: an ampersand a
 * sender typed comes back as `&amp;`. That is right for markup and wrong
 * for text — this is a document's searchable words, and nobody searches
 * for `&amp;`.
 *
 * The named set is short because the set that can appear is: the
 * sanitizer escapes only the characters that would otherwise be markup.
 * Numeric references are decoded generally, because a sender's own
 * `&#8217;` survives the strip as itself.
 */
const NAMED_ENTITIES: ReadonlyMap<string, string> = new Map([
  ["amp", "&"],
  ["lt", "<"],
  ["gt", ">"],
  ["quot", '"'],
  ["apos", "'"],
  ["nbsp", " "],
]);

/**
 * A `Map` rather than an object literal, and that is not a style
 * choice. An object lookup answers for keys nobody wrote — `&constructor;`
 * would read a function off `Object.prototype`, and the `??` below would
 * never fire, so the function's source would be spliced into a
 * document's searchable text. The key here comes out of an email.
 */
function decodeTextEntities(text: string): string {
  return text.replaceAll(
    /&(?:#(\d+)|#[xX]([0-9a-fA-F]+)|([a-zA-Z]+));/g,
    (match: string, decimal?: string, hex?: string, name?: string) => {
      if (decimal !== undefined) return codePoint(Number.parseInt(decimal, 10)) ?? match;
      if (hex !== undefined) return codePoint(Number.parseInt(hex, 16)) ?? match;
      // A name nobody here knows is left exactly as it was written: it is
      // more honest to show `&hellip;` than to guess at it.
      return NAMED_ENTITIES.get((name ?? "").toLowerCase()) ?? match;
    },
  );
}

/** One character from its code point, or `undefined` when the reference
 * names no character at all. NUL is refused because Postgres refuses a
 * text value holding it, and the surrogate range because a lone
 * surrogate is not a character: it would go to the database as a
 * replacement character and out over the API as itself, and a document's
 * stored text must not disagree with its read. */
function codePoint(value: number): string | undefined {
  const surrogate = value >= 0xd800 && value <= 0xdfff;
  return Number.isInteger(value) && value > 0 && value <= 0x10ffff && !surrogate
    ? String.fromCodePoint(value)
    : undefined;
}
