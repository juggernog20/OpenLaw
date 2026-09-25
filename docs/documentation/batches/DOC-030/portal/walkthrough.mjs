// DOC-030 independent walkthrough, group "portal".
// Written by the DOC-030 independent walkthrough agent (portal) from the article text:
//   docs/user-guides/submit-request.md   (V-C09)
//   docs/user-guides/follow-request.md   (V-C10)
// It also checks the author's limitations: the confirmation carries no R- reference, the Read status
// after Legal opens the Request in the Inbox, and a second Department question when an Administrator
// puts the built-in Department Row on the intake Form.
// Run from the worktree root after fixtures.mjs:
//   LAB_PASSWORD=... STATE=<private state file> SESSIONS=<private dir> PHASES=submit,department,follow \
//     node docs/documentation/batches/DOC-030/portal/walkthrough.mjs
// Sign-in links, cookies and passwords stay in memory or in the private SESSIONS directory.
// The log keeps request numbers, filenames and observed text only.
import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as L from "./lib.mjs";
import { pdf } from "./pdf.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "../../../../..");
const OUT = process.env.OUT ?? path.join(here, "walkthrough.json");
const STATE = JSON.parse(readFileSync(process.env.STATE, "utf8"));
const PHASES = (process.env.PHASES ?? "submit,department,follow").split(",");
const runStamp = Number(process.env.RUN_STAMP ?? Date.now());
const sha = (b) => createHash("sha256").update(b).digest("hex");
const lab = JSON.parse(readFileSync(path.join(root, ".documentation-labs/work2/lab.json"), "utf8"));

const log = existsSync(OUT)
  ? JSON.parse(readFileSync(OUT, "utf8"))
  : {
      kind: "independent-article-walkthrough",
      task: "DOC-030",
      group: "portal",
      walkthroughReviewer: "DOC-030 independent walkthrough agent (portal)",
      reviewerKind: "agent",
      appCommit: lab.sourceCommit,
      environment: lab.project,
      lab: lab.name,
      buildId: `app ${lab.appImageId}; engine ${lab.engineImageId}`,
      seed: lab.seed,
      app: L.BASE,
      mail: L.MAIL,
      browser: "Playwright 1.63.0 Chromium, headless; one isolated context per identity",
      fixtures: {
        script: "docs/documentation/batches/DOC-030/portal/fixtures.mjs",
        stamp: STATE.stamp,
        requestType: STATE.requestType.name,
        contractType: STATE.contractType.name,
        entity: STATE.entity.name,
        fields: [STATE.fields.reason.name, STATE.fields.reviewer.name],
        intakeLink: STATE.intakeLink.label,
      },
      articleHashesTested: {},
      runs: [],
      steps: [],
      observations: [],
      productBugs: [],
    };
for (const id of ["submit-request", "follow-request"])
  log.articleHashesTested[id] = sha(readFileSync(path.join(root, `docs/user-guides/${id}.md`)));
const run = { phases: PHASES, runStamp, startedAt: new Date().toISOString(), finishedAt: null };
log.runs.push(run);
function save() {
  run.finishedAt = new Date().toISOString();
  writeFileSync(OUT, JSON.stringify(log, null, 2) + "\n");
}

async function step(article, role, name, expected, fn, page = null) {
  const entry = {
    article,
    role,
    method: "browser-walkthrough",
    step: name,
    expected,
    page: null,
    actual: null,
    result: "not-run",
    startedAt: new Date().toISOString(),
    at: null,
    run: log.runs.length,
  };
  log.steps.push(entry);
  try {
    entry.actual = await fn();
    entry.result = "pass";
  } catch (error) {
    entry.actual = `Check did not hold: ${String(error?.message ?? error)
      .split("\n")
      .slice(0, 3)
      .join(" ")}`;
    entry.result = "fail";
    if (page && process.env.DEBUG_DIR)
      await page
        .screenshot({
          path: `${process.env.DEBUG_DIR}/fail-${log.steps.length}.png`,
          fullPage: true,
        })
        .catch(() => {});
  }
  try {
    if (page) entry.page = new URL(page.url()).pathname + new URL(page.url()).hash;
  } catch {
    /* page closed */
  }
  entry.at = new Date().toISOString();
  console.log(
    `[${article}/${role}] ${entry.result.toUpperCase()} ${name}${entry.result === "fail" ? " :: " + entry.actual : ""}`,
  );
  save();
  return entry;
}
function bug(entry) {
  if (!log.productBugs.some((b) => b.symptom === entry.symptom))
    log.productBugs.push({ ...entry, at: new Date().toISOString() });
}
function expect(cond, msg) {
  if (!cond) throw new Error(msg);
}
const text = async (loc) => (await loc.innerText()).replace(/\s+/g, " ").trim();
const must = (r, what) => {
  if (r.status >= 300)
    throw new Error(`${what}: HTTP ${r.status} ${JSON.stringify(r.body).slice(0, 300)}`);
  return r.body;
};
const pdfFile = (name) => ({ name, mimeType: "application/pdf", buffer: pdf(name) });
async function downloadVia(page, locator) {
  const [dl] = await Promise.all([
    page.waitForEvent("download", { timeout: 20000 }),
    locator.click(),
  ]);
  const p = await dl.path();
  return { filename: dl.suggestedFilename(), bytes: readFileSync(p) };
}
async function openApplet(page, name) {
  const panel = page.getByRole("complementary", { name });
  await page.waitForLoadState("networkidle").catch(() => {});
  for (let i = 0; i < 4; i++) {
    if (!(await panel.isVisible().catch(() => false)))
      await page.getByRole("toolbar", { name: "Applets" }).getByRole("button", { name }).click();
    await page.waitForTimeout(700);
    if (await panel.isVisible().catch(() => false)) break;
  }
  await panel.waitFor({ timeout: 15000 });
  return panel;
}
async function openComments(page) {
  const panel = await openApplet(page, "Comments");
  await panel
    .getByRole("list", { name: "Comments" })
    .or(panel.getByText(/Nothing has been said|could not be read/))
    .first()
    .waitFor({ timeout: 20000 });
  return panel;
}
const pill = async (page) =>
  text(page.getByRole("main").locator("h1").locator("xpath=following-sibling::span[1]"));
const ownerCard = async (page) =>
  text(
    page
      .getByRole("main")
      .getByText("Legal Owner", { exact: true })
      .locator("xpath=ancestor::div[contains(@class,'rounded-card')][1]"),
  );
const labelsOf = async (page) =>
  (await page.locator("form label").allInnerTexts()).map((l) => l.replace(/\s+/g, " ").trim());

