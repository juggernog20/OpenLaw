// DOC-032 documents-2: reference.md (V-C50) on the shared work lab (4ca41822), as
// administrator (Daniel Okafor), legal_team_member (Nadia Haddad), business_user (Felix Brandt)
// and operator (signed out, with read-only container reads).
// Written by the DOC-032 independent walkthrough agent (documents-2) from the article text.
// Ported from the DOC-030 support walkthrough (sections R, K and O of
// docs/documentation/batches/DOC-030/support/walkthrough.mjs), with the DOC-032 changes: seven
// fixed Contract Document types, the Portal Document type name, Delete version for the
// Administrator only, and the API key Toolset rules.
// Fixtures (Contracts, Entities, a Matter, a Knowledge Item and their Documents, all named
// "DOC-032 documents-2 V-C50 <what> <STAMP>") are created through the API; every guide check runs
// in the browser as the named role. MCP settings are changed only inside the API key block and
// put back at its end; the one Contract Document type the run adds is archived at the end.
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { articleText, expectThat as check, q, root, sleep, sql, tidy } from "./lib.mjs";

const ARTICLE = "reference";
const SCENARIO = "V-C50";
const SEVEN = [
  "Draft · ours",
  "Draft · theirs",
  "Redline · theirs",
  "Redline · ours",
  "Partially signed",
  "Executed",
  "Amendment",
];
const sha = (b) => createHash("sha256").update(b).digest("hex");

