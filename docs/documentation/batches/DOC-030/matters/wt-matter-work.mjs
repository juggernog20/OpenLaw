// V-C24 steps for "Manage Matter Tasks, Key dates, and relationships" (matter-work.md), DOC-030.
// Adapted from the DOC-029 round 1 script for the task audience, reminder and Needed by changes.
import { expectThat, q, matterByNumber } from "./lib.mjs";

export default async function matterWork(ctx) {
  const { role, stamp, BASE, api, step, account, actor, other } = ctx;
  const page = actor.page;
  const short = role === "administrator" ? "admin" : "legal";
  const title = (label) => `DOC-030 matters matter-work ${short} ${label} ${stamp}`;
  const day = (days) => new Date(Date.now() + days * 86400000).toISOString().slice(0, 10);
  const s = {};
  const options = (await api(page, "GET", "/matters/options")).json;
  const advisory = options.matterTypes.find((t) => t.displayName === "Advisory");
  const user = (name) => options.users.find((u) => u.displayName === name);
  const closedId = options.matterStatuses.find((x) => x.displayName === "Closed").id;
  const openId = options.matterStatuses.find((x) => x.displayName === "Open").id;
  const tasksRegion = () => page.getByRole("region", { name: "Tasks" });
  const datesRegion = () => page.getByRole("region", { name: "Key dates" });
  const tasks = async () => (await api(page, "GET", `/matters/${s.w}/tasks`)).json;
  const teamNames = async (n = s.w) =>
    (await matterByNumber(page, n)).team.map((p) => p.displayName);
  const dates = async () => (await api(page, "GET", `/matters/${s.w}/key-dates`)).json.deadlines;
  async function gotoTab(tab) {
    await page.goto(`${BASE}/matters/${s.w}/${tab}`);
    await (tab === "tasks" ? tasksRegion() : datesRegion())
      .getByRole("heading", { level: 2 })
      .waitFor();
    await page.waitForLoadState("networkidle");
  }
  async function stagePerson(trigger, name, confirm) {
    await trigger.click();
    const pop = page.getByRole("dialog", { name: "Assign task" });
    await pop.waitFor();
    await pop.getByRole("button", { name: "Add someone to the team…" }).click();
    await pop.getByRole("button", { name, exact: true }).click();
    await pop.getByRole("button", { name: confirm }).click();
    await page.waitForTimeout(500);
  }

  await step(
    "Fixture: a work Matter with a Business User on the team, parent and related candidates, a Confidential Matter related by another reader, and two standalone Contracts",
    "Reviewer prerequisites exist; they are set up through the API and are not article steps.",
    async () => {
      const mk = async (p, label, extra = {}) => {
        const r = await api(p, "POST", "/matters", {
          title: title(label),
          matterTypeId: advisory.id,
          customFields: {},
          ...extra,
        });
        expectThat(r.status === 201, `${label} ${r.status}`);
        return r.json.matter.number;
      };
      s.w = await mk(page, "work", { managerId: user(account.name).id });
      s.p = await mk(page, "parent candidate");
      s.r = await mk(page, "related candidate");
      s.w2 = await mk(page, "second work");
      s.h = await mk(other.page, "hidden related", { isConfidential: true });
      const rel = await api(other.page, "POST", `/matters/${s.h}/relations`, {
        relatedMatterNumber: s.w,
      });
      const team = await api(page, "POST", `/matters/${s.w}/team`, {
        userId: user("Jonas Weber").id,
      });
      const opts = (await api(page, "GET", "/contracts/options")).json;
      const nda = opts.contractTypes.find((c) => c.displayName === "NDA");
      const c1 = await api(page, "POST", "/contracts", {
        title: title("confidential contract"),
        contractTypeId: nda.id,
        isConfidential: true,
      });
      const c2 = await api(page, "POST", "/contracts", {
        title: title("archived contract"),
        contractTypeId: nda.id,
      });
      s.c1 = c1.json.contract.number;
      s.c2 = c2.json.contract.number;
      const cps = (await api(page, "GET", "/counterparties")).json.counterparties;
      s.cp = cps.find((x) => x.name === "Northwind Traders Ltd") ?? cps[0];
      const cp = await api(page, "POST", `/contracts/${s.c1}/counterparties`, {
        counterpartyId: s.cp.id,
      });
      const codes = [rel.status, team.status, c1.status, c2.status, cp.status];
      expectThat(
        codes.every((x) => x < 300),
        `fixture ${codes}`,
      );
      return `Work M-${s.w} (Manager ${account.name}, Jonas Weber on the team), parent candidate M-${s.p}, related candidate M-${s.r}, second work M-${s.w2}; Confidential M-${s.h} created by ${ctx.otherAccount.name} and related to M-${s.w}; Confidential NDA C-${s.c1} with Counterparty ${q(s.cp.name)}; NDA C-${s.c2}.`;
    },
  );

  await step(
    "Maintain Tasks: Add Task without a title is refused; a person staged with Use this person is discarded by Cancel",
    "The dialog refuses a missing title; Cancel before saving saves neither the Task nor the team membership.",
    async () => {
      await gotoTab("tasks");
      await tasksRegion().getByRole("button", { name: "Add Task" }).click();
      const d = page.getByRole("dialog", { name: "Add a Task" });
      await d.waitFor();
      await d.getByRole("button", { name: "Add Task" }).click();
      const refusal = (await d.getByText("Name what needs doing.").innerText()).trim();
      await d.getByLabel("Title").fill("DOC-030 work cancelled task");
      await stagePerson(d.getByRole("button", { name: "Assignee" }), "Tom Iwu", "Use this person");
      const staged = (await d.getByRole("button", { name: "Assignee" }).innerText())
        .replace(/\s+/g, " ")
        .trim();
      const hint = await d
        .getByText("Team membership and assignment are saved when you save the task.")
        .isVisible();
      await d.getByRole("button", { name: "Cancel" }).click();
      await d.waitFor({ state: "hidden" });
      const t = await tasks();
      const team = await teamNames();
      expectThat(
        t.totalCount === 0 && !team.includes("Tom Iwu") && staged.includes("Tom Iwu"),
        `${t.totalCount} ${team} ${staged}`,
      );
      return `Add Task with no title showed ${q(refusal)}. Assignee > Add someone to the team… > Tom Iwu > Use this person showed ${q(staged)}; the hint "Team membership and assignment are saved when you save the task." was visible: ${hint}. Cancel closed the dialog: ${t.totalCount} Tasks, team ${q(team)}.`;
    },
  );

  await step(
    "Maintain Tasks: Add Task with a staged person, due date and Add a note saves the Task, membership and assignment; the note has no audience choice",
    "The dialog offers no audience choice under Comments & attachments; saving the Task saves both team membership and assignment; the initial note posts on the Task conversation, not the record conversation.",
    async () => {
      await tasksRegion().getByRole("button", { name: "Add Task" }).click();
      const d = page.getByRole("dialog", { name: "Add a Task" });
      await d.getByLabel("Title").waitFor();
      const dialogText = (await d.innerText()).replace(/\s+/g, " ");
      const audienceControls =
        (await d.getByRole("group", { name: "Audience" }).count()) +
        (await d.getByRole("radio", { name: /Legal only|Working team/i }).count());
      const section = dialogText.includes("Comments & attachments");
      await d.getByLabel("Title").fill("DOC-030 work review task");
      await d.getByLabel("Description").fill("Fictional task description.");
      await stagePerson(d.getByRole("button", { name: "Assignee" }), "Tom Iwu", "Use this person");
      await d.getByLabel("Due date").fill(day(10));
      await d.getByLabel("Add a note").fill("DOC-030 fictional initial note.");
      await d.getByRole("button", { name: "Add Task" }).click();
      await d.waitFor({ state: "hidden", timeout: 20000 });
      const t = await tasks();
      const review = t.tasks.find((x) => x.title === "DOC-030 work review task");
      const team = await teamNames();
      const comments = (
        await api(page, "GET", `/comments?entityType=matter_task&entityId=${review.id}`)
      ).json.comments;
      const matterId = (await matterByNumber(page, s.w)).matter.id;
      const recordComments =
        (await api(page, "GET", `/comments?entityType=matter&entityId=${matterId}`)).json
          ?.comments ?? [];
      s.review = review;
      expectThat(
        review.assigneeName === "Tom Iwu" && review.dueDate === day(10) && team.includes("Tom Iwu"),
        q(review),
      );
      expectThat(
        section && audienceControls === 0 && !/Legal only|Working team/i.test(dialogText),
        `section ${section} audience controls ${audienceControls}`,
      );
      expectThat(comments.length === 1, q(comments.map((c) => c.visibility)));
      expectThat(
        !recordComments.some((c) => JSON.stringify(c).includes("DOC-030 fictional initial note")),
        "note on record conversation",
      );
      return `The Add a Task dialog shows Comments & attachments with Add a note and ${audienceControls} audience controls (no "Legal only" or "Working team" text). Saved "DOC-030 work review task": assignee ${review.assigneeName}, due ${review.dueDate}; team now ${q(team)}. The Task conversation holds ${comments.length} comment (stored visibility ${q(comments[0].visibility)}); the record conversation (${recordComments.length} comments) does not contain the note.`;
    },
  );

  await step(
    "Maintain Tasks: Add to team and assign on a row is immediate; clearing the assignee keeps membership; Close in Task details discards a staged person",
    "The row change saves at once; Unassigned leaves the team membership; Close before saving saves neither membership nor assignment.",
    async () => {
      await api(page, "POST", `/matters/${s.w}/tasks`, { title: "DOC-030 work plain task" });
      await api(page, "POST", `/matters/${s.w}/tasks`, {
        title: "DOC-030 work empty task",
        dueDate: day(5),
      });
      await gotoTab("tasks");
      const rowButton = tasksRegion().getByRole("button", {
        name: /^Change assignee for DOC-030 work plain task/,
      });
      await stagePerson(rowButton, "Ines Duarte", "Add to team and assign");
      await page.waitForTimeout(800);
      const assigned = (await tasks()).tasks.find((x) => x.title === "DOC-030 work plain task");
      const teamAfterAssign = await teamNames();
      await rowButton.click();
      await page
        .getByRole("dialog", { name: "Assign task" })
        .getByRole("button", { name: "Unassigned" })
        .click();
      await page.waitForTimeout(800);
      const cleared = (await tasks()).tasks.find((x) => x.title === "DOC-030 work plain task");
      const teamAfterClear = await teamNames();
      await tasksRegion()
        .getByRole("button", { name: "DOC-030 work plain task", exact: true })
        .click();
      const details = page.getByRole("dialog", { name: "Task details" });
      await details.waitFor();
      await stagePerson(
        details.getByRole("button", { name: "Assignee" }),
        "Marcus Oyelaran",
        "Use this person",
      );
      await details.getByRole("contentinfo").getByRole("button", { name: "Close" }).click();
      await details.waitFor({ state: "hidden" });
      const afterClose = (await tasks()).tasks.find((x) => x.title === "DOC-030 work plain task");
      const teamAfterClose = await teamNames();
      expectThat(
        assigned.assigneeName === "Ines Duarte" && teamAfterAssign.includes("Ines Duarte"),
        q(assigned),
      );
      expectThat(cleared.assigneeId === null && teamAfterClear.includes("Ines Duarte"), q(cleared));
      expectThat(
        afterClose.assigneeId === null && !teamAfterClose.includes("Marcus Oyelaran"),
        q(afterClose),
      );
      return `Row picker > Add someone to the team… > Ines Duarte > Add to team and assign saved at once: assignee ${assigned.assigneeName}, team ${q(teamAfterAssign)}. Choosing Unassigned left assignee ${cleared.assigneeId} and Ines Duarte still on the team. In Task details, staging Marcus Oyelaran with Use this person and then Close left the assignee ${afterClose.assigneeId} and team ${q(teamAfterClose)}.`;
    },
  );

  await step(
    "Maintain Tasks: order by due date, completion with Show completed, Edit Task and Save",
    "Tasks are listed by due date with undated last; done Tasks are hidden until Show completed; the completion control reopens; Edit Task opens Task details and Save renames; the done/total count updates.",
    async () => {
      await gotoTab("tasks");
      const order = (
        await tasksRegion()
          .getByRole("checkbox")
          .evaluateAll((els) => els.map((e) => e.getAttribute("aria-label")))
      ).map((x) => x.replace(/^(Complete|Reopen) Task: /, ""));
      expectThat(
        q(order) ===
          q(["DOC-030 work empty task", "DOC-030 work review task", "DOC-030 work plain task"]),
        q(order),
      );
      await tasksRegion()
        .getByRole("checkbox", { name: "Complete Task: DOC-030 work review task" })
        .click();
      await page.waitForTimeout(1200);
      const hidden = (await tasksRegion().getByText("DOC-030 work review task").count()) === 0;
      const count = (
        await tasksRegion()
          .getByText(/of \d+ done/)
          .innerText()
      ).trim();
      await tasksRegion().getByRole("switch", { name: "Show completed" }).click();
      await page.waitForTimeout(500);
      const reopenBox = tasksRegion().getByRole("checkbox", {
        name: "Reopen Task: DOC-030 work review task",
      });
      const shown = await reopenBox.isVisible();
      await reopenBox.click();
      await page.waitForTimeout(1200);
      const reopened = (await tasks()).tasks.find((x) => x.title === "DOC-030 work review task");
      await tasksRegion()
        .getByRole("button", { name: "Actions for DOC-030 work plain task" })
        .click();
      await page.getByRole("menuitem", { name: "Edit Task" }).click();
      const details = page.getByRole("dialog", { name: "Task details" });
      await details.getByLabel("Title").fill("DOC-030 work renamed task");
      await details.getByRole("button", { name: "Save" }).click();
      await details.waitFor({ state: "hidden" });
      await tasksRegion()
        .getByRole("button", { name: "DOC-030 work renamed task", exact: true })
        .waitFor();
      const countAfter = (
        await tasksRegion()
          .getByText(/of \d+ done/)
          .innerText()
      ).trim();
      expectThat(
        hidden &&
          count === "1 of 3 done" &&
          shown &&
          reopened.isDone === false &&
          countAfter === "0 of 3 done",
        `${hidden} ${count} ${shown} ${countAfter}`,
      );
      return `Rows in order ${q(order)} (due ${day(5)}, due ${day(10)}, undated). Completing the review Task hid it (hidden ${hidden}); count ${q(count)}. Show completed showed it with the Reopen Task control, which reopened it (isDone ${reopened.isDone}). Actions > Edit Task opened Task details; Save renamed the plain Task; count ${q(countAfter)}.`;
    },
  );

  await step(
    "Maintain Tasks: Task details conversation has no audience selector; Remove Task on an empty Task and on a Task with conversation history",
    "The Task thread has no audience selector and says Visible to everyone who can access this task.; Remove Task removes an empty Task; a Task with a conversation cannot be removed.",
    async () => {
      await gotoTab("tasks");
      await tasksRegion()
        .getByRole("button", { name: "DOC-030 work review task", exact: true })
        .click();
      const details = page.getByRole("dialog", { name: "Task details" });
      await details.waitFor();
      await details.getByText("DOC-030 fictional initial note.").waitFor();
      const audienceGroups =
        (await details.getByRole("group", { name: "Audience" }).count()) +
        (await details.getByRole("radio", { name: /Legal only|Working team/i }).count());
      const sentence = await details
        .getByText("Visible to everyone who can access this task.")
        .first()
        .isVisible();
      const audienceText = `audience controls ${audienceGroups}; sentence visible ${sentence}`;
      await details.getByRole("contentinfo").getByRole("button", { name: "Close" }).click();
      await details.waitFor({ state: "hidden" });
      const confirm = page
        .getByRole("alertdialog")
        .or(page.getByRole("dialog", { name: /Remove/ }));
      await tasksRegion()
        .getByRole("button", { name: "Actions for DOC-030 work empty task" })
        .click();
      await page.getByRole("menuitem", { name: "Remove Task" }).click();
      await page.waitForTimeout(600);
      const emptyConfirm = await confirm
        .first()
        .isVisible()
        .catch(() => false);
      if (emptyConfirm)
        await confirm
          .first()
          .getByRole("button", { name: /Remove/ })
          .last()
          .click();
      await page.waitForTimeout(1200);
      const afterEmpty = (await tasks()).tasks.map((x) => x.title);
      await tasksRegion()
        .getByRole("button", { name: "Actions for DOC-030 work review task" })
        .click();
      await page.getByRole("menuitem", { name: "Remove Task" }).click();
      await page.waitForTimeout(600);
      if (
        await confirm
          .first()
          .isVisible()
          .catch(() => false)
      )
        await confirm
          .first()
          .getByRole("button", { name: /Remove/ })
          .last()
          .click();
      await page.waitForTimeout(1500);
      const refusal = (
        await page
          .getByText(/conversation on it|could not be saved|cannot be removed/)
          .allInnerTexts()
      ).join(" | ");
      const afterHeld = (await tasks()).tasks.map((x) => x.title);
      expectThat(audienceGroups === 0 && sentence, audienceText);
      expectThat(
        !afterEmpty.includes("DOC-030 work empty task") &&
          afterHeld.includes("DOC-030 work review task") &&
          refusal.length > 0,
        `${q(afterHeld)} ${q(refusal)}`,
      );
      return `Task details for the review Task shows the initial note; ${audienceText} ("Visible to everyone who can access this task."). Remove Task on the empty Task (confirmation dialog shown: ${emptyConfirm}) removed its row (remaining ${q(afterEmpty)}). Remove Task on the review Task showed ${q(refusal)} and the Task stayed.`;
    },
  );

  await step(
    "Maintain Tasks: a failed initial note offers Retry note & attachments without creating another Task",
    "The Task saves, the dialog stays open with Retry note & attachments, and the retry adds the note to the same Task.",
    async () => {
      await gotoTab("tasks");
      await tasksRegion().getByRole("button", { name: "Add Task" }).click();
      const d = page.getByRole("dialog", { name: "Add a Task" });
      await d.getByLabel("Title").fill("DOC-030 work retry task");
      await d.getByLabel("Add a note").fill("DOC-030 retry note.");
      let blocked = 0;
      await page.route("**/api/v1/comments", (route) => {
        if (route.request().method() === "POST" && blocked === 0) {
          blocked++;
          return route.abort("failed");
        }
        return route.continue();
      });
      await d.getByRole("button", { name: "Add Task" }).click();
      const open = page.getByRole("dialog", { name: /Add a Task|Task details/ });
      const retry = open.getByRole("button", { name: "Retry note & attachments" });
      await retry.waitFor({ timeout: 20000 });
      const message = (await open.getByText(/Task saved\./).innerText()).trim();
      await page.unroute("**/api/v1/comments");
      await retry.click();
      await open.waitFor({ state: "hidden", timeout: 20000 });
      const matches = (await tasks()).tasks.filter((x) => x.title === "DOC-030 work retry task");
      const comments = (
        await api(page, "GET", `/comments?entityType=matter_task&entityId=${matches[0].id}`)
      ).json.comments;
      expectThat(
        matches.length === 1 && comments.length === 1,
        `${matches.length} ${comments.length}`,
      );
      // Fixture: the author takes the note back; the Task keeps its conversation history.
      const del = await api(page, "DELETE", `/comments/${comments[0].id}`);
      await gotoTab("tasks");
      await tasksRegion()
        .getByRole("button", { name: "Actions for DOC-030 work retry task" })
        .click();
      await page.getByRole("menuitem", { name: "Remove Task" }).click();
      await page.waitForTimeout(600);
      const confirm = page.getByRole("alertdialog").or(page.getByRole("dialog", { name: /Remove/ }));
      if (
        await confirm
          .first()
          .isVisible()
          .catch(() => false)
      )
        await confirm
          .first()
          .getByRole("button", { name: /Remove/ })
          .last()
          .click();
      await page.waitForTimeout(1500);
      const refusal = (
        await page.getByText(/conversation|could not be saved|cannot be removed/).allInnerTexts()
      ).join(" | ");
      const stays = (await tasks()).tasks.some((x) => x.title === "DOC-030 work retry task");
      expectThat(del.status < 300 && stays, `delete ${del.status} stays ${stays}`);
      return `With the comment request failed once by the reviewer's browser route (a network stand-in), the dialog stayed open with ${q(message)} and Retry note & attachments. Retry closed the dialog; ${matches.length} Task has that title and it holds ${comments.length} comment. Fixture: the author deleted that comment (${del.status}); Remove Task on the Task then showed ${q(refusal)} and the Task stayed (${stays}).`;
    },
  );

  await step(
    "Maintain Key dates: Add date refusals, reminder lead times and recipient choices",
    "Missing Date or Event is refused; Reminders show Global reminders and This date will remind; Add lead time and Remove change the schedule; Recipients list the usual audience including the active Business User on the team; the saved date keeps chosen lead times and recipients.",
    async () => {
      await gotoTab("key-dates");
      await datesRegion().getByRole("button", { name: "Add date" }).click();
      const d = page.getByRole("dialog", { name: "Add a Key date" });
      await d.waitFor();
      await d.getByRole("button", { name: "Add date" }).click();
      const noDate = (await d.getByText("Pick a date.").innerText()).trim();
      await d.getByLabel("Date").fill(day(30));
      await d.getByRole("button", { name: "Add date" }).click();
      const noEvent = (await d.getByText("Name what the date is.").innerText()).trim();
      await d.getByLabel("Event").fill("DOC-030 work filing");
      await d.getByLabel("Note").fill("Fictional filing note.");
      const reminders = d.getByRole("group", { name: "Reminders" });
      await reminders.getByText(/^Global reminders:/).waitFor();
      const global = (await reminders.getByText(/^Global reminders:/).innerText()).trim();
      const lead = reminders.getByRole("spinbutton", {
        name: "Additional lead time (days before)",
      });
      await lead.fill("731");
      const tooFarDisabled = await reminders
        .getByRole("button", { name: "Add lead time" })
        .isDisabled();
      await lead.fill("3");
      await reminders.getByRole("button", { name: "Add lead time" }).click();
      const withThree = (await reminders.getByText(/^This date will remind:/).innerText()).trim();
      await reminders.getByRole("button", { name: /^Remove 3 days before/ }).click();
      const withoutThree = (
        await reminders.getByText(/^This date will remind:/).innerText()
      ).trim();
      await lead.fill("45");
      await reminders.getByRole("button", { name: "Add lead time" }).click();
      const peopleText = (await reminders.innerText()).replace(/\s+/g, " ");
      await reminders.getByRole("checkbox", { name: account.name }).check();
      await reminders.getByRole("checkbox", { name: "Tom Iwu" }).check();
      await d.getByRole("button", { name: "Add date" }).click();
      await d.waitFor({ state: "hidden" });
      const saved = (await dates()).find((x) => x.label === "DOC-030 work filing");
      expectThat(
        noDate === "Pick a date." && noEvent === "Name what the date is." && tooFarDisabled,
        `${noDate} ${noEvent} ${tooFarDisabled}`,
      );
      expectThat(
        withThree.includes("3 days before") && !withoutThree.includes("3 days before"),
        `${withThree} / ${withoutThree}`,
      );
      expectThat(
        peopleText.includes("Recipients") &&
          peopleText.includes("Jonas Weber") &&
          peopleText.includes("Tom Iwu"),
        peopleText,
      );
      expectThat(
        q(saved.reminderOffsetDays) === q([45]) &&
          saved.reminderRecipientIds?.length === 2 &&
          !("assigneeId" in saved),
        q(saved),
      );
      return `Add date with nothing showed ${q(noDate)}; with only a Date ${q(noEvent)}. ${q(global)}. 731 left Add lead time disabled: ${tooFarDisabled}. After adding 3: ${q(withThree)}; after Remove: ${q(withoutThree)}. Reminder group text from Recipients: ${q(peopleText.slice(peopleText.indexOf("Recipients")))}; Jonas Weber (active Business User on the team) is listed. Saved ${saved.date} "DOC-030 work filing" with lead times ${q(saved.reminderOffsetDays)} and ${saved.reminderRecipientIds.length} recipients; the row has no assignee field.`;
    },
  );

  await step(
    "Maintain Key dates: header and tab counts, a departed recipient, Remove unavailable recipients and Use the usual audience",
    "The header counts upcoming and overdue dates and the tab counts upcoming; when a selected person leaves the team the dialog says so, Remove unavailable recipients keeps the others, and Use the usual audience clears the selection; clearing every checkbox restores the default.",
    async () => {
      const past = await api(page, "POST", `/matters/${s.w}/key-dates`, {
        date: day(-2),
        label: "DOC-030 work overdue",
      });
      const tomOnly = await api(page, "POST", `/matters/${s.w}/key-dates`, {
        date: day(60),
        label: "DOC-030 work Tom only",
        reminderRecipientIds: [user("Tom Iwu").id],
      });
      await gotoTab("key-dates");
      const tally = (
        await datesRegion()
          .getByText(/upcoming · \d+ overdue/)
          .innerText()
      ).trim();
      const tab = (
        await page
          .getByRole("navigation", { name: "Matter sections" })
          .getByRole("link", { name: /^Key dates/ })
          .innerText()
      ).replace(/\s+/g, " ");
      const leave = await api(page, "DELETE", `/matters/${s.w}/team/${user("Tom Iwu").id}`);
      await page.reload();
      await datesRegion().getByRole("button", { name: "Actions for DOC-030 work filing" }).click();
      await page.getByRole("menuitem", { name: "Edit date" }).click();
      const d = page.getByRole("dialog", { name: "Edit Key date" });
      await d
        .getByText("Some selected recipients have left the team and will not be reminded.")
        .waitFor();
      const both = [
        await d.getByRole("button", { name: "Remove unavailable recipients" }).isVisible(),
        await d.getByRole("button", { name: "Use the usual audience" }).isVisible(),
      ];
      await d.getByRole("button", { name: "Remove unavailable recipients" }).click();
      await d.getByRole("button", { name: "Save" }).click();
      await d.waitFor({ state: "hidden" });
      const filing = (await dates()).find((x) => x.label === "DOC-030 work filing");
      await datesRegion()
        .getByRole("button", { name: "Actions for DOC-030 work Tom only" })
        .click();
      await page.getByRole("menuitem", { name: "Edit date" }).click();
      await d
        .getByText("Some selected recipients have left the team and will not be reminded.")
        .waitFor();
      const onlyUsual = [
        await d.getByRole("button", { name: "Remove unavailable recipients" }).count(),
        await d.getByRole("button", { name: "Use the usual audience" }).isVisible(),
      ];
      await d.getByRole("button", { name: "Use the usual audience" }).click();
      await d.getByRole("button", { name: "Save" }).click();
      await d.waitFor({ state: "hidden" });
      const tomDate = (await dates()).find((x) => x.label === "DOC-030 work Tom only");
      await datesRegion().getByRole("button", { name: "Actions for DOC-030 work filing" }).click();
      await page.getByRole("menuitem", { name: "Edit date" }).click();
      await d.getByRole("checkbox", { name: account.name }).uncheck();
      await d.getByRole("button", { name: "Save" }).click();
      await d.waitFor({ state: "hidden" });
      const cleared = (await dates()).find((x) => x.label === "DOC-030 work filing");
      expectThat(
        past.status === 201 && tomOnly.status === 201 && leave.status === 200,
        `${past.status} ${tomOnly.status} ${leave.status}`,
      );
      expectThat(tally === "2 upcoming · 1 overdue" && /2/.test(tab), `${tally} ${tab}`);
      expectThat(both[0] && both[1] && filing.reminderRecipientIds.length === 1, q(filing));
      expectThat(
        onlyUsual[0] === 0 &&
          onlyUsual[1] &&
          tomDate.reminderRecipientIds.length === 0 &&
          cleared.reminderRecipientIds.length === 0,
        `${q(onlyUsual)} ${q(tomDate)} ${q(cleared)}`,
      );
      return `Fixture: an overdue date and a date whose only recipient is Tom Iwu. Header tally ${q(tally)}; tab ${q(tab)}. Fixture: Tom Iwu left the team (${leave.status}). Edit date on the filing date showed the departed notice with Remove unavailable recipients ${both[0]} and Use the usual audience ${both[1]}; Remove unavailable recipients then Save kept ${filing.reminderRecipientIds.length} recipient. On the Tom-only date the notice offered only Use the usual audience (${onlyUsual[0]} Remove buttons); it saved ${tomDate.reminderRecipientIds.length} recipients. Clearing the last checkbox on the filing date saved ${cleared.reminderRecipientIds.length} recipients.`;
    },
  );

  await step(
    "Maintain Key dates: Edit date and Remove date with confirmation; a closed Matter keeps editable dates without Next deadline",
    "Edit date saves with Save; Remove date asks for confirmation (Cancel keeps the date); a closed Matter keeps its dates, still edits them, and has no Next deadline until reopened.",
    async () => {
      await gotoTab("key-dates");
      await datesRegion().getByRole("button", { name: "Actions for DOC-030 work overdue" }).click();
      await page.getByRole("menuitem", { name: "Edit date" }).click();
      const d = page.getByRole("dialog", { name: "Edit Key date" });
      await d.getByLabel("Event").fill("DOC-030 work overdue edited");
      await d.getByRole("button", { name: "Save" }).click();
      await d.waitFor({ state: "hidden" });
      await datesRegion()
        .getByRole("button", { name: "Actions for DOC-030 work overdue edited" })
        .click();
      await page.getByRole("menuitem", { name: "Remove date" }).click();
      const confirm = page
        .getByRole("dialog", { name: "Remove Key date?" })
        .or(page.getByRole("alertdialog", { name: "Remove Key date?" }));
      await confirm.waitFor();
      const confirmText = (await confirm.innerText()).replace(/\s+/g, " ");
      await confirm.getByRole("button", { name: "Cancel" }).click();
      await confirm.waitFor({ state: "hidden" });
      const kept = (await dates()).some((x) => x.label === "DOC-030 work overdue edited");
      await datesRegion()
        .getByRole("button", { name: "Actions for DOC-030 work overdue edited" })
        .click();
      await page.getByRole("menuitem", { name: "Remove date" }).click();
      await confirm.getByRole("button", { name: "Remove date" }).click();
      await confirm.waitFor({ state: "hidden" });
      await page.waitForTimeout(800);
      const removed = !(await dates()).some((x) => x.label === "DOC-030 work overdue edited");
      const openDeadline = (await matterByNumber(page, s.w)).matter.nextDeadline;
      const close = await api(page, "PATCH", `/matters/${s.w}`, {
        statusId: closedId,
        closingNote: "DOC-030 closed for the Key date check.",
      });
      await gotoTab("key-dates");
      const listed = await datesRegion().getByText("DOC-030 work filing").isVisible();
      await datesRegion().getByRole("button", { name: "Actions for DOC-030 work filing" }).click();
      await page.getByRole("menuitem", { name: "Edit date" }).click();
      await d.getByLabel("Note").fill("Edited while closed.");
      await d.getByRole("button", { name: "Save" }).click();
      await d.waitFor({ state: "hidden" });
      const closedNote = (await dates()).find((x) => x.label === "DOC-030 work filing").note;
      const closedDeadline = (await matterByNumber(page, s.w)).matter.nextDeadline;
      const reopen = await api(page, "PATCH", `/matters/${s.w}`, {
        statusId: openId,
        confirmReopen: true,
      });
      const reopenedDeadline = (await matterByNumber(page, s.w)).matter.nextDeadline;
      expectThat(
        kept && removed && confirmText.includes("This cannot be undone."),
        `${kept} ${removed} ${confirmText}`,
      );
      expectThat(
        close.status === 200 &&
          listed &&
          closedNote === "Edited while closed." &&
          closedDeadline === null &&
          reopen.status === 200 &&
          reopenedDeadline,
        `${q(closedDeadline)} ${q(reopenedDeadline)}`,
      );
      return `Edit date > Save renamed the overdue date. Remove date opened ${q(confirmText)}; Cancel kept it (${kept}); Remove date removed it (${removed}). Next deadline while open ${q(openDeadline)}. Fixture: closed through the API (${close.status}); the Key dates tab still listed the filing date and Edit date saved a note; Next deadline ${q(closedDeadline)}. Fixture: reopened (${reopen.status}); Next deadline ${q(reopenedDeadline)}.`;
    },
  );

  await step(
    "Maintain Key dates: a Needed by date set from the Overview Row is an ordinary Key date named Needed by",
    "Entering Needed by on Overview adds a Key date named Needed by on the Key dates tab with the same Edit date and Remove date actions; editing it there changes the Overview Row.",
    async () => {
      await page.goto(`${BASE}/matters/${s.w2}`);
      const main = page.getByRole("main");
      const needed = main.getByLabel("Needed by", { exact: true });
      await needed.waitFor();
      const wait = page.waitForResponse(
        (r) => /key-dates/.test(new URL(r.url()).pathname) && r.request().method() !== "GET",
      );
      await needed.fill(day(21));
      await needed.press("Enter");
      const added = (await wait).status();
      await page.goto(`${BASE}/matters/${s.w2}/key-dates`);
      await datesRegion().getByText("Needed by", { exact: true }).waitFor();
      await datesRegion().getByRole("button", { name: "Actions for Needed by" }).click();
      const menu = await page.getByRole("menuitem").allInnerTexts();
      await page.getByRole("menuitem", { name: "Edit date" }).click();
      const d = page.getByRole("dialog", { name: "Edit Key date" });
      await d.getByLabel("Note").fill("Fictional Needed by note.");
      await d.getByLabel("Date").fill(day(22));
      await d.getByRole("button", { name: "Save" }).click();
      await d.waitFor({ state: "hidden" });
      await page.goto(`${BASE}/matters/${s.w2}`);
      await needed.waitFor();
      await page.waitForTimeout(500);
      const overview = await needed.inputValue();
      const row = (await api(page, "GET", `/matters/${s.w2}/key-dates`)).json.deadlines.filter(
        (x) => x.label === "Needed by",
      );
      expectThat(
        added < 300 &&
          q(menu.map((m) => m.trim())) === q(["Edit date", "Remove date"]) &&
          row.length === 1 &&
          row[0].date === day(22) &&
          overview === day(22),
        `${added} ${q(menu)} ${q(row)} ${overview}`,
      );
      return `On M-${s.w2} Overview, Needed by ${day(21)} saved (${added}). The Key dates tab lists "Needed by" with actions ${q(menu.map((m) => m.trim()))}; Edit date changed it to ${day(22)} with a note; Overview's Needed by Row now reads ${overview}; ${row.length} Key date named Needed by.`;
    },
  );

  await step(
    "Connect related Matters: Set parent Cancel and confirm, a hierarchy loop is refused",
    "Cancel changes nothing; Set parent saves one parent shown on both Matters; choosing the Matter's own child as the parent's parent is refused.",
    async () => {
      await page.goto(`${BASE}/matters/${s.w}`);
      const card = page.getByRole("region", { name: "Related Matters" });
      await card.getByRole("button", { name: "Set parent" }).click();
      const d = page.getByRole("dialog", { name: "Set parent" });
      const searchLabel = await d.getByRole("textbox").getAttribute("aria-label");
      const listed = async (query) => {
        const wait = page
          .waitForResponse((r) => /relation-candidates|candidates/.test(r.url()), { timeout: 8000 })
          .catch(() => null);
        await d.getByRole("textbox").fill(query);
        await wait;
        await page.waitForTimeout(700);
        const names = await d.getByRole("button", { name: /^M-\d+ / }).allInnerTexts();
        return {
          count: names.length,
          found: names.some((x) => x.replace(/\s+/g, " ").startsWith(`M-${s.p} `)),
        };
      };
      const byRef = await listed(`M-${s.p}`);
      const byNumber = await listed(String(s.p));
      s.searchByNumber = { byRef, byNumber };
      await d.getByRole("textbox").fill(title("parent candidate"));
      await d.getByRole("button", { name: new RegExp(`^M-${s.p} `) }).click();
      await d.getByRole("button", { name: "Cancel" }).click();
      await d.waitFor({ state: "hidden" });
      const afterCancel = (await api(page, "GET", `/matters/${s.w}/relations`)).json.parent;
      await card.getByRole("button", { name: "Set parent" }).click();
      await d.getByRole("textbox").fill(title("parent candidate"));
      await d.getByRole("button", { name: new RegExp(`^M-${s.p} `) }).click();
      await d.getByRole("button", { name: "Set parent" }).click();
      await d.waitFor({ state: "hidden" });
      await card.getByRole("heading", { name: "Parent" }).waitFor();
      const parentRow = (
        await card.getByRole("link", { name: new RegExp(`^M-${s.p} `) }).innerText()
      )
        .replace(/\s+/g, " ")
        .trim();
      const changeLabel = await card.getByRole("button", { name: "Change parent" }).isVisible();
      await page.goto(`${BASE}/matters/${s.p}`);
      const pCard = page.getByRole("region", { name: "Related Matters" });
      await pCard.getByRole("link", { name: new RegExp(`^M-${s.w} `) }).waitFor();
      await pCard.getByRole("button", { name: "Set parent" }).click();
      await d.getByRole("textbox").fill(title("work"));
      await d.getByRole("button", { name: new RegExp(`^M-${s.w} `) }).click();
      await d.getByRole("button", { name: "Set parent" }).click();
      const loop = (
        await d.getByText("That parent would close a loop in the Matter hierarchy.").innerText()
      ).trim();
      await d.getByRole("button", { name: "Cancel" }).click();
      const pParent = (await api(page, "GET", `/matters/${s.p}/relations`)).json.parent;
      expectThat(
        afterCancel === null && changeLabel && pParent === null,
        `${q(afterCancel)} ${q(pParent)}`,
      );
      return `Set parent search box ${q(searchLabel)}. Typing "M-${s.p}" listed ${byRef.count} candidates (M-${s.p} among them: ${byRef.found}); typing "${s.p}" listed ${byNumber.count} (M-${s.p} among them: ${byNumber.found}); the title search listed it. Set parent > M-${s.p} > Cancel left parent ${q(afterCancel)}. Confirming Set parent showed Parent ${q(parentRow)} and the button became Change parent. M-${s.p} lists M-${s.w} under Children. On M-${s.p}, Set parent to M-${s.w} showed ${q(loop)}; Cancel left its parent ${q(pParent)}.`;
    },
  );

  await step(
    "Connect related Matters: Add related Matter, Remove, New sub-Matter, detach a child, and Restricted Matter",
    "A flat relation appears on both Matters and Remove deletes only the link; New sub-Matter creates a separate child that copies nothing; removing the child's Parent detaches it; an unreadable relation shows Restricted Matter without title or link and its direct read is refused.",
    async () => {
      await page.goto(`${BASE}/matters/${s.w}`);
      const card = page.getByRole("region", { name: "Related Matters" });
      await card.getByRole("button", { name: "Add related Matter" }).click();
      const d = page.getByRole("dialog", { name: "Add related Matter" });
      await d.getByRole("textbox").fill(title("related candidate"));
      await d.getByRole("button", { name: new RegExp(`^M-${s.r} `) }).click();
      await d.getByRole("button", { name: "Add relation" }).click();
      await d.waitFor({ state: "hidden" });
      await card.getByRole("link", { name: new RegExp(`^M-${s.r} `) }).waitFor();
      const otherSide = (await api(page, "GET", `/matters/${s.r}/relations`)).json.related.map(
        (x) => x.number,
      );
      const restrictedText = (await card.innerText()).replace(/\s+/g, " ");
      const restrictedLinks = await card
        .getByRole("link", { name: new RegExp(`M-${s.h}\\b`) })
        .count();
      const hiddenRead = (await api(page, "GET", `/matters/${s.h}`)).status;
      const relatedItem = card
        .getByRole("listitem")
        .filter({ has: page.getByRole("link", { name: new RegExp(`^M-${s.r} `) }) });
      await relatedItem.getByRole("button", { name: "Remove" }).click();
      await page.waitForTimeout(1200);
      const afterRemove = (await api(page, "GET", `/matters/${s.r}/relations`)).json.related.map(
        (x) => x.number,
      );
      const rStill = (await api(page, "GET", `/matters/${s.r}`)).status;
      await card.getByRole("button", { name: "New sub-Matter" }).click();
      const create = page.getByRole("dialog", { name: "Create sub-Matter" });
      await create.waitFor();
      const parentLine = (await create.getByText(/^Parent:/).innerText()).trim();
      await create.getByLabel("Title").fill(title("sub-Matter"));
      await create.getByLabel("Matter type").selectOption({ label: "Advisory" });
      await create.getByLabel("Matter Manager").selectOption({ label: "Unassigned" });
      await create.getByRole("button", { name: "Create", exact: true }).click();
      await create.waitFor({ state: "hidden", timeout: 20000 });
      await page.waitForTimeout(1000);
      const children = (await api(page, "GET", `/matters/${s.w}/relations`)).json.children;
      const child = children.find((x) => x.title === title("sub-Matter"));
      const childRecord = await matterByNumber(page, child.number);
      const parentRecord = await matterByNumber(page, s.w);
      const childTasks = (await api(page, "GET", `/matters/${child.number}/tasks`)).json.totalCount;
      await page.goto(`${BASE}/matters/${child.number}`);
      const cCard = page.getByRole("region", { name: "Related Matters" });
      const parentItem = cCard
        .getByRole("listitem")
        .filter({ has: page.getByRole("link", { name: new RegExp(`^M-${s.w} `) }) });
      await parentItem.getByRole("button", { name: "Remove" }).click();
      await page.waitForTimeout(1200);
      const childParent = (await api(page, "GET", `/matters/${child.number}/relations`)).json
        .parent;
      expectThat(
        otherSide.includes(s.w) && !afterRemove.includes(s.w) && rStill === 200,
        `${q(otherSide)} ${q(afterRemove)} ${rStill}`,
      );
      expectThat(
        restrictedText.includes("Restricted Matter") &&
          !restrictedText.includes(title("hidden related")) &&
          restrictedLinks === 0 &&
          hiddenRead === 404,
        `${restrictedLinks} ${hiddenRead}`,
      );
      expectThat(
        parentLine.includes(`M-${s.w}`) &&
          childRecord.matter.manager === null &&
          childRecord.team.length === 1 &&
          childTasks === 0 &&
          parentRecord.matter.manager?.displayName === account.name,
        q(childRecord.team),
      );
      expectThat(childParent === null, q(childParent));
      return `Add related Matter > M-${s.r} > Add relation showed M-${s.r} under Related; M-${s.r} lists M-${s.w} (${q(otherSide)}). The card also shows "Restricted Matter" for M-${s.h} with ${restrictedLinks} links and no title; its direct read answered ${hiddenRead}. Remove on the Related row deleted the link on both sides (${q(afterRemove)}); M-${s.r} still reads ${rStill}. New sub-Matter showed ${q(parentLine)}; the child M-${child.number} has Manager ${childRecord.matter.manager}, team ${q(childRecord.team.map((p) => p.displayName))}, ${childTasks} Tasks, Confidential ${childRecord.matter.isConfidential}, while the parent keeps Manager ${parentRecord.matter.manager?.displayName} and ${parentRecord.team.length} team members. Remove on the child's Parent row left parent ${q(childParent)}.`;
    },
  );

  await step(
    "Link Contracts: Link Contract with differing Confidential flags, Leave them as they are, Restricted contract for another reader",
    "Linking shows the flags stay independent and Confidentiality differs with Leave them as they are; both flags stay unchanged; the Counterparty stays on the Contract; a reader who cannot open the Contract sees Restricted contract.",
    async () => {
      await page.goto(`${BASE}/matters/${s.w}`);
      await page.getByRole("button", { name: "Link Contract" }).click();
      const d = page.getByRole("dialog", { name: "Link Contract" });
      await d.getByRole("textbox").fill(title("confidential contract"));
      await d.getByRole("button", { name: new RegExp(`^C-${s.c1} `) }).click();
      const inline = (
        await d
          .getByText(
            "These records have different Confidential flags. Linking will not change either one.",
          )
          .innerText()
      ).trim();
      await d.getByRole("button", { name: "Link", exact: true }).click();
      const differs = page.getByRole("dialog", { name: "Confidentiality differs" });
      await differs.waitFor();
      const differsText = (await differs.innerText()).replace(/\s+/g, " ");
      await differs.getByRole("button", { name: "Leave them as they are" }).click();
      await differs.waitFor({ state: "hidden" });
      const matter = (await matterByNumber(page, s.w)).matter;
      const contract = (await api(page, "GET", `/contracts/${s.c1}`)).json.contract;
      const linked = (await api(page, "GET", `/matters/${s.w}/contracts`)).json.contracts.map(
        (c) => c.number,
      );
      await other.page.goto(`${BASE}/matters/${s.w}`);
      await other.page.getByRole("heading", { name: "Linked Contracts" }).waitFor();
      await other.page.waitForLoadState("networkidle");
      const otherText = (await other.page.getByRole("main").innerText()).replace(/\s+/g, " ");
      const otherLinks = await other.page
        .getByRole("link", { name: new RegExp(`C-${s.c1}\\b`) })
        .count();
      const otherRead = (await api(other.page, "GET", `/contracts/${s.c1}`)).status;
      expectThat(
        inline.length > 0 &&
          differsText.includes(`C-${s.c1}`) &&
          matter.isConfidential === false &&
          contract.isConfidential === true,
        differsText,
      );
      expectThat(
        linked.includes(s.c1) && contract.primaryCounterparty?.name === s.cp.name,
        q(linked),
      );
      expectThat(
        otherRead !== 200 && otherText.includes("Restricted contract") && otherLinks === 0,
        `${otherRead} ${otherLinks}`,
      );
      return `Link Contract > C-${s.c1} showed ${q(inline)}; Link opened ${q(differsText)}; Leave them as they are closed it. Matter Confidential ${matter.isConfidential}, Contract Confidential ${contract.isConfidential}; linked ${q(linked)}; Counterparty still ${q(contract.primaryCounterparty?.name)} on the Contract. ${ctx.otherAccount.name} (Contract read ${otherRead}) sees "Restricted contract" with ${otherLinks} links to C-${s.c1}.`;
    },
  );

  await step(
    "Link Contracts: one Matter at a time, Unlink and move, New contract with the Matter chosen, archived Contracts excluded",
    "A second link is refused until Unlink; after Unlink the Contract links to another Matter; New contract opens creation with this Matter chosen; an archived linked Contract leaves the list while its link is retained.",
    async () => {
      const second = await api(page, "POST", `/contracts/${s.c1}/matter`, { matterNumber: s.w2 });
      await page.goto(`${BASE}/matters/${s.w2}`);
      await page.getByRole("button", { name: "Link Contract" }).click();
      const d = page.getByRole("dialog", { name: "Link Contract" });
      await d.getByRole("textbox").fill(title("confidential contract"));
      await page.waitForTimeout(1500);
      const offered = await d.getByRole("button", { name: new RegExp(`^C-${s.c1} `) }).count();
      await d.getByRole("button", { name: "Cancel" }).click();
      await page.goto(`${BASE}/matters/${s.w}`);
      const row = page
        .getByRole("listitem")
        .filter({ has: page.getByRole("link", { name: new RegExp(`^C-${s.c1} `) }) });
      await row.getByRole("button", { name: "Unlink" }).click();
      await page.waitForTimeout(600);
      const confirmUnlink = page.getByRole("alertdialog").or(page.getByRole("dialog"));
      const unlinkConfirm = await confirmUnlink
        .first()
        .isVisible()
        .catch(() => false);
      if (unlinkConfirm)
        await confirmUnlink.first().getByRole("button", { name: "Unlink" }).click();
      await page.waitForTimeout(1200);
      const afterUnlink = (await api(page, "GET", `/matters/${s.w}/contracts`)).json.contracts.map(
        (c) => c.number,
      );
      await page.goto(`${BASE}/matters/${s.w2}`);
      await page.getByRole("button", { name: "Link Contract" }).click();
      await d.getByRole("textbox").fill(title("confidential contract"));
      await d.getByRole("button", { name: new RegExp(`^C-${s.c1} `) }).click();
      await d.getByRole("button", { name: "Link", exact: true }).click();
      const differs = page.getByRole("dialog", { name: "Confidentiality differs" });
      await differs.getByRole("button", { name: "Leave them as they are" }).click();
      const movedTo = (await api(page, "GET", `/matters/${s.w2}/contracts`)).json.contracts.map(
        (c) => c.number,
      );
      await page.goto(`${BASE}/matters/${s.w}`);
      await page.getByRole("button", { name: "New contract" }).click();
      const form = page.getByRole("dialog").first();
      await form.waitFor();
      await page.waitForTimeout(800);
      const formText = (await form.innerText()).replace(/\s+/g, " ");
      const matterControl = await form
        .getByLabel(/Matter/)
        .first()
        .evaluate((el) =>
          el.tagName === "SELECT"
            ? el.options[el.selectedIndex]?.textContent
            : (el.value ?? el.textContent),
        )
        .catch(() => null);
      await form.getByRole("button", { name: "Cancel" }).click();
      const link2 = await api(page, "POST", `/contracts/${s.c2}/matter`, { matterNumber: s.w });
      const archive2 = await api(page, "POST", `/contracts/${s.c2}/archive`);
      await page.reload();
      await page.getByRole("heading", { name: "Linked Contracts" }).waitFor();
      await page.waitForLoadState("networkidle");
      const shownArchived = await page
        .getByRole("link", { name: new RegExp(`^C-${s.c2} `) })
        .count();
      const retained = (await api(page, "GET", `/contracts/${s.c2}/matter`)).json;
      expectThat(
        second.status === 409 && afterUnlink.length === 0 && movedTo.includes(s.c1),
        `${second.status} ${q(afterUnlink)} ${q(movedTo)}`,
      );
      expectThat(
        formText.includes(`M-${s.w}`) ||
          formText.includes(title("work")) ||
          String(matterControl).includes(title("work")),
        formText.slice(0, 400),
      );
      expectThat(
        link2.status === 201 &&
          archive2.status === 200 &&
          shownArchived === 0 &&
          JSON.stringify(retained).includes(String(s.w)),
        `${link2.status} ${archive2.status} ${shownArchived} ${q(retained)}`,
      );
      return `A direct second link of C-${s.c1} to M-${s.w2} answered ${second.status} (${q(second.json?.detail)}); M-${s.w2}'s Link Contract search offered C-${s.c1} ${offered} times. Unlink on M-${s.w} (confirmation shown: ${unlinkConfirm}) left ${q(afterUnlink)}; linking from M-${s.w2} then succeeded (${q(movedTo)}). New contract opened a form reading ${q(formText.slice(0, 260))} (Matter control ${q(matterControl)}); Cancel closed it. Fixture: C-${s.c2} linked (${link2.status}) and archived (${archive2.status}); the Linked Contracts card shows it ${shownArchived} times and its Matter link reads ${q(retained)}.`;
    },
  );

  await step(
    "Supplementary checks: lead time 0 and the 20 lead time limit, search by title, and overdue Tasks in Next deadline",
    "0 means on the date; no more than 20 additional lead times can be added; Set parent searches by title; Next deadline includes an overdue unfinished Task.",
    async () => {
      await gotoTab("key-dates");
      await datesRegion().getByRole("button", { name: "Add date" }).click();
      const d = page.getByRole("dialog", { name: "Add a Key date" });
      const reminders = d.getByRole("group", { name: "Reminders" });
      await reminders.getByText(/^Global reminders:/).waitFor();
      const lead = reminders.getByRole("spinbutton", {
        name: "Additional lead time (days before)",
      });
      const addLead = reminders.getByRole("button", { name: "Add lead time" });
      await lead.fill("0");
      const zeroEnabled = await addLead.isEnabled();
      await addLead.click();
      const zeroChip = await reminders.getByRole("button", { name: /^Remove On the day/ }).count();
      const extra = [2, 4, 5, 6, 8, 9, 10, 11, 12, 13, 15, 16, 17, 18, 19, 20, 21, 22, 23];
      for (const n of extra) {
        await lead.fill(String(n));
        if (!(await addLead.isEnabled())) break;
        await addLead.click();
      }
      const chips = await reminders.getByRole("button", { name: /^Remove / }).count();
      await lead.fill("24");
      const twentyFirst = await addLead.isEnabled().catch(() => false);
      const leadVisible = await lead.isVisible();
      await d.getByRole("button", { name: "Cancel" }).click();
      await page.goto(`${BASE}/matters/${s.w2}`);
      const card = page.getByRole("region", { name: "Related Matters" });
      await card.getByRole("button", { name: "Set parent" }).click();
      const sp = page.getByRole("dialog", { name: "Set parent" });
      await sp.getByRole("textbox").fill(title("parent candidate"));
      await sp.getByRole("button", { name: new RegExp(`^M-${s.p} `) }).waitFor();
      const byTitle = await sp.getByRole("listitem").count();
      await sp.getByRole("button", { name: "Cancel" }).click();
      const overdue = await api(page, "POST", `/matters/${s.w2}/tasks`, {
        title: "DOC-030 work overdue task",
        dueDate: day(-3),
      });
      await api(page, "POST", `/matters/${s.w2}/key-dates`, {
        date: day(4),
        label: "DOC-030 work upcoming date",
      });
      const deadline = (await matterByNumber(page, s.w2)).matter.nextDeadline;
      await page.goto(`${BASE}/settings/notifications`);
      await page.getByRole("heading", { name: "Reminder lead times" }).waitFor();
      const orgSwitch = await page
        .getByRole("switch", { name: "Use the organization's default lead times" })
        .count();
      s.leadCard = `Settings > Notifications shows the "Reminder lead times" card with ${orgSwitch} "Use the organization's default lead times" switch (not changed).`;
      expectThat(
        zeroEnabled && zeroChip === 1 && chips === 20 && !(twentyFirst && leadVisible),
        `${zeroEnabled} ${zeroChip} ${chips} ${twentyFirst} ${leadVisible}`,
      );
      expectThat(
        byTitle >= 1 && overdue.status === 201 && deadline?.label === "DOC-030 work overdue task",
        `${byTitle} ${q(deadline)}`,
      );
      return `Lead time 0 was accepted and shown as "On the day" (${zeroChip} chip). After 20 additional lead times (${chips} Remove chips) the lead time control accepted no more (Add lead time enabled ${twentyFirst}, input visible ${leadVisible}); Cancel discarded the draft. Set parent on M-${s.w2} found M-${s.p} by title (${byTitle} results). Fixture on M-${s.w2}: an unfinished Task due ${day(-3)} and a Key date ${day(4)}; Next deadline ${q(deadline)}. ${s.leadCard}`;
    },
  );

  await step(
    "Before you start: an archived Matter refuses changes to this work; restore keeps the rows; History records the changes; a Business User cannot open these sections",
    "Archived: no Add Task, Add date or relationship controls and writes are refused; Restore keeps Tasks and Key dates; History lists Task, Key date and relationship changes; a Business User is sent to the Portal and direct writes are refused.",
    async () => {
      const arch = await api(page, "POST", `/matters/${s.w}/archive`);
      await gotoTab("tasks");
      const addTask = await tasksRegion().getByRole("button", { name: "Add Task" }).count();
      await gotoTab("key-dates");
      const addDate = await datesRegion().getByRole("button", { name: "Add date" }).count();
      await page.goto(`${BASE}/matters/${s.w}`);
      await page.getByRole("region", { name: "Related Matters" }).waitFor();
      const relControls = await page
        .getByRole("button", {
          name: /Set parent|Change parent|Add related Matter|New sub-Matter|Link Contract/,
        })
        .count();
      const taskWrite = (await api(page, "POST", `/matters/${s.w}/tasks`, { title: "Refused" }))
        .status;
      const dateWrite = (
        await api(page, "POST", `/matters/${s.w}/key-dates`, { date: day(9), label: "Refused" })
      ).status;
      const relWrite = (
        await api(page, "POST", `/matters/${s.w}/relations`, { relatedMatterNumber: s.r })
      ).status;
      const restore = await api(page, "POST", `/matters/${s.w}/restore`);
      const t = await tasks();
      const kd = await dates();
      await page.goto(`${BASE}/matters/${s.w}`);
      await page
        .getByRole("toolbar", { name: "Applets" })
        .getByRole("button", { name: "History" })
        .click();
      const history = page.getByRole("complementary", { name: "History" });
      await history.getByRole("listitem").first().waitFor();
      await page.waitForTimeout(800);
      const entries = (await history.getByRole("listitem").allInnerTexts()).map((x) =>
        x.replace(/\s+/g, " ").trim(),
      );
      const has = (re) => entries.some((e) => re.test(e));
      const hiddenInHistory = entries.some((e) => e.includes(title("hidden related")));
      const hiddenTask = (await api(page, "POST", `/matters/${s.h}/tasks`, { title: "Refused" }))
        .status;
      const hiddenRel = (
        await api(page, "POST", `/matters/${s.h}/relations`, { relatedMatterNumber: s.r })
      ).status;
      const bu = await ctx.session("business_user");
      await bu.page.goto(`${BASE}/matters/${s.w}/tasks`);
      await bu.page.waitForLoadState("networkidle");
      const buPath = new URL(bu.page.url()).pathname;
      const buTask = (await api(bu.page, "POST", `/matters/${s.w}/tasks`, { title: "Refused" }))
        .status;
      const buDate = (
        await api(bu.page, "POST", `/matters/${s.w}/key-dates`, { date: day(9), label: "Refused" })
      ).status;
      const buRel = (
        await api(bu.page, "POST", `/matters/${s.w}/relations`, { relatedMatterNumber: s.r })
      ).status;
      expectThat(
        arch.status === 200 && addTask === 0 && addDate === 0 && relControls === 0,
        `${arch.status} ${addTask} ${addDate} ${relControls}`,
      );
      expectThat(
        taskWrite === 409 && dateWrite === 409 && relWrite === 409 && restore.status === 200,
        `${taskWrite} ${dateWrite} ${relWrite}`,
      );
      expectThat(t.totalCount === 3 && kd.length === 2, `${t.totalCount} ${kd.length}`);
      expectThat(
        has(/task/i) && has(/key date|date/i) && has(/parent|related|relation/i),
        q(entries.slice(0, 20)),
      );
      expectThat(
        !hiddenInHistory && hiddenTask === 404 && hiddenRel === 404,
        `hidden ${hiddenInHistory} ${hiddenTask} ${hiddenRel}`,
      );
      expectThat(
        !buPath.startsWith(`/matters/${s.w}`) && [buTask, buDate, buRel].every((x) => x === 403),
        `${buPath} ${buTask} ${buDate} ${buRel}`,
      );
      return `Fixture: archived through the API (${arch.status}). Tasks tab Add Task count ${addTask}; Key dates Add date count ${addDate}; relationship and link controls ${relControls}; direct Task, Key date and relation writes answered ${taskWrite}/${dateWrite}/${relWrite}. Fixture: restored (${restore.status}); ${t.totalCount} Tasks and ${kd.length} Key dates remain. History entries (first 12): ${q(entries.slice(0, 12))}. Jonas Weber (Business User on the team) opening /matters/${s.w}/tasks ended at ${buPath}; his direct Task, Key date and relation writes answered ${buTask}/${buDate}/${buRel}. History names the hidden Confidential Matter's title: ${hiddenInHistory}. ${account.name}'s direct Task and relation writes on that hidden M-${s.h} answered ${hiddenTask}/${hiddenRel}.`;
    },
  );
}
