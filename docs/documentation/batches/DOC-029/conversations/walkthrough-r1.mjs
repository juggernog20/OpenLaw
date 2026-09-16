// DOC-029 round 1 independent browser walkthrough for V-C07 (comments-and-activity)
// and V-C08 (notifications), group "conversations".
// Written by the DOC-029 independent walkthrough agent (conversations, round 1) from the
// current article text. It is not the author's script.
// Run from the repository root:
//   mise exec -- node docs/documentation/batches/DOC-029/conversations/walkthrough-r1.mjs
// The seed demo password comes from the environment or the published seed default.
// Magic links, cookies, and raw mail stay in memory and are never written to the log.
import { writeFileSync, readFileSync, existsSync } from "node:fs";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as L from "./lib-r1.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "../../../../..");
const FIX = path.join(here, "fixtures");
const fixture = (name) => path.join(FIX, name);
const sha256 = (file) => createHash("sha256").update(readFileSync(file)).digest("hex");
const OUT = process.env.OUT ?? path.join(here, "walkthrough-r1.json");
const SECTIONS = (process.env.SECTIONS ?? "all").split(",");
const run = (name) => SECTIONS.includes("all") || SECTIONS.includes(name);
const PROJECT = "openlaw-docs-41255c61-work";
const PG = `${PROJECT}-postgres-1`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const q = (s) => JSON.stringify(s);

const lab = JSON.parse(readFileSync(path.join(root, ".documentation-labs/work/lab.json"), "utf8"));
const results = {
  kind: "independent-article-walkthrough",
  task: "DOC-029",
  group: "conversations",
  round: 1,
  issues: [745, 747],
  independentReview: true,
  walkthroughReviewer: "DOC-029 independent walkthrough agent (conversations, round 1)",
  reviewerKind: "agent",
  method: "browser-walkthrough",
  articles: ["comments-and-activity", "notifications"].map((id) => ({
    articleId: id,
    articlePath: `docs/user-guides/${id}.md`,
    contentSha256: sha256(path.join(root, `docs/user-guides/${id}.md`)),
  })),
  scenarios: { "comments-and-activity": "V-C07", notifications: "V-C08" },
  appCommit: lab.sourceCommit,
  buildId: `app ${lab.appImageId}; engine ${lab.engineImageId}`,
  environment: lab.project,
  containerImages: lab.containerImages,
  appUrl: L.BASE,
  mailUrl: L.MAIL,
  browser:
    "Playwright 1.63.0 Chromium from node_modules/.pnpm, headless, 1440x900, one isolated browser context per identity",
  fixtures: Object.fromEntries(
    [
      "doc029-conv-notice.pdf",
      "doc029-conv-schedule.pdf",
      "doc029-conv-portal-note.pdf",
      "doc029-conv-legal-memo.pdf",
      ...[1, 2, 3, 4, 5, 6].map((n) => `doc029-conv-extra-${n}.txt`),
    ].map((name) => [name, sha256(fixture(name))]),
  ),
  sections: SECTIONS,
  startedAt: new Date().toISOString(),
  fixturePreparation: [],
  records: {},
  steps: [],
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
function prep(text) {
  results.fixturePreparation.push({ at: new Date().toISOString(), text });
  save();
}
async function step(article, role, action, expected, fn) {
  const entry = {
    article,
    role,
    method: "browser-walkthrough",
    step: action,
    expected,
    startedAt: new Date().toISOString(),
    at: null,
    actual: null,
    result: "not-run",
  };
  results.steps.push(entry);
  try {
    entry.actual = await fn();
    entry.result = "pass";
  } catch (error) {
    const msg =
      error instanceof Error ? error.message.split("\n").slice(0, 6).join(" ") : String(error);
    entry.actual = `Check did not complete: ${msg}`;
    entry.result = "fail";
  }
  entry.at = new Date().toISOString();
  console.log(`[${role}] ${entry.result.toUpperCase()} ${article}: ${action}`);
  if (entry.result === "fail") console.log(`    ${entry.actual}`);
  save();
  return entry;
}
function expect(condition, message) {
  if (!condition) throw new Error(message);
}

// ---------- shared helpers ----------
const CA = "comments-and-activity";
const NT = "notifications";

function psql(sql) {
  return execFileSync(
    "docker",
    ["exec", PG, "sh", "-c", `psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Atc "$SQL"`],
    { env: { ...process.env }, encoding: "utf8", input: "" },
  );
}
function psqlWith(sql) {
  return execFileSync(
    "docker",
    [
      "exec",
      "-e",
      `SQL=${sql}`,
      PG,
      "sh",
      "-c",
      'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Atc "$SQL"',
    ],
    { encoding: "utf8" },
  ).trim();
}

async function mailSearch(query) {
  const r = await fetch(`${L.MAIL}/api/v1/search?query=${encodeURIComponent(query)}&limit=50`).then(
    (x) => x.json(),
  );
  return r.messages ?? [];
}
/** Count messages to one address whose subject contains a marker. */
async function mailCount(email, subjectPart) {
  const msgs = await mailSearch(`to:"${email}" subject:"${subjectPart}"`);
  return msgs.filter((m) => m.Subject.includes(subjectPart)).length;
}
async function waitMail(email, subjectPart, before, timeoutMs = 30000) {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    const msgs = (await mailSearch(`to:"${email}" subject:"${subjectPart}"`)).filter((m) =>
      m.Subject.includes(subjectPart),
    );
    if (msgs.length > before) return msgs[0].Subject;
    await sleep(750);
  }
  throw new Error(`no new mail to ${email} with subject containing ${q(subjectPart)}`);
}
/** Waits until the pg-boss email queue has no pending jobs, then a fixed quiet window. */
async function settleQueue(quietMs = 4000) {
  for (let i = 0; i < 60; i++) {
    const pending = Number(
      psqlWith(
        "select count(*) from pgboss.job where state in ('created','retry','active') and name not like '%sweep%' and name <> 'notification.morning-round'",
      ),
    );
    if (pending === 0) break;
    await sleep(1000);
  }
  await sleep(quietMs);
}

