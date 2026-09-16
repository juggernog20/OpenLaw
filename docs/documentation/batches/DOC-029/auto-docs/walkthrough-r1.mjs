// DOC-029 round 1 independent V-C56 browser walkthrough for the "Write an Auto-Doc template" guide.
// Adapted by the DOC-029 independent walkthrough agent (auto-docs, round 1) from
// docs/documentation/batches/DOC-028/walkthrough.mjs, following the current article text.
// Run from the repository root:
//   LAB_PASSWORD=... mise exec -- node docs/documentation/batches/DOC-029/auto-docs/walkthrough-r1.mjs
// The seed password comes only from the environment and is never written to the results.
import { writeFileSync, readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "../../../../..");
const { chromium } = await import(
  path.join(root, "node_modules/.pnpm/playwright@1.63.0/node_modules/playwright/index.mjs")
);

const BASE = process.env.LAB_APP_URL ?? "http://127.0.0.1:23300";
const MAIL = process.env.LAB_MAIL_URL ?? "http://127.0.0.1:23400";
const PASSWORD = process.env.LAB_PASSWORD;
if (!PASSWORD) throw new Error("LAB_PASSWORD is required");
const ADMIN = { email: "daniel.okafor@helix.example", displayName: "Daniel Okafor" };
const MEMBER = { email: "nadia.haddad@helix.example", displayName: "Nadia Haddad" };
const CONTRIBUTOR = { email: "ravi.menon@helix.example" };
const OUT = process.env.OUT ?? path.join(here, "walkthrough-r1.json");
const SHOTS = here;
const FIX = path.join(here, "fixtures");
const stamp = Date.now();
const fixture = (name) => path.join(FIX, name);
const sha256 = (file) => createHash("sha256").update(readFileSync(file)).digest("hex");

