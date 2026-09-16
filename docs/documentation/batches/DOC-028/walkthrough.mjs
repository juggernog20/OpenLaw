// Independent V-C56 browser walkthrough for the "Write an Auto-Doc template" guide.
// Written by the Fable independent documentation walkthrough agent from the article text.
// Run from the repository root:
//   LAB_ADMIN_EMAIL=... LAB_ADMIN_PASSWORD=... node docs/documentation/batches/DOC-028/walkthrough.mjs
// Credentials come only from the environment and are never written to the results.
import { createRequire } from "node:module";
import { writeFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "../../../..");
const require = createRequire(path.join(root, "e2e/package.json"));
const { chromium } = require("@playwright/test");

const BASE = process.env.LAB_APP_URL ?? "http://127.0.0.1:43375";
const MAIL = process.env.LAB_MAIL_URL ?? "http://127.0.0.1:43376";
const ADMIN = {
  email: process.env.LAB_ADMIN_EMAIL,
  password: process.env.LAB_ADMIN_PASSWORD,
  displayName: "Blair Wentworth",
};
if (!ADMIN.email || !ADMIN.password)
  throw new Error("LAB_ADMIN_EMAIL and LAB_ADMIN_PASSWORD are required");
const OUT = process.env.OUT ?? path.join(here, `walkthrough-results-${Date.now()}.json`);
const SHOTS = here;
const FIX = path.join(here, "fixtures");
const stamp = Date.now();
const fixture = (name) => path.join(FIX, name);

const results = {
  startedAt: new Date().toISOString(),
  stamp,
  steps: [],
  records: [],
  member: null,
  finishedAt: null,
};
function save() {
  results.finishedAt = new Date().toISOString();
  writeFileSync(OUT, JSON.stringify(results, null, 2));
}

async function step(role, action, fn) {
  const startedAt = new Date().toISOString();
  const entry = {
    role,
    method: "browser-walkthrough",
    action,
    startedAt,
    at: null,
    actual: null,
    result: "not-run",
  };
  results.steps.push(entry);
  try {
    const actual = await fn();
    entry.actual = actual;
    entry.result = "pass";
  } catch (error) {
    entry.actual = `Reviewer check did not complete: ${error instanceof Error ? error.message.split("\n").slice(0, 4).join(" ") : String(error)}`;
    entry.result = "fail";
    console.error(`[${role}] FAIL ${action}: ${entry.actual}`);
  }
  entry.at = new Date().toISOString();
  console.log(`[${role}] ${entry.result.toUpperCase()} ${action}`);
  save();
  return entry;
}
function expectThat(condition, message) {
  if (!condition) throw new Error(message);
}
const q = (s) => JSON.stringify(s);

async function signIn(page, email, password, displayName) {
  await page.goto(`${BASE}/auth/login`);
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL((url) => url.pathname === "/" || url.pathname.startsWith("/onboarding"), {
    timeout: 20000,
  });
  await page
    .getByRole("banner")
    .getByRole("button", { name: displayName })
    .waitFor({ timeout: 20000 });
}

async function mailLink(email) {
  for (let attempt = 0; attempt < 40; attempt++) {
    const search = await fetch(
      `${MAIL}/api/v1/search?query=${encodeURIComponent(`to:"${email}"`)}`,
    ).then((r) => r.json());
    const first = search.messages?.[0];
    if (first) {
      const message = await fetch(`${MAIL}/api/v1/message/${first.ID}`).then((r) => r.json());
      const match = message.Text.match(/https?:\/\/[^\s)]+\/auth\/set-password[^\s)]*/);
      if (match) {
        const url = new URL(match[0]);
        const lab = new URL(BASE);
        url.protocol = lab.protocol;
        url.host = lab.host;
        return { href: url.toString(), subject: message.Subject };
      }
    }
    await new Promise((r) => setTimeout(r, 750));
  }
  throw new Error(`no set-password email for ${email}`);
}