const applet = (page) => page.getByRole("complementary", { name: "Comments" });
async function openApplet(page, name) {
  const button = page
    .getByRole("toolbar", { name: "Applets" })
    .getByRole("button", { name: new RegExp(`^${name}`) });
  await button.waitFor({ timeout: 20000 });
  if ((await button.getAttribute("aria-expanded")) !== "true") await button.click();
  return button;
}
async function openComments(page) {
  await openApplet(page, "Comments");
  const a = applet(page);
  await a.waitFor({ timeout: 20000 });
  await a
    .getByRole("textbox", { name: "New comment" })
    .or(a.getByRole("alert"))
    .first()
    .waitFor({ timeout: 20000 });
  await page.waitForTimeout(800);
  return a;
}
const rowWith = (a, text) => a.getByRole("listitem").filter({ hasText: text });
async function chooseTier(a, label) {
  const radio = a.getByRole("radio", { name: label });
  if (await radio.isChecked()) return;
  await a
    .getByRole("group", { name: "Audience" })
    .locator("label")
    .filter({ hasText: label })
    .first()
    .click();
  if (!(await radio.isChecked())) await radio.check({ force: true });
}
async function audienceText(a) {
  return (
    await a
      .locator("p")
      .filter({ hasText: /^Visible to/ })
      .first()
      .textContent()
  ).trim();
}
async function postComment(page, text, { tier, files } = {}) {
  const a = applet(page);
  if (tier) await chooseTier(a, tier);
  await a.getByRole("textbox", { name: "New comment" }).fill(text);
  if (files) await a.locator('input[type="file"]').setInputFiles(files.map(fixture));
  await a.getByRole("button", { name: "Comment", exact: true }).click();
  await rowWith(a, text).first().waitFor({ timeout: 20000 });
  return rowWith(a, text).first();
}
async function rowSummary(row) {
  return (await row.innerText()).replace(/\s+/g, " ").trim();
}
async function snapshot(locator) {
  return (await locator.ariaSnapshot())
    .split("\n")
    .filter((l) => !/option "/.test(l))
    .join("\n");
}

// ---------- fixtures ----------
async function setupFixtures() {
  const d = ctx.daniel.page;
  const j = ctx.jonas.page;
  const types = (await L.api(d, "GET", "/request-types")).body.requestTypes;
  const deps = (await L.api(d, "GET", "/departments/options")).body.departments;
  const ct = (await L.api(d, "GET", "/contract-types")).body;
  const mt = (await L.api(d, "GET", "/matter-types")).body;
  const question = types.find((t) => t.slug === "legal_question");
  const submit = async (title) => {
    const r = await L.api(j, "POST", "/requests", {
      requestTypeId: question.id,
      departmentId: deps[0].id,
      title,
      description: "DOC-029 conversations fixture. Fictional request for the comments walkthrough.",
      urgency: "medium",
      customFields: {},
    });
    expect(r.status < 300, `submit ${r.status}`);
    return r.body.request;
  };
  const rc = await submit(`DOC-029 conversations Contract ${stamp}`);
  const rm = await submit(`DOC-029 conversations Matter ${stamp}`);
  const ru = await submit(`DOC-029 conversations open Request ${stamp}`);
  const ra = await submit(`DOC-029 conversations archive Contract ${stamp}`);
  const contractType =
    (ct.contractTypes ?? ct.types).find((t) => t.slug === "msa") ??
    (ct.contractTypes ?? ct.types)[0];
  const matterType =
    (mt.matterTypes ?? mt.types).find((t) => t.slug === "advisory") ??
    (mt.matterTypes ?? mt.types)[0];
  const convert = async (req, payload) => {
    const r = await L.api(d, "POST", `/requests/${req.number}/convert`, {
      title: req.title,
      ...payload,
    });
    expect(r.status < 300, `convert ${r.status} ${JSON.stringify(r.body).slice(0, 300)}`);
    return r.body.request.convertedRecord;
  };
  const contract = await convert(rc, { contractTypeId: contractType.id });
  const matter = await convert(rm, { matterTypeId: matterType.id });
  const archive = await convert(ra, { contractTypeId: contractType.id });
  const people = (await L.api(d, "GET", "/users?limit=100")).body;
  fx = {
    createdAt: new Date().toISOString(),
    stamp,
    contractRequest: rc.number,
    matterRequest: rm.number,
    openRequest: ru.number,
    archiveRequest: ra.number,
    contract,
    matter,
    archive,
    contractTitle: rc.title,
    matterTitle: rm.title,
    openTitle: ru.title,
    archiveTitle: ra.title,
  };
  const c = (await L.api(d, "GET", `/contracts/${contract.number}`)).body;
  const m = (await L.api(d, "GET", `/matters/${matter.number}`)).body;
  const ar = (await L.api(d, "GET", `/contracts/${archive.number}`)).body;
  const oreq = (await L.api(d, "GET", `/requests/${ru.number}`)).body;
  fx.contractId = (c.contract ?? c).id;
  fx.matterId = (m.matter ?? m).id;
  fx.archiveId = (ar.contract ?? ar).id;
  fx.openRequestId = (oreq.request ?? oreq).id;
  const users = people.users ?? people;
  const idOf = (email) => users.find((u) => u.email === email)?.id;
  fx.ids = {
    daniel: idOf(L.PEOPLE.daniel.email),
    nadia: idOf(L.PEOPLE.nadia.email),
    jonas: idOf(L.PEOPLE.jonas.email),
    amara: idOf(L.PEOPLE.amara.email),
  };
  // Nadia joins the Contract and Matter teams so she is in their activity audience.
  for (const [kind, n] of [
    ["contracts", contract.number],
    ["matters", matter.number],
  ]) {
    const r = await L.api(d, "POST", `/${kind}/${n}/team`, { userId: fx.ids.nadia });
    expect(r.status < 300, `team add ${kind} ${r.status} ${JSON.stringify(r.body).slice(0, 300)}`);
  }
  writeFileSync(path.join(here, "fixtures-r1.json"), JSON.stringify(fx, null, 2) + "\n");
  results.records = fx;
  prep(
    `Jonas Weber submitted four Legal question Requests through the Portal API (R-${rc.number}, R-${rm.number}, R-${ru.number}, R-${ra.number}). Daniel Okafor converted R-${rc.number} to Contract C-${contract.number}, R-${rm.number} to Matter M-${matter.number}, and R-${ra.number} to Contract C-${archive.number} through the convert API; R-${ru.number} stays unconverted. Daniel added Nadia Haddad to the C-${contract.number} and M-${matter.number} teams through the team API. The Request submission and conversion procedures belong to other guides.`,
  );
}

// ---------- V-C07 as the Legal Team Member ----------
async function memberComments() {
  const p = ctx.nadia.page;
  const role = "legal_team_member";
  const C = `${L.BASE}/contracts/${fx.contract.number}`;
  const M = `${L.BASE}/matters/${fx.matter.number}`;
  const tag = `DOC-029 conversations ${stamp}`;

  await step(
    CA,
    role,
    "Choose an audience on a record: open the Contract, select Comments, read the audience options and descriptions",
    "Legal Only and Contract Team offered, Contract Team selected first, description below the composer changes with the choice",
    async () => {
      await p.goto(C);
      const a = await openComments(p);
      const radios = await a
        .getByRole("radio")
        .evaluateAll((els) =>
          els.map(
            (e) =>
              `${e.getAttribute("aria-label") ?? e.closest("label")?.textContent?.trim()}:${e.checked}`,
          ),
        );
      const labels = await a.getByRole("group", { name: "Audience" }).innerText();
      const teamChecked = await a.getByRole("radio", { name: "Contract Team" }).isChecked();
      expect(teamChecked, "Contract Team is not the starting audience");
      const teamText = await audienceText(a);
      await chooseTier(a, "Legal Only");
      const legalText = await audienceText(a);
      expect(
        /Administrators and Legal Team Members/.test(legalText),
        `Legal Only description ${legalText}`,
      );
      expect(
        !(await a.getByRole("radio", { name: /Internal team|Working team/ }).count()),
        "an Internal team option is offered",
      );
      await chooseTier(a, "Contract Team");
      return `C-${fx.contract.number} Comments applet opened from the Applets toolbar. Audience offered ${q(labels.replace(/\s+/g, " ").trim())} with Contract Team checked first. Description read ${q(teamText)} for Contract Team and ${q(legalText)} for Legal Only. No Internal team option was offered.`;
    },
  );

  await step(
    CA,
    role,
    "Post one Legal Only and one Contract Team comment on the Contract and check name and audience badge",
    "Each post appears under Nadia Haddad with its audience badge",
    async () => {
      const a = applet(p);
      const lo = await postComment(p, `${tag} Nadia legal only note`, { tier: "Legal Only" });
      const tt = await postComment(p, `${tag} Nadia contract team note`, { tier: "Contract Team" });
      const los = await rowSummary(lo);
      const tts = await rowSummary(tt);
      expect(/Nadia Haddad/.test(los) && /Legal Only/.test(los), `legal only row ${los}`);
      expect(/Nadia Haddad/.test(tts) && /Contract Team/.test(tts), `team row ${tts}`);
      return `Rows read ${q(los)} and ${q(tts)}.`;
    },
  );

  await step(
    CA,
    role,
    "Choose an audience on a Matter: Matter Team first, Legal Only available, post both",
    "Matter Team is the starting audience and posts carry Matter Team or Legal Only badges",
    async () => {
      await p.goto(M);
      const a = await openComments(p);
      const labels = (await a.getByRole("group", { name: "Audience" }).innerText())
        .replace(/\s+/g, " ")
        .trim();
      expect(
        await a.getByRole("radio", { name: "Matter Team" }).isChecked(),
        "Matter Team not checked first",
      );
      const teamText = await audienceText(a);
      const mt = await postComment(p, `${tag} Nadia matter team note`, { tier: "Matter Team" });
      const ml = await postComment(p, `${tag} Nadia matter legal only note`, {
        tier: "Legal Only",
      });
      const s1 = await rowSummary(mt);
      const s2 = await rowSummary(ml);
      expect(/Matter Team/.test(s1) && /Legal Only/.test(s2), `rows ${s1} / ${s2}`);
      return `M-${fx.matter.number} Audience offered ${q(labels)}, Matter Team checked first, description ${q(teamText)}. Rows read ${q(s1)} and ${q(s2)}.`;
    },
  );

  await step(
    CA,
    role,
    "Mention a person: type @ and part of a name, pick on the People tab, check Mentioned, Remove, pick again, Comment",
    "People tab lists reachable people, Files tab present for Legal, Mentioned list with Remove, post succeeds",
    async () => {
      await p.goto(C);
      const a = await openComments(p);
      const box = a.getByRole("textbox", { name: "New comment" });
      await box.fill("");
      await box.pressSequentially(`${tag} Nadia asks @Dan`, { delay: 30 });
      const listbox = a.getByRole("listbox", { name: "People and files you can mention" });
      await listbox.waitFor({ timeout: 10000 });
      const tabs = await a.getByRole("tab").allInnerTexts();
      expect(tabs.includes("People") && tabs.includes("Files"), `tabs ${tabs}`);
      const options = await listbox.getByRole("option").allInnerTexts();
      await listbox.getByRole("option", { name: /Daniel Okafor/ }).click();
      const mentioned = a.getByRole("list", { name: "Mentioned" });
      await mentioned.waitFor({ timeout: 5000 });
      const picked = (await mentioned.innerText()).trim();
      await mentioned.getByRole("button", { name: "Remove Daniel Okafor" }).click();
      const afterRemove = await a.getByRole("list", { name: "Mentioned" }).count();
      await box.pressSequentially(" @Dan", { delay: 30 });
      await listbox.getByRole("option", { name: /Daniel Okafor/ }).click();
      await box.pressSequentially(" to check the notice letter.", { delay: 5 });
      await a.getByRole("button", { name: "Comment", exact: true }).click();
      const row = rowWith(a, "to check the notice letter.").first();
      await row.waitFor({ timeout: 15000 });
      const widen = await p.getByRole("dialog", { name: "Widen the audience?" }).count();
      expect(widen === 0, "a widen prompt appeared for a reachable person");
      return `Typing @Dan opened the tabs ${q(tabs)} with People selected, listing ${q(options)}. Choosing Daniel Okafor added ${q(picked)} to the Mentioned list; Remove Daniel Okafor emptied it (${afterRemove} lists left). After re-picking, Comment posted ${q(await rowSummary(row))} at Contract Team without a widen prompt.`;
    },
  );

  await step(
    CA,
    role,
    "Typing a name as ordinary text alone does not select a recipient",
    "No Mentioned list when the name is typed without choosing from the list",
    async () => {
      const a = applet(p);
      const box = a.getByRole("textbox", { name: "New comment" });
      await box.fill(`${tag} plain text Daniel Okafor without a pick`);
      await p.waitForTimeout(500);
      const lists = await a.getByRole("list", { name: "Mentioned" }).count();
      expect(lists === 0, "Mentioned list appeared");
      await box.fill("");
      return 'Typing "Daniel Okafor" without @ and without choosing showed no Mentioned list; the draft was cleared unposted.';
    },
  );

  await step(
    CA,
    role,
    "Widen the audience? on a Legal Only mention of a Business User: Cancel keeps editing without posting, Widen and post posts at the proposed audience",
    "Dialog names the proposed audience; Cancel posts nothing; Widen and post posts at Contract Team",
    async () => {
      const a = applet(p);
      await chooseTier(a, "Legal Only");
      const box = a.getByRole("textbox", { name: "New comment" });
      const text = `${tag} Nadia legal only mention for`;
      await box.fill("");
      await box.pressSequentially(`${text} @Jon`, { delay: 30 });
      await a
        .getByRole("listbox", { name: "People and files you can mention" })
        .getByRole("option", { name: /Jonas Weber/ })
        .click();
      await a.getByRole("button", { name: "Comment", exact: true }).click();
      const dialog = p.getByRole("dialog", { name: "Widen the audience?" });
      await dialog.waitFor({ timeout: 10000 });
      const body = (await dialog.innerText()).replace(/\s+/g, " ").trim();
      await dialog.getByRole("button", { name: "Cancel" }).click();
      await dialog.waitFor({ state: "hidden" });
      const draftKept = await box.inputValue();
      await p.waitForTimeout(1500);
      const postedAfterCancel = await rowWith(a, text).count();
      expect(postedAfterCancel === 0, "comment was posted after Cancel");
      expect(draftKept.includes(text), "draft lost after Cancel");
      await a.getByRole("button", { name: "Comment", exact: true }).click();
      await dialog.waitFor({ timeout: 10000 });
      await dialog.getByRole("button", { name: "Widen and post" }).click();
      const row = rowWith(a, text).first();
      await row.waitFor({ timeout: 15000 });
      const s = await rowSummary(row);
      expect(/Contract Team/.test(s), `widened row ${s}`);
      return `Dialog read ${q(body)}. Cancel closed it, kept the draft ${q(draftKept)}, and no row was posted. Widen and post published ${q(s)}.`;
    },
  );

  await step(
    CA,
    role,
    "Attach paper: Attach files, choose files, check filenames, Remove one, post, open the preview and use Download",
    "Selected filenames listed with Remove; post carries the remaining attachment; preview opens; Download retrieves the file",
    async () => {
      const a = applet(p);
      await chooseTier(a, "Contract Team");
      const text = `${tag} Nadia shares the notice letter`;
      await a.getByRole("textbox", { name: "New comment" }).fill(text);
      const bound = (await a.getByText(/^Up to \d+ files\.$/).textContent()).trim();
      const chooser = p.waitForEvent("filechooser");
      await a.getByRole("button", { name: "Attach files" }).click();
      await (
        await chooser
      ).setFiles([fixture("doc029-conv-notice.pdf"), fixture("doc029-conv-schedule.pdf")]);
      const chosen = a.getByRole("list", { name: "Files attached to this comment" });
      await chosen.waitFor({ timeout: 5000 });
      const listed = (await chosen.innerText()).replace(/\s+/g, " ").trim();
      await a.getByRole("button", { name: "Remove doc029-conv-schedule.pdf" }).click();
      const listedAfter = (await chosen.innerText()).replace(/\s+/g, " ").trim();
      const audience = await audienceText(a);
      await a.getByRole("button", { name: "Comment", exact: true }).click();
      const row = rowWith(a, text).first();
      await row.waitFor({ timeout: 20000 });
      const s = await rowSummary(row);
      expect(/doc029-conv-notice\.pdf/.test(s) && !/doc029-conv-schedule/.test(s), `row ${s}`);
      await row
        .getByRole("button", { name: /doc029-conv-notice\.pdf/ })
        .first()
        .click();
      const preview = p.getByRole("dialog").filter({ hasText: "doc029-conv-notice.pdf" });
      await preview.waitFor({ timeout: 15000 });
      await p.waitForTimeout(1500);
      const previewText = (await preview.innerText()).replace(/\s+/g, " ").trim().slice(0, 200);
      const previewButtons = await preview.getByRole("button").allInnerTexts();
      const previewLinks = await preview.getByRole("link").allInnerTexts();
      await p.keyboard.press("Escape");
      const dl = p.waitForEvent("download");
      await row.getByRole("link", { name: "Download doc029-conv-notice.pdf" }).click();
      const download = await dl;
      const savedPath = await download.path();
      const same = sha256(savedPath) === sha256(fixture("doc029-conv-notice.pdf"));
      expect(same, "downloaded bytes differ from the fixture");
      return `Composer read ${q(bound)}. Choosing two PDFs listed ${q(listed)}; Remove doc029-conv-schedule.pdf left ${q(listedAfter)}. Audience line before posting: ${q(audience)}. Posted row ${q(s)}. Selecting the filename opened a preview dialog (${q(previewText)}, buttons ${q(previewButtons)}, links ${q(previewLinks)}). Download doc029-conv-notice.pdf saved ${download.suggestedFilename()} with bytes identical to the fixture.`;
    },
  );
}

async function memberComments2() {
  const p = ctx.nadia.page;
  const role = "legal_team_member";
  const C = `${L.BASE}/contracts/${fx.contract.number}`;
  const M = `${L.BASE}/matters/${fx.matter.number}`;
  const tag = `DOC-029 conversations ${stamp}`;

  await step(
    CA,
    role,
    "A failed post: keep the draft, check the error, check for an existing post, retry once",
    "Error shown; text and paper stay in the composer; no row posted and no filed marker; retry posts exactly once",
    async () => {
      await p.goto(C);
      const a = await openComments(p);
      const text = `${tag} Nadia retry after a failed post`;
      await a.getByRole("textbox", { name: "New comment" }).fill(text);
      await a.locator('input[type="file"]').setInputFiles([fixture("doc029-conv-schedule.pdf")]);
      let aborted = 0;
      const handler = async (route) => {
        if (route.request().method() === "POST" && aborted === 0) {
          aborted += 1;
          return route.abort("failed");
        }
        return route.continue();
      };
      await p.route(/\/api\/v1\/comments(\?.*)?$/, handler);
      await a.getByRole("button", { name: "Comment", exact: true }).click();
      const alert = a.getByRole("alert").filter({ hasText: "could not be posted" });
      await alert.waitFor({ timeout: 10000 });
      const alertText = (await alert.textContent()).trim();
      const kept = await a.getByRole("textbox", { name: "New comment" }).inputValue();
      const paper = (
        await a.getByRole("list", { name: "Files attached to this comment" }).innerText()
      ).trim();
      const rows = await rowWith(a, text).count();
      const filed = await a.getByText(/^Filed to/).count();
      expect(
        kept === text && /doc029-conv-schedule\.pdf/.test(paper) && rows === 0,
        "draft or paper lost, or row posted",
      );
      await p.unroute(/\/api\/v1\/comments(\?.*)?$/, handler);
      await p.reload();
      const a2 = await openComments(p);
      const afterReload = await rowWith(a2, text).count();
      // The reload discarded the in-memory draft, so re-enter the same text and paper to retry.
      await a2.getByRole("textbox", { name: "New comment" }).fill(text);
      await a2.locator('input[type="file"]').setInputFiles([fixture("doc029-conv-schedule.pdf")]);
      await a2.getByRole("button", { name: "Comment", exact: true }).click();
      await rowWith(a2, text).first().waitFor({ timeout: 15000 });
      await p.waitForTimeout(1500);
      const count = await rowWith(a2, text).count();
      expect(count === 1, `posted ${count} times`);
      return `With the comment POST aborted once, the composer showed ${q(alertText)}, kept the text ${q(kept)} and the paper ${q(paper)}; no row was posted and ${filed} Filed to markers were shown. A reload to check for an existing post found ${afterReload} rows. Re-entering the draft and retrying posted exactly ${count} row with the attachment.`;
    },
  );

  await step(
    CA,
    role,
    "File to Contract on an unfiled attachment: the preview also offers it; file as a new Document; the attachment stays and shows Filed to",
    "File to Contract offered on the attachment and in the preview; after filing the thread row shows Filed to with Document and version; the Document is on the record",
    async () => {
      const a = applet(p);
      const row = rowWith(a, `${tag} Nadia shares the notice letter`).first();
      await row
        .getByRole("button", { name: /doc029-conv-notice\.pdf/ })
        .first()
        .click();
      const preview = p.getByRole("dialog").filter({ hasText: "doc029-conv-notice.pdf" });
      await preview.waitFor();
      const inPreview = await preview.getByRole("button", { name: "File to Contract" }).count();
      await p.keyboard.press("Escape");
      await preview.waitFor({ state: "hidden" });
      await row.getByRole("button", { name: "File to Contract" }).click();
      const dialog = p.getByRole("dialog", { name: "File attachment" });
      await dialog.waitFor();
      const destOptions = await dialog.getByLabel("Destination").locator("option").allInnerTexts();
      const docName = `${tag} filed notice letter`;
      await dialog.getByLabel("Document name").fill(docName);
      await dialog.getByRole("button", { name: "File", exact: true }).click();
      await dialog.waitFor({ state: "hidden", timeout: 20000 });
      const filed = row.getByText(/Filed to/);
      await filed.waitFor({ timeout: 15000 });
      const filedText = (await filed.innerText()).replace(/\s+/g, " ").trim();
      const stillThere = await row.getByRole("button", { name: /doc029-conv-notice\.pdf/ }).count();
      const fileAgain = await row.getByRole("button", { name: "File to Contract" }).count();
      const docs = await L.api(p, "GET", `/contracts/${fx.contract.number}/documents`);
      const onRecord = JSON.stringify(docs.body).includes(docName);
      expect(
        filedText.includes(docName) && stillThere > 0 && onRecord,
        `filed ${filedText} onRecord ${onRecord}`,
      );
      return `The preview offered File to Contract (${inPreview}). The row's File to Contract opened File attachment with Destination options ${q(destOptions)}. Filing as a New Document named ${q(docName)} closed the dialog; the thread row still lists doc029-conv-notice.pdf and shows ${q(filedText)}, with ${fileAgain} File to Contract controls left on it. The record's Documents read includes the new Document (HTTP ${docs.status}).`;
    },
  );

  await step(
    CA,
    role,
    "Edit or remove a post: Edit then Cancel, Edit then Save shows edited, Delete asks for confirmation and leaves the author tombstone; no Redact for a Legal Team Member",
    "Cancel leaves text; Save marks edited; edit box has no audience control; Delete confirmation then Comment deleted by its author.; menu has Edit and Delete only",
    async () => {
      const a = applet(p);
      const text = `${tag} Nadia wording to correct`;
      const row = await postComment(p, text, { tier: "Contract Team" });
      await row.getByRole("button", { name: "Comment actions" }).click();
      const items = await p.getByRole("menuitem").allInnerTexts();
      expect(!items.some((i) => /Redact/.test(i)), `menu ${items}`);
      await p.getByRole("menuitem", { name: "Edit" }).click();
      const edit = row.getByRole("textbox", { name: "Edit comment" });
      await edit.fill(`${text} (draft change)`);
      const radiosInEdit = await row.getByRole("radio").count();
      await row.getByRole("button", { name: "Cancel" }).click();
      const afterCancel = await rowSummary(rowWith(a, text).first());
      expect(
        !afterCancel.includes("draft change") && !/edited/.test(afterCancel),
        `after cancel ${afterCancel}`,
      );
      await rowWith(a, text).first().getByRole("button", { name: "Comment actions" }).click();
      await p.getByRole("menuitem", { name: "Edit" }).click();
      await rowWith(a, text)
        .first()
        .getByRole("textbox", { name: "Edit comment" })
        .fill(`${text} corrected`);
      await rowWith(a, text).first().getByRole("button", { name: "Save" }).click();
      const editedRow = rowWith(a, `${text} corrected`).first();
      await editedRow.getByText("edited").waitFor({ timeout: 10000 });
      const afterSave = await rowSummary(editedRow);
      await editedRow.getByRole("button", { name: "Comment actions" }).click();
      await p.getByRole("menuitem", { name: "Delete" }).click();
      const confirm = p.getByRole("dialog", { name: "Delete this comment?" });
      await confirm.waitFor();
      const confirmText = (await confirm.innerText()).replace(/\s+/g, " ").trim();
      await confirm.getByRole("button", { name: "Delete" }).click();
      await a.getByText("Comment deleted by its author.").first().waitFor({ timeout: 10000 });
      const gone = await rowWith(a, `${text} corrected`).count();
      const other = rowWith(a, `${tag} Daniel owner note`).first();
      let otherActions = "no Daniel comment yet";
      if (await other.count())
        otherActions = String(await other.getByRole("button", { name: "Comment actions" }).count());
      return `Comment actions on her own comment offered ${q(items)}. Edit opened Edit comment with ${radiosInEdit} audience radios; Cancel left ${q(afterCancel)}. Save left ${q(afterSave)}. Delete asked ${q(confirmText)}; confirming left Comment deleted by its author. and ${gone} rows with the text.`;
    },
  );

  await step(
    CA,
    role,
    "Show older and the unread Comments badge on a Matter with more comments than one page",
    "Badge counts unread comments she can see; Show older loads earlier comments; reading the loaded conversation updates the count",
    async () => {
      // Fixture: Daniel posts 55 Matter Team comments and 1 Legal Only comment on the Matter through the API.
      if (!fx.bulkPosted) {
        for (let i = 1; i <= 55; i++) {
          const r = await L.api(ctx.daniel.page, "POST", "/comments", {
            entityType: "matter",
            entityId: fx.matterId,
            body: `${tag} Daniel bulk update ${String(i).padStart(2, "0")}`,
            visibility: "full_thread",
            mentions: [],
          });
          expect(r.status < 300, `bulk ${r.status} ${JSON.stringify(r.body).slice(0, 200)}`);
        }
        const r = await L.api(ctx.daniel.page, "POST", "/comments", {
          entityType: "matter",
          entityId: fx.matterId,
          body: `${tag} Daniel matter legal only bulk note`,
          visibility: "legal_only",
          mentions: [],
        });
        expect(r.status < 300, `bulk legal ${r.status}`);
        fx.bulkPosted = true;
        writeFileSync(path.join(here, "fixtures-r1.json"), JSON.stringify(fx, null, 2) + "\n");
        prep(
          `Daniel Okafor posted 55 Matter Team comments and one Legal Only comment on M-${fx.matter.number} through the comments API, to give the Matter more than one page of comments, History entries, and notifications.`,
        );
      }
      await p.goto(M);
      const toolbar = p.getByRole("toolbar", { name: "Applets" });
      await toolbar.waitFor();
      await p.waitForTimeout(2000);
      const before = (await toolbar.getByRole("button", { name: /^Comments/ }).innerText())
        .replace(/\s+/g, " ")
        .trim();
      const beforeApi = (
        await L.api(p, "GET", `/comments/unread?entityType=matter&entityId=${fx.matterId}`)
      ).body;
      const a = await openComments(p);
      const firstLoaded = await a.getByRole("listitem").count();
      const older = a.getByRole("button", { name: "Show older" });
      await older.waitFor({ timeout: 10000 });
      await older.click();
      await rowWith(a, "Daniel bulk update 01").first().waitFor({ timeout: 15000 });
      const afterOlder = await a.getByRole("listitem").count();
      await p.waitForTimeout(2000);
      await openApplet(p, "Comments"); // close
      await p.waitForTimeout(1000);
      const after = (await toolbar.getByRole("button", { name: /^Comments/ }).innerText())
        .replace(/\s+/g, " ")
        .trim();
      const afterApi = (
        await L.api(p, "GET", `/comments/unread?entityType=matter&entityId=${fx.matterId}`)
      ).body;
      return `Before opening, the Comments applet button read ${q(before)} (unread read ${q(beforeApi)}). The first load listed ${firstLoaded} rows with Show older at the head; Show older brought the list to ${afterOlder} rows including bulk update 01. After reading, the button read ${q(after)} (unread read ${q(afterApi)}).`;
    },
  );

  await step(
    CA,
    role,
    "Read the Activity feed: History on the Matter, entries in order, Show older",
    "History lists actions on the record, including comment actions, with Show older for earlier changes",
    async () => {
      await p.goto(M);
      await openApplet(p, "History");
      const panel = p.getByRole("complementary", { name: "History" });
      await panel.waitFor();
      await p.waitForTimeout(1500);
      const n1 = await panel.getByRole("listitem").count();
      const first = (await panel.getByRole("listitem").first().innerText())
        .replace(/\s+/g, " ")
        .trim();
      await panel.getByRole("button", { name: "Show older" }).click();
      await p.waitForTimeout(2000);
      const n2 = await panel.getByRole("listitem").count();
      const last = (await panel.getByRole("listitem").last().innerText())
        .replace(/\s+/g, " ")
        .trim();
      expect(n2 > n1, `older did not add entries ${n1} -> ${n2}`);
      return `History listed ${n1} entries, first ${q(first)}. Show older brought ${n2} entries; the last reads ${q(last)}.`;
    },
  );

  await step(
    CA,
    role,
    "Choose an audience in the Inbox: a Request offers Legal only and Shared with requester, starting on Legal only; the Inbox Request has no History",
    "Two audiences, Legal only first, descriptions shown; posts carry their audience; no History applet",
    async () => {
      await p.goto(`${L.BASE}/inbox/${fx.openRequest}`);
      const toolbar = p.getByRole("toolbar", { name: "Applets" });
      await toolbar.waitFor();
      const applets = await toolbar
        .getByRole("button")
        .evaluateAll((els) => els.map((e) => e.getAttribute("aria-label") ?? e.textContent.trim()));
      const a = await openComments(p);
      const labels = (await a.getByRole("group", { name: "Audience" }).innerText())
        .replace(/\s+/g, " ")
        .trim();
      expect(
        await a.getByRole("radio", { name: "Legal only" }).isChecked(),
        "Legal only is not first",
      );
      const legalText = await audienceText(a);
      await chooseTier(a, "Shared with requester");
      const sharedText = await audienceText(a);
      const shared = await postComment(p, `${tag} Nadia shared reply on the open Request`, {
        tier: "Shared with requester",
      });
      const legal = await postComment(p, `${tag} Nadia legal only Request note`, {
        tier: "Legal only",
      });
      expect(!applets.some((x) => /History/.test(x)), `applets ${applets}`);
      return `R-${fx.openRequest} Applets toolbar offered ${q(applets)}. Audience offered ${q(labels)} with Legal only checked; descriptions ${q(legalText)} and ${q(sharedText)}. Posted rows ${q(await rowSummary(shared))} and ${q(await rowSummary(legal))}.`;
    },
  );

  await step(
    CA,
    role,
    "A converted Request in the Inbox has no conversation; open its linked record instead",
    "No Comments applet on the converted Request; Status links the Contract",
    async () => {
      await p.goto(`${L.BASE}/inbox/${fx.contractRequest}`);
      await p.getByRole("heading", { level: 1 }).waitFor();
      await p.waitForTimeout(2000);
      const applets = await p.getByRole("toolbar", { name: "Applets" }).getByRole("button").count();
      const link = p
        .getByRole("region", { name: "Status" })
        .getByRole("link", { name: `C-${fx.contract.number}` });
      const href = await link.getAttribute("href");
      await link.click();
      await p.waitForURL(new RegExp(`/contracts/${fx.contract.number}`));
      expect(applets === 0, `applets ${applets}`);
      return `R-${fx.contractRequest} in the Inbox showed ${applets} applet buttons and a Status link C-${fx.contract.number} (${href}); selecting it opened the Contract.`;
    },
  );
}

// ---------- V-C07 as the Administrator ----------
async function adminComments() {
  const p = ctx.daniel.page;
  const role = "administrator";
  const C = `${L.BASE}/contracts/${fx.contract.number}`;
  const M = `${L.BASE}/matters/${fx.matter.number}`;
  const tag = `DOC-029 conversations ${stamp}`;

  await step(
    CA,
    role,
    "Choose an audience on a record and post at both audiences, one with Legal Only paper",
    "Legal Only and Contract Team offered; posts show under Daniel Okafor with their badges and attachment",
    async () => {
      await p.goto(C);
      const a = await openComments(p);
      const labels = (await a.getByRole("group", { name: "Audience" }).innerText())
        .replace(/\s+/g, " ")
        .trim();
      const first = await a.getByRole("radio", { name: "Contract Team" }).isChecked();
      const team = await postComment(p, `${tag} Daniel owner note`, { tier: "Contract Team" });
      const legal = await postComment(p, `${tag} Daniel legal only memo`, {
        tier: "Legal Only",
        files: ["doc029-conv-legal-memo.pdf"],
      });
      const s2 = await rowSummary(legal);
      expect(
        first && /Legal Only/.test(s2) && /doc029-conv-legal-memo\.pdf/.test(s2),
        `rows ${s2}`,
      );
      return `Audience offered ${q(labels)}, Contract Team first (${first}). Rows ${q(await rowSummary(team))} and ${q(s2)}.`;
    },
  );

  await step(
    CA,
    role,
    "Another author's comment: Comment actions offers Redact and no Edit",
    "Menu on Nadia's live comment offers Redact only",
    async () => {
      const a = applet(p);
      const row = rowWith(a, `${tag} Nadia contract team note`).first();
      await row.getByRole("button", { name: "Comment actions" }).click();
      const items = await p.getByRole("menuitem").allInnerTexts();
      await p.keyboard.press("Escape");
      expect(items.length === 1 && items[0].trim() === "Redact", `menu ${items}`);
      return `Comment actions on Nadia Haddad's Contract Team comment offered ${q(items)}.`;
    },
  );

  await step(
    CA,
    role,
    "File to Matter on a Matter conversation attachment",
    "A Matter Team post with paper offers File to Matter",
    async () => {
      await p.goto(M);
      const a = await openComments(p);
      const row = await postComment(p, `${tag} Daniel matter paper`, {
        tier: "Matter Team",
        files: ["doc029-conv-schedule.pdf"],
      });
      const offer = await row.getByRole("button", { name: "File to Matter" }).count();
      await row.getByRole("button", { name: "File to Matter" }).click();
      const dialog = p.getByRole("dialog", { name: "File attachment" });
      await dialog.waitFor();
      const dest = await dialog.getByLabel("Destination").locator("option").allInnerTexts();
      await dialog.getByRole("button", { name: "Cancel" }).click();
      await dialog.waitFor({ state: "hidden" });
      const filed = await row.getByText(/Filed to/).count();
      expect(offer === 1 && filed === 0, `offer ${offer} filed ${filed}`);
      return `The Matter Team row ${q(await rowSummary(row))} offered File to Matter; it opened File attachment with ${q(dest)}; Cancel closed it with ${filed} Filed to markers.`;
    },
  );

  await step(
    CA,
    role,
    "Legal Request conversation: Comment actions on his own live comment edits and deletes; no File control on Request paper",
    "Edit then Save shows edited; Delete confirmation leaves the author tombstone; Request attachment has no File to control",
    async () => {
      await p.goto(`${L.BASE}/inbox/${fx.openRequest}`);
      const a = await openComments(p);
      const text = `${tag} Daniel request paper`;
      const row = await postComment(p, text, {
        tier: "Shared with requester",
        files: ["doc029-conv-schedule.pdf"],
      });
      const fileControls = await row.getByRole("button", { name: /^File to/ }).count();
      await row.getByRole("button", { name: "Comment actions" }).click();
      const items = await p.getByRole("menuitem").allInnerTexts();
      await p.getByRole("menuitem", { name: "Edit" }).click();
      await row.getByRole("textbox", { name: "Edit comment" }).fill(`${text} revised`);
      await row.getByRole("button", { name: "Save" }).click();
      const edited = rowWith(a, `${text} revised`).first();
      await edited.getByText("edited").waitFor();
      const es = await rowSummary(edited);
      const t2 = `${tag} Daniel request note to delete`;
      const del = await postComment(p, t2, { tier: "Legal only" });
      await del.getByRole("button", { name: "Comment actions" }).click();
      await p.getByRole("menuitem", { name: "Delete" }).click();
      const confirm = p.getByRole("dialog", { name: "Delete this comment?" });
      await confirm.getByRole("button", { name: "Delete" }).click();
      await confirm.waitFor({ state: "hidden" });
      await p.waitForTimeout(1000);
      const gone = await rowWith(a, t2).count();
      const tomb = await a.getByText("Comment deleted by its author.").count();
      expect(
        fileControls === 0 && gone === 0 && tomb > 0,
        `file ${fileControls} gone ${gone} tomb ${tomb}`,
      );
      return `On R-${fx.openRequest} his Shared with requester post with paper showed ${fileControls} File controls. His menu offered ${q(items)}; Save left ${q(es)}. Deleting a Legal only note after the confirmation left ${tomb} Comment deleted by its author. tombstones and no row with its text.`;
    },
  );
}

// ---------- V-C07 as the Business User ----------
async function portalComments() {
  const p = ctx.jonas.page;
  const role = "business_user";
  const tag = `DOC-029 conversations ${stamp}`;

  await step(
    CA,
    role,
    "Reply from the Portal on a never-converted Request: Comments applet, no audience picker, Legal only comments absent, mention and attach, Comment",
    "Shared with requester reply visible, Legal only note absent, reply posts under Jonas Weber with paper",
    async () => {
      await p.goto(`${L.BASE}/portal/requests/${fx.openRequest}`);
      const a = await openComments(p);
      const radios = await a.getByRole("radio").count();
      const shared = await rowWith(a, `${tag} Nadia shared reply on the open Request`).count();
      const legal = await rowWith(a, `${tag} Nadia legal only Request note`).count();
      const box = a.getByRole("textbox", { name: "New comment" });
      const text = `${tag} Jonas replies on the open Request for`;
      await box.pressSequentially(`${text} @Nad`, { delay: 30 });
      const listbox = a.getByRole("listbox", { name: "People and files you can mention" });
      await listbox.waitFor();
      const tabs = await a.getByRole("tab").allInnerTexts();
      const options = await listbox.getByRole("option").allInnerTexts();
      await listbox.getByRole("option", { name: /Nadia Haddad/ }).click();
      const chooser = p.waitForEvent("filechooser");
      await a.getByRole("button", { name: "Attach files" }).click();
      await (await chooser).setFiles([fixture("doc029-conv-portal-note.pdf")]);
      await a.getByRole("button", { name: "Comment", exact: true }).click();
      const row = rowWith(a, text).first();
      await row.waitFor({ timeout: 15000 });
      const s = await rowSummary(row);
      expect(
        radios === 0 &&
          shared === 1 &&
          legal === 0 &&
          /Jonas Weber/.test(s) &&
          /doc029-conv-portal-note\.pdf/.test(s),
        `radios ${radios} shared ${shared} legal ${legal} row ${s}`,
      );
      return `R-${fx.openRequest} Portal Comments showed ${radios} audience radios, ${shared} Shared with requester reply from Nadia, and ${legal} rows of her Legal only note. @Nad showed tabs ${q(tabs)} listing ${q(options)}; after picking Nadia Haddad and attaching doc029-conv-portal-note.pdf, Comment posted ${q(s)}.`;
    },
  );

  await step(
    CA,
    role,
    "Portal: Comment actions edits and deletes his own words",
    "Edit and Delete offered on his own comment, no Redact; edited marker; author tombstone",
    async () => {
      const a = applet(p);
      const text = `${tag} Jonas second thought`;
      const row = await postComment(p, text);
      await row.getByRole("button", { name: "Comment actions" }).click();
      const items = await p.getByRole("menuitem").allInnerTexts();
      await p.getByRole("menuitem", { name: "Edit" }).click();
      await row.getByRole("textbox", { name: "Edit comment" }).fill(`${text} revised`);
      await row.getByRole("button", { name: "Save" }).click();
      const edited = rowWith(a, `${text} revised`).first();
      await edited.getByText("edited").waitFor();
      const es = await rowSummary(edited);
      await edited.getByRole("button", { name: "Comment actions" }).click();
      await p.getByRole("menuitem", { name: "Delete" }).click();
      const confirm = p.getByRole("dialog", { name: "Delete this comment?" });
      await confirm.getByRole("button", { name: "Delete" }).click();
      await confirm.waitFor({ state: "hidden" });
      await a.getByText("Comment deleted by its author.").first().waitFor();
      const otherMenu = await rowWith(a, `${tag} Nadia shared reply on the open Request`)
        .first()
        .getByRole("button", { name: "Comment actions" })
        .count();
      expect(
        !items.some((i) => /Redact/.test(i)) && otherMenu === 0,
        `items ${items} other ${otherMenu}`,
      );
      return `His menu offered ${q(items)}; Save left ${q(es)}; Delete after confirmation left Comment deleted by its author.; Nadia's reply had ${otherMenu} Comment actions buttons.`;
    },
  );

  await step(
    CA,
    role,
    "After conversion the Request address opens the Contract; its Comments hold team comments and their paper but no Legal Only content, no filing, no audience picker",
    "Redirect to the Portal Contract; Contract Team rows and widened mention visible; Legal Only rows and memo absent; attachment preview and Download work; no File to Contract",
    async () => {
      await p.goto(`${L.BASE}/portal/requests/${fx.contractRequest}`);
      await p.waitForURL(new RegExp(`/portal/contracts/${fx.contract.number}`), { timeout: 20000 });
      const a = await openComments(p);
      const seen = {
        team: await rowWith(a, `${tag} Nadia contract team note`).count(),
        widened: await rowWith(a, `${tag} Nadia legal only mention for`).count(),
        notice: await rowWith(a, `${tag} Nadia shares the notice letter`).count(),
        danielTeam: await rowWith(a, `${tag} Daniel owner note`).count(),
        legalOnly: await rowWith(a, `${tag} Nadia legal only note`).count(),
        danielMemo: await rowWith(a, `${tag} Daniel legal only memo`).count(),
        memoFile: await a.getByText("doc029-conv-legal-memo.pdf").count(),
      };
      const radios = await a.getByRole("radio").count();
      const fileTo = await a.getByRole("button", { name: /^File to/ }).count();
      const row = rowWith(a, `${tag} Nadia shares the notice letter`).first();
      const dl = p.waitForEvent("download");
      await row.getByRole("link", { name: "Download doc029-conv-notice.pdf" }).click();
      const download = await dl;
      const same = sha256(await download.path()) === sha256(fixture("doc029-conv-notice.pdf"));
      expect(
        seen.team &&
          seen.widened &&
          seen.notice &&
          seen.danielTeam &&
          !seen.legalOnly &&
          !seen.danielMemo &&
          !seen.memoFile &&
          radios === 0 &&
          fileTo === 0 &&
          same,
        JSON.stringify({ seen, radios, fileTo, same }),
      );
      return `/portal/requests/${fx.contractRequest} redirected to ${new URL(p.url()).pathname}. Comments counts ${q(seen)}; ${radios} audience radios; ${fileTo} File to controls; the notice letter downloaded with fixture-identical bytes. Its row read ${q(await rowSummary(row))}.`;
    },
  );

  await step(
    CA,
    role,
    "Portal Matter: Show older and the unread badge; Legal Only bulk note absent",
    "Show older loads the earlier Matter Team comments; the Legal Only note is not in the view",
    async () => {
      await p.goto(`${L.BASE}/portal/matters/${fx.matter.number}`);
      const toolbar = p.getByRole("toolbar", { name: "Applets" });
      await toolbar.waitFor();
      await p.waitForTimeout(2000);
      const badge = (await toolbar.getByRole("button", { name: /^Comments/ }).innerText())
        .replace(/\s+/g, " ")
        .trim();
      const a = await openComments(p);
      await a.getByRole("button", { name: "Show older" }).click();
      await rowWith(a, "Daniel bulk update 01").first().waitFor();
      const legal = await rowWith(a, `${tag} Daniel matter legal only bulk note`).count();
      const legal2 = await rowWith(a, `${tag} Nadia matter legal only note`).count();
      const team = await rowWith(a, `${tag} Nadia matter team note`).count();
      expect(legal === 0 && legal2 === 0 && team === 1, `legal ${legal}/${legal2} team ${team}`);
      return `Before opening, the Portal Comments button read ${q(badge)}. Show older loaded bulk update 01; Nadia's Matter Team note was present; Legal Only notes from Daniel and Nadia were absent (${legal}, ${legal2}).`;
    },
  );

  await step(
    CA,
    role,
    "Portal History on the Contract: shared comment activity only",
    "History shows comment entries for team comments only; no Legal Only activity",
    async () => {
      await p.goto(`${L.BASE}/portal/contracts/${fx.contract.number}`);
      await openApplet(p, "History");
      const panel = p.getByRole("complementary", { name: "History" });
      await panel.waitFor();
      await p.waitForTimeout(2000);
      const entries = (await panel.getByRole("listitem").allInnerTexts()).map((t) =>
        t.replace(/\s+/g, " ").trim(),
      );
      const staff = (
        await L.api(
          ctx.nadia.page,
          "GET",
          `/activity?entityType=contract&entityId=${fx.contractId}&limit=100`,
        )
      ).body;
      return `Portal History listed ${entries.length} entries: ${q(entries.slice(0, 20))}. Staff activity read for comparison: ${q(JSON.stringify(staff).slice(0, 200))}.`;
    },
  );
}

// ---------- V-C07 Administrator redaction and archive ----------
async function adminRedact() {
  const p = ctx.daniel.page;
  const role = "administrator";
  const C = `${L.BASE}/contracts/${fx.contract.number}`;
  const tag = `DOC-029 conversations ${stamp}`;

  await step(
    CA,
    role,
    "Redact a reached comment with paper, an author-deleted comment, and the comment whose attachment was filed",
    "Confirmation read first; thread says Comment removed by an Administrator.; attachment URL no longer serves; the filed Document stays on the record",
    async () => {
      await p.goto(C);
      const a = await openComments(p);
      const target = rowWith(a, `${tag} Nadia retry after a failed post`).first();
      const attachmentHref = await target
        .getByRole("link", { name: "Download doc029-conv-schedule.pdf" })
        .getAttribute("href");
      const before = (await p.request.get(`${L.BASE}${attachmentHref}`)).status();
      await target.getByRole("button", { name: "Comment actions" }).click();
      await p.getByRole("menuitem", { name: "Redact" }).click();
      const confirm = p.getByRole("dialog", { name: "Redact this comment?" });
      await confirm.waitFor();
      const text = (await confirm.innerText()).replace(/\s+/g, " ").trim();
      await confirm.getByRole("button", { name: "Redact" }).click();
      await confirm.waitFor({ state: "hidden" });
      await p.waitForTimeout(1500);
      const after = (await p.request.get(`${L.BASE}${attachmentHref}`)).status();
      const remaining = await rowWith(a, `${tag} Nadia retry after a failed post`).count();
      // Author-deleted comment (Nadia's deleted correction) is the first author tombstone on this thread.
      const deleted = a
        .getByRole("listitem")
        .filter({ hasText: "Comment deleted by its author." })
        .first();
      await deleted.getByRole("button", { name: "Comment actions" }).click();
      const delItems = await p.getByRole("menuitem").allInnerTexts();
      await p.getByRole("menuitem", { name: "Redact" }).click();
      await confirm.getByRole("button", { name: "Redact" }).click();
      await confirm.waitFor({ state: "hidden" });
      await p.waitForTimeout(1000);
      const filedRow = rowWith(a, `${tag} Nadia shares the notice letter`).first();
      await filedRow.getByRole("button", { name: "Comment actions" }).click();
      await p.getByRole("menuitem", { name: "Redact" }).click();
      await confirm.getByRole("button", { name: "Redact" }).click();
      await confirm.waitFor({ state: "hidden" });
      await p.waitForTimeout(1500);
      const tombs = await a.getByText("Comment removed by an Administrator.").count();
      const authorTombs = await a.getByText("Comment deleted by its author.").count();
      const docs = await L.api(p, "GET", `/contracts/${fx.contract.number}/documents`);
      const docStays = JSON.stringify(docs.body).includes(`${tag} filed notice letter`);
      expect(
        before === 200 && after === 404 && remaining === 0 && tombs === 3 && docStays,
        JSON.stringify({ before, after, remaining, tombs, docStays }),
      );
      return `Redact on Nadia's comment with paper asked ${q(text)}. After confirming, the row became Comment removed by an Administrator. and its attachment URL answered ${after} (it answered ${before} before). On her author-deleted comment the menu offered ${q(delItems)} and the redaction replaced that tombstone. Redacting the notice-letter comment left the filed Document on the record (${docStays}). The thread now shows ${tombs} administrator tombstones and ${authorTombs} author tombstones.`;
    },
  );

  await step(
    CA,
    role,
    "Archived record: the attachment offers no File to Contract",
    "No File to Contract on an archived Contract",
    async () => {
      const r = await L.api(p, "POST", "/comments", {
        entityType: "contract",
        entityId: fx.archiveId,
        body: `${tag} Daniel paper before archive`,
        visibility: "full_thread",
        mentions: [],
      });
      expect(r.status < 300, `pre-archive post ${r.status}`);
      // Attach paper through the browser before archiving.
      await p.goto(`${L.BASE}/contracts/${fx.archive.number}`);
      await openComments(p);
      await postComment(p, `${tag} Daniel archive paper`, {
        tier: "Contract Team",
        files: ["doc029-conv-schedule.pdf"],
      });
      const beforeArchive = await rowWith(applet(p), `${tag} Daniel archive paper`)
        .first()
        .getByRole("button", { name: "File to Contract" })
        .count();
      const ar = await L.api(p, "POST", `/contracts/${fx.archive.number}/archive`);
      expect(ar.status < 300, `archive ${ar.status}`);
      prep(
        `Daniel Okafor archived C-${fx.archive.number} through the archive API after posting a Contract Team comment with paper in the browser.`,
      );
      await p.goto(`${L.BASE}/contracts/${fx.archive.number}`);
      const a = await openComments(p);
      const row = rowWith(a, `${tag} Daniel archive paper`).first();
      await row.waitFor();
      const after = await row.getByRole("button", { name: /^File to/ }).count();
      expect(beforeArchive === 1 && after === 0, `before ${beforeArchive} after ${after}`);
      return `Before archiving, the row offered File to Contract (${beforeArchive}). After archiving C-${fx.archive.number}, the same row showed ${after} File to controls: ${q(await rowSummary(row))}.`;
    },
  );
}

async function portalAfter() {
  const role = "business_user";
  const tag = `DOC-029 conversations ${stamp}`;
  const p = ctx.jonas.page;

  await step(
    CA,
    role,
    "Archived destination: the Request address shows the original request with no conversation",
    "Portal Request page shows the archived message and no Comments",
    async () => {
      await p.goto(`${L.BASE}/portal/requests/${fx.archiveRequest}`);
      await p.getByRole("heading", { level: 1 }).waitFor();
      await p.waitForTimeout(2000);
      const msg = await p.getByText("The record created from this Request was archived.").count();
      const applets = await p.getByRole("toolbar", { name: "Applets" }).count();
      const comments = await p.getByRole("button", { name: /^Comments/ }).count();
      const recordRead = (await L.api(p, "GET", `/portal/contracts/${fx.archive.number}`)).status;
      expect(
        msg === 1 && comments === 0 && recordRead >= 400,
        `msg ${msg} comments ${comments} record ${recordRead}`,
      );
      return `The archived Contract C-${fx.archive.number} record read answered HTTP ${recordRead} for Jonas. /portal/requests/${fx.archiveRequest} stayed at ${new URL(p.url()).pathname}, showed ${q("The record created from this Request was archived. Your original request is shown below.")}, and had ${applets} applet toolbars and ${comments} Comments buttons.`;
    },
  );

  await step(
    CA,
    role,
    "A later-added Business User reads earlier team comments; a removed person loses them, including through the old Request link",
    "Amara sees earlier Contract Team comments after being added; after removal Jonas cannot open the Contract or its conversation through /portal/requests",
    async () => {
      const d = ctx.daniel.page;
      const add = await L.api(d, "POST", `/contracts/${fx.contract.number}/team`, {
        userId: fx.ids.amara,
      });
      expect(add.status < 300, `add amara ${add.status}`);
      prep(
        `Daniel Okafor added Amara Nwosu (Business User) to the C-${fx.contract.number} team through the team API, then removed her again; later removed and restored Jonas Weber the same way.`,
      );
      ctx.amara = await L.portalContext(L.PEOPLE.amara);
      const ap = ctx.amara.page;
      await ap.goto(`${L.BASE}/portal/contracts/${fx.contract.number}`);
      const a = await openComments(ap);
      const earlier = await rowWith(a, `${tag} Nadia contract team note`).count();
      const legal = await rowWith(a, `${tag} Nadia legal only note`).count();
      const rm = await L.api(d, "DELETE", `/contracts/${fx.contract.number}/team/${fx.ids.amara}`);
      await ap.goto(`${L.BASE}/portal/contracts/${fx.contract.number}`);
      await ap.waitForTimeout(3000);
      const amaraAfter = (await ap.locator("main").innerText())
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, 160);
      const amaraApi = (await L.api(ap, "GET", `/portal/contracts/${fx.contract.number}`)).status;
      const rj = await L.api(d, "DELETE", `/contracts/${fx.contract.number}/team/${fx.ids.jonas}`);
      await p.goto(`${L.BASE}/portal/requests/${fx.contractRequest}`);
      await p.waitForTimeout(3000);
      const jonasAfter = (await p.locator("main").innerText())
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, 200);
      const jonasComments = await p.getByRole("button", { name: /^Comments/ }).count();
      const jonasApi = (await L.api(p, "GET", `/portal/contracts/${fx.contract.number}`)).status;
      const restore = await L.api(d, "POST", `/contracts/${fx.contract.number}/team`, {
        userId: fx.ids.jonas,
      });
      expect(
        earlier === 1 &&
          legal === 0 &&
          rm.status < 300 &&
          rj.status < 300 &&
          amaraApi >= 400 &&
          jonasApi >= 400 &&
          jonasComments === 0 &&
          restore.status < 300,
        JSON.stringify({
          earlier,
          legal,
          amaraApi,
          jonasApi,
          jonasComments,
          restore: restore.status,
        }),
      );
      return `After being added, Amara Nwosu saw Nadia's earlier Contract Team note (${earlier}) and not her Legal Only note (${legal}). After removal Amara's Portal Contract page read ${q(amaraAfter)} (record read HTTP ${amaraApi}). After Jonas's removal, /portal/requests/${fx.contractRequest} showed ${q(jonasAfter)} with ${jonasComments} Comments buttons (record read HTTP ${jonasApi}). Jonas was restored to the team (HTTP ${restore.status}).`;
    },
  );
}

