# Auto-Doc detection and fill fixtures

Use these Word OOXML packages, based on the existing document-engine plain fixture.
Read each document body for its case. Open the checked-in `.docx` files in tests.

- `plain`: repeated Placeholders and document order.
- `split`: one Placeholder split across runs and spell-check markers.
- `blocks`: two named Blocks and their Placeholders.
- `formatting`: bold and italic runs, a hyperlink, and a table.
- `block-formatting`: a conditional Block with bold, colored text and an unconditional Block.
- `directives`: upper case, a day/month/year date, and a USD amount with separators.
- `parts`: styles, numbering, a table, and fixed headers and footers.
- `parts-markers`: the same package with Placeholders in its header, footer, and endnotes.
- `unclosed-brace`, `unclosed-block`, `invalid-slug`, `unopened-block`: upload refusals.
- Use `demo-nda-v1` for the complete M35 demo, then upload `demo-nda-v2` to add a confidentiality-period Placeholder while retaining the arbitration Block.
