// DOC-029 independent walkthrough, group "portal", round 1.
// Written by the DOC-029 independent walkthrough agent (portal, round 1) from the article text:
//   docs/user-guides/submit-request.md   (V-C09)
//   docs/user-guides/follow-request.md   (V-C10)
//   docs/user-guides/portal-knowledge.md (V-C11)
// Run from the worktree root after fixtures-r1.mjs:
//   LAB_SEED_PASSWORD=... STATE=<private state file> PHASES=submit,follow,knowledge mise exec -- node docs/documentation/batches/DOC-029/portal/walkthrough-r1.mjs
// Sign-in links, cookies, and passwords stay in memory. The log keeps request numbers, filenames, and observed text only.
import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as L from "./lib-r1.mjs";
import { pdf } from "./pdf-r1.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "../../../../..");
const OUT = process.env.OUT ?? path.join(here, "walkthrough-r1.json");
const STATE = JSON.parse(readFileSync(process.env.STATE, "utf8"));
const PHASES = (process.env.PHASES ?? "submit,follow,knowledge").split(",");
const stamp = STATE.stamp;
const runStamp = Date.now();
const sha = (b) => createHash("sha256").update(b).digest("hex");

const log = existsSync(OUT)
  ? JSON.parse(readFileSync(OUT, "utf8"))
  : {
      kind: "independent-article-walkthrough",
      task: "DOC-029",
      group: "portal",
      round: 1,
      walkthroughReviewer: "DOC-029 independent walkthrough agent (portal, round 1)",
      reviewerKind: "agent",
      appCommit: "3fa407e3a846559914aa1a63249741f30cfb4f69",
      environment: process.env.LAB_PROJECT ?? "openlaw-docs-41255c61-work",
      buildId: process.env.LAB_BUILD ?? null,
      app: L.BASE,
      mail: L.MAIL,
      browser: "Playwright 1.63.0 Chromium, headless; one isolated context per identity",
      articleHashesTested: Object.fromEntries(
        ["submit-request", "follow-request", "portal-knowledge"].map((id) => [
          id,
          sha(readFileSync(path.join(root, `docs/user-guides/${id}.md`))),
        ]),
      ),
      fixtureStamp: stamp,
      runs: [],
      steps: [],
    };
const run = { phases: PHASES, startedAt: new Date().toISOString(), finishedAt: null };
log.runs.push(run);
function save() {
  run.finishedAt = new Date().toISOString();
  writeFileSync(OUT, JSON.stringify(log, null, 2) + "\n");
}