const results = {
  kind: "independent-article-walkthrough",
  task: "DOC-029",
  group: "auto-docs",
  round: 1,
  issues: [745, 747],
  walkthroughReviewer: "DOC-029 independent walkthrough agent (auto-docs, round 1)",
  reviewerKind: "agent",
  articleId: "auto-doc-template",
  articlePath: "docs/user-guides/auto-doc-template.md",
  contentSha256: sha256(path.join(root, "docs/user-guides/auto-doc-template.md")),
  scenario: "V-C56",
  appCommit: "3fa407e3a846559914aa1a63249741f30cfb4f69",
  labProject: process.env.LAB_PROJECT ?? "openlaw-docs-41255c61-admin",
  containerImages: JSON.parse(process.env.LAB_IMAGES ?? "[]"),
  appUrl: BASE,
  fixtures: Object.fromEntries(
    [
      "doc029-services-v1.docx",
      "doc029-services-v2.docx",
      "doc029-unclosed-block.docx",
      "doc029-unclosed-brace.docx",
      "doc029-bad-slug.docx",
      "doc029-bad-directive.docx",
      "doc029-bad-currency.docx",
      "doc029-two-directives-one-placeholder.docx",
      "doc029-two-directives.docx",
    ].map((name) => [name, sha256(fixture(name))]),
  ),
  priorAttempts: [
    {
      log: "walkthrough-r1-attempt1.json",
      disposition:
        "Reviewer script errors, not app or article failures. The pane check expected one header chip, but the DOC-029 header fixture holds two Placeholders (counterparty_name and client_matter). The Contributor sign-in waited for / or /onboarding, but the Contributor lands elsewhere. Both checks were corrected and the full procedure was rerun with new records.",
    },
    {
      log: "walkthrough-r1-attempt2.json",
      disposition:
        'Reviewer script errors, not app or article failures. The field-order helper also collected the Clauses button "Edit the rule for arbitration", so the list had one extra entry after the eight fields, which were in the expected order. The non-legal sign-in used a password, but ravi.menon has no password in this lab; the rerun uses an emailed sign-in link. Both checks were corrected and the full procedure was rerun with new records.',
    },
    {
      log: "walkthrough-r1-attempt3.json",
      disposition:
        "A passing 44-step run, superseded. Its non-legal role lookup used a wrong API path (/api/v1/auth/me answered 404), so the role was not confirmed. The rerun corrects the path and adds date-directive and upper-directive checks to the v1 fixture (signing_date now carries date:DD/MM/YYYY and the header carries counterparty_name|upper). The full procedure was rerun with new records.",
    },
  ],
  startedAt: new Date().toISOString(),
  stamp,
  steps: [],
  records: [],
  finishedAt: null,
};
function save() {
  results.finishedAt = new Date().toISOString();
  results.summary = {
    total: results.steps.length,
    pass: results.steps.filter((s) => s.result === "pass").length,
    fail: results.steps.filter((s) => s.result === "fail").length,
  };
  writeFileSync(OUT, JSON.stringify(results, null, 2) + "\n");
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
  await page.waitForURL((url) => !url.pathname.startsWith("/auth/"), {
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

async function magicLinkSignIn(page, email) {
  const newest = async () =>
    (
      await fetch(
        `${MAIL}/api/v1/search?query=${encodeURIComponent(`to:"${email}"`)}&limit=1`,
      ).then((r) => r.json())
    ).messages?.[0]?.ID ?? null;
  const before = await newest();
  await page.goto(`${BASE}/portal/login`);
  const magic = page.getByRole("button", { name: "Email me a sign-in link" });
  await magic.waitFor({ timeout: 20000 });
  await magic.click();
  await page.getByLabel("Email").fill(email);
  await page.getByRole("button", { name: "Send link" }).click();
  await page.getByText("Check your email").first().waitFor({ timeout: 15000 });
  for (let i = 0; i < 60; i++) {
    const id = await newest();
    if (id && id !== before) {
      const m = await fetch(`${MAIL}/api/v1/message/${id}`).then((r) => r.json());
      const match = m.Text.match(/https?:\/\/[^\s)\]]+magic-link\/verify[^\s)\]]*/);
      if (match) {
        const u = new URL(match[0]);
        const lab = new URL(BASE);
        u.protocol = lab.protocol;
        u.host = lab.host;
        await page.goto(u.toString());
        await page.waitForURL((url) => !/\/(auth|portal\/login)/.test(url.pathname), {
          timeout: 30000,
        });
        return;
      }
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error("no fresh sign-in mail");
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
  return labels.filter((l) => !/^Edit the rule for /.test(l)).map((l) => l.replace(/^Edit /, ""));
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
  const autoDocName = `DOC-029 auto-docs ${roleName} Services Agreement ${stamp}`;
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
      v1Report = await uploadExpectingReport(page, fixture("doc029-services-v1.docx"));
      expectThat(/File version 1:/.test(v1Report.report), `unexpected report ${v1Report.report}`);
      await page.getByRole("heading", { name: "doc029-services-v1.docx" }).waitFor();
      return `Dialog caption read ${q(v1Report.caption)}. After Upload the dialog reported ${q(v1Report.report)} and closed with Close.`;
    },
  );

  await step(
    role,
    "Read the template pane: every Placeholder and Block is marked in the body, header, footer, footnote, and endnote; new fields follow the pane order, body first",
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
      for (const name of ["Header", "Footer", "Footnotes", "Endnotes", "Body"]) {
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
        .getByRole("heading", { name: "doc029-services-v1.docx" })
        .boundingBox();
      const fieldsBox = await page.getByRole("region", { name: "Fields" }).boundingBox();
      const sideBySide =
        paneBox && fieldsBox && paneBox.x < fieldsBox.x && Math.abs(paneBox.y - fieldsBox.y) < 200;
      expectThat(sideBySide, `pane and form are not side by side: ${q(paneBox)} ${q(fieldsBox)}`);
      expectThat(
        parts.Header && parts.Header.length === 2,
        "header Placeholder chips missing (counterparty_name and client_matter)",
      );
      expectThat(parts.Footer && parts.Footer.length === 1, "footer Placeholder chip missing");
      expectThat(
        parts.Footnotes && parts.Footnotes.length === 1,
        "footnote Placeholder chip missing",
      );
      expectThat(parts.Endnotes && parts.Endnotes.length === 1, "endnote Placeholder chip missing");
      const partOrder = await page
        .locator("section[aria-label]")
        .evaluateAll((els) =>
          els
            .map((e) => e.getAttribute("aria-label"))
            .filter((l) => ["Body", "Header", "Footer", "Footnotes", "Endnotes"].includes(l)),
        );
      const chipOrder = [];
      for (const c of chips) {
        const slug = c.label
          .replace(/^Placeholder /, "")
          .split("|")[0]
          .trim();
        if (!chipOrder.includes(slug)) chipOrder.push(slug);
      }
      const bodySlugs = [];
      for (const l of parts.Body ?? []) {
        const slug = l
          .replace(/^Placeholder /, "")
          .split("|")[0]
          .trim();
        if (!bodySlugs.includes(slug)) bodySlugs.push(slug);
      }
      const expectedLabels = chipOrder.map((slug) => {
        const words = slug.split("_").join(" ");
        return words.charAt(0).toUpperCase() + words.slice(1);
      });
      expectThat(partOrder[0] === "Body", `body is not first: ${q(partOrder)}`);
      expectThat(
        q(fields) === q(expectedLabels),
        `field order ${q(fields)} does not follow pane order ${q(expectedLabels)}`,
      );
      expectThat(
        fields.indexOf("Client matter") > fields.indexOf("Arbitration seat") &&
          fields.indexOf("Schedule number") > fields.indexOf("Arbitration seat") &&
          fields.indexOf("Reference code") > fields.indexOf("Arbitration seat"),
        `a non-body field comes before a body field: ${q(fields)}`,
      );
      results.observedOrder = { partOrder, chipOrder, bodySlugs, fields };
      expectThat(
        chips.every((c) => !/no form field/.test(c.label)),
        "a chip reports no form field",
      );
      if (role === "administrator")
        await page.screenshot({
          path: path.join(SHOTS, "r1-admin-template-pane.png"),
          fullPage: true,
        });
      return `Pane heading shows the filename with pill ${q(pill)} and summary ${q(summary)}. Chips: ${q(chips.map((c) => c.text))}. Header chips ${q(parts.Header)}, Footer chips ${q(parts.Footer)}, Footnotes chips ${q(parts.Footnotes)}, Endnotes chips ${q(parts.Endnotes)}. Pane part order ${q(partOrder)}; first-seen Placeholder order in the pane ${q(chipOrder)}; the form field order follows it with every body field first. Block tag reads ${q(block)} and the close reads ${q(end)}. Form fields in list order: ${q(fields)}. At 1280 px the file pane (x=${Math.round(paneBox.x)}) sits left of the Fields region (x=${Math.round(fieldsBox.x)}).`;
    },
  );

  await step(
    role,
    "A directive decides the new field's type: date directive creates a Date field, currency directive a Currency field, others Text; upper is accepted",
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
      await page.getByRole("button", { name: "Placeholder signing_date", exact: true }).click();
      const dateType = await page
        .getByRole("region", { name: "Signing date" })
        .getByLabel("Type")
        .locator("option:checked")
        .innerText();
      await page.getByRole("button", { name: "Placeholder client_matter", exact: true }).click();
      const headerType = await page
        .getByRole("region", { name: "Client matter" })
        .getByLabel("Type")
        .locator("option:checked")
        .innerText();
      expectThat(dateType === "Date", `signing_date type is ${dateType}`);
      expectThat(headerType === "Text", `client_matter type is ${headerType}`);
      expectThat(type === "currency", `fee_amount type is ${type}`);
      expectThat(textType === "Text", `governing_law type is ${textType}`);
      return `Selecting the fee_amount chip opened its card; Type shows ${q(typeLabel)}. The signing_date card (date:DD/MM/YYYY directive) shows ${q(dateType)}. The governing_law card's Type shows ${q(textType)} and the header-only client_matter card shows ${q(headerType)}. The header Placeholder {{counterparty_name|upper}} uploaded without refusal.`;
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
        await page.screenshot({ path: path.join(SHOTS, "r1-admin-publish-refusal.png") });
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
      const text = await uploadExpectingRefusal(page, fixture("doc029-unclosed-block.docx"));
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
      return `Upload version refused doc029-unclosed-block.docx with ${q(text)}; the pane still shows ${q(pill)}.`;
    },
  );

  await step(
    role,
    "Negative: an upload with an unclosed brace is refused and the refusal quotes the text",
    async () => {
      const text = await uploadExpectingRefusal(page, fixture("doc029-unclosed-brace.docx"));
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
      return `Upload version refused doc029-unclosed-brace.docx with ${q(text)}; the pane still shows ${q(pill)}.`;
    },
  );

  await step(
    role,
    "Negative: an upload with a name that is not a valid slug is refused and the refusal quotes the text",
    async () => {
      const text = await uploadExpectingRefusal(page, fixture("doc029-bad-slug.docx"));
      const pill = (
        await page
          .getByText(/^File version \d+$/)
          .first()
          .textContent()
      ).trim();
      expectThat(/Counterparty-Name/.test(text), `unexpected refusal ${text}`);
      expectThat(pill === "File version 1", `a version was written: ${pill}`);
      return `Upload version refused doc029-bad-slug.docx with ${q(text)}; the pane still shows ${q(pill)}.`;
    },
  );

  await step(
    role,
    "Negative: an upload with a directive that is not one of the three is refused and the refusal quotes the text",
    async () => {
      const text = await uploadExpectingRefusal(page, fixture("doc029-bad-directive.docx"));
      expectThat(/lower/.test(text), `unexpected refusal ${text}`);
      return `Upload version refused doc029-bad-directive.docx with ${q(text)}.`;
    },
  );

  await step(
    role,
    "Negative: a Placeholder with two directives is refused (a Placeholder takes one directive, not two)",
    async () => {
      const text = await uploadExpectingRefusal(
        page,
        fixture("doc029-two-directives-one-placeholder.docx"),
      );
      expectThat(/upper\|upper|counterparty_name/.test(text), `unexpected refusal ${text}`);
      return `Upload version refused doc029-two-directives-one-placeholder.docx with ${q(text)}.`;
    },
  );

  await step(
    role,
    "Supplementary: an unknown currency code is refused and the refusal quotes the text",
    async () => {
      const text = await uploadExpectingRefusal(page, fixture("doc029-bad-currency.docx"));
      expectThat(/currency code/i.test(text) && /ZZZ/.test(text), `unexpected refusal ${text}`);
      return `Upload version refused doc029-bad-currency.docx with ${q(text)}.`;
    },
  );

  let v2Report;
  await step(
    role,
    "Upload a new version that drops a Placeholder; the orphaned field is kept and marked",
    async () => {
      v2Report = await uploadExpectingReport(page, fixture("doc029-services-v2.docx"));
      await page.getByRole("heading", { name: "doc029-services-v2.docx" }).waitFor();
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
          path: path.join(SHOTS, "r1-member-orphaned-field.png"),
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

  await step(
    role,
    "Remove the field or put the Placeholder back: a field whose Placeholder remains asks first; the orphaned field is removed directly",
    async () => {
      const guardButton = page.getByRole("button", { name: "Remove Governing law", exact: true });
      await guardButton.click();
      const guard = page.getByRole("dialog", { name: "Remove Governing law?" });
      await guard.waitFor({ timeout: 5000 });
      const guardText = (await guard.textContent()).trim();
      await guard.getByRole("button", { name: "Cancel" }).click();
      await guard.waitFor({ state: "hidden" });
      const stillThere = (await fieldOrder(page)).includes("Governing law");
      await page.getByRole("button", { name: "Remove Signing date", exact: true }).click();
      await page.waitForTimeout(500);
      const dialogs = await page.getByRole("dialog").count();
      await page.waitForTimeout(1200);
      const fields = await fieldOrder(page);
      const orphanMarks = await page.getByText(/^No Placeholder in file version \d+$/).count();
      expectThat(stillThere, "Governing law was removed after Cancel");
      expectThat(dialogs === 0, "removing the orphan opened a dialog");
      expectThat(!fields.includes("Signing date"), `Signing date is still listed: ${q(fields)}`);
      await page.reload();
      await page.getByRole("heading", { name: "doc029-services-v2.docx" }).waitFor();
      const afterReload = await fieldOrder(page);
      expectThat(!afterReload.includes("Signing date"), "Signing date came back after reload");
      return `Remove Governing law opened ${q(guardText)}; Cancel kept the field. Remove Signing date opened no dialog and removed the row; fields now ${q(afterReload)} after reload, orphan marks left ${orphanMarks}.`;
    },
  );

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
    const opened = page.url().replace(BASE, "");
    await page.goto(`${base}/form`);
    return `Link href ${q(href)} opened ${q(opened)} with h1 ${q(h1)} and sections ${q(h2s)}.`;
  });

  await step(
    role,
    "Keyboard: reach a Placeholder chip with Tab and select it with Enter; open and close Upload version with the keyboard",
    async () => {
      await page.goto(`${base}/form`);
      await page.getByRole("heading", { name: "doc029-services-v2.docx" }).waitFor();
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
      await page.getByRole("heading", { name: "doc029-services-v2.docx" }).waitFor();
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
        const name = `DOC-029 auto-docs ${roleName} Two directives ${stamp}`;
        await page.goto(`${BASE}/auto-docs`);
        await page.getByRole("button", { name: "Create Auto-Doc" }).first().click();
        const dialog = page.getByRole("dialog");
        await dialog.getByLabel("Name").fill(name);
        await dialog.getByRole("button", { name: "Create", exact: true }).click();
        await page.waitForURL(/\/auto-docs\/[0-9a-f-]+/, { timeout: 20000 });
        const id = page.url().match(/\/auto-docs\/([0-9a-f-]+)/)[1];
        results.records.push({ role, name, id });
        await tab(page, "Form").click();
        const { report } = await uploadExpectingReport(page, fixture("doc029-two-directives.docx"));
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
  await step("administrator", "Before you start: sign in as an Administrator", async () => {
    await signIn(adminPage, ADMIN.email, PASSWORD, ADMIN.displayName);
    return "Signed in through /auth/login as the seeded Administrator; the banner shows the display name.";
  });
  const memberContext = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const memberPage = await memberContext.newPage();
  await step("legal_team_member", "Before you start: sign in as a Legal Team Member", async () => {
    await signIn(memberPage, MEMBER.email, PASSWORD, MEMBER.displayName);
    return "Signed in through /auth/login as the seeded Legal Team Member; the banner shows the display name.";
  });

  await walkthrough("administrator", adminPage, ADMIN.displayName, { twoDirectives: true });
  await walkthrough("legal_team_member", memberPage, MEMBER.displayName);

  // Role label is confirmed at run time from /api/v1/me and written into the step.
  const contributorContext = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const contributorPage = await contributorContext.newPage();
  await step(
    "non-legal",
    "Negative (supplementary): a seeded non-legal account (ravi.menon), who is not a Legal Team Member or Administrator, cannot open Auto-Docs",
    async () => {
      await magicLinkSignIn(contributorPage, CONTRIBUTOR.email);
      const me = await contributorPage.request.get(`${BASE}/api/v1/me`);
      const meBody = me.ok() ? await me.json() : null;
      const actualRole = meBody?.user?.role ?? meBody?.role ?? `unknown (${me.status()})`;
      expectThat(
        !["administrator", "legal_team_member"].includes(actualRole),
        `signed-in role is ${actualRole}`,
      );
      const navLinks = await contributorPage
        .getByRole("link", { name: "Auto-Docs", exact: true })
        .count();
      await contributorPage.goto(`${BASE}/auto-docs`);
      await contributorPage.waitForTimeout(2500);
      const landed = new URL(contributorPage.url()).pathname;
      const record = results.records.find((r) => r.role === "administrator");
      let recordLanded = null;
      if (record) {
        await contributorPage.goto(`${BASE}/auto-docs/${record.id}/form`);
        await contributorPage.waitForTimeout(2500);
        recordLanded = new URL(contributorPage.url()).pathname;
      }
      const api = record
        ? (await contributorPage.request.get(`${BASE}/api/v1/auto-docs/${record.id}`)).status()
        : null;
      expectThat(!landed.startsWith("/auto-docs"), `Contributor stayed on ${landed}`);
      expectThat(
        recordLanded === null || !recordLanded.startsWith("/auto-docs"),
        `Contributor stayed on ${recordLanded}`,
      );
      return `Signed in with an emailed sign-in link; /api/v1/me reports role ${q(actualRole)}. Auto-Docs links visible: ${navLinks}. /auto-docs sent the account to ${q(landed)}; the Administrator's Auto-Doc Form URL sent it to ${q(recordLanded)}; GET /api/v1/auto-docs/<id> answered ${api}.`;
    },
  );
} finally {
  save();
  await browser.close();
  console.log(`results: ${OUT}`);
}
