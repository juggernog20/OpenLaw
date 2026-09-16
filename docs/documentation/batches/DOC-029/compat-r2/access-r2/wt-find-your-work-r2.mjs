// V-C03 find-your-work: followed from docs/user-guides/find-your-work.md for Administrator and Legal Team Member.
// Seeded Daniel and Nadia read Home as it is; the "DOC-029r2 access" fresh accounts carry the reviewer's Task fixtures.
import { BASE, SEED, api, ensureStaffAccounts, newContext, passwordSignIn, sleep, sql, text } from "./lib-r2.mjs";

const A = "find-your-work";
const ORDER = ["Approvals waiting on you", "Tasks assigned to you", "Dates approaching", "Entity obligations", "Inbox", "Your contracts", "Your matters"];
const iso = (days) => new Date(Date.now() + days * 86400000).toISOString().slice(0, 10);

async function signInAs(email, password) {
  const c = await newContext();
  await c.page.goto(`${BASE}/auth/login`);
  await c.page.getByLabel("Email").fill(email);
  await c.page.getByLabel("Password").fill(password);
  await c.page.getByRole("button", { name: "Sign in", exact: true }).click();
  await c.page.waitForURL((u) => !u.pathname.startsWith("/auth"), { timeout: 30000 });
  return c;
}