async function step(article, role, name, expected, fn) {
  const entry = {
    article,
    role,
    method: "browser-walkthrough",
    step: name,
    expected,
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
  }
  entry.at = new Date().toISOString();
  console.log(
    `[${article}/${role}] ${entry.result.toUpperCase()} ${name}${entry.result === "fail" ? " :: " + entry.actual : ""}`,
  );
  save();
  return entry;
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
const pdfFile = async (name) => ({ name, mimeType: "application/pdf", buffer: pdf(name) });
async function downloadVia(page, locator) {
  const [dl] = await Promise.all([
    page.waitForEvent("download", { timeout: 20000 }),
    locator.click(),
  ]);
  const p = await dl.path();
  return { filename: dl.suggestedFilename(), bytes: readFileSync(p) };
}
async function openComments(page) {
  const panel = page.getByRole("complementary", { name: "Comments" });
  if (!(await panel.isVisible().catch(() => false))) {
    await page
      .getByRole("toolbar", { name: "Applets" })
      .getByRole("button", { name: "Comments" })
      .click();
  }
  await panel.waitFor({ timeout: 15000 });
  await panel
    .getByRole("list", { name: "Comments" })
    .or(panel.getByText(/Nothing has been said|could not be read/))
    .first()
    .waitFor({ timeout: 20000 });
  return panel;
}

// ---------------------------------------------------------------- V-C09
async function submitPhase() {
  const A = "submit-request";
  const R = "business_user";
  const { page } = await L.portalContext(L.PEOPLE.jonas);
  const posts = [];
  page.on("request", (req) => {
    if (req.method() === "POST" && new URL(req.url()).pathname === "/api/v1/requests")
      posts.push(req.url());
  });
  const title = `DOC-029 portal Review the Northstar evaluation terms ${runStamp}`;
  const chosen = `doc029-northstar-terms-${runStamp}.pdf`;
  const dropped = `doc029-northstar-dropped-${runStamp}.pdf`;
  let number = null;

  await step(
    A,
    R,
    "Portal home: read Before you submit, then select the request type",
    "Home shows request type cards, a Before you submit panel, and Your requests; selecting NDA request opens its form",
    async () => {
      await page.goto(`${L.BASE}/portal`);
      await page.getByRole("heading", { level: 1, name: "What do you need from Legal?" }).waitFor();
      const panel = page.getByRole("region", { name: "Before you submit" });
      const links = await panel.getByRole("link").allInnerTexts();
      expect(links.length > 0, "no Before you submit links");
      await page.getByRole("region", { name: "Your requests" }).waitFor();
      await page
        .getByRole("list", { name: "Request types" })
        .getByRole("link", { name: /NDA request/ })
        .click();
      await page.waitForURL(/\/portal\/new\/nda_request$/);
      await page.getByRole("heading", { level: 1, name: "NDA request" }).waitFor();
      return `Home listed Before you submit links [${links.map((l) => l.replace(/\s+/g, " ").trim()).join("; ")}] and Your requests; the NDA request card opened /portal/new/nda_request`;
    },
  );

  await step(
    A,
    R,
    "Form labels, asterisks, Department default, and Urgency default",
    "Title, Description, Attachments, Department, Urgency and the type's questions show; required ones carry an asterisk; Department starts at the user's own Department; Urgency starts at Medium with Low/Medium/High/Critical",
    async () => {
      const labels = await page.locator("form label").allInnerTexts();
      const clean = labels.map((l) => l.replace(/\s+/g, " ").trim());
      for (const want of [
        "Title",
        "Description",
        "Attachments",
        "Department",
        "Urgency",
        "Counterparty name",
      ]) {
        expect(
          clean.some((l) => l.startsWith(want)),
          `label ${want} missing (${clean.join(" | ")})`,
        );
      }
      const starred = clean.filter((l) => l.includes("*"));
      expect(
        starred.some((l) => l.startsWith("Title")) &&
          starred.some((l) => l.startsWith("Department")) &&
          starred.some((l) => l.startsWith("Counterparty name")),
        `asterisks: ${starred.join(" | ")}`,
      );
      const notStarred = clean.filter((l) => !l.includes("*"));
      const dept = page.getByLabel("Department");
      const deptText = await dept.evaluate((el) =>
        el.options ? el.options[el.selectedIndex]?.textContent : el.textContent,
      );
      expect(/Engineering/.test(deptText ?? ""), `Department started at ${deptText}`);
      const urg = page.getByLabel("Urgency");
      const urgVal = await urg.evaluate((el) => el.options[el.selectedIndex].textContent);
      const urgOpts = await urg.evaluate((el) => [...el.options].map((o) => o.textContent));
      expect(urgVal === "Medium", `Urgency started at ${urgVal}`);
      expect(
        JSON.stringify(urgOpts) === JSON.stringify(["Low", "Medium", "High", "Critical"]),
        `Urgency options ${urgOpts}`,
      );
      return `Labels: ${clean.join(" | ")}. Starred: ${starred.length}; without asterisk: ${notStarred.join(" | ") || "none"}. Department started at "${deptText?.trim()}" (Jonas's Department). Urgency started at Medium; options ${urgOpts.join(", ")}.`;
    },
  );

  await step(
    A,
    R,
    "Submit request with required answers missing",
    "Submission is refused, the missing questions are named and marked, and no Request is sent",
    async () => {
      await page.getByRole("button", { name: "Submit request" }).click();
      const alert = page.locator("form").getByRole("alert");
      await alert.waitFor();
      const said = await text(alert);
      const marks = await page.getByText(/ is required\.$/).allInnerTexts();
      await page.waitForTimeout(500);
      expect(posts.length === 0, "a POST /requests was sent");
      expect(
        /Title/.test(said) && /Description/.test(said) && /Counterparty name/.test(said),
        `alert: ${said}`,
      );
      return `Alert "${said}"; field marks: ${marks.join(" / ")}; POST /api/v1/requests sent: ${posts.length}`;
    },
  );

  await step(
    A,
    R,
    "Attachments: Choose files beyond 20, then remove unintended files",
    "The form keeps only the files that fit (20) and says so; Remove drops a file from the list",
    async () => {
      const many = [];
      for (let i = 1; i <= 21; i++)
        many.push(await pdfFile(`doc029-extra-${String(i).padStart(2, "0")}-${runStamp}.pdf`));
      const [chooser] = await Promise.all([
        page.waitForEvent("filechooser"),
        page.getByRole("button", { name: "Choose files" }).click(),
      ]);
      await chooser.setFiles(many);
      const note = await text(page.getByText(/A request carries at most/));
      const listed = await page.getByRole("button", { name: /^Remove doc029-extra-/ }).count();
      expect(listed === 20, `listed ${listed}`);
      await page
        .getByRole("button", { name: `Remove doc029-extra-21-${runStamp}.pdf` })
        .count()
        .then((c) => expect(c === 0, "21st file kept"));
      for (let i = 20; i >= 1; i--)
        await page
          .getByRole("button", {
            name: `Remove doc029-extra-${String(i).padStart(2, "0")}-${runStamp}.pdf`,
          })
          .click();
      const after = await page.getByRole("button", { name: /^Remove doc029-extra-/ }).count();
      expect(after === 0, `after removal ${after}`);
      return `Chose 21 files: ${listed} listed, the 21st dropped, with "${note}". Remove took each listed file off; ${after} remain.`;
    },
  );

  await step(
    A,
    R,
    "Attachments: select one file with Choose files and drop another onto the form",
    "Both filenames appear in the list",
    async () => {
      const [chooser] = await Promise.all([
        page.waitForEvent("filechooser"),
        page.getByRole("button", { name: "Choose files" }).click(),
      ]);
      await chooser.setFiles([await pdfFile(chosen)]);
      const dropBytes = (await pdfFile(dropped)).buffer.toString("base64");
      const zone = page.getByText(/^Drop files here/).locator("xpath=..");
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
  );

  await step(
    A,
    R,
    "Complete the form and Submit request once; keep the confirmation open",
    "Confirmation names the R- reference, shows Attaching your files while uploads run, reports no failure, and offers Open request",
    async () => {
      await page.getByLabel(/^Title/).fill(title);
      await page
        .getByLabel(/^Description/)
        .fill(
          "DOC-029 portal: Northstar proposes a 60-day evaluation. Counterparty Northstar Evaluation Ltd. Please review the evaluation terms.",
        );
      await page.getByLabel(/^Department/).selectOption({ label: "Procurement" });
      await page.getByLabel(/^Urgency/).selectOption({ label: "High" });
      await page.getByLabel(/^Counterparty name/).fill("Northstar Evaluation Ltd");
      let release;
      const gate = new Promise((r) => (release = r));
      await page.route("**/api/v1/requests/*/attachments", async (route) => {
        await gate;
        await route.continue();
      });
      await page.getByRole("button", { name: "Submit request" }).click();
      const heading = page.getByRole("heading", { name: /^Request R-\d+ is with Legal$/ });
      await heading.waitFor({ timeout: 20000 });
      const head = await text(heading);
      number = Number(head.match(/R-(\d+)/)[1]);
      const uploading = await page.getByText("Attaching your files…").isVisible();
      release();
      await page.getByText("Attaching your files…").waitFor({ state: "hidden", timeout: 20000 });
      await page.unroute("**/api/v1/requests/*/attachments");
      const failures = await page.getByText(/did not attach/).count();
      expect(uploading, "Attaching your files… not shown while uploads were held");
      expect(failures === 0, "a failure was reported");
      expect(posts.length === 1, `POST count ${posts.length}`);
      await page.getByRole("link", { name: "Open request" }).waitFor();
      return `"${head}"; "Attaching your files…" shown while the two uploads were held, then cleared; no failure; one POST /api/v1/requests; Open request offered.`;
    },
  );

  await step(
    A,
    R,
    "Open request and check saved answers and attachments",
    "The Request shows the title, R- reference, description, Department, Urgency, answer, and both files with their original bytes",
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
        "Northstar Evaluation Ltd",
        chosen,
        dropped,
      ])
        expect(body.includes(want), `missing ${want} in: ${body}`);
      const got = [];
      for (const name of [chosen, dropped]) {
        const d = await downloadVia(page, card.getByRole("link", { name }));
        expect(sha(d.bytes) === sha((await pdfFile(name)).buffer), `bytes differ for ${name}`);
        got.push(d.filename);
      }
      const editControls = await card.getByRole("button").count();
      return `Meta "${meta}"; What you submitted: "${body.slice(0, 400)}"; downloads ${got.join(", ")} matched the original bytes; ${editControls} buttons in the card (no edit control).`;
    },
  );

  await step(
    A,
    R,
    "Check Your requests on the Portal home",
    "The new Request appears once under Your requests",
    async () => {
      await page.getByRole("link", { name: "Your requests" }).first().click();
      await page.waitForURL(/\/portal$/);
      const list = page.getByRole("region", { name: "Your requests" });
      const rows = list.getByRole("link", { name: new RegExp(title) });
      await rows
        .first()
        .waitFor({ timeout: 20000 })
        .catch(() => {});
      const count = await rows.count();
      expect(count === 1, `rows ${count}`);
      return `Your requests: "${await text(rows.first())}" (1 row).`;
    },
  );

  await step(
    A,
    "legal_team_member",
    "Legal receives the Request to triage; no Contract or Matter exists until conversion",
    "Staff detail shows the Request as new with no converted record",
    async () => {
      const { page: nadia } = await L.staffContext(L.PEOPLE.nadia);
      const r = must(await L.api(nadia, "GET", `/requests/${number}`), "staff read").request;
      expect(
        r.status === "new" && !r.convertedRecord,
        `status ${r.status} converted ${JSON.stringify(r.convertedRecord)}`,
      );
      await nadia.goto(`${L.BASE}/inbox/${number}`);
      await nadia.getByText(title).first().waitFor({ timeout: 20000 });
      await nadia.context().close();
      return `Nadia's Inbox /inbox/${number} shows the Request; API status "${r.status}", convertedRecord ${JSON.stringify(r.convertedRecord ?? null)}.`;
    },
  );

  await step(
    A,
    "legal_team_member",
    "Department: a Requester without a listed Department must choose one",
    "Department starts empty and submission names Department as missing",
    async () => {
      const { page: staff } = await L.staffContext(L.PEOPLE.nadia);
      await staff.goto(`${L.BASE}/portal/new/legal_question`);
      const dept = staff.getByLabel(/^Department/);
      await dept.waitFor();
      const start = await dept.evaluate((el) => el.options[el.selectedIndex]?.textContent);
      await staff.getByLabel(/^Title/).fill("DOC-029 portal department check (not submitted)");
      await staff.getByLabel(/^Description/).fill("Not submitted.");
      await staff.getByRole("button", { name: "Submit request" }).click();
      const said = await text(staff.locator("form").getByRole("alert"));
      expect(/Department/.test(said), `alert ${said}`);
      await staff.context().close();
      return `Nadia (no Department on her profile) saw Department start at "${start}"; Submit request answered "${said}". Nothing was submitted.`;
    },
  );

  // Attachment failure
  let failedNumber = null;
  const failedName = `doc029-failing-${runStamp}.pdf`;
  await step(
    A,
    R,
    "An attachment fails: the Request still exists and the failure is named",
    "Confirmation reports the named file did not attach and keeps the R- reference; the Request is saved and the file can go on a reply",
    async () => {
      await page.goto(`${L.BASE}/portal/new/legal_question`);
      await page.getByLabel(/^Title/).fill(`DOC-029 portal attachment failure ${runStamp}`);
      await page.getByLabel(/^Description/).fill("DOC-029 portal: checking an attachment failure.");
      const [chooser] = await Promise.all([
        page.waitForEvent("filechooser"),
        page.getByRole("button", { name: "Choose files" }).click(),
      ]);
      await chooser.setFiles([await pdfFile(failedName)]);
      await page.route("**/api/v1/requests/*/attachments", (route) => route.abort("failed"));
      await page.getByRole("button", { name: "Submit request" }).click();
      const heading = page.getByRole("heading", { name: /^Request R-\d+ is with Legal$/ });
      await heading.waitFor({ timeout: 20000 });
      failedNumber = Number((await text(heading)).match(/R-(\d+)/)[1]);
      const alert = page.getByRole("alert").filter({ hasText: "did not attach" });
      await alert.waitFor({ timeout: 20000 });
      const said = await text(alert);
      await page.unroute("**/api/v1/requests/*/attachments");
      expect(said.includes(failedName) && said.includes(`R-${failedNumber}`), said);
      await page.getByRole("link", { name: "Open request" }).click();
      await page.waitForURL(new RegExp(`/portal/requests/${failedNumber}$`));
      const card = await text(page.getByRole("region", { name: "What you submitted" }));
      expect(!card.includes(failedName), "failed file listed");
      const panel = await openComments(page);
      await panel
        .getByRole("textbox", { name: "New comment" })
        .fill(`DOC-029 portal: the file that did not attach to R-${failedNumber}.`);
      const [fc] = await Promise.all([
        page.waitForEvent("filechooser"),
        panel.getByRole("button", { name: "Attach files" }).click(),
      ]);
      await fc.setFiles([await pdfFile(failedName)]);
      await panel.getByRole("button", { name: "Comment", exact: true }).click();
      await panel
        .getByText(`the file that did not attach to R-${failedNumber}`)
        .waitFor({ timeout: 20000 });
      await panel.getByRole("link", { name: `Download ${failedName}` }).waitFor({ timeout: 20000 });
      return `Confirmation "${said}". R-${failedNumber} opened without the file; Jonas sent ${failedName} on a reply in Comments and it appeared in the conversation.`;
    },
  );

  // Decision during upload
  await step(
    A,
    R,
    "Legal decides the Request while its files upload",
    "Confirmation links to a reply on the same Request; the link opens its composer; the submission stays saved",
    async () => {
      const { page: nadia } = await L.staffContext(L.PEOPLE.nadia);
      const raceName = `doc029-race-${runStamp}.pdf`;
      await page.goto(`${L.BASE}/portal/new/legal_question`);
      await page.getByLabel(/^Title/).fill(`DOC-029 portal decided during upload ${runStamp}`);
      await page
        .getByLabel(/^Description/)
        .fill("DOC-029 portal: Legal declines while the file uploads.");
      const [chooser] = await Promise.all([
        page.waitForEvent("filechooser"),
        page.getByRole("button", { name: "Choose files" }).click(),
      ]);
      await chooser.setFiles([await pdfFile(raceName)]);
      await page.route("**/api/v1/requests/*/attachments", async (route) => {
        const n = Number(new URL(route.request().url()).pathname.split("/")[4]);
        must(
          await L.api(nadia, "POST", `/requests/${n}/decline`, {
            reason: "DOC-029 portal: declined during upload.",
          }),
          "decline",
        );
        await route.continue();
      });
      await page.getByRole("button", { name: "Submit request" }).click();
      const heading = page.getByRole("heading", { name: /^Request R-\d+ is with Legal$/ });
      await heading.waitFor({ timeout: 20000 });
      const n = Number((await text(heading)).match(/R-(\d+)/)[1]);
      const alert = page.getByRole("alert").filter({ hasText: "did not attach" });
      await alert.waitFor({ timeout: 20000 });
      const said = await text(alert);
      await page.unroute("**/api/v1/requests/*/attachments");
      const link = alert.getByRole("link", { name: new RegExp(`reply on R-${n}`) });
      await link.click();
      await page.waitForURL(new RegExp(`/portal/requests/${n}#portal-request-composer$`));
      const panel = await openComments(page);
      const composerVisible = await panel.getByRole("textbox", { name: "New comment" }).isVisible();
      await panel
        .getByRole("textbox", { name: "New comment" })
        .fill(`DOC-029 portal: the file that did not attach to R-${n}.`);
      const [fc] = await Promise.all([
        page.waitForEvent("filechooser"),
        panel.getByRole("button", { name: "Attach files" }).click(),
      ]);
      await fc.setFiles([await pdfFile(raceName)]);
      await panel.getByRole("button", { name: "Comment", exact: true }).click();
      await panel.getByText(`the file that did not attach to R-${n}`).waitFor({ timeout: 20000 });
      await panel.getByRole("link", { name: `Download ${raceName}` }).waitFor({ timeout: 20000 });
      const pill = await text(page.locator("main h1").locator("xpath=following-sibling::span[1]"));
      const card = await text(page.getByRole("region", { name: "What you submitted" }));
      expect(
        composerVisible &&
          pill === "Declined" &&
          card.includes("Legal declines while the file uploads"),
        `composer ${composerVisible} pill ${pill}`,
      );
      await nadia.context().close();
      return `Confirmation "${said}"; the link opened /portal/requests/${n}#portal-request-composer with the Comments composer visible; Jonas sent ${raceName} on a reply there; status ${pill}; What you submitted kept the description.`;
    },
  );

  await step(
    A,
    R,
    "A form address that does not exist returns to the Portal home",
    "Unknown form slug redirects to /portal",
    async () => {
      await page.goto(`${L.BASE}/portal/new/doc029-no-such-form`);
      await page.waitForURL(/\/portal$/, { timeout: 15000 });
      return `/portal/new/doc029-no-such-form went to ${new URL(page.url()).pathname}.`;
    },
  );

  await step(
    A,
    R,
    "Submission reports an error without confirmation; Your requests shows no new Request",
    "Error text shows, answers stay, and no Request was saved",
    async () => {
      await page.goto(`${L.BASE}/portal/new/legal_question`);
      const t = `DOC-029 portal network failure ${runStamp}`;
      await page.getByLabel(/^Title/).fill(t);
      await page
        .getByLabel(/^Description/)
        .fill("DOC-029 portal: the submission does not reach the server.");
      await page.route("**/api/v1/requests", (route) =>
        route.request().method() === "POST" ? route.abort("failed") : route.continue(),
      );
      await page.getByRole("button", { name: "Submit request" }).click();
      const said = await text(page.locator("form").getByRole("alert"));
      const kept = await page.getByLabel(/^Title/).inputValue();
      await page.unroute("**/api/v1/requests");
      const mine = must(await L.api(page, "GET", "/portal/requests"), "list").requests.filter(
        (r) => r.title === t,
      ).length;
      expect(
        /could not be submitted/.test(said) && kept === t && mine === 0,
        `${said} kept=${kept} saved=${mine}`,
      );
      return `Alert "${said}"; Title kept; no confirmation; Your requests carries ${mine} Request with that title.`;
    },
  );
  await page.context().close();
}