function tab(page, name) {
  return page.getByRole("navigation", { name: "Auto-Doc sections" }).getByRole("link", { name });
}
async function uploadExpectingRefusal(page, file) {
  await page.getByRole("button", { name: "Upload version" }).click();
  const dialog = page.getByRole("dialog", { name: "Upload version" });
  await dialog.getByLabel("Word template").setInputFiles(file);
  await dialog.getByRole("button", { name: "Upload", exact: true }).click();
  const alert = dialog.getByRole("alert");
  await alert.waitFor({ timeout: 15000 });
  const text = (await alert.textContent()).trim();
  await dialog.getByRole("button", { name: "Cancel" }).click();
  await dialog.waitFor({ state: "hidden" });
  return text;
}

async function uploadExpectingReport(page, file) {
  await page.getByRole("button", { name: "Upload version" }).click();
  const dialog = page.getByRole("dialog", { name: "Upload version" });
  const caption = (await dialog.getByText(/Each upload adds a file version/).textContent()).trim();
  await dialog.getByLabel("Word template").setInputFiles(file);
  await dialog.getByRole("button", { name: "Upload", exact: true }).click();
  const status = dialog.getByRole("status");
  await status.waitFor({ timeout: 20000 });
  const report = (await status.textContent()).trim();
  await dialog.getByRole("button", { name: "Close" }).click();
  await dialog.waitFor({ state: "hidden" });
  return { report, caption };
}

async function fieldOrder(page) {
  const labels = await page
    .getByRole("button", { name: /^Edit / })
    .evaluateAll((els) => els.map((e) => e.getAttribute("aria-label")));
  return labels.map((l) => l.replace(/^Edit /, ""));
}

async function publishDialogOptions(page) {
  const dialog = page.getByRole("dialog", { name: "Publish" });
  const files = await dialog.getByLabel("File version").locator("option").allInnerTexts();
  const forms = await dialog.getByLabel("Form version").locator("option").allInnerTexts();
  const caption = (
    await dialog.getByText(/Later edits leave this pair unchanged/).textContent()
  ).trim();
  return { files, forms, caption };
}