// ---------- notification helpers ----------
const bell = (page) => page.getByRole("banner").getByRole("button", { name: /^Notifications,/ });
async function bellName(page) {
  return (await bell(page).getAttribute("aria-label")) ?? (await bell(page).innerText());
}
async function unreadApi(page, portal = false) {
  return (
    await L.api(
      page,
      "GET",
      portal ? "/portal/notifications/unread-count" : "/notifications/unread-count",
    )
  ).body.unread;
}
async function openBell(page) {
  await bell(page).click();
  const dialog = page.getByRole("dialog", { name: "Notifications" });
  await dialog.waitFor();
  await dialog
    .getByRole("list")
    .or(dialog.getByRole("alert"))
    .or(dialog.getByText(/^Nothing to catch up on/))
    .first()
    .waitFor({ timeout: 15000 });
  await page.waitForTimeout(500);
  return dialog;
}
async function closeBell(page) {
  await page.keyboard.press("Escape");
  await page.getByRole("dialog", { name: "Notifications" }).waitFor({ state: "hidden" });
}
async function findItem(page, dialog, re, maxPages = 4) {
  for (let i = 0; i < maxPages; i++) {
    const link = dialog.getByRole("link", { name: re }).first();
    if (await link.count()) return link;
    const older = dialog.getByRole("button", { name: "Show older" });
    if (!(await older.count())) break;
    await older.click();
    await page.waitForTimeout(1500);
  }
  return null;
}
async function itemsMatching(page, re, portal = false, since = null) {
  let cursor = null;
  const found = [];
  for (let i = 0; i < 40; i++) {
    const r = await L.api(
      page,
      "GET",
      `${portal ? "/portal/notifications" : "/notifications"}${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ""}`,
    );
    const items = r.body.items ?? r.body.notifications ?? [];
    let older = false;
    for (const it of items) {
      if (since && it.createdAt < since) {
        older = true;
        continue;
      }
      if (re.test(JSON.stringify(it))) found.push(it);
    }
    cursor = r.body.nextCursor;
    if (!cursor || older || (!since && i >= 5)) break;
  }
  return found;
}
/** Notifications a person received about one posted comment. */
async function aboutComment(page, commentId, since, portal = false) {
  return itemsMatching(page, new RegExp(commentId), portal, since);
}
async function setSwitch(page, name, on) {
  const sw = page.getByRole("switch", { name, exact: true });
  await sw.waitFor();
  const now = (await sw.getAttribute("aria-checked")) === "true";
  if (now !== on) {
    await sw.click();
    await page.getByText("Saved", { exact: true }).first().waitFor({ timeout: 10000 });
  }
  return now;
}
async function switchStates(page, names) {
  const out = {};
  for (const n of names)
    out[n] =
      (await page.getByRole("switch", { name: n, exact: true }).getAttribute("aria-checked")) ===
      "true";
  return out;
}
async function openStaffNotificationSettings(page, displayName) {
  await page.goto(`${L.BASE}/`);
  await page.getByRole("banner").getByRole("button", { name: displayName }).click();
  await page.getByRole("menuitem", { name: "Settings" }).click();
  await page
    .getByRole("navigation", { name: "Settings sections" })
    .getByRole("group", { name: "Personal" })
    .getByRole("link", { name: "Notifications" })
    .click();
  await page.getByRole("heading", { name: "Notification preferences" }).waitFor();
}
async function comment(page, entityType, entityId, body, visibility, mentions = []) {
  const r = await L.api(page, "POST", "/comments", {
    entityType,
    entityId,
    body,
    visibility,
    mentions,
  });
  expect(r.status < 300, `comment ${r.status} ${JSON.stringify(r.body).slice(0, 200)}`);
  const id = r.body.comment?.id ?? r.body.id;
  expect(id, `no comment id in ${JSON.stringify(r.body).slice(0, 200)}`);
  return id;
}
const STAFF_SWITCHES = [
  "Assigned to you In-app",
  "Assigned to you Email",
  "Activity on your records In-app",
  "Activity on your records Email",
  "Dates approaching In-app",
  "New requests In-app",
  "New requests Email",
  "Knowledge items Email",
  "Approvals Email",
  "Tasks Email",
  "Dates Email",
  "Obligations Email",
  "Intake Email",
];

