// SPDX-License-Identifier: AGPL-3.0-only
import { expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { parseDocumentationBundle } from "./documentation.js";

it("loads the built documentation and rejects malformed reader data before caching it", () => {
  const source: unknown = JSON.parse(
    readFileSync(new URL("../../dist/documentation.json", import.meta.url), "utf8"),
  );
  const bundle = parseDocumentationBundle(source);
  expect(bundle.articles.length).toBeGreaterThan(0);
  for (const invalid of [
    null,
    {},
    { ...bundle, contexts: null },
    { ...bundle, articles: [{ ...bundle.articles[0], text: 123 }] },
  ]) {
    expect(() => parseDocumentationBundle(invalid)).toThrow(
      "The documentation bundle is invalid. Rebuild the API.",
    );
  }
});
