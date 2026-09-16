// SPDX-License-Identifier: AGPL-3.0-only

export const LOGO_BYTE_LIMIT = 5 * 1024 * 1024;
export const LOGO_TYPES = ["image/png", "image/jpeg", "image/webp", "image/svg+xml"];

// Base64 expansion plus the longest supported data URI prefix (SVG).
export const LOGO_DATA_URI_LIMIT = 4 * Math.ceil(LOGO_BYTE_LIMIT / 3) + 26;
