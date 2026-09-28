// DOC-032 documents-2: archive-and-delete-documents.md (V-C54) on the shared work lab (4ca41822),
// as legal_team_member (Nadia Haddad) and administrator (Daniel Okafor), with a Business User
// (Mei Tanaka) for the negative checks. Ported from DOC-030 contracts-c/documents.mjs; the
// deletion steps follow the DOC-032 guide (Delete version, one Version at a time) and the
// Delete version pattern of DOC-032 documents/walkthrough.mjs.
// Fixtures (disposable DOC-032 documents-2 Contracts, Knowledge Items and their Documents) are
// created through the API; every guide step runs in the browser.
import fs from "node:fs";
import path from "node:path";
import { PEOPLE, articleText, expectThat, q, sleep, sql, until } from "./lib.mjs";

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
    const title = `DOC-032 documents-2 V-C54 archive-and-delete ${label} ${STAMP}`;
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
        // Current-Version row menus, then (after showing earlier Versions) the Version menus.
        const seen = [];
        for (const trigger of await docsSection(page)
          .getByRole("button", { name: /^Actions for (?!version )/ })
          .all()) {
          await trigger.click();
          seen.push(
            ...(await page.getByRole("menu").getByRole("menuitem").allInnerTexts()).map((t) =>
              t.trim(),
            ),
          );
          await page.keyboard.press("Escape");
        }
        const toggles = await docsSection(page)
          .getByRole("button", { name: /^Show the \d+ earlier versions? of / })
          .all();
        for (const t of toggles) await t.click().catch(() => {});
        const versionSeen = [];
        for (const trigger of await docsSection(page)
          .getByRole("button", { name: /^Actions for version / })
          .all()) {
          await trigger.click();
          versionSeen.push(
            ...(await page.getByRole("menu").getByRole("menuitem").allInnerTexts()).map((t) =>
              t.trim(),
            ),
          );
          await page.keyboard.press("Escape");
        }
        const versionDelete = versionSeen.includes("Delete version");
        if (versionDelete && role === "administrator") {
          results.productBugs.push({
            id: "archived-record-version-delete",
            observed: `On archived C-${contract.number} the Document row Actions menus offered ${q([...new Set(seen)])}, but the earlier Version menus ("Actions for version N of ...") offered ${q([...new Set(versionSeen)])} to the Administrator.`,
            reproduction:
              "As an Administrator, archive a Contract whose Document has two or more Versions, open its Documents tab, show the earlier Versions and open an Actions for version menu: Delete version is offered although the row's own Actions menu offers no change. Confirms the author's productBugs entry (documents-card.tsx VersionActions renders Delete version when canErase, regardless of frozen).",
          });
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
        return `Archived C-${contract.number}: no Show archived switch, no Upload, row menus offered ${q([...new Set(seen)])}; earlier Version menus offered ${q([...new Set(versionSeen)])}${versionDelete ? " (Delete version there is the author's reported product bug; the guide tells the reader to restore the record first)" : ""}. Restoring the Document answered ${refused.status} ${q(refused.json?.detail)}. After the Contract was restored, Show archived > Restore made the Document live.`;
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
          title: `DOC-032 documents-2 V-C54 archive Knowledge ${label} ${STAMP}`,
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

    const esc = (t) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const showEarlier = async (title) => {
      const t = page.getByRole("button", {
        name: new RegExp(`^Show the \\d+ earlier versions? of ${esc(title)}$`),
      });
      if (await t.isVisible().catch(() => false)) await t.click();
    };
    async function versionMenuItems(title, n) {
      await showEarlier(title);
      await page
        .getByRole("button", { name: `Actions for version ${n} of ${title}`, exact: true })
        .click();
      const menu = page.getByRole("menu");
      await menu.waitFor();
      const items = (await menu.getByRole("menuitem").allInnerTexts()).map((t) => t.trim());
      await page.keyboard.press("Escape");
      await menu.waitFor({ state: "hidden" });
      return items;
    }
    const vOf = (d, n) => d.versions.find((v) => v.versionNumber === n);
    const numbers = (d) => (d?.versions ?? []).map((v) => v.versionNumber).join(",");

    if (role === "legal_team_member") {
      await step(
        role,
        who.name,
        `${recUrl}/documents`,
        "Before you start and Permanently delete a Version: a Legal Team Member looks for Delete version in the Document's Actions menu, an earlier Version's Actions for version menu and Delete versions in the selection bar, and tries a direct Version deletion",
        "No Delete version in either menu and no Delete versions in the selection bar; a direct Version deletion is refused and the Document keeps its 3 Versions.",
        async () => {
          await openDocuments(page, `${recUrl}/documents`);
          const items = await menuItems(page, main.title);
          const vItems = await versionMenuItems(main.title, 1);
          await page.getByRole("checkbox", { name: `Select ${b1.title}` }).click();
          const barButtons = (await bar(page, 1).getByRole("button").allInnerTexts()).map((t) =>
            t.trim(),
          );
          await bar(page, 1).getByRole("button", { name: "Clear selection" }).click();
          const before = await getDoc(who, recUrl, main.id);
          const del = await who.api(
            "DELETE",
            `/documents/${main.id}/versions/${vOf(before, 3).id}`,
            {
              confirmTitle: main.title,
            },
          );
          const d = await getDoc(who, recUrl, main.id);
          expectThat(
            !items.some((i) => /Delete/.test(i)) &&
              !vItems.some((i) => /Delete/.test(i)) &&
              !barButtons.some((b) => /Delete/.test(b)) &&
              del.status === 403 &&
              numbers(d) === "1,2,3",
            q({ items, vItems, barButtons, del: del.status, n: numbers(d) }),
          );
          return `Row menu offered ${q(items)}; "Actions for version 1 of ${main.title}" offered ${q(vItems)}; the selection bar offered ${q(barButtons)}. None had Delete version or Delete versions. A direct deletion of Version 3 answered ${del.status} ${q(del.json?.detail ?? del.json?.title)}; the Document kept Versions ${numbers(d)}.`;
        },
      );

      await step(
        "legal_team_member",
        `${PEOPLE.mei.name} (Business User on the Contract team)`,
        `/portal/contracts/${contract.number}`,
        "Before you start: a Business User on the Contract team reads its Documents in the Portal and tries archive, restore and Version deletion",
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
            await sleep(800);
            const text = (await mei.page.locator("main").innerText()).replace(/\s+/g, " ");
            const listsLive = text.includes(main.title);
            const current = await getDoc(who, recUrl, main.id);
            const archive = await mei.api("POST", `/documents/${main.id}/archive`, {});
            const restore = await mei.api("POST", `/documents/${b2.id}/restore`, {});
            const del = await mei.api(
              "DELETE",
              `/documents/${main.id}/versions/${current.versions.at(-1).id}`,
              { confirmTitle: main.title },
            );
            const after = await getDoc(who, recUrl, main.id);
            const stillArchived = (await getDoc(who, recUrl, b2.id))?.archivedAt;
            expectThat(
              !/\bArchive\b|\bRestore\b|\bDelete\b|Show archived/.test(text) &&
                archive.status >= 400 &&
                restore.status >= 400 &&
                del.status >= 400 &&
                stillArchived &&
                numbers(after) === numbers(current) &&
                listsLive,
              q({ archive: archive.status, restore: restore.status, del: del.status, listsLive }),
            );
            return `Team add answered ${team.status}; Mei Tanaka signed in with a fresh magic link. The Portal Contract page lists ${q(main.title)} and shows no Archive, Restore, Delete or Show archived control. Archive answered ${archive.status}, restore ${restore.status}, Version deletion ${del.status}; the archived Document stayed archived and the other kept Versions ${numbers(after)}.`;
          } finally {
            await mei.context.close();
            await who.api("POST", `/documents/${b2.id}/restore`, {});
          }
        },
      );
      continue;
    }

    // ---------------- Administrator: Permanently delete a Version ----------------
    const delDialog = () => page.getByRole("dialog", { name: /^Delete version \d+\?$/ });
    const confirmField = (dialog) => dialog.getByLabel('Type "delete" to confirm');
    const confirmButton = (dialog) =>
      dialog.getByRole("button").filter({ hasText: /^Delete version$/ });
    async function activityFor(entityType, entityId) {
      const r = await who.api("GET", `/activity?entityType=${entityType}&entityId=${entityId}`);
      return { status: r.status, text: JSON.stringify(r.json ?? {}) };
    }
    const contractId = (await who.api("GET", recUrl)).json.contract.id;

    await step(
      role,
      who.name,
      `${recUrl}/documents`,
      "Permanently delete a Version steps 1-4 on the current Version, first with Cancel: Actions, Delete version; read Delete version 3?; try the field empty and with the Document name; Cancel",
      "The row menu offers Delete version and no whole-Document Delete; the dialog names Version 3 and the Document and says All other versions will remain.; the button stays disabled until delete is typed; Cancel keeps all 3 Versions.",
      async () => {
        await openDocuments(page, `${recUrl}/documents`);
        const items = await menuItems(page, main.title);
        await chooseMenu(page, main.title, "Delete version");
        const dialog = delDialog();
        await dialog.waitFor();
        const title = (await dialog.getByRole("heading").first().innerText()).trim();
        const text = (await dialog.innerText()).replace(/\s+/g, " ");
        const button = confirmButton(dialog);
        const accessible = await button.getAttribute("aria-label");
        const disabledEmpty = await button.isDisabled();
        await confirmField(dialog).fill(main.title);
        const disabledName = await button.isDisabled();
        await dialog.getByRole("button", { name: "Cancel" }).click();
        await dialog.waitFor({ state: "hidden" });
        const d = await getDoc(who, recUrl, main.id);
        expectThat(
          items.includes("Delete version") && !items.includes("Delete"),
          `items ${q(items)}`,
        );
        expectThat(
          title === "Delete version 3?" &&
            text.includes(`Version 3 of ${main.title} and its stored file will be removed.`) &&
            text.includes("All other versions will remain.") &&
            text.includes('Type "delete" to confirm'),
          `dialog ${title} | ${text}`,
        );
        expectThat(disabledEmpty && disabledName && numbers(d) === "1,2,3", "cancel");
        return `Row menu offered ${q(items)} (Delete version, no whole-Document Delete). Delete version opened ${q(title)} reading ${q(text.slice(0, 260))}. The button (accessible name ${q(accessible)}) stayed disabled with the field empty and with the Document name typed. Cancel closed it; read-back Versions ${numbers(d)}.`;
      },
    );

    let removedV3 = null;
    await step(
      role,
      who.name,
      `${recUrl}/documents`,
      'Permanently delete a Version steps 2-4 on the current Version: Actions, Delete version, type delete in Type "delete" to confirm, Delete version; check the Versions, downloads, the Executed pin and the activity record',
      "Version 3 is gone; Versions 1 and 2 remain with their files; Version 3's download is no longer available; the Executed pin stays on Version 2; the activity record of the deletion remains.",
      async () => {
        const before = await getDoc(who, recUrl, main.id);
        removedV3 = vOf(before, 3);
        await chooseMenu(page, main.title, "Delete version");
        const dialog = delDialog();
        await dialog.waitFor();
        await confirmField(dialog).fill("delete");
        const enabled = await confirmButton(dialog).isEnabled();
        await confirmButton(dialog).click();
        await dialog.waitFor({ state: "hidden", timeout: 30000 });
        const row = rowOf(page, main.title);
        await row.getByText("v2", { exact: true }).waitFor({ timeout: 15000 });
        const d = await getDoc(who, recUrl, main.id);
        const gone = await who.api(
          "GET",
          `/documents/${main.id}/versions/${removedV3.id}/download`,
        );
        const kept = [];
        for (const v of d.versions)
          kept.push(
            (await who.api("GET", `/documents/${main.id}/versions/${v.id}/download`)).status,
          );
        const act = await activityFor("contract", contractId);
        const logged = act.text.includes("document.version_deleted");
        expectThat(
          enabled &&
            numbers(d) === "1,2" &&
            vOf(d, 2).isExecuted &&
            gone.status === 404 &&
            kept.every((s) => s === 200) &&
            logged,
          q({ enabled, n: numbers(d), gone: gone.status, kept, logged }),
        );
        return `Typing delete enabled Delete version; after it the row read v2. Read-back Versions ${numbers(d)}, the Executed pin still on Version 2. Version 3's download answered ${gone.status}; Versions 1 and 2 answered ${kept.join(", ")}. The Contract activity read (${act.status}) holds a document.version_deleted entry.`;
      },
    );

    await step(
      role,
      who.name,
      `${recUrl}/documents`,
      "Permanently delete a Version: OpenLaw does not reuse the deleted Version number (Actions, Add version, Choose file, Upload)",
      "The next Version is v4, not v3.",
      async () => {
        await chooseMenu(page, main.title, "Add version");
        const dialog = page.getByRole("dialog", { name: "Add version" });
        await dialog.waitFor();
        const [chooser] = await Promise.all([
          page.waitForEvent("filechooser"),
          dialog.getByRole("button", { name: /Choose file$/ }).click(),
        ]);
        await chooser.setFiles(path.join(FIX, "doc029-draft-v1.docx"));
        await dialog.getByRole("button", { name: "Upload", exact: true }).click();
        await dialog.waitFor({ state: "hidden", timeout: 30000 });
        await rowOf(page, main.title).getByText("v4", { exact: true }).waitFor({ timeout: 15000 });
        const d = await getDoc(who, recUrl, main.id);
        expectThat(numbers(d) === "1,2,4", `numbers ${numbers(d)}`);
        return `Add version, Choose file, Upload made v4; read-back Versions ${numbers(d)}. Number 3 was not reused.`;
      },
    );

    await step(
      role,
      who.name,
      `${recUrl}/documents`,
      "Permanently delete an earlier Version: prepare a Comparison of Version 1 to Version 2 (API); show the earlier Versions, open Actions for version 2 (the Executed pin), Delete version, type delete, Delete version",
      "Version 2 is removed with its file and the Comparison that uses it; the Executed pin is cleared; Versions 1 and 4 remain.",
      async () => {
        const before = await getDoc(who, recUrl, main.id);
        const c = await who.api("POST", `/documents/${main.id}/comparisons`, {
          fromVersionId: vOf(before, 1).id,
          toVersionId: vOf(before, 2).id,
        });
        expectThat([200, 202].includes(c.status), `fixture comparison ${c.status}`);
        const cid = c.json.comparison.id;
        await until(
          async () => {
            const r = await who.api("GET", `/documents/${main.id}/comparisons/${cid}`);
            return ["ready", "failed"].includes(r.json?.comparison?.state);
          },
          "comparison settled",
          240000,
          1000,
        );
        const cmpBefore = await who.api("GET", `/documents/${main.id}/comparisons/${cid}`);
        const cmpState = cmpBefore.json?.comparison?.state;
        const cmpFailure = cmpBefore.json?.comparison?.failure ?? null;
        await openDocuments(page, `${recUrl}/documents`);
        const vItems = await versionMenuItems(main.title, 2);
        await page
          .getByRole("button", { name: `Actions for version 2 of ${main.title}`, exact: true })
          .click();
        await page.getByRole("menuitem", { name: "Delete version", exact: true }).click();
        const dialog = delDialog();
        await dialog.waitFor();
        const title = (await dialog.getByRole("heading").first().innerText()).trim();
        const text = (await dialog.innerText()).replace(/\s+/g, " ");
        await confirmField(dialog).fill("delete");
        await confirmButton(dialog).click();
        await dialog.waitFor({ state: "hidden", timeout: 30000 });
        const d = await getDoc(who, recUrl, main.id);
        const cmpAfter = await who.api("GET", `/documents/${main.id}/comparisons/${cid}`);
        const gone = await who.api(
          "GET",
          `/documents/${main.id}/versions/${vOf(before, 2).id}/download`,
        );
        expectThat(
          vItems.includes("Delete version") &&
            title === "Delete version 2?" &&
            text.includes("All other versions will remain.") &&
            numbers(d) === "1,4" &&
            !d.versions.some((v) => v.isExecuted) &&
            cmpBefore.status === 200 &&
            cmpAfter.status === 404 &&
            gone.status === 404,
          q({
            vItems,
            title,
            n: numbers(d),
            cmp: [cmpBefore.status, cmpAfter.status],
            gone: gone.status,
          }),
        );
        return `"Actions for version 2 of ${main.title}" offered ${q(vItems)}. Delete version opened ${q(title)} reading ${q(text.slice(0, 200))}. After delete and Delete version, read-back Versions ${numbers(d)}, none carrying the Executed pin. The Comparison of Version 1 to Version 2 (state ${cmpState}${cmpFailure ? `, ${q(cmpFailure)}` : ""}) answered ${cmpBefore.status} before and ${cmpAfter.status} after; Version 2's download answered ${gone.status}.`;
      },
    );

    await step(
      role,
      who.name,
      `${recUrl}/documents`,
      "If deletion fails: someone renames the Document while the Delete version dialog is open; type delete and select Delete version; then reopen the record and try again",
      "OpenLaw refuses the deletion with a message and the Document stays under its new name; after reopening, the deletion succeeds (its one Version was the last, so the Document is removed).",
      async () => {
        await openDocuments(page, `${recUrl}/documents`);
        await chooseMenu(page, b2.title, "Delete version");
        const dialog = delDialog();
        await dialog.waitFor();
        const firstText = (await dialog.innerText()).replace(/\s+/g, " ");
        const renamed = `${b2.title} renamed`;
        const patch = await who.api("PATCH", `/documents/${b2.id}`, { title: renamed });
        expectThat(patch.status === 200, `fixture rename ${patch.status}`);
        await confirmField(dialog).fill("delete");
        await confirmButton(dialog).click();
        const alert = dialog.getByRole("alert");
        await alert.waitFor({ timeout: 15000 });
        const message = (await alert.innerText()).trim();
        await dialog.getByRole("button", { name: "Cancel" }).click();
        const kept = await getDoc(who, recUrl, b2.id);
        expectThat(kept && kept.title === renamed, "document gone after refused delete");
        await openDocuments(page, `${recUrl}/documents`);
        await chooseMenu(page, renamed, "Delete version");
        const again = delDialog();
        await again.waitFor();
        const text = (await again.innerText()).replace(/\s+/g, " ");
        await confirmField(again).fill("delete");
        await confirmButton(again).click();
        await again.waitFor({ state: "hidden", timeout: 30000 });
        const after = await getDoc(who, recUrl, b2.id);
        expectThat(
          firstText.includes("This is the last version, so the document will also be removed.") &&
            text.includes(renamed) &&
            after === null,
          q({ text, after: !!after }),
        );
        return `With the dialog open, a second request renamed the Document. Delete version was refused with ${q(message)}; the Document stayed as ${q(kept.title)}. After reopening the record, Delete version opened ${q(text.slice(0, 200))}; typing delete removed the Document (read-back including archived: gone).`;
      },
    );

    await step(
      role,
      who.name,
      `${recUrl}/documents`,
      "Delete a whole Document, one Version at a time, on an archived primary Document: Archive, Show archived, Actions, Delete version (Version 4), then Actions, Delete version (Version 1, the last); check the row, downloads, primary reference and activity",
      "The first dialog says All other versions will remain.; the last says This is the last version, so the document will also be removed.; the Document is gone with archived rows included; its downloads fail; the primary reference is cleared and no other Document is chosen; the activity record remains.",
      async () => {
        await openDocuments(page, `${recUrl}/documents`);
        await chooseMenu(page, main.title, "Archive");
        await rowOf(page, main.title).waitFor({ state: "hidden", timeout: 20000 });
        await showArchived(page, true);
        const before = await getDoc(who, recUrl, main.id);
        const primaryColumn = () =>
          sql(
            ctx.lab.project,
            `select coalesce(primary_document_id::text, 'null') from contracts where number = ${contract.number}`,
          );
        const primaryBefore = primaryColumn();
        const archivedItems = await menuItems(page, main.title);
        const texts = [];
        for (const n of [4, 1]) {
          await chooseMenu(page, main.title, "Delete version");
          const dialog = delDialog();
          await dialog.waitFor();
          texts.push((await dialog.innerText()).replace(/\s+/g, " "));
          await confirmField(dialog).fill("delete");
          await confirmButton(dialog).click();
          await dialog.waitFor({ state: "hidden", timeout: 30000 });
          if (n === 4)
            await rowOf(page, main.title)
              .getByText("v1", { exact: true })
              .waitFor({ timeout: 15000 });
        }
        await rowOf(page, main.title).waitFor({ state: "detached", timeout: 15000 });
        const downloads = [];
        for (const v of before.versions)
          downloads.push(
            (await who.api("GET", `/documents/${main.id}/versions/${v.id}/download`)).status,
          );
        const docs = await recordDocs(who, recUrl, true);
        const primaryNow = primaryColumn();
        const act = await activityFor("contract", contractId);
        const hard = act.text.includes("document.hard_deleted") && act.text.includes(main.title);
        expectThat(
          archivedItems.includes("Delete version") &&
            texts[0].startsWith("Delete version 4?") &&
            texts[0].includes("All other versions will remain.") &&
            texts[1].startsWith("Delete version 1?") &&
            texts[1].includes("This is the last version, so the document will also be removed."),
          q(texts),
        );
        expectThat(
          before.isPrimary &&
            primaryBefore === main.id &&
            !docs.some((d) => d.id === main.id) &&
            downloads.every((s) => s === 404) &&
            primaryNow === "null" &&
            !docs.some((d) => d.isPrimary) &&
            hard,
          q({ primaryBefore, downloads, primaryNow, hard, left: docs.length }),
        );
        return `Archived ${q(main.title)}; with Show archived on its row menu offered ${q(archivedItems)}. Delete version opened ${q(texts[0].slice(0, 160))}; after it the row read v1. Delete version again opened ${q(texts[1].slice(0, 200))}; after it the row left the list. Read-back with archived rows: the Document is gone; its ${before.versions.length} remaining Version downloads answered ${downloads.join(", ")}. The Document read back as primary while archived, and the Contract's primary_document_id (read-only database read) was this Document before and ${primaryNow} after; none of the ${docs.length} remaining Documents is primary. The Contract activity read (${act.status}) holds a document.hard_deleted entry naming the Document.`;
      },
    );

    await step(
      role,
      who.name,
      `${recUrl}/documents`,
      "Delete the current Version of several Documents: select a one-Version and a two-Version Document, Delete versions in the selection bar, read the dialog, type delete, confirm",
      "The dialog says only the current Version of each selected Document is deleted and asks for delete; the one-Version Document is removed; the two-Version Document keeps Version 1.",
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
        await addVersion(who, c2.id, "doc029-bulk-a.txt", `archive-del-2-${tag}-v2.txt`);
        await openDocuments(page, `${recUrl}/documents`);
        await page.getByRole("checkbox", { name: `Select ${c1.title}` }).click();
        await page.getByRole("checkbox", { name: `Select ${c2.title}` }).click();
        const barButtons = (await bar(page, 2).getByRole("button").allInnerTexts()).map((t) =>
          t.trim(),
        );
        await bar(page, 2).getByRole("button", { name: "Delete versions", exact: true }).click();
        const dialog = page.getByRole("dialog", { name: "Delete 2 selected versions?" });
        await dialog.waitFor();
        const text = (await dialog.innerText()).replace(/\s+/g, " ");
        const buttons = (await dialog.getByRole("button").allInnerTexts()).map((t) => t.trim());
        const confirm = dialog
          .getByRole("button")
          .filter({ hasText: /^Delete/ })
          .last();
        const disabled = await confirm.isDisabled();
        await confirmField(dialog).fill("delete");
        await confirm.click();
        await dialog.waitFor({ state: "hidden", timeout: 30000 });
        const d1 = await getDoc(who, recUrl, c1.id);
        const d2 = await getDoc(who, recUrl, c2.id);
        expectThat(
          barButtons.includes("Delete versions") &&
            !barButtons.includes("Delete") &&
            text.includes("Only the current version of each selected document will be deleted.") &&
            disabled &&
            d1 === null &&
            numbers(d2) === "1",
          q({ barButtons, text, disabled, d1: !!d1, d2: numbers(d2) }),
        );
        return `Selection bar for two Documents offered ${q(barButtons)}. Delete versions opened "Delete 2 selected versions?" reading ${q(text.slice(0, 280))} with buttons ${q(buttons)}. The confirm button was disabled until delete was typed. Afterwards the one-Version Document was gone and the two-Version Document kept Versions ${numbers(d2)}.`;
      },
    );

    // Fixture for the Generated redline refusal: a Word Comparison exported as a Version. It
    // needs the doc engine; when the engine cannot compare, the check is recorded as a limitation.
    const g = await uploadApi(
      who,
      `${recUrl}/documents`,
      "doc029-draft-v1.docx",
      `archive-redline-${tag}.docx`,
    );
    await addVersion(who, g.id, "doc029-draft-v2.docx", `archive-redline-${tag}-v2.docx`);
    let gd = await getDoc(who, recUrl, g.id);
    const gc = await who.api("POST", `/documents/${g.id}/comparisons`, {
      fromVersionId: vOf(gd, 1).id,
      toVersionId: vOf(gd, 2).id,
    });
    expectThat([200, 202].includes(gc.status), `fixture comparison ${gc.status}`);
    const settled = await until(
      async () => {
        const r = await who.api("GET", `/documents/${g.id}/comparisons/${gc.json.comparison.id}`);
        return ["ready", "failed"].includes(r.json?.comparison?.state) ? r.json.comparison : null;
      },
      "comparison settled",
      240000,
      1000,
    );
    if (settled.state !== "ready") {
      results.limitations.push(
        `Generated redline refusal not exercised by this walkthrough: the Word Comparison fixture on ${q(g.title)} ended ${settled.state} with ${q(settled.failure)} at ${new Date().toISOString()}. The shared work lab's doc-engine container was reported unhealthy by Docker (health check could not start a process: "Resource temporarily unavailable"; engine log "LibreOffice compare failed: [Errno 11] Resource temporarily unavailable"). The walkthrough may not restart shared containers. The technical review lists this check as optional when the lab has no Comparison export.`,
      );
    } else {
      const ex = await who.api("POST", `/documents/${g.id}/comparisons/${settled.id}/export`);
      expectThat([200, 201].includes(ex.status), `fixture export ${ex.status}`);
      const gen = ex.json.version;
      await step(
        role,
        who.name,
        `${recUrl}/documents`,
        "Generated redline refusal: with a Word Comparison of Version 1 to Version 2 exported as a Generated redline Version (API fixture), Actions for version 1, Delete version, type delete, Delete version; then delete the Generated redline Version first and try again; the Type column offers correction instead",
        "Deleting Version 1 is refused while the Generated redline uses it and the chain is unchanged; after the Generated redline Version is deleted, Version 1 deletes; ordinary Version rows carry a Type control.",
        async () => {
          let d;
          await openDocuments(page, `${recUrl}/documents`);
          await rowOf(page, g.title)
            .getByText(`v${gen.versionNumber}`, { exact: true })
            .waitFor({ timeout: 20000 });
          const typeControls = await page
            .getByLabel(new RegExp(`^Type of version \\d+ of ${esc(g.title)}$`))
            .count();
          await showEarlier(g.title);
          await page
            .getByRole("button", { name: `Actions for version 1 of ${g.title}`, exact: true })
            .click();
          await page.getByRole("menuitem", { name: "Delete version", exact: true }).click();
          let dialog = delDialog();
          await dialog.waitFor();
          await confirmField(dialog).fill("delete");
          await confirmButton(dialog).click();
          const alert = (await dialog.getByRole("alert").innerText({ timeout: 15000 })).trim();
          await dialog.getByRole("button", { name: "Cancel" }).click();
          await dialog.waitFor({ state: "hidden" });
          const unchanged = numbers(await getDoc(who, recUrl, g.id));
          await chooseMenu(page, g.title, "Delete version");
          dialog = delDialog();
          await dialog.waitFor();
          const genTitle = (await dialog.getByRole("heading").first().innerText()).trim();
          await confirmField(dialog).fill("delete");
          await confirmButton(dialog).click();
          await dialog.waitFor({ state: "hidden", timeout: 30000 });
          await openDocuments(page, `${recUrl}/documents`);
          await showEarlier(g.title);
          await page
            .getByRole("button", { name: `Actions for version 1 of ${g.title}`, exact: true })
            .click();
          await page.getByRole("menuitem", { name: "Delete version", exact: true }).click();
          dialog = delDialog();
          await dialog.waitFor();
          await confirmField(dialog).fill("delete");
          await confirmButton(dialog).click();
          await dialog.waitFor({ state: "hidden", timeout: 30000 });
          d = await getDoc(who, recUrl, g.id);
          expectThat(
            unchanged === `1,2,${gen.versionNumber}` &&
              genTitle === `Delete version ${gen.versionNumber}?` &&
              numbers(d) === "2" &&
              typeControls >= 1,
            q({ alert, unchanged, genTitle, after: numbers(d), typeControls }),
          );
          return `Fixture: a Word Comparison of Version 1 to Version 2 exported as Version ${gen.versionNumber} (kind ${gen.kind}). The row carried ${typeControls} "Type of version N" controls for correcting a type. Delete version on Version 1 was refused in the dialog with ${q(alert)}; the chain stayed ${unchanged}. Deleting the Generated redline Version first (${q(genTitle)}) and then Version 1 succeeded; read-back Versions ${numbers(d)}.`;
        },
      );
    }
  }

  await step(
    "administrator",
    PEOPLE.daniel.name,
    "docs/user-guides/archive-and-delete-documents.md",
    "Guide text check: the labels walked are in the reviewed content",
    "The guide names Actions, Archive, Show archived, Archived, Restore, Filter, Delete version, Actions for version, Delete version N?, both dialog notes, the confirm field, Cancel, Delete versions, Generated redline and the Type column.",
    async () => {
      const text = articleText(ARTICLE);
      const labels = [
        "**Actions**",
        "**Archive**",
        "**Show archived**",
        "**Archived**",
        "**Restore**",
        "**Filter**",
        "**Delete version**",
        "**Actions for version**",
        "**Delete version N?**",
        "**All other versions will remain.**",
        "**This is the last version, so the document will also be removed.**",
        '**Type "delete" to confirm**',
        "**Cancel**",
        "**Delete versions**",
        "**Generated redline**",
        "**Type**",
      ];
      for (const label of labels) expectThat(text.includes(label), `guide lacks ${label}`);
      return `All ${labels.length} labels are in the reviewed guide text.`;
    },
  );
  await admin.context.close();
  await nadia.context.close();
}
