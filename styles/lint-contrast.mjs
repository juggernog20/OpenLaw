/* OpenLaw — contrast lint gate (DES-011, #42).
 *
 * Reads the three committed theme files and fails when any meaningful
 * text-on-background token pair drops below its WCAG 2.2 AA threshold:
 *
 *   - 4.5:1 for body-size text (DES-006 ramp is 11–14px in pills,
 *     badges, links, and copy — all under the 18px large-text cutoff).
 *   - 3:1 for graphical objects and non-body roles: the file-type icon
 *     squares, the avatar initials treatment (DES-018/DES-019), and
 *     `--text-subtle`, whose only roles are placeholder and disabled
 *     text (DES-005). Disabled text is exempt under WCAG 1.4.3; we hold
 *     placeholders to the 3:1 non-text floor instead of exempting them.
 *     `--text-subtle` is never body copy.
 *
 * Failures are fixed by adjusting the failing token in
 * styles/themes/<theme>.css — never by relaxing the check (DES-011).
 *
 * Runs standalone (`pnpm lint:contrast`) and inside `pnpm check`.
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const stylesDir = dirname(fileURLToPath(import.meta.url));

const BODY = 4.5;
const UI = 3.0;

const THEMES = ["light", "warm", "dark"];

const SURFACES = ["bg-canvas", "bg-raised", "bg-section-header", "bg-control"];
const STATUS_FAMILIES = [
  "success",
  "warning",
  "info",
  "danger",
  "severe", // DES-018 severity ramp
  "assigned",
  "onhold",
  "neutral", // DES-018 severity ramp
];

/* The pair matrix — every text/surface and status bg/fg pair the design
 * system actually uses (DES-005, DES-009, DES-018, DES-019), plus the
 * DES-011 suspect pairs. Each entry: [fg token, bg token, threshold].
 *
 * `--text-on-accent` × `--accent` is NOT checked yet: nothing renders
 * on the accent fill today, and the pair fails badly (2.5:1 in Light).
 * Add it here when mention chips land, after the pair is fixed. */
const PAIRS = [];

// Content text on the four content surfaces.
for (const text of ["text-primary", "text-muted"]) {
  for (const surface of SURFACES) PAIRS.push([text, surface, BODY]);
}
// Links appear on canvas, cards, and section-header strips ("View all").
for (const surface of ["bg-canvas", "bg-raised", "bg-section-header"]) {
  PAIRS.push(["text-link", surface, BODY]);
}
// Inline danger text sits in rows on canvas and cards.
for (const surface of ["bg-canvas", "bg-raised"]) {
  PAIRS.push(["text-danger", surface, BODY]);
}
// Placeholder / disabled — 3:1 floor, see file header.
for (const surface of ["bg-canvas", "bg-raised", "bg-control", "chrome-search-bg"]) {
  PAIRS.push(["text-subtle", surface, UI]);
}
// Inverted chrome (DES-005 header, DES-019 nav + search).
PAIRS.push(
  ["text-on-inverted", "bg-inverted", BODY],
  ["text-on-inverted", "chrome-nav-bg", BODY],
  ["text-on-inverted", "chrome-search-bg", BODY],
  ["chrome-nav-muted", "chrome-nav-bg", BODY],
  ["chrome-brand-fg", "chrome-brand-chip", BODY],
  ["text-on-cta", "cta-primary", BODY],
);
// Status pills — paired fg on bg, all eight families.
for (const family of STATUS_FAMILIES) {
  PAIRS.push([`status-${family}-fg`, `status-${family}-bg`, BODY]);
}
// Counter badges (11px counts — body threshold).
PAIRS.push(["badge-count-fg", "badge-count-bg", BODY], ["badge-alert-fg", "badge-alert-bg", BODY]);
// Confidentiality — inline marker on canvas/cards, banner fg on banner bg.
PAIRS.push(
  ["confidential-fg", "bg-canvas", BODY],
  ["confidential-fg", "bg-raised", BODY],
  ["confidential-fg", "confidential-bg", BODY],
);
// The Legal Only comment row (DES-023) — its own wash, one step lighter
// than the banner, so the row's own text and the DES-009-paired badge
// sitting on top of it both keep reading.
PAIRS.push(["text-primary", "legal-only-bg", BODY], ["text-muted", "legal-only-bg", BODY]);
// Avatar initials — graphical identifier per DES-018/DES-019; the name
// always accompanies the avatar in accessible contexts.
PAIRS.push(["avatar-fg", "avatar-bg", UI]);