// ---------------------------------------------------------------- V-C09
async function submitPhase() {
  const A = "submit-request";
  const R = "business_user";
  const RT = STATE.requestType;
  const F = STATE.fields;
  const { page } = await L.portalContext(L.PEOPLE.jonas);
  const posts = [];
  page.on("request", (req) => {
    if (req.method() === "POST" && new URL(req.url()).pathname === "/api/v1/requests")
      posts.push(req.url());
  });
  const title = `DOC-030 portal Review the Northstar evaluation terms ${runStamp}`;
  const chosen = `doc030-northstar-terms-${runStamp}.pdf`;
  const dropped = `doc030-northstar-dropped-${runStamp}.pdf`;
  const newParty = `DOC-030 portal Northstar Evaluation Ltd ${runStamp}`;
  let number = null;
  let existingParty = null;

  await step(
    A,
    R,
    "Step 1: Portal home, read Before you submit, select the request type",
    "Home shows Before you submit links, Your requests and request type cards; the card opens /portal/new/<slug>; the form shows its own Before you submit link",
    async () => {
      await page.goto(`${L.BASE}/portal`);
      await page.getByRole("heading", { level: 1, name: "What do you need from Legal?" }).waitFor();
      const panel = page.getByRole("region", { name: "Before you submit" });
      const links = (await panel.getByRole("link").allInnerTexts()).map((l) =>
        l.replace(/\s+/g, " ").trim(),
      );
      expect(links.length > 0, "no Before you submit links on the home");
      await page.getByRole("region", { name: "Your requests" }).waitFor();
      await page
        .getByRole("list", { name: "Request types" })
        .getByRole("link", { name: new RegExp(RT.name) })
        .click();
      await page.waitForURL(new RegExp(`/portal/new/${RT.slug}$`));
      await page.getByRole("heading", { level: 1, name: RT.name }).waitFor();
      const formPanel = page.getByRole("region", { name: "Before you submit" });
      const formLinks = (await formPanel.getByRole("link").allInnerTexts()).map((l) =>
        l.replace(/\s+/g, " ").trim(),
      );
      expect(
        formLinks.some((l) => l.includes(STATE.intakeLink.label)),
        `form links ${formLinks.join(" | ")}`,
      );
      return `Home Before you submit links: ${links.join("; ")}. The "${RT.name}" card opened /portal/new/${RT.slug}. The form's own Before you submit panel beside the questions lists: ${formLinks.join("; ")}.`;
    },
    page,
  );

  await step(
    A,
    R,
    "Steps 2 to 6: form order under About your request, asterisks, Department and Urgency defaults",
    "About your request lists Title, Department, Urgency, then the Form's Intake Rows (Description among them), with Attachments last; required ones carry an asterisk; Department starts at Jonas's own Department and is required; Urgency starts at Medium with Low, Medium, High, Critical",
    async () => {
      await page.getByRole("heading", { level: 2, name: "About your request" }).waitFor();
      const clean = await labelsOf(page);
      const order = clean.map((l) => l.replace(/\*.*$/, "").trim());
      expect(
        order[0] === "Title" && order[1] === "Department" && order[2] === "Urgency",
        `order ${order.join(" | ")}`,
      );
      expect(order.at(-1) === "Attachments", `last label ${order.at(-1)}`);
      expect(order.includes("Description"), "no Description");
      const starred = clean.filter((l) => l.includes("*") || l.includes("(required)"));
      for (const want of ["Title", "Department", "Urgency", "Description", F.reason.name])
        expect(
          starred.some((l) => l.startsWith(want)),
          `${want} not marked required (${starred.join(" | ")})`,
        );
      const dept = page.getByLabel(/^Department/);
      const deptText = await dept.evaluate((el) => el.options[el.selectedIndex]?.textContent);
      const deptOptions = await dept.evaluate((el) => [...el.options].map((o) => o.textContent));
      const urg = page.getByLabel(/^Urgency/);
      const urgVal = await urg.evaluate((el) => el.options[el.selectedIndex].textContent);
      const urgOpts = await urg.evaluate((el) => [...el.options].map((o) => o.textContent));
      expect(deptText && deptText !== "Choose a Department", `Department started at ${deptText}`);
      expect(urgVal === "Medium", `Urgency started at ${urgVal}`);
      expect(
        JSON.stringify(urgOpts) === JSON.stringify(["Low", "Medium", "High", "Critical"]),
        `Urgency options ${urgOpts}`,
      );
      return `Labels in order: ${clean.join(" | ")}. Required marks on: ${starred.join(" | ")}. Department started at "${deptText}" (Jonas's own Department) with options ${deptOptions.join(", ")}. Urgency started at ${urgVal}; options ${urgOpts.join(", ")}.`;
    },
    page,
  );

  await step(
    A,
    R,
    "Step 7 (negative): Submit request with required answers missing",
    "Nothing is sent; the form names each missing answer and marks the question",
    async () => {
      await page.getByRole("button", { name: "Submit request" }).click();
      const alert = page.locator("form").getByRole("alert");
      await alert.waitFor();
      const said = await text(alert);
      const marks = await page.getByText(/ is required\.$/).allInnerTexts();
      await page.waitForTimeout(500);
      expect(posts.length === 0, "a POST /requests was sent");
      for (const want of ["Title", "Description", F.reason.name])
        expect(said.includes(want), `alert does not name ${want}: ${said}`);
      return `Alert "${said}"; marks under the questions: ${marks.join(" / ")}; POST /api/v1/requests sent: ${posts.length}.`;
    },
    page,
  );

  await step(
    A,
    R,
    "Answer conditional questions: Term type Fixed shows a required Expiry date; Evergreen hides it; the answer stays in the form",
    "Expiry date is absent until Term type is Fixed; then it carries an asterisk and blocks submission when empty; Evergreen hides it; returning to Fixed shows the kept answer",
    async () => {
      const before = await page.getByLabel(/^Expiry date/).count();
      const termOptions = await page
        .getByLabel(/^Term type/)
        .evaluate((el) => [...el.options].map((o) => `${o.value}=${o.textContent}`));
      await page.getByLabel(/^Term type/).selectOption("fixed");
      await page.getByLabel(/^Expiry date/).waitFor();
      const expiryLabel = (await labelsOf(page)).find((l) => l.startsWith("Expiry date"));
      await page.getByRole("button", { name: "Submit request" }).click();
      const said = await text(page.locator("form").getByRole("alert"));
      const mark = await page.getByText("Expiry date is required.", { exact: true }).count();
      await page.getByLabel(/^Expiry date/).fill("2027-03-31");
      await page.getByLabel(/^Term type/).selectOption("evergreen");
      await page.waitForTimeout(300);
      const hidden = await page.getByLabel(/^Expiry date/).count();
      await page.getByLabel(/^Term type/).selectOption("fixed");
      const kept = await page.getByLabel(/^Expiry date/).inputValue();
      const noteShown = await page.getByLabel(new RegExp(`^${F.fixedNote.name}`)).count();
      expect(before === 0, `Expiry date shown before a Term type (${before})`);
      expect(expiryLabel?.includes("*"), `Expiry label ${expiryLabel}`);
      expect(said.includes("Expiry date") && mark === 1, `alert ${said} mark ${mark}`);
      expect(hidden === 0, "Expiry date still shown under Evergreen");
      expect(kept === "2027-03-31", `kept ${kept}`);
      expect(posts.length === 0, "a POST was sent");
      if (termOptions.includes("fixed=fixed"))
        bug({
          article: A,
          symptom:
            "The Portal Term type question lists its raw stored values as choices (fixed, auto_renew, evergreen) instead of labels such as Fixed and Evergreen; What you submitted also shows 'Term type fixed' and 'Value frequency one_time'.",
          reproduction: `Portal form /portal/new/${STATE.requestType.slug}, Term type options ${termOptions.join(", ")}.`,
          effect:
            "The guide's example says Fixed and Evergreen; a reader finds the lowercase values, so the step still works.",
        });
      return `Term type options: ${termOptions.join(", ")}. Expiry date absent before a choice; Fixed showed "${expiryLabel}"; Submit request said "${said}" with "Expiry date is required."; Evergreen hid Expiry date; Fixed again showed the kept answer ${kept}, and the optional "${F.fixedNote.name}" under the same Branch (${noteShown} shown). No POST sent.`;
    },
    page,
  );

  await step(
    A,
    R,
    "Answer conditional questions: Our entity, person question, Value and Counterparties controls",
    "Our entity lists only the Portal-listed Entity; the person question offers only Not set and has no asterisk; Value is one Row with amount, currency and frequency; Counterparties finds an existing Counterparty and offers Add new; the first is marked Primary",
    async () => {
      const entityOpts = await page
        .getByLabel(/^Our entity/)
        .evaluate((el) => [...el.options].map((o) => o.textContent));
      const { page: daniel } = await L.staffContext(L.PEOPLE.daniel);
      const all = must(await L.api(daniel, "GET", "/entities"), "entities").entities;
      await daniel.context().close();
      const listed = all
        .filter((e) => e.portalListed && !e.archivedAt)
        .map((e) => e.legalName ?? e.name)
        .sort();
      const offered = entityOpts.slice(1).sort();
      expect(entityOpts[0] === "Not set", `first option ${entityOpts[0]}`);
      expect(
        JSON.stringify(offered) === JSON.stringify(listed),
        `offered ${offered.join(", ")} listed ${listed.join(", ")}`,
      );
      expect(offered.includes(STATE.entity.name), "fixture Entity not offered");
      const staffEntities = all.length;
      const personLabel = (await labelsOf(page)).find((l) => l.startsWith(F.reviewer.name));
      const personOpts = await page
        .getByLabel(new RegExp(`^${F.reviewer.name}`))
        .evaluate((el) => [...el.options].map((o) => o.textContent));
      expect(
        !personLabel.includes("*") && JSON.stringify(personOpts) === '["Not set"]',
        `person ${personLabel} ${personOpts}`,
      );
      const valueControls = [];
      for (const n of ["Amount", "Currency", "Frequency"])
        valueControls.push(
          `${n}:${await page.locator("form").getByLabel(n, { exact: true }).count()}`,
        );
      await page.getByLabel("Amount", { exact: true }).fill("25000");
      const currencies = await page
        .getByLabel("Currency", { exact: true })
        .evaluate((el) => [...el.options].map((o) => o.value).filter(Boolean));
      await page
        .getByLabel("Currency", { exact: true })
        .selectOption(currencies.includes("GBP") ? "GBP" : currencies[0]);
      const box = page.getByLabel(/^Counterparties/);
      await box.fill("Lit");
      const matches = page.getByRole("listbox", { name: "Counterparty matches" });
      await matches.waitFor({ timeout: 15000 });
      await page.waitForTimeout(1200);
      const options = (await matches.getByRole("option").allInnerTexts()).map((o) =>
        o.replace(/\s+/g, " ").trim(),
      );
      const firstExisting = options.find(
        (o) => !o.startsWith("Add new") && !o.startsWith("Create"),
      );
      if (firstExisting) {
        await matches.getByRole("option", { name: firstExisting }).first().click();
        existingParty = firstExisting;
      }
      await box.fill(newParty);
      const addNew = page.getByRole("option", { name: `Add new "${newParty}"` });
      await addNew.waitFor({ timeout: 15000 });
      await addNew.click();
      const rows = (
        await page
          .locator("form li")
          .filter({ has: page.getByRole("button", { name: /^Remove / }) })
          .allInnerTexts()
      ).map((r) => r.replace(/\s+/g, " ").trim());
      expect(existingParty, `no existing Counterparty offered for "Lit": ${options.join(" | ")}`);
      expect(
        rows[0]?.includes("Primary") && !rows[1]?.includes("Primary"),
        `rows ${rows.join(" | ")}`,
      );
      return `Our entity options: ${entityOpts.join(", ")} (the staff registry holds ${staffEntities} Entities; ${listed.length} are Portal-listed and exactly those are offered). "${personLabel}" offers ${personOpts.join(", ")} and has no asterisk. Value controls ${valueControls.join(", ")} sit in one Row; amount 25000 entered. Counterparties search "Lit" offered: ${options.join(" | ")}; picked "${existingParty}", then 'Add new "${newParty}"'. Selected rows: ${rows.join(" | ")}.`;
    },
    page,
  );

  await step(
    A,
    R,
    "Step 6: Attachments, Choose files beyond 20, then Remove",
    "The form keeps 20 files, shows A request carries at most 20 files., and Remove takes a file off the list",
    async () => {
      await page
        .getByRole("heading", { level: 2, name: "About your request" })
        .scrollIntoViewIfNeeded();
      const many = [];
      for (let i = 1; i <= 21; i++)
        many.push(pdfFile(`doc030-extra-${String(i).padStart(2, "0")}-${runStamp}.pdf`));
      const [chooser] = await Promise.all([
        page.waitForEvent("filechooser"),
        page.getByRole("button", { name: "Choose files", exact: true }).click(),
      ]);
      await chooser.setFiles(many);
      const note = await text(page.getByText(/A request carries at most/));
      const listed = await page.getByRole("button", { name: /^Remove doc030-extra-/ }).count();
      const has21 = await page
        .getByRole("button", { name: `Remove doc030-extra-21-${runStamp}.pdf` })
        .count();
      for (let i = 20; i >= 1; i--)
        await page
          .getByRole("button", {
            name: `Remove doc030-extra-${String(i).padStart(2, "0")}-${runStamp}.pdf`,
          })
          .click();
      const after = await page.getByRole("button", { name: /^Remove doc030-extra-/ }).count();
      expect(listed === 20 && has21 === 0, `listed ${listed} 21st ${has21}`);
      expect(note === "A request carries at most 20 files.", `note ${note}`);
      expect(after === 0, `after removal ${after}`);
      return `Chose 21 files: ${listed} listed, the 21st dropped, with "${note}". Remove took each listed file off; ${after} remain.`;
    },
    page,
  );

  await step(
    A,
    R,
    "Step 6: select one file with Choose files and drop another onto the form",
    "Both filenames are listed",
    async () => {
      const [chooser] = await Promise.all([
        page.waitForEvent("filechooser"),
        page.getByRole("button", { name: "Choose files", exact: true }).click(),
      ]);
      await chooser.setFiles([pdfFile(chosen)]);
      const dropBytes = pdfFile(dropped).buffer.toString("base64");
      const zone = page.getByText(/^Drop up to 20 files/).locator("xpath=..");
      await zone.evaluate(
        (el, { b64, name }) => {
          const bin = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
          const dt = new DataTransfer();
          dt.items.add(new File([bin], name, { type: "application/pdf" }));
          el.dispatchEvent(
            new DragEvent("dragover", { bubbles: true, cancelable: true, dataTransfer: dt }),
          );
          el.dispatchEvent(
            new DragEvent("drop", { bubbles: true, cancelable: true, dataTransfer: dt }),
          );
        },
        { b64: dropBytes, name: dropped },
      );
      await page.getByRole("button", { name: `Remove ${dropped}` }).waitFor();
      await page.getByRole("button", { name: `Remove ${chosen}` }).waitFor();
      return `Listed ${chosen} (Choose files) and ${dropped} (dropped onto the form).`;
    },
    page,
  );

  await step(
    A,
    R,
    "Steps 2 to 8: complete the form, Submit request once, keep the confirmation open",
    "Confirmation reads Thanks! Your request has been submitted to legal.; Attaching your files… shows while uploads run; no failure and no R- reference on the confirmation; one POST; Open request offered",
    async () => {
      await page.getByLabel(/^Title/).fill(title);
      await page
        .getByLabel(/^Description/)
        .fill(
          "DOC-030 portal: Northstar proposes a 60-day evaluation. Please review the evaluation terms.",
        );
      await page.getByLabel(/^Department/).selectOption({ label: "Procurement" });
      await page.getByLabel(/^Urgency/).selectOption({ label: "High" });
      await page.getByLabel(/^Our entity/).selectOption({ label: STATE.entity.name });
      await page
        .getByLabel(new RegExp(`^${F.reason.name}`))
        .fill("DOC-030 portal: evaluation before a purchase decision.");
      let release;
      const gate = new Promise((r) => (release = r));
      await page.route("**/api/v1/requests/*/attachments", async (route) => {
        await gate;
        await route.continue();
      });
      const created = page.waitForResponse(
        (r) => r.request().method() === "POST" && new URL(r.url()).pathname === "/api/v1/requests",
      );
      await page.getByRole("button", { name: "Submit request" }).click();
      number = (await (await created).json()).request.number;
      const heading = page.getByRole("heading", {
        name: "Thanks! Your request has been submitted to legal.",
      });
      await heading.waitFor({ timeout: 20000 });
      const uploading = await page.getByText("Attaching your files…").isVisible();
      const confirmation = await text(heading.locator("xpath=ancestor::section[1]"));
      release();
      await page.getByText("Attaching your files…").waitFor({ state: "hidden", timeout: 20000 });
      await page.unroute("**/api/v1/requests/*/attachments");
      const failures = await page.getByText(/did not attach/).count();
      const finalText = await text(heading.locator("xpath=ancestor::section[1]"));
      expect(uploading, "Attaching your files… not shown while uploads were held");
      expect(failures === 0, "a failure was reported");
      expect(!/R-\d+/.test(finalText), `confirmation carries a reference: ${finalText}`);
      expect(posts.length === 1, `POST count ${posts.length}`);
      await page.getByRole("link", { name: "Open request" }).waitFor();
      return `While the two uploads were held the confirmation read "${confirmation}"; after release it read "${finalText}". No R- reference and no failure on the confirmation; one POST /api/v1/requests (the API numbered it R-${number}); Open request offered.`;
    },
    page,
  );

  await step(
    A,
    R,
    "Step 9: Open request, read the R- reference and check saved answers and attachments",
    "The line under the title shows the R- reference; What you submitted shows the description, Department, Urgency, answers and both files with their original bytes; no edit control",
    async () => {
      await page.getByRole("link", { name: "Open request" }).click();
      await page.waitForURL(new RegExp(`/portal/requests/${number}$`));
      await page.getByRole("heading", { level: 1, name: title }).waitFor();
      const meta = await text(page.getByText(new RegExp(`^R-${number} ·`)));
      const card = page.getByRole("region", { name: "What you submitted" });
      const body = await text(card);
      for (const want of [
        "Northstar proposes a 60-day evaluation",
        "Procurement",
        "High",
        newParty,
        STATE.entity.name,
        "2027-03-31".slice(0, 4),
        "evaluation before a purchase decision",
        chosen,
        dropped,
      ])
        expect(body.includes(want), `missing ${want} in: ${body}`);
      const got = [];
      for (const name of [chosen, dropped]) {
        const d = await downloadVia(page, card.getByRole("link", { name }));
        expect(sha(d.bytes) === sha(pdfFile(name).buffer), `bytes differ for ${name}`);
        got.push(d.filename);
      }
      const editControls = await card.getByRole("button").count();
      const inputs = await card.locator("input,textarea,select").count();
      expect(meta.startsWith(`R-${number} · ${RT.name} · Submitted`), `meta ${meta}`);
      return `Meta line "${meta}". What you submitted: "${body}". Downloads ${got.join(", ")} matched the original bytes; ${editControls} buttons and ${inputs} inputs in the card (no edit control).`;
    },
    page,
  );

  await step(
    A,
    R,
    "Check the result: Your requests shows the new Request as Open with Legal Owner: Not assigned yet",
    "One row with R- reference, title, Open and Legal Owner: Not assigned yet",
    async () => {
      await page.getByRole("link", { name: "Your requests" }).first().click();
      await page.waitForURL(/\/portal$/);
      const list = page.getByRole("region", { name: "Your requests" });
      const rows = list.getByRole("link", { name: new RegExp(title) });
      await rows.first().waitFor({ timeout: 20000 });
      const count = await rows.count();
      const row = await text(rows.first());
      expect(count === 1, `rows ${count}`);
      expect(
        row.includes(`R-${number}`) &&
          row.includes("Legal Owner: Not assigned yet") &&
          /Open$/.test(row),
        `row ${row}`,
      );
      return `Your requests: "${row}" (1 row).`;
    },
    page,
  );

  await step(
    A,
    "legal_team_member",
    "Check the result: Legal receives a Request to triage; no Contract or Matter exists yet",
    "Staff API read shows status new with no converted record",
    async () => {
      const { page: nadia } = await L.staffContext(L.PEOPLE.nadia);
      const r = must(await L.api(nadia, "GET", `/requests/${number}`), "staff read").request;
      await nadia.context().close();
      expect(
        r.status === "new" && !r.convertedRecord,
        `status ${r.status} converted ${JSON.stringify(r.convertedRecord)}`,
      );
      return `Nadia's API read of R-${number}: status "${r.status}", convertedRecord ${JSON.stringify(r.convertedRecord ?? null)}, department "${r.department}", urgency "${r.urgency}".`;
    },
  );
  STATE.submitted = { number, title };

  await step(
    A,
    "legal_team_member",
    "Step 3 (negative): a Requester without a listed Department must choose one",
    "Department starts empty and Submit request names Department as missing",
    async () => {
      const { page: staff } = await L.staffContext(L.PEOPLE.nadia);
      await staff.goto(`${L.BASE}/portal/new/legal_question`);
      const dept = staff.getByLabel(/^Department/);
      await dept.waitFor();
      const start = await dept.evaluate((el) => el.options[el.selectedIndex]?.textContent);
      await staff.getByLabel(/^Title/).fill("DOC-030 portal department check (not submitted)");
      await staff.getByRole("button", { name: "Submit request" }).click();
      const said = await text(staff.locator("form").getByRole("alert"));
      await staff.context().close();
      expect(/Department/.test(said), `alert ${said}`);
      return `Nadia (no Department on her profile) saw Department start at "${start}"; Submit request answered "${said}". Nothing was submitted.`;
    },
  );

  const failedName = `doc030-failing-${runStamp}.pdf`;
  await step(
    A,
    R,
    "If it does not work: an attachment fails; the Request still exists and the failure names the file and the R- reference",
    "Confirmation names the file and the R- reference; the Request is saved without the file; the file goes on a reply",
    async () => {
      await page.goto(`${L.BASE}/portal/new/legal_question`);
      await page.getByLabel(/^Title/).fill(`DOC-030 portal attachment failure ${runStamp}`);
      await page.getByLabel(/^Description/).fill("DOC-030 portal: checking an attachment failure.");
      const [chooser] = await Promise.all([
        page.waitForEvent("filechooser"),
        page.getByRole("button", { name: "Choose files", exact: true }).click(),
      ]);
      await chooser.setFiles([pdfFile(failedName)]);
      await page.route("**/api/v1/requests/*/attachments", (route) => route.abort("failed"));
      const created = page.waitForResponse(
        (r) => r.request().method() === "POST" && new URL(r.url()).pathname === "/api/v1/requests",
      );
      await page.getByRole("button", { name: "Submit request" }).click();
      const n = (await (await created).json()).request.number;
      const alert = page.getByRole("alert").filter({ hasText: "did not attach" });
      await alert.waitFor({ timeout: 20000 });
      const said = await text(alert);
      await page.unroute("**/api/v1/requests/*/attachments");
      expect(said.includes(failedName) && said.includes(`R-${n}`), said);
      await page.getByRole("link", { name: "Open request" }).click();
      await page.waitForURL(new RegExp(`/portal/requests/${n}$`));
      const card = await text(page.getByRole("region", { name: "What you submitted" }));
      expect(!card.includes(failedName), "failed file listed");
      const panel = await openComments(page);
      await panel
        .getByRole("textbox", { name: "New comment" })
        .fill(`DOC-030 portal: the file that did not attach to R-${n}.`);
      const [fc] = await Promise.all([
        page.waitForEvent("filechooser"),
        panel.getByRole("button", { name: "Attach files" }).click(),
      ]);
      await fc.setFiles([pdfFile(failedName)]);
      await panel.getByRole("button", { name: "Comment", exact: true }).click();
      await panel.getByText(`the file that did not attach to R-${n}`).waitFor({ timeout: 20000 });
      await panel.getByRole("link", { name: `Download ${failedName}` }).waitFor({ timeout: 20000 });
      return `Confirmation alert "${said}". R-${n} opened without the file in What you submitted; Jonas sent ${failedName} on a reply in Comments and it appeared in the conversation.`;
    },
    page,
  );

  await step(
    A,
    R,
    "If it does not work: Legal decides the Request while its files upload",
    "Confirmation links to a reply on the same Request; the link opens its composer; the submission stays saved",
    async () => {
      const { page: nadia } = await L.staffContext(L.PEOPLE.nadia);
      const raceName = `doc030-race-${runStamp}.pdf`;
      await page.goto(`${L.BASE}/portal/new/legal_question`);
      await page.getByLabel(/^Title/).fill(`DOC-030 portal decided during upload ${runStamp}`);
      await page
        .getByLabel(/^Description/)
        .fill("DOC-030 portal: Legal declines while the file uploads.");
      const [chooser] = await Promise.all([
        page.waitForEvent("filechooser"),
        page.getByRole("button", { name: "Choose files", exact: true }).click(),
      ]);
      await chooser.setFiles([pdfFile(raceName)]);
      await page.route("**/api/v1/requests/*/attachments", async (route) => {
        const n = Number(new URL(route.request().url()).pathname.split("/")[4]);
        must(
          await L.api(nadia, "POST", `/requests/${n}/decline`, {
            reason: "DOC-030 portal: declined during upload.",
          }),
          "decline",
        );
        await route.continue();
      });
      const created = page.waitForResponse(
        (r) => r.request().method() === "POST" && new URL(r.url()).pathname === "/api/v1/requests",
      );
      await page.getByRole("button", { name: "Submit request" }).click();
      const n = (await (await created).json()).request.number;
      const alert = page.getByRole("alert").filter({ hasText: "did not attach" });
      await alert.waitFor({ timeout: 20000 });
      const said = await text(alert);
      await page.unroute("**/api/v1/requests/*/attachments");
      await alert.getByRole("link", { name: new RegExp(`reply on R-${n}`) }).click();
      await page.waitForURL(new RegExp(`/portal/requests/${n}#portal-request-composer$`));
      const panel = await openComments(page);
      const composerVisible = await panel.getByRole("textbox", { name: "New comment" }).isVisible();
      await panel
        .getByRole("textbox", { name: "New comment" })
        .fill(`DOC-030 portal: the file that did not attach to R-${n}.`);
      const [fc] = await Promise.all([
        page.waitForEvent("filechooser"),
        panel.getByRole("button", { name: "Attach files" }).click(),
      ]);
      await fc.setFiles([pdfFile(raceName)]);
      await panel.getByRole("button", { name: "Comment", exact: true }).click();
      await panel.getByText(`the file that did not attach to R-${n}`).waitFor({ timeout: 20000 });
      await panel.getByRole("link", { name: `Download ${raceName}` }).waitFor({ timeout: 20000 });
      const status = await pill(page);
      const card = await text(page.getByRole("region", { name: "What you submitted" }));
      await nadia.context().close();
      expect(
        composerVisible &&
          status === "Declined" &&
          card.includes("Legal declines while the file uploads"),
        `composer ${composerVisible} status ${status}`,
      );
      return `Confirmation alert "${said}"; its link opened /portal/requests/${n}#portal-request-composer with the Comments composer visible; Jonas sent ${raceName} on a reply there; status ${status}; What you submitted kept the description.`;
    },
    page,
  );

  await step(
    A,
    R,
    "If it does not work: a form address that does not exist returns to the Portal home",
    "Unknown form slug redirects to /portal",
    async () => {
      await page.goto(`${L.BASE}/portal/new/doc030-no-such-form`);
      await page.waitForURL(/\/portal$/, { timeout: 15000 });
      return `/portal/new/doc030-no-such-form went to ${new URL(page.url()).pathname}.`;
    },
    page,
  );

  await step(
    A,
    R,
    "If it does not work: submission reports an error without confirmation; Your requests shows no new Request",
    "Error text shows, answers stay, and no Request was saved",
    async () => {
      await page.goto(`${L.BASE}/portal/new/legal_question`);
      const t = `DOC-030 portal network failure ${runStamp}`;
      await page.getByLabel(/^Title/).fill(t);
      await page.route("**/api/v1/requests", (route) =>
        route.request().method() === "POST" ? route.abort("failed") : route.continue(),
      );
      await page.getByRole("button", { name: "Submit request" }).click();
      const said = await text(page.locator("form").getByRole("alert"));
      const kept = await page.getByLabel(/^Title/).inputValue();
      const confirmations = await page
        .getByRole("heading", { name: "Thanks! Your request has been submitted to legal." })
        .count();
      await page.unroute("**/api/v1/requests");
      await page.goto(`${L.BASE}/portal`);
      const list = page.getByRole("region", { name: "Your requests" });
      await list.waitFor();
      const mine = await list.getByRole("link", { name: new RegExp(t) }).count();
      expect(
        /could not be submitted/.test(said) && kept === t && mine === 0 && confirmations === 0,
        `${said} kept=${kept} saved=${mine}`,
      );
      return `Alert "${said}"; Title kept; ${confirmations} confirmation; Your requests lists ${mine} Request with that title.`;
    },
    page,
  );
  await page.context().close();
}