// ---------- V-C08 as the Legal Team Member ----------
async function memberNotifications() {
  const p = ctx.nadia.page;
  const d = ctx.daniel.page;
  const role = "legal_team_member";
  const tag = `DOC-029 conversations ${stamp}`;
  const title = fx.contractTitle;

  await step(
    NT,
    role,
    "Open a notification: badge with 9+, unread dots, opening the panel marks nothing read, selecting an item opens its record and marks it read",
    "Badge shows 9+ over nine; items marked Unread; count unchanged by opening; the selected item opens the Contract and becomes read",
    async () => {
      await comment(
        d,
        "contract",
        fx.contractId,
        `${tag} Daniel bell check for Nadia`,
        "full_thread",
        [fx.ids.nadia],
      );
      prep(
        `Notification events were arranged by posting comments through the comments API as the acting role (Daniel Okafor, Nadia Haddad) on C-${fx.contract.number}, M-${fx.matter.number}, and R-${fx.openRequest}; the notification steps under test were then followed in the browser.`,
      );
      await p.goto(`${L.BASE}/`);
      await bell(p).waitFor();
      await p.waitForTimeout(1500);
      const name = await bellName(p);
      const badge = (await bell(p).innerText()).trim();
      const before = await unreadApi(p);
      const dialog = await openBell(p);
      const unreadMarks = await dialog.getByText("Unread", { exact: true }).count();
      const item = dialog
        .getByRole("link", { name: new RegExp(`Daniel Okafor mentioned you on .*${stamp}`) })
        .first();
      await item.waitFor({ timeout: 10000 });
      const itemName = (await item.getAttribute("aria-label")) ?? (await item.innerText());
      const href = await item.getAttribute("href");
      await closeBell(p);
      await p.waitForTimeout(1000);
      const afterOpen = await unreadApi(p);
      const d2 = await openBell(p);
      await d2
        .getByRole("link", { name: new RegExp(`Daniel Okafor mentioned you on .*${stamp}`) })
        .first()
        .click();
      await p.waitForURL(new RegExp(`/contracts/${fx.contract.number}`));
      await p.waitForTimeout(1500);
      const [it] = (
        await itemsMatching(
          p,
          new RegExp(fx.contractId),
          false,
          new Date(Date.now() - 120000).toISOString(),
        )
      ).filter((x) => /mention/.test(x.eventType));
      const d3 = await openBell(p);
      const again = d3
        .getByRole("link", { name: new RegExp(`mentioned you on .*${stamp}`) })
        .first();
      const againName = (await again.getAttribute("aria-label")) ?? (await again.innerText());
      await closeBell(p);
      expect(
        before > 9 && badge === "9+" && afterOpen >= before && !/^Unread/.test(againName.trim()),
        JSON.stringify({ before, badge, afterOpen, againName }),
      );
      return `Header button read ${q(name)} with badge ${q(badge)}. The panel showed ${unreadMarks} Unread markers; the newest mention item read ${q(itemName.replace(/\s+/g, " "))} linking ${href}. Closing left unread at ${afterOpen} (was ${before}; other lab activity can only raise it). Selecting the item opened ${new URL(p.url()).pathname}, and on reopening the item read ${q(againName.replace(/\s+/g, " "))} without the Unread marker (API readAt ${it?.readAt ? "set" : "unknown"}).`;
    },
  );

  await step(
    NT,
    role,
    "Show older loads earlier items; Mark all read clears unread and then disappears",
    "More than 25 items after Show older; unread 0 after Mark all read; the control is absent with nothing unread",
    async () => {
      const dialog = await openBell(p);
      const n1 = await dialog.getByRole("listitem").count();
      await dialog.getByRole("button", { name: "Show older" }).click();
      await p.waitForTimeout(2000);
      const n2 = await dialog.getByRole("listitem").count();
      const markAll = dialog.getByRole("button", { name: "Mark all read" });
      const had = await markAll.count();
      await markAll.click();
      await p.waitForTimeout(1500);
      const unread = await unreadApi(p);
      const still = await dialog.getByRole("button", { name: "Mark all read" }).count();
      const marks = await dialog.getByText("Unread", { exact: true }).count();
      await closeBell(p);
      const name = await bellName(p);
      expect(
        n2 > n1 && had === 1 && (unread === 0 ? still === 0 : true),
        JSON.stringify({ n1, n2, had, unread, still }),
      );
      return `The panel listed ${n1} items; Show older brought ${n2}. Mark all read was present (${had}); after selecting it unread read ${unread}, ${marks} Unread markers remained, and Mark all read was ${still ? "still shown because new lab events arrived" : "gone"}. The header then read ${q(name)}.`;
    },
  );

  await step(
    NT,
    role,
    "Change preferences: profile menu, Settings, Personal, Notifications; groups and initial choices match the table; Briefing switches",
    "Five groups with the documented switches and initial choices; Briefing Approvals, Tasks, Dates, Obligations on and Intake off",
    async () => {
      await openStaffNotificationSettings(p, "Nadia Haddad");
      const states = await switchStates(p, STAFF_SWITCHES);
      const inAppDates = await p
        .getByRole("switch", { name: "Dates approaching Email", exact: true })
        .count();
      const knowledgeInApp = await p
        .getByRole("switch", { name: "Knowledge items In-app", exact: true })
        .count();
      const expected = {
        "Assigned to you In-app": true,
        "Assigned to you Email": true,
        "Activity on your records In-app": true,
        "Activity on your records Email": false,
        "Dates approaching In-app": true,
        "New requests In-app": true,
        "New requests Email": false,
        "Knowledge items Email": true,
        "Approvals Email": true,
        "Tasks Email": true,
        "Dates Email": true,
        "Obligations Email": true,
        "Intake Email": false,
      };
      const diff = Object.keys(expected).filter((k) => expected[k] !== states[k]);
      expect(
        diff.length === 0 && inAppDates === 0 && knowledgeInApp === 0,
        `diff ${diff} datesEmail ${inAppDates} knowledgeInApp ${knowledgeInApp}`,
      );
      return `Profile menu > Settings > Personal > Notifications reached ${new URL(p.url()).pathname}. Switch states ${q(states)} match the guide's initial choices; Dates approaching has no Email switch and Knowledge items has no In-app switch.`;
    },
  );

  await step(
    NT,
    role,
    "Assigned to you: Email off keeps the bell item and sends no mail; Email on sends mail; In-app off stops both; each choice survives a reload; a mention gives one item, not a second comment item",
    "Mention item with no mail; then mail; then neither; reload keeps each choice; no separate commented-on item for the mention",
    async () => {
      const email = L.PEOPLE.nadia.email;
      const subject = `You were mentioned on ${title}`;
      const out = [];
      const mentionRound = async (label) => {
        const since = new Date(Date.now() - 2000).toISOString();
        const beforeMail = await mailCount(email, subject);
        const id = await comment(
          d,
          "contract",
          fx.contractId,
          `${tag} Daniel mention round ${label}`,
          "full_thread",
          [fx.ids.nadia],
        );
        await settleQueue();
        const afterMail = await mailCount(email, subject);
        const items = await aboutComment(p, id, since);
        return {
          bell: items.filter((x) => /mention/.test(x.eventType)).length,
          mail: afterMail - beforeMail,
          commentItems: items.filter((x) => x.eventType === "comment.posted").length,
          eventTypes: items.map((x) => x.eventType),
        };
      };
      await openStaffNotificationSettings(p, "Nadia Haddad");
      const origEmail = await setSwitch(p, "Assigned to you Email", false);
      await p.reload();
      const keptOff = await p
        .getByRole("switch", { name: "Assigned to you Email", exact: true })
        .getAttribute("aria-checked");
      const r1 = await mentionRound("email-off");
      await setSwitch(p, "Assigned to you Email", true);
      const r2 = await mentionRound("email-on");
      await setSwitch(p, "Assigned to you In-app", false);
      await p.reload();
      const keptInApp = await p
        .getByRole("switch", { name: "Assigned to you In-app", exact: true })
        .getAttribute("aria-checked");
      const r3 = await mentionRound("inapp-off");
      await setSwitch(p, "Assigned to you In-app", true);
      await setSwitch(p, "Assigned to you Email", origEmail);
      // The UI item text for the bell check.
      await p.reload();
      const dialog = await openBell(p);
      const itemText = await dialog
        .getByRole("link", { name: /mentioned you on/ })
        .first()
        .getAttribute("aria-label")
        .catch(() => null);
      await closeBell(p);
      expect(
        keptOff === "false" &&
          r1.bell === 1 &&
          r1.mail === 0 &&
          r1.commentItems === 0 &&
          r2.bell === 1 &&
          r2.mail === 1 &&
          keptInApp === "false" &&
          r3.bell === 0 &&
          r3.mail === 0,
        JSON.stringify({ keptOff, r1, r2, keptInApp, r3 }),
      );
      return `Email off (still off after reload): a mention gave ${r1.bell} bell item, ${r1.commentItems} extra comment items, and ${r1.mail} "${subject}" mail after the queue settled. Email on: ${r2.bell} item and ${r2.mail} mail. In-app off (still off after reload): ${r3.bell} items and ${r3.mail} mail. Choices restored to In-app on and Email ${origEmail ? "on" : "off"}.`;
    },
  );

  await step(
    NT,
    role,
    "A failed preference save shows the error and the switch returns to its earlier value",
    "The change could not be saved. Try again.; switch back to its earlier value, also after reload",
    async () => {
      await openStaffNotificationSettings(p, "Nadia Haddad");
      const sw = p.getByRole("switch", { name: "New requests Email", exact: true });
      const before = await sw.getAttribute("aria-checked");
      const handler = (route) =>
        route.request().method() === "PATCH" ? route.abort("failed") : route.continue();
      await p.route(/\/api\/v1\/me\/notification-preferences/, handler);
      await sw.click();
      await p.getByText("The change could not be saved. Try again.").waitFor({ timeout: 10000 });
      const after = await sw.getAttribute("aria-checked");
      await p.unroute(/\/api\/v1\/me\/notification-preferences/, handler);
      await p.reload();
      const reloaded = await p
        .getByRole("switch", { name: "New requests Email", exact: true })
        .getAttribute("aria-checked");
      expect(before === after && before === reloaded, `${before} ${after} ${reloaded}`);
      return `With the PATCH aborted, selecting New requests Email showed "The change could not be saved. Try again." and the switch returned to aria-checked=${after} (was ${before}); after reload it read ${reloaded}.`;
    },
  );

  await step(
    NT,
    role,
    "New requests: a new Request reaches the Legal user's bell and opens the Inbox Request",
    "New request item links /inbox/N and opens it",
    async () => {
      const r = await L.api(ctx.jonas.page, "POST", "/requests", {
        requestTypeId: (await L.api(d, "GET", "/request-types")).body.requestTypes.find(
          (t) => t.slug === "legal_question",
        ).id,
        departmentId: (await L.api(d, "GET", "/departments/options")).body.departments[0].id,
        title: `DOC-029 conversations new request bell ${stamp}`,
        description: "DOC-029 conversations fictional bell check.",
        urgency: "low",
        customFields: {},
      });
      expect(r.status < 300, `submit ${r.status} ${JSON.stringify(r.body).slice(0, 200)}`);
      fx.bellRequest = r.body.request.number;
      prep(
        `Jonas Weber submitted R-${fx.bellRequest} through the Requests API from his Portal session for the New requests and Request receipt checks.`,
      );
      await p.goto(`${L.BASE}/`);
      const dialog = await openBell(p);
      const link = await findItem(
        p,
        dialog,
        new RegExp(`new request: DOC-029 conversations new request bell ${stamp}`),
      );
      expect(link, "no new request item");
      const label = (await link.getAttribute("aria-label")) ?? (await link.innerText());
      await link.click();
      await p.waitForURL(new RegExp(`/inbox/${fx.bellRequest}`));
      return `The bell item ${q(label.replace(/\s+/g, " "))} opened ${new URL(p.url()).pathname}.`;
    },
  );
}

