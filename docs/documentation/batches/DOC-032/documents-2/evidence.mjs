// Writes docs/documentation/evidence/<id>.json for the DOC-032 documents-2 articles from
// walkthrough.json. Written by the DOC-032 independent walkthrough agent (documents-2) on the
// DOC-030 documents-2 evidence.mjs pattern. It writes a record only for an article whose every
// required role and method passed in one complete run, and only while the guide's hash still
// matches the hash that run walked.
// Run from the worktree root: [ONLY=archive,...] node docs/documentation/batches/DOC-032/documents-2/evidence.mjs
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "../../../../..");
const REL = "docs/documentation/batches/DOC-032/documents-2";
const read = (f) => JSON.parse(fs.readFileSync(path.join(root, f), "utf8"));
const log = read(`${REL}/walkthrough.json`);
const review = read(`${REL}/technical-review.json`);
const plan = read("docs/documentation/batches/DOC-032/plan.json");
const sha = (f) =>
  crypto
    .createHash("sha256")
    .update(fs.readFileSync(path.join(root, f)))
    .digest("hex");
const clip = (s, n) => (String(s).length > n ? `${String(s).slice(0, n - 1)}…` : String(s));
const STANDARD =
  "Independent agent walkthrough by a different agent from the author and technical reviewer; not a human user study and not the feature owner's approval.";

