// V-C19: "Manage Contract Tasks and Key dates", followed as written for one role.
import path from "node:path";
import { openContractsDefaultView, selectContractsView } from "./lib-r1.mjs";

export async function runC19(ctx, step) {
  const { actor, role, other, PEOPLE, userId, typeId, stamp, helpers, here, getBusinessUser } = ctx;
  const { expectThat, isoPlusDays, sleep, text, withResponse, BASE } = helpers;
  const p = actor.page;
  const fix = (name) => path.join(here, "fixtures", name);
  const read = async (num) => (await actor.api("GET", `/contracts/${num}`)).json?.contract;
  const tag = `${role} ${stamp}`;
  const addCandidate = role === "administrator" ? "Tom Iwu" : "Priya Raman";
  const rowCandidate = role === "administrator" ? "Marcus Oyelaran" : "Ines Duarte";
  let num;

  const tasksTab = async () => {
    await p.goto(`${BASE}/contracts/${num}/tasks`);
    await p.getByRole("region", { name: "Tasks" }).waitFor();
    await sleep(600);
    return p.getByRole("region", { name: "Tasks" });
  };
  const keyDatesTab = async () => {
    await p.goto(`${BASE}/contracts/${num}/key-dates`);
    try {
      await p.getByRole("region", { name: "Key dates" }).waitFor({ timeout: 20000 });
    } catch {
      await ctx.shot(p, `${role}-key-dates-slow-load`);
      await p.reload();
      await p.getByRole("region", { name: "Key dates" }).waitFor({ timeout: 30000 });
      ctx.records.push({
        note: `Key dates section for C-${num} did not render within 20 s once; a reload rendered it`,
      });
    }
    await sleep(600);
    return p.getByRole("region", { name: "Key dates" });
  };
  const apiTasks = async () => (await actor.api("GET", `/contracts/${num}/tasks`)).json;
  const teamNames = async () =>
    JSON.stringify((await actor.api("GET", `/contracts/${num}`)).json.team ?? []);
  const taskComments = async (id) =>
    (await actor.api("GET", `/comments?entityType=contract_task&entityId=${id}`)).json?.comments ??
    [];
  const kdRows = async () => {
    const region = await keyDatesTab();
    const rows = region.getByRole("row");
    const n = await rows.count();
    const out = [];
    for (let i = 1; i < n; i++)
      out.push({
        text: await text(rows.nth(i)),
        actions: await rows.nth(i).getByRole("button").count(),
      });
    return out;
  };

  await step(
    "Prepare an unarchived Contract with the acting role as Legal Owner and the other staff role and a Business User on the Contract team",
    "Prerequisite record exists for this role",
    async () => {
      const created = await actor.api("POST", "/contracts", {
        title: `DOC-029r2 contracts-b C19 ${tag}`,
        contractTypeId: typeId("NDA"),
        managerId: userId(PEOPLE[role].name),
      });
      expectThat(created.status === 201, `create ${created.status}`);
      num = created.json.contract.number;
      for (const name of [PEOPLE[other].name, PEOPLE.businessUser.name]) {
        const t = await actor.api("POST", `/contracts/${num}/team`, { userId: userId(name) });
        expectThat(t.status < 300, `team ${name} ${t.status}`);
      }
      ctx.records.push({
        article: "contract-tasks-and-dates",
        role,
        purpose: "Tasks and Key dates",
        reference: `C-${num}`,
      });
      return `C-${num} "DOC-029r2 contracts-b C19 ${tag}" with Legal Owner ${PEOPLE[role].name}; team adds ${PEOPLE[other].name} and ${PEOPLE.businessUser.name} (Business User).`;
    },
  );

  await step(
    "Add task: the Assignee picker offers active team people and the Legal Owner, not Business Users; Add someone to the team… then Use this person, then Cancel before saving",
    "Cancel before saving creates neither the Task nor a staged team addition",
    async () => {
      const region = await tasksTab();
      await region.getByRole("button", { name: "Add task" }).click();
      const dialog = p.getByRole("dialog", { name: "Add a task" });
      await dialog
        .getByRole("textbox", { name: "Title" })
        .fill(`DOC-029r2 contracts-b C19 cancelled ${tag}`);
      await dialog.getByRole("button", { name: "Assignee" }).click();
      const picker = p.getByRole("dialog", { name: "Assign task" });
      await picker.waitFor();
      const offered = (await picker.getByRole("button").allTextContents())
        .map((s) => s.trim())
        .filter(Boolean);
      expectThat(
        offered.some((s) => s.includes(PEOPLE[role].name)) &&
          offered.some((s) => s.includes(PEOPLE[other].name)),
        `offered ${offered.join(", ")}`,
      );
      expectThat(
        !offered.some((s) => s.includes(PEOPLE.businessUser.name)),
        `Business User offered: ${offered.join(", ")}`,
      );
      await picker.getByRole("button", { name: "Add someone to the team…" }).click();
      await picker.getByRole("textbox", { name: "Search people" }).fill(addCandidate.split(" ")[0]);
      await picker.getByRole("button", { name: addCandidate }).click();
      const notice = await text(picker.getByText(/This person will join the team/));
      const deferred = await text(
        picker.getByText(/Team membership and assignment are saved when you save the task/),
      );
      await picker.getByRole("button", { name: "Use this person" }).click();
      await sleep(400);
      const shown = await text(dialog.getByRole("button", { name: "Assignee" }));
      await dialog.getByRole("button", { name: "Cancel" }).click();
      await dialog.waitFor({ state: "hidden" });
      const tasks = await apiTasks();
      const team = await teamNames();
      expectThat(!tasks.tasks.some((t) => t.title.includes("cancelled")), "cancelled task exists");
      expectThat(!team.includes(addCandidate), `${addCandidate} was added to the team`);
      return `The picker offered: ${offered.join(", ")} (no ${PEOPLE.businessUser.name}). Add someone to the team… -> ${addCandidate} showed "${notice}" and "${deferred}"; Use this person set the Assignee to "${shown}". Cancel: no Task saved and ${addCandidate} is not on the team.`;
    },
  );

  await step(
    "Add task with Title, Description, a staged team addition as Assignee, a Due date, and an initial note with a file; check the new row and the note's Working team audience",
    "The Task saves with its assignee added to the team; the initial note uses the Working team audience",
    async () => {
      const region = await tasksTab();
      await region.getByRole("button", { name: "Add task" }).click();
      const dialog = p.getByRole("dialog", { name: "Add a task" });
      const title = `DOC-029r2 contracts-b C19 review notice ${tag}`;
      await dialog.getByRole("textbox", { name: "Title" }).fill(title);
      await dialog
        .getByRole("textbox", { name: "Description" })
        .fill("Check the notice clause against the signed paper.");
      await dialog.getByRole("button", { name: "Assignee" }).click();
      const picker = p.getByRole("dialog", { name: "Assign task" });
      await picker.getByRole("button", { name: "Add someone to the team…" }).click();
      await picker.getByRole("textbox", { name: "Search people" }).fill(addCandidate.split(" ")[0]);
      await picker.getByRole("button", { name: addCandidate }).click();
      await picker.getByRole("button", { name: "Use this person" }).click();
      await dialog.getByRole("textbox", { name: "Due date" }).fill(isoPlusDays(20));
      await dialog
        .getByRole("textbox", { name: "Add a note" })
        .fill("DOC-029r2 initial note for the reviewer.");
      await dialog
        .locator("input[type=file]")
        .first()
        .setInputFiles(fix("doc029-services-agreement.pdf"));
      await dialog.getByRole("button", { name: "Add task" }).click();
      await dialog.waitFor({ state: "hidden", timeout: 20000 });
      const r2 = await tasksTab();
      const row = r2.getByRole("listitem").filter({ hasText: title });
      const rowText = await text(row);
      const task = (await apiTasks()).tasks.find((t) => t.title === title);
      const team = await teamNames();
      await row.getByRole("button", { name: title, exact: true }).click();
      const details = p.getByRole("dialog", { name: "Task details" });
      await details.waitFor();
      await sleep(1500);
      const detailsText = await text(details);
      const first = (await taskComments(task.id))[0];
      await details.getByRole("button", { name: "Close" }).first().click();
      expectThat(
        task && task.assigneeName === addCandidate && task.dueDate === isoPlusDays(20),
        `task ${JSON.stringify(task)}`,
      );
      expectThat(team.includes(addCandidate), `${addCandidate} not on team`);
      expectThat(
        first &&
          first.visibility === "working_team" &&
          detailsText.includes("DOC-029r2 initial note") &&
          detailsText.includes("doc029-services-agreement.pdf"),
        `comment ${JSON.stringify(first)?.slice(0, 300)}; details ${detailsText.slice(0, 300)}`,
      );
      return `Row: "${rowText}". Task assigned to ${task.assigneeName}, due ${task.dueDate}; ${addCandidate} joined the Contract team on save. Task details shows the initial note and the attached PDF; the comment visibility is ${first.visibility}.`;
    },
  );

  await step(
    "Partial save: the Task saves but its initial note fails; Retry note & attachments posts the note without creating another Task",
    "Retry note & attachments retries the pending comment only",
    async () => {
      const region = await tasksTab();
      await region.getByRole("button", { name: "Add task" }).click();
      const dialog = p.getByRole("dialog", { name: "Add a task" });
      const title = `DOC-029r2 contracts-b C19 retry ${tag}`;
      await dialog.getByRole("textbox", { name: "Title" }).fill(title);
      await dialog
        .getByRole("textbox", { name: "Add a note" })
        .fill("DOC-029r2 note that fails once.");
      let failed = 0;
      const handler = async (route) => {
        if (route.request().method() === "POST" && failed === 0) {
          failed++;
          return route.fulfill({
            status: 503,
            contentType: "application/problem+json",
            body: JSON.stringify({ title: "Service Unavailable", status: 503 }),
          });
        }
        return route.continue();
      };
      await p.route("**/api/v1/comments", handler);
      await dialog.getByRole("button", { name: "Add task" }).click();
      const retry = dialog.getByRole("button", { name: "Retry note & attachments" });
      await retry.waitFor({ timeout: 15000 });
      const message = await text(dialog.getByText(/could not be added/).first());
      const between = (await apiTasks()).tasks.filter((t) => t.title === title).length;
      await p.unroute("**/api/v1/comments", handler);
      await retry.click();
      await dialog.waitFor({ state: "hidden", timeout: 15000 }).catch(() => {});
      const stillOpen = await dialog.isVisible().catch(() => false);
      if (stillOpen)
        await dialog
          .getByRole("button", { name: /Close|Cancel/ })
          .first()
          .click();
      const tasks = (await apiTasks()).tasks.filter((t) => t.title === title);
      const comments = await taskComments(tasks[0].id);
      expectThat(
        failed === 1 && between === 1 && tasks.length === 1 && comments.length === 1,
        `failed ${failed} between ${between} tasks ${tasks.length} comments ${comments.length}`,
      );
      return `With one comment POST answered 503 by the reviewer's route, the dialog said "${message}" and offered Retry note & attachments; ${between} Task existed. After the retry there is ${tasks.length} Task named "${title}" with ${comments.length} comment; the dialog ${stillOpen ? "stayed open and was closed" : "closed"}.`;
    },
  );

  await step(
    "Complete a Task with its checkbox, find it with Show completed, reopen it, and check the done count",
    "A completed Task leaves the list until Show completed is on; reopening restores it",
    async () => {
      const title = `DOC-029r2 contracts-b C19 retry ${tag}`;
      let region = await tasksTab();
      const countBefore = await text(region.getByText(/of \d+ done/));
      await withResponse(
        p,
        (r) => r.request().method() !== "GET" && r.url().includes("/tasks/"),
        () => region.getByRole("checkbox", { name: `Complete task: ${title}` }).click(),
      );
      await sleep(800);
      const hidden = (await region.getByRole("button", { name: title, exact: true }).count()) === 0;
      const countDone = await text(region.getByText(/of \d+ done/));
      await region.getByRole("switch", { name: "Show completed" }).click();
      await sleep(600);
      const shown = (await region.getByRole("button", { name: title, exact: true }).count()) === 1;
      const box = region.getByRole("checkbox", { name: new RegExp(title) });
      const checked = await box.isChecked();
      await withResponse(
        p,
        (r) => r.request().method() !== "GET" && r.url().includes("/tasks/"),
        () => box.click(),
      );
      region = await tasksTab();
      const countAfter = await text(region.getByText(/of \d+ done/));
      const t = (await apiTasks()).tasks.find((x) => x.title === title);
      expectThat(
        hidden && shown && checked && !t.isDone,
        `hidden ${hidden} shown ${shown} checked ${checked} done ${t.isDone}`,
      );
      return `Count "${countBefore}" -> "${countDone}" after completion; the row left the list; Show completed showed it checked; selecting the checkbox again reopened it ("${countAfter}", isDone ${t.isDone}).`;
    },
  );

  await step(
    "Open Task details from the title and from Edit task, save an edit with Save, and remove an empty Task with Remove task; a Task with conversation history cannot be removed, also after its comment is deleted",
    "Edits persist; Remove task removes only a Task without conversation history",
    async () => {
      const retryTitle = `DOC-029r2 contracts-b C19 retry ${tag}`;
      const emptyTitle = `DOC-029r2 contracts-b C19 empty ${tag}`;
      const e = await actor.api("POST", `/contracts/${num}/tasks`, { title: emptyTitle });
      expectThat(e.status === 201, `empty task ${e.status}`);
      let region = await tasksTab();
      await region.getByRole("button", { name: emptyTitle, exact: true }).click();
      let details = p.getByRole("dialog", { name: "Task details" });
      const edited = `${emptyTitle} edited`;
      await details.getByRole("textbox", { name: "Title" }).fill(edited);
      await withResponse(
        p,
        (r) => r.request().method() === "PATCH",
        () => details.getByRole("button", { name: "Save" }).click(),
      );
      await sleep(800);
      if (await details.isVisible())
        await details.getByRole("button", { name: "Close" }).first().click();
      region = await tasksTab();
      const editedShown =
        (await region.getByRole("button", { name: edited, exact: true }).count()) === 1;
      await region.getByRole("button", { name: `Actions for ${edited}` }).click();
      const menuItems = (await p.getByRole("menuitem").allTextContents()).map((s) => s.trim());
      await p.getByRole("menuitem", { name: "Edit task" }).click();
      details = p.getByRole("dialog", { name: "Task details" });
      await details.waitFor();
      const editOpened =
        (await details.getByRole("textbox", { name: "Title" }).inputValue()) === edited;
      await details.getByRole("button", { name: "Close" }).first().click();
      await details.waitFor({ state: "hidden" });
      await region.getByRole("button", { name: `Actions for ${edited}` }).click();
      const s = await withResponse(
        p,
        (r) => r.request().method() === "DELETE",
        () => p.getByRole("menuitem", { name: "Remove task" }).click(),
      );
      await sleep(800);
      const removed = !(await apiTasks()).tasks.some((t) => t.title === edited);
      region = await tasksTab();
      await region.getByRole("button", { name: `Actions for ${retryTitle}` }).click();
      const s2 = await withResponse(
        p,
        (r) => r.request().method() === "DELETE",
        () => p.getByRole("menuitem", { name: "Remove task" }).click(),
      );
      await sleep(800);
      const tasksText = await text(p.getByRole("region", { name: "Tasks" }));
      const refusal =
        tasksText
          .match(/[^.]*(cannot|could not|conversation|history|comments)[^.]*\./i)?.[0]
          ?.trim() ?? `(no refusal sentence found in: ${tasksText.slice(0, 200)})`;
      await ctx.shot(p, `${role}-task-remove-refused`);
      const kept = (await apiTasks()).tasks.some((t) => t.title === retryTitle);
      const task = (await apiTasks()).tasks.find((t) => t.title === retryTitle);
      const comments = await taskComments(task.id);
      const del = await actor.api("DELETE", `/comments/${comments[0].id}`);
      region = await tasksTab();
      await region.getByRole("button", { name: `Actions for ${retryTitle}` }).click();
      const s3 = await withResponse(
        p,
        (r) => r.request().method() === "DELETE",
        () => p.getByRole("menuitem", { name: "Remove task" }).click(),
      );
      await sleep(800);
      const kept2 = (await apiTasks()).tasks.some((t) => t.title === retryTitle);
      expectThat(
        editedShown && editOpened && s < 300 && removed,
        `edit ${editedShown} open ${editOpened} remove ${s} removed ${removed}`,
      );
      expectThat(
        s2 === 409 && kept && del.status < 300 && s3 === 409 && kept2,
        `refusal ${s2} kept ${kept} delete ${del.status} again ${s3} kept ${kept2}`,
      );
      return `Title click opened Task details; Save persisted "${edited}". The row actions menu offered ${menuItems.join(", ")}; Edit task opened the same details. Remove task on the empty Task answered ${s} and removed it. Remove task on the Task with a note answered ${s2} ("${refusal}") and kept it; after the comment was deleted (${del.status}) Remove task still answered ${s3} and the Task stayed.`;
    },
  );

  await step(
    "Change who is responsible from the row's assignee: Add someone to the team… shows the access notice and Add to team and assign; later changing to Unassigned keeps the team membership",
    "The person joins the Contract team and is assigned; clearing the assignee does not remove team membership",
    async () => {
      const title = `DOC-029r2 contracts-b C19 retry ${tag}`;
      let region = await tasksTab();
      await region
        .getByRole("button", { name: `Change assignee for ${title}: Unassigned` })
        .click();
      const picker = p.getByRole("dialog", { name: "Assign task" });
      await picker.getByRole("button", { name: "Add someone to the team…" }).click();
      await picker.getByRole("textbox", { name: "Search people" }).fill(rowCandidate.split(" ")[0]);
      await picker.getByRole("button", { name: rowCandidate }).click();
      const notice = await text(picker.getByText(/This person will join the team/));
      await withResponse(
        p,
        (r) => r.request().method() === "PATCH",
        () => picker.getByRole("button", { name: "Add to team and assign" }).click(),
      );
      await sleep(800);
      const t1 = (await apiTasks()).tasks.find((t) => t.title === title);
      const team1 = await teamNames();
      region = await tasksTab();
      await region
        .getByRole("button", { name: `Change assignee for ${title}: ${rowCandidate}` })
        .click();
      await withResponse(
        p,
        (r) => r.request().method() === "PATCH",
        () =>
          p
            .getByRole("dialog", { name: "Assign task" })
            .getByRole("button", { name: "Unassigned" })
            .click(),
      );
      await sleep(800);
      const t2 = (await apiTasks()).tasks.find((t) => t.title === title);
      const team2 = await teamNames();
      expectThat(
        t1.assigneeName === rowCandidate && team1.includes(rowCandidate),
        `assigned ${t1.assigneeName}`,
      );
      expectThat(
        t2.assigneeId === null && team2.includes(rowCandidate),
        `after clear ${t2.assigneeId}`,
      );
      return `Row picker -> Add someone to the team… -> ${rowCandidate}: "${notice}"; Add to team and assign made ${t1.assigneeName} the assignee and a team member. Choosing Unassigned cleared the assignee; ${rowCandidate} is still on the team.`;
    },
  );

  await step(
    "Task details conversation offers only Legal only and Working team and stays separate from the record conversation; the Tasks section has no reordering control",
    "Task comments stay separate from the record conversation; no reorder control exists",
    async () => {
      const title = `DOC-029r2 contracts-b C19 review notice ${tag}`;
      const region = await tasksTab();
      const dragHandles = await region.locator("[draggable=true]").count();
      const moveButtons = await region.getByRole("button", { name: /move|reorder|drag/i }).count();
      await region.getByRole("button", { name: title, exact: true }).click();
      const details = p.getByRole("dialog", { name: "Task details" });
      await details.waitFor();
      const labels = await text(details.getByRole("group", { name: "Audience" }));
      await details.getByRole("button", { name: "Close" }).first().click();
      const recordThread = (
        await actor.api("GET", `/comments?entityType=contract&entityId=${(await read(num)).id}`)
      ).json;
      const leaked = JSON.stringify(recordThread).includes("DOC-029r2 initial note");
      expectThat(dragHandles === 0 && moveButtons === 0, `drag ${dragHandles} move ${moveButtons}`);
      expectThat(
        /Legal only/.test(labels) && /Working team/.test(labels) && !/Full thread/.test(labels),
        `audiences "${labels}"`,
      );
      expectThat(!leaked, "Task note appears in the record conversation");
      return `Tasks section: ${dragHandles} draggable elements and ${moveButtons} move/reorder buttons. Task details Audience group reads "${labels}". The Contract's own conversation does not contain the Task note.`;
    },
  );

  await step(
    "Add date: Date, Event, Note; check global and combined reminders; add and remove an additional lead time; out-of-range lead times are refused; select a recipient; save and check the Key date row",
    "The Key date saves with source Key date; lead times follow the 0 to 730 rule; recipient checkboxes list active team members and never Business Users",
    async () => {
      const region = await keyDatesTab();
      await region.getByRole("button", { name: "Add date" }).click();
      const dialog = p.getByRole("dialog", { name: "Add a key date" });
      await dialog.getByRole("textbox", { name: "Date" }).fill(isoPlusDays(40));
      await dialog.getByRole("textbox", { name: "Event" }).fill(`DOC-029r2 price review ${tag}`);
      await dialog.getByRole("textbox", { name: "Note" }).fill("Fictional price review window.");
      const reminders = dialog.getByRole("group", { name: "Reminders" });
      await reminders.getByText(/^Global reminders:/).waitFor();
      const global = await text(reminders.getByText(/^Global reminders:/));
      const lead = reminders.getByRole("spinbutton", {
        name: "Additional lead time (days before)",
      });
      const add = reminders.getByRole("button", { name: "Add lead time" });
      await lead.fill("731");
      const disabled731 = await add.isDisabled();
      await lead.fill("-1");
      const disabledNeg = await add.isDisabled();
      await lead.fill("0");
      const zeroEnabled = await add.isEnabled();
      await lead.fill("45");
      await add.click();
      await lead.fill("30");
      const thirtyEnabled = await add.isEnabled();
      if (thirtyEnabled) await add.click();
      const combined = await text(reminders.getByText(/^This date will remind:/));
      await lead.fill("60");
      await add.click();
      const withSixty = await text(reminders.getByText(/^This date will remind:/));
      await reminders.getByRole("button", { name: "Remove 60 days before" }).click();
      const afterRemove = await text(reminders.getByText(/^This date will remind:/));
      const boxesText = await text(reminders);
      await reminders.getByRole("checkbox", { name: PEOPLE[other].name }).check();
      await dialog.getByRole("button", { name: "Add date" }).click();
      await dialog.waitFor({ state: "hidden", timeout: 15000 });
      const rows = await kdRows();
      const row = rows.find((r) => r.text.includes(`DOC-029r2 price review ${tag}`));
      const thirtyCount = (combined.match(/30 days before/g) ?? []).length;
      expectThat(
        disabled731 && disabledNeg && zeroEnabled,
        `731 disabled ${disabled731}; -1 disabled ${disabledNeg}; 0 enabled ${zeroEnabled}`,
      );
      expectThat(
        /45 days before/.test(combined) &&
          thirtyCount === 1 &&
          /60 days before/.test(withSixty) &&
          !/60 days before/.test(afterRemove),
        `combined "${combined}" / "${withSixty}" / "${afterRemove}"`,
      );
      expectThat(
        boxesText.includes(PEOPLE[other].name) && !boxesText.includes(PEOPLE.businessUser.name),
        `recipient list "${boxesText}"`,
      );
      expectThat(
        row && row.text.includes("Key date") && row.actions === 1,
        `row ${JSON.stringify(row)}`,
      );
      return `"${global}". 731 and -1 left Add lead time disabled; 0 enabled it. After adding 45 and 30 (Add lead time ${thirtyEnabled ? "enabled" : "disabled"} for 30): "${combined}" (30 appears once). Adding 60 then Remove left "${afterRemove}". The recipient checkboxes include ${PEOPLE[other].name} and not ${PEOPLE.businessUser.name}. Saved row "${row.text}" with one actions button.`;
    },
  );

  await step(
    "Edit date then Cancel leaves the saved date unchanged; Edit date then Save changes it; Remove date removes another Key date; derived rows have no actions and the list orders upcoming dates nearest first and past dates after",
    "Key date edits persist, Cancel changes nothing, and the combined list keeps the stated order",
    async () => {
      const addKd = async (date, label) => {
        const r = await actor.api("POST", `/contracts/${num}/key-dates`, { date, label });
        expectThat(r.status === 201, `key date ${label} ${r.status}`);
      };
      await addKd(isoPlusDays(-10), `DOC-029r2 past check ${tag}`);
      await addKd(isoPlusDays(10), `DOC-029r2 near check ${tag}`);
      await addKd(isoPlusDays(200), `DOC-029r2 remove me ${tag}`);
      const ex = await actor.api("PATCH", `/contracts/${num}`, { expiryDate: isoPlusDays(300) });
      expectThat(ex.status === 200, `expiry ${ex.status}`);
      let region = await keyDatesTab();
      const label = `DOC-029r2 price review ${tag}`;
      await region.getByRole("button", { name: `Actions for ${label}` }).click();
      await p.getByRole("menuitem", { name: "Edit date" }).click();
      let dialog = p.getByRole("dialog", { name: "Edit key date" });
      await dialog.getByRole("textbox", { name: "Event" }).fill(`${label} changed then cancelled`);
      await dialog.getByRole("button", { name: "Cancel" }).click();
      let rows = await kdRows();
      const cancelled = rows.some((r) => r.text.includes("changed then cancelled"));
      region = await keyDatesTab();
      await region.getByRole("button", { name: `Actions for ${label}` }).click();
      await p.getByRole("menuitem", { name: "Edit date" }).click();
      dialog = p.getByRole("dialog", { name: "Edit key date" });
      await dialog.getByRole("textbox", { name: "Event" }).fill(`${label} saved`);
      await dialog.getByRole("button", { name: "Save" }).click();
      await dialog.waitFor({ state: "hidden" });
      region = await keyDatesTab();
      await region.getByRole("button", { name: `Actions for DOC-029r2 remove me ${tag}` }).click();
      await p.getByRole("menuitem", { name: "Remove date" }).click();
      await sleep(500);
      const confirm = p.getByRole("alertdialog");
      let confirmText = "no confirmation dialog";
      if (await confirm.count()) {
        confirmText = await text(confirm);
        await confirm.getByRole("button", { name: /Remove/ }).click();
      }
      await sleep(1000);
      rows = await kdRows();
      const texts = rows.map((r) => r.text);
      const idx = (s) => texts.findIndex((t) => t.includes(s));
      const derived = rows.filter((r) => r.text.includes("Derived"));
      expectThat(
        !cancelled && idx(`${label} saved`) >= 0 && idx("remove me") < 0,
        `cancelled ${cancelled}; rows ${texts.join(" | ")}`,
      );
      expectThat(
        derived.length >= 1 && derived.every((r) => r.actions === 0),
        `derived ${JSON.stringify(derived)}`,
      );
      expectThat(
        idx("near check") < idx(`${label} saved`) &&
          idx(`${label} saved`) < idx("Current term expires") &&
          idx("Current term expires") < idx("past check"),
        `order ${texts.join(" | ")}`,
      );
      return `Cancel kept the event; Save changed it to "${label} saved"; Remove date (${confirmText}) removed "remove me". Rows in order: ${texts.join(" | ")}. ${derived.length} derived row(s), each without actions.`;
    },
  );

  await step(
    "A selected recipient leaves the team: the Edit date dialog says so and offers Use the usual audience, which clears the selection",
    "The dialog names the change and returns to the default recipients",
    async () => {
      const label = `DOC-029r2 price review ${tag} saved`;
      const before = (await actor.api("GET", `/contracts/${num}/key-dates`)).json;
      const off = await actor.api("DELETE", `/contracts/${num}/team/${userId(PEOPLE[other].name)}`);
      expectThat(off.status < 300, `team removal ${off.status}`);
      const region = await keyDatesTab();
      await region.getByRole("button", { name: `Actions for ${label}` }).click();
      await p.getByRole("menuitem", { name: "Edit date" }).click();
      const dialog = p.getByRole("dialog", { name: "Edit key date" });
      await dialog.getByText(/have left the team/).waitFor({ timeout: 10000 });
      const warn = await text(dialog.getByText(/have left the team/));
      await dialog.getByRole("button", { name: "Use the usual audience" }).click();
      await dialog.getByRole("button", { name: "Save" }).click();
      await dialog.waitFor({ state: "hidden" });
      const after = (await actor.api("GET", `/contracts/${num}/key-dates`)).json;
      const find = (j) =>
        JSON.stringify(j).match(/\{[^{}]*"label":"DOC-029r2 price review[^{}]*\}/)?.[0] ?? "";
      const back = await actor.api("POST", `/contracts/${num}/team`, {
        userId: userId(PEOPLE[other].name),
      });
      const b = find(before);
      const a = find(after);
      expectThat(
        /reminderRecipientIds":\["/.test(b) && !/reminderRecipientIds":\["/.test(a),
        `before ${b} after ${a}`,
      );
      return `Saved selection before: ${b.match(/"reminderRecipientIds":[^\]]*\]/)?.[0]}. After ${PEOPLE[other].name} left the team the dialog said "${warn}"; Use the usual audience then Save stored ${a.match(/"reminderRecipientIds":[^\]]*\]/)?.[0] ?? a.slice(0, 200)}. ${PEOPLE[other].name} was re-added (${back.status}).`;
    },
  );

  await step(
    "Next deadline in the Contracts list picks the earliest unfinished Task due date, including an overdue Task, before Key dates and term dates",
    "The Next deadline column shows the overdue Task, then the nearest Key date after the Task is done",
    async () => {
      const overdueTitle = `DOC-029r2 contracts-b C19 overdue ${tag}`;
      const t = await actor.api("POST", `/contracts/${num}/tasks`, {
        title: overdueTitle,
        dueDate: isoPlusDays(-3),
      });
      expectThat(t.status === 201, `overdue task ${t.status}`);
      const readCell = async () => {
        const v = await openContractsDefaultView(p);
        if (v.before !== "Default view") ctx.restoreView = v.before;
        const viewNote = `view ${v.now} (previously selected: ${v.before})`;
        const headers = (await p.getByRole("columnheader").allTextContents()).map((x) => x.trim());
        const col = headers.findIndex((h) => h === "Next deadline");
        expectThat(col >= 0, `no Next deadline column: ${headers.join(", ")}`);
        for (let i = 0; i < 20; i++) {
          const row = p
            .getByRole("row")
            .filter({ has: p.getByRole("cell", { name: `C-${num}`, exact: true }) });
          if (await row.count())
            return { cell: await text(row.getByRole("cell").nth(col)), viewNote };
          const more = p.getByRole("button", { name: "Show more" });
          if (!(await more.count())) break;
          await more.click();
          await sleep(800);
        }
        throw new Error(`C-${num} not found in the list`);
      };
      const first = await readCell();
      await p.goto(`${BASE}/contracts/${num}/tasks`);
      await withResponse(
        p,
        (r) => r.request().method() !== "GET" && r.url().includes("/tasks/"),
        () =>
          p
            .getByRole("region", { name: "Tasks" })
            .getByRole("checkbox", { name: `Complete task: ${overdueTitle}` })
            .click(),
      );
      const toggled = (await apiTasks()).tasks.find((x) => x.title === overdueTitle);
      const second = await readCell();
      const restored = ctx.restoreView
        ? `re-selected view "${await selectContractsView(p, ctx.restoreView)}" afterwards`
        : "made no view change";
      expectThat(
        first.cell.includes("overdue") && toggled.isDone,
        `first "${first.cell}" done ${toggled.isDone}`,
      );
      expectThat(second.cell.includes("near check"), `second "${second.cell}"`);
      return `${first.viewNote}. With an open Task due ${isoPlusDays(-3)}, the C-${num} Next deadline cell read "${first.cell}". After the Task was completed it read "${second.cell}" (the Key date due ${isoPlusDays(10)}; the review Task is due ${isoPlusDays(20)}, other Key dates and the ${isoPlusDays(300)} expiry are later). The reviewer ${restored}.`;
    },
  );

  await step(
    "Home and My Tasks show the assigned open Task and the approaching Contract date, with links back to the correct Contract",
    "Home lists assigned open Tasks and approaching Contract dates in separate sections",
    async () => {
      const title = `DOC-029r2 contracts-b C19 mine ${tag}`;
      const t = await actor.api("POST", `/contracts/${num}/tasks`, {
        title,
        assigneeId: userId(PEOPLE[role].name),
        dueDate: isoPlusDays(2),
      });
      expectThat(t.status === 201, `task ${t.status}`);
      await p.goto(`${BASE}/`);
      await p.getByRole("region", { name: "Tasks assigned to you" }).waitFor();
      await sleep(1500);
      const regions = await p
        .getByRole("main")
        .getByRole("region")
        .evaluateAll((els) => els.map((e) => e.querySelector("h2")?.textContent));
      await p.goto(`${BASE}/home/tasks`);
      const link = p.getByRole("link", { name: new RegExp(title) });
      await link.first().waitFor({ timeout: 15000 });
      await link.first().click();
      await sleep(1500);
      const landed = new URL(p.url()).pathname;
      await p.goto(`${BASE}/`);
      await p.getByRole("region", { name: "Tasks assigned to you" }).waitFor();
      await sleep(1500);
      const dates = p.getByRole("region", { name: "Dates approaching" });
      const datesText = (await dates.count()) ? await text(dates) : "";
      const contracts = p.getByRole("region", { name: "Your contracts" });
      const contractsText = (await contracts.count()) ? await text(contracts) : "";
      const homeTask = p
        .getByRole("region", { name: "Tasks assigned to you" })
        .getByRole("link", { name: new RegExp(title) });
      const homeTaskText = (await homeTask.count())
        ? `Home Tasks assigned to you lists it (${await homeTask.first().getAttribute("href")})`
        : "Home Tasks assigned to you shows the first rows only and did not include it; View all opens My Tasks";
      const dateLink = dates.getByRole("link").filter({ hasText: `Contract C-${num}` });
      let dateEvidence = "";
      if (await dateLink.count()) {
        dateEvidence = `Dates approaching lists "${await text(dateLink.first())}" -> ${await dateLink.first().getAttribute("href")}`;
      } else {
        await dates
          .getByRole("button", { name: /View all/ })
          .or(dates.getByRole("link", { name: /View all/ }))
          .first()
          .click();
        const cal = p.getByRole("dialog", { name: "Your dates" });
        await cal.waitFor();
        await sleep(1500);
        const whole = cal
          .getByRole("button", { name: "Show whole month" })
          .or(cal.getByRole("checkbox", { name: "Show whole month" }))
          .or(cal.getByRole("switch", { name: "Show whole month" }));
        if (await whole.count()) await whole.first().click();
        await sleep(1500);
        let entry = cal
          .getByRole("link")
          .filter({ hasText: `C-${num}` })
          .filter({ hasText: "near check" });
        if (!(await entry.count()) && isoPlusDays(10).slice(0, 7) !== isoPlusDays(0).slice(0, 7)) {
          await cal.getByRole("button", { name: "Next month" }).click();
          await sleep(1500);
          entry = cal
            .getByRole("link")
            .filter({ hasText: `C-${num}` })
            .filter({ hasText: "near check" });
        }
        if (await entry.count()) {
          const entryText = await text(entry.first());
          const href = await entry.first().getAttribute("href");
          await entry.first().click();
          await sleep(1500);
          dateEvidence = `Dates approaching showed only its first rows ("${datesText.slice(0, 60)}…"); View all opened Your dates, which lists "${entryText}" -> ${href}; the link opened ${new URL(p.url()).pathname}`;
        } else {
          dateEvidence = `Dates approaching and Your dates did not show C-${num}: "${(await text(cal)).slice(0, 300)}"`;
        }
      }
      expectThat(landed.startsWith(`/contracts/${num}`), `landed ${landed}`);
      expectThat(
        /lists "/.test(dateEvidence) && dateEvidence.includes(`/contracts/${num}`),
        `${dateEvidence}; contracts "${contractsText.slice(0, 300)}"`,
      );
      return `Home sections: ${regions.join(", ")}. ${homeTaskText}. My Tasks listed "${title}" and its link opened ${landed}. ${dateEvidence}.`;
    },
  );

  await step(
    "Negative: an archived Contract is read-only for Tasks and Key dates; Restore allows changes again",
    "No add, complete or date controls while archived; writes are refused",
    async () => {
      const a = await actor.api("POST", `/contracts/${num}/archive`);
      expectThat(a.status === 200, `archive ${a.status}`);
      let region = await tasksTab();
      const addTask = await region.getByRole("button", { name: "Add task" }).count();
      const enabledBoxes = await region
        .getByRole("checkbox")
        .evaluateAll(
          (els) =>
            els.filter((e) => !e.disabled && e.getAttribute("aria-disabled") !== "true").length,
        );
      const kd = await keyDatesTab();
      const addDate = await kd.getByRole("button", { name: "Add date" }).count();
      const kdActions = await kd.getByRole("button", { name: /^Actions for/ }).count();
      const w1 = await actor.api("POST", `/contracts/${num}/tasks`, {
        title: "DOC-029r2 archived write",
      });
      const w2 = await actor.api("POST", `/contracts/${num}/key-dates`, {
        date: isoPlusDays(5),
        label: "DOC-029r2 archived write",
      });
      const r = await actor.api("POST", `/contracts/${num}/restore`);
      region = await tasksTab();
      const addAfter = await region.getByRole("button", { name: "Add task" }).count();
      expectThat(
        addTask === 0 &&
          enabledBoxes === 0 &&
          addDate === 0 &&
          kdActions === 0 &&
          w1.status === 409 &&
          w2.status === 409 &&
          r.status === 200 &&
          addAfter === 1,
        `addTask ${addTask} boxes ${enabledBoxes} addDate ${addDate} kdActions ${kdActions} w1 ${w1.status} w2 ${w2.status} restore ${r.status} after ${addAfter}`,
      );
      return `Archived: Tasks had ${addTask} Add task buttons and ${enabledBoxes} enabled checkboxes; Key dates had ${addDate} Add date buttons and ${kdActions} row action buttons; Task and Key date writes answered ${w1.status} and ${w2.status}. After Restore (${r.status}) Add task is back.`;
    },
  );

  await step(
    "Negative: a Business User on the Contract team cannot open the Tasks or Key dates sections",
    "Tasks and Key dates remain in the full app; Business Users cannot open these sections",
    async () => {
      const bu = await getBusinessUser();
      const t = await bu.api("GET", `/contracts/${num}/tasks`);
      const k = await bu.api("GET", `/contracts/${num}/key-dates`);
      await bu.page.goto(`${BASE}/contracts/${num}/tasks`);
      await sleep(2500);
      const landed = new URL(bu.page.url()).pathname;
      const body = await text(bu.page.locator("body"));
      const sawTasks = /Add task|of \d+ done|No tasks on this contract/.test(body);
      expectThat(
        [403, 404].includes(t.status) && [403, 404].includes(k.status) && !sawTasks,
        `tasks ${t.status} keydates ${k.status} landed ${landed}`,
      );
      return `${PEOPLE.businessUser.name} (Business User, on the team) got ${t.status} for Tasks and ${k.status} for Key dates; opening /contracts/${num}/tasks landed on ${landed} without a Tasks section.`;
    },
  );
}
