// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The result envelope every settings API adapter resolves with: the
 * mutated row (or rows), or the problem's `detail` when the API
 * refused. A neutral home so peer components — the taxonomy pane
 * (DES-020) and the type editor (DES-022) — share the shape without
 * importing each other's modules.
 */

/** A mutation's outcome: the row (or rows), or the problem's detail. */
export interface ApiResult<T> {
  data?: T;
  detail?: string;
}
