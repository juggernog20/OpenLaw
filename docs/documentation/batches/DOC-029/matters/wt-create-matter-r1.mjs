// V-C22 steps for "Create a Matter and use a template" (create-matter.md).
import path from "node:path";
import { expectThat, q, findMatters, matterByNumber, patchAfter, utcDatePlus } from "./lib-r1.mjs";

export default async function createMatter(ctx) {
  const { role, stamp, fx, BASE, api, step, account, actor, admin } = ctx;
  const page = actor.page;
  const short = role === "administrator" ? "admin" : "legal";
  const title = (label) => `DOC-029 matters ${short} ${label} ${stamp}`;
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

  await step(
    "Before you start / Create the Matter: open Matters, select New matter, and read the starting values",
    "The dialog offers Title, Matter type, Matter Manager (starting with the reader; Unassigned and only Legal Team Members or Administrators), Department with No Department, Priority Medium and Risk Not assessed; Matter template appears after a type and starts on No template.",
    async () => {
      await openCreate();
      const d = dialog();
      const manager = await selectedLabel(d.getByLabel("Matter Manager"));
      const managers = await optionLabels(d.getByLabel("Matter Manager"));
      const department = await selectedLabel(d.getByLabel("Department"));
      const priority = await selectedLabel(d.getByLabel("Priority"));
      const risk = await selectedLabel(d.getByLabel("Risk"));
      const templateBefore = await d.getByLabel("Matter template").count();
      expectThat(manager === account.name, `Manager starts on ${manager}`);
      expectThat(managers[0] === "Unassigned", "no Unassigned option first");
      for (const outsider of ["Jonas Weber", "Ravi Menon"])
        expectThat(!managers.includes(outsider), `${outsider} offered as Manager`);
      expectThat(department === "No Department", `Department ${department}`);
      expectThat(
        priority === "Medium" && risk === "Not assessed",
        `Priority ${priority} Risk ${risk}`,
      );
      expectThat(templateBefore === 0, "Matter template shown before a type");
      await d.getByLabel("Matter type").selectOption({ label: fx.typeMain.displayName });
      const template = await selectedLabel(d.getByLabel("Matter template"));
      const templates = await optionLabels(d.getByLabel("Matter template"));
      expectThat(template === "No template", `template starts on ${template}`);
      const fieldLabels = [];
      for (const f of [fx.fieldRequired, fx.fieldOptional, fx.fieldEntity, fx.fieldPerson])
        if (await fieldBox(d, f).isVisible()) fieldLabels.push(f.displayName);
      expectThat(fieldLabels.length === 4, `type Fields shown: ${fieldLabels}`);
      await d.getByRole("button", { name: "Cancel" }).click();
      await dialog().waitFor({ state: "hidden" });
      return `Create matter dialog opened from Matters > New matter. Matter Manager started on ${q(manager)}; its options were ${q(managers)} (no Business Users). Department ${q(department)}, Priority ${q(priority)}, Risk ${q(risk)}. No Matter template control before a type; after choosing ${q(fx.typeMain.displayName)} it showed ${q(template)} selected with options ${q(templates)}, and the four type Fields appeared.`;
    },
  );

  await step(
    "Create the Matter / If creation is refused: missing Title, missing required Field, then Cancel",
    "Create is refused with a message naming the missing values; Cancel closes the dialog without creating a Matter.",
    async () => {
      const t = title("refused");
      await openCreate();
      const d = dialog();
      await d.getByLabel("Matter type").selectOption({ label: fx.typeMain.displayName });
      await d.getByRole("button", { name: "Create", exact: true }).click();
      const first = (await d.getByRole("alert").textContent()).trim();
      await d.getByLabel("Title").fill(t);
      await d.getByRole("button", { name: "Create", exact: true }).click();
      await page.waitForTimeout(300);
      const second = (await d.getByRole("alert").textContent()).trim();
      expectThat(
        first.includes("Title") && first.includes(fx.fieldRequired.displayName),
        `first ${first}`,
      );
      expectThat(second === `Fill ${fx.fieldRequired.displayName}.`, `second ${second}`);
      await d.getByRole("button", { name: "Cancel" }).click();
      await dialog().waitFor({ state: "hidden" });
      const made = await findMatters(page, t);
      expectThat(made.length === 0, "a Matter was created");
      return `Create with no Title showed ${q(first)}. With the Title filled it showed ${q(second)}. Cancel closed the dialog; no Matter titled ${q(t)} exists.`;
    },
  );

  await step(
    "Create the Matter: fill values, Entity and person references, attach a document; an upload failure leaves the dialog open with Retry failed uploads and Continue",
    "The Matter already exists after the failed upload; Retry failed uploads completes it and the new Matter opens with its M- reference, open-Category Status, chosen Manager, Department and references.",
    async () => {
      const t = title("direct");
      await openCreate();
      const d = dialog();
      await d.getByLabel("Title").fill(t);
      await d.getByLabel("Matter type").selectOption({ label: fx.typeMain.displayName });
      await d.getByLabel("Matter Manager").selectOption({ label: "Priya Raman" });
      await d.getByLabel("Department").selectOption({ label: "Finance" });
      await fieldBox(d, fx.fieldRequired).fill("Fictional scope note");
      await fieldBox(d, fx.fieldEntity).selectOption({ label: fx.entity.legalName });
      await fieldBox(d, fx.fieldPerson).selectOption({ label: "Jonas Weber" });
      await d.getByLabel("Description").fill("DOC-029 fictional description.");
      await d
        .locator('input[type="file"]')
        .setInputFiles(path.join(ctx.here, "fixtures/doc029-matters-note.pdf"));
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
      state.direct = { number: n, title: t };
      const header = page.getByRole("region", { name: t });
      const ref = await header
        .getByText(`M-${n}`, { exact: true })
        .waitFor()
        .then(
          () => true,
          () => false,
        );
      const pill = await header
        .getByText("Open", { exact: true })
        .first()
        .waitFor()
        .then(
          () => true,
          () => false,
        );
      const m = (await matterByNumber(page, n)).matter;
      expectThat(ref && pill, "header reference or Status pill missing");
      expectThat(
        m.statusCategory === "open" && m.priority === "medium" && m.risk === null,
        "values",
      );
      expectThat(
        m.manager?.displayName === "Priya Raman" && m.department === "Finance",
        "manager/department",
      );
      expectThat(m.customFields[fx.fieldEntity.slug] === fx.entity.id, "entity reference");
      const docs = (await api(page, "GET", `/matters/${n}/documents`)).json.documents;
      expectThat(docs.length === 1, `documents ${docs.length}`);
      const bu = await ctx.session("business_user");
      const buRead = await api(bu.page, "GET", `/portal/matters/${n}`);
      expectThat(buRead.status === 404, `Business User referenced read ${buRead.status}`);
      return `With the upload request failed once by the reviewer's browser route (a network stand-in), the dialog read "Record created. Some documents could not be uploaded." with Retry failed uploads and Continue, and ${q(t)} already existed as M-${n}. Retry failed uploads uploaded the file and opened /matters/${n}: header M-${n}, Status pill Open (Category ${m.statusCategory}, statusName ${q(m.statusName)}), Priority Medium, Risk Not assessed, Manager Priya Raman, Department Finance, Entity reference ${q(fx.entity.legalName)}, person reference Jonas Weber, ${docs.length} Document. Jonas Weber, named only in the person Field, got ${buRead.status} reading the Matter.`;
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
        priority: await selectedLabel(d.getByLabel("Priority")),
        risk: await selectedLabel(d.getByLabel("Risk")),
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
      const typed = title("template");
      await d.getByLabel("Title").fill(typed);
      await tpl.selectOption({ label: "No template" });
      const none = await read();
      expectThat(
        none.title === typed && none.priority === "Medium" && none.risk === "Not assessed",
        q(none),
      );
      expectThat(none.optional === "" && none.required === "" && none.hint === null, q(none));
      await tpl.selectOption({ label: fx.templateAlpha.name });
      const again = await read();
      expectThat(again.title === typed && again.required === "Alpha required default", q(again));
      await d.getByRole("button", { name: "Cancel" }).click();
      return `Alpha: ${q(alpha)}. After typing "Typed optional value" and choosing beta: ${q(beta)}. After typing a title and choosing No template: ${q(none)}. Choosing alpha again: ${q(again)}.`;
    },
  );

  await step(
    "Use a template: clear a prefilled optional Field, create, then check Tasks, Key dates, Status and team",
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
      expectThat(
        optionalValue === undefined || optionalValue === null,
        `optional saved as ${q(optionalValue)}`,
      );
      expectThat(
        m.customFields[fx.fieldRequired.slug] === "Alpha required default",
        "required default",
      );
      expectThat(
        m.priority === "high" && m.risk === "critical" && m.statusName === "Open",
        "defaults/status",
      );
      const overviewOptional = await fieldBox(page, fx.fieldOptional).inputValue();
      expectThat(overviewOptional === "", `Overview optional ${overviewOptional}`);
      const expectedManager = role === "administrator" ? account.name : null;
      await page.getByRole("link", { name: /^Tasks/ }).click();
      await page.waitForURL(/\/tasks$/);
      const tasksRegion = page.getByRole("region", { name: "Tasks" });
      await tasksRegion.getByText("DOC-029 alpha evidence review").waitFor();
      const assigneeButton = await tasksRegion
        .getByRole("button", { name: /^Change assignee for DOC-029 alpha evidence review/ })
        .getAttribute("aria-label");
      const tasks = (await api(page, "GET", `/matters/${n}/tasks`)).json.tasks;
      const review = tasks.find((x) => x.title === "DOC-029 alpha evidence review");
      const discussion = tasks.find((x) => x.title === "DOC-029 alpha discussion");
      const created = m.createdAt;
      expectThat(review.dueDate === utcDatePlus(created, 3), `review due ${review.dueDate}`);
      expectThat(discussion && discussion.dueDate === null, "discussion date");
      expectThat(
        (review.assigneeName ?? null) === expectedManager,
        `assignee ${review.assigneeName}`,
      );
      await page.getByRole("link", { name: /^Key dates/ }).click();
      await page.waitForURL(/\/key-dates$/);
      const kd = page.getByRole("region", { name: "Key dates" });
      await kd.getByText("DOC-029 alpha filing").waitFor();
      const dates = (await api(page, "GET", `/matters/${n}/key-dates`)).json.deadlines;
      const kick = dates.find((x) => x.label === "DOC-029 alpha kickoff");
      const filing = dates.find((x) => x.label === "DOC-029 alpha filing");
      expectThat(
        kick.date === utcDatePlus(created, 0) && filing.date === utcDatePlus(created, 7),
        q(dates),
      );
      const team = record.team.map((p) => p.displayName);
      expectThat(prefilledTitle === t, `title became ${prefilledTitle}`);
      return `The typed title ${q(t)} stayed after choosing alpha (the field read ${q(prefilledTitle)}). The prefilled optional Field was cleared; Matter M-${n} was created ${created} with Status ${q(m.statusName)}, Priority high, Risk critical, required ${q(m.customFields[fx.fieldRequired.slug])}, optional ${q(optionalValue ?? null)}, and Overview shows the optional Field empty. Tasks tab: "DOC-029 alpha evidence review" due ${review.dueDate} (+3 UTC days), ${q(assigneeButton)}; "DOC-029 alpha discussion" undated. Key dates tab: kickoff ${kick.date} (+0) and filing ${filing.date} (+7). Team: ${q(team)}.`;
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
    "Set responsibility and maintain the record: Overview field sequence, Region, owners, Priority and rename",
    "Core fields read title, type, Matter Manager, Business Owner, Department, Region, Priority, Risk; Region saves from the shared list and No Region clears it; both owner controls search people and show an avatar; Priority saves; renaming keeps the M- reference.",
    async () => {
      const { number: n, title: t } = state.direct;
      await page.goto(`${BASE}/matters/${n}`);
      const main = page.getByRole("main");
      const controls = [
        ["title", main.getByRole("textbox", { name: "Title" })],
        ["type", main.getByRole("combobox", { name: "Matter type" })],
        ["Matter Manager", main.getByRole("button", { name: "Matter Manager" })],
        ["Business Owner", main.getByRole("button", { name: "Business Owner" })],
        ["Department", main.getByRole("combobox", { name: "Department" })],
        ["Region", main.getByRole("combobox", { name: "Region" })],
        ["Priority", main.getByRole("combobox", { name: "Priority" })],
        ["Risk", main.getByRole("combobox", { name: "Risk" })],
      ];
      const boxes = [];
      for (const [name, loc] of controls) {
        const b = await loc.boundingBox();
        boxes.push({ name, y: Math.round(b.y), x: Math.round(b.x) });
      }
      const order = [...boxes].sort((a, b) => a.y - b.y || a.x - b.x).map((b) => b.name);
      expectThat(q(order) === q(controls.map((c) => c[0])), `order ${q(order)}`);
      const s1 = await patchAfter(page, n, () =>
        main.getByRole("combobox", { name: "Region" }).selectOption({ label: "EMEA" }),
      );
      const r1 = (await matterByNumber(page, n)).matter.region;
      const s2 = await patchAfter(page, n, () =>
        main.getByRole("combobox", { name: "Region" }).selectOption({ label: "No Region" }),
      );
      const r2 = (await matterByNumber(page, n)).matter.region;
      expectThat(s1 === 200 && r1 === "EMEA" && s2 === 200 && r2 === null, `region ${r1} ${r2}`);
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
        main.getByRole("combobox", { name: "Priority" }).selectOption({ label: "High" }),
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
        s4 === 200 && after.priority === "high" && s5 === 200 && after.number === n && ref,
        "priority/rename",
      );
      return `Overview control order by position: ${q(order)}. Region EMEA saved (${s1}, region ${q(r1)}); No Region cleared it (${s2}, ${q(r2)}). Business Owner picker searched "Jonas" and saved Jonas Weber (${s3}); the control reads ${q(ownerText)} with ${avatar} avatar element(s). The Matter Manager control reads ${q(managerText)} with ${managerAvatar} avatar element(s) and its picker has Search people and offers only eligible legal people (${managerChoices.length} buttons, no Jonas Weber). Priority High saved (${s4}). Rename saved (${s5}); the header still shows M-${n}.`;
    },
  );

  await step(
    "Set responsibility: a required value cannot be cleared; Change matter type asks for the new type's required Fields; detached values are retained but hidden",
    "Clearing the required Field is refused and the value stays; the Change matter type dialog Cancel keeps the type and Change type saves; switching back keeps the detached value stored but not shown.",
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
      const changeText = (await change.innerText()).replace(/\s+/g, " ").slice(0, 200);
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
      const shown = await page.getByRole("main").getByText(fx.fieldNumber.displayName).count();
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
    "Set responsibility: Matter team roster, Add team member, and owners versus membership",
    "The roster has one row per person with Matter Manager, Business Owner and Creator statements; Add team member > Person > Add adds a row; a Business Owner who is not a member has no Portal access until membership is added.",
    async () => {
      const { number: n } = state.direct;
      await page.goto(`${BASE}/matters/${n}`);
      await page
        .getByRole("toolbar", { name: "Applets" })
        .getByRole("button", { name: "Matter team" })
        .click();
      const panel = page.getByRole("complementary", { name: "Matter team" });
      await panel.waitFor();
      const rowsBefore = (await panel.getByRole("listitem").allInnerTexts()).map((x) =>
        x.replace(/\s+/g, " ").trim(),
      );
      const bu = await ctx.session("business_user");
      const record = await matterByNumber(page, n);
      const jonasMember = record.team.some((p) => p.displayName === "Jonas Weber");
      const buBefore = (await api(bu.page, "GET", `/portal/matters/${n}`)).status;
      await panel.getByRole("button", { name: "Add team member" }).click();
      const add = page.getByRole("dialog", { name: "Add team member" });
      await add
        .getByLabel("Person")
        .selectOption({ label: "Jonas Weber" })
        .catch(async () => {
          await add.getByLabel("Person").click();
          await page.getByRole("option", { name: "Jonas Weber" }).click();
        });
      await add.getByRole("button", { name: "Add", exact: true }).click();
      await add.waitFor({ state: "hidden" });
      await page.waitForTimeout(800);
      const rowsAfter = (await panel.getByRole("listitem").allInnerTexts()).map((x) =>
        x.replace(/\s+/g, " ").trim(),
      );
      const buAfter = (await api(bu.page, "GET", `/portal/matters/${n}`)).status;
      const names = rowsAfter.map((r) =>
        r.replace(/^(Matter Manager|Business Owner|Creator|\s)+/, ""),
      );
      const priyaRows = rowsAfter.filter((r) => r.includes("Priya Raman")).length;
      const jonasRows = rowsAfter.filter((r) => r.includes("Jonas Weber")).length;
      expectThat(
        rowsBefore.some((r) => r.includes("Priya Raman") && r.includes("Matter Manager")),
        q(rowsBefore),
      );
      expectThat(
        rowsBefore.some((r) => r.includes(account.name) && r.includes("Creator")),
        q(rowsBefore),
      );
      expectThat(
        !jonasMember && buBefore === 404,
        `Business Owner before membership ${jonasMember} ${buBefore}`,
      );
      expectThat(
        buAfter === 200 && jonasRows === 1 && priyaRows === 1,
        `after ${buAfter} ${q(rowsAfter)}`,
      );
      return `Roster before: ${q(rowsBefore)}. Jonas Weber was Business Owner but not a member, and his Portal read answered ${buBefore}. Add team member > Person Jonas Weber > Add gave: ${q(rowsAfter)} (one row each for Priya Raman and Jonas Weber); his read then answered ${buAfter}.`;
    },
  );

  await step(
    "Set responsibility: Confidential audience control",
    "On a Confidential Matter, a Legal Team Member added to the team can read and edit details but cannot change the audience; the Administrator, Matter Manager or Creator can.",
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
      const teamWrite = (
        await api(priya.page, "POST", `/matters/${n}/team`, {
          userId: "01a0aaad-7761-76ba-a052-5150b0a89336",
        })
      ).status;
      const flagWrite = (await api(priya.page, "PATCH", `/matters/${n}`, { isConfidential: false }))
        .status;
      const actorFlag = (await api(page, "PATCH", `/matters/${n}`, { isConfidential: true }))
        .status;
      expectThat(before === 404 && read === 200 && edit === 200, `${before} ${read} ${edit}`);
      expectThat(
        addState !== "enabled" && teamWrite === 403 && flagWrite === 403 && actorFlag === 200,
        `${addState} ${teamWrite} ${flagWrite} ${actorFlag}`,
      );
      return `Fixture Confidential M-${n} created by ${account.name} with no Manager. Priya Raman (Legal Team Member, not on the team) read it: ${before}. After Add team member > Priya Raman, her read ${read}, Description edit ${edit}; in her browser Add team member was ${addState} and the Confidential switch disabled=${switchState}; her direct team write ${teamWrite} and flag write ${flagWrite}. The ${role === "administrator" ? "Administrator" : "Creator"} flag write answered ${actorFlag}.`;
    },
  );

  await step(
    "Set responsibility: link a Contract with a Counterparty and open History",
    "Linking a Contract does not copy its Fields, team or Documents onto the Matter, and its Counterparty stays on the Contract; History lists the recorded changes.",
    async () => {
      const { number: n } = state.direct;
      const opts = (await api(page, "GET", "/contracts/options")).json;
      const nda = opts.contractTypes.find((c) => c.displayName === "NDA");
      const c = await api(page, "POST", "/contracts", {
        title: title("linked contract"),
        contractTypeId: nda.id,
      });
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
      await link.getByText(title("linked contract")).first().click();
      await link.getByRole("button", { name: "Link", exact: true }).click();
      await link.waitFor({ state: "hidden" });
      await page.getByRole("link", { name: new RegExp(`C-${cn}`) }).waitFor();
      const after = await matterByNumber(page, n);
      const docsAfter = (await api(page, "GET", `/matters/${n}/documents`)).json.documents.length;
      const contract = (await api(page, "GET", `/contracts/${cn}`)).json.contract;
      expectThat(
        q(after.team) === q(before.team) &&
          q(after.matter.customFields) === q(before.matter.customFields) &&
          docsAfter === docsBefore,
        "matter changed by link",
      );
      expectThat(contract.primaryCounterparty?.name === cp.name, "counterparty moved");
      await page
        .getByRole("toolbar", { name: "Applets" })
        .getByRole("button", { name: "History" })
        .click();
      const history = page.getByRole("complementary", { name: "History" });
      await history.getByRole("listitem").first().waitFor();
      const entries = (await history.getByRole("listitem").allInnerTexts()).map((x) =>
        x.replace(/\s+/g, " ").trim(),
      );
      expectThat(entries.length >= 5, `history ${entries.length}`);
      return `Fixture NDA C-${cn} with Counterparty ${q(cp.name)} linked through Link Contract > search > Link. The Matter's team (${after.team.length} people), custom Field values and Documents (${docsAfter}) were unchanged, and the Counterparty is still ${q(contract.primaryCounterparty?.name)} on the Contract. History shows ${entries.length} entries, first ones: ${q(entries.slice(0, 6))}.`;
    },
  );

  await step(
    "Create the Matter: switch Confidential on, then Continue after a failed upload",
    "The Confidential switch in the dialog saves the flag; Continue leaves the failed file behind and opens the Matter that already exists.",
    async () => {
      const t = title("confidential continue");
      await openCreate();
      const d = dialog();
      await d.getByLabel("Title").fill(t);
      await d.getByLabel("Matter type").selectOption({ label: fx.typeMain.displayName });
      await fieldBox(d, fx.fieldRequired).fill("Continue check");
      await d.getByRole("switch", { name: /^Confidential/ }).click();
      const on = await d
        .getByRole("switch", { name: /^Confidential/ })
        .getAttribute("aria-checked");
      await d
        .locator('input[type="file"]')
        .setInputFiles(path.join(ctx.here, "fixtures/doc029-matters-note.pdf"));
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
      return `Confidential switch aria-checked ${on} before Create. With every upload failed by the reviewer's route, Continue closed the dialog and opened M-${n} ${q(t)}: Confidential ${m.isConfidential}, ${docs} Documents.`;
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
      expectThat(button === 0 && direct.status === 403, `${button} ${direct.status}`);
      return `Jonas Weber's Portal Matters page has ${button} New matter buttons; his direct create answered ${direct.status}.`;
    },
  );
}