export default async function reference(ctx) {
  const { BASE, lab, STAMP, results, sessions, PEOPLE } = ctx;
  const project = lab.project;
  results.settingsChanged = [];
  results.fixtures = {};
  const name = (s) => `DOC-032 documents-2 V-C50 ${s} ${STAMP}`;
  const fileTag = `doc032-vc50-${STAMP}`;
  const record = (kind, label, ref) => results.records.push({ kind, name: label, ref });
  const FIX = path.join(root, "docs/documentation/batches/DOC-029/support/fixtures");
  const fixture = (f) => readFileSync(path.join(FIX, f));
  const step = (role, actors, o, fn) =>
    ctx.step(
      {
        article: ARTICLE,
        scenario: SCENARIO,
        role,
        actors,
        method: "browser-walkthrough",
        independent: true,
        ...o,
      },
      fn,
    );

  // ---------------------------------------------------------------- page helpers
  const clean = (s) => tidy(String(s ?? ""));
  const settle = async (page, ms = 800) => {
    await page.waitForLoadState("networkidle", { timeout: 15000 }).catch(() => {});
    await sleep(ms);
  };
  const go = async (page, url) => {
    await page.goto(`${BASE}${url}`);
    await settle(page);
    const ready = page.getByRole("heading", { level: 1 }).or(page.getByRole("main")).first();
    const ok = await ready
      .waitFor({ timeout: 20000 })
      .then(() => true)
      .catch(() => false);
    if (!ok || /Something went wrong\./.test(await page.locator("body").innerText())) {
      await page.goto(`${BASE}${url}`);
      await settle(page, 2000);
    }
  };
  const h1 = async (page) =>
    clean(await page.getByRole("heading", { level: 1 }).first().textContent({ timeout: 15000 }));
  const bodyText = async (page) => clean(await page.locator("body").innerText());
  const mainText = async (page) => clean(await page.getByRole("main").innerText());
  const menuItems = async (page, trigger) => {
    await trigger.click();
    const menu = page.getByRole("menu");
    await menu.waitFor({ timeout: 10000 });
    const items = (await menu.getByRole("menuitem").allInnerTexts()).map(clean);
    await page.keyboard.press("Escape");
    await menu.waitFor({ state: "hidden" }).catch(() => {});
    return items;
  };
  const switchStates = async (page, scope) => {
    const snap = await (scope ?? page.getByRole("main")).ariaSnapshot();
    return [...snap.matchAll(/switch "([^"]+)"( \[checked\])?( \[disabled\])?/g)].map((m) => ({
      name: m[1],
      checked: Boolean(m[2]),
      disabled: Boolean(m[3]),
    }));
  };
  const closeDialog = async (page) => {
    const dialog = page.getByRole("dialog");
    const cancel = dialog.getByRole("button", { name: "Cancel" });
    if (await cancel.count()) await cancel.first().click();
    else await page.keyboard.press("Escape");
    await dialog.waitFor({ state: "hidden", timeout: 10000 }).catch(() => {});
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
  const download = async (page, trigger) => {
    const [dl] = await Promise.all([page.waitForEvent("download", { timeout: 30000 }), trigger()]);
    const buf = readFileSync(await dl.path());
    return { name: dl.suggestedFilename(), sha256: sha(buf), bytes: buf.length };
  };
  const docsRegion = (page) => page.getByRole("region", { name: "Documents", exact: true });
  const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

  // ---------------------------------------------------------------- API helpers (fixtures, reads)
  const must = (r, what) => {
    if (r.status >= 300)
      throw new Error(`${what}: ${r.status} ${JSON.stringify(r.json).slice(0, 300)}`);
    return r.json;
  };
  const upload = async (s, p, fileName, buffer, mimeType = "text/plain", extra = {}) => {
    const r = await s.page.request.fetch(`${BASE}/api/v1${p}`, {
      method: "POST",
      headers: { origin: BASE },
      failOnStatusCode: false,
      multipart: { ...extra, file: { name: fileName, mimeType, buffer } },
    });
    let json = null;
    try {
      json = await r.json();
    } catch {}
    return must({ status: r.status(), json }, `upload ${fileName}`);
  };
  const recordDocs = async (s, recordUrl) => {
    const docs = [];
    let cursor = null;
    do {
      const sp = new URLSearchParams();
      if (cursor) sp.set("cursor", cursor);
      const r = must(await s.api("GET", `${recordUrl}/documents?${sp}`), "documents");
      docs.push(...r.documents);
      cursor = r.nextCursor;
    } while (cursor);
    return docs;
  };

  // ---------------------------------------------------------------- people
  const admin = await sessions.password(PEOPLE.daniel);
  const nadia = await sessions.password(PEOPLE.nadia);
  const felix = await sessions.magic(PEOPLE.felix);
  const D = admin.page;
  const N = nadia.page;
  const B = felix.page;
  if (!new URL(B.url()).pathname.startsWith("/portal")) await go(B, "/portal");
  const users = must(await admin.api("GET", "/users?limit=200"), "users").users;
  const uid = (email) => users.find((u) => u.email === email)?.id;
  const ids = {
    daniel: uid(PEOPLE.daniel.email),
    nadia: uid(PEOPLE.nadia.email),
    felix: uid(PEOPLE.felix.email),
  };
  check(ids.daniel && ids.nadia && ids.felix, `user ids ${JSON.stringify(ids)}`);

  // ---------------------------------------------------------------- fixtures (API)
  const ctypes = must(await admin.api("GET", "/contract-types"), "contract types").contractTypes;
  const nda = ctypes.find((t) => t.displayName === "NDA").id;
  const newContract = async (s, label, extra = {}) => {
    const c = must(
      await s.api("POST", "/contracts", {
        title: name(label),
        contractTypeId: nda,
        managerId: ids.nadia,
        ...extra,
      }),
      label,
    ).contract;
    record("contract", c.title, `C-${c.number}`);
    return c;
  };
  const FX = results.fixtures;
  const shared = await newContract(nadia, "shared contract");
  must(await nadia.api("POST", `/contracts/${shared.number}/team`, { userId: ids.felix }), "team");
  const sharedUrl = `/contracts/${shared.number}`;
  const primary = (
    await upload(
      nadia,
      `${sharedUrl}/documents`,
      `${fileTag}-primary.txt`,
      fixture("doc029-support-v1.txt"),
    )
  ).document;
  await upload(
    nadia,
    `/documents/${primary.id}/versions`,
    `${fileTag}-primary-v2.txt`,
    fixture("doc029-support-v2.txt"),
  );
  if (!(await recordDocs(nadia, sharedUrl)).find((d) => d.id === primary.id)?.isPrimary)
    must(await nadia.api("POST", `/documents/${primary.id}/primary`, {}), "primary");
  const pngName = `${fileTag}-image.png`;
  await upload(
    nadia,
    `${sharedUrl}/documents`,
    pngName,
    fixture("doc029-support-image.png"),
    "image/png",
  );
  const svgName = `${fileTag}-diagram.svg`;
  await upload(
    nadia,
    `${sharedUrl}/documents`,
    svgName,
    fixture("doc029-support-diagram.svg"),
    "image/svg+xml",
  );
  const emlName = `${fileTag}-message.eml`;
  await upload(
    nadia,
    `${sharedUrl}/documents`,
    emlName,
    fixture("doc029-support-message.eml"),
    "message/rfc822",
  );
  FX.shared = { number: shared.number, title: shared.title, primary: primary.title };

  const delContract = await newContract(admin, "version delete contract");
  const delUrl = `/contracts/${delContract.number}`;
  const twoName = `${fileTag}-two-versions.txt`;
  const two = (
    await upload(admin, `${delUrl}/documents`, twoName, fixture("doc029-support-v1.txt"))
  ).document;
  await upload(
    admin,
    `/documents/${two.id}/versions`,
    `${fileTag}-two-versions-v2.txt`,
    fixture("doc029-support-v2.txt"),
  );
  const oneName = `${fileTag}-one-version.txt`;
  const one = (
    await upload(admin, `${delUrl}/documents`, oneName, fixture("doc029-support-note.txt"))
  ).document;
  FX.versionDelete = { number: delContract.number, two: two.title, one: one.title };

  const conf = await newContract(nadia, "confidential contract", { isConfidential: true });
  FX.confidential = { number: conf.number };

  const etypes = must(await nadia.api("GET", "/entities/types"), "entity types").entityTypes;
  const newEntity = async (label) => {
    const e = must(
      await nadia.api("POST", "/entities", { legalName: name(label), entityTypeId: etypes[0].id }),
      label,
    ).entity;
    record("entity", e.legalName, e.id);
    return e;
  };
  const confEntity = await newEntity("confidential entity Ltd");
  must(
    await nadia.api("PATCH", `/entities/${confEntity.id}`, { isConfidential: true }),
    "entity confidential",
  );
  FX.confidentialEntity = { id: confEntity.id, name: confEntity.legalName };
  const reg = await newEntity("register entity Ltd");
  const holderEnt = await newEntity("holder entity Ltd");
  must(
    await nadia.api("POST", `/entities/${reg.id}/share-classes`, {
      name: "Ordinary",
      votesPerShare: 1,
    }),
    "share class",
  );
  const regRead = must(await nadia.api("GET", `/entities/${reg.id}/share-register`), "register");
  const ordinary = (regRead.classes ?? regRead.register?.classes).find(
    (c) => c.name === "Ordinary",
  ).id;
  const today = new Date().toISOString().slice(0, 10);
  for (const [quantity, to] of [
    [100, { kind: "individual", name: "Marta Kowalczyk" }],
    [300, { kind: "entity", entityId: holderEnt.id }],
  ])
    must(
      await nadia.api("POST", `/entities/${reg.id}/share-entries`, {
        kind: "allotment",
        effectiveOn: today,
        shareClassId: ordinary,
        quantity,
        to,
      }),
      "allotment",
    );
  FX.registerEntity = { id: reg.id, name: reg.legalName, holderEntity: holderEnt.legalName };
  FX.holderEntityId = holderEnt.id;

  const kType = must(await nadia.api("GET", "/knowledge?limit=1"), "knowledge").knowledgeItems[0]
    .knowledgeTypeId;
  const kItem = must(
    await nadia.api("POST", "/knowledge", {
      title: name("Portal Knowledge"),
      knowledgeTypeId: kType,
    }),
    "knowledge",
  ).knowledgeItem;
  record("knowledge", kItem.title, kItem.id);
  const kFile = `${fileTag}-knowledge.txt`;
  const kDoc = (
    await upload(nadia, `/knowledge/${kItem.id}/documents`, kFile, fixture("doc029-support-v1.txt"))
  ).document;
  await upload(
    nadia,
    `/documents/${kDoc.id}/versions`,
    `${fileTag}-knowledge-v2.txt`,
    fixture("doc029-support-v2.txt"),
  );
  must(
    await nadia.api("PATCH", `/knowledge/${kItem.id}`, {
      audience: "everyone",
      primaryDocumentId: kDoc.id,
      body: "DOC-032 documents-2 fictional guidance for the Portal file check.",
    }),
    "knowledge patch",
  );
  must(await nadia.api("POST", `/knowledge/${kItem.id}/publish`, {}), "knowledge publish");
  FX.knowledge = { id: kItem.id, title: kItem.title, file: kDoc.title };

  const buApproval = await newContract(nadia, "business approver contract");
  await upload(
    nadia,
    `/contracts/${buApproval.number}/documents`,
    `${fileTag}-approval-paper.txt`,
    fixture("doc029-support-v1.txt"),
  );
  must(
    await nadia.api("POST", `/contracts/${buApproval.number}/approvals`, {
      approverIds: [ids.felix],
    }),
    "approval",
  );
  FX.buApproval = { number: buApproval.number };
  const mtypes = must(await admin.api("GET", "/matter-types"), "matter types").matterTypes;
  let matter = null;
  for (const mt of mtypes) {
    const r = await nadia.api("POST", "/matters", {
      title: name("related matter"),
      matterTypeId: mt.id,
      managerId: ids.nadia,
    });
    if (r.status < 300) {
      matter = r.json.matter;
      break;
    }
  }
  check(matter, "no Matter type accepted a Matter without extra Fields");
  record("matter", matter.title, `M-${matter.number}`);
  must(
    await nadia.api("POST", `${sharedUrl}/matter`, { matterNumber: matter.number }),
    "link matter",
  );
  FX.relatedMatter = { number: matter.number };
  ctx.save();

  const ADDED_TYPE = name("Contract document type");
  const added = { docType: null };
  const mcp = { original: null, touched: new Set(), key: null };
  try {
    // ================================================================ Administrator
    const A = "administrator";
    await step(
      A,
      [PEOPLE.daniel.name],
      {
        page: "/settings/users",
        action: "Permissions at a glance: open a user's role control in Settings > Users",
        expected:
          "The role control offers Administrator, Legal team member and Business user only; there is no Deployment operator or other account role.",
      },
      async () => {
        await go(D, "/settings/users");
        await D.getByRole("button", {
          name: "Legal team member — change the role of priya.raman@helix.example",
        }).click();
        const menu = D.getByRole("menu").or(D.getByRole("listbox")).or(D.getByRole("dialog"));
        await menu.first().waitFor({ timeout: 10000 });
        const options = clean(await menu.first().innerText());
        await D.keyboard.press("Escape");
        check(
          /Administrator/.test(options) &&
            /Legal team member/.test(options) &&
            /Business user/.test(options) &&
            !/operator|Contributor/i.test(options),
          options,
        );
        return `The role control for Priya Raman offered ${q(options)}. Escape closed it with no change.`;
      },
    );

    await step(
      A,
      [PEOPLE.daniel.name],
      {
        page: "/settings/contracts/statuses; /settings/matters/statuses",
        action:
          "Stage, Status and Category: read Contract statuses and open Matter statuses > Add status",
        expected:
          "Each Contract Status maps to one Stage from Draft, Review, Approval, Signature, Active, Ended; a new Matter Status asks for Category Open or Closed.",
      },
      async () => {
        await go(D, "/settings/contracts/statuses");
        const stages = [
          ...new Set(((await mainText(D)).match(/Stage: (\w+)/g) ?? []).map((s) => s.slice(7))),
        ];
        await go(D, "/settings/matters/statuses");
        await D.getByRole("button", { name: "Add status" }).click();
        await sleep(800);
        const dlg = D.getByRole("dialog").first();
        const scope = (await dlg.count()) ? dlg : D.getByRole("main");
        const category = scope
          .getByRole("combobox")
          .filter({ has: D.locator("option", { hasText: "Closed" }) })
          .first();
        const opts = (await category.count())
          ? (await category.locator("option").allInnerTexts()).map(clean)
          : [clean(await scope.innerText()).slice(0, 200)];
        await closeDialog(D);
        const want = ["Draft", "Review", "Approval", "Signature", "Active", "Ended"];
        check(
          want.every((s) => stages.includes(s)) &&
            stages.every((s) => want.includes(s)) &&
            opts.some((o) => /Open/.test(o)) &&
            opts.some((o) => /Closed/.test(o)),
          `stages ${stages} opts ${opts}`,
        );
        return `Contract statuses showed the Stages ${q(stages)}. Matter statuses > Add status offered Category ${q(opts)}; Cancel added nothing.`;
      },
    );

    await step(
      A,
      [PEOPLE.daniel.name],
      {
        page: "/settings/documents/contracts",
        action:
          "Document type: open Settings > Organization > Documents; read the Matters, Contracts and Entities lists; Add type on the Contract list",
        expected:
          "One list per module; the Contract list starts with seven fixed types in the order Draft · ours, Draft · theirs, Redline · theirs, Redline · ours, Partially signed, Executed, Amendment; the Matter and Entity lists have no fixed type; an Administrator can add a Contract type.",
      },
      async () => {
        await go(D, "/settings");
        await D.getByRole("group", { name: "Organization" })
          .getByRole("link", { name: "Documents" })
          .click();
        await settle(D);
        const nav = D.getByRole("navigation", { name: "Document type lists" });
        const tabs = (await nav.getByRole("link").allInnerTexts()).map(clean);
        const listOf = async (label) => {
          await nav.getByRole("link", { name: label }).click();
          await settle(D);
          const fixed = await D.getByRole("main")
            .getByRole("img", { name: /has a fixed name\./ })
            .evaluateAll((els) => els.map((e) => e.getAttribute("aria-label")));
          const count = clean(
            await D.getByText(/^\d+ types?$/)
              .first()
              .textContent()
              .catch(() => ""),
          );
          return { fixed: fixed.map((f) => f.replace(/ has a fixed name\..*/, "")), count };
        };
        const matters = await listOf("Matters");
        const entities = await listOf("Entities");
        const contracts = await listOf("Contracts");
        await D.getByRole("button", { name: "Add type" }).click();
        const input = D.getByRole("textbox", { name: "New type name" });
        await input.fill(ADDED_TYPE);
        await input.press("Enter");
        await D.getByRole("main").getByText(ADDED_TYPE).first().waitFor({ timeout: 10000 });
        const t = must(
          await admin.api("GET", "/documents/types/contract"),
          "types",
        ).documentTypes.find((x) => x.displayName === ADDED_TYPE && !x.archivedAt);
        check(t, "added type not read back");
        added.docType = { id: t.id, name: ADDED_TYPE };
        record("document_type:contract", ADDED_TYPE, t.id);
        results.settingsChanged.push({
          setting: "Contract Document type added (archived at the end of the run)",
          value: ADDED_TYPE,
          at: new Date().toISOString(),
        });
        check(
          tabs.join("|") === "Matters|Contracts|Entities" &&
            contracts.fixed.join("|") === SEVEN.join("|") &&
            matters.fixed.length === 0 &&
            entities.fixed.length === 0,
          `tabs ${tabs} ${JSON.stringify({ matters, entities, contracts })}`,
        );
        return `Settings > Organization > Documents showed the lists ${q(tabs)}. Contracts: fixed types in order ${q(contracts.fixed)} (${contracts.count} in all on this shared lab, including other agents' additions). Matters: ${matters.count}, none fixed. Entities: ${entities.count}, none fixed. Add type, New type name, Enter added ${q(ADDED_TYPE)} to the Contract list.`;
      },
    );

    await step(
      A,
      [PEOPLE.daniel.name],
      {
        page: "/settings/*",
        action:
          "What your organization can configure: open types and their Forms, Statuses, Fields, Document types, Matter Templates, Approver groups, request types, default reminder lead times and MCP",
        expected:
          "Each named configuration has an Organization settings page; a type's Form has per-Row On intake form, Required for creation and Visible on Portal switches.",
      },
      async () => {
        const pages = {};
        for (const [label, url] of [
          ["Contract types", "/settings/contracts/types"],
          ["Contract statuses", "/settings/contracts/statuses"],
          ["Contract fields", "/settings/contracts/fields"],
          ["Approver groups", "/settings/contracts/approver-groups"],
          ["Matter templates", "/settings/matters/templates"],
          ["Request types", "/settings/intake/request-types"],
          ["Reminders", "/settings/reminders"],
          ["Document types", "/settings/documents/contracts"],
          ["MCP", "/settings/mcp"],
        ]) {
          await go(D, url);
          const heads = (
            await D.getByRole("main").getByRole("heading", { level: 2 }).allInnerTexts()
          )
            .map(clean)
            .filter((h) => !/^(Personal|Organization)$/.test(h));
          pages[label] = `${new URL(D.url()).pathname}: ${heads.slice(0, 3).join(" / ")}`;
        }
        await go(D, "/settings/contracts/types");
        await D.getByRole("main").getByRole("button", { name: "Edit DPA" }).click();
        await settle(D);
        await D.getByRole("main")
          .getByRole("tab", { name: "Form" })
          .or(D.getByRole("main").getByRole("link", { name: "Form" }))
          .first()
          .click();
        await settle(D);
        const sw = [...new Set((await switchStates(D)).map((s) => s.name.replace(/ for .*$/, "")))];
        const swText = clean(await D.getByRole("main").innerText());
        check(
          Object.values(pages).every((v) => !/not found/i.test(v)) &&
            /On intake form/.test(`${sw} ${swText}`) &&
            /Required for creation/.test(`${sw} ${swText}`) &&
            /Visible on Portal/.test(`${sw} ${swText}`),
          `${JSON.stringify(pages)} ${sw}`,
        );
        return `Pages: ${q(pages)}. The DPA Form's Row switch kinds: ${q(sw.slice(0, 8))}.`;
      },
    );

    await step(
      A,
      [PEOPLE.daniel.name, PEOPLE.nadia.name],
      {
        page: `/entities/${confEntity.id}; /contracts/${conf.number}`,
        action:
          "Permissions: the Administrator opens a Confidential Entity without and with a Grant, and a Confidential Contract he is not named on",
        expected:
          "Without a Grant the Entity answers Entity not found; with Nadia's Grant it opens; after removal it is closed again; the Confidential Contract answers Contract not found.",
      },
      async () => {
        await go(D, `/entities/${confEntity.id}`);
        const before = await h1(D);
        must(
          await nadia.api("POST", `/entities/${confEntity.id}/grants`, { userId: ids.daniel }),
          "grant",
        );
        await go(D, `/entities/${confEntity.id}`);
        const withGrant = await h1(D);
        must(
          await nadia.api("DELETE", `/entities/${confEntity.id}/grants/${ids.daniel}`),
          "revoke",
        );
        await go(D, `/entities/${confEntity.id}`);
        const revoked = await h1(D);
        await go(D, `/contracts/${conf.number}`);
        const contract = await h1(D);
        check(
          before === "Entity not found" &&
            withGrant === confEntity.legalName &&
            revoked === "Entity not found" &&
            contract === "Contract not found",
          `${before} | ${withGrant} | ${revoked} | ${contract}`,
        );
        return `Confidential Entity: ${q(before)} before the Grant, ${q(withGrant)} after Nadia granted Daniel, ${q(revoked)} after removal. Confidential C-${conf.number}: ${q(contract)}.`;
      },
    );

    // ---------------------------------------------------------------- Delete version
    const showEarlier = async (page, title) => {
      const t = page.getByRole("button", {
        name: new RegExp(`^Show the \\d+ earlier versions? of ${esc(title)}$`),
      });
      if (await t.isVisible().catch(() => false)) await t.click();
    };
    const versionMenu = async (page, title, n) => {
      await showEarlier(page, title);
      return menuItems(
        page,
        page.getByRole("button", { name: `Actions for version ${n} of ${title}`, exact: true }),
      );
    };
    const rowMenu = (page, title) =>
      menuItems(page, page.getByRole("button", { name: `Actions for ${title}`, exact: true }));
    const openDocs = async (page, url) => {
      await go(page, url);
      await docsRegion(page)
        .getByRole("heading", { name: "Documents" })
        .waitFor({ timeout: 30000 });
    };

    await step(
      "legal_team_member",
      [PEOPLE.nadia.name],
      {
        page: `${delUrl}/documents`,
        action:
          "Documents: a Legal Team Member opens the row Actions menu and an earlier Version's Actions for version menu on a two-Version Document",
        expected:
          "Only an Administrator can permanently delete a Version: the Legal Team Member sees no Delete version and no whole-Document Delete in either menu.",
      },
      async () => {
        await openDocs(N, `${delUrl}/documents`);
        const row = await rowMenu(N, two.title);
        const v1 = await versionMenu(N, two.title, 1);
        check(
          !row.some((i) => /Delete/.test(i)) && !v1.some((i) => /Delete/.test(i)),
          `row ${row} v1 ${v1}`,
        );
        return `On C-${delContract.number}, Nadia's Actions for ${q(two.title)} offered ${q(row)}; Actions for version 1 offered ${q(v1)}. Neither menu has Delete version or Delete.`;
      },
    );

    await step(
      A,
      [PEOPLE.daniel.name],
      {
        page: `${delUrl}/documents`,
        action:
          "Documents: the Administrator reads the row and version menus, deletes Version 2 of a two-Version Document, then deletes the only Version of a one-Version Document (Delete version, type delete, Delete version)",
        expected:
          "Delete version is offered to the Administrator and no whole-Document Delete exists; deleting Version 2 keeps the Document with Version 1; deleting a Document's last Version also removes the Document.",
      },
      async () => {
        await openDocs(D, `${delUrl}/documents`);
        const row = await rowMenu(D, two.title);
        const v1 = await versionMenu(D, two.title, 1);
        const oneRow = await rowMenu(D, one.title);
        const del = async (title) => {
          await D.getByRole("button", { name: `Actions for ${title}`, exact: true }).click();
          await D.getByRole("menuitem", { name: "Delete version", exact: true }).click();
          const dialog = D.getByRole("dialog", { name: /^Delete version \d+\?$/ });
          await dialog.waitFor();
          const text = clean(await dialog.innerText());
          await dialog.getByLabel('Type "delete" to confirm').fill("delete");
          await dialog
            .getByRole("button")
            .filter({ hasText: /^Delete version$/ })
            .click();
          await dialog.waitFor({ state: "hidden", timeout: 30000 });
          await settle(D);
          return text;
        };
        const t2 = await del(two.title);
        const t1 = await del(one.title);
        await D.getByRole("button", { name: `Actions for ${one.title}`, exact: true })
          .waitFor({ state: "detached", timeout: 15000 })
          .catch(() => {});
        const docs = await recordDocs(admin, delUrl);
        const twoAfter = docs.find((d) => d.id === two.id);
        const oneAfter = docs.find((d) => d.id === one.id);
        const oneRowLeft = await D.getByRole("button", {
          name: `Actions for ${one.title}`,
          exact: true,
        }).count();
        check(
          row.includes("Delete version") &&
            !row.includes("Delete") &&
            v1.includes("Delete version") &&
            oneRow.includes("Delete version") &&
            !oneRow.includes("Delete"),
          `row ${row} v1 ${v1} one ${oneRow}`,
        );
        check(
          twoAfter &&
            twoAfter.versions.map((v) => v.versionNumber).join(",") === "1" &&
            !oneAfter &&
            oneRowLeft === 0,
          `two ${JSON.stringify(twoAfter?.versions?.map((v) => v.versionNumber))} one ${Boolean(oneAfter)} row ${oneRowLeft}`,
        );
        return `Daniel's Actions for ${q(two.title)} offered ${q(row)}; Actions for version 1 offered ${q(v1)}; the one-Version Document's menu offered ${q(oneRow)}. No item deletes a whole Document. Deleting Version 2 (${q(t2.slice(0, 160))}) left the Document with Versions 1. Deleting the only Version of ${q(one.title)} (${q(t1.slice(0, 160))}) removed its row, and the Documents read-back no longer lists it.`;
      },
    );

    // ================================================================ Legal Team Member
    const L = "legal_team_member";
    await step(
      L,
      [PEOPLE.nadia.name],
      {
        page: `/entities/${reg.id}/ownership; /entities/${holderEnt.id}/ownership`,
        action:
          "Holding: read the register Entity's Register of members and the holder Entity's Holdings in other Entities; open Add Holding and cancel",
        expected:
          "The register lists an Individual and an Entity holder; the holder Entity's row for the register Entity shows From register with no enabled edit control; Add Holding offers an Entity or an Individual as owner.",
      },
      async () => {
        await go(N, `/entities/${reg.id}/ownership`);
        const members = clean(
          await N.getByRole("region", { name: "Register of members" }).innerText(),
        );
        await go(N, `/entities/${holderEnt.id}/ownership`);
        const owned = N.getByRole("region", { name: "Holdings in other Entities" });
        await owned.waitFor({ timeout: 20000 });
        const row = owned
          .getByRole("listitem")
          .or(owned.getByRole("row"))
          .filter({ hasText: reg.legalName })
          .first();
        const rowText = clean(await row.innerText().catch(() => ""));
        const editable = await row
          .locator("input:not([disabled]), button[aria-label^='Remove']:not([disabled])")
          .count();
        const locked = await row
          .locator("input[disabled], button[aria-label^='Remove'][disabled]")
          .count();
        await N.getByRole("button", { name: "Add Holding" }).click();
        const dialog = N.getByRole("dialog", { name: "Add Holding" });
        await dialog.waitFor();
        const dialogText = clean(await dialog.innerText());
        await closeDialog(N);
        check(
          /Marta Kowalczyk/.test(members) &&
            /Individual/.test(members) &&
            members.includes(holderEnt.legalName),
          `members ${members}`,
        );
        check(
          /From register/.test(rowText) && editable === 0,
          `row ${rowText} editable ${editable}`,
        );
        check(/Individual/.test(dialogText) && /Entity/.test(dialogText), dialogText);
        return `Register of members read ${q(members.slice(0, 300))}. On the holder Entity, the row for the register Entity read ${q(rowText)} with ${editable} enabled and ${locked} disabled percent or remove controls. Add Holding read ${q(dialogText.slice(0, 240))}; Cancel added nothing.`;
      },
    );

    await step(
      L,
      [PEOPLE.nadia.name],
      {
        page: `${sharedUrl}/key-dates; ${sharedUrl}/tasks; ${sharedUrl}`,
        action:
          "Task and Key date, Entity and Counterparty: open Add date and Add task (Cancel), then read the Contract Overview",
        expected:
          "Add a key date has no assignee but has reminder lead times and team recipients; Add task has an assignee and a due date; the Overview shows Our entity separately from Counterparties. The app does not equate Task due dates with Key dates or Entity with Counterparty.",
      },
      async () => {
        await go(N, `${sharedUrl}/key-dates`);
        await N.getByRole("button", { name: "Add date" }).click();
        const kd = N.getByRole("dialog", { name: "Add a key date" });
        await kd.waitFor();
        await kd.getByRole("checkbox", { name: "Nadia Haddad" }).waitFor({ timeout: 20000 });
        const kdText = clean(await kd.innerText());
        await kd.getByRole("button", { name: "Cancel" }).click();
        await go(N, `${sharedUrl}/tasks`);
        await N.getByRole("button", { name: "Add task" }).click();
        await sleep(1000);
        const td = N.getByRole("dialog").first();
        const taskText = clean(
          await ((await td.count()) ? td : N.getByRole("region", { name: "Tasks" })).innerText(),
        );
        await N.keyboard.press("Escape");
        await go(N, sharedUrl);
        const entity = await N.getByRole("combobox", { name: "Our entity" }).count();
        const cps = await N.getByRole("combobox", { name: "Counterparties" }).count();
        check(
          !/assign/i.test(kdText) &&
            /lead time/i.test(kdText) &&
            /Nadia Haddad/.test(kdText) &&
            /Assign/i.test(taskText) &&
            /Due/i.test(taskText) &&
            entity === 1 &&
            cps === 1,
          `kd ${kdText} task ${taskText} entity ${entity} cp ${cps}`,
        );
        return `Add a key date read ${q(kdText.slice(0, 380))}: no assignee, a lead-time control and team recipients. Add task showed ${q(taskText.slice(0, 220))}. The Contract Overview has separate Our entity and Counterparties controls.`;
      },
    );

    const typedFile = `${fileTag}-typed.txt`;
    await step(
      L,
      [PEOPLE.nadia.name],
      {
        page: `${sharedUrl}/documents`,
        action:
          "Document type: Upload with Type set to the Administrator-added type; change the image's Type column to Partially signed and reload",
        expected:
          "Type starts at No type and lists the seven fixed Contract types and the added one; the upload keeps the chosen type; the Type column change to Partially signed stays after reload; the primary Document stays No type.",
      },
      async () => {
        check(added.docType, "no Administrator-added type (the Settings step failed)");
        await go(N, `${sharedUrl}/documents`);
        await docsRegion(N).getByRole("button", { name: "Upload", exact: true }).click();
        const dialog = N.getByRole("dialog", { name: "Upload document" });
        await dialog.waitFor({ timeout: 10000 });
        const [chooser] = await Promise.all([
          N.waitForEvent("filechooser"),
          dialog.getByRole("button", { name: /Choose file/ }).click(),
        ]);
        await chooser.setFiles({
          name: typedFile,
          mimeType: "text/plain",
          buffer: fixture("doc029-support-note.txt"),
        });
        const type = dialog.getByLabel("Type", { exact: true });
        const initial = clean(await type.locator("option:checked").textContent());
        const options = (await type.locator("option").allInnerTexts()).map(clean);
        await type.selectOption({ label: ADDED_TYPE });
        await dialog.getByRole("button", { name: "Upload", exact: true }).click();
        await dialog.waitFor({ state: "hidden", timeout: 30000 });
        await settle(N);
        const typeOf = async (file) =>
          clean(
            await N.getByRole("combobox", {
              name: new RegExp(`^Type of version \\d+ of ${esc(file)}`),
            })
              .first()
              .locator("option:checked")
              .textContent(),
          );
        const typed = await typeOf(typedFile);
        await N.getByRole("combobox", {
          name: new RegExp(`^Type of version \\d+ of ${esc(pngName)}`),
        })
          .first()
          .selectOption({ label: "Partially signed" });
        await settle(N, 1500);
        await N.reload();
        await settle(N);
        const pngAfter = await typeOf(pngName);
        const primaryType = await typeOf(primary.title);
        check(
          initial === "No type" &&
            options[0] === "No type" &&
            SEVEN.every((t) => options.includes(t)) &&
            options.includes(ADDED_TYPE) &&
            typed === ADDED_TYPE &&
            pngAfter === "Partially signed" &&
            primaryType === "No type",
          `initial ${initial} options ${options} typed ${typed} png ${pngAfter} primary ${primaryType}`,
        );
        return `Upload document: Type started at ${q(initial)} with ${options.length} options, including ${q(SEVEN)} and ${q(ADDED_TYPE)}; the upload's Type column read ${q(typed)}. The image's Type column changed to ${q(pngAfter)} and kept it after reload. The primary Document read ${q(primaryType)}.`;
      },
    );

    await step(
      L,
      [PEOPLE.nadia.name],
      {
        page: `${sharedUrl}/documents`,
        action:
          "Executed pin and Comparison: open the primary Document's Actions menu; select Compare with previous",
        expected:
          "Actions offer Mark as executed copy and Compare with previous and no delete item; Compare opens a comparison page and the Document still has 2 Versions (a Comparison is not a Version).",
      },
      async () => {
        await openDocs(N, `${sharedUrl}/documents`);
        const items = await rowMenu(N, primary.title);
        await N.getByRole("button", { name: `Actions for ${primary.title}`, exact: true }).click();
        await N.getByRole("menuitem", { name: "Compare with previous" }).click();
        await settle(N, 3000);
        const comparePath = new URL(N.url()).pathname;
        const body = await bodyText(N);
        const compareText =
          body.match(/Compares v\d+ and v\d+/)?.[0] ?? (await h1(N).catch(() => ""));
        const failed = body.match(/[^.]*(could not|failed)[^.]*\./i)?.[0] ?? null;
        const versions = (await recordDocs(nadia, sharedUrl)).find((d) => d.id === primary.id)
          .versions.length;
        if (failed)
          results.limitations.push(
            `Comparison of two text Versions on C-${shared.number} showed ${JSON.stringify(failed)} on the comparison page (doc engine on the shared lab). The reference row's claim that a Comparison is not itself a Version was still observed: the Document kept ${versions} Versions.`,
          );
        check(
          items.includes("Mark as executed copy") &&
            items.includes("Compare with previous") &&
            !items.some((i) => /Delete/.test(i)) &&
            /compar/i.test(comparePath) &&
            versions === 2,
          `items ${items} path ${comparePath} versions ${versions}`,
        );
        return `Nadia's Actions for ${q(primary.title)} offered ${q(items)}. Compare with previous opened ${comparePath} (${q(compareText)}${failed ? `; the page also read ${q(failed)}` : ""}); the Document still had ${versions} Versions.`;
      },
    );

    await step(
      L,
      [PEOPLE.nadia.name],
      {
        page: `${sharedUrl}/documents?doc=…`,
        action: "File behavior: open the PNG, the SVG and the EML Documents in the reader",
        expected:
          "The PNG reads inline; the SVG shows the download-only card; the EML shows its headers and body.",
      },
      async () => {
        const docs = await recordDocs(nadia, sharedUrl);
        const open = async (file, ready = null) => {
          const doc = docs.find((d) => d.title === file);
          const v = doc.versions.at(-1);
          await go(N, `${sharedUrl}/documents?doc=${doc.id}&version=${v.id}`);
          const panel = N.getByRole("complementary")
            .filter({ has: N.getByRole("button", { name: "Close the document" }) })
            .first();
          await panel.waitFor({ timeout: 30000 }).catch(() => {});
          if (ready)
            await panel
              .getByText(ready)
              .first()
              .waitFor({ timeout: 30000 })
              .catch(() => {});
          else await sleep(3000);
          const visible = await panel.isVisible().catch(() => false);
          return {
            visible,
            text: visible ? clean(await panel.innerText()).slice(0, 220) : "",
            imgs: visible ? await panel.locator("img").count() : 0,
          };
        };
        const png = await open(pngName);
        const svg = await open(svgName, /does not open here/);
        const eml = await open(emlName, /DOC-029 support fictional message/);
        check(png.visible && png.imgs > 0, `png ${JSON.stringify(png)}`);
        check(/does not open here/.test(svg.text), `svg ${JSON.stringify(svg)}`);
        check(/DOC-029 support fictional message/.test(eml.text), `eml ${JSON.stringify(eml)}`);
        return `PNG reader: ${png.imgs} image element(s). SVG: ${q(svg.text)}. EML reader: ${q(eml.text)}.`;
      },
    );

    await step(
      L,
      [PEOPLE.nadia.name],
      {
        page: `/knowledge/${kItem.id}; /settings/users`,
        action:
          "Knowledge files and settings ownership: read a Knowledge Item's Type and its file's Type column; open /settings/users as Legal",
        expected:
          "The Knowledge file's Type column shows the item's Knowledge type; the Legal Team Member has no Organization settings; Personal lists Notifications and API keys.",
      },
      async () => {
        await go(N, `/knowledge/${kItem.id}`);
        const kTypeName = clean(
          await N.getByRole("main")
            .getByRole("combobox", { name: "Type", exact: true })
            .locator("option:checked")
            .textContent(),
        );
        const col = N.getByRole("combobox", {
          name: new RegExp(`^Type of version \\d+ of ${esc(kFile)}`),
        }).first();
        const colType = clean(await col.locator("option:checked").textContent());
        await go(N, "/settings/users");
        const landed = new URL(N.url()).pathname;
        const invite = await N.getByRole("button", { name: "Invite user" }).count();
        const org = await N.getByRole("group", { name: "Organization" }).count();
        const personal = (
          await N.getByRole("group", { name: "Personal" }).getByRole("link").allInnerTexts()
        ).map(clean);
        check(
          colType === kTypeName &&
            invite === 0 &&
            org === 0 &&
            personal.includes("Notifications") &&
            personal.includes("API keys"),
          `k ${kTypeName}/${colType} invite ${invite} org ${org} personal ${personal}`,
        );
        return `Knowledge ${q(kItem.title)} has Type ${q(kTypeName)}; its file's Type column read ${q(colType)}. /settings/users for Nadia ended at ${landed} with no Invite user and no Organization group; Personal listed ${q(personal)}.`;
      },
    );

    await step(
      L,
      [PEOPLE.nadia.name],
      {
        page: `${sharedUrl}/signatures`,
        action:
          "Envelope: open the Contract's Signatures tab on the default build (Signing connector not configured on this lab)",
        expected:
          "The reference's Envelope states (preparing, draft, sent) and the live-Envelope refusal are observable only with a configured connector; the default build shows the Signatures section. Record what it shows.",
      },
      async () => {
        await go(N, sharedUrl);
        await N.getByRole("link", { name: "Signatures", exact: true }).first().click();
        await settle(N);
        const section = N.getByRole("region", { name: "Signatures" });
        await section.waitFor({ timeout: 20000 });
        const text = clean(await section.innerText());
        const send = await section.getByRole("button", { name: "Send for signature" }).count();
        const prepare = await section.getByRole("button", { name: "Prepare Envelope" }).count();
        const statuses = sql(
          project,
          "select coalesce(string_agg(distinct status::text, ','), '(none)') from contract_envelopes",
        );
        const constraint = sql(
          project,
          "select coalesce(string_agg(pg_get_constraintdef(oid), ' | '), '') from pg_constraint where conrelid='contract_envelopes'::regclass and contype='c' and pg_get_constraintdef(oid) like '%status%'",
        );
        check(/Signatures/.test(text) && prepare === 0, `section ${text}`);
        results.limitations.push(
          `Envelope row: the work lab has signing unconfigured and signingPreparation off. The Contract's Signatures section read ${JSON.stringify(text.slice(0, 160))} with ${send} Send for signature and ${prepare} Prepare Envelope buttons; the lab holds Envelope statuses ${statuses}. The preparing and draft states and the refusal of a second live Envelope were not observable in the browser. The database status check reads ${JSON.stringify(constraint.slice(0, 700))}.`,
        );
        return `Signatures read ${q(text.slice(0, 200))}; Send for signature ${send}, Prepare Envelope ${prepare} (connector not configured). Envelope statuses in the lab database: ${statuses}. Status check constraint: ${q(constraint.slice(0, 700))}. Recorded as a limitation.`;
      },
    );

    // ================================================================ Business User
    const BU = "business_user";
    await step(
      BU,
      [PEOPLE.felix.name, PEOPLE.nadia.name],
      {
        page: `/documents; /portal/contracts/${shared.number}`,
        action:
          "Permissions and Portal files: open a staff address; read the shared Contract's Portal Documents rows; show earlier Versions and download Version 1",
        expected:
          "Staff addresses land in the Portal. The Portal shows the Document type name: the Administrator-added type by its name, Partially signed for the fixed type, and General for a Version with no type; earlier Versions read and download.",
      },
      async () => {
        await go(B, "/documents");
        const staffPath = new URL(B.url()).pathname;
        await go(B, `/portal/contracts/${shared.number}`);
        const region = docsRegion(B);
        await region.waitFor({ timeout: 20000 });
        const item = (n) => region.getByRole("listitem").filter({ hasText: n }).first();
        const typedRow = clean(await item(typedFile).innerText());
        const pngRow = clean(await item(pngName).innerText());
        const primaryRow = clean(await item(primary.title).innerText());
        const earlier = item(primary.title).getByRole("button", { name: /earlier version/i });
        let earlierText = "no earlier Versions control";
        if (await earlier.count()) {
          await earlier.first().click();
          await sleep(800);
          earlierText = clean(await item(primary.title).innerText()).slice(0, 260);
        }
        const v1 = region
          .getByRole("link", { name: new RegExp(`^Download ${esc(primary.title)}, version 1$`) })
          .first();
        const dl = (await v1.count()) ? await download(B, () => v1.click()) : null;
        check(
          staffPath.startsWith("/portal") &&
            typedRow.includes(ADDED_TYPE) &&
            !/General/.test(typedRow) &&
            /Partially signed/.test(pngRow) &&
            /General/.test(primaryRow) &&
            dl?.sha256 === sha(fixture("doc029-support-v1.txt")),
          JSON.stringify({ staffPath, typedRow, pngRow, primaryRow, dl }),
        );
        return `/documents in Felix's session landed on ${staffPath}. Portal Documents rows: added type ${q(typedRow.slice(0, 180))}; fixed type ${q(pngRow.slice(0, 140))}; no type ${q(primaryRow.slice(0, 140))}. Earlier Versions: ${q(earlierText)}. Version 1 downloaded ${dl.bytes} bytes equal to the uploaded Version 1.`;
      },
    );

    await step(
      BU,
      [PEOPLE.felix.name],
      {
        page: `/portal/contracts/${shared.number}`,
        action: "Portal upload: select Upload documents, add a file, read Kind, then Cancel",
        expected:
          "Kind offers General and the seven fixed Contract types (Draft · ours, Draft · theirs, Redline · theirs, Redline · ours, Partially signed, Executed, Amendment), eight options in all, and no Administrator-added type. The reference names no order for Kind.",
      },
      async () => {
        await go(B, `/portal/contracts/${shared.number}`);
        await B.getByRole("button", { name: "Upload documents" }).click();
        const dialog = B.getByRole("dialog", { name: "Upload documents" });
        await dialog.waitFor();
        await dialog.locator("input[type=file]").setInputFiles({
          name: `${fileTag}-not-uploaded.txt`,
          mimeType: "text/plain",
          buffer: Buffer.from("DOC-032 V-C50 fictional file, not uploaded.\n"),
        });
        const kind = dialog.getByRole("combobox", { name: "Kind" });
        const kindDefault = await kind.evaluate((s) => s.options[s.selectedIndex].text);
        const kinds = (await kind.locator("option").allInnerTexts()).map(clean);
        await dialog.getByRole("button", { name: "Cancel" }).click();
        await dialog.waitFor({ state: "hidden" });
        const docsAfter = await recordDocs(nadia, sharedUrl);
        const leaked = docsAfter.some((d) => d.title === `${fileTag}-not-uploaded.txt`);
        check(
          kindDefault === "General" &&
            kinds.length === 8 &&
            ["General", ...SEVEN].every((k) => kinds.includes(k)) &&
            !kinds.includes(ADDED_TYPE) &&
            !leaked,
          JSON.stringify({ kindDefault, kinds, leaked }),
        );
        return `Kind started on ${q(kindDefault)} and offered, in this order, ${q(kinds)}, without ${q(ADDED_TYPE)}. Cancel uploaded nothing.`;
      },
    );

    await step(
      BU,
      [PEOPLE.felix.name],
      {
        page: `/portal/knowledge/${kItem.id}`,
        action: "Portal files: open published Knowledge whose file has two Versions; download",
        expected:
          "Published Knowledge offers a current-file Download without a Version-history picker; the download returns Version 2.",
      },
      async () => {
        await go(B, `/portal/knowledge/${kItem.id}`);
        const main = B.getByRole("main");
        const heading = await h1(B);
        const links = (await main.getByRole("link", { name: /Download/ }).allInnerTexts()).map(
          clean,
        );
        const versionControls = await main
          .getByRole("combobox")
          .or(main.getByRole("button", { name: /version/i }))
          .count();
        const dl = await download(B, () =>
          main
            .getByRole("link", { name: /Download/ })
            .first()
            .click(),
        );
        check(
          heading === kItem.title &&
            links.length === 1 &&
            versionControls === 0 &&
            dl.sha256 === sha(fixture("doc029-support-v2.txt")),
          `h ${heading} links ${links} vc ${versionControls} dl ${dl.bytes}`,
        );
        return `Portal Knowledge ${q(heading)} showed ${links.length} Download link and ${versionControls} Version controls. The download returned ${dl.bytes} bytes equal to Version 2.`;
      },
    );

    await step(
      BU,
      [PEOPLE.felix.name, PEOPLE.nadia.name],
      {
        page: `/portal/contracts/${buApproval.number}; /portal/matters/${matter.number}`,
        action:
          "Approval Request and related records: open the Contract whose Approval Request names Felix, and the Matter linked to the shared Contract",
        expected:
          "The Approval Request does not add the Business User to the team, so the Portal record page stays closed; the related Matter stays closed.",
      },
      async () => {
        await go(B, `/portal/contracts/${buApproval.number}`);
        const text = (await bodyText(B)).slice(0, 300);
        await go(N, `/contracts/${buApproval.number}`);
        const team = clean(await (await applet(N, "Contract team")).innerText());
        await go(B, `/portal/matters/${matter.number}`);
        const mText = (await bodyText(B)).slice(0, 300);
        check(
          /does not exist, or you cannot open it\./.test(text) &&
            !team.includes(PEOPLE.felix.name) &&
            /does not exist, or you cannot open it\./.test(mText),
          `text ${text} team ${team} matter ${mText}`,
        );
        return `/portal/contracts/${buApproval.number} showed ${q(text.match(/[^.]*does not exist, or you cannot open it\./)?.[0])}; Nadia's Contract team applet read ${q(team.slice(0, 140))}, without Felix. M-${matter.number}, linked to shared C-${shared.number}, showed ${q(mText.match(/[^.]*does not exist, or you cannot open it\./)?.[0])}.`;
      },
    );

    // ================================================================ API keys (MCP window)
    const POLICY = [
      "enabled",
      "legalApiKeysEnabled",
      "businessApiKeysEnabled",
      "readOnly",
      "apiKeyLifetimeDays",
      "toolsetCeiling",
    ];
    const policyNow = async () => {
      const s = must(await admin.api("GET", "/mcp-settings"), "mcp settings");
      return Object.fromEntries(POLICY.map((k) => [k, s[k]]));
    };
    mcp.original = await policyNow();
    results.settingsChanged.push({
      setting: "MCP policy before the API key steps",
      value: mcp.original,
      at: new Date().toISOString(),
    });
    ctx.save();
    const kname = (label) => name(label);
    const rowOf = (page, client) =>
      page.getByRole("main").getByRole("row").filter({ hasText: client }).first();
    const rowText = async (page, client) => clean(await rowOf(page, client).innerText());
    const openKeysStaff = async (page) => {
      await go(page, "/settings");
      await page
        .getByRole("group", { name: "Personal" })
        .getByRole("link", { name: "API keys" })
        .click();
      await settle(page);
    };
    const openKeysPortal = async () => {
      await go(B, "/portal");
      await B.getByRole("banner")
        .getByRole("link", { name: "Notification settings" })
        .or(B.getByRole("banner").getByRole("button", { name: "Notification settings" }))
        .first()
        .click();
      await settle(B);
      await B.getByRole("main").getByRole("link", { name: "API keys" }).click();
      await settle(B);
    };
    const readDialog = async (page) => {
      await page.getByRole("button", { name: "Request a key" }).click();
      const dialog = page.getByRole("dialog", { name: "Request an API key" });
      await dialog.waitFor({ timeout: 10000 });
      const text = clean(await dialog.innerText());
      const toolsets = (
        await dialog
          .getByRole("checkbox")
          .evaluateAll((els) => els.map((e) => e.closest("label")?.textContent ?? ""))
      ).map(clean);
      const checked = await dialog.getByRole("checkbox", { checked: true }).count();
      const radios = (
        await dialog
          .getByRole("radio")
          .evaluateAll((els) => els.map((e) => e.parentElement.textContent))
      ).map(clean);
      return { dialog, text, toolsets, checked, radios };
    };
    const requestKey = async (page, client, { toolsets, scope, note }) => {
      const r = await readDialog(page);
      await r.dialog.getByLabel("Client name").fill(client);
      for (const t of toolsets)
        await r.dialog.getByRole("checkbox", { name: t, exact: true }).click();
      await r.dialog
        .getByRole("radio", { name: scope === "write" ? /^Write\./ : /^Read\./ })
        .check();
      if (note) await r.dialog.getByLabel("Note (Optional)").fill(note);
      await r.dialog.getByRole("button", { name: "Send request" }).click();
      await r.dialog.waitFor({ state: "hidden", timeout: 15000 });
      await settle(page);
      record("api_key", client, "API key request");
      return r;
    };
    const decide = async (page, client, action, note) => {
      await rowOf(page, client).getByRole("button", { name: action, exact: true }).click();
      const dialog = page.getByRole("dialog");
      await dialog.waitFor({ timeout: 10000 });
      const text = clean(await dialog.innerText());
      if (note) await dialog.getByLabel("Note (Optional)").fill(note);
      await dialog.getByRole("button", { name: action, exact: true }).last().click();
      await dialog.waitFor({ state: "hidden", timeout: 15000 });
      await settle(page);
      return text;
    };
    const readyDialog = async (page) => {
      const ready = page.getByRole("dialog", { name: "Your key is ready" });
      await ready.waitFor({ timeout: 20000 });
      const key = clean(await ready.locator("code").first().textContent());
      const text = clean(await ready.innerText())
        .split(key)
        .join("<key>");
      await ready.getByRole("button", { name: "Done" }).click();
      await ready.waitFor({ state: "hidden" });
      return { key, text };
    };
    const saveSwitch = async (sw) => {
      const res = D.waitForResponse(
        (r) => r.url().includes("/api/v1/mcp-settings") && r.request().method() === "PATCH",
      );
      await sw.click();
      const status = (await res).status();
      await sleep(400);
      return status;
    };
    const mcpCall = async (key, method, params, id = 1) => {
      const headers = {
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
      };
      if (key) headers["x-api-key"] = key;
      const r = await fetch(`${BASE}/mcp`, {
        method: "POST",
        headers,
        body: JSON.stringify({ jsonrpc: "2.0", id, method, params }),
      });
      const raw = await r.text();
      const line = raw.split("\n").find((l) => l.startsWith("data:"));
      let body = null;
      try {
        body = JSON.parse(line ? line.slice(5) : raw);
      } catch {
        body = raw.slice(0, 200);
      }
      return { status: r.status, body };
    };

    await step(
      L,
      [PEOPLE.nadia.name],
      {
        page: "/settings/api-keys",
        action: "API keys: open Settings > Personal > API keys while Enable MCP is off",
        expected:
          "The page opens with Connected Clients; Request a key is absent while Enable MCP or the group's API keys switch is off.",
      },
      async () => {
        await openKeysStaff(N);
        const request = await N.getByRole("button", { name: "Request a key" }).count();
        const cc = await N.getByRole("region", { name: "Connected Clients" }).count();
        const text = await mainText(N);
        check(
          !mcp.original.enabled && request === 0 && cc === 1,
          `enabled ${mcp.original.enabled} request ${request} cc ${cc}`,
        );
        return `With Enable MCP off, ${new URL(N.url()).pathname} showed ${request} Request a key buttons and ${q(text.slice(0, 260))}.`;
      },
    );

    await step(
      BU,
      [PEOPLE.felix.name],
      {
        page: "/portal/settings/api-keys",
        action:
          "API keys: in the Portal select Notification settings, then API keys, while Enable MCP is off",
        expected: "Notification settings links to API keys; Request a key is absent.",
      },
      async () => {
        await openKeysPortal();
        const path_ = new URL(B.url()).pathname;
        const request = await B.getByRole("button", { name: "Request a key" }).count();
        const text = await mainText(B);
        check(path_ === "/portal/settings/api-keys" && request === 0, `path ${path_} ${request}`);
        return `Notification settings > API keys opened ${path_} with ${request} Request a key buttons: ${q(text.slice(0, 240))}.`;
      },
    );

    await step(
      A,
      [PEOPLE.daniel.name, PEOPLE.nadia.name],
      {
        page: "/settings/mcp",
        action:
          "API keys: in Organization > MCP turn on Enable MCP (check Legal's page), then Legal Users API keys and Business Users API keys; expand Toolset ceiling and select Team and Administration",
        expected:
          "With Enable MCP on and Legal Users API keys off, Request a key is still absent for Legal; each switch and checkbox saves; the ceiling summary counts the two added Toolsets.",
      },
      async () => {
        await go(D, "/settings");
        await D.getByRole("group", { name: "Organization" })
          .getByRole("link", { name: "MCP", exact: true })
          .first()
          .click();
        await settle(D);
        const saved = [];
        const turnOn = async (label) => {
          const sw = D.getByRole("switch", { name: label, exact: true });
          if ((await sw.getAttribute("aria-checked")) !== "true") {
            saved.push(`${label}: ${await saveSwitch(sw)}`);
            return true;
          }
          return false;
        };
        if (await turnOn("Enable MCP")) mcp.touched.add("enabled");
        await openKeysStaff(N);
        const legalOffWhileMcpOn = await N.getByRole("button", { name: "Request a key" }).count();
        if (await turnOn("Legal Users API keys")) mcp.touched.add("legalApiKeysEnabled");
        if (await turnOn("Business Users API keys")) mcp.touched.add("businessApiKeysEnabled");
        await D.getByRole("button", { name: /Toolset ceiling/ })
          .first()
          .click();
        await sleep(600);
        for (const t of ["Team", "Administration"]) {
          const box = D.getByRole("checkbox", { name: t, exact: true });
          if ((await box.getAttribute("aria-checked")) !== "true") {
            saved.push(`${t}: ${await saveSwitch(box)}`);
            mcp.touched.add("toolsetCeiling");
          }
        }
        const summary = clean(
          await D.getByText(/\d+ of \d+ Toolsets/)
            .first()
            .textContent(),
        );
        const after = await policyNow();
        results.settingsChanged.push({
          setting: "MCP switches and ceiling turned on for the API key steps",
          value: saved,
          after,
          at: new Date().toISOString(),
        });
        ctx.save();
        check(
          after.enabled &&
            after.legalApiKeysEnabled &&
            after.businessApiKeysEnabled &&
            after.toolsetCeiling.includes("team") &&
            after.toolsetCeiling.includes("administration") &&
            legalOffWhileMcpOn === 0,
          `after ${JSON.stringify(after)} legal ${legalOffWhileMcpOn}`,
        );
        return `Saved ${q(saved)}. With Enable MCP on and Legal Users API keys still off, Nadia's API keys page had ${legalOffWhileMcpOn} Request a key buttons. The ceiling summary read ${q(summary)}.`;
      },
    );

    await step(
      A,
      [PEOPLE.daniel.name],
      {
        page: "/settings/api-keys",
        action:
          "API keys: the Administrator opens Request a key, reads the Toolsets, and sends his own request (Administration, Read)",
        expected:
          "The form offers the ceiling Toolsets including Team and Administration, with nothing selected; an Administrator's own request approves itself and shows Your key is ready; he revokes it.",
      },
      async () => {
        await openKeysStaff(D);
        const client = kname("administrator client");
        const r = await requestKey(D, client, { toolsets: ["Administration"], scope: "read" });
        const ready = await readyDialog(D);
        const row = await rowText(D, client);
        await decide(D, client, "Revoke");
        const revoked = await rowText(D, client);
        check(
          r.toolsets.includes("Team") &&
            r.toolsets.includes("Administration") &&
            r.checked === 0 &&
            /Active/.test(row) &&
            /Revoked/.test(revoked) &&
            ready.key.length > 20,
          JSON.stringify({ toolsets: r.toolsets, checked: r.checked, row, revoked }),
        );
        return `Request an API key offered Toolsets ${q(r.toolsets)} with ${r.checked} selected. Send request opened ${q(ready.text.slice(0, 260))} at once (key withheld); the row read ${q(row)}; after Revoke ${q(revoked)}.`;
      },
    );

    await step(
      L,
      [PEOPLE.nadia.name],
      {
        page: "/settings/api-keys",
        action:
          "API keys: Request a key; read Client name, Toolsets, Scope and Note (Optional); send a Read request, then Cancel request",
        expected:
          "The form offers only ceiling Toolsets that Legal can use (Team, not Administration), nothing selected, Read and Write, Note (Optional) and the lifetime line; the row reads Pending approval, then Cancelled.",
      },
      async () => {
        await openKeysStaff(N);
        const client = kname("cancelled client");
        const r = await requestKey(N, client, { toolsets: ["Comments"], scope: "read" });
        const pending = await rowText(N, client);
        const cancel = await decide(N, client, "Cancel request");
        const cancelled = await rowText(N, client);
        check(
          /Client name/.test(r.text) &&
            /Nothing is selected for you\./.test(r.text) &&
            r.checked === 0 &&
            /Note \(Optional\)/.test(r.text) &&
            r.toolsets.includes("Team") &&
            !r.toolsets.includes("Administration") &&
            r.radios.some((x) => /^Write\./.test(x)) &&
            r.radios.some((x) => /^Read\./.test(x)),
          JSON.stringify(r),
        );
        check(
          /Pending approval/.test(pending) && /Cancelled/.test(cancelled),
          `${pending} | ${cancelled}`,
        );
        return `Request an API key read ${q(r.text.slice(0, 420))}; Toolsets ${q(r.toolsets)} (Team offered, Administration not, although both are in the ceiling); ${r.checked} selected; scopes ${q(r.radios)}. The row read ${q(pending)}; Cancel request (${q(cancel.slice(0, 120))}) left ${q(cancelled)}.`;
      },
    );

    await step(
      A,
      [PEOPLE.daniel.name, PEOPLE.nadia.name],
      {
        page: "/ (bell); /settings/mcp",
        action:
          "API keys approval: Nadia sends two requests; Daniel selects Approve on one under Your approvals in the bell and Deny with a note on the other under API key requests in Organization > MCP",
        expected:
          "The bell lists the request under Your approvals with Approve and Deny; API key requests has Approve and Deny with Note (Optional); the requester's rows read Active and Denied with the note.",
      },
      async () => {
        const bellClient = kname("bell client");
        const notedClient = kname("noted client");
        await openKeysStaff(N);
        await requestKey(N, bellClient, { toolsets: ["Team", "Contracts"], scope: "read" });
        await requestKey(N, notedClient, {
          toolsets: ["Contracts"],
          scope: "write",
          note: "DOC-032 V-C50 fictional reason for a write key",
        });
        await go(N, "/");
        await go(D, "/");
        await D.getByRole("banner")
          .getByRole("button", { name: /^Notifications/ })
          .click();
        const section = D.locator("section")
          .filter({ has: D.getByRole("heading", { name: "Your approvals" }) })
          .first();
        await section.waitFor({ timeout: 15000 });
        const item = section.getByRole("listitem").filter({ hasText: bellClient }).first();
        await item.waitFor({ timeout: 20000 });
        const itemText = clean(await item.innerText());
        const buttons = (await item.getByRole("button").allInnerTexts()).map(clean);
        await item.getByRole("button", { name: "Approve", exact: true }).click();
        await sleep(1500);
        await D.keyboard.press("Escape");
        await go(D, "/settings/mcp");
        const orgRow = await rowText(D, notedClient);
        const denyText = await decide(
          D,
          notedClient,
          "Deny",
          "DOC-032 V-C50 fictional denial note",
        );
        check(
          buttons.includes("Approve") &&
            buttons.includes("Deny") &&
            /Note \(Optional\)/.test(denyText),
          `buttons ${buttons} deny ${denyText}`,
        );
        return `The bell's Your approvals item read ${q(itemText.slice(0, 180))} with ${q(buttons)}; Daniel selected Approve. Organization > MCP > API key requests row read ${q(orgRow.slice(0, 200))}; its Deny dialog read ${q(denyText.slice(0, 200))}; Daniel entered a note and selected Deny.`;
      },
    );

    await step(
      L,
      [PEOPLE.nadia.name],
      {
        page: "/settings/api-keys",
        action:
          "The key: open API keys after approval; read Your key is ready; Done; reload; use the key at the MCP address and against the browser API; Revoke",
        expected:
          "Your key is ready shows the key once with the x-api-key header line; a reload does not show it again; the Denied row keeps its note; the key works at the MCP address and does not sign in to the browser app; Revoke ends it at once and keeps the row.",
      },
      async () => {
        const bellClient = kname("bell client");
        const notedClient = kname("noted client");
        await N.goto(`${BASE}/settings/api-keys`);
        const ready = await readyDialog(N);
        mcp.key = ready.key;
        const row = await rowText(N, bellClient);
        await N.reload();
        await settle(N, 1500);
        const again = await N.getByRole("dialog", { name: "Your key is ready" }).count();
        const pageHasKey = (await bodyText(N)).includes(ready.key);
        const denied = await rowText(N, notedClient);
        const init = await mcpCall(ready.key, "initialize", {
          protocolVersion: "2025-06-18",
          capabilities: {},
          clientInfo: { name: "doc032-vc50", version: "1" },
        });
        const me = await fetch(`${BASE}/api/v1/me`, { headers: { "x-api-key": ready.key } });
        await decide(N, bellClient, "Revoke");
        const revoked = await rowText(N, bellClient);
        const after = await mcpCall(
          ready.key,
          "tools/call",
          { name: "openlaw_whoami", arguments: {} },
          2,
        );
        mcp.key = null;
        check(
          /Send this key in the x-api-key header\./.test(ready.text) &&
            /will not show this key again/.test(ready.text) &&
            /Active/.test(row) &&
            again === 0 &&
            !pageHasKey &&
            /Denied/.test(denied) &&
            /fictional denial note/.test(denied) &&
            init.status === 200 &&
            me.status === 401 &&
            /Revoked/.test(revoked) &&
            after.status === 401,
          JSON.stringify({
            text: ready.text,
            row,
            again,
            denied,
            init: init.status,
            me: me.status,
            revoked,
            after: after.status,
          }),
        );
        return `API keys opened ${q(ready.text.slice(0, 360))} (key withheld). After Done the row read ${q(row)}; a reload opened no dialog and the page did not contain the key. The denied row read ${q(denied)}. POST ${BASE}/mcp initialize with the key in x-api-key answered ${init.status}; GET /api/v1/me with the same header answered ${me.status}. After Revoke the row read ${q(revoked)} and the next MCP call answered ${after.status}.`;
      },
    );

    await step(
      BU,
      [PEOPLE.felix.name, PEOPLE.daniel.name],
      {
        page: "/portal/settings/api-keys; /settings/mcp",
        action:
          "API keys (Portal): Notification settings > API keys > Request a key; read Toolsets; send a Read request; Daniel approves under API key requests; read Your key is ready; Revoke",
        expected:
          "The form offers only Toolsets a Business User can use: neither Team nor Administration although both are in the ceiling; the row reads Pending approval, then Active after approval with Your key is ready shown once; Revoke sets Revoked.",
      },
      async () => {
        await openKeysPortal();
        const client = kname("portal client");
        const peek = await readDialog(B);
        await closeDialog(B);
        await requestKey(B, client, { toolsets: [peek.toolsets[0]], scope: "read" });
        const pending = await rowText(B, client);
        await go(B, "/portal");
        await go(D, "/settings/mcp");
        await decide(D, client, "Approve");
        await B.goto(`${BASE}/portal/settings/api-keys`);
        const ready = await readyDialog(B);
        const active = await rowText(B, client);
        await decide(B, client, "Revoke");
        const revoked = await rowText(B, client);
        check(
          peek.toolsets.length > 0 &&
            !peek.toolsets.includes("Team") &&
            !peek.toolsets.includes("Administration") &&
            peek.checked === 0 &&
            /Pending approval/.test(pending) &&
            /Active/.test(active) &&
            /Revoked/.test(revoked) &&
            ready.key.length > 20,
          JSON.stringify({ toolsets: peek.toolsets, pending, active, revoked }),
        );
        return `Portal Request an API key offered Toolsets ${q(peek.toolsets)} (${peek.checked} selected; no Team, no Administration). The row read ${q(pending)}. After Daniel's Approve in API key requests, the Portal opened ${q(ready.text.slice(0, 220))} (key withheld); then ${q(active)}; after Revoke ${q(revoked)}.`;
      },
    );

    await step(
      L,
      [PEOPLE.nadia.name, PEOPLE.daniel.name],
      {
        page: "/settings/api-keys",
        action:
          "API keys: open Request a key while the organization is Read-only (set for this check, then put back)",
        expected: "Write is absent while Read-only is on; with it off again Write returns.",
      },
      async () => {
        must(await admin.api("PATCH", "/mcp-settings", { readOnly: true }), "read-only on");
        mcp.touched.add("readOnly");
        let radios;
        try {
          await openKeysStaff(N);
          radios = (await readDialog(N)).radios;
          await closeDialog(N);
        } finally {
          must(
            await admin.api("PATCH", "/mcp-settings", { readOnly: mcp.original.readOnly }),
            "read-only back",
          );
        }
        results.settingsChanged.push({
          setting: "MCP Read-only",
          before: mcp.original.readOnly,
          during: true,
          after: mcp.original.readOnly,
          at: new Date().toISOString(),
        });
        await openKeysStaff(N);
        const after = (await readDialog(N)).radios;
        await closeDialog(N);
        check(
          radios.length === 1 && /^Read\./.test(radios[0]) && after.length === 2,
          `${radios} | ${after}`,
        );
        return `With Read-only on, Scope offered ${q(radios)}; with it back off, ${q(after)}. Both dialogs were cancelled.`;
      },
    );

    await step(
      A,
      [PEOPLE.daniel.name],
      {
        page: "/settings/mcp",
        action: "Lifetime: enter 400 in API key lifetime (days), then the original value",
        expected:
          "400 is refused with the 1 to 365 message and the saved lifetime does not change.",
      },
      async () => {
        await go(D, "/settings/mcp");
        const box = D.getByRole("spinbutton", { name: "API key lifetime (days)" });
        await box.fill("400");
        await box.press("Tab");
        await sleep(1500);
        const msg = clean(
          await D.getByText(/API key lifetime must be a whole number from 1 to 365 days\./)
            .first()
            .textContent()
            .catch(() => ""),
        );
        const saved = (await policyNow()).apiKeyLifetimeDays;
        await box.fill(String(mcp.original.apiKeyLifetimeDays));
        await box.press("Tab");
        await sleep(1500);
        const final = (await policyNow()).apiKeyLifetimeDays;
        check(
          msg &&
            saved === mcp.original.apiKeyLifetimeDays &&
            final === mcp.original.apiKeyLifetimeDays,
          `msg ${msg} saved ${saved} final ${final}`,
        );
        return `Entering 400 showed ${q(msg)}; the saved lifetime stayed ${saved}. Entering ${mcp.original.apiKeyLifetimeDays} again left ${final}.`;
      },
    );

    await step(
      BU,
      [PEOPLE.felix.name, PEOPLE.nadia.name, PEOPLE.daniel.name],
      {
        page: "/portal/settings/api-keys; /settings/api-keys",
        action:
          "Request a key needs a Toolset for your account type: with the ceiling set to Team and Administration only (for this check, then put back), reload Felix's and Nadia's API keys pages",
        expected:
          "Felix sees no Request a key and the message that no Toolsets are available for his account; Nadia still sees Request a key and the form offers Team only.",
      },
      async () => {
        await openKeysPortal();
        await openKeysStaff(N);
        const before = await policyNow();
        let felixText;
        let felixButton;
        let nadiaToolsets;
        const t0 = Date.now();
        must(
          await admin.api("PATCH", "/mcp-settings", { toolsetCeiling: ["team", "administration"] }),
          "narrow ceiling",
        );
        mcp.touched.add("toolsetCeiling");
        try {
          await B.reload();
          await settle(B, 500);
          felixButton = await B.getByRole("button", { name: "Request a key" }).count();
          felixText = await mainText(B);
          await N.reload();
          await settle(N, 500);
          nadiaToolsets = (await readDialog(N)).toolsets;
          await closeDialog(N);
        } finally {
          must(
            await admin.api("PATCH", "/mcp-settings", { toolsetCeiling: before.toolsetCeiling }),
            "ceiling back",
          );
        }
        const seconds = ((Date.now() - t0) / 1000).toFixed(1);
        results.settingsChanged.push({
          setting: "MCP Toolset ceiling narrowed to Team and Administration",
          before: before.toolsetCeiling,
          during: ["team", "administration"],
          after: (await policyNow()).toolsetCeiling,
          seconds: Number(seconds),
          at: new Date().toISOString(),
        });
        await B.reload();
        await settle(B);
        const felixAfter = await B.getByRole("button", { name: "Request a key" }).count();
        check(
          felixButton === 0 &&
            /No Toolsets are available for your account\. Ask an Administrator to enable a Toolset you can use\./.test(
              felixText,
            ) &&
            nadiaToolsets.join("|") === "Team" &&
            felixAfter === 1,
          JSON.stringify({
            felixButton,
            felixText: felixText.slice(0, 200),
            nadiaToolsets,
            felixAfter,
          }),
        );
        return `For ${seconds} s the ceiling held Team and Administration only. Felix's page had ${felixButton} Request a key buttons and read ${q(felixText.match(/No Toolsets[^.]*\.[^.]*\./)?.[0])}; Nadia's form offered ${q(nadiaToolsets)}. With the ceiling put back, Felix's page showed Request a key again (${felixAfter}).`;
      },
    );
  } finally {
    // Put the shared lab back.
    if (mcp.original) {
      const now = must(await admin.api("GET", "/mcp-settings"), "mcp settings");
      const back = {};
      for (const k of mcp.touched)
        if (JSON.stringify(now[k]) !== JSON.stringify(mcp.original[k])) back[k] = mcp.original[k];
      if (Object.keys(back).length)
        must(await admin.api("PATCH", "/mcp-settings", back), "restore mcp");
      const final = must(await admin.api("GET", "/mcp-settings"), "mcp settings");
      results.settingsChanged.push({
        setting: "MCP policy restored",
        restored: back,
        final: Object.fromEntries(Object.keys(mcp.original).map((k) => [k, final[k]])),
        matchesBefore: Object.keys(mcp.original).every(
          (k) => JSON.stringify(final[k]) === JSON.stringify(mcp.original[k]),
        ),
        at: new Date().toISOString(),
      });
    }
    if (added.docType) {
      const r = await admin.api(
        "POST",
        `/documents/types/contract/${added.docType.id}/archive`,
        {},
      );
      results.settingsChanged.push({
        setting: "Contract Document type archived",
        value: added.docType.name,
        status: r.status,
        at: new Date().toISOString(),
      });
    }
    ctx.save();
  }

  // ================================================================ Operator
  const O = "operator";
  const bundled = articleText(ARTICLE);
  await step(
    O,
    ["signed-out reader"],
    {
      page: "/documentation/reference",
      action: "Deployment operator: read the reference signed out in the documentation reader",
      expected:
        "The reader opens without an app session and shows the Deployment operator row and MAX_UPLOAD_MB.",
    },
    async () => {
      const { chromium } = await import(
        path.join(root, "node_modules/.pnpm/playwright@1.63.0/node_modules/playwright/index.mjs")
      );
      const browser = await chromium.launch({ headless: true });
      try {
        const page = await (await browser.newContext()).newPage();
        const apiCalls = [];
        page.on("request", (r) => {
          const p = new URL(r.url()).pathname;
          if (p.startsWith("/api/")) apiCalls.push(p);
        });
        await go(page, "/documentation/reference");
        const heading = await h1(page);
        const text = await bodyText(page);
        const hasSeven = text.includes("Partially signed");
        await go(page, "/help");
        const help = new URL(page.url()).pathname;
        check(
          heading === "Look up terms, permissions, and file behavior" &&
            /Deployment operator/.test(text) &&
            text.includes("MAX_UPLOAD_MB") &&
            help.startsWith("/documentation"),
          `h ${heading} help ${help}`,
        );
        return `Signed out, /documentation/reference showed ${q(heading)} with the Deployment operator row and MAX_UPLOAD_MB. The bundled (4ca41822) bytes ${hasSeven ? "include" : "do not include"} Partially signed; the reviewed worktree bytes (sha256 ${sha(bundled)}) are newer than the lab bundle. App API requests while reading: ${q([...new Set(apiCalls)])}. Signed-out /help landed on ${help}.`;
      } finally {
        await browser.close();
      }
    },
  );

  await step(
    O,
    ["deployment operator (shell)"],
    {
      method: "browser-walkthrough",
      page: "docker exec / docker inspect (read only)",
      action:
        "Deployment operator: check the reference's operator facts against the lab containers (read only)",
      expected:
        "No operator account role exists; MAX_UPLOAD_MB is an environment setting whose empty value means the 100 MiB default; the filename limit is 255; the MCP address is the app address plus /mcp; files and database live in operator-managed volumes.",
    },
    async () => {
      const exec = (svc, cmd) =>
        execFileSync("docker", ["exec", `${project}-${svc}-1`, "sh", "-c", cmd], {
          encoding: "utf8",
        }).trim();
      const envMax = exec("app", 'printf "[%s]" "${MAX_UPLOAD_MB-unset}"');
      const baseUrl = exec("app", 'printf "%s" "$BASE_URL"');
      const code = exec(
        "app",
        "grep -n 'DEFAULT_MAX_UPLOAD_MB = \\|MEGABYTE = \\|MAX_FILENAME_LENGTH = ' /app/apps/api/dist/lib/uploads.js",
      );
      const roles = sql(
        project,
        "select pg_get_constraintdef(oid) from pg_constraint where conrelid='users'::regclass and contype='c' and pg_get_constraintdef(oid) like '%role%'",
      );
      const mounts = (c) =>
        execFileSync(
          "docker",
          ["inspect", "--format", "{{range .Mounts}}{{.Type}}:{{.Destination}} {{end}}", c],
          { encoding: "utf8" },
        ).trim();
      const appMounts = mounts(`${project}-app-1`);
      const pgMounts = mounts(`${project}-postgres-1`);
      const probe = await fetch(`${BASE}/mcp`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          accept: "application/json, text/event-stream",
        },
        body: "{}",
      });
      check(
        envMax === "[]" &&
          /DEFAULT_MAX_UPLOAD_MB = 100/.test(code) &&
          /MAX_FILENAME_LENGTH = 255/.test(code),
        `env ${envMax} code ${code}`,
      );
      check(
        /administrator.*legal_team_member.*business_user/.test(roles) && !/operator/.test(roles),
        `roles ${roles}`,
      );
      check(
        baseUrl === BASE && [401, 404].includes(probe.status),
        `base ${baseUrl} ${probe.status}`,
      );
      return `In the app container MAX_UPLOAD_MB is ${envMax} (set but empty) and the built uploads module reads ${q(code.replace(/\n/g, " | "))}: an empty value falls back to 100 MiB (104,857,600 bytes). The users table allows only ${q(roles)}; there is no operator role. BASE_URL is ${baseUrl}, so the MCP address is ${baseUrl}/mcp (an unauthenticated POST answered ${probe.status}). App mounts: ${q(appMounts)}; database mounts: ${q(pgMounts)}. Read only; nothing was changed.`;
    },
  );

  await step(
    O,
    ["signed-out reader"],
    {
      page: "/documentation/*",
      action: "Links in the reviewed reference bytes resolve in the documentation reader",
      expected:
        "Every internal link and anchor in the reviewed bytes opens an article and heading in the bundled edition, or the gap is named.",
    },
    async () => {
      const links = [
        ...new Set(
          [...bundled.matchAll(/\]\(([a-z0-9-]+)\.md(#[a-z0-9-]+)?\)/g)].map(
            (m) => `${m[1]}${m[2] ?? ""}`,
          ),
        ),
      ];
      const { chromium } = await import(
        path.join(root, "node_modules/.pnpm/playwright@1.63.0/node_modules/playwright/index.mjs")
      );
      const browser = await chromium.launch({ headless: true });
      const bad = [];
      try {
        const page = await (await browser.newContext()).newPage();
        for (const link of links) {
          const [target, anchor] = link.split("#");
          await go(page, `/documentation/${target}`);
          const heading = await h1(page).catch(() => "");
          if (!heading || heading === "Article unavailable") bad.push(`${link}: ${heading}`);
          else if (anchor && !(await page.locator(`[id="${anchor}"]`).count()))
            bad.push(`${link}: no anchor in the bundled ${target}`);
        }
      } finally {
        await browser.close();
      }
      check(bad.length === 0, `unresolved ${bad}`);
      return `${links.length} internal targets (${q(links)}); all opened in the bundled reader.`;
    },
  );
}
