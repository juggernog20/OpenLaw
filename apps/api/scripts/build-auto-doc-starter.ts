// SPDX-License-Identifier: AGPL-3.0-only
/** Rebuild the downloadable starter: pnpm --filter @openlaw/api exec tsx scripts/build-auto-doc-starter.ts */
import { mkdir, writeFile } from "node:fs/promises";
import PizZip from "pizzip";

const escape = (text: string) =>
  text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
const paragraph = (text: string, style = "Normal") =>
  `<w:p><w:pPr><w:pStyle w:val="${style}"/></w:pPr><w:r><w:t xml:space="preserve">${escape(text)}</w:t></w:r></w:p>`;
const signature = (party: string) =>
  `<w:tc><w:tcPr><w:tcW w:w="4819" w:type="dxa"/></w:tcPr>${[
    paragraph(`For ${party}`, "Heading2"),
    paragraph("Signature: ____________________"),
    paragraph("Name / title: __________________"),
    paragraph("Date: ________________________"),
  ].join("")}</w:tc>`;
const formatRow = (marker: string, result: string) =>
  `<w:tr><w:tc><w:tcPr><w:tcW w:w="5500" w:type="dxa"/></w:tcPr>${paragraph(marker, "Code")}</w:tc><w:tc><w:tcPr><w:tcW w:w="4138" w:type="dxa"/></w:tcPr>${paragraph(result, "Guide")}</w:tc></w:tr>`;
