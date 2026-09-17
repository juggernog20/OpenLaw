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

it("fills the downloadable agreement and its optional clause after removing the instructions page", async () => {
  const { detectAutoDocTemplate } = await import("../auto-doc-template.js");
  const template = await readFile(
    new URL("../../../../web/public/downloads/openlaw-auto-doc-starter.docx", import.meta.url),
  );
  const packageWithInstructions = new PizZip(template);
  const document = packageWithInstructions.file("word/document.xml")!.asText();
  const pageBreak = '<w:p><w:r><w:br w:type="page"/></w:r></w:p>';
  expect(document.split(pageBreak)).toHaveLength(2);
  expect(document.split(pageBreak)[0]).toContain("{{start_date|date:MMMM D, YYYY}}");
  // Follow the download's instructions: delete page one and its page break in Word.
  packageWithInstructions.file(
    "word/document.xml",
    document.replace(/(<w:body>)[\s\S]*?<w:p><w:r><w:br w:type="page"\/><\/w:r><\/w:p>/, "$1"),
  );
  const agreement = packageWithInstructions.generate({ type: "nodebuffer" });
  const detected = detectAutoDocTemplate(agreement);
  expect(detected.blocks).toEqual(["confidentiality"]);
  expect([...new Set(detected.placeholders)]).toEqual([
    "start_date",
    "provider_name",
    "client_name",
    "services",
    "fee",
  ]);
  expect(detected.directives).toEqual([
    { slug: "start_date", directive: "date:DD/MM/YYYY" },
    { slug: "provider_name", directive: "upper" },
    { slug: "client_name", directive: "upper" },
    { slug: "services", directive: "italic" },
    { slug: "fee", directive: "currency:USD" },
    { slug: "provider_name", directive: "bold" },
    { slug: "client_name", directive: "underline" },
  ]);
  const definition = form("start_date", "provider_name", "client_name", "services", "fee");
  definition.fields[0]!.fieldType = "date";
  definition.fields[4]!.fieldType = "currency";
  const output = await engine.fill({
    template: agreement,
    definition,
    answers: {
      start_date: "2026-10-01",
      provider_name: "Acme Advisory Ltd",
      client_name: "Wentworth Family Office",
      services: "Review and report on the Client’s supplier contracts.",
      fee: 2500,
    },
  });
  const filled = text(output);
  expect(filled).toContain("01/10/2026");
  expect(filled).toContain("ACME ADVISORY LTD");
  expect(filled).toContain("WENTWORTH FAMILY OFFICE");
  expect(filled.split("Fees and payment")[1]).toContain("$2,500.00");
  expect(filled).toContain("Review and report on the Client’s supplier contracts.");
  expect(filled).toContain("For Acme Advisory Ltd");
  expect(filled).toContain("For Wentworth Family Office");
  expect(filled).not.toContain("{{");
  expect(filled).toContain("Confidentiality");
  definition.fields.push({
    ...definition.fields[0]!,
    slug: "include_confidentiality",
    label: "Include confidentiality",
    fieldType: "boolean",
    placeholder: false,
    displayOrder: 5,
  });
  definition.clauseRules = [
    {
      blockName: "confidentiality",
      fieldSlug: "include_confidentiality",
      operator: "equals",
      value: true,
    },
  ];
  for (const include of [true, false]) {
    const result = text(
      await engine.fill({
        template: agreement,
        definition,
        answers: { include_confidentiality: include },
      }),
    );
    expect(result.includes("Confidentiality")).toBe(include);
    expect(result.includes("non-public information")).toBe(include);
    expect(result).toContain("Changes");
    expect(result).not.toContain("{{");
  }
});

it.each([
  ["bold", "b", "1"],
  ["italic", "i", "1"],
  ["underline", "u", "single"],
])(
  "applies %s only to the answer, preserving surrounding runs and XML escaping",
  async (style, property, expected) => {
    const zip = new PizZip(await fixture("plain"));
    zip.file(
      "word/document.xml",
      `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:rPr><w:b w:val="0"/><w:i w:val="0"/><w:u w:val="none"/><w:color w:val="336699"/></w:rPr><w:t>Before {{name|${style}}} after {{other}}.</w:t></w:r></w:p></w:body></w:document>`,
    );
    const output = await engine.fill({
      template: zip.generate({ type: "nodebuffer" }),
      definition: form("name", "other"),
      answers: { name: "A & <B>\nSecond line", other: "plain" },
    });
    expect(text(output)).toContain("Before A & <B>\nSecond line after plain.");
    const { DOMParser } = await import("@xmldom/xmldom");
    const xml = new PizZip(output).file("word/document.xml")!.asText();
    const ns = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
    const runs = Array.from(
      new DOMParser().parseFromString(xml, "application/xml").getElementsByTagNameNS(ns, "r"),
    );
    expect(runs[0]!.textContent).toBe("Before ");
    expect(runs.at(-1)!.textContent).toBe(" after plain.");
    const prop = (index: number) =>
      runs[index]!.getElementsByTagNameNS(ns, property!)[0]!.getAttributeNS(ns, "val");
    expect(prop(0)).toBe(style === "underline" ? "none" : "0");
    for (let index = 1; index < runs.length - 1; index++) expect(prop(index)).toBe(expected);
    expect(prop(runs.length - 1)).toBe(style === "underline" ? "none" : "0");
    expect(runs[1]!.getElementsByTagNameNS(ns, "color")[0]!.getAttributeNS(ns, "val")).toBe(
      "336699",
    );
    expect(xml).not.toContain("OPENLAW_STYLE_");
  },
);

it("styles split markers and headers, and leaves no style markers when a block is omitted", async () => {
  const zip = new PizZip(await fixture("parts"));
  const ns = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
  zip.file(
    "word/document.xml",
    `<w:document xmlns:w="${ns}"><w:body><w:p><w:r><w:t>Before {{na</w:t></w:r><w:r><w:t>me|bold}} after.</w:t></w:r></w:p><w:p><w:r><w:t>{{#block extra}}Optional {{name|italic}}{{/block}}</w:t></w:r></w:p></w:body></w:document>`,
  );
  zip.file(
    "word/header1.xml",
    `<w:hdr xmlns:w="${ns}"><w:p><w:r><w:t>Header {{name|underline}}.</w:t></w:r></w:p></w:hdr>`,
  );
  const definition = form("name", "include");
  definition.clauseRules = [
    { blockName: "extra", fieldSlug: "include", operator: "equals", value: "yes" },
  ];
  const output = await engine.fill({
    template: zip.generate({ type: "nodebuffer" }),
    definition,
    answers: { name: "Acme", include: "no" },
  });
  expect(text(output)).toContain("Before Acme after.");
  expect(text(output)).not.toContain("Optional");
  const result = new PizZip(output);
  expect(result.file("word/document.xml")!.asText()).toContain('<w:b w:val="1"');
  expect(result.file("word/header1.xml")!.asText()).toContain('<w:u w:val="single"');
  expect(result.file("word/header1.xml")!.asText()).not.toContain("OPENLAW_STYLE_");
});
