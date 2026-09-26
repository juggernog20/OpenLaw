// SPDX-License-Identifier: AGPL-3.0-only
import { expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { parseDocumentationBundle } from "./documentation.js";

it.each([
  [
    "connect-claude",
    "attach-a-record-and-run-a-prompt",
    ["@openlaw:openlaw://contracts/C-12", "/openlaw:triage_inbox", "/openlaw:summarize_record"],
  ],
  [
    "connect-headless-client",
    "read-resources-and-get-prompts",
    ["openlaw://document-versions/{versionId}", "triage_inbox", "summarize_record"],
  ],
  ["connect-chatgpt", "resources-and-prompts", ["resources", "prompts"]],
  ["connect-microsoft-365-copilot", "resources-and-prompts", ["resources", "prompts"]],
  [
    "configure-mcp",
    "choose-team-and-administration",
    ["Starts off.", "Starts off. Administrators only."],
  ],
  ["configure-mcp", "receive-change-notifications", ["legacy Clients", "reload"]],
])("bundles the M42 section %s#%s for Help and Guide", (id, section, terms) => {
  const bundle = parseDocumentationBundle(
    JSON.parse(readFileSync(new URL("../../dist/documentation.json", import.meta.url), "utf8")),
  );
  const article = bundle.articles.find((article) => article.id === id);
  expect(article).toBeDefined();
  expect(article!.outline.map((heading) => heading.id)).toContain(section);
  for (const term of terms) expect(article!.text).toContain(term);
});

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
