// V-C38 steps for "Configure types, Statuses, and Fields" (docs/user-guides/types-statuses-fields.md), DOC-032.
// Written by the DOC-032 independent walkthrough agent (records). Ported from the DOC-030
// admin-config walkthrough.mjs sections types, documents, statuses, fields, form, officers and
// access. New in DOC-032: the Document type colour swatch, seven fixed Contract Document types
// (Partially signed before Executed) with the lock text "<name> has a fixed name. Its colour can be
// changed.", and Partially signed as a protected Signature Status.
// This article changes organisation-wide configuration on a shared lab. The run creates only
// types, Statuses, Fields, Document types and Officer roles named "DOC-032 records V-C38 ...
// <stamp>", reorders only its own rows, sets any colour back, and archives what it created at the
// end. Seeded items are only read: a fixed type's colour swatch is opened and closed with Escape.
import path from "node:path";
import { execFileSync } from "node:child_process";
import { must as expectThat, q, escapeRe, until, sleep as pause, BASE } from "./lib.mjs";

const flat = (s) => (s ?? "").replace(/\s+/g, " ").trim();

export default async function typesStatusesFields(ctx) {
  const PEOPLE = {
    administrator: { email: "daniel.okafor@helix.example", name: "Daniel Okafor" },
    legal_team_member: { email: "nadia.haddad@helix.example", name: "Nadia Haddad" },
  };
  const stamp = ctx.stamp;
  const SHOTS = ctx.here;
  let section = null;
  const name = (scenario, what) => `DOC-032 records ${scenario} ${what} ${stamp}`;
  const api = async (page, method, url, data) => {
    const r = await ctx.api(page, method, url.replace(/^\/api\/v1/, ""), data);
    return { status: r.status, body: r.json };
  };
  let currentPage = null;
  const step = (scenario, role, action, expected, fn, method = "browser-walkthrough") =>
    ctx.step(action, expected, fn, {
      method,
      page: currentPage,
      actor: currentPage && currentPage !== adminPage ? "Nadia Haddad" : "Daniel Okafor",
    });
  async function browserSignIn(page, person) {
    await page.goto(`${BASE}/auth/login`);
    await page.getByRole("heading").first().waitFor({ timeout: 20000 });
    const withPassword = page.getByRole("button", {
      name: /Sign in with a password|Administrator sign-in/,
    });
    if (await withPassword.isVisible().catch(() => false)) await withPassword.click();
    await page.getByLabel("Email").fill(person.email);
    await page.getByLabel("Password").fill(process.env.LAB_PASSWORD);
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await page.waitForURL((u) => !u.pathname.startsWith("/auth/"), { timeout: 30000 });
  }
  const adminPage = (await ctx.session("administrator")).page;
  ctx.setPage(adminPage);
  const record = (kind, value, extra = {}) => ctx.record({ what: kind, name: value, ...extra });

  async function openSettings(page, person, link, group = "Organization") {
    await page.goto(`${BASE}/`);
    await page.getByRole("banner").getByRole("button", { name: person.name }).click();
    await page.getByRole("menuitem", { name: "Settings" }).click();
    await page.waitForURL(/\/settings/);
    const rail = page.getByRole("navigation", { name: "Settings sections" });
    if (group === "Advanced") {
      const adv = rail.getByRole("button", { name: "Advanced" });
      if ((await adv.getAttribute("aria-expanded")) !== "true") await adv.click();
      await rail.getByRole("link", { name: link, exact: true }).click();
    } else {
      await rail
        .getByRole("group", { name: group })
        .getByRole("link", { name: link, exact: true })
        .click();
    }
    await page.waitForLoadState("networkidle").catch(() => {});
  }
  async function pane(page, paneNav, link) {
    await page
      .getByRole("navigation", { name: paneNav })
      .getByRole("link", { name: link, exact: true })
      .click();
    await page.waitForLoadState("networkidle").catch(() => {});
  }
  function row(page, label) {
    return page
      .getByRole("listitem")
      .filter({ has: page.getByRole("button", { name: `Rename ${label}`, exact: true }) });
  }
  async function addListRow(page, button, inputLabel, value, saveLabel = "Save") {
    await page.getByRole("button", { name: button, exact: true }).click();
    await page.getByRole("textbox", { name: inputLabel }).fill(value);
    await page.getByRole("button", { name: saveLabel, exact: true }).click();
    await page
      .getByRole("button", { name: `Rename ${value}`, exact: true })
      .waitFor({ timeout: 15000 });
  }
  async function renameRow(page, from, to) {
    await page.getByRole("button", { name: `Rename ${from}`, exact: true }).click();
    const input = page.getByRole("textbox", { name: `Rename ${from}`, exact: true });
    await input.fill(to);
    await input.press("Enter");
    await page
      .getByRole("button", { name: `Rename ${to}`, exact: true })
      .waitFor({ timeout: 15000 });
  }
  async function reorderPosition(page, label) {
    const aria = await page
      .getByRole("button", { name: new RegExp(`^Reorder ${escapeRe(label)}, position`) })
      .getAttribute("aria-label");
    return Number(aria.match(/position (\d+) of/)[1]);
  }
  async function moveUp(page, label) {
    const before = await reorderPosition(page, label);
    await page
      .getByRole("button", { name: new RegExp(`^Reorder ${escapeRe(label)}, position`) })
      .focus();
    await page.keyboard.press("ArrowUp");
    await until(
      async () => (await reorderPosition(page, label)) === before - 1,
      `${label} did not move up`,
    );
    await pause(1500);
    await page.reload();
    await page
      .getByRole("button", { name: new RegExp(`^Reorder ${escapeRe(label)}, position`) })
      .waitFor();
    const after = await reorderPosition(page, label);
    expectThat(after === before - 1, `${label}: position ${before} became ${after} after reload`);
    return { before, after };
  }
  function imageId(container) {
    try {
      return execFileSync("docker", ["inspect", "--format", "{{.Image}}", container])
        .toString()
        .trim();
    } catch {
      return null;
    }
  }

  const S = {};

  // =====================================================================
  // V-C38 types-statuses-fields: types
  // =====================================================================
  async function typesSection(admin) {
    const SC = "V-C38";
    const role = "administrator";
    const A = PEOPLE.administrator;
    const typeName = name(SC, "Supplier assessment");
    const typeRenamed = name(SC, "Supplier assessment renamed");
    const replacement = name(SC, "Replacement type");
    const archivedProbe = name(SC, "Archived probe type");
    currentPage = admin;

    await step(
      SC,
      role,
      "Add and maintain types, steps 1-2: profile menu > Settings > Organization > Matters > Types; Add type, enter a name, Save; Cancel discards a draft",
      "Cancel creates no row. Save adds the named type row.",
      async () => {
        await openSettings(admin, A, "Matters");
        await pane(admin, "Matters panes", "Types");
        await admin.getByRole("heading", { name: "Matter types" }).waitFor();
        const cancelName = name(SC, "Cancelled draft");
        await admin.getByRole("button", { name: "Add type", exact: true }).click();
        const input = admin.getByRole("textbox", { name: "New type name" });
        await input.fill(cancelName);
        await admin.getByRole("button", { name: "Cancel", exact: true }).click();
        await input.waitFor({ state: "detached", timeout: 10000 });
        await admin.reload();
        await admin
          .getByRole("button", { name: /^Rename / })
          .first()
          .waitFor();
        const cancelled = await admin
          .getByRole("button", { name: `Rename ${cancelName}`, exact: true })
          .count();
        expectThat(cancelled === 0, "Cancel created a row");
        for (const n of [typeName, replacement, archivedProbe]) {
          await addListRow(admin, "Add type", "New type name", n);
          record("matter type", n);
        }
        const usage = flat(await row(admin, typeName).innerText());
        return `Profile menu > Settings > Organization > Matters opened the Types pane with heading "Matter types". Add type opened the "New type name" box; the draft ${q(cancelName)} with Cancel left no row after reload. Add type + Save added ${q(typeName)} (row reads ${q(usage)}), ${q(replacement)} and ${q(archivedProbe)}.`;
      },
    );

    await step(
      SC,
      role,
      "Step 3: select the row's Rename control; open Edit, change the description, leave the field; check the Form tab exists and the saved result",
      "Rename changes the display name; the editor has Details and Form; the description saves on leaving the field and survives reload.",
      async () => {
        await renameRow(admin, typeName, typeRenamed);
        await admin.getByRole("button", { name: `Edit ${typeRenamed}`, exact: true }).click();
        await admin.getByRole("heading", { name: typeRenamed }).first().waitFor();
        const tabs = await admin
          .getByRole("navigation", { name: "Type sections" })
          .getByRole("link")
          .allInnerTexts();
        const desc = admin.getByRole("textbox", { name: "Description" });
        const text = "DOC-032 fictional supplier assessment type.";
        await desc.fill(text);
        await desc.press("Tab");
        const note = await until(
          async () => (await admin.getByText(/^Saved$/).count()) > 0,
          "no Saved note after blur",
        ).catch(() => false);
        await pause(1000);
        await admin.reload();
        await admin.getByRole("textbox", { name: "Description" }).waitFor();
        const saved = await admin.getByRole("textbox", { name: "Description" }).inputValue();
        expectThat(saved === text, `description after reload ${q(saved)}`);
        S.matterTypeUrl = admin.url();
        await admin
          .getByRole("navigation", { name: "Type sections" })
          .getByRole("link", { name: "Form" })
          .click();
        await admin.getByRole("region", { name: "Form" }).waitFor();
        return `Rename changed the row to ${q(typeRenamed)}. Edit opened ${new URL(S.matterTypeUrl).pathname} with Type sections ${q(tabs.map(flat))}. The Description saved on Tab (Saved note seen: ${!!note}) and read ${q(saved)} after reload. The Form link opened the Form region.`;
      },
    );

    await step(
      SC,
      role,
      "Step 4: focus a reorder handle and use the arrow keys to change the display order",
      "The row moves up one position and keeps it after reload.",
      async () => {
        await admin.goto(`${BASE}/settings/matters/types`);
        await admin.getByRole("heading", { name: "Matter types" }).waitFor();
        const { before, after } = await moveUp(admin, replacement);
        return `The handle "Reorder ${replacement}, position ${before} of …" moved to position ${after} (above this run's ${typeRenamed}) with ArrowUp and kept it after reload.`;
      },
    );

    await step(
      SC,
      role,
      "Step 1-3 for Contracts, Entities and Knowledge: Add type; Edit is available on Contracts and Entities, not on Knowledge",
      "Each list accepts Add type + Save; Contract and Entity rows have Edit; Knowledge rows have none.",
      async () => {
        const out = [];
        for (const [link, heading, paneNav] of [
          ["Contracts", "Contract types", "Contracts panes"],
          ["Entities", "Entity types", "Entities panes"],
          ["Knowledge", "Knowledge types", "Knowledge panes"],
        ]) {
          await openSettings(admin, A, link);
          await pane(admin, paneNav, "Types");
          await admin.getByRole("heading", { name: heading }).waitFor();
          const n = name(SC, `${link} probe type`);
          await addListRow(admin, "Add type", "New type name", n);
          record(`${link} type`, n);
          const edit = await admin.getByRole("button", { name: `Edit ${n}`, exact: true }).count();
          if (link === "Knowledge") expectThat(edit === 0, "Knowledge row has Edit");
          else expectThat(edit === 1, `${link} row has no Edit`);
          const other = await admin
            .getByRole("img", { name: "Other is system-protected and can't be archived" })
            .count();
          out.push(
            `${link}: added ${q(n)}; Edit ${edit ? "present" : "absent"}; Other lock images ${other}`,
          );
        }
        return out.join(". ") + ".";
      },
    );

    await step(
      SC,
      role,
      "Archive a type in use: read the usage count, choose the live replacement, confirm; the dialog lists only live types; Other shows a lock",
      "The dialog shows the usage count and offers only live types other than the target; the record moves to the replacement.",
      async () => {
        // Fixture: one archived type (unused) and one fictional Matter on the type to archive.
        await admin.goto(`${BASE}/settings/matters/types`);
        await admin.getByRole("button", { name: `Archive ${archivedProbe}`, exact: true }).click();
        let d = admin.getByRole("dialog");
        const probeText = flat(await d.innerText());
        await d
          .getByRole("button", { name: /^Archive/ })
          .last()
          .click();
        await d.waitFor({ state: "hidden" });
        const types = (await api(admin, "GET", "/api/v1/matter-types?includeArchived=true")).body;
        const list = types?.types ?? types?.matterTypes ?? types ?? [];
        const typeRow = list.find((t) => t.displayName === typeRenamed);
        const replRow = list.find((t) => t.displayName === replacement);
        expectThat(typeRow && replRow, `type ids not found in ${q(Object.keys(types ?? {}))}`);
        S.matterTypeId = typeRow.id;
        S.replacementTypeId = replRow.id;
        S.archivedMatterTypeId = list.find((t) => t.displayName === archivedProbe)?.id;
        const m = await api(admin, "POST", "/api/v1/matters", {
          title: name(SC, "Reassigned matter"),
          matterTypeId: typeRow.id,
        });
        expectThat(m.status < 300, `fixture matter answered ${m.status} ${q(m.body)}`);
        S.reassignMatter = m.body.number ?? m.body.matter?.number;
        record("matter", name(SC, "Reassigned matter"), { number: S.reassignMatter });
        await admin.reload();
        const usage = flat(await row(admin, typeRenamed).innerText());
        await admin.getByRole("button", { name: `Archive ${typeRenamed}`, exact: true }).click();
        d = admin.getByRole("dialog");
        await d.waitFor();
        const text = flat(await d.innerText());
        const select = d.getByRole("combobox");
        const options = (await select.locator("option").allInnerTexts()).map(flat);
        expectThat(!options.includes(archivedProbe), "archived type offered as a replacement");
        expectThat(!options.includes(typeRenamed), "the type itself offered as a replacement");
        await select.selectOption({ label: replacement });
        await d
          .getByRole("button", { name: /^Archive/ })
          .last()
          .click();
        await d.waitFor({ state: "hidden", timeout: 15000 });
        const matter = await api(admin, "GET", `/api/v1/matters/${S.reassignMatter}`);
        const mtName = matter.body?.matter?.matterTypeName;
        expectThat(mtName === replacement, `matter type after archive ${mtName}`);
        const other = await admin
          .getByRole("img", { name: "Other is system-protected and can't be archived" })
          .count();
        expectThat(other === 1, "Other lock missing");
        return `Archiving the unused ${q(archivedProbe)} read ${q(probeText.slice(0, 200))}. M-${S.reassignMatter} (API fixture) used ${q(typeRenamed)}; its row read ${q(usage)}. The Archive dialog read ${q(text.slice(0, 300))}; the replacement list offered ${options.length} entries, without the archived ${q(archivedProbe)} or the type itself. After choosing ${q(replacement)} and confirming, M-${S.reassignMatter} reads Matter type ${q(mtName)}. Other shows the image "Other is system-protected and can't be archived" in place of Archive.`;
      },
    );

    await step(
      SC,
      role,
      "Default type: Contracts and Matters each have one type named Default with no label; its row shows Archive, and the dialog refuses and says it is the Default type",
      "The Archive dialog refuses the Default type with a reason; the type stays live.",
      async () => {
        const out = [];
        for (const [mod, heading] of [
          ["contracts", "Contract types"],
          ["matters", "Matter types"],
        ]) {
          await admin.goto(`${BASE}/settings/${mod}/types`);
          await admin.getByRole("heading", { name: heading }).waitFor();
          const rowText = flat(await row(admin, "Default").innerText());
          await admin.getByRole("button", { name: "Archive Default", exact: true }).click();
          const d = admin.getByRole("dialog");
          await d.waitFor();
          const before = flat(await d.innerText());
          const confirm = d.getByRole("button", { name: /^Archive/ }).last();
          const select = d.getByRole("combobox");
          if (await select.count()) {
            const opts = (await select.locator("option").allInnerTexts()).map(flat);
            const pick = opts.find((o) => o && !/^(No reassignment|Choose)/.test(o));
            if (pick) await select.selectOption({ label: pick });
          }
          let after = before;
          if (await confirm.isEnabled()) {
            await confirm.click();
            await pause(2000);
            after = flat(await d.innerText().catch(() => "(dialog closed)"));
          }
          const refusal = flat(
            await d
              .getByRole("alert")
              .allInnerTexts()
              .then((a) => a.join(" "))
              .catch(() => ""),
          );
          expectThat(
            /is the Default type/.test(refusal),
            `${mod}: no Default type refusal: ${refusal}`,
          );
          await admin.keyboard.press("Escape");
          await d.waitFor({ state: "hidden" }).catch(() => {});
          await admin.reload();
          await admin.getByRole("heading", { name: heading }).waitFor();
          const stillLive = await admin
            .getByRole("button", { name: "Archive Default", exact: true })
            .count();
          expectThat(stillLive === 1, `${mod}: Default no longer live`);
          out.push(
            `${heading}: row ${q(rowText)} (no Default label); the Archive dialog read ${q(before.slice(0, 160))}; after choosing a replacement and Archive it showed ${q(flat(refusal))}; the Default row stayed live after reload`,
          );
        }
        return out.join(". ") + ".";
      },
    );

    await step(
      SC,
      role,
      "Create dialogs preselect the Default type",
      "The Create matter dialog preselects Default as its Matter type.",
      async () => {
        await admin.goto(`${BASE}/matters`);
        await admin
          .getByRole("button", { name: /Create matter|New matter/ })
          .first()
          .click();
        const d = admin.getByRole("dialog");
        await d.waitFor();
        const sel = d.getByLabel(/Matter type/).first();
        const value = await sel.evaluate((el) =>
          el.tagName === "SELECT" ? el.selectedOptions[0]?.textContent : el.textContent,
        );
        await admin.keyboard.press("Escape");
        expectThat(flat(value) === "Default", `Matter type preselected ${q(value)}`);
        return `Matters > Create matter opened with Matter type ${q(flat(value))} preselected.`;
      },
    );

    await step(
      SC,
      role,
      "Show archived and Restore: restoring makes the type available again and does not move reassigned records back",
      "Show archived lists the archived type with Restore; after Restore it is live and the reassigned Matter keeps the replacement.",
      async () => {
        await admin.goto(`${BASE}/settings/matters/types`);
        await admin.getByRole("heading", { name: "Matter types" }).waitFor();
        const toggle = admin
          .getByRole("switch", { name: /Show archived/ })
          .or(admin.getByRole("checkbox", { name: /Show archived/ }));
        await toggle.first().click();
        const restore = admin.getByRole("button", { name: `Restore ${typeRenamed}`, exact: true });
        await restore.waitFor({ timeout: 10000 });
        await restore.click();
        await admin
          .getByRole("button", { name: `Archive ${typeRenamed}`, exact: true })
          .waitFor({ timeout: 15000 });
        const matter = await api(admin, "GET", `/api/v1/matters/${S.reassignMatter}`);
        const mtName = matter.body?.matter?.matterTypeName;
        expectThat(mtName === replacement, `matter moved back to ${mtName}`);
        return `Show archived listed ${q(typeRenamed)} with "Restore ${typeRenamed}". Restore made it live again (its Archive control returned). M-${S.reassignMatter} still reads Matter type ${q(mtName)}.`;
      },
    );

    await step(
      SC,
      role,
      "Negative check (API): invalid reassignment onto an archived type or onto the type itself is refused",
      "The archive dialog cannot offer these choices, so the API is asked directly and refuses both with a 400 and a reason.",
      async () => {
        const toArchived = await api(
          admin,
          "POST",
          `/api/v1/matter-types/${S.replacementTypeId}/archive`,
          { reassignToId: S.archivedMatterTypeId },
        );
        const toSelf = await api(
          admin,
          "POST",
          `/api/v1/matter-types/${S.replacementTypeId}/archive`,
          { reassignToId: S.replacementTypeId },
        );
        const still = (await api(admin, "GET", `/api/v1/matter-types/${S.replacementTypeId}`)).body;
        expectThat(
          toArchived.status === 400 && toSelf.status === 400,
          `answers ${toArchived.status}, ${toSelf.status}`,
        );
        const archivedAt = still?.archivedAt ?? still?.type?.archivedAt ?? null;
        expectThat(!archivedAt, "replacement type was archived");
        return `As the Administrator, POST /api/v1/matter-types/{${q(replacement)}}/archive with reassignToId = the archived ${q(archivedProbe)} answered ${toArchived.status} ${q(toArchived.body?.detail)}; with reassignToId = itself answered ${toSelf.status} ${q(toSelf.body?.detail)}. The type stayed live (archivedAt ${archivedAt}).`;
      },
      "api-refusal",
    );
  }

  // =====================================================================
  // V-C38 types-statuses-fields: Document types
  // =====================================================================
  async function uploadTypeChoices(page, recordPath) {
    await page.goto(`${BASE}${recordPath}`);
    await page.getByRole("button", { name: "Upload", exact: true }).first().click();
    const d = page.getByRole("dialog", { name: "Upload document" });
    await d.waitFor();
    const type = d.getByRole("combobox", { name: "Type" });
    const options = (await type.count())
      ? (await type.locator("option").allInnerTexts()).map(flat)
      : null;
    await d.getByRole("button", { name: "Cancel" }).click();
    return options;
  }

  async function documentsSection(admin) {
    const SC = "V-C38";
    const role = "administrator";
    const A = PEOPLE.administrator;
    const matterDoc = name(SC, "Board resolution");
    const matterDocRenamed = name(SC, "Board resolution renamed");
    const matterDocNeighbour = name(SC, "Board minutes");
    currentPage = admin;

    await step(
      SC,
      role,
      "Add Document types, steps 1-4: Settings > Organization > Documents; Matters tab; Add type, enter a name, Save; rename and reorder",
      "The new Document type row appears in the Matters list; rename and keyboard reorder persist.",
      async () => {
        await openSettings(admin, A, "Documents");
        const tabs = (
          await admin
            .getByRole("navigation", { name: "Document type lists" })
            .getByRole("link")
            .allInnerTexts()
        ).map(flat);
        expectThat(q(tabs) === q(["Matters", "Contracts", "Entities"]), `tabs ${q(tabs)}`);
        await pane(admin, "Document type lists", "Matters");
        await admin.getByRole("heading", { name: "Document types" }).waitFor();
        const before = (await admin.getByRole("button", { name: /^Rename / }).allInnerTexts()).map(
          flat,
        );
        await addListRow(admin, "Add type", "New type name", matterDocNeighbour);
        record("matter document type", matterDocNeighbour);
        await addListRow(admin, "Add type", "New type name", matterDoc);
        record("matter document type", matterDoc);
        await renameRow(admin, matterDoc, matterDocRenamed);
        let moved = "only one row, no reorder";
        if ((await admin.getByRole("button", { name: /^Reorder / }).count()) > 1) {
          const { before: b, after: a } = await moveUp(admin, matterDocRenamed);
          moved = `ArrowUp moved it from position ${b} to ${a} (above this run's ${matterDocNeighbour}), kept after reload`;
        }
        if (!S.docMatter) {
          const mts = (await api(admin, "GET", "/api/v1/matter-types")).body?.matterTypes ?? [];
          const m = await api(admin, "POST", "/api/v1/matters", {
            title: name(SC, "Document types matter"),
            matterTypeId: mts.find((t) => t.displayName === "Default").id,
          });
          S.docMatter = m.body?.matter?.number;
          record("matter", name(SC, "Document types matter"), { number: S.docMatter });
        }
        const upload = await uploadTypeChoices(admin, `/matters/${S.docMatter}/documents`);
        expectThat(
          upload && upload.includes(matterDocRenamed),
          `Matter upload Type choices ${q(upload)}`,
        );
        return `Settings > Organization > Documents shows the lists ${q(tabs)}; Knowledge has none. The Matters list held ${before.length} rows before this run (${q(before)}), made by other agents on this shared lab, so "starts empty" cannot be seen here. Add type + Save added ${q(matterDoc)}; Rename changed it to ${q(matterDocRenamed)}; ${moved}. A Matter's Upload dialog now shows a Type choice ${q(upload)}.`;
      },
    );

    await step(
      SC,
      role,
      "Add Document types, step 5: select the row's colour swatch (Colour for <name>), choose a colour; the choice saves immediately; Automatic returns the default",
      "The swatch named Colour for <type> opens Grey, Blue, Amber, Green, Red, Orange, Purple and Automatic; choosing Purple saves without another control and survives a reload; Automatic sets it back.",
      async () => {
        await admin.goto(`${BASE}/settings/documents/matters`);
        await admin.getByRole("heading", { name: "Document types" }).waitFor();
        const swatch = admin.getByRole("button", {
          name: `Colour for ${matterDocRenamed}`,
          exact: true,
        });
        const titleBefore = await swatch.getAttribute("title");
        await swatch.click();
        const pop = admin.getByRole("dialog", { name: `Colour for ${matterDocRenamed}` });
        await pop.waitFor();
        const options = (await pop.getByRole("button").allInnerTexts()).map(flat);
        const patch = admin.waitForResponse(
          (r) => r.request().method() === "PATCH" && /\/documents\/types\/matter\//.test(r.url()),
        );
        await pop.getByRole("button", { name: "Purple", exact: true }).click();
        const saved = (await patch).status();
        await pop.waitFor({ state: "hidden" });
        await admin.reload();
        await swatch.waitFor();
        const titleAfter = await swatch.getAttribute("title");
        const rows = (await api(admin, "GET", "/api/v1/documents/types/matter")).body;
        const stored = (rows?.documentTypes ?? []).find((t) => t.displayName === matterDocRenamed);
        await swatch.click();
        await pop.waitFor();
        const pressed = await pop
          .getByRole("button", { name: "Purple", exact: true })
          .getAttribute("aria-pressed");
        await pop.getByRole("button", { name: "Automatic", exact: true }).click();
        await pop.waitFor({ state: "hidden" });
        await pause(800);
        const back = (
          (await api(admin, "GET", "/api/v1/documents/types/matter")).body?.documentTypes ?? []
        ).find((t) => t.displayName === matterDocRenamed);
        expectThat(
          q(options) ===
            q(["Automatic", "Grey", "Blue", "Amber", "Green", "Red", "Orange", "Purple"]) &&
            saved === 200 &&
            stored?.color === "purple" &&
            titleAfter === `Colour for ${matterDocRenamed}: Purple` &&
            pressed === "true" &&
            back?.color === null,
          q({
            options,
            saved,
            stored: stored?.color,
            titleBefore,
            titleAfter,
            pressed,
            back: back?.color,
          }),
        );
        return `The row's swatch "Colour for ${matterDocRenamed}" (title ${q(titleBefore)}) opened a panel with ${q(options)}. Choosing Purple saved at once (PATCH ${saved}) with no Save control; after a reload the swatch title read ${q(titleAfter)} and Purple was pressed. Choosing Automatic set it back (stored colour ${q(back?.color)}).`;
      },
    );

    await step(
      SC,
      role,
      "Contracts tab: seven fixed types, in order, each with a lock and no rename or archive control; a fixed type's colour can still be changed",
      'Draft · ours, Draft · theirs, Redline · theirs, Redline · ours, Partially signed, Executed and Amendment, in that order, each show the lock "<name> has a fixed name. Its colour can be changed." and no Rename or Archive; each has a Colour for <name> swatch.',
      async () => {
        await admin.goto(`${BASE}/settings/documents/matters`);
        await pane(admin, "Document type lists", "Contracts");
        await admin.getByRole("heading", { name: "Document types" }).waitFor();
        await admin
          .getByRole("button", { name: /^Reorder / })
          .first()
          .waitFor();
        const fixed = [
          "Draft · ours",
          "Draft · theirs",
          "Redline · theirs",
          "Redline · ours",
          "Partially signed",
          "Executed",
          "Amendment",
        ];
        const order = (
          await admin
            .getByRole("button", { name: /^Reorder / })
            .evaluateAll((bs) => bs.map((b) => b.getAttribute("aria-label")))
        ).map((l) => l.match(/^Reorder (.*), position \d+ of \d+/)[1]);
        const fixedOrder = order.filter((n) => fixed.includes(n));
        const out = [];
        for (const f of fixed) {
          const lock = await admin
            .getByRole("img", { name: `${f} has a fixed name. Its colour can be changed.` })
            .count();
          const rename = await admin
            .getByRole("button", { name: `Rename ${f}`, exact: true })
            .count();
          const archive = await admin
            .getByRole("button", { name: `Archive ${f}`, exact: true })
            .count();
          const colour = await admin
            .getByRole("button", { name: `Colour for ${f}`, exact: true })
            .count();
          expectThat(
            lock === 1 && rename === 0 && archive === 0 && colour === 1,
            `${f}: lock ${lock}, rename ${rename}, archive ${archive}, colour ${colour}`,
          );
          out.push(f);
        }
        // Read-only on the seeded fixed type: open its swatch, read it, close with Escape.
        const before = (
          (await api(admin, "GET", "/api/v1/documents/types/contract")).body?.documentTypes ?? []
        ).find((t) => t.displayName === "Partially signed");
        const swatch = admin.getByRole("button", {
          name: "Colour for Partially signed",
          exact: true,
        });
        const title = await swatch.getAttribute("title");
        await swatch.click();
        const pop = admin.getByRole("dialog", { name: "Colour for Partially signed" });
        await pop.waitFor();
        const choices = (await pop.getByRole("button").allInnerTexts()).map(flat);
        const enabled = await pop.getByRole("button", { name: "Purple", exact: true }).isEnabled();
        await admin.keyboard.press("Escape");
        await pop.waitFor({ state: "hidden" });
        const after = (
          (await api(admin, "GET", "/api/v1/documents/types/contract")).body?.documentTypes ?? []
        ).find((t) => t.displayName === "Partially signed");
        const others = order.filter((n) => !fixed.includes(n));
        expectThat(
          q(fixedOrder) === q(fixed) &&
            choices.length === 8 &&
            enabled &&
            before?.color === after?.color,
          q({ order, fixedOrder, choices, enabled, before: before?.color, after: after?.color }),
        );
        return `The Contracts list shows the fixed types in the order ${q(fixedOrder)}, each with the image "<name> has a fixed name. Its colour can be changed.", a "Colour for <name>" swatch, and no Rename or Archive control. On Partially signed (title ${q(title)}) the swatch opened ${q(choices)} with the choices enabled; Escape closed it without a change (stored colour ${q(before?.color)} before and ${q(after?.color)} after). Other rows present, added by other agents: ${q(others)}.`;
      },
    );

    await step(
      SC,
      role,
      "Entities tab: upload dialogs show a type choice only when the module's list holds a live type; archive asks for no replacement; Show archived and Restore",
      "With no live Entity Document type, an Entity upload has no Type choice; after Add type it has one; Archive names the version count without a replacement choice; the archived type leaves the upload choices; Restore brings it back.",
      async () => {
        const entities = (await api(admin, "GET", "/api/v1/entities")).body;
        const entity = (entities?.entities ?? entities?.items ?? entities ?? [])[0];
        expectThat(entity?.id, "no entity to upload to");
        const entityPath = `/entities/${entity.id}/documents`;
        await admin.goto(`${BASE}/settings/documents/entities`);
        await admin.getByRole("heading", { name: "Document types" }).waitFor();
        await pause(800);
        const live = (await admin.getByRole("button", { name: /^Rename / }).allInnerTexts()).map(
          flat,
        );
        const before =
          live.length === 0 ? await uploadTypeChoices(admin, entityPath) : "(list not empty)";
        const entDoc = name(SC, "Entity certificate");
        await admin.goto(`${BASE}/settings/documents/entities`);
        await addListRow(admin, "Add type", "New type name", entDoc);
        record("entity document type", entDoc);
        const withType = await uploadTypeChoices(admin, entityPath);
        await admin.goto(`${BASE}/settings/documents/entities`);
        await admin.getByRole("button", { name: `Archive ${entDoc}`, exact: true }).click();
        const d = admin.getByRole("dialog");
        await d.waitFor();
        const text = flat(await d.innerText());
        const selects = await d.getByRole("combobox").count();
        await d
          .getByRole("button", { name: /^Archive/ })
          .last()
          .click();
        await d.waitFor({ state: "hidden" });
        const afterArchive = await uploadTypeChoices(admin, entityPath);
        await admin.goto(`${BASE}/settings/documents/entities`);
        await admin.getByRole("switch", { name: "Show archived" }).click();
        await admin.getByRole("button", { name: `Restore ${entDoc}`, exact: true }).click();
        await admin
          .getByRole("button", { name: `Archive ${entDoc}`, exact: true })
          .waitFor({ timeout: 15000 });
        const restored = await uploadTypeChoices(admin, entityPath);
        // Leave the Entities list as found: archive the type again.
        await admin.goto(`${BASE}/settings/documents/entities`);
        await admin.getByRole("button", { name: `Archive ${entDoc}`, exact: true }).click();
        await admin
          .getByRole("dialog")
          .getByRole("button", { name: /^Archive/ })
          .last()
          .click();
        await admin.getByRole("dialog").waitFor({ state: "hidden" });
        expectThat(
          live.length > 0 || before === null,
          `Entity upload with an empty list offered ${q(before)}`,
        );
        expectThat(withType?.includes(entDoc), `upload after Add type ${q(withType)}`);
        expectThat(selects === 0, "archive dialog asks for a replacement");
        expectThat(
          !(afterArchive ?? []).includes(entDoc),
          `archived type still offered ${q(afterArchive)}`,
        );
        expectThat(restored?.includes(entDoc), `restored type not offered ${q(restored)}`);
        return `The Entities list held ${q(live)} live rows. On Entity ${q(entity.legalName ?? entity.name)} the Upload dialog showed ${before === null ? "no Type choice" : q(before)}. After Add type ${q(entDoc)} it showed Type ${q(withType)}. Archive read ${q(text)} with ${selects} choice controls; afterwards the Upload dialog showed ${afterArchive === null ? "no Type choice" : q(afterArchive)}. Show archived + Restore brought it back (${q(restored)}). The type was archived again to leave the list as found.`;
      },
    );
  }

  // =====================================================================
  // V-C38 types-statuses-fields: Statuses
  // =====================================================================
  async function statusesSection(admin) {
    const SC = "V-C38";
    const role = "administrator";
    const A = PEOPLE.administrator;
    currentPage = admin;
    const cStatus = name(SC, "Contract status");
    const cRenamed = name(SC, "Contract status renamed");
    const cNeighbour = name(SC, "Contract status neighbour");
    const sigStatus = name(SC, "Signature status");
    const mStatus = name(SC, "Matter status");
    const mWaiting = name(SC, "Matter status waiting");
    const mClosed = name(SC, "Matter status closed");

    await step(
      SC,
      role,
      "Configure Statuses, Contract: Contracts > Statuses; Add status, name, Stage; Cancel discards; Save status; rename and reorder; no control changes the Stage",
      "The new row reads its Stage; the row has no Stage control; rename and reorder persist; Draft, Partially signed, Active and Expired are protected.",
      async () => {
        await openSettings(admin, A, "Contracts");
        await pane(admin, "Contracts panes", "Statuses");
        await admin.getByRole("heading", { name: "Contract statuses" }).waitFor();
        await admin.getByRole("button", { name: "Add status", exact: true }).click();
        await admin
          .getByRole("textbox", { name: "New status name" })
          .fill(name(SC, "Cancelled status"));
        const stages = (
          await admin
            .getByRole("combobox", { name: "New status stage" })
            .locator("option")
            .allInnerTexts()
        ).map(flat);
        await admin.getByRole("button", { name: "Cancel", exact: true }).click();
        await admin.getByRole("button", { name: "Add status", exact: true }).click();
        await admin.getByRole("textbox", { name: "New status name" }).fill(cNeighbour);
        await admin
          .getByRole("combobox", { name: "New status stage" })
          .selectOption({ label: "Review" });
        await admin.getByRole("button", { name: "Save status", exact: true }).click();
        await admin
          .getByRole("button", { name: `Rename ${cNeighbour}`, exact: true })
          .waitFor({ timeout: 15000 });
        record("contract status", cNeighbour);
        await admin.getByRole("button", { name: "Add status", exact: true }).click();
        await admin.getByRole("textbox", { name: "New status name" }).fill(cStatus);
        await admin
          .getByRole("combobox", { name: "New status stage" })
          .selectOption({ label: "Review" });
        await admin.getByRole("button", { name: "Save status", exact: true }).click();
        await admin
          .getByRole("button", { name: `Rename ${cStatus}`, exact: true })
          .waitFor({ timeout: 15000 });
        record("contract status", cStatus);
        await renameRow(admin, cStatus, cRenamed);
        const r = row(admin, cRenamed);
        const rowText = flat(await r.innerText());
        const rowControls =
          (await r.getByRole("combobox").count()) + (await r.getByRole("radio").count());
        const { before, after } = await moveUp(admin, cRenamed);
        const cancelled = await admin
          .getByRole("button", { name: `Rename ${name(SC, "Cancelled status")}`, exact: true })
          .count();
        const locks = [];
        for (const n of ["Draft", "Partially signed", "Active", "Expired"])
          locks.push(
            await admin
              .getByRole("img", { name: `${n} is system-protected and can't be archived` })
              .count(),
          );
        expectThat(
          /Stage: Review/.test(rowText) && rowControls === 0,
          `row ${rowText}, controls ${rowControls}`,
        );
        expectThat(
          cancelled === 0 && locks.every((l) => l === 1),
          `cancelled ${cancelled}, locks ${locks}`,
        );
        return `Contracts > Statuses: Add status offered Stage choices ${q(stages)}. Cancel left no row. Save status added the row; after Rename it reads ${q(rowText)} with ${rowControls} Stage controls. ArrowUp moved it from ${before} to ${after} (above this run's ${q(cNeighbour)}) after reload. Draft, Partially signed, Active and Expired show "<name> is system-protected and can't be archived".`;
      },
    );

    await step(
      SC,
      role,
      "Contract Status archive: the dialog for an in-use Status asks you to move Contracts yourself and does not reassign; an unused custom Status archives",
      "In-use: the dialog says to move the Contracts first and has no replacement choice. Unused: Archive status removes it.",
      async () => {
        await admin.getByRole("button", { name: "Archive Terminated", exact: true }).click();
        let d = admin.getByRole("dialog");
        await d.waitFor();
        const inUse = flat(await d.innerText());
        const choices = await d.getByRole("combobox").count();
        const canArchive = await d
          .getByRole("button", { name: "Archive status" })
          .isEnabled()
          .catch(() => false);
        await d.getByRole("button", { name: "Cancel" }).click();
        await admin.getByRole("button", { name: `Archive ${cRenamed}`, exact: true }).click();
        d = admin.getByRole("dialog");
        const unused = flat(await d.innerText());
        await d.getByRole("button", { name: "Archive status" }).click();
        await d.waitFor({ state: "hidden" });
        const gone = await admin
          .getByRole("button", { name: `Rename ${cRenamed}`, exact: true })
          .count();
        expectThat(
          choices === 0 && /Move/.test(inUse) && !canArchive,
          `in-use dialog ${inUse}, choices ${choices}, archive enabled ${canArchive}`,
        );
        expectThat(gone === 0, "status still listed");
        return `Archive Terminated (seeded, in use) read ${q(inUse)} with ${choices} replacement controls and Archive status enabled=${canArchive}; Cancel closed it. Archive on the unused ${q(cRenamed)} read ${q(unused)}; Archive status removed it from the live list.`;
      },
    );

    await step(
      SC,
      role,
      "Contract Status archive in the Signature Stage: an ordinary fixture Status archives while the Stage keeps other live Statuses; Partially signed is protected and does not count for the Stage (author's product-bug report)",
      "A fixture Signature Status archives with Archive status; Partially signed shows the protected lock; the author's bug (last other Signature Status) is not reproduced because it needs seeded Statuses archived.",
      async () => {
        await admin.goto(`${BASE}/settings/contracts/statuses`);
        await admin.getByRole("heading", { name: "Contract statuses" }).waitFor();
        await admin.getByRole("button", { name: "Add status", exact: true }).click();
        await admin.getByRole("textbox", { name: "New status name" }).fill(sigStatus);
        await admin
          .getByRole("combobox", { name: "New status stage" })
          .selectOption({ label: "Signature" });
        await admin.getByRole("button", { name: "Save status", exact: true }).click();
        await admin
          .getByRole("button", { name: `Rename ${sigStatus}`, exact: true })
          .waitFor({ timeout: 15000 });
        record("contract status", sigStatus);
        const rowText = flat(await row(admin, sigStatus).innerText());
        const psArchive = await admin
          .getByRole("button", { name: "Archive Partially signed", exact: true })
          .count();
        const psLock = await admin
          .getByRole("img", { name: "Partially signed is system-protected and can't be archived" })
          .count();
        const live = (
          (await api(admin, "GET", "/api/v1/contract-statuses")).body?.contractStatuses ?? []
        )
          .filter((x) => x.stage === "signature")
          .map((x) => x.displayName);
        await admin.getByRole("button", { name: `Archive ${sigStatus}`, exact: true }).click();
        const d = admin.getByRole("dialog");
        await d.waitFor();
        const text = flat(await d.innerText());
        await d.getByRole("button", { name: "Archive status" }).click();
        await d.waitFor({ state: "hidden" });
        const gone = await admin
          .getByRole("button", { name: `Rename ${sigStatus}`, exact: true })
          .count();
        expectThat(
          /Stage: Signature/.test(rowText) && psArchive === 0 && psLock === 1 && gone === 0,
          q({ rowText, psArchive, psLock, gone, live }),
        );
        await ctx.record({
          what: "Author's product bug (Signature Stage floor): not reproduced",
          observed: `Live Signature Statuses before the fixture was archived: ${q(live)}.`,
          reason:
            "Reproducing needs Partially signed plus one other live Signature Status. On the shared work lab that means archiving the seeded Out for signature and Signed, awaiting countersignature, which other guides rely on, so the bug was neither confirmed nor refuted here.",
        });
        return `Add status with Stage Signature saved ${q(sigStatus)} (row ${q(rowText)}). The Signature Stage then held ${q(live)}. Partially signed shows the lock "Partially signed is system-protected and can't be archived" and no Archive control. Archive on the fixture read ${q(text)}; Archive status removed it, leaving the seeded Signature Statuses live. The author's bug (the archive dialog for the last other Signature Status shows no warning but the API refuses) was not reproduced: it needs the two seeded Signature Statuses archived.`;
      },
    );

    await step(
      SC,
      role,
      "Configure Statuses, Matter: Matters > Statuses; Add status in the Open Category with the default group (In progress) and one in Waiting; a Closed Category Status; change a group on its row",
      "New Open-Category Status defaults to In progress; the row group control changes and persists; Category is fixed; Open and Closed are protected.",
      async () => {
        await openSettings(admin, A, "Matters");
        await pane(admin, "Matters panes", "Statuses");
        await admin.getByRole("heading", { name: "Matter statuses" }).waitFor();
        await admin.getByRole("button", { name: "Add status", exact: true }).click();
        await admin.getByRole("textbox", { name: "New status name" }).fill(mStatus);
        const cats = (
          await admin
            .getByRole("combobox", { name: "New status category" })
            .locator("option")
            .allInnerTexts()
        ).map(flat);
        await admin
          .getByRole("combobox", { name: "New status category" })
          .selectOption({ label: "Open" });
        const groupDefault = await admin
          .getByRole("combobox", { name: "New status group" })
          .evaluate((e) => e.selectedOptions[0].textContent);
        await admin.getByRole("button", { name: "Save status", exact: true }).click();
        await admin
          .getByRole("button", { name: `Rename ${mStatus}`, exact: true })
          .waitFor({ timeout: 15000 });
        await admin.getByRole("button", { name: "Add status", exact: true }).click();
        await admin.getByRole("textbox", { name: "New status name" }).fill(mWaiting);
        await admin
          .getByRole("combobox", { name: "New status category" })
          .selectOption({ label: "Open" });
        await admin
          .getByRole("combobox", { name: "New status group" })
          .selectOption({ label: "Waiting" });
        await admin.getByRole("button", { name: "Save status", exact: true }).click();
        await admin
          .getByRole("button", { name: `Rename ${mWaiting}`, exact: true })
          .waitFor({ timeout: 15000 });
        await admin.getByRole("button", { name: "Add status", exact: true }).click();
        await admin.getByRole("textbox", { name: "New status name" }).fill(mClosed);
        await admin
          .getByRole("combobox", { name: "New status category" })
          .selectOption({ label: "Closed" });
        const closedGroup = await admin.getByRole("combobox", { name: "New status group" }).count();
        await admin.getByRole("button", { name: "Save status", exact: true }).click();
        await admin
          .getByRole("button", { name: `Rename ${mClosed}`, exact: true })
          .waitFor({ timeout: 15000 });
        for (const n of [mStatus, mWaiting, mClosed]) record("matter status", n);
        const group = admin.getByRole("combobox", { name: `Group for ${mStatus}` });
        const saved = await group.evaluate((e) => e.selectedOptions[0].textContent);
        await group.selectOption({ label: "Open" });
        await pause(1500);
        await admin.reload();
        const reloaded = await admin
          .getByRole("combobox", { name: `Group for ${mStatus}` })
          .evaluate((e) => e.selectedOptions[0].textContent);
        const waitingGroup = await admin
          .getByRole("combobox", { name: `Group for ${mWaiting}` })
          .evaluate((e) => e.selectedOptions[0].textContent);
        const closedRow = flat(await row(admin, mClosed).innerText());
        const closedRowGroup = await row(admin, mClosed).getByRole("combobox").count();
        const locks = [];
        for (const n of ["Open", "Closed"])
          locks.push(
            await admin
              .getByRole("img", { name: `${n} is system-protected and can't be archived` })
              .count(),
          );
        expectThat(
          groupDefault === "In progress" &&
            saved === "In progress" &&
            reloaded === "Open" &&
            waitingGroup === "Waiting",
          `groups ${groupDefault} ${saved} ${reloaded} ${waitingGroup}`,
        );
        expectThat(
          closedRowGroup === 0 && /Category: Closed/.test(closedRow),
          `closed row ${closedRow}`,
        );
        expectThat(
          locks.every((l) => l === 1),
          `locks ${locks}`,
        );
        return `Matters > Statuses: Add status offered Categories ${q(cats)}; with Open the group control defaulted to ${q(groupDefault)}. Save status added ${q(mStatus)} (row group ${q(saved)}) and ${q(mWaiting)} (row group ${q(waitingGroup)}). With Closed the add row showed ${closedGroup} group controls; ${q(mClosed)} reads ${q(closedRow)} with no group control. Changing ${q(mStatus)}'s row group to Open saved and read ${q(reloaded)} after reload. Open and Closed show the protected lock.`;
      },
    );

    await step(
      SC,
      role,
      "Matter Status archive: for an in-use custom Status, choose a replacement in the same Category",
      "The dialog offers only Open-Category Statuses; after Archive status the Matter moves to the replacement.",
      async () => {
        const statuses = (await api(admin, "GET", "/api/v1/matter-statuses")).body;
        const list = statuses?.statuses ?? statuses?.matterStatuses ?? statuses ?? [];
        const mine = list.find((s) => s.displayName === mStatus);
        const mts = (await api(admin, "GET", "/api/v1/matter-types")).body;
        const defaultType = (mts?.matterTypes ?? []).find((t) => t.displayName === "Default");
        const m = await api(admin, "POST", "/api/v1/matters", {
          title: name(SC, "Status matter"),
          matterTypeId: defaultType.id,
        });
        const number = m.body?.matter?.number ?? m.body?.number;
        expectThat(number, `fixture matter ${m.status} ${q(m.body)}`);
        record("matter", name(SC, "Status matter"), { number });
        const p = await api(admin, "PATCH", `/api/v1/matters/${number}`, { statusId: mine.id });
        expectThat(p.status < 300, `status fixture ${p.status} ${q(p.body)}`);
        await admin.reload();
        await admin.getByRole("button", { name: `Archive ${mStatus}`, exact: true }).click();
        const d = admin.getByRole("dialog");
        await d.waitFor();
        const text = flat(await d.innerText());
        const opts = (await d.getByRole("combobox").locator("option").allInnerTexts()).map(flat);
        const closedOffered = opts.includes("Closed") || opts.includes(mClosed);
        await d.getByRole("combobox").selectOption({ label: mWaiting });
        await d.getByRole("button", { name: "Archive status" }).click();
        await d.waitFor({ state: "hidden", timeout: 15000 });
        const after = (await api(admin, "GET", `/api/v1/matters/${number}`)).body?.matter
          ?.statusName;
        expectThat(
          !closedOffered && after === mWaiting,
          `closed offered ${closedOffered}; status after ${after}`,
        );
        return `M-${number} (API fixture) was set to ${q(mStatus)}. Its Archive dialog read ${q(text.slice(0, 200))} and offered ${q(opts)} (no Closed-Category Status). With ${q(mWaiting)} chosen, Archive status moved M-${number} to ${q(after)}.`;
      },
    );

    await step(
      SC,
      role,
      "Negative check (API): a Stage or Category change on an existing Status is refused",
      "Neither page has a Stage or Category control, so the API is asked: a rename body carrying stage or category is refused.",
      async () => {
        const cs = (await api(admin, "GET", "/api/v1/contract-statuses?includeArchived=true")).body;
        const clist = cs?.statuses ?? cs?.contractStatuses ?? cs ?? [];
        const c =
          clist.find((s) => s.displayName === cRenamed) ??
          clist.find((s) => s.displayName === "Terminated");
        const ms = (await api(admin, "GET", "/api/v1/matter-statuses")).body;
        const mlist = ms?.statuses ?? ms?.matterStatuses ?? ms ?? [];
        const mm = mlist.find((s) => s.displayName === mWaiting);
        const cr = await api(admin, "PATCH", `/api/v1/contract-statuses/${c.id}`, {
          displayName: c.displayName,
          stage: "ended",
        });
        const mr = await api(admin, "PATCH", `/api/v1/matter-statuses/${mm.id}`, {
          displayName: mm.displayName,
          category: "closed",
        });
        const cAfter = (
          (await api(admin, "GET", "/api/v1/contract-statuses?includeArchived=true")).body
            ?.contractStatuses ?? []
        ).find((s) => s.id === c.id);
        expectThat(cr.status === 400 && mr.status === 400, `answers ${cr.status} ${mr.status}`);
        return `As the Administrator, PATCH /api/v1/contract-statuses/{${q(c.displayName)}} with stage "ended" answered ${cr.status} ${q(cr.body?.detail ?? cr.body?.message)}; the Status keeps Stage ${q(cAfter?.stage ?? c.stage)}. PATCH /api/v1/matter-statuses/{${q(mm.displayName)}} with category "closed" answered ${mr.status} ${q(mr.body?.detail ?? mr.body?.message)}.`;
      },
      "api-refusal",
    );
  }

  // =====================================================================
  // V-C38 types-statuses-fields: Fields
  // =====================================================================
  async function fieldsSection(admin) {
    const SC = "V-C38";
    const role = "administrator";
    const A = PEOPLE.administrator;
    currentPage = admin;

    await step(
      SC,
      role,
      "Create a Field, first paragraphs: Matter and Contract Fields show a collapsed Default Fields card of locked read-only rows above an expanded Custom Fields card; Governing law, Jurisdiction and Our position show a lock in place of archive",
      "Default Fields starts collapsed and expands on its heading into locked rows with no controls; Custom Fields starts expanded with Add field; the three default catalog Fields have a lock and no Archive.",
      async () => {
        const out = [];
        for (const [link, paneNav] of [
          ["Matters", "Matters panes"],
          ["Contracts", "Contracts panes"],
        ]) {
          await openSettings(admin, A, link);
          await pane(admin, paneNav, "Fields");
          const defaults = admin.getByRole("region", { name: "Default Fields" });
          const custom = admin.getByRole("region", { name: "Custom Fields" });
          await defaults.waitFor({ timeout: 15000 });
          const toggle = defaults.getByRole("button", { name: "Default Fields" });
          const start = await toggle.getAttribute("aria-expanded");
          const customStart = await custom
            .getByRole("button", { name: "Custom Fields" })
            .getAttribute("aria-expanded");
          const addField = await custom.getByRole("button", { name: "Add field" }).count();
          await toggle.click();
          await until(
            async () => (await toggle.getAttribute("aria-expanded")) === "true",
            "Default Fields did not expand",
          );
          const rows = (await defaults.getByRole("listitem").allInnerTexts()).map(flat);
          const locks = await defaults
            .getByRole("img", { name: /: built-in field, read-only here$/ })
            .count();
          const buttons = await defaults.getByRole("list").getByRole("button").count();
          expectThat(
            start === "false" && customStart === "true" && addField === 1,
            `${link}: default ${start}, custom ${customStart}, add ${addField}`,
          );
          expectThat(
            rows.length > 0 && locks === rows.length && buttons === 0,
            `${link}: rows ${rows.length}, locks ${locks}, buttons ${buttons}`,
          );
          let defaultsNote = "";
          if (link === "Contracts") {
            const notes = [];
            for (const f of ["Governing law", "Jurisdiction", "Our position"]) {
              const lock = await custom
                .getByRole("img", { name: `${f} is a default Field and can't be archived` })
                .count();
              const archive = await custom
                .getByRole("button", { name: `Archive ${f}`, exact: true })
                .count();
              const rename = await custom
                .getByRole("button", { name: `Rename ${f}`, exact: true })
                .count();
              expectThat(
                lock === 1 && archive === 0 && rename === 1,
                `${f}: lock ${lock}, archive ${archive}, rename ${rename}`,
              );
              notes.push(f);
            }
            const api1 = await api(admin, "GET", "/api/v1/fields");
            const gl = (api1.body?.fields ?? []).find((f) => f.displayName === "Governing law");
            const refused = gl
              ? await api(admin, "POST", `/api/v1/fields/${gl.id}/archive`, {})
              : { status: "n/a" };
            defaultsNote = ` Custom Fields lists ${q(notes)} with Rename and the image "<name> is a default Field and can't be archived" in place of Archive; the API refuses the archive of Governing law with ${refused.status} ${q(refused.body?.detail ?? "")}.`;
          }
          out.push(
            `${link} > Fields: Default Fields aria-expanded=${start}, Custom Fields aria-expanded=${customStart} with Add field. Expanded, Default Fields lists ${rows.length} rows (${q(rows.slice(0, 4))}…), each with a "<name>: built-in field, read-only here" lock and no buttons.${defaultsNote}`,
          );
        }
        return out.join(" ");
      },
    );

    await step(
      SC,
      role,
      "Create a Field, steps 1-5: Matters > Fields > Add field with Name, Description, Type and Options; the type cannot change after creation; Boolean has no Yes/No control at creation; no reorder handles",
      "The Type list matches the guide; Options take one per line; the row shows the new Field; Edit has no Type control; the catalog has no reorder handles.",
      async () => {
        await openSettings(admin, A, "Matters");
        await pane(admin, "Matters panes", "Fields");
        const custom = admin.getByRole("region", { name: "Custom Fields" });
        await custom.getByRole("button", { name: "Add field" }).click();
        const d = admin.getByRole("dialog", { name: "Add field" });
        const types = (await d.getByLabel("Type").locator("option").allInnerTexts())
          .map(flat)
          .filter((t) => t !== "Type…");
        const expected = [
          "Text",
          "Long text",
          "Number",
          "Currency",
          "Date",
          "Boolean",
          "Single select",
          "Multi select",
          "User",
          "Entity",
        ];
        expectThat(q(types) === q(expected), `Type list ${q(types)}`);
        S.matterSelectField = name(SC, "Assessment scope");
        await d.getByLabel("Name").fill(S.matterSelectField);
        await d.getByLabel("Description").fill("Which part of the supplier the assessment covers.");
        await d.getByLabel("Type").selectOption({ label: "Single select" });
        await d.getByLabel("Options").fill("Security\nPrivacy\nFinance");
        const aiPrompt = await d.getByLabel("AI prompt").count();
        await d.getByRole("button", { name: "Add field" }).click();
        await d.waitFor({ state: "hidden" });
        await admin
          .getByRole("button", { name: `Rename ${S.matterSelectField}`, exact: true })
          .waitFor();
        record("matter field", S.matterSelectField);
        const rowText = flat(await row(admin, S.matterSelectField).innerText());
        S.matterBoolField = name(SC, "Assessment signed off");
        await custom.getByRole("button", { name: "Add field" }).click();
        await d.getByLabel("Name").fill(S.matterBoolField);
        await d.getByLabel("Type").selectOption({ label: "Boolean" });
        const boolControls =
          (await d.getByRole("radio").count()) +
          (await d.getByRole("switch").count()) +
          (await d.getByRole("checkbox").count());
        await d.getByRole("button", { name: "Add field" }).click();
        await d.waitFor({ state: "hidden" });
        await admin
          .getByRole("button", { name: `Rename ${S.matterBoolField}`, exact: true })
          .waitFor();
        record("matter field", S.matterBoolField);
        const handles = await custom.getByRole("button", { name: /^Reorder / }).count();
        await admin
          .getByRole("button", { name: `Edit ${S.matterSelectField}`, exact: true })
          .click();
        const e = admin.getByRole("dialog", { name: `Edit ${S.matterSelectField}` });
        const typeCombo = await e.getByRole("combobox", { name: "Type" }).count();
        const immutable = await e.getByText("The field type is immutable after creation.").count();
        const options = await e.getByLabel("Options").inputValue();
        await e.getByRole("button", { name: "Cancel" }).click();
        expectThat(typeCombo === 0 && immutable > 0, `Edit type combo ${typeCombo}`);
        expectThat(
          handles === 0 && boolControls === 0 && aiPrompt === 0,
          `handles ${handles}, bool controls ${boolControls}, ai ${aiPrompt}`,
        );
        return `Add field offered Types ${q(types)}. ${q(S.matterSelectField)} (Single select, Options "Security/Privacy/Finance") saved as row ${q(rowText)}; a Matter Field has no AI prompt. The Boolean Field ${q(S.matterBoolField)} was created with ${boolControls} Yes/No controls in the dialog. Custom Fields shows ${handles} reorder handles. Edit shows no Type control and reads "The field type is immutable after creation."; Options read ${q(options)}.`;
      },
    );

    await step(
      SC,
      role,
      "Contract Fields: AI prompt on Contract Fields other than User and Entity; a Text or Long text Field has Answer style with Organisation default",
      "Text shows AI prompt and Answer style with Organisation default; User and Entity show no AI prompt; Number shows AI prompt without Answer style.",
      async () => {
        await openSettings(admin, A, "Contracts");
        await pane(admin, "Contracts panes", "Fields");
        const custom = admin.getByRole("region", { name: "Custom Fields" });
        await custom.getByRole("button", { name: "Add field" }).click();
        const d = admin.getByRole("dialog", { name: "Add field" });
        const seen = {};
        for (const t of ["Text", "Long text", "Number", "User", "Entity"]) {
          await d.getByLabel("Type").selectOption({ label: t });
          await pause(300);
          const style = d.getByRole("combobox", { name: "Answer style" });
          seen[t] = {
            aiPrompt: await d.getByLabel("AI prompt").count(),
            answerStyle: (await style.count())
              ? (await style.locator("option").allInnerTexts()).map(flat)
              : null,
          };
        }
        S.contractTextField = name(SC, "Supplier tier");
        await d.getByLabel("Name").fill(S.contractTextField);
        await d.getByLabel("Type").selectOption({ label: "Text" });
        await d.getByRole("button", { name: "Add field" }).click();
        await d.waitFor({ state: "hidden" });
        await admin
          .getByRole("button", { name: `Rename ${S.contractTextField}`, exact: true })
          .waitFor();
        record("contract field", S.contractTextField);
        expectThat(
          seen.Text.aiPrompt === 1 &&
            seen.Text.answerStyle?.some((o) => /^Organisation default/.test(o)),
          `Text ${q(seen.Text)}`,
        );
        expectThat(
          seen["Long text"].answerStyle &&
            seen.User.aiPrompt === 0 &&
            seen.Entity.aiPrompt === 0 &&
            !seen.Number.answerStyle,
          `seen ${q(seen)}`,
        );
        return `Contracts > Fields > Add field: ${Object.entries(seen)
          .map(
            ([t, v]) =>
              `${t}: AI prompt ${v.aiPrompt ? "shown" : "absent"}, Answer style ${v.answerStyle ? q(v.answerStyle) : "absent"}`,
          )
          .join(
            "; ",
          )}. The Text Field ${q(S.contractTextField)} was added with Organisation default kept.`;
      },
    );

    await step(
      SC,
      role,
      "Create a Field, step 1 for Entities: Entities > Fields > Add field",
      "An Entity Field can be added.",
      async () => {
        await openSettings(admin, A, "Entities");
        await pane(admin, "Entities panes", "Fields");
        await admin.getByRole("button", { name: "Add field" }).first().click();
        const d = admin.getByRole("dialog", { name: "Add field" });
        S.entityField = name(SC, "Registry code");
        await d.getByLabel("Name").fill(S.entityField);
        await d.getByLabel("Type").selectOption({ label: "Text" });
        await d.getByRole("button", { name: "Add field" }).click();
        await d.waitFor({ state: "hidden" });
        await admin.getByRole("button", { name: `Rename ${S.entityField}`, exact: true }).waitFor();
        record("entity field", S.entityField);
        const defaults = await admin.getByRole("region", { name: "Default Fields" }).count();
        return `Entities > Fields: Add field created ${q(S.entityField)}. The page shows ${defaults} Default Fields cards.`;
      },
    );
  }

  // =====================================================================
  // V-C38 types-statuses-fields: Form, Branch, records, Field archive
  // =====================================================================
  const formRow = (page, label) =>
    page.getByRole("region", { name: "Form" }).getByRole("group", { name: label, exact: true });
  async function switchState(page, rowLabel, sw) {
    const s = page.getByRole("switch", { name: `${rowLabel}: ${sw}`, exact: true });
    return {
      checked: (await s.getAttribute("aria-checked")) === "true",
      locked: (await s.getAttribute("aria-disabled")) === "true",
    };
  }
  async function touchpoint(page, rowLabel) {
    const t = flat(await formRow(page, rowLabel).innerText());
    return (t.match(/(Intake|Creation|Record)\s*$/) ??
      t.match(/\b(Intake|Creation|Record)\b(?!.*\b(Intake|Creation|Record)\b)/) ?? [null, null])[1];
  }
  async function flip(page, rowLabel, sw) {
    const before = await switchState(page, rowLabel, sw);
    await page.getByRole("switch", { name: `${rowLabel}: ${sw}`, exact: true }).click();
    await until(
      async () => (await switchState(page, rowLabel, sw)).checked !== before.checked,
      `${rowLabel}: ${sw} did not change`,
    );
    const saved = await until(
      async () =>
        (await formRow(page, rowLabel).getByText("Saved", { exact: true }).count()) > 0 ||
        (await page
          .getByRole("region", { name: "Form" })
          .getByText("Saved", { exact: true })
          .count()) > 0,
      `${rowLabel}: ${sw} showed no Saved`,
    ).catch(() => false);
    await pause(600);
    return !!saved;
  }

  async function formSection(admin) {
    const SC = "V-C38";
    const role = "administrator";
    const A = PEOPLE.administrator;
    currentPage = admin;
    const nda = name(SC, "Fixed-term NDA");
    const tier = name(SC, "Supplier tier form");
    const owner = name(SC, "Business contact");

    await step(
      SC,
      role,
      "Attach Fields, step 1: Types > Edit on the type > Form; Title and Type stay pinned; built-in Rows show Built-in and Visible on Portal Fixed",
      "The Form tab opens; Title and Type have a lock and disabled switches; built-in Rows show Fixed under Visible on Portal.",
      async () => {
        await openSettings(admin, A, "Contracts");
        await pane(admin, "Contracts panes", "Types");
        await addListRow(admin, "Add type", "New type name", nda);
        record("contract type", nda);
        await admin.getByRole("button", { name: `Edit ${nda}`, exact: true }).click();
        await admin
          .getByRole("navigation", { name: "Type sections" })
          .getByRole("link", { name: "Form" })
          .click();
        await admin.getByRole("region", { name: "Form" }).waitFor();
        S.ndaFormUrl = admin.url();
        S.ndaTypeId = S.ndaFormUrl.match(/types\/([^/]+)\/form/)[1];
        const header = flat(
          await admin.getByRole("region", { name: "Form" }).locator("header").innerText(),
        );
        const rows = await admin
          .getByRole("region", { name: "Form" })
          .getByRole("group")
          .evaluateAll((els) => els.map((e) => e.getAttribute("aria-label")));
        const title = flat(await formRow(admin, "Title").innerText());
        const titleSw = await switchState(admin, "Title", "Required for creation");
        const termType = flat(await formRow(admin, "Term type").innerText());
        expectThat(rows[0] === "Title" && rows[1] === "Type", `first rows ${q(rows.slice(0, 2))}`);
        expectThat(
          /Position and switches are fixed/.test(title) && titleSw.checked,
          `title ${title}`,
        );
        expectThat(/Built-in/.test(termType) && /Fixed/.test(termType), `term type ${termType}`);
        return `Added Contract type ${q(nda)}; Edit > Form opened ${new URL(S.ndaFormUrl).pathname}. The Form header reads ${q(header)}. Rows in order: ${q(rows)}. Title reads ${q(title)} (Required for creation on and locked); Term type reads ${q(termType)}.`;
      },
    );

    await step(
      SC,
      role,
      "Attach Fields, step 2: Attach Field lists the module's Fields alphabetically; Search fields filters; choose one",
      "The menu opens with a Search fields box; typing filters the list; choosing a Field adds its Row with Touchpoint Record.",
      async () => {
        // A Contract Text Field for this run, created in the catalog as a fixture.
        const f = await api(admin, "POST", "/api/v1/fields", {
          displayName: tier,
          moduleScope: "contract",
          fieldType: "text",
        });
        expectThat(f.status < 300, `field fixture ${f.status} ${q(f.body)}`);
        record("contract field", tier);
        await admin.goto(S.ndaFormUrl);
        await admin.getByRole("button", { name: "Attach Field" }).click();
        const menu = admin.getByRole("menu");
        await menu.waitFor();
        const search = menu.getByRole("textbox", { name: "Search fields" });
        const focused = await search.evaluate((e) => e === document.activeElement);
        const all = (await menu.locator("[data-field-option]").allInnerTexts()).map((t) =>
          flat(t.split("\n")[0]),
        );
        const sorted = [...all].sort((a, b) => a.localeCompare(b));
        await search.fill("Supplier tier form");
        await pause(300);
        const filtered = (await menu.locator("[data-field-option]").allInnerTexts()).map(flat);
        const last = flat(await menu.getByRole("menuitem").last().innerText());
        await menu.getByRole("menuitem", { name: new RegExp(`^${escapeRe(tier)}`) }).click();
        await formRow(admin, tier).waitFor({ timeout: 15000 });
        const tp = await touchpoint(admin, tier);
        expectThat(q(all) === q(sorted), "list is not alphabetical");
        expectThat(
          filtered.length >= 1 && filtered.every((t) => t.includes("Supplier tier form")),
          `filtered ${q(filtered)}`,
        );
        expectThat(tp === "Record", `touchpoint ${tp}`);
        return `Attach Field opened a menu with the Search fields box focused (${focused}), ${all.length} Contract Fields in alphabetical order, and ${q(last)} last. Typing "Supplier tier form" left ${q(filtered)}. Choosing it added the Row ${q(tier)} with Touchpoint ${tp}.`;
      },
    );

    await step(
      SC,
      role,
      "Attach Fields, step 2: Create Field opens a new Field definition without leaving the Form and attaches it",
      "The Add field dialog opens over the Form; after Add field the new Row is on the Form.",
      async () => {
        await admin.getByRole("button", { name: "Create Field", exact: true }).click();
        const d = admin.getByRole("dialog", { name: "Add field" });
        await d.waitFor();
        await d.getByLabel("Name").fill(owner);
        await d.getByLabel("Type").selectOption({ label: "User" });
        await d.getByRole("button", { name: "Add field" }).click();
        await d.waitFor({ state: "hidden", timeout: 15000 });
        await formRow(admin, owner).waitFor({ timeout: 15000 });
        record("contract field", owner);
        return `Create Field opened the "Add field" dialog while ${new URL(admin.url()).pathname} stayed open. The User Field ${q(owner)} was created and its Row attached (reads ${q(flat(await formRow(admin, owner).innerText()))}).`;
      },
    );

    await step(
      SC,
      role,
      "Attach Fields, step 3 and the switch table: each change saves (Saved); On intake form also turns on Visible on Portal and locks it; Touchpoint follows the switches; a User Row on intake cannot be required",
      "Touchpoint reads Intake, Creation or Record as the switches change; Visible on Portal is on and locked while On intake form is on; the User Row's Required switch refuses with a reason; changes survive reload.",
      async () => {
        const log = [];
        let saved = await flip(admin, tier, "On intake form");
        let vis = await switchState(admin, tier, "Visible on Portal");
        log.push(
          `On intake form on: Saved ${saved}, Visible on Portal checked ${vis.checked} locked ${vis.locked}, Touchpoint ${await touchpoint(admin, tier)}`,
        );
        expectThat(
          vis.checked && vis.locked && (await touchpoint(admin, tier)) === "Intake",
          log.at(-1),
        );
        const reason = flat(
          await admin
            .locator(`[id^="reason-"][id$="-visibleOnPortal"]`)
            .first()
            .textContent()
            .catch(() => ""),
        );
        saved = await flip(admin, tier, "Required for creation");
        log.push(
          `Required for creation on: Saved ${saved}, Touchpoint ${await touchpoint(admin, tier)}`,
        );
        saved = await flip(admin, tier, "On intake form");
        vis = await switchState(admin, tier, "Visible on Portal");
        const creation = await touchpoint(admin, tier);
        log.push(
          `On intake form off: Saved ${saved}, Visible on Portal checked ${vis.checked} locked ${vis.locked}, Touchpoint ${creation}`,
        );
        expectThat(creation === "Creation" && !vis.locked, log.at(-1));
        // The User Row on intake.
        await flip(admin, owner, "On intake form");
        const req = await switchState(admin, owner, "Required for creation");
        const userReason = flat(
          await formRow(admin, owner)
            .locator(`[id$="-isRequired"].sr-only, [id^="reason-"][id$="-isRequired"]`)
            .first()
            .textContent()
            .catch(() => ""),
        );
        await admin
          .getByRole("switch", { name: `${owner}: Required for creation`, exact: true })
          .click({ force: true });
        await pause(800);
        const reqAfter = await switchState(admin, owner, "Required for creation");
        expectThat(
          req.locked && !reqAfter.checked,
          `user required locked ${req.locked}, after click ${reqAfter.checked}`,
        );
        await flip(admin, owner, "On intake form");
        await admin.reload();
        await formRow(admin, tier).waitFor();
        const persisted = {
          intake: (await switchState(admin, tier, "On intake form")).checked,
          required: (await switchState(admin, tier, "Required for creation")).checked,
          tp: await touchpoint(admin, tier),
        };
        expectThat(
          !persisted.intake && persisted.required && persisted.tp === "Creation",
          `after reload ${q(persisted)}`,
        );
        return `${log.join(". ")}. The locked Visible on Portal switch reads ${q(reason)}. With On intake form on for the User Row ${q(owner)}, its Required for creation switch is locked with ${q(userReason)} and a click left it off. After reload ${q(tier)} reads On intake form off, Required for creation on, Touchpoint ${persisted.tp}.`;
      },
    );

    await step(
      SC,
      role,
      "Attach Fields, step 4: focus a Row's move handle and use the arrow keys; Title and Type stay pinned",
      "The Row moves up one place and keeps it after reload; Title and Type keep the first two places.",
      async () => {
        const order = async () =>
          admin
            .getByRole("region", { name: "Form" })
            .getByRole("group")
            .evaluateAll((els) => els.map((e) => e.getAttribute("aria-label")));
        const before = await order();
        await admin.getByRole("button", { name: `Move ${tier}`, exact: true }).focus();
        await admin.keyboard.press("ArrowUp");
        await until(
          async () => (await order()).indexOf(tier) === before.indexOf(tier) - 1,
          "Row did not move",
        );
        await pause(1500);
        await admin.reload();
        await formRow(admin, tier).waitFor();
        const after = await order();
        expectThat(
          after.indexOf(tier) === before.indexOf(tier) - 1,
          `order after reload ${q(after)}`,
        );
        // Try to move the Row above Type.
        for (let i = 0; i < after.indexOf(tier); i++) {
          await admin.getByRole("button", { name: `Move ${tier}`, exact: true }).focus();
          await admin.keyboard.press("ArrowUp");
          await pause(700);
        }
        const top = await order();
        expectThat(top[0] === "Title" && top[1] === "Type", `top ${q(top.slice(0, 3))}`);
        return `ArrowUp on "Move ${tier}" moved it from place ${before.indexOf(tier) + 1} to ${after.indexOf(tier) + 1}, kept after reload. Further ArrowUp presses stopped it at place ${top.indexOf(tier) + 1}; Title and Type stay first and second.`;
      },
    );

    await step(
      SC,
      role,
      "Add conditional Rows with a Branch, steps 1-3: On intake form for Term type and Expiry date, Required for creation for Expiry date; Add condition in the Form header; Row Term type, Operator is, Value Fixed; grip Move Expiry date > Put under a condition… > Show when all of: Term type is Fixed",
      "The new Branch appears at the end of the Form below Term type; the completed condition saves; Expiry date moves under the Branch.",
      async () => {
        await flip(admin, "Term type", "On intake form");
        await flip(admin, "Expiry date", "On intake form");
        await flip(admin, "Expiry date", "Required for creation");
        const region = admin.getByRole("region", { name: "Form" });
        await region.locator("header").getByRole("button", { name: "Add condition" }).click();
        const editor = admin.getByRole("group", { name: "Branch conditions" });
        await editor.waitFor();
        const lastGroups = await region
          .getByRole("group")
          .evaluateAll((els) => els.map((e) => e.getAttribute("aria-label")));
        const rowSel = editor.locator("select").nth(0);
        const opSel = editor.locator("select").nth(1);
        const rowChoices = (await rowSel.locator("option").allInnerTexts()).map(flat);
        await rowSel.selectOption({ label: "Term type" });
        const ops = (await opSel.locator("option").allInnerTexts()).map(flat);
        await opSel.selectOption({ label: "is" });
        const valueChoices = (
          await editor
            .getByRole("combobox", { name: "Value", exact: true })
            .locator("option")
            .allInnerTexts()
        ).map(flat);
        await editor
          .getByRole("combobox", { name: "Value", exact: true })
          .selectOption({ label: "Fixed" });
        const branchName = "Show when all of: Term type is Fixed";
        await region.getByText(branchName).first().waitFor({ timeout: 15000 });
        const saved = await until(
          async () => (await region.getByText("Saved", { exact: true }).count()) > 0,
          "no Saved",
        ).catch(() => false);
        await pause(800);
        const branchChildrenBefore = lastGroups.at(-1);
        await admin.getByRole("button", { name: "Move Expiry date", exact: true }).click();
        await admin.getByRole("menuitem", { name: "Put under a condition…" }).click();
        const dlg = admin.getByRole("dialog", { name: "Put under a condition" });
        await dlg.getByRole("button", { name: branchName }).click();
        const children = region.getByRole("group", { name: `Children of ${branchName}` });
        await children
          .getByRole("group", { name: "Expiry date", exact: true })
          .waitFor({ timeout: 15000 });
        await pause(1500);
        await admin.reload();
        await admin
          .getByRole("group", { name: `Children of ${branchName}` })
          .getByRole("group", { name: "Expiry date", exact: true })
          .waitFor({ timeout: 15000 });
        const all = await region
          .getByRole("group")
          .evaluateAll((els) => els.map((e) => e.getAttribute("aria-label")));
        const termIdx = all.indexOf("Term type");
        const branchIdx = all.indexOf(`Children of ${branchName}`);
        expectThat(branchIdx > termIdx && branchIdx === all.length - 2, `order ${q(all)}`);
        return `On intake form was turned on for Term type and Expiry date and Required for creation for Expiry date. Add condition in the Form header opened a condition editor at the end of the Form (last group before it: ${q(branchChildrenBefore)}). Row offered ${q(rowChoices)}; Operator offered ${q(ops)}; Value offered ${q(valueChoices)}. After Term type / is / Fixed the Branch header read ${q(branchName)} (Saved seen ${!!saved}). The grip "Move Expiry date" offered Put under a condition…, and the dialog "Put under a condition" offered ${q(branchName)}. Expiry date now sits in "Children of ${branchName}", which is after Term type and last on the Form, after reload.`;
      },
    );

    await step(
      SC,
      role,
      "Branch, step 4: Preview intake form; Fixed shows Expiry date as required, Evergreen hides it; Submit request tests validation without sending",
      "The preview reads Preview only. No Request will be sent.; Expiry date appears only for Fixed; Submit request without it is refused and sends nothing.",
      async () => {
        await admin
          .getByRole("region", { name: "Form" })
          .locator("header")
          .getByRole("button", { name: "Preview intake form" })
          .click();
        const d = admin.getByRole("dialog", { name: "Preview intake form" });
        await d.waitFor();
        const intro = flat(
          await d
            .getByText(/Preview only/)
            .first()
            .innerText(),
        );
        const term = d.getByLabel(/^Term type/);
        const termOptions = (await term.locator("option").allInnerTexts()).map(flat);
        await term.selectOption({ label: "Fixed" });
        await pause(400);
        const expiryFixed = await d.getByText(/^Expiry date/).count();
        const expiryLabel = expiryFixed
          ? flat(
              await d
                .getByText(/^Expiry date/)
                .first()
                .innerText(),
            )
          : null;
        await d
          .getByLabel(/^Title/)
          .first()
          .fill("Preview only");
        await d.getByRole("button", { name: "Submit request" }).click();
        await pause(800);
        const dialogText = await d.innerText();
        const refusal = flat(
          [
            ...(await d.getByRole("alert").allInnerTexts()),
            ...dialogText
              .split("\n")
              .filter((l) => /^Fill |required|Choose |Enter /i.test(l.trim())),
          ].join(" | "),
        );
        const invalid = await d.locator('[aria-invalid="true"]').count();
        const done = await d.getByText("Preview complete. No Request was sent").count();
        await term.selectOption({ label: "Evergreen" });
        await pause(400);
        const expiryEvergreen = await d.getByText(/^Expiry date/).count();
        await admin.screenshot({
          path: path.join(SHOTS, "types-statuses-fields-preview-intake-form.png"),
        });
        await d.getByRole("button", { name: "Close" }).last().click();
        await d.waitFor({ state: "hidden" });
        expectThat(/Preview only\. No Request will be sent\./.test(intro), `intro ${intro}`);
        expectThat(
          expiryFixed > 0 && expiryEvergreen === 0,
          `expiry fixed ${expiryFixed}, evergreen ${expiryEvergreen}`,
        );
        expectThat(done === 0 && refusal, `submit ${done} refusal ${refusal}`);
        return `Preview intake form opened a dialog reading ${q(intro)}. Term type offered ${q(termOptions)}. With Fixed, Expiry date appeared (${q(expiryLabel)}); Submit request with Expiry date empty showed ${q(refusal)} (${invalid} controls marked invalid) and no completion message. With Evergreen, Expiry date disappeared. Close returned to the Form. Screenshot v-c38-preview-intake-form.png.`;
      },
    );

    await step(
      SC,
      role,
      "Branch rules: Add another condition asks AND or OR once and Join conditions changes it; a second Branch cannot start until the first is finished; Escape discards a new condition",
      "The join question offers AND and OR; the Join conditions control appears; Add condition is refused while a Branch is unfinished; Escape removes the draft.",
      async () => {
        const region = admin.getByRole("region", { name: "Form" });
        const branchName = "Show when all of: Term type is Fixed";
        await region.getByRole("button", { name: "Edit conditions" }).first().click();
        const editor = admin.getByRole("group", { name: "Branch conditions" });
        await editor.getByRole("button", { name: "Add another condition" }).click();
        const ask = editor.getByRole("group", { name: "Join the next condition with" });
        const askButtons = (await ask.getByRole("button").allInnerTexts()).map(flat);
        await ask.getByRole("button", { name: "OR", exact: true }).click();
        const join = editor.getByRole("combobox", { name: "Join conditions" });
        const joinValue = await join.evaluate((e) => e.selectedOptions[0].textContent);
        await join.selectOption({ label: "AND" });
        await editor.getByRole("button", { name: "Remove condition 2" }).click();
        await pause(800);
        await region
          .getByRole("button", { name: "Edit conditions" })
          .first()
          .click()
          .catch(() => {});
        // A new, unfinished Branch blocks a second one.
        await region.locator("header").getByRole("button", { name: "Add condition" }).click();
        await admin.getByRole("group", { name: "Branch conditions" }).waitFor();
        const addAgain = region.locator("header").getByRole("button", { name: "Add condition" });
        const blocked = await addAgain.getAttribute("aria-disabled");
        await admin
          .getByRole("group", { name: "Branch conditions" })
          .locator("select")
          .first()
          .focus();
        await admin.keyboard.press("Escape");
        await pause(600);
        const drafts = await admin.getByRole("group", { name: "Branch conditions" }).count();
        const branches = await region.getByRole("group", { name: /^Children of / }).count();
        expectThat(
          q(askButtons) === q(["AND", "OR", "Cancel"]) && joinValue === "OR",
          `ask ${q(askButtons)} join ${joinValue}`,
        );
        expectThat(
          blocked === "true" && drafts === 0 && branches === 1,
          `blocked ${blocked}, drafts ${drafts}, branches ${branches}`,
        );
        return `Edit conditions > Add another condition asked "Join the next condition with" offering ${q(askButtons)}; after OR, the Join conditions control read ${q(joinValue)} and was changed to AND; Remove condition 2 removed the second condition. A new Add condition opened an unfinished Branch; the header's Add condition then carried aria-disabled=${blocked} ("Complete the Branch condition first"). Escape discarded the draft (${drafts} editors, ${branches} Branch left).`;
      },
    );

    await step(
      SC,
      role,
      "New and existing records follow the Form: a new Contract of this type needs the Required for creation Row; Rows under a false Branch are not collected or required; the record holds the value",
      "Create is refused while the required Field is empty; Expiry date is asked only for Fixed; Create succeeds with Evergreen and a value; the Contract shows the value.",
      async () => {
        await admin.goto(`${BASE}/contracts`);
        await admin
          .getByRole("button", { name: /New contract|Create contract/ })
          .first()
          .click();
        const d = admin.getByRole("dialog", { name: "Create contract" });
        const title = name(SC, "Supplier NDA");
        await d.getByRole("textbox", { name: "Title" }).fill(title);
        await d.getByRole("combobox", { name: "Contract type" }).selectOption({ label: nda });
        await pause(1000);
        const labels = (await d.locator("label").allInnerTexts()).map(flat).filter(Boolean);
        await d.getByRole("button", { name: "Create" }).click();
        await pause(1500);
        const stillOpen = await d.isVisible();
        const alerts = flat(
          (
            await d
              .getByRole("alert")
              .allInnerTexts()
              .catch(() => [])
          ).join(" | "),
        );
        expectThat(stillOpen, "created without the required Field");
        await d.getByRole("textbox", { name: new RegExp(`^${escapeRe(tier)}`) }).fill("Tier 2");
        const termType = d.getByLabel(/^Term type/).first();
        const termOptions = (
          await termType
            .locator("option")
            .allInnerTexts()
            .catch(() => [])
        ).map(flat);
        await termType.selectOption({ label: "Fixed" });
        await pause(500);
        const labelsFixed = (await d.locator("label").allInnerTexts())
          .map(flat)
          .filter((l) => /^Expiry date/.test(l));
        await termType.selectOption({ label: "Evergreen" });
        await pause(500);
        const labelsEvergreen = (await d.locator("label").allInnerTexts())
          .map(flat)
          .filter((l) => /^Expiry date/.test(l));
        expectThat(
          labelsFixed.length === 1 && labelsEvergreen.length === 0,
          `Expiry with Fixed ${q(labelsFixed)}, with Evergreen ${q(labelsEvergreen)}`,
        );
        const expiryNote = `Term type offered ${q(termOptions)}; with Fixed the dialog showed ${q(labelsFixed)}, with Evergreen no Expiry date control`;
        await d.getByRole("button", { name: "Create" }).click();
        await pause(1500);
        if (await d.isVisible()) {
          const more = flat((await d.getByRole("alert").allInnerTexts()).join(" | "));
          throw new Error(`still open after Tier 2: ${more}; labels ${q(labels)}`);
        }
        await admin.waitForURL(/\/contracts\/\d+/, { timeout: 20000 });
        S.ndaContract = admin.url().match(/\/contracts\/(\d+)/)[1];
        record("contract", title, { number: S.ndaContract });
        await admin
          .getByRole("navigation", { name: "Contract sections" })
          .getByRole("link", { name: "Fields" })
          .click();
        await admin
          .locator("main")
          .getByRole("textbox", { name: new RegExp(`^${escapeRe(tier)}`) })
          .waitFor({ timeout: 15000 });
        const shown = await admin
          .locator("main")
          .getByRole("textbox", { name: new RegExp(`^${escapeRe(tier)}`) })
          .inputValue()
          .catch(() => null);
        expectThat(shown === "Tier 2", `record shows ${q(shown)} for the Field`);
        return `Contracts > Create contract with type ${q(nda)} showed ${q(labels)}. Create with ${q(tier)} empty kept the dialog open with ${q(alerts)}. With "Tier 2" filled, ${expiryNote}; Create with Evergreen opened C-${S.ndaContract}, whose Fields tab shows ${q(tier)} = ${q(shown)}.`;
      },
    );

    await step(
      SC,
      role,
      "Branch rules: Remove condition keeps its children",
      "After Remove condition the Branch is gone and Expiry date stays on the Form at the root with its switches.",
      async () => {
        await admin.goto(S.ndaFormUrl);
        const region = admin.getByRole("region", { name: "Form" });
        const branchName = "Show when all of: Term type is Fixed";
        await region.getByRole("button", { name: `Actions for ${branchName}` }).click();
        await admin.getByRole("menuitem", { name: "Remove condition" }).click();
        await until(
          async () => (await region.getByRole("group", { name: /^Children of / }).count()) === 0,
          "Branch not removed",
        );
        await pause(1200);
        await admin.reload();
        await formRow(admin, "Expiry date").waitFor();
        const all = await region
          .getByRole("group")
          .evaluateAll((els) => els.map((e) => e.getAttribute("aria-label")));
        const req = await switchState(admin, "Expiry date", "Required for creation");
        expectThat(all.includes("Expiry date") && req.checked, `rows ${q(all)}`);
        return `Actions for ${q(branchName)} > Remove condition removed the Branch; after reload Expiry date is on the Form at the root (${all.indexOf("Expiry date") + 1} of ${all.length} groups) with Required for creation ${req.checked ? "on" : "off"}.`;
      },
    );

    await step(
      SC,
      role,
      "Archive in the Field catalog hides the Field and keeps attachments and stored values; Show archived > Restore brings them back; Detach removes a Row and keeps the Field",
      "The archive dialog says the attachment is kept; the Form no longer shows the Row; after Restore the Row and the record's value return; Detach removes the User Row and the Field stays in the catalog.",
      async () => {
        await openSettings(admin, A, "Contracts");
        await pane(admin, "Contracts panes", "Fields");
        await admin.getByRole("button", { name: `Archive ${tier}`, exact: true }).click();
        const d = admin.getByRole("dialog");
        const text = flat(await d.innerText());
        const reassign = await d.getByRole("combobox").count();
        const shownCount = Number((text.match(/attached to (\d+) types?/) ?? [0, 0])[1]);
        if (shownCount !== 1) {
          ctx.productBug({
            scenario: SC,
            title: "The Field archive dialog counts records holding a value as attached types",
            reproduction: `Attach a new Contract Field to one Contract type's Form only, create one Contract that holds a value for it, then open Archive on the Field in Settings > Contracts > Fields. The dialog read ${q(text)}.`,
            expected: "attached to 1 type (only one type's Form holds the Field)",
            observed: `attached to ${shownCount} types`,
            source:
              "apps/api/src/modules/fields/routes.ts attachmentCounts adds type attachments and records holding the slug; settings.contractFields.archiveWarning calls the sum types",
          });
        }
        await d.getByRole("button", { name: "Archive field" }).click();
        await d.waitFor({ state: "hidden" });
        await admin.goto(S.ndaFormUrl);
        await formRow(admin, "Title").waitFor();
        const rowWhileArchived = await formRow(admin, tier).count();
        const recWhileArchived = (await api(admin, "GET", `/api/v1/contracts/${S.ndaContract}`))
          .body;
        const storedWhileArchived = JSON.stringify(
          recWhileArchived?.contract?.customFields ?? recWhileArchived?.customFields ?? {},
        ).includes("Tier 2");
        await admin.goto(`${BASE}/contracts/${S.ndaContract}`);
        await pause(1500);
        await admin.locator("main").getByRole("textbox").first().waitFor();
        const pageWhileArchived = await admin
          .locator("main")
          .getByRole("textbox", { name: new RegExp(`^${escapeRe(tier)}`) })
          .inputValue()
          .catch(() => "(no control)");
        await openSettings(admin, A, "Contracts");
        await pane(admin, "Contracts panes", "Fields");
        await admin.getByRole("button", { name: "Rename Governing law", exact: true }).waitFor();
        const showArchived = admin.getByRole("switch", { name: "Show archived" });
        await showArchived.click();
        await until(
          async () => (await showArchived.getAttribute("aria-checked")) === "true",
          "Show archived did not turn on",
        );
        await admin.getByRole("button", { name: `Restore ${tier}`, exact: true }).click();
        await admin
          .getByRole("button", { name: `Archive ${tier}`, exact: true })
          .waitFor({ timeout: 15000 });
        await admin.goto(S.ndaFormUrl);
        await formRow(admin, tier).waitFor({ timeout: 15000 });
        const restoredReq = await switchState(admin, tier, "Required for creation");
        await admin.getByRole("button", { name: `Detach ${owner}`, exact: true }).click();
        await until(
          async () => (await formRow(admin, owner).count()) === 0,
          "User Row not detached",
        );
        await pause(1000);
        await admin.goto(`${BASE}/contracts/${S.ndaContract}/fields`);
        await admin
          .locator("main")
          .getByRole("textbox", { name: new RegExp(`^${escapeRe(tier)}`) })
          .waitFor({ timeout: 15000 });
        const pageRestored = await admin
          .locator("main")
          .getByRole("textbox", { name: new RegExp(`^${escapeRe(tier)}`) })
          .inputValue()
          .catch(() => "(no control)");
        expectThat(pageRestored === "Tier 2", `restored record shows ${q(pageRestored)}`);
        const catalog = ((await api(admin, "GET", "/api/v1/fields")).body?.fields ?? []).find(
          (f) => f.displayName === owner,
        );
        expectThat(
          reassign === 0 && /attachments? (is|are) kept/.test(text),
          `archive dialog ${text}`,
        );
        expectThat(
          rowWhileArchived === 0 && restoredReq.checked,
          `row while archived ${rowWhileArchived}, restored required ${restoredReq.checked}`,
        );
        expectThat(catalog && !catalog.archivedAt, "detached Field left the catalog");
        return `Archive ${q(tier)} read ${q(text)} with ${reassign} reassignment controls. While archived, the Form showed ${rowWhileArchived} Rows for it; the API still held the stored value (${storedWhileArchived}); the Contract's Fields tab control for it read ${q(pageWhileArchived)}. Show archived > Restore returned the Row with Required for creation ${restoredReq.checked ? "on" : "off"}, and C-${S.ndaContract}'s Fields tab reads ${q(pageRestored)} again. "Detach ${owner}" removed the User Row; the Field stays live in the catalog.`;
      },
    );

    await step(
      SC,
      role,
      "Entity Forms show only Required for creation, with no On intake form or Visible on Portal switch and no intake preview",
      "An Entity type's Form has only Required for creation switches and no Preview intake form button.",
      async () => {
        await openSettings(admin, A, "Entities");
        await pane(admin, "Entities panes", "Types");
        const et = name(SC, "Entity form type");
        await addListRow(admin, "Add type", "New type name", et);
        record("entity type", et);
        await admin.getByRole("button", { name: `Edit ${et}`, exact: true }).click();
        await admin
          .getByRole("navigation", { name: "Type sections" })
          .getByRole("link", { name: "Form" })
          .click();
        const region = admin.getByRole("region", { name: "Form" });
        await region.waitFor();
        await region.getByRole("button", { name: "Attach Field" }).click();
        const menu = admin.getByRole("menu");
        await menu.locator("[data-field-option]").first().click();
        await region.getByRole("switch").first().waitFor({ timeout: 15000 });
        await pause(800);
        const header = flat(await region.locator("header").innerText());
        const switches = await region
          .getByRole("switch")
          .evaluateAll((els) => els.map((e) => e.getAttribute("aria-label")));
        const preview = await region.getByRole("button", { name: "Preview intake form" }).count();
        const addCond = await region.getByRole("button", { name: "Add condition" }).count();
        expectThat(
          preview === 0 &&
            switches.length > 0 &&
            switches.every((s) => /: Required for creation$/.test(s)),
          `switches ${q(switches)}, preview ${preview}`,
        );
        return `Entity type ${q(et)} (one Entity Field attached through Attach Field) Form header reads ${q(header)}; its ${switches.length} switches are all "<Row>: Required for creation" (${q(switches.slice(0, 3))}); Preview intake form buttons ${preview}; Add condition buttons ${addCond}.`;
      },
    );
  }

  // =====================================================================
  // V-C38 types-statuses-fields: Officer roles
  // =====================================================================
  async function officersSection(admin) {
    const SC = "V-C38";
    const role = "administrator";
    const A = PEOPLE.administrator;
    currentPage = admin;
    const roleName = name(SC, "Board observer");
    const renamed = name(SC, "Board observer renamed");
    const replacement = name(SC, "Board adviser");

    await step(
      SC,
      role,
      "Maintain Officer roles: Entities > Director & Officer roles; Add role, Rename, reorder",
      "The new role row appears; Rename and keyboard reorder persist; Other is protected.",
      async () => {
        await openSettings(admin, A, "Entities");
        await pane(admin, "Entities panes", "Director & Officer roles");
        await admin.getByRole("heading", { name: "Director & Officer roles" }).first().waitFor();
        await addListRow(admin, "Add role", "New role name", roleName);
        await addListRow(admin, "Add role", "New role name", replacement);
        record("officer role", roleName);
        record("officer role", replacement);
        await renameRow(admin, roleName, renamed);
        const { before, after } = await moveUp(admin, replacement);
        const other = await admin
          .getByRole("img", { name: "Other is system-protected and can't be archived" })
          .count();
        expectThat(other === 1, "Other lock missing");
        return `Entities > Director & Officer roles: Add role added ${q(roleName)} and ${q(replacement)}; Rename changed the first to ${q(renamed)}; ArrowUp moved ${q(replacement)} from ${before} to ${after} (above this run's own row), kept after reload. Other shows "Other is system-protected and can't be archived".`;
      },
    );

    await step(
      SC,
      role,
      "Archive an in-use role: usage counts current and resigned Officers; select the replacement and confirm Archive role; Restore does not reverse the reassignment",
      "The dialog counts both Officers; after Archive role both move to the replacement; Restore makes the role selectable and leaves them on the replacement.",
      async () => {
        const roles = (await api(admin, "GET", "/api/v1/officer-roles")).body;
        const list = roles?.officerRoles ?? roles?.roles ?? roles ?? [];
        const r = list.find((x) => x.displayName === renamed);
        const repl = list.find((x) => x.displayName === replacement);
        const entities = (await api(admin, "GET", "/api/v1/entities")).body?.entities ?? [];
        const mine = entities.find((e) => /^DOC-032 records V-C38 /.test(e.legalName)) ?? null;
        let entityId = mine?.id;
        if (!entityId) {
          const types = (await api(admin, "GET", "/api/v1/entity-types")).body;
          const et = (types?.entityTypes ?? types ?? [])[0];
          const e = await api(admin, "POST", "/api/v1/entities", {
            legalName: name(SC, "Officer test Ltd"),
            entityTypeId: et.id,
          });
          entityId = e.body?.entity?.id ?? e.body?.id;
          expectThat(entityId, `entity fixture ${e.status} ${q(e.body)}`);
          record("entity", name(SC, "Officer test Ltd"));
        }
        const o1 = await api(admin, "POST", `/api/v1/entities/${entityId}/officers`, {
          name: `Imani Fictional ${stamp}`,
          officerRoleId: r.id,
          appointedOn: "2024-01-15",
        });
        const o2 = await api(admin, "POST", `/api/v1/entities/${entityId}/officers`, {
          name: `Tomas Fictional ${stamp}`,
          officerRoleId: r.id,
          appointedOn: "2023-03-01",
          resignedOn: "2025-06-30",
        });
        expectThat(
          o1.status < 300 && o2.status < 300,
          `officer fixtures ${o1.status} ${o2.status} ${q(o2.body)}`,
        );
        await admin.reload();
        const usage = flat(await row(admin, renamed).innerText());
        await admin.getByRole("button", { name: `Archive ${renamed}`, exact: true }).click();
        const d = admin.getByRole("dialog");
        const text = flat(await d.innerText());
        await d.getByRole("combobox").selectOption({ label: replacement });
        await d.getByRole("button", { name: "Archive role" }).click();
        await d.waitFor({ state: "hidden", timeout: 15000 });
        const officers = (
          await api(admin, "GET", `/api/v1/entities/${entityId}/officers?includeFormer=true`)
        ).body;
        const olist = officers?.officers ?? officers ?? [];
        const moved = olist
          .filter((o) => [`Imani Fictional ${stamp}`, `Tomas Fictional ${stamp}`].includes(o.name))
          .map(
            (o) =>
              `${o.name}: ${o.officerRoleName ?? o.roleName ?? o.officerRole?.displayName ?? o.officerRoleId}`,
          );
        await admin.getByRole("switch", { name: "Show archived" }).click();
        await admin.getByRole("button", { name: `Restore ${renamed}`, exact: true }).click();
        await admin
          .getByRole("button", { name: `Archive ${renamed}`, exact: true })
          .waitFor({ timeout: 15000 });
        const after = (
          (await api(admin, "GET", `/api/v1/entities/${entityId}/officers?includeFormer=true`)).body
            ?.officers ?? []
        ).filter((o) => o.officerRoleId === r.id).length;
        expectThat(
          /2 officers/.test(text) &&
            moved.length === 2 &&
            moved.every((m) => m.includes(replacement) || m.includes(repl.id)),
          `text ${text}; moved ${q(moved)}`,
        );
        expectThat(after === 0, `${after} officers moved back`);
        return `Two fictional Officers (one current, one resigned 2025-06-30) were given ${q(renamed)} through the API. Its row read ${q(usage)}; the Archive dialog read ${q(text)}. After choosing ${q(replacement)} and Archive role, the Officers read ${q(moved)}. Show archived > Restore made ${q(renamed)} live again; ${after} Officers moved back.`;
      },
    );
  }

  // =====================================================================
  // V-C38 negative: non-Administrators cannot edit configuration
  // =====================================================================
  async function accessSection(browser, contexts) {
    const SC = "V-C38";
    // Ravi Menon, the seed's Contributor, holds the Business User role on this shared lab at the
    // time of the walk, so the Business User check runs in the forms section with Jonas Weber.
    for (const [key, person] of [["legal_team_member", PEOPLE.legal_team_member]]) {
      const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
      contexts.push(ctx);
      const page = await ctx.newPage();
      currentPage = page;
      await step(
        SC,
        "administrator",
        `Negative check: a ${key.replace(/_/g, " ")} (${person.name}) cannot open or change type, Status or Field configuration`,
        "The Settings rail has no Organization configuration; the configuration URLs do not show the editors; the API refuses a change.",
        async () => {
          await browserSignIn(page, person);
          await page.goto(`${BASE}/`);
          await page.getByRole("banner").getByRole("button", { name: person.name }).click();
          await page.getByRole("menuitem", { name: "Settings" }).click();
          await page.waitForURL(/\/settings/);
          await page.waitForLoadState("networkidle").catch(() => {});
          const rail = page.getByRole("navigation", { name: "Settings sections" });
          const groups = await rail
            .getByRole("group")
            .evaluateAll((els) =>
              els.map((e) => e.getAttribute("aria-label") ?? e.querySelector("h2")?.textContent),
            );
          const out = [];
          for (const u of [
            "/settings/contracts/types",
            "/settings/matters/statuses",
            "/settings/contracts/fields",
            "/settings/entities/officer-roles",
          ]) {
            await page.goto(`${BASE}${u}`);
            await page.waitForLoadState("networkidle").catch(() => {});
            await pause(800);
            const add = await page
              .getByRole("button", { name: /^(Add type|Add status|Add field|Add role)$/ })
              .count();
            const heading = flat(
              await page
                .locator("main h2, main h1")
                .first()
                .innerText()
                .catch(() => ""),
            );
            out.push(
              `${u} -> ${new URL(page.url()).pathname} (${q(heading)}, add controls ${add})`,
            );
            expectThat(add === 0, `${u} shows an add control`);
          }
          const types =
            (await api(page, "GET", "/api/v1/contract-types")).body?.contractTypes ?? [];
          const target = types[0]?.id ?? "00000000-0000-0000-0000-000000000000";
          const patch = await api(page, "POST", "/api/v1/contract-types", {
            displayName: name(SC, "Refused type"),
          });
          expectThat(patch.status === 403, `API create answered ${patch.status}`);
          return `${person.name} opened Settings from the profile menu; the rail groups are ${q(groups)}. ${out.join("; ")}. POST /api/v1/contract-types answered ${patch.status} ${q(patch.body?.detail ?? patch.body?.title)}.`;
        },
      );
    }
  }

  let admin = adminPage;
  const browser = ctx.browser;
  const contexts = [];
  try {
    for (const [s, fn] of [
      ["types", () => typesSection(adminPage)],
      ["documents", () => documentsSection(adminPage)],
      ["statuses", () => statusesSection(adminPage)],
      ["fields", () => fieldsSection(adminPage)],
      ["form", () => formSection(adminPage)],
      ["officers", () => officersSection(adminPage)],
      ["access", () => accessSection(browser, contexts)],
    ]) {
      if (process.env.SECTIONS && !process.env.SECTIONS.split(",").includes(s)) continue;
      section = s;
      currentPage = adminPage;
      await fn();
    }
  } finally {
    currentPage = adminPage;
    for (const c of contexts) await c.close().catch(() => {});
    // Archive every configuration record this run created and left live.
    const mine = (n) =>
      typeof n === "string" && n.startsWith("DOC-032 records ") && n.endsWith(stamp);
    const results = [];
    const defaults = {};
    for (const [path2, key] of [
      ["/api/v1/matter-types", "matterTypes"],
      ["/api/v1/contract-types", "contractTypes"],
      ["/api/v1/entity-types", "entityTypes"],
      ["/api/v1/knowledge/types", "knowledgeTypes"],
    ]) {
      const list = (await api(adminPage, "GET", path2)).body?.[key] ?? [];
      defaults[path2] = list.find((t) => t.displayName === "Default" || t.slug === "other");
      for (const t of list.filter((x) => mine(x.displayName) && !x.archivedAt)) {
        let r = await api(adminPage, "POST", `${path2}/${t.id}/archive`, {});
        if (r.status >= 400 && defaults[path2])
          r = await api(adminPage, "POST", `${path2}/${t.id}/archive`, {
            reassignToId: defaults[path2].id,
          });
        results.push(`${t.displayName}: ${r.status}`);
      }
    }
    for (const mod of ["matter", "contract", "entity"]) {
      const list =
        (await api(adminPage, "GET", `/api/v1/documents/types/${mod}`)).body?.documentTypes ?? [];
      for (const t of list.filter((x) => mine(x.displayName) && !x.archivedAt)) {
        if (t.color)
          await api(adminPage, "PATCH", `/api/v1/documents/types/${mod}/${t.id}`, { color: null });
        const r = await api(
          adminPage,
          "POST",
          `/api/v1/documents/types/${mod}/${t.id}/archive`,
          {},
        );
        results.push(`${t.displayName}: ${r.status}`);
      }
    }
    const cs =
      (await api(adminPage, "GET", "/api/v1/contract-statuses")).body?.contractStatuses ?? [];
    for (const t of cs.filter((x) => mine(x.displayName) && !x.archivedAt)) {
      const r = await api(adminPage, "POST", `/api/v1/contract-statuses/${t.id}/archive`, {});
      results.push(`${t.displayName}: ${r.status}`);
    }
    const ms = (await api(adminPage, "GET", "/api/v1/matter-statuses")).body?.matterStatuses ?? [];
    for (const t of ms.filter((x) => mine(x.displayName) && !x.archivedAt)) {
      const same = ms.find((x) => x.slug === t.category && !x.archivedAt);
      let r = await api(adminPage, "POST", `/api/v1/matter-statuses/${t.id}/archive`, {});
      if (r.status >= 400 && same)
        r = await api(adminPage, "POST", `/api/v1/matter-statuses/${t.id}/archive`, {
          reassignToId: same.id,
        });
      results.push(`${t.displayName}: ${r.status}`);
    }
    const fl = (await api(adminPage, "GET", "/api/v1/fields")).body?.fields ?? [];
    for (const t of fl.filter((x) => mine(x.displayName) && !x.archivedAt)) {
      const r = await api(adminPage, "POST", `/api/v1/fields/${t.id}/archive`, {});
      results.push(`${t.displayName}: ${r.status}`);
    }
    const orl = (await api(adminPage, "GET", "/api/v1/officer-roles")).body?.officerRoles ?? [];
    const other = orl.find((x) => x.slug === "other");
    for (const t of orl.filter((x) => mine(x.displayName) && !x.archivedAt)) {
      let r = await api(adminPage, "POST", `/api/v1/officer-roles/${t.id}/archive`, {});
      if (r.status >= 400 && other)
        r = await api(adminPage, "POST", `/api/v1/officer-roles/${t.id}/archive`, {
          reassignToId: other.id,
        });
      results.push(`${t.displayName}: ${r.status}`);
    }
    await ctx.record({
      what: "V-C38 configuration cleanup",
      how: "Administrator API after the walk",
      cleanup: results.length ? results.join("; ") : "nothing left live",
    });
  }
}
