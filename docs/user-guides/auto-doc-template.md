# Write an Auto-Doc template

An Auto-Doc fills an approved Word file from a form. You write the file in Word, mark the places the form fills, and upload it. OpenLaw reads the markers and builds the form beside the file.

## Before you start

Sign in as a Legal Team Member or Administrator, open **Auto-Docs**, and create an Auto-Doc or open one. The **Form** section shows the file on the left and its form on the right. Upload a `.docx` file with **Upload version**.

## Mark a Placeholder

Type a name in double braces where the answer goes, for example `{{counterparty_name}}`. Use lowercase letters, digits, and underscores, and start with a letter. Type it anywhere in the document, including headers, footers, and footnotes. The first upload creates one text form field for each new Placeholder, in document order. Edit the field's label, type, and help from its card.

Format a value with a directive after a bar:

- `{{name|upper}}` prints the answer in capitals.
- `{{signing_date|date:DD/MM/YYYY}}` prints a date answer in that pattern.
- `{{amount|currency:USD}}` prints a currency answer with its symbol and separators.

The form field's type must match the directive. Publish refuses a mismatch and names it.

## Mark a Block

Wrap a span of text in `{{#block name}}` and `{{/block}}` to make a Block. A Block keeps its own formatting and is included unless a Clause rule leaves it out. Write the rule in the **Form** section: open the Block under **Clauses**, choose **When a rule matches**, and pick the form field, the operator, and the value. A Block with no rule is always included.

Every Block must close. An upload with an open Block, an unclosed brace, or a name that is not a valid slug is refused, and the refusal quotes the text to fix.

## Upload a new version

Each upload adds a file version. A new Placeholder gets a new form field. A field whose Placeholder is gone stays on the form, marked **No Placeholder in file version N**, so a mapped answer is never dropped without you seeing it. Remove the field or put the Placeholder back.

Publish pins one file version and one form version together. Later uploads and edits change nothing live until you publish again.