async function walkthrough(role, page, displayName, options = {}) {
  const roleName = role === "administrator" ? "Admin" : "Member";
  const autoDocName = `DOC-028 ${roleName} Services Agreement ${stamp}`;
  let recordId = null;
  let base = null;

  await step(
    role,
    "Before you start: open Auto-Docs and create an Auto-Doc, then open its Form section",
    async () => {
      await page.goto(`${BASE}/auto-docs`);
      await page.getByRole("button", { name: "Create Auto-Doc" }).first().click();
      const dialog = page.getByRole("dialog");
      await dialog.getByLabel("Name").fill(autoDocName);
      await dialog.getByRole("button", { name: "Create", exact: true }).click();
      await page.waitForURL(/\/auto-docs\/[0-9a-f-]+/, { timeout: 20000 });
      recordId = page.url().match(/\/auto-docs\/([0-9a-f-]+)/)[1];
      base = `${BASE}/auto-docs/${recordId}`;
      results.records.push({ role, name: autoDocName, id: recordId });
      await tab(page, "Form").click();
      await page.waitForURL(/\/form$/);
      const empty = (
        await page.getByText("Upload a Word file to start the form.").textContent()
      ).trim();
      const uploadButton = await page.getByRole("button", { name: "Upload version" }).isVisible();
      expectThat(uploadButton, "no Upload version button");
      return `Created Auto-Doc ${q(autoDocName)} (id ${recordId}) with Create Auto-Doc > Name > Create; it opened on its record. The Form tab shows the template pane reading ${q(empty)} beside the form, with an Upload version button as the guide says.`;
    },
  );

  let v1Report;
  await step(
    role,
    "Upload a .docx with Placeholders, one directive, and one Block with Upload version",
    async () => {
      v1Report = await uploadExpectingReport(page, fixture("doc028-services-v1.docx"));
      expectThat(/File version 1:/.test(v1Report.report), `unexpected report ${v1Report.report}`);
      await page.getByRole("heading", { name: "doc028-services-v1.docx" }).waitFor();
      return `Dialog caption read ${q(v1Report.caption)}. After Upload the dialog reported ${q(v1Report.report)} and closed with Close.`;
    },
  );

  await step(
    role,
    "Read the template pane: every Placeholder and Block is marked, including header, footer, and footnote",
    async () => {
      const summary = (
        await page
          .getByText(/\d+ Placeholders?, \d+ Blocks?/)
          .first()
          .textContent()
      ).trim();
      const pill = (
        await page
          .getByText(/^File version \d+$/)
          .first()
          .textContent()
      ).trim();
      const parts = {};
      for (const name of ["Header", "Footer", "Footnotes", "Body"]) {
        const section = page.locator(`section[aria-label="${name}"]`);
        parts[name] = (await section.count())
          ? await section
              .getByRole("button", { name: /^Placeholder / })
              .evaluateAll((els) => els.map((e) => e.getAttribute("aria-label")))
          : null;
      }
      const chips = await page
        .getByRole("button", { name: /^Placeholder / })
        .evaluateAll((els) =>
          els.map((e) => ({ label: e.getAttribute("aria-label"), text: e.textContent })),
        );
      const block = (
        await page.getByRole("button", { name: "Block arbitration" }).textContent()
      ).trim();
      const end = (await page.getByText("end arbitration").textContent()).trim();
      const fields = await fieldOrder(page);
      const paneBox = await page
        .getByRole("heading", { name: "doc028-services-v1.docx" })
        .boundingBox();
      const fieldsBox = await page.getByRole("region", { name: "Fields" }).boundingBox();
      const sideBySide =
        paneBox && fieldsBox && paneBox.x < fieldsBox.x && Math.abs(paneBox.y - fieldsBox.y) < 200;
      expectThat(sideBySide, `pane and form are not side by side: ${q(paneBox)} ${q(fieldsBox)}`);
      expectThat(parts.Header && parts.Header.length === 1, "header Placeholder chip missing");
      expectThat(parts.Footer && parts.Footer.length === 1, "footer Placeholder chip missing");
      expectThat(
        parts.Footnotes && parts.Footnotes.length === 1,
        "footnote Placeholder chip missing",
      );
      expectThat(
        chips.every((c) => !/no form field/.test(c.label)),
        "a chip reports no form field",
      );
      if (role === "administrator")
        await page.screenshot({
          path: path.join(SHOTS, "admin-template-pane-v1.png"),
          fullPage: true,
        });
      return `Pane heading shows the filename with pill ${q(pill)} and summary ${q(summary)}. Chips: ${q(chips.map((c) => c.text))}. Header chips ${q(parts.Header)}, Footer chips ${q(parts.Footer)}, Footnotes chips ${q(parts.Footnotes)}. Block tag reads ${q(block)} and the close reads ${q(end)}. Form fields in list order: ${q(fields)}. At 1280 px the file pane (x=${Math.round(paneBox.x)}) sits left of the Fields region (x=${Math.round(fieldsBox.x)}).`;
    },
  );

  await step(
    role,
    "A directive decides the new field's type: currency directive created a Currency field, others Text",
    async () => {
      await page.getByRole("button", { name: "Placeholder fee_amount", exact: true }).click();
      const card = page.getByRole("region", { name: "Fee amount" });
      const type = await card.getByLabel("Type").inputValue();
      const typeLabel = await card.getByLabel("Type").locator("option:checked").innerText();
      await page.getByRole("button", { name: "Placeholder governing_law", exact: true }).click();
      const textType = await page
        .getByRole("region", { name: "Governing law" })
        .getByLabel("Type")
        .locator("option:checked")
        .innerText();
      expectThat(type === "currency", `fee_amount type is ${type}`);
      expectThat(textType === "Text", `governing_law type is ${textType}`);
      return `Selecting the fee_amount chip opened its card; Type shows ${q(typeLabel)}. The governing_law card's Type shows ${q(textType)}.`;
    },
  );

  await step(
    role,
    "Select a field from its chip and edit the label, type, and help from its card; the form follows each commit",
    async () => {
      const chip = page
        .getByRole("button", { name: "Placeholder counterparty_name", exact: true })
        .first();
      await chip.click();
      expectThat(
        (await chip.getAttribute("aria-pressed")) === "true",
        "chip not pressed after click",
      );
      const card = page.getByRole("region", { name: "Counterparty name" });
      await card.waitFor();
      const controls = [];
      for (const label of ["Label", "Slug", "Type", "Help text"])
        controls.push(`${label}:${await card.getByLabel(label).count()}`);
      await card.getByLabel("Label").fill("Counterparty legal name");
      await card.getByLabel("Label").press("Enter");
      const renamed = page.getByRole("region", { name: "Counterparty legal name" });
      await renamed.waitFor({ timeout: 15000 });
      await renamed.getByLabel("Help text").fill("Use the registered company name.");
      await renamed.getByLabel("Help text").press("Enter");
      await page.waitForTimeout(800);
      const listed = await fieldOrder(page);
      expectThat(
        listed.includes("Counterparty legal name"),
        `field list did not follow: ${q(listed)}`,
      );
      const helpSaved = await renamed.getByLabel("Help text").inputValue();
      return `Clicking the chip marked it selected (aria-pressed) and opened the field card with controls ${q(controls)}. Changing Label to "Counterparty legal name" and pressing Enter renamed the card and the Fields list (${q(listed)}). Help text saved as ${q(helpSaved)}.`;
    },
  );

  await step(
    role,
    "Write a Clause rule: open the Block under Clauses, choose When a rule matches, pick field, operator, value",
    async () => {
      const before = (
        await page.getByRole("button", { name: "Block arbitration" }).textContent()
      ).trim();
      const clauseNote = (
        await page.getByText("A Block with no rule is always included.").textContent()
      ).trim();
      await page.getByRole("button", { name: "Edit the rule for arbitration" }).click();
      const card = page.getByRole("region", { name: "arbitration" });
      await card.waitFor();
      const includeOptions = await card.getByLabel("Include").locator("option").allInnerTexts();
      await card.getByLabel("Include").selectOption({ label: "When a rule matches" });
      await card.getByLabel("Form field").waitFor();
      await card.getByLabel("Form field").selectOption({ label: "Governing law" });
      await card.getByLabel("Operator").selectOption({ label: "Equals" });
      await card.getByLabel("Value").fill("England and Wales");
      await card.getByLabel("Value").press("Tab");
      await page.waitForTimeout(1200);
      const after = (
        await page.getByRole("button", { name: "Block arbitration" }).textContent()
      ).trim();
      const row = (
        await page
          .getByText(/Included when/)
          .first()
          .textContent()
          .catch(() => "(no Included when row)")
      ).trim();
      expectThat(/when/.test(after) && !/always/.test(after), `block tag did not change: ${after}`);
      if (role === "administrator")
        await page.screenshot({ path: path.join(SHOTS, "admin-clause-rule.png"), fullPage: true });
      return `Clauses section notes ${q(clauseNote)}. Block tag read ${q(before)} before the rule. Include offered ${q(includeOptions)}; after choosing "When a rule matches", Form field "Governing law", Operator "Equals", Value "England and Wales" the tag reads ${q(after)} and the Clauses row reads ${q(row)}.`;
    },
  );

  await step(
    role,
    "Negative: Publish refuses a field that cannot print its directive and names it (currency directive on a Text field)",
    async () => {
      await page.getByRole("button", { name: "Placeholder fee_amount", exact: true }).click();
      const card = page.getByRole("region", { name: "Fee amount" });
      await card.getByLabel("Type").selectOption({ label: "Text" });
      await page.waitForTimeout(1000);
      await page.getByRole("button", { name: "Publish", exact: true }).first().click();
      const dialog = page.getByRole("dialog", { name: "Publish" });
      const options = await publishDialogOptions(page);
      await dialog.getByRole("button", { name: "Publish", exact: true }).click();
      const alert = dialog.getByRole("alert");
      await alert.waitFor({ timeout: 15000 });
      const text = (await alert.textContent()).trim();
      if (role === "administrator")
        await page.screenshot({ path: path.join(SHOTS, "admin-publish-directive-refusal.png") });
      await dialog.getByRole("button", { name: "Cancel" }).click();
      await dialog.waitFor({ state: "hidden" });
      const state = (
        await page
          .getByText(/^(Draft|Published|Archived)$/)
          .first()
          .textContent()
      ).trim();
      await card.getByLabel("Type").selectOption({ label: "Currency" });
      await page.waitForTimeout(1000);
      expectThat(
        /Fee amount/.test(text) && /fee_amount\|currency:USD/.test(text),
        `refusal did not name the field and directive: ${text}`,
      );
      expectThat(state === "Draft", `state changed to ${state}`);
      return `With Fee amount set to Text, Publish offered ${q(options.files)} / ${q(options.forms)} and refused with ${q(text)}. State stayed ${q(state)}. Type was then set back to Currency.`;
    },
  );

  await step(
    role,
    "Negative: an upload with an open Block is refused and the refusal quotes the text",
    async () => {
      const text = await uploadExpectingRefusal(page, fixture("doc028-unclosed-block.docx"));
      const pill = (
        await page
          .getByText(/^File version \d+$/)
          .first()
          .textContent()
      ).trim();
      expectThat(
        /Unclosed Block/.test(text) && /#block arbitration/.test(text),
        `unexpected refusal ${text}`,
      );
      expectThat(pill === "File version 1", `a version was written: ${pill}`);
      return `Upload version refused doc028-unclosed-block.docx with ${q(text)}; the pane still shows ${q(pill)}.`;
    },
  );

  await step(
    role,
    "Negative: an upload with an unclosed brace is refused and the refusal quotes the text",
    async () => {
      const text = await uploadExpectingRefusal(page, fixture("doc028-unclosed-brace.docx"));
      const pill = (
        await page
          .getByText(/^File version \d+$/)
          .first()
          .textContent()
      ).trim();
      expectThat(
        /Unclosed Placeholder brace/.test(text) && /\{\{counterparty_name/.test(text),
        `unexpected refusal ${text}`,
      );
      expectThat(pill === "File version 1", `a version was written: ${pill}`);
      return `Upload version refused doc028-unclosed-brace.docx with ${q(text)}; the pane still shows ${q(pill)}.`;
    },
  );

  await step(
    role,
    "Supplementary: an unknown currency code is refused and the refusal quotes the text",
    async () => {
      const text = await uploadExpectingRefusal(page, fixture("doc028-bad-currency.docx"));
      expectThat(/currency code/i.test(text) && /ZZZ/.test(text), `unexpected refusal ${text}`);
      return `Upload version refused doc028-bad-currency.docx with ${q(text)}.`;
    },
  );

  let v2Report;
  await step(
    role,
    "Upload a new version that drops a Placeholder; the orphaned field is kept and marked",
    async () => {
      v2Report = await uploadExpectingReport(page, fixture("doc028-services-v2.docx"));
      await page.getByRole("heading", { name: "doc028-services-v2.docx" }).waitFor();
      const pill = (
        await page
          .getByText(/^File version \d+$/)
          .first()
          .textContent()
      ).trim();
      const orphanMark = (
        await page
          .getByText(/^No Placeholder in file version \d+$/)
          .first()
          .textContent()
      ).trim();
      const orphanTab = (await tab(page, "Form").textContent()).trim();
      const fields = await fieldOrder(page);
      const earlier = await page.getByRole("button", { name: /^Earlier versions/ }).textContent();
      expectThat(fields.includes("Signing date"), `Signing date field was dropped: ${q(fields)}`);
      expectThat(fields.includes("Notice address"), `Notice address field missing: ${q(fields)}`);
      expectThat(
        orphanMark === "No Placeholder in file version 2",
        `orphan mark reads ${orphanMark}`,
      );
      if (role === "legal_team_member")
        await page.screenshot({
          path: path.join(SHOTS, "member-orphaned-field.png"),
          fullPage: true,
        });
      return `Dialog reported ${q(v2Report.report)}. Pane shows ${q(pill)} with ${q(earlier.trim())}. Fields list ${q(fields)}; the Signing date row is marked ${q(orphanMark)} and the Form tab reads ${q(orphanTab)}.`;
    },
  );

  await step(role, "Publish pins one file version and one form version together", async () => {
    await page.getByRole("button", { name: "Publish", exact: true }).first().click();
    const dialog = page.getByRole("dialog", { name: "Publish" });
    const options = await publishDialogOptions(page);
    await dialog.getByLabel("File version").selectOption({ label: "File version 2" });
    const formOptions = dialog.getByLabel("Form version").locator("option");
    const lastForm = (await formOptions.allInnerTexts())[0];
    const selectedForm = await dialog
      .getByLabel("Form version")
      .locator("option:checked")
      .innerText();
    await dialog.getByRole("button", { name: "Publish", exact: true }).click();
    await dialog.waitFor({ state: "hidden", timeout: 15000 });
    await page.getByText("Published", { exact: true }).first().waitFor({ timeout: 15000 });
    await tab(page, "Overview").click();
    const live = (await page.getByText(/^Live since /).textContent()).trim();
    await tab(page, "Form").click();
    return `Publish dialog offered file versions ${q(options.files)} and form versions ${q(options.forms)} with caption ${q(options.caption)}; the newest form ${q(lastForm)} was preselected (checked option ${q(selectedForm)}). Chose File version 2 and published; the header state reads Published and Overview reads ${q(live)}.`;
  });

  await step(role, "Later edits change nothing live until you publish again", async () => {
    await page
      .getByRole("button", { name: "Placeholder governing_law", exact: true })
      .first()
      .click();
    const card = page.getByRole("region", { name: "Governing law" });
    await card.getByLabel("Help text").fill("Name the jurisdiction.");
    await card.getByLabel("Help text").press("Enter");
    await page.waitForTimeout(1000);
    await tab(page, "Overview").click();
    const live = (await page.getByText(/^Live since /).textContent()).trim();
    const newer = (await page.getByText(/newer than the currently published/).textContent()).trim();
    await tab(page, "Form").click();
    return `After editing a Help text, Overview still reads ${q(live)} and warns ${q(newer)}.`;
  });

  await step(role, "The Help link on the template pane resolves to this article", async () => {
    const link = page.getByRole("link", { name: "How to write an Auto-Doc template" });
    const href = await link.getAttribute("href");
    await link.click();
    await page.waitForURL(/\/help\/auto-doc-template/, { timeout: 15000 });
    await page
      .getByRole("heading", { level: 1, name: "Write an Auto-Doc template" })
      .waitFor({ timeout: 20000 });
    const h1 = (
      await page
        .getByRole("heading", { level: 1, name: "Write an Auto-Doc template" })
        .textContent()
    ).trim();
    const h2s = await page.getByRole("heading", { level: 2 }).allInnerTexts();
    const unavailable = await page.getByText(/Article unavailable/).count();
    expectThat(unavailable === 0, "Help answered Article unavailable");
    expectThat(h1 === "Write an Auto-Doc template", `heading is ${h1}`);
    if (role === "legal_team_member")
      await page.screenshot({ path: path.join(SHOTS, "member-help-article.png"), fullPage: false });
    const opened = page.url().replace(BASE, "");
    await page.goto(`${base}/form`);
    return `Link href ${q(href)} opened ${q(opened)} with h1 ${q(h1)} and sections ${q(h2s)}.`;
  });

  await step(
    role,
    "Keyboard: reach a Placeholder chip with Tab and select it with Enter; open and close Upload version with the keyboard",
    async () => {
      await page.goto(`${base}/form`);
      await page.getByRole("heading", { name: "doc028-services-v2.docx" }).waitFor();
      await page.getByRole("button", { name: "Open", exact: true }).first().focus();
      let reached = null;
      for (let i = 0; i < 25 && !reached; i++) {
        await page.keyboard.press("Tab");
        const active = await page.evaluate(() => ({
          label: document.activeElement?.getAttribute("aria-label"),
          tag: document.activeElement?.tagName,
          outline: getComputedStyle(document.activeElement).outlineStyle,
        }));
        if (active.label?.startsWith("Placeholder ")) reached = { ...active, tabs: i + 1 };
      }
      expectThat(reached, "no Placeholder chip reached by Tab");
      await page.keyboard.press("Enter");
      const pressed = await page.evaluate(() =>
        document.activeElement?.getAttribute("aria-pressed"),
      );
      expectThat(pressed === "true", "Enter did not select the Placeholder");
      const selectedLabel = await page
        .getByRole("textbox", { name: "Label", exact: true })
        .inputValue();
      const card = page.getByRole("region", { name: selectedLabel, exact: true });
      await card.waitFor({ state: "visible" });
      const cardVisible = await card.isVisible();
      await page.getByRole("button", { name: "Upload version" }).focus();
      await page.keyboard.press("Enter");
      const dialog = page.getByRole("dialog", { name: "Upload version" });
      await dialog.waitFor({ timeout: 5000 });
      const focusInDialog = await page.evaluate(
        () => !!document.activeElement?.closest("[role=dialog]"),
      );
      await page.keyboard.press("Escape");
      await dialog.waitFor({ state: "hidden", timeout: 5000 });
      return `Tab reached ${q(reached.label)} after ${reached.tabs} presses (focus outline style ${q(reached.outline)}); Enter set aria-pressed=${q(pressed)} and its card visible=${cardVisible}. Enter on Upload version opened the dialog (focus inside: ${focusInDialog}); Escape closed it.`;
    },
  );

  await step(
    role,
    "Narrow layout: the Form section and the Help article at 390 px wide",
    async () => {
      await page.setViewportSize({ width: 390, height: 844 });
      await page.goto(`${base}/form`);
      await page.getByRole("heading", { name: "doc028-services-v2.docx" }).waitFor();
      await page.waitForTimeout(500);
      const form = await page.evaluate(() => ({
        scrollWidth: document.documentElement.scrollWidth,
        clientWidth: document.documentElement.clientWidth,
      }));
      const upload = await page.getByRole("button", { name: "Upload version" }).isVisible();
      const help = await page
        .getByRole("link", { name: "How to write an Auto-Doc template" })
        .isVisible();
      const chips = await page.getByRole("button", { name: /^Placeholder / }).count();
      if (role === "legal_team_member")
        await page.screenshot({ path: path.join(SHOTS, "member-narrow-form.png"), fullPage: true });
      await page.goto(`${BASE}/help/auto-doc-template`);
      await page.getByRole("heading", { level: 1, name: "Write an Auto-Doc template" }).waitFor();
      const article = await page.evaluate(() => ({
        scrollWidth: document.documentElement.scrollWidth,
        clientWidth: document.documentElement.clientWidth,
      }));
      await page.setViewportSize({ width: 1280, height: 900 });
      await page.goto(`${base}/form`);
      return `Form section at 390 px: scrollWidth ${form.scrollWidth} vs clientWidth ${form.clientWidth}; Upload version visible=${upload}, Help link visible=${help}, ${chips} chips rendered. Help article at 390 px: scrollWidth ${article.scrollWidth} vs clientWidth ${article.clientWidth}.`;
    },
  );

  if (options.twoDirectives) {
    await step(
      role,
      "Supplementary: two directives that disagree on one name create a Text field and Publish names the gap",
      async () => {
        const name = `DOC-028 ${roleName} Two directives ${stamp}`;
        await page.goto(`${BASE}/auto-docs`);
        await page.getByRole("button", { name: "Create Auto-Doc" }).first().click();
        const dialog = page.getByRole("dialog");
        await dialog.getByLabel("Name").fill(name);
        await dialog.getByRole("button", { name: "Create", exact: true }).click();
        await page.waitForURL(/\/auto-docs\/[0-9a-f-]+/, { timeout: 20000 });
        const id = page.url().match(/\/auto-docs\/([0-9a-f-]+)/)[1];
        results.records.push({ role, name, id });
        await tab(page, "Form").click();
        const { report } = await uploadExpectingReport(page, fixture("doc028-two-directives.docx"));
        await page
          .getByRole("button", { name: "Placeholder fee_amount", exact: true })
          .first()
          .click();
        const type = await page
          .getByRole("region", { name: "Fee amount" })
          .getByLabel("Type")
          .locator("option:checked")
          .innerText();
        await page.getByRole("button", { name: "Publish", exact: true }).first().click();
        const publish = page.getByRole("dialog", { name: "Publish" });
        await publish.getByRole("button", { name: "Publish", exact: true }).click();
        const alert = publish.getByRole("alert");
        await alert.waitFor({ timeout: 15000 });
        const text = (await alert.textContent()).trim();
        await publish.getByRole("button", { name: "Cancel" }).click();
        expectThat(type === "Text", `type is ${type}`);
        return `Upload reported ${q(report)}; Fee amount Type shows ${q(type)}; Publish refused with ${q(text)}.`;
      },
    );
  }
}

const browser = await chromium.launch({ headless: true });
try {
  const adminContext = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const adminPage = await adminContext.newPage();
  await step("administrator", "Sign in as the lab Administrator (setup)", async () => {
    await signIn(adminPage, ADMIN.email, ADMIN.password, ADMIN.displayName);
    return "Signed in through /auth/login; the banner shows the Administrator's display name.";
  });

  const member = {
    email: `doc028.member+${stamp}@example.com`,
    displayName: "Nadia Okonkwo-Reyes",
    password: randomBytes(12).toString("base64url") + "Aa1!",
  };
  const memberContext = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const memberPage = await memberContext.newPage();
  await step(
    "legal_team_member",
    "Setup: invite a fictional Legal Team Member and activate the account through the set-password email",
    async () => {
      const invited = await adminPage.request.post(`${BASE}/api/v1/auth/invites`, {
        data: { email: member.email, displayName: member.displayName, role: "legal_team_member" },
      });
      expectThat(
        invited.status() === 201,
        `invite answered ${invited.status()} ${await invited.text()}`,
      );
      const { user } = await invited.json();
      results.member = {
        email: member.email,
        displayName: member.displayName,
        role: "legal_team_member",
        userId: user?.id ?? null,
      };
      const mail = await mailLink(member.email);
      await memberPage.goto(mail.href);
      await memberPage.getByLabel("New password").fill(member.password);
      await memberPage.getByLabel("Confirm password").fill(member.password);
      await memberPage.getByRole("button", { name: "Set password" }).click();
      await memberPage.getByText("Password set").waitFor({ timeout: 15000 });
      await signIn(memberPage, member.email, member.password, member.displayName);
      return `Administrator invited ${member.email} as legal_team_member over the API; Mailpit delivered ${q(mail.subject)}; the member set a password on the activation page and signed in through /auth/login.`;
    },
  );

  await walkthrough("administrator", adminPage, ADMIN.displayName, { twoDirectives: true });
  await walkthrough("legal_team_member", memberPage, member.displayName);
} finally {
  save();
  await browser.close();
  console.log(`results: ${OUT}`);
}