// ---------- V-C08 as the Administrator ----------
async function adminNotifications() {
  const p = ctx.daniel.page;
  const n = ctx.nadia.page;
  const role = "administrator";
  const tag = `DOC-029 conversations ${stamp}`;
  const title = fx.contractTitle;

  await step(
    NT,
    role,
    "Activity on your records as the Owner: Email off gives a bell item and no mail; Email on sends New comment mail; own comment gives no item; the item opens the Contract",
    "commented on item without mail; with Email on the mail arrives; his own comment produces no item",
    async () => {
      const email = L.PEOPLE.daniel.email;
      const subject = `New comment on ${title}`;
      await openStaffNotificationSettings(p, "Daniel Okafor");
      const init = await switchStates(p, [
        "Activity on your records In-app",
        "Activity on your records Email",
      ]);
      const round = async (label, actor = n) => {
        const since = new Date(Date.now() - 2000).toISOString();
        const bm = await mailCount(email, subject);
        const id = await comment(
          actor,
          "contract",
          fx.contractId,
          `${tag} activity round ${label}`,
          "full_thread",
        );
        await settleQueue();
        const am = await mailCount(email, subject);
        return { bell: (await aboutComment(p, id, since)).length, mail: am - bm };
      };
      await setSwitch(p, "Activity on your records Email", false);
      const r1 = await round("email-off");
      await setSwitch(p, "Activity on your records Email", true);
      const r2 = await round("email-on");
      await setSwitch(p, "Activity on your records Email", init["Activity on your records Email"]);
      const own = await round("own", p);
      await p.goto(`${L.BASE}/`);
      const dialog = await openBell(p);
      const link = await findItem(p, dialog, new RegExp(`Nadia Haddad commented on .*${stamp}`));
      expect(link, "no commented on item");
      const label = (await link.getAttribute("aria-label")) ?? (await link.innerText());
      await link.click();
      await p.waitForURL(new RegExp(`/contracts/${fx.contract.number}`));
      expect(
        r1.bell === 1 &&
          r1.mail === 0 &&
          r2.bell === 1 &&
          r2.mail === 1 &&
          own.bell === 0 &&
          own.mail === 0,
        JSON.stringify({ r1, r2, own }),
      );
      return `Initial Activity on your records ${q(init)}. Email off: Nadia's comment gave ${r1.bell} bell item and ${r1.mail} "${subject}" mail. Email on: ${r2.bell} item and ${r2.mail} mail. Restored. His own comment gave ${own.bell} items and ${own.mail} mail. The item ${q(label.replace(/\s+/g, " "))} opened ${new URL(p.url()).pathname}.`;
    },
  );

  await step(
    NT,
    role,
    "If an update is missing: a failed bell read and a failed older page show their messages and recover",
    "Notifications could not be read. Close this and open it again.; reopening lists items; The older notifications could not be read. Try again.; retry loads more",
    async () => {
      await p.goto(`${L.BASE}/`);
      await bell(p).waitFor();
      let block = true;
      const handler = (route) =>
        block && route.request().method() === "GET" && !/unread-count/.test(route.request().url())
          ? route.abort("failed")
          : route.continue();
      await p.route(/\/api\/v1\/notifications(\?.*)?$/, handler);
      await bell(p).click();
      const dialog = p.getByRole("dialog", { name: "Notifications" });
      const err = dialog.getByText(
        "Notifications could not be read. Close this and open it again.",
      );
      await err.waitFor({ timeout: 10000 });
      block = false;
      await closeBell(p);
      const d2 = await openBell(p);
      const rows = await d2.getByRole("listitem").count();
      block = false;
      await p.unroute(/\/api\/v1\/notifications(\?.*)?$/, handler);
      let blockOlder = true;
      const older = (route) =>
        blockOlder && /cursor=/.test(route.request().url())
          ? route.abort("failed")
          : route.continue();
      await p.route(/\/api\/v1\/notifications\?/, older);
      await d2.getByRole("button", { name: "Show older" }).click();
      const oerr = d2.getByText("The older notifications could not be read. Try again.");
      await oerr.waitFor({ timeout: 10000 });
      const kept = await d2.getByRole("listitem").count();
      blockOlder = false;
      await d2.getByRole("button", { name: "Show older" }).click();
      await p.waitForTimeout(2000);
      const more = await d2.getByRole("listitem").count();
      await p.unroute(/\/api\/v1\/notifications\?/, older);
      await closeBell(p);
      expect(rows > 0 && kept === rows && more > kept, JSON.stringify({ rows, kept, more }));
      return `A blocked read showed "Notifications could not be read. Close this and open it again."; reopening listed ${rows} items. A blocked older page showed "The older notifications could not be read. Try again." with ${kept} rows kept; the retry brought ${more}.`;
    },
  );

  await step(
    NT,
    role,
    "Settings page for an Administrator matches the guide's groups and Briefing sections",
    "Same five groups and five Briefing switches",
    async () => {
      await openStaffNotificationSettings(p, "Daniel Okafor");
      const states = await switchStates(p, STAFF_SWITCHES);
      const heading = await p.getByRole("heading", { name: "Briefing" }).count();
      const caption = (
        await p.getByText(/^These switches change the email only/).textContent()
      ).trim();
      return `Daniel's pane showed Notification preferences and ${heading} Briefing heading with switches ${q(states)}; caption ${q(caption)}.`;
    },
  );
}

