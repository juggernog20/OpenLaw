// V-C56 steps for "Write an Auto-Doc template" (docs/user-guides/auto-doc-template.md), DOC-032.
// Written by the DOC-032 independent walkthrough agent (records). Ported from the DOC-030
// admin-config walkthrough.mjs autoDocSection. New in DOC-032: the Upload version dialog (drop
// zone, Choose file, file name and size, Change file, Remove file, the single-.docx refusal, the
// report with Placeholders detected, Blocks detected, fields created and orphaned fields, Done),
// field settings edited under the row's "Edit <label>" control, and Clause rules written under
// "Edit the rule for <Block>", including one box per value for Is one of on a date field.
// Each role creates its own Auto-Docs named "DOC-032 records V-C56 ... <stamp>". Fixture Word
// files are fictional and live in ./fixtures (built by the DOC-030 build-fixtures.py, renamed).
import path from "node:path";
import os from "node:os";
import { mkdtempSync, rmSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { must as expectThat, q, sleep as pause, BASE } from "./lib.mjs";

const flat = (s) => (s ?? "").replace(/\s+/g, " ").trim();

export default async function autoDocTemplate(ctx) {
  const role = ctx.role;
  const SC = "V-C56";
  const SHOTS = ctx.here;
  const fixture = (n) => path.join(ctx.here, "fixtures", n.replace(/^doc030-/, "doc032-records-"));
  const name = (scenario, what) => `DOC-032 records ${scenario} ${what} ${ctx.stamp}`;
  const record = (kind, value, extra = {}) => ctx.record({ what: kind, name: value, ...extra });
  const page = (await ctx.session(role)).page;
  ctx.setPage(page);
  const step = (scenario, r, action, expected, fn) => ctx.step(action, expected, fn, { page });

  function adTab(p, label) {
    return p
      .getByRole("navigation", { name: "Auto-Doc sections" })
      .getByRole("link", { name: label });
  }
  async function openUpload(p) {
    await p.getByRole("button", { name: "Upload version" }).click();
    const dialog = p.getByRole("dialog", { name: "Upload version" });
    await dialog.waitFor();
    return dialog;
  }
  async function chooseFiles(p, dialog, files) {
    const [chooser] = await Promise.all([
      p.waitForEvent("filechooser"),
      dialog.getByRole("button", { name: /^(Choose file|Change file)$/ }).click(),
    ]);
    await chooser.setFiles(files);
  }
  async function uploadRefused(p, file) {
    const dialog = await openUpload(p);
    await chooseFiles(p, dialog, file);
    await dialog.getByRole("button", { name: "Upload", exact: true }).click();
    const alert = dialog.getByRole("alert");
    await alert.waitFor({ timeout: 30000 });
    const text = flat(await alert.textContent());
    const report = await dialog.getByText(/^File version \d+ uploaded$/).count();
    await dialog.getByRole("button", { name: "Cancel" }).click();
    await dialog.waitFor({ state: "hidden" });
    expectThat(report === 0, `a refused upload showed a report`);
    return text;
  }
  async function uploadReport(p, file) {
    const dialog = await openUpload(p);
    await chooseFiles(p, dialog, file);
    await dialog.getByRole("button", { name: "Upload", exact: true }).click();
    const status = dialog.getByRole("status").filter({ hasText: /uploaded/ });
    await status.waitFor({ timeout: 30000 });
    const report = flat(await status.textContent());
    const headline = flat(await status.getByText(/^File version \d+ uploaded$/).textContent());
    const counts = await status
      .locator("p.text-lg")
      .evaluateAll((els) => els.map((e) => e.textContent.trim()));
    await dialog.getByRole("button", { name: "Done" }).click();
    await dialog.waitFor({ state: "hidden" });
    return { report, headline, placeholders: Number(counts[0]), blocks: Number(counts[1]) };
  }
  async function adFields(p) {
    const labels = await p
      .getByRole("button", { name: /^Edit / })
      .evaluateAll((els) => els.map((e) => e.getAttribute("aria-label")));
    return labels.filter((l) => !/^Edit the rule for /.test(l)).map((l) => l.replace(/^Edit /, ""));
  }
  async function pill(p) {
    return flat(
      await p
        .getByText(/^File version \d+$/)
        .first()
        .textContent(),
    );
  }
  /** Opens a field's editor with its row's Edit <label> control and returns the region. */
  async function editField(p, label) {
    const control = p.getByRole("button", { name: `Edit ${label}`, exact: true });
    if ((await control.getAttribute("aria-expanded")) !== "true") await control.click();
    const region = p.getByRole("region", { name: label, exact: true });
    await region.waitFor();
    return region;
  }
  async function closeField(p, label) {
    const control = p.getByRole("button", { name: `Edit ${label}`, exact: true });
    if ((await control.getAttribute("aria-expanded")) === "true") await control.click();
  }
  const adName = name(SC, `${role === "administrator" ? "Admin" : "Member"} Services Agreement`);
  let base = null;

  await step(
    SC,
    role,
    "Download a starter template: Download starter template (.docx) beside the page title on Auto-Docs",
    "A Word file downloads with an instruction page (placeholders, bold, underline, italic, capitals, three date formats, currency, blocks) and an example services agreement with five fields and a confidentiality block.",
    async () => {
      await page.goto(`${BASE}/`);
      await page
        .getByRole("navigation", { name: "Primary" })
        .getByRole("link", { name: "Auto-Docs" })
        .click();
      await page.getByRole("heading", { name: "Auto-Docs", level: 1 }).waitFor();
      const [download] = await Promise.all([
        page.waitForEvent("download"),
        page.getByRole("link", { name: "Download starter template (.docx)" }).click(),
      ]);
      const dir = mkdtempSync(path.join(os.tmpdir(), "doc032-records-starter-"));
      const file = path.join(dir, download.suggestedFilename());
      await download.saveAs(file);
      const xml = execFileSync("unzip", ["-p", file, "word/document.xml"]).toString();
      rmSync(dir, { recursive: true, force: true });
      const text = xml
        .replace(/<w:br[^>]*w:type="page"[^>]*\/>/g, "\n[PAGE BREAK]\n")
        .replace(/<\/w:p>/g, "\n")
        .replace(/<[^>]+>/g, "");
      const placeholders = [...new Set([...text.matchAll(/\{\{([^}]+)\}\}/g)].map((m) => m[1]))];
      const pageBreak = /\[PAGE BREAK\]/.test(text);
      const agreement = text.slice(text.indexOf("[PAGE BREAK]"));
      const agreementNames = [
        ...new Set(
          [...agreement.matchAll(/\{\{([a-z][a-z0-9_]*)(?:\|[^}]*)?\}\}/g)].map((m) => m[1]),
        ),
      ];
      const has = (re) => placeholders.some((p) => re.test(p));
      expectThat(
        pageBreak &&
          has(/\|bold$/) &&
          has(/\|underline$/) &&
          has(/\|italic$/) &&
          has(/\|upper$/) &&
          has(/date:YYYY-MM-DD/) &&
          has(/date:DD\/MM\/YYYY/) &&
          has(/date:MMMM D, YYYY/) &&
          has(/currency:/) &&
          has(/^#block/),
        `starter placeholders ${q(placeholders)}`,
      );
      expectThat(
        agreementNames.length === 5 && /\{\{#block confidentiality/.test(agreement),
        `agreement names ${q(agreementNames)}`,
      );
      return `Primary navigation > Auto-Docs showed the link "Download starter template (.docx)" beside the title; it downloaded ${q(download.suggestedFilename())} (saved outside the repository and deleted). The file has a page break; the instruction page shows ${q([...new Set([...text.slice(0, text.indexOf("[PAGE BREAK]")).matchAll(/\{\{([^}]+)\}\}/g)].map((m) => m[1]))])}; the agreement after the break uses ${q(agreementNames)} and a confidentiality Block.`;
    },
  );

  await step(
    SC,
    role,
    "Before you start: open Auto-Docs, create an Auto-Doc, open its Form section; the file shows on the left and the form on the right; Upload version",
    "The Form section shows an empty template pane beside the form and an Upload version button.",
    async () => {
      await page.getByRole("button", { name: "Create Auto-Doc" }).first().click();
      const dialog = page.getByRole("dialog");
      await dialog.getByLabel("Name").fill(adName);
      await dialog.getByRole("button", { name: "Create", exact: true }).click();
      await page.waitForURL(/\/auto-docs\/[0-9a-f-]+/, { timeout: 20000 });
      base = page
        .url()
        .replace(/\/(overview|form|settings)?$/, "")
        .match(/.*\/auto-docs\/[0-9a-f-]+/)[0];
      record("auto-doc", adName, { role });
      await adTab(page, "Form").click();
      await page.waitForURL(/\/form$/);
      const empty = flat(
        await page.getByText("Upload a Word file to start the form.").textContent(),
      );
      expectThat(
        await page.getByRole("button", { name: "Upload version" }).isVisible(),
        "no Upload version",
      );
      return `Create Auto-Doc > Name > Create made ${q(adName)} and opened ${new URL(base).pathname}. The Form section reads ${q(empty)} with Upload version.`;
    },
  );

  await step(
    SC,
    role,
    "Upload a new version, steps 1-2: Upload version opens on a drop zone; Choose file shows the file name and size; Change file and Remove file pick again; more than one file or a non-.docx file shows Choose a single Word document (.docx). and keeps no file",
    "The dialog shows Drop your Word template here and Choose file; a PDF and two dropped files each show the refusal with no file kept and Upload disabled; a .docx shows its name and size with Change file and Remove file; Remove file returns to Choose file.",
    async () => {
      const dialog = await openUpload(page);
      const drop = flat(await dialog.getByText("Drop your Word template here").textContent());
      const format = flat(await dialog.getByText("One .docx file").textContent());
      const chooseLabel = flat(
        await dialog.getByRole("button", { name: /^(Choose file|Change file)$/ }).textContent(),
      );
      const uploadDisabledEmpty = await dialog
        .getByRole("button", { name: "Upload", exact: true })
        .isDisabled();
      await chooseFiles(page, dialog, fixture("doc032-records-register-extract.pdf"));
      const pdfAlert = flat(await dialog.getByRole("alert").textContent());
      const pdfKept = await dialog.getByText("doc032-records-register-extract.pdf").count();
      const uploadDisabledPdf = await dialog
        .getByRole("button", { name: "Upload", exact: true })
        .isDisabled();
      await chooseFiles(page, dialog, fixture("doc032-records-services-v1.docx"));
      const fileName = await dialog
        .getByText("doc032-records-services-v1.docx", { exact: true })
        .count();
      const cardText = flat(
        await dialog
          .getByText("doc032-records-services-v1.docx", { exact: true })
          .locator("xpath=..")
          .textContent(),
      );
      const alertAfterDocx = await dialog.getByRole("alert").count();
      const changeLabel = flat(
        await dialog.getByRole("button", { name: /^(Choose file|Change file)$/ }).textContent(),
      );
      // Two files dropped on the drop zone at once.
      await dialog.getByText("Drop your Word template here").evaluate((el) => {
        const zone = el.closest("div.border-dashed");
        const dt = new DataTransfer();
        for (const n of ["a.docx", "b.docx"])
          dt.items.add(
            new File(["x"], n, {
              type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
            }),
          );
        zone.dispatchEvent(
          new DragEvent("drop", { dataTransfer: dt, bubbles: true, cancelable: true }),
        );
      });
      const twoAlert = flat(await dialog.getByRole("alert").textContent());
      const twoKept = await dialog
        .getByText("doc032-records-services-v1.docx", { exact: true })
        .count();
      await chooseFiles(page, dialog, fixture("doc032-records-services-v1.docx"));
      await dialog.getByRole("button", { name: "Remove file" }).click();
      const removed = await dialog
        .getByText("doc032-records-services-v1.docx", { exact: true })
        .count();
      const backLabel = flat(
        await dialog.getByRole("button", { name: /^(Choose file|Change file)$/ }).textContent(),
      );
      await dialog.getByRole("button", { name: "Cancel" }).click();
      await dialog.waitFor({ state: "hidden" });
      const refusal = "Choose a single Word document (.docx).";
      expectThat(
        chooseLabel === "Choose file" &&
          uploadDisabledEmpty &&
          pdfAlert === refusal &&
          pdfKept === 0 &&
          uploadDisabledPdf &&
          fileName === 1 &&
          /KB|bytes|B\b/.test(cardText) &&
          alertAfterDocx === 0 &&
          changeLabel === "Change file" &&
          twoAlert === refusal &&
          twoKept === 0 &&
          removed === 0 &&
          backLabel === "Choose file",
        q({
          chooseLabel,
          uploadDisabledEmpty,
          pdfAlert,
          pdfKept,
          fileName,
          cardText,
          changeLabel,
          twoAlert,
          twoKept,
          removed,
          backLabel,
        }),
      );
      return `Upload version opened a dialog titled "Upload version" on a drop zone reading ${q(drop)} / ${q(format)} with ${q(chooseLabel)}; Upload was disabled. Choosing a PDF showed ${q(pdfAlert)} and kept no file (Upload disabled). Choosing doc032-records-services-v1.docx showed ${q(cardText)} and the button became ${q(changeLabel)}. Dropping two .docx files at once showed ${q(twoAlert)} and kept no file. After choosing the .docx again, Remove file cleared it and the button read ${q(backLabel)}. Cancel closed the dialog.`;
    },
  );

  await step(
    SC,
    role,
    "Upload the file with Placeholders, directives (bold, italic, underline, upper, dates, currency) and one Block; read the template pane",
    "The upload reports the counts; the pane marks every Placeholder and Block in body, header, footer, footnote and endnote; new fields follow the pane order, body first; directives set the field types.",
    async () => {
      const up = await uploadReport(page, fixture("doc032-records-services-v1.docx"));
      const report = up.report;
      await page.getByRole("heading", { name: "doc032-records-services-v1.docx" }).waitFor();
      const summary = flat(
        await page
          .getByText(/\d+ Placeholders?, \d+ Blocks?/)
          .first()
          .textContent(),
      );
      const parts = {};
      for (const n of ["Body", "Header", "Footer", "Footnotes", "Endnotes"]) {
        const sec = page.locator(`section[aria-label="${n}"]`);
        parts[n] = (await sec.count())
          ? await sec
              .getByRole("button", { name: /^Placeholder / })
              .evaluateAll((els) =>
                els.map((e) => e.getAttribute("aria-label").replace(/^Placeholder /, "")),
              )
          : null;
      }
      const partOrder = await page
        .locator("section[aria-label]")
        .evaluateAll((els) =>
          els
            .map((e) => e.getAttribute("aria-label"))
            .filter((l) => ["Body", "Header", "Footer", "Footnotes", "Endnotes"].includes(l)),
        );
      const block = flat(
        await page.getByRole("button", { name: "Block arbitration" }).textContent(),
      );
      const fields = await adFields(page);
      const types = {};
      for (const [slug, label] of [
        ["fee_amount", "Fee amount"],
        ["signing_date", "Signing date"],
        ["provider_contact", "Provider contact"],
        ["governing_law", "Governing law"],
        ["client_matter", "Client matter"],
      ]) {
        await page
          .getByRole("button", { name: `Placeholder ${slug}`, exact: true })
          .or(page.getByRole("button", { name: new RegExp(`^Placeholder ${slug}\\|`) }))
          .first()
          .click();
        types[slug] = flat(
          await page
            .getByRole("region", { name: label })
            .getByLabel("Type")
            .locator("option:checked")
            .innerText(),
        );
      }
      expectThat(
        up.headline === "File version 1 uploaded" &&
          /Placeholders detected/.test(report) &&
          /Blocks detected/.test(report) &&
          up.blocks === 1 &&
          /form fields? created\./.test(report),
        `report ${q(up)}`,
      );
      expectThat(
        partOrder[0] === "Body" &&
          parts.Header?.length &&
          parts.Footer?.length &&
          parts.Footnotes?.length &&
          parts.Endnotes?.length,
        `parts ${q(parts)}`,
      );
      expectThat(
        types.fee_amount === "Currency" &&
          types.signing_date === "Date" &&
          types.provider_contact === "Text" &&
          types.governing_law === "Text",
        `types ${q(types)}`,
      );
      expectThat(
        fields.indexOf("Client matter") > fields.indexOf("Arbitration seat") &&
          fields.indexOf("Schedule number") > fields.indexOf("Arbitration seat"),
        `order ${q(fields)}`,
      );
      if (role === "administrator")
        await ctx.shot(page, "auto-doc-template-admin-template-pane.png");
      return `Choose file, doc032-records-services-v1.docx, Upload: the report read ${q(report)} (${up.placeholders} Placeholders detected, ${up.blocks} Blocks detected), then Done. Pane summary ${q(summary)}; parts in order ${q(partOrder)} with chips ${q(parts)}. Block tag ${q(block)}. Fields in order ${q(fields)} (body first). Types: ${q(types)}; the header {{counterparty_name|upper}} and the bold, italic and underline Placeholders uploaded without refusal.`;
    },
  );

  await step(
    SC,
    role,
    "Mark a Placeholder: select Edit followed by the field's label in its row under Fields (Edit Counterparty name); the editor opens under that row with Label, Type and Help text (and Template placeholder); select the same control again to close it",
    "Edit Counterparty name expands an editor directly under that row; changing Label renames the row and its control; Help text saves; the same control closes the editor.",
    async () => {
      await closeField(page, "Counterparty name").catch(() => {});
      const control = page.getByRole("button", { name: "Edit Counterparty name", exact: true });
      const expandedBefore = await control.getAttribute("aria-expanded");
      await control.click();
      const card = page.getByRole("region", { name: "Counterparty name", exact: true });
      await card.waitFor();
      const expanded = await control.getAttribute("aria-expanded");
      const controlled = await control.getAttribute("aria-controls");
      const underRow = await card.evaluate((region, ctl) => {
        const row = document.querySelector(`[aria-label="${ctl}"]`)?.closest("li");
        return !!row && row.contains(region);
      }, "Edit Counterparty name");
      const controls = [];
      for (const l of ["Label", "Template placeholder", "Type", "Help text"])
        controls.push(`${l}:${await card.getByLabel(l, { exact: true }).count()}`);
      const tp = await card.getByLabel("Template placeholder", { exact: true }).inputValue();
      await card.getByLabel("Label", { exact: true }).fill("Counterparty legal name");
      await card.getByLabel("Label", { exact: true }).press("Enter");
      const renamed = page.getByRole("region", { name: "Counterparty legal name", exact: true });
      await renamed.waitFor({ timeout: 15000 });
      await renamed.getByLabel("Help text").fill("Use the registered company name.");
      await renamed.getByLabel("Help text").press("Enter");
      await pause(1200);
      const listed = await adFields(page);
      const renamedControl = page.getByRole("button", {
        name: "Edit Counterparty legal name",
        exact: true,
      });
      await renamedControl.click();
      await renamed.waitFor({ state: "hidden" });
      const closed = await renamedControl.getAttribute("aria-expanded");
      await page.reload();
      await renamedControl.waitFor();
      const help = await (
        await editField(page, "Counterparty legal name")
      )
        .getByLabel("Help text")
        .inputValue();
      await closeField(page, "Counterparty legal name");
      expectThat(
        expandedBefore !== "true" &&
          expanded === "true" &&
          underRow &&
          controls.every((c) => c.endsWith(":1")) &&
          tp === "counterparty_name" &&
          listed.includes("Counterparty legal name") &&
          closed !== "true" &&
          help === "Use the registered company name.",
        q({ expandedBefore, expanded, controlled, underRow, controls, tp, listed, closed, help }),
      );
      return `Under Fields, the row control "Edit Counterparty name" (aria-expanded ${expandedBefore}) opened an editor inside that row (aria-expanded ${expanded}, under the row: ${underRow}) with ${q(controls)}; Template placeholder reads ${q(tp)}. Label "Counterparty legal name" + Enter renamed the row and its control (Fields ${q(listed.slice(0, 4))}…); Help text saved and read ${q(help)} after a reload. Selecting "Edit Counterparty legal name" again closed the editor (aria-expanded ${closed}).`;
    },
  );

  await step(
    SC,
    role,
    "Mark a Block: under Clauses select Edit the rule for arbitration; the editor opens under that row; choose When a rule matches, then Form field, Operator and value; Is one of on a date field takes one box per value with Add value and Remove value N; a Block with no rule is always included",
    "Clauses says a Block with no rule is always included and the row reads Always included; the rule editor opens under the row; Equals on Governing law saves and the row reads Included when …; Is one of on Signing date shows Values with Value 1, Add value adds Value 2 and 3, Remove value 2 deletes one, and the rule saves both remaining dates.",
    async () => {
      const note = flat(
        await page.getByText("A Block with no rule is always included.").textContent(),
      );
      const control = page.getByRole("button", {
        name: "Edit the rule for arbitration",
        exact: true,
      });
      const rowBefore = flat(await control.locator("xpath=ancestor::li[1]").innerText());
      await control.click();
      const card = page.getByRole("region", { name: "arbitration", exact: true });
      await card.waitFor();
      const underRow = await card.evaluate((region) =>
        Boolean(
          document
            .querySelector('[aria-label="Edit the rule for arbitration"]')
            ?.closest("li")
            ?.contains(region),
        ),
      );
      const include = (await card.getByLabel("Include").locator("option").allInnerTexts()).map(
        flat,
      );
      await card.getByLabel("Include").selectOption({ label: "When a rule matches" });
      await card.getByLabel("Form field").selectOption({ label: "Governing law" });
      const ops = (await card.getByLabel("Operator").locator("option").allInnerTexts()).map(flat);
      await card.getByLabel("Operator").selectOption({ label: "Equals" });
      await card.getByLabel("Value").fill("England and Wales");
      await card.getByLabel("Value").press("Tab");
      await pause(1500);
      const rowEquals = flat(await control.locator("xpath=ancestor::li[1]").innerText());
      // Is one of on a date field: one box per value.
      await card.getByLabel("Form field").selectOption({ label: "Signing date" });
      await card.getByLabel("Operator").selectOption({ label: "Is one of" });
      const values = card.getByRole("group", { name: "Values" });
      await values.waitFor();
      const firstBoxes = await values.getByRole("textbox").or(values.locator("input")).count();
      const removeDisabled = await values
        .getByRole("button", { name: "Remove value 1" })
        .isDisabled();
      await values.getByLabel("Value 1", { exact: true }).fill("2026-01-15");
      await values.getByRole("button", { name: "Add value" }).click();
      await values.getByLabel("Value 2", { exact: true }).fill("2026-02-15");
      await values.getByRole("button", { name: "Add value" }).click();
      await values.getByLabel("Value 3", { exact: true }).fill("2026-03-15");
      await values.getByRole("button", { name: "Remove value 2" }).click();
      const remaining = await values.locator("input").evaluateAll((els) => els.map((e) => e.value));
      await card.getByLabel("Include").focus();
      await page.getByRole("heading", { name: "Clauses" }).first().click();
      await pause(1500);
      const rowOneOf = flat(await control.locator("xpath=ancestor::li[1]").innerText());
      // Put the rule back on Governing law so the later steps keep a simple rule.
      await card.getByLabel("Form field").selectOption({ label: "Governing law" });
      await card.getByLabel("Operator").selectOption({ label: "Equals" });
      await card.getByLabel("Value").fill("England and Wales");
      await card.getByLabel("Value").press("Tab");
      await pause(1500);
      await control.click();
      await card.waitFor({ state: "hidden" });
      expectThat(
        /Always included/.test(rowBefore) &&
          underRow &&
          q(include) === q(["Always", "When a rule matches"]) &&
          /Included when/.test(rowEquals) &&
          /England and Wales/.test(rowEquals) &&
          firstBoxes === 1 &&
          removeDisabled &&
          q(remaining) === q(["2026-01-15", "2026-03-15"]) &&
          /Included when/.test(rowOneOf) &&
          /Signing date/.test(rowOneOf),
        q({
          rowBefore,
          underRow,
          include,
          ops,
          rowEquals,
          firstBoxes,
          removeDisabled,
          remaining,
          rowOneOf,
        }),
      );
      return `Clauses reads ${q(note)}; the arbitration row read ${q(rowBefore)}. "Edit the rule for arbitration" opened an editor inside that row (${underRow}). Include offered ${q(include)}; Operator offered ${q(ops)}. When a rule matches / Governing law / Equals / "England and Wales" saved and the row read ${q(rowEquals)}. With Form field Signing date and Is one of, a Values group showed ${firstBoxes} box (Value 1, its Remove value 1 disabled); Add value added Value 2 and Value 3; Remove value 2 left ${q(remaining)}; leaving the rule saved it and the row read ${q(rowOneOf)}. The rule was set back to Governing law Equals "England and Wales" and the same control closed the editor.`;
    },
  );

  await step(
    SC,
    role,
    "Negative: an unclosed Block, an unclosed brace, a bad name, an unknown directive, an unknown currency code and two directives on one Placeholder are refused and quote the text",
    "Each upload is refused with the offending text quoted; no file version is written.",
    async () => {
      const out = {};
      for (const [f, re] of [
        ["doc032-records-unclosed-block.docx", /#block arbitration/],
        ["doc032-records-unclosed-brace.docx", /\{\{counterparty_name/],
        ["doc032-records-bad-name.docx", /Counterparty-Name/],
        ["doc032-records-bad-directive.docx", /lower/],
        ["doc032-records-bad-currency.docx", /ZZZ/],
        ["doc032-records-two-directives-one-placeholder.docx", /upper\|bold|counterparty_name/],
      ]) {
        out[f] = await uploadRefused(page, fixture(f));
        expectThat(re.test(out[f]), `${f}: ${out[f]}`);
      }
      const p = await pill(page);
      expectThat(p === "File version 1", `pill ${p}`);
      return `Refusals: ${Object.entries(out)
        .map(([f, t]) => `${f}: ${q(t)}`)
        .join("; ")}. The pane still reads ${q(p)}.`;
    },
  );

  await step(
    SC,
    role,
    "Negative: a macro, a non-hyperlink external link, an INCLUDETEXT field and a package that expands past 32 MiB are refused with the reason named",
    "Each upload is refused and the refusal names the reason; no file version is written.",
    async () => {
      const out = {};
      for (const [f, re] of [
        ["doc032-records-macro.docx", /macro/i],
        ["doc032-records-external-link.docx", /external .*link.*Only hyperlinks/i],
        ["doc032-records-includetext-field.docx", /INCLUDETEXT/],
        ["doc032-records-expands-past-32mib.docx", /32 MiB/],
      ]) {
        out[f] = await uploadRefused(page, fixture(f));
        expectThat(re.test(out[f]), `${f}: ${out[f]}`);
      }
      const p = await pill(page);
      expectThat(p === "File version 1", `pill ${p}`);
      return `Refusals: ${Object.entries(out)
        .map(([f, t]) => `${f}: ${q(t)}`)
        .join(
          "; ",
        )}. The pane still reads ${q(p)}. Fixtures are fictional files built by the DOC-030 build-fixtures.py and renamed.`;
    },
  );

  await step(
    SC,
    role,
    "Negative: Publish refuses a field whose type cannot print its directive and names it (currency directive on a Text field)",
    "Publish shows a refusal naming the field and the Placeholder; the Auto-Doc stays Draft.",
    async () => {
      await page
        .getByRole("button", { name: "Placeholder fee_amount|currency:USD", exact: true })
        .or(page.getByRole("button", { name: "Placeholder fee_amount", exact: true }))
        .first()
        .click();
      const card = page.getByRole("region", { name: "Fee amount" });
      await card.getByLabel("Type").selectOption({ label: "Text" });
      await pause(1200);
      await page.getByRole("button", { name: "Publish", exact: true }).first().click();
      const dialog = page.getByRole("dialog", { name: "Publish" });
      await dialog.getByRole("button", { name: "Publish", exact: true }).click();
      const alert = dialog.getByRole("alert");
      await alert.waitFor({ timeout: 15000 });
      const text = flat(await alert.textContent());
      await dialog.getByRole("button", { name: "Cancel" }).click();
      await dialog.waitFor({ state: "hidden" });
      await card.getByLabel("Type").selectOption({ label: "Currency" });
      await pause(1200);
      expectThat(
        /Fee amount/.test(text) && /fee_amount\|currency:USD/.test(text),
        `refusal ${text}`,
      );
      return `With Fee amount set to Text, Publish refused with ${q(text)}. Type was set back to Currency.`;
    },
  );

  await step(
    SC,
    role,
    "Upload a new version that drops a Placeholder: the orphaned field stays, marked No Placeholder in file version N; a new Placeholder gets a new field",
    "The report reads File version 2 uploaded with the counts and 1 field no longer has a placeholder in this file. Your existing fields have been kept for review.; Signing date stays with the mark; Notice address is added.",
    async () => {
      const up = await uploadReport(page, fixture("doc032-records-services-v2.docx"));
      const report = up.report;
      await page.getByRole("heading", { name: "doc032-records-services-v2.docx" }).waitFor();
      const p = await pill(page);
      const mark = flat(
        await page
          .getByText(/^No Placeholder in file version \d+$/)
          .first()
          .textContent(),
      );
      const fields = await adFields(page);
      expectThat(
        fields.includes("Signing date") &&
          fields.includes("Notice address") &&
          mark === "No Placeholder in file version 2" &&
          up.headline === "File version 2 uploaded" &&
          /1 field no longer has a placeholder in this file\. Your existing fields have been kept for review\./.test(
            report,
          ),
        `fields ${q(fields)} mark ${mark}`,
      );
      if (role === "legal_team_member")
        await ctx.shot(page, "auto-doc-template-member-orphaned-field.png");
      return `Report ${q(report)}; pane ${q(p)}. Fields ${q(fields)}; the Signing date row reads ${q(mark)}.`;
    },
  );

  await step(
    SC,
    role,
    "Publish pins one file version and one form version together; later edits change nothing live until you publish again",
    "The Publish dialog offers file and form versions; after Publish the state is Published; a later edit leaves the live pair and Overview warns that a newer version exists.",
    async () => {
      await page.getByRole("button", { name: "Publish", exact: true }).first().click();
      const dialog = page.getByRole("dialog", { name: "Publish" });
      const files = (await dialog.getByLabel("File version").locator("option").allInnerTexts()).map(
        flat,
      );
      const forms = (await dialog.getByLabel("Form version").locator("option").allInnerTexts()).map(
        flat,
      );
      const caption = flat(
        await dialog.getByText(/Later edits leave this pair unchanged/).textContent(),
      );
      await dialog.getByLabel("File version").selectOption({ label: "File version 2" });
      await dialog.getByRole("button", { name: "Publish", exact: true }).click();
      let refusal = null;
      await dialog.waitFor({ state: "hidden", timeout: 15000 }).catch(async () => {
        refusal = flat(
          await dialog
            .getByRole("alert")
            .textContent()
            .catch(() => ""),
        );
      });
      if (refusal !== null) {
        // The orphaned field may block Publish: remove it (the guide: remove the field or put the Placeholder back).
        await dialog.getByRole("button", { name: "Cancel" }).click();
        await page.getByRole("button", { name: "Remove Signing date", exact: true }).click();
        await pause(1500);
        await page.getByRole("button", { name: "Publish", exact: true }).first().click();
        await dialog.getByLabel("File version").selectOption({ label: "File version 2" });
        await dialog.getByRole("button", { name: "Publish", exact: true }).click();
        await dialog.waitFor({ state: "hidden", timeout: 15000 });
      }
      await page.getByText("Published", { exact: true }).first().waitFor({ timeout: 15000 });
      await adTab(page, "Overview").click();
      const live = flat(await page.getByText(/^Live since /).textContent());
      await adTab(page, "Form").click();
      await page
        .getByRole("button", { name: "Placeholder governing_law", exact: true })
        .first()
        .click();
      const card = page.getByRole("region", { name: "Governing law" });
      await card.getByLabel("Help text").fill("Name the jurisdiction.");
      await card.getByLabel("Help text").press("Enter");
      await pause(1200);
      await adTab(page, "Overview").click();
      const liveAfter = flat(await page.getByText(/^Live since /).textContent());
      const newer = flat(await page.getByText(/newer than the currently published/).textContent());
      expectThat(live === liveAfter, `live changed ${live} -> ${liveAfter}`);
      return `Publish offered file versions ${q(files)} and form versions ${q(forms)} with caption ${q(caption)}${refusal ? `; the first Publish with the orphaned field showed ${q(refusal)}, so Remove Signing date was used as the guide says, then Publish succeeded` : ""}. After Publish with File version 2 the state reads Published and Overview reads ${q(live)}. A later Help text edit left ${q(liveAfter)} and Overview warns ${q(newer)}.`;
    },
  );

  await step(
    SC,
    role,
    "Directive disagreement: one name with a date directive and a currency directive becomes a text field, and Publish names the gap",
    "The new field is Text; Publish refuses and names the Placeholder.",
    async () => {
      await page.goto(`${BASE}/auto-docs`);
      await page.getByRole("button", { name: "Create Auto-Doc" }).first().click();
      const dialog = page.getByRole("dialog");
      const n2 = name(
        SC,
        `${role === "administrator" ? "Admin" : "Member"} disagreeing directives`,
      );
      await dialog.getByLabel("Name").fill(n2);
      await dialog.getByRole("button", { name: "Create", exact: true }).click();
      await page.waitForURL(/\/auto-docs\/[0-9a-f-]+/, { timeout: 20000 });
      record("auto-doc", n2, { role });
      await adTab(page, "Form").click();
      const { report } = await uploadReport(
        page,
        fixture("doc032-records-disagreeing-directives.docx"),
      );
      await page
        .getByRole("button", { name: /^Placeholder payment/ })
        .first()
        .click();
      const type = flat(
        await page
          .getByRole("region", { name: "Payment" })
          .getByLabel("Type")
          .locator("option:checked")
          .innerText(),
      );
      await page.getByRole("button", { name: "Publish", exact: true }).first().click();
      const pub = page.getByRole("dialog", { name: "Publish" });
      await pub.getByRole("button", { name: "Publish", exact: true }).click();
      const alert = pub.getByRole("alert");
      await alert.waitFor({ timeout: 15000 });
      const text = flat(await alert.textContent());
      await pub.getByRole("button", { name: "Cancel" }).click();
      expectThat(type === "Text" && /payment\|/.test(text), `type ${type}, refusal ${text}`);
      return `${q(n2)}: upload of {{payment|currency:USD}} and {{payment|date:YYYY-MM-DD}} reported ${q(report)}; the Payment field's Type is ${q(type)}. Publish refused with ${q(text)}.`;
    },
  );

  // Archive this role's Auto-Docs so they leave the live list.
  const list = (await ctx.api(page, "GET", "/auto-docs")).json;
  const rows = (list?.autoDocs ?? list?.items ?? []).filter(
    (a) => a.name?.startsWith("DOC-032 records V-C56") && a.name.endsWith(ctx.stamp),
  );
  const archived = [];
  for (const a of rows) {
    const r = await ctx.api(page, "POST", `/auto-docs/${a.id}/archive`, {});
    archived.push(`${a.name}: ${r.status}`);
  }
  await ctx.record({
    what: "V-C56 cleanup",
    how: `POST /auto-docs/:id/archive as ${ctx.account.name}`,
    cleanup: archived.join("; ") || "no Auto-Docs found to archive",
  });
}
