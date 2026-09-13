// SPDX-License-Identifier: AGPL-3.0-only

/** TECH-028: convert scanned markers to sections without rewriting Word XML. */
import Docxtemplater from "docxtemplater";
import PizZip from "pizzip";
import { scanTemplateText, templateTextParts } from "../auto-doc-template.js";
import { AutoDocFillError, type AutoDocFillInput } from "./engine.js";
import { zipEntries } from "../docx-package.js";
import { evaluateCondition, resolveAutoDocValue } from "./values.js";

interface LexedPart {
  type: string;
  value?: string;
  position?: string;
}

export function renderAutoDoc(input: AutoDocFillInput): Buffer {
  if (
    [...zipEntries(input.template).values()].reduce(
      (total, entry) => total + entry.uncompressedSize,
      0,
    ) >
    32 * 1024 * 1024
  )
    throw new AutoDocFillError("The expanded Word template exceeds 32 MiB.");
  const scans = new Map(
    templateTextParts(input.template).map((part) => [
      part.name,
      { text: part.text, ...scanTemplateText(part.text) },
    ]),
  );
  const values = new Map<string, string | boolean>();
  let next = 0;
  const sections = new Map<string, string>();
  const module = {
    name: "OpenLawAutoDocMarkers",
    optionsTransformer(options: Docxtemplater.DXT.Options, doc: Docxtemplater) {
      doc.targets = [...scans.keys()];
      const config = (
        doc as Docxtemplater & {
          fileTypeConfig: { tagsXmlTextArray: string[]; templatedNs: string[] };
        }
      ).fileTypeConfig;
      config.tagsXmlTextArray = ["w:t"];
      config.templatedNs = [];
      return options;
    },
    preparse(parts: LexedPart[], options: { filePath: string }) {
      const scan = scans.get(options.filePath);
      let index = 0;
      let active = false;
      let replacement = "";
      let original = "";
      let first: LexedPart | undefined;
      for (const part of parts) {
        if (part.type === "delimiter" && part.position === "start") {
          active = true;
          original = "";
          first = undefined;
          const token = scan?.tokens[index];
          if (!token) throw new AutoDocFillError("The Word marker scan and renderer do not agree.");
          if (token.kind === "placeholder") {
            replacement = `value_${next++}`;
            values.set(replacement, resolveAutoDocValue(token, input));
          } else {
            let key = sections.get(token.name);
            if (!key) {
              key = `section_${next++}`;
              sections.set(token.name, key);
            }
            const rule = input.definition.clauseRules?.find(
              (candidate) => candidate.blockName === token.name,
            );
            values.set(key, rule ? evaluateCondition(rule, input.answers) : true);
            replacement = `${token.kind === "block_open" ? "#" : "/"}${key}`;
          }
        } else if (part.type === "delimiter" && part.position === "end") {
          const token = scan?.tokens[index++];
          if (
            !token ||
            !first ||
            original.trim() !== scan!.text.slice(token.start + 2, token.end - 2).trim()
          )
            throw new AutoDocFillError("The Word marker scan and renderer do not agree.");
          first.value = replacement;
          active = false;
        } else if (active && part.type === "content" && part.position === "insidetag") {
          first ??= part;
          original += part.value ?? "";
          part.value = "";
        }
      }
      if (index !== (scan?.tokens.length ?? 0))
        throw new AutoDocFillError("The Word marker scan and renderer do not agree.");
      return parts;
    },
  };
  const doc = new Docxtemplater(new PizZip(input.template), {
    delimiters: { start: "{{", end: "}}" },
    paragraphLoop: true,
    linebreaks: true,
    errorLogging: false,
    syntax: { changeDelimiterPrefix: null },
    modules: [module],
    parser: (tag) => ({ get: () => values.get(tag) ?? "" }),
  });
  doc.render({});
  return doc.getZip().generate({ type: "nodebuffer", compression: "DEFLATE" });
}
