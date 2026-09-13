// SPDX-License-Identifier: AGPL-3.0-only

/** TECH-028: the real renderer fills checked-in Word packages. */
import { readFile } from "node:fs/promises";
import { expect, it } from "vitest";
import type { AutoDocFormDefinition } from "@openlaw/db";
import PizZip from "pizzip";
import { templateTextParts } from "../auto-doc-template.js";
import { createAutoDocFillEngine } from "./real.js";
import { evaluateCondition } from "./values.js";

const fixture = (name: string) =>
  readFile(new URL(`../../testing/fixtures/auto-docs/${name}.docx`, import.meta.url));
const form = (...slugs: string[]): AutoDocFormDefinition => ({
  fields: slugs.map((slug, displayOrder) => ({
    slug,
    label: slug,
    fieldType: "text",
    help: null,
    options: null,
    required: false,
    displayOrder,
    placeholder: true,
  })),
  clauseRules: [],
});
const engine = createAutoDocFillEngine();
const text = (bytes: Buffer) =>
  templateTextParts(bytes)
    .map((part) => part.text)
    .join("\n");

it.each(["plain", "split", "formatting"])(
  "fills %s without losing run formatting",
  async (name) => {
    const template = await fixture(name);
    const output = await engine.fill({
      template,
      definition: form("counterparty_name", "signing_date", "amount"),
      answers: { counterparty_name: "Acme & Sons", signing_date: "2026-09-13", amount: "100" },
    });
    expect(text(output)).toContain("Acme & Sons");
    expect(text(output)).not.toContain("{{");
    if (name === "formatting") {
      const xml = new PizZip(output).file("word/document.xml")!.asText();
      expect(xml).toContain("<w:b/>");
      expect(xml).toContain("<w:i/>");
      expect(xml).toContain("<w:tbl>");
      expect(xml).toContain('<w:hyperlink w:anchor="local">');
    }
  },
);

it("keeps one Block and omits another while preserving the kept formatting", async () => {
  const definition = form("seat", "address", "jurisdiction");
  definition.clauseRules = [
    { blockName: "arbitration", fieldSlug: "jurisdiction", operator: "equals", value: "US" },
  ];
  const template = await fixture("block-formatting");
  const kept = await engine.fill({
    template,
    definition,
    answers: { seat: "New York", address: "London", jurisdiction: "US" },
  });
  const omitted = await engine.fill({
    template,
    definition,
    answers: { seat: "Paris", address: "London", jurisdiction: "FR" },
  });
  expect(text(kept)).toContain("The arbitration seat is New York.");
  expect(new PizZip(kept).file("word/document.xml")!.asText()).toContain(
    '<w:color w:val="336699"/>',
  );
  expect(text(omitted)).not.toContain("arbitration");
  expect(text(omitted)).not.toContain("Paris");
  expect(text(omitted)).toContain("Notice to London");
  expect(text(kept)).not.toContain("{{");
});

it("resolves upper case, fixed date formats, and currency symbols and separators", async () => {
  const definition = form("counterparty_name", "signing_date", "amount");
  definition.fields[1]!.fieldType = "date";
  definition.fields[2]!.fieldType = "currency";
  const output = await engine.fill({
    template: await fixture("directives"),
    definition,
    answers: { counterparty_name: "Acme", signing_date: "2026-09-13", amount: 12345.67 },
  });
  expect(text(output)).toContain("ACME");
  expect(text(output)).toContain("13/09/2026");
  expect(text(output)).toContain("$12,345.67");
});

it("preserves styles, numbering, tables, headers and footers outside substitutions", async () => {
  const template = await fixture("parts");
  const output = await engine.fill({
    template,
    definition: form("counterparty_name"),
    answers: { counterparty_name: "Acme" },
  });
  const before = new PizZip(template);
  const after = new PizZip(output);
  for (const name of [
    "word/styles.xml",
    "word/numbering.xml",
    "word/header1.xml",
    "word/footer1.xml",
    "word/_rels/document.xml.rels",
  ]) {
    expect(after.file(name)!.asText()).toBe(before.file(name)!.asText());
  }
  const xml = after.file("word/document.xml")!.asText();
  expect(xml).toContain('<w:numId w:val="1"/>');
  expect(xml).toContain('<w:tblStyle w:val="TableGrid"/>');
  expect(text(output)).toContain("Acme");
});

it("fills the scanner's header, footer, and endnote Placeholders", async () => {
  const output = await engine.fill({
    template: await fixture("parts-markers"),
    definition: form("counterparty_name"),
    answers: { counterparty_name: "Acme" },
  });
  const parts = templateTextParts(output);
  expect(parts.find((part) => part.name === "word/header1.xml")?.text).toContain("Acme");
  expect(parts.find((part) => part.name === "word/footer1.xml")?.text).toContain("ACME");
  expect(parts.find((part) => part.name === "word/endnotes.xml")?.text).toContain(
    "Endnote for Acme",
  );
  expect(text(output)).not.toContain("{{");
});

it.each([
  ["unclosed-brace", "{{counterparty_name"],
  ["unclosed-block", "{{#block arbitration}}"],
  ["invalid-slug", "{{Counterparty Name}}"],
  ["unopened-block", "{{/block}}"],
])("refuses the same malformed %s as upload", async (name, marker) => {
  await expect(
    engine.fill({ template: await fixture(name), definition: form(), answers: {} }),
  ).rejects.toThrow(marker);
});

it("terminates a timed-out fill without returning any output", async () => {
  const bounded = createAutoDocFillEngine({ timeoutMs: 1 });
  await expect(
    bounded.fill({ template: await fixture("plain"), definition: form(), answers: {} }),
  ).rejects.toThrow("timed out");
});

it("uses one condition grammar for scalar and multiple-choice answers", () => {
  const condition = (
    operator: "equals" | "is_one_of" | "is_set" | "is_not",
    value: string | string[] | null,
  ) => ({ fieldSlug: "jurisdiction", operator, value });
  expect(evaluateCondition(condition("equals", "US"), { jurisdiction: "US" })).toBe(true);
  expect(
    evaluateCondition(condition("is_one_of", ["US", "UK"]), { jurisdiction: ["FR", "UK"] }),
  ).toBe(true);
  expect(evaluateCondition(condition("is_set", null), { jurisdiction: false })).toBe(true);
  expect(evaluateCondition(condition("is_set", null), { jurisdiction: [] })).toBe(false);
  expect(evaluateCondition(condition("is_not", "US"), { jurisdiction: "UK" })).toBe(true);
});

it("refuses an expanded package above 32 MiB before rendering", async () => {
  const zip = new PizZip(await fixture("plain"));
  zip.file("word/media/oversized.bin", Buffer.alloc(32 * 1024 * 1024));
  await expect(
    engine.fill({
      template: zip.generate({ type: "nodebuffer", compression: "DEFLATE" }),
      definition: form(),
      answers: {},
    }),
  ).rejects.toThrow("expanded Word template exceeds 32 MiB");
});
