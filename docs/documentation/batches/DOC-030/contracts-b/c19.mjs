// V-C19: "Manage Contract Tasks and Key dates", followed as written for one role.
// Adapted from DOC-029 contracts-b/c19-r1.mjs for the guide text at 74eda329.
export async function runC19(ctx, step) {
  const { actor, role, other, PEOPLE, userId, typeId, stamp, h, sessions, getBusinessUser } = ctx;
  const { expectThat, isoPlusDays, sleep, text, withResponse, BASE, q } = h;
  const p = actor.page;
  const tag = `${role} ${stamp}`;
  const T = (s) => `DOC-030 contracts-b V-C19 ${s} ${tag}`;
  const addCandidate = role === "administrator" ? "Tom Iwu" : "Priya Raman";
  const rowCandidate = role === "administrator" ? "Marcus Oyelaran" : "Ines Duarte";
  const bu = PEOPLE.business_user_team;
  let num;

  const tasksTab = async () => {
    await p.goto(`${BASE}/contracts/${num}/tasks`);
    try {
      await p.getByRole("region", { name: "Tasks" }).waitFor({ timeout: 25000 });
    } catch {
      await p.reload();
      await p.getByRole("region", { name: "Tasks" }).waitFor({ timeout: 45000 });
      ctx.notes.push(`${role}: Tasks section for C-${num} did not render within 25 s once; a reload rendered it`);
    }
    await sleep(700);
    return p.getByRole("region", { name: "Tasks" });
  };
  const keyDatesTab = async () => {
    await p.goto(`${BASE}/contracts/${num}/key-dates`);
    try {
      await p.getByRole("region", { name: "Key dates" }).waitFor({ timeout: 20000 });
    } catch {
      await p.reload();
      await p.getByRole("region", { name: "Key dates" }).waitFor({ timeout: 30000 });
      ctx.notes.push(`Key dates section for C-${num} did not render within 20 s once; a reload rendered it`);
    }
    await sleep(700);
    return p.getByRole("region", { name: "Key dates" });
  };
  const apiTasks = async () => (await actor.api("GET", `/contracts/${num}/tasks`)).json;
  const teamNames = async () =>
    JSON.stringify((await actor.api("GET", `/contracts/${num}`)).json.team ?? []);
  const taskComments = async (id) =>
    (await actor.api("GET", `/comments?entityType=contract_task&entityId=${id}`)).json?.comments ?? [];
  const taskOrder = async (region) =>
    (await region.getByRole("checkbox").evaluateAll((els) => els.map((e) => e.getAttribute("aria-label"))))
      .filter(Boolean)
      .map((s) => s.replace(/^(Complete|Reopen) task: /, ""));
  const kdRows = async () => {
    const region = await keyDatesTab();
    const rows = region.getByRole("row");
    const n = await rows.count();
    const out = [];
    for (let i = 1; i < n; i++)
      out.push({ text: await text(rows.nth(i)), actions: await rows.nth(i).getByRole("button", { name: /^Actions for/ }).count() });
    return out;
  };
  const openKdDialog = async (label) => {
    const region = await keyDatesTab();
    await region.getByRole("button", { name: `Actions for ${label}` }).click();
    await p.getByRole("menuitem", { name: "Edit date" }).click();
    const dialog = p.getByRole("dialog", { name: "Edit key date" });
    await dialog.waitFor();
    await dialog.getByRole("group", { name: "Reminders" }).getByText(/^Global reminders:/).waitFor();
    return dialog;
  };

  await step(
    "Before you start: an unarchived Contract with the acting role as Legal Owner, the other staff role and a Business User on the Contract team",
    "Prerequisite record exists for this role",
    async () => {
      const created = await actor.api("POST", "/contracts", {
        title: T("record"),
        contractTypeId: typeId("NDA"),
        managerId: userId(PEOPLE[role].name),
      });
      expectThat(created.status === 201, `create ${created.status} ${created.text.slice(0, 200)}`);
      num = created.json.contract.number;
      for (const name of [PEOPLE[other].name, bu.name]) {
        const t = await actor.api("POST", `/contracts/${num}/team`, { userId: userId(name) });
        expectThat(t.status < 300, `team ${name} ${t.status}`);
      }
      ctx.records.push({ article: "contract-tasks-and-dates", role, reference: `C-${num}`, title: T("record") });
      return `Setup API as ${role}: C-${num} "${T("record")}" (NDA) with Legal Owner ${PEOPLE[role].name}; team adds ${PEOPLE[other].name} and ${bu.name} (Business User).`;
    },
  );

  await step(
    "Maintain Tasks step 1-3: Add task; the Assignee picker offers active team people and the Legal Owner, not Business Users; Add someone to the team… then Use this person, then Cancel",
    "Cancel before saving creates neither the Task nor a staged team addition",
    async () => {
      const region = await tasksTab();
      await region.getByRole("button", { name: "Add task" }).click();
      const dialog = p.getByRole("dialog", { name: "Add a task" });
      await dialog.getByRole("textbox", { name: "Title" }).fill(T("cancelled"));
      await dialog.getByRole("button", { name: "Assignee" }).click();
      const picker = p.getByRole("dialog", { name: "Assign task" });
      await picker.waitFor();
      const offered = (await picker.getByRole("button").allTextContents()).map((s) => s.trim()).filter(Boolean);
      expectThat(
        offered.some((s) => s.includes(PEOPLE[role].name)) && offered.some((s) => s.includes(PEOPLE[other].name)),
        `offered ${offered.join(", ")}`,
      );
      expectThat(offered.some((s) => /^Unassigned/.test(s)), `no Unassigned in ${offered.join(", ")}`);
      expectThat(!offered.some((s) => s.includes(bu.name)), `Business User offered: ${offered.join(", ")}`);
      await picker.getByRole("button", { name: "Add someone to the team…" }).click();
      await picker.getByRole("textbox", { name: "Search people" }).fill(addCandidate.split(" ")[0]);
      await picker.getByRole("button", { name: addCandidate }).click();
      const pickerText = await text(picker);
      await picker.getByRole("button", { name: "Use this person" }).click();
      await sleep(400);
      const shown = await text(dialog.getByRole("button", { name: "Assignee" }));
      await dialog.getByRole("button", { name: "Cancel" }).click();
      await dialog.waitFor({ state: "hidden" });
      const tasks = await apiTasks();
      const team = await teamNames();
      expectThat(!tasks.tasks.some((t) => t.title === T("cancelled")), "cancelled task exists");
      expectThat(!team.includes(addCandidate), `${addCandidate} was added to the team`);
      return `Tasks -> Add task -> Assignee: the picker offered ${q(offered)} (no ${bu.name}). Add someone to the team… -> ${addCandidate} showed ${q(pickerText.slice(0, 260))}; Use this person set Assignee to "${shown}". Cancel: no Task saved and ${addCandidate} is not on the team.`;
    },
    { page: p },
  );

  await step(
    "Maintain Tasks step 2-3: Add task with Title, Description, a staged team addition as Assignee, Due date, and an initial note with a file under Comments & attachments; check the new row",
    "The Task saves with its assignee added to the team; the initial note is readable to everyone who can open the Task (no audience choice)",
    async () => {
      const region = await tasksTab();
      await region.getByRole("button", { name: "Add task" }).click();
      const dialog = p.getByRole("dialog", { name: "Add a task" });
      const title = T("review notice");
      await dialog.getByRole("textbox", { name: "Title" }).fill(title);
      await dialog.getByRole("textbox", { name: "Description" }).fill("Check the notice clause against the signed paper.");
      await dialog.getByRole("button", { name: "Assignee" }).click();
      const picker = p.getByRole("dialog", { name: "Assign task" });
      await picker.getByRole("button", { name: "Add someone to the team…" }).click();
      await picker.getByRole("textbox", { name: "Search people" }).fill(addCandidate.split(" ")[0]);
      await picker.getByRole("button", { name: addCandidate }).click();
      await picker.getByRole("button", { name: "Use this person" }).click();
      await dialog.getByRole("textbox", { name: "Due date" }).fill(isoPlusDays(20));
      await dialog.getByRole("textbox", { name: "Add a note" }).fill("DOC-030 initial note for the reviewer.");
      const composerText = await text(dialog);
      const audienceGroups = await dialog.getByRole("group", { name: "Audience" }).count();
      const audienceRadios = await dialog.getByRole("radio").count();
      await dialog.locator("input[type=file]").first().setInputFiles(ctx.taskFile);
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
      await details.getByRole("button", { name: "Close" }).first().click();
      expectThat(task && task.assigneeName === addCandidate && task.dueDate === isoPlusDays(20), `task ${q(task)}`);
      expectThat(team.includes(addCandidate), `${addCandidate} not on team`);
      expectThat(audienceGroups === 0 && audienceRadios === 0, `audience group ${audienceGroups} radios ${audienceRadios}`);
      expectThat(!/Legal Only|Legal only|Working team/.test(composerText), `composer offers a tier: ${composerText.slice(0, 400)}`);
      const otherRead = await ctx.otherSession.api("GET", `/comments?entityType=contract_task&entityId=${task.id}`);
      const otherSees = JSON.stringify(otherRead.json ?? {}).includes("DOC-030 initial note");
      expectThat(otherRead.status === 200 && otherSees, `other team member read ${otherRead.status} sees ${otherSees}`);
      expectThat(detailsText.includes("DOC-030 initial note") && detailsText.includes(ctx.taskFileName), `details ${detailsText.slice(0, 400)}`);
      return `Add a task dialog with a typed note: Comments & attachments has no Audience group, no audience radio and no Legal Only or Working team wording (${q(composerText.slice(composerText.indexOf("Comments"), composerText.indexOf("Comments") + 90))}). ${PEOPLE[other].name}, another team member, can read the initial note (comments read ${otherRead.status}). Saved row: "${rowText}". Task assigned to ${task.assigneeName}, due ${task.dueDate}; ${addCandidate} joined the Contract team on save. Task details shows the initial note and ${ctx.taskFileName}.`;
    },
    { page: p },
  );

  await step(
    "Partial save: the Task saves but its initial note fails; Retry note & attachments posts the note without creating another Task",
    "Retry note & attachments retries the pending comment only; the Task that saved is kept",
    async () => {
      const region = await tasksTab();
      await region.getByRole("button", { name: "Add task" }).click();
      const dialog = p.getByRole("dialog", { name: "Add a task" });
      const title = T("retry");
      await dialog.getByRole("textbox", { name: "Title" }).fill(title);
      await dialog.getByRole("textbox", { name: "Add a note" }).fill("DOC-030 note that fails once.");
      let failed = 0;
      const handler = async (route) => {
        if (route.request().method() === "POST" && failed === 0) {
          failed++;
          return route.fulfill({ status: 503, contentType: "application/problem+json", body: JSON.stringify({ title: "Service Unavailable", status: 503 }) });
        }
        return route.continue();
      };
      await p.route("**/api/v1/comments", handler);
      await dialog.getByRole("button", { name: "Add task" }).click();
      const retry = dialog.getByRole("button", { name: "Retry note & attachments" });
      await retry.waitFor({ timeout: 15000 });
      const message = await text(dialog.getByRole("alert").first()).catch(() => "(no alert)");
      const between = (await apiTasks()).tasks.filter((t) => t.title === title).length;
      await p.unroute("**/api/v1/comments", handler);
      await retry.click();
      await dialog.waitFor({ state: "hidden", timeout: 15000 }).catch(() => {});
      const stillOpen = await dialog.isVisible().catch(() => false);
      if (stillOpen) await dialog.getByRole("button", { name: /Close|Cancel/ }).first().click();
      const tasks = (await apiTasks()).tasks.filter((t) => t.title === title);
      const comments = await taskComments(tasks[0].id);
      expectThat(failed === 1 && between === 1 && tasks.length === 1 && comments.length === 1, `failed ${failed} between ${between} tasks ${tasks.length} comments ${comments.length}`);
      return `With one comment POST answered 503 by the reviewer's browser route, the dialog said "${message}" and offered Retry note & attachments; ${between} Task existed. After Retry note & attachments there is ${tasks.length} Task "${title}" with ${comments.length} comment; the dialog ${stillOpen ? "stayed open and was closed" : "closed"}.`;
    },
    { page: p },
  );

  await step(
    "Maintain Tasks step 4: complete a Task with its checkbox, find it with Show completed, reopen it, and check the done count in the section header",
    "A completed Task leaves the list until Show completed is on; reopening restores it; the header count reads like 1 of 3 done",
    async () => {
      const title = T("retry");
      let region = await tasksTab();
      const countBefore = await text(region.getByText(/\d+ of \d+ done/));
      await withResponse(p, (r) => r.request().method() !== "GET" && r.url().includes("/tasks/"), () =>
        region.getByRole("checkbox", { name: `Complete task: ${title}` }).click(),
      );
      await sleep(900);
      const hidden = (await region.getByRole("button", { name: title, exact: true }).count()) === 0;
      const countDone = await text(region.getByText(/\d+ of \d+ done/));
      await region.getByRole("switch", { name: "Show completed" }).click();
      await sleep(700);
      const shown = (await region.getByRole("button", { name: title, exact: true }).count()) === 1;
      const box = region.getByRole("checkbox", { name: new RegExp(title) });
      const boxLabel = await box.getAttribute("aria-label");
      const checked = await box.isChecked();
      await withResponse(p, (r) => r.request().method() !== "GET" && r.url().includes("/tasks/"), () => box.click());
      region = await tasksTab();
      const countAfter = await text(region.getByText(/\d+ of \d+ done/));
      const t = (await apiTasks()).tasks.find((x) => x.title === title);
      expectThat(hidden && shown && checked && !t.isDone, `hidden ${hidden} shown ${shown} checked ${checked} done ${t.isDone}`);
      expectThat(/^0 of 2 done$/.test(countBefore) && /^1 of 2 done$/.test(countDone) && /^0 of 2 done$/.test(countAfter), `counts ${countBefore} / ${countDone} / ${countAfter}`);
      return `Header count "${countBefore}" -> "${countDone}" after completion; the row left the list; Show completed showed it with a checked box ("${boxLabel}"); selecting the checkbox again reopened it ("${countAfter}", isDone ${t.isDone}).`;
    },
    { page: p },
  );

  await step(
    "Maintain Tasks step 5: open details from the title and from Edit task, Save an edit, Remove task on an empty Task; a Task with conversation history cannot be removed, also after its comment is deleted",
    "Edits persist; Remove task removes only a Task without conversation history",
    async () => {
      const retryTitle = T("retry");
      const emptyTitle = T("empty");
      const e = await actor.api("POST", `/contracts/${num}/tasks`, { title: emptyTitle });
      expectThat(e.status === 201, `empty task ${e.status}`);
      let region = await tasksTab();
      await region.getByRole("button", { name: emptyTitle, exact: true }).click();
      let details = p.getByRole("dialog", { name: "Task details" });
      const edited = `${emptyTitle} edited`;
      await details.getByRole("textbox", { name: "Title" }).fill(edited);
      await withResponse(p, (r) => r.request().method() === "PATCH", () => details.getByRole("button", { name: "Save" }).click());
      await sleep(800);
      if (await details.isVisible()) await details.getByRole("button", { name: "Close" }).first().click();
      region = await tasksTab();
      const editedShown = (await region.getByRole("button", { name: edited, exact: true }).count()) === 1;
      await region.getByRole("button", { name: `Actions for ${edited}` }).click();
      const menuItems = (await p.getByRole("menuitem").allTextContents()).map((s) => s.trim());
      await p.getByRole("menuitem", { name: "Edit task" }).click();
      details = p.getByRole("dialog", { name: "Task details" });
      await details.waitFor();
      const editOpened = (await details.getByRole("textbox", { name: "Title" }).inputValue()) === edited;
      await details.getByRole("button", { name: "Close" }).first().click();
      await details.waitFor({ state: "hidden" });
      await region.getByRole("button", { name: `Actions for ${edited}` }).click();
      const s = await withResponse(p, (r) => r.request().method() === "DELETE", () => p.getByRole("menuitem", { name: "Remove task" }).click());
      await sleep(800);
      const removed = !(await apiTasks()).tasks.some((t) => t.title === edited);
      region = await tasksTab();
      await region.getByRole("button", { name: `Actions for ${retryTitle}` }).click();
      const s2 = await withResponse(p, (r) => r.request().method() === "DELETE", () => p.getByRole("menuitem", { name: "Remove task" }).click());
      await sleep(900);
      const tasksText = await text(p.getByRole("region", { name: "Tasks" }));
      const alerts = (await p.getByRole("alert").allTextContents()).map((x) => x.trim()).filter(Boolean);
      const refusal = alerts.find((a) => /conversation|history|comment|cannot|could not/i.test(a)) ?? tasksText.match(/[^.]*(cannot|could not|conversation|history)[^.]*\./i)?.[0]?.trim() ?? "(no refusal text found)";
      const kept = (await apiTasks()).tasks.some((t) => t.title === retryTitle);
      const task = (await apiTasks()).tasks.find((t) => t.title === retryTitle);
      const comments = await taskComments(task.id);
      const del = await actor.api("DELETE", `/comments/${comments[0].id}`);
      region = await tasksTab();
      await region.getByRole("button", { name: `Actions for ${retryTitle}` }).click();
      const s3 = await withResponse(p, (r) => r.request().method() === "DELETE", () => p.getByRole("menuitem", { name: "Remove task" }).click());
      await sleep(800);
      const kept2 = (await apiTasks()).tasks.some((t) => t.title === retryTitle);
      expectThat(editedShown && editOpened && s < 300 && removed, `edit ${editedShown} open ${editOpened} remove ${s} removed ${removed}`);
      expectThat(menuItems.includes("Edit task") && menuItems.includes("Remove task"), `menu ${q(menuItems)}`);
      expectThat(s2 === 409 && kept && del.status < 300 && s3 === 409 && kept2, `refusal ${s2} kept ${kept} delete ${del.status} again ${s3} kept ${kept2}`);
      return `Title click opened Task details; Save persisted "${edited}". The row actions menu offered ${q(menuItems)}; Edit task opened the same details. Remove task on the empty Task answered ${s} and removed it. Remove task on the Task with a note answered ${s2} ("${refusal}") and kept it; after its comment was deleted (setup API ${del.status}) Remove task still answered ${s3} and the Task stayed.`;
    },
    { page: p },
  );

  await step(
    "Change who is responsible from the row's assignee: Add someone to the team… shows the access notice and Add to team and assign; later changing to Unassigned keeps the team membership",
    "The person joins the Contract team and is assigned; clearing the assignee does not remove team membership",
    async () => {
      const title = T("retry");
      let region = await tasksTab();
      await region.getByRole("button", { name: `Change assignee for ${title}: Unassigned` }).click();
      const picker = p.getByRole("dialog", { name: "Assign task" });
      await picker.getByRole("button", { name: "Add someone to the team…" }).click();
      await picker.getByRole("textbox", { name: "Search people" }).fill(rowCandidate.split(" ")[0]);
      await picker.getByRole("button", { name: rowCandidate }).click();
      const notice = await text(picker);
      await withResponse(p, (r) => r.request().method() === "PATCH", () => picker.getByRole("button", { name: "Add to team and assign" }).click());
      await sleep(900);
      const t1 = (await apiTasks()).tasks.find((t) => t.title === title);
      const team1 = await teamNames();
      region = await tasksTab();
      await region.getByRole("button", { name: `Change assignee for ${title}: ${rowCandidate}` }).click();
      await withResponse(p, (r) => r.request().method() === "PATCH", () =>
        p.getByRole("dialog", { name: "Assign task" }).getByRole("button", { name: "Unassigned" }).click(),
      );
      await sleep(900);
      const t2 = (await apiTasks()).tasks.find((t) => t.title === title);
      const team2 = await teamNames();
      expectThat(/team/i.test(notice), `no access notice: ${notice.slice(0, 300)}`);
      expectThat(t1.assigneeName === rowCandidate && team1.includes(rowCandidate), `assigned ${t1.assigneeName}`);
      expectThat(t2.assigneeId === null && team2.includes(rowCandidate), `after clear ${t2.assigneeId}`);
      return `Row assignee -> Add someone to the team… -> ${rowCandidate}: picker read ${q(notice.slice(0, 300))}; Add to team and assign made ${t1.assigneeName} the assignee and a team member. Choosing Unassigned cleared the assignee; ${rowCandidate} is still on the team.`;
    },
    { page: p },
  );

  await step(
    "Task details conversation: no audience choice, readable to everyone who can open the Task, separate from the record conversation",
    "The composer has no Legal Only / Working team choice and states the task audience; the Task note is not in the record conversation",
    async () => {
      const title = T("review notice");
      const region = await tasksTab();
      await region.getByRole("button", { name: title, exact: true }).click();
      const details = p.getByRole("dialog", { name: "Task details" });
      await details.waitFor();
      await sleep(1200);
      const dText = await text(details);
      const audienceGroups = await details.getByRole("group", { name: "Audience" }).count();
      const tierWords = /Legal Only|Legal only|Working team/.test(dText);
      await details.getByRole("button", { name: "Close" }).first().click();
      const contractId = (await actor.api("GET", `/contracts/${num}`)).json.contract.id;
      const recordThread = (await actor.api("GET", `/comments?entityType=contract&entityId=${contractId}`)).json;
      const leaked = JSON.stringify(recordThread).includes("DOC-030 initial note");
      expectThat(audienceGroups === 0 && !tierWords, `audience group ${audienceGroups}; tier words ${tierWords}: ${dText.slice(0, 400)}`);
      expectThat(/Visible to everyone who can access this task\./.test(dText), `no audience sentence: ${dText.slice(0, 400)}`);
      expectThat(!leaked, "Task note appears in the record conversation");
      return `Task details for "${title}": Comments & attachments shows the initial note, no Audience group and no Legal Only or Working team wording; it says "Visible to everyone who can access this task." The Contract's own conversation does not contain the Task note.`;
    },
    { page: p },
  );

  await step(
    "Task order: Tasks keep the order in which they were added; a new Task goes to the end; completing, editing, or reassigning does not move it; no reordering control, and dragging a row does not change the order",
    "Displayed order equals added order before and after complete/edit/reassign and a drag attempt",
    async () => {
      let region = await tasksTab();
      await region.getByRole("switch", { name: "Show completed" }).click().catch(() => {});
      await sleep(500);
      const before = await taskOrder(region);
      const newTitle = T("added last");
      await region.getByRole("button", { name: "Add task" }).click();
      const dialog = p.getByRole("dialog", { name: "Add a task" });
      await dialog.getByRole("textbox", { name: "Title" }).fill(newTitle);
      await dialog.getByRole("button", { name: "Add task" }).click();
      await dialog.waitFor({ state: "hidden", timeout: 20000 });
      region = await tasksTab();
      const afterAdd = await taskOrder(region);
      const first = afterAdd[0];
      await withResponse(p, (r) => r.request().method() !== "GET" && r.url().includes("/tasks/"), () =>
        region.getByRole("checkbox", { name: `Complete task: ${first}` }).click(),
      );
      await sleep(700);
      await region.getByRole("switch", { name: "Show completed" }).click();
      await sleep(600);
      const afterComplete = await taskOrder(region);
      await region.getByRole("checkbox", { name: new RegExp(first) }).click();
      await sleep(800);
      region = await tasksTab();
      await region.getByRole("button", { name: `Change assignee for ${newTitle}: Unassigned` }).click();
      await withResponse(p, (r) => r.request().method() === "PATCH", () =>
        p.getByRole("dialog", { name: "Assign task" }).getByRole("button", { name: PEOPLE[role].name }).first().click(),
      );
      await sleep(700);
      region = await tasksTab();
      const afterReassign = await taskOrder(region);
      const dragHandles = await region.locator("[draggable=true]").count();
      const moveButtons = await region.getByRole("button", { name: /move|reorder|drag|up|down/i }).count();
      const rows = region.getByRole("listitem");
      const src = rows.filter({ hasText: newTitle }).first();
      const dst = rows.first();
      const sb = await src.boundingBox();
      const db = await dst.boundingBox();
      let reorderCalls = 0;
      const watch = (r) => { if (/\/tasks\/reorder/.test(r.url())) reorderCalls++; };
      p.on("request", watch);
      await p.mouse.move(sb.x + 40, sb.y + sb.height / 2);
      await p.mouse.down();
      await p.mouse.move(db.x + 40, db.y + 4, { steps: 12 });
      await p.mouse.up();
      await sleep(800);
      p.off("request", watch);
      region = await tasksTab();
      const afterDrag = await taskOrder(region);
      const apiOrder = (await apiTasks()).tasks.map((t) => t.title);
      expectThat(afterAdd.at(-1) === newTitle && afterAdd.slice(0, -1).join("|") === before.join("|"), `after add ${q(afterAdd)} before ${q(before)}`);
      expectThat([afterComplete, afterReassign, afterDrag].every((o) => o.join("|") === afterAdd.join("|")), `orders ${q({ afterComplete, afterReassign, afterDrag })}`);
      expectThat(dragHandles === 0 && moveButtons === 0 && reorderCalls === 0, `drag ${dragHandles} move ${moveButtons} reorder calls ${reorderCalls}`);
      return `Order with Show completed on: ${q(before)}. Add task "${newTitle}" appended it at the end. Completing "${first}", then reopening it, and reassigning "${newTitle}" to ${PEOPLE[role].name} left the order ${q(afterReassign)}. The section has ${dragHandles} draggable elements and ${moveButtons} move/reorder buttons; a mouse drag of the last row onto the first sent ${reorderCalls} reorder request and the order stayed ${q(afterDrag)} (API order ${q(apiOrder)}).`;
    },
    { page: p },
  );

  await step(
    "Maintain Key dates steps 1-5: Add date with Date, Event, Note; Global reminders and This date will remind; Additional lead time 0 to 730, at most 20, Remove; Recipients checkboxes include active Business Users on the team; select one; Add date; check the row and Key date source",
    "The Key date saves with source Key date; lead times follow the 0 to 730 and 20 rules; Recipients list active team members including Business Users",
    async () => {
      const region = await keyDatesTab();
      await region.getByRole("button", { name: "Add date" }).click();
      const dialog = p.getByRole("dialog", { name: "Add a key date" });
      await dialog.getByRole("textbox", { name: "Date" }).fill(isoPlusDays(40));
      await dialog.getByRole("textbox", { name: "Event" }).fill(T("price review"));
      await dialog.getByRole("textbox", { name: "Note" }).fill("Fictional price review window.");
      const reminders = dialog.getByRole("group", { name: "Reminders" });
      await reminders.getByText(/^Global reminders:/).waitFor();
      const global = await text(reminders.getByText(/^Global reminders:/));
      const lead = reminders.getByRole("spinbutton", { name: "Additional lead time (days before)" });
      const add = reminders.getByRole("button", { name: "Add lead time" });
      await lead.fill("731");
      const disabled731 = await add.isDisabled();
      await lead.fill("-1");
      const disabledNeg = await add.isDisabled();
      await lead.fill("0");
      const zeroEnabled = await add.isEnabled();
      await lead.fill("45");
      await add.click();
      const globalDays = [...global.matchAll(/(\d+) days? before/g)].map((m) => m[1]);
      const dup = globalDays[0] ?? "30";
      await lead.fill(dup);
      const dupEnabled = await add.isEnabled();
      if (dupEnabled) await add.click();
      const combined = await text(reminders.getByText(/^This date will remind:/));
      // Up to 20 additional lead times.
      let added = await reminders.getByRole("button", { name: /^Remove \d+ days? before$|^Remove On the day$/ }).count();
      for (let d = 100; added < 20 && d < 140; d++) {
        await lead.fill(String(d));
        if (await add.isDisabled()) break;
        await add.click();
        added = await reminders.getByRole("button", { name: /^Remove \d+ days? before$|^Remove On the day$/ }).count();
      }
      await lead.fill("200");
      const twentyFirstDisabled = await add.isDisabled();
      const at20 = added;
      for (let d = 100; d < 140; d++) {
        const b = reminders.getByRole("button", { name: `Remove ${d} days before` });
        if (await b.count()) await b.click();
      }
      await lead.fill("");
      const afterRemove = await text(reminders.getByText(/^This date will remind:/));
      const globalStill = await text(reminders.getByText(/^Global reminders:/));
      const recipients = await reminders.getByRole("checkbox").evaluateAll((els) =>
        els.map((e) => (e.closest("label")?.textContent ?? e.getAttribute("aria-label") ?? "").trim()),
      );
      await reminders.getByRole("checkbox", { name: PEOPLE[other].name }).check();
      const resetShown = await reminders.getByRole("button", { name: "Use the usual audience" }).count();
      await dialog.getByRole("button", { name: "Add date" }).click();
      await dialog.waitFor({ state: "hidden", timeout: 15000 });
      const rows = await kdRows();
      const row = rows.find((r) => r.text.includes(T("price review")));
      const thirtyCount = (combined.match(new RegExp(`\\b${dup} days before`, "g")) ?? []).length;
      expectThat(disabled731 && disabledNeg && zeroEnabled, `731 disabled ${disabled731}; -1 disabled ${disabledNeg}; 0 enabled ${zeroEnabled}`);
      expectThat(/45 days before/.test(combined) && thirtyCount === 1, `combined "${combined}"`);
      expectThat(at20 === 20 && twentyFirstDisabled, `at most 20: added ${at20}, 21st disabled ${twentyFirstDisabled}`);
      expectThat(!/10\d days before/.test(afterRemove) && /45 days before/.test(afterRemove) && globalStill === global, `after remove "${afterRemove}" global "${globalStill}"`);
      expectThat(recipients.some((r) => r.includes(PEOPLE[other].name)) && recipients.some((r) => r.includes(bu.name)) && recipients.some((r) => r.includes(PEOPLE[role].name)), `recipients ${q(recipients)}`);
      expectThat(resetShown === 1, `Use the usual audience shown ${resetShown}`);
      expectThat(row && /Key date/.test(row.text) && row.actions === 1, `row ${q(row)}`);
      return `"${global}". 731 and -1 left Add lead time disabled; 0 enabled it. After adding 45 and ${dup} (${dup} is global; Add lead time ${dupEnabled ? "enabled" : "disabled"}): "${combined}" (${dup} appears once). With ${at20} additional lead times Add lead time was ${twentyFirstDisabled ? "disabled" : "enabled"} for a 21st. Remove on the 10x-day entries left "${afterRemove}"; Global reminders unchanged. Recipients checkboxes: ${q(recipients)} (includes Business User ${bu.name}). Selecting ${PEOPLE[other].name} showed Use the usual audience. Saved row "${row.text}" with one actions button.`;
    },
    { page: p },
  );

  await step(
    "Maintain Key dates step 6 and list order: Edit date then Cancel leaves the date unchanged; Edit date then Save changes it; Remove date removes another; Derived rows have no actions; upcoming nearest first, past most recent first",
    "Key date edits persist, Cancel changes nothing, and the combined list keeps the stated order",
    async () => {
      const addKd = async (date, label) => {
        const r = await actor.api("POST", `/contracts/${num}/key-dates`, { date, label });
        expectThat(r.status === 201, `key date ${label} ${r.status}`);
      };
      await addKd(isoPlusDays(-10), T("past recent"));
      await addKd(isoPlusDays(-40), T("past older"));
      await addKd(isoPlusDays(10), T("near check"));
      await addKd(isoPlusDays(200), T("remove me"));
      const ex = await actor.api("PATCH", `/contracts/${num}`, { expiryDate: isoPlusDays(300) });
      expectThat(ex.status === 200, `expiry ${ex.status}`);
      const label = T("price review");
      let region = await keyDatesTab();
      await region.getByRole("button", { name: `Actions for ${label}` }).click();
      const kdMenu = (await p.getByRole("menuitem").allTextContents()).map((s) => s.trim());
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
      await region.getByRole("button", { name: `Actions for ${T("remove me")}` }).click();
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
      const derived = rows.filter((r) => /Derived/.test(r.text));
      expectThat(!cancelled && idx(`${label} saved`) >= 0 && idx(T("remove me")) < 0, `cancelled ${cancelled}; rows ${texts.join(" | ")}`);
      expectThat(derived.length >= 1 && derived.every((r) => r.actions === 0), `derived ${q(derived)}`);
      const exp = texts.findIndex((t) => /expir/i.test(t) && /Derived/.test(t));
      expectThat(
        idx(T("near check")) < idx(`${label} saved`) && idx(`${label} saved`) < exp && exp < idx(T("past recent")) && idx(T("past recent")) < idx(T("past older")),
        `order ${texts.join(" | ")}`,
      );
      return `Row menu ${q(kdMenu)}. Cancel kept the event; Save changed it to "${label} saved"; Remove date (${confirmText}) removed "remove me". Rows in order: ${texts.join(" | ")}. ${derived.length} Derived row(s), none with an actions button. Upcoming nearest first; past dates follow, ${isoPlusDays(-10)} before ${isoPlusDays(-40)}.`;
    },
    { page: p },
  );

  await step(
    "Missing recipients: a selected recipient leaves the team; the Edit date dialog says so and offers Remove unavailable recipients while another selected person remains; Use the usual audience clears the selection",
    "The dialog names the change, Remove unavailable recipients keeps only remaining people, and Use the usual audience returns to the default",
    async () => {
      const label = `${T("price review")} saved`;
      let dialog = await openKdDialog(label);
      await dialog.getByRole("group", { name: "Reminders" }).getByRole("checkbox", { name: bu.name }).check();
      await dialog.getByRole("button", { name: "Save" }).click();
      await dialog.waitFor({ state: "hidden" });
      const find = (j) => (j.deadlines ?? j.keyDates ?? []).find((d) => (d.label ?? "").startsWith(label)) ?? JSON.stringify(j).match(/\{[^{}]*"label":"[^"]*price review[^{}]*\}/)?.[0];
      const before = find((await actor.api("GET", `/contracts/${num}/key-dates`)).json);
      const off = await actor.api("DELETE", `/contracts/${num}/team/${userId(PEOPLE[other].name)}`);
      expectThat(off.status < 300, `team removal ${off.status}`);
      try {
        dialog = await openKdDialog(label);
        const reminders = dialog.getByRole("group", { name: "Reminders" });
        await reminders.getByText(/have left the team/).waitFor({ timeout: 10000 });
        const warn = await text(reminders.getByRole("status").filter({ hasText: /left the team/ }));
        const removeBtn = reminders.getByRole("button", { name: "Remove unavailable recipients" });
        const offered = await removeBtn.count();
        await removeBtn.click();
        await sleep(300);
        const warnGone = (await reminders.getByText(/have left the team/).count()) === 0;
        const buChecked = await reminders.getByRole("checkbox", { name: bu.name }).isChecked();
        const reset = reminders.getByRole("button", { name: "Use the usual audience" });
        const resetShown = await reset.count();
        await dialog.getByRole("button", { name: "Save" }).click();
        await dialog.waitFor({ state: "hidden" });
        const mid = find((await actor.api("GET", `/contracts/${num}/key-dates`)).json);
        dialog = await openKdDialog(label);
        await dialog.getByRole("group", { name: "Reminders" }).getByRole("button", { name: "Use the usual audience" }).click();
        const checkedAfterReset = await dialog.getByRole("group", { name: "Reminders" }).getByRole("checkbox", { checked: true }).count();
        await dialog.getByRole("button", { name: "Save" }).click();
        await dialog.waitFor({ state: "hidden" });
        const after = find((await actor.api("GET", `/contracts/${num}/key-dates`)).json);
        const ids = (x) => (typeof x === "string" ? x.match(/"reminderRecipientIds":(\[[^\]]*\])/)?.[1] : q(x?.reminderRecipientIds));
        expectThat(offered === 1 && warnGone && buChecked && resetShown === 1, `offered ${offered} warnGone ${warnGone} bu ${buChecked} reset ${resetShown}`);
        expectThat(ids(before)?.split(",").length === 2 && ids(mid)?.split(",").length === 1 && (ids(after) === "[]" || ids(after) === undefined), `before ${ids(before)} mid ${ids(mid)} after ${ids(after)}`);
        expectThat(checkedAfterReset === 0, `checked after reset ${checkedAfterReset}`);
        return `Saved recipients ${PEOPLE[other].name} and ${bu.name} (${ids(before)}). After ${PEOPLE[other].name} left the team (setup API), Edit date said "${warn}" and offered Remove unavailable recipients; selecting it cleared the notice and kept ${bu.name} checked; Save stored ${ids(mid)}. Use the usual audience then Save left no checkbox selected and stored ${ids(after)}.`;
      } finally {
        await actor.api("POST", `/contracts/${num}/team`, { userId: userId(PEOPLE[other].name) });
      }
    },
    { page: p },
  );

  await step(
    "Personal lead times: the Reminder lead times card under Settings -> Notifications replaces the organization default for this person; This date will remind does not show the personal list",
    "The card exists with Use the organization's default lead times; after switching it off and adding a personal lead time, the Key date dialog still shows only the organization list plus the date's own lead times",
    async () => {
      const prefs0 = (await actor.api("GET", "/me/notification-preferences")).json;
      const own0 = prefs0?.reminderOffsetDays ?? null;
      try {
        await p.goto(`${BASE}/settings`);
        await p.getByRole("link", { name: "Notifications", exact: true }).first().click();
        await p.waitForURL(/\/settings\/notifications/);
        const card = p.getByRole("region", { name: "Reminder lead times" }).or(p.locator("section,div").filter({ has: p.getByRole("heading", { name: "Reminder lead times" }) }).last());
        await p.getByText("Reminder lead times", { exact: true }).first().waitFor();
        const sw = p.getByRole("switch", { name: "Use the organization's default lead times" });
        const on0 = (await sw.getAttribute("aria-checked")) === "true" || (await sw.getAttribute("data-state")) === "checked";
        if (on0) {
          await withResponse(p, (r) => r.request().method() === "PATCH", () => sw.click());
          await sleep(500);
        }
        const list = p.getByRole("list", { name: "Your reminder lead times" });
        const input = p.getByRole("spinbutton", { name: "days before the date" });
        await input.fill("3");
        await withResponse(p, (r) => r.request().method() === "PATCH", () => p.getByRole("button", { name: "Add lead time" }).click());
        await sleep(500);
        const listText = await text(list);
        const own1 = (await actor.api("GET", "/me/notification-preferences")).json?.reminderOffsetDays;
        const dialog = await openKdDialog(`${T("price review")} saved`);
        const reminders = dialog.getByRole("group", { name: "Reminders" });
        const g = await text(reminders.getByText(/^Global reminders:/));
        const c = await text(reminders.getByText(/^This date will remind:/));
        await dialog.getByRole("button", { name: "Cancel" }).click();
        expectThat(Array.isArray(own1) && own1.includes(3), `own list ${q(own1)}`);
        expectThat(!/\b3 days before/.test(g) && !/\b3 days before/.test(c), `dialog shows personal list: ${g} / ${c}`);
        return `Settings -> Notifications shows the Reminder lead times card with "Use the organization's default lead times" (${on0 ? "on" : "off"} at start). Switching it off and adding 3 saved the personal list ${q(own1)} ("${listText}"). The Key date dialog then read "${g}" and "${c}": neither shows the personal 3-day lead time, as the guide warns.`;
      } finally {
        const back = await actor.api("PATCH", "/me/notification-preferences", { reminderOffsetDays: own0 });
        ctx.notes.push(`${role}: personal reminder lead times restored to ${q(own0)} (${back.status}).`);
      }
    },
    { page: p },
  );

  await step(
    "Next deadline in the Contracts list picks the earliest unfinished Task due date, including an overdue Task, before Key dates and term dates",
    "The Next deadline cell shows the overdue Task, then the nearest Key date after the Task is done",
    async () => {
      const overdueTitle = T("overdue");
      const t = await actor.api("POST", `/contracts/${num}/tasks`, { title: overdueTitle, dueDate: isoPlusDays(-3) });
      expectThat(t.status === 201, `overdue task ${t.status}`);
      const readCell = async () => {
        await p.goto(`${BASE}/contracts?q=${encodeURIComponent(`C-${num}`)}`);
        await p.getByRole("heading", { name: "Contracts", level: 1 }).waitFor();
        await sleep(1500);
        let headers = (await p.getByRole("columnheader").allTextContents()).map((x) => x.trim());
        let col = headers.findIndex((hh) => hh === "Next deadline");
        if (col < 0) {
          // The saved view may hide the column; the Default view shows it.
          const viewButton = p.getByRole("region", { name: "Contracts" }).getByRole("button").first();
          const before = await text(viewButton);
          if (before !== "Default view") {
            ctx.restoreView ??= before;
            await viewButton.click();
            await p.getByText("Default view", { exact: true }).last().click();
            await sleep(1500);
            ctx.notes.push(`${role}: Contracts list view switched from "${before}" to Default view to read Next deadline`);
          }
          headers = (await p.getByRole("columnheader").allTextContents()).map((x) => x.trim());
          col = headers.findIndex((hh) => hh === "Next deadline");
        }
        expectThat(col >= 0, `no Next deadline column: ${headers.join(", ")}`);
        for (let i = 0; i < 25; i++) {
          const row = p.getByRole("row").filter({ hasText: T("record") });
          if (await row.count()) return text(row.first().getByRole("cell").nth(col));
          const more = p.getByRole("button", { name: "Show more" });
          if (!(await more.count())) break;
          await more.click();
          await sleep(800);
        }
        throw new Error(`C-${num} not found in the list`);
      };
      const first = await readCell();
      await p.goto(`${BASE}/contracts/${num}/tasks`);
      await withResponse(p, (r) => r.request().method() !== "GET" && r.url().includes("/tasks/"), () =>
        p.getByRole("region", { name: "Tasks" }).getByRole("checkbox", { name: `Complete task: ${overdueTitle}` }).click(),
      );
      const toggled = (await apiTasks()).tasks.find((x) => x.title === overdueTitle);
      const second = await readCell();
      let restored = "made no view change";
      if (ctx.restoreView) {
        const viewButton = p.getByRole("region", { name: "Contracts" }).getByRole("button").first();
        await viewButton.click();
        await p.getByText(ctx.restoreView, { exact: true }).last().click();
        await sleep(1200);
        restored = `re-selected the saved view "${await text(viewButton)}" afterwards`;
        ctx.notes.push(`${role}: Contracts list view restored to "${ctx.restoreView}"`);
        ctx.restoreView = undefined;
      }
      expectThat(first.includes("overdue") && toggled.isDone, `first "${first}" done ${toggled.isDone}`);
      expectThat(second.includes("near check"), `second "${second}"`);
      return `With an open Task due ${isoPlusDays(-3)}, the C-${num} Next deadline cell read "${first}". After the Task was completed in the browser it read "${second}" (the Key date on ${isoPlusDays(10)}; other Tasks, Key dates and the ${isoPlusDays(300)} expiry are later). The reviewer ${restored}.`;
    },
    { page: p },
  );

  await step(
    "Check reminders and your work: Home shows assigned open Tasks and approaching Contract dates in their sections, and their links open the correct Task or Contract",
    "Home lists assigned open Tasks and approaching Contract dates in separate sections with links back",
    async () => {
      const title = T("mine");
      const t = await actor.api("POST", `/contracts/${num}/tasks`, { title, assigneeId: userId(PEOPLE[role].name), dueDate: isoPlusDays(1) });
      expectThat(t.status === 201, `task ${t.status}`);
      await p.goto(`${BASE}/`);
      await p.getByRole("region", { name: "Tasks assigned to you" }).waitFor();
      await sleep(1500);
      const regions = await p.getByRole("main").getByRole("region").evaluateAll((els) => els.map((e) => e.getAttribute("aria-label") ?? e.querySelector("h2")?.textContent));
      let homeTask = p.getByRole("region", { name: "Tasks assigned to you" }).getByRole("link", { name: new RegExp(title) });
      let where = "Home Tasks assigned to you";
      if (!(await homeTask.count())) {
        await p.goto(`${BASE}/home/tasks`);
        homeTask = p.getByRole("link", { name: new RegExp(title) });
        await homeTask.first().waitFor({ timeout: 15000 });
        where = "My Tasks (View all from Home; Home shows its first rows only)";
      }
      const taskHref = await homeTask.first().getAttribute("href");
      await homeTask.first().click();
      await sleep(1500);
      const landed = new URL(p.url()).pathname + new URL(p.url()).search;
      const detailsOpen = await p.getByRole("dialog", { name: "Task details" }).count();
      await p.goto(`${BASE}/`);
      await p.getByRole("region", { name: "Tasks assigned to you" }).waitFor();
      await sleep(1500);
      const dates = p.getByRole("region", { name: "Dates approaching" });
      let dateEvidence = "";
      const dateLink = dates.getByRole("link").filter({ hasText: `C-${num}` });
      if (await dateLink.count()) {
        const href = await dateLink.first().getAttribute("href");
        const tx = await text(dateLink.first());
        await dateLink.first().click();
        await sleep(1200);
        dateEvidence = `Dates approaching lists "${tx}" -> ${href}; it opened ${new URL(p.url()).pathname}`;
      } else {
        await dates.getByRole("button", { name: /View all/ }).or(dates.getByRole("link", { name: /View all/ })).first().click();
        const cal = p.getByRole("dialog", { name: "Your dates" });
        await cal.waitFor();
        await sleep(1500);
        const whole = cal.getByRole("switch", { name: "Show whole month" }).or(cal.getByRole("checkbox", { name: "Show whole month" })).or(cal.getByRole("button", { name: "Show whole month" }));
        if (await whole.count()) await whole.first().click();
        await sleep(1200);
        let entry = cal.getByRole("link").filter({ hasText: `C-${num}` }).filter({ hasText: "near check" });
        if (!(await entry.count()) && isoPlusDays(10).slice(0, 7) !== isoPlusDays(0).slice(0, 7)) {
          await cal.getByRole("button", { name: "Next month" }).click();
          await sleep(1500);
          entry = cal.getByRole("link").filter({ hasText: `C-${num}` }).filter({ hasText: "near check" });
        }
        expectThat(await entry.count(), `Your dates has no C-${num} near check: ${(await text(cal)).slice(0, 300)}`);
        const tx = await text(entry.first());
        const href = await entry.first().getAttribute("href");
        await entry.first().click();
        await sleep(1500);
        dateEvidence = `Dates approaching showed only its first rows; View all opened Your dates, which lists "${tx}" -> ${href}; it opened ${new URL(p.url()).pathname}`;
      }
      expectThat(landed.startsWith(`/contracts/${num}`), `task link landed ${landed}`);
      expectThat(dateEvidence.includes(`/contracts/${num}`), dateEvidence);
      return `Home sections: ${q(regions)}. ${where} lists "${title}" (${taskHref}); its link opened ${landed}${detailsOpen ? " with Task details open" : ""}. ${dateEvidence}. Reminder delivery timing was not exercised.`;
    },
    { page: p },
  );

  await step(
    "If an action is unavailable: an archived Contract is read-only for Tasks and Key dates; restore allows changes again",
    "No Add task, enabled checkbox, Add date or row actions while archived; writes are refused; after restore Add task returns",
    async () => {
      const a = await actor.api("POST", `/contracts/${num}/archive`);
      expectThat(a.status === 200, `archive ${a.status}`);
      let region = await tasksTab();
      const addTask = await region.getByRole("button", { name: "Add task" }).count();
      const taskActions = await region.getByRole("button", { name: /^Actions for/ }).count();
      const enabledBoxes = await region.getByRole("checkbox").evaluateAll((els) => els.filter((e) => !e.disabled && e.getAttribute("aria-disabled") !== "true" && e.getAttribute("data-disabled") === null).length);
      const kd = await keyDatesTab();
      const addDate = await kd.getByRole("button", { name: "Add date" }).count();
      const kdActions = await kd.getByRole("button", { name: /^Actions for/ }).count();
      const w1 = await actor.api("POST", `/contracts/${num}/tasks`, { title: "DOC-030 archived write" });
      const w2 = await actor.api("POST", `/contracts/${num}/key-dates`, { date: isoPlusDays(5), label: "DOC-030 archived write" });
      const r = await actor.api("POST", `/contracts/${num}/restore`);
      region = await tasksTab();
      const addAfter = await region.getByRole("button", { name: "Add task" }).count();
      expectThat(
        addTask === 0 && taskActions === 0 && enabledBoxes === 0 && addDate === 0 && kdActions === 0 && w1.status === 409 && w2.status === 409 && r.status === 200 && addAfter === 1,
        `addTask ${addTask} taskActions ${taskActions} boxes ${enabledBoxes} addDate ${addDate} kdActions ${kdActions} w1 ${w1.status} w2 ${w2.status} restore ${r.status} after ${addAfter}`,
      );
      return `Archived (setup API): Tasks had ${addTask} Add task buttons, ${taskActions} row action menus and ${enabledBoxes} enabled checkboxes; Key dates had ${addDate} Add date buttons and ${kdActions} row action buttons; direct Task and Key date writes answered ${w1.status} and ${w2.status}. After restore (${r.status}) Add task is back.`;
    },
    { page: p },
  );

  await step(
    "If an action is unavailable: a Business User on the Contract team cannot open the Tasks or Key dates sections",
    "Tasks and Key dates remain in the full app; the Business User has no Tasks or Key date section",
    async () => {
      const b = await getBusinessUser();
      const t = await b.api("GET", `/contracts/${num}/tasks`);
      const k = await b.api("GET", `/contracts/${num}/key-dates`);
      await b.page.goto(`${BASE}/contracts/${num}/tasks`);
      await sleep(3000);
      const landed = new URL(b.page.url()).pathname;
      const body = await text(b.page.locator("body"));
      const sawTasks = /Add task|of \d+ done|Add date|Global reminders/.test(body);
      expectThat([403, 404].includes(t.status) && [403, 404].includes(k.status) && !sawTasks, `tasks ${t.status} keydates ${k.status} landed ${landed}`);
      return `${bu.name} (Business User, on the team) got ${t.status} for Tasks and ${k.status} for Key dates; opening /contracts/${num}/tasks landed on ${landed} with no Tasks or Key dates section.`;
    },
    { page: getBusinessUser.page },
  );
}
