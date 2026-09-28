// DOC-032 documents-2: contributor-guide (V-C25), Business User Ravi Menon, browser walkthrough.
// Written by the DOC-032 independent walkthrough agent (documents-2) from the article text, on the
// DOC-030 access contributor() pattern (docs/documentation/batches/DOC-030/access/walkthrough.mjs).
// Every guide step runs in Ravi's browser. Legal (Nadia Haddad) and the Administrator
// (Daniel Okafor) act through their own browser contexts where the guide names their action, and
// through API calls only for fixtures, a second actor's competing write, and state reads.
// Every record this part creates is new and named "DOC-032 documents-2 V-C25 <what> <STAMP>".
// The run adds one Administrator-added Contract Document type in Settings and archives it at the end.
import { mkdirSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { expectThat as check, pdf, sleep, sql } from "./lib.mjs";

const ARTICLE = "contributor-guide";
const SCENARIO = "V-C25";
const BU = "business_user";

export default async function contributor(ctx) {
  const { BASE, lab, STAMP, results, sessions, PEOPLE, here } = ctx;
  const project = lab.project;
  const name = (s) => `DOC-032 documents-2 V-C25 ${s} ${STAMP}`;
  const fileTag = `doc032-vc25-${STAMP}`;
  const tmp = path.join(os.tmpdir(), `doc032-vc25-${STAMP}`);
  mkdirSync(tmp, { recursive: true });
  const file = (n, body) => {
    const p = path.join(tmp, n);
    writeFileSync(p, body);
    return p;
  };
  const record = (kind, label, ref) => results.records.push({ kind, name: label, ref });
  const step = (o, fn) =>
    ctx.step(
      {
        article: ARTICLE,
        scenario: SCENARIO,
        role: BU,
        actors: [PEOPLE.ravi.name],
        independent: true,
        ...o,
      },
      fn,
    );

  // ---------------------------------------------------------------- helpers
  const text = async (locator) =>
    (await locator.innerText().catch(() => "")).replace(/\s+/g, " ").trim();
  const settle = async (page) => {
    await page.waitForLoadState("networkidle", { timeout: 15000 }).catch(() => {});
    await sleep(600);
  };
  const go = async (page, url) => {
    await page.goto(`${BASE}${url}`);
    await settle(page);
    if (/Something went wrong\./.test(await text(page.locator("body")))) {
      await page.reload();
      await settle(page);
    }
  };
  const h1 = async (page) => {
    const heading = page.getByRole("heading", { level: 1 }).first();
    await heading.waitFor({ timeout: 15000 });
    return (await heading.innerText()).trim();
  };
  const applet = async (page, appletName) => {
    const panel = page.getByRole("complementary", { name: appletName, exact: true });
    if (!(await panel.isVisible().catch(() => false))) {
      await page
        .getByRole("toolbar", { name: "Applets" })
        .getByRole("button", { name: new RegExp(`^${appletName}\\b`) })
        .first()
        .click();
    }
    await panel.waitFor({ timeout: 10000 });
    await sleep(700);
    return panel;
  };
  const rosterRows = async (panel) =>
    (await panel.getByRole("listitem").allInnerTexts()).map((t) => t.replace(/\s+/g, " ").trim());
  const NOT_FOUND = /does not exist, or you cannot open it/;
  const openRecord = async (page, url) => {
    await go(page, url);
    const title = await h1(page);
    const body = await text(page.locator("body"));
    return { title, refused: NOT_FOUND.test(body) || /not found/.test(title) };
  };
  const addTeamMember = async (page, appletName, person) => {
    const panel = await applet(page, appletName);
    const add = panel.getByRole("button", { name: "Add team member" });
    check(await add.isEnabled(), "Add team member is disabled");
    await add.click();
    const dialog = page.getByRole("dialog", { name: "Add team member" });
    await dialog.waitFor();
    const options = (
      await dialog.getByRole("combobox", { name: "Person" }).locator("option").allInnerTexts()
    ).map((s) => s.trim());
    await dialog.getByRole("combobox", { name: "Person" }).selectOption({ label: person });
    await dialog.getByRole("button", { name: "Add", exact: true }).click();
    await dialog.waitFor({ state: "hidden", timeout: 10000 });
    await panel.getByText(person, { exact: false }).first().waitFor({ timeout: 10000 });
    return { options };
  };
  const removeTeamMember = async (page, appletName, person, module) => {
    const panel = await applet(page, appletName);
    const remove = panel.getByRole("button", { name: `Take ${person} off the ${module} team` });
    await remove.click();
    const confirm = page.getByRole("alertdialog");
    if (await confirm.isVisible({ timeout: 1500 }).catch(() => false))
      await confirm
        .getByRole("button")
        .filter({ hasNotText: /Cancel/ })
        .last()
        .click();
    await remove.waitFor({ state: "detached", timeout: 10000 });
  };
  const call = async (s, method, p, data) => {
    const r = await s.api(method, p, data);
    return { status: r.status, body: r.json };
  };
  const must = (r, what) => {
    if (r.status >= 300)
      throw new Error(`${what}: ${r.status} ${JSON.stringify(r.body).slice(0, 300)}`);
    return r.body;
  };
  const upload = async (s, p, fileName, content, mimeType = "text/plain", extra = {}) => {
    const r = await s.page.request.fetch(`${BASE}/api/v1${p}`, {
      method: "POST",
      headers: { origin: BASE },
      failOnStatusCode: false,
      multipart: { ...extra, file: { name: fileName, mimeType, buffer: Buffer.from(content) } },
    });
    let body = null;
    try {
      body = await r.json();
    } catch {}
    return { status: r.status(), body };
  };
  const portalActivity = async (reader, entityType, entityId) => {
    const r = await call(
      reader,
      "GET",
      `/portal/activity?entityType=${entityType}&entityId=${entityId}`,
    );
    return (r.body?.entries ?? []).map((e) => ({ id: e.id, action: e.action }));
  };
  const historyPanel = async (page, url) => {
    await go(page, url);
    const panel = await applet(page, "History");
    await sleep(800);
    return text(panel);
  };

  // ---------------------------------------------------------------- people
  const daniel = await sessions.password(PEOPLE.daniel);
  const nadia = await sessions.password(PEOPLE.nadia);
  const N = nadia.page;
  const D = daniel.page;
  let ravi = null;
  let clara = null;
  const fx = {};
  const added = { docType: null, raviOnMc: false };

  try {
    // ------------------------------------------------------------ fixtures
    await step(
      {
        role: "legal_team_member",
        actors: [PEOPLE.daniel.name, PEOPLE.nadia.name, PEOPLE.ravi.name],
        page: "/api/v1 (fixtures)",
        action:
          "Fixtures (API): Fields and two Contract types with Forms, a Request by Ravi that Legal converts, Matters, a Document paging Matter, Contracts to page Your Contracts, and a second-type Contract.",
        expected: "Every fixture answers 2xx; Ravi is Business Owner of the converted Contract.",
      },
      async () => {
        const users = must(await call(daniel, "GET", "/users"), "users").users;
        const uid = (email) => users.find((u) => u.email === email).id;
        fx.ids = {
          ravi: uid(PEOPLE.ravi.email),
          nadia: uid(PEOPLE.nadia.email),
          clara: uid(PEOPLE.clara.email),
          daniel: uid(PEOPLE.daniel.email),
        };
        const ctypes = must(await call(daniel, "GET", "/contract-types"), "ctypes").contractTypes;
        const mtypes = must(await call(daniel, "GET", "/matter-types"), "mtypes").matterTypes;
        const depts = must(await call(daniel, "GET", "/departments"), "depts").departments;
        fx.nda = ctypes.find((t) => t.displayName === "NDA").id;
        fx.commercial = mtypes.find((t) => t.displayName === "Commercial").id;
        fx.sales = depts.find((t) => t.displayName === "Sales").id;

        // Fields and Forms: shown on one type's Form and hidden on another's, a hidden Field, a Branch.
        const field = async (label, fieldType) => {
          const f = must(
            await call(daniel, "POST", "/fields", {
              displayName: name(label),
              moduleScope: "contract",
              fieldType,
            }),
            label,
          ).field;
          record("field", f.displayName, f.id);
          return { id: f.id, key: f.slug, name: f.displayName, fieldType: f.fieldType };
        };
        const visible = await field("Visible field", "text");
        const hidden = await field("Hidden field", "text");
        const gate = await field("Gate", "boolean");
        const branch = await field("Branch field", "text");
        const baseForm = must(
          await call(daniel, "GET", `/contract-types/${fx.nda}/form`),
          "form",
        ).form;
        const row = (f, visibleOnPortal) => ({
          kind: "row",
          id: f.id,
          rowRef: f.key,
          fieldType: f.fieldType,
          onIntakeForm: false,
          isRequired: false,
          visibleOnPortal,
        });
        const ctype = async (label) => {
          const t = must(
            await call(daniel, "POST", "/contract-types", { displayName: name(label) }),
            label,
          ).contractType;
          record("contract_type", t.displayName, t.id);
          return t;
        };
        const typeA = await ctype("Form type");
        const typeB = await ctype("Second type");
        must(
          await call(daniel, "PUT", `/contract-types/${typeA.id}/form`, {
            form: [
              ...baseForm,
              row(visible, true),
              row(hidden, false),
              row(gate, true),
              {
                kind: "branch",
                id: `doc032-vc25-branch-${STAMP}`,
                match: "all",
                conditions: [{ rowRef: gate.key, operator: "equals", value: true }],
                children: [row(branch, true)],
              },
            ],
          }),
          "form A",
        );
        must(
          await call(daniel, "PUT", `/contract-types/${typeB.id}/form`, {
            form: [...baseForm, row(visible, false)],
          }),
          "form B",
        );
        fx.form = { typeA, typeB, visible, hidden, gate, branch };

        // Ravi's Request, converted by Legal (other guides' steps; fixtures here).
        ravi = await sessions.magic(PEOPLE.ravi);
        const rt = must(
          await call(ravi, "GET", "/portal/request-types/contract_review"),
          "request type",
        ).requestType;
        const rq = must(
          await call(ravi, "POST", "/requests", {
            requestTypeId: rt.id,
            departmentId: fx.sales,
            title: name("Ravi request"),
            description: `DOC-032 documents-2 V-C25 fictional ask from Ravi ${STAMP}.`,
            urgency: "medium",
          }),
          "request",
        ).request;
        record("request", name("Ravi request"), `R-${rq.number}`);
        const cv = must(
          await call(nadia, "POST", `/requests/${rq.number}/convert`, {
            title: name("Ravi converted contract"),
            contractTypeId: typeA.id,
          }),
          "convert",
        );
        const rec = cv.request?.convertedRecord ?? cv.request?.conversion?.convertedRecord;
        fx.cr = {
          number: rec.number,
          id: rec.id ?? sql(project, `select id from contracts where number=${Number(rec.number)}`),
          title: name("Ravi converted contract"),
        };
        check(fx.cr.id, "converted Contract id not found");
        record("contract", fx.cr.title, `C-${fx.cr.number}`);

        const primary = must(
          await upload(
            nadia,
            `/contracts/${fx.cr.number}/documents`,
            `${fileTag}-supporting-v1.txt`,
            "DOC-032 V-C25 fictional supporting paper, version 1.\n",
          ),
          "primary",
        );
        fx.primary = { id: primary.document.id, v1: primary.document.versions[0].id };
        must(
          await call(nadia, "PATCH", `/contracts/${fx.cr.number}`, {
            customFields: {
              [visible.key]: `DOC-032 V-C25 shown value ${STAMP}`,
              [hidden.key]: `DOC-032 V-C25 hidden value ${STAMP}`,
              [gate.key]: false,
            },
            region: "EMEA",
            owningDepartmentId: fx.sales,
            value: { amount: 1200000, currency: "GBP", cadence: "annually" },
            effectiveDate: "2026-01-01",
            expiryDate: "2027-12-31",
          }),
          "contract fields",
        );
        const cp = must(
          await call(nadia, "POST", `/contracts/${fx.cr.number}/counterparties`, {
            name: name("Fictional Supplier Ltd"),
          }),
          "counterparty",
        );
        record("counterparty", name("Fictional Supplier Ltd"), cp?.counterparty?.id ?? null);

        const matter = async (label, extra = {}) => {
          const m = must(
            await call(nadia, "POST", "/matters", {
              title: name(label),
              matterTypeId: fx.commercial,
              managerId: fx.ids.nadia,
              ...extra,
            }),
            label,
          ).matter;
          record("matter", m.title, `M-${m.number}`);
          return { number: m.number, id: m.id, title: m.title };
        };
        fx.mr = await matter("Ravi matter", {
          departmentId: fx.sales,
          region: "EMEA",
          description: "DOC-032 V-C25 fictional Matter description.",
        });
        fx.mx = await matter("comparable matter");
        fx.mc = await matter("confidential matter", { isConfidential: true });
        fx.dm = await matter("document paging matter");
        must(
          await call(nadia, "POST", `/matters/${fx.dm.number}/team`, { userId: fx.ids.ravi }),
          "DM team",
        );
        for (let i = 1; i <= 51; i++)
          must(
            await upload(
              nadia,
              `/matters/${fx.dm.number}/documents`,
              `${fileTag}-page-${String(i).padStart(2, "0")}.txt`,
              `DOC-032 V-C25 fictional paging paper ${i}.\n`,
            ),
            `page ${i}`,
          );

        const contract = async (label, extra = {}) => {
          const c = must(
            await call(nadia, "POST", "/contracts", {
              title: name(label),
              contractTypeId: fx.nda,
              managerId: fx.ids.nadia,
              ...extra,
            }),
            label,
          ).contract;
          record("contract", c.title, `C-${c.number}`);
          return { number: c.number, id: c.id, title: c.title };
        };
        fx.cr2 = await contract("Ravi second type contract", { contractTypeId: typeB.id });
        must(
          await call(nadia, "PATCH", `/contracts/${fx.cr2.number}`, {
            customFields: { [visible.key]: "DOC-032 V-C25 value on the second type" },
          }),
          "cr2 field",
        );
        must(
          await call(nadia, "POST", `/contracts/${fx.cr2.number}/team`, { userId: fx.ids.ravi }),
          "cr2 team",
        );
        // Your Contracts holds 25 rows a page; top Ravi's list up to 30 so Show more has a page.
        const onTeam = Number(
          sql(
            project,
            `select count(*) from contract_team t join contracts c on c.id=t.contract_id where t.user_id='${fx.ids.ravi}' and c.archived_at is null`,
          ),
        );
        fx.paging = [];
        for (let i = 1; i <= Math.max(0, 30 - onTeam); i++) {
          const c = await contract(`paging contract ${String(i).padStart(2, "0")}`);
          must(
            await call(nadia, "POST", `/contracts/${c.number}/team`, { userId: fx.ids.ravi }),
            `paging team ${i}`,
          );
          fx.paging.push(c.number);
        }
        const earlierPaging = sql(
          project,
          `select string_agg('C-' || c.number, ', ' order by c.number) from contracts c join contract_team t on t.contract_id=c.id where t.user_id='${fx.ids.ravi}' and c.archived_at is null and c.title like 'DOC-032 documents-2 V-C25 paging contract %' and c.title not like '%${STAMP}'`,
        );
        if (earlierPaging)
          record(
            "contract",
            "DOC-032 documents-2 V-C25 paging contract NN <earlier run stamp> (created by an earlier run of this part, Ravi on team)",
            earlierPaging,
          );
        const convertedTeam = sql(
          project,
          `select string_agg(u.display_name, ', ') from contract_team t join users u on u.id=t.user_id where t.contract_id='${fx.cr.id}'`,
        );
        return `Created two Contract types ("${typeA.displayName}" with Visible, Hidden, Gate and a Branch holding the Branch field; "${typeB.displayName}" with the Visible field's Row off the Portal). Ravi submitted R-${rq.number} (API as Ravi); Nadia converted it to C-${fx.cr.number} on the Form type, uploaded the first Document, set Fields, Value, dates, Department Sales, Region EMEA and the primary Counterparty. Matters M-${fx.mr.number} (Ravi's), M-${fx.mx.number} (comparable), M-${fx.mc.number} (Confidential), M-${fx.dm.number} (51 Documents, Ravi on team). C-${fx.cr2.number} on the second type with Ravi on team. Ravi was on ${onTeam} live Contract teams; ${fx.paging.length} paging Contracts added${earlierPaging ? ` (paging Contracts from an earlier run of this part: ${earlierPaging})` : ""}. C-${fx.cr.number} team from the database: ${convertedTeam}.`;
      },
    );
    ravi ??= await sessions.magic(PEOPLE.ravi);
    const R = ravi.page;
    const CR = fx.cr?.number;
    const MR = fx.mr?.number;

    // Administrator adds a run-named Contract Document type in Settings (browser).
    const ADMIN_TYPE = name("Contract document type");
    await step(
      {
        role: "administrator",
        actors: [PEOPLE.daniel.name],
        page: "/settings/documents/contracts",
        action: `Setup as Administrator in the browser: Settings, Documents, Contracts tab, Add type "${ADMIN_TYPE}", Save.`,
        expected: "The new type appears in the Contracts list.",
      },
      async () => {
        await go(D, "/settings/documents/contracts");
        await D.getByRole("button", { name: "Add type" }).click();
        await D.getByLabel("New type name").fill(ADMIN_TYPE);
        await D.getByRole("button", { name: "Save", exact: true }).click();
        await D.getByText(ADMIN_TYPE, { exact: true }).first().waitFor({ timeout: 15000 });
        const types = must(
          await call(daniel, "GET", "/documents/types/contract"),
          "types",
        ).documentTypes;
        const t = types.find((x) => x.displayName === ADMIN_TYPE && !x.archivedAt);
        check(t, "type not read back");
        added.docType = { id: t.id, name: ADMIN_TYPE, archivedAfterRun: false };
        record("document_type:contract", ADMIN_TYPE, t.id);
        fx.fixedTypes = Object.fromEntries(
          types.filter((x) => x.systemKind).map((x) => [x.systemKind, x]),
        );
        return `Add type, New type name "${ADMIN_TYPE}", Save added the row on the Contracts tab (read back active). The run archives it at the end.`;
      },
    );

    // ------------------------------------------------------------ Before you start
    await step(
      {
        page: `/portal/matters/${MR}`,
        actors: [PEOPLE.ravi.name, PEOPLE.nadia.name],
        action:
          "Before Legal adds Ravi, open the Matter; Nadia adds him with Matter team in the full app; select Matters in the Portal navigation bar and choose the record; check title and M- reference; open a comparable Matter by its link; check the converted Contract's team.",
        expected:
          "The record opens only after Legal adds him; the title and reference show; being Business Owner adds you to the team; a copied link to a comparable record does not grant access.",
      },
      async () => {
        const before = await openRecord(R, `/portal/matters/${MR}`);
        await go(N, `/matters/${MR}`);
        await addTeamMember(N, "Matter team", PEOPLE.ravi.name);
        await go(R, "/portal");
        await R.getByRole("navigation", { name: "Portal" })
          .getByRole("link", { name: "Matters" })
          .click();
        await settle(R);
        await R.getByRole("link", { name: fx.mr.title }).click();
        await settle(R);
        const title = await h1(R);
        const main = await text(R.getByRole("main"));
        const comparable = await openRecord(R, `/portal/matters/${fx.mx.number}`);
        await go(R, "/portal");
        await R.getByRole("navigation", { name: "Portal" })
          .getByRole("link", { name: "Contracts" })
          .click();
        await settle(R);
        await R.getByRole("searchbox", { name: "Search Contracts" }).fill(fx.cr.title);
        await R.getByRole("searchbox", { name: "Search Contracts" }).press("Enter");
        await settle(R);
        await R.getByRole("link", { name: fx.cr.title }).click();
        await settle(R);
        const cMain = await text(R.getByRole("main"));
        const rows = await rosterRows(await applet(R, "Contract team"));
        check(
          before.refused &&
            title === fx.mr.title &&
            main.includes(`M-${MR}`) &&
            comparable.refused &&
            cMain.includes(`C-${CR}`) &&
            rows.some((r) => /Business Owner/.test(r) && r.includes(PEOPLE.ravi.name)),
          JSON.stringify({ before, title, comparable, rows }),
        );
        return `Before: "${before.title}". After Nadia added Ravi through Matter team in the full app, Portal Matters listed the record; it showed "${title}" and M-${MR}. The comparable M-${fx.mx.number} link showed "${comparable.title}". Ravi opened his converted C-${CR} from Contracts; its Contract team read: ${rows.join(" | ")}.`;
      },
    );

    // ------------------------------------------------------------ Find a record
    await step(
      {
        page: "/portal/matters",
        action:
          "Enter a title or M- reference in Search and press Enter or select Search; search Contracts by the primary Counterparty.",
        expected:
          "Search matches title and reference; Contract search also matches the primary Counterparty.",
      },
      async () => {
        await go(R, "/portal/matters");
        const box = R.getByRole("searchbox", { name: "Search Matters" });
        await box.fill(`V-C25 Ravi matter ${STAMP}`);
        await box.press("Enter");
        await settle(R);
        const byTitle = await text(R.getByRole("table"));
        await box.fill(`M-${MR}`);
        await R.getByRole("search", { name: "Search Matters" })
          .getByRole("button", { name: "Search", exact: true })
          .click();
        await settle(R);
        const byRef = await text(R.getByRole("table"));
        await go(R, "/portal/contracts");
        const cbox = R.getByRole("searchbox", { name: "Search Contracts" });
        await cbox.fill(`Fictional Supplier Ltd ${STAMP}`);
        await cbox.press("Enter");
        await settle(R);
        const byCp = await text(R.getByRole("table"));
        const cpRows = (await R.getByRole("table").getByRole("row").count()) - 1;
        check(
          byTitle.includes(`M-${MR}`) &&
            byRef.includes(`M-${MR}`) &&
            !byRef.includes(`M-${fx.dm.number}`) &&
            byCp.includes(`C-${CR}`) &&
            cpRows === 1,
          JSON.stringify({ byTitle, byRef, byCp }).slice(0, 500),
        );
        return `"V-C25 Ravi matter ${STAMP}" + Enter listed M-${MR}; "M-${MR}" + Search listed only M-${MR}; Contracts search "Fictional Supplier Ltd ${STAMP}" (the primary Counterparty's name, not in the title) listed ${cpRows} row: C-${CR}.`;
      },
    );

    await step(
      {
        page: "/portal/contracts",
        action:
          "Select Filter on Contracts and Matters; choose a property and value; select Apply; combine with Search; remove a chip; use Clear all.",
        expected:
          "Contracts offer Stage, Type, Legal Owner and Expiry date; Matters offer Status, Type, Matter Manager and open or closed lifecycle; filters combine with search; removing a chip or Clear all widens the list.",
      },
      async () => {
        await go(R, "/portal/contracts");
        const cbox = R.getByRole("searchbox", { name: "Search Contracts" });
        await cbox.fill(`DOC-032 documents-2 V-C25`);
        await cbox.press("Enter");
        await settle(R);
        const searchOnly = (await R.getByRole("table").getByRole("row").count()) - 1;
        await R.getByRole("button", { name: "Filter", exact: true }).click();
        const cd = R.getByRole("dialog", { name: "Filter" });
        const cprops = (await cd.getByRole("button").allInnerTexts()).map((s) => s.trim());
        await cd.getByRole("button", { name: "Type", exact: true }).click();
        await sleep(400);
        const tdlg = R.getByRole("dialog").last();
        await tdlg.getByRole("textbox", { name: "Search choices" }).fill(fx.form.typeA.displayName);
        await tdlg.getByText(fx.form.typeA.displayName, { exact: true }).click();
        await tdlg.getByRole("button", { name: "Apply" }).click();
        await settle(R);
        const combined = await text(R.getByRole("table"));
        const combinedRows = (await R.getByRole("table").getByRole("row").count()) - 1;
        const cchips = await R.getByRole("button", { name: /Remove .* filter/ }).count();
        const caddr = new URL(R.url()).search;
        await R.getByRole("button", { name: /Remove .* filter/ })
          .first()
          .click();
        await settle(R);
        const afterChip = (await R.getByRole("table").getByRole("row").count()) - 1;
        const chipsLeft = await R.getByRole("button", { name: /Remove .* filter/ }).count();

        await go(R, "/portal/matters");
        await R.getByRole("button", { name: "Filter", exact: true }).click();
        const fd = R.getByRole("dialog", { name: "Filter" });
        const mprops = (await fd.getByRole("button").allInnerTexts()).map((s) => s.trim());
        await fd.getByRole("button", { name: "Lifecycle" }).click();
        await sleep(500);
        const life = await text(R.getByRole("dialog").last());
        await R.getByRole("dialog").last().getByText("Open", { exact: true }).first().click();
        await R.getByRole("dialog").last().getByRole("button", { name: "Apply" }).click();
        await settle(R);
        const box = R.getByRole("searchbox", { name: "Search Matters" });
        await box.fill("DOC-032 documents-2 V-C25");
        await box.press("Enter");
        await settle(R);
        const chips = await R.getByRole("button", { name: /Remove .* filter/ }).count();
        const url = new URL(R.url()).search;
        await R.getByRole("button", { name: "Clear all" }).click();
        await settle(R);
        const cleared = await R.getByRole("button", { name: /Remove .* filter/ }).count();
        check(
          ["Type", "Legal Owner", "Stage", "Expiry date"].every((p) => cprops.includes(p)) &&
            ["Type", "Matter Manager", "Status", "Lifecycle"].every((p) => mprops.includes(p)) &&
            combinedRows === 1 &&
            combined.includes(`C-${CR}`) &&
            searchOnly > 1 &&
            cchips === 1 &&
            chipsLeft === 0 &&
            afterChip === searchOnly &&
            chips === 1 &&
            cleared === 0,
          JSON.stringify({ cprops, mprops, searchOnly, combinedRows, cchips, afterChip, chips }),
        );
        return `Contracts Filter offered ${cprops.join(", ")}; Matters Filter offered ${mprops.join(", ")}. Search "DOC-032 documents-2 V-C25" listed ${searchOnly} Contracts; adding Type "${fx.form.typeA.displayName}" and Apply gave 1 chip and 1 row (C-${CR}; address ${caddr}); removing the chip returned ${afterChip} rows. Matters Lifecycle showed "${life.slice(0, 80)}"; Lifecycle Open with search gave 1 chip (address ${url}); Clear all removed it (${cleared} chips).`;
      },
    );

    await step(
      {
        page: "/portal/contracts",
        action:
          "Select the Title heading three times; open a record and go Back; reopen the bookmarked address; use Columns; drag the Reference heading's edge; select Show more.",
        expected:
          "Sorting cycles ascending, descending and default; Columns chooses and reorders columns; the edge resizes; Show more adds the next page; the address keeps search, filters and sorting.",
      },
      async () => {
        await go(R, "/portal/contracts");
        const rowsBefore = await R.getByRole("table").getByRole("row").count();
        await R.getByRole("button", { name: "Show more" }).click();
        await settle(R);
        const rowsAfter = await R.getByRole("table").getByRole("row").count();
        const heading = R.getByRole("columnheader", { name: "Title" }).getByRole("button", {
          name: "Title",
        });
        const sorts = [];
        for (let i = 0; i < 3; i++) {
          await heading.click();
          await settle(R);
          sorts.push(
            `${await R.getByRole("columnheader", { name: "Title" }).getAttribute("aria-sort")} ${new URL(R.url()).search || "(no query)"}`,
          );
        }
        await heading.click();
        await settle(R);
        const bookmarked = R.url();
        await R.locator("main table a[href*='/portal/contracts/']").first().click();
        await settle(R);
        await R.goBack();
        await settle(R);
        const back = R.url();
        await R.getByRole("button", { name: "Columns" }).click();
        await sleep(500);
        const colPanel = R.getByRole("dialog").or(R.getByRole("menu")).last();
        const colText = await text(colPanel);
        const moveControls = await colPanel.getByRole("button", { name: /Move|up|down/i }).count();
        const checkboxes = await colPanel.getByRole("checkbox").count();
        await R.keyboard.press("Escape");
        const sep = R.getByRole("separator", { name: "Width of the Reference column" });
        const w0 = (await R.getByRole("columnheader", { name: "Reference" }).boundingBox()).width;
        const sb = await sep.boundingBox();
        await R.mouse.move(sb.x + 2, sb.y + sb.height / 2);
        await R.mouse.down();
        await R.mouse.move(sb.x + 60, sb.y + sb.height / 2, { steps: 6 });
        await R.mouse.move(sb.x + 120, sb.y + sb.height / 2, { steps: 6 });
        await R.mouse.up();
        await sleep(400);
        const w1 = (await R.getByRole("columnheader", { name: "Reference" }).boundingBox()).width;
        await sep.focus();
        await R.keyboard.press("Home");
        await R.goto(bookmarked);
        await settle(R);
        const reopened = await R.getByRole("columnheader", { name: "Title" }).getAttribute(
          "aria-sort",
        );
        check(
          rowsAfter > rowsBefore &&
            /ascending/.test(sorts[0]) &&
            /descending/.test(sorts[1]) &&
            /sort=/.test(sorts[0]) &&
            /sort=/.test(sorts[1]) &&
            !/sort=/.test(sorts[2]) &&
            back === bookmarked &&
            reopened === "ascending" &&
            Math.abs(w1 - w0) > 40 &&
            /Reference/.test(colText) &&
            /Title/.test(colText),
          JSON.stringify({ rowsBefore, rowsAfter, sorts, back, bookmarked, w0, w1, colText }),
        );
        return `Your Contracts rows ${rowsBefore - 1} -> ${rowsAfter - 1} after Show more. Title heading: ${sorts.join(" -> ")}. Back from a record returned to ${new URL(back).search}; reopening the bookmarked address kept aria-sort ${reopened}. Columns showed "${colText.slice(0, 160)}" (${checkboxes} checkboxes, ${moveControls} move controls). Dragging the Reference edge changed its width ${Math.round(w0)} -> ${Math.round(w1)} px.`;
      },
    );

    // ------------------------------------------------------------ Read record information
    await step(
      {
        page: `/portal/contracts/${CR}`,
        actors: [PEOPLE.ravi.name, PEOPLE.nadia.name],
        action:
          "Read the record details and Fields on the Contract and the Matter; look for edit controls; Legal changes a Visible on Portal Field and the Description (API, second actor); reload; read Original request; open the second-type Contract.",
        expected:
          "Department and Region on both; Overview with Value and dates; Visible on Portal Rows and Description are read-only; a Row off the Portal is absent; a Row under a false Branch is still listed; an empty Field shows Not recorded; Legal's change appears on reload; Original request is read-only and does not change; the same Field is hidden on the other type's Form.",
      },
      async () => {
        await go(R, `/portal/matters/${MR}`);
        const mMain = await text(R.getByRole("main"));
        await go(R, `/portal/contracts/${CR}`);
        const overview = await text(R.getByRole("region", { name: "Overview" }));
        const fText = await text(R.getByRole("region", { name: "Fields" }));
        const editable = await R.getByRole("main")
          .locator(
            "input:not([type=file]):not([type=search]), textarea, select, [contenteditable=true]",
          )
          .evaluateAll((els) =>
            els
              .filter(
                (e) =>
                  !e.closest("[role=search]") &&
                  e.getAttribute("aria-label") !== "Search Documents",
              )
              .map((e) => e.getAttribute("aria-label") ?? e.tagName),
          );
        const newValue = `DOC-032 V-C25 Legal update ${STAMP}`;
        const newDescription = `DOC-032 V-C25 live description ${STAMP}`;
        must(
          await call(nadia, "PATCH", `/contracts/${CR}`, {
            customFields: { [fx.form.visible.key]: newValue },
            description: newDescription,
          }),
          "legal change",
        );
        await R.reload();
        await settle(R);
        const fAfter = await text(R.getByRole("region", { name: "Fields" }));
        const main = await text(R.getByRole("main"));
        const original = main.slice(main.indexOf("Original request"));
        const originalEditable = await R.getByRole("region", { name: "Original request" })
          .locator("input, textarea, select, [contenteditable=true]")
          .count()
          .catch(() => 0);
        await go(R, `/portal/contracts/${fx.cr2.number}`);
        const cr2Fields = await text(R.getByRole("region", { name: "Fields" }));
        const bi = fText.indexOf(fx.form.branch.name);
        const branchRow = bi >= 0 ? fText.slice(bi, bi + fx.form.branch.name.length + 14) : "";
        check(
          /Department/.test(mMain) &&
            /Region/.test(mMain) &&
            !/Original request/.test(mMain) &&
            /Department/.test(overview) &&
            /Region/.test(overview) &&
            /Value/.test(overview) &&
            /Effective date/.test(overview) &&
            /Expiry date/.test(overview),
          overview,
        );
        check(
          fText.includes(fx.form.visible.name) &&
            !fText.includes(fx.form.hidden.name) &&
            fText.includes(fx.form.gate.name) &&
            /Not recorded/.test(branchRow) &&
            editable.length === 0,
          JSON.stringify({ fText, editable }),
        );
        check(
          fAfter.includes(newValue) &&
            fAfter.includes(newDescription) &&
            original.includes(`fictional ask from Ravi ${STAMP}`) &&
            !original.includes(newDescription) &&
            /Ravi Menon/.test(original) &&
            /Submitted/.test(original) &&
            originalEditable === 0 &&
            !cr2Fields.includes(fx.form.visible.name),
          JSON.stringify({ original: original.slice(0, 200), cr2Fields }),
        );
        if (/Not recorded/.test(branchRow))
          results.productBugs.push({
            title: "Portal record ignores Form Branch conditions (known since DOC-030)",
            severity: "minor",
            reproduction: `On the work lab, C-${CR} uses Contract type "${fx.form.typeA.displayName}", whose Branch shows "${fx.form.branch.name}" only when "${fx.form.gate.name}" is Yes. With the Gate at No and the Branch field empty, Ravi Menon's Portal record lists the Branch field as Not recorded. The staff record applies the Form evaluator; the Portal record does not (DD-028 points 4 and 5).`,
            guideImpact:
              "None: the guide says the Portal lists every Field whose Row is Visible on Portal, even when a Branch condition does not hold.",
          });
        return `M-${MR} showed Department and Region and no Original request (it started without a Request). C-${CR} Overview: "${overview.slice(0, 280)}". Fields: "${fText.slice(0, 420)}". The Visible field and the Gate (No) were listed; the Hidden field (Row off the Portal) was absent; the Branch field read "${branchRow}" although the Gate is No. Editable controls in the record: ${editable.length}. After Nadia changed the Visible field and the Description, Ravi's reload showed both, and Original request still read "${original.slice(0, 200)}" (${originalEditable} editable controls). On C-${fx.cr2.number} (second type, the same Field's Row off the Portal) Fields read "${cr2Fields.slice(0, 160)}".`;
      },
    );

    // ------------------------------------------------------------ Work with Documents
    const pdfName = `${fileTag}-admin-typed.pdf`;
    const fixedName = `${fileTag}-fixed-typed.txt`;
    const generalName = `${fileTag}-no-type.txt`;
    await step(
      {
        page: `/portal/contracts/${CR}`,
        actors: [PEOPLE.ravi.name, PEOPLE.nadia.name],
        action:
          "Legal uploads three Documents (API, second actor): a PDF typed with the Administrator-added type, one typed Redline · theirs, one with no type. Ravi reads Documents; selects the PDF name to preview; uses the download control.",
        expected:
          "The Primary Document comes first; each row shows current Version, Document type, uploader and date; the Administrator-added type shows its own name (DOC-032 change); a fixed type shows its name; no type shows the kind General; the name opens a preview; download works.",
      },
      async () => {
        check(added.docType, "no Administrator-added type (the Settings step failed)");
        const a = await upload(
          nadia,
          `/contracts/${CR}/documents`,
          pdfName,
          pdf("DOC-032 V-C25 fictional preview paper"),
          "application/pdf",
          { documentTypeId: added.docType.id },
        );
        const f = await upload(
          nadia,
          `/contracts/${CR}/documents`,
          fixedName,
          "DOC-032 V-C25 fictional redline paper.\n",
          "text/plain",
          { documentTypeId: fx.fixedTypes.redline_theirs.id },
        );
        const g = await upload(
          nadia,
          `/contracts/${CR}/documents`,
          generalName,
          "DOC-032 V-C25 fictional untyped paper.\n",
        );
        check(
          a.status === 201 && f.status === 201 && g.status === 201,
          `uploads ${a.status} ${f.status} ${g.status} ${JSON.stringify(a.body).slice(0, 200)}`,
        );
        const staffType = (d) => d.document?.versions?.[0]?.documentType?.displayName ?? null;
        await go(R, `/portal/contracts/${CR}`);
        const region = R.getByRole("region", { name: "Documents" });
        const rows = (await region.getByRole("listitem").allInnerTexts()).map((t) =>
          t.replace(/\s+/g, " "),
        );
        const rowOf = (n) => rows.find((r) => r.includes(n)) ?? "";
        const pdfRow = rowOf(pdfName);
        const fixedRow = rowOf(fixedName);
        const generalRow = rowOf(generalName);
        await region.screenshot({ path: path.join(here, "contributor-portal-document-types.png") });
        let viewerText = "";
        let rendered = 0;
        for (let i = 0; i < 10; i++) {
          await region.getByRole("button", { name: pdfName }).first().click();
          const viewer = R.getByRole("complementary", {
            name: new RegExp(pdfName.replace(/\./g, "\\.")),
          });
          await viewer.waitFor({ timeout: 15000 });
          await sleep(2500);
          viewerText = await text(viewer);
          rendered = await viewer.locator("canvas, img, iframe, embed, object").count();
          if (rendered && !/Preparing|processing/i.test(viewerText)) break;
          await viewer.getByRole("button", { name: "Close the document" }).click();
          await sleep(4000);
          await R.reload();
          await settle(R);
        }
        await R.getByRole("complementary", { name: new RegExp(pdfName.replace(/\./g, "\\.")) })
          .getByRole("button", { name: "Close the document" })
          .click();
        const href = await region
          .getByRole("link", { name: new RegExp(`Download ${fileTag}-supporting-v1\\.txt`) })
          .first()
          .getAttribute("href");
        const dl = await R.request.get(new URL(href, BASE).toString());
        const dlBody = await dl.text();
        const today = new Date().toLocaleDateString("en-US", {
          month: "short",
          day: "numeric",
          timeZone: "UTC",
        });
        check(
          new RegExp(`^Primary Document ${fileTag}-supporting-v1\\.txt`).test(rows[0]) &&
            /Version 1/.test(pdfRow) &&
            pdfRow.includes(ADMIN_TYPE) &&
            !/General/.test(pdfRow) &&
            /Nadia Haddad/.test(pdfRow) &&
            /Redline · theirs/.test(fixedRow) &&
            /General/.test(generalRow) &&
            rendered > 0 &&
            dl.status() === 200 &&
            dlBody.includes("supporting paper, version 1"),
          JSON.stringify({ first: rows[0], pdfRow, fixedRow, generalRow, rendered, today }),
        );
        return `First row: "${rows[0].slice(0, 140)}". Legal's API uploads were typed ${JSON.stringify(staffType(a.body))}, ${JSON.stringify(staffType(f.body))} and ${JSON.stringify(staffType(g.body))}. Portal rows: "${pdfRow.slice(0, 200)}"; "${fixedRow.slice(0, 160)}"; "${generalRow.slice(0, 160)}". The PDF name opened the viewer with ${rendered} rendered page element(s). The primary Document's download control answered ${dl.status()} with the fictional text. See contributor-portal-document-types.png.`;
      },
    );

    await step(
      {
        page: `/portal/contracts/${CR}`,
        action:
          "Select Upload documents; choose New documents under Add as; add two files; read and choose Kind (Partially signed); enter Note (optional); Upload with one failure (browser route abort); Retry failed uploads; upload a third file on General.",
        expected:
          "Add as offers New documents and New version of each Document; Kind starts on General and offers General plus Draft · ours, Draft · theirs, Redline · theirs, Redline · ours, Partially signed, Executed, Amendment; Kind and Note apply to every file; Retry failed uploads retries only the failures; Legal sees the Kind as the Version's Document type and General as no type; the Portal row shows the type name.",
      },
      async () => {
        const n1 = `${fileTag}-business-upload.txt`;
        const n2 = `${fileTag}-second-upload.txt`;
        const n3 = `${fileTag}-general-upload.txt`;
        const f1 = file(n1, "DOC-032 V-C25 fictional business upload.\n");
        const f2 = file(n2, "DOC-032 V-C25 fictional second upload.\n");
        const f3 = file(n3, "DOC-032 V-C25 fictional general upload.\n");
        const note = `DOC-032 V-C25 business note ${STAMP}`;
        await go(R, `/portal/contracts/${CR}`);
        let aborted = 0;
        const posts = [];
        const matcher = (u) => u.pathname.endsWith(`/contracts/${CR}/documents`);
        const handler = async (route) => {
          if (route.request().method() !== "POST") return route.continue();
          const body = route.request().postDataBuffer()?.toString("latin1") ?? "";
          const which = [n1, n2, n3].find((n) => body.includes(n)) ?? "?";
          posts.push(which);
          if (!aborted && which === n2) {
            aborted++;
            return route.abort("failed");
          }
          return route.continue();
        };
        await R.route(matcher, handler);
        await R.getByRole("button", { name: "Upload documents" }).click();
        const dialog = R.getByRole("dialog", { name: "Upload documents" });
        await dialog.waitFor();
        const addAs = await dialog
          .getByRole("combobox", { name: "Add as" })
          .locator("option")
          .allInnerTexts();
        await dialog
          .getByRole("combobox", { name: "Add as" })
          .selectOption({ label: "New documents" });
        await dialog.locator("input[type=file]").setInputFiles([f1, f2]);
        const kind = dialog.getByRole("combobox", { name: "Kind" });
        const kindDefault = await kind.evaluate((s) => s.options[s.selectedIndex].text);
        const kinds = (await kind.locator("option").allInnerTexts()).map((s) => s.trim());
        await kind.selectOption({ label: "Partially signed" });
        await dialog.getByRole("textbox", { name: "Note (optional)" }).fill(note);
        await dialog.getByRole("button", { name: "Upload", exact: true }).click();
        await dialog
          .getByRole("button", { name: "Retry failed uploads" })
          .waitFor({ timeout: 20000 });
        const mid = await text(dialog);
        const postsBeforeRetry = posts.length;
        await dialog.getByRole("button", { name: "Retry failed uploads" }).click();
        await dialog.waitFor({ state: "hidden", timeout: 20000 });
        await R.unroute(matcher, handler);
        await settle(R);
        await R.getByRole("button", { name: "Upload documents" }).click();
        await dialog.waitFor();
        await dialog.locator("input[type=file]").setInputFiles([f3]);
        await dialog.getByRole("button", { name: "Upload", exact: true }).click();
        await dialog.waitFor({ state: "hidden", timeout: 20000 });
        await settle(R);
        const portalRows = (
          await R.getByRole("region", { name: "Documents" }).getByRole("listitem").allInnerTexts()
        ).map((t) => t.replace(/\s+/g, " "));
        const pRow = (n) => portalRows.find((r) => r.includes(n)) ?? "";
        const staffDocs = must(await call(nadia, "GET", `/contracts/${CR}/documents`), "docs");
        const list = staffDocs.documents ?? staffDocs.items ?? [];
        const find = (n) =>
          list.find((d) => d.title === n || d.versions?.[0]?.originalFilename === n);
        const [d1, d2, d3] = [n1, n2, n3].map(find);
        const typeOf = (d) =>
          d?.versions?.[0]?.documentType?.displayName ?? d?.versions?.[0]?.documentTypeId ?? null;
        const noteOf = (d) => d?.versions?.[0]?.note ?? null;
        const legalView = { [n1]: typeOf(d1), [n2]: typeOf(d2), [n3]: typeOf(d3) };
        const want = [
          "General",
          "Draft · ours",
          "Draft · theirs",
          "Redline · theirs",
          "Redline · ours",
          "Partially signed",
          "Executed",
          "Amendment",
        ];
        check(
          kindDefault === "General" &&
            kinds.length === 8 &&
            want.every((k) => kinds.includes(k)) &&
            addAs.includes("New documents") &&
            addAs.some((o) => o === `New version of ${fileTag}-supporting-v1.txt`),
          JSON.stringify({ kindDefault, kinds, addAs }),
        );
        check(
          postsBeforeRetry === 2 &&
            posts.length === 3 &&
            posts[2] === n2 &&
            d1 &&
            d2 &&
            d3 &&
            noteOf(d1) === note &&
            noteOf(d2) === note,
          JSON.stringify({ posts, postsBeforeRetry, notes: [noteOf(d1), noteOf(d2)] }),
        );
        check(
          legalView[n1] === "Partially signed" &&
            legalView[n2] === "Partially signed" &&
            legalView[n3] === null &&
            /Partially signed/.test(pRow(n1)) &&
            /General/.test(pRow(n3)),
          `Legal types ${JSON.stringify(legalView)}; Portal rows ${pRow(n1)} | ${pRow(n3)}`,
        );
        return `Add as offered ${addAs.length} options: ${addAs.slice(0, 3).join(", ")}, ... (New documents, then New version of each Document). Kind started on ${kindDefault} and offered ${kinds.join(", ")}. With the second file's first POST aborted by the reviewer's browser route, the dialog read "${mid.slice(0, 220)}"; Retry failed uploads sent only ${posts[2]} (POSTs: ${postsBeforeRetry} then ${posts.length}). Both Documents carry the note. Legal's Document list shows the two Partially signed uploads as ${JSON.stringify(legalView[n1])} / ${JSON.stringify(legalView[n2])} and the General upload with no type (${JSON.stringify(legalView[n3])}). Ravi's Portal rows read "${pRow(n1).slice(0, 120)}" and "${pRow(n3).slice(0, 120)}".`;
      },
    );

    await step(
      {
        page: `/portal/matters/${MR}`,
        action: "Open Upload documents on the Matter, choose a file, Upload.",
        expected:
          "Matter uploads have no Kind control; Note (optional) is there; the upload finishes.",
      },
      async () => {
        await go(R, `/portal/matters/${MR}`);
        await R.getByRole("button", { name: "Upload documents" }).click();
        const dialog = R.getByRole("dialog", { name: "Upload documents" });
        await dialog.waitFor();
        const n = `${fileTag}-matter-upload.txt`;
        await dialog
          .locator("input[type=file]")
          .setInputFiles([file(n, "DOC-032 V-C25 fictional Matter upload.\n")]);
        const kind = await dialog.getByRole("combobox", { name: "Kind" }).count();
        const labels = await text(dialog);
        await dialog.getByRole("button", { name: "Upload", exact: true }).click();
        await dialog.waitFor({ state: "hidden", timeout: 20000 });
        await settle(R);
        const listed = (await text(R.getByRole("region", { name: "Documents" }))).includes(n);
        check(kind === 0 && /Note \(optional\)/.test(labels) && listed, labels);
        return `The Matter Upload documents dialog read "${labels.slice(0, 200)}" with no Kind control (${kind}); the upload finished and ${n} is listed.`;
      },
    );

    await step(
      {
        page: `/portal/contracts/${CR}`,
        actors: [PEOPLE.ravi.name, PEOPLE.nadia.name],
        action:
          "Legal pins Version 1 of the primary Document as the signed copy (API, second actor). Ravi selects Add version beside the primary Document, uploads one file, expands earlier versions; looks at a one-Version Document.",
        expected:
          "Add version opens the dialog with that Document selected and takes one file; the current Version appears only on the main row; Signed copy marks the pinned Version; uploading a Version changes neither designation; a one-Version Document has no history to expand.",
      },
      async () => {
        must(
          await call(nadia, "POST", `/documents/${fx.primary.id}/executed-version`, {
            versionId: fx.primary.v1,
          }),
          "pin",
        );
        await go(R, `/portal/contracts/${CR}`);
        const region = R.getByRole("region", { name: "Documents" });
        const row = region
          .getByRole("listitem")
          .filter({ hasText: `${fileTag}-supporting` })
          .first();
        await row.getByRole("button", { name: "Add version" }).click();
        const dialog = R.getByRole("dialog", { name: "Upload documents" });
        await dialog.waitFor();
        const selected = await dialog
          .getByRole("combobox", { name: "Add as" })
          .evaluate((s) => s.options[s.selectedIndex].text);
        const multiple = await dialog.locator("input[type=file]").getAttribute("multiple");
        await dialog
          .locator("input[type=file]")
          .setInputFiles(
            file(
              `${fileTag}-supporting-v2.txt`,
              "DOC-032 V-C25 fictional supporting paper, version 2.\n",
            ),
          );
        await dialog.getByRole("button", { name: "Upload", exact: true }).click();
        await dialog.waitFor({ state: "hidden", timeout: 20000 });
        await settle(R);
        const row2 = region
          .getByRole("listitem")
          .filter({ hasText: `${fileTag}-supporting` })
          .first();
        const collapsed = await text(row2);
        await row2.getByRole("button", { name: /earlier version/ }).click();
        await sleep(500);
        const t = await text(row2);
        const first = await text(region.getByRole("listitem").first());
        const oneVersion = region.getByRole("listitem").filter({ hasText: fixedName }).first();
        const oneHistory = await oneVersion
          .getByRole("button", { name: /earlier version/ })
          .count();
        const staff = must(await call(nadia, "GET", `/contracts/${CR}/documents`), "docs");
        const p = (staff.documents ?? staff.items ?? []).find((d) => d.id === fx.primary.id);
        const primaryStill = sql(
          project,
          `select primary_document_id='${fx.primary.id}' from contracts where id='${fx.cr.id}'`,
        );
        const pinned = sql(
          project,
          `select executed_version_id from documents where id='${fx.primary.id}'`,
        );
        const v2Count = (t.match(/Version 2/g) ?? []).length;
        check(
          new RegExp(`New version of ${fileTag}-supporting-v1\\.txt`).test(selected) &&
            multiple === null &&
            /Signed copy/.test(t) &&
            /^Primary Document/.test(first) &&
            /Version 2/.test(collapsed) &&
            v2Count === 1 &&
            /Version 1/.test(t) &&
            oneHistory === 0 &&
            primaryStill === "t" &&
            pinned === fx.primary.v1,
          JSON.stringify({
            selected,
            multiple,
            t: t.slice(0, 300),
            oneHistory,
            primaryStill,
            pinned,
          }),
        );
        return `Legal pinned Version 1 as the signed copy. Add version opened Upload documents with "${selected}" and a single-file input (no multiple attribute). After upload the row read "${collapsed.slice(0, 160)}"; expanded: "${t.slice(0, 320)}" (Version 2 appears ${v2Count} time, on the main row). The first row is still the Primary Document; the database still names it primary (${primaryStill}) and keeps Version 1 as the executed Version. The one-Version Document ${fixedName} has ${oneHistory} earlier-versions controls. Staff read of the primary: ${p?.versions?.length ?? "?"} Versions.`;
      },
    );

    await step(
      {
        page: `/portal/contracts/${CR}`,
        action: "Drop a file onto Documents; cancel; look for folder and archive controls.",
        expected:
          "Dropping opens the upload dialog with the file; Business Users cannot manage folders or archive paper.",
      },
      async () => {
        await go(R, `/portal/contracts/${CR}`);
        const region = R.getByRole("region", { name: "Documents" });
        const target = region.getByRole("button", { name: "Drop files here or click to upload" });
        const dropName = `${fileTag}-dropped.txt`;
        const dt = await R.evaluateHandle((n) => {
          const d = new DataTransfer();
          d.items.add(new File(["DOC-032 V-C25 dropped paper"], n, { type: "text/plain" }));
          return d;
        }, dropName);
        await target.dispatchEvent("dragover", { dataTransfer: dt });
        await target.dispatchEvent("drop", { dataTransfer: dt });
        const dialog = R.getByRole("dialog", { name: "Upload documents" });
        await dialog.waitFor({ timeout: 10000 });
        const listed = (await text(dialog)).includes(dropName);
        await dialog.getByRole("button", { name: "Cancel" }).click();
        const all = await text(region);
        const buttons = (await region.getByRole("button").allInnerTexts()).map((s) => s.trim());
        const forbidden = buttons.filter((b) => /folder|archive|move/i.test(b));
        check(
          listed && forbidden.length === 0 && !/New folder/.test(all),
          JSON.stringify({ listed, forbidden }),
        );
        return `Dropping ${dropName} on "Drop files here or click to upload" opened Upload documents with the file listed (cancelled). Documents had no folder, archive or move controls (${buttons.length} buttons checked).`;
      },
    );

    await step(
      {
        page: `/portal/matters/${fx.dm.number}`,
        action:
          "Use Search Documents with an earlier Version's filename; on the 51-Document Matter use Show more and search a name.",
        expected:
          "Search Documents finds by name or any Version's filename; Show more loads another page.",
      },
      async () => {
        await go(R, `/portal/contracts/${CR}`);
        const region = R.getByRole("region", { name: "Documents" });
        await region.getByRole("textbox", { name: "Search Documents" }).fill("supporting-v1");
        await region.getByRole("button", { name: "Search", exact: true }).click();
        await settle(R);
        const byOld = await text(region);
        const oldRows = await region.getByRole("listitem").count();
        await go(R, `/portal/matters/${fx.dm.number}`);
        const d = R.getByRole("region", { name: "Documents" });
        const pageRe = new RegExp(`^${fileTag}-page-`);
        const before = await d.getByRole("button", { name: pageRe }).count();
        await d.getByRole("button", { name: "Show more" }).click();
        await settle(R);
        const after = await d.getByRole("button", { name: pageRe }).count();
        await d.getByRole("textbox", { name: "Search Documents" }).fill("page-37");
        await d.getByRole("textbox", { name: "Search Documents" }).press("Enter");
        await settle(R);
        const byName = await d.getByRole("button", { name: pageRe }).allInnerTexts();
        check(
          byOld.includes(`${fileTag}-supporting`) &&
            /Version 2/.test(byOld) &&
            before === 50 &&
            after === 51 &&
            byName.length === 1,
          JSON.stringify({ before, after, byName, oldRows, byOld: byOld.slice(0, 200) }),
        );
        return `"supporting-v1" (Version 1's filename) listed the supporting Document whose current Version is Version 2 (${oldRows} row): "${byOld.slice(0, 180)}". On M-${fx.dm.number} Documents showed ${before} rows and Show more added the rest (${after}); "page-37" + Enter listed ${byName.map((s) => s.trim()).join(", ")}.`;
      },
    );

    // ------------------------------------------------------------ Join the conversation
    await step(
      {
        page: `/portal/matters/${MR}`,
        actors: [PEOPLE.ravi.name, PEOPLE.nadia.name],
        action:
          "Legal posts a team reply (API). Ravi opens Comments; writes a draft and attaches a file; switches to History and back; closes and reopens Comments; types @; posts with Comment; uses Comment actions to edit and delete.",
        expected:
          "The unread badge clears after the comments load; the draft and attachment stay; @ offers people who can hear the comment; Comment actions edit and delete; there is no audience picker.",
      },
      async () => {
        const t = `DOC-032 V-C25 ask ${STAMP}`;
        must(
          await call(nadia, "POST", "/comments", {
            entityType: "matter",
            entityId: fx.mr.id,
            body: `DOC-032 V-C25 Legal reply for Ravi ${STAMP}`,
            visibility: "full_thread",
          }),
          "legal reply",
        );
        await go(R, `/portal/matters/${MR}`);
        const btn = R.getByRole("toolbar", { name: "Applets" }).getByRole("button", {
          name: /^Comments/,
        });
        const badgeBefore = `${(await btn.innerText()).trim()} | ${(await btn.getAttribute("aria-label")) ?? ""}`;
        const panel = await applet(R, "Comments");
        await sleep(1500);
        const pickers = await panel.getByRole("radio").count();
        const attach = file(
          `${fileTag}-comment.txt`,
          "DOC-032 V-C25 fictional comment attachment.\n",
        );
        await panel.getByRole("textbox", { name: "New comment" }).fill("DOC-032 V-C25 draft kept ");
        await panel.locator("input[type=file]").setInputFiles(attach);
        await applet(R, "History");
        await applet(R, "Comments");
        const switched = await panel.getByRole("textbox", { name: "New comment" }).inputValue();
        await panel.getByRole("button", { name: "Close" }).click();
        await panel.waitFor({ state: "hidden", timeout: 5000 }).catch(() => {});
        await applet(R, "Comments");
        const kept = await panel.getByRole("textbox", { name: "New comment" }).inputValue();
        const keptFile = (await text(panel)).includes(`${fileTag}-comment.txt`);
        await R.goto(R.url());
        await settle(R);
        const badgeAfter = await R.getByRole("toolbar", { name: "Applets" })
          .getByRole("button", { name: /^Comments/ })
          .evaluate((b) => `${b.innerText.trim()} | ${b.getAttribute("aria-label") ?? ""}`);
        const p2 = await applet(R, "Comments");
        const box = p2.getByRole("textbox", { name: "New comment" });
        await box.fill("");
        await box.pressSequentially(`${t} @Nad`, { delay: 40 });
        const lb = R.getByRole("listbox", { name: "People and files you can mention" });
        await lb.waitFor({ timeout: 10000 });
        const mentions = (await lb.getByRole("option").allInnerTexts()).map((s) =>
          s.replace(/\s+/g, " "),
        );
        await lb.getByRole("option").first().click();
        await p2.locator("input[type=file]").setInputFiles(attach);
        await p2.getByRole("button", { name: "Comment", exact: true }).click();
        const mine = p2.getByRole("listitem").filter({ hasText: t });
        await mine.waitFor({ timeout: 15000 });
        const posted = await text(mine);
        await mine.getByRole("button", { name: "Comment actions" }).click();
        await R.getByRole("menuitem", { name: "Edit" }).click();
        await p2.getByRole("textbox", { name: "Edit comment" }).fill(`${t} edited`);
        await p2.getByRole("button", { name: "Save" }).click();
        await p2.getByText(`${t} edited`).waitFor({ timeout: 10000 });
        const edited = p2.getByRole("listitem").filter({ hasText: `${t} edited` });
        await edited.getByRole("button", { name: "Comment actions" }).click();
        await R.getByRole("menuitem", { name: "Delete" }).click();
        await R.getByRole("dialog", { name: "Delete this comment?" })
          .getByRole("button", { name: "Delete" })
          .click();
        await sleep(1500);
        const final = await text(p2);
        check(
          pickers === 0 &&
            switched.startsWith("DOC-032 V-C25 draft kept") &&
            kept.startsWith("DOC-032 V-C25 draft kept") &&
            keptFile &&
            posted.includes(`${fileTag}-comment.txt`) &&
            posted.includes("Nadia Haddad") &&
            mentions.some((o) => /Nadia/.test(o)) &&
            /1/.test(badgeBefore) &&
            !/\d/.test(badgeAfter) &&
            (!final.includes(`${t} edited`) || /deleted/i.test(final)),
          JSON.stringify({
            pickers,
            kept,
            keptFile,
            mentions,
            badgeBefore,
            badgeAfter,
            posted: posted.slice(0, 160),
          }),
        );
        return `Comments button before opening: "${badgeBefore}"; after the comments loaded and a reload: "${badgeAfter}". No audience picker (${pickers} radios). The draft and its attachment stayed after switching to History and back and after closing and reopening Comments. @Nad offered ${mentions.join("; ")}. The reply posted with its attachment and the mention ("${posted.slice(0, 140)}"); Comment actions > Edit > Save changed it; Comment actions > Delete removed it.`;
      },
    );

    await step(
      {
        page: `/portal/matters/${MR}`,
        actors: [PEOPLE.ravi.name, PEOPLE.nadia.name],
        action:
          "Legal posts a Legal Only and an Internal team (Working Team) comment (API). Ravi posts a reply on the Matter and on the Contract and reads the text below the composer.",
        expected:
          "The reply shows Matter Team or Contract Team; the text below the composer names the audience; Legal Only and older Internal team messages stay outside this view.",
      },
      async () => {
        for (const [visibility, body] of [
          ["legal_only", `DOC-032 V-C25 hidden Legal Only ${STAMP}`],
          ["working_team", `DOC-032 V-C25 hidden Internal team ${STAMP}`],
        ])
          must(
            await call(nadia, "POST", "/comments", {
              entityType: "matter",
              entityId: fx.mr.id,
              body,
              visibility,
            }),
            visibility,
          );
        const out = {};
        for (const [label, url, module] of [
          ["Matter Team", `/portal/matters/${MR}`, "Matter"],
          ["Contract Team", `/portal/contracts/${CR}`, "Contract"],
        ]) {
          await go(R, url);
          const panel = await applet(R, "Comments");
          await sleep(1000);
          const hint = ((await text(panel)).match(/Visible to [^.]*\./) ?? [""])[0];
          const body = `DOC-032 V-C25 Ravi reply on ${module} ${STAMP}`;
          await panel.getByRole("textbox", { name: "New comment" }).fill(body);
          await panel.getByRole("button", { name: "Comment", exact: true }).click();
          const item = panel.getByRole("listitem").filter({ hasText: body }).first();
          await item.waitFor({ timeout: 15000 });
          const row = (await text(item)).replace(body, "");
          const all = await text(panel);
          out[module] = {
            row,
            hint,
            hidden:
              all.includes(`hidden Legal Only ${STAMP}`) ||
              all.includes(`hidden Internal team ${STAMP}`),
            labels: /Legal Only|Internal team/.test(all),
          };
          check(
            row.includes(label) && hint === `Visible to Legal and all ${module} team members.`,
            JSON.stringify(out[module]),
          );
        }
        check(
          !out.Matter.hidden && !out.Matter.labels && !out.Contract.labels,
          JSON.stringify(out),
        );
        return `Matter reply row "${out.Matter.row.slice(0, 70)}", composer text "${out.Matter.hint}"; Contract reply row "${out.Contract.row.slice(0, 70)}", composer text "${out.Contract.hint}". Nadia's Legal Only and Working Team comments on M-${MR} did not appear, and no Legal Only or Internal team label showed.`;
      },
    );

    // ------------------------------------------------------------ Read what has happened
    await step(
      {
        page: `/portal/contracts/${CR}`,
        actors: [PEOPLE.ravi.name, PEOPLE.nadia.name],
        action:
          "Legal changes the Contract one item at a time (API, second actor) and closes the Matter with a closing note; Ravi opens History after each.",
        expected:
          "History lists Stage and Status moves, changes to values the Portal draws and to Visible on Portal Fields, Tasks added (with due date) or completed, and replies, newest first; it excludes Legal Only and Working Team messages, edited, reordered or removed Tasks, Priority, Risk and Fields kept off the Portal; a Matter's closing note stays with Legal.",
      },
      async () => {
        const id = fx.cr.id;
        const cur = must(await call(nadia, "GET", `/contracts/${CR}`), "contract").contract;
        const statuses = must(
          await call(daniel, "GET", "/contract-statuses"),
          "cs",
        ).contractStatuses.filter((s) => !s.archivedAt);
        const currentStatus = statuses.find((s) => s.id === cur.statusId);
        let taskA = null;
        let taskB = null;
        const comment = (visibility, body) => () =>
          call(nadia, "POST", "/comments", {
            entityType: "contract",
            entityId: id,
            body,
            visibility,
          });
        const patch = (b) => () => call(nadia, "PATCH", `/contracts/${CR}`, b);
        const target =
          statuses.find((s) => s.stage !== currentStatus?.stage && s.stage === "review") ??
          statuses.find((s) => s.stage !== currentStatus?.stage);
        const actions = [
          ["Priority change", false, patch({ priority: cur.priority === "high" ? "low" : "high" })],
          ["Risk change", false, patch({ risk: cur.risk === "high" ? "low" : "high" })],
          [
            "Legal Only comment",
            false,
            comment("legal_only", `DOC-032 V-C25 Legal Only probe ${STAMP}`),
          ],
          [
            "Working Team (Internal team) comment",
            false,
            comment("working_team", `DOC-032 V-C25 Working Team probe ${STAMP}`),
          ],
          [
            "Field kept off the Portal changed",
            false,
            patch({
              customFields: { [fx.form.hidden.key]: `DOC-032 V-C25 hidden change ${STAMP}` },
            }),
          ],
          [
            "Field with Visible on Portal changed",
            true,
            patch({
              customFields: { [fx.form.visible.key]: `DOC-032 V-C25 shown change ${STAMP}` },
            }),
          ],
          [
            "Task added with a due date",
            true,
            async () => {
              const r = await call(nadia, "POST", `/contracts/${CR}/tasks`, {
                title: `DOC-032 V-C25 probe task A ${STAMP}`,
                dueDate: "2026-12-15",
              });
              taskA = r.body?.createdTaskId;
              return r;
            },
          ],
          [
            "Second task added",
            true,
            async () => {
              const r = await call(nadia, "POST", `/contracts/${CR}/tasks`, {
                title: `DOC-032 V-C25 probe task B ${STAMP}`,
              });
              taskB = r.body?.createdTaskId;
              return r;
            },
          ],
          [
            "Task edited",
            false,
            () =>
              call(nadia, "PATCH", `/tasks/${taskA}`, {
                title: `DOC-032 V-C25 probe task A edited ${STAMP}`,
              }),
          ],
          [
            "Tasks reordered",
            false,
            async () => {
              const all = must(
                await call(nadia, "GET", `/contracts/${CR}/tasks`),
                "tasks",
              ).tasks.map((t) => t.id);
              return call(nadia, "PUT", `/contracts/${CR}/tasks/reorder`, {
                taskIds: [...all].reverse(),
              });
            },
          ],
          ["Task completed", true, () => call(nadia, "POST", `/tasks/${taskA}/toggle`, {})],
          ["Task removed", false, () => call(nadia, "DELETE", `/tasks/${taskB}`)],
          [
            "Value changed",
            true,
            patch({
              value: {
                amount: (cur.value?.amount ?? 0) + 100000,
                currency: "GBP",
                cadence: "annually",
              },
            }),
          ],
          ["Expiry date changed", true, patch({ expiryDate: "2029-09-15" })],
          [
            `Stage move to ${target.displayName} (${target.stage})`,
            true,
            patch({ statusId: target.id, overrideSoftGate: true }),
          ],
          [
            "Full Thread (team) comment",
            true,
            comment("full_thread", `DOC-032 V-C25 team history probe ${STAMP}`),
          ],
        ];
        const rows = [];
        for (const [what, shown, act] of actions) {
          const before = await portalActivity(ravi, "contract", id);
          const r = await act();
          await sleep(700);
          const after = await portalActivity(ravi, "contract", id);
          const fresh = after.filter((e) => !before.some((b) => b.id === e.id));
          rows.push({
            what,
            expectedShown: shown,
            status: r.status,
            newEntries: fresh.length,
            actions: fresh.map((e) => e.action),
          });
        }
        const panelText = await historyPanel(R, `/portal/contracts/${CR}`);
        await call(nadia, "PATCH", `/contracts/${CR}`, {
          statusId: cur.statusId,
          overrideSoftGate: true,
          priority: cur.priority,
          risk: cur.risk ?? null,
        });
        const bad = rows.filter(
          (r) => r.status >= 300 || (r.expectedShown ? r.newEntries < 1 : r.newEntries !== 0),
        );
        const verdict = rows
          .map(
            (r) =>
              `${r.what}: ${r.expectedShown ? "shown" : "not shown"} (${r.newEntries} new${r.actions.length ? ` ${r.actions.join(",")}` : ""})`,
          )
          .join("; ");
        const ms = must(await call(daniel, "GET", "/matter-statuses"), "ms").matterStatuses;
        const closed = ms.find((s) => s.category === "closed" && !s.archivedAt);
        const open = ms.find((s) => s.slug === "open");
        const mBefore = await portalActivity(ravi, "matter", fx.mr.id);
        const note = `DOC-032 V-C25 closing note ${STAMP}`;
        const mv = await call(nadia, "PATCH", `/matters/${MR}`, {
          statusId: closed.id,
          closingNote: note,
        });
        await sleep(800);
        const mAfter = await portalActivity(ravi, "matter", fx.mr.id);
        const mPanel = await historyPanel(R, `/portal/matters/${MR}`);
        const reopen = await call(nadia, "PATCH", `/matters/${MR}`, {
          statusId: open.id,
          confirmReopen: true,
        });
        const closeEntries = mAfter.filter((e) => !mBefore.some((b) => b.id === e.id));
        const iComment = panelText.indexOf("commented");
        const iStage = panelText.indexOf("changed the stage");
        check(bad.length === 0, `unexpected: ${JSON.stringify(bad)}`);
        check(
          mv.status === 200 &&
            reopen.status === 200 &&
            closeEntries.length > 0 &&
            !mPanel.includes(note) &&
            /probe task A/.test(panelText) &&
            /due Dec 15/.test(panelText) &&
            iComment >= 0 &&
            iStage > iComment,
          JSON.stringify({
            mv: mv.status,
            reopen: reopen.status,
            mPanel: mPanel.slice(0, 200),
            panelText: panelText.slice(0, 300),
          }),
        );
        return `${verdict}. Contract History panel (newest first): "${panelText.slice(0, 700)}". Closing M-${MR} as "${closed.displayName}" with a closing note added ${closeEntries.length} History entry (${closeEntries.map((e) => e.action).join(", ")}); the Matter panel read "${mPanel.slice(0, 200)}" and did not contain the note. Legal reopened the Matter (${reopen.status}) and put the Contract's Stage, Priority and Risk back.`;
      },
    );

    // ------------------------------------------------------------ Add team members
    await step(
      {
        page: `/portal/matters/${MR}`,
        actors: [PEOPLE.ravi.name, PEOPLE.clara.name, PEOPLE.nadia.name],
        action:
          "Open Matter team; Add team member; read the picker; choose Clara Fontaine; Add. Clara opens the Matter in the Portal; Nadia reads the full-app team and removes Clara. Nadia adds Ravi to the Confidential Matter; Ravi opens its Matter team.",
        expected:
          "Existing members are excluded; each person appears once; the person joins the same team as in the full app; a Business User added gains Portal access; no remove control; on a Confidential record Ravi is told to ask Legal.",
      },
      async () => {
        await go(R, `/portal/matters/${MR}`);
        const { options } = await addTeamMember(R, "Matter team", PEOPLE.clara.name);
        const panel = await applet(R, "Matter team");
        const removes = await panel.getByRole("button", { name: /off the|Remove/ }).count();
        const portalRows = await rosterRows(panel);
        clara = await sessions.magic(PEOPLE.clara);
        const cOpen = await openRecord(clara.page, `/portal/matters/${MR}`);
        await go(N, `/matters/${MR}`);
        const legal = await rosterRows(await applet(N, "Matter team"));
        await removeTeamMember(N, "Matter team", PEOPLE.clara.name, "matter");
        await go(N, `/matters/${fx.mc.number}`);
        await addTeamMember(N, "Matter team", PEOPLE.ravi.name);
        added.raviOnMc = true;
        await go(R, `/portal/matters/${fx.mc.number}`);
        const cp = await applet(R, "Matter team");
        const cadd = await cp.getByRole("button", { name: "Add team member" }).isEnabled();
        const cnote = await text(cp);
        await go(N, `/matters/${fx.mc.number}`);
        await removeTeamMember(N, "Matter team", PEOPLE.ravi.name, "matter");
        added.raviOnMc = false;
        const once = portalRows.filter((r) => r.includes(PEOPLE.clara.name)).length;
        check(
          !options.includes(PEOPLE.ravi.name) &&
            !options.includes(PEOPLE.nadia.name) &&
            options.includes(PEOPLE.clara.name) &&
            new Set(options).size === options.length &&
            once === 1 &&
            legal.some((r) => r.includes(PEOPLE.clara.name)) &&
            removes === 0 &&
            !cOpen.refused &&
            cOpen.title === fx.mr.title &&
            !cadd &&
            /Ask Legal to add members to a Confidential record/.test(cnote),
          JSON.stringify({ n: options.length, legal, removes, cOpen, cadd, cnote }),
        );
        return `The picker listed ${options.length} people, each once, without Ravi or Nadia (existing members). Ravi added Clara Fontaine; the Portal team read ${portalRows.join(" | ")}. Clara (fresh sign-in link) opened M-${MR} ("${cOpen.title}"), and Nadia saw her on the full-app team (${legal.join(" | ")}). No remove control in the Portal (${removes}). On Confidential M-${fx.mc.number} Add team member was disabled: "${cnote.slice(0, 140)}". Nadia removed Clara and Ravi afterwards in the full app.`;
      },
    );

    // ------------------------------------------------------------ Work that stays with Legal
    await step(
      {
        page: `/portal/contracts/${CR}`,
        action:
          "Look for controls for Fields, Description, Value, dates, Status, Type, owners, parties, confidentiality, relationships, Tasks, Key dates, approval requests, signatures and team removal on both records; try direct writes.",
        expected:
          "These stay with Legal: no Stage or Status move or other reserved control; direct writes are refused.",
      },
      async () => {
        const out = [];
        for (const url of [`/portal/contracts/${CR}`, `/portal/matters/${MR}`]) {
          await go(R, url);
          const main = await text(R.getByRole("main"));
          const buttons = (await R.getByRole("main").getByRole("button").allInnerTexts())
            .map((s) => s.trim())
            .filter((b) => b && !/\.(txt|pdf)$/.test(b));
          const bad = buttons.filter((b) =>
            /move|Stage|Status|Owner|Confidential|Counterpart|Link|Task|Key date|Approv|Sign|Archive|Remove|Edit/i.test(
              b,
            ),
          );
          out.push({
            url,
            bad,
            switches: await R.getByRole("switch").count(),
            sections: ["Tasks", "Key dates"].filter((w) => new RegExp(`\\b${w}\\b`).test(main)),
          });
        }
        const writes = [
          await call(ravi, "PATCH", `/contracts/${CR}`, { title: "DOC-032 V-C25 probe" }),
          await call(ravi, "PATCH", `/matters/${MR}`, { priority: "high" }),
          await call(ravi, "POST", `/contracts/${CR}/tasks`, { title: "DOC-032 V-C25 probe task" }),
          await call(ravi, "DELETE", `/matters/${MR}/team/${fx.ids.nadia}`),
        ].map((r) => r.status);
        check(
          out.every((o) => o.bad.length === 0 && o.switches === 0 && o.sections.length === 0) &&
            writes.every((s) => s >= 400),
          JSON.stringify({ out, writes }),
        );
        return `Neither Portal record offered Stage or Status moves, owner, party, confidentiality, relationship, Task, Key date, approval, signing or team-removal controls (${JSON.stringify(out.map((o) => o.bad.length))} such buttons, no switches, no Tasks or Key dates section). Direct writes as Ravi (Contract title, Matter Priority, new Task, remove a team member) answered ${writes.join(", ")}.`;
      },
    );

    await step(
      {
        page: `/portal/matters/${MR}`,
        actors: [PEOPLE.ravi.name, PEOPLE.nadia.name],
        action:
          "Legal closes the Matter and ends the Contract (API, second actor), then archives and restores the Matter; then Nadia removes Ravi from the Matter team in the full app. Ravi reloads each time.",
        expected:
          "Closing or Ending keeps permitted Portal work; archiving removes the record from the Portal; removing Ravi from the team stops access.",
      },
      async () => {
        const ms = must(await call(daniel, "GET", "/matter-statuses"), "ms").matterStatuses;
        const closed = ms.find((s) => s.category === "closed" && !s.archivedAt);
        const open = ms.find((s) => s.slug === "open");
        const mv = await call(nadia, "PATCH", `/matters/${MR}`, {
          statusId: closed.id,
          closingNote: "DOC-032 V-C25 fictional closing note.",
        });
        const openClosed = await openRecord(R, `/portal/matters/${MR}`);
        const uploadClosed = await R.getByRole("button", { name: "Upload documents" })
          .isEnabled()
          .catch(() => false);
        const cur = must(await call(nadia, "GET", `/contracts/${CR}`), "contract").contract;
        const ended = must(
          await call(daniel, "GET", "/contract-statuses"),
          "cs",
        ).contractStatuses.find((s) => s.stage === "ended" && !s.archivedAt);
        const end = await call(nadia, "PATCH", `/contracts/${CR}`, {
          statusId: ended.id,
          overrideSoftGate: true,
        });
        const openEnded = await openRecord(R, `/portal/contracts/${CR}`);
        const uploadEnded = await R.getByRole("button", { name: "Upload documents" })
          .isEnabled()
          .catch(() => false);
        const commentEnded = await (
          await applet(R, "Comments")
        )
          .getByRole("textbox", { name: "New comment" })
          .isEditable()
          .catch(() => false);
        const back = await call(nadia, "PATCH", `/contracts/${CR}`, {
          statusId: cur.statusId,
          overrideSoftGate: true,
        });
        const ar = await call(nadia, "POST", `/matters/${MR}/archive`, {});
        await go(R, "/portal/matters");
        const listArchived = await text(R.getByRole("main"));
        const openArchived = await openRecord(R, `/portal/matters/${MR}`);
        const rs = await call(nadia, "POST", `/matters/${MR}/restore`, {});
        const reopen = await call(nadia, "PATCH", `/matters/${MR}`, {
          statusId: open.id,
          confirmReopen: true,
        });
        const restored = await openRecord(R, `/portal/matters/${MR}`);
        await go(N, `/matters/${MR}`);
        await removeTeamMember(N, "Matter team", PEOPLE.ravi.name, "matter");
        const removed = await openRecord(R, `/portal/matters/${MR}`);
        const docs = await call(ravi, "GET", `/portal/matters/${MR}/documents`);
        await go(R, "/portal/matters");
        const listRemoved = await text(R.getByRole("main"));
        check(
          mv.status === 200 &&
            !openClosed.refused &&
            uploadClosed &&
            end.status === 200 &&
            !openEnded.refused &&
            uploadEnded &&
            commentEnded &&
            back.status === 200 &&
            ar.status < 300 &&
            !listArchived.includes(fx.mr.title) &&
            openArchived.refused &&
            rs.status < 300 &&
            !restored.refused &&
            removed.refused &&
            !listRemoved.includes(fx.mr.title) &&
            docs.status >= 400,
          JSON.stringify({
            mv: mv.status,
            uploadClosed,
            end: end.status,
            uploadEnded,
            commentEnded,
            ar: ar.status,
            openArchived,
            restored,
            removed,
            docs: docs.status,
          }),
        );
        return `Legal closed M-${MR} as "${closed.displayName}" (${mv.status}); Ravi still opened it with Upload documents enabled. Legal ended C-${CR} as "${ended.displayName}" (${end.status}); Ravi still opened it with Upload documents and the Comments composer; Legal moved it back (${back.status}). After archiving (${ar.status}) M-${MR} left Your Matters and its link showed "${openArchived.title}"; after restore (${rs.status}) and reopen (${reopen.status}) Ravi opened it again. After Nadia removed Ravi through Matter team in the full app, his link showed "${removed.title}", Your Matters no longer listed it, and a Documents read answered ${docs.status}.`;
      },
    );

    // ------------------------------------------------------------ Review an approval request
    await step(
      {
        page: "/portal/approvals",
        actors: [PEOPLE.ravi.name, PEOPLE.nadia.name, PEOPLE.clara.name],
        action:
          "Legal requests Ravi's approval on two new Contracts (API fixtures). Ravi selects Approvals in the Portal navigation bar; searches by Contract title and by requester name; opens a request; enters Note (optional); Approve; Reject the other; opens Completed. Clara tries to decide Ravi's request.",
        expected:
          "Your approvals lists Pending requests; search works on title and requester; the request shows the primary Document; Approve or Reject; a decision is final; completed decisions appear under Completed; only the named approver can decide; the request does not add Ravi to the team.",
      },
      async () => {
        const make = async (k) => {
          const c = must(
            await call(nadia, "POST", "/contracts", {
              title: name(`Ravi ${k} approval`),
              contractTypeId: fx.nda,
              managerId: fx.ids.nadia,
            }),
            k,
          ).contract;
          record("contract", c.title, `C-${c.number}`);
          must(
            await upload(
              nadia,
              `/contracts/${c.number}/documents`,
              `${fileTag}-${k}-paper.txt`,
              `DOC-032 V-C25 fictional paper to ${k}.\n`,
            ),
            `${k} doc`,
          );
          const a = must(
            await call(nadia, "POST", `/contracts/${c.number}/approvals`, {
              approverIds: [fx.ids.ravi],
            }),
            `${k} approval`,
          );
          return {
            number: c.number,
            title: c.title,
            id: (a.approvals ?? [a.approval ?? a])[0]?.id,
          };
        };
        const ap = await make("approve");
        const rj = await make("reject");
        await go(R, "/portal");
        await R.getByRole("navigation", { name: "Portal" })
          .getByRole("link", { name: "Approvals" })
          .click();
        await R.getByRole("heading", { name: "Your approvals" }).waitFor({ timeout: 15000 });
        await settle(R);
        const pending = await text(R.getByRole("main"));
        const pendingTab = await R.getByRole("link", { name: "Pending" }).count();
        const search = R.getByRole("searchbox", { name: "Search approvals" });
        await search.fill(ap.title);
        await R.getByRole("search").getByRole("button", { name: "Search" }).click();
        await settle(R);
        const byTitle = await text(R.getByRole("main"));
        await search.fill("Nadia");
        await R.getByRole("search").getByRole("button", { name: "Search" }).click();
        await settle(R);
        const byRequester = await text(R.getByRole("main"));
        await R.getByRole("link", { name: ap.title }).first().click();
        await settle(R);
        const packet = await text(R.getByRole("main"));
        clara ??= await sessions.magic(PEOPLE.clara);
        const other = await call(clara, "POST", `/portal/approvals/${ap.id}/decision`, {
          decision: "approved",
        });
        await R.getByLabel("Note (optional)").fill(`DOC-032 V-C25 approval note ${STAMP}`);
        await R.getByRole("button", { name: "Approve" }).click();
        await R.getByRole("status")
          .filter({ hasText: /Approved/ })
          .first()
          .waitFor({ timeout: 15000 });
        const decided = await text(R.getByRole("main"));
        const buttonsLeft = await R.getByRole("button", { name: /^(Approve|Reject)$/ }).count();
        const again = await call(ravi, "POST", `/portal/approvals/${ap.id}/decision`, {
          decision: "rejected",
        });
        await go(R, `/portal/approvals/${rj.id}`);
        await R.getByRole("button", { name: "Reject" }).click();
        await R.getByRole("status")
          .filter({ hasText: /Rejected/ })
          .first()
          .waitFor({ timeout: 15000 });
        await go(R, "/portal/approvals");
        await R.getByRole("link", { name: "Completed" }).click();
        await settle(R);
        const completed = await text(R.getByRole("main"));
        const direct = await openRecord(R, `/portal/contracts/${ap.number}`);
        const d = decided.indexOf("Your decision");
        check(
          pendingTab > 0 &&
            pending.includes(ap.title) &&
            pending.includes(rj.title) &&
            byTitle.includes(ap.title) &&
            !byTitle.includes(rj.title) &&
            byRequester.includes(ap.title) &&
            byRequester.includes(rj.title),
          JSON.stringify({ pendingTab, byTitle: byTitle.slice(0, 200) }),
        );
        check(
          packet.includes(`${fileTag}-approve-paper.txt`) &&
            other.status >= 400 &&
            buttonsLeft === 0 &&
            again.status === 409 &&
            decided.includes(`DOC-032 V-C25 approval note ${STAMP}`) &&
            completed.includes(ap.title) &&
            completed.includes(rj.title) &&
            direct.refused,
          JSON.stringify({
            other: other.status,
            buttonsLeft,
            again: again.status,
            direct,
            packet: packet.slice(0, 200),
          }),
        );
        return `Your approvals (Pending) listed both new requests. Searching the Contract title kept only that request; searching "Nadia" (the requester) listed both. The request page read "${packet.slice(0, 240)}". Clara's decision on Ravi's request answered ${other.status}. Ravi entered a Note and selected Approve; the page then read "${decided.slice(d, d + 140)}" with no Approve or Reject, and a second decision answered ${again.status}. Reject on the other request worked. Completed listed both. /portal/contracts/${ap.number} showed "${direct.title}" (the request did not add Ravi to the team).`;
      },
    );
  } finally {
    // Put the shared lab back.
    if (added.raviOnMc && fx.mc)
      await call(nadia, "DELETE", `/matters/${fx.mc.number}/team/${fx.ids.ravi}`).catch(() => {});
    if (added.docType && !added.docType.archivedAfterRun) {
      const r = await call(
        daniel,
        "POST",
        `/documents/types/contract/${added.docType.id}/archive`,
        {},
      ).catch(() => ({ status: 0 }));
      added.docType.archivedAfterRun = r.status === 200;
      results.limitations.push(
        `The run added the Administrator-added Contract Document type "${added.docType.name}" in Settings as Daniel Okafor and archived it at the end (answer ${r.status}). Its Versions keep the label.`,
      );
    }
    results.addedDocumentTypes = added.docType ? [added.docType] : [];
    await clara?.context.close().catch(() => {});
    await ravi?.context.close().catch(() => {});
    await nadia.context.close().catch(() => {});
    await daniel.context.close().catch(() => {});
  }
}
