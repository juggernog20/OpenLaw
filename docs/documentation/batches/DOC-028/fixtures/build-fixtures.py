#!/usr/bin/env python3
"""Build the fictional DOC-028 Word fixtures used by the independent V-C56 walkthrough.

Each file is a minimal Word OOXML package written with the standard library only,
in the same shape as apps/api/src/testing/fixtures/auto-docs. Run from any
directory; the .docx files land beside this script.
"""
from pathlib import Path
import zipfile

HERE = Path(__file__).resolve().parent
# Preserve the timestamps of the fixtures used in the recorded walkthrough.
FIXTURE_TIMESTAMP = (2026, 9, 16, 13, 32, 36)
W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"'
R = 'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"'
DECL = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'


def esc(text: str) -> str:
    return text.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")


def para(text: str, footnote: bool = False) -> str:
    runs = f"<w:r><w:t xml:space=\"preserve\">{esc(text)}</w:t></w:r>"
    if footnote:
        runs += '<w:r><w:rPr><w:vertAlign w:val="superscript"/></w:rPr><w:footnoteReference w:id="1"/></w:r>'
    return f"<w:p>{runs}</w:p>"


def package(body_paragraphs, header=None, footer=None, footnote=None) -> bytes:
    from io import BytesIO

    overrides = [
        ("/word/document.xml", "application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"),
    ]
    rels = []
    parts = {}
    sect = ""
    if header is not None:
        overrides.append(("/word/header1.xml", "application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml"))
        rels.append(("rHeader", "http://schemas.openxmlformats.org/officeDocument/2006/relationships/header", "header1.xml"))
        parts["word/header1.xml"] = f"{DECL}<w:hdr {W}>{para(header)}</w:hdr>"
        sect += '<w:headerReference w:type="default" r:id="rHeader"/>'
    if footer is not None:
        overrides.append(("/word/footer1.xml", "application/vnd.openxmlformats-officedocument.wordprocessingml.footer+xml"))
        rels.append(("rFooter", "http://schemas.openxmlformats.org/officeDocument/2006/relationships/footer", "footer1.xml"))
        parts["word/footer1.xml"] = f"{DECL}<w:ftr {W}>{para(footer)}</w:ftr>"
        sect += '<w:footerReference w:type="default" r:id="rFooter"/>'
    if footnote is not None:
        overrides.append(("/word/footnotes.xml", "application/vnd.openxmlformats-officedocument.wordprocessingml.footnotes+xml"))
        rels.append(("rFootnotes", "http://schemas.openxmlformats.org/officeDocument/2006/relationships/footnotes", "footnotes.xml"))
        parts["word/footnotes.xml"] = (
            f"{DECL}<w:footnotes {W}><w:footnote w:id=\"1\">{para(footnote)}</w:footnote></w:footnotes>"
        )
    body = "".join(body_paragraphs)
    parts["word/document.xml"] = (
        f"{DECL}<w:document {W} {R}><w:body>{body}<w:sectPr>{sect}</w:sectPr></w:body></w:document>"
    )
    content_types = (
        f'{DECL}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
        '<Default Extension="xml" ContentType="application/xml"/>'
        + "".join(f'<Override PartName="{name}" ContentType="{ctype}"/>' for name, ctype in overrides)
        + "</Types>"
    )
    root_rels = (
        f'{DECL}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
        '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>'
        "</Relationships>"
    )
    doc_rels = (
        f'{DECL}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
        + "".join(f'<Relationship Id="{rid}" Type="{rtype}" Target="{target}"/>' for rid, rtype, target in rels)
        + "</Relationships>"
    )
    buffer = BytesIO()
    with zipfile.ZipFile(buffer, "w", zipfile.ZIP_DEFLATED) as zf:
        entries = {
            "[Content_Types].xml": content_types,
            "_rels/.rels": root_rels,
            "word/_rels/document.xml.rels": doc_rels,
            **parts,
        }
        for name, xml in entries.items():
            entry = zipfile.ZipInfo(name, FIXTURE_TIMESTAMP)
            entry.compress_type = zipfile.ZIP_DEFLATED
            zf.writestr(entry, xml)
    return buffer.getvalue()


COMMON_HEAD = [
    para("DOC-028 Services Agreement"),
    para("This Services Agreement is between Helix Legal and {{counterparty_name}}.", footnote=True),
]
COMMON_TAIL = [
    para("Fee: {{fee_amount|currency:USD}}"),
    para("Governing law: {{governing_law}}"),
    para("{{#block arbitration}}Any dispute is settled by arbitration seated in {{arbitration_seat}}.{{/block}}"),
]
HEADER = "Helix Legal / {{counterparty_name}}"
FOOTER = "Reference {{reference_code}}"
FOOTNOTE = "Footnote: registered name of {{counterparty_name}}."

FIXTURES = {
    "doc028-services-v1.docx": package(
        COMMON_HEAD + [para("Signing date: {{signing_date}}")] + COMMON_TAIL,
        header=HEADER, footer=FOOTER, footnote=FOOTNOTE,
    ),
    # Drops signing_date (orphan) and adds notice_address (new field).
    "doc028-services-v2.docx": package(
        COMMON_HEAD + [para("Notices go to {{notice_address}}.")] + COMMON_TAIL,
        header=HEADER, footer=FOOTER, footnote=FOOTNOTE,
    ),
    "doc028-unclosed-block.docx": package(
        [para("{{#block arbitration}}Any dispute is settled by arbitration."), para("Signed by {{counterparty_name}}.")]
    ),
    "doc028-unclosed-brace.docx": package(
        [para("Signed by {{counterparty_name on the date below.")]
    ),
    "doc028-bad-currency.docx": package(
        [para("Fee: {{fee_amount|currency:ZZZ}}")]
    ),
    "doc028-two-directives.docx": package(
        [para("Fee: {{fee_amount|currency:USD}} due {{fee_amount|date:YYYY-MM-DD}}")]
    ),
}

if __name__ == "__main__":
    for name, data in FIXTURES.items():
        (HERE / name).write_bytes(data)
        print(f"{name}: {len(data)} bytes")