const PARTS = {
  archive: {
    id: "archive-and-delete-documents",
    module: "archive.mjs",
    prereq: (s) => [
      `Per staff role, a Contract named "DOC-032 documents-2 V-C54 archive-and-delete <Legal|Admin> ${s.stamp}" (${s.records
        .filter((r) => r.kind === "contract")
        .map((r) => `${r.reference} for ${r.role}`)
        .join(
          ", ",
        )}) with a three-Version primary DOCX whose Version 2 carries the Executed pin, and further text Documents, plus a Knowledge Item with two Documents; all created through the lab API from the DOC-029 documents fixtures. Mei Tanaka (seeded Business User) was added to the Legal Contract's team and signed in to the Portal with a fresh magic link.`,
      "The Administrator's deletion fixtures (a one-Version and a two-Version Document for Delete versions, a Comparison of Version 1 to Version 2) were also prepared through the lab API; every guide step ran in the browser.",
    ],
    limitations: (s) => [
      'Registry action "permanently delete a separate Document as Administrator": the app at 4ca41822 has no whole-Document delete control, as the author noted. The Administrator\'s Document menu offers Delete version and the selection bar offers Delete versions; neither offers a Delete for the whole Document. The walkthrough removed separate Documents by deleting their Versions: a two-Version archived primary Document one Version at a time (the last dialog said "This is the last version, so the document will also be removed."), a one-Version Document after the rename refusal, and a one-Version Document through Delete versions. Each Document was gone afterwards, its downloads answered 404, and the primary reference was cleared with no replacement. The API route DELETE /documents/:documentId was not called, because no control uses it.',
      ...s.limitations,
      "The Comparison removed with Version 2 had ended in the failed state (the doc engine did not answer); the check shows that OpenLaw removes a Comparison record that uses the deleted Version (200 before, 404 after), not the removal of a ready redline file.",
      "A storage failure during deletion (If deletion fails) cannot be induced on the shared lab and was not exercised; the rename refusal and the retry after reopening the record were.",
      "Removal of previews and extracted text is not visible in the app beyond the Version downloads, which answered 404. The Audit log was not read; the Contract activity read (lab API) held document.version_deleted and document.hard_deleted entries after the deletions.",
      "The Auto-Doc template refusal is not reachable from any Documents section, as the author noted; not exercised.",
      `Product bug confirmed (not a guide failure): ${s.productBugs.map((b) => b.observed).join(" ")} The guide tells the reader to restore an archived owning record before changing its Documents and does not describe this edge.`,
      `The work lab is shared with other DOC-032 agents. Only records named "DOC-032 documents-2 V-C54 … ${s.stamp}" were credited (${s.records.map((r) => r.reference ?? r.title).join(", ")}). Development runs at stamps 20260928072710 and 20260928072827 left more DOC-032 documents-2 V-C54 records (C-134, C-135 and their siblings); they are not credited. No organization setting was changed.`,
    ],
  },
  knowledge: {
    id: "create-knowledge",
    module: "knowledge.mjs",
    buRole: "business_user",
    buName: "Ade Balogun",
    prereq: (s) => [
      `Per staff role, Knowledge folders, items and Documents named "DOC-032 documents-2 V-C33 <Legal|Admin> … ${s.stamp}", made in the browser by the guide's steps except the parent and child folder fixtures (lab API) that let Start with files begin in a selected folder. Seeded Knowledge types; an archived Knowledge type fixture per role, created and deleted in its step. Fictional PDF and DOCX files from the DOC-029 fixtures under run-specific names.`,
    ],
    limitations: (s) => [
      ...s.limitations,
      "The parent and child folders are lab API fixtures so Start with files could begin in a selected folder; Add folder itself was walked in Organize the library step 2.",
      "On a Knowledge Item an earlier Version with nothing to compare has an Actions for version menu only for an Administrator, so a third Version was added to the supporting DOCX (lab API fixture) to give the Legal Team Member a Version menu to inspect. Neither the Legal Team Member's Document menus nor that Version menu offered Delete version; a direct deletion answered 403.",
      "Failed attachment uploads in New Knowledge Item were produced by the browser dropping the upload request (Playwright route abort). The archived-item upload refusal was checked with a second request through the lab API after the browser hid Upload.",
      "Help search was checked last, after the run's own Knowledge Items existed.",
      `The work lab is shared with other DOC-032 agents. Organization settings changed for the run and put back: ${(s.settingsChanged ?? []).map((c) => `${c.setting} "${c.added}" (${c.restored})`).join("; ")}. Development runs at stamps 20260928072911 and 20260928073114 left more DOC-032 documents-2 V-C33 records; they are not credited, and their Knowledge types were deleted.`,
    ],
  },
  contributor: {
    id: "contributor-guide",
    module: "contributor.mjs",
    extraEvidence: [`${REL}/contributor-portal-document-types.png`],
    prereq: (s) => [
      `Fixtures named "DOC-032 documents-2 V-C25 … ${s.stamp}": ${s.records
        .map((r) => `${r.kind} ${r.ref ?? ""}`.trim())
        .join(
          ", ",
        )}. Ravi Menon (seeded Business User, the former Contributor) signed in to the Portal with a fresh magic link; Clara Fontaine was the colleague he added and the non-approver.`,
      "Daniel Okafor added the Contract Document type in Settings, Documents in the browser (setup step) and the run archived it at the end; Legal uploads typed with it, with a fixed type and with no type were lab API writes by the second actor.",
    ],
    setupRoles: ["legal_team_member", "administrator"],
    limitations: (s) => [
      ...s.limitations,
      `Product bug confirmed (not a guide failure): ${s.productBugs.map((b) => `${b.title}. ${b.reproduction} ${b.guideImpact}`).join(" ")}`,
      "The registry action Edit permitted business Fields has no control: the Portal record has no editable Field, and direct record writes as Ravi were refused. The guide says to ask Legal, which is what the app supports.",
      "Legal and Administrator actions used API sessions as the second actor: uploads, the signed-copy pin, the History changes, close, end, archive and restore, and the approval requests. Adding Ravi to the team and removing Ravi and Clara were browser actions in the full app. Legal's view of the Kind choice and the unchanged primary and signed-copy designations were API and database reads.",
      "Show more on Your Contracts used paging Contracts C-179 to C-200 created by an earlier run of this part (stamp 20260928073104, Ravi on their teams). That earlier run failed on a reviewer script fault and its records (C-177, C-178, C-216, M-63 to M-66, a Request, Fields and types) are not credited; its Document type is archived.",
      "The work lab is shared with other DOC-032 agents. The only organization setting changed was the run's own Contract Document type, archived at the end (answer 200).",
    ],
  },
  reference: {
    id: "reference",
    module: "reference.mjs",
    prereq: (s) => [
      `Fixtures named "DOC-032 documents-2 V-C50 … ${s.stamp}" created through the lab API: ${s.records
        .filter((r) => r.kind !== "api_key")
        .map((r) => `${r.kind ?? "record"} ${r.ref ?? r.reference ?? r.name}`)
        .join(
          ", ",
        )}, and the API key requests the steps sent. Daniel Okafor (Administrator) and Nadia Haddad (Legal Team Member) signed in with passwords; Felix Brandt (seeded Business User) signed in to the Portal with a fresh magic link; the operator steps ran signed out and as read-only container reads.`,
      `Organization settings changed for single steps and put back at once: ${s.settingsChanged.map((c) => c.setting).join("; ")}. The final MCP policy read matched the policy before the run (${s.settingsChanged.find((c) => c.setting === "MCP policy restored")?.matchesBefore}).`,
    ],
    limitations: (s) => [
      ...s.limitations,
      "The Toolset filter was observed by narrowing the organization's Toolset ceiling to Team and Administration for about two seconds: the Business User's page showed no Request a key and the no-Toolsets message, and the Legal Team Member's form offered only Team. Other agents share the lab; the ceiling and every MCP switch were put back and read back equal to their values before the run.",
      "Registration, Officer, Obligation, Signer, Analysis run and Generated redline rows were checked in the article text only, not exercised. Word and PowerPoint conversion and PDF OCR were not exercised; the shared lab's doc engine was unhealthy during the batch.",
      "The Documentation reader on the lab serves the article bytes bundled at 4ca41822; the operator steps opened the reference there, and the link check opened every internal link of the reviewed bytes.",
      "The work lab is shared with other DOC-032 agents. Only records named DOC-032 documents-2 V-C50 were credited. A helper's earlier complete run (stamp 20260928075036) and development runs before it left more V-C50 records and archived Document types; they are not credited.",
    ],
  },
};