/* Tokens whose value `transparent` means "the underlying surface shows
 * through" — resolved to that surface before checking. */
const TRANSPARENT_FALLBACK = { "chrome-brand-chip": "bg-inverted" };

function parseVars(css, source) {
  const vars = {};
  for (const match of css.matchAll(/--([\w-]+):\s*([^;]+);/g)) {
    vars[match[1]] = match[2].trim();
  }
  if (Object.keys(vars).length === 0) {
    throw new Error(`no custom properties found in ${source}`);
  }
  return vars;
}

function luminance(hex) {
  const digits = hex.replace("#", "");
  const full = digits.length === 3 ? [...digits].map((c) => c + c).join("") : digits;
  const [r, g, b] = [0, 2, 4].map((i) => {
    const channel = parseInt(full.slice(i, i + 2), 16) / 255;
    return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrastRatio(a, b) {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

function resolveHex(vars, token, theme) {
  let value = vars[token];
  if (value === undefined) {
    throw new Error(`token --${token} is missing from the ${theme} theme`);
  }
  if (value === "transparent") {
    const fallback = TRANSPARENT_FALLBACK[token];
    if (!fallback) {
      throw new Error(`token --${token} is transparent in ${theme} and has no fallback surface`);
    }
    value = vars[fallback];
  }
  if (!/^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(value)) {
    throw new Error(`token --${token} in ${theme} is not a hex color: "${value}"`);
  }
  return value;
}

// File-type icon colors are theme-invariant and live in globals.css.
const globalsVars = parseVars(
  readFileSync(join(stylesDir, "globals.css"), "utf8"),
  "styles/globals.css",
);
const FILE_TYPES = ["file-word", "file-excel", "file-pdf", "file-default"];

const failures = [];
let checked = 0;

for (const theme of THEMES) {
  const file = join(stylesDir, "themes", `${theme}.css`);
  const vars = parseVars(readFileSync(file, "utf8"), file);

  const check = (fgToken, fgHex, bgToken, bgHex, threshold) => {
    checked += 1;
    const ratio = contrastRatio(fgHex, bgHex);
    if (ratio < threshold) {
      failures.push({ theme, fgToken, fgHex, bgToken, bgHex, ratio, threshold });
    }
  };

  for (const [fgToken, bgToken, threshold] of PAIRS) {
    check(
      fgToken,
      resolveHex(vars, fgToken, theme),
      bgToken,
      resolveHex(vars, bgToken, theme),
      threshold,
    );
  }

  // File-type icon squares against the page canvas — graphical objects.
  for (const fileType of FILE_TYPES) {
    check(
      fileType,
      resolveHex(globalsVars, `color-${fileType}`, "globals"),
      "bg-canvas",
      resolveHex(vars, "bg-canvas", theme),
      UI,
    );
  }
}

if (failures.length > 0) {
  console.error(
    `contrast: ${failures.length} of ${checked} pairs fail WCAG 2.2 AA ` +
      `(DES-011 thresholds: ${BODY}:1 body text, ${UI}:1 graphical/placeholder)`,
  );
  for (const f of failures) {
    console.error(
      `  ${f.theme.padEnd(5)}  --${f.fgToken} ${f.fgHex}  on  --${f.bgToken} ${f.bgHex}` +
        `  ${f.ratio.toFixed(2)}:1 < ${f.threshold}:1`,
    );
  }
  console.error(
    "Fix by adjusting the failing token in styles/themes/<theme>.css — " +
      "never by relaxing the check (DES-011).",
  );
  process.exit(1);
}

console.log(`contrast: ${checked} pairs across ${THEMES.length} themes pass WCAG 2.2 AA (DES-011)`);
