// SPDX-License-Identifier: AGPL-3.0-only

/** TECH-028: convert scanned markers to sections without rewriting Word XML. */
import { randomUUID } from "node:crypto";
import { applyTextStyles } from "./text-style.js";
import Docxtemplater from "docxtemplater";
import PizZip from "pizzip";
import {
  isAutoDocTextStyle,
  type AutoDocTextStyle,
  scanTemplateText,
  templateTextParts,
} from "../auto-doc-template.js";
import { AutoDocFillError, MAX_EXPANDED_TEMPLATE_BYTES, type AutoDocFillInput } from "./engine.js";
import { verifyZipPackage } from "../docx-package.js";
import { evaluateCondition, resolveAutoDocValue } from "./values.js";

interface LexedPart {
  type: string;
  value?: string;
  position?: string;
}

export function renderAutoDoc(input: AutoDocFillInput): Buffer {
  // Declared sizes are not trusted; every entry is inflated under the ceiling first.
  try {
    verifyZipPackage(input.template, MAX_EXPANDED_TEMPLATE_BYTES);
  } catch (error) {
    throw new AutoDocFillError(
      error instanceof Error ? error.message : "The Word template could not be read.",
    );
  }
  const scans = new Map(
    templateTextParts(input.template).map((part) => [
      part.name,
      { text: part.text, ...scanTemplateText(part.text) },
    ]),
  );
  const values = new Map<string, string | boolean>();
  const stylePrefix = `OPENLAW_STYLE_${randomUUID().replaceAll("-", "")}_`;
  const textStyles = new Map<string, AutoDocTextStyle>();
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
            let value = resolveAutoDocValue(token, input);
            if (isAutoDocTextStyle(token.directive)) {
              const id = String(next);
              textStyles.set(id, token.directive);
              value = `${stylePrefix}S${id}__${value}${stylePrefix}E${id}__`;
            }
            values.set(replacement, value);
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
  const filled = doc.getZip();
  if (textStyles.size)
    for (const name of scans.keys()) {
      const part = filled.file(name);
      if (part) filled.file(name, applyTextStyles(part.asText(), stylePrefix, textStyles));
    }
  return filled.generate({ type: "nodebuffer", compression: "DEFLATE" });
}