const written = [];
const skipped = [];
// ONLY=archive,knowledge limits the run to finished parts while another part is still walking.
const ONLY = process.env.ONLY?.split(",");
for (const [key, cfg] of Object.entries(PARTS)) {
  if (ONLY && !ONLY.includes(key)) continue;
  const s = log.sections[key];
  const articleId = cfg.id;
  const g = plan.groups["documents-2"].find((a) => a.id === articleId);
  const author = review.articles.find((a) => a.articleId === articleId);
  const guide = `docs/user-guides/${articleId}.md`;
  const problems = [];
  if (!s) {
    skipped.push(`${articleId}: no recorded run`);
    continue;
  }
  if (s.fatal) problems.push(`fatal ${s.fatal}`);
  if (sha(guide) !== s.articleSha256) problems.push("guide changed after the walk");
  if (s.steps.some((x) => x.result !== "pass"))
    problems.push(`${s.steps.filter((x) => x.result !== "pass").length} steps not passing`);
  const scenario = g.scenarios[0];
  const labLine = `Shared lab ${s.environment} (${s.labName}) built from ${s.appCommit}, Helix seed ${s.seed.scale} profile, random seed ${s.seed.randomSeed}, seeded ${s.seed.startedAt} to ${s.seed.completedAt}. ${s.browser}. Run stamp ${s.stamp}, ${s.startedAt} to ${s.finishedAt}.`;
  const bu = cfg.buRole ? s.steps.filter((x) => x.role === cfg.buRole) : [];
  const scenarios = [];
  for (const role of scenario.roles) {
    for (const method of scenario.requiredMethods) {
      const mine = s.steps.filter((x) => x.role === role && (x.method ?? method) === method);
      if (!mine.length) problems.push(`${role} ${method}: no steps`);
      const setup = (cfg.setupRoles ?? [])
        .filter((r) => r !== role)
        .flatMap((r) => s.steps.filter((x) => x.role === r));
      const actual = [
        `${mine.length} recorded steps passed for this role on ${s.appCommit.slice(0, 8)} (section ${key} of walkthrough.json).`,
        ...mine.map((x, i) => `(${i + 1}) ${x.action}: ${clip(x.actual, 900)}`),
        ...(setup.length
          ? [`Setup steps by other roles: ${setup.map((x) => clip(x.actual, 400)).join(" ")}`]
          : []),
        ...(bu.length
          ? [
              `Business User negative check, ${cfg.buName} through a fresh Portal magic link: ${bu.map((x) => clip(x.actual, 600)).join(" ")}`,
            ]
          : []),
      ].join(" ");
      scenarios.push({
        id: scenario.id,
        coverage: scenario.coverage,
        role,
        method,
        prerequisites: [labLine, ...cfg.prereq(s)],
        expected: `${scenario.expectedResults.join(" ")} Negative checks: ${scenario.negativeChecks.join(" ")}`,
        actual,
        result: "pass",
        evidence: [
          `${REL}/walkthrough.json`,
          `${REL}/walkthrough.mjs`,
          `${REL}/${cfg.module}`,
          `${REL}/lib.mjs`,
          ...(cfg.extraEvidence ?? []),
        ],
      });
    }
  }
  if (problems.length) {
    skipped.push(`${articleId}: ${problems.join("; ")}`);
    continue;
  }
  const prior = read(`docs/documentation/evidence/${articleId}.json`);
  const previousEvidence =
    prior.appCommit === s.appCommit && prior.walkthroughReviewer === s.seat
      ? prior.previousEvidence
      : {
          appCommit: g.priorEvidence.appCommit,
          contentSha256: author.contentSha256Before,
          verifiedAt: g.priorEvidence.verifiedAt,
        };
  const priorAuthor =
    prior.appCommit === s.appCommit && prior.walkthroughReviewer === s.seat
      ? prior.author
      : `${review.reviewer}; earlier: ${prior.author}`;
  const record = {
    articleId,
    contentSha256: s.articleSha256,
    environment: s.environment,
    appCommit: s.appCommit,
    buildId: `app ${s.appImageId}; engine ${s.engineImageId}`,
    walkthroughReviewer: s.seat,
    reviewerKind: "agent",
    technicalReviewer: review.reviewer,
    author: priorAuthor,
    verifiedAt: s.finishedAt,
    status: "pass",
    sources: [
      ...new Set([
        guide,
        `${REL}/technical-review.json`,
        `${REL}/walkthrough.mjs`,
        `${REL}/${cfg.module}`,
        `${REL}/lib.mjs`,
        `${REL}/walkthrough.json`,
        `${REL}/evidence.mjs`,
        ...author.sources.filter((x) => x !== guide),
      ]),
    ],
    scenarios,
    limitations: [STANDARD, ...cfg.limitations(s)],
    previousEvidence,
    compatibilityReview: null,
    copyOnlyReview: null,
  };
  fs.writeFileSync(
    path.join(root, "docs/documentation/evidence", `${articleId}.json`),
    JSON.stringify(record, null, 2) + "\n",
  );
  written.push(articleId);
}
console.log("written", written.join(", ") || "none");
if (skipped.length) console.log("skipped\n  " + skipped.join("\n  "));
