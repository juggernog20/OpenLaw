// DOC-030 contracts-c: electronic-signing.md (V-C17-electronic), both roles.
// Ported from DOC-029/rewalk/signing/walkthrough-rw.mjs and rewritten for the 067c1646 texts:
// the send dialog's Active note, the note under a live row that names the update mode, and the
// note shown when an Administrator disables the connector while an Envelope is out.
//
// Lab: the owned lab "c3sign" (lab.mjs, app commit 067c1646) with the local DocuSign protocol
// stand-in from signing/ applied by signing/up.sh. The shared lab work2 is not used for this
// article, because the stand-in needs DOCUSIGN_BASE_URL and SIGNING_STANDIN on the app and worker.
// The stand-in has no published port; the script reaches it on the lab's backend network address.
// The RSA key and Connect secret are generated in memory for each run and never written.
import { execFileSync } from "node:child_process";
import { createHmac, generateKeyPairSync, randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import {
  PEOPLE,
  articleText,
  expectThat,
  pdf,
  q,
  sha,
  sleep,
  until,
} from "./lib.mjs";

const ARTICLE = "electronic-signing";
const SCENARIO = "V-C17-electronic";

export default async function signing(ctx) {
  const { BASE, lab, step: rawStep, sessions, STAMP, PHASE } = ctx;
  const STANDIN_CONTAINER = `${lab.project}-signing-standin-1`;
  const STANDIN_IP = execFileSync("docker", [
    "--context",
    "default",
    "inspect",
    "-f",
    "{{range .NetworkSettings.Networks}}{{.IPAddress}} {{end}}",
    STANDIN_CONTAINER,
  ])
    .toString()
    .trim()
    .split(/\s+/)[0];
  const STANDIN = `http://${STANDIN_IP}:8129`;
  const step = (role, actors, page, action, expected, fn, extra = {}) =>
    rawStep({ article: ARTICLE, scenario: SCENARIO, role, actors, page, action, expected, ...extra }, fn);

  async function standin(control, body) {
    const res = await fetch(`${STANDIN}/__control/${control}`, {
      method: body === undefined ? "GET" : "POST",
      headers: { "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return res.json();
  }
  let connectSecret = null;
  async function deliver(providerEnvelopeId, status, extra = {}) {
    const body = JSON.stringify({
      event: `envelope-${status}`,
      data: {
        envelopeId: providerEnvelopeId,
        envelopeSummary: {
          status,
          ...(status === "declined" ? { declinedReason: extra.reason } : {}),
          ...(extra.completedAt ? { completedDateTime: extra.completedAt } : {}),
        },
      },
    });
    const signature = createHmac("sha256", connectSecret ?? randomBytes(16).toString("hex"))
      .update(body)
      .digest("base64");
    const res = await fetch(`${BASE}/api/v1/signing/docusign/webhook`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-docusign-signature-1": signature },
      body,
    });
    return res.status;
  }

  const api = (who, method, url, body, multipart) =>
    who.page.request
      .fetch(`${BASE}/api/v1${url}`, {
        method,
        data: body,
        multipart,
        headers: { origin: BASE },
        failOnStatusCode: false,
      })
      .then(async (res) => {
        let json = null;
        try {
          json = await res.json();
        } catch {}
        return { status: res.status(), json };
      });
  const signingState = async (who, number) =>
    (await api(who, "GET", `/contracts/${number}/envelopes`)).json;
  const paper = async (who, number) =>
    (await api(who, "GET", `/contracts/${number}/documents?includeArchived=true`)).json.documents;
  const contractOf = async (who, number) =>
    (await api(who, "GET", `/contracts/${number}`)).json.contract;
  const connector = async (who) =>
    (await api(who, "GET", "/signing-connectors/docusign")).json.connector;

  const SIG_TAB = {
    documentId: "1",
    anchorString: "/sig/",
    anchorUnits: "pixels",
    anchorXOffset: "0",
    anchorYOffset: "0",
    anchorIgnoreIfNotPresent: "true",
  };
  function checkSigTabs(provider) {
    for (const s of provider.signers) {
      const tabs = s.tabs?.signHereTabs ?? [];
      expectThat(
        tabs.length === 1 && JSON.stringify(tabs[0]) === JSON.stringify(SIG_TAB),
        `Signer ${s.name} tabs ${JSON.stringify(s.tabs)}`,
      );
    }
    return `each of ${provider.signers.length} Signers carried one signHereTabs entry anchored on /sig/`;
  }
  async function upload(who, number, name, bytes, kind, note) {
    const r = await api(who, "POST", `/contracts/${number}/documents`, undefined, {
      kind,
      note,
      file: { name, mimeType: "application/pdf", buffer: bytes },
    });
    expectThat(r.status === 201, `upload ${name} answered ${r.status}`);
    return r.json.document ?? r.json;
  }
  async function addVersion(who, documentId, name, bytes, kind, note) {
    const r = await api(who, "POST", `/documents/${documentId}/versions`, undefined, {
      kind,
      note,
      file: { name, mimeType: "application/pdf", buffer: bytes },
    });
    expectThat(r.status === 201, `version ${name} answered ${r.status}`);
  }

  const card = (page) => page.getByRole("region", { name: "Approvals & signing" });
  const sendButton = (page) => card(page).getByRole("button", { name: "Send for signature" });
  const envelopeRows = (page) =>
    card(page).locator('table[aria-labelledby="contract-signing-heading"] tbody tr');
  async function openApprovals(page, number) {
    await page.goto(`${BASE}/contracts/${number}`);
    await page
      .getByRole("navigation", { name: "Contract sections" })
      .getByRole("link", { name: "Approvals", exact: true })
      .click();
    await page.waitForURL(new RegExp(`/contracts/${number}/approvals$`));
    await card(page).waitFor({ timeout: 20000 });
    await page.waitForLoadState("networkidle").catch(() => {});
  }
  async function rowTexts(page) {
    const rows = envelopeRows(page);
    const n = await rows.count();
    const out = [];
    for (let i = 0; i < n; i++)
      out.push((await rows.nth(i).innerText()).replace(/\s+/g, " ").trim());
    return out;
  }
  const NOTE = {
    polling:
      "Signed, declined, and voided status is checked by polling, about every 15–20 minutes. The executed file is filed automatically. The Contract advances to Active only if it is still in the Signature Stage.",
    webhook:
      "Signed, declined, and voided status arrives by webhook. The executed file is filed automatically. The Contract advances to Active only if it is still in the Signature Stage.",
    disabled:
      "Automatic status updates are unavailable while the connector is disabled. The executed file is filed automatically. The Contract advances to Active only if it is still in the Signature Stage.",
  };
  const SEND_NOTE =
    "When everyone signs, the executed file lands on this Contract. The Contract advances to Active only if it is still in the Signature Stage.";
  async function liveNote(page) {
    const texts = await card(page).locator("p").allInnerTexts();
    return texts.map((t) => t.replace(/\s+/g, " ").trim()).find((t) => /status (is checked|arrives)|Automatic status updates/.test(t)) ?? null;
  }
  async function moveStatus(page, number, statusName) {
    await page.goto(`${BASE}/contracts/${number}`);
    const control = page.getByRole("button", { name: /move contract$/ });
    await control.waitFor({ timeout: 20000 });
    const answered = page.waitForResponse(
      (r) => r.url().endsWith(`/api/v1/contracts/${number}`) && r.request().method() === "PATCH",
    );
    await control.click();
    await page
      .getByRole("menuitemradio")
      .filter({ hasText: new RegExp(`^${statusName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`) })
      .first()
      .click();
    const res = await answered;
    expectThat(res.status() === 200, `status move answered ${res.status()}`);
  }
  async function openSendDialog(page) {
    await sendButton(page).click();
    const dialog = page.getByRole("dialog", { name: "Send for signature" });
    await dialog.waitFor();
    return dialog;
  }
  async function fillSigners(dialog, signers) {
    for (let i = 0; i < signers.length; i++) {
      if (i > 0) await dialog.getByRole("button", { name: "Add signer" }).click();
      await dialog.getByLabel(`Signer ${i + 1} name`).fill(signers[i].name);
      await dialog.getByLabel(`Signer ${i + 1} email`).fill(signers[i].email);
    }
  }
  async function sendEnvelope(page, number, { versionLabel, signers, subject }) {
    const dialog = await openSendDialog(page);
    if (versionLabel) await dialog.getByLabel("Version").selectOption({ label: versionLabel });
    await fillSigners(dialog, signers);
    if (subject) await dialog.getByLabel("Subject", { exact: true }).fill(subject);
    const sent = page.waitForResponse(
      (r) =>
        r.url().endsWith(`/api/v1/contracts/${number}/envelopes`) && r.request().method() === "POST",
    );
    await dialog.getByRole("button", { name: "Send envelope" }).click();
    const res = await sent;
    return { dialog, status: res.status() };
  }
  const signersFor = (role, round) => [
    { name: `DOC-030 Signer One ${round}`, email: `signer.one.${role}.${round}.${STAMP}@counterparty.example` },
    { name: `DOC-030 Signer Two ${round}`, email: `signer.two.${role}.${round}.${STAMP}@counterparty.example` },
  ];
  async function newestProviderEnvelope(before) {
    const state = await standin("state");
    expectThat(
      state.envelopes.length === before + 1,
      `provider holds ${state.envelopes.length} envelopes, expected ${before + 1}`,
    );
    return state.envelopes[state.envelopes.length - 1];
  }
  async function openConnector(page) {
    await page.goto(`${BASE}/settings/integrations/e-signature`);
    const docusign = page.getByRole("button", { name: "DocuSign", exact: true });
    await docusign.waitFor({ timeout: 20000 });
    if ((await docusign.getAttribute("aria-expanded")) === "false") await docusign.click();
  }
  async function setEnabled(daniel, on) {
    await openConnector(daniel.page);
    const sw = daniel.page.getByRole("switch", { name: "Send for signature from records" });
    if ((await sw.getAttribute("aria-checked")) !== String(on)) await sw.click();
    await until(async () => (await connector(daniel)).enabled === on, `connector enabled=${on}`);
  }

  // ---------------------------------------------------------------- main phase (Webhook mode)
  async function main() {
    const daniel = await sessions.password(PEOPLE.daniel);
    const nadia = await sessions.password(PEOPLE.nadia);
    const priya = await sessions.password(PEOPLE.priya);
    const marcus = await sessions.password(PEOPLE.marcus);
    const users = (await api(daniel, "GET", "/users")).json.users;
    const idOf = (person) => users.find((u) => u.email === person.email).id;
    const options = (await api(daniel, "GET", "/contracts/options")).json;
    const typeId = options.contractTypes.find((t) => t.displayName === "NDA").id;
    const flows = [
      { role: "legal_team_member", sender: nadia, owner: priya, unrelated: marcus, voider: daniel, voiderWhy: "Administrator who is neither sender nor Legal Owner", rival: priya },
      { role: "administrator", sender: daniel, owner: nadia, unrelated: priya, voider: nadia, voiderWhy: "Legal Owner", rival: nadia },
    ];

    await step("administrator", PEOPLE.daniel.name, "/settings/integrations/e-signature (API read)", "Read the lab's starting Signing connector", "The lab starts with no Signing connector.", async () => {
      const c = await connector(daniel);
      expectThat(!c.configured, "a connector is already configured");
      return `Connector configured=${c.configured}, enabled=${c.enabled}, stored updateMode default ${c.updateMode}`;
    });

    for (const flow of flows) {
      const title = `DOC-030 contracts-c electronic-signing ${flow.role} ${STAMP}`;
      const created = await api(flow.sender, "POST", "/contracts", { title, contractTypeId: typeId, managerId: idOf(flow.owner.person) });
      expectThat(created.status === 201, `create answered ${created.status}`);
      flow.number = created.json.contract.number;
      flow.title = title;
      flow.v1 = pdf(`DOC-030 ${flow.role} primary version 1`, ["Signature of Signer One: /sig/", "Signature of Signer Two: /sig/"]);
      flow.v2 = pdf(`DOC-030 ${flow.role} primary version 2`);
      flow.v1Name = `doc030-primary-${flow.role}.pdf`;
      flow.v2Name = `doc030-primary-v2-${flow.role}.pdf`;
      flow.supportName = `doc030-supporting-${flow.role}.pdf`;
      const noPaper = await api(flow.sender, "POST", "/contracts", { title: `DOC-030 contracts-c electronic-signing ${flow.role} no paper ${STAMP}`, contractTypeId: typeId });
      flow.noPaperNumber = noPaper.json.contract.number;
      const team = await api(flow.sender, "POST", `/contracts/${flow.number}/team`, { userId: idOf(PEOPLE.ravi) });
      flow.raviOnTeam = team.status;
    }

    for (const flow of flows) {
      await step(flow.role, flow.sender.person.name, `/contracts/${flow.number}/approvals`, "If signing is unavailable: open Approvals with no connector configured, before and after a primary Document exists", "Send for signature is absent with no connector, with or without a primary Document.", async () => {
        await openApprovals(flow.sender.page, flow.number);
        const before = await sendButton(flow.sender.page).count();
        const doc = await upload(flow.sender, flow.number, flow.v1Name, flow.v1, "draft_ours", "DOC-030 first round");
        await addVersion(flow.sender, doc.id, flow.v2Name, flow.v2, "redline_theirs", "DOC-030 agreed round");
        await upload(flow.sender, flow.number, flow.supportName, pdf(`DOC-030 ${flow.role} supporting`), "draft_ours", "DOC-030 supporting paper");
        await openApprovals(flow.sender.page, flow.number);
        const after = await sendButton(flow.sender.page).count();
        const s = await signingState(flow.sender, flow.number);
        expectThat(before === 0 && after === 0, `Send for signature count ${before}/${after}`);
        expectThat(!s.signingConfigured && s.primaryDocument, "unexpected signing state");
        flow.documentId = s.primaryDocument.id;
        return `C-${flow.number}: no Send for signature without paper; after a primary Document (2 Versions) and a supporting Document it is still absent; signingConfigured=${s.signingConfigured}, primary ${q(s.primaryDocument.title)}`;
      });
    }

    const { privateKey } = generateKeyPairSync("rsa", {
      modulusLength: 2048,
      publicKeyEncoding: { type: "spki", format: "pem" },
      privateKeyEncoding: { type: "pkcs8", format: "pem" },
    });
    connectSecret = randomBytes(24).toString("base64url");
    await step("administrator", PEOPLE.daniel.name, "/settings/integrations/e-signature", "Setup (configure-signing owns these steps): save and enable a Webhook-mode DocuSign connector that points at the stand-in, then Test connection", "The connector saves, is enabled, and Test connection reaches the stand-in.", async () => {
      const page = daniel.page;
      await openConnector(page);
      await page.getByLabel("Environment").selectOption("demo");
      const defaultMode = await page.getByLabel("Signing updates").inputValue();
      await page.getByLabel("Signing updates").selectOption("webhook");
      await page.getByLabel("Integration key").fill("doc030-standin-integration-key");
      await page.getByLabel("User ID").fill("doc030-standin-user");
      await page.getByLabel("RSA private key").fill(privateKey);
      await page.getByLabel("Connect HMAC secret").fill(connectSecret);
      const saved = page.waitForResponse((r) => r.url().endsWith("/api/v1/signing-connectors/docusign") && r.request().method() === "PUT");
      await page.getByRole("button", { name: "Save connector" }).click();
      expectThat((await saved).status() === 200, "save refused");
      let c = await connector(daniel);
      if (!c.enabled) await setEnabled(daniel, true);
      await openConnector(page);
      await page.getByRole("button", { name: "Test connection" }).click();
      await page.getByText("Connected to DOC-030 signing stand-in.").waitFor({ timeout: 20000 });
      c = await connector(daniel);
      return `Signing updates showed ${q(defaultMode)} before the change (the default); saved Demo/Webhook, enabled=${c.enabled}, updateMode=${c.updateMode}; Test connection said "Connected to DOC-030 signing stand-in."`;
    });

    for (const flow of flows) {
      await step(flow.role, flow.sender.person.name, `/contracts/${flow.noPaperNumber}/approvals, /contracts/${flow.number}/approvals`, "With the connector enabled, open Approvals on a Contract with no primary Document and on one with a primary Document", "Send for signature is absent with no primary Document and shown with one.", async () => {
        await openApprovals(flow.sender.page, flow.noPaperNumber);
        const noPaper = await sendButton(flow.sender.page).count();
        await openApprovals(flow.sender.page, flow.number);
        const withPaper = await sendButton(flow.sender.page).count();
        expectThat(noPaper === 0 && withPaper === 1, `counts ${noPaper}/${withPaper}`);
        return `C-${flow.noPaperNumber} (no paper): Send for signature absent; C-${flow.number} (primary Document): Send for signature shown`;
      });
    }

    await step("administrator", PEOPLE.daniel.name, "/settings/integrations/e-signature", "If signing is unavailable: turn Send for signature from records off, read both Contracts' Approvals, then turn it on again", "With the connector disabled, Send for signature is absent on both Contracts; enabled again, it returns.", async () => {
      await setEnabled(daniel, false);
      const seen = [];
      for (const flow of flows) {
        await openApprovals(flow.sender.page, flow.number);
        seen.push(`${flow.role} C-${flow.number} disabled: ${await sendButton(flow.sender.page).count()} Send`);
      }
      await setEnabled(daniel, true);
      for (const flow of flows) {
        await openApprovals(flow.sender.page, flow.number);
        seen.push(`${flow.role} C-${flow.number} enabled: ${await sendButton(flow.sender.page).count()} Send`);
      }
      expectThat(seen.filter((s) => s.includes("disabled: 0")).length === 2 && seen.filter((s) => s.includes("enabled: 1")).length === 2, seen.join("; "));
      return seen.join("; ");
    });

    for (const flow of flows) {
      const { role, sender, number } = flow;
      const page = sender.page;
      const v1Label = `Version 1 — ${flow.v1Name}`;
      const v2Current = `Version 2 — ${flow.v2Name} (current)`;

      await step(role, sender.person.name, `/contracts/${number}/documents (API download)`, "Before you start (/sig/): the paper to send carries /sig/ marks before its Document Version is uploaded", "The guide paragraph is present, and Version 1 downloads with its two /sig/ marks.", async () => {
        const text = articleText(ARTICLE);
        expectThat(text.includes("Type `/sig/` where each signature goes.") && text.includes("If the paper has no `/sig/`, DocuSign puts no Sign Here field"), "paragraph missing");
        const docs = await paper(sender, number);
        const primary = docs.find((d) => d.id === flow.documentId);
        const v1 = [...primary.versions].sort((a, b) => a.versionNumber - b.versionNumber)[0];
        const dl = await page.request.get(`${BASE}/api/v1/documents/${flow.documentId}/versions/${v1.id}/download`);
        const bytes = await dl.body();
        const marks = (bytes.toString("latin1").match(/\/sig\//g) ?? []).length;
        expectThat(dl.status() === 200 && sha(bytes) === sha(flow.v1) && marks === 2, `download ${dl.status()}, marks ${marks}`);
        return `Version 1 (${v1.originalFilename}) was uploaded with two /sig/ marks; its download answered 200 with the same bytes and ${marks} marks. Version 2 has none. The stand-in cannot render placement or white text.`;
      });

      await step(role, sender.person.name, `/contracts/${number}`, "Before you start: move the Contract to the Signature Status Out for signature", "The Contract is in the Signature Stage.", async () => {
        await moveStatus(page, number, "Out for signature");
        const c = await contractOf(sender, number);
        expectThat(c.stage === "signature", `stage ${c.stage}`);
        return `Status ${q(c.statusName)} (stage ${c.stage})`;
      });

      await step(role, sender.person.name, `/contracts/${number}/approvals`, "Send the Envelope steps 1-3 and 5: Approvals > Send for signature on Approvals & signing; read the send dialog; Version; empty and duplicate Signers; Add signer and Remove signer; Cancel", "The dialog says the Contract advances to Active only if it is still in the Signature Stage; Version lists only the primary Document's Versions with the current one selected; empty and duplicate Signers are refused; Cancel sends nothing.", async () => {
        const providerBefore = await standin("state");
        await openApprovals(page, number);
        const tab = await page.getByRole("navigation", { name: "Contract sections" }).getByRole("link", { name: "Approvals", exact: true }).count();
        const heading = (await card(page).getByRole("heading").first().innerText()).trim();
        const dialog = await openSendDialog(page);
        const dialogText = (await dialog.innerText()).replace(/\s+/g, " ");
        const optionTexts = (await dialog.getByLabel("Version").locator("option").allInnerTexts()).map((t) => t.trim());
        const selected = await dialog.getByLabel("Version").evaluate((el) => el.options[el.selectedIndex].text);
        const versionHelp = await dialog.getByText("Only the primary document goes out. Attachments are not sent.").count();
        const signersHelp = await dialog.getByText("Everyone you name is asked at once. They sign in any order.").count();
        const subjectHelp = await dialog.getByText("Signers see this on the invitation. Left blank, it names this contract.").count();
        expectThat(dialogText.includes(SEND_NOTE), `send note missing: ${dialogText.slice(0, 300)}`);
        expectThat(optionTexts.length === 2 && optionTexts[0] === v2Current && optionTexts[1] === v1Label, `options ${optionTexts.join(" | ")}`);
        expectThat(selected === v2Current, `selected ${selected}`);
        expectThat(versionHelp === 1 && signersHelp === 1, `help ${versionHelp}/${signersHelp}`);
        await dialog.getByRole("button", { name: "Send envelope" }).click();
        const emptyAlert = (await dialog.getByRole("alert").innerText()).trim();
        expectThat(emptyAlert === "Give every signer a name and an email address.", `empty alert ${emptyAlert}`);
        await fillSigners(dialog, [
          { name: "DOC-030 Duplicate One", email: `dup.${role}.${STAMP}@counterparty.example` },
          { name: "DOC-030 Duplicate Two", email: `dup.${role}.${STAMP}@counterparty.example` },
          { name: "DOC-030 Unwanted Row", email: `unwanted.${role}.${STAMP}@counterparty.example` },
        ]);
        await dialog.getByRole("button", { name: "Remove signer 3" }).click();
        const rowsAfterRemove = await dialog.getByLabel(/^Signer \d+ name$/).count();
        await dialog.getByRole("button", { name: "Send envelope" }).click();
        await until(async () => (await dialog.getByRole("alert").count()) > 0 && (await dialog.getByRole("alert").innerText()).trim() !== emptyAlert, "no duplicate alert");
        const dupAlert = (await dialog.getByRole("alert").innerText()).trim();
        expectThat(dupAlert === "Each signer needs their own email address.", `duplicate alert ${dupAlert}`);
        await dialog.getByRole("button", { name: "Cancel" }).click();
        await dialog.waitFor({ state: "hidden" });
        const s = await signingState(sender, number);
        const providerAfter = await standin("state");
        expectThat(rowsAfterRemove === 2, `rows after remove ${rowsAfterRemove}`);
        expectThat(s.envelopes.length === 0, "an Envelope was recorded");
        expectThat(providerAfter.envelopes.length === providerBefore.envelopes.length, "the provider holds a new envelope");
        return `Tab Approvals (${tab}); card heading ${q(heading)}; dialog note ${q(SEND_NOTE)}; Version options ${q(optionTexts)}, selected ${q(selected)}; help texts ${versionHelp}/${signersHelp}/${subjectHelp}; empty Signers: ${q(emptyAlert)}; Remove signer 3 left ${rowsAfterRemove} rows; duplicate address: ${q(dupAlert)}; Cancel closed the dialog, 0 Envelopes in the app and ${providerAfter.envelopes.length} (unchanged) at the provider`;
      });

      await step(role, sender.person.name, `/contracts/${number}/approvals`, "If sending fails: send during a provider outage, read the error, reload the Envelope list, then send Version 1 with a blank Subject (Send the Envelope steps 2-5)", "The outage shows an error and records no round; the retry shows an Out for signature row with Version, Signers and sent time; the provider receives only the primary PDF with subject C-<number> <title>; the Status does not move; the note under the live row names Webhook mode.", async () => {
        const before = (await standin("state")).envelopes.length;
        await standin("faults", { outage: true });
        await openApprovals(page, number);
        const attempt = await sendEnvelope(page, number, { versionLabel: v1Label, signers: signersFor(role, "r1") });
        await until(async () => (await attempt.dialog.getByRole("alert").count()) > 0, "no outage alert");
        const outageAlert = (await attempt.dialog.getByRole("alert").innerText()).trim();
        const duringOutage = (await signingState(sender, number)).envelopes.length;
        await attempt.dialog.getByRole("button", { name: "Cancel" }).click();
        await standin("faults", { outage: false });
        await openApprovals(page, number);
        const rowsAfterReload = await envelopeRows(page).count();
        expectThat(duringOutage === 0 && rowsAfterReload === 0, "a round exists after the outage");
        const retry = await sendEnvelope(page, number, { versionLabel: v1Label, signers: signersFor(role, "r1") });
        expectThat(retry.status === 201, `retry answered ${retry.status}`);
        await retry.dialog.waitFor({ state: "hidden" });
        await openApprovals(page, number);
        const rows = await rowTexts(page);
        const note = await liveNote(page);
        const provider = await newestProviderEnvelope(before);
        const c = await contractOf(sender, number);
        expectThat(rows.length === 1 && rows[0].includes("Out for signature") && rows[0].includes("Version 1") && rows[0].includes(`by ${sender.person.name}`), `row ${rows[0]}`);
        for (const signer of signersFor(role, "r1")) expectThat(rows[0].includes(signer.name) && rows[0].includes(signer.email), "signer missing from row");
        expectThat(note === NOTE.webhook, `note ${note}`);
        expectThat(provider.subject === `C-${number} ${flow.title}`, `subject ${provider.subject}`);
        expectThat(provider.documentSha256 === sha(flow.v1) && provider.documentCount === 1, "provider paper differs from Version 1");
        expectThat(provider.signers.length === 2 && new Set(provider.signers.map((s) => s.routingOrder)).size === 1, "signers not asked at once");
        expectThat(c.stage === "signature", `stage ${c.stage}`);
        flow.liveProviderId = provider.id;
        const tabs = checkSigTabs(provider);
        return `Outage alert ${q(outageAlert)}; 0 rounds during the outage and after reload; retry row ${q(rows[0])}; note under the live row ${q(note)}; provider subject ${q(provider.subject)}, ${provider.documentCount} document equal to Version 1, 2 Signers with routingOrder ${provider.signers[0].routingOrder}; ${tabs}; Status still ${q(c.statusName)}`;
      });

      await step(role, sender.person.name, `/contracts/${number}/approvals`, "One live Envelope: read Approvals while the round is out and try a second send directly", "Send for signature is absent and a second send is refused.", async () => {
        await openApprovals(page, number);
        const count = await sendButton(page).count();
        const second = await api(sender, "POST", `/contracts/${number}/envelopes`, { documentVersionId: (await signingState(sender, number)).primaryDocument.versions[0].id, signers: signersFor(role, "second") });
        expectThat(count === 0 && second.status === 409, `button ${count}, API ${second.status}`);
        return `Send for signature absent; direct second send answered ${second.status}: ${q(second.json?.detail ?? second.json?.title)}`;
      });

      await step(role, `${PEOPLE.daniel.name}, ${sender.person.name}`, `/settings/integrations/e-signature, /contracts/${number}/approvals`, "Follow completion: an Administrator disables the connector while the Envelope is out; the sender reads the note under the live row; the Administrator enables it again", "With the connector disabled, the note says automatic status updates are unavailable; enabled again, it names Webhook.", async () => {
        await setEnabled(daniel, false);
        await openApprovals(page, number);
        const disabledNote = await liveNote(page);
        const disabledSend = await sendButton(page).count();
        const rows = await rowTexts(page);
        await setEnabled(daniel, true);
        await openApprovals(page, number);
        const againNote = await liveNote(page);
        expectThat(disabledNote === NOTE.disabled, `disabled note ${disabledNote}`);
        expectThat(againNote === NOTE.webhook, `re-enabled note ${againNote}`);
        return `Disabled: note ${q(disabledNote)}; Send for signature ${disabledSend}; row ${q(rows[0])}. Enabled again: note ${q(againNote)}`;
      });

      await step(role, `${flow.unrelated.person.name}, ${sender.person.name}, ${flow.voider.person.name}`, `/contracts/${number}/approvals`, `Withdraw: an unrelated Legal Team Member reads the round; the sender opens its actions; the ${flow.voiderWhy} selects Void envelope, tries an empty Reason, cancels, then voids with a Reason`, "The unrelated member has no envelope actions and cannot void; the void dialog needs a Reason; Cancel keeps the round; a Voided round frees a new send and does not move the Status.", async () => {
        const envelopeId = (await signingState(sender, number)).envelopes[0].id;
        await openApprovals(flow.unrelated.page, number);
        const unrelatedActions = await card(flow.unrelated.page).getByRole("button", { name: /^Actions for the envelope sent on/ }).count();
        const unrelatedVoid = await api(flow.unrelated, "POST", `/envelopes/${envelopeId}/void`, { reason: "DOC-030 should be refused" });
        await openApprovals(page, number);
        const senderActions = await card(page).getByRole("button", { name: /^Actions for the envelope sent on/ }).count();
        expectThat(unrelatedActions === 0 && unrelatedVoid.status === 403 && senderActions === 1, `unrelated ${unrelatedActions}/${unrelatedVoid.status}, sender ${senderActions}`);
        const vp = flow.voider.page;
        await openApprovals(vp, number);
        await card(vp).getByRole("button", { name: /^Actions for the envelope sent on/ }).click();
        await vp.getByRole("menuitem", { name: "Void envelope" }).click();
        let dialog = vp.getByRole("dialog", { name: "Void envelope" });
        await dialog.waitFor();
        const explains = await dialog.getByText("The signers can no longer sign this round. The contract can be sent again straight after.").count();
        await dialog.getByRole("button", { name: "Void envelope" }).click();
        await until(async () => (await dialog.getByRole("alert").count()) > 0, "no reason alert");
        const reasonAlert = (await dialog.getByRole("alert").innerText()).trim();
        await dialog.getByRole("button", { name: "Cancel" }).click();
        await dialog.waitFor({ state: "hidden" });
        const afterCancel = (await signingState(sender, number)).envelopes[0].status;
        await card(vp).getByRole("button", { name: /^Actions for the envelope sent on/ }).click();
        await vp.getByRole("menuitem", { name: "Void envelope" }).click();
        dialog = vp.getByRole("dialog", { name: "Void envelope" });
        const reason = `DOC-030 wrong signatory ${role} ${STAMP}`;
        await dialog.getByLabel("Reason").fill(reason);
        const voided = vp.waitForResponse((r) => r.url().endsWith(`/envelopes/${envelopeId}/void`));
        await dialog.getByRole("button", { name: "Void envelope" }).click();
        const voidStatus = (await voided).status();
        await dialog.waitFor({ state: "hidden" });
        await openApprovals(page, number);
        const rows = await rowTexts(page);
        const sendAgain = await sendButton(page).count();
        const provider = (await standin("state")).envelopes.find((e) => e.id === flow.liveProviderId);
        const c = await contractOf(sender, number);
        expectThat(reasonAlert === "Say why this envelope is being voided.", `reason alert ${reasonAlert}`);
        expectThat(afterCancel === "sent" && voidStatus === 200, `cancel ${afterCancel}, void ${voidStatus}`);
        expectThat(rows[0].includes("Voided") && rows[0].includes(reason), `row ${rows[0]}`);
        expectThat(sendAgain === 1 && provider.status === "voided" && provider.voidedReason === reason && c.stage === "signature", "after void");
        return `${flow.unrelated.person.name}: 0 envelope actions, void answered ${unrelatedVoid.status}; ${sender.person.name}: actions menu shown; ${flow.voider.person.name} (${flow.voiderWhy}): dialog text shown (${explains}), empty Reason refused with ${q(reasonAlert)}, Cancel kept status ${afterCancel}, confirm answered ${voidStatus}; row ${q(rows[0])}; provider status ${provider.status} with the reason; Send for signature shown again; Status still ${q(c.statusName)}`;
      });

      await step(role, sender.person.name, `/contracts/${number}/approvals`, "Decline: send a new round (current Version 2), the provider reports Declined with a reason", "The Declined row records its reason, the Voided round stays in history, nothing is filed, the Contract is not ended or archived, and another send is allowed.", async () => {
        const before = (await standin("state")).envelopes.length;
        const versionsBefore = (await paper(sender, number)).find((d) => d.id === flow.documentId).versions.length;
        await openApprovals(page, number);
        const sent = await sendEnvelope(page, number, { signers: signersFor(role, "r2"), subject: `DOC-030 contracts-c ${role} decline round` });
        expectThat(sent.status === 201, `send answered ${sent.status}`);
        const provider = await newestProviderEnvelope(before);
        expectThat(provider.documentSha256 === sha(flow.v2), "decline round did not send the current Version 2");
        expectThat(provider.subject === `DOC-030 contracts-c ${role} decline round`, `subject ${provider.subject}`);
        const reason = `DOC-030 fictional signer declined ${STAMP}`;
        await standin("decline", { id: provider.id, reason });
        const webhook = await deliver(provider.id, "declined", { reason, completedAt: new Date().toISOString() });
        await openApprovals(page, number);
        const rows = await rowTexts(page);
        const docs = await paper(sender, number);
        const versionsAfter = docs.find((d) => d.id === flow.documentId).versions.length;
        const c = await contractOf(sender, number);
        const sendAgain = await sendButton(page).count();
        expectThat(webhook === 204, `webhook ${webhook}`);
        expectThat(rows.length === 2 && rows[0].includes("Declined") && rows[0].includes(reason) && rows[1].includes("Voided"), rows.join(" / "));
        expectThat(versionsAfter === versionsBefore && c.stage === "signature" && !c.archivedAt && sendAgain === 1, "after decline");
        return `Sent Version 2 with the entered Subject; provider decline delivery answered ${webhook}; rows ${q(rows[0])} / ${q(rows[1])}; primary Document still ${versionsAfter} Versions; Status ${q(c.statusName)}, archivedAt ${c.archivedAt ?? null}; Send for signature shown`;
      });

      await step(role, `${sender.person.name}, ${flow.rival.person.name}`, `/contracts/${number}/approvals`, "If another sender won: both people open the send dialog; the first sends; the second sends, reads the refusal, and reloads", "The second send is refused in the dialog and reloading shows the winner's live round; no second round exists.", async () => {
        const before = (await standin("state")).envelopes.length;
        await openApprovals(page, number);
        await openApprovals(flow.rival.page, number);
        const rivalDialog = await openSendDialog(flow.rival.page);
        await fillSigners(rivalDialog, signersFor(role, "rival"));
        const sent = await sendEnvelope(page, number, { signers: signersFor(role, "r3"), subject: `DOC-030 contracts-c ${role} completion round` });
        expectThat(sent.status === 201, `winner send ${sent.status}`);
        await sent.dialog.waitFor({ state: "hidden" });
        await rivalDialog.getByRole("button", { name: "Send envelope" }).click();
        await until(async () => (await rivalDialog.getByRole("alert").count()) > 0, "no refusal in rival dialog");
        const refusal = (await rivalDialog.getByRole("alert").innerText()).trim();
        await rivalDialog.getByRole("button", { name: "Cancel" }).click();
        await openApprovals(flow.rival.page, number);
        const rows = await rowTexts(flow.rival.page);
        const after = (await standin("state")).envelopes.length;
        expectThat(rows[0].includes("Out for signature") && rows[0].includes(`by ${sender.person.name}`) && after === before + 1, `rows ${rows[0]}, provider ${before}->${after}`);
        flow.liveProviderId = (await standin("state")).envelopes[after - 1].id;
        return `${flow.rival.person.name}'s later send showed ${q(refusal)}; after reload the first row reads ${q(rows[0])}; the provider holds ${after - before} new envelope`;
      });

      await step(role, sender.person.name, `/contracts/${number}/approvals, /contracts/${number}/documents`, "Follow completion: the provider reports completion; watch the row, wait for Executed copy, open it, and check the Documents tab and Contract Status", "The row shows Signed then Executed copy; the executed PDF equals the provider output and is filed once as the pinned executed Version on the primary Document chain; the supporting Document is untouched; the Contract moves to Active; a repeated delivery adds nothing.", async () => {
        const providerState = (await standin("state")).envelopes.find((e) => e.id === flow.liveProviderId);
        await standin("complete", { id: flow.liveProviderId });
        const webhook = await deliver(flow.liveProviderId, "completed", { completedAt: new Date().toISOString() });
        const immediately = (await signingState(sender, number)).envelopes[0];
        await openApprovals(page, number);
        const firstRead = (await rowTexts(page))[0];
        await until(async () => {
          await openApprovals(page, number);
          return (await card(page).getByRole("link", { name: "Executed copy" }).count()) === 1;
        }, "Executed copy never appeared", 120000, 2000);
        const rows = await rowTexts(page);
        const link = card(page).getByRole("link", { name: "Executed copy" });
        const href = await link.getAttribute("href");
        const downloadPromise = page.waitForEvent("download", { timeout: 15000 }).catch(() => null);
        await link.click();
        const download = await downloadPromise;
        let openedSha = null;
        if (download) openedSha = sha(readFileSync(await download.path()));
        const fetched = await page.request.get(`${BASE}${href}`);
        const fetchedSha = sha(await fetched.body());
        const docs = await paper(sender, number);
        const primary = docs.find((d) => d.id === flow.documentId);
        const supporting = docs.find((d) => d.id !== flow.documentId);
        const chain = [...primary.versions].sort((a, b) => a.versionNumber - b.versionNumber);
        const executed = chain[chain.length - 1];
        const c = await contractOf(sender, number);
        await page.goto(`${BASE}/contracts/${number}/documents`);
        const docsRegion = page.getByRole("region", { name: "Documents" });
        await docsRegion.waitFor();
        const primaryRow = (await docsRegion.getByRole("row").filter({ hasText: flow.v1Name }).first().innerText()).replace(/\s+/g, " ");
        await docsRegion.getByRole("button", { name: `Actions for ${flow.v1Name}` }).click();
        const unmark = await page.getByRole("menuitem", { name: "Unmark as executed copy" }).count();
        await page.keyboard.press("Escape");
        const repeat = await deliver(flow.liveProviderId, "completed", { completedAt: new Date().toISOString() });
        await sleep(4000);
        const docsAgain = await paper(sender, number);
        const envelopesAgain = (await signingState(sender, number)).envelopes.length;
        expectThat(webhook === 204 && repeat === 204, `webhooks ${webhook}/${repeat}`);
        expectThat(rows[0].includes("Signed"), `row ${rows[0]}`);
        expectThat(fetchedSha === providerState.executedSha256 && (openedSha === null || openedSha === providerState.executedSha256), "executed bytes differ");
        expectThat(executed.isExecuted && executed.isCurrent && chain.length === 3, `chain ${JSON.stringify(chain.map((v) => [v.versionNumber, v.kind, v.isExecuted]))}`);
        expectThat(supporting.versions.length === 1 && !supporting.versions.some((v) => v.isExecuted), "supporting Document changed");
        expectThat(c.stage === "active", `status ${c.statusName} stage ${c.stage}`);
        expectThat(unmark === 1, "no Unmark as executed copy");
        expectThat(docsAgain.find((d) => d.id === flow.documentId).versions.length === 3 && envelopesAgain === 3, "repeat delivery changed something");
        return `Completion delivery answered ${webhook}; API right after: status ${immediately.status}, executedFetch ${immediately.executedFetch}; first page read ${q(firstRead)}; final row ${q(rows[0])}; Executed copy ${download ? "opened as a download" : "link followed"}, bytes equal the provider output; primary Document Version ${executed.versionNumber} ${q(executed.originalFilename)} kind ${executed.kind}, current, designated executed; Documents row ${q(primaryRow.slice(0, 140))} offers Unmark as executed copy; supporting Document still 1 Version; Status ${q(c.statusName)} (stage ${c.stage}); repeated delivery answered ${repeat} and added no Version or Envelope`;
      });

      await step(role, sender.person.name, `/contracts/${number}`, "Follow completion: someone moves the Contract to another Stage while the round is out; the provider then completes it", "Filing still pins the executed Version, and completion does not overwrite that Stage.", async () => {
        await moveStatus(page, number, "Out for signature");
        const before = (await standin("state")).envelopes.length;
        await openApprovals(page, number);
        const sent = await sendEnvelope(page, number, { signers: signersFor(role, "r4") });
        expectThat(sent.status === 201, `send ${sent.status}`);
        const provider = await newestProviderEnvelope(before);
        await moveStatus(page, number, "Internal review");
        await standin("complete", { id: provider.id });
        const webhook = await deliver(provider.id, "completed", { completedAt: new Date().toISOString() });
        await until(async () => (await signingState(sender, number)).envelopes[0].executedFetch === "ready", "never filed", 120000, 1500);
        const chain = [...(await paper(sender, number)).find((d) => d.id === flow.documentId).versions].sort((a, b) => a.versionNumber - b.versionNumber);
        const last = chain[chain.length - 1];
        const c = await contractOf(sender, number);
        expectThat(webhook === 204 && last.versionNumber === 4 && last.isExecuted && last.isCurrent && c.statusName === "Internal review", `v${last.versionNumber} ${c.statusName}`);
        return `Moved to Internal review after sending; completion (${webhook}) filed Version ${last.versionNumber} as current and designated executed; Status stayed ${q(c.statusName)} (stage ${c.stage})`;
      });

      await step(role, sender.person.name, `/contracts/${number}/approvals`, "If voiding is refused because the provider already completed the round: void, read the refusal, reload, and inspect the recorded outcome", "The dialog shows the refusal; after the provider's feed arrives, reloading shows Signed.", async () => {
        const before = (await standin("state")).envelopes.length;
        await openApprovals(page, number);
        const sent = await sendEnvelope(page, number, { signers: signersFor(role, "r5") });
        expectThat(sent.status === 201, `send ${sent.status}`);
        await sent.dialog.waitFor({ state: "hidden" });
        const provider = await newestProviderEnvelope(before);
        await standin("complete", { id: provider.id });
        await card(page).getByRole("button", { name: /^Actions for the envelope sent on/ }).first().click();
        await page.getByRole("menuitem", { name: "Void envelope" }).click();
        const dialog = page.getByRole("dialog", { name: "Void envelope" });
        await dialog.getByLabel("Reason").fill("DOC-030 late void attempt");
        await dialog.getByRole("button", { name: "Void envelope" }).click();
        await until(async () => (await dialog.getByRole("alert").count()) > 0, "no refusal");
        const refusal = (await dialog.getByRole("alert").innerText()).trim();
        await dialog.getByRole("button", { name: "Cancel" }).click();
        await openApprovals(page, number);
        const reloadedBeforeFeed = (await rowTexts(page))[0];
        const webhook = await deliver(provider.id, "completed", { completedAt: new Date().toISOString() });
        await openApprovals(page, number);
        const reloadedAfterFeed = (await rowTexts(page))[0];
        expectThat(refusal.length > 0 && reloadedAfterFeed.includes("Signed"), `${refusal} / ${reloadedAfterFeed}`);
        await until(async () => (await signingState(sender, number)).envelopes[0].executedFetch === "ready", "never filed", 120000, 1500);
        return `Void refused in the dialog: ${q(refusal)}; reload before the provider feed: ${q(reloadedBeforeFeed)}; after the feed (${webhook}) and reload: ${q(reloadedAfterFeed)}`;
      });

      await step(role, sender.person.name, `/contracts/${number}/approvals`, "If the row says the executed copy could not be filed: the provider completes a round whose executed file cannot be fetched", "The Signed row says the executed copy could not be filed, and no Version is created.", async () => {
        await standin("faults", { combinedRefused: true });
        try {
          const before = (await standin("state")).envelopes.length;
          const versionsBefore = (await paper(sender, number)).find((d) => d.id === flow.documentId).versions.length;
          await openApprovals(page, number);
          const sent = await sendEnvelope(page, number, { signers: signersFor(role, "r6") });
          expectThat(sent.status === 201, `send ${sent.status}`);
          const provider = await newestProviderEnvelope(before);
          await standin("complete", { id: provider.id });
          const webhook = await deliver(provider.id, "completed", { completedAt: new Date().toISOString() });
          await until(async () => (await signingState(sender, number)).envelopes[0].executedFetch === "failed", "never recorded the failure", 180000, 1500);
          await openApprovals(page, number);
          const row = (await rowTexts(page))[0];
          const versionsAfter = (await paper(sender, number)).find((d) => d.id === flow.documentId).versions.length;
          expectThat(row.includes("Signed") && row.includes("The executed copy could not be filed. Upload it to the record instead.") && versionsAfter === versionsBefore, row);
          return `Delivery ${webhook}; row ${q(row)}; primary Document still ${versionsAfter} Versions`;
        } finally {
          await standin("faults", { combinedRefused: false });
        }
      });

      await step(role, `${PEOPLE.ravi.name} (Business User on the Contract team)`, `/portal (API reads)`, "Negative: a Business User on the Contract team tries to read and send Envelopes", "Both are refused.", async () => {
        const ravi = await sessions.magic(PEOPLE.ravi);
        try {
          const read = await api(ravi, "GET", `/contracts/${number}/envelopes`);
          const send = await api(ravi, "POST", `/contracts/${number}/envelopes`, { documentVersionId: "x", signers: signersFor(role, "ravi") });
          expectThat(read.status === 403 && send.status === 403, `read ${read.status}, send ${send.status}`);
          return `Team add answered ${flow.raviOnTeam}; Ravi Menon signed in with a fresh magic link; envelope read answered ${read.status}, send answered ${send.status}`;
        } finally {
          await ravi.context.close();
        }
      });

      await step(role, sender.person.name, `/contracts/${number}/approvals`, "If signing is unavailable: archive the Contract and open Approvals", "Send for signature is absent on an archived Contract; its recorded rounds stay readable.", async () => {
        const arch = await api(sender, "POST", `/contracts/${number}/archive`);
        expectThat(arch.status === 200, `archive ${arch.status}`);
        try {
          await openApprovals(page, number);
          const rows = await envelopeRows(page).count();
          const send = await sendButton(page).count();
          const direct = await api(sender, "POST", `/contracts/${number}/envelopes`, { documentVersionId: (await signingState(sender, number)).primaryDocument?.versions?.[0]?.id ?? "x", signers: signersFor(role, "archived") });
          expectThat(send === 0 && rows >= 6 && direct.status === 409, `send ${send}, rows ${rows}, direct ${direct.status}`);
          return `Archived C-${number}: ${rows} rounds readable, Send for signature absent, direct send answered ${direct.status}`;
        } finally {
          const restored = await api(sender, "POST", `/contracts/${number}/restore`);
          expectThat(restored.status === 200, `restore ${restored.status}`);
        }
      });
    }
    ctx.results.contracts = flows.map((f) => ({ role: f.role, number: f.number, noPaperNumber: f.noPaperNumber, title: f.title }));
    for (const who of [daniel, nadia, priya, marcus]) await who.context.close();
  }

  // ---------------------------------------------------------------- polling phase
  async function polling() {
    const daniel = await sessions.password(PEOPLE.daniel);
    const nadia = await sessions.password(PEOPLE.nadia);
    const options = (await api(daniel, "GET", "/contracts/options")).json;
    const typeId = options.contractTypes.find((t) => t.displayName === "NDA").id;
    await step("administrator", PEOPLE.daniel.name, "/settings/integrations/e-signature", "Setup: switch Signing updates to Polling and save", "The connector stays enabled in Polling mode.", async () => {
      const page = daniel.page;
      await openConnector(page);
      await page.getByLabel("Signing updates").selectOption("polling");
      const hint = await page.getByText(/Updates can take about 15 to 20 minutes while the worker is running/).count();
      const saved = page.waitForResponse((r) => r.url().endsWith("/api/v1/signing-connectors/docusign") && r.request().method() === "PUT");
      await page.getByRole("button", { name: "Save connector" }).click();
      expectThat((await saved).status() === 200, "save refused");
      const c = await connector(daniel);
      expectThat(c.updateMode === "polling" && c.enabled, JSON.stringify({ mode: c.updateMode, enabled: c.enabled }));
      return `Saved updateMode ${c.updateMode}, enabled ${c.enabled}; the settings Polling hint is shown (${hint})`;
    });
    const flows = [
      { role: "legal_team_member", who: nadia },
      { role: "administrator", who: daniel },
    ];
    for (const flow of flows) {
      flow.title = `DOC-030 contracts-c electronic-signing polling ${flow.role} ${STAMP}`;
      const created = await api(flow.who, "POST", "/contracts", { title: flow.title, contractTypeId: typeId });
      flow.number = created.json.contract.number;
      flow.bytes = pdf(`DOC-030 polling primary ${flow.role}`);
      await upload(flow.who, flow.number, `doc030-polling-${flow.role}.pdf`, flow.bytes, "draft_ours", "DOC-030 polling round");
      await step(flow.role, flow.who.person.name, `/contracts/${flow.number}/approvals`, "Polling: move to Out for signature, send an Envelope, and read the note under the live row", "The note under the live row says status is checked by polling about every 15–20 minutes.", async () => {
        await moveStatus(flow.who.page, flow.number, "Out for signature");
        const before = (await standin("state")).envelopes.length;
        await openApprovals(flow.who.page, flow.number);
        const sent = await sendEnvelope(flow.who.page, flow.number, { signers: signersFor(flow.role, "p1") });
        expectThat(sent.status === 201, `send ${sent.status}`);
        await sent.dialog.waitFor({ state: "hidden" });
        await openApprovals(flow.who.page, flow.number);
        const note = await liveNote(flow.who.page);
        const header = await flow.who.page.getByText("Envelope sent", { exact: true }).count();
        const provider = await newestProviderEnvelope(before);
        flow.providerId = provider.id;
        flow.sentAt = Date.now();
        expectThat(note === NOTE.polling, `note ${note}`);
        expectThat(header >= 1, "the header does not say Envelope sent");
        return `C-${flow.number}: note under the live row ${q(note)}; the record header reads "Envelope sent"`;
      });
    }
    for (const flow of flows) {
      await standin("complete", { id: flow.providerId });
      flow.completedAt = Date.now();
      flow.refused = await deliver(flow.providerId, "completed", { completedAt: new Date().toISOString() });
    }
    for (const flow of flows) {
      await step(flow.role, flow.who.person.name, `/contracts/${flow.number}/approvals`, "Polling: the provider completes the round and no webhook is accepted; watch the row until Signed and Executed copy", "The row reaches Signed within about 15 to 20 minutes while the worker runs; the executed copy files and the Contract moves to Active.", async () => {
        await until(async () => (await signingState(flow.who, flow.number)).envelopes[0].status === "signed", "polling never reported completion within 30 minutes", 30 * 60 * 1000, 20000);
        const signedAt = Date.now();
        await until(async () => (await signingState(flow.who, flow.number)).envelopes[0].executedFetch === "ready", "never filed", 300000, 5000);
        await openApprovals(flow.who.page, flow.number);
        const row = (await rowTexts(flow.who.page))[0];
        const exec = await card(flow.who.page).getByRole("link", { name: "Executed copy" }).count();
        const header = await flow.who.page.getByText("Envelope signed", { exact: true }).count();
        expectThat(header >= 1, "the header does not say Envelope signed");
        const c = await contractOf(flow.who, flow.number);
        const minutes = ((signedAt - flow.completedAt) / 60000).toFixed(1);
        expectThat(row.includes("Signed") && exec === 1 && c.stage === "active", `${row} ${c.statusName}`);
        return `C-${flow.number}: a completed delivery in Polling mode answered ${flow.refused}; the record read Signed ${minutes} minutes after the provider completion (${((signedAt - flow.sentAt) / 60000).toFixed(1)} minutes after sending); row ${q(row)}; Executed copy link shown; header "Envelope signed"; Status ${q(c.statusName)}`;
      });
    }
    ctx.results.contracts = flows.map((f) => ({ role: f.role, number: f.number, title: f.title }));
    await daniel.context.close();
    await nadia.context.close();
  }

  if (PHASE === "main") await main();
  else if (PHASE === "polling") await polling();
  else throw new Error(`unknown signing phase ${PHASE}`);
}