const body = [
  paragraph("OPENLAW / AUTO-DOCS", "Eyebrow"),
  paragraph("Make a document from a form", "Title"),
  paragraph(
    "Write your document in Word and mark where answers should go. OpenLaw turns those marked places into form fields, then fills a copy of your document when someone completes the form.",
    "Guide",
  ),
  paragraph("1. Start with the agreement on page 2", "Heading2"),
  paragraph(
    "Save a copy of this file. Delete this instruction page and its page break before uploading: the examples below are for reading and would otherwise be filled too. In Auto-Docs, choose Create Auto-Doc, give it a name, then use Form → Upload version to upload your copy.",
    "Guide",
  ),
  paragraph("2. Put an answer into your document", "Heading2"),
  paragraph(
    "Type {{client_name}} wherever the client’s name should appear. OpenLaw creates one field for that name. Use the same marker again to repeat the same answer, for example in the signature section.",
    "Guide",
  ),
  paragraph(
    "Choose names such as client_name or start_date: begin with a lowercase letter and use only lowercase letters, digits and underscores (up to 120 characters). In Form, give each field a clear label, help text and the right answer type.",
    "Guide",
  ),
  paragraph("3. Choose how the answer looks", "Heading2"),
  paragraph(
    "Add one of the following after the field name. The bar (|) separates the name from the formatting instruction. Use only one formatting instruction in each marker.",
    "Guide",
  ),
  `<w:tbl><w:tblPr><w:tblW w:w="9638" w:type="dxa"/><w:tblLayout w:type="fixed"/></w:tblPr><w:tblGrid><w:gridCol w:w="5500"/><w:gridCol w:w="4138"/></w:tblGrid>${[
    formatRow("{{client_name|upper}}", "Acme Ltd → ACME LTD"),
    formatRow("{{start_date|date:DD/MM/YYYY}}", "1 October 2026 → 01/10/2026"),
    formatRow("{{start_date|date:YYYY-MM-DD}}", "1 October 2026 → 2026-10-01"),
    formatRow("{{start_date|date:MMMM D, YYYY}}", "1 October 2026 → October 1, 2026"),
    formatRow("{{fee|currency:USD}}", "2500 → $2,500.00"),
  ].join("")}</w:tbl>`,
  paragraph(
    "Date markers create date fields; currency markers create currency fields. Replace USD with another supported three-letter currency code, such as GBP. Currency formatting changes how a number is shown; it does not convert exchange rates.",
    "Guide",
  ),
  paragraph("4. Include a paragraph only when it is needed", "Heading2"),
  paragraph(
    "A block groups text that can be included or left out. Put the opening marker before the text and the closing marker after it:",
    "Guide",
  ),
  paragraph("{{#block confidentiality}}", "Code"),
  paragraph("The confidentiality paragraph goes here.", "Guide"),
  paragraph("{{/block}}", "Code"),
  paragraph(
    "The agreement on page 2 already uses this block. To make it optional, add a Boolean (Yes/No) field called Include confidentiality in Form. Under Clauses, open confidentiality, choose When a rule matches, and set the rule to include it when that field is Yes. Without a rule, the block is always included. Every opening marker needs a closing marker.",
    "Guide",
  ),
  paragraph("5. Try your finished template", "Heading2"),
  paragraph(
    "Review the form, choose Publish, then Generate. Fill in the parties, start date, services and fee. Download the result and check the answers, optional text and layout. If you change the Word file later, upload a new version and publish again.",
    "Guide",
  ),
  '<w:p><w:r><w:br w:type="page"/></w:r></w:p>',
  paragraph("Services Agreement", "Title"),
  paragraph(
    "This Services Agreement takes effect on {{start_date|date:DD/MM/YYYY}} between {{provider_name|upper}} (the “Provider”) and {{client_name|upper}} (the “Client”).",
  ),
  paragraph("Services", "Heading2"),
  paragraph("The Provider shall perform the following services for the Client: {{services}}"),
  paragraph("Fees and payment", "Heading2"),
  paragraph(
    "The Client shall pay a total fee of {{fee|currency:USD}}. Payment is due within 30 days after receipt of the Provider’s invoice.",
  ),
  paragraph("Term", "Heading2"),
  paragraph(
    "The services shall begin on the effective date and continue until completed, unless the parties agree in writing to end this Agreement earlier.",
  ),
  paragraph("{{#block confidentiality}}", "Code"),
  paragraph("Confidentiality", "Heading2"),
  paragraph(
    "Each party shall keep the other party’s non-public information confidential and use it only to perform this Agreement, except where disclosure is required by law.",
  ),
  paragraph("{{/block}}", "Code"),
  paragraph("Changes", "Heading2"),
  paragraph(
    "Any change to the services, fees or timing must be agreed in writing by both parties.",
  ),
  paragraph("Agreed by the parties", "Heading2"),
  `<w:tbl><w:tblPr><w:tblW w:w="9638" w:type="dxa"/><w:tblLayout w:type="fixed"/></w:tblPr><w:tblGrid><w:gridCol w:w="4819"/><w:gridCol w:w="4819"/></w:tblGrid><w:tr>${signature("{{provider_name}}")}${signature("{{client_name}}")}</w:tr></w:tbl>`,
].join("");
const zip = new PizZip();
const files: Record<string, string> = {
  "[Content_Types].xml": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/></Types>`,
  "_rels/.rels": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`,
  "word/document.xml": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body}<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1080" w:right="1134" w:bottom="1080" w:left="1134" w:header="540" w:footer="540" w:gutter="0"/></w:sectPr></w:body></w:document>`,
  "word/_rels/document.xml.rels": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`,
  "word/styles.xml": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri"/><w:sz w:val="22"/><w:color w:val="243247"/><w:lang w:val="en-US"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:after="120" w:line="264" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults><w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style>${[
    ["Title", "38", "172C43", "160", "160"],
    ["Subtitle", "24", "596777", "0", "200"],
    ["Heading1", "28", "172C43", "200", "100"],
    ["Heading2", "22", "172C43", "120", "60"],
    ["Guide", "20", "243247", "0", "90"],
    ["Code", "19", "243247", "0", "60"],
    ["Eyebrow", "18", "1A7F37", "0", "80"],
  ]
    .map(
      ([id, size, color, before, after]) =>
        `<w:style w:type="paragraph" w:styleId="${id}"><w:name w:val="${id}"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:pPr>${["Guide", "Code"].includes(id!) ? "" : "<w:keepNext/>"}<w:spacing w:before="${before}" w:after="${after}"${["Guide", "Code"].includes(id!) ? ' w:line="230" w:lineRule="auto"' : ""}/></w:pPr><w:rPr>${["Subtitle", "Guide", "Code"].includes(id!) ? "" : "<w:b/>"}${id === "Code" ? '<w:rFonts w:ascii="Consolas" w:hAnsi="Consolas"/>' : ""}<w:sz w:val="${size}"/><w:color w:val="${color}"/></w:rPr></w:style>`,
    )
    .join("")}</w:styles>`,
};
for (const [name, content] of Object.entries(files))
  zip.file(name, content, { date: new Date("2026-01-01T00:00:00Z") });
const output = new URL("../../web/public/downloads/openlaw-auto-doc-starter.docx", import.meta.url);
await mkdir(new URL(".", output), { recursive: true });
await writeFile(output, zip.generate({ type: "nodebuffer", compression: "DEFLATE" }));
