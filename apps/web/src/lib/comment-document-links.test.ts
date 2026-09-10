// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from "vitest";
import {
  commentBodyParts,
  documentLinkDraft,
  serializeDocumentLinks,
} from "./comment-document-links";

const href = "/matters/12/documents?doc=doc-sample&version=version-sample";

describe("document references in comments", () => {
  it("round trips punctuation, repeated references, and edits without showing link syntax", () => {
    const link = { displayName: "Agreement [signed] \\ final (2026).pdf", href };
    const draft = `@Jenny please read @${link.displayName}, then compare @${link.displayName}.`;
    const stored = serializeDocumentLinks(draft, [link]);
    expect(commentBodyParts(stored).filter((part) => typeof part !== "string")).toEqual([
      link,
      link,
    ]);
    expect(documentLinkDraft(stored).draft).toBe(draft);
    expect(
      serializeDocumentLinks(documentLinkDraft(stored).draft, documentLinkDraft(stored).links),
    ).toBe(stored);
    expect(serializeDocumentLinks("Reference removed.", [link])).toBe("Reference removed.");
  });

  it("leaves unsafe and unrelated links as plain text", () => {
    for (const url of [
      "javascript:alert(1)",
      "https://example.com",
      "//example.com",
      "/settings",
      `${href}&redirect=https://example.com`,
    ]) {
      const body = `[@Agreement](${url})`;
      expect(commentBodyParts(body)).toEqual([body]);
      expect(serializeDocumentLinks("@Agreement", [{ displayName: "Agreement", href: url }])).toBe(
        "@Agreement",
      );
    }
  });

  it("does not turn an email address or an edited longer title into a link", () => {
    const link = { displayName: "Agreement", href };
    expect(serializeDocumentLinks("help@Agreement.test @Agreements", [link])).toBe(
      "help@Agreement.test @Agreements",
    );
  });
});
