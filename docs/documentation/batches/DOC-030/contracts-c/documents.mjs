// DOC-030 contracts-c: archive-and-delete-documents.md (V-C54) on the shared lab work2, as
// legal_team_member (Nadia Haddad) and administrator (Daniel Okafor), with a Business User
// (Mei Tanaka) for the negative checks. Ported from DOC-029/documents/walkthrough-r1.mjs
// (archive section) and the DOC-030 documents helpers for the 067c1646 Documents card.
// Fixtures (disposable DOC-030 Contracts, Knowledge Items and their Documents) are created
// through the API; every guide step runs in the browser.
import fs from "node:fs";
import path from "node:path";
import { PEOPLE, articleText, expectThat, q, sha, sleep } from "./lib.mjs";

const ARTICLE = "archive-and-delete-documents";
const SCENARIO = "V-C54";

export default async function documents(ctx) {
  const { BASE, step: rawStep, sessions, STAMP, results, here } = ctx;
  const step = (role, actors, page, action, expected, fn, extra = {}) =>
    rawStep(
      { article: ARTICLE, scenario: SCENARIO, role, actors, page, action, expected, ...extra },
      fn,
    );
  const FIX = path.resolve(here, "../../DOC-029/documents/fixtures");
  const MIME = {
    ".pdf": "application/pdf",
    ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ".txt": "text/plain",
  };
  const part = (name, as = name) => ({
    name: as,
    mimeType: MIME[path.extname(name)] ?? "application/octet-stream",
    buffer: fs.readFileSync(path.join(FIX, name)),
  });
  results.records = [];

  const admin = await sessions.password(PEOPLE.daniel);
  const nadia = await sessions.password(PEOPLE.nadia);
  const users = (await admin.api("GET", "/users?limit=200")).json.users;
  const idOf = (email) => users.find((u) => u.email === email)?.id;
  const contractTypeId = (await admin.api("GET", "/contracts/options")).json.contractTypes.find(
    (t) => t.displayName === "NDA",
  ).id;

  async function uploadApi(who, url, name, as) {
    const r = await who.api("POST", url, undefined, {
      multipart: { kind: "draft_ours", file: part(name, as) },
    });
    expectThat(
      r.status === 201,
      `fixture upload ${r.status} ${JSON.stringify(r.json).slice(0, 200)}`,
    );
    return r.json.document;
  }
  async function addVersion(who, id, name, as) {
    const r = await who.api("POST", `/documents/${id}/versions`, undefined, {
      multipart: { kind: "draft_theirs", file: part(name, as) },
    });
    expectThat(r.status === 201, `fixture version ${r.status}`);
  }
  async function recordDocs(who, recordUrl, archived = false) {
    const docs = [];
    let cursor = null;
    do {
      const sp = new URLSearchParams();
      if (cursor) sp.set("cursor", cursor);
      if (archived) sp.set("includeArchived", "true");
      const r = await who.api("GET", `${recordUrl}/documents?${sp}`);
      expectThat(r.status === 200, `read-back documents ${r.status}`);
      docs.push(...r.json.documents);
      cursor = r.json.nextCursor;
    } while (cursor);
    return docs;
  }
  const getDoc = async (who, recordUrl, id) =>
    (await recordDocs(who, recordUrl, true)).find((d) => d.id === id) ?? null;
  async function waitDoc(who, recordUrl, id, pred) {
    let d;
    for (let i = 0; i < 30; i++) {
      d = await getDoc(who, recordUrl, id);
      if (pred(d)) return d;
      await sleep(300);
    }
    return d;
  }

  const docsSection = (page) => page.getByRole("region", { name: "Documents", exact: true });
  // As in the DOC-030 documents helper: a page that lands on the error boundary is reloaded
  // once with its Reload button, and the event is kept in the log.
  async function openDocuments(page, url) {
    await page.goto(`${BASE}${url}`);
    const heading = docsSection(page).getByRole("heading", { name: "Documents" });
    const broken = page.getByText("Something went wrong.");
    await heading.or(broken).first().waitFor({ timeout: 30000 });
    if (await broken.isVisible().catch(() => false)) {
      results.reloads = [
        ...(results.reloads ?? []),
        {
          url,
          at: new Date().toISOString(),
          text: (await page.locator("body").innerText()).replace(/\s+/g, " ").slice(0, 300),
        },
      ];
      await page.getByRole("button", { name: "Reload" }).click();
      await heading.waitFor({ timeout: 30000 });
    }
    await page.waitForLoadState("networkidle").catch(() => {});
  }
  async function rowMenu(page, title) {
    await page.getByRole("button", { name: `Actions for ${title}`, exact: true }).click();
    const menu = page.getByRole("menu");
    await menu.waitFor();
    return menu;
  }
  async function menuItems(page, title) {
    const menu = await rowMenu(page, title);
    const items = (await menu.getByRole("menuitem").allInnerTexts()).map((t) => t.trim());
    await page.keyboard.press("Escape");
    await menu.waitFor({ state: "hidden" });
    return items;
  }
  async function chooseMenu(page, title, item) {
    const menu = await rowMenu(page, title);
    await menu.getByRole("menuitem", { name: item, exact: true }).click();
  }
  const rowOf = (page, title) =>
    page
      .getByRole("row")
      .filter({ has: page.getByRole("button", { name: `Actions for ${title}`, exact: true }) });
  async function showArchived(page, on) {
    const sw = docsSection(page).getByRole("switch", { name: "Show archived" });
    if ((await sw.getAttribute("aria-checked")) !== String(on)) await sw.click();
    await page.waitForLoadState("networkidle").catch(() => {});
    await sleep(700);
  }
  const bar = (page, n) => page.getByText(`${n} selected`, { exact: true }).locator("xpath=../..");

  const flows = [
    { role: "legal_team_member", who: nadia, label: "Legal" },
    { role: "administrator", who: admin, label: "Admin" },
  ];

  for (const flow of flows) {
    const { role, who, label } = flow;
    const page = who.page;
    const tag = `${label.toLowerCase()}-${STAMP}`;
    const title = `DOC-030 contracts-c archive-and-delete ${label} ${STAMP}`;
    const c = await who.api("POST", "/contracts", { title, contractTypeId });
    expectThat(c.status === 201, `fixture contract ${c.status}`);
    const contract = c.json.contract;
    results.records.push({ role, kind: "contract", reference: `C-${contract.number}`, title });
    const recUrl = `/contracts/${contract.number}`;
    const main = await uploadApi(
      who,
      `${recUrl}/documents`,
      "doc029-draft-v1.docx",
      `archive-main-${tag}.docx`,
    );
    for (const n of [2, 3])
      await addVersion(who, main.id, "doc029-draft-v2.docx", `archive-main-${tag}-v${n}.docx`);
    let doc = await getDoc(who, recUrl, main.id);
    const v2 = doc.versions.find((v) => v.versionNumber === 2);
    expectThat(
      (await who.api("POST", `/documents/${main.id}/executed-version`, { versionId: v2.id }))
        .status < 300,
      "fixture pin",
    );
    if (!(await getDoc(who, recUrl, main.id)).isPrimary)
      expectThat(
        (await who.api("POST", `/documents/${main.id}/primary`, {})).status < 300,
        "fixture primary",
      );
    const b1 = await uploadApi(
      who,
      `${recUrl}/documents`,
      "doc029-bulk-a.txt",
      `archive-bulk-1-${tag}.txt`,
    );
    const b2 = await uploadApi(
      who,
      `${recUrl}/documents`,
      "doc029-bulk-b.txt",
      `archive-bulk-2-${tag}.txt`,
    );
    const r1 = await uploadApi(
      who,
      `${recUrl}/documents`,
      "doc029-bulk-c.txt",
      `archive-repo-${tag}.txt`,
    );
    flow.contract = contract;
    flow.recUrl = recUrl;
    flow.main = main;
    flow.b1 = b1;

    await step(
      role,
      who.name,
      `${recUrl}/documents`,
      "Archive a Document steps 1-3: open the Documents tab, the Document's Actions menu, Archive; check it leaves the list; turn on Show archived",
      "The Document leaves the normal list and reappears marked Archived with Show archived on; its 3 Versions, files, primary mark and executed designation stay.",
      async () => {
        await openDocuments(page, `${recUrl}/documents`);
        const items = await menuItems(page, main.title);
        await chooseMenu(page, main.title, "Archive");
        await rowOf(page, main.title).waitFor({ state: "hidden", timeout: 20000 });
        await showArchived(page, true);
        const row = rowOf(page, main.title);
        await row.getByText("Archived", { exact: true }).waitFor();
        const rowText = (await row.innerText()).replace(/\s+/g, " ");
        const d = await getDoc(who, recUrl, main.id);
        const downloads = [];
        for (const v of d.versions)
          downloads.push(
            (await who.api("GET", `/documents/${main.id}/versions/${v.id}/download`)).status,
          );
        const search = await who.api(
          "GET",
          `/documents?q=${encodeURIComponent(`archive-main-${tag}`)}`,
        );
        const inRepo = JSON.stringify(search.json ?? {}).includes(main.id);
        expectThat(
          items.includes("Archive") &&
            d.archivedAt &&
            d.versions.length === 3 &&
            d.isPrimary &&
            d.versions.find((v) => v.isExecuted)?.versionNumber === 2 &&
            downloads.every((s) => s === 200),
          `archived ${q({ items, a: d.archivedAt, n: d.versions.length, p: d.isPrimary, downloads })}`,
        );
        expectThat(!inRepo, "the archived Document is still in the repository list");
        return `Row menu offered ${q(items)}. Archive removed ${q(main.title)} from the list; Show archived drew ${q(rowText.slice(0, 140))}. Read-back: 3 Versions, still primary, executed designation on Version 2, every Version download 200. The Documents repository search (${search.status}) did not list it.`;
      },
    );

    await step(
      role,
      who.name,
      `${recUrl}/documents`,
      "Restore a Document steps 1-3 on the owning record: Show archived, the row's Actions menu, Restore",
      "The Document is live again with its 3 Versions, its primary mark and its executed designation.",
      async () => {
        await chooseMenu(page, main.title, "Restore");
        const d = await waitDoc(who, recUrl, main.id, (x) => !x.archivedAt);
        await showArchived(page, false);
        const row = rowOf(page, main.title);
        await row.waitFor();
        const text = (await row.innerText()).replace(/\s+/g, " ");
        expectThat(
          !d.archivedAt &&
            d.isPrimary &&
            d.versions.length === 3 &&
            d.versions.find((v) => v.isExecuted)?.versionNumber === 2,
          `restored ${text}`,
        );
        return `Restore in the archived row's Actions menu made it live. With Show archived off its row reads ${q(text.slice(0, 140))}; read-back keeps 3 Versions, primary, executed designation on Version 2.`;
      },
    );

    await step(
      role,
      who.name,
      `${recUrl}/documents`,
      "Archive several live Documents: select their checkboxes and Archive in the selection bar; then, with Show archived on, select both and Restore in the selection bar",
      "Both leave the list together and return together.",
      async () => {
        await page.getByRole("checkbox", { name: `Select ${b1.title}` }).click();
        await page.getByRole("checkbox", { name: `Select ${b2.title}` }).click();
        const barText = (await bar(page, 2).innerText()).replace(/\s+/g, " ");
        await bar(page, 2).getByRole("button", { name: "Archive", exact: true }).click();
        await rowOf(page, b1.title).waitFor({ state: "hidden", timeout: 20000 });
        await rowOf(page, b2.title).waitFor({ state: "hidden", timeout: 20000 });
        await showArchived(page, true);
        await page.getByRole("checkbox", { name: `Select ${b1.title}` }).click();
        await page.getByRole("checkbox", { name: `Select ${b2.title}` }).click();
        await bar(page, 2).getByRole("button", { name: "Restore", exact: true }).click();
        const live = [
          await waitDoc(who, recUrl, b1.id, (x) => !x.archivedAt),
          await waitDoc(who, recUrl, b2.id, (x) => !x.archivedAt),
        ];
        await showArchived(page, false);
        expectThat(
          live.every((d) => !d.archivedAt),
          "bulk restore",
        );
        return `Selection bar for two live Documents read ${q(barText)}; Archive removed both rows. With Show archived on, selecting both and Restore made both live again.`;
      },
    );

    await step(
      role,
      who.name,
      "/documents",
      "Restore a Document step 1 and 2 in the Documents repository: Filter, Show archived, then the repository's Restore action",
      "Without Show archived the archived Document is not listed; with it, the row is marked Archived and Restore makes it live.",
      async () => {
        expectThat(
          (await who.api("POST", `/documents/${r1.id}/archive`, {})).status === 200,
          "fixture archive",
        );
        await page.goto(`${BASE}/documents`);
        await page.waitForLoadState("networkidle").catch(() => {});
        const filterBar = page.getByLabel("Record filters");
        await filterBar.getByRole("button", { name: /^Filter/ }).click();
        let pop = page.getByRole("dialog", { name: "Filter" });
        await pop.waitFor();
        await pop.getByRole("button", { name: "Record", exact: true }).click();
        await pop.getByLabel("Search choices").fill(`C-${contract.number}`);
        await pop.getByText(`C-${contract.number} · ${contract.title}`, { exact: true }).click();
        await pop.getByRole("button", { name: "Apply" }).click();
        await pop.waitFor({ state: "hidden" });
        await page.waitForLoadState("networkidle").catch(() => {});
        await sleep(1000);
        const rowsBefore = (await page.getByRole("row").allInnerTexts()).map((t) =>
          t.replace(/\s+/g, " "),
        );
        const before = rowsBefore.some((t) => t.includes(r1.title));
        const liveListed = rowsBefore.some((t) => t.includes(b1.title));
        await filterBar.getByRole("button", { name: /^Filter/ }).click();
        pop = page.getByRole("dialog", { name: "Filter" });
        await pop.waitFor();
        await pop.getByRole("button", { name: "Show archived", exact: true }).click();
        await page.waitForLoadState("networkidle").catch(() => {});
        await sleep(1200);
        const row = page.getByRole("row").filter({ hasText: r1.title }).first();
        const rowText = (await row.innerText()).replace(/\s+/g, " ");
        await page.getByRole("button", { name: `Restore ${r1.title}` }).click();
        const d = await waitDoc(who, recUrl, r1.id, (x) => !x.archivedAt);
        expectThat(
          !before && liveListed && /Archived/.test(rowText) && !d.archivedAt,
          q({ before, liveListed, rowText, archived: d.archivedAt }),
        );
        return `With the Record filter set to C-${contract.number}, the repository listed its live Documents (${rowsBefore.length - 1} rows) but not the archived one; Filter > Show archived added ${q(rowText.slice(0, 140))}; its Restore action made it live (read-back).`;
      },
    );

    await step(
      role,
      who.name,
      `${recUrl}/documents`,
      "If restoration is refused because the owning record is archived: archive the Contract (setup), try to restore its archived Document, restore the Contract first, then restore the Document",
      "While the Contract is archived there is no Show archived or change control and restoring is refused; after restoring the Contract the Document restores.",
      async () => {
        expectThat(
          (await who.api("POST", `/documents/${b1.id}/archive`, {})).status === 200,
          "fixture doc archive",
        );
        expectThat(
          (await who.api("POST", `${recUrl}/archive`, {})).status === 200,
          "fixture record archive",
        );
        await openDocuments(page, `${recUrl}/documents`);
        const sw = await docsSection(page).getByRole("switch", { name: "Show archived" }).count();
        const upload = await docsSection(page)
          .getByRole("button", { name: "Upload", exact: true })
          .count();
        const seen = [];
        for (const trigger of await docsSection(page)
          .getByRole("button", { name: /^Actions for / })
          .all()) {
          await trigger.click();
          seen.push(
            ...(await page.getByRole("menu").getByRole("menuitem").allInnerTexts()).map((t) =>
              t.trim(),
            ),
          );
          await page.keyboard.press("Escape");
        }
        const changing = seen.filter((t) =>
          /Archive|Restore|Delete|Add version|Move to folder/.test(t),
        ).length;
        const refused = await who.api("POST", `/documents/${b1.id}/restore`, {});
        expectThat(
          (await who.api("POST", `${recUrl}/restore`, {})).status === 200,
          "fixture record restore",
        );
        await openDocuments(page, `${recUrl}/documents`);
        await showArchived(page, true);
        await chooseMenu(page, b1.title, "Restore");
        const d = await waitDoc(who, recUrl, b1.id, (x) => !x.archivedAt);
        await showArchived(page, false);
        expectThat(
          sw === 0 && upload === 0 && changing === 0 && refused.status === 409 && !d.archivedAt,
          q({ sw, upload, changing, refused: refused.status }),
        );
        return `Archived C-${contract.number}: no Show archived switch, no Upload, row menus offered ${q([...new Set(seen)])}; restoring the Document answered ${refused.status} ${q(refused.json?.detail)}. After the Contract was restored, Show archived > Restore made the Document live.`;
      },
    );

    await step(
      role,
      who.name,
      `${recUrl}/documents`,
      "Restore a Document: a second session restores the same archived Document first; this page selects Restore on its stale row, reads the message and reloads",
      "A stale-state message shows; after reload the Document is live.",
      async () => {
        expectThat(
          (await who.api("POST", `/documents/${b2.id}/archive`, {})).status === 200,
          "fixture archive",
        );
        await openDocuments(page, `${recUrl}/documents`);
        await showArchived(page, true);
        await rowOf(page, b2.title).getByText("Archived", { exact: true }).waitFor();
        const other = await sessions.password(who.person);
        const r = await other.api("POST", `/documents/${b2.id}/restore`, {});
        await other.context.close();
        expectThat(r.status === 200, `second session restore ${r.status}`);
        await chooseMenu(page, b2.title, "Restore");
        const alert = docsSection(page)
          .locator('[aria-live="polite"], [role="alert"]')
          .filter({ hasText: /archived|restore|could not|already/i });
        await alert.first().waitFor({ timeout: 15000 });
        const message = (await alert.first().innerText()).trim();
        await page.reload();
        await docsSection(page).getByRole("heading", { name: "Documents" }).waitFor();
        const live = !(await getDoc(who, recUrl, b2.id)).archivedAt;
        expectThat(message.length > 0 && live, `message ${message}`);
        return `A second session restored the Document while this page still showed it archived. Restore on the stale row showed ${q(message)}. After reload it was live.`;
      },
    );

    await step(
      role,
      who.name,
      `/knowledge/<id>`,
      "Archive a Document step 1 in a Knowledge Item's Documents section: Archive from the row's Actions, Show archived, Restore",
      "The Knowledge Documents section archives and restores the same way.",
      async () => {
        const kType = (await who.api("GET", "/knowledge?limit=1")).json.knowledgeItems?.[0]
          ?.knowledgeTypeId;
        const k = await who.api("POST", "/knowledge", {
          title: `DOC-030 contracts-c archive Knowledge ${label} ${STAMP}`,
          knowledgeTypeId: kType,
        });
        expectThat(k.status === 201, `fixture knowledge ${k.status}`);
        const kid = k.json.knowledgeItem.id;
        results.records.push({ role, kind: "knowledge_item", title: k.json.knowledgeItem.title });
        await uploadApi(
          who,
          `/knowledge/${kid}/documents`,
          "doc029-services-text.pdf",
          `knowledge-a-${tag}.pdf`,
        );
        const d2 = await uploadApi(
          who,
          `/knowledge/${kid}/documents`,
          "doc029-bulk-a.txt",
          `knowledge-b-${tag}.txt`,
        );
        await openDocuments(page, `/knowledge/${kid}`);
        await chooseMenu(page, d2.title, "Archive");
        await rowOf(page, d2.title).waitFor({ state: "hidden", timeout: 20000 });
        await showArchived(page, true);
        await rowOf(page, d2.title).getByText("Archived", { exact: true }).waitFor();
        await chooseMenu(page, d2.title, "Restore");
        const live = await waitDoc(who, `/knowledge/${kid}`, d2.id, (x) => x && !x.archivedAt);
        expectThat(live && !live.archivedAt, "knowledge restore");
        return `Knowledge Item ${q(k.json.knowledgeItem.title)}: Archive removed ${q(d2.title)}, Show archived showed it marked Archived, Restore made it live.`;
      },
    );

    if (role === "legal_team_member") {
      await step(
        role,
        who.name,
        `${recUrl}/documents`,
        "Before you start and Permanently delete: a Legal Team Member looks for Delete in the row menu and the selection bar, and tries a direct deletion",
        "No Delete in the row menu or selection bar; direct deletion is refused and the Document stays.",
        async () => {
          await openDocuments(page, `${recUrl}/documents`);
          const items = await menuItems(page, main.title);
          await page.getByRole("checkbox", { name: `Select ${b1.title}` }).click();
          const barDelete = await bar(page, 1)
            .getByRole("button", { name: "Delete", exact: true })
            .count();
          const barButtons = (await bar(page, 1).getByRole("button").allInnerTexts()).map((t) =>
            t.trim(),
          );
          await bar(page, 1).getByRole("button", { name: "Clear selection" }).click();
          const del = await who.api("DELETE", `/documents/${main.id}`, {
            confirmTitle: main.title,
          });
          const d = await getDoc(who, recUrl, main.id);
          expectThat(
            !items.includes("Delete") &&
              barDelete === 0 &&
              del.status === 403 &&
              d?.versions.length === 3,
            q({ items, barDelete, del: del.status }),
          );
          return `Row menu offered ${q(items)} (no Delete). Selection bar offered ${q(barButtons)} (no Delete). Direct deletion answered ${del.status} ${q(del.json?.detail ?? del.json?.title)}; the Document kept its 3 Versions.`;
        },
      );

      await step(
        "legal_team_member",
        `${PEOPLE.mei.name} (Business User on the Contract team)`,
        `/portal/contracts/${contract.number}`,
        "Before you start: a Business User on the Contract team reads its Documents in the Portal and tries archive, restore and delete",
        "No archive, restore, delete or Show archived controls; all three requests are refused.",
        async () => {
          const team = await who.api("POST", `/contracts/${contract.number}/team`, {
            userId: idOf(PEOPLE.mei.email),
          });
          expectThat([200, 201, 409].includes(team.status), `team ${team.status}`);
          expectThat(
            (await who.api("POST", `/documents/${b2.id}/archive`, {})).status === 200,
            "fixture archive",
          );
          const mei = await sessions.magic(PEOPLE.mei);
          try {
            await mei.page.goto(`${BASE}/portal/contracts/${contract.number}`);
            await mei.page
              .getByRole("heading", { name: "Documents" })
              .first()
              .waitFor({ timeout: 30000 });
            await mei.page.waitForLoadState("networkidle").catch(() => {});
            const text = (await mei.page.locator("main").innerText()).replace(/\s+/g, " ");
            const listsLive = text.includes(main.title);
            const archive = await mei.api("POST", `/documents/${main.id}/archive`, {});
            const restore = await mei.api("POST", `/documents/${b2.id}/restore`, {});
            const del = await mei.api("DELETE", `/documents/${main.id}`, {
              confirmTitle: main.title,
            });
            const stillArchived = (await getDoc(who, recUrl, b2.id))?.archivedAt;
            expectThat(
              !/\bArchive\b|\bRestore\b|\bDelete\b|Show archived/.test(text) &&
                archive.status >= 400 &&
                restore.status >= 400 &&
                del.status >= 400 &&
                stillArchived &&
                listsLive,
              q({ archive: archive.status, restore: restore.status, del: del.status, listsLive }),
            );
            return `Team add answered ${team.status}; Mei Tanaka signed in with a fresh magic link. The Portal Contract page lists ${q(main.title)} and shows no Archive, Restore, Delete or Show archived control. Archive answered ${archive.status}, restore ${restore.status}, delete ${del.status}; the archived Document stayed archived.`;
          } finally {
            await mei.context.close();
            await who.api("POST", `/documents/${b2.id}/restore`, {});
          }
        },
      );
      continue;
    }

    await step(
      role,
      who.name,
      `${recUrl}/documents`,
      "Permanently delete steps 1-4: Actions, Delete; read Delete this document?; try Delete with the field empty and with the Document name; Cancel",
      "The dialog names the Document and its 3 Versions; Delete stays disabled until the word delete is typed; Cancel keeps the Document.",
      async () => {
        await openDocuments(page, `${recUrl}/documents`);
        await chooseMenu(page, main.title, "Delete");
        const dialog = page.getByRole("dialog", { name: "Delete this document?" });
        await dialog.waitFor();
        const text = (await dialog.innerText()).replace(/\s+/g, " ");
        await page.screenshot({ path: path.join(here, "administrator-delete-dialog.png") });
        const button = dialog.getByRole("button", { name: `Delete ${main.title}` });
        const disabledEmpty = await button.isDisabled();
        await dialog.getByLabel('Type "delete" to confirm').fill(main.title);
        const disabledWrong = await button.isDisabled();
        await dialog.getByRole("button", { name: "Cancel" }).click();
        await dialog.waitFor({ state: "hidden" });
        const d = await getDoc(who, recUrl, main.id);
        expectThat(
          text.includes(main.title) &&
            /3 versions/.test(text) &&
            disabledEmpty &&
            disabledWrong &&
            d?.versions.length === 3,
          `text ${text} disabled ${disabledEmpty}/${disabledWrong}`,
        );
        return `Delete opened "Delete this document?" reading ${q(text.slice(0, 260))}. Delete stayed disabled with the field empty and with the Document name typed. Cancel closed it; the Document kept 3 Versions.`;
      },
    );

    await step(
      role,
      who.name,
      `${recUrl}/documents`,
      "If deletion fails: someone renames the Document while the Delete dialog is open; type delete and select Delete",
      "OpenLaw refuses the deletion with a message and the Document stays under its new name.",
      async () => {
        await chooseMenu(page, b2.title, "Delete");
        const dialog = page.getByRole("dialog", { name: "Delete this document?" });
        await dialog.waitFor();
        const renamed = `${b2.title} renamed`;
        const patch = await who.api("PATCH", `/documents/${b2.id}`, { title: renamed });
        expectThat(patch.status === 200, `fixture rename ${patch.status}`);
        await dialog.getByLabel('Type "delete" to confirm').fill("delete");
        await dialog.getByRole("button", { name: `Delete ${b2.title}` }).click();
        const alert = dialog.getByRole("alert");
        await alert.waitFor({ timeout: 15000 });
        const message = (await alert.innerText()).trim();
        await dialog.getByRole("button", { name: "Cancel" }).click();
        const d = await getDoc(who, recUrl, b2.id);
        expectThat(d && d.title === renamed, "document gone after refused delete");
        return `With the dialog open, a second request renamed the Document. Delete was refused with ${q(message)}; the Document remains as ${q(d.title)}.`;
      },
    );

    await step(
      role,
      who.name,
      `${recUrl}/documents`,
      "Permanently delete steps 3-4 on an archived Document: Show archived, archive the primary Document first, Actions > Delete, type delete, Delete; check the row, Version downloads, primary reference and activity",
      "The row is gone (archived rows included); every Version download fails; no other Document becomes primary; the activity record of the deletion remains.",
      async () => {
        await openDocuments(page, `${recUrl}/documents`);
        await chooseMenu(page, main.title, "Archive");
        await rowOf(page, main.title).waitFor({ state: "hidden", timeout: 20000 });
        await showArchived(page, true);
        const before = await getDoc(who, recUrl, main.id);
        const contractId = (await who.api("GET", recUrl)).json.contract.id;
        await chooseMenu(page, main.title, "Delete");
        const dialog = page.getByRole("dialog", { name: "Delete this document?" });
        await dialog.getByLabel('Type "delete" to confirm').fill("delete");
        await dialog.getByRole("button", { name: `Delete ${main.title}` }).click();
        await dialog.waitFor({ state: "hidden", timeout: 20000 });
        await rowOf(page, main.title).waitFor({ state: "hidden" });
        const downloads = [];
        for (const v of before.versions)
          downloads.push(
            (await who.api("GET", `/documents/${main.id}/versions/${v.id}/download`)).status,
          );
        const docs = await recordDocs(who, recUrl, true);
        const activity = await who.api(
          "GET",
          `/activity?entityType=contract&entityId=${contractId}`,
        );
        const mention = JSON.stringify(activity.json ?? {}).includes(main.title);
        const primaryNow = (await who.api("GET", recUrl)).json.contract.primaryDocumentId ?? null;
        expectThat(
          !docs.some((d) => d.id === main.id) &&
            downloads.every((s) => s === 404) &&
            !docs.some((d) => d.isPrimary) &&
            mention,
          q({
            downloads,
            primary: docs.filter((d) => d.isPrimary).length,
            activity: activity.status,
            mention,
          }),
        );
        return `Archived first, then with Show archived on, Delete and typing delete removed ${q(main.title)} (gone with archived rows included). The ${before.versions.length} Version downloads answered ${downloads.join(", ")}. No remaining Document is primary (contract primaryDocumentId ${q(primaryNow)}). The Contract activity read (${activity.status}) still names the Document.`;
      },
    );

    await step(
      role,
      who.name,
      `${recUrl}/documents`,
      "Permanently delete several Documents: select their checkboxes, Delete in the selection bar, type delete",
      "The bulk dialog asks for the word delete and removes both.",
      async () => {
        const c1 = await uploadApi(
          who,
          `${recUrl}/documents`,
          "doc029-bulk-c.txt",
          `archive-del-1-${tag}.txt`,
        );
        const c2 = await uploadApi(
          who,
          `${recUrl}/documents`,
          "doc029-bulk-d.txt",
          `archive-del-2-${tag}.txt`,
        );
        await openDocuments(page, `${recUrl}/documents`);
        await page.getByRole("checkbox", { name: `Select ${c1.title}` }).click();
        await page.getByRole("checkbox", { name: `Select ${c2.title}` }).click();
        await bar(page, 2).getByRole("button", { name: "Delete", exact: true }).click();
        const dialog = page.getByRole("dialog", { name: "Delete 2 documents?" });
        await dialog.waitFor();
        const text = (await dialog.innerText()).replace(/\s+/g, " ");
        const confirm = dialog.getByRole("button", { name: "Delete", exact: true });
        const disabled = await confirm.isDisabled();
        await dialog.getByLabel('Type "delete" to confirm').fill("delete");
        await confirm.click();
        await dialog.waitFor({ state: "hidden", timeout: 20000 });
        const docs = await recordDocs(who, recUrl, true);
        expectThat(
          disabled && !docs.some((d) => d.id === c1.id || d.id === c2.id),
          `disabled ${disabled}`,
        );
        return `The selection bar's Delete opened "Delete 2 documents?" reading ${q(text.slice(0, 200))}. Delete was disabled until delete was typed; then both Documents were removed.`;
      },
    );

    await step(
      role,
      who.name,
      `${recUrl}/documents`,
      "You cannot delete just one Version: open an earlier Version's actions and the Version rows' Type column",
      "No Version-level Delete; the Version rows carry a Type control for correcting a Version's Document type; a single-Version delete request is refused.",
      async () => {
        const d = await uploadApi(
          who,
          `${recUrl}/documents`,
          "doc029-draft-v1.docx",
          `archive-keep-${tag}.docx`,
        );
        await addVersion(who, d.id, "doc029-draft-v2.docx", `archive-keep-${tag}-v2.docx`);
        await openDocuments(page, `${recUrl}/documents`);
        await page
          .getByRole("button", { name: `Show the 1 earlier version of ${d.title}` })
          .click();
        await page
          .getByRole("button", { name: `Actions for version 1 of ${d.title}`, exact: true })
          .click();
        const items = (await page.getByRole("menu").getByRole("menuitem").allInnerTexts()).map(
          (t) => t.trim(),
        );
        await page.keyboard.press("Escape");
        const typeSelects = await page
          .getByLabel(
            new RegExp(
              `^Type of version \\d+ of ${d.title.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`,
            ),
          )
          .count();
        const header = await docsSection(page).getByRole("columnheader", { name: "Type" }).count();
        const fresh = await getDoc(who, recUrl, d.id);
        const v1 = fresh.versions.find((v) => v.versionNumber === 1);
        const del = await who.api("DELETE", `/documents/${d.id}/versions/${v1.id}`);
        const after = await getDoc(who, recUrl, d.id);
        expectThat(
          !items.some((i) => /Delete/.test(i)) &&
            del.status >= 400 &&
            after.versions.length === 2 &&
            typeSelects >= 1 &&
            header >= 1,
          q({ items, del: del.status, typeSelects, header }),
        );
        return `The earlier Version's menu offered ${q(items)} (no Delete). The Documents table has a Type column (${header}) with ${typeSelects} Type controls on this Document's Version rows. A request to delete one Version answered ${del.status}; the Document kept both Versions.`;
      },
    );
  }

  await step(
    "administrator",
    PEOPLE.daniel.name,
    "docs/user-guides/archive-and-delete-documents.md",
    "Guide text check: the labels walked are in the reviewed content",
    "The guide names Actions, Archive, Show archived, Archived, Restore, Filter, Delete, Delete this document? and the Type column.",
    async () => {
      const text = articleText(ARTICLE);
      for (const label of [
        "**Actions**",
        "**Archive**",
        "**Show archived**",
        "**Archived**",
        "**Restore**",
        "**Filter**",
        "**Delete**",
        "**Delete this document?**",
        "**Type**",
        '**Type "delete" to confirm**',
      ])
        expectThat(text.includes(label), `guide lacks ${label}`);
      return "All ten labels are in the reviewed guide text.";
    },
  );
  await admin.context.close();
  await nadia.context.close();
}
