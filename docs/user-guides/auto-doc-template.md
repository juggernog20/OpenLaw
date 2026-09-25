# Write an Auto-Doc template

An Auto-Doc fills an approved Word file from a form. You write the file in Word, mark the places the form fills, and upload it. OpenLaw reads the markers and builds the form beside the file.

## Before you start

Sign in as a Legal Team Member or Administrator, open **Auto-Docs**, and create an Auto-Doc or open one. The **Form** section shows the file on the left and its form on the right. Upload a `.docx` file with **Upload version**.

## Download a starter template

On the **Auto-Docs** page, choose **Download starter template (.docx)** beside the page title. The Word file has two pages: plain-English instructions with examples of placeholders, bold, underlined and italic text, capital letters, all three supported date formats, currency formatting and conditional blocks, followed by an example services agreement. Save a copy and delete the instruction page and its page break before uploading it, so the examples in the guide are not treated as template content. The agreement uses five fields (start date, provider name, client name, services and fee) and a confidentiality block. The block is included by default; add a Boolean (Yes/No) field and a rule under **Clauses** if you want the person completing the form to choose whether to include it.

## Mark a Placeholder

Type a name in double braces where the answer goes, for example `{{counterparty_name}}`. Start the name with a lowercase letter, then use lowercase letters, digits, and underscores. Keep it to 120 characters. Type a Placeholder in the body, a header, a footer, a footnote, or an endnote. Each new Placeholder gets its own form field on upload, in the order the file on the left shows them. The body comes first, then the other parts. Edit the field's label, type, and help from its card. **Template placeholder** connects the field to the marker in Word; change it only when matching a different marker.

## Format a value

Add one directive after a bar to say how the answer prints. A Placeholder takes one directive, not two.

- `{{name|bold}}` makes the inserted answer bold.
- `{{name|underline}}` underlines the inserted answer.
- `{{name|italic}}` makes the inserted answer italic.
- `{{name|upper}}` prints the answer in capitals.
- `{{signing_date|date:DD/MM/YYYY}}` prints a date answer in that pattern. The three patterns are `YYYY-MM-DD`, `DD/MM/YYYY`, and `MMMM D, YYYY`.
- `{{amount|currency:USD}}` prints the answer with that currency's symbol and separators. Use a three-letter currency code.

A directive also decides the new field's type. A date directive creates a date field, a currency directive creates a currency field, and every other new Placeholder creates a text field. If one name has a date directive in one place and a currency directive in another, the new field is a text field, and Publish then names the gap.

The bold, underline and italic flags style only the inserted answer and preserve the surrounding Word formatting. These flags and `upper` work with any field type. A date directive needs a date field. A currency directive needs a currency or a number field. Publish refuses a field that cannot print its directive and names it.

An upload is refused when a name does not follow the naming rules above, when a directive is not one of the supported options above, or when a currency code is not one OpenLaw knows. The refusal quotes the text to fix.

OpenLaw also refuses a Word file that holds a macro, a link to content outside the file other than a hyperlink, or a field that pulls in outside content, such as `INCLUDETEXT` or `DDE`. It refuses a file whose contents expand past 32 MiB. The refusal names the reason. Save a clean copy of the file and upload it again.

## Mark a Block

Wrap a span of text in `{{#block name}}` and `{{/block}}` to make a Block. A Block keeps its own formatting and is included unless a Clause rule leaves it out. Write the rule in the **Form** section: open the Block under **Clauses**, choose **When a rule matches**, and pick the form field, the operator, and the value. A Block with no rule is always included.

Every Block must close. An upload with an open Block, an unclosed brace, or a name that does not follow the naming rules above is refused, and the refusal quotes the text to fix.

## Upload a new version

Each upload adds a file version. A new Placeholder gets a new form field. A field whose Placeholder is gone stays on the form, marked **No Placeholder in file version N**, so a mapped answer is never dropped without you seeing it. Remove the field or put the Placeholder back.

Publish pins one file version and one form version together. Later uploads and edits change nothing live until you publish again.
