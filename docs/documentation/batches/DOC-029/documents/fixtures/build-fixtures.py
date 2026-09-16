#!/usr/bin/env python3
"""Build the fictional files for the DOC-029 documents walkthrough (round 1).

Needs LibreOffice (soffice) and ImageMagick (magick). Run from any directory:
    python3 build-fixtures.py
All text is fictional. The outputs are written next to this script.
"""
import base64
import os
import shutil
import subprocess
import tempfile
import zipfile

HERE = os.path.dirname(os.path.abspath(__file__))


def out(name):
    return os.path.join(HERE, name)


def soffice_convert(source_name, text, target_ext, filter_name=None):
    work = tempfile.mkdtemp(prefix="doc029-fixtures-")
    profile = tempfile.mkdtemp(prefix="doc029-soffice-profile-")
    try:
        src = os.path.join(work, source_name)
        with open(src, "w", encoding="utf-8") as handle:
            handle.write(text)
        convert_to = target_ext if filter_name is None else f"{target_ext}:{filter_name}"
        subprocess.run(
            [
                "soffice",
                f"-env:UserInstallation=file://{profile}",
                "--headless",
                "--convert-to",
                convert_to,
                "--outdir",
                work,
                src,
            ],
            check=True,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            timeout=180,
        )
        produced = os.path.splitext(src)[0] + "." + target_ext
        shutil.copyfile(produced, out(os.path.splitext(source_name)[0] + "." + target_ext))
    finally:
        shutil.rmtree(work, ignore_errors=True)
        shutil.rmtree(profile, ignore_errors=True)


def html_pages(title, paragraphs, pages=1):
    body = []
    for page in range(pages):
        if page:
            body.append('<p style="page-break-before: always"></p>')
        body.append(f"<h1>{title} page {page + 1}</h1>")
        body.extend(f"<p>{p}</p>" for p in paragraphs)
    return "<html><body>" + "".join(body) + "</body></html>"


