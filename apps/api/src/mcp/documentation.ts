// SPDX-License-Identifier: AGPL-3.0-only
import { readFileSync } from "node:fs";
import type { DocumentationBundle } from "../../../../scripts/documentation/reader.mjs";

let bundle: DocumentationBundle | undefined;
export function documentationBundle(): DocumentationBundle {
  // The same location resolves from src/mcp during development and dist/mcp in the image.
  return (bundle ??= JSON.parse(
    readFileSync(new URL("../../dist/documentation.json", import.meta.url), "utf8"),
  ) as DocumentationBundle);
}