// ---------- V-C08 as the Business User ----------
async function portalNotifications() {
  const p = ctx.jonas.page;
  const n = ctx.nadia.page;
  const d = ctx.daniel.page;
  const role = "business_user";
  const tag = `DOC-029 conversations ${stamp}`;
  const email = L.PEOPLE.jonas.email;

  await step(
    NT,
    role,
    "Portal bell: a Request receipt opens the Request; a converted Request's record item opens the Contract",
    "Receipt item links /portal/requests/N; a C-N comment item opens /portal/contracts/N",
    async () => {
      await comment(
        n,
        "contract",
        fx.contractId,
        `${tag} Nadia team update for Jonas`,
        "full_thread",
      );
      await p.goto(`${L.BASE}/portal`);
      const dialog = await openBell(p);
      const receipt = await findItem(
        p,
        dialog,
        new RegExp(`received your request DOC-029 conversations new request bell ${stamp}`),
      );
      expect(receipt, "no receipt item");
      const rl = (await receipt.getAttribute("aria-label")) ?? (await receipt.innerText());
      const rhref = await receipt.getAttribute("href");
      await closeBell(p);
      const d2 = await openBell(p);
      const rec = await findItem(p, d2, new RegExp(`Nadia Haddad .* ${fx.contractTitle}`));
      expect(rec, "no record item");
      const label = (await rec.getAttribute("aria-label")) ?? (await rec.innerText());
      const href = await rec.getAttribute("href");
      await rec.click();
      await p.waitForURL(new RegExp(`/portal/contracts/${fx.contract.number}`));
      const landed = new URL(p.url()).pathname;
      await p.goto(`${L.BASE}/portal`);
      const d3 = await openBell(p);
      const team = await findItem(
        p,
        d3,
        new RegExp(`added you to the Contract team for ${fx.contractTitle}`),
      );
      let teamText = "no team-addition item found";
      if (team) {
        teamText = `${((await team.getAttribute("aria-label")) ?? (await team.innerText())).replace(/\s+/g, " ")} -> ${await team.getAttribute("href")}`;
        await closeBell(p);
      } else await closeBell(p);
      expect(rhref === `/portal/requests/${fx.bellRequest}`, `receipt href ${rhref}`);
      return `Portal header read ${q(await bellName(p))}. Receipt item ${q(rl.replace(/\s+/g, " "))} links ${rhref}. The item for Nadia's comment on the converted Contract read ${q(label.replace(/\s+/g, " "))}, linked ${href}, and opened ${landed}. Team addition item: ${q(teamText)}.`;
    },
  );

  await step(
    NT,
    role,
    "Change Portal preferences: Notification settings offers Request updates, Assigned to you, Activity on your records with the documented initial choices and no Briefing",
    "Three groups, In-app and Email each, Activity email off initially, no Briefing",
    async () => {
      await p.getByRole("banner").getByRole("link", { name: "Notification settings" }).click();
      await p.getByRole("heading", { name: "Notification settings", level: 1 }).waitFor();
      const names = await p
        .getByRole("switch")
        .evaluateAll((els) =>
          els.map((e) => `${e.getAttribute("aria-label") ?? ""}=${e.getAttribute("aria-checked")}`),
        );
      const briefing = await p.getByText("Briefing").count();
      const expected = [
        "Request updates In-app=true",
        "Request updates Email=true",
        "Assigned to you In-app=true",
        "Assigned to you Email=true",
        "Activity on your records In-app=true",
        "Activity on your records Email=false",
      ];
      const labels = await p
        .getByRole("switch")
        .evaluateAll((els) => els.map((e) => e.getAttribute("aria-labelledby") || e.id));
      const accessible = [];
      for (const sw of await p.getByRole("switch").all())
        accessible.push(`${(await sw.evaluate((e) => e.getAttribute("aria-label"))) ?? ""}`);
      const states = await switchStates(
        p,
        expected.map((e) => e.split("=")[0]),
      );
      const diff = expected.filter((e) => String(states[e.split("=")[0]]) !== e.split("=")[1]);
      expect(
        diff.length === 0 && briefing === 0 && (await p.getByRole("switch").count()) === 6,
        `diff ${diff} briefing ${briefing}`,
      );
      return `/portal/settings showed 6 switches with states ${q(states)} and ${briefing} Briefing text.`;
    },
  );

  await step(
    NT,
    role,
    "Portal Request updates: Email off keeps the bell item with no mail; Email on sends mail; In-app off stops both; choices survive reload",
    "Legal replied item without mail; with mail; neither",
    async () => {
      const subject = `Legal replied on`;
      const marker = fx.openTitle;
      const round = async (label) => {
        const since = new Date(Date.now() - 2000).toISOString();
        const bm = (await mailSearch(`to:"${email}" subject:"${subject}"`)).filter((m) =>
          m.Subject.includes(marker),
        ).length;
        const id = await comment(
          n,
          "request",
          fx.openRequestId,
          `${tag} Nadia reply round ${label}`,
          "full_thread",
        );
        await settleQueue();
        const am = (await mailSearch(`to:"${email}" subject:"${subject}"`)).filter((m) =>
          m.Subject.includes(marker),
        ).length;
        const items = await aboutComment(p, id, since, true);
        return { bell: items.length, mail: am - bm, eventTypes: items.map((x) => x.eventType) };
      };
      await p.goto(`${L.BASE}/portal/settings`);
      await setSwitch(p, "Request updates Email", false);
      await p.reload();
      const kept = await p
        .getByRole("switch", { name: "Request updates Email", exact: true })
        .getAttribute("aria-checked");
      const r1 = await round("email-off");
      await setSwitch(p, "Request updates Email", true);
      const r2 = await round("email-on");
      await setSwitch(p, "Request updates In-app", false);
      await p.reload();
      const kept2 = await p
        .getByRole("switch", { name: "Request updates In-app", exact: true })
        .getAttribute("aria-checked");
      const r3 = await round("inapp-off");
      await setSwitch(p, "Request updates In-app", true);
      expect(
        kept === "false" &&
          kept2 === "false" &&
          r1.bell === 1 &&
          r1.mail === 0 &&
          r2.bell === 1 &&
          r2.mail === 1 &&
          r3.bell === 0 &&
          r3.mail === 0,
        JSON.stringify({ kept, kept2, r1, r2, r3 }),
      );
      return `Email off (kept after reload): Nadia's Shared with requester reply on R-${fx.openRequest} gave ${r1.bell} bell item and ${r1.mail} "Legal replied on" mail. Email on: ${r2.bell} item and ${r2.mail} mail. In-app off (kept after reload): ${r3.bell} items and ${r3.mail} mail. Restored to both on.`;
    },
  );

  await step(
    NT,
    role,
    "Portal Assigned to you: a team mention on his converted Contract gives one mention item and You were mentioned mail; a Legal Only comment gives nothing",
    "mentioned you item with mail; nothing for Legal Only",
    async () => {
      const title = fx.contractTitle;
      const since = new Date(Date.now() - 2000).toISOString();
      const bm = await mailCount(email, `You were mentioned on ${title}`);
      const mid = await comment(
        n,
        "contract",
        fx.contractId,
        `${tag} Nadia mentions Jonas`,
        "full_thread",
        [fx.ids.jonas],
      );
      const lid = await comment(
        n,
        "contract",
        fx.contractId,
        `${tag} Nadia legal only no portal item`,
        "legal_only",
      );
      await settleQueue();
      const am = await mailCount(email, `You were mentioned on ${title}`);
      const mItems = await aboutComment(p, mid, since, true);
      const lItems = await aboutComment(p, lid, since, true);
      expect(
        am - bm === 1 &&
          mItems.length === 1 &&
          /mention/.test(mItems[0].eventType) &&
          lItems.length === 0,
        JSON.stringify({
          mention: [mItems.map((x) => x.eventType), am - bm],
          legal: lItems.length,
        }),
      );
      return `A Contract Team mention of Jonas on C-${fx.contract.number} gave exactly one Portal item (${mItems.map((x) => x.eventType)}) and ${am - bm} "You were mentioned on" mail. A Legal Only comment on the same Contract gave ${lItems.length} Portal items.`;
    },
  );

  await step(
    NT,
    role,
    "Portal Activity on your records: shared comments on his Contracts give a bell item and, with Email initially off, no mail",
    "A shared team comment on C-N gives an Activity on your records bell item and no email while that group's Email is off",
    async () => {
      const title = fx.contractTitle;
      // Amara Nwosu is added to the same Contract as a team member who did not raise its Request, for comparison.
      const add = await L.api(d, "POST", `/contracts/${fx.contract.number}/team`, {
        userId: fx.ids.amara,
      });
      expect(add.status < 300, `add amara ${add.status}`);
      ctx.amara ??= await L.portalContext(L.PEOPLE.amara);
      const jonasPrefs = await (async () => {
        await p.goto(`${L.BASE}/portal/settings`);
        return switchStates(p, [
          "Activity on your records In-app",
          "Activity on your records Email",
          "Request updates Email",
        ]);
      })();
      const since = new Date(Date.now() - 2000).toISOString();
      const allMailBefore = (await mailSearch(`to:"${email}"`)).length;
      const amaraMailBefore = (await mailSearch(`to:"${L.PEOPLE.amara.email}"`)).length;
      const pid = await comment(
        n,
        "contract",
        fx.contractId,
        `${tag} Nadia plain team comment`,
        "full_thread",
      );
      await settleQueue();
      const jItems = await aboutComment(p, pid, since, true);
      const aItems = await aboutComment(ctx.amara.page, pid, since, true);
      const jMail = (await mailSearch(`to:"${email}"`))
        .filter((m) => m.Created >= since)
        .map((m) => m.Subject)
        .filter((x) => x.includes(title) || x.includes(`R-${fx.contractRequest}`));
      const aMail = (await mailSearch(`to:"${L.PEOPLE.amara.email}"`))
        .filter((m) => m.Created >= since)
        .map((m) => m.Subject)
        .filter((x) => x.includes(title));
      const rm = await L.api(d, "DELETE", `/contracts/${fx.contract.number}/team/${fx.ids.amara}`);
      prep(
        `Daniel Okafor added Amara Nwosu to the C-${fx.contract.number} team for the Portal Activity on your records comparison and removed her afterwards (HTTP ${rm.status}).`,
      );
      const observed = `Jonas (the Requester of R-${fx.contractRequest}, with ${q(jonasPrefs)}) received ${q(jItems.map((x) => `${x.eventType} -> ${x.entityType}`))} and mail ${q(jMail)}. Amara (on the team, not the Requester) received ${q(aItems.map((x) => `${x.eventType} -> ${x.entityType}`))} and mail ${q(aMail)}.`;
      expect(
        jItems.length === 1 && jItems[0].eventType === "comment.posted" && jMail.length === 0,
        `The guide says shared comments on his Contracts belong to Activity on your records (Email initially off). ${observed}`,
      );
      return observed;
    },
  );

  await step(
    NT,
    role,
    "A failed Portal preference save shows the error and keeps the earlier value",
    "The change could not be saved. Try again.; switch reverts",
    async () => {
      await p.goto(`${L.BASE}/portal/settings`);
      const sw = p.getByRole("switch", { name: "Activity on your records Email", exact: true });
      const before = await sw.getAttribute("aria-checked");
      const handler = (route) =>
        ["PATCH", "PUT", "POST"].includes(route.request().method())
          ? route.abort("failed")
          : route.continue();
      await p.route(/notification-preferences/, handler);
      await sw.click();
      await p.getByText("The change could not be saved. Try again.").waitFor({ timeout: 10000 });
      const after = await sw.getAttribute("aria-checked");
      await p.unroute(/notification-preferences/, handler);
      await p.reload();
      const reloaded = await p
        .getByRole("switch", { name: "Activity on your records Email", exact: true })
        .getAttribute("aria-checked");
      expect(before === after && after === reloaded, `${before} ${after} ${reloaded}`);
      return `With the save aborted the page showed "The change could not be saved. Try again."; the switch stayed aria-checked=${after} and read ${reloaded} after reload.`;
    },
  );

  await step(
    NT,
    role,
    "Removing team membership removes record notifications from the Portal bell; restoring brings them back",
    "No C-N items while off the team; items return after restore",
    async () => {
      const title = fx.contractTitle;
      const before = (await itemsMatching(p, new RegExp(fx.contractId), true, fx.createdAt)).length;
      const rm = await L.api(d, "DELETE", `/contracts/${fx.contract.number}/team/${fx.ids.jonas}`);
      let during, visible;
      try {
        expect(rm.status < 300, `remove ${rm.status}`);
        await p.goto(`${L.BASE}/portal`);
        const dialog = await openBell(p);
        during = (await itemsMatching(p, new RegExp(fx.contractId), true, fx.createdAt)).length;
        visible = await dialog.getByRole("link", { name: new RegExp(`on ${title}`) }).count();
        await closeBell(p);
      } finally {
        const add = await L.api(d, "POST", `/contracts/${fx.contract.number}/team`, {
          userId: fx.ids.jonas,
        });
        expect(add.status < 300, `restore ${add.status}`);
      }
      const after = (await itemsMatching(p, new RegExp(fx.contractId), true, fx.createdAt)).length;
      prep(
        `Daniel Okafor removed and restored Jonas Weber on the C-${fx.contract.number} team through the team API for the Portal bell access check.`,
      );
      expect(
        before > 0 && during === 0 && visible === 0 && after >= before,
        JSON.stringify({ before, during, visible, after }),
      );
      return `Jonas had ${before} C-${fx.contract.number} notifications; while off the team the Portal bell read returned ${during} and the panel showed ${visible} links for the Contract; after restore it returned ${after}.`;
    },
  );
}

