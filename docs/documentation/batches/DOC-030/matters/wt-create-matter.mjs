// V-C22 steps for "Create a Matter and use a template" (create-matter.md), DOC-030.
// Adapted from the DOC-029 round 1 script and rewritten for the type Form creation Rows.
import path from "node:path";
import { expectThat, q, findMatters, matterByNumber, patchAfter, utcDatePlus } from "./lib.mjs";

export default async function createMatter(ctx) {
  const { role, stamp, fx, BASE, api, step, account, actor, admin } = ctx;
  const page = actor.page;
  const short = role === "administrator" ? "admin" : "legal";
  const title = (label) => `DOC-030 matters create-matter ${short} ${label} ${stamp}`;
  const dialog = () => page.getByRole("dialog", { name: "Create matter" });
  const selectedLabel = async (locator) =>
    locator.evaluate((el) => el.options[el.selectedIndex]?.textContent?.trim());
  const optionLabels = async (locator) =>
    locator.evaluate((el) => Array.from(el.options).map((o) => o.textContent.trim()));
  async function openCreate() {
    await page.goto(`${BASE}/matters`);
    await page.getByRole("button", { name: "New matter" }).click();
    await dialog().waitFor();
  }
  const state = {};
  const esc = (v) => v.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const fieldBox = (scope, f) => scope.getByLabel(new RegExp(`^${esc(f.displayName)}`));
  const builtinLabels = ["Description", "Department", "Region", "Priority", "Risk", "Needed by"];
  async function drawnBuiltins(d) {
    const shown = [];
    for (const label of builtinLabels)
      if (await d.getByLabel(new RegExp(`^${label}\\b`)).count()) shown.push(label);
    return shown;
  }
  const PDF = path.join(ctx.here, "../../DOC-029/matters/fixtures/doc029-matters-note.pdf");
  async function pickNeededBy(d) {
    await d.getByRole("button", { name: "Needed by" }).click();
    const pop = page.getByRole("dialog", { name: "Choose a date" });
    await pop.waitFor();
    await pop.getByRole("button", { name: "Next month" }).click();
    await pop.getByRole("button", { name: /\b15th\b/ }).click();
    await pop.waitFor({ state: "hidden" });
    const now = new Date();
    const next = new Date(now.getFullYear(), now.getMonth() + 1, 15);
    return `${next.getFullYear()}-${String(next.getMonth() + 1).padStart(2, "0")}-15`;
  }

  await step(
    "Create the Matter: open Matters, select New matter, and read the starting values and the Rows the Form draws",
    "The Create matter dialog starts on the default type; Matter Manager starts with the reader, offers Unassigned and only Legal Team Members or Administrators; Matter template appears for a chosen type and starts on No template; the dialog draws only the Rows the type's Form collects at creation (Department with No Department, Priority Medium, Risk, Needed by on the lab type; only Description on a new type; a required Department starts on Choose a Department).",
    async () => {
      await openCreate();
      const d = dialog();
      const startType = await selectedLabel(d.getByLabel("Matter type"));
      const defaults = (await api(page, "GET", "/matters/options")).json.matterTypes.filter(
        (t) => t.isDefault,
      );
      const manager = await selectedLabel(d.getByLabel("Matter Manager"));
      const managers = await optionLabels(d.getByLabel("Matter Manager"));
      const startRows = await drawnBuiltins(d);
      expectThat(
        defaults.length === 1 && startType === defaults[0].displayName,
        `dialog started on ${startType}; default ${q(defaults.map((t) => t.displayName))}`,
      );
      expectThat(manager === account.name, `Manager starts on ${manager}`);
      expectThat(managers[0] === "Unassigned", "no Unassigned option first");
      for (const outsider of ["Jonas Weber", "Ravi Menon"])
        expectThat(!managers.includes(outsider), `${outsider} offered as Manager`);
      await d.getByLabel("Matter type").selectOption({ label: fx.typeMain.displayName });
      const template = await selectedLabel(d.getByLabel("Matter template"));
      const templates = await optionLabels(d.getByLabel("Matter template"));
      const mainRows = await drawnBuiltins(d);
      const department = await selectedLabel(d.getByLabel(/^Department\b/));
      const departments = await optionLabels(d.getByLabel(/^Department\b/));
      const priority = await selectedLabel(d.getByLabel("Priority", { exact: true }));
      const risk = await selectedLabel(d.getByLabel("Risk", { exact: true }));
      const riskOptions = await optionLabels(d.getByLabel("Risk", { exact: true }));
      const neededBy = (await d.getByRole("button", { name: "Needed by" }).innerText()).trim();
      const fieldLabels = [];
      for (const f of [fx.fieldRequired, fx.fieldOptional, fx.fieldEntity, fx.fieldPerson])
        if (await fieldBox(d, f).isVisible()) fieldLabels.push(f.displayName);
      await d.getByLabel("Matter type").selectOption({ label: fx.typeRetype.displayName });
      const newTypeRows = await drawnBuiltins(d);
      await d.getByLabel("Matter type").selectOption({ label: fx.typeDept.displayName });
      const deptRows = await drawnBuiltins(d);
      const requiredDept = await selectedLabel(d.getByLabel(/^Department\b/));
      await d.getByRole("button", { name: "Cancel" }).click();
      await dialog().waitFor({ state: "hidden" });
      expectThat(template === "No template", `template starts on ${template}`);
      expectThat(
        q(mainRows) === q(["Description", "Department", "Priority", "Risk", "Needed by"]),
        `lab type rows ${q(mainRows)}`,
      );
      expectThat(department === "No Department", `Department ${department}`);
      expectThat(priority === "Medium", `Priority ${priority}`);
      expectThat(fieldLabels.length === 4, `type Fields shown: ${fieldLabels}`);
      expectThat(q(newTypeRows) === q(["Description"]), `new type rows ${q(newTypeRows)}`);
      expectThat(
        q(deptRows) === q(["Description", "Department"]) && requiredDept === "Choose a Department",
        `required Department ${q(deptRows)} ${requiredDept}`,
      );
      return `Matters > New matter opened "Create matter" on Matter type ${q(startType)} (the type marked default). Built-in Rows drawn on it: ${q(startRows)}. Matter Manager started on ${q(manager)}; options ${q(managers)} (no Business Users). After choosing ${q(fx.typeMain.displayName)} (Form: Description, Department, Priority, Risk, Needed by On intake form; Region a record Row): Matter template ${q(template)} of ${q(templates)}; built-in Rows drawn ${q(mainRows)}; Department ${q(department)} (options ${q(departments)}); Priority ${q(priority)}; Risk ${q(risk)} (options ${q(riskOptions)}); Needed by button reads ${q(neededBy)}; the four attached Fields drawn ${q(fieldLabels)}. ${q(fx.typeRetype.displayName)} (the Form a new type gets, plus two required Fields) drew built-in Rows ${q(newTypeRows)}. ${q(fx.typeDept.displayName)} (Department Required for creation) drew ${q(deptRows)} with Department starting on ${q(requiredDept)}. Cancel closed the dialog.`;
    },
  );

  await step(
    "Create the Matter / If creation is refused: missing Title and required Field, a required Department, then Cancel",
    "Create is refused with a message naming the missing values; a required Department left on Choose a Department blocks Create; choosing a Department then creates the Matter; Cancel closes without creating.",
    async () => {
      const t = title("refused");
      await openCreate();
      let d = dialog();
      await d.getByLabel("Matter type").selectOption({ label: fx.typeMain.displayName });
      await d.getByRole("button", { name: "Create", exact: true }).click();
      const first = (await d.getByRole("alert").textContent()).trim();
      await d.getByLabel("Title").fill(t);
      await d.getByRole("button", { name: "Create", exact: true }).click();
      await page.waitForTimeout(300);
      const second = (await d.getByRole("alert").textContent()).trim();
      await d.getByRole("button", { name: "Cancel" }).click();
      await dialog().waitFor({ state: "hidden" });
      const made = await findMatters(page, t);
      expectThat(
        first.includes("Title") && first.includes(fx.fieldRequired.displayName),
        `first ${first}`,
      );
      expectThat(second === `Fill ${fx.fieldRequired.displayName}.`, `second ${second}`);
      expectThat(made.length === 0, "a Matter was created");

      const td = title("department required");
      await openCreate();
      d = dialog();
      await d.getByLabel("Title").fill(td);
      await d.getByLabel("Matter type").selectOption({ label: fx.typeDept.displayName });
      const posts = [];
      const listen = (r) => {
        if (r.request().method() === "POST" && new URL(r.url()).pathname === "/api/v1/matters")
          posts.push(r.status());
      };
      page.on("response", listen);
      await d.getByRole("button", { name: "Create", exact: true }).click();
      await page.waitForTimeout(800);
      const deptBox = d.getByLabel(/^Department\b/);
      const validation = await deptBox.evaluate((el) => el.validationMessage);
      const alertCount = await d.getByRole("alert").count();
      const stillOpen = await d.isVisible();
      const blockedPosts = posts.length;
      const noneYet = (await findMatters(page, td)).length;
      await deptBox.selectOption({ label: "Finance" });
      await d.getByRole("button", { name: "Create", exact: true }).click();
      await page.waitForURL(/\/matters\/\d+$/, { timeout: 20000 });
      page.off("response", listen);
      const n = Number(page.url().match(/\/matters\/(\d+)$/)[1]);
      state.deptRequired = { number: n, title: td };
      const m = (await matterByNumber(page, n)).matter;
      expectThat(
        stillOpen && blockedPosts === 0 && noneYet === 0 && validation.length > 0,
        `required Department: open ${stillOpen} posts ${blockedPosts} made ${noneYet} ${q(validation)}`,
      );
      expectThat(m.department === "Finance", `department ${m.department}`);
      return `On ${q(fx.typeMain.displayName)}: Create with no Title showed ${q(first)}; with the Title filled it showed ${q(second)}; Cancel closed the dialog and no Matter titled ${q(t)} exists. On ${q(fx.typeDept.displayName)}: Create with Department on Choose a Department kept the dialog open, sent ${blockedPosts} create requests and showed the browser's required-field message on Department (${q(validation)}; ${alertCount} alert elements); no Matter existed. Choosing Finance and Create made M-${n} with Department ${q(m.department)}.`;
    },
  );

  await step(
    "Create the Matter: fill the drawn Rows, Entity and person references, Needed by, attach a document with a Document type; an upload failure leaves the dialog open with Retry failed uploads and Continue",
    "The Matter already exists after the failed upload; Retry failed uploads completes it; the new Matter opens with its M- reference, open-category Status, chosen Manager, Department, Priority, Risk, references, a Key date named Needed by and the Document with the chosen type.",
    async () => {
      const t = title("direct");
      const typeName = `DOC-030 matters paper ${stamp} ${short}`;
      const created = await api(admin.page, "POST", "/documents/types/matter", {
        displayName: typeName,
      });
      expectThat(created.status === 201, `fixture Document type ${created.status}`);
      const docTypeId = created.json.documentType.id;
      try {
        await openCreate();
        const d = dialog();
        await d.getByLabel("Title").fill(t);
        await d.getByLabel("Matter type").selectOption({ label: fx.typeMain.displayName });
        await d.getByLabel("Matter Manager").selectOption({ label: "Priya Raman" });
        await d.getByLabel(/^Department\b/).selectOption({ label: "Finance" });
        await d.getByLabel("Priority", { exact: true }).selectOption({ label: "High" });
        await d.getByLabel("Risk", { exact: true }).selectOption({ label: "Low" });
        const neededBy = await pickNeededBy(d);
        await fieldBox(d, fx.fieldRequired).fill("Fictional scope note");
        await fieldBox(d, fx.fieldEntity).selectOption({ label: fx.entity.legalName });
        await fieldBox(d, fx.fieldPerson).selectOption({ label: "Jonas Weber" });
        await d.getByLabel("Description", { exact: true }).fill("DOC-030 fictional description.");
        const docTypeBefore = await d.getByLabel("Document type").count();
        const attachButton = await d.getByRole("button", { name: "Attach documents" }).count();
        const dropHint = await d.getByText("or drag and drop files here").count();
        await d.locator('input[type="file"]').setInputFiles(PDF);
        const typeSelect = d.getByLabel("Document type");
        await typeSelect.waitFor();
        const typeStart = await selectedLabel(typeSelect);
        await typeSelect.selectOption({ label: typeName });
        let blocked = 0;
        const pattern = "**/api/v1/matters/*/documents";
        await page.route(pattern, async (route) => {
          if (route.request().method() === "POST" && blocked === 0) {
            blocked++;
            return route.abort("failed");
          }
          return route.continue();
        });
        await d.getByRole("button", { name: "Create", exact: true }).click();
        await d
          .getByText("Record created. Some documents could not be uploaded.")
          .waitFor({ timeout: 20000 });
        const retry = d.getByRole("button", { name: "Retry failed uploads" });
        const cont = d.getByRole("button", { name: "Continue" });
        expectThat((await retry.isVisible()) && (await cont.isVisible()), "Retry/Continue missing");
        const existing = await findMatters(page, t);
        expectThat(existing.length === 1, `after failure ${existing.length} Matters`);
        await page.unroute(pattern);
        await retry.click();
        await page.waitForURL(new RegExp(`/matters/${existing[0].number}$`), { timeout: 20000 });
        const n = existing[0].number;
        state.direct = { number: n, title: t, neededBy };
        const header = page.getByRole("region", { name: t });
        const ref = await header
          .getByText(`M-${n}`, { exact: true })
          .waitFor()
          .then(
            () => true,
            () => false,
          );
        const m = (await matterByNumber(page, n)).matter;
        const docs = (await api(page, "GET", `/matters/${n}/documents`)).json.documents;
        const kd = (await api(page, "GET", `/matters/${n}/key-dates`)).json.deadlines;
        const needed = kd.filter((x) => x.label === "Needed by");
        const bu = await ctx.session("business_user");
        const buRead = await api(bu.page, "GET", `/portal/matters/${n}`);
        expectThat(ref, "header reference missing");
        expectThat(
          m.statusCategory === "open" && m.priority === "high" && m.risk === "low",
          `values ${m.statusCategory} ${m.priority} ${m.risk}`,
        );
        expectThat(
          m.manager?.displayName === "Priya Raman" && m.department === "Finance",
          "manager/department",
        );
        expectThat(m.customFields[fx.fieldEntity.slug] === fx.entity.id, "entity reference");
        expectThat(docs.length === 1, `documents ${docs.length}`);
        const docType = docs[0].versions?.[0]?.documentType?.displayName ?? null;
        expectThat(docType === typeName, `document type ${q(docs[0].versions?.[0])}`);
        expectThat(needed.length === 1 && needed[0].date === neededBy, `Needed by ${q(kd)}`);
        expectThat(docTypeBefore === 0 && typeStart === "No type", `${docTypeBefore} ${typeStart}`);
        return `Dialog had Attach documents (${attachButton}) and "or drag and drop files here" (${dropHint}); no Document type control before a file was staged (${docTypeBefore}). Fixture: the Administrator API added the Matter Document type ${q(typeName)} for this step. After staging the PDF, Document type started on ${q(typeStart)} and ${q(typeName)} was chosen. With the first upload request failed by the reviewer's browser route (a network stand-in), the dialog read "Record created. Some documents could not be uploaded." with Retry failed uploads and Continue, and ${q(t)} already existed as M-${n}. Retry failed uploads opened /matters/${n}: header M-${n}, Status ${q(m.statusName)} (category ${m.statusCategory}), Priority ${m.priority}, Risk ${m.risk}, Manager ${m.manager?.displayName}, Department ${m.department}, Entity ${q(fx.entity.legalName)}, person Jonas Weber, ${docs.length} Document typed ${q(docType)}. Key dates: ${needed.length} named "Needed by" on ${needed[0]?.date} (picked ${neededBy}). Jonas Weber, named only in the person Field, got ${buRead.status} reading the Matter in the Portal.`;
      } finally {
        await page.unroute("**/api/v1/matters/*/documents").catch(() => {});
        const archived = await api(
          admin.page,
          "POST",
          `/documents/types/matter/${docTypeId}/archive`,
          {},
        );
        state.docTypeArchive = archived.status;
      }
    },
  );

  await step(
    "Use a template: choose, change and remove templates in the dialog",
    "A template prefills title, Priority, Risk and Fields and states its Task and Key date counts; changing or removing it resets Priority, Risk and every Field value (typed Field values replaced); a typed title survives unless it still matches the previous prefix.",
    async () => {
      await openCreate();
      const d = dialog();
      const tpl = d.getByLabel("Matter template");
      const read = async () => ({
        title: await d.getByLabel("Title").inputValue(),
        priority: await selectedLabel(d.getByLabel("Priority", { exact: true })),
        risk: await selectedLabel(d.getByLabel("Risk", { exact: true })),
        required: await fieldBox(d, fx.fieldRequired).inputValue(),
        optional: await fieldBox(d, fx.fieldOptional).inputValue(),
        hint: (await d.getByText(/^Template adds/).count())
          ? (await d.getByText(/^Template adds/).textContent()).trim()
          : null,
      });
      await d.getByLabel("Matter type").selectOption({ label: fx.typeMain.displayName });
      await tpl.selectOption({ label: fx.templateAlpha.name });
      const alpha = await read();
      expectThat(
        alpha.title === fx.templateAlpha.titlePrefix &&
          alpha.priority === "High" &&
          alpha.risk === "Critical",
        q(alpha),
      );
      expectThat(
        alpha.required === "Alpha required default" && alpha.optional === "Alpha optional default",
        q(alpha),
      );
      expectThat(alpha.hint === "Template adds 2 tasks and 2 key dates.", q(alpha));
      await fieldBox(d, fx.fieldOptional).fill("Typed optional value");
      await tpl.selectOption({ label: fx.templateBeta.name });
      const beta = await read();
      expectThat(
        beta.title === fx.templateBeta.titlePrefix &&
          beta.priority === "Low" &&
          beta.risk === "Low",
        q(beta),
      );
      expectThat(beta.optional === "Beta optional default" && beta.required === "", q(beta));
      const typed = title("template typed");
      await d.getByLabel("Title").fill(typed);
      await tpl.selectOption({ label: "No template" });
      const none = await read();
      expectThat(none.title === typed && none.priority === "Medium", q(none));
      expectThat(
        none.optional === "" && none.required === "" && none.hint === null && none.risk === "Not set",
        q(none),
      );
      await tpl.selectOption({ label: fx.templateAlpha.name });
      const again = await read();
      expectThat(again.title === typed && again.required === "Alpha required default", q(again));
      await d.getByRole("button", { name: "Cancel" }).click();
      return `Alpha: ${q(alpha)}. After typing "Typed optional value" and choosing beta: ${q(beta)}. After typing a title and choosing No template: ${q(none)} (the dialog's empty Risk choice reads "Not set"). Choosing alpha again: ${q(again)}.`;
    },
  );

  await step(
    "Use a template: clear a prefilled optional Field, create, then check Overview, Tasks, Key dates, Status and team",
    "The cleared optional Field stays empty; defaults are saved; Tasks and Key dates are copied at UTC offsets from the creation date; the Manager-targeted Task goes to the chosen Manager or stays unassigned without one; the template sets no Status and no team.",
    async () => {
      const t = title("from template");
      await openCreate();
      const d = dialog();
      await d.getByLabel("Title").fill(t);
      await d.getByLabel("Matter type").selectOption({ label: fx.typeMain.displayName });
      await d.getByLabel("Matter template").selectOption({ label: fx.templateAlpha.name });
      const prefilledTitle = await d.getByLabel("Title").inputValue();
      await fieldBox(d, fx.fieldOptional).fill("");
      if (role === "legal_team_member")
        await d.getByLabel("Matter Manager").selectOption({ label: "Unassigned" });
      await d.getByRole("button", { name: "Create", exact: true }).click();
      await page.waitForURL(/\/matters\/\d+$/, { timeout: 20000 });
      const n = Number(page.url().match(/\/matters\/(\d+)$/)[1]);
      state.template = { number: n, title: t };
      const record = await matterByNumber(page, n);
      const m = record.matter;
      const optionalValue = m.customFields[fx.fieldOptional.slug];
      const main = page.getByRole("main");
      await main.getByRole("combobox", { name: "Region" }).waitFor();
      await page.waitForLoadState("networkidle");
      const overviewOptional = await fieldBox(main, fx.fieldOptional).inputValue();
      const overviewPriority = await selectedLabel(
        main.getByRole("combobox", { name: "Priority" }),
      ).catch(() => null);
      const overviewRisk = await selectedLabel(main.getByRole("combobox", { name: "Risk" })).catch(
        () => null,
      );
      const expectedManager = role === "administrator" ? account.name : null;
      await page.getByRole("link", { name: /^Tasks/ }).click();
      await page.waitForURL(/\/tasks$/);
      const tasksRegion = page.getByRole("region", { name: "Tasks" });
      await tasksRegion.getByText("DOC-030 alpha evidence review").waitFor();
      const assigneeButton = await tasksRegion
        .getByRole("button", { name: /^Change assignee for DOC-030 alpha evidence review/ })
        .getAttribute("aria-label");
      const tasks = (await api(page, "GET", `/matters/${n}/tasks`)).json.tasks;
      const review = tasks.find((x) => x.title === "DOC-030 alpha evidence review");
      const discussion = tasks.find((x) => x.title === "DOC-030 alpha discussion");
      const created = m.createdAt;
      await page.getByRole("link", { name: /^Key dates/ }).click();
      await page.waitForURL(/\/key-dates$/);
      const kd = page.getByRole("region", { name: "Key dates" });
      await kd.getByText("DOC-030 alpha filing").waitFor();
      const dates = (await api(page, "GET", `/matters/${n}/key-dates`)).json.deadlines;
      const kick = dates.find((x) => x.label === "DOC-030 alpha kickoff");
      const filing = dates.find((x) => x.label === "DOC-030 alpha filing");
      const team = record.team.map((p) => p.displayName);
      expectThat(
        optionalValue === undefined || optionalValue === null,
        `optional saved as ${q(optionalValue)}`,
      );
      expectThat(
        m.customFields[fx.fieldRequired.slug] === "Alpha required default",
        "required default",
      );
      expectThat(
        m.priority === "high" && m.risk === "critical" && m.statusCategory === "open",
        "defaults/status",
      );
      expectThat(overviewOptional === "", `Overview optional ${overviewOptional}`);
      expectThat(review.dueDate === utcDatePlus(created, 3), `review due ${review.dueDate}`);
      expectThat(discussion && discussion.dueDate === null, "discussion date");
      expectThat(
        (review.assigneeName ?? null) === expectedManager,
        `assignee ${review.assigneeName}`,
      );
      expectThat(
        kick.date === utcDatePlus(created, 0) && filing.date === utcDatePlus(created, 7),
        q(dates),
      );
      expectThat(prefilledTitle === t, `title became ${prefilledTitle}`);
      return `The typed title ${q(t)} stayed after choosing alpha (the field read ${q(prefilledTitle)}). The prefilled optional Field was cleared${role === "legal_team_member" ? " and Matter Manager set to Unassigned" : ""}; M-${n} was created ${created} with Status ${q(m.statusName)}, Priority ${m.priority} (Overview ${q(overviewPriority)}), Risk ${m.risk} (Overview ${q(overviewRisk)}), required ${q(m.customFields[fx.fieldRequired.slug])}, optional ${q(optionalValue ?? null)}; Overview shows the optional Field empty. Tasks tab: "DOC-030 alpha evidence review" due ${review.dueDate} (+3 UTC days), ${q(assigneeButton)}; "DOC-030 alpha discussion" undated. Key dates tab: kickoff ${kick.date} (+0) and filing ${filing.date} (+7). Team: ${q(team)}.`;
    },
  );

  await step(
    "Create the Matter / Use a template: Rows the dialog does not draw; template defaults for them are saved, and without a template Priority is Medium and Risk Not assessed",
    "On a type whose Form collects only Description, the dialog draws no Priority or Risk; a template's Priority and Risk defaults are still saved and show on Overview; a Matter made without a template shows Priority Medium and Risk Not assessed.",
    async () => {
      const t = title("undrawn defaults");
      await openCreate();
      const d = dialog();
      await d.getByLabel("Title").fill(t);
      await d.getByLabel("Matter type").selectOption({ label: fx.typeRetype.displayName });
      await d.getByLabel("Matter template").selectOption({ label: fx.templateUndrawn.name });
      const rows = await drawnBuiltins(d);
      const req = await fieldBox(d, fx.fieldRequired).inputValue();
      await fieldBox(d, fx.fieldNumber).fill("7");
      await d.getByRole("button", { name: "Create", exact: true }).click();
      await page.waitForURL(/\/matters\/\d+$/, { timeout: 20000 });
      const n = Number(page.url().match(/\/matters\/(\d+)$/)[1]);
      const main = page.getByRole("main");
      await main.getByRole("combobox", { name: "Priority" }).waitFor();
      const shownPriority = await selectedLabel(main.getByRole("combobox", { name: "Priority" }));
      const shownRisk = await selectedLabel(main.getByRole("combobox", { name: "Risk" }));
      const m = (await matterByNumber(page, n)).matter;
      const { number: dn } = state.deptRequired;
      await page.goto(`${BASE}/matters/${dn}`);
      await main.getByRole("combobox", { name: "Priority" }).waitFor();
      const plainPriority = await selectedLabel(main.getByRole("combobox", { name: "Priority" }));
      const plainRisk = await selectedLabel(main.getByRole("combobox", { name: "Risk" }));
      const dm = (await matterByNumber(page, dn)).matter;
      expectThat(q(rows) === q(["Description"]), `rows ${q(rows)}`);
      expectThat(
        m.priority === "high" && m.risk === "low" && shownPriority === "High" && shownRisk === "Low",
        `${m.priority} ${m.risk} ${shownPriority} ${shownRisk}`,
      );
      expectThat(
        dm.priority === "medium" &&
          dm.risk === null &&
          plainPriority === "Medium" &&
          plainRisk === "Not assessed",
        `${dm.priority} ${dm.risk} ${plainPriority} ${plainRisk}`,
      );
      return `On ${q(fx.typeRetype.displayName)} with ${q(fx.templateUndrawn.name)} (Priority High, Risk Low) the dialog drew built-in Rows ${q(rows)} and prefilled the required note ${q(req)}. M-${n} saved Priority ${m.priority}, Risk ${m.risk}; Overview shows Priority ${q(shownPriority)} and Risk ${q(shownRisk)}. M-${dn}, made without a template on ${q(fx.typeDept.displayName)} (Priority and Risk not drawn), shows Priority ${q(plainPriority)} and Risk ${q(plainRisk)}.`;
    },
  );

  await step(
    "If creation is refused: a template archived after the form opened",
    "Create is refused with a message, no Matter is created, and a reopened form no longer lists the template.",
    async () => {
      const t = title("stale template");
      await openCreate();
      const d = dialog();
      await d.getByLabel("Title").fill(t);
      await d.getByLabel("Matter type").selectOption({ label: fx.typeMain.displayName });
      await d.getByLabel("Matter template").selectOption({ label: fx.templateGamma.name });
      await fieldBox(d, fx.fieldRequired).fill("Stale check");
      const archived = await api(
        admin.page,
        "POST",
        `/matter-templates/${fx.templateGamma.id}/archive`,
      );
      let message;
      let listed;
      try {
        expectThat(archived.status === 200, `fixture archive ${archived.status}`);
        await d.getByRole("button", { name: "Create", exact: true }).click();
        message = (await d.getByRole("alert").textContent({ timeout: 15000 })).trim();
        await d.getByRole("button", { name: "Cancel" }).click();
        await openCreate();
        await dialog().getByLabel("Matter type").selectOption({ label: fx.typeMain.displayName });
        listed = await optionLabels(dialog().getByLabel("Matter template"));
        await dialog().getByRole("button", { name: "Cancel" }).click();
      } finally {
        await api(admin.page, "POST", `/matter-templates/${fx.templateGamma.id}/restore`);
      }
      const made = await findMatters(page, t);
      expectThat(made.length === 0, "a Matter was created");
      expectThat(!listed.includes(fx.templateGamma.name), `still listed ${listed}`);
      return `Fixture: the Administrator API archived ${q(fx.templateGamma.name)} after the form had it selected. Create showed ${q(message)} and created nothing. A reopened form listed ${q(listed)}. The fixture template was restored afterwards.`;
    },
  );

  await step(
    "Set responsibility and maintain the record: Overview Row order, Region, Needed by, owners, Priority and rename",
    "The Matter section starts with Title; Form Rows follow in Form order (Matter type, built-in Rows, attached Fields) with no separate custom-field section; Matter Manager and Business Owner come after the Rows; Region saves and No Region clears it; the Needed by Row edits the Needed by Key date; both owner controls search people and show an avatar; renaming keeps the M- reference.",
    async () => {
      const { number: n, title: t } = state.direct;
      await page.goto(`${BASE}/matters/${n}`);
      const main = page.getByRole("main");
      await main.getByRole("combobox", { name: "Region" }).waitFor();
      const controls = [
        ["Title", main.getByRole("textbox", { name: "Title" })],
        ["Matter type", main.getByRole("combobox", { name: "Matter type" })],
        ["Description", main.getByRole("textbox", { name: "Description" })],
        ["Department", main.getByRole("combobox", { name: "Department" })],
        ["Priority", main.getByRole("combobox", { name: "Priority" })],
        ["Risk", main.getByRole("combobox", { name: "Risk" })],
        ["Needed by", main.getByLabel("Needed by", { exact: true })],
        ["Region", main.getByRole("combobox", { name: "Region" })],
        [fx.fieldRequired.displayName, fieldBox(main, fx.fieldRequired)],
        [fx.fieldOptional.displayName, fieldBox(main, fx.fieldOptional)],
        [fx.fieldEntity.displayName, fieldBox(main, fx.fieldEntity)],
        [fx.fieldPerson.displayName, fieldBox(main, fx.fieldPerson)],
        ["Matter Manager", main.getByRole("button", { name: "Matter Manager" })],
        ["Business Owner", main.getByRole("button", { name: "Business Owner" })],
      ];
      const handles = [];
      for (const [name, loc] of controls) handles.push([name, await loc.first().elementHandle()]);
      const order = await page.evaluate(
        (els) =>
          els
            .map((e, i) => ({ e, i }))
            .sort((a, b) =>
              a.e.compareDocumentPosition(b.e) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1,
            )
            .map((x) => x.i),
        handles.map((h) => h[1]),
      );
      const domOrder = order.map((i) => controls[i][0]);
      const headings = await main.getByRole("heading", { level: 2 }).allInnerTexts();
      expectThat(q(domOrder) === q(controls.map((c) => c[0])), `order ${q(domOrder)}`);
      const s1 = await patchAfter(page, n, () =>
        main.getByRole("combobox", { name: "Region" }).selectOption({ label: "EMEA" }),
      );
      const r1 = (await matterByNumber(page, n)).matter.region;
      const s2 = await patchAfter(page, n, () =>
        main.getByRole("combobox", { name: "Region" }).selectOption({ label: "No Region" }),
      );
      const r2 = (await matterByNumber(page, n)).matter.region;
      expectThat(s1 === 200 && r1 === "EMEA" && s2 === 200 && r2 === null, `region ${r1} ${r2}`);
      const needed = main.getByLabel("Needed by", { exact: true });
      const neededBefore = await needed.inputValue();
      const newDate = utcDatePlus(new Date().toISOString(), 40);
      const wait = page.waitForResponse(
        (r) => /key-dates/.test(new URL(r.url()).pathname) && r.request().method() !== "GET",
      );
      await needed.fill(newDate);
      await needed.press("Enter");
      const neededStatus = (await wait).status();
      await page.waitForTimeout(500);
      const kd = (await api(page, "GET", `/matters/${n}/key-dates`)).json.deadlines.filter(
        (x) => x.label === "Needed by",
      );
      expectThat(
        neededBefore === state.direct.neededBy && kd.length === 1 && kd[0].date === newDate,
        `Needed by ${neededBefore} -> ${q(kd)}`,
      );
      await main.getByRole("button", { name: "Business Owner" }).click();
      const picker = page.getByRole("dialog", { name: "Business Owner" });
      await picker.getByRole("textbox", { name: "Search people" }).fill("Jonas");
      const s3 = await patchAfter(page, n, () =>
        picker.getByRole("button", { name: "Jonas Weber" }).click(),
      );
      await page.waitForTimeout(500);
      const ownerButton = main.getByRole("button", { name: "Business Owner" });
      const ownerText = (await ownerButton.innerText()).replace(/\s+/g, " ").trim();
      const avatar = await ownerButton
        .locator("img, [data-slot='avatar'], span[aria-hidden='true']")
        .count();
      await main.getByRole("button", { name: "Matter Manager" }).click();
      const mPicker = page.getByRole("dialog", { name: "Matter Manager" });
      const managerSearch = await mPicker
        .getByRole("textbox", { name: "Search people" })
        .isVisible();
      const managerChoices = await mPicker.getByRole("button").allInnerTexts();
      await page.keyboard.press("Escape");
      const managerText = (await main.getByRole("button", { name: "Matter Manager" }).innerText())
        .replace(/\s+/g, " ")
        .trim();
      const managerAvatar = await main
        .getByRole("button", { name: "Matter Manager" })
        .locator("img, [data-slot='avatar'], span[aria-hidden='true']")
        .count();
      expectThat(
        s3 === 200 && ownerText.includes("Jonas Weber") && avatar > 0 && managerAvatar > 0,
        `owner ${ownerText} avatar ${avatar}/${managerAvatar}`,
      );
      expectThat(
        managerSearch && !managerChoices.some((c) => c.includes("Jonas Weber")),
        `manager picker ${q(managerChoices)}`,
      );
      const s4 = await patchAfter(page, n, () =>
        main.getByRole("combobox", { name: "Priority" }).selectOption({ label: "Critical" }),
      );
      const renamed = `${t} renamed`;
      const s5 = await patchAfter(page, n, async () => {
        await main.getByRole("textbox", { name: "Title" }).fill(renamed);
        await main.getByRole("textbox", { name: "Title" }).press("Enter");
      });
      await page.waitForTimeout(500);
      const after = (await matterByNumber(page, n)).matter;
      state.direct.title = renamed;
      const header = page.getByRole("region", { name: renamed });
      const ref = await header.getByText(`M-${n}`, { exact: true }).isVisible();
      expectThat(
        s4 === 200 && after.priority === "critical" && s5 === 200 && after.number === n && ref,
        "priority/rename",
      );
      return `Overview controls in document order: ${q(domOrder)}; section headings ${q(headings)} (no separate custom-field section). Region EMEA saved (${s1}, ${q(r1)}); No Region cleared it (${s2}, ${q(r2)}). The Needed by Row showed ${neededBefore}; entering ${newDate} saved (${neededStatus}) and the one Key date named Needed by now reads ${kd[0].date}. Business Owner picker searched "Jonas" and saved Jonas Weber (${s3}); the control reads ${q(ownerText)} with ${avatar} avatar element(s). Matter Manager reads ${q(managerText)} with ${managerAvatar} avatar element(s); its picker has Search people and offers only eligible legal people (${managerChoices.length} buttons, no Jonas Weber). Priority Critical saved (${s4}). Rename saved (${s5}); the header still shows M-${n}.`;
    },
  );

  await step(
    "Set responsibility: a required value cannot be cleared; Change matter type to asks for the new type's required Fields; detached values are retained but hidden",
    "Clearing the required Field is refused and the value stays; the Change matter type to dialog Cancel keeps the type and Change type saves; switching back keeps the detached value stored but not shown.",
    async () => {
      const { number: n } = state.direct;
      await page.goto(`${BASE}/matters/${n}`);
      const main = page.getByRole("main");
      const requiredBox = main.getByRole("textbox", {
        name: `${fx.fieldRequired.displayName} (required)`,
      });
      await requiredBox.fill("");
      await requiredBox.blur();
      await page.waitForTimeout(1200);
      const message = (await main.getByText(/required|requires/i).allInnerTexts())
        .filter((x) => !x.endsWith("(required)"))
        .join(" | ");
      const kept = (await matterByNumber(page, n)).matter.customFields[fx.fieldRequired.slug];
      expectThat(kept === "Fictional scope note", `required now ${q(kept)}`);
      await page.reload();
      await main
        .getByRole("combobox", { name: "Matter type" })
        .selectOption({ label: fx.typeRetype.displayName });
      const change = page.getByRole("dialog", {
        name: `Change matter type to ${fx.typeRetype.displayName}`,
      });
      await change.waitFor();
      const changeText = (await change.innerText()).replace(/\s+/g, " ").slice(0, 220);
      await change.getByRole("button", { name: "Cancel" }).click();
      await page.waitForTimeout(500);
      const stillType = (await matterByNumber(page, n)).matter.matterTypeName;
      expectThat(stillType === fx.typeMain.displayName, `type after Cancel ${stillType}`);
      await page.reload();
      await main
        .getByRole("combobox", { name: "Matter type" })
        .selectOption({ label: fx.typeRetype.displayName });
      await change.waitFor();
      await change.getByRole("spinbutton").or(change.getByRole("textbox")).first().fill("42");
      const s1 = await patchAfter(page, n, () =>
        change.getByRole("button", { name: "Change type" }).click(),
      );
      const retyped = (await matterByNumber(page, n)).matter;
      expectThat(
        s1 === 200 &&
          retyped.matterTypeName === fx.typeRetype.displayName &&
          retyped.customFields[fx.fieldNumber.slug] === 42,
        q(retyped.customFields),
      );
      await page.reload();
      const s2 = await patchAfter(page, n, () =>
        main
          .getByRole("combobox", { name: "Matter type" })
          .selectOption({ label: fx.typeMain.displayName }),
      );
      await page.waitForTimeout(500);
      const back = (await matterByNumber(page, n)).matter;
      await page.reload();
      await main.getByRole("combobox", { name: "Matter type" }).waitFor();
      const shown = await main.getByText(fx.fieldNumber.displayName).count();
      expectThat(
        s2 === 200 &&
          back.matterTypeName === fx.typeMain.displayName &&
          back.customFields[fx.fieldNumber.slug] === 42 &&
          shown === 0,
        `back ${q(back.customFields)} shown ${shown}`,
      );
      return `Clearing the required Field showed ${q(message)}; the stored value stayed ${q(kept)}. Choosing ${q(fx.typeRetype.displayName)} opened ${q(changeText)}; Cancel kept ${q(stillType)}. Entering 42 and Change type saved (${s1}) with the number stored. Switching back to ${q(fx.typeMain.displayName)} saved (${s2}) with no dialog; the record still stores ${fx.fieldNumber.slug}=42 and Overview shows no ${q(fx.fieldNumber.displayName)} control.`;
    },
  );

  await step(
    "Set responsibility: Matter team roster, Add team member, and the Business Owner membership",
    "The roster has one row per person with Matter Manager, Business Owner and Creator statements; assigning the Business Owner added them to the team and their row has no remove control; Add team member > Person > Add adds a row; after clearing the Business Owner, the former owner stays on the team and can be removed.",
    async () => {
      const { number: n } = state.direct;
      await page.goto(`${BASE}/matters/${n}`);
      await page
        .getByRole("toolbar", { name: "Applets" })
        .getByRole("button", { name: "Matter team" })
        .click();
      const panel = page.getByRole("complementary", { name: "Matter team" });
      await panel.waitFor();
      await panel.getByRole("listitem").first().waitFor();
      const rows = async () =>
        (await panel.getByRole("listitem").allInnerTexts()).map((x) => x.replace(/\s+/g, " ").trim());
      const rowsBefore = await rows();
      const removeFor = (name) =>
        panel.getByRole("button", { name: `Take ${name} off the matter team` });
      const jonasRemoveWhileOwner = await removeFor("Jonas Weber").count();
      const priyaRemove = await removeFor("Priya Raman").count();
      const bu = await ctx.session("business_user");
      const buRead = (await api(bu.page, "GET", `/portal/matters/${n}`)).status;
      await panel.getByRole("button", { name: "Add team member" }).click();
      const add = page.getByRole("dialog", { name: "Add team member" });
      await add.getByLabel("Person").selectOption({ label: "Tom Iwu" });
      await add.getByRole("button", { name: "Add", exact: true }).click();
      await add.waitFor({ state: "hidden" });
      await panel.getByText("Tom Iwu").waitFor();
      const rowsAfter = await rows();
      const main = page.getByRole("main");
      await main.getByRole("button", { name: "Business Owner" }).click();
      const picker = page.getByRole("dialog", { name: "Business Owner" });
      const s = await patchAfter(page, n, () =>
        picker.getByRole("button", { name: "Unassigned" }).click(),
      );
      await page.reload();
      await page
        .getByRole("toolbar", { name: "Applets" })
        .getByRole("button", { name: "Matter team" })
        .click();
      await panel.getByRole("listitem").first().waitFor();
      const rowsCleared = await rows();
      const jonasRemoveAfter = await removeFor("Jonas Weber").count();
      const jonasRows = rowsAfter.filter((r) => r.includes("Jonas Weber")).length;
      const priyaRows = rowsAfter.filter((r) => r.includes("Priya Raman")).length;
      expectThat(
        rowsBefore.some((r) => r.includes("Priya Raman") && r.includes("Matter Manager")),
        q(rowsBefore),
      );
      expectThat(
        rowsBefore.some((r) => r.includes(account.name) && r.includes("Creator")),
        q(rowsBefore),
      );
      expectThat(
        rowsBefore.some((r) => r.includes("Jonas Weber") && r.includes("Business Owner")) &&
          jonasRemoveWhileOwner === 0 &&
          buRead === 200,
        `owner row ${q(rowsBefore)} remove ${jonasRemoveWhileOwner} read ${buRead}`,
      );
      expectThat(
        rowsAfter.some((r) => r.includes("Tom Iwu")) && jonasRows === 1 && priyaRows === 1,
        q(rowsAfter),
      );
      expectThat(
        s === 200 &&
          rowsCleared.some((r) => r.includes("Jonas Weber") && !r.includes("Business Owner")) &&
          jonasRemoveAfter === 1,
        `${s} ${q(rowsCleared)} ${jonasRemoveAfter}`,
      );
      return `Roster after naming Jonas Weber Business Owner on Overview: ${q(rowsBefore)}. Jonas Weber's row had ${jonasRemoveWhileOwner} remove controls (Priya Raman's had ${priyaRemove}); his Portal read answered ${buRead}. Add team member > Person Tom Iwu > Add gave ${q(rowsAfter)} (one row each for Priya Raman and Jonas Weber). Clearing Business Owner to Unassigned saved (${s}); roster ${q(rowsCleared)}; Jonas Weber stays with ${jonasRemoveAfter} remove control.`;
    },
  );

  await step(
    "Set responsibility: Confidential audience control, Matter Manager and Business Owner changes",
    "On a Confidential Matter, a Legal Team Member added to the team can read and edit details but cannot change the team, the Matter Manager or the Business Owner, or the flag; the Administrator, Matter Manager or Creator can.",
    async () => {
      const priya = await ctx.session("priya");
      const t = title("confidential");
      const created = await api(page, "POST", "/matters", {
        title: t,
        matterTypeId: fx.typeMain.id,
        managerId: null,
        customFields: { [fx.fieldRequired.slug]: "Confidential fixture" },
        isConfidential: true,
      });
      expectThat(created.status === 201, `fixture ${created.status}`);
      const n = created.json.matter.number;
      const before = (await api(priya.page, "GET", `/matters/${n}`)).status;
      await page.goto(`${BASE}/matters/${n}`);
      await page
        .getByRole("toolbar", { name: "Applets" })
        .getByRole("button", { name: "Matter team" })
        .click();
      const panel = page.getByRole("complementary", { name: "Matter team" });
      await panel.getByRole("button", { name: "Add team member" }).click();
      const add = page.getByRole("dialog", { name: "Add team member" });
      await add.getByLabel("Person").selectOption({ label: "Priya Raman" });
      await add.getByRole("button", { name: "Add", exact: true }).click();
      await add.waitFor({ state: "hidden" });
      const read = (await api(priya.page, "GET", `/matters/${n}`)).status;
      const edit = (
        await api(priya.page, "PATCH", `/matters/${n}`, { description: "Priya fictional edit." })
      ).status;
      await priya.page.goto(`${BASE}/matters/${n}`);
      const pMain = priya.page.getByRole("main");
      await pMain.getByRole("button", { name: "Matter Manager" }).waitFor();
      await priya.page
        .getByRole("toolbar", { name: "Applets" })
        .getByRole("button", { name: "Matter team" })
        .click();
      const pPanel = priya.page.getByRole("complementary", { name: "Matter team" });
      await pPanel.waitFor();
      const addButton = pPanel.getByRole("button", { name: "Add team member" });
      const addState =
        (await addButton.count()) === 0
          ? "absent"
          : (await addButton.isDisabled())
            ? "disabled"
            : "enabled";
      const switchState = await priya.page
        .getByRole("switch", { name: /^Confidential/ })
        .isDisabled()
        .catch(() => "absent");
      const users = (await api(page, "GET", "/matters/options")).json.users;
      const uid = (name) => users.find((u) => u.displayName === name).id;
      let managerUi = "not tried";
      try {
        await pMain.getByRole("button", { name: "Matter Manager" }).click({ timeout: 3000 });
        const mp = priya.page.getByRole("dialog", { name: "Matter Manager" });
        await mp.waitFor({ timeout: 3000 });
        const wait = priya.page.waitForResponse(
          (r) =>
            r.request().method() === "PATCH" &&
            new URL(r.url()).pathname === `/api/v1/matters/${n}`,
          { timeout: 8000 },
        );
        await mp.getByRole("textbox", { name: "Search people" }).fill("Priya");
        await mp.getByRole("button", { name: "Priya Raman" }).click();
        const res = await wait;
        await priya.page.waitForTimeout(600);
        const note = (await pMain.getByText(/could not|cannot|only|not allowed/i).allInnerTexts())
          .join(" | ")
          .slice(0, 200);
        managerUi = `picker opened; PATCH ${res.status()}; message ${q(note)}`;
      } catch (e) {
        managerUi = `picker not usable: ${String(e.message).split("\n")[0]}`;
      }
      const teamWrite = (await api(priya.page, "POST", `/matters/${n}/team`, { userId: uid("Tom Iwu") }))
        .status;
      const flagWrite = (await api(priya.page, "PATCH", `/matters/${n}`, { isConfidential: false }))
        .status;
      const managerWrite = (
        await api(priya.page, "PATCH", `/matters/${n}`, { managerId: uid("Priya Raman") })
      ).status;
      const ownerWrite = (
        await api(priya.page, "PATCH", `/matters/${n}`, { businessOwnerId: uid("Jonas Weber") })
      ).status;
      const after = (await matterByNumber(page, n)).matter;
      const actorFlag = (await api(page, "PATCH", `/matters/${n}`, { isConfidential: true })).status;
      const actorManager = (
        await api(page, "PATCH", `/matters/${n}`, { managerId: uid("Priya Raman") })
      ).status;
      expectThat(before === 404 && read === 200 && edit === 200, `${before} ${read} ${edit}`);
      expectThat(
        addState !== "enabled" &&
          teamWrite === 403 &&
          flagWrite === 403 &&
          managerWrite === 403 &&
          ownerWrite === 403 &&
          after.manager === null &&
          !after.businessOwner,
        `${addState} ${teamWrite} ${flagWrite} ${managerWrite} ${ownerWrite} ${q(after.manager)}`,
      );
      expectThat(actorFlag === 200 && actorManager === 200, `${actorFlag} ${actorManager}`);
      return `Fixture Confidential M-${n} created by ${account.name} with no Manager. Priya Raman (Legal Team Member, not on the team) read it: ${before}. After Add team member > Priya Raman, her read ${read}, Description edit ${edit}; in her browser Add team member was ${addState} and the Confidential switch disabled=${switchState}; choosing herself in her Matter Manager control: ${managerUi}. Her direct writes: team ${teamWrite}, flag ${flagWrite}, Matter Manager ${managerWrite}, Business Owner ${ownerWrite}; the Matter still has Manager ${q(after.manager)} and Business Owner ${q(after.businessOwner ?? null)}. The ${role === "administrator" ? "Administrator" : "Creator"} flag write answered ${actorFlag} and Matter Manager change ${actorManager}.`;
    },
  );

  await step(
    "Set responsibility: link a Contract with a Counterparty and open History",
    "Linking a Contract does not copy its Fields, team or Documents onto the Matter, and its Counterparty stays on the Contract; History lists the recorded changes.",
    async () => {
      const { number: n } = state.direct;
      const opts = (await api(page, "GET", "/contracts/options")).json;
      const nda = opts.contractTypes.find((c) => c.displayName === "NDA");
      const ct = title("linked contract");
      const c = await api(page, "POST", "/contracts", { title: ct, contractTypeId: nda.id });
      expectThat(c.status === 201, `contract fixture ${c.status}`);
      const cn = c.json.contract.number;
      const cps = (await api(page, "GET", "/counterparties")).json.counterparties;
      const cp = cps.find((x) => x.name === "Northwind Traders Ltd") ?? cps[0];
      const addCp = await api(page, "POST", `/contracts/${cn}/counterparties`, {
        counterpartyId: cp.id,
      });
      expectThat(addCp.status < 300, `counterparty ${addCp.status}`);
      const before = await matterByNumber(page, n);
      const docsBefore = (await api(page, "GET", `/matters/${n}/documents`)).json.documents.length;
      await page.goto(`${BASE}/matters/${n}`);
      await page.getByRole("button", { name: "Link Contract" }).click();
      const link = page.getByRole("dialog", { name: "Link Contract" });
      await link.getByRole("textbox").fill(String(cn));
      await link.getByText(ct).first().click();
      await link.getByRole("button", { name: "Link", exact: true }).click();
      await link.waitFor({ state: "hidden" });
      await page.getByRole("link", { name: new RegExp(`C-${cn}`) }).waitFor();
      const after = await matterByNumber(page, n);
      const docsAfter = (await api(page, "GET", `/matters/${n}/documents`)).json.documents.length;
      const contract = (await api(page, "GET", `/contracts/${cn}`)).json.contract;
      await page
        .getByRole("toolbar", { name: "Applets" })
        .getByRole("button", { name: "History" })
        .click();
      const history = page.getByRole("complementary", { name: "History" });
      await history.getByRole("listitem").first().waitFor();
      const entries = (await history.getByRole("listitem").allInnerTexts()).map((x) =>
        x.replace(/\s+/g, " ").trim(),
      );
      expectThat(
        q(after.team) === q(before.team) &&
          q(after.matter.customFields) === q(before.matter.customFields) &&
          docsAfter === docsBefore,
        "matter changed by link",
      );
      expectThat(contract.primaryCounterparty?.name === cp.name, "counterparty moved");
      expectThat(entries.length >= 5, `history ${entries.length}`);
      return `Fixture NDA C-${cn} with Counterparty ${q(cp.name)} linked through Link Contract > search > Link. The Matter's team (${after.team.length} people), Field values and Documents (${docsAfter}) were unchanged, and the Counterparty is still ${q(contract.primaryCounterparty?.name)} on the Contract. History shows ${entries.length} entries, first ones: ${q(entries.slice(0, 6))}.`;
    },
  );

  await step(
    "Create the Matter: switch Confidential — restrict to the matter team on, then Continue after a failed upload",
    "The Confidential — restrict to the matter team switch saves the flag; Continue leaves the failed file behind and opens the Matter that already exists.",
    async () => {
      const t = title("confidential continue");
      await openCreate();
      const d = dialog();
      await d.getByLabel("Title").fill(t);
      await d.getByLabel("Matter type").selectOption({ label: fx.typeMain.displayName });
      await fieldBox(d, fx.fieldRequired).fill("Continue check");
      const sw = d.getByRole("switch", { name: "Confidential — restrict to the matter team" });
      await sw.click();
      const on = await sw.getAttribute("aria-checked");
      await d.locator('input[type="file"]').setInputFiles(PDF);
      const typeControl = await d.getByLabel("Document type").count();
      const pattern = "**/api/v1/matters/*/documents";
      await page.route(pattern, (route) =>
        route.request().method() === "POST" ? route.abort("failed") : route.continue(),
      );
      await d.getByRole("button", { name: "Create", exact: true }).click();
      await d.getByRole("button", { name: "Continue" }).waitFor({ timeout: 20000 });
      await d.getByRole("button", { name: "Continue" }).click();
      await page.waitForURL(/\/matters\/\d+$/, { timeout: 20000 });
      await page.unroute(pattern);
      const n = Number(page.url().match(/\/matters\/(\d+)$/)[1]);
      const m = (await matterByNumber(page, n)).matter;
      const docs = (await api(page, "GET", `/matters/${n}/documents`)).json.documents.length;
      expectThat(
        on === "true" && m.title === t && m.isConfidential === true && docs === 0,
        `${on} ${m.title} ${m.isConfidential} ${docs}`,
      );
      return `The switch named "Confidential — restrict to the matter team" read aria-checked ${on} before Create. With no Matter Document types live, staging a file showed ${typeControl} Document type controls. With every upload failed by the reviewer's route, Continue closed the dialog and opened M-${n} ${q(t)}: Confidential ${m.isConfidential}, ${docs} Documents.`;
    },
  );

  await step(
    "Before you start (negative): a Business User cannot create a Matter",
    "A Business User has no New matter control and a direct create is refused.",
    async () => {
      const bu = await ctx.session("business_user");
      await bu.page.goto(`${BASE}/portal/matters`);
      await bu.page.waitForLoadState("networkidle");
      const button = await bu.page.getByRole("button", { name: "New matter" }).count();
      const direct = await api(bu.page, "POST", "/matters", {
        title: title("business user"),
        matterTypeId: fx.typeMain.id,
        customFields: { [fx.fieldRequired.slug]: "x" },
      });
      await bu.page.goto(`${BASE}/matters`);
      await bu.page.waitForLoadState("networkidle");
      const landed = new URL(bu.page.url()).pathname;
      expectThat(button === 0 && direct.status === 403, `${button} ${direct.status}`);
      return `Jonas Weber's Portal Matters page has ${button} New matter buttons; opening /matters ended at ${landed}; his direct create answered ${direct.status}. Fixture Document type archive from the direct-create step answered ${state.docTypeArchive}.`;
    },
  );
}
