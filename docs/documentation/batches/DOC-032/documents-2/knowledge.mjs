// DOC-032 documents-2 independent walkthrough, create-knowledge (V-C33).
// Ported from the DOC-030 documents-2 walkthrough.mjs section "create-knowledge (V-C33)", with
// the DOC-032 Delete version paragraph added on the documents group's Delete version pattern.
// Every guide step runs in the browser as Nadia Haddad (Legal Team Member) and then as Daniel
// Okafor (Administrator), in the guide's order. API calls only prepare fictional fixtures, make a
// direct attempt the browser does not offer, or read results back. Ade Balogun (Business User)
// runs the negative check through a fresh Portal magic link.
// Organization setting changed and put back at once: one run-named Knowledge type per staff role
// is created and archived for the "archived types are unavailable" check, then deleted.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { expectThat as expect, q, root, sleep, sql, tidy, until } from "./lib.mjs";

const A = "create-knowledge";
const SCENARIO = "V-C33";
const KFIX = path.join(root, "docs/documentation/batches/DOC-029/knowledge/fixtures");
const kfix = (name) => path.join(KFIX, name);
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export default async function knowledgePart(ctx) {
  const { BASE, STAMP, sessions, PEOPLE, results, lab } = ctx;
  const WORK = fs.mkdtempSync(path.join(os.tmpdir(), "doc032-documents-2-knowledge-"));
  const record = (role, kind, name, ref) => results.records.push({ role, kind, name, ref });
  const settingsChanged = (results.settingsChanged ??= []);

  function copyAs(src, name) {
    const dir = fs.mkdtempSync(path.join(WORK, "f-"));
    const dest = path.join(dir, name);
    fs.copyFileSync(src, dest);
    return dest;
  }
  const MIME = {
    ".pdf": "application/pdf",
    ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  };
  const part = (file, as) => ({
    name: as ?? path.basename(file),
    mimeType: MIME[path.extname(file)] ?? "application/octet-stream",
    buffer: fs.readFileSync(file),
  });

  // ---------- UI helpers ----------
  const itemsRegion = (page) => page.getByRole("region", { name: "Knowledge items" });
  const folderTree = (page) => page.getByRole("complementary", { name: "Knowledge folders" });
  const folderButton = (page, name) =>
    folderTree(page).getByRole("button", { name: new RegExp(`^${escapeRe(name)}\\s*\\d*$`) });
  const docsSection = (page) => page.getByRole("region", { name: "Documents", exact: true });
  const selectedText = async (select) =>
    (await select.locator("option:checked").innerText()).trim();
  const optionTexts = async (select) =>
    (await select.locator("option").allInnerTexts()).map((t) => t.trim());
  async function chooseFiles(page, trigger, files) {
    const [chooser] = await Promise.all([page.waitForEvent("filechooser"), trigger.click()]);
    await chooser.setFiles(files);
  }
  async function menuItems(page, name) {
    await page.getByRole("button", { name, exact: true }).click();
    const menu = page.getByRole("menu");
    await menu.waitFor();
    const items = (await menu.getByRole("menuitem").allInnerTexts()).map((t) => t.trim());
    await page.keyboard.press("Escape");
    await menu.waitFor({ state: "hidden" });
    return items;
  }
  async function chooseMenu(page, title, item) {
    await page.getByRole("button", { name: `Actions for ${title}`, exact: true }).click();
    const menu = page.getByRole("menu");
    await menu.waitFor();
    await menu.getByRole("menuitem", { name: item, exact: true }).click();
  }
  const rowOfAction = (page, title) =>
    page
      .getByRole("button", { name: `Actions for ${title}`, exact: true })
      .locator("xpath=ancestor::*[self::tr or self::li][1]");

  async function openKnowledge(page) {
    await page.goto(`${BASE}/`);
    await page
      .getByRole("navigation")
      .getByRole("link", { name: "Knowledge", exact: true })
      .first()
      .click();
    await page.waitForURL(/\/knowledge$/);
    await itemsRegion(page).waitFor();
  }
  async function selectFolder(page, name) {
    await folderButton(page, name).click();
    await until(
      async () => (await folderButton(page, name).getAttribute("aria-current")) === "page",
      `folder ${name} did not become selected`,
    );
    await sleep(600);
  }
  async function selectAll(page) {
    await folderTree(page).getByRole("button", { name: "All Knowledge" }).click();
    await sleep(600);
  }
  async function listTitles(page) {
    await sleep(700);
    const region = itemsRegion(page);
    if (await region.getByText("No Knowledge items match these filters").count()) return [];
    return region
      .locator("tbody tr")
      .evaluateAll((rows) =>
        rows.map((row) => (row.querySelector("td")?.innerText ?? "").split("\n")[0].trim()),
      );
  }
  async function openRecord(page, id) {
    await page.goto(`${BASE}/knowledge/${id}`);
    await page.locator("#knowledge-record-type").waitFor({ timeout: 20000 });
    await page.getByRole("region", { name: "Guidance", exact: true }).waitFor();
    await page.waitForLoadState("networkidle").catch(() => {});
  }
  async function markers(page) {
    const text = await page.locator("section[aria-labelledby='page-title']").innerText();
    return { draft: /\bDraft\b/.test(text), archived: /\bArchived\b/.test(text) };
  }
  async function waitMarkers(page, wanted, message) {
    return until(async () => {
      const m = await markers(page);
      return Object.entries(wanted).every(([k, v]) => m[k] === v) ? m : null;
    }, message);
  }
  async function primaryControlText(page) {
    const label = page.getByText("Primary document", { exact: true }).first();
    return tidy(await label.locator("xpath=..").innerText());
  }

  // ---------- read-back helpers (API) ----------
  const call = async (s, method, p, data, extra) => {
    const r = await s.api(method, p, data, extra);
    return { status: r.status, body: r.json };
  };
  async function readItem(s, id) {
    const r = await call(s, "GET", `/knowledge/${id}`);
    expect(r.status === 200, `item read answered ${r.status}`);
    return r.body.knowledgeItem;
  }
  async function readKDocs(s, id, includeArchived = false) {
    const r = await call(
      s,
      "GET",
      `/knowledge/${id}/documents${includeArchived ? "?includeArchived=true" : ""}`,
    );
    expect(r.status === 200, `documents read answered ${r.status}`);
    return r.body.documents;
  }
  const readKFolders = async (s) => (await call(s, "GET", "/knowledge/folders")).body.folders;
  const primaryColumn = (id) =>
    sql(
      lab.project,
      `select coalesce(primary_document_id::text, 'null') from knowledge_items where id = '${id}'`,
    );

  // Administrator session used only for the Knowledge type fixture.
  const adminFixture = await sessions.password(PEOPLE.daniel);

  async function withArchivedType(role, label, fn) {
    const name = `DOC-032 documents-2 V-C33 ${label} retired Knowledge type ${STAMP}`;
    const made = await call(adminFixture, "POST", "/knowledge/types", { displayName: name });
    expect(made.status < 300, `type fixture ${made.status}`);
    const id = made.body.knowledgeType.id;
    const change = {
      setting: "Knowledge type list",
      added: name,
      id,
      state: "created and archived as a fixture",
    };
    settingsChanged.push(change);
    record(role, "knowledge_type (archived fixture, deleted)", name, id);
    try {
      const arch = await call(adminFixture, "POST", `/knowledge/types/${id}/archive`, {});
      expect(arch.status < 300, `type archive ${arch.status}`);
      return await fn(name);
    } finally {
      const del = await call(adminFixture, "DELETE", `/knowledge/types/${id}`);
      change.restored = `deleted at the end of the step (${del.status})`;
      ctx.save();
    }
  }

  const staffItems = {};

  async function staff(role, person) {
    const label = role === "administrator" ? "Admin" : "Legal";
    const n = (what) => `DOC-032 documents-2 V-C33 ${label} ${what} ${STAMP}`;
    const s = await sessions.password(person);
    const { page } = s;
    const k = {};
    const step = (o, fn) =>
      ctx.step(
        { article: A, scenario: SCENARIO, role, actors: [person.name], page: "/knowledge", ...o },
        fn,
      );

    // Fixture: two folders (parent and child) so Start with files can start in a selected folder.
    // The browser's Add folder is walked in Organize the library step 2.
    {
      const p = await call(s, "POST", "/knowledge/folders", { name: n("parent") });
      expect(p.status === 201, `fixture folder ${p.status}`);
      k.parent = p.body.folders.find((f) => f.name === n("parent"));
      const c = await call(s, "POST", "/knowledge/folders", {
        name: n("child"),
        parentId: k.parent.id,
      });
      expect(c.status === 201, `fixture folder ${c.status}`);
      k.child = c.body.folders.find((f) => f.name === n("child"));
      record(
        role,
        "knowledge_folders (fixture)",
        `${n("parent")}; ${n("child")}`,
        `${k.parent.id}; ${k.child.id}`,
      );
    }

    await step(
      {
        action: "Before you start: sign in and open Knowledge from the navigation",
        expected:
          "Knowledge opens with New, the All Knowledge folder entry and the Knowledge items list",
      },
      async () => {
        await openKnowledge(page);
        await page.getByRole("button", { name: "New", exact: true }).waitFor();
        await folderTree(page).getByRole("button", { name: "All Knowledge" }).waitFor();
        return `As ${person.name}, the navigation link Knowledge opened /knowledge with the New button, the All Knowledge folder entry and the "Knowledge items" region.`;
      },
    );

    await step(
      {
        action:
          "Start with files steps 1-2: New, New from files; Folder starts at the selected folder, or at Library",
        expected:
          "Folder reads Library with All Knowledge selected, and the selected folder otherwise",
      },
      async () => {
        await selectAll(page);
        await page.getByRole("button", { name: "New", exact: true }).click();
        const menu = tidy(await page.getByRole("menu").innerText());
        await page.getByRole("menuitem", { name: "New from files" }).click();
        let dialog = page.getByRole("dialog", { name: "New from files" });
        const rootLabel = await selectedText(dialog.getByLabel("Folder", { exact: true }));
        await dialog.getByRole("button", { name: "Cancel" }).click();
        await dialog.waitFor({ state: "hidden" });
        await selectFolder(page, n("parent"));
        await page.getByRole("button", { name: "New", exact: true }).click();
        await page.getByRole("menuitem", { name: "New from files" }).click();
        dialog = page.getByRole("dialog", { name: "New from files" });
        const selLabel = await selectedText(dialog.getByLabel("Folder", { exact: true }));
        expect(
          rootLabel === "Library" && selLabel.includes(n("parent")),
          `root ${rootLabel} selected ${selLabel}`,
        );
        return `New opened a menu reading "${menu}". With All Knowledge selected, New from files showed Folder "${rootLabel}". With "${n("parent")}" selected it started at "${selLabel}".`;
      },
    );

    await step(
      {
        action:
          "Start with files steps 2-3: Drop files here or choose files (two files), Type Precedent, Create drafts",
        expected:
          "Each file creates a separate draft Knowledge Item named after the file with its own Document as primary; the first item opens; the other is in Knowledge",
      },
      async () => {
        const dialog = page.getByRole("dialog", { name: "New from files" });
        const fileA = copyAs(kfix("doc029-policy-a.pdf"), `${n("policy A")}.pdf`);
        const fileB = copyAs(kfix("doc029-policy-b.pdf"), `${n("policy B")}.pdf`);
        await chooseFiles(page, dialog.getByText("Drop files here or choose files"), [
          fileA,
          fileB,
        ]);
        await dialog.getByText("2 files selected").waitFor();
        await dialog.getByLabel(/^Type\*?$/).selectOption({ label: "Precedent" });
        await dialog.getByRole("button", { name: "Create drafts" }).click();
        await page.waitForURL(/\/knowledge\/[0-9a-f-]{36}$/, { timeout: 30000 });
        const firstId = page.url().split("/").pop();
        const heading = await until(async () => {
          const t = tidy(
            await page
              .locator("#page-title")
              .innerText()
              .catch(() => ""),
          );
          return t.startsWith("DOC-032") ? t : null;
        }, "record heading did not render");
        const m = await markers(page);
        const first = await readItem(s, firstId);
        const names = [`${n("policy A")}.pdf`, `${n("policy B")}.pdf`];
        expect(
          m.draft && heading === first.title && names.includes(first.title),
          `draft ${m.draft} heading ${heading} title ${first.title}`,
        );
        expect(
          first.state === "draft" &&
            first.audience === "legal_only" &&
            first.folderId === k.parent.id &&
            first.knowledgeTypeName === "Precedent" &&
            first.primaryDocument &&
            first.documentCount === 1,
          `first ${JSON.stringify(first).slice(0, 200)}`,
        );
        const primaryControl = await page
          .getByRole("button", { name: `Open preview of ${first.primaryDocument.title}` })
          .count();
        expect(primaryControl === 1, "Primary document control does not name the file");
        const primaryText = await primaryControlText(page);
        await page
          .locator("section[aria-labelledby='page-title']")
          .getByRole("link", { name: "Knowledge" })
          .click();
        await page.waitForURL(/\/knowledge$/);
        await selectFolder(page, n("parent"));
        const titles = await listTitles(page);
        const other = first.title === names[0] ? names[1] : names[0];
        expect(titles.includes(other) && titles.includes(first.title), `list titles ${q(titles)}`);
        const { body } = await call(s, "GET", `/knowledge?folder=${k.parent.id}`);
        const otherRow = body.knowledgeItems.find((row) => row.title === other);
        expect(
          otherRow &&
            otherRow.state === "draft" &&
            otherRow.primaryDocument &&
            otherRow.primaryDocument.id !== first.primaryDocument.id &&
            otherRow.documentCount === 1,
          "second item not a separate draft with its own primary",
        );
        k.itemA = first.title === names[0] ? first : otherRow;
        k.itemB = first.title === names[0] ? otherRow : first;
        record(role, "knowledge_items", `${first.title}; ${other}`, `${first.id}; ${otherRow.id}`);
        return `Create drafts opened "${first.title}" with the Draft marker, Audience Legal Only, Type Precedent, Folder "${n("parent")}" and "${primaryText}". The Knowledge breadcrumb returned to the list; the parent folder listed both "${names[0]}" and "${names[1]}". Each was a draft with one Document of its own as primary (read-back).`;
      },
    );

    await step(
      {
        page: "/knowledge/:id (policy A)",
        action:
          "Start with files step 4: Title saves on Enter and on leaving the field; Type and Folder save when changed",
        expected: "Each value is saved and survives a reload",
      },
      async () => {
        await openRecord(page, k.itemA.id);
        const title = page.locator("#knowledge-record-title");
        await title.fill(n("policy A renamed"));
        await title.press("Enter");
        await until(
          async () => (await readItem(s, k.itemA.id)).title === n("policy A renamed"),
          "Enter did not save the title",
        );
        await title.fill(n("policy A reviewed"));
        await page.locator("#knowledge-record-type").focus();
        await until(
          async () => (await readItem(s, k.itemA.id)).title === n("policy A reviewed"),
          "leaving the field did not save the title",
        );
        await page.locator("#knowledge-record-type").selectOption({ label: "Playbook" });
        await until(
          async () => (await readItem(s, k.itemA.id)).knowledgeTypeName === "Playbook",
          "type did not save",
        );
        await page.locator("#knowledge-record-folder").selectOption(k.child.id);
        await until(
          async () => (await readItem(s, k.itemA.id)).folderId === k.child.id,
          "folder did not save",
        );
        await page.reload();
        await page.locator("#knowledge-record-type").waitFor({ timeout: 20000 });
        const after = {
          title: await page.locator("#knowledge-record-title").inputValue(),
          type: await selectedText(page.locator("#knowledge-record-type")),
          folder: await selectedText(page.locator("#knowledge-record-folder")),
          folderId: await page.locator("#knowledge-record-folder").inputValue(),
        };
        expect(
          after.title === n("policy A reviewed") &&
            after.type === "Playbook" &&
            after.folderId === k.child.id,
          `after ${q(after)}`,
        );
        k.itemA.title = after.title;
        return `Enter saved "${n("policy A renamed")}". Moving focus to Type saved "${after.title}". Type Playbook and Folder "${n("child")}" saved on change. After a reload Title read "${after.title}", Type "${after.type}", Folder "${after.folder}".`;
      },
    );

    await step(
      {
        action:
          "Start with guidance steps 1-2: New, New Knowledge Item, Title, Type, Folder, Attach documents (no type choice for the files), Create item; the upload fails (browser drops the request); Retry failed uploads",
        expected:
          "No Document type control; the item exists after the failed upload; Retry failed uploads uploads the file; the item is Draft and Legal Only; the file shows the item's Knowledge type",
      },
      async () => {
        await page.goto(`${BASE}/knowledge`);
        await itemsRegion(page).waitFor();
        await page.getByRole("button", { name: "New", exact: true }).click();
        await page.getByRole("menuitem", { name: "New Knowledge Item" }).click();
        const dialog = page.getByRole("dialog", { name: "New Knowledge Item" });
        await dialog.getByLabel(/^Title\*?$/).fill(n("guidance"));
        await dialog.getByLabel(/^Type\*?$/).selectOption({ label: "Article" });
        await dialog.getByLabel("Folder", { exact: true }).selectOption(k.parent.id);
        const docx = copyAs(kfix("doc029-playbook.docx"), `${n("playbook")}.docx`);
        await chooseFiles(
          page,
          dialog
            .getByRole("button", { name: "Attach documents", exact: true })
            .and(dialog.locator("button")),
          [docx],
        );
        await dialog
          .getByText(`${n("playbook")}.docx`)
          .first()
          .waitFor();
        const typeControls = await dialog.getByLabel("Document type").count();
        const kindControls = await dialog.getByLabel("Document kind").count();
        const labels = await dialog
          .locator("label")
          .evaluateAll((els) => els.map((e) => e.textContent.trim()).filter(Boolean));
        let failed = 0;
        await page.route("**/api/v1/knowledge/*/documents", async (route) => {
          if (route.request().method() === "POST" && failed === 0) {
            failed++;
            await route.abort("failed");
          } else await route.continue();
        });
        await dialog.getByRole("button", { name: "Create item" }).click();
        const failure = dialog.getByText("Record created. Some documents could not be uploaded.");
        await failure.waitFor({ timeout: 20000 });
        const retry = dialog.getByRole("button", { name: "Retry failed uploads" });
        await retry.waitFor();
        await dialog.getByRole("button", { name: "Continue" }).waitFor();
        const { body } = await call(s, "GET", `/knowledge?folder=${k.parent.id}`);
        const existing = body.knowledgeItems.find((row) => row.title === n("guidance"));
        expect(existing && existing.documentCount === 0, "item missing after the failed upload");
        await page.unroute("**/api/v1/knowledge/*/documents");
        await retry.click();
        await page.waitForURL(new RegExp(`/knowledge/${existing.id}$`), { timeout: 30000 });
        await page.locator("#knowledge-record-type").waitFor({ timeout: 20000 });
        const item = await readItem(s, existing.id);
        const m = await markers(page);
        const audience = await selectedText(page.locator("#knowledge-record-audience"));
        const docs = await readKDocs(s, existing.id);
        const rowType = page.getByLabel(`Type of version 1 of ${docs[0].title}`, { exact: true });
        const rowTypeText = await selectedText(rowType);
        const typeOf = docs[0].versions[0]?.documentType?.displayName ?? null;
        expect(
          typeControls === 0 && kindControls === 0,
          `type ${typeControls} kind ${kindControls}`,
        );
        expect(
          item.state === "draft" &&
            item.audience === "legal_only" &&
            m.draft &&
            audience === "Legal Only" &&
            item.primaryDocument?.title &&
            item.documentCount === 1,
          `item ${JSON.stringify(item).slice(0, 200)}`,
        );
        expect(
          rowTypeText === "Article" && typeOf === "Article",
          `row type ${rowTypeText} read-back ${typeOf}`,
        );
        k.guidance = item;
        k.docxTitle = item.primaryDocument.title;
        record(role, "knowledge_item", n("guidance"), existing.id);
        return `New Knowledge Item took Title, Type Article, Folder "${n("parent")}" and one file through Attach documents. The dialog's labels were ${q(labels.join(" | ").slice(0, 160))}; no Document type or Document kind control (counts ${typeControls}/${kindControls}). With the upload request dropped by the browser, the dialog read "Record created. Some documents could not be uploaded." with Retry failed uploads and Continue, and the item already existed with no Document (read-back). Retry failed uploads uploaded the file and opened the item: Draft marker, Audience "${audience}", "${k.docxTitle}" under Primary document. Its "Type of version 1" control read "${rowTypeText}", the item's Knowledge type (read-back ${typeOf}).`;
      },
    );

    await step(
      {
        action: "Start with guidance step 2: after a failed upload, Continue keeps the item",
        expected: "Continue opens the created item without the failed file",
      },
      async () => {
        await page.goto(`${BASE}/knowledge`);
        await itemsRegion(page).waitFor();
        await page.getByRole("button", { name: "New", exact: true }).click();
        await page.getByRole("menuitem", { name: "New Knowledge Item" }).click();
        const dialog = page.getByRole("dialog", { name: "New Knowledge Item" });
        await dialog.getByLabel(/^Title\*?$/).fill(n("continue"));
        const pdf = copyAs(kfix("doc029-checklist.pdf"), `${n("continue checklist")}.pdf`);
        await chooseFiles(
          page,
          dialog
            .getByRole("button", { name: "Attach documents", exact: true })
            .and(dialog.locator("button")),
          [pdf],
        );
        await page.route("**/api/v1/knowledge/*/documents", (route) =>
          route.request().method() === "POST" ? route.abort("failed") : route.continue(),
        );
        await dialog.getByRole("button", { name: "Create item" }).click();
        await dialog.getByRole("button", { name: "Continue" }).waitFor({ timeout: 20000 });
        await dialog.getByRole("button", { name: "Continue" }).click();
        await page.waitForURL(/\/knowledge\/[0-9a-f-]{36}$/, { timeout: 20000 });
        await page.unroute("**/api/v1/knowledge/*/documents");
        const id = page.url().split("/").pop();
        const item = await readItem(s, id);
        const m = await markers(page);
        expect(
          item.title === n("continue") &&
            m.draft &&
            item.documentCount === 0 &&
            !item.primaryDocument,
          "continue item wrong",
        );
        record(role, "knowledge_item", item.title, id);
        return `With the upload request dropped, Continue closed the dialog and opened "${item.title}": Draft marker, no Document (read-back documentCount 0, no primary).`;
      },
    );

    await step(
      {
        page: "/knowledge/:id (guidance)",
        action:
          "Start with guidance steps 3-4: Add guidance, Markdown source, Preview saves on blur and renders, Edit returns to the source; raw HTML is not rendered",
        expected:
          "The editor names no Markdown rules; headings, lists, emphasis, code and links render; raw HTML does not become HTML; the source survives a reload",
      },
      async () => {
        await openRecord(page, k.guidance.id);
        const guidance = page.getByRole("region", { name: "Guidance", exact: true });
        await guidance.getByRole("button", { name: "Add guidance" }).click();
        const editor = page.locator("#knowledge-body");
        await editor.waitFor();
        const helpText = tidy(await guidance.innerText());
        const source = [
          `## ${n("supplier checks")}`,
          "",
          "Use this **fictional** list before *onboarding* a supplier.",
          "",
          "- Check the `vendor-id` field",
          "- Read the [supplier policy](https://example.com/doc032-policy)",
          "",
          "<b>raw-html-doc032</b>",
        ].join("\n");
        await editor.fill(source);
        await guidance.getByRole("button", { name: "Preview" }).click();
        await until(
          async () => (await readItem(s, k.guidance.id)).body === source,
          "Preview blur did not save the guidance",
        );
        await guidance.getByRole("heading", { name: n("supplier checks") }).waitFor();
        const rendered = await guidance.evaluate((el) => ({
          strong: [...el.querySelectorAll("strong")].map((x) => x.textContent),
          em: [...el.querySelectorAll("em")].map((x) => x.textContent),
          li: el.querySelectorAll("li").length,
          code: [...el.querySelectorAll("code")].map((x) => x.textContent),
          links: [...el.querySelectorAll("a")].map((x) => x.getAttribute("href")),
          rawB: [...el.querySelectorAll("b")].some((x) => x.textContent === "raw-html-doc032"),
          rawText: el.innerText.includes("raw-html-doc032"),
        }));
        expect(
          rendered.strong.includes("fictional") &&
            rendered.em.includes("onboarding") &&
            rendered.li === 2 &&
            rendered.code.includes("vendor-id") &&
            rendered.links.includes("https://example.com/doc032-policy") &&
            !rendered.rawB,
          `rendered ${q(rendered)}`,
        );
        expect(!/markdown/i.test(helpText), "the editor names Markdown rules");
        await guidance.getByRole("button", { name: "Edit" }).click();
        expect((await editor.inputValue()) === source, "Edit did not return to the source");
        await page.reload();
        await page.locator("#knowledge-body").waitFor({ timeout: 20000 });
        expect(
          (await page.locator("#knowledge-body").inputValue()) === source,
          "source lost after reload",
        );
        return `Add guidance opened the editor; the section read "${helpText.slice(0, 120)}" and named no Markdown rules. Preview saved the source on blur (read-back) and rendered the heading, bold "fictional", italic "onboarding", a ${rendered.li}-item list, inline code "vendor-id" and the link. The raw <b> tag did not become a bold element (its text ${rendered.rawText ? "showed as plain text" : "was dropped"}). Edit showed the source again; the source was unchanged after a reload.`;
      },
    );

    await step(
      {
        page: "/knowledge/:id (guidance)",
        action: "Add Documents step 1: upload a new Document in the item's Documents section",
        expected: "Upload adds a new v1 Document; the first Document stays primary",
      },
      async () => {
        await docsSection(page).getByRole("button", { name: "Upload", exact: true }).click();
        const dialog = page.getByRole("dialog", { name: "Upload document" });
        const pdf = copyAs(kfix("doc029-checklist.pdf"), `${n("supporting checklist")}.pdf`);
        await chooseFiles(page, dialog.getByRole("button", { name: /Choose files$/ }), [pdf]);
        await dialog.getByRole("button", { name: "Upload", exact: true }).click();
        await dialog.waitFor({ state: "hidden", timeout: 30000 });
        const docs = await until(async () => {
          const rows = await readKDocs(s, k.guidance.id);
          return rows.length === 2 ? rows : null;
        }, "second Document not listed");
        const pdfDoc = docs.find((d) => d.title !== k.docxTitle);
        const docxDoc = docs.find((d) => d.title === k.docxTitle);
        expect(
          docxDoc.isPrimary && !pdfDoc.isPrimary && pdfDoc.versions.length === 1,
          "first Document is no longer primary",
        );
        await page
          .getByRole("button", { name: `Actions for ${pdfDoc.title}`, exact: true })
          .waitFor();
        k.pdfTitle = pdfDoc.title;
        k.pdfDocId = pdfDoc.id;
        k.docxDocId = docxDoc.id;
        return `Upload, Choose files and Upload added "${k.pdfTitle}" as a second Document at v1. "${k.docxTitle}", the first Document, kept the primary designation (read-back).`;
      },
    );

    await step(
      {
        page: "/knowledge/:id (guidance)",
        action:
          "Add Documents step 2: the other Document's Actions, Set as primary; check the Primary mark and the Primary document control",
        expected: "The chosen Document shows Primary and is named under Primary document",
      },
      async () => {
        const primaryItems = await menuItems(page, `Actions for ${k.docxTitle}`);
        const before = await primaryControlText(page);
        await chooseMenu(page, k.pdfTitle, "Set as primary");
        await page
          .getByRole("button", { name: `Open preview of ${k.pdfTitle}` })
          .waitFor({ timeout: 15000 });
        const docs = await readKDocs(s, k.guidance.id);
        const rowText = tidy(await rowOfAction(page, k.pdfTitle).innerText());
        const otherRow = tidy(await rowOfAction(page, k.docxTitle).innerText());
        const after = await primaryControlText(page);
        expect(
          docs.find((d) => d.id === k.pdfDocId).isPrimary &&
            !docs.find((d) => d.id === k.docxDocId).isPrimary &&
            /\bPrimary\b/.test(rowText) &&
            !/\bPrimary\b/.test(otherRow) &&
            !primaryItems.includes("Set as primary"),
          `row ${rowText} other ${otherRow} primary menu ${primaryItems}`,
        );
        return `The primary row's Actions menu offered ${primaryItems.join(", ")} (no Set as primary). The control read "${before}". On "${k.pdfTitle}", Actions, Set as primary put the Primary mark on that row ("${rowText.slice(0, 130)}"), took it off the DOCX row, and the control read "${after}".`;
      },
    );

    await step(
      {
        page: "/knowledge/:id (guidance)",
        action:
          "Add Documents step 3: Open preview reads the primary's current Version; the other Document keeps its own Version history",
        expected:
          "The reader opens on the primary's current Version; a new Version on the supporting Document stays on its own chain",
      },
      async () => {
        await page.getByRole("button", { name: `Open preview of ${k.pdfTitle}` }).click();
        const closeBtn = page.getByRole("button", { name: "Close the document" });
        await closeBtn.waitFor({ timeout: 20000 });
        const readerLabel = await page.getByLabel(`${k.pdfTitle}, version 1`).count();
        expect(readerLabel > 0, "reader is not labelled with the current Version");
        await closeBtn.click();
        await closeBtn.waitFor({ state: "hidden" });
        await chooseMenu(page, k.docxTitle, "Add version");
        const dialog = page.getByRole("dialog", { name: "Add version" });
        const v2 = copyAs(kfix("doc029-playbook-v2.docx"), `${n("playbook v2")}.docx`);
        await chooseFiles(page, dialog.getByRole("button", { name: /Choose file/ }), [v2]);
        await dialog.getByRole("button", { name: "Upload", exact: true }).click();
        await dialog.waitFor({ state: "hidden", timeout: 30000 });
        const docs = await until(async () => {
          const rows = await readKDocs(s, k.guidance.id);
          return rows.find((d) => d.id === k.docxDocId).versions.length === 2 ? rows : null;
        }, "supporting Document did not get Version 2");
        const pdfDoc = docs.find((d) => d.id === k.pdfDocId);
        expect(
          pdfDoc.isPrimary && pdfDoc.versions.length === 1,
          "primary changed by supporting version",
        );
        return `Open preview opened the reader labelled "${k.pdfTitle}, version 1", the current Version; Close the document shut it. Add version on "${k.docxTitle}" made Version 2 on that Document only; the primary PDF kept one Version and its designation (read-back).`;
      },
    );

    await step(
      {
        page: "/knowledge/:id (guidance)",
        action:
          "Add Documents closing text: an item's Documents use a flat list (no New folder; a folder pick lands at the item root)",
        expected:
          "The Documents section has no New folder control, and a folder pick imports its file at the item root with no Document folder",
      },
      async () => {
        await openRecord(page, k.guidance.id);
        const newFolder = await page.getByRole("button", { name: "New folder" }).count();
        await docsSection(page).getByRole("button", { name: "Upload", exact: true }).click();
        const dialog = page.getByRole("dialog", { name: "Upload document" });
        await dialog.waitFor();
        const dir = path.join(fs.mkdtempSync(path.join(WORK, "kpick-")), "outer");
        fs.mkdirSync(path.join(dir, "inner"), { recursive: true });
        fs.copyFileSync(
          kfix("doc029-checklist.pdf"),
          path.join(dir, "inner", `${n("folder pick")}.pdf`),
        );
        const chooseFolder = dialog.getByRole("button", { name: /Choose folder/ });
        if (await chooseFolder.count()) await chooseFiles(page, chooseFolder, dir);
        else await page.locator("#document-directory").setInputFiles(dir);
        const importButton = page
          .getByRole("dialog")
          .getByRole("button", { name: /^Import 1 file$/ });
        await importButton.waitFor({ timeout: 15000 });
        await importButton.click();
        const docs = await until(async () => {
          const rows = await readKDocs(s, k.guidance.id);
          return rows.some((d) => d.title === `${n("folder pick")}.pdf`) ? rows : null;
        }, "folder pick did not import");
        const folders = (await call(s, "GET", `/knowledge/${k.guidance.id}/folders`)).status;
        expect(
          newFolder === 0 && docs.every((d) => !(d.folderId ?? d.folder?.id)),
          `newFolder ${newFolder}`,
        );
        k.pickTitle = `${n("folder pick")}.pdf`;
        return `The item's Documents section had no New folder button. Upload, Choose folder on a folder holding one file in a subfolder offered Import 1 file; the import placed "${k.pickTitle}" at the item root with no Document folder, beside the other Documents (${docs.length} in the flat list; a folder read on the item answered ${folders}).`;
      },
    );

    await step(
      {
        page: "/knowledge/:id (guidance)",
        action:
          "Add Documents closing text: archiving the primary Document preserves its Versions and designation and chooses no replacement; restoring returns it",
        expected:
          "The archived primary leaves the ordinary list, no other row becomes Primary, and restoring returns it with its designation",
      },
      async () => {
        await chooseMenu(page, k.pdfTitle, "Archive");
        const confirm = page.getByRole("dialog").or(page.getByRole("alertdialog"));
        if (await confirm.count()) await confirm.getByRole("button", { name: "Archive" }).click();
        await until(
          async () =>
            (await page
              .getByRole("button", { name: `Actions for ${k.pdfTitle}`, exact: true })
              .count()) === 0,
          "archived Document still in the ordinary list",
        );
        const docxRow = tidy(await rowOfAction(page, k.docxTitle).innerText());
        const pickRow = tidy(await rowOfAction(page, k.pickTitle).innerText());
        const archived = (await readKDocs(s, k.guidance.id, true)).find((d) => d.id === k.pdfDocId);
        const item = await readItem(s, k.guidance.id);
        expect(
          !/\bPrimary\b/.test(docxRow) &&
            !/\bPrimary\b/.test(pickRow) &&
            archived.archivedAt &&
            archived.isPrimary &&
            archived.versions.length === 1,
          `docxRow ${docxRow} archived ${!!archived.archivedAt} primary ${archived.isPrimary}`,
        );
        await page.getByLabel("Show archived").click();
        await chooseMenu(page, k.pdfTitle, "Restore");
        await until(
          async () => (await readKDocs(s, k.guidance.id)).some((d) => d.id === k.pdfDocId),
          "restore did not return the Document",
        );
        await page.reload();
        await page.locator("#knowledge-record-type").waitFor({ timeout: 20000 });
        await page.getByRole("button", { name: `Open preview of ${k.pdfTitle}` }).waitFor();
        const restoredRow = tidy(await rowOfAction(page, k.pdfTitle).innerText());
        expect(/\bPrimary\b/.test(restoredRow), "restored row lost Primary");
        return `Archive took "${k.pdfTitle}" out of the ordinary Documents list; neither remaining row got the Primary mark. Read-back with archived rows: it kept its 1 Version and isPrimary true (item primaryDocument ${item.primaryDocument ? `"${item.primaryDocument.title}"` : "null"}). Show archived, Actions, Restore returned it; after a reload its row read "${restoredRow.slice(0, 110)}" and the Primary document control named it.`;
      },
    );

    const earlierToggle = (title) =>
      page.getByRole("button", {
        name: new RegExp(`^Show the \\d+ earlier versions? of ${escapeRe(title)}$`),
      });
    async function menuOrAbsent(name) {
      const button = page.getByRole("button", { name, exact: true });
      if (!(await button.count())) return null;
      return menuItems(page, name);
    }
    const show = (items) => (items ? items.join(", ") : "no such button (no menu)");
    async function deleteMenus() {
      // Fixture: a third Version on the supporting DOCX, so an earlier Version (v2) has a
      // Compare choice and therefore its own "Actions for version" menu for every staff role.
      const v3 = await call(s, "POST", `/documents/${k.docxDocId}/versions`, undefined, {
        multipart: { file: part(kfix("doc029-playbook.docx"), `${n("playbook v3")}.docx`) },
      });
      expect(v3.status === 201, `fixture version ${v3.status}`);
      await openRecord(page, k.guidance.id);
      const primary = await menuItems(page, `Actions for ${k.pdfTitle}`);
      const supporting = await menuItems(page, `Actions for ${k.docxTitle}`);
      const toggle = earlierToggle(k.docxTitle);
      const toggleName =
        (await toggle.getAttribute("aria-label")) ?? tidy(await toggle.innerText());
      await toggle.click();
      const v2 = await menuOrAbsent(`Actions for version 2 of ${k.docxTitle}`);
      const v1 = await menuOrAbsent(`Actions for version 1 of ${k.docxTitle}`);
      expect(v2, "no Actions for version 2 menu");
      return { primary, supporting, v2, v1, toggleName };
    }

    if (role === "legal_team_member") {
      await step(
        {
          page: "/knowledge/:id (guidance)",
          action:
            "Add Documents closing text: Only an Administrator sees Delete version (Legal Team Member: the Document's Actions menus and an earlier Version's Actions for version menu)",
          expected:
            "No Delete version item in any of the menus; a direct version delete is refused; the chain is unchanged",
        },
        async () => {
          const m = await deleteMenus();
          const docx = (await readKDocs(s, k.guidance.id)).find((d) => d.id === k.docxDocId);
          const v1 = docx.versions.find((v) => v.versionNumber === 1);
          const attempt = await call(s, "DELETE", `/documents/${docx.id}/versions/${v1.id}`, {
            confirmTitle: docx.title,
          });
          const after = (await readKDocs(s, k.guidance.id)).find((d) => d.id === k.docxDocId);
          expect(
            ![...m.primary, ...m.supporting, ...m.v2, ...(m.v1 ?? [])].includes("Delete version"),
            `menus ${q(m)}`,
          );
          expect(
            attempt.status === 403 && after.versions.length === 3,
            `attempt ${attempt.status} versions ${after.versions.length}`,
          );
          return `As Nadia, "Actions for ${k.pdfTitle}" (primary) offered ${m.primary.join(", ")}; "Actions for ${k.docxTitle}" offered ${m.supporting.join(", ")}. With a third Version added as a fixture, "${m.toggleName}" showed the earlier Versions: "Actions for version 2 of ${k.docxTitle}" offered ${show(m.v2)}; version 1 had ${show(m.v1)}. None offered Delete version. A direct DELETE of version 1 answered ${attempt.status} ("${attempt.body?.detail ?? ""}"); the Document still had ${after.versions.length} Versions.`;
        },
      );
    } else {
      await step(
        {
          page: "/knowledge/:id (guidance)",
          action:
            "Add Documents closing text: Only an Administrator sees Delete version (Administrator: the Document's Actions menus and an earlier Version's Actions for version menu)",
          expected:
            "Delete version is offered in the Document's Actions menu and in Actions for version",
        },
        async () => {
          const m = await deleteMenus();
          expect(
            m.primary.includes("Delete version") &&
              m.supporting.includes("Delete version") &&
              m.v2.includes("Delete version") &&
              m.v1?.includes("Delete version"),
            `menus ${q(m)}`,
          );
          return `As Daniel, "Actions for ${k.pdfTitle}" (primary) offered ${m.primary.join(", ")}; "Actions for ${k.docxTitle}" offered ${m.supporting.join(", ")}. With a third Version added as a fixture, "${m.toggleName}" showed the earlier Versions: "Actions for version 2 of ${k.docxTitle}" offered ${show(m.v2)}; "Actions for version 1" offered ${show(m.v1)}.`;
        },
      );

      await step(
        {
          page: "/knowledge/:id (guidance)",
          action:
            'Add Documents closing text: as Administrator, delete the last Version of the primary Document (Actions, Delete version, type delete in Type "delete" to confirm, Delete version)',
          expected:
            "The primary Document is removed; the Primary document control is cleared; no other Document is chosen; primaryDocumentId reads back null",
        },
        async () => {
          await openRecord(page, k.guidance.id);
          const before = await primaryControlText(page);
          await chooseMenu(page, k.pdfTitle, "Delete version");
          const dialog = page.getByRole("dialog", { name: /^Delete version \d+\?$/ });
          await dialog.waitFor();
          const title = tidy(await dialog.getByRole("heading").first().innerText());
          const body = tidy(await dialog.innerText());
          const button = dialog.getByRole("button").filter({ hasText: /^Delete version$/ });
          const disabledAtOpen = await button.isDisabled();
          await dialog.getByLabel('Type "delete" to confirm').fill("delete");
          const enabled = await button.isEnabled();
          const response = page.waitForResponse(
            (r) =>
              r.request().method() === "DELETE" &&
              r.url().includes(`/documents/${k.pdfDocId}/versions/`),
          );
          await button.click();
          const answered = await response;
          const answer = await answered.json().catch(() => null);
          await dialog.waitFor({ state: "hidden", timeout: 30000 });
          await page
            .getByRole("button", { name: `Actions for ${k.pdfTitle}`, exact: true })
            .waitFor({ state: "detached", timeout: 15000 });
          const live = await until(async () => {
            const t = await primaryControlText(page);
            return t === "Primary document None" ? t : null;
          }, "Primary document control did not clear");
          const previews = await page.getByRole("button", { name: /^Open preview of / }).count();
          const docxRow = tidy(await rowOfAction(page, k.docxTitle).innerText());
          const pickRow = tidy(await rowOfAction(page, k.pickTitle).innerText());
          const docs = await readKDocs(s, k.guidance.id, true);
          const item = await readItem(s, k.guidance.id);
          const column = primaryColumn(k.guidance.id);
          await page.reload();
          await page.locator("#knowledge-record-type").waitFor({ timeout: 20000 });
          await page.waitForLoadState("networkidle").catch(() => {});
          const reloaded = await primaryControlText(page);
          expect(
            title === "Delete version 1?" &&
              body.includes("This is the last version, so the document will also be removed."),
            `title ${title} body ${body}`,
          );
          expect(disabledAtOpen && enabled, `button disabled ${disabledAtOpen} enabled ${enabled}`);
          expect(
            answered.status() === 200 &&
              (answer?.documents ?? []).every((d) => !d.isPrimary) &&
              !docs.some((d) => d.id === k.pdfDocId) &&
              docs.every((d) => !d.isPrimary) &&
              docs.length === 2,
            `answer ${answered.status()} docs ${q(docs.map((d) => [d.title, d.isPrimary]))}`,
          );
          expect(
            !/\bPrimary\b/.test(docxRow) && !/\bPrimary\b/.test(pickRow) && previews === 0,
            `rows ${docxRow} / ${pickRow} previews ${previews}`,
          );
          expect(
            item.primaryDocument === null &&
              (item.primaryDocumentId ?? null) === null &&
              column === "null",
            `item ${q(item.primaryDocument)} column ${column}`,
          );
          expect(reloaded === "Primary document None", `after reload ${reloaded}`);
          return `Before the delete the control read "${before}". "Actions for ${k.pdfTitle}", Delete version opened "${title}" reading "${body.slice(0, 320)}". Delete version was disabled at open and enabled after typing delete. The DELETE answered ${answered.status()} with no Document marked primary. The row left the list; the control read "${live}" and still did after a reload; no Open preview button remained. "${k.docxTitle}" and "${k.pickTitle}" stayed without the Primary mark (read-back ${docs.length} Documents, none primary, including archived). The item read back primaryDocument null, and knowledge_items.primary_document_id read ${column}.`;
        },
      );
    }

    await step(
      {
        action:
          "Organize the library step 1: All Knowledge, a folder with its descendants, and the Type, State, Audience, Author and Format filters",
        expected:
          "A folder lists its descendants; each filter narrows the list; clearing restores it",
      },
      async () => {
        await page.goto(`${BASE}/knowledge`);
        await itemsRegion(page).waitFor();
        await selectAll(page);
        const allTitles = await listTitles(page);
        for (const l of ["Type", "State", "Audience", "Author", "Format"])
          await page.getByRole("combobox", { name: l, exact: true }).first().waitFor();
        await selectFolder(page, n("parent"));
        let titles = await listTitles(page);
        expect(
          titles.includes(k.itemA.title) &&
            titles.includes(k.itemB.title) &&
            titles.includes(n("guidance")),
          `parent folder list ${q(titles)}`,
        );
        const parentCount = titles.length;
        await selectFolder(page, n("child"));
        titles = await listTitles(page);
        expect(
          titles.includes(k.itemA.title) && !titles.includes(k.itemB.title),
          `child list ${q(titles)}`,
        );
        await selectFolder(page, n("parent"));
        const combo = (l) => page.getByRole("combobox", { name: l, exact: true }).first();
        await combo("Type").selectOption({ label: "Precedent" });
        titles = await listTitles(page);
        expect(
          titles.includes(k.itemB.title) && !titles.includes(k.itemA.title),
          `type filter ${q(titles)}`,
        );
        await combo("State").selectOption({ label: "Published" });
        titles = await listTitles(page);
        expect(!titles.includes(k.itemB.title), "State Published did not hide the draft");
        await page.getByRole("button", { name: "Clear filters" }).first().click();
        await sleep(800);
        await selectFolder(page, n("parent"));
        await combo("Author").selectOption({ label: person.name });
        titles = await listTitles(page);
        expect(titles.includes(k.itemB.title), `author ${q(titles)}`);
        await combo("Format").selectOption({ label: "Word" });
        titles = await listTitles(page);
        expect(!titles.includes(k.itemB.title), `format Word kept the PDF item ${q(titles)}`);
        await combo("Format").selectOption({ label: "PDF" });
        titles = await listTitles(page);
        expect(titles.includes(k.itemB.title), `format PDF ${q(titles)}`);
        await combo("Audience").selectOption({ label: "Everyone" });
        titles = await listTitles(page);
        expect(!titles.includes(k.itemB.title), "Audience Everyone kept a Legal Only item");
        await page.getByRole("button", { name: "Clear filters" }).first().click();
        await sleep(800);
        await selectFolder(page, n("parent"));
        titles = await listTitles(page);
        expect(
          titles.includes(k.itemB.title) && titles.includes(k.itemA.title),
          "items did not return after clearing",
        );
        return `All Knowledge listed ${allTitles.length} items on its first page. Type, State, Audience, Author and Format were each offered. "${n("parent")}" listed ${parentCount} items, including "${k.itemA.title}" from its child folder; "${n("child")}" listed only that item. Type Precedent dropped the Playbook item. State Published hid the drafts. Author ${person.name} kept "${k.itemB.title}"; Format Word dropped it and Format PDF brought it back. Audience Everyone hid that Legal Only item. Clear filters and reselecting the folder brought all items back.`;
      },
    );

    async function addFolderInBrowser(name) {
      await folderTree(page).getByRole("button", { name: "Add folder" }).click();
      const dialog = page.getByRole("dialog", { name: "Add folder" });
      await dialog.getByLabel("Folder name").fill(name);
      await dialog.getByRole("button", { name: "Add folder" }).click();
      await dialog.waitFor({ state: "hidden" });
      const folder = await until(
        async () => (await readKFolders(s)).find((row) => row.name === name),
        `folder ${name} not saved`,
      );
      await folderButton(page, name).waitFor();
      return folder;
    }

    await step(
      {
        action:
          "Organize the library step 2: Add folder, Folder name, Add folder with All Knowledge selected (top level); then with that folder selected (child)",
        expected:
          "With All Knowledge selected the folder is top-level; with a folder selected the new folder is its child",
      },
      async () => {
        await selectAll(page);
        k.target = await addFolderInBrowser(n("target"));
        expect(k.target.parentId === null, "top-level folder has a parent");
        await selectFolder(page, n("target"));
        k.sub = await addFolderInBrowser(n("target sub"));
        expect(k.sub.parentId === k.target.id, "child folder not under the selected folder");
        record(
          role,
          "knowledge_folders",
          `${n("target")}; ${n("target sub")}`,
          `${k.target.id}; ${k.sub.id}`,
        );
        return `With All Knowledge selected, Add folder, Folder name "${n("target")}", Add folder saved a top-level folder. With it selected, Add folder saved "${n("target sub")}" under it (read-back parentId).`;
      },
    );

    await step(
      {
        action:
          "Organize the library step 3: Rename or move selected folder; Parent folder excludes the folder and its descendants; Save folder renames or moves",
        expected: "Parent folder omits the folder and its child; Save folder renames or moves it",
      },
      async () => {
        await selectFolder(page, n("parent"));
        await page.getByRole("button", { name: "Rename or move selected folder" }).click();
        let dialog = page.getByRole("dialog", { name: "Rename or move folder" });
        const options = await dialog
          .getByLabel("Parent folder")
          .locator("option")
          .evaluateAll((els) => els.map((e) => e.value));
        expect(
          !options.includes(k.parent.id) &&
            !options.includes(k.child.id) &&
            options.includes(k.target.id),
          "parent choices include the folder or its descendant",
        );
        await dialog.getByLabel("Folder name").fill(n("parent renamed"));
        await dialog.getByRole("button", { name: "Save folder" }).click();
        await dialog.waitFor({ state: "hidden" });
        await folderButton(page, n("parent renamed")).waitFor();
        await selectFolder(page, n("child"));
        await page.getByRole("button", { name: "Rename or move selected folder" }).click();
        dialog = page.getByRole("dialog", { name: "Rename or move folder" });
        await dialog.getByLabel("Parent folder").selectOption(k.target.id);
        await dialog.getByRole("button", { name: "Save folder" }).click();
        await dialog.waitFor({ state: "hidden" });
        await until(
          async () =>
            (await readKFolders(s)).find((r) => r.id === k.child.id)?.parentId === k.target.id,
          "child folder did not move",
        );
        await selectFolder(page, n("target"));
        const titles = await listTitles(page);
        expect(
          titles.includes(k.itemA.title) && (await readItem(s, k.itemA.id)).folderId === k.child.id,
          "moved folder's item not listed under the new parent",
        );
        return `In Rename or move folder for "${n("parent")}", Parent folder offered ${options.length} choices including "${n("target")}" but neither the folder itself nor "${n("child")}". Save folder renamed it to "${n("parent renamed")}". Moving "${n("child")}" under "${n("target")}" kept its item in it, and "${n("target")}" listed "${k.itemA.title}".`;
      },
    );

    await step(
      {
        action:
          "Organize the library step 4: the selected folder's up/down controls change its order among sibling folders",
        expected: "Move up then Move down changes the saved order and returns it",
      },
      async () => {
        await selectFolder(page, n("target"));
        const orderOf = async () => {
          const siblings = (await readKFolders(s))
            .filter((r) => r.parentId === null)
            .sort((a, b) => a.displayOrder - b.displayOrder);
          return siblings.findIndex((r) => r.id === k.target.id);
        };
        const start = await orderOf();
        let clicks = 0;
        const move = async (dir, expected) => {
          for (let i = 0; i < 3; i++) {
            clicks++;
            await page.getByRole("button", { name: `Move ${n("target")} ${dir}` }).click();
            try {
              await until(async () => (await orderOf()) === expected, "order unchanged", 4000);
              return;
            } catch {
              /* a click during an in-flight request is ignored; try again */
            }
          }
          throw new Error(`Move ${dir} did not change the order`);
        };
        await move("up", start - 1);
        await move("down", start);
        return `"${n("target")}" was at top-level sibling position ${start + 1}. "Move ${n("target")} up" saved position ${start}; "Move … down" saved position ${start + 1} again (${clicks} clicks). Moving an item by its Folder field was shown in Start with files step 4.`;
      },
    );

    await step(
      {
        action:
          "Organize the library step 5: Delete selected folder, read the confirmation, Delete folder; items and child folders move to its parent",
        expected:
          "The confirmation says nothing is deleted; the child folders move up and the item remains with its Document",
      },
      async () => {
        await selectFolder(page, n("target"));
        await page.getByRole("button", { name: "Delete selected folder" }).click();
        const dialog = page.getByRole("dialog", { name: `Delete the ${n("target")} folder?` });
        const text = tidy(await dialog.innerText());
        await dialog.getByRole("button", { name: "Delete folder" }).click();
        await dialog.waitFor({ state: "hidden" });
        const fl = await readKFolders(s);
        const item = await readItem(s, k.itemA.id);
        expect(
          /Nothing is deleted\./.test(text) &&
            !fl.some((r) => r.id === k.target.id) &&
            fl.find((r) => r.id === k.child.id)?.parentId === null &&
            fl.find((r) => r.id === k.sub.id)?.parentId === null &&
            item.folderId === k.child.id &&
            item.documentCount === 1 &&
            !item.archivedAt,
          `text ${text}`,
        );
        return `The dialog read "${text.slice(0, 200)}". Delete folder removed "${n("target")}". Its child folders "${n("child")}" and "${n("target sub")}" became top-level, and "${item.title}" stayed in "${n("child")}" with its one Document (read-back).`;
      },
    );

    await step(
      {
        page: "/knowledge/:id (policy A) and the create dialogs",
        action:
          "Recover from an unavailable choice: Manage types… beside Type is for Administrators; an archived Knowledge type is unavailable for new selection",
        expected:
          "Only the Administrator sees Manage types…; the archived type is absent from the record Type control and both create dialogs",
      },
      async () =>
        withArchivedType(role, label, async (archivedName) => {
          await openRecord(page, k.itemA.id);
          const manageCount = await page.getByRole("link", { name: "Manage types…" }).count();
          expect(
            manageCount === (role === "administrator" ? 1 : 0),
            `Manage types… count ${manageCount}`,
          );
          const recordOptions = await optionTexts(page.locator("#knowledge-record-type"));
          await page.goto(`${BASE}/knowledge`);
          await itemsRegion(page).waitFor();
          await page.getByRole("button", { name: "New", exact: true }).click();
          await page.getByRole("menuitem", { name: "New Knowledge Item" }).click();
          let dialog = page.getByRole("dialog", { name: "New Knowledge Item" });
          const createOptions = await optionTexts(dialog.getByLabel(/^Type\*?$/));
          await dialog.getByRole("button", { name: "Cancel" }).click();
          await page.getByRole("button", { name: "New", exact: true }).click();
          await page.getByRole("menuitem", { name: "New from files" }).click();
          dialog = page.getByRole("dialog", { name: "New from files" });
          const filesOptions = await optionTexts(dialog.getByLabel(/^Type\*?$/));
          await dialog.getByRole("button", { name: "Cancel" }).click();
          for (const list of [recordOptions, createOptions, filesOptions])
            expect(!list.includes(archivedName) && list.includes("Playbook"), `options ${list}`);
          let target = null;
          if (role === "administrator") {
            await openRecord(page, k.itemA.id);
            await page.getByRole("link", { name: "Manage types…" }).click();
            await page.waitForURL(/\/settings\/knowledge/);
            target = new URL(page.url()).pathname;
          }
          return `${role === "administrator" ? `Manage types… was beside Type and opened ${target}.` : "No Manage types… link was beside Type for the Legal Team Member."} With "${archivedName}" created and archived as a fixture, it was absent from the record Type control (${recordOptions.length} options), New Knowledge Item (${createOptions.length}) and New from files (${filesOptions.length}); Playbook was offered in all three. The fixture type was deleted at the end of the step.`;
        }),
    );

    await step(
      {
        page: "/knowledge/:id (guidance)",
        action:
          "Recover from an unavailable choice: an archived Knowledge Item cannot be edited or receive uploads; Restore makes it editable",
        expected:
          "Archived disables Title, Type, Folder, Audience and guidance, hides Upload, and a direct upload is refused; Restore re-enables them",
      },
      async () => {
        await openRecord(page, k.guidance.id);
        await page.getByRole("button", { name: "Knowledge Item actions" }).click();
        await page.getByRole("menu").getByRole("menuitem", { name: "Archive" }).click();
        const dialog = page.getByRole("dialog", { name: "Archive Knowledge Item" });
        const dialogText = tidy(await dialog.innerText());
        await dialog.getByRole("button", { name: "Archive", exact: true }).click();
        await dialog.waitFor({ state: "hidden" });
        await waitMarkers(page, { archived: true }, "no Archived marker");
        const disabled = {};
        for (const id of [
          "knowledge-record-title",
          "knowledge-record-type",
          "knowledge-record-folder",
          "knowledge-record-audience",
        ])
          disabled[id] = await page.locator(`#${id}`).isDisabled();
        disabled.guidanceEditor = await page
          .locator("#knowledge-body")
          .isDisabled({ timeout: 3000 })
          .catch(() => null);
        const uploadCount = await page.getByRole("button", { name: "Upload", exact: true }).count();
        const refused = await call(s, "POST", `/knowledge/${k.guidance.id}/documents`, undefined, {
          multipart: { file: part(kfix("doc029-checklist.pdf")) },
        });
        expect(
          Object.values(disabled).every((v) => v !== false) &&
            uploadCount === 0 &&
            refused.status >= 400,
          `disabled ${q(disabled)} upload ${uploadCount} direct ${refused.status}`,
        );
        await page.getByRole("button", { name: "Knowledge Item actions" }).click();
        await page.getByRole("menu").getByRole("menuitem", { name: "Restore" }).click();
        await waitMarkers(page, { archived: false }, "Restore did not clear Archived");
        await until(
          async () => !(await page.locator("#knowledge-record-title").isDisabled()),
          "title still disabled after restore",
        );
        await page.getByRole("button", { name: "Upload", exact: true }).waitFor();
        const item = await readItem(s, k.guidance.id);
        expect(!item.archivedAt, "item still archived");
        return `Knowledge Item actions, Archive opened "Archive Knowledge Item" ("${dialogText.slice(0, 160)}"); Archive (no replacement) marked the item Archived and disabled Title, Type, Folder, Audience and the guidance editor (${q(disabled)}). Upload disappeared, and a direct upload request answered ${refused.status} ("${tidy(refused.body?.detail).slice(0, 100)}"). Knowledge Item actions, Restore cleared Archived and made the fields and Upload available again.`;
      },
    );

    await step(
      {
        page: "/help",
        action:
          "Before you start: Help search does not search Knowledge Items or their files (checked last, once this run's Knowledge Item exists)",
        expected: "Help finds this guide by its title but not a Knowledge Item by its title",
      },
      async () => {
        await page.goto(`${BASE}/help`);
        const box = page
          .getByRole("searchbox", { name: "Search documentation" })
          .or(page.getByLabel("Search documentation"))
          .first();
        await box.fill("Create and organize Knowledge Items");
        await box.press("Enter");
        await page
          .getByRole("link", { name: "Create and organize Knowledge Items" })
          .first()
          .waitFor({ timeout: 15000 });
        await box.fill(n("guidance"));
        await box.press("Enter");
        const none = page.getByText(/No matching articles/).first();
        await none.waitFor({ timeout: 15000 });
        const noneText = tidy(await none.innerText());
        await box.fill(n("supporting checklist"));
        await box.press("Enter");
        await page
          .getByText(/No matching articles/)
          .first()
          .waitFor({ timeout: 15000 });
        return `Help search found "Create and organize Knowledge Items" by its title. A search for the Knowledge Item title "${n("guidance")}" answered "${noneText}", and so did a search for its Document title "${n("supporting checklist")}".`;
      },
    );

    staffItems[role] = k;
    await s.context.close();
  }

  try {
    await staff("legal_team_member", PEOPLE.nadia);
    await staff("administrator", PEOPLE.daniel);

    const kItem = staffItems.legal_team_member?.itemA?.id ?? staffItems.administrator?.itemA?.id;
    const typeId = (await call(adminFixture, "GET", "/knowledge/type-options")).body
      ?.knowledgeTypes?.[0]?.id;
    await ctx.step(
      {
        article: A,
        scenario: SCENARIO,
        role: "business_user",
        actors: [PEOPLE.ade.name],
        page: "/knowledge, /knowledge/:id",
        action:
          "Before you start (negative): a Business User cannot author or browse the staff Knowledge library",
        expected:
          "/knowledge and a staff Knowledge record address send him to the Portal; staff Knowledge list, record and create requests answer 403",
        independent: true,
      },
      async () => {
        expect(kItem, "no staff Knowledge Item from this run to test against");
        const b = await sessions.magic(PEOPLE.ade);
        const { page } = b;
        await page.goto(`${BASE}/knowledge`);
        await sleep(1500);
        await page.waitForLoadState("networkidle").catch(() => {});
        const listPath = new URL(page.url()).pathname;
        await page.goto(`${BASE}/knowledge/${kItem}`);
        await sleep(1500);
        await page.waitForLoadState("networkidle").catch(() => {});
        const recordPath = new URL(page.url()).pathname;
        const statuses = [
          (await call(b, "GET", "/knowledge")).status,
          (await call(b, "GET", `/knowledge/${kItem}`)).status,
          (
            await call(b, "POST", "/knowledge", {
              title: `DOC-032 documents-2 V-C33 refused ${STAMP}`,
              knowledgeTypeId: typeId,
            })
          ).status,
          (await call(b, "GET", "/knowledge/folders")).status,
        ];
        await b.context.close();
        expect(
          listPath.startsWith("/portal") &&
            recordPath.startsWith("/portal") &&
            statuses.every((x) => x === 403),
          `list ${listPath} record ${recordPath} api ${statuses}`,
        );
        return `Ade Balogun signed in to the Portal with a fresh magic link. /knowledge sent him to ${listPath}; the staff record address /knowledge/<Nadia's policy A item> sent him to ${recordPath}. The staff Knowledge list, record, create and folder requests answered ${q(statuses)}.`;
      },
    );
  } finally {
    await adminFixture.context.close().catch(() => {});
    fs.rmSync(WORK, { recursive: true, force: true });
  }
}