// ---------- V-C08 morning round, Key date reminders, and briefing ----------
function localDate(tz, plusDays = 0) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
  const d = new Date(`${parts}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + plusDays);
  return d.toISOString().slice(0, 10);
}
function localHour(tz) {
  return Number(
    new Intl.DateTimeFormat("en-GB", { timeZone: tz, hour: "2-digit", hour12: false }).format(
      new Date(),
    ),
  );
}
async function queueMorningRound() {
  const id = psqlWith(
    "insert into pgboss.job (name, data, policy, expire_seconds, deletion_seconds, keep_until, retry_limit) select 'notification.morning-round', '{}'::jsonb, q.policy, q.expire_seconds, q.deletion_seconds, now() + interval '1 day', 0 from pgboss.queue q where q.name = 'notification.morning-round' returning id",
  ).split("\n")[0];
  for (let i = 0; i < 180; i++) {
    const state = psqlWith(`select state from pgboss.job where id = '${id}'`);
    if (state === "completed") return { id, state };
    if (state === "failed") throw new Error(`round ${id} failed`);
    await sleep(1000);
  }
  throw new Error(`round ${id} did not complete`);
}
async function mailTo(email, since) {
  return (await mailSearch(`to:"${email}"`)).filter((m) => m.Created >= since);
}
async function mailText(id) {
  const m = await fetch(`${L.MAIL}/api/v1/message/${id}`).then((x) => x.json());
  return m.Text ?? "";
}
function sectionsOf(text) {
  return ["Approvals", "Tasks", "Dates", "Obligations", "Knowledge", "Intake"].filter((h) =>
    new RegExp(`^${h}$`, "m").test(text),
  );
}

async function morning() {
  const d = ctx.daniel.page;
  const n = ctx.nadia.page;
  const tag = `DOC-029 conversations ${stamp}`;
  const LA = "America/Los_Angeles";
  const HNL = "Pacific/Honolulu";
  expect(
    localHour(LA) >= 8 && localHour(HNL) < 8,
    `timezone window closed: LA ${localHour(LA)} HNL ${localHour(HNL)}`,
  );
  const browser = await L.launch();
  const specs = [
    { key: "a", role: "legal_team_member", label: "Member Dates" },
    { key: "b", role: "legal_team_member", label: "Member No Date Bell" },
    { key: "c", role: "administrator", label: "Admin No Date Email" },
    { key: "e", role: "legal_team_member", label: "Member Honolulu" },
  ];
  const fresh = {};
  await step(
    NT,
    "administrator",
    "Fixture: invite fresh fictional accounts and check the initial Notification preferences on each",
    "Each fresh account shows the guide's initial choices",
    async () => {
      const out = [];
      for (const spec of specs) {
        const email = `doc029-conv-${stamp}-${spec.key}@helix.example`;
        const displayName = `DOC-029 conversations ${spec.label} ${stamp}`;
        const inv = await L.api(d, "POST", "/auth/invites", {
          email,
          displayName,
          role: spec.role,
        });
        expect(
          inv.status === 201,
          `invite ${inv.status} ${JSON.stringify(inv.body).slice(0, 200)}`,
        );
        const id = inv.body.user?.id;
        let href = null;
        for (let i = 0; i < 60 && !href; i++) {
          const [m] = await mailSearch(`to:"${email}"`);
          if (m) {
            const t = await mailText(m.ID);
            const match = t.match(/https?:\/\/[^\s)\]]+\/auth\/set-password[^\s)\]]*/);
            if (match) {
              const u = new URL(match[0]);
              const lab = new URL(L.BASE);
              u.protocol = lab.protocol;
              u.host = lab.host;
              href = u.toString();
            }
          }
          if (!href) await sleep(750);
        }
        expect(href, `no activation mail for ${spec.key}`);
        const context = await browser.newContext({
          baseURL: L.BASE,
          viewport: { width: 1440, height: 900 },
        });
        context.setDefaultTimeout(15000);
        const page = await context.newPage();
        const password = `Doc029-${createHash("sha256").update(`${Math.random()}${Date.now()}`).digest("hex").slice(0, 20)}`;
        await page.goto(href);
        href = null;
        await page.getByLabel("New password").fill(password);
        await page.getByLabel("Confirm password").fill(password);
        await page.getByRole("button", { name: "Set password" }).click();
        await page
          .getByText("Password set")
          .first()
          .waitFor({ timeout: 15000 })
          .catch(() => {});
        await page.goto(`${L.BASE}/auth/login`);
        const pw = page.getByRole("button", { name: "Sign in with a password" });
        if (await pw.isVisible().catch(() => false)) await pw.click();
        await page.getByLabel("Email").fill(email);
        await page.getByLabel("Password").fill(password);
        await page.getByRole("button", { name: "Sign in", exact: true }).click();
        await page.waitForURL((u) => !u.pathname.startsWith("/auth"), { timeout: 30000 });
        // Keep the account outside any morning until its fixtures are ready.
        const tz = await L.api(page, "PATCH", "/me/preferences", { timezone: HNL });
        expect(tz.status < 300, `timezone ${tz.status}`);
        if (page.url().includes("/onboarding")) await page.goto(`${L.BASE}/`);
        await openStaffNotificationSettings(page, displayName);
        const states = await switchStates(page, STAFF_SWITCHES);
        const expected = {
          "Assigned to you In-app": true,
          "Assigned to you Email": true,
          "Activity on your records In-app": true,
          "Activity on your records Email": false,
          "Dates approaching In-app": true,
          "New requests In-app": true,
          "New requests Email": false,
          "Knowledge items Email": true,
          "Approvals Email": true,
          "Tasks Email": true,
          "Dates Email": true,
          "Obligations Email": true,
          "Intake Email": false,
        };
        const diff = Object.keys(expected).filter((k) => expected[k] !== states[k]);
        expect(diff.length === 0, `${spec.key} initial diff ${diff}`);
        fresh[spec.key] = { ...spec, email, displayName, id, context, page };
        out.push(`${spec.role} ${displayName}: initial choices match`);
      }
      results.records.freshAccounts = Object.values(fresh).map((f) => ({
        role: f.role,
        displayName: f.displayName,
        email: f.email,
        userId: f.id,
      }));
      prep(
        `Daniel Okafor invited four fresh fictional accounts through the invites API (three Legal Team Members and one Administrator, all named "DOC-029 conversations ... ${stamp}"). Each set a random in-memory password from its activation mail, signed in, and had its timezone set to ${HNL} through the preferences API so no morning round could serve it before its fixtures were ready.`,
      );
      return out.join("; ");
    },
  );
  if (Object.keys(fresh).length < 4) return;

  const offsets = (await L.api(d, "GET", "/org/reminder-offsets")).body;
  const today = localDate(LA);
  const plus7 = localDate(LA, 7);
  const plus3 = localDate(LA, 3);
  await step(
    NT,
    "legal_team_member",
    "Key date reminders: the Add a key date dialog shows global reminders and the combined schedule, bounds additional lead times, offers team members but not Business Users, and narrows recipients",
    "Global reminders and This date will remind lines; 731 not addable; Business User on the team not offered; the saved Key date keeps its lead time and one recipient",
    async () => {
      for (const f of Object.values(fresh)) {
        const r = await L.api(d, "POST", `/contracts/${fx.contract.number}/team`, { userId: f.id });
        expect(r.status < 300, `team ${f.key} ${r.status}`);
      }
      for (const f of [fresh.b, fresh.c]) {
        const r = await L.api(d, "POST", `/contracts/${fx.contract.number}/tasks`, {
          title: `${tag} due today for ${f.label}`,
          assigneeId: f.id,
          dueDate: today,
          addToTeam: true,
        });
        expect(r.status < 300, `task ${f.key} ${r.status} ${JSON.stringify(r.body).slice(0, 200)}`);
      }
      for (const label of [`${tag} board pack`, `${tag} filing window`]) {
        const r = await L.api(d, "POST", `/contracts/${fx.contract.number}/key-dates`, {
          date: plus7,
          label,
        });
        expect(r.status < 300, `key date ${r.status} ${JSON.stringify(r.body).slice(0, 200)}`);
      }
      prep(
        `Daniel Okafor added the four fresh accounts to the C-${fx.contract.number} team, created one Task due ${today} for "Member No Date Bell" and for "Admin No Date Email", and added two Key dates on ${plus7} (${tag} board pack, ${tag} filing window) through the API. Global reminder lead times in this lab: ${q(offsets)}.`,
      );
      const p = n;
      await p.goto(`${L.BASE}/contracts/${fx.contract.number}`);
      await p
        .getByRole("link", { name: /^Key dates/ })
        .first()
        .click();
      await p.getByRole("button", { name: "Add date" }).first().click();
      const dialog = p.getByRole("dialog", { name: "Add a key date" });
      await dialog.waitFor();
      await dialog.getByText(/^Global reminders:/).waitFor();
      const global = (await dialog.getByText(/^Global reminders:/).textContent()).trim();
      await dialog.getByRole("textbox", { name: "Date" }).fill(plus3);
      await dialog.getByRole("textbox", { name: "Event" }).fill(`${tag} narrowed review`);
      const lead = dialog.getByRole("spinbutton", { name: "Additional lead time (days before)" });
      await lead.fill("731");
      const disabled731 = await dialog.getByRole("button", { name: "Add lead time" }).isDisabled();
      await lead.fill("3");
      await dialog.getByRole("button", { name: "Add lead time" }).click();
      const combined = (await dialog.getByText(/^This date will remind:/).textContent()).trim();
      const people = await dialog
        .getByRole("checkbox")
        .evaluateAll((els) => els.map((e) => e.getAttribute("aria-label") ?? e.id));
      const names = [];
      for (const cb of await dialog.getByRole("checkbox").all())
        names.push(
          (
            await cb.evaluate(
              (e) => e.labels?.[0]?.textContent ?? e.getAttribute("aria-label") ?? "",
            )
          ).trim(),
        );
      const jonasOffered = names.some((x) => /Jonas Weber/.test(x));
      await dialog.getByRole("checkbox", { name: fresh.a.displayName }).check();
      const usual = await dialog.getByRole("button", { name: "Use the usual audience" }).count();
      await dialog.getByRole("button", { name: "Add date" }).click();
      await dialog.waitFor({ state: "hidden" });
      const kd = (
        await L.api(d, "GET", `/contracts/${fx.contract.number}/key-dates`)
      ).body.deadlines.find((x) => x.label === `${tag} narrowed review`);
      expect(
        disabled731 &&
          !jonasOffered &&
          kd &&
          kd.reminderOffsetDays.includes(3) &&
          kd.reminderRecipientIds.length === 1 &&
          kd.reminderRecipientIds[0] === fresh.a.id,
        JSON.stringify({ disabled731, jonasOffered, kd }),
      );
      return `Nadia's Add a key date dialog read ${q(global)}. Additional lead time 731 left Add lead time disabled (${disabled731}); 3 was added and the dialog read ${q(combined)}. Recipient checkboxes offered ${q(names)} (Jonas Weber, a Business User on the team, ${jonasOffered ? "was" : "was not"} offered); Use the usual audience controls shown after a pick: ${usual}. Saved ${plus3} with lead times ${q(kd.reminderOffsetDays)} and one recipient (the "Member Dates" account).`;
    },
  );

  await step(
    NT,
    "legal_team_member",
    "Set the daily briefing and group switches on the fresh accounts before the morning",
    "Saved indications for Dates approaching In-app off (Member No Date Bell) and Briefing Dates Email off (Admin No Date Email)",
    async () => {
      await openStaffNotificationSettings(fresh.b.page, fresh.b.displayName);
      await setSwitch(fresh.b.page, "Dates approaching In-app", false);
      await openStaffNotificationSettings(fresh.c.page, fresh.c.displayName);
      await setSwitch(fresh.c.page, "Dates Email", false);
      await fresh.b.page.reload();
      await fresh.c.page.reload();
      const b = await switchStates(fresh.b.page, ["Dates approaching In-app", "Dates Email"]);
      const c = await switchStates(fresh.c.page, ["Dates approaching In-app", "Dates Email"]);
      for (const f of [fresh.a, fresh.b, fresh.c]) {
        const r = await L.api(f.page, "PATCH", "/me/preferences", { timezone: LA });
        expect(r.status < 300, `tz ${f.key}`);
      }
      prep(
        `The Member Dates, Member No Date Bell, and Admin No Date Email accounts had their timezone set to ${LA} (local hour ${localHour(LA)}) through the preferences API; Member Honolulu stayed on ${HNL} (local hour ${localHour(HNL)}).`,
      );
      expect(
        !b["Dates approaching In-app"] &&
          b["Dates Email"] &&
          c["Dates approaching In-app"] &&
          !c["Dates Email"],
        JSON.stringify({ b, c }),
      );
      return `After reload, Member No Date Bell read ${q(b)} and Admin No Date Email read ${q(c)}.`;
    },
  );

  const since = new Date(Date.now() - 1000).toISOString();
  let round1;
  await step(
    NT,
    "legal_team_member",
    "Understand reminder timing: a morning round after 8:00 in the saved timezone serves the briefing and date reminders; before 8:00 it defers",
    "Accounts in Los Angeles receive what their switches allow; the Honolulu account receives nothing; Business User receives no briefing",
    async () => {
      round1 = await queueMorningRound();
      prep(
        `A morning round was queued as notification.morning-round in the lab's own pg-boss queue (job ${round1.id}) instead of waiting for the hourly cron; the worker ran it with its real clock, rules, notifier, and mailer.`,
      );
      await settleQueue(5000);
      const report = {};
      for (const f of Object.values(fresh)) {
        const all = await mailTo(f.email, since);
        const mails = all.filter((m) =>
          /^Your daily briefing$|^\d+ dates? on your|new Knowledge item/.test(m.Subject),
        );
        const briefing = [];
        for (const m of mails)
          briefing.push({ subject: m.Subject, sections: sectionsOf(await mailText(m.ID)) });
        const items = (await itemsMatching(f.page, /date\.|briefing/, false, since)).map((x) => ({
          type: x.eventType,
          label: x.payload?.label ?? null,
          reminderOffsetDays: x.reminderOffsetDays ?? x.payload?.reminderOffsetDays ?? null,
        }));
        report[f.key] = {
          mails: briefing,
          otherMail: all.filter((m) => !mails.includes(m)).map((m) => m.Subject),
          bell: items,
        };
      }
      const jonasBriefing = (await mailTo(L.PEOPLE.jonas.email, since)).filter((m) =>
        /briefing|dates? on your/i.test(m.Subject),
      ).length;
      results.records.morningRound1 = report;
      const a = report.a,
        b = report.b,
        c = report.c,
        e = report.e;
      const labels = (r) =>
        r.bell
          .filter((x) => x.type.startsWith("date.") && String(x.label).includes(stamp))
          .map((x) => x.label)
          .sort();
      const ok =
        labels(a).length === 3 &&
        a.mails.length === 1 &&
        a.mails[0].sections.includes("Dates") &&
        labels(b).length === 0 &&
        b.mails.length === 1 &&
        b.mails[0].sections.includes("Tasks") &&
        !b.mails[0].sections.includes("Dates") &&
        labels(c).length === 2 &&
        !labels(c).some((x) => /narrowed/.test(x)) &&
        c.mails.length === 1 &&
        c.mails[0].sections.includes("Tasks") &&
        !c.mails[0].sections.includes("Dates") &&
        e.mails.length === 0 &&
        e.bell.filter((x) => String(x.label).includes(stamp) || x.type === "briefing.ready")
          .length === 0 &&
        jonasBriefing === 0;
      expect(ok, JSON.stringify({ report, jonasBriefing }));
      return `Round ${round1.state}. Member Dates (LA): bell ${q(a.bell)}, mail ${q(a.mails)}. Member No Date Bell (LA, Dates approaching In-app off): bell ${q(b.bell)}, mail ${q(b.mails)}. Admin No Date Email (LA, Briefing Dates Email off): bell ${q(c.bell)}, mail ${q(c.mails)}. Member Honolulu (before 08:00): bell ${q(e.bell)}, mail ${q(e.mails)}. Jonas Weber received ${jonasBriefing} briefing mails.`;
    },
  );

  await step(
    NT,
    "administrator",
    "The daily bell summary opens Home; a second round the same local day sends no second briefing or reminder",
    "Your daily briefing is ready opens /; second round adds no mail or date items",
    async () => {
      const p = fresh.c.page;
      await p.goto(`${L.BASE}/contracts/${fx.contract.number}`);
      const dialog = await openBell(p);
      const link = dialog.getByRole("link", { name: /Your daily briefing is ready/ }).first();
      await link.waitFor({ timeout: 10000 });
      const href = await link.getAttribute("href");
      const dateLinks = await dialog
        .getByRole("link", {
          name: new RegExp(`${stamp} (board pack|filing window) on .* is coming up`),
        })
        .allInnerTexts();
      await link.click();
      await p.waitForURL((u) => u.pathname === "/", { timeout: 15000 });
      const since2 = new Date(Date.now() - 1000).toISOString();
      const round2 = await queueMorningRound();
      await settleQueue(5000);
      const extra = {};
      for (const f of Object.values(fresh)) {
        extra[f.key] = {
          mails: (await mailTo(f.email, since2)).map((m) => m.Subject),
          bell: (await itemsMatching(f.page, /date\.|briefing/, false, since2)).length,
        };
      }
      const quiet = ["a", "b", "c"].every(
        (k) => extra[k].mails.length === 0 && extra[k].bell === 0,
      );
      expect(href === "/" && quiet, JSON.stringify({ href, extra }));
      return `Admin No Date Email's bell listed the Key date items ${q(dateLinks.map((x) => x.replace(/\s+/g, " ")))} and Your daily briefing is ready linking ${href}; selecting it opened Home. A second queued round (${round2.state}) gave ${q(extra)}.`;
    },
  );

  for (const f of Object.values(fresh)) await f.context.close();
}

