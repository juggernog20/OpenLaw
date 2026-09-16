# Write an Auto-Doc template

An Auto-Doc fills an approved Word file from a form. You write the file in Word, mark the places the form fills, and upload it. OpenLaw reads the markers and builds the form beside the file.

## Before you start

Sign in as a Legal Team Member or Administrator, open **Auto-Docs**, and create an Auto-Doc or open one. The **Form** section shows the file on the left and its form on the right. Upload a `.docx` file with **Upload version**.

## Mark a Placeholder

Type a name in double braces where the answer goes, for example `{{counterparty_name}}`. Start the name with a lowercase letter, then use lowercase letters, digits, and underscores. Keep it to 120 characters. Type a Placeholder in the body, a header, a footer, a footnote, or an endnote. Each new Placeholder gets its own form field on upload, in the order the file on the left shows them. The body comes first, then the other parts. Edit the field's label, type, and help from its card.

## Format a value

Add one directive after a bar to say how the answer prints. A Placeholder takes one directive, not two.

- `{{name|upper}}` prints the answer in capitals.
- `{{signing_date|date:DD/MM/YYYY}}` prints a date answer in that pattern. The three patterns are `YYYY-MM-DD`, `DD/MM/YYYY`, and `MMMM D, YYYY`.
- `{{amount|currency:USD}}` prints the answer with that currency's symbol and separators. Use a three-letter currency code.

A directive also decides the new field's type. A date directive creates a date field, a currency directive creates a currency field, and every other new Placeholder creates a text field. Two directives that disagree on one name create a text field, and Publish then names the gap.

`upper` prints any answer, so it asks nothing of the field. A date directive needs a date field. A currency directive needs a currency or a number field. Publish refuses a field that cannot print its directive and names it.

An upload is refused when a name is not a valid slug, when a directive is not one of the three above, or when a currency code is not one OpenLaw knows. The refusal quotes the text to fix.

## Mark a Block

Wrap a span of text in `{{#block name}}` and `{{/block}}` to make a Block. A Block keeps its own formatting and is included unless a Clause rule leaves it out. Write the rule in the **Form** section: open the Block under **Clauses**, choose **When a rule matches**, and pick the form field, the operator, and the value. A Block with no rule is always included.

Every Block must close. An upload with an open Block, an unclosed brace, or a name that is not a valid slug is refused, and the refusal quotes the text to fix.

## Upload a new version

Each upload adds a file version. A new Placeholder gets a new form field. A field whose Placeholder is gone stays on the form, marked **No Placeholder in file version N**, so a mapped answer is never dropped without you seeing it. Remove the field or put the Placeholder back.

Publish pins one file version and one form version together. Later uploads and edits change nothing live until you publish again.
