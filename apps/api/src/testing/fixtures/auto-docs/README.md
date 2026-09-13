# Auto-Doc detection fixtures

Use these Word OOXML packages, based on the existing document-engine plain fixture.
Read each document body for its case. Open the checked-in `.docx` files in tests.

- `plain`: repeated Placeholders and document order.
- `split`: one Placeholder split across runs and spell-check markers.
- `blocks`: two named Blocks and their Placeholders.
- `formatting`: bold and italic runs, a hyperlink, and a table.
- `unclosed-brace`, `unclosed-block`, `invalid-slug`, `unopened-block`: upload refusals.