def main():
    # A two-page text PDF with one distinctive word for Find in document.
    soffice_convert(
        "doc029-services-text.html",
        html_pages(
            "DOC-029 fictional services agreement",
            [
                "This fictional agreement is between Helix Example Ltd and Northwind Example GmbH.",
                "The service credit clause mentions the word Quillfeather for reader search.",
            ],
            pages=2,
        ),
        "pdf",
    )
    # Two Word rounds of one paper.
    soffice_convert(
        "doc029-draft-v1.html",
        html_pages("DOC-029 fictional supply draft round one", ["Payment terms are thirty days."]),
        "docx",
        "MS Word 2007 XML",
    )
    soffice_convert(
        "doc029-draft-v2.html",
        html_pages("DOC-029 fictional supply draft round two", ["Payment terms are forty-five days."]),
        "docx",
        "MS Word 2007 XML",
    )
    # A PowerPoint deck: HTML to ODT to PDF, then the PDF imported into Impress.
    work = tempfile.mkdtemp(prefix="doc029-pptx-")
    profile = tempfile.mkdtemp(prefix="doc029-soffice-profile-")
    try:
        odg = os.path.join(work, "doc029-deck.html")
        with open(odg, "w", encoding="utf-8") as handle:
            handle.write(html_pages("DOC-029 fictional briefing deck", ["Quarterly legal briefing."]))
        subprocess.run(
            ["soffice", f"-env:UserInstallation=file://{profile}", "--headless", "--convert-to", "odt", "--outdir", work, odg],
            check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=180,
        )
        subprocess.run(
            ["soffice", f"-env:UserInstallation=file://{profile}", "--headless", "--convert-to", "pdf", "--outdir", work, os.path.join(work, "doc029-deck.odt")],
            check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=180,
        )
        subprocess.run(
            ["soffice", f"-env:UserInstallation=file://{profile}", "--headless", "--infilter=impress_pdf_import", "--convert-to", "pptx", "--outdir", work, os.path.join(work, "doc029-deck.pdf")],
            check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=180,
        )
        shutil.copyfile(os.path.join(work, "doc029-deck.pptx"), out("doc029-deck.pptx"))
    finally:
        shutil.rmtree(work, ignore_errors=True)
        shutil.rmtree(profile, ignore_errors=True)

    # A raster image and an image-only scan with one distinctive word for OCR.
    subprocess.run(
        ["magick", "-size", "900x300", "xc:white", "-fill", "black", "-pointsize", "48",
         "-annotate", "+40+160", "DOC-029 fictional stamp", out("doc029-stamp.png")],
        check=True,
    )
    scan_png = out("doc029-scan-page.png")
    subprocess.run(
        ["magick", "-size", "1700x2200", "xc:white", "-fill", "black", "-pointsize", "72",
         "-annotate", "+120+300", "Fictional scanned letter",
         "-annotate", "+120+500", "Marrowbridge warranty notice",
         "-annotate", "+120+700", "Helix Example Ltd",
         "-density", "200", scan_png],
        check=True,
    )
    subprocess.run(["magick", scan_png, "-density", "200", "-units", "PixelsPerInch", out("doc029-scan.pdf")], check=True)
    os.remove(scan_png)

    # An email with a remote image, a PDF attachment and a Word attachment.
    with open(out("doc029-services-text.pdf"), "rb") as handle:
        pdf_b64 = base64.encodebytes(handle.read()).decode("ascii")
    with open(out("doc029-draft-v1.docx"), "rb") as handle:
        docx_b64 = base64.encodebytes(handle.read()).decode("ascii")
    boundary = "doc029-boundary"
    eml = (
        "From: Avery Morgan <avery.morgan@northwind.example>\r\n"
        "To: Nadia Haddad <nadia.haddad@helix.example>\r\n"
        "Subject: DOC-029 fictional counterparty email\r\n"
        "Date: Tue, 15 Sep 2026 09:30:00 +0000\r\n"
        "MIME-Version: 1.0\r\n"
        f'Content-Type: multipart/mixed; boundary="{boundary}"\r\n\r\n'
        f"--{boundary}\r\n"
        "Content-Type: text/html; charset=utf-8\r\n\r\n"
        "<html><body><p>Please find the fictional drafts attached.</p>"
        '<img src="http://remote-images.invalid/doc029-tracker.png" alt="tracker"></body></html>\r\n'
        f"--{boundary}\r\n"
        'Content-Type: application/pdf; name="doc029-attached.pdf"\r\n'
        'Content-Disposition: attachment; filename="doc029-attached.pdf"\r\n'
        "Content-Transfer-Encoding: base64\r\n\r\n"
        f"{pdf_b64}\r\n"
        f"--{boundary}\r\n"
        'Content-Type: application/vnd.openxmlformats-officedocument.wordprocessingml.document; name="doc029-attached.docx"\r\n'
        'Content-Disposition: attachment; filename="doc029-attached.docx"\r\n'
        "Content-Transfer-Encoding: base64\r\n\r\n"
        f"{docx_b64}\r\n"
        f"--{boundary}--\r\n"
    )
    with open(out("doc029-message.eml"), "w", encoding="ascii", newline="") as handle:
        handle.write(eml)

    # Download-only formats.
    with open(out("doc029-schedule.csv"), "w", encoding="utf-8") as handle:
        handle.write("item,amount\nfictional fee,100\n")
    with zipfile.ZipFile(out("doc029-bundle.zip"), "w") as archive:
        info = zipfile.ZipInfo("doc029-readme.txt", date_time=(2026, 9, 16, 0, 0, 0))
        archive.writestr(info, "Fictional bundle.\n")

    # A Word file whose ZIP container is malformed, for a failed preview.
    with open(out("doc029-broken.docx"), "wb") as handle:
        handle.write(b"PK\x03\x04" + b"\x14\x00\x00\x00\x08\x00" + b"DOC-029 malformed container " * 40)

    # Small plain files for bulk import and folder import.
    for name in ["doc029-bulk-a.txt", "doc029-bulk-b.txt", "doc029-bulk-c.txt", "doc029-bulk-d.txt"]:
        with open(out(name), "w", encoding="utf-8") as handle:
            handle.write(f"Fictional bulk import file {name}.\n")


if __name__ == "__main__":
    main()
