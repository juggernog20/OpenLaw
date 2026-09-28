// V-C32 steps for "Manage Holdings, Officers, and Registrations" (docs/user-guides/entity-records.md), DOC-032.
// Written by the DOC-032 independent walkthrough agent (records). Ported from the DOC-030 entities
// walkthrough.mjs c32 function. The Officer steps are rewritten for the Director or officer name
// combobox (People list, Use "<name>" without linking a user, User linked icon) described in the
// corrected guide. Fixture Entities are created per role and named "DOC-032 records V-C32 ...".
import path from "node:path";
import {
  expect,
  q,
  tidy,
  wait,
  sessionFor,
  go,
  settle,
  reload,
  blurTo,
  sectionText,
  section,
  applyFilter,
  fixtureEntity,
  addHolding,
  errorScreens,
} from "./entities-lib.mjs";

export default async function entityRecords(ctx) {
  const R = ctx.role;
  const TAG = ctx.stamp;
  const step = (role, pg, action, expected, fn) => ctx.step(action, expected, fn, { page: pg });
  const s = await sessionFor(ctx, R);
  ctx.setPage(s.page);
  const { page } = s;
  const who = R === "administrator" ? "A" : "L";
  const prefix = `DOC-032 records V-C32 ${who} ${TAG}`;
  const main = await fixtureEntity(ctx, s, `${prefix} main`, {
    jurisdiction: "Republic of Aldoria",
  });
  const owned = await fixtureEntity(ctx, s, `${prefix} owned`);
  const third = await fixtureEntity(ctx, s, `${prefix} third`);
  const coOwner = await fixtureEntity(ctx, s, `${prefix} co-owner`);
  const officer = `Ines Castell ${who} ${TAG}`;
  const person = `Mara Quill ${who} ${TAG}`;
  const other = "Ravi Menon";
  const body = page.getByRole("main");

  const nameBox = (scope, who) =>
    scope.getByRole("combobox", { name: `${who} Director or officer name`, exact: true });
  const linkedIcon = (box) => box.locator("xpath=..").locator('[aria-label="User linked"]');
  const people = () => page.getByRole("listbox", { name: "People" });

  await step(
    R,
    page,
    "Officers steps 1-2 and 4: Add director or officer; type in Director or officer name; the list shows matching OpenLaw users; select one to fill the name and link the user (person icon); Role, Appointed on, Add",
    "The add form has a Director or officer name combobox (no Linked user control); typing lists matching users under People; selecting Ravi Menon fills the name with a User linked icon; Add is available only when name and role have values; the saved row shows the name, role, date and the link.",
    async () => {
      await go(page, `/entities/${main.id}`);
      const card = section(page, "Directors & Officers");
      await card.getByRole("button", { name: "Add director or officer" }).click();
      const box = card.getByRole("combobox", { name: "Director or officer name", exact: true });
      await box.waitFor();
      const placeholder = await box.getAttribute("placeholder");
      const linkedUserControl = await card.getByLabel("Linked user").count();
      const addButton = card.getByRole("button", { name: "Add", exact: true });
      const addDisabledEmpty = await addButton.isDisabled();
      const roleStart = tidy(
        await card.getByLabel("Role", { exact: true }).locator("option:checked").innerText(),
      );
      await box.click();
      await box.pressSequentially("Ravi");
      await people().waitFor();
      const options = (await people().getByRole("option").allInnerTexts()).map(tidy);
      await people().getByRole("option", { name: "Ravi Menon", exact: true }).click();
      const filled = await box.inputValue();
      const iconAfterSelect = await linkedIcon(box).count();
      await card.getByLabel("Role", { exact: true }).selectOption({ label: "Director" });
      await card.getByLabel("Appointed on", { exact: true }).fill("2021-03-01");
      const addEnabled = await addButton.isEnabled();
      await addButton.click();
      await settle(page);
      await reload(page);
      const c = section(page, "Directors & Officers");
      const row = {
        name: await nameBox(c, "Ravi Menon").inputValue(),
        role: tidy(await c.getByLabel("Ravi Menon Role").locator("option:checked").innerText()),
        appointed: await c.getByLabel("Ravi Menon Appointed on").inputValue(),
        linkedIcon: await linkedIcon(nameBox(c, "Ravi Menon")).count(),
      };
      const apiRow = (await s.api("GET", `/entities/${main.id}/officers`)).json.officers.find(
        (o) => o.name === "Ravi Menon",
      );
      expect(
        placeholder === "Select a user or enter a name" &&
          linkedUserControl === 0 &&
          addDisabledEmpty &&
          options.includes("Ravi Menon") &&
          filled === "Ravi Menon" &&
          iconAfterSelect === 1 &&
          addEnabled &&
          row.role === "Director" &&
          row.appointed === "2021-03-01" &&
          row.linkedIcon === 1 &&
          apiRow?.user?.displayName === "Ravi Menon",
        q({
          placeholder,
          linkedUserControl,
          addDisabledEmpty,
          options,
          filled,
          iconAfterSelect,
          addEnabled,
          row,
          apiUser: apiRow?.user,
        }),
      );
      return `Add director or officer opened a form with a Director or officer name combobox (placeholder ${q(placeholder)}), Role (starting on ${q(roleStart)}), Appointed on, Add and Cancel; ${linkedUserControl} Linked user controls. Add was disabled with the name empty. Typing "Ravi" opened the People list with ${q(options)}; selecting Ravi Menon filled ${q(filled)} and showed the User linked person icon (${iconAfterSelect}). With Role Director and Appointed on 2021-03-01, Add was enabled; after Add and a reload the row read ${q(row)} and the saved Officer is linked to ${apiRow?.user?.displayName}.`;
    },
  );

  await step(
    R,
    page,
    'Officers step 3: type a full name and choose Use "Helena Marsh" without linking a user, or press Enter; typing over a name removes its user link',
    "Helena Marsh (a seeded Officer name with no OpenLaw account) lists no user, only the Use option; the saved row has no person icon; a typed name committed with Enter saves unlinked; typing over a selected user removes the link icon.",
    async () => {
      let card = section(page, "Directors & Officers");
      await card.getByRole("button", { name: "Add director or officer" }).click();
      let box = card.getByRole("combobox", { name: "Director or officer name", exact: true });
      await box.click();
      await box.pressSequentially("Priya");
      await people().getByRole("option", { name: "Priya Raman", exact: true }).click();
      const iconSelected = await linkedIcon(box).count();
      await box.pressSequentially(" Q");
      const iconTypedOver = await linkedIcon(box).count();
      await box.fill("");
      await box.pressSequentially("Helena Marsh");
      await people().waitFor();
      const helenaOptions = (await people().getByRole("option").allInnerTexts()).map(tidy);
      await people()
        .getByRole("option", { name: 'Use "Helena Marsh" without linking a user', exact: true })
        .click();
      const helenaIcon = await linkedIcon(box).count();
      await card.getByLabel("Role", { exact: true }).selectOption({ label: "Secretary" });
      await card.getByRole("button", { name: "Add", exact: true }).click();
      await settle(page);
      // The Enter path, with the officer used in the later steps.
      card = section(page, "Directors & Officers");
      await card.getByRole("button", { name: "Add director or officer" }).click();
      box = card.getByRole("combobox", { name: "Director or officer name", exact: true });
      await box.click();
      await box.pressSequentially(officer);
      const typedOptions = (await people().getByRole("option").allInnerTexts()).map(tidy);
      await box.press("Enter");
      const afterEnter = await box.inputValue();
      await card.getByLabel("Role", { exact: true }).selectOption({ label: "Director" });
      await card.getByLabel("Appointed on", { exact: true }).fill("2022-05-09");
      await card.getByRole("button", { name: "Add", exact: true }).click();
      await settle(page);
      await reload(page);
      const c = section(page, "Directors & Officers");
      const helena = {
        name: await nameBox(c, "Helena Marsh").inputValue(),
        role: tidy(await c.getByLabel("Helena Marsh Role").locator("option:checked").innerText()),
        linkedIcon: await linkedIcon(nameBox(c, "Helena Marsh")).count(),
      };
      const typed = {
        name: await nameBox(c, officer).inputValue(),
        appointed: await c.getByLabel(`${officer} Appointed on`).inputValue(),
        linkedIcon: await linkedIcon(nameBox(c, officer)).count(),
      };
      const saved = (await s.api("GET", `/entities/${main.id}/officers`)).json.officers;
      const users = (await s.api("GET", "/users?limit=200")).json?.users ?? [];
      const helenaUser = users.filter((u) => /Helena Marsh/.test(u.displayName ?? "")).length;
      expect(
        iconSelected === 1 &&
          iconTypedOver === 0 &&
          q(helenaOptions) === q(['Use "Helena Marsh" without linking a user']) &&
          helenaIcon === 0 &&
          helena.linkedIcon === 0 &&
          helena.role === "Secretary" &&
          afterEnter === officer &&
          typed.linkedIcon === 0 &&
          typed.appointed === "2022-05-09" &&
          saved.find((o) => o.name === "Helena Marsh")?.user == null &&
          saved.find((o) => o.name === officer)?.user == null,
        q({ iconSelected, iconTypedOver, helenaOptions, helenaIcon, helena, afterEnter, typed }),
      );
      return `Selecting Priya Raman showed the User linked icon (${iconSelected}); typing " Q" over the name removed it (${iconTypedOver}). Typing "Helena Marsh" listed only ${q(helenaOptions)} (no OpenLaw user of that name; the user list has ${helenaUser} matches); choosing it left no icon, and with Role Secretary Add saved ${q(helena)}. Typing ${q(officer)} listed ${q(typedOptions)}; Enter committed ${q(afterEnter)} unlinked, and with Director and 2022-05-09 Add saved ${q(typed)}. Both rows are stored with no user link.`;
    },
  );

  await step(
    R,
    page,
    "Officers step 5: change a row's name the same way (typed name saves on leaving the field; selecting a user saves and links); change its date and move focus away; choosing another role saves",
    "A typed name saves on blur; selecting a user from the list saves at once and links; a date saves on blur; a Role selection saves at once; each survives a reload.",
    async () => {
      let c = section(page, "Directors & Officers");
      await nameBox(c, officer).click();
      await nameBox(c, officer).press("End");
      await nameBox(c, officer).pressSequentially(" Jr");
      await blurTo(page, "Directors & Officers");
      await reload(page);
      c = section(page, "Directors & Officers");
      const renamed = await nameBox(c, `${officer} Jr`).inputValue();
      await nameBox(c, `${officer} Jr`).fill("");
      await nameBox(c, `${officer} Jr`).pressSequentially(officer);
      await nameBox(c, `${officer} Jr`).press("Enter");
      await settle(page);
      await reload(page);
      c = section(page, "Directors & Officers");
      const back = await nameBox(c, officer).inputValue();
      // Selecting a user on the Helena Marsh row links it; then set it back by typing.
      const helenaBox = nameBox(c, "Helena Marsh");
      await helenaBox.click();
      await helenaBox.fill("");
      await helenaBox.pressSequentially("Amara");
      await people().getByRole("option", { name: "Amara Nwosu", exact: true }).click();
      await settle(page);
      await reload(page);
      c = section(page, "Directors & Officers");
      const linkedRow = {
        name: await nameBox(c, "Amara Nwosu").inputValue(),
        icon: await linkedIcon(nameBox(c, "Amara Nwosu")).count(),
      };
      await nameBox(c, "Amara Nwosu").fill("");
      await nameBox(c, "Amara Nwosu").pressSequentially("Helena Marsh");
      await blurTo(page, "Directors & Officers");
      await reload(page);
      c = section(page, "Directors & Officers");
      const unlinkedAgain = await linkedIcon(nameBox(c, "Helena Marsh")).count();
      await c.getByLabel(`${officer} Appointed on`).fill("2022-05-10");
      await blurTo(page, "Directors & Officers");
      await section(page, "Directors & Officers")
        .getByLabel(`${officer} Role`)
        .selectOption({ label: "Secretary" });
      await settle(page);
      await reload(page);
      c = section(page, "Directors & Officers");
      const role = tidy(
        await c.getByLabel(`${officer} Role`).locator("option:checked").innerText(),
      );
      const date = await c.getByLabel(`${officer} Appointed on`).inputValue();
      await c.getByLabel(`${officer} Appointed on`).fill("2022-05-09");
      await blurTo(page, "Directors & Officers");
      await section(page, "Directors & Officers")
        .getByLabel(`${officer} Role`)
        .selectOption({ label: "Director" });
      await settle(page);
      expect(
        renamed === `${officer} Jr` &&
          back === officer &&
          linkedRow.icon === 1 &&
          unlinkedAgain === 0 &&
          role === "Secretary" &&
          date === "2022-05-10",
        q({ renamed, back, linkedRow, unlinkedAgain, role, date }),
      );
      return `Typing " Jr" and leaving the field saved ${q(renamed)}; retyping and Enter saved ${q(back)}. On the Helena Marsh row, selecting Amara Nwosu from People saved ${q(linkedRow)} (linked); typing Helena Marsh over it and leaving the field saved it unlinked (${unlinkedAgain} icons). Appointed on 2022-05-10 saved on blur and Role Secretary saved on selection (${q(role)}, ${q(date)} after reload); both were set back.`;
    },
  );

  await step(
    R,
    page,
    "Officers step 5: if a save fails, the row shows the saved value again",
    "With the Entity archived by a second actor after the page loaded, a name change is refused and the row shows the saved name again; nothing else changes.",
    async () => {
      await reload(page);
      const c = section(page, "Directors & Officers");
      const other2 = await sessionFor(
        ctx,
        R === "administrator" ? "legal_team_member" : "administrator",
      );
      const archived = await other2.api("POST", `/entities/${main.id}/archive`);
      let shown;
      let message;
      let stored;
      try {
        expect(archived.status === 200, `competing archive ${archived.status} ${q(archived.json)}`);
        const box = nameBox(c, officer);
        await box.click();
        await box.press("End");
        await box.pressSequentially(" X");
        const patch = page.waitForResponse(
          (r) => r.request().method() === "PATCH" && /\/officers\//.test(new URL(r.url()).pathname),
          { timeout: 10000 },
        );
        await blurTo(page, "Directors & Officers");
        const status = (await patch).status();
        await wait(500);
        shown = await nameBox(section(page, "Directors & Officers"), officer)
          .inputValue()
          .catch(() => null);
        message = tidy(
          (await section(page, "Directors & Officers").innerText()).match(
            /[^.\n]*archived[^.\n]*\.?/i,
          )?.[0] ?? "",
        );
        stored = (await s.api("GET", `/entities/${main.id}/officers`)).json.officers.map(
          (o) => o.name,
        );
        expect(
          status >= 400 && shown === officer && !stored.includes(`${officer} X`),
          q({ status, shown, stored }),
        );
        message = `${status}; ${message}`;
      } finally {
        await other2.api("POST", `/entities/${main.id}/restore`);
      }
      await ctx.record({
        what: `Competing archive of ${main.legalName}`,
        how: `POST /entities/:id/archive as ${other2.person.name}, then restore`,
        cleanup: "restored in the same step",
      });
      return `A second actor archived the Entity after the page loaded. Typing " X" after the name and leaving the field was refused (${message}); the row showed ${q(shown)} again and the stored names stayed ${q(stored)}. The Entity was restored.`;
    },
  );

  await step(
    R,
    page,
    "Negative: a resignation date before the appointment date is refused",
    "Refusal message; the appointment date is unchanged and no resignation is stored.",
    async () => {
      const card = section(page, "Directors & Officers");
      await card.getByLabel(`${officer} Resigned on`).fill("2021-01-01");
      await blurTo(page, "Directors & Officers");
      const message = tidy(
        await page
          .getByText(/resignation date cannot be before/i)
          .first()
          .innerText()
          .catch(() => ""),
      );
      await reload(page);
      const c = section(page, "Directors & Officers");
      const appointed = await c.getByLabel(`${officer} Appointed on`).inputValue();
      const resigned = await c.getByLabel(`${officer} Resigned on`).inputValue();
      expect(
        message && appointed === "2022-05-09" && resigned === "",
        q({ message, appointed, resigned }),
      );
      return `Resigned on 2021-01-01 showed ${q(message)}. After a reload Appointed on was ${appointed} and Resigned on was empty.`;
    },
  );

  await step(
    R,
    page,
    "Officers step 6: Resigned on keeps a resignation; Show former reads former Officers; clearing the date returns the Officer",
    "The resigned Officer leaves the current list, returns with Show former, and clearing the date restores it.",
    async () => {
      let card = section(page, "Directors & Officers");
      await card.getByLabel(`${officer} Resigned on`).fill("2024-08-31");
      await blurTo(page, "Directors & Officers");
      await reload(page);
      card = section(page, "Directors & Officers");
      const currentCount = await card
        .getByRole("combobox", { name: `${officer} Director or officer name` })
        .count();
      await card.getByLabel("Show former").check();
      await settle(page);
      const former = await card.getByLabel(`${officer} Resigned on`).inputValue();
      await card.getByLabel(`${officer} Resigned on`).fill("");
      await blurTo(page, "Directors & Officers");
      await reload(page);
      const back = await section(page, "Directors & Officers")
        .getByRole("combobox", { name: `${officer} Director or officer name` })
        .count();
      expect(
        currentCount === 0 && former === "2024-08-31" && back === 1,
        q({ currentCount, former, back }),
      );
      return `With Resigned on 2024-08-31 the Officer left the current list (${currentCount} rows). Show former showed it with ${former}. Clearing the date and reloading returned it to the current list (${back} row).`;
    },
  );

  await step(
    R,
    page,
    "Officer note: linking a user does not grant that person Entity access",
    "The linked user gains no Grant on the Entity.",
    async () => {
      const grants = await s.api("GET", `/entities/${main.id}/grants`);
      const names = (grants.json?.grants ?? []).map((g) => g.displayName);
      expect(!names.includes(other), `grants ${q(names)}`);
      return `The Entity's access list named ${q(names)}; the linked user ${other} held no Grant. (The effect on a Confidential Entity is checked in V-C53.)`;
    },
  );

  await step(
    R,
    page,
    "Officer note: the remove control, labelled Remove <name>, deletes the Officer entry",
    "The Officer is absent even with Show former.",
    async () => {
      const card = section(page, "Directors & Officers");
      const label = await card
        .getByRole("button", { name: "Remove Ravi Menon", exact: true })
        .count();
      await card.getByRole("button", { name: "Remove Ravi Menon", exact: true }).click();
      await settle(page);
      await reload(page);
      const c = section(page, "Directors & Officers");
      await c.getByLabel("Show former").check();
      await settle(page);
      const count = await c
        .getByRole("combobox", { name: "Ravi Menon Director or officer name" })
        .count();
      const others = await c
        .getByRole("combobox", { name: `${officer} Director or officer name` })
        .count();
      expect(
        label === 1 && count === 0 && others === 1,
        `label ${label} still ${count} others ${others}`,
      );
      return `The Ravi Menon row's remove control is labelled "Remove Ravi Menon". After selecting it and a reload, Show former listed no Ravi Menon row; ${officer} was untouched.`;
    },
  );

  const jur = `Nordvik ${who} ${TAG}`;
  const obligationLabel = `${prefix} licence renewal`;
  await step(
    R,
    page,
    "Registrations steps 1-3: Add registration with Jurisdiction, Registration number, Registered agent, Status Lapsed; Formation jurisdiction unchanged",
    "The row saves; the Entity's Formation jurisdiction stays the same.",
    async () => {
      const card = section(page, "Registrations");
      await card.getByRole("button", { name: "Add registration" }).click();
      await card.getByLabel("Jurisdiction", { exact: true }).fill(jur);
      await card.getByLabel("Registration number", { exact: true }).fill(`NV-${TAG}`);
      await card.getByLabel("Registered agent", { exact: true }).fill("Nordvik Agents AS");
      await card.getByLabel("Status", { exact: true }).selectOption({ label: "Lapsed" });
      await card.getByRole("button", { name: "Add", exact: true }).click();
      await settle(page);
      await reload(page);
      const c = section(page, "Registrations");
      const row = {
        number: await c.getByLabel(`${jur} Registration number`).inputValue(),
        agent: await c.getByLabel(`${jur} Registered agent`).inputValue(),
        status: tidy(await c.getByLabel(`${jur} Status`).locator("option:checked").innerText()),
      };
      const formation = await body
        .getByLabel("Formation jurisdiction", { exact: true })
        .inputValue();
      expect(
        row.number === `NV-${TAG}` &&
          row.status === "Lapsed" &&
          formation === "Republic of Aldoria",
        `${q(row)} ${formation}`,
      );
      return `The Registration ${jur} saved ${q(row)}. Formation jurisdiction still read ${q(formation)}.`;
    },
  );

  await step(
    R,
    page,
    "Registrations step 3: edit text and move focus away; a Status selection saves immediately",
    "Agent saves on blur; Withdrawn saves on selection.",
    async () => {
      const card = section(page, "Registrations");
      await card.getByLabel(`${jur} Registered agent`).fill("Nordvik Corporate Agents AS");
      await blurTo(page, "Registrations");
      await section(page, "Registrations")
        .getByLabel(`${jur} Status`)
        .selectOption({ label: "Withdrawn" });
      await settle(page);
      await reload(page);
      const c = section(page, "Registrations");
      const agent = await c.getByLabel(`${jur} Registered agent`).inputValue();
      const status = tidy(
        await c.getByLabel(`${jur} Status`).locator("option:checked").innerText(),
      );
      expect(
        agent === "Nordvik Corporate Agents AS" && status === "Withdrawn",
        `${agent} ${status}`,
      );
      return `After a reload Registered agent read ${q(agent)} and Status read ${status}.`;
    },
  );

  await step(
    R,
    page,
    "Registrations step 4 and note: Remove <jurisdiction> registration deletes it and detaches, but keeps, a linked Obligation",
    "The Obligation linked to the Registration remains with no Registration link.",
    async () => {
      await go(page, `/entities/${main.id}/obligations`);
      await page.getByRole("button", { name: "Add obligation" }).click();
      const dialog = page.getByRole("dialog", { name: "Add obligation" });
      await dialog.getByLabel("Label", { exact: true }).fill(obligationLabel);
      await dialog.getByLabel("Due date", { exact: true }).fill("2027-03-31");
      await dialog
        .getByLabel("Registration", { exact: true })
        .selectOption({ label: `${jur} · NV-${TAG}` });
      await dialog.getByRole("button", { name: "Add obligation" }).click();
      await dialog.waitFor({ state: "hidden" });
      await go(page, `/entities/${main.id}`);
      await section(page, "Registrations")
        .getByRole("button", { name: `Remove ${jur} registration` })
        .click();
      await settle(page);
      await reload(page);
      const gone =
        (await section(page, "Registrations").getByLabel(`${jur} Registration number`).count()) ===
        0;
      await go(page, `/entities/${main.id}/obligations`);
      const row = tidy(
        await page.locator("main table tbody tr", { hasText: obligationLabel }).first().innerText(),
      );
      const api = await s.api("GET", `/entities/${main.id}/obligations`);
      const kept = (api.json?.obligations ?? []).find((o) => o.label === obligationLabel);
      expect(gone && kept && kept.registration === null, q({ gone, kept }));
      return `An Obligation ${q(obligationLabel)} was linked to ${jur}. Remove ${jur} registration deleted the row; the Obligation stayed on the Entity (${q(row)}) with no Registration link.`;
    },
  );

  await step(
    R,
    page,
    "Holdings intro and step 1: the Ownership tab opens with the share register; Add Holding sits below Holdings in other Entities; Owner type Entity; Ownership percent starts at 100",
    "No share register yet shows first; Add Holding is below Holdings in other Entities; the dialog defaults to Entity and 100.",
    async () => {
      await go(page, `/entities/${main.id}/ownership`);
      const empty = await page.getByRole("heading", { name: "No share register yet" }).isVisible();
      const heading = page.getByRole("heading", {
        name: "Holdings in other Entities",
        exact: true,
      });
      const hBox = await heading.boundingBox();
      const add = page.getByRole("button", { name: "Add Holding" });
      const aBox = await add.boundingBox();
      const declaredCard = await page
        .getByRole("heading", { name: "Declared owners not in the register" })
        .count();
      await add.click();
      const dialog = page.getByRole("dialog", { name: "Add Holding" });
      await dialog.waitFor();
      const entityChecked = await dialog.getByRole("radio", { name: "Entity" }).isChecked();
      const individualOffered = await dialog.getByRole("radio", { name: "Individual" }).count();
      const percent = await dialog.getByLabel("Ownership percent").inputValue();
      const relationships = (
        await dialog.getByLabel("Relationship").locator("option").allInnerTexts()
      ).map(tidy);
      await dialog.getByRole("button", { name: "Cancel" }).click();
      expect(
        empty &&
          hBox &&
          aBox &&
          aBox.y > hBox.y &&
          declaredCard === 0 &&
          entityChecked &&
          individualOffered === 1 &&
          percent === "100" &&
          q(relationships) === q(["Owns this Entity", "This Entity owns"]),
        q({ empty, hBox, aBox, declaredCard, entityChecked, percent, relationships }),
      );
      return `The Ownership tab showed "No share register yet" and no Declared owners card. Add Holding sat below the Holdings in other Entities heading (y ${Math.round(aBox.y)} > ${Math.round(hBox.y)}). The dialog opened with Owner type Entity selected, Individual offered, Relationship ${q(relationships)}, and Ownership percent ${percent}.`;
    },
  );

  await step(
    R,
    page,
    "Holdings steps 2-3, 5: This Entity owns another Entity; it appears under Holdings in other Entities; the owned Entity lists the owner under Declared owners not in the register",
    "60% Holding shows on both records.",
    async () => {
      await addHolding(page, {
        relationship: "This Entity owns",
        entity: owned.legalName,
        percent: "60",
      });
      await reload(page);
      const ownedList = await sectionText(page, "Holdings in other Entities");
      await go(page, `/entities/${owned.id}/ownership`);
      const owners = await sectionText(page, "Declared owners not in the register");
      const pct = await page.getByLabel(`${main.legalName} ownership percent`).inputValue();
      expect(
        ownedList.includes(owned.legalName) && owners?.includes(main.legalName) && pct === "60",
        q({ ownedList, owners, pct }),
      );
      return `${main.legalName} listed ${owned.legalName} under Holdings in other Entities. ${owned.legalName} showed the card "Declared owners not in the register" with ${main.legalName} at ${pct}%.`;
    },
  );

  await step(
    R,
    page,
    "Holdings: Owns this Entity direction; a total over 100% warns but saves; correcting the row on blur clears the warning",
    "Second owner at 60% saves with 'Ownership totals 120% for <name>.'; changing it to 30 clears the warning.",
    async () => {
      await addHolding(page, {
        relationship: "Owns this Entity",
        entity: coOwner.legalName,
        percent: "60",
      });
      const warning = `Ownership totals 120% for ${owned.legalName}.`;
      const warned = await page.getByText(warning).isVisible();
      await reload(page);
      const saved = await page.getByLabel(`${coOwner.legalName} ownership percent`).inputValue();
      await page.getByLabel(`${coOwner.legalName} ownership percent`).fill("30");
      await blurTo(page, "Declared owners not in the register");
      await reload(page);
      const corrected = await page
        .getByLabel(`${coOwner.legalName} ownership percent`)
        .inputValue();
      const still = await page.getByText(/Ownership totals/).count();
      expect(
        warned && saved === "60" && corrected === "30" && still === 0,
        q({ warned, saved, corrected, still }),
      );
      return `Adding ${coOwner.legalName} as owner at 60% showed ${q(warning)} and saved (${saved} after reload). Changing that row to 30 and moving focus saved ${corrected} and no total warning remained.`;
    },
  );

  await step(
    R,
    page,
    "Holdings step 4: Owner type Individual, Full name, Ownership percent, Add; no Entity or account; percent correction saves",
    "The individual appears under Declared owners not in the register with the Individual label; a corrected percent saves on blur.",
    async () => {
      await page.getByRole("button", { name: "Add Holding" }).click();
      const dialog = page.getByRole("dialog", { name: "Add Holding" });
      await dialog.getByRole("radio", { name: "Individual" }).check();
      const relationshipShown = await dialog.getByLabel("Relationship").count();
      await dialog.getByLabel("Full name").fill(person);
      await dialog.getByLabel("Ownership percent").fill("10");
      await dialog.getByRole("button", { name: "Add", exact: true }).click();
      await dialog.waitFor({ state: "hidden", timeout: 10000 });
      await settle(page);
      await reload(page);
      const owners = await sectionText(page, "Declared owners not in the register");
      await page.getByLabel(`${person} ownership percent`).fill("12");
      await blurTo(page, "Declared owners not in the register");
      await reload(page);
      const pct = await page.getByLabel(`${person} ownership percent`).inputValue();
      const warn = tidy(
        await page
          .getByText(/Ownership totals/)
          .first()
          .innerText()
          .catch(() => ""),
      );
      await page.getByLabel(`${person} ownership percent`).fill("10");
      await blurTo(page, "Declared owners not in the register");
      const found = await s.api("GET", `/entities?q=${encodeURIComponent(person)}`);
      expect(
        relationshipShown === 0 &&
          owners.includes(`${person} Individual`) &&
          pct === "12" &&
          warn === `Ownership totals 102% for ${owned.legalName}.` &&
          (found.json?.entities ?? []).length === 0,
        q({ relationshipShown, owners, pct, warn }),
      );
      return `Choosing Individual hid Relationship; Full name ${q(person)} at 10% was added. Declared owners read ${q(owners)}. Changing it to 12 saved on blur (${pct} after reload, with ${q(warn)}); it was set back to 10. No Entity record was created for the person.`;
    },
  );

  await step(
    R,
    page,
    "Negative: an out-of-range row percentage is refused without changing saved values",
    "150 is refused; the rows keep 30 and 60 after reload.",
    async () => {
      await page.getByLabel(`${coOwner.legalName} ownership percent`).fill("150");
      await blurTo(page, "Declared owners not in the register");
      const alerts = (await page.getByRole("alert").allInnerTexts()).map(tidy).join(" | ");
      await reload(page);
      const value = await page.getByLabel(`${coOwner.legalName} ownership percent`).inputValue();
      const other = await page.getByLabel(`${main.legalName} ownership percent`).inputValue();
      expect(value === "30" && other === "60" && alerts.length > 0, q({ value, other, alerts }));
      return `Entering 150 showed ${q(alerts)}. After a reload the row still read ${value} and the other Holding ${other}.`;
    },
  );

  await step(
    R,
    page,
    "Holdings note: an Entity cannot own itself, duplicate a directional Holding, or create an ownership loop",
    "Self and existing related Entities are not offered; a loop is refused with a message.",
    async () => {
      await page.getByRole("button", { name: "Add Holding" }).click();
      const dialog = page.getByRole("dialog", { name: "Add Holding" });
      await dialog.getByRole("combobox", { name: "Entity" }).fill(prefix);
      const options = (
        await dialog
          .getByRole("listbox", { name: "Entity matches" })
          .getByRole("option")
          .allInnerTexts()
      ).map(tidy);
      await dialog.getByRole("button", { name: "Cancel" }).click();
      await dialog.waitFor({ state: "hidden" });
      expect(
        !options.includes(owned.legalName) &&
          !options.includes(main.legalName) &&
          options.includes(third.legalName),
        `options ${q(options)}`,
      );
      // owned owns third; then third owning main closes main -> owned -> third -> main.
      await addHolding(page, {
        relationship: "This Entity owns",
        entity: third.legalName,
        percent: "100",
      });
      await go(page, `/entities/${main.id}/ownership`);
      await page.getByRole("button", { name: "Add Holding" }).click();
      const loop = page.getByRole("dialog", { name: "Add Holding" });
      await loop.getByLabel("Relationship").selectOption({ label: "Owns this Entity" });
      await loop.getByRole("combobox", { name: "Entity" }).fill(third.legalName);
      await loop.getByRole("option", { name: third.legalName }).click();
      await loop.getByLabel("Ownership percent").fill("10");
      await loop.getByRole("button", { name: "Add", exact: true }).click();
      const alert = loop.getByRole("alert");
      await alert.waitFor({ timeout: 8000 });
      const message = tidy(await alert.innerText());
      await loop.getByRole("button", { name: "Cancel" }).click();
      await reload(page);
      const declared = await sectionText(page, "Declared owners not in the register");
      expect(!declared, `loop saved ${declared}`);
      return `On ${owned.legalName} the picker for ${q(prefix)} offered ${q(options)}: not itself and not ${main.legalName}, which already holds it. Adding ${third.legalName} as owner of ${main.legalName} (closing a loop through ${owned.legalName}) was refused with ${q(message)} and no owner row was added.`;
    },
  );

  await step(
    R,
    page,
    "Holdings step 6: the remove control, labelled Remove <other party>, removes the Holding; neither Entity is deleted",
    "The Holding and the individual leave the list; the co-owner still opens.",
    async () => {
      await go(page, `/entities/${owned.id}/ownership`);
      await page.getByRole("button", { name: `Remove ${coOwner.legalName}` }).click();
      await settle(page);
      await page.getByRole("button", { name: `Remove ${person}` }).click();
      await settle(page);
      await reload(page);
      const owners = await sectionText(page, "Declared owners not in the register");
      await go(page, `/entities/${coOwner.id}`);
      const opens = await page
        .getByRole("heading", { level: 1, name: coOwner.legalName })
        .isVisible();
      expect(
        !owners.includes(coOwner.legalName) && !owners.includes(person) && opens,
        q({ owners, opens }),
      );
      return `After Remove ${coOwner.legalName} and Remove ${person}, the Declared owners card on ${owned.legalName} read ${q(owners)}; ${coOwner.legalName} still opened.`;
    },
  );

  await step(
    R,
    page,
    "Documents: a new Entity has no pre-created folders; Upload lands a Document on this Entity only",
    "Empty Documents tab; the upload is listed on this Entity and not on another.",
    async () => {
      await go(page, `/entities/${main.id}/documents`);
      const empty = await page.getByText("No documents on this Entity yet.").isVisible();
      const folders = await page
        .getByRole("button", { name: /^Actions for the .* folder$/ })
        .count();
      await page.getByRole("button", { name: "Upload", exact: true }).click();
      const dialog = page.getByRole("dialog", { name: "Upload document" });
      await dialog.waitFor();
      const [chooser] = await Promise.all([
        page.waitForEvent("filechooser"),
        dialog.getByText("Choose files", { exact: true }).click(),
      ]);
      await chooser.setFiles(
        path.join(ctx.here, "fixtures", "doc032-records-register-extract.pdf"),
      );
      await dialog.getByRole("button", { name: "Upload", exact: true }).click();
      await dialog.waitFor({ state: "hidden", timeout: 30000 });
      await reload(page);
      const row = tidy(
        await page
          .locator("main table tbody tr", { hasText: "doc032-records-register-extract" })
          .first()
          .innerText(),
      );
      await go(page, `/entities/${owned.id}/documents`);
      const sibling = await page.getByText("doc032-records-register-extract").count();
      expect(empty && folders === 0 && row && sibling === 0, q({ empty, folders, row, sibling }));
      return `The Documents tab first showed "No documents on this Entity yet." and ${folders} folders. Upload produced the row ${q(row)}. ${owned.legalName} did not list it.`;
    },
  );

  await step(
    R,
    page,
    "Archive step 1: Archive saves immediately; Archived mark; editable controls, including the share register and Add Holding, become unavailable",
    "Archived mark and restore note; Legal name disabled; add buttons absent or disabled; a register write is refused.",
    async () => {
      await go(page, `/entities/${main.id}`);
      await page.getByRole("button", { name: "Archive", exact: true }).click();
      await settle(page);
      await reload(page);
      const mark = await page.getByText("Archived", { exact: true }).first().isVisible();
      const note = await page.getByText("This entity is archived. Restore it to edit.").isVisible();
      const nameDisabled = await body.getByLabel("Legal name", { exact: true }).isDisabled();
      const addOfficer = await page
        .getByRole("button", { name: "Add director or officer" })
        .count();
      const addRegistration = await page.getByRole("button", { name: "Add registration" }).count();
      await go(page, `/entities/${main.id}/obligations`);
      const addObligation = await page.getByRole("button", { name: "Add obligation" }).count();
      await go(page, `/entities/${main.id}/ownership`);
      const newClass = await page.getByRole("button", { name: "New share class" }).isDisabled();
      const addHoldingDisabled = await page
        .getByRole("button", { name: "Add Holding" })
        .isDisabled();
      const write = await s.api("POST", `/entities/${main.id}/share-classes`, {
        name: "Ordinary",
        votesPerShare: 1,
      });
      expect(
        mark &&
          note &&
          nameDisabled &&
          addOfficer === 0 &&
          addRegistration === 0 &&
          addObligation === 0 &&
          newClass &&
          addHoldingDisabled &&
          write.status === 409,
        q({
          mark,
          note,
          nameDisabled,
          addOfficer,
          addRegistration,
          addObligation,
          newClass,
          addHoldingDisabled,
          write,
        }),
      );
      return `After Archive and a reload the record showed the Archived mark and "This entity is archived. Restore it to edit.". Legal name was disabled; Add director or officer, Add registration and Add obligation were absent. On Ownership, New share class and Add Holding were disabled, and a share-class write was refused ${write.status} ${q(write.json?.detail)}.`;
    },
  );

  await step(
    R,
    page,
    "Archive: the archived Entity leaves ordinary registry and Holding picker results",
    "Not in a List search without Show archived; not offered in Add Holding.",
    async () => {
      await go(page, "/entities?view=list");
      await page.getByRole("searchbox", { name: "Search entities by name" }).fill(main.legalName);
      await settle(page);
      const hidden = await page
        .locator("main table tbody")
        .getByRole("link", { name: main.legalName })
        .count();
      await go(page, `/entities/${coOwner.id}/ownership`);
      await page.getByRole("button", { name: "Add Holding" }).click();
      const dialog = page.getByRole("dialog", { name: "Add Holding" });
      await dialog.getByRole("combobox", { name: "Entity" }).fill(prefix);
      const options = (
        await dialog
          .getByRole("listbox", { name: "Entity matches" })
          .getByRole("option")
          .allInnerTexts()
      ).map(tidy);
      await dialog.getByRole("button", { name: "Cancel" }).click();
      expect(hidden === 0 && !options.includes(main.legalName), q({ hidden, options }));
      return `The List search found ${hidden} rows for the archived Entity, and Add Holding on ${coOwner.legalName} offered ${q(options)}, without it.`;
    },
  );

  await step(
    R,
    page,
    "Archive steps 2-3: List, Filter, Show archived, open the Entity, Restore; facts, relationships, Documents and Obligation remain; editing returns",
    "Show archived lists it; Restore brings back editing with data intact.",
    async () => {
      await go(page, "/entities?view=list");
      await applyFilter(page, page.getByLabel("Record filters"), "Show archived");
      const chip = (
        await page.getByLabel("Record filters").getByRole("button").allInnerTexts()
      ).map(tidy);
      await page.getByRole("searchbox", { name: "Search entities by name" }).fill(main.legalName);
      await settle(page);
      const link = page.locator("main table tbody").getByRole("link", { name: main.legalName });
      const listed = await link.count();
      await link.first().click();
      await settle(page);
      await page.getByRole("button", { name: "Restore", exact: true }).click();
      await settle(page);
      await reload(page);
      const editable = await body.getByLabel("Legal name", { exact: true }).isEnabled();
      const addOfficer = await page
        .getByRole("button", { name: "Add director or officer" })
        .count();
      const formation = await body
        .getByLabel("Formation jurisdiction", { exact: true })
        .inputValue();
      await go(page, `/entities/${main.id}/ownership`);
      const ownedList = await sectionText(page, "Holdings in other Entities");
      const newClass = await page.getByRole("button", { name: "New share class" }).isEnabled();
      await go(page, `/entities/${main.id}/documents`);
      const doc = await page.getByText("doc032-records-register-extract").count();
      await go(page, `/entities/${main.id}/obligations`);
      const obligation = await page
        .locator("main table tbody tr", { hasText: obligationLabel })
        .count();
      expect(
        listed === 1 &&
          editable &&
          addOfficer === 1 &&
          formation === "Republic of Aldoria" &&
          ownedList.includes(owned.legalName) &&
          newClass &&
          doc > 0 &&
          obligation === 1,
        q({ chip, listed, editable, addOfficer, formation, ownedList, newClass, doc, obligation }),
      );
      return `Filter, then Show archived, added the chip ${q(chip.find((c) => /Show archived/.test(c)))} and the List showed ${listed} row for it. Restore returned an editable Legal name, Add director or officer and New share class. Formation jurisdiction ${q(formation)}, the Holding of ${owned.legalName}, the uploaded Document, and the Obligation all remained.`;
    },
  );
  if (errorScreens.length)
    await ctx.record({
      what: "Transient error screens on the shared lab (each cleared on reload)",
      screens: errorScreens.splice(0),
    });
}
