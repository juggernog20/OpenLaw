// SPDX-License-Identifier: AGPL-3.0-only

/** ADO-002 detection reads real Word packages, including split runs. */
import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { detectAutoDocTemplate, scanTemplateText } from "./auto-doc-template.js";

const fixture = (name: string) =>
  readFile(new URL(`../testing/fixtures/auto-docs/${name}.docx`, import.meta.url));

describe("Auto-Doc detection", () => {
  it("reports every Placeholder in document order", async () => {
    const found = detectAutoDocTemplate(await fixture("plain"));
    expect(found.placeholders).toEqual(["counterparty_name", "signing_date", "counterparty_name"]);
    expect(found.blocks).toEqual([]);
  });
  it.each(["split", "formatting"])("merges Word runs in %s", async (name) => {
    const found = detectAutoDocTemplate(await fixture(name));
    expect(found.placeholders).toEqual(
      name === "formatting" ? ["counterparty_name", "amount"] : ["counterparty_name"],
    );
  });
  it("reports named Blocks separately from Placeholders", async () => {
    const found = detectAutoDocTemplate(await fixture("blocks"));
    expect(found.blocks).toEqual(["arbitration", "notice"]);
    expect(found.placeholders).toEqual(["seat", "address"]);
  });
  it.each([
    ["unclosed-brace", "{{counterparty_name"],
    ["unclosed-block", "{{#block arbitration}}"],
    ["invalid-slug", "{{Counterparty Name}}"],
    ["unopened-block", "{{/block}}"],
  ])("quotes the offending text in %s", async (name, offending) => {
    const bytes = await fixture(name!);
    expect(() => detectAutoDocTemplate(bytes)).toThrow(JSON.stringify(offending));
  });
  it("ignores ordinary braces and non-marker text", () => {
    expect(scanTemplateText("The set {a, b}. MERGEFIELD company_name")).toMatchObject({
      placeholders: [],
      blocks: [],
    });
  });
  it("refuses a broken package", () => {
    expect(() => detectAutoDocTemplate(Buffer.from("not a Word file"))).toThrow();
  });
});