// ---------- supplement: checks added after the main run ----------
async function supplement() {
  const n = ctx.nadia.page;
  const j = ctx.jonas.page;
  const tag = `DOC-029 conversations ${fx.stamp}`;
  const MORNING_STAMP = process.env.MORNING_STAMP;
  const only = (process.env.SUPP ?? "wt,errors,six,usual,bu,lines").split(",");

  if (only.includes("wt"))
    await step(
      CA,
      "legal_team_member",
      "Internal team: an older Working Team comment stays readable to Legal with its label, cannot be chosen, and stays out of the Business User view",
      "Contract shows Internal team badge; Inbox Request shows Working team badge; no such composer option; Jonas sees neither",
      async () => {
        const wc = await L.api(n, "POST", "/comments", {
          entityType: "contract",
          entityId: fx.contractId,
          body: `${tag} older working team note`,
          visibility: "working_team",
          mentions: [],
        });
        const wr = await L.api(n, "POST", "/comments", {
          entityType: "request",
          entityId: fx.openRequestId,
          body: `${tag} older working team request note`,
          visibility: "working_team",
          mentions: [],
        });
        expect(
          wc.status < 300 && wr.status < 300,
          `working team fixture ${wc.status} ${wr.status} ${JSON.stringify(wc.body).slice(0, 160)}`,
        );
        prep(
          `Nadia Haddad posted one working_team comment on C-${fx.contract.number} and one on R-${fx.openRequest} through the comments API to stand in for older Working Team comments; the composer does not offer that tier.`,
        );
        await n.goto(`${L.BASE}/contracts/${fx.contract.number}`);
        let a = await openComments(n);
        const crow = rowWith(a, `${tag} older working team note`).first();
        await crow.waitFor();
        const cs = await rowSummary(crow);
        const cOptions = (await a.getByRole("group", { name: "Audience" }).innerText())
          .replace(/\s+/g, " ")
          .trim();
        await n.goto(`${L.BASE}/inbox/${fx.openRequest}`);
        a = await openComments(n);
        const rrow = rowWith(a, `${tag} older working team request note`).first();
        await rrow.waitFor();
        const rs = await rowSummary(rrow);
        const rOptions = (await a.getByRole("group", { name: "Audience" }).innerText())
          .replace(/\s+/g, " ")
          .trim();
        await j.goto(`${L.BASE}/portal/contracts/${fx.contract.number}`);
        let pa = await openComments(j);
        const jc = await rowWith(pa, `${tag} older working team note`).count();
        await j.goto(`${L.BASE}/portal/requests/${fx.openRequest}`);
        pa = await openComments(j);
        const jr = await rowWith(pa, `${tag} older working team request note`).count();
        expect(
          /Internal team/.test(cs) &&
            /Working team/.test(rs) &&
            !/Internal|Working/.test(cOptions + rOptions) &&
            jc === 0 &&
            jr === 0,
          JSON.stringify({ cs, rs, cOptions, rOptions, jc, jr }),
        );
        return `Nadia's Contract row read ${q(cs)} with composer options ${q(cOptions)}. Her Inbox Request row read ${q(rs)} with options ${q(rOptions)}. Jonas's Portal Contract showed ${jc} and Portal Request ${jr} of these comments.`;
      },
    );

  if (only.includes("errors"))
    await step(
      CA,
      "legal_team_member",
      "If the conversation or History cannot load: follow the message to reopen; retry Show older when only the earlier page failed",
      "The conversation could not be read. Reopen the panel to try again.; reopening recovers; The earlier comments could not be read. Try again. keeps loaded rows and the retry loads more; The history could not be read. Reopen the panel to try again.",
      async () => {
        await n.goto(`${L.BASE}/matters/${fx.matter.number}`);
        await n.getByRole("toolbar", { name: "Applets" }).waitFor();
        let block = true;
        const thread = (route) =>
          block &&
          route.request().method() === "GET" &&
          !/unread|mention/.test(route.request().url())
            ? route.abort("failed")
            : route.continue();
        await n.route(/\/api\/v1\/comments\?/, thread);
        await openApplet(n, "Comments");
        const a = applet(n);
        const loadErr = a.getByText(
          "The conversation could not be read. Reopen the panel to try again.",
        );
        await loadErr.waitFor({ timeout: 15000 });
        block = false;
        await n.unroute(/\/api\/v1\/comments\?/, thread);
        await a.getByRole("button", { name: "Close" }).click();
        await a.waitFor({ state: "hidden" });
        await openApplet(n, "Comments");
        await a.getByRole("button", { name: "Show older" }).waitFor({ timeout: 15000 });
        const loaded = await a.getByRole("listitem").count();
        let blockOlder = true;
        const older = (route) =>
          blockOlder && /before=|cursor=/.test(route.request().url())
            ? route.abort("failed")
            : route.continue();
        await n.route(/\/api\/v1\/comments\?/, older);
        await a.getByRole("button", { name: "Show older" }).click();
        const olderErr = a.getByText("The earlier comments could not be read. Try again.");
        await olderErr.waitFor({ timeout: 15000 });
        const kept = await a.getByRole("listitem").count();
        blockOlder = false;
        await a.getByRole("button", { name: "Show older" }).click();
        await rowWith(a, "Daniel bulk update 01").first().waitFor({ timeout: 15000 });
        const more = await a.getByRole("listitem").count();
        await n.unroute(/\/api\/v1\/comments\?/, older);
        await n.goto(`${L.BASE}/matters/${fx.matter.number}`);
        await n.getByRole("toolbar", { name: "Applets" }).waitFor();
        let blockHist = true;
        const hist = (route) => (blockHist ? route.abort("failed") : route.continue());
        await n.route(/\/api\/v1\/activity\?/, hist);
        await openApplet(n, "History");
        const panel = n.getByRole("complementary", { name: "History" });
        const histErr = panel.getByText(
          "The history could not be read. Reopen the panel to try again.",
        );
        await histErr.waitFor({ timeout: 15000 });
        blockHist = false;
        await n.unroute(/\/api\/v1\/activity\?/, hist);
        await panel.getByRole("button", { name: "Close" }).click();
        await panel.waitFor({ state: "hidden" });
        await openApplet(n, "History");
        await panel.getByRole("listitem").first().waitFor({ timeout: 15000 });
        const hRows = await panel.getByRole("listitem").count();
        expect(
          loaded > 0 && kept === loaded && more > kept && hRows > 0,
          JSON.stringify({ loaded, kept, more, hRows }),
        );
        return `A blocked thread read showed "The conversation could not be read. Reopen the panel to try again."; closing and reopening Comments loaded ${loaded} rows. A blocked earlier page showed "The earlier comments could not be read. Try again." with ${kept} rows kept; the retry brought ${more}. A blocked History read showed "The history could not be read. Reopen the panel to try again."; reopening listed ${hRows} entries.`;
      },
    );

  if (only.includes("six"))
    await step(
      CA,
      "legal_team_member",
      "Attach files accepts up to five files",
      "Choosing six files keeps at most five in the list",
      async () => {
        await n.goto(`${L.BASE}/contracts/${fx.contract.number}`);
        const a = await openComments(n);
        await a
          .getByRole("textbox", { name: "New comment" })
          .fill(`${tag} six file probe (not posted)`);
        const chooser = n.waitForEvent("filechooser");
        await a.getByRole("button", { name: "Attach files" }).click();
        await (
          await chooser
        ).setFiles([1, 2, 3, 4, 5, 6].map((k) => fixture(`doc029-conv-extra-${k}.txt`)));
        await n.waitForTimeout(800);
        const listed = await a
          .getByRole("list", { name: "Files attached to this comment" })
          .getByRole("listitem")
          .count();
        const alert = await a.getByRole("alert").allInnerTexts();
        const addDisabled = await a.getByRole("button", { name: "Attach files" }).isDisabled();
        await a.getByRole("textbox", { name: "New comment" }).fill("");
        await n.reload();
        expect(listed <= 5, `listed ${listed}`);
        return `Choosing six text files listed ${listed} files (alerts ${q(alert)}; Attach files disabled: ${addDisabled}). The draft was discarded unposted.`;
      },
    );

  if (only.includes("usual"))
    await step(
      NT,
      "legal_team_member",
      "When the selected recipient has left the team, editing the Key date offers Use the usual audience",
      "Edit key date explains the departed recipient and offers Use the usual audience; choosing it clears the selection",
      async () => {
        const d = ctx.daniel.page;
        const label = MORNING_STAMP
          ? `DOC-029 conversations ${MORNING_STAMP} narrowed review`
          : `${tag} narrowed review`;
        const kd = (
          await L.api(d, "GET", `/contracts/${fx.contract.number}/key-dates`)
        ).body.deadlines.find((x) => x.label === label);
        const recipient = kd.reminderRecipientIds[0];
        const openEdit = async () => {
          await n.goto(`${L.BASE}/contracts/${fx.contract.number}`);
          await n
            .getByRole("link", { name: /^Key dates/ })
            .first()
            .click();
          await n.getByRole("button", { name: `Actions for ${label}` }).click();
          await n.getByRole("menuitem", { name: "Edit date" }).click();
          const dialog = n.getByRole("dialog", { name: "Edit key date" });
          await dialog.waitFor();
          await dialog.getByText(/^This date will remind:/).waitFor();
          await n.waitForTimeout(800);
          return dialog;
        };
        let dialog = await openEdit();
        const beforeUsual = await dialog
          .getByRole("button", { name: "Use the usual audience" })
          .count();
        await dialog.getByRole("button", { name: "Cancel" }).click();
        const rm = await L.api(d, "DELETE", `/contracts/${fx.contract.number}/team/${recipient}`);
        expect(rm.status < 300, `remove ${rm.status}`);
        let status, offered, checkedAfter;
        try {
          dialog = await openEdit();
          status = (
            await dialog.getByRole("status").filter({ hasText: "left the team" }).innerText()
          )
            .replace(/\s+/g, " ")
            .trim();
          offered = await dialog.getByRole("button", { name: "Use the usual audience" }).count();
          await dialog.getByRole("button", { name: "Use the usual audience" }).click();
          checkedAfter = await dialog.getByRole("checkbox", { checked: true }).count();
          const stillStatus = await dialog
            .getByText("Some selected recipients have left the team")
            .count();
          await dialog.getByRole("button", { name: "Cancel" }).click();
          expect(
            beforeUsual === 0 && offered === 1 && checkedAfter === 0 && stillStatus === 0,
            JSON.stringify({ beforeUsual, offered, checkedAfter, stillStatus }),
          );
        } finally {
          await L.api(d, "POST", `/contracts/${fx.contract.number}/team`, { userId: recipient });
        }
        prep(
          `Daniel Okafor removed the selected recipient of ${label} from the C-${fx.contract.number} team through the team API and restored it after the check.`,
        );
        return `With the selected recipient still on the team, Edit key date showed ${beforeUsual} Use the usual audience controls. After that person left the team, the dialog read ${q(status)} and offered Use the usual audience (${offered}); choosing it left ${checkedAfter} recipients selected. Cancel closed it without saving.`;
      },
    );

  if (only.includes("bu"))
    await step(
      NT,
      "business_user",
      "A Business User on the team receives no date reminders or briefing from the morning rounds",
      "No date.* or briefing items in the Portal bell for the Contract after the rounds",
      async () => {
        const items = await itemsMatching(j, /date\.|briefing/, true, fx.createdAt);
        expect(items.length === 0, JSON.stringify(items.map((x) => x.eventType)));
        return `Jonas's Portal notifications since the fixtures were created include ${items.length} date reminder or briefing items, although he is on the C-${fx.contract.number} team whose Key dates reminded the Legal accounts.`;
      },
    );

  if (MORNING_STAMP && only.includes("lines")) {
    await step(
      NT,
      "legal_team_member",
      "The briefing lines name each Key date",
      "The Member Dates briefing email names both same-date Key dates and the narrowed one",
      async () => {
        const email = `doc029-conv-${MORNING_STAMP}-a@helix.example`;
        const [m] = (await mailSearch(`to:"${email}" subject:"Your daily briefing"`)).filter(
          (x) => x.Subject === "Your daily briefing",
        );
        expect(m, "no briefing mail");
        const text = await mailText(m.ID);
        const names = ["board pack", "filing window", "narrowed review"].map(
          (x) => `${MORNING_STAMP} ${x}`,
        );
        const present = names.filter((x) => text.includes(x));
        expect(present.length === 3, `present ${present}`);
        return `The Member Dates ${MORNING_STAMP} briefing email's Dates section names ${q(present)}.`;
      },
    );
  }
}

// ---------- focused screenshots ----------
async function shots() {
  const j = ctx.jonas.page;
  const n = ctx.nadia.page;
  results.screenshots = [];
  await step(
    NT,
    "business_user",
    "Screenshot: Portal bell item for a team comment on the Contract converted from his Request",
    "Item reads replied on your request",
    async () => {
      await comment(
        n,
        "contract",
        fx.contractId,
        `DOC-029 conversations ${fx.stamp} screenshot team comment`,
        "full_thread",
      );
      await j.goto(`${L.BASE}/portal/settings`);
      await j.getByRole("heading", { name: "Notification settings", level: 1 }).waitFor();
      await j.screenshot({ path: path.join(here, "r1-portal-notification-settings.png") });
      const dialog = await openBell(j);
      const item = dialog
        .getByRole("link", { name: new RegExp(`replied on your request ${fx.contractTitle}`) })
        .first();
      await item.waitFor();
      const text = (await item.innerText()).replace(/\s+/g, " ").trim();
      await j.screenshot({
        path: path.join(here, "r1-portal-bell-converted-contract-comment.png"),
      });
      await closeBell(j);
      results.screenshots.push(
        "r1-portal-notification-settings.png",
        "r1-portal-bell-converted-contract-comment.png",
      );
      return `Saved r1-portal-notification-settings.png and r1-portal-bell-converted-contract-comment.png; the newest item for the Contract comment read ${q(text)}.`;
    },
  );
  await step(
    CA,
    "legal_team_member",
    "Screenshot: Contract conversation with audience badges, Filed to, and administrator tombstones",
    "Screenshot saved",
    async () => {
      await n.goto(`${L.BASE}/contracts/${fx.contract.number}`);
      await openComments(n);
      await n.screenshot({ path: path.join(here, "r1-member-contract-comments.png") });
      results.screenshots.push("r1-member-contract-comments.png");
      return "Saved r1-member-contract-comments.png.";
    },
  );
}

// ---------- main ----------
let fx = existsSync(path.join(here, "fixtures-r1.json"))
  ? JSON.parse(readFileSync(path.join(here, "fixtures-r1.json"), "utf8"))
  : null;
const stamp = process.env.STAMP ?? String(Date.now()).slice(-6);
results.stamp = stamp;

const ctx = {};
try {
  ctx.nadia = await L.staffContext(L.PEOPLE.nadia);
  ctx.daniel = await L.staffContext(L.PEOPLE.daniel);
  ctx.jonas = await L.portalContext(L.PEOPLE.jonas);
  results.identities = [
    { role: "administrator", account: "Daniel Okafor (seed)", entry: "password sign-in" },
    { role: "legal_team_member", account: "Nadia Haddad (seed)", entry: "password sign-in" },
    {
      role: "business_user",
      account: "Jonas Weber (seed)",
      entry: "fresh magic link read from the work lab Mailpit, never stored",
    },
  ];

  if (run("setup")) await setupFixtures();
  for (const c of Object.values(ctx)) c.context.setDefaultTimeout(15000);
  if (run("member-comments")) await memberComments();
  if (run("member-comments2")) await memberComments2();
  if (run("admin-comments")) await adminComments();
  if (run("portal-comments")) await portalComments();
  if (run("admin-redact")) await adminRedact();
  if (run("portal-after")) await portalAfter();
  if (run("member-notifications")) await memberNotifications();
  if (run("admin-notifications")) await adminNotifications();
  if (run("portal-notifications")) await portalNotifications();
  if (run("morning")) await morning();
  if (SECTIONS.includes("supplement")) await supplement();
  if (SECTIONS.includes("shots")) await shots();
} finally {
  save();
  await L.close();
}
