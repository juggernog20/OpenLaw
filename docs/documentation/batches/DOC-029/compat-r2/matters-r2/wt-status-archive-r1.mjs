// V-C23 steps for "Change a Matter Status or archive it" (matter-status-and-archive.md).
import { expectThat, q, matterByNumber, patchAfter, listTitles } from "./lib-r1.mjs";

export default async function statusArchive(ctx) {
  const { role, stamp, BASE, api, step, account, actor, other } = ctx;
  const page = actor.page;
  const short = role === "administrator" ? "admin" : "legal";
  const title = (label) => `DOC-029r2 matters ${short} ${label} ${stamp}`;
  const futureDate = (days) => new Date(Date.now() + days * 86400000).toISOString().slice(0, 10);
  const header = (t) => page.getByRole("region", { name: t });
  const state = {};
  const statuses = (await api(page, "GET", "/matters/options")).json.matterStatuses;
  const statusId = (name) => statuses.find((s) => s.displayName === name).id;

  async function pick(group, status) {
    await page.getByRole("button", { name: `${group} — move matter` }).waitFor();
    await page.getByRole("button", { name: `${group} — move matter` }).click();
    const menu = page.getByRole("menu", { name: `${group} — move matter` });
    await menu.waitFor();
    const moveTo = await menu.getByText("Move to").isVisible();
    const items = await menu.getByRole("menuitemradio").allInnerTexts();
    await menu.getByRole("menuitemradio", { name: status, exact: true }).click();
    return { moveTo, items: items.map((x) => x.trim()) };
  }
  async function openFilterAnd(names) {
    await page.goto(`${BASE}/matters`);
    await page.waitForLoadState("networkidle");
    for (const name of names) {
      await page
        .getByRole("button", { name: /^Filter/ })
        .first()
        .click();
      await page.getByRole("button", { name, exact: true }).click();
      await page.waitForLoadState("networkidle");
      await page.keyboard.press("Escape");
    }
    await page.waitForTimeout(800);
  }
  const listedInTable = async (t) =>
    (await page.getByRole("link", { name: t, exact: true }).count()) > 0;
  const closedValue = async () =>
    (
      await page
        .getByRole("main")
        .locator("dt", { hasText: /^Closed$/ })
        .locator("xpath=following-sibling::dd[1]")
        .innerText()
    ).trim();

  await step(
    "Fixture: a Matter with an open child, a restricted Confidential child, a linked Contract, an open Task and a future Key date, with a Business User on the team",
    "Reviewer prerequisites exist; they are set up through the API and are not article steps.",
    async () => {
      const types = (await api(page, "GET", "/matters/options")).json.matterTypes;
      const advisory = types.find((t) => t.displayName === "Advisory");
      const t = title("lifecycle");
      const m = await api(page, "POST", "/matters", {
        title: t,
        matterTypeId: advisory.id,
        customFields: {},
      });
      const n = m.json.matter.number;
      const child = await api(page, "POST", "/matters", {
        title: title("open child"),
        matterTypeId: advisory.id,
        customFields: {},
        parentMatterNumber: n,
      });
      const hidden = await api(other.page, "POST", "/matters", {
        title: title("private child"),
        matterTypeId: advisory.id,
        customFields: {},
        isConfidential: true,
        parentMatterNumber: n,
      });
      const opts = (await api(page, "GET", "/contracts/options")).json;
      const nda = opts.contractTypes.find((c) => c.displayName === "NDA");
      const contract = await api(page, "POST", "/contracts", {
        title: title("lifecycle contract"),
        contractTypeId: nda.id,
        matterNumber: n,
      });
      const task = await api(page, "POST", `/matters/${n}/tasks`, {
        title: "DOC-029r2 lifecycle task",
        dueDate: futureDate(40),
      });
      const date = await api(page, "POST", `/matters/${n}/key-dates`, {
        date: futureDate(20),
        label: "DOC-029r2 lifecycle date",
      });
      const users = (await api(page, "GET", "/matters/options")).json.users;
      const jonas = users.find((u) => u.displayName === "Jonas Weber");
      const team = await api(page, "POST", `/matters/${n}/team`, { userId: jonas.id });
      const codes = [
        m.status,
        child.status,
        hidden.status,
        contract.status,
        task.status,
        date.status,
        team.status,
      ];
      expectThat(
        codes.every((s) => s === 201),
        `fixture statuses ${codes}`,
      );
      Object.assign(state, {
        n,
        t,
        child: child.json.matter.number,
        hidden: hidden.json.matter.number,
        contract: contract.json.contract.number,
        before: (await matterByNumber(page, n)).matter,
      });
      return `Fixture M-${n} ${q(t)} (Advisory, Status Open) with open child M-${state.child}, Confidential child M-${state.hidden} created by ${ctx.otherAccount.name} without ${account.name}, linked NDA C-${state.contract}, Task due ${futureDate(40)}, Key date ${futureDate(20)}, and Jonas Weber on the team. Next deadline ${q(state.before.nextDeadline)}.`;
    },
  );

  await step(
    "Change Status within the current Category: read the pill and Status strip, then move within open groups",
    "The pill shows the exact Status; the strip has Open, In progress, Waiting and Closed; a group opens a Move to menu; a same-Category Status saves at once and keeps Opened and Closed.",
    async () => {
      const { n, t, before } = state;
      await page.goto(`${BASE}/matters/${n}`);
      await header(t).getByRole("button", { name: "Closed — move matter" }).waitFor();
      const groups = (
        await header(t).getByRole("list", { name: "Status" }).getByRole("button").allInnerTexts()
      ).map((g) => g.trim());
      expectThat(q(groups) === q(["Open", "In progress", "Waiting", "Closed"]), q(groups));
      let menuOpen;
      const s1 = await patchAfter(page, n, async () => {
        menuOpen = await pick("Open", "On hold");
      });
      await header(t).getByText("On hold", { exact: true }).waitFor();
      const onHold = (await matterByNumber(page, n)).matter;
      let menuWaiting;
      const s2 = await patchAfter(page, n, async () => {
        menuWaiting = await pick("Waiting", "With external counsel");
      });
      await header(t).getByText("With external counsel", { exact: true }).waitFor();
      const dialogs = await page.getByRole("dialog").count();
      const waiting = (await matterByNumber(page, n)).matter;
      expectThat(menuOpen.moveTo && s1 === 200 && s2 === 200 && dialogs === 0, "moves");
      expectThat(onHold.statusCategory === "open" && waiting.statusCategory === "open", "category");
      expectThat(waiting.openedAt === before.openedAt && waiting.closedAt === null, "dates");
      return `Status strip groups ${q(groups)}. Open group menu showed "Move to" with ${q(menuOpen.items)}; On hold saved at once (${s1}), pill "On hold", Category ${onHold.statusCategory}. Waiting group menu ${q(menuWaiting.items)}; With external counsel saved (${s2}) with no dialog, Category ${waiting.statusCategory}, Opened unchanged ${waiting.openedAt}, Closed ${waiting.closedAt}.`;
    },
  );

  await step(
    "Close or reopen: Closed group, close dialog with Closing note, open child Matters, Cancel then Close matter",
    "The close dialog requires a note up to 2,000 characters, lists open children and a Restricted Matter; Cancel keeps the Status; Close matter records the Closed date and History keeps the note; children, the Contract and Tasks keep their state; the Matter leaves the default list and active deadlines.",
    async () => {
      const { n, t, before } = state;
      await page.goto(`${BASE}/matters/${n}`);
      await pick("Closed", "Closed");
      const dialog = page.getByRole("dialog", { name: `Close ${t}?` });
      await dialog.waitFor();
      const note = dialog.getByLabel("Closing note");
      const disabledEmpty = await dialog.getByRole("button", { name: "Close matter" }).isDisabled();
      await note.fill("n".repeat(2100));
      const maxKept = (await note.inputValue()).length;
      await note.fill("");
      const text = (await dialog.innerText()).replace(/\s+/g, " ");
      expectThat(
        text.includes("Open child Matters") &&
          text.includes(`M-${state.child}`) &&
          text.includes("Restricted Matter"),
        text,
      );
      expectThat(
        !text.includes(title("private child")) && !text.includes(`M-${state.hidden}`),
        "restricted child named",
      );
      await dialog.getByRole("button", { name: "Cancel" }).click();
      await dialog.waitFor({ state: "hidden" });
      const afterCancel = (await matterByNumber(page, n)).matter;
      expectThat(
        afterCancel.statusName === "With external counsel" && afterCancel.closedAt === null,
        "cancel changed",
      );
      await pick("Closed", "Closed");
      await dialog.waitFor();
      await note.fill("DOC-029r2 fictional closing note for the walkthrough.");
      const s = await patchAfter(page, n, () =>
        dialog.getByRole("button", { name: "Close matter" }).click(),
      );
      await dialog.waitFor({ state: "hidden" });
      await page.reload();
      const closed = (await matterByNumber(page, n)).matter;
      const overviewClosed = await closedValue();
      await page
        .getByRole("toolbar", { name: "Applets" })
        .getByRole("button", { name: "History" })
        .click();
      const history = page.getByRole("complementary", { name: "History" });
      await history.getByText("Closing note").first().waitFor();
      const firstEntry = (await history.getByRole("listitem").first().innerText()).replace(
        /\s+/g,
        " ",
      );
      const child = (await matterByNumber(page, state.child)).matter;
      const contract = (await api(page, "GET", `/contracts/${state.contract}`)).json.contract;
      const tasks = (await api(page, "GET", `/matters/${n}/tasks`)).json.tasks;
      const dates = (await api(page, "GET", `/matters/${n}/key-dates`)).json.deadlines;
      const inDefault = (await listTitles(page, "")).includes(t);
      expectThat(
        disabledEmpty && maxKept === 2000 && s === 200,
        `${disabledEmpty} ${maxKept} ${s}`,
      );
      expectThat(
        closed.statusCategory === "closed" &&
          closed.closedAt &&
          closed.openedAt === before.openedAt,
        "closed dates",
      );
      expectThat(
        overviewClosed !== "Still open" && firstEntry.includes("Closing note"),
        `${overviewClosed} ${firstEntry}`,
      );
      expectThat(child.statusCategory === "open" && contract.stage === "draft", "contract/child");
      expectThat(
        tasks.every((x) => !x.isDone) &&
          dates.length === 1 &&
          closed.nextDeadline === null &&
          !inDefault,
        "surfaces",
      );
      return `Closed group > Closed opened "Close ${t}?"; Close matter was disabled with an empty note; typing 2,100 characters kept ${maxKept}. Dialog text: ${q(text.slice(0, 400))}. Cancel kept Status ${q(afterCancel.statusName)}. Close matter with a note saved (${s}): Category closed, Closed ${closed.closedAt}, Opened unchanged; Overview Closed reads ${q(overviewClosed)}; History first entry ${q(firstEntry)}. Child M-${state.child} still ${child.statusName}; Contract C-${state.contract} still ${contract.statusName}; Task not done; Key date kept (${dates.length}); nextDeadline null; default list includes it: ${inDefault}.`;
    },
  );

  await step(
    "Close or reopen: a closed Matter stays editable, and Filter > Show closed finds it",
    "Permitted users continue editing a closed Matter; the default list omits it and Show closed lists it.",
    async () => {
      const { n, t } = state;
      await page.goto(`${BASE}/matters/${n}`);
      const desc = page.getByRole("main").getByRole("textbox", { name: "Description" });
      const s = await patchAfter(page, n, async () => {
        await desc.fill("Edited while closed (fictional).");
        await desc.blur();
      });
      const taskAdd = await api(page, "POST", `/matters/${n}/tasks`, {
        title: "DOC-029r2 closed task",
      });
      await page.goto(`${BASE}/matters`);
      await page.waitForLoadState("networkidle");
      const defaultListed = await listedInTable(t);
      await openFilterAnd(["Show closed"]);
      const closedListed = await listedInTable(t);
      expectThat(
        s === 200 && taskAdd.status === 201 && !defaultListed && closedListed,
        `${s} ${taskAdd.status} ${defaultListed} ${closedListed}`,
      );
      return `Description saved on the closed Matter (${s}); a Task write answered ${taskAdd.status}. Matters default table listed it: ${defaultListed}; after Filter > Show closed: ${closedListed}.`;
    },
  );

  await step(
    "Close or reopen: choose an open Status from a closed Matter, Cancel, then Reopen matter",
    "The reopen dialog uses the chosen open Status; Cancel keeps it closed; Reopen matter clears the Closed date (Overview shows Still open), keeps Opened, returns future Key dates to active deadlines, and History keeps the transitions.",
    async () => {
      const { n, t, before } = state;
      await page.goto(`${BASE}/matters/${n}`);
      await pick("In progress", "In progress");
      const dialog = page.getByRole("dialog", { name: `Reopen ${t}?` });
      await dialog.waitFor();
      const text = (await dialog.innerText()).replace(/\s+/g, " ");
      await dialog.getByRole("button", { name: "Cancel" }).click();
      await dialog.waitFor({ state: "hidden" });
      const still = (await matterByNumber(page, n)).matter;
      await pick("In progress", "In progress");
      await dialog.waitFor();
      const s = await patchAfter(page, n, () =>
        dialog.getByRole("button", { name: "Reopen matter" }).click(),
      );
      await dialog.waitFor({ state: "hidden" });
      const reopened = (await matterByNumber(page, n)).matter;
      await page.reload();
      const overviewClosed = await closedValue();
      await page
        .getByRole("toolbar", { name: "Applets" })
        .getByRole("button", { name: "History" })
        .click();
      const history = page.getByRole("complementary", { name: "History" });
      await history.getByRole("listitem").first().waitFor();
      const entries = (await history.getByRole("listitem").allInnerTexts()).map((x) =>
        x.replace(/\s+/g, " ").trim(),
      );
      expectThat(still.statusCategory === "closed" && s === 200, "cancel/save");
      expectThat(
        reopened.statusName === "In progress" &&
          reopened.closedAt === null &&
          reopened.openedAt === before.openedAt,
        "reopen dates",
      );
      expectThat(
        overviewClosed === "Still open" && reopened.nextDeadline !== null,
        `${overviewClosed} ${q(reopened.nextDeadline)}`,
      );
      const statusEntries = entries.filter((e) => e.includes("changed the status"));
      expectThat(statusEntries.length >= 4, q(statusEntries));
      return `In progress group > In progress opened ${q(text)}; Cancel kept Category ${still.statusCategory}. Reopen matter saved (${s}): Status ${reopened.statusName}, Closed null, Opened unchanged ${reopened.openedAt}; Overview Closed reads ${q(overviewClosed)}; nextDeadline ${q(reopened.nextDeadline)}. History status entries: ${q(statusEntries)}.`;
    },
  );

  await step(
    "Archive or restore: Matter actions > Archive, Cancel, then Archive; archived controls and refusals",
    "Cancel changes nothing; Archive keeps the M- reference and History, removes it from default lists, freezes ordinary changes (Status strip without Move to), and leaves children and the linked Contract unarchived.",
    async () => {
      const { n, t } = state;
      const close = await api(page, "PATCH", `/matters/${n}`, {
        statusId: statusId("Closed"),
        closingNote: "DOC-029r2 closed again before archiving.",
      });
      await page.goto(`${BASE}/matters/${n}`);
      await page.getByRole("button", { name: "Matter actions" }).click();
      await page.getByRole("menuitem", { name: "Archive" }).click();
      const dialog = page.getByRole("dialog", { name: `Archive ${t}?` });
      await dialog.waitFor();
      const text = (await dialog.innerText()).replace(/\s+/g, " ");
      await dialog.getByRole("button", { name: "Cancel" }).click();
      await dialog.waitFor({ state: "hidden" });
      const notYet = (await matterByNumber(page, n)).matter.archivedAt;
      await page.getByRole("button", { name: "Matter actions" }).click();
      await page.getByRole("menuitem", { name: "Archive" }).click();
      await dialog.getByRole("button", { name: "Archive", exact: true }).click();
      await header(t).getByText("Archived", { exact: true }).waitFor();
      const archived = (await matterByNumber(page, n)).matter;
      const moveButtons = await header(t)
        .getByRole("button", { name: /move matter$/ })
        .count();
      const strip = (await header(t).getByRole("list", { name: "Status" }).innerText()).replace(
        /\s+/g,
        " ",
      );
      const descriptionBox = await page
        .getByRole("main")
        .getByRole("textbox", { name: "Description" })
        .count();
      const ref = await header(t).getByText(`M-${n}`, { exact: true }).isVisible();
      const write = await api(page, "PATCH", `/matters/${n}`, {
        description: "Should be refused.",
      });
      const statusWrite = await api(page, "PATCH", `/matters/${n}`, {
        statusId: statusId("Open"),
        confirmReopen: true,
      });
      const child = (await matterByNumber(page, state.child)).matter;
      const contract = (await api(page, "GET", `/contracts/${state.contract}`)).json.contract;
      const inDefault = (await listTitles(page, "includeClosed=true")).includes(t);
      await page
        .getByRole("toolbar", { name: "Applets" })
        .getByRole("button", { name: "History" })
        .click();
      await page
        .getByRole("complementary", { name: "History" })
        .getByText("archived this matter")
        .first()
        .waitFor();
      const historyCount = await page
        .getByRole("complementary", { name: "History" })
        .getByRole("listitem")
        .count();
      expectThat(close.status === 200 && notYet === null && archived.archivedAt, "archive");
      expectThat(
        moveButtons === 0 &&
          descriptionBox === 0 &&
          ref &&
          write.status === 409 &&
          statusWrite.status === 409 &&
          !inDefault,
        `${moveButtons} ${descriptionBox} ${write.status} ${statusWrite.status} ${inDefault}`,
      );
      expectThat(
        historyCount >= 5 && !child.archivedAt && "archivedAt" in contract && !contract.archivedAt,
        `history ${historyCount}; contract keys ${Object.keys(contract).includes("archivedAt")}`,
      );
      return `Fixture: the Matter was closed again through the API (${close.status}). Matter actions > Archive opened ${q(text)}; Cancel left archivedAt ${notYet}. Archive confirmed: header shows M-${n} and "Archived"; Status strip reads ${q(strip)} with ${moveButtons} Move to buttons; Description textbox count ${descriptionBox}; direct Description and Status writes answered ${write.status} (${q(write.json?.detail)}) and ${statusWrite.status}; the list with closed included omits it: ${!inDefault}. History has ${historyCount} entries, the newest "archived this matter". Child M-${state.child} archivedAt ${child.archivedAt}; Contract C-${state.contract} archivedAt ${contract.archivedAt ?? null}.`;
    },
  );

  await step(
    "Archive or restore: find it with Show archived and Show closed, Restore Cancel, then Restore",
    "Show archived alone does not list a closed archived Matter; adding Show closed does; Restore Cancel keeps it archived; Restore makes it editable and keeps it closed.",
    async () => {
      const { n, t } = state;
      await openFilterAnd(["Show archived"]);
      const archivedOnly = await listedInTable(t);
      await page
        .getByRole("button", { name: /^Filter/ })
        .first()
        .click();
      await page.getByRole("button", { name: "Show closed", exact: true }).click();
      await page.waitForLoadState("networkidle");
      await page.keyboard.press("Escape");
      await page.waitForTimeout(800);
      const both = await listedInTable(t);
      await page.getByRole("link", { name: t, exact: true }).click();
      await page.waitForURL(new RegExp(`/matters/${n}$`));
      await page.getByRole("button", { name: "Matter actions" }).click();
      await page.getByRole("menuitem", { name: "Restore" }).click();
      const dialog = page.getByRole("dialog", { name: `Restore ${t}?` });
      await dialog.waitFor();
      const text = (await dialog.innerText()).replace(/\s+/g, " ");
      await dialog.getByRole("button", { name: "Cancel" }).click();
      await dialog.waitFor({ state: "hidden" });
      const still = (await matterByNumber(page, n)).matter.archivedAt;
      await page.getByRole("button", { name: "Matter actions" }).click();
      await page.getByRole("menuitem", { name: "Restore" }).click();
      await dialog.getByRole("button", { name: "Restore", exact: true }).click();
      await dialog.waitFor({ state: "hidden" });
      await page.waitForTimeout(800);
      const restored = (await matterByNumber(page, n)).matter;
      await page.reload();
      await header(t)
        .getByRole("button", { name: "Closed — move matter" })
        .waitFor({ timeout: 15000 })
        .catch(() => {});
      const moveButtons = await header(t)
        .getByRole("button", { name: /move matter$/ })
        .count();
      const desc = page.getByRole("main").getByRole("textbox", { name: "Description" });
      const s = await patchAfter(page, n, async () => {
        await desc.fill("Edited after restore (fictional).");
        await desc.blur();
      });
      expectThat(!archivedOnly && both && still, `${archivedOnly} ${both} ${still}`);
      expectThat(
        restored.archivedAt === null &&
          restored.statusCategory === "closed" &&
          moveButtons === 4 &&
          s === 200,
        `${q(restored.statusCategory)} ${moveButtons} ${s}`,
      );
      return `Filter > Show archived listed it: ${archivedOnly}; with Show closed added: ${both}. Matter actions > Restore opened ${q(text)}; Cancel kept archivedAt ${still}. Restore confirmed: archivedAt null, Status ${q(restored.statusName)} (Category ${restored.statusCategory}), ${moveButtons} Status groups with Move to menus, Description saved (${s}).`;
    },
  );

  await step(
    "Before you start (negative): a Business User reads the Status in the Portal but cannot change, close, reopen, archive or restore",
    "The Portal shows the Status name with no lifecycle controls; direct Status, archive and restore writes are refused.",
    async () => {
      const { n, t } = state;
      const bu = await ctx.session("business_user");
      await bu.page.goto(`${BASE}/portal/matters/${n}`);
      await bu.page.getByText(t).first().waitFor();
      const current = (await matterByNumber(page, n)).matter.statusName;
      const body = (await bu.page.getByRole("main").innerText()).replace(/\s+/g, " ");
      const controls = await bu.page
        .getByRole("button", {
          name: /move matter|Matter actions|Close matter|Reopen matter|Archive|Restore/,
        })
        .count();
      await bu.page.goto(`${BASE}/matters/${n}`);
      await bu.page.waitForLoadState("networkidle");
      const staff = new URL(bu.page.url()).pathname;
      const statusWrite = (
        await api(bu.page, "PATCH", `/matters/${n}`, {
          statusId: statusId("Open"),
          confirmReopen: true,
        })
      ).status;
      const archive = (await api(bu.page, "POST", `/matters/${n}/archive`)).status;
      const restore = (await api(bu.page, "POST", `/matters/${n}/restore`)).status;
      expectThat(body.includes(current) && controls === 0, `${current} ${controls}`);
      expectThat(
        [statusWrite, archive, restore].every((x) => x === 403),
        `${statusWrite} ${archive} ${restore}`,
      );
      return `Jonas Weber (Business User on the team) opened /portal/matters/${n}; the page text includes the Status ${q(current)} and has ${controls} Status, Matter actions, Close, Reopen, Archive or Restore controls. Opening the staff route /matters/${n} ended at ${staff}. Direct Status, archive and restore writes answered ${statusWrite}/${archive}/${restore}.`;
    },
  );
}
