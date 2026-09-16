// V-C04 search-and-views: followed from docs/user-guides/search-and-views.md for Administrator and Legal Team Member.
// The "DOC-029r2 access" fresh accounts search and save views, so seeded accounts keep their saved views.
// Daniel creates the fixtures: a visible Contract whose PDF alone holds a unique word, a second visible Contract with
// that word in its title, and a Confidential Contract with that word in its title that neither fresh account reaches.
import { BASE, SEED, api, ensureStaffAccounts, newContext, passwordSignIn, sleep, sql, text } from "./lib-r2.mjs";

const A = "search-and-views";

function pdf(line) {
  const objs = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
    null,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  const stream = `BT /F1 14 Tf 72 700 Td (${line}) Tj ET`;
  objs[3] = `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`;
  let out = "%PDF-1.4\n";
  const offsets = [];
  objs.forEach((o, i) => {
    offsets.push(out.length);
    out += `${i + 1} 0 obj\n${o}\nendobj\n`;
  });
  const xref = out.length;
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n` + offsets.map((n) => `${String(n).padStart(10, "0")} 00000 n \n`).join("");
  out += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, "latin1");
}

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
  const letters = String(stamp).slice(-8).split("").map((d) => "abcdefghij"[Number(d)]).join("");
  const term = `quill${letters}`;
  const must = (r, what) => {
    if (r.status >= 300) throw new Error(`${what}: ${r.status} ${JSON.stringify(r.body).slice(0, 200)}`);
    return r.body;
  };
  const users = must(await api(admin.page, "GET", "/users"), "users").users;
  const danielId = users.find((u) => u.email === SEED.daniel.email).id;
  const nda = must(await api(admin.page, "GET", "/contract-types"), "types").contractTypes.find((t) => t.displayName === "NDA").id;
  const visible = must(await api(admin.page, "POST", "/contracts", { title: `DOC-029r2 access search document holder ${stamp}`, contractTypeId: nda, managerId: danielId }), "c1").contract;
  const second = must(await api(admin.page, "POST", "/contracts", { title: `DOC-029r2 access search second ${term}`, contractTypeId: nda, managerId: danielId }), "c2").contract;
  const hidden = must(await api(admin.page, "POST", "/contracts", { title: `DOC-029r2 access search confidential ${term}`, contractTypeId: nda, managerId: danielId, isConfidential: true }), "c3").contract;
  const up = await admin.page.request.post(`${BASE}/api/v1/contracts/${visible.number}/documents`, {
    headers: { origin: BASE },
    multipart: { file: { name: `doc029r2-access-search-${stamp}.pdf`, mimeType: "application/pdf", buffer: pdf(`DOC-029r2 access fictional clause mentions ${term} only inside this Document.`) } },
    failOnStatusCode: false,
  });
  if (up.status() >= 300) throw new Error(`upload ${up.status()}`);
  fx.created.push(`Contracts C-${visible.number} (PDF with the unique word), C-${second.number}, Confidential C-${hidden.number} for search`);
  // Wait for text processing so the Document is searchable (Daniel reaches all three).
  let indexed = false;
  for (let i = 0; i < 90 && !indexed; i++) {
    const r = await api(admin.page, "GET", `/search?q=${term}`);
    indexed = JSON.stringify(r.body).includes(`doc029r2-access-search-${stamp}.pdf`) || JSON.stringify(r.body).includes('"kind":"document"');
    if (!indexed) await sleep(2000);
  }
  log.record(A, "administrator", "fixture: Document text processed and searchable", "The PDF's word becomes searchable", `Indexed ${indexed} for a unique word in the PDF on C-${visible.number}`, indexed);

  for (const role of ["administrator", "legal_team_member"]) {
    const R = (step, expected, actual, pass) => log.record(A, role, step, expected, actual, pass);
    const acct = fx.accounts[role];
    const c = await signInAs(acct.email, acct.password);
    const p = c.page;
    if (process.env.VIEWS_ONLY) {
      await p.goto(`${BASE}/contracts`);
      await p.getByRole("button", { name: /^Filter/ }).waitFor();
    }
    if (!process.env.VIEWS_ONLY) {

    // Search across your work: header, /, results, kind, Document result opens the matching Version with find.
    await p.locator("body").click({ position: { x: 5, y: 400 } });
    await p.keyboard.press("/");
    await p.keyboard.type(term);
    const box = p.getByRole("listbox", { name: "Search results" });
    await box.waitFor({ timeout: 15000 });
    await sleep(2000);
    const boxText = await text(box);
    const hiddenInBox = boxText.includes("search confidential");
    await p.getByRole("option", { name: /See all results/ }).or(p.getByRole("link", { name: /See all results/ })).or(p.getByRole("button", { name: /See all results/ })).first().click();
    await p.waitForURL(/\/search\?q=/);
    await sleep(2500);
    const all = await text(p.locator("main"));
    const hasSecond = all.includes(`search second ${term}`);
    const docRow = p.locator("main li").filter({ hasText: `C-${visible.number}` }).first();
    const docRowText = await text(docRow);
    const docNames = docRowText.includes(`Owned by C-${visible.number}`) && /v1/.test(docRowText);
    const hiddenOnPage = all.includes("search confidential");
    await p.getByRole("link", { name: "Document", exact: true }).click();
    await p.waitForURL(/kind=document/);
    await sleep(2000);
    const docOnly = await p.locator("main li").evaluateAll((els) => els.map((e) => e.innerText));
    const onlyDocs = docOnly.length > 0 && docOnly.every((t) => /Owned by/.test(t));
    await p.locator("main li").filter({ hasText: `C-${visible.number}` }).getByRole("link").first().click();
    await p.waitForURL(new RegExp(`/contracts/${visible.number}/documents\\?.*find=`), { timeout: 15000 });
    await sleep(4000);
    const findValue = await p.locator("input[type=search], input").evaluateAll((els, t) => els.some((e) => e.value === t), term);
    const readerOpen = (await p.getByRole("complementary").filter({ hasText: `doc029r2-access-search-${stamp}.pdf` }).count()) > 0 || (await text(p.locator("body"))).includes(`doc029r2-access-search-${stamp}.pdf`);
    R(
      "Search across your work, steps 1-4, and the Document result",
      "/ focuses Search; results include the reachable records and the Document whose words match; the Document result names its owning record and Version; the kind filter narrows; opening the result shows the matching Version with find filled; the Confidential record outside reach never appears",
      `Header results listed; See all results opened the results page; title match C-${second.number} ${hasSecond}; Document result "${docRowText.slice(0, 90)}" names owner and version ${docNames}; Document filter left only Document rows ${onlyDocs} (${docOnly.length}); opened ${new URL(p.url()).pathname} with find text filled ${findValue} and reader showing the file ${readerOpen}; Confidential C-${hidden.number} in header ${hiddenInBox}, on page ${hiddenOnPage}`,
      hasSecond && docNames && onlyDocs && findValue && readerOpen && !hiddenInBox && !hiddenOnPage,
    );
    await p.goto(`${BASE}/contracts/${hidden.number}`);
    const directHidden = await p.getByText("Contract not found").first().waitFor({ timeout: 15000 }).then(() => true, () => false);
    const hiddenApi = await api(p, "GET", `/search?q=${term}&kind=contract`);
    R("the Confidential record outside reach stays hidden", "Direct link and search do not reveal it", `Direct link shows Contract not found ${directHidden}; API contract results include it ${JSON.stringify(hiddenApi.body).includes("search confidential")}`, directHidden && !JSON.stringify(hiddenApi.body).includes("search confidential"));

    // Show more and failed reads.
    await p.goto(`${BASE}/search?q=DOC-029`);
    await p.getByRole("button", { name: "Show more" }).waitFor({ timeout: 15000 });
    const firstPage = await p.locator("main li").count();
    await p.route("**/api/v1/search**", (route) => (route.request().url().includes("cursor=") ? route.abort() : route.continue()));
    await p.getByRole("button", { name: "Show more" }).click();
    const nextErr = await p.getByText("The next results could not be read. Try again.").waitFor({ timeout: 10000 }).then(() => true, () => false);
    const kept = await p.locator("main li").count();
    await p.unroute("**/api/v1/search**");
    await p.getByRole("button", { name: "Show more" }).click();
    await sleep(3000);
    const grown = await p.locator("main li").count();
    await p.route("**/api/v1/search**", (route) => route.abort());
    await p.getByRole("combobox", { name: "Search" }).fill(`${term}x`);
    const headerErr = await p.getByText("Search could not load").first().waitFor({ timeout: 10000 }).then(() => true, () => false);
    await p.getByRole("combobox", { name: "Search" }).fill("");
    await p.goto(`${BASE}/search?q=${term}`);
    const pageErr = await p.getByText("Search could not load. Try again.").first().waitFor({ timeout: 15000 }).then(() => true, () => false);
    await p.unroute("**/api/v1/search**");
    await p.goto(`${BASE}/search?q=${term}`);
    const recovered = await p.locator("main li").first().waitFor({ timeout: 15000 }).then(() => true, () => false);
    await p.goto(`${BASE}/search?q=zz${letters}qx`);
    const noMatch = await p.getByText("No matches").first().waitFor({ timeout: 15000 }).then(() => true, () => false);
    R(
      "Show more, failed reads and No matches",
      "Show more adds a page; a failed next page keeps the rows and Show more retries; a failed search says Search could not load and a retry after recovery works; an unmatched query says No matches",
      `First page ${firstPage} rows; blocked next page message ${nextErr} with ${kept} rows kept; retry grew to ${grown}; header dropdown Search could not load ${headerErr}; results page Search could not load. Try again. ${pageErr}; retry after recovery ${recovered}; No matches ${noMatch}`,
      nextErr && kept === firstPage && grown > firstPage && headerErr && pageErr && recovered && noMatch,
    );

    // Filter and sort a list.
    await p.goto(`${BASE}/`);
    await p.getByRole("navigation", { name: "Primary" }).getByRole("link", { name: "Contracts" }).click();
    await p.waitForURL(/\/contracts/);
    await p.getByRole("button", { name: /^Filter/ }).waitFor();
    await sleep(2000);
    const addFilter = async (prop, value) => {
      await p.getByRole("button", { name: /^Filter/ }).click();
      await p.getByRole("dialog", { name: "Filter" }).getByRole("button", { name: prop, exact: true }).click();
      const any = await p.getByRole("dialog", { name: "Filter" }).getByText("Matches any selected value").isVisible().catch(() => false);
      await p.getByRole("dialog", { name: "Filter" }).getByRole("checkbox", { name: value, exact: true }).click();
      await p.getByRole("dialog", { name: "Filter" }).getByRole("button", { name: "Apply" }).click();
      await sleep(2500);
      return any;
    };
    const countText = async () => (await text(p.getByRole("region", { name: "Contracts" }).getByRole("paragraph").first())).trim();
    const allCount = await countText();
    const anyHint = await addFilter("Owner", "Daniel Okafor");
    const chip = await p.getByRole("button", { name: "Owner: Daniel Okafor" }).isVisible();
    const ownerUrl = p.url();
    const nums = await p.locator("main tbody tr, main [role=rowgroup]:nth-of-type(2) [role=row]").evaluateAll((rows) => rows.map((r) => (r.innerText.match(/C-(\d+)/) ?? [])[1]).filter(Boolean));
    const owners = nums.slice(0, 25).map((n) => sql(`select manager_id from contracts where number=${n}`));
    const allDaniel = owners.length > 0 && owners.every((o) => o === danielId);
    const ownerCount = await countText();
    await addFilter("Status", "Draft");
    const twoChips = (await p.getByRole("button", { name: /^Remove .* filter$/ }).count()) === 2;
    const bothCount = await countText();
    const titleHeader = p.getByRole("columnheader", { name: "Title" });
    await p.getByRole("button", { name: "Title", exact: true }).click();
    await p.waitForURL(/dir=asc/);
    const s1 = await titleHeader.getAttribute("aria-sort");
    await p.getByRole("button", { name: "Title", exact: true }).click();
    await p.waitForURL(/dir=desc/);
    const s2 = await titleHeader.getAttribute("aria-sort");
    await p.goBack();
    await p.waitForURL(/dir=asc/);
    await sleep(1500);
    const backSort = await titleHeader.getAttribute("aria-sort");
    await p.goBack();
    await p.waitForURL((u) => !u.search.includes("sort="));
    await sleep(1500);
    const back2Sort = await titleHeader.getAttribute("aria-sort");
    const back2Chips = await p.getByRole("button", { name: /^Remove .* filter$/ }).count();
    await p.goBack();
    await p.waitForURL((u) => !u.search.includes("status"), { timeout: 10000 }).catch(() => {});
    await sleep(1500);
    const back3Chips = await p.getByRole("button", { name: /^Remove .* filter$/ }).count();
    await p.goForward();
    await sleep(1500);
    const fwdChips = await p.getByRole("button", { name: /^Remove .* filter$/ }).count();
    await p.goForward();
    await p.waitForURL(/dir=asc/);
    await sleep(1500);
    const fwdSort = await titleHeader.getAttribute("aria-sort");
    await p.getByRole("button", { name: "Remove Status filter" }).click();
    await sleep(2000);
    const afterRemove = await p.getByRole("button", { name: /^Remove .* filter$/ }).count();
    await p.getByRole("button", { name: "Clear all" }).click();
    await sleep(2000);
    const afterClear = await p.getByRole("button", { name: /^Remove .* filter$/ }).count();
    R(
      "Filter and sort a list, steps 1-6, with Back and Forward",
      "Owner filter with Apply shows a chip and matching rows; another filter narrows; the Title heading cycles sort states; Back and Forward restore chips and sort; remove control and Clear all clear filters",
      `Count ${allCount} -> Owner ${ownerCount} -> Owner+Status ${bothCount}; chip ${chip}; hint Matches any selected value ${anyHint}; first-page rows all owned by Daniel ${allDaniel} (${owners.length}); URL carries owner ${/owner=/.test(ownerUrl)}; two chips ${twoChips}; Title sort ${s1} -> ${s2}; Back -> ${backSort}, Back -> ${back2Sort} with ${back2Chips} chips, Back -> ${back3Chips} chips; Forward -> ${fwdChips} chips, Forward -> ${fwdSort}; remove Status leaves ${afterRemove}; Clear all leaves ${afterClear}`,
      chip && anyHint && allDaniel && twoChips && s1 === "ascending" && s2 === "descending" && backSort === "ascending" && back2Sort === null && back2Chips === 2 && back3Chips === 1 && fwdChips === 2 && fwdSort === "ascending" && afterRemove === 1 && afterClear === 0 && ownerCount !== allCount && bothCount !== ownerCount,
    );

    await addFilter("Owner", "Me");
    const emptyState = await p.getByText("No contracts match these filters").first().waitFor({ timeout: 10000 }).then(() => true, () => false);
    await p.getByRole("button", { name: "Clear all" }).click();
    await sleep(2000);
    R("No contracts match these filters", "An empty filter answer shows the empty message; removing filters restores rows", `Owner Me shows the empty message ${emptyState}; rows after Clear all ${await p.locator("main tbody tr").count()}`, emptyState);

    }
    const addFilter = async (prop, value) => {
      await p.getByRole("button", { name: /^Filter/ }).click();
      await p.getByRole("dialog", { name: "Filter" }).getByRole("button", { name: prop, exact: true }).click();
      await p.getByRole("dialog", { name: "Filter" }).getByRole("checkbox", { name: value, exact: true }).click();
      await p.getByRole("dialog", { name: "Filter" }).getByRole("button", { name: "Apply" }).click();
      await sleep(2500);
    };
    // Save a view.
    const viewName = `DOC-029r2 access ${role === "administrator" ? "Administrator" : "Member"} portfolio ${stamp % 100000}`;
    const newName = `${viewName} renamed`;
    const headers = async () => p.locator("main th").evaluateAll((els) => els.map((e) => e.innerText.trim()).filter(Boolean));
    const sortIs = async (want) => {
      for (let i = 0; i < 40; i++) {
        if ((await p.getByRole("columnheader", { name: "Title" }).getAttribute("aria-sort")) === want) return true;
        await sleep(250);
      }
      return false;
    };
    await p.goto(`${BASE}/contracts`);
    await p.getByRole("button", { name: /^Filter/ }).waitFor();
    await sleep(1500);
    await addFilter("Owner", "Daniel Okafor");
    await p.getByRole("button", { name: "Title", exact: true }).click();
    await sortIs("ascending");
    await p.getByRole("button", { name: "Columns" }).click();
    await p.getByRole("button", { name: "Move Counterparty later" }).click({ timeout: 10000 });
    await p.keyboard.press("Escape");
    await sleep(800);
    const movedHeaders = await headers();
    const viewsBtn = p.getByRole("region", { name: "Contracts" }).getByRole("button").first();
    await viewsBtn.click();
    await p.getByRole("menuitem", { name: "Save as…" }).click();
    await p.getByRole("dialog").getByLabel("Name").fill(viewName);
    await p.getByRole("dialog").getByRole("button", { name: "Save" }).click();
    await sleep(2500);
    const savedLabel = await text(viewsBtn);
    const savedOk = savedLabel === viewName;

    await addFilter("Status", "Draft");
    const modified = (await text(viewsBtn)).includes("Modified");
    await viewsBtn.click();
    await p.getByRole("menuitem", { name: "Discard unsaved changes" }).click();
    await sleep(2500);
    const discarded = (await p.getByRole("button", { name: /^Remove .* filter$/ }).count()) === 1 && !(await text(viewsBtn)).includes("Modified");

    await p.getByRole("button", { name: "Title", exact: true }).click();
    await sortIs("descending");
    await sleep(1000);
    const modified2 = (await text(viewsBtn)).includes("Modified");
    await viewsBtn.click();
    await p.getByRole("menuitem", { name: "Save", exact: true }).click();
    await sleep(2500);
    const savedAgain = !(await text(viewsBtn)).includes("Modified");

    await viewsBtn.click();
    await p.getByRole("menuitemradio", { name: "Default view" }).click();
    await sleep(2500);
    const builtIn = (await p.getByRole("button", { name: /^Remove .* filter$/ }).count()) === 0 && (await text(viewsBtn)).startsWith("Default view");
    const builtInHeaders = await headers();
    await viewsBtn.click();
    await p.getByRole("menuitemradio", { name: viewName }).click();
    await sleep(2500);
    const restoredChip = await p.getByRole("button", { name: "Owner: Daniel Okafor" }).isVisible();
    const restoredSort = await p.getByRole("columnheader", { name: "Title" }).getAttribute("aria-sort");
    const restoredHeaders = await headers();
    if (role === "legal_team_member") await p.screenshot({ path: `${process.env.SHOT_DIR ?? "/tmp/claude-1000"}/r2-access-${role}-${Date.now()}.png` });
    R(
      "Save a view, steps 1-6, Modified, Save, Discard unsaved changes, Default view",
      "Save as… with a Name stores filters, sort and column order; a change marks Modified; Discard unsaved changes restores; Save replaces; Default view shows the built-in layout; selecting the view restores it",
      `Columns after Move Counterparty later: ${movedHeaders.join("|")}; saved label "${savedLabel}" ${savedOk}; change marked Modified ${modified}; Discard restored ${discarded}; second change Modified ${modified2}, Save cleared it ${savedAgain}; Default view built-in ${builtIn} (${builtInHeaders.join("|")}); reselected view: Owner chip ${restoredChip}, Title sort ${restoredSort}, columns ${restoredHeaders.join("|")}`,
      savedOk && modified && discarded && modified2 && savedAgain && builtIn && restoredChip && restoredSort === "descending" && JSON.stringify(restoredHeaders) === JSON.stringify(movedHeaders) && JSON.stringify(builtInHeaders) !== JSON.stringify(movedHeaders),
    );

    await viewsBtn.click();
    await p.getByRole("menuitem", { name: "Set as default" }).click();
    await sleep(1500);
    await p.getByRole("navigation", { name: "Primary" }).getByRole("link", { name: "Home", exact: true }).click();
    await p.waitForURL(`${BASE}/`);
    await p.getByRole("navigation", { name: "Primary" }).getByRole("link", { name: "Contracts" }).click();
    await p.waitForURL(/\/contracts/);
    await sleep(2500);
    const opensWithView = (await text(viewsBtn)).startsWith(viewName) && (await p.getByRole("button", { name: "Owner: Daniel Okafor" }).isVisible());
    await viewsBtn.click();
    await p.getByRole("menuitem", { name: "Rename…" }).click();
    await p.getByRole("dialog").getByLabel("Name").fill(newName);
    await p.getByRole("dialog").getByRole("button", { name: "Rename" }).click();
    await sleep(2000);
    const renamed = (await text(viewsBtn)).startsWith(newName);
    await viewsBtn.click();
    await p.getByRole("menuitem", { name: "Save as…" }).click();
    await p.getByRole("dialog").getByLabel("Name").fill(newName);
    await p.getByRole("dialog").getByRole("button", { name: "Save" }).click();
    await sleep(2000);
    const dupDialog = await p.getByRole("dialog").isVisible().catch(() => false);
    const dupText = dupDialog ? await text(p.getByRole("dialog")) : "";
    const views = must(await api(p, "GET", "/list-views?surface=contracts"), "views").views ?? [];
    const dupRefused = dupDialog && views.filter((v) => v.name === newName).length <= 1;
    if (dupDialog) await p.getByRole("dialog").getByRole("button", { name: "Cancel" }).click();

    const other = await signInAs(acct.email, acct.password);
    await other.page.goto(`${BASE}/contracts`);
    await sleep(3000);
    const otherBtn = other.page.getByRole("region", { name: "Contracts" }).getByRole("button").first();
    const otherHasView = (await text(otherBtn)).startsWith(newName) && (await other.page.getByRole("button", { name: "Owner: Daniel Okafor" }).isVisible());
    await other.context.close();
    R(
      "Set as default, Rename…, duplicate name, another device",
      "Set as default opens the list with the view; Rename… changes the name; a duplicate name is refused; the view follows the account to another browser",
      `Opens with view after leaving and returning ${opensWithView}; renamed ${renamed}; duplicate Save as… kept the dialog open ${dupDialog} ("${dupText.slice(0, 120)}"), stored views with that name ${views.filter((v) => v.name === newName).length}; second browser opened the view with its chip ${otherHasView}`,
      opensWithView && renamed && dupRefused && otherHasView,
    );

    const rowsBefore = sql(`select count(*) from contracts`);
    await viewsBtn.click();
    await p.getByRole("menuitem", { name: "Delete…" }).click();
    const delText = await text(p.getByRole("alertdialog").or(p.getByRole("dialog")).first());
    await p.getByRole("alertdialog").or(p.getByRole("dialog")).first().getByRole("button", { name: "Delete" }).click();
    await sleep(2500);
    await viewsBtn.click();
    const stillListed = (await p.getByRole("menuitemradio", { name: newName }).count()) > 0;
    await p.keyboard.press("Escape");
    const rowsAfter = sql(`select count(*) from contracts`);
    R(
      "Delete… removes the saved view after confirmation and does not delete records",
      "Confirmation says the records are not touched; the view is gone; records remain",
      `Dialog: "${delText.slice(0, 140)}"; view still listed ${stillListed}; contract rows in database ${rowsBefore} -> ${rowsAfter}`,
      delText.includes("The records in it are not touched.") && !stillListed && Number(rowsAfter) >= Number(rowsBefore),
    );
    await c.context.close();
  }
  await admin.context.close();
}
