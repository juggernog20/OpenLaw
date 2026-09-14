// SPDX-License-Identifier: AGPL-3.0-only

import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { readTemplate, readTemplatePart } from "./auto-doc-reading.js";

describe("readTemplatePart", () => {
  it("types Placeholders and Block markers inside their paragraphs", () => {
    const text =
      "Made between Helix and {{counterparty_name}}.\n\n{{#block arbitration}}Seated in {{seat|upper}}.{{/block}}\nEnd.\n";
    const paragraphs = readTemplatePart(text, new Set(["counterparty_name"]));
    expect(paragraphs).toEqual([
      [
        { kind: "text", text: "Made between Helix and " },
        {
          kind: "placeholder",
          text: "{{counterparty_name}}",
          name: "counterparty_name",
          directive: null,
          hasField: true,
        },
        { kind: "text", text: "." },
      ],
      [
        { kind: "block_open", name: "arbitration" },
        { kind: "text", text: "Seated in " },
        {
          kind: "placeholder",
          text: "{{seat|upper}}",
          name: "seat",
          directive: "upper",
          hasField: false,
        },
        { kind: "text", text: "." },
        { kind: "block_close", name: "arbitration" },
      ],
      [{ kind: "text", text: "End." }],
    ]);
  });

  it("keeps a Placeholder that a line break splits from its sentence", () => {
    const paragraphs = readTemplatePart("Dear\n{{name}}", new Set());
    expect(paragraphs).toHaveLength(2);
    expect(paragraphs[1]?.[0]).toMatchObject({ kind: "placeholder", name: "name" });
  });
});

describe("readTemplate", () => {
  it("reads the body of a fixture with its Blocks in order", async () => {
    const bytes = await readFile(
      new URL("../testing/fixtures/auto-docs/blocks.docx", import.meta.url),
    );
    const parts = readTemplate(bytes, new Set());
    expect(parts[0]?.kind).toBe("body");
    const kinds = parts[0]!.paragraphs.flat().map((segment) => segment.kind);
    expect(kinds).toContain("block_open");
    expect(kinds).toContain("block_close");
    expect(kinds).toContain("placeholder");
  });
});