// ------------------------------------------ author limitation: Department Row on the intake Form
async function departmentPhase() {
  const A = "submit-request";
  const R = "business_user";
  const RT = STATE.requestType;
  const { page: daniel } = await L.staffContext(L.PEOPLE.daniel);
  const { page } = await L.portalContext(L.PEOPLE.jonas);
  const { page: nadia } = await L.staffContext(L.PEOPLE.nadia);
  const formPath = `/contract-types/${STATE.contractType.id}/form`;
  const title = `DOC-030 portal two Department answers ${runStamp}`;
  let number = null;
  try {
    must(await L.api(daniel, "PUT", formPath, { form: STATE.formWithDepartment }), "put form");
    await step(
      A,
      R,
      "Limitation check: the built-in Department Row On intake form on the destination Form",
      "Record what the Portal form shows when an Administrator turns on the Department Row",
      async () => {
        await page.goto(`${L.BASE}/portal/new/${RT.slug}`);
        await page.getByRole("heading", { level: 2, name: "About your request" }).waitFor();
        const labels = await labelsOf(page);
        const depts = labels.filter((l) => l.startsWith("Department"));
        const ids = await page
          .locator("form label")
          .filter({ hasText: /^Department/ })
          .evaluateAll((ls) => ls.map((l) => l.getAttribute("for")));
        const selects = [];
        for (const id of ids) {
          const sel = page.locator(`[id="${id}"]`);
          selects.push({
            id,
            selected: await sel.evaluate((el) => el.options[el.selectedIndex]?.textContent),
            required: await sel.evaluate((el) => el.getAttribute("aria-required")),
          });
        }
        log.observations.push({
          article: A,
          at: new Date().toISOString(),
          topic: "Built-in Department Row On intake form",
          observed: `Portal form labels: ${labels.join(" | ")}. Department questions: ${depts.length}; controls ${JSON.stringify(selects)}.`,
        });
        expect(depts.length >= 1, "no Department question");
        return `With the Department Row On intake form the form shows ${depts.length} Department questions. Labels: ${labels.join(" | ")}. Controls: ${JSON.stringify(selects)}.`;
      },
      page,
    );

    await step(
      A,
      R,
      "Limitation check: submit two different Department answers and see which one Legal and conversion use",
      "Record what the Request page, the staff read and the converted Contract hold",
      async () => {
        await page.getByLabel(/^Title/).fill(title);
        await page.getByLabel(/^Description/).fill("DOC-030 portal: two Department answers.");
        const ids = await page
          .locator("form label")
          .filter({ hasText: /^Department/ })
          .evaluateAll((ls) => ls.map((l) => l.getAttribute("for")));
        await page.locator(`[id="${ids[0]}"]`).selectOption({ label: "Procurement" });
        if (ids[1]) await page.locator(`[id="${ids[1]}"]`).selectOption({ label: "Engineering" });
        await page.getByLabel(/^Term type/).selectOption("evergreen");
        await page
          .getByLabel(new RegExp(`^${STATE.fields.reason.name}`))
          .fill("DOC-030 portal: Department check.");
        const created = page.waitForResponse(
          (r) =>
            r.request().method() === "POST" && new URL(r.url()).pathname === "/api/v1/requests",
        );
        await page.getByRole("button", { name: "Submit request" }).click();
        const resp = await created;
        const sent = JSON.parse(resp.request().postData());
        number = (await resp.json()).request.number;
        await page.getByRole("link", { name: "Open request" }).click();
        await page.waitForURL(new RegExp(`/portal/requests/${number}$`));
        const card = await text(page.getByRole("region", { name: "What you submitted" }));
        const staff = must(await L.api(nadia, "GET", `/requests/${number}`), "staff").request;
        const conv = must(
          await L.api(nadia, "POST", `/requests/${number}/convert`, {
            title,
            contractTypeId: STATE.contractType.id,
          }),
          "convert",
        ).request;
        const contract = must(
          await L.api(nadia, "GET", `/contracts/${conv.convertedRecord.number}`),
          "contract",
        );
        const c = contract.contract ?? contract;
        const owning =
          c.owningDepartment ??
          c.owningDepartmentName ??
          c.owningDepartmentId ??
          c.customFields?.owning_department;
        const observed = `Sent departmentId=${sent.departmentId} and customFields.owning_department=${sent.customFields?.owning_department ?? "(absent)"}. Portal What you submitted: "${card}". Staff read: department "${staff.department}", customFields.owning_department ${JSON.stringify(staff.customFields?.owning_department ?? null)}. Converted to C-${conv.convertedRecord.number}; its Department: ${JSON.stringify(owning)}.`;
        log.observations.push({
          article: A,
          at: new Date().toISOString(),
          topic: "Two Department answers on one Request",
          request: `R-${number}`,
          observed,
        });
        STATE.departmentCheck = { number, contract: conv.convertedRecord.number, sent, owning };
        if (ids.length > 1 && JSON.stringify(owning) !== JSON.stringify(staff.department))
          bug({
            article: A,
            symptom:
              "With the built-in Department Row On intake form, the Portal form asks Department twice: the fixed Department basic (required) and a second Department question (optional, starts at Not set). The Request stores both. Conversion takes the second answer as the new Contract's Department and ignores the Department basic that Legal saw on the Request.",
            reproduction: observed,
            effect:
              "The guide says Department identifies the business team and that conversion carries it to the new record. Under this configuration the record gets the second answer instead.",
          });
        return observed;
      },
      page,
    );
  } finally {
    must(await L.api(daniel, "PUT", formPath, { form: STATE.form }), "restore form");
    await daniel.context().close();
    await nadia.context().close();
    await page.context().close();
  }
}

