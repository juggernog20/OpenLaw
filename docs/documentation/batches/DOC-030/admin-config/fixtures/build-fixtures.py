#!/usr/bin/env python3
"""Build the fictional DOC-030 admin-config Word fixtures for the V-C56 walkthrough.

Adapted from DOC-029/auto-docs/fixtures/build-fixtures.py. It adds the bold,
underline and italic directives, disagreeing date and currency directives, and
the package-screening refusals: a macro project, a non-hyperlink external link,
an INCLUDETEXT field and a package that expands past 32 MiB.

Each file is a minimal Word OOXML package written with the standard library only,
in the same shape as apps/api/src/testing/fixtures/auto-docs. Run from any
directory; the .docx files land beside this script.
"""
from pathlib import Path
import zipfile

HERE = Path(__file__).resolve().parent
# A fixed timestamp keeps the fixture bytes reproducible.
FIXTURE_TIMESTAMP = (2026, 9, 25, 12, 0, 0)
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


def package(body_paragraphs, header=None, footer=None, footnote=None, endnote=None,
            extra_parts=None, extra_rels=None, extra_overrides=None, raw_body=None) -> bytes:
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
    if endnote is not None:
        overrides.append(("/word/endnotes.xml", "application/vnd.openxmlformats-officedocument.wordprocessingml.endnotes+xml"))
        rels.append(("rEndnotes", "http://schemas.openxmlformats.org/officeDocument/2006/relationships/endnotes", "endnotes.xml"))
        parts["word/endnotes.xml"] = (
            f"{DECL}<w:endnotes {W}><w:endnote w:id=\"1\">{para(endnote)}</w:endnote></w:endnotes>"
        )
    overrides += list(extra_overrides or [])
    rels += list(extra_rels or [])
    body = raw_body if raw_body is not None else "".join(body_paragraphs)
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
        + "".join(f'<Relationship Id="{r[0]}" Type="{r[1]}" Target="{r[2]}"' + (f' TargetMode="{r[3]}"' if len(r) > 3 else "") + "/>" for r in rels)
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
        entries.update(extra_parts or {})
        for name, xml in entries.items():
            entry = zipfile.ZipInfo(name, FIXTURE_TIMESTAMP)
            entry.compress_type = zipfile.ZIP_DEFLATED
            zf.writestr(entry, xml)
    return buffer.getvalue()



COMMON_HEAD = [
    para("DOC-030 admin-config Services Agreement"),
    para("This Services Agreement is between Helix Legal and {{counterparty_name}}.", footnote=True),
    para("Provider contact: {{provider_contact|bold}}, {{provider_role|italic}}, {{provider_team|underline}}."),
]
COMMON_TAIL = [
    para("Fee: {{fee_amount|currency:USD}}"),
    para("Governing law: {{governing_law}}"),
    para("{{#block arbitration}}Any dispute is settled by arbitration seated in {{arbitration_seat}}.{{/block}}"),
]
HEADER = "Helix Legal / {{counterparty_name|upper}} / {{client_matter}}"
FOOTER = "Reference {{reference_code}}"
FOOTNOTE = "Footnote: registered name of {{counterparty_name}}."
ENDNOTE = "Endnote: see schedule {{schedule_number}}."
WML = "http://schemas.openxmlformats.org/wordprocessingml/2006/main"

FIXTURES = {
    "doc030-services-v1.docx": package(
        COMMON_HEAD + [para("Signing date: {{signing_date|date:DD/MM/YYYY}}"), para("Start: {{start_date|date:MMMM D, YYYY}}")] + COMMON_TAIL,
        header=HEADER, footer=FOOTER, footnote=FOOTNOTE, endnote=ENDNOTE,
    ),
    # Drops signing_date (orphan) and adds notice_address (new field).
    "doc030-services-v2.docx": package(
        COMMON_HEAD + [para("Notices go to {{notice_address}}."), para("Start: {{start_date|date:MMMM D, YYYY}}")] + COMMON_TAIL,
        header=HEADER, footer=FOOTER, footnote=FOOTNOTE, endnote=ENDNOTE,
    ),
    "doc030-unclosed-block.docx": package(
        [para("{{#block arbitration}}Any dispute is settled by arbitration."), para("Signed by {{counterparty_name}}.")]
    ),
    "doc030-unclosed-brace.docx": package([para("Signed by {{counterparty_name on the date below.")]),
    "doc030-bad-name.docx": package([para("Signed by {{Counterparty-Name}}.")]),
    "doc030-bad-directive.docx": package([para("Signed by {{counterparty_name|lower}}.")]),
    "doc030-bad-currency.docx": package([para("Fee: {{fee_amount|currency:ZZZ}}")]),
    "doc030-two-directives-one-placeholder.docx": package([para("Signed by {{counterparty_name|upper|bold}}.")]),
    "doc030-disagreeing-directives.docx": package(
        [para("Fee: {{payment|currency:USD}} due {{payment|date:YYYY-MM-DD}}")]
    ),
    # Package screening refusals.
    "doc030-macro.docx": package(
        [para("Signed by {{counterparty_name}}.")],
        extra_parts={"word/vbaProject.bin": "fictional macro project placeholder bytes"},
        extra_rels=[("rVba", "http://schemas.microsoft.com/office/2006/relationships/vbaProject", "vbaProject.bin")],
        extra_overrides=[("/word/vbaProject.bin", "application/vnd.ms-office.vbaProject")],
    ),
    "doc030-external-link.docx": package(
        [para("Signed by {{counterparty_name}}.")],
        extra_rels=[("rTpl", "http://schemas.openxmlformats.org/officeDocument/2006/relationships/attachedTemplate", "https://example.com/doc-030-template.dotx", "External")],
    ),
    "doc030-includetext-field.docx": package(
        [],
        raw_body=(
            para("Signed by {{counterparty_name}}.")
            + '<w:p><w:fldSimple w:instr=" INCLUDETEXT &quot;https://example.com/doc-030-clause.docx&quot; "><w:r><w:t>clause</w:t></w:r></w:fldSimple></w:p>'
        ),
    ),
    "doc030-expands-past-32mib.docx": package(
        [para("Signed by {{counterparty_name}}.")],
        extra_parts={"word/media/filler.bin": "0" * (33 * 1024 * 1024)},
    ),
}

if __name__ == "__main__":
    for name, data in FIXTURES.items():
        (HERE / name).write_bytes(data)
        print(f"{name}: {len(data)} bytes")
