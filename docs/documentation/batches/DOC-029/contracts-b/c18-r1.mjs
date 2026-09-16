// V-C18: "Manage Contract terms and renewals", followed as written for one role.
import path from "node:path";

export async function runC18(ctx, step) {
  const { actor, otherSession, role, other, PEOPLE, userId, typeId, stamp, helpers, here } = ctx;
  const { expectThat, isoPlusDays, isPatchOf, pickDate, sleep, text, withResponse, BASE } = helpers;
  const p = actor.page;
  const fix = (name) => path.join(here, "fixtures", name);
  const read = async (num, session = actor) => (await session.api("GET", `/contracts/${num}`)).json?.contract;
  const tag = `${role} ${stamp}`;
  let num;
  let parentTitle;

  const overview = async () => {
    await p.goto(`${BASE}/contracts/${num}`);
    await p.getByRole("heading", { name: "Contract", exact: true, level: 2 }).waitFor();
  };
  const keyDateRows = async () => {
    await p.goto(`${BASE}/contracts/${num}/key-dates`);
    const region = p.getByRole("region", { name: "Key dates" });
    await region.waitFor();
    await sleep(500);
    const rows = region.getByRole("row");
    const count = await rows.count();
    const out = [];
    for (let i = 1; i < count; i++) {
      const row = rows.nth(i);
      out.push({ text: await text(row), actions: await row.getByRole("button").count() });
    }
    return out;
  };
  const approvals = async () => {
    await p.goto(`${BASE}/contracts/${num}/approvals`);
    await p.getByRole("region", { name: "Approvals & signing" }).waitFor();
    await sleep(500);
  };

  await step(
    "Prepare an unarchived Contract with an Entity, a Counterparty, a value, a High priority and risk, the Confidential flag, and the other staff role and a Business User on the team",
    "Prerequisite record exists for this role",
    async () => {
      parentTitle = `DOC-029 contracts-b C18 ${tag}`;
      const created = await actor.api("POST", "/contracts", {
        title: parentTitle,
        contractTypeId: typeId("NDA"),
        managerId: userId(PEOPLE[role].name),
        isConfidential: true,
      });
      expectThat(created.status === 201, `create answered ${created.status}`);
      num = created.json.contract.number;
      for (const name of [PEOPLE[other].name, PEOPLE.businessUser.name]) {
        const t = await actor.api("POST", `/contracts/${num}/team`, { userId: userId(name) });
        expectThat(t.status < 300, `team add ${name} answered ${t.status}`);
      }
      const entities = (await actor.api("GET", "/entities?limit=100")).json;
      const list = entities.entities ?? entities.items ?? entities.rows ?? [];
      const entity = list.find((e) => e.legalName === "Helix Software Ltd") ?? list[0];
      const patches = [
        { entityId: entity.id },
        { value: { amount: 990000, currency: "GBP", cadence: "annually" } },
        { priority: "high" },
        { risk: "high" },
      ];
      for (const body of patches) {
        const r = await actor.api("PATCH", `/contracts/${num}`, body);
        expectThat(r.status === 200, `PATCH ${Object.keys(body)[0]} answered ${r.status}`);
      }
      const cp = await actor.api("POST", `/contracts/${num}/counterparties`, { name: `DOC-029 contracts-b Counterparty ${tag}` });
      expectThat(cp.status < 300, `counterparty answered ${cp.status}`);
      ctx.records.push({ article: "terms-and-renewals", role, purpose: "term and renewal", reference: `C-${num}` });
      return `C-${num} "${parentTitle}" created by ${PEOPLE[role].name}; entity ${entity.legalName}; value GBP 9,900.00 annually; priority High; risk High; Confidential; team adds ${PEOPLE[other].name} and ${PEOPLE.businessUser.name}.`;
    },
  );

  await step(
    "Overview Contract card: choose Term type Fixed term, then pick Effective date and Expiry date and type Notice period (days), saving one change at a time",
    "Fixed term has no renewal-period value; each value saves on its own; the notice deadline is expiry minus the notice period",
    async () => {
      await overview();
      const termType = p.getByRole("combobox", { name: "Term type" });
      const s1 = await withResponse(p, isPatchOf(num), () => termType.selectOption({ label: "Fixed term" }));
      expectThat(s1 === 200, `term type PATCH ${s1}`);
      await sleep(400);
      const renewal = p.getByRole("spinbutton", { name: "Renewal period (months)" });
      const renewalEditable = (await renewal.count()) > 0 && (await renewal.isEditable().catch(() => false));
      const s2 = await withResponse(p, isPatchOf(num), () => pickDate(p, "Effective date", "2026-02-01"));
      const s3 = await withResponse(p, isPatchOf(num), () => pickDate(p, "Expiry date", "2027-01-31"));
      const notice = p.getByRole("spinbutton", { name: "Notice period (days)" });
      await notice.fill("30");
      const s4 = await withResponse(p, isPatchOf(num), () => notice.press("Tab"));
      expectThat([s2, s3, s4].every((s) => s === 200), `PATCH statuses ${s2} ${s3} ${s4}`);
      const c = await read(num);
      expectThat(c.termType === "fixed" && c.effectiveDate === "2026-02-01" && c.expiryDate === "2027-01-31" && c.noticePeriodDays === 30, `saved ${JSON.stringify([c.termType, c.effectiveDate, c.expiryDate, c.noticePeriodDays])}`);
      expectThat(!renewalEditable, "Renewal period is editable on Fixed term");
      expectThat(c.noticeDeadline === "2027-01-01", `notice deadline ${c.noticeDeadline}`);
      await overview();
      const eff = await text(p.getByRole("button", { name: "Effective date", exact: true }));
      const exp = await text(p.getByRole("button", { name: "Expiry date", exact: true }));
      return `Four separate PATCH commits answered 200. Renewal period (months) was ${renewalEditable ? "editable" : (await renewal.count()) ? "shown read-only and blank" : "absent"} on Fixed term. After reload the pickers read "${eff}" and "${exp}", notice 30 days; the record's notice deadline is ${c.noticeDeadline} (Jan 31, 2027 minus 30 days).`;
    },
  );

  await step(
    "Key dates shows the derived Current term expires and Renewal notice deadline rows, and the Term timeline draws the recorded dates",
    "Derived rows reflect the recorded term and carry no row actions",
    async () => {
      await overview();
      const timeline = p.getByRole("region", { name: "Term timeline" });
      const timelineText = await text(timeline);
      expectThat(!/No term dates|No effective date|No expiry date/.test(timelineText), `timeline: ${timelineText}`);
      const rows = await keyDateRows();
      const exp = rows.find((r) => r.text.includes("Current term expires"));
      const nd = rows.find((r) => r.text.includes("Renewal notice deadline"));
      expectThat(exp && exp.text.startsWith("Jan 31, 2027") && exp.text.includes("Derived") && exp.actions === 0, `expiry row ${JSON.stringify(exp)}`);
      expectThat(nd && nd.text.startsWith("Jan 1, 2027") && nd.text.includes("30 days before expiry") && nd.actions === 0, `notice row ${JSON.stringify(nd)}`);
      return `Term timeline: "${timelineText.slice(0, 160)}". Key dates rows: "${exp.text}" and "${nd.text}", each with 0 row action buttons.`;
    },
  );

  await step(
    "Change Term type to Auto-renewing and type Renewal period (months)",
    "Auto-renewing accepts a renewal period in months",
    async () => {
      await overview();
      const s1 = await withResponse(p, isPatchOf(num), () => p.getByRole("combobox", { name: "Term type" }).selectOption({ label: "Auto-renewing" }));
      await sleep(400);
      const renewal = p.getByRole("spinbutton", { name: "Renewal period (months)" });
      await renewal.fill("1");
      const s2 = await withResponse(p, isPatchOf(num), () => renewal.press("Tab"));
      const c = await read(num);
      expectThat(s1 === 200 && s2 === 200 && c.termType === "auto_renew" && c.renewalPeriodMonths === 1, `saved ${c.termType} ${c.renewalPeriodMonths}`);
      return `Term type Auto-renewing and Renewal period 1 month saved (PATCH ${s1}, ${s2}); expiry still ${c.expiryDate}.`;
    },
  );

  await step(
    "Change Term type to Evergreen and review the saved values",
    "Evergreen has no expiry date; changing to Evergreen clears the expiry and the renewal period",
    async () => {
      await overview();
      const s = await withResponse(p, isPatchOf(num), () => p.getByRole("combobox", { name: "Term type" }).selectOption({ label: "Evergreen" }));
      await overview();
      const c = await read(num);
      const expiry = p.getByRole("button", { name: "Expiry date", exact: true });
      const expiryCount = await expiry.count();
      const expiryEnabled = expiryCount ? await expiry.isEnabled() : false;
      expectThat(s === 200 && c.termType === "evergreen" && c.expiryDate === null && c.renewalPeriodMonths === null, `saved ${JSON.stringify([c.termType, c.expiryDate, c.renewalPeriodMonths])}`);
      expectThat(!expiryEnabled, "Expiry date picker still enabled on Evergreen");
      const rows = await keyDateRows();
      return `Evergreen saved; expiry ${c.expiryDate}, renewal period ${c.renewalPeriodMonths}; Expiry date picker ${expiryCount ? "shown disabled" : "absent"}; effective date kept ${c.effectiveDate}; Key dates now lists: ${rows.map((r) => r.text).join(" | ") || "no derived term rows"}.`;
    },
  );

  await step(
    "Change back to Auto-renewing, record expiry and renewal period, then change to Fixed term and review; finally restore Auto-renewing with a 1-month period",
    "Changing away from Auto-renewing clears the renewal period and keeps the expiry",
    async () => {
      await overview();
      await withResponse(p, isPatchOf(num), () => p.getByRole("combobox", { name: "Term type" }).selectOption({ label: "Auto-renewing" }));
      await sleep(400);
      await withResponse(p, isPatchOf(num), () => pickDate(p, "Expiry date", "2027-01-31"));
      const renewal = p.getByRole("spinbutton", { name: "Renewal period (months)" });
      await renewal.fill("1");
      await withResponse(p, isPatchOf(num), () => renewal.press("Tab"));
      await withResponse(p, isPatchOf(num), () => p.getByRole("combobox", { name: "Term type" }).selectOption({ label: "Fixed term" }));
      const fixed = await read(num);
      expectThat(fixed.termType === "fixed" && fixed.renewalPeriodMonths === null && fixed.expiryDate === "2027-01-31", `after Fixed ${JSON.stringify([fixed.termType, fixed.renewalPeriodMonths, fixed.expiryDate])}`);
      await overview();
      await withResponse(p, isPatchOf(num), () => p.getByRole("combobox", { name: "Term type" }).selectOption({ label: "Auto-renewing" }));
      await sleep(400);
      const renewal2 = p.getByRole("spinbutton", { name: "Renewal period (months)" });
      await renewal2.fill("1");
      await withResponse(p, isPatchOf(num), () => renewal2.press("Tab"));
      const c = await read(num);
      expectThat(c.termType === "auto_renew" && c.renewalPeriodMonths === 1 && c.expiryDate === "2027-01-31" && c.noticeDeadline === "2027-01-01", `final ${JSON.stringify([c.termType, c.renewalPeriodMonths, c.expiryDate, c.noticeDeadline])}`);
      return `Auto-renewing -> Fixed term cleared the renewal period (null) and kept expiry 2027-01-31. The Contract is Auto-renewing again: expiry 2027-01-31, renewal 1 month, notice 30 days, notice deadline ${c.noticeDeadline}.`;
    },
  );

  await step(
    "Negative: a Task due date before the notice deadline does not feed the term-derived deadlines",
    "Current term expires and Renewal notice deadline stay derived from the term; the Task does not show as a Key date",
    async () => {
      const t = await actor.api("POST", `/contracts/${num}/tasks`, { title: `DOC-029 contracts-b C18 early task ${tag}`, dueDate: "2026-12-01" });
      expectThat(t.status === 201, `task answered ${t.status}`);
      const rows = await keyDateRows();
      const nd = rows.find((r) => r.text.includes("Renewal notice deadline"));
      const exp = rows.find((r) => r.text.includes("Current term expires"));
      expectThat(nd?.text.startsWith("Jan 1, 2027") && exp?.text.startsWith("Jan 31, 2027"), `rows ${rows.map((r) => r.text).join(" | ")}`);
      expectThat(!rows.some((r) => r.text.includes("early task")), "task appears in Key dates");
      const c = await read(num);
      expectThat(c.noticeDeadline === "2027-01-01" && c.expiryDate === "2027-01-31", "term deadlines changed");
      return `A Task due 2026-12-01 was added. Key dates still reads "${exp.text}" and "${nd.text}" and lists no Task row; the record's notice deadline stays ${c.noticeDeadline}.`;
    },
  );

  await step(
    "Approvals: select Renew; Confirm the roll is the default; an entered date on the current expiry is refused; Cancel changes nothing",
    "Invalid new expiry is refused with the dialog's message and Cancel keeps the term",
    async () => {
      await approvals();
      await p.getByRole("button", { name: "Renew", exact: true }).click();
      const dialog = p.getByRole("dialog", { name: "Confirm renewal" });
      await dialog.waitFor();
      const roll = dialog.getByRole("radio", { name: /Confirm the roll/ });
      expectThat(await roll.isChecked(), "Confirm the roll not default");
      const amendment = await dialog.getByRole("radio", { name: /Paper as amendment/ }).count();
      const input = dialog.getByRole("textbox", { name: "New expiry date" });
      const proposed = await input.inputValue();
      const current = await text(dialog.getByText(/The term currently runs to/));
      await input.fill("2027-01-31");
      await dialog.getByRole("button", { name: "Confirm renewal" }).click();
      const alert = dialog.getByText("A roll moves the term forward. Pick a date after the current expiry.");
      await alert.waitFor({ timeout: 5000 });
      await dialog.getByRole("button", { name: "Cancel" }).click();
      await dialog.waitFor({ state: "hidden" });
      const c = await read(num);
      expectThat(proposed === "2027-02-28", `proposal ${proposed}`);
      expectThat(amendment === 0, "Paper as amendment offered without a primary Document");
      expectThat(c.expiryDate === "2027-01-31", `expiry ${c.expiryDate}`);
      return `Renew opened "Confirm renewal" with Confirm the roll checked, "${current}", proposed New expiry date ${proposed}, and no Paper as amendment option (no primary Document). Entering 2027-01-31 and selecting Confirm renewal showed "A roll moves the term forward. Pick a date after the current expiry." Cancel left expiry ${c.expiryDate}.`;
    },
  );

  await step(
    "Confirm the roll with the proposed date and check the new expiry, notice deadline, Last renewal, the renewal row, and the unchanged Status",
    "The term advances only through the confirmation; Status and Stage do not change",
    async () => {
      const before = await read(num);
      await approvals();
      await p.getByRole("button", { name: "Renew", exact: true }).click();
      const dialog = p.getByRole("dialog", { name: "Confirm renewal" });
      const proposed = await dialog.getByRole("textbox", { name: "New expiry date" }).inputValue();
      const status = await withResponse(p, (r) => r.request().method() === "POST" && r.url().endsWith(`/contracts/${num}/renewal`), () => dialog.getByRole("button", { name: "Confirm renewal" }).click());
      await dialog.waitFor({ state: "hidden" });
      const c = await read(num);
      await approvals();
      const region = p.getByRole("region", { name: "Approvals & signing" });
      const rows = await region.getByText(/Term advanced to/).count();
      const renewalText = await text(region.getByText(/Term advanced to/).first().locator("xpath=ancestor::*[self::li or self::tr][1]"));
      await overview();
      const lastRenewal = await text(p.getByText("Last renewal", { exact: true }).locator("xpath=.."));
      const rowsKd = await keyDateRows();
      const nd = rowsKd.find((r) => r.text.includes("Renewal notice deadline"));
      expectThat(status === 200 && proposed === "2027-02-28" && c.expiryDate === "2027-02-28", `status ${status} proposal ${proposed} expiry ${c.expiryDate}`);
      expectThat(c.noticeDeadline === "2027-01-29" && nd?.text.startsWith("Jan 29, 2027"), `notice ${c.noticeDeadline} ${nd?.text}`);
      expectThat(rows === 1 && !/—$/.test(lastRenewal), `renewal rows ${rows}; last renewal "${lastRenewal}"`);
      expectThat(c.statusName === before.statusName && c.stage === before.stage, `status moved ${before.statusName} -> ${c.statusName}`);
      return `Confirm renewal (POST ${status}) moved expiry 2027-01-31 -> ${c.expiryDate}; notice deadline ${c.noticeDeadline} ("${nd.text}"); Approvals & signing shows 1 renewal row "${renewalText}"; Overview "${lastRenewal}"; Status stays ${c.statusName} (${c.stage}).`;
    },
  );

  await step(
    "Stale confirmation: with Renew open, the other staff role changes the expiry; selecting Confirm renewal is refused and the dialog shows the refreshed expiry; Cancel and reopen gives a fresh proposal",
    "A stale roll is refused and re-read; no second roll is recorded",
    async () => {
      await approvals();
      await p.getByRole("button", { name: "Renew", exact: true }).click();
      const dialog = p.getByRole("dialog", { name: "Confirm renewal" });
      const input = dialog.getByRole("textbox", { name: "New expiry date" });
      const proposal = await input.inputValue();
      const moved = await otherSession.api("PATCH", `/contracts/${num}`, { expiryDate: "2027-04-30" });
      expectThat(moved.status === 200, `other PATCH ${moved.status}`);
      await sleep(1500);
      const status = await withResponse(p, (r) => r.request().method() === "POST" && r.url().endsWith(`/contracts/${num}/renewal`), () => dialog.getByRole("button", { name: "Confirm renewal" }).click());
      const refusal = await text(dialog.getByRole("alert").first());
      await sleep(1000);
      const current = await text(dialog.getByText(/The term currently runs to/));
      const kept = await input.inputValue();
      await ctx.shot(p, `${role}-renewal-stale-refused`);
      await dialog.getByRole("button", { name: "Cancel" }).click();
      await dialog.waitFor({ state: "hidden" });
      await p.getByRole("button", { name: "Renew", exact: true }).click();
      const fresh = await p.getByRole("dialog", { name: "Confirm renewal" }).getByRole("textbox", { name: "New expiry date" }).inputValue();
      await p.getByRole("dialog", { name: "Confirm renewal" }).getByRole("button", { name: "Cancel" }).click();
      const c = await read(num);
      await approvals();
      const rows = await p.getByRole("region", { name: "Approvals & signing" }).getByText(/Term advanced to/).count();
      expectThat(status === 409 && /already moved/.test(refusal), `status ${status} refusal "${refusal}"`);
      expectThat(/Apr 30, 2027/.test(current) && fresh === "2027-05-30" && c.expiryDate === "2027-04-30" && rows === 1, `current "${current}" fresh ${fresh} expiry ${c.expiryDate} rows ${rows}`);
      return `Dialog proposed ${proposal}; ${PEOPLE[other].name} moved expiry to 2027-04-30 through the API; Confirm renewal answered ${status} with "${refusal}". The dialog then said "${current}" and kept the entered ${kept}. Cancel and reopen proposed ${fresh}. Expiry ${c.expiryDate}; renewal rows still ${rows}.`;
    },
  );

  await step(
    "Competing confirmations: both staff roles open Renew on the same expiry; the first Confirm renewal records the roll and the second is refused",
    "Two competing confirmations do not record the same roll twice",
    async () => {
      const q = otherSession.page;
      await approvals();
      await q.goto(`${BASE}/contracts/${num}/approvals`);
      await p.getByRole("button", { name: "Renew", exact: true }).click();
      await q.getByRole("button", { name: "Renew", exact: true }).click();
      const d1 = p.getByRole("dialog", { name: "Confirm renewal" });
      const d2 = q.getByRole("dialog", { name: "Confirm renewal" });
      const v1 = await d1.getByRole("textbox", { name: "New expiry date" }).inputValue();
      const v2 = await d2.getByRole("textbox", { name: "New expiry date" }).inputValue();
      const s1 = await withResponse(p, (r) => r.request().method() === "POST" && r.url().endsWith(`/contracts/${num}/renewal`), () => d1.getByRole("button", { name: "Confirm renewal" }).click());
      const s2 = await withResponse(q, (r) => r.request().method() === "POST" && r.url().endsWith(`/contracts/${num}/renewal`), () => d2.getByRole("button", { name: "Confirm renewal" }).click());
      const refusal = await text(d2.getByRole("alert").first());
      await d2.getByRole("button", { name: "Cancel" }).click();
      const c = await read(num);
      await approvals();
      const rows = await p.getByRole("region", { name: "Approvals & signing" }).getByText(/Term advanced to/).count();
      expectThat(s1 === 200 && s2 === 409 && rows === 2 && c.expiryDate === "2027-05-30", `s1 ${s1} s2 ${s2} rows ${rows} expiry ${c.expiryDate}`);
      return `Both dialogs proposed ${v1} / ${v2}. ${PEOPLE[role].name}'s Confirm renewal answered ${s1}; ${PEOPLE[other].name}'s answered ${s2} with "${refusal}". Expiry ${c.expiryDate}; renewal rows ${rows} (one per distinct roll).`;
    },
  );

  await step(
    "Paper as amendment: after the first Document is uploaded, reload and reopen Renew; File the amendment opens Add version with the Amendment kind; the new version is not executed until marked, and marking replaces the chain's designation",
    "Amendment is a kind, not an executed designation; no new Contract and no expiry change",
    async () => {
      const before = await read(num);
      await p.goto(`${BASE}/contracts/${num}/documents`);
      const docs = p.getByRole("region", { name: "Documents" });
      await docs.getByRole("button", { name: "Upload", exact: true }).click();
      const up = p.getByRole("dialog", { name: "Upload document" });
      await up.locator("input[type=file]").first().setInputFiles(fix("doc029-services-agreement.pdf"));
      await withResponse(p, (r) => r.request().method() === "POST" && r.url().includes(`/contracts/${num}/documents`), () => up.getByRole("button", { name: "Upload", exact: true }).click(), 30000);
      await up.waitFor({ state: "hidden" });
      await docs.getByRole("button", { name: "Actions for doc029-services-agreement.pdf" }).click();
      await p.getByRole("menuitem", { name: "Mark as executed copy" }).click();
      await sleep(1500);
      // Without a reload the dialog may still lack the option; the article says to reload.
      await p.reload();
      await approvals();
      await p.getByRole("button", { name: "Renew", exact: true }).click();
      const dialog = p.getByRole("dialog", { name: "Confirm renewal" });
      await dialog.getByText("Paper as amendment", { exact: true }).click();
      await dialog.getByRole("button", { name: "File the amendment" }).click();
      const add = p.getByRole("dialog", { name: /Add version/ });
      await add.waitFor({ timeout: 15000 });
      const kind = await add.getByRole("combobox", { name: "Kind" }).evaluate((el) => el.options[el.selectedIndex].text);
      const url = p.url();
      await add.locator("input[type=file]").first().setInputFiles(fix("doc029-renewal-amendment.pdf"));
      await withResponse(p, (r) => r.request().method() === "POST" && r.url().includes("/versions"), () => add.getByRole("button", { name: /Upload|Add version/ }).last().click(), 30000);
      await add.waitFor({ state: "hidden" });
      await sleep(1500);
      const versionsOf = async () => (await actor.api("GET", `/contracts/${num}/documents`)).json.documents[0].versions;
      const vs = await versionsOf();
      const summary1 = vs.map((v) => `v${v.versionNumber} ${v.kind} executed=${v.isExecuted}`).join("; ");
      const v1 = vs.find((v) => v.versionNumber === 1);
      const v2 = vs.find((v) => v.versionNumber === 2);
      expectThat(kind === "Amendment" && url.includes("/documents"), `kind ${kind} url ${url}`);
      expectThat(v2 && v2.kind === "amendment" && !v2.isExecuted && v1.isExecuted, `versions ${summary1}`);
      await p.goto(`${BASE}/contracts/${num}/documents`);
      await p.reload();
      const row = p.getByRole("region", { name: "Documents" });
      await row.getByRole("button", { name: /Actions for version 2 of|Actions for doc029-services-agreement.pdf/ }).first().click();
      await p.getByRole("menuitem", { name: "Mark as executed copy" }).click();
      await sleep(1500);
      const vs2 = await versionsOf();
      const summary2 = vs2.map((v) => `v${v.versionNumber} ${v.kind} executed=${v.isExecuted}`).join("; ");
      const c = await read(num);
      const rel = (await actor.api("GET", `/contracts/${num}/relations`)).json;
      expectThat(vs2.find((v) => v.versionNumber === 2).isExecuted && !vs2.find((v) => v.versionNumber === 1).isExecuted, `after mark ${summary2}`);
      expectThat(c.expiryDate === before.expiryDate, `expiry changed ${c.expiryDate}`);
      return `Before a Document existed the dialog had no Paper as amendment (previous step). Uploaded doc029-services-agreement.pdf as the primary Document and marked it executed; after reload Paper as amendment -> File the amendment moved to ${new URL(url).pathname} and opened Add version with Kind "${kind}". After upload: ${summary1}. Mark as executed copy on version 2 gave: ${summary2}. Expiry still ${c.expiryDate}; relations ${JSON.stringify(rel).slice(0, 200)}.`;
    },
  );

  const routed = async (label, radio, button, newTitle, check) => {
    await approvals();
    await p.getByRole("button", { name: "Renew", exact: true }).click();
    const dialog = p.getByRole("dialog", { name: "Confirm renewal" });
    await dialog.getByText(radio, { exact: true }).click();
    await dialog.getByRole("button", { name: button }).click();
    const create = p.getByRole("dialog", { name: label });
    await create.waitFor();
    const intro = await text(create.getByText(/^Prefilled from/));
    const title = create.getByRole("textbox", { name: "Title" });
    const prefilledTitle = await title.inputValue();
    const typeLabel = await create.getByRole("combobox", { name: "Contract type" }).evaluate((el) => el.options[el.selectedIndex].text);
    const ownerLabel = await create.getByRole("combobox", { name: "Owner" }).evaluate((el) => el.options[el.selectedIndex].text);
    await title.fill(newTitle);
    const created = p.waitForResponse((r) => r.request().method() === "POST" && new URL(r.url()).pathname === "/api/v1/contracts");
    await create.getByRole("button", { name: "Create", exact: true }).click();
    const res = await created;
    const body = await res.json();
    const childNum = body.contract.number;
    await p.waitForURL(new RegExp(`/contracts/${childNum}`), { timeout: 15000 }).catch(() => {});
    const landed = p.url();
    const child = await read(childNum);
    const teamNames = JSON.stringify((await actor.api("GET", `/contracts/${childNum}`)).json.team ?? []);
    await p.goto(`${BASE}/contracts/${childNum}`);
    const relRegion = p.getByRole("region", { name: "Related contracts" });
    await relRegion.waitFor();
    await sleep(800);
    const relText = await text(relRegion);
    const parent = await read(num);
    ctx.records.push({ article: "terms-and-renewals", role, purpose: label, reference: `C-${childNum}` });
    const facts = {
      entity: child.entity?.legalName ?? child.entity?.name ?? null,
      counterparty: child.primaryCounterparty?.name ?? null,
      value: child.value,
      termType: child.termType,
      expiry: child.expiryDate,
      renewal: child.renewalPeriodMonths,
      notice: child.noticePeriodDays,
      manager: child.manager?.displayName ?? null,
      status: child.statusName,
      priority: child.priority,
      risk: child.risk,
      confidential: child.isConfidential,
    };
    expectThat(res.status() === 201 && prefilledTitle === parentTitle && typeLabel === "NDA", `create ${res.status()} title "${prefilledTitle}" type ${typeLabel}`);
    expectThat(facts.counterparty && facts.entity && facts.value?.amount === 990000 && facts.termType === "auto_renew" && facts.expiry === parent.expiryDate, `copied ${JSON.stringify(facts)}`);
    expectThat(ownerLabel === "Unassigned" && facts.manager === null && facts.status === "Draft" && facts.priority === "medium" && facts.risk === null && facts.confidential === false, `not copied ${ownerLabel} ${JSON.stringify(facts)}`);
    expectThat(!teamNames.includes(PEOPLE.businessUser.name) && !teamNames.includes(PEOPLE[other].name), `team ${teamNames.slice(0, 300)}`);
    expectThat(check(relText, `C-${num}`), `relation "${relText}"`);
    return `${radio} -> ${button} opened "${label}": "${intro}". Prefilled Title "${prefilledTitle}", Contract type ${typeLabel}, Owner ${ownerLabel}; Title edited and Create answered ${res.status()} for C-${childNum} (${new URL(landed).pathname}). Copied: entity ${facts.entity}, counterparty ${facts.counterparty}, value ${JSON.stringify(facts.value)}, ${facts.termType} to ${facts.expiry} (renewal ${facts.renewal}, notice ${facts.notice}). Not copied: Legal Owner ${facts.manager}, Status ${facts.status}, Priority ${facts.priority}, Risk ${facts.risk}, Confidential ${facts.confidential}; team has neither ${PEOPLE[other].name} nor ${PEOPLE.businessUser.name}. Related contracts on C-${childNum}: "${relText}". C-${num} still expires ${parent.expiryDate}.`;
  };

  await step(
    "Create child contract from Renew: review and edit the prefilled Title and Contract type, create, and check the new C- reference and relationship",
    "A new Contract parented to this one; Entity, Counterparties, value and term shape carry over; Legal Owner, team, Status, Priority, Risk and Confidential flag do not",
    () => routed("Create child contract", "Create child contract", "Open the child contract", `DOC-029 contracts-b C18 child ${tag}`, (rel, ref) => /Parent/i.test(rel) && rel.includes(ref)),
  );

  await step(
    "New successor contract from Renew: review, create, and check the new C- reference and Renews relationship",
    "A new Contract linked as renewing this predecessor, with the same carry-over rules",
    () => routed("Create successor contract", "New successor contract", "Open the successor", `DOC-029 contracts-b C18 successor ${tag}`, (rel, ref) => /Renews/i.test(rel) && rel.includes(ref)),
  );

  await step(
    "Renewal banner: an Auto-renewing Contract whose expiry has passed shows Renewal date passed — pending confirmation with Review renewal, which opens the same dialog",
    "The banner and Review renewal appear; the app does not advance expiry automatically",
    async () => {
      const created = await actor.api("POST", "/contracts", { title: `DOC-029 contracts-b C18 lapsed ${tag}`, contractTypeId: typeId("NDA"), managerId: userId(PEOPLE[role].name) });
      const lapsed = created.json.contract.number;
      ctx.records.push({ article: "terms-and-renewals", role, purpose: "passed renewal date", reference: `C-${lapsed}` });
      await actor.api("PATCH", `/contracts/${lapsed}`, { termType: "auto_renew" });
      const past = isoPlusDays(-5);
      const e = await actor.api("PATCH", `/contracts/${lapsed}`, { expiryDate: past, renewalPeriodMonths: 12 });
      expectThat(e.status === 200, `expiry PATCH ${e.status}`);
      await p.goto(`${BASE}/contracts/${lapsed}/approvals`);
      const banner = p.getByText(/Renewal date passed — pending confirmation/);
      await banner.waitFor({ timeout: 10000 });
      const bannerText = await text(banner);
      await p.getByRole("button", { name: "Review renewal" }).click();
      const dialog = p.getByRole("dialog", { name: "Confirm renewal" });
      await dialog.waitFor();
      const proposal = await dialog.getByRole("textbox", { name: "New expiry date" }).inputValue();
      await dialog.getByRole("button", { name: "Cancel" }).click();
      const c = await read(lapsed);
      expectThat(c.expiryDate === past && proposal > past, `expiry ${c.expiryDate} proposal ${proposal}`);
      return `C-${lapsed} Auto-renewing, 12 months, expiry ${past}: banner "${bannerText}"; Review renewal opened Confirm renewal proposing ${proposal}; Cancel left expiry ${c.expiryDate} (no automatic advance).`;
    },
  );

  await step(
    "Negative: an archived Contract offers no Renew and refuses a renewal write; Restore keeps the recorded rolls",
    "Archived records are handled differently from an active renewal",
    async () => {
      const a = await actor.api("POST", `/contracts/${num}/archive`);
      expectThat(a.status === 200, `archive ${a.status}`);
      await approvals();
      const renewCount = await p.getByRole("button", { name: "Renew", exact: true }).count();
      const c0 = await read(num);
      const write = await actor.api("POST", `/contracts/${num}/renewal`, { fromExpiry: c0.expiryDate, toExpiry: "2027-12-31" });
      const r = await actor.api("POST", `/contracts/${num}/restore`);
      const c = await read(num);
      await approvals();
      const rows = await p.getByRole("region", { name: "Approvals & signing" }).getByText(/Term advanced to/).count();
      expectThat(renewCount === 0 && write.status === 409 && r.status === 200 && c.expiryDate === c0.expiryDate && rows === 2, `renew ${renewCount} write ${write.status} restore ${r.status} rows ${rows}`);
      return `Archived C-${num}: Approvals showed ${renewCount} Renew buttons and a renewal POST answered ${write.status}. After Restore (${r.status}) expiry ${c.expiryDate} and ${rows} renewal rows remain.`;
    },
  );
}
