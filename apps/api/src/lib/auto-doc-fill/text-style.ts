// SPDX-License-Identifier: AGPL-3.0-only
import {
  DOMParser,
  XMLSerializer,
  type DOMParserOptions,
  type Element,
  type Node,
} from "@xmldom/xmldom";
import type { AutoDocTextStyle } from "../auto-doc-template.js";
import { AutoDocFillError } from "./engine.js";

const WORD_NS = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
const properties: Record<AutoDocTextStyle, string[]> = {
  bold: ["b", "bCs"],
  italic: ["i", "iCs"],
  underline: ["u"],
};
function isWord(node: Node, name: string): node is Element {
  return (
    node.nodeType === 1 &&
    (node as Element).namespaceURI === WORD_NS &&
    (node as Element).localName === name
  );
}

/** Isolate each filled answer in its own Word run so adjacent text keeps its formatting. */
export function applyTextStyles(
  xml: string,
  prefix: string,
  styles: Map<string, AutoDocTextStyle>,
): string {
  if (!xml.includes(prefix)) return xml;
  const options: DOMParserOptions = {
    onError: () => {
      throw new AutoDocFillError("The filled Word XML could not be styled.");
    },
  };
  const document = new DOMParser(options).parseFromString(xml, "application/xml");
  const markers = new RegExp(`${prefix}(S|E)(\\d+)__`, "g");
  let active: string | null = null;
  for (const run of Array.from(document.getElementsByTagNameNS(WORD_NS, "r"))) {
    const children = Array.from(run.childNodes);
    if (
      active === null &&
      !children.some((child) => isWord(child, "t") && child.textContent?.includes(prefix))
    )
      continue;
    const originalProperties = children.find((child) => isWord(child, "rPr"));
    let output: Element | undefined;
    let outputStyle: string | null | undefined;
    const append = (child: Node) => {
      if (!output || outputStyle !== active) {
        output = run.cloneNode(false) as Element;
        outputStyle = active;
        const props = originalProperties?.cloneNode(true) as Element | undefined;
        if (props) output.appendChild(props);
        if (active !== null) {
          const style = styles.get(active);
          if (!style) throw new AutoDocFillError("An unknown text style was encountered.");
          const rPr = props ?? document.createElementNS(WORD_NS, "w:rPr");
          if (!props) output.appendChild(rPr);
          for (const name of properties[style]) {
            for (const held of Array.from(rPr.childNodes))
              if (isWord(held, name)) rPr.removeChild(held);
            const property = document.createElementNS(WORD_NS, `w:${name}`);
            property.setAttributeNS(WORD_NS, "w:val", name === "u" ? "single" : "1");
            rPr.appendChild(property);
          }
        }
        run.parentNode!.insertBefore(output, run);
      }
      output.appendChild(child);
    };
    for (const child of children) {
      if (isWord(child, "rPr")) continue;
      if (!isWord(child, "t")) {
        append(child.cloneNode(true));
        continue;
      }
      const value = child.textContent ?? "";
      const addText = (value: string) => {
        if (!value) return;
        const node = child.cloneNode(false) as Element;
        node.setAttributeNS("http://www.w3.org/XML/1998/namespace", "xml:space", "preserve");
        node.appendChild(document.createTextNode(value));
        append(node);
      };
      let offset = 0;
      for (const match of value.matchAll(markers)) {
        addText(value.slice(offset, match.index));
        const id = match[2]!;
        if (!styles.has(id) || (match[1] === "S" ? active !== null : active !== id))
          throw new AutoDocFillError("The filled text style boundaries do not match.");
        active = match[1] === "S" ? id : null;
        offset = match.index + match[0].length;
      }
      addText(value.slice(offset));
    }
    run.parentNode!.removeChild(run);
  }
  const result = new XMLSerializer().serializeToString(document);
  if (active !== null || result.includes(prefix))
    throw new AutoDocFillError("The filled text style boundaries could not be resolved.");
  return result;
}