// ---------------------------------------------------------------- V-C10
async function followPhase() {
  const A = "follow-request";
  const R = "business_user";
  const Q = {};
  const { page: nadia } = await L.staffContext(L.PEOPLE.nadia);
  const { page } = await L.portalContext(L.PEOPLE.jonas);

  await step(
    A,
    R,
    "Setup: Jonas has Requests to follow (created through the API; the form itself is V-C09)",
    "Six Requests with one original PDF each",
    async () => {
      const types = must(await L.api(page, "GET", "/portal/request-types"), "types").requestTypes;
      const bySlug = Object.fromEntries(types.map((t) => [t.slug, t]));
      const engineering = must(
        await L.api(page, "GET", "/portal/request-types/contract_review"),
        "form",
      ).departments.find((d) => d.displayName === "Engineering");
      const plan = [
        ["open", "contract_review", { counterparty_name: "Northstar Evaluation Ltd" }],
        ["contract", "contract_review", { counterparty_name: "Northstar Evaluation Ltd" }],
        ["matter", "employment_question", { country: "Germany" }],
        ["resolved", "legal_question", {}],
        ["declined", "legal_question", {}],
        ["older", "legal_question", {}],
      ];
      for (const [key, slug, customFields] of plan) {
        const title = `DOC-029 portal follow ${key} ${runStamp}`;
        const r = must(
          await L.api(page, "POST", "/requests", {
            requestTypeId: bySlug[slug].id,
            departmentId: engineering.id,
            title,
            description: `DOC-029 portal description for ${key}.`,
            urgency: "high",
            customFields,
          }),
          `request ${key}`,
        ).request;
        const original = `doc029-original-${key}-${runStamp}.pdf`;
        must(
          await L.api(page, "POST", `/requests/${r.number}/attachments`, undefined, {
            file: await pdfFile(original),
          }),
          `attach ${key}`,
        );
        Q[key] = { number: r.number, id: r.id, title, slug, original };
      }
      return Object.entries(Q)
        .map(([k, q]) => `${k}: R-${q.number}`)
        .join("; ");
    },
  );
  const nadiaMe = must(await L.api(nadia, "GET", "/me"), "me").user;
  const legal = {};
  const post = async (entityType, entityId, visibility, body, filename) => {
    const multipart = { entityType, entityId, body, visibility };
    if (filename) multipart.file = await pdfFile(filename);
    return must(
      await L.api(nadia, "POST", "/comments", undefined, multipart),
      `comment ${visibility}`,
    );
  };

  await step(
    A,
    "legal_team_member",
    "Setup: Legal replies at every audience before any decision, and assigns the open Request",
    "Full thread (with paper), Legal only, and Working team comments post on each Request; R-open is assigned to Nadia",
    async () => {
      const out = [];
      for (const key of ["open", "contract", "matter", "resolved", "declined"]) {
        const q = Q[key];
        const tag = `${key} ${runStamp}`;
        legal[key] = {
          full: `DOC-029 portal Legal full thread ${tag}`,
          legalOnly: `DOC-029 portal Legal only note ${tag}`,
          working: `DOC-029 portal Working team note ${tag}`,
          file: `doc029-legal-${key}-${runStamp}.pdf`,
        };
        await post("request", q.id, "full_thread", legal[key].full, legal[key].file);
        await post("request", q.id, "legal_only", legal[key].legalOnly);
        const w = await L.api(nadia, "POST", "/comments", undefined, {
          entityType: "request",
          entityId: q.id,
          body: legal[key].working,
          visibility: "working_team",
        });
        out.push(`R-${q.number}: full+file, legal_only, working_team HTTP ${w.status}`);
      }
      must(
        await L.api(nadia, "PATCH", `/requests/${Q.open.number}/assignee`, {
          assigneeId: nadiaMe.id,
        }),
        "assign",
      );
      return out.join("; ") + `; R-${Q.open.number} assigned to ${nadiaMe.displayName}.`;
    },
  );

  await step(
    A,
    "legal_team_member",
    "Setup: Legal converts, resolves, and declines through the API",
    "Contract and Matter conversions, a resolution with a reply, and a decline with a reason succeed",
    async () => {
      const { page: daniel } = await L.staffContext(L.PEOPLE.daniel);
      const ctypes = must(await L.api(daniel, "GET", "/contract-types"), "contract types");
      await daniel.context().close();
      const ctype = (ctypes.contractTypes ?? ctypes.types ?? Object.values(ctypes)[0]).find(
        (t) => !t.archivedAt,
      );
      const c = must(
        await L.api(nadia, "POST", `/requests/${Q.contract.number}/convert`, {
          title: Q.contract.title,
          contractTypeId: ctype.id,
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
        "contract read",
      );
      const mr = must(
        await L.api(nadia, "GET", `/matters/${m.convertedRecord.number}`),
        "matter read",
      );
      STATE.contract = { ...c.convertedRecord, id: (cr.contract ?? cr).id };
      STATE.matter = { ...m.convertedRecord, id: (mr.matter ?? mr).id };
      if (!STATE.contract.id || !STATE.matter.id) throw new Error("converted record ids not read");
      must(
        await L.api(nadia, "POST", `/requests/${Q.resolved.number}/resolve`, {
          reply: `DOC-029 portal resolution reply ${runStamp}`,
        }),
        "resolve",
      );
      must(
        await L.api(nadia, "POST", `/requests/${Q.declined.number}/decline`, {
          reason: `DOC-029 portal decline reason ${runStamp}`,
        }),
        "decline",
      );
      return `R-${Q.contract.number} converted to ${JSON.stringify(c.convertedRecord)}; R-${Q.matter.number} converted to ${JSON.stringify(m.convertedRecord)}; R-${Q.resolved.number} resolved with a reply; R-${Q.declined.number} declined with a reason.`;
    },
  );

  await step(
    A,
    "legal_team_member",
    "Setup: Legal posts later replies with paper after the decisions, and 55 extra replies on R-older",
    "Later Full thread replies and Legal only notes post on the Requests and the converted records",
    async () => {
      const targets = [
        ["open", "request", Q.open.id],
        ["resolved", "request", Q.resolved.id],
        ["declined", "request", Q.declined.id],
        ["contract", "contract", STATE.contract.id],
        ["matter", "matter", STATE.matter.id],
      ];
      for (const [key, type, id] of targets) {
        legal[key].later = `DOC-029 portal Legal later reply ${key} ${runStamp}`;
        legal[key].laterFile = `doc029-legal-later-${key}-${runStamp}.pdf`;
        legal[key].laterNote = `DOC-029 portal Legal later legal-only ${key} ${runStamp}`;
        await post(type, id, "full_thread", legal[key].later, legal[key].laterFile);
        await post(type, id, "legal_only", legal[key].laterNote);
      }
      for (let i = 1; i <= 55; i++)
        await post(
          "request",
          Q.older.id,
          "full_thread",
          `DOC-029 portal older marker ${String(i).padStart(2, "0")} ${runStamp}`,
        );
      return `Later replies posted on ${targets.map((t) => `${t[1]} ${t[0]}`).join(", ")}; 55 Full thread markers on R-${Q.older.number}.`;
    },
  );

  await step(
    A,
    R,
    "Your requests lists open, resolved, and declined Requests with Owner; converted ones leave the list",
    "Rows for R-open, R-resolved, R-declined with Owner text; no rows for the converted Requests",
    async () => {
      await page.goto(`${L.BASE}/portal`);
      const list = page.getByRole("region", { name: "Your requests" });
      await list.waitFor();
      const rows = {};
      for (const key of ["open", "resolved", "declined", "contract", "matter"]) {
        const row = list.getByRole("link", { name: new RegExp(Q[key].title) });
        rows[key] = (await row.count()) ? await text(row) : null;
      }
      expect(
        rows.open && rows.resolved && rows.declined && !rows.contract && !rows.matter,
        JSON.stringify(rows),
      );
      expect(rows.open.includes("Owner: Nadia Haddad"), rows.open);
      return `Rows: ${rows.open} || ${rows.resolved} || ${rows.declined}; converted R-${Q.contract.number} and R-${Q.matter.number} not listed.`;
    },
  );

  for (const key of ["open", "resolved", "declined"]) {
    const q = Q[key];
    await step(
      A,
      R,
      `R-${key}: open from Your requests; check title, reference, status, Owner, and banner`,
      "Title, R- reference, requester status (Open/Resolved/Declined), Owner line, and banner text; decline reason under the status; reply link on decided Requests only",
      async () => {
        await page.goto(`${L.BASE}/portal`);
        await page
          .getByRole("region", { name: "Your requests" })
          .getByRole("link", { name: new RegExp(q.title) })
          .click();
        await page.waitForURL(new RegExp(`/portal/requests/${q.number}$`));
        await page.getByRole("heading", { level: 1, name: q.title }).waitFor();
        const main = page.getByRole("main");
        const meta = await text(main.getByText(new RegExp(`^R-${q.number} ·`)));
        const pill = await text(main.locator("h1").locator("xpath=following-sibling::span[1]"));
        const owner = await text(main.getByText(/^Owner: /));
        const banner = await text(main.getByText(/^Legal (has|declined|is)/));
        const replyLink = await main
          .getByRole("link", { name: "Attach new files to a reply" })
          .count();
        const want = { open: "Open", resolved: "Resolved", declined: "Declined" }[key];
        expect(pill === want, `pill ${pill}`);
        if (key === "declined")
          expect(banner.includes(`DOC-029 portal decline reason ${runStamp}`), banner);
        expect(key === "open" ? replyLink === 0 : replyLink === 1, `reply link ${replyLink}`);
        return `Meta "${meta}"; status "${pill}"; "${owner}"; banner "${banner}"; reply link count ${replyLink}.`;
      },
    );

    await step(
      A,
      R,
      `R-${key}: Comments shows Legal's shared replies and paper only`,
      "Full thread replies and their files show; Legal only and Working team notes do not; no audience choice",
      async () => {
        const panel = await openComments(page);
        const L_ = legal[key];
        await panel
          .getByText(L_.later)
          .waitFor({ timeout: 20000 })
          .catch(() => {});
        const body = await text(panel);
        expect(
          body.includes(L_.full) && body.includes(L_.later),
          `full thread missing: ${body.slice(0, 300)}`,
        );
        if (key === "resolved")
          expect(
            body.includes(`DOC-029 portal resolution reply ${runStamp}`),
            "resolution reply missing",
          );
        expect(
          !body.includes(L_.legalOnly) &&
            !body.includes(L_.working) &&
            !body.includes(L_.laterNote),
          "restricted note visible",
        );
        const radios = await panel.getByRole("radio").count();
        const audience = await panel.getByText("Audience", { exact: true }).count();
        const d = await downloadVia(
          page,
          panel
            .getByRole("link", { name: new RegExp(L_.laterFile) })
            .or(panel.getByRole("button", { name: new RegExp(`Download ${L_.laterFile}`) }))
            .first(),
        );
        expect(
          sha(d.bytes) === sha((await pdfFile(L_.laterFile)).buffer),
          "Legal file bytes differ",
        );
        expect(radios === 0 && audience === 0, `radios ${radios} audience ${audience}`);
        return `Comments showed "${L_.full}" and "${L_.later}"${key === "resolved" ? " and the resolution reply" : ""}; Legal only and Working team texts absent; radios ${radios}, Audience label ${audience}; ${d.filename} downloaded with matching bytes.`;
      },
    );

    await step(
      A,
      R,
      `R-${key}: What you submitted shows the saved answers and the original attachment`,
      "Description, original attachment (downloadable, same bytes), Department, Urgency, and answered questions",
      async () => {
        const card = page.getByRole("region", { name: "What you submitted" });
        const body = await text(card);
        for (const want of [
          `DOC-029 portal description for ${key}.`,
          q.original,
          "Engineering",
          "High",
        ])
          expect(body.includes(want), `missing ${want}: ${body}`);
        const d = await downloadVia(page, card.getByRole("link", { name: q.original }));
        expect(sha(d.bytes) === sha((await pdfFile(q.original)).buffer), "original bytes differ");
        return `What you submitted: "${body}"; ${d.filename} downloaded with the original bytes.`;
      },
    );

    await step(
      A,
      R,
      `R-${key}: reply with further paper`,
      "Comment stays unavailable without a message (also with a file selected); the reply and file appear; the status does not change; Legal reads it",
      async () => {
        if (key !== "open") {
          await page.getByRole("link", { name: "Attach new files to a reply" }).click();
          await page.waitForURL(new RegExp(`#portal-request-composer$`));
        }
        const panel = await openComments(page);
        const send = panel.getByRole("button", { name: "Comment", exact: true });
        const emptyDisabled = await send.isDisabled();
        const replyFile = `doc029-jonas-reply-${key}-${runStamp}.pdf`;
        const [fc] = await Promise.all([
          page.waitForEvent("filechooser"),
          panel.getByRole("button", { name: "Attach files" }).click(),
        ]);
        await fc.setFiles([await pdfFile(replyFile)]);
        const fileOnlyDisabled = await send.isDisabled();
        const msg = `DOC-029 portal Jonas reply ${key} ${runStamp}`;
        await panel.getByRole("textbox", { name: "New comment" }).fill(msg);
        const enabled = await send.isEnabled();
        await send.click();
        await panel.getByText(msg).waitFor({ timeout: 20000 });
        const d = await downloadVia(
          page,
          panel
            .getByRole("link", { name: new RegExp(replyFile) })
            .or(panel.getByRole("button", { name: new RegExp(`Download ${replyFile}`) }))
            .first(),
        );
        await page.reload();
        await page.getByRole("heading", { level: 1, name: q.title }).waitFor();
        const pill = await text(
          page.getByRole("main").locator("h1").locator("xpath=following-sibling::span[1]"),
        );
        const panel2 = await openComments(page);
        await panel2
          .getByText(msg, { exact: true })
          .first()
          .waitFor({ timeout: 20000 })
          .catch(() => {});
        const count = await panel2.getByText(msg, { exact: true }).count();
        const staff = must(
          await L.api(nadia, "GET", `/comments?entityType=request&entityId=${q.id}`),
          "staff comments",
        ).comments.filter((c) => c.body === msg);
        expect(
          emptyDisabled && fileOnlyDisabled && enabled,
          `disabled ${emptyDisabled}/${fileOnlyDisabled} enabled ${enabled}`,
        );
        expect(
          count === 1 &&
            staff.length === 1 &&
            (staff[0].attachments ?? []).some((a) => a.filename === replyFile),
          `count ${count} staff ${JSON.stringify(staff).slice(0, 200)}`,
        );
        expect(sha(d.bytes) === sha((await pdfFile(replyFile)).buffer), "reply file bytes differ");
        expect(
          pill === { open: "Open", resolved: "Resolved", declined: "Declined" }[key],
          `pill ${pill}`,
        );
        return `${key === "open" ? "" : "Attach new files to a reply opened #portal-request-composer. "}Comment disabled when empty (${emptyDisabled}) and with only a file (${fileOnlyDisabled}); posted "${msg}" once with ${replyFile} (download bytes match); after reload the status stayed ${pill}; Nadia's API read shows the reply with its file.`;
      },
    );
  }

  for (const key of ["contract", "matter"]) {
    const q = Q[key];
    const rec = STATE[key];
    await step(
      A,
      R,
      `R-${key}: the converted Request address opens the resulting ${key}`,
      `Redirect to /portal/${key}s/<n>; Original request shows the ask; Jonas is Business Owner on the team; Comments shows Full thread replies only; a reply posts on the record`,
      async () => {
        await page.goto(`${L.BASE}/portal/requests/${q.number}`);
        await page.waitForURL(new RegExp(`/portal/${key}s/${rec.number}$`), { timeout: 20000 });
        const main = page.getByRole("main");
        await main.getByText("Original request").first().waitFor({ timeout: 20000 });
        const orig = await text(
          main.getByText("Original request").first().locator("xpath=ancestor::section[1]"),
        );
        expect(
          orig.includes(`DOC-029 portal description for ${key}.`),
          `original: ${orig.slice(0, 300)}`,
        );
        const teamLabel = key === "contract" ? "Contract team" : "Matter team";
        await page
          .getByRole("toolbar", { name: "Applets" })
          .getByRole("button", { name: teamLabel })
          .click();
        const team = page.getByRole("complementary", { name: teamLabel });
        await team.getByText("Jonas Weber").first().waitFor({ timeout: 15000 });
        const teamText = await text(team);
        expect(/Business Owner/.test(teamText), `team: ${teamText}`);
        const panel = await openComments(page);
        const L_ = legal[key];
        await panel
          .getByText(L_.later)
          .waitFor({ timeout: 20000 })
          .catch(() => {});
        const body = await text(panel);
        expect(
          body.includes(L_.full) && body.includes(L_.later),
          `full missing: ${body.slice(0, 300)}`,
        );
        expect(
          !body.includes(L_.legalOnly) &&
            !body.includes(L_.laterNote) &&
            !body.includes(L_.working),
          "restricted note visible",
        );
        const msg = `DOC-029 portal Jonas reply on ${key} ${runStamp}`;
        await panel.getByRole("textbox", { name: "New comment" }).fill(msg);
        await panel.getByRole("button", { name: "Comment", exact: true }).click();
        await panel.getByText(msg).waitFor({ timeout: 20000 });
        return `/portal/requests/${q.number} went to /portal/${key}s/${rec.number}; Original request: "${orig.slice(0, 200)}"; ${teamLabel}: "${teamText.slice(0, 200)}"; Comments showed the Full thread replies and not the Legal only or Working team notes; reply "${msg}" posted on the record.`;
      },
    );
  }

  await step(
    A,
    R,
    "Show older loads earlier replies",
    "The conversation first shows the newest page; Show older adds the earlier replies",
    async () => {
      await page.goto(`${L.BASE}/portal/requests/${Q.older.number}`);
      const panel = await openComments(page);
      await panel
        .getByText(`DOC-029 portal older marker 55 ${runStamp}`)
        .waitFor({ timeout: 20000 });
      const before = await panel
        .getByText(new RegExp(`^DOC-029 portal older marker \\d\\d ${runStamp}$`))
        .count();
      const hadFirst = await panel.getByText(`DOC-029 portal older marker 01 ${runStamp}`).count();
      await panel.getByRole("button", { name: "Show older" }).click();
      await panel
        .getByText(`DOC-029 portal older marker 01 ${runStamp}`)
        .waitFor({ timeout: 20000 });
      const after = await panel
        .getByText(new RegExp(`^DOC-029 portal older marker \\d\\d ${runStamp}$`))
        .count();
      expect(
        before < 55 && hadFirst === 0 && after === 55,
        `before ${before} first ${hadFirst} after ${after}`,
      );
      return `R-${Q.older.number}: ${before} markers before Show older (marker 01 absent), ${after} after.`;
    },
  );

  await step(
    A,
    R,
    "Recovery: a failed reply keeps its text and files; Comment again posts once",
    "Error shows, text and file stay; retry posts one reply",
    async () => {
      await page.goto(`${L.BASE}/portal/requests/${Q.open.number}`);
      const panel = await openComments(page);
      const msg = `DOC-029 portal retry reply ${runStamp}`;
      const f = `doc029-retry-${runStamp}.pdf`;
      await panel.getByRole("textbox", { name: "New comment" }).fill(msg);
      const [fc] = await Promise.all([
        page.waitForEvent("filechooser"),
        panel.getByRole("button", { name: "Attach files" }).click(),
      ]);
      await fc.setFiles([await pdfFile(f)]);
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
  );

  await step(
    A,
    R,
    "Recovery: the conversation could not be read; close and reopen Comments",
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
  );

  await step(
    A,
    R,
    "Clearing triage assignment shows Not assigned yet",
    "Request page and Your requests show Not assigned yet",
    async () => {
      must(
        await L.api(nadia, "PATCH", `/requests/${Q.open.number}/assignee`, { assigneeId: null }),
        "unassign",
      );
      await page.goto(`${L.BASE}/portal/requests/${Q.open.number}`);
      const own = await text(page.getByRole("main").getByText(/^Owner: /));
      await page.goto(`${L.BASE}/portal`);
      const row = await text(
        page
          .getByRole("region", { name: "Your requests" })
          .getByRole("link", { name: new RegExp(Q.open.title) }),
      );
      expect(
        own === "Owner: Not assigned yet" && row.includes("Owner: Not assigned yet"),
        `${own} / ${row}`,
      );
      return `Request page "${own}"; list row "${row}".`;
    },
  );

  await step(
    "follow-request",
    "business_user",
    "Negative: a second Business User cannot open Jonas's Requests or files",
    "Amara's browser returns to /portal; API answers 404 for the Request and its attachment; converted addresses also return to /portal",
    async () => {
      const { page: amara } = await L.portalContext(L.PEOPLE.amara);
      const out = [];
      for (const key of ["open", "contract", "matter"]) {
        await amara.goto(`${L.BASE}/portal/requests/${Q[key].number}`);
        await amara.waitForURL(/\/portal$/, { timeout: 15000 });
        out.push(`R-${Q[key].number} -> /portal`);
      }
      const detail = await L.api(page, "GET", `/portal/requests/${Q.open.number}`);
      const att = detail.body.attachments[0];
      const a1 = await L.api(amara, "GET", `/portal/requests/${Q.open.number}`);
      const a2 = await amara.request.get(
        `${L.BASE}/api/v1/portal/requests/${Q.open.number}/attachments/${att.id}`,
      );
      await amara.goto(`${L.BASE}/portal/contracts/${STATE.contract.number}`);
      await amara
        .waitForURL((u) => u.pathname !== `/portal/contracts/${STATE.contract.number}`, {
          timeout: 15000,
        })
        .catch(() => {});
      const contractPath = new URL(amara.url()).pathname;
      await amara.waitForTimeout(2000);
      const contractBody = await text(amara.getByRole("main"));
      expect(a1.status === 404 && a2.status() === 404, `api ${a1.status}/${a2.status()}`);
      expect(!contractBody.includes(Q.contract.title), "Amara saw the contract title");
      await amara.context().close();
      return `${out.join("; ")}; API detail ${a1.status}, attachment ${a2.status()}; /portal/contracts/${STATE.contract.number} left Amara at ${contractPath} without the record title (page text: "${contractBody.slice(0, 160)}").`;
    },
  );

  await step(
    A,
    R,
    "Negative: staff addresses are not a substitute for the Portal link",
    "Jonas's staff API reads are refused and staff record pages do not open",
    async () => {
      const s1 = await L.api(page, "GET", `/requests/${Q.open.number}`);
      await page.goto(`${L.BASE}/contracts/${STATE.contract.number}`);
      await page.waitForTimeout(2500);
      const p1 = new URL(page.url()).pathname;
      await page.goto(`${L.BASE}/matters/${STATE.matter.number}`);
      await page.waitForTimeout(2500);
      const p2 = new URL(page.url()).pathname;
      expect(s1.status === 403 || s1.status === 404, `staff read ${s1.status}`);
      expect(p1.startsWith("/portal") && p2.startsWith("/portal"), `${p1} ${p2}`);
      return `Staff Request read HTTP ${s1.status}; /contracts/${STATE.contract.number} ended at ${p1}; /matters/${STATE.matter.number} ended at ${p2}.`;
    },
  );

  await step(
    A,
    R,
    "Team row removed: the old Request link no longer opens the live record",
    "After Legal removes Jonas from the Matter team, the Request address returns to the Portal home",
    async () => {
      const jonasId = must(await L.api(page, "GET", "/me"), "me").user.id;
      const del = await L.api(nadia, "DELETE", `/matters/${STATE.matter.number}/team/${jonasId}`);
      if (del.status >= 300)
        throw new Error(
          `team removal refused: HTTP ${del.status} ${JSON.stringify(del.body).slice(0, 200)}`,
        );
      await page.goto(`${L.BASE}/portal/requests/${Q.matter.number}`);
      await page.waitForURL(/\/portal$/, { timeout: 15000 });
      return `DELETE team row HTTP ${del.status}; /portal/requests/${Q.matter.number} returned to /portal.`;
    },
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
      return `Archive HTTP ${arch.status}; notice "${notice}"; What you submitted "${card}"; Comments applet buttons ${commentsBtn}; attachment links ${fileLinks}.`;
    },
  );
  await page.context().close();
  await nadia.context().close();
}

// ---------------------------------------------------------------- V-C11
async function knowledgePhase() {
  const A = "portal-knowledge";
  const R = "business_user";
  const K = STATE.knowledge;
  const { page: nadia } = await L.staffContext(L.PEOPLE.nadia);
  const { page } = await L.portalContext(L.PEOPLE.jonas);
  let homeLinks = [];

  await step(
    A,
    "legal_team_member",
    "Setup: the DOC-029 guidance fixture is published for Everyone",
    "The staff item reads published, Everyone, not archived, with two Documents and a primary",
    async () => {
      let staff = must(
        await L.api(nadia, "GET", `/knowledge/${K.guidance.id}`),
        "staff item",
      ).knowledgeItem;
      let republished = false;
      if (staff.state !== "published") {
        must(await L.api(nadia, "POST", `/knowledge/${K.guidance.id}/publish`, {}), "publish");
        republished = true;
        staff = must(
          await L.api(nadia, "GET", `/knowledge/${K.guidance.id}`),
          "staff item",
        ).knowledgeItem;
      }
      expect(
        staff.state === "published" &&
          staff.audience === "everyone" &&
          !staff.archivedAt &&
          staff.documentCount === 2 &&
          staff.primaryDocument,
        JSON.stringify(staff).slice(0, 300),
      );
      return `${K.guidance.title}: ${staff.state}, ${staff.audience}, ${staff.documentCount} Documents, primary ${staff.primaryDocument.currentVersion.originalFilename}${republished ? " (republished after an earlier interrupted harness run left it unpublished)" : ""}.`;
    },
  );

  await step(
    A,
    R,
    "Portal home: Before you submit lists only eligible guidance",
    "Knowledge links point at published Everyone items; external links show their website",
    async () => {
      await page.goto(`${L.BASE}/portal`);
      const panel = page.getByRole("region", { name: "Before you submit" });
      await panel.waitFor();
      homeLinks = await panel.getByRole("link").evaluateAll((as) =>
        as.map((a) => ({
          label: a.childNodes[0]?.textContent?.trim(),
          href: a.getAttribute("href"),
          target: a.getAttribute("target"),
          domain: a.parentElement?.querySelector("span[aria-hidden]")?.textContent ?? null,
        })),
      );
      const listed = must(
        await L.api(nadia, "GET", "/knowledge?limit=100"),
        "knowledge",
      ).knowledgeItems;
      for (const l of homeLinks.filter((l) => l.href.startsWith("/portal/knowledge/"))) {
        const item = listed.find((k) => k.id === l.href.split("/").at(-1));
        expect(
          item && item.state === "published" && item.audience === "everyone" && !item.archivedAt,
          `ineligible link ${l.href}`,
        );
      }
      for (const bad of [K.restricted, K.draft, K.archived])
        expect(!homeLinks.some((l) => l.href.includes(bad.id)), "restricted fixture linked");
      return `Links: ${homeLinks.map((l) => `${l.label} -> ${l.href}${l.target ? ` (target ${l.target}, domain ${l.domain})` : ""}`).join("; ")}. Each Knowledge link names a published Everyone item.`;
    },
  );

  await step(
    A,
    R,
    "A request form shows its own Before you submit links, which can differ from the home",
    "The form's panel differs from the home panel",
    async () => {
      await page.goto(`${L.BASE}/portal/new/contract_review`);
      await page.getByRole("heading", { level: 1, name: "Contract review" }).waitFor();
      const panel = page.getByRole("region", { name: "Before you submit" });
      const n = (await panel.count()) ? await panel.getByRole("link").count() : 0;
      expect(n !== homeLinks.length, `form links ${n} home ${homeLinks.length}`);
      return `The Contract review form shows ${n} Before you submit links (no panel) against ${homeLinks.length} on the home. The seed configures no form-specific links.`;
    },
  );

  await step(
    A,
    R,
    "Open guidance from Before you submit: same tab, From Legal, title, Guidance, Your requests",
    "Same-tab navigation to /portal/knowledge/<id>; From Legal above the title; Guidance text; Your requests returns home",
    async () => {
      await page.goto(`${L.BASE}/portal`);
      const pages = page.context().pages().length;
      const first = homeLinks.find((l) => l.href.startsWith("/portal/knowledge/"));
      await page
        .getByRole("region", { name: "Before you submit" })
        .getByRole("link", { name: first.label })
        .click();
      await page.waitForURL(new RegExp(first.href + "$"));
      const main = page.getByRole("main");
      const kicker = await text(main.getByText("From Legal", { exact: true }));
      const h1 = await text(main.getByRole("heading", { level: 1 }));
      const guidance = await main.getByRole("region", { name: "Guidance" }).count();
      const gtext = guidance
        ? (await text(main.getByRole("region", { name: "Guidance" }))).slice(0, 120)
        : "";
      expect(page.context().pages().length === pages, "new tab opened");
      await main.getByRole("link", { name: "Your requests" }).click();
      await page.waitForURL(/\/portal$/);
      return `"${first.label}" opened ${first.href} in the same tab; "${kicker}" above "${h1}"; Guidance: "${gtext}"; Your requests returned to /portal.`;
    },
  );

  let primaryUrl = null;
  await step(
    A,
    R,
    "A shared Portal Knowledge link: Documents lists the primary first; Download gives the current Version; Guidance shows",
    "Primary Document first (uploaded after the supporting one); Download bytes equal staff current Version; no version picker or reader",
    async () => {
      await page.goto(`${L.BASE}/portal/knowledge/${K.guidance.id}`);
      const main = page.getByRole("main");
      await main.getByRole("heading", { level: 1, name: K.guidance.title }).waitFor();
      const docs = main.getByRole("region", { name: "Documents" });
      const names = await docs.getByRole("listitem").allInnerTexts();
      const clean = names.map((n) =>
        n
          .replace(/\s+/g, " ")
          .replace(/Download$/, "")
          .trim(),
      );
      const item = must(
        await L.api(page, "GET", `/portal/knowledge/${K.guidance.id}`),
        "portal item",
      ).knowledgeItem;
      const staffItem = must(
        await L.api(nadia, "GET", `/knowledge/${K.guidance.id}`),
        "staff item",
      ).knowledgeItem;
      const supportingFirstUploaded = item.documents.length === 2;
      expect(
        supportingFirstUploaded &&
          item.documents[0].id === staffItem.primaryDocument.id &&
          clean[0] === staffItem.primaryDocument.currentVersion.originalFilename,
        `order ${clean} primary ${staffItem.primaryDocument?.id}`,
      );
      const results = [];
      for (const d of item.documents) {
        const dl = await downloadVia(
          page,
          docs.getByRole("link", { name: `Download ${d.currentVersion.originalFilename}` }),
        );
        const staffDocs = must(
          await L.api(nadia, "GET", `/knowledge/${K.guidance.id}/documents`),
          "staff docs",
        );
        const doc = (staffDocs.documents ?? []).find((x) => x.id === d.id);
        const versions = [...(doc?.versions ?? [])].sort(
          (a, b) => (a.number ?? a.versionNumber) - (b.number ?? b.versionNumber),
        );
        const cur = doc?.currentVersion ?? versions.at(-1);
        if (!cur)
          throw new Error(
            `staff version chain not read: ${JSON.stringify(staffDocs).slice(0, 300)}`,
          );
        const staffBytes = await nadia.request
          .get(`${L.BASE}/api/v1/documents/${d.id}/versions/${cur.id}/download`)
          .then((r) => r.body());
        expect(sha(dl.bytes) === sha(staffBytes), `bytes differ for ${dl.filename}`);
        results.push(
          `${dl.filename} matched staff current Version ${cur.number ?? cur.versionNumber ?? ""}`.trim(),
        );
      }
      primaryUrl = item.documents[0].currentVersion.downloadUrl;
      const buttons = await main.getByRole("button").allInnerTexts();
      const combos = await main.getByRole("combobox").count();
      const guidance = await text(main.getByRole("region", { name: "Guidance" }));
      expect(
        combos === 0 && guidance.includes("Send the latest draft"),
        `combos ${combos} guidance ${guidance}`,
      );
      return `Documents order: ${clean.join(" | ")}; ${results.join("; ")}; buttons in main: [${buttons.join(", ")}]; version pickers ${combos}; Guidance "${guidance}".`;
    },
  );

  await step(
    A,
    R,
    "A new Version: Download gives the new current file",
    "After Legal adds a Version, reloading shows the new filename and Download serves the new bytes",
    async () => {
      const item = must(
        await L.api(page, "GET", `/portal/knowledge/${K.guidance.id}`),
        "item",
      ).knowledgeItem;
      const primary = item.documents[0];
      const vname = `doc029-primary-v2-${runStamp}.pdf`;
      const up = await L.api(nadia, "POST", `/documents/${primary.id}/versions`, undefined, {
        file: await pdfFile(vname),
      });
      if (up.status >= 300)
        throw new Error(
          `version upload HTTP ${up.status} ${JSON.stringify(up.body).slice(0, 200)}`,
        );
      await page.reload();
      const docs = page.getByRole("main").getByRole("region", { name: "Documents" });
      const dl = await downloadVia(page, docs.getByRole("link", { name: `Download ${vname}` }));
      const saved = await page.request.get(`${L.BASE}${primaryUrl}`).then((r) => r.body());
      expect(
        sha(dl.bytes) === sha((await pdfFile(vname)).buffer) && sha(saved) === sha(dl.bytes),
        "new bytes not served",
      );
      return `Version upload HTTP ${up.status}; the page listed ${vname}; Download and the earlier saved address both served the new bytes.`;
    },
  );

  await step(
    A,
    R,
    "Draft, restricted, archived, and unknown items and their files do not open",
    "Each page returns to /portal; item and file APIs answer 404",
    async () => {
      const out = [];
      const seedDraft = must(
        await L.api(nadia, "GET", "/knowledge?limit=100&state=draft"),
        "drafts",
      ).knowledgeItems.find((k) => k.audience === "everyone" && !k.title.startsWith("DOC-029"));
      const cases = [
        ["draft", K.draft.id],
        ["restricted", K.restricted.id],
        ["archived", K.archived.id],
        ["unknown", "01a0aaad-0000-7000-8000-000000000000"],
      ];
      if (seedDraft) cases.push(["seed draft Everyone", seedDraft.id]);
      for (const [label, id] of cases) {
        await page.goto(`${L.BASE}/portal/knowledge/${id}`);
        await page.waitForURL(/\/portal$/, { timeout: 15000 });
        const api = await L.api(page, "GET", `/portal/knowledge/${id}`);
        let fileStatus = "n/a";
        if (label !== "unknown" && label !== "seed draft Everyone") {
          const staff = must(
            await L.api(nadia, "GET", `/knowledge/${id}`),
            "staff item",
          ).knowledgeItem;
          const docId = staff.primaryDocument?.id;
          if (docId)
            fileStatus = (
              await page.request.get(
                `${L.BASE}/api/v1/portal/knowledge/${id}/documents/${docId}/download`,
              )
            ).status();
          expect(docId && fileStatus === 404, `${label} file ${fileStatus}`);
        }
        expect(api.status === 404, `${label} api ${api.status}`);
        out.push(`${label}: page -> /portal, item ${api.status}, file ${fileStatus}`);
      }
      return out.join("; ");
    },
  );

  await step(
    A,
    R,
    "A saved download address follows the item's availability",
    "After Legal unpublishes, the page returns home and the saved address answers 404; republishing restores it",
    async () => {
      primaryUrl ??= must(await L.api(page, "GET", `/portal/knowledge/${K.guidance.id}`), "item")
        .knowledgeItem.documents[0].currentVersion.downloadUrl;
      must(await L.api(nadia, "POST", `/knowledge/${K.guidance.id}/unpublish`, {}), "unpublish");
      let s1;
      try {
        await page.goto(`${L.BASE}/portal/knowledge/${K.guidance.id}`);
        await page.waitForURL(/\/portal$/, { timeout: 15000 });
        s1 = (await page.request.get(`${L.BASE}${primaryUrl}`)).status();
      } finally {
        must(await L.api(nadia, "POST", `/knowledge/${K.guidance.id}/publish`, {}), "republish");
      }
      const s2 = (await page.request.get(`${L.BASE}${primaryUrl}`)).status();
      expect(s1 === 404 && s2 === 200, `${s1} ${s2}`);
      return `Unpublished: page returned to /portal, saved address HTTP ${s1}. Republished: saved address HTTP ${s2}.`;
    },
  );

  await step(
    A,
    R,
    "A broken external link opens in a new tab and does not block the Request form",
    "The external link opens a new tab; the original tab stays on the Portal; a Request can still be submitted",
    async () => {
      await page.goto(`${L.BASE}/portal`);
      const ext = homeLinks.find((l) => l.target === "_blank");
      const [popup] = await Promise.all([
        page.context().waitForEvent("page"),
        page
          .getByRole("region", { name: "Before you submit" })
          .getByRole("link", { name: new RegExp(ext.label) })
          .click(),
      ]);
      await popup.waitForLoadState("domcontentloaded").catch(() => {});
      const popupUrl = popup.url();
      const popupFailed = await popup
        .evaluate(() => document.body?.innerText?.slice(0, 80) ?? "")
        .catch((e) => `error: ${e.message}`);
      await popup.close();
      expect(new URL(page.url()).pathname === "/portal", "original tab moved");
      await page
        .getByRole("list", { name: "Request types" })
        .getByRole("link", { name: /Legal question/ })
        .click();
      await page.getByLabel(/^Title/).fill(`DOC-029 portal after a broken link ${runStamp}`);
      await page
        .getByLabel(/^Description/)
        .fill("DOC-029 portal: the external website did not load.");
      await page.getByRole("button", { name: "Submit request" }).click();
      const head = await text(page.getByRole("heading", { name: /^Request R-\d+ is with Legal$/ }));
      return `"${ext.label}" (domain shown: ${ext.domain}) opened a new tab at ${popupUrl} (page text: "${String(popupFailed).replace(/\s+/g, " ")}"); the original tab stayed on /portal; the Legal question form then confirmed "${head}".`;
    },
  );

  await step(
    A,
    R,
    "The Portal has no staff Knowledge library or editing controls",
    "Portal navigation offers Requests, Contracts, Matters, Auto-Docs; the staff Knowledge address does not open for a Business User",
    async () => {
      await page.goto(`${L.BASE}/portal`);
      await page.getByRole("navigation", { name: "Portal" }).getByRole("link").first().waitFor();
      const nav = await page
        .getByRole("navigation", { name: "Portal" })
        .getByRole("link")
        .evaluateAll((as) => as.map((a) => a.textContent.trim()));
      await page.goto(`${L.BASE}/knowledge`);
      await page.waitForTimeout(2500);
      const where = new URL(page.url()).pathname;
      const api = await L.api(page, "GET", "/knowledge");
      expect(
        !nav.some((n) => /Knowledge/i.test(n)) && where.startsWith("/portal") && api.status >= 400,
        `${nav} ${where} ${api.status}`,
      );
      await page.goto(`${L.BASE}/portal/knowledge/${K.guidance.id}`);
      const editing = await page
        .getByRole("main")
        .getByRole("button", { name: /Edit|Publish|Archive|Upload/ })
        .count();
      return `Portal nav: ${nav.join(", ")}; /knowledge ended at ${where}; staff list API HTTP ${api.status}; editing buttons on the Portal item page ${editing}.`;
    },
  );

  await step(
    A,
    "anonymous",
    "Signed out: Everyone guidance is not an anonymous public page",
    "A browser without a session goes to the Portal sign-in; item and file APIs answer 401",
    async () => {
      const b = await L.launch();
      const ctx = await b.newContext();
      const p = await ctx.newPage();
      await p.goto(`${L.BASE}/portal/knowledge/${K.guidance.id}`);
      await p.waitForURL(/\/portal\/login/, { timeout: 15000 });
      const a = await ctx.request.get(`${L.BASE}/api/v1/portal/knowledge/${K.guidance.id}`);
      const f = await ctx.request.get(`${L.BASE}${primaryUrl}`);
      await ctx.close();
      expect(a.status() === 401 && f.status() === 401, `${a.status()} ${f.status()}`);
      return `Page went to /portal/login; item API ${a.status()}; file ${f.status()}.`;
    },
  );

  await step(
    A,
    R,
    "Help search does not search organization Knowledge",
    "Searching Help for the guidance title finds no organization Knowledge Item",
    async () => {
      await page.goto(`${L.BASE}/portal/help`);
      const box = page
        .getByRole("searchbox")
        .or(page.getByRole("textbox", { name: /search/i }))
        .first();
      await box.waitFor({ timeout: 15000 });
      await box.fill(K.guidance.title);
      await page.waitForTimeout(1500);
      const body = await text(page.getByRole("main"));
      const typed = await box.inputValue();
      const hit = await page.getByRole("link", { name: K.guidance.title }).count();
      expect(hit === 0, "guidance found in Help");
      return `Help search for "${K.guidance.title}" (search box value "${typed}") showed no link to it; page text after the search starts "${body.slice(0, 200)}".`;
    },
  );
  await page.context().close();
  await nadia.context().close();
}

// Recheck after a harness timing fault: the list count in the first run was read 55 ms after
// selecting Your requests, before the home had rendered. Same Request, same article steps.
async function recheckPhase() {
  const n = Number(process.env.RECHECK_NUMBER);
  const title = process.env.RECHECK_TITLE;
  const { page } = await L.portalContext(L.PEOPLE.jonas);
  await step(
    "submit-request",
    "business_user",
    "Recheck: Check Your requests on the Portal home (after the harness timing fault)",
    "The Request appears once under Your requests",
    async () => {
      await page.goto(`${L.BASE}/portal/requests/${n}`);
      await page.getByRole("heading", { level: 1, name: title }).waitFor();
      await page.getByRole("link", { name: "Your requests" }).first().click();
      await page.waitForURL(/\/portal$/);
      const list = page.getByRole("region", { name: "Your requests" });
      const rows = list.getByRole("link", { name: new RegExp(title) });
      await rows.first().waitFor({ timeout: 20000 });
      const count = await rows.count();
      expect(count === 1, `rows ${count}`);
      return `From R-${n}, Your requests returned to /portal and listed "${await text(rows.first())}" (1 row).`;
    },
  );
  await page.context().close();
}

// Supplement: two checks the main run covered only partly. The reply-link check in the main run
// could fall back to the applet toolbar; here the link alone must open the composer. The second
// records what selecting a conversation attachment's name does.
async function supplementPhase() {
  const n = Number(process.env.DECLINED_NUMBER);
  const { page } = await L.portalContext(L.PEOPLE.jonas);
  await step(
    "follow-request",
    "business_user",
    "Supplement: Attach new files to a reply opens the Comments composer by itself",
    "Selecting the banner link on a Declined Request opens Comments with New comment visible, without using the applet bar",
    async () => {
      await page.goto(`${L.BASE}/portal/requests/${n}`);
      await page.getByRole("link", { name: "Attach new files to a reply" }).click();
      await page.waitForURL(/#portal-request-composer$/);
      const panel = page.getByRole("complementary", { name: "Comments" });
      await panel.waitFor({ timeout: 15000 });
      const box = panel.getByRole("textbox", { name: "New comment" });
      await box.waitFor({ timeout: 15000 });
      const focused = await box.evaluate((el) => el === document.activeElement);
      return `R-${n}: the link opened the Comments panel with New comment visible (text box focused: ${focused}).`;
    },
  );
  await step(
    "follow-request",
    "business_user",
    "Supplement: selecting a conversation attachment",
    "The attachment can be downloaded from the conversation",
    async () => {
      const panel = page.getByRole("complementary", { name: "Comments" });
      await panel.getByRole("list", { name: "Comments" }).waitFor();
      let direct = null;
      const onDl = (d) => (direct = d.suggestedFilename());
      page.on("download", onDl);
      const nameButton = panel
        .getByRole("button", { name: /^doc029-jonas-reply-declined-/ })
        .first();
      const filename = await text(nameButton);
      await nameButton.click();
      await page.waitForTimeout(2000);
      page.off("download", onDl);
      const dialog = page.getByRole("dialog", { name: filename });
      await dialog.waitFor({ timeout: 15000 });
      const d1 = await downloadVia(page, dialog.getByRole("link", { name: "Download" }));
      await dialog.getByRole("button", { name: "Close attachment preview" }).click();
      const d2 = await downloadVia(page, panel.getByRole("link", { name: `Download ${filename}` }));
      const want = sha((await pdfFile(filename)).buffer);
      expect(sha(d1.bytes) === want && sha(d2.bytes) === want, "bytes differ");
      return `Selecting the filename "${filename}" started no download (${direct ?? "none"}); it opened an attachment preview dialog whose Download link gave the file. The row's separate "Download ${filename}" control downloaded it directly. Both copies matched the original bytes.`;
    },
  );
  await page.context().close();
}

try {
  if (PHASES.includes("supplement")) await supplementPhase();
  if (PHASES.includes("recheck")) await recheckPhase();
  if (PHASES.includes("submit")) await submitPhase();
  if (PHASES.includes("follow")) await followPhase();
  if (PHASES.includes("knowledge")) await knowledgePhase();
} finally {
  save();
  await L.close();
}
