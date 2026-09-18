// SPDX-License-Identifier: AGPL-3.0-only

/** Hand-built Word packages for the template screen and the ZIP guard tests. */
import PizZip from "pizzip";

export const WORD_NS = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
export const OFFICE_RELATIONSHIPS_NS =
  "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
export const PACKAGE_RELATIONSHIPS_NS =
  "http://schemas.openxmlformats.org/package/2006/relationships";

export function wordBody(inner: string): string {
  return `<w:document xmlns:w="${WORD_NS}" xmlns:r="${OFFICE_RELATIONSHIPS_NS}"><w:body>${inner}</w:body></w:document>`;
}
export function paragraph(text: string): string {
  return `<w:p><w:r><w:t xml:space="preserve">${text}</w:t></w:r></w:p>`;
}
export function relationships(inner: string): string {
  return `<Relationships xmlns="${PACKAGE_RELATIONSHIPS_NS}">${inner}</Relationships>`;
}
/** One complex field: a begin mark, the instruction runs, and an end mark. */
export function complexField(...instructionRuns: string[]): string {
  return (
    `<w:p><w:r><w:fldChar w:fldCharType="begin"/></w:r>` +
    instructionRuns
      .map((run) => `<w:r><w:instrText xml:space="preserve">${run}</w:instrText></w:r>`)
      .join("") +
    `<w:r><w:fldChar w:fldCharType="separate"/></w:r><w:r><w:t>result</w:t></w:r><w:r><w:fldChar w:fldCharType="end"/></w:r></w:p>`
  );
}

const CONTENT_TYPES = `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Default Extension="bin" ContentType="application/octet-stream"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`;
const ROOT_RELATIONSHIPS = relationships(
  `<Relationship Id="rId1" Type="${OFFICE_RELATIONSHIPS_NS}/officeDocument" Target="word/document.xml"/>`,
);

/**
 * A minimal package the detector accepts, with `parts` laid over the
 * defaults. A part set to `null` is left out.
 */
export function buildWordPackage(
  parts: Record<string, string | Buffer | null> = {},
  options: { compression?: "DEFLATE" | "STORE" } = {},
): Buffer {
  const files: Record<string, string | Buffer | null> = {
    "[Content_Types].xml": CONTENT_TYPES,
    "_rels/.rels": ROOT_RELATIONSHIPS,
    "word/document.xml": wordBody(paragraph("Between us and {{counterparty_name}}.")),
    "word/_rels/document.xml.rels": relationships(""),
    ...parts,
  };
  const zip = new PizZip();
  for (const [name, content] of Object.entries(files))
    if (content !== null) zip.file(name, content);
  return zip.generate({ type: "nodebuffer", compression: options.compression ?? "DEFLATE" });
}

const CENTRAL_DIRECTORY_ENTRY = 0x02014b50;
const LOCAL_FILE_HEADER = 0x04034b50;

/**
 * Rewrites the declared uncompressed size of one entry in both the
 * central directory and the local header, so the package claims a size
 * its bytes do not have.
 */
export function forgeDeclaredSize(packageBytes: Buffer, name: string, declared: number): Buffer {
  const forged = Buffer.from(packageBytes);
  const wanted = Buffer.from(name, "utf8");
  let patched = 0;
  for (let offset = 0; offset + 46 <= forged.byteLength; offset += 1) {
    const signature = forged.readUInt32LE(offset);
    if (signature === CENTRAL_DIRECTORY_ENTRY) {
      const nameLength = forged.readUInt16LE(offset + 28);
      if (forged.subarray(offset + 46, offset + 46 + nameLength).equals(wanted)) {
        forged.writeUInt32LE(declared, offset + 24);
        patched += 1;
      }
    } else if (signature === LOCAL_FILE_HEADER) {
      const nameLength = forged.readUInt16LE(offset + 26);
      if (forged.subarray(offset + 30, offset + 30 + nameLength).equals(wanted)) {
        forged.writeUInt32LE(declared, offset + 22);
        patched += 1;
      }
    }
  }
  if (patched !== 2) throw new Error(`Could not forge the size of ${name} (${patched} headers).`);
  return forged;
}