export async function run(log, fx) {
  const admin = await passwordSignIn(SEED.daniel.email);
  await ensureStaffAccounts(fx, admin.page);
  const stamp = Date.now();
  const must = (r, what) => {
    if (r.status >= 300) throw new Error(`${what}: ${r.status} ${JSON.stringify(r.body).slice(0, 200)}`);
    return r.body;
  };
  const users = must(await api(admin.page, "GET", "/users"), "users").users;
  const uid = (email) => users.find((u) => u.email === email)?.id;
  const ctypes = must(await api(admin.page, "GET", "/contract-types"), "ctypes").contractTypes;
  const nda = ctypes.find((t) => t.displayName === "NDA").id;

  // Fixtures created by the Administrator through the API.
  const home = must(await api(admin.page, "POST", "/contracts", { title: `DOC-029r2 access Home contract ${stamp}`, contractTypeId: nda, managerId: uid(SEED.daniel.email) }), "contract").contract;
  const conf = must(await api(admin.page, "POST", "/contracts", { title: `DOC-029r2 access confidential contract ${stamp}`, contractTypeId: nda, managerId: uid(SEED.daniel.email), isConfidential: true }), "confidential").contract;
  fx.created.push(`Contract C-${home.number} DOC-029r2 access Home contract ${stamp}`, `Confidential Contract C-${conf.number} DOC-029r2 access confidential contract ${stamp} (Daniel's team only)`);
  fx.confidential = { number: conf.number, title: conf.title };
  const seededTask = {};
  for (const [role, email] of [["administrator", SEED.daniel.email], ["legal_team_member", SEED.nadia.email]]) {
    const title = `DOC-029r2 access Home task ${role} ${stamp}`;
    must(await api(admin.page, "POST", `/contracts/${home.number}/tasks`, { title, assigneeId: uid(email), addToTeam: true, dueDate: iso(-400) }), "seeded task");
    seededTask[role] = title;
  }
  // Fresh accounts: 53 dated and 2 undated Tasks each, created after the empty-list check below.

  for (const [role, seed] of [["administrator", SEED.daniel], ["legal_team_member", SEED.nadia]]) {
    const R = (step, expected, actual, pass) => log.record(A, role, step, expected, actual, pass);
    const s = role === "administrator" ? admin : await passwordSignIn(seed.email);
    const p = s.page;

    // Open work from Home.
    await p.getByRole("navigation", { name: "Primary" }).getByRole("link", { name: "Home", exact: true }).click();
    await p.waitForURL(`${BASE}/`);
    await p.getByRole("region", { name: "Tasks assigned to you" }).waitFor({ timeout: 20000 });
    await sleep(1500);
    const present = [];
    for (const name of ORDER) if (await p.locator("main").getByRole("heading", { level: 2, name, exact: true }).count()) present.push(name);
    const domOrder = await p.locator("main h2").evaluateAll((els) => els.map((e) => e.textContent.trim()));
    const seen = domOrder.filter((t) => present.includes(t));
    const ordered = seen.length === present.length && seen.every((t, i) => t === present[i]);
    const homeApi = must(await api(p, "GET", "/home"), "home").sections;
    const apiTypes = homeApi.map((x) => `${x.type}:${x.total}`);
    const zeroOmitted = homeApi.every((x) => x.total > 0);
    const taskRow = p.getByRole("region", { name: "Tasks assigned to you" }).getByRole("link", { name: new RegExp(seededTask[role]) });
    const taskOnCard = await taskRow.isVisible().catch(() => false);
    await taskRow.click();
    await p.waitForURL(new RegExp(`/contracts/${home.number}/tasks`), { timeout: 15000 });
    await sleep(1500);
    const head = await text(p.getByRole("region", { name: home.title }));
    const numberTitle = head.includes(`C-${home.number}`) && head.includes(home.title);
    const sections = p.getByRole("navigation", { name: "Contract sections" });
    await sections.getByRole("link", { name: "Fields" }).click();
    const fieldsOk = await p.waitForURL(new RegExp(`/contracts/${home.number}/fields`)).then(() => true, () => false);
    await sections.getByRole("link", { name: "Documents" }).click();
    const docsOk = await p.waitForURL(new RegExp(`/contracts/${home.number}/documents`)).then(() => true, () => false);
    await p.getByRole("navigation", { name: "Primary" }).getByRole("link", { name: "Home", exact: true }).click();
    const backHome = await p.waitForURL(`${BASE}/`).then(() => true, () => false);
    R(
      "Open work from Home, steps 1-5",
      "Home lists only sections with work, in the documented order; a Task title opens its record; the record shows its number and title; Fields and Documents section links work; Home returns",
      `Sections shown in order: ${present.join(" > ")} (order matches ${ordered}); API sections ${apiTypes.join(", ")} (no zero-total section ${zeroOmitted}); reviewer Task on the card ${taskOnCard}; opened C-${home.number} with number and title ${numberTitle}; Fields ${fieldsOk}; Documents ${docsOk}; Home ${backHome}`,
      ordered && zeroOmitted && taskOnCard && numberTitle && fieldsOk && docsOk && backHome && present.includes("Tasks assigned to you"),
    );

    // Section meanings that can be checked against record data.
    const me = uid(seed.email);
    const cRows = homeApi.find((x) => x.type === "contracts")?.rows ?? [];
    const mRows = homeApi.find((x) => x.type === "matters")?.rows ?? [];
    const cMgr = cRows.map((r) => sql(`select manager_id from contracts where number=${r.contract?.number ?? r.number}`));
    const mMgr = mRows.map((r) => sql(`select manager_id from matters where number=${r.matter?.number ?? r.number}`));
    const taskRows = homeApi.find((x) => x.type === "tasks")?.rows ?? [];
    const approvalsVisible = homeApi.some((x) => x.type === "approvals");
    R(
      "section contents: Your contracts by Owner, Your matters by Matter Manager, Tasks open and assigned",
      "Your contracts rows have you as Owner; Your matters rows have you as Matter Manager; Tasks rows are open",
      `Your contracts rows ${cRows.length}, all managed by this account ${cMgr.every((m) => m === me)}; Your matters rows ${mRows.length}, all managed by this account ${mMgr.every((m) => m === me)}; Task rows open ${taskRows.every((t) => !t.isDone)}; Approvals section present ${approvalsVisible}`,
      cMgr.every((m) => m === me) && mMgr.every((m) => m === me) && taskRows.every((t) => !t.isDone),
    );

    // Task due dates do not feed Dates approaching; View all opens Your dates.
    const datesRows = JSON.stringify(homeApi.find((x) => x.type === "dates") ?? {});
    const taskInDates = datesRows.includes(seededTask[role]) || datesRows.includes(`"number":${home.number}`);
    const datesCard = p.getByRole("region", { name: "Dates approaching" });
    let yourDates = false;
    if (await datesCard.isVisible().catch(() => false)) {
      await datesCard.getByRole("button", { name: /^View all \d+$/ }).click();
      yourDates = await p.getByRole("dialog").getByText("Your dates").first().isVisible().catch(() => false);
      const dialogText = yourDates ? await text(p.getByRole("dialog")) : "";
      yourDates = yourDates && !dialogText.includes(seededTask[role]);
      await p.keyboard.press("Escape");
      await sleep(500);
    }
    R("Task due dates do not feed Dates approaching; View all opens Your dates", "The reviewer Task's due date is absent from Dates approaching and Your dates; View all opens Your dates", `Task or its Contract in Dates approaching ${taskInDates}; Your dates opened without the Task ${yourDates}`, !taskInDates && yourDates);

    // Keyboard navigation and Help.
    await p.goto(`${BASE}/`);
    await p.getByRole("region", { name: "Tasks assigned to you" }).waitFor();
    await p.locator("body").click({ position: { x: 5, y: 400 } });
    await p.keyboard.press("?");
    const sheet = await p.getByRole("dialog").getByText("Keyboard shortcuts").first().waitFor({ timeout: 5000 }).then(() => true, () => false);
    await p.keyboard.press("Escape");
    const sheetClosed = await p.getByRole("dialog").waitFor({ state: "hidden", timeout: 5000 }).then(() => true, () => false);
    await p.getByRole("button", { name: seed.name, exact: true }).click();
    const menuOpen = await p.getByRole("menu").isVisible();
    await p.keyboard.press("Escape");
    const menuClosed = await p.getByRole("menu").waitFor({ state: "hidden", timeout: 5000 }).then(() => true, () => false);
    await p.locator("body").click({ position: { x: 5, y: 400 } });
    await p.keyboard.press("/");
    const searchFocused = await p.getByRole("combobox", { name: "Search" }).evaluate((el) => el === document.activeElement);
    await p.keyboard.type("?/x");
    await sleep(500);
    const typed = await p.getByRole("combobox", { name: "Search" }).inputValue();
    const noSheet = !(await p.getByRole("dialog").filter({ hasText: "Keyboard shortcuts" }).isVisible().catch(() => false));
    await p.getByRole("combobox", { name: "Search" }).fill("");
    await p.keyboard.press("Escape");
    await p.getByRole("navigation", { name: "Primary" }).getByRole("link", { name: "Contracts" }).focus();
    await p.keyboard.press("Tab");
    const tabMoved = await p.evaluate(() => document.activeElement?.textContent?.trim());
    await p.getByRole("navigation", { name: "Primary" }).getByRole("link", { name: "Contracts" }).focus();
    await p.keyboard.press("Enter");
    const enterOk = await p.waitForURL(/\/contracts$/, { timeout: 10000 }).then(() => true, () => false);
    R(
      "keyboard: ?, Escape, /, Tab and Enter; typing in a field keeps the characters",
      "? opens Keyboard shortcuts; Escape closes a dialog and a menu; / focuses record search; Tab moves focus; Enter activates a link; ? and / typed in a field stay in the field",
      `Sheet opened ${sheet}, closed by Escape ${sheetClosed}; name menu open ${menuOpen}, closed by Escape ${menuClosed}; / focused Search ${searchFocused}; typed value "${typed}" with no sheet ${noSheet}; Tab moved focus to "${tabMoved}"; Enter on Contracts link navigated ${enterOk}`,
      sheet && sheetClosed && menuOpen && menuClosed && searchFocused && typed === "?/x" && noSheet && !!tabMoved && enterOk,
    );

    await p.goto(`${BASE}/`);
    await p.getByRole("region", { name: "Tasks assigned to you" }).waitFor();
    await p.getByRole("banner").getByRole("link", { name: "Help" }).click();
    await p.waitForURL(/\/help/);
    await p.getByRole("searchbox", { name: "Search documentation" }).fill("Find your work on Home");
    await p.getByRole("searchbox", { name: "Search documentation" }).press("Enter");
    await p.locator("main").getByRole("link", { name: "Find your work on Home" }).waitFor({ timeout: 15000 }).catch(() => {});
    const helpText = await text(p.locator("main"));
    const helpFound = helpText.includes("Find your work on Home");
    const recordLeak = helpText.includes(home.title);
    R("Help in the header opens product instructions and its search searches guides", "Help opens from Home; its search finds the guide, not records", `Help URL ${new URL(p.url()).pathname}${new URL(p.url()).search.slice(0, 60)}; result summary "${(helpText.match(/\d+ results?/) ?? ["none"])[0]}"; guide found ${helpFound}; reviewer Contract title in Help results ${recordLeak}`, helpFound && !recordLeak);

    // Unavailable records.
    const nf = {};
    for (const [path, titleText, back, ref] of [
      ["/contracts/999999", "Contract not found", "Back to Contracts", "C-999999"],
      ["/matters/999999", "Matter not found", "Back to Matters", "M-999999"],
      ...(role === "legal_team_member" ? [[`/contracts/${conf.number}`, "Contract not found", "Back to Contracts", `C-${conf.number}`]] : []),
    ]) {
      await p.goto(`${BASE}${path}`);
      const t = await p.getByText(titleText).first().waitFor({ timeout: 15000 }).then(() => true, () => false);
      const body = await text(p.locator("body"));
      const said = body.includes(`${ref} does not exist, or you cannot open it.`);
      const leaked = body.includes(conf.title);
      await p.getByRole("link", { name: back }).click();
      const returned = await p.waitForURL(new RegExp(`${back.endsWith("Contracts") ? "/contracts" : "/matters"}$`), { timeout: 10000 }).then(() => true, () => false);
      nf[path] = { title: t, message: said, backLink: returned, leaked };
    }
    const nfOk = Object.values(nf).every((v) => v.title && v.message && v.backLink && !v.leaked);
    R("unavailable record pages", "Contract not found or Matter not found says the record does not exist or you cannot open it; Back to Contracts or Back to Matters returns to the list", JSON.stringify(nf).replace(/"/g, "'"), nfOk);
    if (role !== "administrator") await s.context.close();
  }

  // Your Tasks with the fresh accounts.
  for (const role of ["administrator", "legal_team_member"]) {
    const R = (step, expected, actual, pass) => log.record(A, role, step, expected, actual, pass);
    const acct = fx.accounts[role];
    const c = await signInAs(acct.email, acct.password);
    const p = c.page;
    await p.getByRole("navigation", { name: "Primary" }).getByRole("link", { name: "My Tasks" }).click();
    await p.waitForURL(/\/home\/tasks/);
    const empty = await p.getByText("No open Tasks assigned to you.").waitFor({ timeout: 15000 }).then(() => true, () => false);
    await p.goto(`${BASE}/`);
    await sleep(2500);
    const noCard = !(await p.getByRole("region", { name: "Tasks assigned to you" }).isVisible().catch(() => false));
    const welcome = await p.getByText("Welcome to OpenLaw").isVisible().catch(() => false);
    const freshSections = (must(await api(p, "GET", "/home"), "home fresh").sections ?? []).map((x) => x.type);
    R("empty Tasks list and absent Home card", "No open Tasks assigned to you. on Your Tasks; no Tasks assigned to you card on Home", `Empty message ${empty}; Home Tasks card absent ${noCard}; Home sections for this account: ${freshSections.join(", ") || "none"}; Welcome to OpenLaw shown ${welcome}`, empty && noCard && (freshSections.length > 0 || welcome));

    const titles = [];
    for (let i = 0; i < 55; i++) {
      const dated = i < 53;
      const title = `DOC-029r2 access Task ${String(i + 1).padStart(2, "0")} ${dated ? "dated" : "undated"} ${role} ${stamp}`;
      must(await api(admin.page, "POST", `/contracts/${home.number}/tasks`, { title, assigneeId: acct.userId, addToTeam: true, dueDate: dated ? iso(5 + (53 - i)) : null }), "fresh task");
      titles.push({ title, dated, due: dated ? iso(5 + (53 - i)) : null });
    }
    fx.created.push(`55 Tasks on C-${home.number} assigned to ${acct.email}`);

    await p.goto(`${BASE}/`);
    const card = p.getByRole("region", { name: "Tasks assigned to you" });
    await card.waitFor({ timeout: 15000 });
    await card.getByRole("link", { name: "View all 55" }).click();
    const viaViewAll = await p.waitForURL(/\/home\/tasks/).then(() => true, () => false);
    await p.getByText("Your Tasks").first().waitFor();
    await sleep(1500);
    const list = p.getByRole("region", { name: "Tasks assigned to you" }).or(p.locator("main"));
    const rowCount = async () => p.locator("main li").filter({ hasText: `${role} ${stamp}` }).count();
    const before = await rowCount();
    const loadMore = p.getByRole("button", { name: "Load more Tasks" });
    const hasLoadMore = await loadMore.isVisible();
    await loadMore.click();
    await sleep(2500);
    const after = await rowCount();
    const shown = await p.locator("main li").filter({ hasText: `${role} ${stamp}` }).evaluateAll((els) => els.map((e) => e.innerText.split("\n")[0].trim()));
    const expectedOrder = [...titles].sort((a, b) => (a.due ?? "9999") < (b.due ?? "9999") ? -1 : (a.due ?? "9999") > (b.due ?? "9999") ? 1 : 0).map((t) => t.title);
    const idxs = expectedOrder.map((t) => shown.findIndex((x) => x.includes(t)));
    const inOrder = idxs.every((v, i) => v >= 0 && (i === 0 || v > idxs[i - 1]));
    const undatedLast = shown.slice(-2).every((x) => x.includes("undated"));
    R(
      "Open all your Tasks: View all, Your Tasks, Load more Tasks, due-date order with undated last",
      "View all with the count opens Your Tasks; Load more Tasks adds the next page; Tasks follow due date with undated Tasks last",
      `View all 55 opened /home/tasks ${viaViewAll}; rows ${before} then ${after} after Load more Tasks (shown ${hasLoadMore}); order by due date ${inOrder}; last two rows undated ${undatedLast}`,
      viaViewAll && hasLoadMore && before === 50 && after === 55 && inOrder && undatedLast,
    );

    // Completion, Undo, Show completed, reopen.
    const t1 = titles[52].title;
    await p.getByRole("checkbox", { name: `Complete Task: ${t1}` }).click();
    const done = await p.getByText(`Completed: ${t1}`).waitFor({ timeout: 10000 }).then(() => true, () => false);
    await p.getByRole("button", { name: "Undo" }).click();
    await sleep(2000);
    const undone = sql(`select is_done from contract_tasks where title='${t1}'`) === "f";
    const undoRow = await p.locator("main li").filter({ hasText: t1 }).count();
    await p.getByRole("checkbox", { name: `Complete Task: ${t1}` }).click();
    await p.getByText(`Completed: ${t1}`).waitFor({ timeout: 10000 });
    await sleep(1500);
    const gone = (await p.locator("main li").filter({ hasText: t1 }).count()) === 0;
    const toggle = p.getByRole("switch", { name: "Show completed" }).or(p.getByRole("checkbox", { name: "Show completed" })).or(p.getByRole("button", { name: "Show completed" }));
    await toggle.first().click();
    await sleep(2500);
    const hideLabel = (await p.getByText("Hide completed").count()) > 0;
    const completedShown = (await p.locator("main li").filter({ hasText: t1 }).count()) > 0;
    if (role === "administrator") await p.screenshot({ path: `${process.env.SHOT_DIR ?? "/tmp/claude-1000"}/r2-access-${role}-${Date.now()}.png` });
    await p.getByRole("checkbox", { name: `Reopen Task: ${t1}` }).click();
    const reopened = await p.getByText(`Reopened: ${t1}`).waitFor({ timeout: 10000 }).then(() => true, () => false);
    const dbOpen = sql(`select is_done from contract_tasks where title='${t1}'`) === "f";
    const hideToggle = p.getByRole("switch", { name: "Hide completed" }).or(p.getByRole("checkbox", { name: "Hide completed" })).or(p.getByRole("button", { name: "Hide completed" }));
    await hideToggle.first().click();
    await sleep(2000);
    const showLabelBack = (await p.getByText("Show completed").count()) > 0;
    R(
      "complete, Undo, Show completed / Hide completed, reopen by clearing the control",
      "Completion shows Completed with Undo; Undo reopens; Show completed adds completed Tasks and the label says Hide completed; clearing a completed Task's control shows Reopened",
      `Completed message ${done}; Undo reopened (database open ${undone}, row present ${undoRow > 0}); completed row left the open list ${gone}; after Show completed: label Hide completed ${hideLabel}, completed row listed ${completedShown}; Reopened message ${reopened}, database open ${dbOpen}; switch turned off, label Show completed ${showLabelBack}`,
      done && undone && undoRow > 0 && gone && hideLabel && completedShown && reopened && dbOpen && showLabelBack,
    );

    // Task title opens its owning record; Home in navigation returns.
    await p.locator("main li").filter({ hasText: titles[51].title }).getByRole("link").first().click();
    const owning = await p.waitForURL(new RegExp(`/contracts/${home.number}/tasks`), { timeout: 15000 }).then(() => true, () => false);
    await p.getByRole("navigation", { name: "Primary" }).getByRole("link", { name: "Home", exact: true }).click();
    const homeBack = await p.waitForURL(`${BASE}/`).then(() => true, () => false);
    R("Your Tasks: Task title opens its owning record; Home in the app navigation returns", "Task title opens the Contract; Home returns", `Opened /contracts/${home.number}/tasks ${owning}; Home ${homeBack}`, owning && homeBack);
    await c.context.close();
  }
  if (!fx.keepAdmin) await admin.context.close();
}
