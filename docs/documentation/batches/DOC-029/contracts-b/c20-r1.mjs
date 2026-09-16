// V-C20: "Relate, end, and archive Contracts", followed as written for one role.
import { openContractsDefaultView, selectContractsView } from "./lib-r1.mjs";

export async function runC20(ctx, step) {
  const { actor, sessions, role, PEOPLE, userId, typeId, stamp, helpers } = ctx;
  const { expectThat, sleep, text, withResponse, BASE } = helpers;
  const p = actor.page;
  const reader = sessions.reader;
  const tag = `${role} ${stamp}`;
  const n = {};
  const m = {};
  const read = async (num, session = actor) =>
    (await session.api("GET", `/contracts/${num}`)).json?.contract;
  const relations = async (num) => (await actor.api("GET", `/contracts/${num}/relations`)).json;
  const relatedCard = async (num, page = p) => {
    await page.goto(`${BASE}/contracts/${num}`);
    const card = page.getByRole("region", { name: "Related contracts" });
    await card.waitFor();
    await sleep(800);
    return card;
  };
  const pick = async (dialog, num) => {
    const box = dialog.getByRole("combobox", { name: "Search by number or title…" });
    // Titles carry the run stamp, so a bare number also matches many stamps; search by the unique title.
    await box.fill(`DOC-029 contracts-b C20 ${num} ${tag}`);
    const option = dialog
      .getByRole("option")
      .filter({ hasText: `C-${n[num]}` })
      .first();
    await option.waitFor({ timeout: 10000 });
    await option.dispatchEvent("pointerdown");
    await sleep(300);
  };

  await step(
    "Prepare separate Contracts for relations, the confidentiality prompt in both directions, a restricted target, the Matter links, and ending and archiving; and two open Matters",
    "Prerequisite records exist for this role",
    async () => {
      const make = async (key, confidential = false) => {
        const r = await actor.api("POST", "/contracts", {
          title: `DOC-029 contracts-b C20 ${key} ${tag}`,
          contractTypeId: typeId("NDA"),
          managerId: userId(PEOPLE[role].name),
          isConfidential: confidential,
        });
        expectThat(r.status === 201, `create ${key} ${r.status}`);
        n[key] = r.json.contract.number;
        ctx.records.push({
          article: "contract-relations-and-ending",
          role,
          purpose: key,
          reference: `C-${n[key]}`,
        });
      };
      for (const key of ["A", "B", "C", "E", "F", "H", "J"]) await make(key);
      for (const key of ["D", "G", "I"]) await make(key, true);
      const mo = (await actor.api("GET", "/matters/options")).json;
      const matterTypeId = mo.matterTypes[0].id;
      for (const key of ["M1", "M2"]) {
        const r = await actor.api("POST", "/matters", {
          title: `DOC-029 contracts-b C20 ${key} ${tag}`,
          matterTypeId,
          managerId: userId(PEOPLE[role].name),
        });
        expectThat(r.status === 201, `matter ${key} ${r.status}`);
        m[key] = r.json.matter.number;
        ctx.records.push({
          article: "contract-relations-and-ending",
          role,
          purpose: key,
          reference: `M-${m[key]}`,
        });
      }
      return `Open Contracts ${["A", "B", "C", "E", "F", "H", "J"].map((k) => `${k}=C-${n[k]}`).join(", ")}; Confidential ${["D", "G", "I"].map((k) => `${k}=C-${n[k]}`).join(", ")}; open Matters M1=M-${m.M1}, M2=M-${m.M2}. ${PEOPLE.reader.name} is on none of their teams.`;
    },
  );

  await step(
    "Set parent: Cancel leaves no parent; Set parent places A under B; B lists A under Children; choosing A as B's parent is refused as a cycle",
    "Parent relation saves; Cancel changes nothing; a parent choice that creates a cycle is refused",
    async () => {
      let card = await relatedCard(n.A);
      await card.getByRole("button", { name: "Set parent" }).click();
      let dialog = p.getByRole("dialog", { name: "Set parent" });
      await pick(dialog, "B");
      await dialog.getByRole("button", { name: "Cancel" }).click();
      const afterCancel = await relations(n.A);
      await card.getByRole("button", { name: "Set parent" }).click();
      dialog = p.getByRole("dialog", { name: "Set parent" });
      await pick(dialog, "B");
      const picked = await text(dialog);
      await withResponse(
        p,
        (r) => r.request().method() === "POST" && r.url().endsWith(`/contracts/${n.A}/parent`),
        () => dialog.getByRole("button", { name: "Set parent" }).click(),
      );
      await dialog.waitFor({ state: "hidden" });
      card = await relatedCard(n.A);
      const aText = await text(card);
      card = await relatedCard(n.B);
      const bText = await text(card);
      await card.getByRole("button", { name: "Set parent" }).click();
      dialog = p.getByRole("dialog", { name: "Set parent" });
      await pick(dialog, "A");
      await dialog.getByRole("button", { name: "Set parent" }).click();
      const refusal = await text(dialog.getByRole("alert").first());
      await dialog.getByRole("button", { name: "Cancel" }).click();
      const bRel = await relations(n.B);
      expectThat(
        (afterCancel.parentChain ?? []).length === 0,
        `cancel left ${JSON.stringify(afterCancel)}`,
      );
      expectThat(
        /Parent/i.test(aText) &&
          aText.includes(`C-${n.B}`) &&
          /Children/i.test(bText) &&
          bText.includes(`C-${n.A}`),
        `A "${aText}" B "${bText}"`,
      );
      expectThat(
        /already sits under this one/.test(refusal) && (bRel.parentChain ?? []).length === 0,
        `refusal "${refusal}" B ${JSON.stringify(bRel)}`,
      );
      return `Cancel left C-${n.A} with no parent. The picker showed "${picked.slice(0, 160)}"; Set parent saved. C-${n.A}: "${aText}". C-${n.B}: "${bText}". Choosing C-${n.A} as C-${n.B}'s parent was refused: "${refusal}"; C-${n.B} still has no parent.`;
    },
  );

  await step(
    "Add link Related, Renews and Amends from A to C; check direction on both records; a duplicate Renews is refused; the picker does not offer A itself",
    "Typed links save with the stated direction; self-links and duplicates are refused",
    async () => {
      const link = async (type) => {
        const card = await relatedCard(n.A);
        await card.getByRole("button", { name: "Add link" }).click();
        const dialog = p.getByRole("dialog", { name: "Link contract" });
        await pick(dialog, "C");
        await dialog.getByRole("combobox", { name: "Link type" }).selectOption({ label: type });
        const s = await withResponse(
          p,
          (r) => r.request().method() === "POST" && r.url().endsWith(`/contracts/${n.A}/relations`),
          () => dialog.getByRole("button", { name: "Link contract" }).click(),
        );
        await sleep(600);
        let alert = "";
        if (await dialog.isVisible()) {
          alert = (await dialog.getByRole("alert").allTextContents()).join(" ").trim();
          await dialog.getByRole("button", { name: "Cancel" }).click();
        }
        return { s, alert };
      };
      const r1 = await link("Related");
      const r2 = await link("Renews");
      const r3 = await link("Amends");
      const dup = await link("Renews");
      const aText = await text(await relatedCard(n.A));
      const cText = await text(await relatedCard(n.C));
      const card = await relatedCard(n.A);
      await card.getByRole("button", { name: "Add link" }).click();
      const dialog = p.getByRole("dialog", { name: "Link contract" });
      const searchBox = dialog.getByRole("combobox", { name: "Search by number or title…" });
      await searchBox.fill(`DOC-029 contracts-b C20 B ${tag}`);
      await dialog
        .getByRole("listbox")
        .getByRole("option")
        .filter({ hasText: `C-${n.B}` })
        .first()
        .waitFor({ timeout: 10000 });
      await searchBox.fill(`DOC-029 contracts-b C20 A ${tag}`);
      await sleep(2000);
      const listbox = dialog.getByRole("listbox");
      const selfOptions = await listbox
        .getByRole("option")
        .filter({ hasText: `C-${n.A}` })
        .count();
      const optionsText = (await listbox.getByRole("option").allTextContents()).join(" | ");
      await dialog.getByRole("button", { name: "Cancel" }).click();
      expectThat(
        [r1.s, r2.s, r3.s].every((s) => s < 300),
        `link statuses ${r1.s} ${r2.s} ${r3.s}`,
      );
      expectThat(
        /Related/.test(aText) && /Renews/.test(aText) && /Amends/.test(aText),
        `A "${aText}"`,
      );
      expectThat(
        /Renewed by/i.test(cText) && /Amended by/i.test(cText) && /Related/i.test(cText),
        `C "${cText}"`,
      );
      expectThat(
        dup.s === 409 && /already linked that way/.test(dup.alert),
        `duplicate ${dup.s} "${dup.alert}"`,
      );
      const selfApi = await actor.api("POST", `/contracts/${n.A}/relations`, {
        relatedContractNumber: n.A,
        relationType: "related",
      });
      expectThat(
        selfOptions === 0 && [400, 409].includes(selfApi.status),
        `self offered: ${optionsText}; direct self-link ${selfApi.status}`,
      );
      return `Related, Renews and Amends answered ${r1.s}, ${r2.s}, ${r3.s}. C-${n.A}: "${aText}". C-${n.C}: "${cText}". A second Renews answered ${dup.s}: "${dup.alert}". In C-${n.A}'s own picker a title search found C-${n.B}, and a search for C-${n.A}'s own title offered: "${optionsText}" (not C-${n.A} itself); a direct self-link write answered ${selfApi.status}.`;
    },
  );

  await step(
    "Remove link on the Related row removes only that relationship; Remove parent clears the parent; both records still exist",
    "Removal affects only the chosen relationship",
    async () => {
      let card = await relatedCard(n.A);
      const relatedRow = card.getByRole("listitem").filter({ hasText: `C-${n.C}` });
      const rowsBefore = await relatedRow.count();
      // The Related subsection is listed first; remove the first matching row's link under Related.
      const section = card
        .locator("section, div")
        .filter({ has: p.getByText(/^Related$/i) })
        .last();
      const removeButtons = card.getByRole("button", { name: "Remove link" });
      const before = (await relations(n.A)).links;
      let target = null;
      const count = await removeButtons.count();
      for (let i = 0; i < count; i++) {
        const holder = removeButtons
          .nth(i)
          .locator("xpath=ancestor::*[self::ul or self::section or self::div][2]");
        const holderText = await text(holder);
        if (
          /^Related/i.test(holderText) ||
          (/Related/i.test(holderText) && !/Renews|Amends/i.test(holderText))
        ) {
          target = removeButtons.nth(i);
          break;
        }
      }
      expectThat(
        target,
        `no Related remove button among ${count}; section ${await text(section).catch(() => "")}`,
      );
      await withResponse(
        p,
        (r) => r.request().method() === "DELETE",
        () => target.click(),
      );
      await sleep(800);
      const after = (await relations(n.A)).links;
      card = await relatedCard(n.A);
      await withResponse(
        p,
        (r) => r.request().method() === "DELETE",
        () => card.getByRole("button", { name: "Remove parent" }).click(),
      );
      await sleep(800);
      const finalRel = await relations(n.A);
      const aText = await text(await relatedCard(n.A));
      const b = await read(n.B);
      const c = await read(n.C);
      const types = (links) =>
        (links ?? [])
          .map((l) => l.relationType)
          .sort()
          .join(",");
      expectThat(
        types(before).includes("related") &&
          !types(after).includes("related") &&
          /renews/.test(types(after)) &&
          /amends/.test(types(after)),
        `before ${JSON.stringify(before)} after ${JSON.stringify(after)}`,
      );
      expectThat(
        (finalRel.parentChain ?? []).length === 0 && b && c,
        `parent ${JSON.stringify(finalRel.parentChain)}`,
      );
      return `Links before: ${types(before)}; after Remove link on the Related row: ${types(after)} (${rowsBefore} rows had named C-${n.C}). Remove parent cleared the parent. C-${n.A} now reads "${aText}"; C-${n.B} and C-${n.C} still exist.`;
    },
  );

  const nudge = async (from, to, accept) => {
    const card = await relatedCard(n[from]);
    await card.getByRole("button", { name: "Add link" }).click();
    const dialog = p.getByRole("dialog", { name: "Link contract" });
    await pick(dialog, to);
    await withResponse(
      p,
      (r) => r.request().method() === "POST" && r.url().endsWith(`/contracts/${n[from]}/relations`),
      () => dialog.getByRole("button", { name: "Link contract" }).click(),
    );
    const prompt = p.getByRole("dialog").filter({ hasText: "Flag as confidential?" });
    await prompt.waitFor({ timeout: 10000 });
    const promptText = await text(prompt);
    const s = await withResponse(
      p,
      (r) => r.url().includes("/api/v1/"),
      () =>
        prompt
          .getByRole("button", {
            name: accept ? "Flag as confidential" : "No, leave it open",
            exact: true,
          })
          .click(),
    ).catch(() => "no request");
    await prompt.waitFor({ state: "hidden" }).catch(() => {});
    await sleep(800);
    return { promptText, s };
  };

  await step(
    "Flag as confidential? after linking Confidential D to open E: the prompt names E and Flag as confidential sets E's flag",
    "The prompt names the Contract that is not yet Confidential and sets only that flag",
    async () => {
      const { promptText, s } = await nudge("D", "E", true);
      const d = await read(n.D);
      const e = await read(n.E);
      expectThat(
        promptText.includes(`C-${n.E}`) && e.isConfidential && d.isConfidential,
        `prompt "${promptText}" E ${e.isConfidential}`,
      );
      return `Prompt: "${promptText}". Flag as confidential (${s}) set C-${n.E} Confidential; C-${n.D} stays Confidential.`;
    },
  );

  await step(
    "Flag as confidential? after linking open F to Confidential G: the prompt names F (this Contract) and accepting sets F's flag",
    "The flagged Contract can be this Contract",
    async () => {
      const { promptText, s } = await nudge("F", "G", true);
      const f = await read(n.F);
      expectThat(
        promptText.includes(`C-${n.F}`) && f.isConfidential,
        `prompt "${promptText}" F ${f.isConfidential}`,
      );
      return `Prompt: "${promptText}". Flag as confidential (${s}) set this Contract C-${n.F} Confidential.`;
    },
  );

  await step(
    "No, leave it open after linking open H to Confidential I changes nothing; a reader without access to I sees Restricted contract on H and cannot open I",
    "The link does not change either flag or grant access; the restricted target does not leak its details",
    async () => {
      const { promptText } = await nudge("H", "I", false);
      const h = await read(n.H);
      const i = await read(n.I);
      const rel = await relations(n.H);
      const rp = reader.page;
      const card = await relatedCard(n.H, rp);
      const readerText = await text(card);
      await card.screenshot({ path: `${ctx.here}/r1-${role}-restricted-related.png` });
      const links = await card
        .getByRole("link")
        .evaluateAll((els) => els.map((e) => e.getAttribute("href")));
      const direct = await reader.api("GET", `/contracts/${n.I}`);
      const readerRel = JSON.stringify(
        (await reader.api("GET", `/contracts/${n.H}/relations`)).json,
      );
      expectThat(
        !h.isConfidential && i.isConfidential && (rel.links ?? []).length === 1,
        `H ${h.isConfidential} I ${i.isConfidential} links ${JSON.stringify(rel.links)}`,
      );
      expectThat(
        /Restricted contract/.test(readerText) &&
          !readerText.includes(`C-${n.I}`) &&
          !readerText.includes(`C20 I ${tag}`) &&
          !links.some((l) => l?.includes(`/contracts/${n.I}`)),
        `reader card "${readerText}" links ${links}`,
      );
      expectThat(
        direct.status === 404 && !readerRel.includes(`C20 I ${tag}`),
        `direct ${direct.status}`,
      );
      return `Prompt: "${promptText}". No, leave it open kept C-${n.H} open and C-${n.I} Confidential; the link exists. ${PEOPLE.reader.name}'s C-${n.H} card: "${readerText}" with no link to C-${n.I}; a direct read of C-${n.I} answered ${direct.status}; the relations read does not include its title.`;
    },
  );

  await step(
    "Link to Matter: search, inspect the M- reference, Link; the card then offers Unlink and no Link to Matter; Unlink before moving to another Matter; a confidentiality mismatch warns without changing flags",
    "One Matter at a time; the mismatch advice changes neither flag",
    async () => {
      const matterLink = async (key, matterKey) => {
        await p.goto(`${BASE}/contracts/${n[key]}`);
        await p.getByRole("button", { name: "Link to Matter" }).click();
        const dialog = p.getByRole("dialog", { name: "Link to Matter" });
        await dialog
          .getByRole("textbox", { name: "Search by Matter number or title" })
          .fill(`DOC-029 contracts-b C20 ${matterKey} ${tag}`);
        const candidate = dialog.getByRole("button").filter({ hasText: `M-${m[matterKey]}` });
        await candidate.first().waitFor({ timeout: 10000 });
        const candidateText = await text(candidate.first());
        await candidate.first().click();
        const warning = (await dialog.getByText(/different Confidential flags/).count())
          ? await text(dialog.getByText(/different Confidential flags/))
          : "";
        const s = await withResponse(
          p,
          (r) => r.request().method() === "POST" && r.url().endsWith(`/contracts/${n[key]}/matter`),
          () => dialog.getByRole("button", { name: "Link", exact: true }).click(),
        );
        await sleep(1000);
        return { candidateText, warning, s };
      };
      const first = await matterLink("J", "M1");
      await p.reload();
      await sleep(1000);
      const unlinkShown = await p.getByRole("button", { name: "Unlink" }).count();
      const linkShown = await p.getByRole("button", { name: "Link to Matter" }).count();
      const second = await actor.api("POST", `/contracts/${n.J}/matter`, { matterNumber: m.M2 });
      await withResponse(
        p,
        (r) => r.request().method() === "DELETE" && r.url().endsWith(`/contracts/${n.J}/matter`),
        () => p.getByRole("button", { name: "Unlink" }).click(),
      );
      await sleep(800);
      const moved = await matterLink("J", "M2");
      const linked = (await actor.api("GET", `/contracts/${n.J}/matter`)).json;
      const mismatch = await matterLink("D", "M1");
      const advice = p.getByRole("dialog").filter({ hasText: "Confidentiality differs" });
      await advice.waitFor({ timeout: 10000 });
      const adviceText = await text(advice);
      await advice.getByRole("button", { name: "Leave them as they are" }).click();
      const d = await read(n.D);
      const mat = (await actor.api("GET", `/matters/${m.M1}`)).json;
      const matterConfidential = mat.matter?.isConfidential ?? mat.isConfidential;
      expectThat(
        first.s < 300 && unlinkShown === 1 && linkShown === 0,
        `first ${first.s} unlink ${unlinkShown} link ${linkShown}`,
      );
      expectThat(
        second.status === 409 &&
          moved.s < 300 &&
          JSON.stringify(linked).includes(`"number":${m.M2}`),
        `second ${second.status} moved ${moved.s} ${JSON.stringify(linked).slice(0, 200)}`,
      );
      expectThat(
        /different Confidential flags/.test(mismatch.warning) &&
          mismatch.s < 300 &&
          d.isConfidential &&
          matterConfidential === false,
        `mismatch "${mismatch.warning}" D ${d.isConfidential} M ${matterConfidential}`,
      );
      return `C-${n.J} search offered "${first.candidateText}"; Link answered ${first.s}; the card then showed ${unlinkShown} Unlink and ${linkShown} Link to Matter buttons. A second link to M-${m.M2} answered ${second.status}. After Unlink, the Contract linked to M-${m.M2} (${moved.s}). Confidential C-${n.D} -> open M-${m.M1}: the dialog warned "${mismatch.warning}"; after Link, "${adviceText}"; Leave them as they are kept C-${n.D} Confidential and M-${m.M1} open.`;
    },
  );

  await step(
    "End: use the Stage control to choose Expired (Ended); check Status and History; the Contract remains editable; the default Contracts view excludes it until Filter -> Show ended; reopen with Active and History keeps the Expired change",
    "Ending records the lifecycle change without freezing the record; the ended filter reveals it; reopening is another recorded change",
    async () => {
      const findInList = async () => {
        for (let i = 0; i < 25; i++) {
          if (await p.getByRole("cell", { name: `C-${n.J}`, exact: true }).count()) return true;
          const more = p.getByRole("button", { name: "Show more" });
          if (!(await more.count())) return false;
          await more.click();
          await sleep(700);
        }
        return false;
      };
      const openList = async () => {
        const v = await openContractsDefaultView(p);
        if (v.before !== "Default view") ctx.restoreView = v.before;
        return `${v.now}; previously selected ${v.before}`;
      };
      await p.goto(`${BASE}/contracts/${n.J}`);
      await p.getByRole("button", { name: / — move contract$/ }).click();
      await withResponse(
        p,
        (r) => r.request().method() === "PATCH",
        () => p.getByRole("menuitemradio", { name: "Expired Ended" }).click(),
      );
      await sleep(1000);
      const c1 = await read(n.J);
      const desc = p.getByRole("textbox", { name: "Description" });
      await desc.fill("DOC-029 note added after the Contract ended.");
      const ds = await withResponse(
        p,
        (r) => r.request().method() === "PATCH",
        () => desc.press("Tab"),
      );
      await p
        .getByRole("toolbar", { name: "Applets" })
        .getByRole("button", { name: "History" })
        .click();
      await sleep(2000);
      const history = await text(
        p
          .getByText(/Expired/)
          .last()
          .locator("xpath=ancestor::*[self::li or self::article or self::div][2]"),
      );
      const view = await openList();
      const hiddenDefault = !(await findInList());
      await p.getByRole("button", { name: /^Filter/ }).click();
      await p
        .getByRole("dialog", { name: "Filter" })
        .getByRole("button", { name: "Show ended" })
        .click();
      await sleep(400);
      await p.keyboard.press("Escape");
      await sleep(1500);
      const filterName = await text(p.getByRole("button", { name: /^Filter/ }));
      const shownEnded = await findInList();
      await p.goto(`${BASE}/contracts/${n.J}`);
      await p.getByRole("button", { name: / — move contract$/ }).click();
      await withResponse(
        p,
        (r) => r.request().method() === "PATCH",
        () => p.getByRole("menuitemradio", { name: "Active Active" }).click(),
      );
      await sleep(800);
      const c2 = await read(n.J);
      await p.reload();
      await p
        .getByRole("toolbar", { name: "Applets" })
        .getByRole("button", { name: "History" })
        .click();
      await sleep(2000);
      const panel = await text(p.locator("body"));
      const historyKeeps = /Expired/.test(panel) && /Active/.test(panel);
      expectThat(
        c1.statusName === "Expired" && c1.stage === "ended" && ds === 200,
        `status ${c1.statusName} ${c1.stage} desc ${ds}`,
      );
      expectThat(
        hiddenDefault && shownEnded,
        `view "${view}" hidden ${hiddenDefault} shown ${shownEnded} filter "${filterName}"`,
      );
      expectThat(
        c2.statusName === "Active" && historyKeeps,
        `reopen ${c2.statusName} history ${historyKeeps}`,
      );
      return `Stage control -> Expired set Status ${c1.statusName} (stage ${c1.stage}); a Description edit then saved (${ds}). History showed "${history.slice(0, 200)}". The Contracts list (view "${view}") did not list C-${n.J} after paging; Filter -> Show ended ("${filterName}") listed it. Choosing Active reopened it (${c2.statusName}); History still shows the Expired change and the Active change.`;
    },
  );

  await step(
    "Archive from Contract actions: Archived marker and read-only message; Status unchanged; linked Contract and Matter are not archived and the Matter's Linked Contracts omits it; find it with Show archived plus Show ended; Restore from Contract actions and from the known C- address",
    "Archiving is separate from ending; restore re-enables editing and keeps the Status",
    async () => {
      const link = await actor.api("POST", `/contracts/${n.J}/relations`, {
        relatedContractNumber: n.C,
        relationType: "related",
      });
      await p.goto(`${BASE}/contracts/${n.J}`);
      await p.getByRole("button", { name: / — move contract$/ }).click();
      await withResponse(
        p,
        (r) => r.request().method() === "PATCH",
        () => p.getByRole("menuitemradio", { name: "Expired Ended" }).click(),
      );
      await sleep(800);
      await p.goto(`${BASE}/matters/${m.M2}`);
      await sleep(2000);
      const sectionBefore = p
        .locator("section")
        .filter({ has: p.getByText("Linked Contracts", { exact: true }) });
      const sectionBeforeText = (await sectionBefore.count())
        ? await text(sectionBefore.first())
        : "";
      expectThat(
        sectionBeforeText.includes(`C-${n.J}`),
        `M-${m.M2} Linked Contracts before archive: "${sectionBeforeText}"`,
      );
      await p.goto(`${BASE}/contracts/${n.J}`);
      await p.getByRole("button", { name: "Contract actions" }).click();
      await withResponse(
        p,
        (r) => r.request().method() === "POST" && r.url().endsWith(`/contracts/${n.J}/archive`),
        async () => {
          await p.getByRole("menuitem", { name: "Archive" }).click();
          await sleep(300);
          const confirm = p.getByRole("alertdialog");
          if (await confirm.count()) await confirm.getByRole("button", { name: /Archive/ }).click();
        },
      );
      await sleep(1000);
      await p.reload();
      await sleep(1500);
      const marker = await p.getByText("Archived", { exact: true }).count();
      const notice = await text(p.getByText(/This contract is archived/));
      const titleEditable = await p
        .getByRole("textbox", { name: "Title" })
        .isEditable()
        .catch(() => false);
      const c = await read(n.J);
      const linkedC = await read(n.C);
      const matter = (await actor.api("GET", `/matters/${m.M2}`)).json;
      await p.goto(`${BASE}/matters/${m.M2}`);
      await sleep(2000);
      const section = p
        .locator("section")
        .filter({ has: p.getByText("Linked Contracts", { exact: true }) });
      const sectionText = (await section.count())
        ? await text(section.first())
        : "(no Linked Contracts section found)";
      await openContractsDefaultView(p);
      const findInList = async () => {
        for (let i = 0; i < 25; i++) {
          if (await p.getByRole("cell", { name: `C-${n.J}`, exact: true }).count()) return true;
          const more = p.getByRole("button", { name: "Show more" });
          if (!(await more.count())) return false;
          await more.click();
          await sleep(700);
        }
        return false;
      };
      const setFlag = async (label) => {
        await p.getByRole("button", { name: /^Filter/ }).click();
        await p
          .getByRole("dialog", { name: "Filter" })
          .getByRole("button", { name: label })
          .click();
        await sleep(400);
        await p.keyboard.press("Escape");
        await sleep(1500);
      };
      const filterNow = await text(p.getByRole("button", { name: /^Filter/ }));
      await setFlag("Show archived");
      const archivedOnlyName = await text(p.getByRole("button", { name: /^Filter/ }));
      const archivedOnly = await findInList();
      await openContractsDefaultView(p);
      const persisted = await text(p.getByRole("button", { name: /^Filter/ }));
      if (!/2/.test(persisted)) {
        if (!/1/.test(persisted)) await setFlag("Show archived");
        await setFlag("Show ended");
      }
      const bothName = await text(p.getByRole("button", { name: /^Filter/ }));
      const both = await findInList();
      await p.getByRole("link", { name: `DOC-029 contracts-b C20 J ${tag}` }).click();
      await p.waitForURL(new RegExp(`/contracts/${n.J}`));
      await p.getByRole("button", { name: "Contract actions" }).click();
      await withResponse(
        p,
        (r) => r.request().method() === "POST" && r.url().endsWith(`/contracts/${n.J}/restore`),
        () => p.getByRole("menuitem", { name: "Restore" }).click(),
      );
      await sleep(1000);
      await p.reload();
      await sleep(1500);
      const markerAfter = await p.getByText("Archived", { exact: true }).count();
      const editableAfter = await p.getByRole("textbox", { name: "Title" }).isEditable();
      const c2 = await read(n.J);
      const again = await actor.api("POST", `/contracts/${n.J}/archive`);
      await p.goto(`${BASE}/contracts/${n.J}`);
      await sleep(1500);
      await p.getByRole("button", { name: "Contract actions" }).click();
      const restoreByAddress = await p.getByRole("menuitem", { name: "Restore" }).count();
      await withResponse(
        p,
        (r) => r.request().method() === "POST" && r.url().endsWith(`/contracts/${n.J}/restore`),
        () => p.getByRole("menuitem", { name: "Restore" }).click(),
      );
      await sleep(800);
      const c3 = await read(n.J);
      await openContractsDefaultView(p);
      const leftFilter = await text(p.getByRole("button", { name: /^Filter/ }));
      if (/\d/.test(leftFilter)) {
        await p.getByRole("button", { name: /^Filter/ }).click();
        const clear = p
          .getByRole("dialog", { name: "Filter" })
          .getByRole("button", { name: "Clear all" });
        if (await clear.count()) await clear.click();
        await p.keyboard.press("Escape");
        await sleep(800);
      }
      const restoredView = ctx.restoreView
        ? await selectContractsView(p, ctx.restoreView)
        : "Default view";
      expectThat(
        marker >= 1 &&
          /Restore it to edit/.test(notice) &&
          !titleEditable &&
          c.archivedAt &&
          c.statusName === "Expired",
        `marker ${marker} notice "${notice}" editable ${titleEditable} status ${c.statusName}`,
      );
      expectThat(
        !linkedC.archivedAt &&
          !(matter.matter?.archivedAt ?? matter.archivedAt) &&
          !sectionText.includes(`C-${n.J}`),
        `linked C ${linkedC.archivedAt} matter section "${sectionText}"`,
      );
      expectThat(
        !archivedOnly && both,
        `archived only ${archivedOnly} (${archivedOnlyName}); both ${both} (${bothName})`,
      );
      expectThat(
        markerAfter === 0 &&
          editableAfter &&
          !c2.archivedAt &&
          c2.statusName === "Expired" &&
          restoreByAddress === 1 &&
          !c3.archivedAt,
        `after restore marker ${markerAfter} editable ${editableAfter} status ${c2.statusName} address ${restoreByAddress}`,
      );
      return `Related link to C-${n.C} (${link.status}); Status Expired. Archive showed the Archived marker and "${notice}"; Title was not editable; Status stayed ${c.statusName}. C-${n.C} and M-${m.M2} were not archived; Before archiving M-${m.M2}'s Linked Contracts listed C-${n.J}; while archived it read "${sectionText.slice(0, 200)}". List filter started as "${filterNow}"; Show archived alone ("${archivedOnlyName}") did not list the Ended record; with Show ended too ("${bothName}") it did. Restore from Contract actions removed the marker and re-enabled editing; Status still ${c2.statusName}, so the default view still excludes it. Archived again (${again.status}), the known /contracts/${n.J} address offered Restore (${restoreByAddress}) and restored it. Afterwards the reviewer cleared its list filters ("${leftFilter}" before) and re-selected view "${restoredView}".`;
    },
  );
}
