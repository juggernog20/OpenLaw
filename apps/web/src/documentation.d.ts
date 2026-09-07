// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The virtual bundle contains reader data only. TECH-026 keeps the Node compiler
 * and internal verification records out of the browser module graph.
 */

declare module "virtual:openlaw-documentation" {
  const bundle: import("../../../scripts/documentation/reader.mjs").DocumentationBundle;
  export default bundle;
}