// ---------------------------------------------------------------- V-C10
async function followPhase() {
  const A = "follow-request";
  const R = "business_user";
  const Q = {};
  const F = STATE.fields;
  const { page: nadia } = await L.staffContext(L.PEOPLE.nadia);
  const { page } = await L.portalContext(L.PEOPLE.jonas);
  const legal = {};

  const nadiaMe = must(await L.api(nadia, "GET", "/me"), "me").user;
  const post = async (entityType, entityId, visibility, body, filename) => {
    const multipart = { entityType, entityId, body, visibility };
    if (filename) multipart.file = pdfFile(filename);
    return L.api(nadia, "POST", "/comments", undefined, multipart);
  };

  const RESUME = process.env.RESUME_FOLLOW
    ? process.env.RESUME_FOLLOW.split(",").map(Number)
    : null;
  if (RESUME) {
    // Continue an earlier run's Requests (same RUN_STAMP) after a harness fault, without new Requests.
    const keys = ["open", "contract", "matter", "resolved", "declined", "older"];
    for (const [i, key] of keys.entries()) {
      const r = must(await L.api(nadia, "GET", `/requests/${RESUME[i]}`), "resume read").request;
      Q[key] = {
        number: r.number,
        id: r.id,
        title: r.title,
        original: `doc030-original-${key}-${runStamp}.pdf`,
      };
      const tag = `${key} ${runStamp}`;
      legal[key] = {
        full: `DOC-030 portal Legal full thread ${tag}`,
        legalOnly: `DOC-030 portal Legal only note ${tag}`,
        working: `DOC-030 portal Working team note ${tag}`,
        file: `doc030-legal-${key}-${runStamp}.pdf`,
      };
    }
  } else {
    await step(
      A,
      R,
      "Setup: Jonas has Requests to follow (created through the API; the form itself is V-C09)",
      "Five Requests with one original PDF each",
      async () => {
        const types = must(await L.api(page, "GET", "/portal/request-types"), "types").requestTypes;
        const bySlug = Object.fromEntries(types.map((t) => [t.slug, t]));
        const form = must(
          await L.api(page, "GET", `/portal/request-types/${STATE.requestType.slug}`),
          "form",
        );
        const engineering = form.departments.find((d) => d.displayName === "Engineering");
        const common = {
          [F.reason.slug]: "DOC-030 portal: follow-up reason.",
          entity: STATE.entity.id,
        };
        const plan = [
          [
            "open",
            STATE.requestType.slug,
            { ...common, term_type: "fixed", expiry_date: "2027-06-30" },
          ],
          ["contract", STATE.requestType.slug, { ...common, term_type: "evergreen" }],
          ["matter", "legal_question", {}],
          ["resolved", "legal_question", {}],
          ["declined", "legal_question", {}],
          ["older", "legal_question", {}],
        ];
        for (const [key, slug, extra] of plan) {
          const title = `DOC-030 portal follow ${key} ${runStamp}`;
          const r = must(
            await L.api(page, "POST", "/requests", {
              requestTypeId: bySlug[slug].id,
              departmentId: engineering.id,
              title,
              urgency: "high",
              customFields: { description: `DOC-030 portal description for ${key}.`, ...extra },
            }),
            `request ${key}`,
          ).request;
          const original = `doc030-original-${key}-${runStamp}.pdf`;
          must(
            await L.api(page, "POST", `/requests/${r.number}/attachments`, undefined, {
              file: pdfFile(original),
            }),
            `attach ${key}`,
          );
          Q[key] = { number: r.number, id: r.id, title, slug, original };
        }
        return Object.entries(Q)
          .map(([k, q]) => `${k}: R-${q.number} (${q.slug})`)
          .join("; ");
      },
    );
    await step(
      A,
      "legal_team_member",
      "Setup: Legal replies at every audience before any decision, and assigns R-open",
      "Full thread (with paper) and Legal only comments post on each Request; R-open is assigned to Nadia; statuses stay new",
      async () => {
        const out = [];
        for (const key of ["open", "contract", "matter", "resolved", "declined"]) {
          const q = Q[key];
          const tag = `${key} ${runStamp}`;
          legal[key] = {
            full: `DOC-030 portal Legal full thread ${tag}`,
            legalOnly: `DOC-030 portal Legal only note ${tag}`,
            working: `DOC-030 portal Working team note ${tag}`,
            file: `doc030-legal-${key}-${runStamp}.pdf`,
          };
          must(
            await post("request", q.id, "full_thread", legal[key].full, legal[key].file),
            "full",
          );
          must(await post("request", q.id, "legal_only", legal[key].legalOnly), "legal only");
          const w = await post("request", q.id, "working_team", legal[key].working);
          out.push(`R-${q.number}: full+file, legal_only, working_team HTTP ${w.status}`);
        }
        must(
          await L.api(nadia, "PATCH", `/requests/${Q.open.number}/assignee`, {
            assigneeId: nadiaMe.id,
          }),
          "assign",
        );
        const st = must(await L.api(nadia, "GET", `/requests/${Q.open.number}`), "read").request
          .status;
        expect(st === "new", `status after setup ${st}`);
        return (
          out.join("; ") +
          `; R-${Q.open.number} assigned to ${nadiaMe.displayName}; its status is still "${st}".`
        );
      },
    );

    const q = Q.open ?? {};
    await step(
      A,
      R,
      "Open your Request, step 1: Your requests row shows reference, title, type, age, Legal Owner and status",
      "The R-open row shows R-n, the title, the request type, an age, Legal Owner: Nadia Haddad and Open",
      async () => {
        await page.goto(`${L.BASE}/portal`);
        const row = page
          .getByRole("region", { name: "Your requests" })
          .getByRole("link", { name: new RegExp(q.title) });
        await row.waitFor({ timeout: 20000 });
        const t = await text(row);
        const age = await row.locator("time").innerText();
        expect(
          t.includes(`R-${q.number}`) &&
            t.includes(STATE.requestType.name) &&
            t.includes("Legal Owner: Nadia Haddad") &&
            /Open$/.test(t),
          t,
        );
        return `Row: "${t}" (age "${age}").`;
      },
      page,
    );

    await step(
      A,
      R,
      "Open your Request, steps 2 and 3: title, meta line, Open status, Legal Owner card and banner",
      "Meta line R-n · type · Submitted date; status Open; Legal Owner card names Nadia Haddad; banner explains Open; no Attach new files to a reply link",
      async () => {
        await page
          .getByRole("region", { name: "Your requests" })
          .getByRole("link", { name: new RegExp(q.title) })
          .click();
        await page.waitForURL(new RegExp(`/portal/requests/${q.number}$`));
        await page.getByRole("heading", { level: 1, name: q.title }).waitFor();
        const main = page.getByRole("main");
        const meta = await text(main.getByText(new RegExp(`^R-${q.number} ·`)));
        const status = await pill(page);
        const card = await ownerCard(page);
        const banner = await text(main.getByText(/^Legal has received your request/));
        const replyLink = await main
          .getByRole("link", { name: "Attach new files to a reply" })
          .count();
        expect(
          status === "Open" && card.includes("Nadia Haddad") && replyLink === 0,
          `${status} ${card} ${replyLink}`,
        );
        expect(meta.startsWith(`R-${q.number} · ${STATE.requestType.name} · Submitted`), meta);
        return `Meta "${meta}"; status "${status}"; card "${card}"; banner "${banner}"; reply link count ${replyLink}.`;
      },
      page,
    );

    await step(
      A,
      R,
      "Reply and send further files: reply while the Request is Open",
      "The reply posts and appears; the status stays Open",
      async () => {
        const panel = await openComments(page);
        const msg = `DOC-030 portal Jonas reply while open ${runStamp}`;
        await panel.getByRole("textbox", { name: "New comment" }).fill(msg);
        await panel.getByRole("button", { name: "Comment", exact: true }).click();
        await panel.getByText(msg).waitFor({ timeout: 20000 });
        await page.reload();
        await page.getByRole("heading", { level: 1, name: q.title }).waitFor();
        const status = await pill(page);
        expect(status === "Open", status);
        return `Posted "${msg}"; after reload the status is ${status}.`;
      },
      page,
    );

    await step(
      A,
      "legal_team_member",
      "Status table, Read: Nadia opens the Request in the Inbox",
      "The Inbox page opens R-open; the staff read then shows status read",
      async () => {
        await nadia.goto(`${L.BASE}/inbox/${q.number}`);
        await nadia.getByText(q.title).first().waitFor({ timeout: 20000 });
        let st = null;
        for (let i = 0; i < 20 && st !== "read"; i++) {
          st = must(await L.api(nadia, "GET", `/requests/${q.number}`), "read").request.status;
          if (st !== "read") await nadia.waitForTimeout(500);
        }
        expect(st === "read", `status ${st}`);
        return `Nadia opened /inbox/${q.number} in her browser; the staff read now shows status "${st}".`;
      },
      nadia,
    );

    await step(
      A,
      R,
      "Status table, Read: the Requester sees Read with its banner, on the page and in Your requests",
      "Status Read; banner Your request has been opened by the Legal team.; no Attach new files to a reply link; the list row shows Read",
      async () => {
        await page.reload();
        await page.getByRole("heading", { level: 1, name: q.title }).waitFor();
        const main = page.getByRole("main");
        const status = await pill(page);
        const banner = await text(
          main.getByText("Your request has been opened by the Legal team."),
        );
        const replyLink = await main
          .getByRole("link", { name: "Attach new files to a reply" })
          .count();
        await page.goto(`${L.BASE}/portal`);
        const row = await text(
          page
            .getByRole("region", { name: "Your requests" })
            .getByRole("link", { name: new RegExp(q.title) }),
        );
        expect(
          status === "Read" && replyLink === 0 && /Read$/.test(row),
          `${status} ${replyLink} ${row}`,
        );
        await page.goto(`${L.BASE}/portal/requests/${q.number}`);
        await page.getByRole("heading", { level: 1, name: q.title }).waitFor();
        return `Status "${status}"; banner "${banner}"; reply link count ${replyLink}; Your requests row "${row}".`;
      },
      page,
    );

    await step(
      A,
      R,
      "Open your Request, step 4: Comments shows Legal's shared replies only; History lists the shared conversation",
      "Full thread replies and files show; Legal only and Working team notes do not; no audience choice; History lists conversation activity without the Legal only note",
      async () => {
        const panel = await openComments(page);
        await panel.getByText(legal.open.full).waitFor({ timeout: 20000 });
        const body = await text(panel);
        const radios = await panel.getByRole("radio").count();
        const audience = await panel.getByText("Audience", { exact: true }).count();
        expect(
          !body.includes(legal.open.legalOnly) && !body.includes(legal.open.working),
          "restricted note visible",
        );
        expect(radios === 0 && audience === 0, `radios ${radios} audience ${audience}`);
        const history = await openApplet(page, "History");
        await history
          .getByText(/Nothing has happened|could not be read/)
          .or(history.getByRole("list").first())
          .first()
          .waitFor({ timeout: 20000 });
        await page.waitForTimeout(1000);
        const hist = await text(history);
        expect(
          !hist.includes(legal.open.legalOnly) && !hist.includes(legal.open.working),
          "History shows a restricted note",
        );
        return `Comments showed "${legal.open.full}" with ${legal.open.file} and Jonas's reply; Legal only and Working team texts absent; radios ${radios}, Audience label ${audience}. History panel: "${hist.slice(0, 500)}".`;
      },
      page,
    );

    await step(
      A,
      R,
      "Open your Request, step 5: What you submitted shows the saved answers and the original attachment",
      "Description, original attachment (downloads with the same bytes), Department, Urgency and answered Rows",
      async () => {
        const card = page.getByRole("region", { name: "What you submitted" });
        const body = await text(card);
        for (const want of [
          "DOC-030 portal description for open.",
          q.original,
          "Engineering",
          "High",
          STATE.entity.name,
          "follow-up reason",
        ])
          expect(body.includes(want), `missing ${want}: ${body}`);
        const d = await downloadVia(page, card.getByRole("link", { name: q.original }));
        expect(sha(d.bytes) === sha(pdfFile(q.original).buffer), "original bytes differ");
        return `What you submitted: "${body}"; selecting ${q.original} downloaded ${d.filename} with the original bytes.`;
      },
      page,
    );

    await step(
      A,
      R,
      "Reply and send further files, steps 1 to 4, while the Request is Read",
      "Comment stays unavailable with no message and with only a file; the reply and file appear; filename opens a preview; the download control saves the file; status stays Read; Legal reads it",
      async () => {
        const panel = await openComments(page);
        const send = panel.getByRole("button", { name: "Comment", exact: true });
        const emptyDisabled = await send.isDisabled();
        const replyFile = `doc030-jonas-reply-read-${runStamp}.pdf`;
        const extra = `doc030-jonas-unintended-${runStamp}.pdf`;
        const [fc] = await Promise.all([
          page.waitForEvent("filechooser"),
          panel.getByRole("button", { name: "Attach files" }).click(),
        ]);
        await fc.setFiles([pdfFile(replyFile), pdfFile(extra)]);
        await panel.getByRole("button", { name: `Remove ${extra}` }).click();
        const extraLeft = await panel.getByText(extra).count();
        const fileOnlyDisabled = await send.isDisabled();
        const msg = `DOC-030 portal Jonas reply while read ${runStamp}`;
        await panel.getByRole("textbox", { name: "New comment" }).fill(msg);
        const enabled = await send.isEnabled();
        await send.click();
        await panel.getByText(msg).waitFor({ timeout: 20000 });
        await panel.getByRole("button", { name: replyFile }).click();
        const preview = page.getByRole("dialog");
        await preview.waitFor({ timeout: 15000 });
        const previewText = await text(preview);
        await preview.getByRole("button", { name: /Close/ }).first().click();
        const d = await downloadVia(
          page,
          panel.getByRole("link", { name: `Download ${replyFile}` }),
        );
        await page.reload();
        await page.getByRole("heading", { level: 1, name: q.title }).waitFor();
        const status = await pill(page);
        const staff = must(
          await L.api(nadia, "GET", `/comments?entityType=request&entityId=${q.id}`),
          "staff comments",
        ).comments.filter((c) => c.body === msg);
        expect(
          emptyDisabled && fileOnlyDisabled && enabled,
          `disabled ${emptyDisabled}/${fileOnlyDisabled} enabled ${enabled}`,
        );
        expect(extraLeft === 0, "removed file still listed");
        expect(
          staff.length === 1 && staff[0].attachments.some((a) => a.filename === replyFile),
          "staff read",
        );
        expect(sha(d.bytes) === sha(pdfFile(replyFile).buffer), "reply file bytes differ");
        expect(status === "Read", `status ${status}`);
        return `Comment disabled when empty (${emptyDisabled}) and with only a file (${fileOnlyDisabled}); Remove took ${extra} off; posted "${msg}" with ${replyFile}. Selecting the filename opened a preview ("${previewText.slice(0, 160)}"); the "Download ${replyFile}" control saved the same bytes. After reload the status stayed ${status}; Nadia's API read shows the reply with its file.`;
      },
      page,
    );
  }
  await step(
    A,
    "legal_team_member",
    "Setup: Legal converts, resolves and declines through the API, then posts later replies",
    "Contract and Matter conversions, a resolution with a reply, a decline with a reason; later Full thread and Legal only replies; 55 markers on R-older",
    async () => {
      const already = must(
        await L.api(nadia, "GET", `/requests/${Q.contract.number}`),
        "read",
      ).request;
      const c = already.convertedRecord
        ? already
        : must(
            await L.api(nadia, "POST", `/requests/${Q.contract.number}/convert`, {
              title: Q.contract.title,
              contractTypeId: STATE.contractType.id,
            }),
            "convert contract",
          ).request;
      const m = must(
        await L.api(nadia, "POST", `/requests/${Q.matter.number}/convert`, {
          title: Q.matter.title,
        }),
        "convert matter",
      ).request;
      const cr = must(
        await L.api(nadia, "GET", `/contracts/${c.convertedRecord.number}`),
        "contract",
      );
      const mr = must(await L.api(nadia, "GET", `/matters/${m.convertedRecord.number}`), "matter");
      STATE.contract = { ...c.convertedRecord, id: (cr.contract ?? cr).id };
      STATE.matter = { ...m.convertedRecord, id: (mr.matter ?? mr).id };
      must(
        await L.api(nadia, "POST", `/requests/${Q.resolved.number}/resolve`, {
          reply: `DOC-030 portal resolution reply ${runStamp}`,
        }),
        "resolve",
      );
      must(
        await L.api(nadia, "POST", `/requests/${Q.declined.number}/decline`, {
          reason: `DOC-030 portal decline reason ${runStamp}`,
        }),
        "decline",
      );
      const targets = [
        ["resolved", "request", Q.resolved.id],
        ["declined", "request", Q.declined.id],
        ["contract", "contract", STATE.contract.id],
        ["matter", "matter", STATE.matter.id],
      ];
      for (const [key, type, id] of targets) {
        legal[key].later = `DOC-030 portal Legal later reply ${key} ${runStamp}`;
        legal[key].laterFile = `doc030-legal-later-${key}-${runStamp}.pdf`;
        legal[key].laterNote = `DOC-030 portal Legal later legal-only ${key} ${runStamp}`;
        must(
          await post(type, id, "full_thread", legal[key].later, legal[key].laterFile),
          `later ${key}`,
        );
        must(await post(type, id, "legal_only", legal[key].laterNote), `later note ${key}`);
      }
      for (let i = 1; i <= 55; i++)
        must(
          await post(
            "request",
            Q.older.id,
            "full_thread",
            `DOC-030 portal older marker ${String(i).padStart(2, "0")} ${runStamp}`,
          ),
          "marker",
        );
      return `R-${Q.contract.number} converted to C-${STATE.contract.number}; R-${Q.matter.number} converted to M-${STATE.matter.number}; R-${Q.resolved.number} resolved with a reply; R-${Q.declined.number} declined with a reason; later replies posted; 55 markers on R-${Q.older.number}.`;
    },
  );

  await step(
    A,
    R,
    "Your requests: resolved and declined rows remain; converted Requests leave the list",
    "Rows for R-resolved and R-declined with their status; no rows for R-contract and R-matter",
    async () => {
      await page.goto(`${L.BASE}/portal`);
      const list = page.getByRole("region", { name: "Your requests" });
      await list.waitFor();
      await list
        .getByRole("link", { name: new RegExp(Q.resolved.title) })
        .waitFor({ timeout: 20000 });
      const rows = {};
      for (const key of ["resolved", "declined", "contract", "matter"]) {
        const row = list.getByRole("link", { name: new RegExp(Q[key].title) });
        rows[key] = (await row.count()) ? await text(row) : null;
      }
      expect(
        /Resolved$/.test(rows.resolved ?? "") &&
          /Declined$/.test(rows.declined ?? "") &&
          !rows.contract &&
          !rows.matter,
        JSON.stringify(rows),
      );
      return `Rows: "${rows.resolved}" || "${rows.declined}"; converted R-${Q.contract.number} and R-${Q.matter.number} not listed.`;
    },
    page,
  );

  for (const key of ["resolved", "declined"]) {
    const r = Q[key];
    const want = key === "resolved" ? "Resolved" : "Declined";
    await step(
      A,
      R,
      `Status table, ${want}: open R-${key}, read the banner and the conversation`,
      key === "resolved"
        ? "Status Resolved; banner says Legal answered and closed it; the resolution is in Comments; Attach new files to a reply link"
        : "Status Declined; the reason is in the status banner; Attach new files to a reply link",
      async () => {
        await page.goto(`${L.BASE}/portal`);
        await page
          .getByRole("region", { name: "Your requests" })
          .getByRole("link", { name: new RegExp(r.title) })
          .click();
        await page.waitForURL(new RegExp(`/portal/requests/${r.number}$`));
        await page.getByRole("heading", { level: 1, name: r.title }).waitFor();
        const main = page.getByRole("main");
        const status = await pill(page);
        const banner = await text(main.getByText(/^Legal (has answered|declined)/));
        const replyLink = await main
          .getByRole("link", { name: "Attach new files to a reply" })
          .count();
        const panel = await openComments(page);
        await panel.getByText(legal[key].later).waitFor({ timeout: 20000 });
        const body = await text(panel);
        expect(status === want && replyLink === 1, `${status} ${replyLink}`);
        if (key === "resolved")
          expect(
            body.includes(`DOC-030 portal resolution reply ${runStamp}`),
            "resolution missing",
          );
        else expect(banner.includes(`DOC-030 portal decline reason ${runStamp}`), banner);
        expect(
          !body.includes(legal[key].legalOnly) &&
            !body.includes(legal[key].laterNote) &&
            !body.includes(legal[key].working),
          "restricted note visible",
        );
        return `Status "${status}"; banner "${banner}"; reply link count ${replyLink}; Comments hold "${legal[key].full}" and "${legal[key].later}"${key === "resolved" ? " and the resolution reply" : ""}, without the Legal only and Working team notes.`;
      },
      page,
    );

    await step(
      A,
      R,
      `Reply and send further files on R-${key}: Attach new files to a reply opens the composer; the reply does not reopen it`,
      "The link goes to #portal-request-composer; the reply and file post; the status stays the same",
      async () => {
        await page.getByRole("link", { name: "Attach new files to a reply" }).click();
        await page.waitForURL(/#portal-request-composer$/);
        const panel = await openComments(page);
        const replyFile = `doc030-jonas-reply-${key}-${runStamp}.pdf`;
        const [fc] = await Promise.all([
          page.waitForEvent("filechooser"),
          panel.getByRole("button", { name: "Attach files" }).click(),
        ]);
        await fc.setFiles([pdfFile(replyFile)]);
        const msg = `DOC-030 portal Jonas reply ${key} ${runStamp}`;
        await panel.getByRole("textbox", { name: "New comment" }).fill(msg);
        await panel.getByRole("button", { name: "Comment", exact: true }).click();
        await panel.getByText(msg).waitFor({ timeout: 20000 });
        await panel
          .getByRole("link", { name: `Download ${replyFile}` })
          .waitFor({ timeout: 20000 });
        await page.reload();
        await page.getByRole("heading", { level: 1, name: r.title }).waitFor();
        const status = await pill(page);
        expect(status === want, `status ${status}`);
        return `The link opened #portal-request-composer; posted "${msg}" with ${replyFile}; after reload the status stayed ${status}.`;
      },
      page,
    );
  }

  for (const key of ["contract", "matter"]) {
    const r = Q[key];
    const rec = STATE[key];
    await step(
      A,
      R,
      `Converted R-${key}: the Request address opens the resulting ${key}`,
      "Redirect to the record; Original request shows the ask; Jonas is Business Owner on the team; Fields card lists Visible on Portal Fields with Not recorded for empty ones; Comments show Full thread only; a reply posts on the record",
      async () => {
        await page.goto(`${L.BASE}/portal/requests/${r.number}`);
        await page.waitForURL(new RegExp(`/portal/${key}s/${rec.number}$`), { timeout: 20000 });
        const main = page.getByRole("main");
        await main.getByText("Original request").first().waitFor({ timeout: 20000 });
        const orig = await text(
          main.getByText("Original request").first().locator("xpath=ancestor::section[1]"),
        );
        expect(
          orig.includes(`DOC-030 portal description for ${key}.`),
          `original: ${orig.slice(0, 300)}`,
        );
        const fields = await text(main.getByRole("region", { name: "Fields" }));
        const teamLabel = key === "contract" ? "Contract team" : "Matter team";
        const team = await openApplet(page, teamLabel);
        await team.getByText("Jonas Weber").first().waitFor({ timeout: 15000 });
        const teamText = await text(team);
        expect(/Business Owner/.test(teamText), `team: ${teamText}`);
        const panel = await openComments(page);
        await panel.getByText(legal[key].later).waitFor({ timeout: 20000 });
        const body = await text(panel);
        expect(body.includes(legal[key].full), "full thread from the Request missing");
        expect(
          !body.includes(legal[key].legalOnly) &&
            !body.includes(legal[key].laterNote) &&
            !body.includes(legal[key].working),
          "restricted note visible",
        );
        const msg = `DOC-030 portal Jonas reply on ${key} ${runStamp}`;
        await panel.getByRole("textbox", { name: "New comment" }).fill(msg);
        await panel.getByRole("button", { name: "Comment", exact: true }).click();
        await panel.getByText(msg).waitFor({ timeout: 20000 });
        if (key === "contract") {
          expect(fields.includes("Not recorded"), `no Not recorded in Fields: ${fields}`);
          if (fields.includes(`${F.fixedNote.name} Not recorded`))
            bug({
              article: A,
              symptom: `The Portal record Fields card draws "${F.fixedNote.name}: Not recorded" although that Row sits under the Term type is Fixed Branch and the record's Term type is Evergreen. This confirms the author's product bug (record-work.tsx calls no Form evaluator).`,
              reproduction: `C-${rec.number} from R-${r.number}; Fields card: "${fields}".`,
              effect: "The guide's sentence (a Field without a value shows Not recorded) holds.",
            });
        }
        return `/portal/requests/${r.number} went to /portal/${key}s/${rec.number}. Original request: "${orig.slice(0, 200)}". Fields card: "${fields.slice(0, 400)}". ${teamLabel}: "${teamText.slice(0, 200)}". Comments show the Full thread replies and not the Legal only or Working team notes; reply "${msg}" posted on the record.`;
      },
      page,
    );
  }

  await step(
    A,
    R,
    "Open your Request, step 4: Show older loads earlier replies",
    "The conversation first shows the newest page; Show older adds the earlier replies",
    async () => {
      await page.goto(`${L.BASE}/portal/requests/${Q.older.number}`);
      const panel = await openComments(page);
      await panel
        .getByText(`DOC-030 portal older marker 55 ${runStamp}`)
        .waitFor({ timeout: 20000 });
      const re = new RegExp(`^DOC-030 portal older marker \\d\\d ${runStamp}$`);
      const before = await panel.getByText(re).count();
      const hadFirst = await panel.getByText(`DOC-030 portal older marker 01 ${runStamp}`).count();
      await panel.getByRole("button", { name: "Show older" }).click();
      await panel
        .getByText(`DOC-030 portal older marker 01 ${runStamp}`)
        .waitFor({ timeout: 20000 });
      const after = await panel.getByText(re).count();
      expect(
        before < 55 && hadFirst === 0 && after === 55,
        `before ${before} first ${hadFirst} after ${after}`,
      );
      return `R-${Q.older.number}: ${before} markers before Show older (marker 01 absent), ${after} after.`;
    },
    page,
  );

  await step(
    A,
    R,
    "If it does not work: a failed reply keeps its text and files; Comment again posts once",
    "Error shows, text and file stay; retry posts one reply",
    async () => {
      await page.goto(`${L.BASE}/portal/requests/${Q.open.number}`);
      const panel = await openComments(page);
      const msg = `DOC-030 portal retry reply ${runStamp}`;
      const f = `doc030-retry-${runStamp}.pdf`;
      await panel.getByRole("textbox", { name: "New comment" }).fill(msg);
      const [fc] = await Promise.all([
        page.waitForEvent("filechooser"),
        panel.getByRole("button", { name: "Attach files" }).click(),
      ]);
      await fc.setFiles([pdfFile(f)]);
      await page.route("**/api/v1/comments", (route) =>
        route.request().method() === "POST" ? route.abort("failed") : route.continue(),
      );
      await panel.getByRole("button", { name: "Comment", exact: true }).click();
      const err = await text(panel.getByText(/could not be posted/));
      const kept = await panel.getByRole("textbox", { name: "New comment" }).inputValue();
      const fileKept = await panel.getByText(f).count();
      await page.unroute("**/api/v1/comments");
      await panel.getByRole("button", { name: "Comment", exact: true }).click();
      await panel.getByText(msg, { exact: true }).first().waitFor({ timeout: 20000 });
      await page.waitForTimeout(1000);
      const staff = must(
        await L.api(nadia, "GET", `/comments?entityType=request&entityId=${Q.open.id}`),
        "staff",
      ).comments.filter((c) => c.body === msg);
      expect(
        kept === msg && fileKept > 0 && staff.length === 1,
        `kept ${kept} file ${fileKept} posted ${staff.length}`,
      );
      return `Error "${err}"; text kept, ${f} kept; retry posted ${staff.length} reply.`;
    },
    page,
  );

  await step(
    A,
    R,
    "If it does not work: the conversation could not be read; close and reopen Comments",
    "Error text shows; reopening the panel reads the conversation",
    async () => {
      await page.route("**/api/v1/comments?*", (route) => route.abort("failed"));
      await page.goto(`${L.BASE}/portal/requests/${Q.open.number}`);
      const panel = await openComments(page);
      const err = await text(panel.getByText(/could not be read/).first());
      await page.unroute("**/api/v1/comments?*");
      await panel.getByRole("button", { name: "Close" }).click();
      await panel.waitFor({ state: "hidden", timeout: 10000 });
      const again = await openComments(page);
      await again.getByText(legal.open.full).waitFor({ timeout: 20000 });
      return `Error "${err}"; after Close and reopening Comments the conversation showed Legal's replies.`;
    },
    page,
  );

  await step(
    A,
    R,
    "Clearing triage assignment shows Not assigned yet",
    "The Legal Owner card and Your requests show Not assigned yet",
    async () => {
      must(
        await L.api(nadia, "PATCH", `/requests/${Q.open.number}/assignee`, { assigneeId: null }),
        "unassign",
      );
      await page.goto(`${L.BASE}/portal/requests/${Q.open.number}`);
      await page.getByRole("heading", { level: 1, name: Q.open.title }).waitFor();
      const card = await ownerCard(page);
      await page.goto(`${L.BASE}/portal`);
      const row = await text(
        page
          .getByRole("region", { name: "Your requests" })
          .getByRole("link", { name: new RegExp(Q.open.title) }),
      );
      expect(
        card.includes("Not assigned yet") && row.includes("Legal Owner: Not assigned yet"),
        `${card} / ${row}`,
      );
      return `Legal Owner card "${card}"; list row "${row}".`;
    },
    page,
  );

  await step(
    A,
    R,
    "Negative: a second Business User cannot open Jonas's Requests or files",
    "Amara's browser returns to /portal; the API answers 404 for the Request and its attachment; the converted addresses also return to /portal",
    async () => {
      const { page: amara } = await L.portalContext(L.PEOPLE.amara);
      const out = [];
      for (const key of ["open", "resolved", "contract"]) {
        await amara.goto(`${L.BASE}/portal/requests/${Q[key].number}`);
        await amara.waitForURL(/\/portal$/, { timeout: 15000 });
        out.push(`R-${Q[key].number} -> /portal`);
      }
      const detail = must(await L.api(page, "GET", `/portal/requests/${Q.open.number}`), "detail");
      const att = detail.attachments[0];
      const a1 = await L.api(amara, "GET", `/portal/requests/${Q.open.number}`);
      const a2 = await amara.request.get(
        `${L.BASE}/api/v1/portal/requests/${Q.open.number}/attachments/${att.id}`,
      );
      await amara.goto(`${L.BASE}/portal/contracts/${STATE.contract.number}`);
      await amara.waitForTimeout(2500);
      const contractPath = new URL(amara.url()).pathname;
      const contractBody = await text(amara.getByRole("main"));
      await amara.context().close();
      expect(a1.status === 404 && a2.status() === 404, `api ${a1.status}/${a2.status()}`);
      expect(!contractBody.includes(Q.contract.title), "Amara saw the contract title");
      return `${out.join("; ")}; API detail ${a1.status}, attachment ${a2.status()}; /portal/contracts/${STATE.contract.number} left Amara at ${contractPath} without the record title.`;
    },
  );

  await step(
    A,
    R,
    "Negative: Legal-only conversation and internal work details stay unavailable to Jonas",
    "Jonas's staff API reads are refused; staff record pages send him to the Portal; the Portal Request read carries no Legal only text",
    async () => {
      const s1 = await L.api(page, "GET", `/requests/${Q.open.number}`);
      const s2 = await L.api(page, "GET", `/comments?entityType=request&entityId=${Q.open.id}`);
      const portalRead = JSON.stringify(
        must(await L.api(page, "GET", `/portal/requests/${Q.open.number}`), "portal read"),
      );
      await page.goto(`${L.BASE}/inbox/${Q.open.number}`);
      await page.waitForTimeout(2500);
      const p0 = new URL(page.url()).pathname;
      await page.goto(`${L.BASE}/matters/${STATE.matter.number}`);
      await page.waitForTimeout(2500);
      const p1 = new URL(page.url()).pathname;
      const commentBodies = s2.status === 200 ? s2.body.comments.map((c) => c.body) : [];
      expect(s1.status === 403 || s1.status === 404, `staff read ${s1.status}`);
      expect(
        !commentBodies.includes(legal.open.legalOnly) &&
          !commentBodies.includes(legal.open.working),
        "legal-only readable",
      );
      expect(!portalRead.includes(legal.open.legalOnly), "legal-only in portal read");
      expect(p0.startsWith("/portal") && p1.startsWith("/portal"), `${p0} ${p1}`);
      return `Staff Request read HTTP ${s1.status}; comment list HTTP ${s2.status} with ${commentBodies.length} bodies, none Legal only or Working team; Portal Request read carries no Legal only text; /inbox/${Q.open.number} ended at ${p0}; /matters/${STATE.matter.number} ended at ${p1}.`;
    },
    page,
  );

  await step(
    A,
    R,
    "Team row removed: the old Request link no longer opens the live record",
    "After Legal removes Jonas from the Matter team, the Request address returns to the Portal home",
    async () => {
      const jonasId = must(await L.api(page, "GET", "/me"), "me").user.id;
      const first = await L.api(nadia, "DELETE", `/matters/${STATE.matter.number}/team/${jonasId}`);
      const owner = must(
        await L.api(nadia, "PATCH", `/matters/${STATE.matter.number}`, { businessOwnerId: null }),
        "clear Business Owner",
      );
      void owner;
      const del = await L.api(nadia, "DELETE", `/matters/${STATE.matter.number}/team/${jonasId}`);
      if (del.status >= 300)
        throw new Error(
          `team removal refused: HTTP ${del.status} ${JSON.stringify(del.body).slice(0, 200)}`,
        );
      await page.goto(`${L.BASE}/portal/requests/${Q.matter.number}`);
      await page.waitForURL(/\/portal$/, { timeout: 15000 });
      return `Legal's first team-row removal answered HTTP ${first.status} "${first.body?.title ?? ""}"; Legal then cleared the Matter's Business Owner and the removal answered HTTP ${del.status}. /portal/requests/${Q.matter.number} then returned to /portal.`;
    },
    page,
  );

  await step(
    A,
    R,
    "Archived destination: the Request address shows the original ask and an archived notice",
    "Notice text, original ask, no Comments applet and no attachment links",
    async () => {
      const arch = await L.api(nadia, "POST", `/contracts/${STATE.contract.number}/archive`, {});
      if (arch.status >= 300)
        throw new Error(
          `archive refused: HTTP ${arch.status} ${JSON.stringify(arch.body).slice(0, 200)}`,
        );
      await page.goto(`${L.BASE}/portal/requests/${Q.contract.number}`);
      await page
        .getByRole("heading", { level: 1, name: Q.contract.title })
        .waitFor({ timeout: 20000 });
      const main = page.getByRole("main");
      const notice = await text(main.getByText(/was archived/));
      const card = await text(main.getByRole("region", { name: "What you submitted" }));
      const commentsBtn = await page
        .getByRole("toolbar", { name: "Applets" })
        .getByRole("button", { name: "Comments" })
        .count();
      const fileLinks = await main
        .getByRole("region", { name: "What you submitted" })
        .getByRole("link")
        .count();
      expect(commentsBtn === 0 && fileLinks === 0, `comments ${commentsBtn} links ${fileLinks}`);
      return `Archive HTTP ${arch.status}; notice "${notice}"; What you submitted "${card.slice(0, 300)}"; Comments applet buttons ${commentsBtn}; attachment links ${fileLinks}.`;
    },
    page,
  );
  STATE.follow = Object.fromEntries(Object.entries(Q).map(([k, v]) => [k, `R-${v.number}`]));
  log.followRequests = STATE.follow;
  save();
  await page.context().close();
  await nadia.context().close();
}

try {
  if (PHASES.includes("submit")) await submitPhase();
  if (PHASES.includes("department")) await departmentPhase();
  if (PHASES.includes("follow")) await followPhase();
} finally {
  save();
  await L.close();
}
