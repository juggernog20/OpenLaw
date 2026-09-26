// DOC-030 contracts-c: matter-templates.md (V-C39) on the shared lab work2.
// The registry names the administrator role; the Convert path is walked as administrator and as
// legal_team_member, as the author's technical review and the triage ask.
// Fixture setup through the API (another guide owns these steps): three DOC-030 Matter Fields, a
// DOC-030 Matter type whose Form makes Priority and Risk creation Rows (On intake form), a
// Matter-targeting DOC-030 Request type, and two fictional Requests from Ade Balogun.
// Nothing seeded is changed. Every matter-templates step runs in the browser.
import path from "node:path";
import { PEOPLE, articleText, expectThat, q, sleep, until, utcDatePlus } from "./lib.mjs";

const ARTICLE = "matter-templates";
const SCENARIO = "V-C39";

export default async function templates(ctx) {
  const { BASE, step: rawStep, sessions, STAMP, results, here } = ctx;
  const step = (role, actors, page, action, expected, fn, extra = {}) =>
    rawStep(
      { article: ARTICLE, scenario: SCENARIO, role, actors, page, action, expected, ...extra },
      fn,
    );
  const G = "DOC-030 contracts-c";
  const T = {
    type: `${G} template type ${STAMP}`,
    fOpt: `${G} optional note ${STAMP}`,
    fReq: `${G} required note ${STAMP}`,
    fRec: `${G} record note ${STAMP}`,
    name: `${G} onboarding template ${STAMP}`,
    task1: `${G} manager task ${STAMP}`,
    task2: `${G} open task ${STAMP}`,
    task3: `${G} second manager task ${STAMP}`,
    date1: `${G} review ${STAMP}`,
    date2: `${G} kick-off ${STAMP}`,
    prefix: "DOC-030 CC -",
    requestType: `${G} matter request ${STAMP}`,
  };
  results.fixtures = { names: T };

  const admin = await sessions.password(PEOPLE.daniel);
  const nadia = await sessions.password(PEOPLE.nadia);
  const A = admin.page;
  const must = (r, what) => {
    if (r.status >= 300) throw new Error(`${what}: ${r.status} ${JSON.stringify(r.json)}`);
    return r.json;
  };

  // ------------------------------------------------------------ fixture setup (API)
  const fieldIds = {};
  for (const [key, displayName] of [
    ["fOpt", T.fOpt],
    ["fReq", T.fReq],
    ["fRec", T.fRec],
  ]) {
    const f = must(
      await admin.api("POST", "/fields", {
        displayName,
        moduleScope: "matter",
        fieldType: "text",
        fieldTag: "business",
      }),
      displayName,
    ).field;
    fieldIds[key] = f;
  }
  const type = must(
    await admin.api("POST", "/matter-types", { displayName: T.type }),
    T.type,
  ).matterType;
  const current = must(await admin.api("GET", `/matter-types/${type.id}/form`), "form").form;
  const pins = current.slice(0, 2);
  const builtin = Object.fromEntries(
    current.filter((n) => n.kind === "row" && n.id === n.rowRef).map((n) => [n.rowRef, n]),
  );
  const fieldRow = (f, { required = false, intake = false } = {}) => ({
    kind: "row",
    id: f.id,
    rowRef: f.slug,
    fieldType: "text",
    onIntakeForm: intake,
    isRequired: required,
    visibleOnPortal: true,
  });
  const formRows = (withRecord = true) => [
    ...pins,
    { ...builtin.description, onIntakeForm: true },
    { ...builtin.priority, onIntakeForm: true },
    { ...builtin.risk, onIntakeForm: true, isRequired: false },
    ...["department", "region", "needed_by"].map((k) => ({
      ...builtin[k],
      onIntakeForm: false,
      isRequired: false,
    })),
    fieldRow(fieldIds.fOpt, { intake: true }),
    fieldRow(fieldIds.fReq, { required: true }),
    ...(withRecord ? [fieldRow(fieldIds.fRec)] : []),
  ];
  must(await admin.api("PUT", `/matter-types/${type.id}/form`, { form: formRows() }), "type form");
  const savedForm = must(await admin.api("GET", `/matter-types/${type.id}/form`), "form").form;
  const rowFlags = savedForm
    .filter((n) => n.kind === "row")
    .map((n) => ({ rowRef: n.rowRef, onIntakeForm: n.onIntakeForm, isRequired: n.isRequired }));
  const rt = must(
    await admin.api("POST", "/request-types", { displayName: T.requestType }),
    T.requestType,
  ).requestType;
  must(
    await admin.api("PATCH", `/request-types/${rt.id}`, {
      targetModule: "matter",
      targetTypeId: type.id,
    }),
    "request type target",
  );
  results.fixtures.matterType = { id: type.id, displayName: T.type, form: rowFlags };
  results.fixtures.priorityRiskCreationRows = {
    priority: rowFlags.find((r) => r.rowRef === "priority"),
    risk: rowFlags.find((r) => r.rowRef === "risk"),
    note: "Priority and Risk are On intake form on this type, so both are creation Rows in the Create matter and Convert dialogs.",
  };
  results.fixtures.fields = Object.fromEntries(
    Object.entries(fieldIds).map(([k, f]) => [k, { slug: f.slug, displayName: f.displayName }]),
  );
  results.fixtures.requestType = { id: rt.id, displayName: T.requestType };

  // Two fictional Requests from Ade Balogun (one sign-in link).
  const requests = {};
  {
    const ade = await sessions.magic(PEOPLE.ade);
    const onboarding = must(await ade.api("GET", "/portal/onboarding"), "onboarding");
    const departmentId =
      onboarding.departmentId ??
      must(await admin.api("GET", "/departments"), "departments").departments[0].id;
    for (const role of ["administrator", "legal_team_member"]) {
      const title = `${G} matter-templates ${role} convert ${STAMP}`;
      const created = must(
        await ade.api("POST", "/requests", {
          requestTypeId: rt.id,
          departmentId,
          title,
          urgency: "high",
          description: `Fictional description for ${title}.`,
          customFields: { [fieldIds.fOpt.slug]: `Requester answer ${role}` },
        }),
        `request ${role}`,
      ).request;
      requests[role] = {
        number: created.number,
        title,
        createdAt: created.createdAt ?? new Date().toISOString(),
      };
    }
    await ade.context.close();
  }
  results.fixtures.requests = requests;

  // ------------------------------------------------------------ helpers
  async function openTemplates(page) {
    await page.goto(`${BASE}/`);
    await page.getByRole("banner").getByRole("button", { name: PEOPLE.daniel.name }).click();
    await page.getByRole("menuitem", { name: "Settings" }).click();
    await page.waitForURL(/\/settings/);
    const rail = page.getByRole("navigation", { name: "Settings sections" });
    await rail.getByRole("link", { name: "Matters", exact: true }).click();
    await page
      .getByRole("navigation", { name: "Matters panes" })
      .getByRole("link", { name: "Templates" })
      .click();
    await page.getByRole("heading", { name: "Matter templates" }).first().waitFor();
    await page.getByRole("combobox", { name: "Matter type" }).selectOption({ label: T.type });
    await sleep(800);
  }
  const fieldBox = (scope, name) =>
    scope.getByRole("textbox", {
      name: new RegExp(`^${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`),
    });
  async function saveTemplate(page) {
    await page.getByRole("button", { name: "Save template" }).click();
    await sleep(2500);
    const main = await page.locator("main").innerText();
    const error =
      main.match(
        /[^\n]*(could not be saved|Give every row|Give [^\n]* a number|Name the template)[^\n]*/,
      )?.[0] ?? null;
    return { error, saved: /Saved/.test(main) };
  }
  async function readTemplate(page) {
    const tasks = [];
    const nTasks = await page.getByRole("textbox", { name: /^Task \d+ title$/ }).count();
    for (let i = 1; i <= nTasks; i++)
      tasks.push([
        await page.getByRole("textbox", { name: `Task ${i} title` }).inputValue(),
        await page.getByRole("spinbutton", { name: `Task ${i} due offset in days` }).inputValue(),
        await page
          .getByRole("combobox", { name: `Task ${i} role` })
          .locator("option:checked")
          .innerText(),
      ]);
    const dates = [];
    const nDates = await page.getByRole("textbox", { name: /^Key date \d+ label$/ }).count();
    for (let i = 1; i <= nDates; i++)
      dates.push([
        await page.getByRole("textbox", { name: `Key date ${i} label` }).inputValue(),
        await page.getByRole("spinbutton", { name: `Key date ${i} offset in days` }).inputValue(),
        await page.getByRole("textbox", { name: `Key date ${i} note` }).inputValue(),
      ]);
    return {
      name: await page.getByRole("textbox", { name: "Name" }).first().inputValue(),
      description: await page.getByRole("textbox", { name: "Description" }).first().inputValue(),
      priority: await page
        .getByRole("combobox", { name: "Priority" })
        .locator("option:checked")
        .innerText(),
      risk: await page
        .getByRole("combobox", { name: "Risk" })
        .locator("option:checked")
        .innerText(),
      prefix: await page.getByRole("textbox", { name: "Title prefix" }).inputValue(),
      fOpt: await fieldBox(page, T.fOpt).inputValue(),
      fReq: await fieldBox(page, T.fReq).inputValue(),
      fRec: await fieldBox(page, T.fRec).inputValue(),
      tasks,
      dates,
    };
  }
  async function openCreate(page) {
    await page.goto(`${BASE}/matters`);
    await page.getByRole("button", { name: "New matter" }).click();
    const d = page.getByRole("dialog", { name: "Create matter" });
    await d.waitFor();
    return d;
  }
  const checked = (loc) => loc.evaluate((el) => el.options[el.selectedIndex]?.textContent?.trim());
  const optionsOf = (loc) =>
    loc.evaluate((el) => Array.from(el.options).map((o) => o.textContent.trim()));
  async function snapshot(who, number) {
    const m = (await who.api("GET", `/matters/${number}`)).json;
    const tasks = (await who.api("GET", `/matters/${number}/tasks`)).json.tasks ?? [];
    const dates = (await who.api("GET", `/matters/${number}/key-dates`)).json.deadlines ?? [];
    return {
      matter: m.matter,
      tasks: tasks.map((t) => [t.title, t.dueDate ?? null, t.assigneeName ?? null]),
      dates: dates.map((k) => [k.label, k.date]),
    };
  }
  async function pageReads(page, number) {
    try {
      return await pageReadsOnce(page, number);
    } catch {
      await sleep(3000);
      return await pageReadsOnce(page, number);
    }
  }
  async function pageReadsOnce(page, number) {
    await page.goto(`${BASE}/matters/${number}`);
    await page.waitForLoadState("networkidle").catch(() => {});
    await sleep(800);
    const overviewText = (await page.locator("body").innerText()).replace(/\s+/g, " ");
    const titleValue = await page
      .getByRole("textbox", { name: /^Title\b/ })
      .first()
      .inputValue()
      .catch(() => "");
    const overview = `${titleValue} | ${overviewText}`;
    await page.goto(`${BASE}/matters/${number}/tasks`);
    await page.waitForLoadState("networkidle").catch(() => {});
    await sleep(800);
    const tasks = (await page.locator("main").innerText()).replace(/\s+/g, " ");
    await page.goto(`${BASE}/matters/${number}/key-dates`);
    await page.waitForLoadState("networkidle").catch(() => {});
    await sleep(800);
    const dates = (await page.locator("main").innerText()).replace(/\s+/g, " ");
    return { overview, tasks, dates };
  }
  const expectedTasks = (anchor, manager) => [
    [T.task1, utcDatePlus(anchor, 2), manager],
    [T.task3, utcDatePlus(anchor, 5), manager],
    [T.task2, null, null],
  ];
  const expectedDates = (anchor) => [
    [T.date1, utcDatePlus(anchor, 10)],
    [T.date2, utcDatePlus(anchor, 0)],
  ];
  const sortLike = (actual, expected) =>
    expected.map((e) => actual.find((a) => a[0] === e[0]) ?? null);
  const S = {};

  // ------------------------------------------------------------ steps
  await step(
    "administrator",
    PEOPLE.daniel.name,
    "API (fixture setup)",
    "Before you start: a live Matter type with the Fields the template should fill (fixture setup through the API)",
    "The DOC-030 Matter type is live; Priority and Risk are On intake form, so both are creation Rows; the optional note is On intake form, the required note is Required for creation, and the record note is neither.",
    async () => {
      const pr = results.fixtures.priorityRiskCreationRows;
      expectThat(pr.priority?.onIntakeForm && pr.risk?.onIntakeForm, `priority/risk rows ${q(pr)}`);
      return `Matter type ${q(T.type)} Form rows ${q(rowFlags.map((r) => `${r.rowRef}${r.onIntakeForm ? " intake" : ""}${r.isRequired ? " required" : ""}`))}. Priority creation Row: yes (On intake form). Risk creation Row: yes (On intake form, optional). Request type ${q(T.requestType)} targets the type. Ade Balogun submitted R-${requests.administrator.number} and R-${requests.legal_team_member.number} (Urgency High, optional note answered, Risk not answered).`;
    },
  );

  await step(
    "administrator",
    PEOPLE.daniel.name,
    "/settings/matters/templates",
    "Create and edit a template, steps 1-7: profile menu > Settings > Matters > Templates; Matter type; Add template (Name, Description); Edit; Matter defaults; Custom field defaults; Tasks (Add task, offsets, Matter Manager / Unassigned, reorder); Key dates (Add key date); Save template; reopen and confirm",
    "The template saves, and after reload all four areas hold the entered values in the chosen order.",
    async () => {
      await openTemplates(A);
      await A.getByRole("button", { name: "Add template" }).click();
      const d = A.getByRole("dialog", { name: "Add Matter template" });
      await d.getByLabel("Name").fill(T.name);
      await d.getByLabel("Description").fill("DOC-030 fictional onboarding checklist.");
      await d.getByRole("button", { name: "Add template" }).click();
      await d.waitFor({ state: "hidden" });
      const listText = (await A.locator("main").innerText()).replace(/\s+/g, " ");
      await A.getByRole("link", { name: `Edit ${T.name}` }).click();
      await A.getByRole("heading", { name: "Matter defaults" }).waitFor();
      S.templateUrl = A.url();
      const typeNote = (await A.getByText(/^Matter type: /).textContent()).trim();
      await A.getByRole("combobox", { name: "Priority" }).selectOption({ label: "Low" });
      await A.getByRole("combobox", { name: "Risk" }).selectOption({ label: "Critical" });
      await A.getByRole("textbox", { name: "Title prefix" }).fill(T.prefix);
      await fieldBox(A, T.fOpt).fill("Template optional default");
      await fieldBox(A, T.fReq).fill("Template required default");
      await fieldBox(A, T.fRec).fill("Template record default");
      for (const [title, offset, roleName] of [
        [T.task1, "2", "Matter Manager"],
        [T.task2, "", "Unassigned"],
        [T.task3, "5", "Matter Manager"],
      ]) {
        await A.getByRole("button", { name: "Add task" }).click();
        const i = await A.getByRole("textbox", { name: /^Task \d+ title$/ }).count();
        await A.getByRole("textbox", { name: `Task ${i} title` }).fill(title);
        await A.getByRole("spinbutton", { name: `Task ${i} due offset in days` }).fill(offset);
        await A.getByRole("combobox", { name: `Task ${i} role` }).selectOption({ label: roleName });
      }
      const roleOptions = await optionsOf(A.getByRole("combobox", { name: "Task 1 role" }));
      await A.getByRole("button", {
        name: new RegExp(`^Reorder ${T.task3.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}, position`),
      }).focus();
      await A.keyboard.press("ArrowUp");
      await sleep(500);
      for (const [label, offset, note] of [
        [T.date1, "10", "Fictional review with the supplier."],
        [T.date2, "0", ""],
      ]) {
        await A.getByRole("button", { name: "Add key date" }).click();
        const i = await A.getByRole("textbox", { name: /^Key date \d+ label$/ }).count();
        await A.getByRole("textbox", { name: `Key date ${i} label` }).fill(label);
        await A.getByRole("spinbutton", { name: `Key date ${i} offset in days` }).fill(offset);
        await A.getByRole("textbox", { name: `Key date ${i} note` }).fill(note);
      }
      const saved = await saveTemplate(A);
      expectThat(!saved.error, `save error ${saved.error}`);
      await A.reload();
      await A.getByRole("heading", { name: "Matter defaults" }).waitFor();
      await sleep(1000);
      const t = await readTemplate(A);
      expectThat(
        t.priority === "Low" && t.risk === "Critical" && t.prefix.trim() === T.prefix,
        `defaults ${q(t)}`,
      );
      expectThat(
        t.fOpt === "Template optional default" &&
          t.fReq === "Template required default" &&
          t.fRec === "Template record default",
        `field defaults ${q(t)}`,
      );
      expectThat(
        q(t.tasks) ===
          q([
            [T.task1, "2", "Matter Manager"],
            [T.task3, "5", "Matter Manager"],
            [T.task2, "", "Unassigned"],
          ]),
        `tasks ${q(t.tasks)}`,
      );
      expectThat(
        q(t.dates) ===
          q([
            [T.date1, "10", "Fictional review with the supplier."],
            [T.date2, "0", ""],
          ]),
        `dates ${q(t.dates)}`,
      );
      S.template = must(
        await admin.api("GET", "/matter-templates?includeArchived=true"),
        "templates",
      ).matterTemplates.find((x) => x.name === T.name);
      await A.screenshot({ path: path.join(here, "matter-template-editor.png"), fullPage: true });
      return `Templates list after Add template: ${q(listText.slice(listText.indexOf(T.name) - 10, listText.indexOf(T.name) + T.name.length + 60))}. Edit opened the editor (${q(typeNote)}). Task role options ${q(roleOptions)}. Save template reported saved=${saved.saved}. After reload: Priority ${q(t.priority)}, Risk ${q(t.risk)}, Title prefix ${q(t.prefix)}; Field defaults ${q([t.fOpt, t.fReq, t.fRec])}; Tasks ${q(t.tasks)} (the third Task moved up with ArrowUp on its reorder handle); Key dates ${q(t.dates)}.`;
    },
  );

  await step(
    "administrator",
    PEOPLE.daniel.name,
    "template editor",
    "Offsets: enter Task 1 due offset 3651 and save; then clear Key date 1's offset and save (Recover a failed save: correct invalid offsets)",
    "Both saves are refused with an error naming the problem; after reload the template is unchanged.",
    async () => {
      await A.goto(S.templateUrl);
      await A.getByRole("heading", { name: "Matter defaults" }).waitFor();
      await A.getByRole("combobox", { name: "Priority" }).selectOption({ label: "Critical" });
      await A.getByRole("spinbutton", { name: "Task 1 due offset in days" }).fill("3651");
      const big = await saveTemplate(A);
      await A.reload();
      await A.getByRole("heading", { name: "Matter defaults" }).waitFor();
      await sleep(800);
      const afterBig = await readTemplate(A);
      await A.getByRole("spinbutton", { name: "Key date 1 offset in days" }).fill("");
      const blank = await saveTemplate(A);
      await A.reload();
      await A.getByRole("heading", { name: "Matter defaults" }).waitFor();
      await sleep(800);
      const afterBlank = await readTemplate(A);
      expectThat(big.error && blank.error, `errors ${q([big.error, blank.error])}`);
      expectThat(
        afterBig.priority === "Low" &&
          afterBig.tasks[0][1] === "2" &&
          afterBlank.dates[0][1] === "10",
        "a refused save changed the template",
      );
      return `Priority Critical with Task 1 offset 3651: Save template showed ${q(big.error)}; after reload Priority ${q(afterBig.priority)}, Task 1 offset ${q(afterBig.tasks[0][1])}. Blank Key date 1 offset: ${q(blank.error)}; after reload it reads ${q(afterBlank.dates[0][1])}. Both were refused before any section saved.`;
    },
  );

  await step(
    "administrator",
    PEOPLE.daniel.name,
    "/matters (Create matter dialog), /matters/<n>",
    "Test both creation paths, direct creation: choose the type, then the template in Matter template; read the hint, the title, the creation Rows, and Matter Manager; clear the optional Field; Create; check Overview, Tasks, Task assignments and Key dates",
    "The dialog says the template adds 3 Tasks and 2 Key dates, suggests the prefix title, shows Priority Low and Risk Critical and the Field defaults in the creation Rows; the record-only Field is not shown but its default goes on the Matter; the cleared optional Field stays empty; dates count from the UTC creation date; Manager Tasks go to the Matter Manager; the Task without an offset has no due date.",
    async () => {
      const d = await openCreate(A);
      await d.getByLabel("Matter type").selectOption({ label: T.type });
      const templateOptions = await optionsOf(d.getByLabel("Matter template"));
      await d.getByLabel("Matter template").selectOption({ label: T.name });
      await sleep(600);
      const hint = (await d.getByText(/^Template adds /).innerText()).trim();
      const suggested = {
        title: await d.getByLabel(/^Title\b/).inputValue(),
        priority: await checked(d.getByLabel(/^Priority\b/)),
        risk: await checked(d.getByLabel(/^Risk\b/)),
        manager: await checked(d.getByLabel("Matter Manager")),
        fOpt: await fieldBox(d, T.fOpt).inputValue(),
        fReq: await fieldBox(d, T.fReq).inputValue(),
        fRecShown: await fieldBox(d, T.fRec).count(),
      };
      expectThat(hint === "Template adds 3 tasks and 2 key dates.", `hint ${hint}`);
      expectThat(
        suggested.title.trim() === T.prefix &&
          suggested.priority === "Low" &&
          suggested.risk === "Critical" &&
          suggested.manager === PEOPLE.daniel.name,
        `suggested ${q(suggested)}`,
      );
      expectThat(
        suggested.fOpt === "Template optional default" &&
          suggested.fReq === "Template required default" &&
          suggested.fRecShown === 0,
        `fields ${q(suggested)}`,
      );
      const title = `${T.prefix} ${G} direct matter ${STAMP}`;
      await d.getByLabel(/^Title\b/).fill(title);
      await fieldBox(d, T.fOpt).fill("");
      await d.getByRole("button", { name: "Create" }).click();
      await A.waitForURL(/\/matters\/\d+/, { timeout: 20000 });
      const number = Number(A.url().match(/\/matters\/(\d+)/)[1]);
      S.direct = number;
      const snap = await snapshot(admin, number);
      const m = snap.matter;
      const anchor = m.createdAt;
      const cf = m.customFields ?? {};
      const reads = await pageReads(A, number);
      S.directSnapshot = snap;
      expectThat(
        m.priority === "low" && m.risk === "critical",
        `priority/risk ${m.priority}/${m.risk}`,
      );
      expectThat(
        (cf[fieldIds.fOpt.slug] ?? null) === null || cf[fieldIds.fOpt.slug] === "",
        `optional ${q(cf)}`,
      );
      expectThat(
        cf[fieldIds.fReq.slug] === "Template required default" &&
          cf[fieldIds.fRec.slug] === "Template record default",
        `fields ${q(cf)}`,
      );
      expectThat(
        q(sortLike(snap.tasks, expectedTasks(anchor, PEOPLE.daniel.name))) ===
          q(expectedTasks(anchor, PEOPLE.daniel.name)),
        `tasks ${q(snap.tasks)}`,
      );
      expectThat(
        q(sortLike(snap.dates, expectedDates(anchor))) === q(expectedDates(anchor)),
        `dates ${q(snap.dates)}`,
      );
      expectThat(
        reads.tasks.includes(T.task1) &&
          reads.dates.includes(T.date1) &&
          reads.overview.includes(title),
        "pages do not show the template content",
      );
      return `Template choices ${q(templateOptions)}; hint ${q(hint)}; suggested ${q(suggested)} (the record-only Field is not a creation Row, so it is not drawn). Cleared the optional Field, Create opened M-${number} created ${anchor} (UTC anchor ${anchor.slice(0, 10)}). Saved priority ${m.priority}, risk ${m.risk}, optional ${q(cf[fieldIds.fOpt.slug] ?? null)}, required ${q(cf[fieldIds.fReq.slug])}, record-only ${q(cf[fieldIds.fRec.slug])} (template default for a Row the dialog did not show). Tasks ${q(snap.tasks)}; Key dates ${q(snap.dates)}. Overview, Tasks and Key dates pages show the title, Tasks and Key dates.`;
    },
  );

  await step(
    "administrator",
    PEOPLE.daniel.name,
    "/matters (Create matter dialog)",
    "Direct creation with explicit values: clear the Required for creation Field and select Create; then fill it, set Priority to Medium and Matter Manager to Unassigned, and Create",
    "Creation is refused while the required Row is empty; the explicit Priority wins over the template default; Matter Manager Tasks stay unassigned.",
    async () => {
      const d = await openCreate(A);
      await d.getByLabel("Matter type").selectOption({ label: T.type });
      await d.getByLabel("Matter template").selectOption({ label: T.name });
      await sleep(500);
      const title = `${T.prefix} ${G} unassigned matter ${STAMP}`;
      await d.getByLabel(/^Title\b/).fill(title);
      await fieldBox(d, T.fReq).fill("");
      await d.getByRole("button", { name: "Create" }).click();
      await until(async () => (await d.getByRole("alert").count()) > 0, "no required alert");
      const alert = (await d.getByRole("alert").first().innerText()).trim();
      const stillOpen = await d.isVisible();
      await fieldBox(d, T.fReq).fill("Typed required value");
      await d.getByLabel(/^Priority\b/).selectOption({ label: "Medium" });
      await d.getByLabel("Matter Manager").selectOption({ label: "Unassigned" });
      await d.getByRole("button", { name: "Create" }).click();
      await A.waitForURL(/\/matters\/\d+/, { timeout: 20000 });
      const number = Number(A.url().match(/\/matters\/(\d+)/)[1]);
      const snap = await snapshot(admin, number);
      const m = snap.matter;
      expectThat(alert.includes(T.fReq) && stillOpen, `alert ${alert}`);
      expectThat(
        (m.priority === "medium" && m.risk === "critical" && m.manager === null) ||
          (m.priority === "medium" && !m.manager?.id),
        `matter ${q({ p: m.priority, r: m.risk, mgr: m.manager })}`,
      );
      expectThat(
        snap.tasks.length === 3 && snap.tasks.every((t) => t[2] === null),
        `tasks ${q(snap.tasks)}`,
      );
      expectThat(m.customFields[fieldIds.fReq.slug] === "Typed required value", "typed value lost");
      return `Empty required Row: the dialog stayed open with ${q(alert)}. After filling it, Priority Medium and Unassigned: M-${number} priority ${m.priority} (template Low), risk ${m.risk}, manager ${q(m.manager?.displayName ?? null)}, required ${q(m.customFields[fieldIds.fReq.slug])}; Tasks ${q(snap.tasks)} (Manager Tasks unassigned).`;
    },
  );

  for (const [role, who] of [
    ["administrator", admin],
    ["legal_team_member", nadia],
  ]) {
    const R = requests[role];
    await step(
      role,
      who.name,
      `/inbox/${R.number} (Convert dialog)`,
      `Test both creation paths, Request conversion: open R-${R.number}, Triage > Convert to matter, confirm the configured Matter type, choose the template in Matter template, review the creation Rows${role === "administrator" ? ", fill Risk Medium" : ", leave Risk empty"}, and select Convert to matter`,
      "The dialog shows the target Form's creation Rows; the optional Field starts from the Request's answer, the required Field from the template default; Priority starts from the Request's Urgency (High), not the template's Low; Risk starts empty; no carried or not-carried lists; no template title prefix.",
      async () => {
        const page = who.page;
        await page.goto(`${BASE}/inbox/${R.number}`);
        await page.getByText(`R-${R.number}`, { exact: true }).first().waitFor({ timeout: 20000 });
        await page.waitForLoadState("networkidle").catch(() => {});
        await page.getByRole("button", { name: "Triage", exact: true }).click();
        await page.getByRole("menuitem", { name: "Convert to matter" }).click();
        const d = page.getByRole("dialog", { name: `Convert R-${R.number} to a matter` });
        await d.waitFor();
        const typeShown = await checked(d.getByLabel("Matter type"));
        const before = {
          priority: await checked(d.getByLabel(/^Priority\b/)),
          fReq: await fieldBox(d, T.fReq).inputValue(),
        };
        await d.getByLabel("Matter template").selectOption({ label: T.name });
        await sleep(800);
        const text = (await d.innerText()).replace(/\s+/g, " ");
        const reviewed = {
          title: await d.getByLabel(/^Title\b/).inputValue(),
          priority: await checked(d.getByLabel(/^Priority\b/)),
          risk: await checked(d.getByLabel(/^Risk\b/)),
          fOpt: await fieldBox(d, T.fOpt).inputValue(),
          fReq: await fieldBox(d, T.fReq).inputValue(),
          fRecShown: await fieldBox(d, T.fRec).count(),
        };
        const lists = /carr(y|ies) into|Does not carry/i.test(text);
        expectThat(typeShown === T.type, `type ${typeShown}`);
        expectThat(
          reviewed.title === R.title && reviewed.priority === "High" && reviewed.risk === "Not set",
          `reviewed ${q(reviewed)}`,
        );
        expectThat(
          reviewed.fOpt === `Requester answer ${role}` &&
            reviewed.fReq === "Template required default" &&
            reviewed.fRecShown === 0,
          `fields ${q(reviewed)}`,
        );
        expectThat(!lists, "carry lists shown");
        if (role === "administrator")
          await d.getByLabel(/^Risk\b/).selectOption({ label: "Medium" });
        await page.screenshot({
          path: path.join(here, `${role}-convert-matter-template.png`),
          fullPage: false,
        });
        await d.getByRole("button", { name: "Convert to matter", exact: true }).click();
        await d.waitFor({ state: "hidden", timeout: 60000 });
        const detail = (await who.api("GET", `/requests/${R.number}`)).json;
        const number = detail.request.convertedRecord?.number;
        expectThat(
          detail.request.convertedRecord?.module === "matter",
          `outcome ${q(detail.request.convertedRecord)}`,
        );
        S[`converted_${role}`] = number;
        const snap = await snapshot(who, number);
        const m = snap.matter;
        const cf = m.customFields ?? {};
        const anchor = m.createdAt;
        const reads = await pageReads(page, number);
        expectThat(m.title === R.title, `title ${m.title}`);
        expectThat(m.priority === "high", `priority ${m.priority}`);
        expectThat(
          role === "administrator" ? m.risk === "medium" : m.risk === null,
          `risk ${m.risk}`,
        );
        expectThat(m.manager?.displayName === who.name, `manager ${q(m.manager)}`);
        expectThat(
          cf[fieldIds.fOpt.slug] === `Requester answer ${role}` &&
            cf[fieldIds.fReq.slug] === "Template required default",
          `fields ${q(cf)}`,
        );
        expectThat(
          q(sortLike(snap.tasks, expectedTasks(anchor, who.name))) ===
            q(expectedTasks(anchor, who.name)),
          `tasks ${q(snap.tasks)}`,
        );
        expectThat(
          q(sortLike(snap.dates, expectedDates(anchor))) === q(expectedDates(anchor)),
          `dates ${q(snap.dates)}`,
        );
        expectThat(
          reads.tasks.includes(T.task1) && reads.dates.includes(T.date1),
          "pages do not show the template content",
        );
        return `Dialog "Convert R-${R.number} to a matter" opened on Matter type ${q(typeShown)} with Priority ${q(before.priority)} (Urgency High). After choosing the template: ${q(reviewed)}; no carried or not-carried lists. ${role === "administrator" ? "Filled Risk Medium." : "Left Risk Not set."} Converted to M-${number} created ${anchor} (the Request was submitted ${R.createdAt}). Saved title ${q(m.title)} (no ${q(T.prefix)} prefix), priority ${m.priority} (template Low), risk ${q(m.risk)} (template Critical does not apply), Matter Manager ${q(m.manager?.displayName)}, optional ${q(cf[fieldIds.fOpt.slug])}, required ${q(cf[fieldIds.fReq.slug])}, record-only ${q(cf[fieldIds.fRec.slug] ?? null)}. Tasks ${q(snap.tasks)}; Key dates ${q(snap.dates)} (anchor ${anchor.slice(0, 10)} UTC).`;
      },
      { independent: true },
    );
  }

  await step(
    "administrator",
    PEOPLE.daniel.name,
    "template editor, /matters",
    "Change or archive a template: rename Task 1 and change its offset to 3, save; compare the earlier Matter and a new Matter",
    "The earlier Matter keeps its Tasks; a new Matter uses the changed Task.",
    async () => {
      await A.goto(S.templateUrl);
      await A.getByRole("heading", { name: "Matter defaults" }).waitFor();
      const edited = `${T.task1} revised`;
      await A.getByRole("textbox", { name: "Task 1 title" }).fill(edited);
      await A.getByRole("spinbutton", { name: "Task 1 due offset in days" }).fill("3");
      const saved = await saveTemplate(A);
      expectThat(!saved.error, `save error ${saved.error}`);
      const directNow = (await snapshot(admin, S.direct)).tasks;
      expectThat(
        q(directNow) === q(S.directSnapshot.tasks),
        `existing Matter changed: ${q(directNow)}`,
      );
      const d = await openCreate(A);
      await d.getByLabel("Matter type").selectOption({ label: T.type });
      await d.getByLabel("Matter template").selectOption({ label: T.name });
      await sleep(500);
      await d.getByLabel(/^Title\b/).fill(`${T.prefix} ${G} after change matter ${STAMP}`);
      const posted = A.waitForRequest(
        (r) => r.method() === "POST" && /\/api\/v1\/matters$/.test(r.url()),
      );
      await d.getByRole("button", { name: "Create" }).click();
      S.createBody = JSON.parse((await posted).postData() ?? "{}");
      await A.waitForURL(/\/matters\/\d+/, { timeout: 20000 });
      const number = Number(A.url().match(/\/matters\/(\d+)/)[1]);
      const snap = await snapshot(admin, number);
      const t1 = snap.tasks.find((t) => t[0] === edited);
      expectThat(
        t1 && t1[1] === utcDatePlus(snap.matter.createdAt, 3),
        `new tasks ${q(snap.tasks)}`,
      );
      return `Saved Task 1 as ${q(edited)} with offset 3. M-${S.direct} still has ${q(directNow)}. New M-${number} (created ${snap.matter.createdAt}) has ${q(t1)}.`;
    },
  );

  await step(
    "administrator",
    PEOPLE.daniel.name,
    "/settings/matters/templates, /matters",
    "Archive the template (Archive control, Archive template), check creation, then Show archived > Restore",
    "The archived template is not offered and a creation that names it is refused with a clear message; Restore brings its saved definition back.",
    async () => {
      await openTemplates(A);
      await A.getByRole("button", { name: `Archive ${T.name}`, exact: true }).click();
      const ad = A.getByRole("dialog");
      const adText = (await ad.innerText()).replace(/\s+/g, " ");
      await ad.getByRole("button", { name: "Archive template" }).click();
      await ad.waitFor({ state: "hidden", timeout: 15000 });
      let d = await openCreate(A);
      await d.getByLabel("Matter type").selectOption({ label: T.type });
      const archivedOptions = await optionsOf(d.getByLabel("Matter template"));
      await d.getByRole("button", { name: "Cancel" }).click();
      const refused = await admin.api("POST", "/matters", {
        ...S.createBody,
        title: `${G} refused archived template ${STAMP}`,
      });
      await openTemplates(A);
      await A.getByRole("switch", { name: "Show archived" }).click();
      await A.getByRole("button", { name: `Restore ${T.name}`, exact: true }).click();
      await A.getByRole("button", { name: `Archive ${T.name}`, exact: true }).waitFor({
        timeout: 15000,
      });
      await A.getByRole("link", { name: `Edit ${T.name}` }).click();
      await A.getByRole("heading", { name: "Matter defaults" }).waitFor();
      await sleep(800);
      const restored = await readTemplate(A);
      d = await openCreate(A);
      await d.getByLabel("Matter type").selectOption({ label: T.type });
      const restoredOptions = await optionsOf(d.getByLabel("Matter template"));
      await d.getByRole("button", { name: "Cancel" }).click();
      expectThat(
        !archivedOptions.includes(T.name) &&
          refused.status >= 400 &&
          restoredOptions.includes(T.name),
        q({ archivedOptions, refused: refused.status, restoredOptions }),
      );
      expectThat(
        restored.tasks.length === 3 &&
          restored.dates.length === 2 &&
          restored.fReq === "Template required default",
        `restored ${q(restored)}`,
      );
      return `Archive dialog: ${q(adText.slice(0, 220))}. After Archive template the Create matter dialog offered ${q(archivedOptions)}; a create naming the archived template answered ${refused.status} ${q(refused.json?.detail ?? refused.json?.title)}. Show archived > Restore: the editor holds ${restored.tasks.length} Tasks, ${restored.dates.length} Key dates and the Field defaults; the dialog offers ${q(restoredOptions)} again.`;
    },
  );

  await step(
    "administrator",
    PEOPLE.daniel.name,
    "/matters (Create matter dialog)",
    "A template whose Matter type is unavailable: a second, unused DOC-030 Matter type with its own template is archived (setup through the API); open Create matter and try that template; then restore the type",
    "The archived type and its template are not offered, and a creation naming them is refused.",
    async () => {
      const t2 = must(
        await admin.api("POST", "/matter-types", { displayName: `${T.type} unused` }),
        "second type",
      ).matterType;
      const tpl2 = must(
        await admin.api("POST", "/matter-templates", {
          matterTypeId: t2.id,
          name: `${T.name} unused`,
          defaultPriority: "low",
        }),
        "second template",
      ).matterTemplate;
      let d = await openCreate(A);
      const before = await optionsOf(d.getByLabel("Matter type"));
      await d.getByLabel("Matter type").selectOption({ label: `${T.type} unused` });
      const tplBefore = await optionsOf(d.getByLabel("Matter template"));
      await d.getByRole("button", { name: "Cancel" }).click();
      const arch = await admin.api("POST", `/matter-types/${t2.id}/archive`, {});
      try {
        expectThat(arch.status < 300, `archive type ${arch.status} ${q(arch.json)}`);
        d = await openCreate(A);
        const types = await optionsOf(d.getByLabel("Matter type"));
        await d.getByRole("button", { name: "Cancel" }).click();
        const refused = await admin.api("POST", "/matters", {
          title: `${G} refused archived type ${STAMP}`,
          matterTypeId: t2.id,
          templateId: tpl2.id,
        });
        expectThat(
          before.includes(`${T.type} unused`) && tplBefore.includes(`${T.name} unused`),
          "second type or template not offered while live",
        );
        expectThat(
          !types.includes(`${T.type} unused`) && refused.status >= 400,
          q({ offered: types.includes(`${T.type} unused`), refused: refused.status }),
        );
        return `While live, Create matter offered ${q(`${T.type} unused`)} with template choices ${q(tplBefore)}. After the type was archived, Create matter no longer listed it; a create naming the archived type and its template answered ${refused.status} ${q(refused.json?.detail ?? refused.json?.title)}.`;
      } finally {
        await admin.api("POST", `/matter-types/${t2.id}/restore`, {});
      }
    },
  );

  await step(
    "administrator",
    PEOPLE.daniel.name,
    "template editor",
    "A Field detached from the template's type: remove the record-only Field's Row from the type Form (setup through the API), open the template editor, then attach it again",
    "The editor names the Field and its retained saved value; after reattaching, the default is an editable control again.",
    async () => {
      must(
        await admin.api("PUT", `/matter-types/${type.id}/form`, { form: formRows(false) }),
        "detach",
      );
      await A.goto(S.templateUrl);
      await A.getByRole("heading", { name: "Custom field defaults" }).waitFor();
      await sleep(1000);
      const note = (
        await A.getByText(/is no longer attached to this Matter type/).textContent()
      ).trim();
      must(
        await admin.api("PUT", `/matter-types/${type.id}/form`, { form: formRows(true) }),
        "reattach",
      );
      await A.reload();
      await A.getByRole("heading", { name: "Custom field defaults" }).waitFor();
      await sleep(1000);
      const value = await fieldBox(A, T.fRec).inputValue();
      expectThat(
        note.includes(T.fRec) &&
          note.includes("Template record default") &&
          value === "Template record default",
        `note ${note}, value ${value}`,
      );
      return `After the Row was removed, the editor read ${q(note)}. After the Row was added again, the default control shows ${q(value)}.`;
    },
  );

  await step(
    "administrator",
    PEOPLE.daniel.name,
    "docs/user-guides/matter-templates.md",
    "Guide text check: the steps walked are the ones in the reviewed content",
    "The guide names Matter template, On intake form, Required for creation, Convert to matter, Archive template, Show archived and Restore.",
    async () => {
      const text = articleText(ARTICLE);
      for (const label of [
        "**Matter template**",
        "**On intake form**",
        "**Required for creation**",
        "**Convert to matter**",
        "**Archive template**",
        "**Show archived**",
        "**Restore**",
        "**Save template**",
      ])
        expectThat(text.includes(label), `guide lacks ${label}`);
      return "All eight labels are in the reviewed guide text.";
    },
  );

  results.records = {
    direct: S.direct,
    converted: {
      administrator: S.converted_administrator,
      legal_team_member: S.converted_legal_team_member,
    },
  };
  await admin.context.close();
  await nadia.context.close();
}
