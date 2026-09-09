// SPDX-License-Identifier: AGPL-3.0-only
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { test } from "node:test";
import { applicationDigest, buildIdentity, compileWorkspace } from "./build.mjs";
import { compileDocumentation, validateCatalog } from "./compiler.mjs";
import { searchDocumentation, documentationExcerpt, resolveDocumentationLink } from "./reader.mjs";
import { readOwnedFile } from "./owned-file.mjs";

const commit = "a".repeat(40);
const digest = "b".repeat(64);
// The fenced block carries a bare tag, an upper-case one and one with an
// attribute. A filter that only knows the lower-case bare form would let the
// other two through, so all three ride the fixture and the assertions below
// match on the tag name alone, without case.
const text =
  "# Submit a fixture\n\nA validation fixture, not product instructions.\n\n## Before you start\n\nUse fictional paper.\n\n## Submit\n\n1. Open the fixture.\n2. Review the result.\n\n[Recovery](recover.md#retry)\n\n```sh\nprintf '<script>literal</script><SCRIPT SRC=x></SCRIPT><ScRiPt >mixed</ScRiPt>'\n```\n";
function fixture(t, options = {}) {
  const root = mkdtempSync(join(tmpdir(), "openlaw-docs-test-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const contentRoot = join(root, "content"),
    metadataRoot = join(root, "metadata");
  mkdirSync(contentRoot);
  mkdirSync(metadataRoot);
  mkdirSync(join(metadataRoot, "evidence"));
  function json(name, value) {
    writeFileSync(join(metadataRoot, name), JSON.stringify(value));
  }
  const articles = [
    {
      id: "submit",
      title: "Submit a fixture",
      section: "start",
      kind: "how-to",
      coverage: ["C01"],
      ownerTask: "DOC-008",
      audiences: ["business_user"],
      destinations: ["formal", "portal-help"],
      priority: "P0",
      contexts: ["portal.submit"],
      status: "verified",
    },
    {
      id: "recover",
      title: "Recover a fixture",
      section: "start",
      kind: "troubleshooting",
      coverage: ["C02"],
      ownerTask: "DOC-008",
      audiences: ["business_user"],
      destinations: ["formal", "portal-help"],
      priority: "P1",
      contexts: ["portal.submit"],
      status: "verified",
    },
  ];
  const sources = {
    submit: text,
    recover: "# Recover a fixture\n\n## Retry\n\nRepeat the fixture action.\n",
  };
  const scenarios = articles.map((a) => ({
    id: `V-${a.id}`,
    articles: [a.id],
    coverage: a.coverage,
    roles: a.audiences,
    requiredMethods: ["browser-walkthrough"],
  }));
  const edition = {
    schemaVersion: 1,
    id: "fixture",
    channel: "development",
    supportedAppVersion: "0.0.1",
    supportedAppCommit: commit,
    publicationTarget: "test-fixture",
    compatibilityReview: {
      testedAppCommit: commit,
      applicationSha256: digest,
      reviewer: "Fixture reviewer",
      reviewedAt: "2026-09-06T00:00:00Z",
      summary: "Fixture only",
    },
  };
  json("articles.json", {
    schemaVersion: 1,
    sections: [{ id: "start", title: "Start here" }],
    articles,
  });
  json("edition.json", edition);
  json("redirects.json", { schemaVersion: 1, redirects: [] });
  json("help-contexts.json", {
    schemaVersion: 1,
    bindings: [
      {
        routes: ["/portal/new/:slug"],
        contexts: ["portal.submit"],
        surface: "portal",
        pilotEntry: true,
      },
    ],
  });
  json("scenarios.json", { schemaVersion: 1, scenarios });
  function evidence(id) {
    const a = articles.find((a) => a.id === id);
    return {
      articleId: id,
      contentSha256: createHash("sha256").update(sources[id]).digest("hex"),
      appCommit: commit,
      buildId: commit,
      environment: "fixture",
      author: "Fixture author",
      technicalReviewer: "Fixture technical reviewer",
      walkthroughReviewer: "Fixture reader",
      reviewerKind: "agent",
      verifiedAt: "2026-09-06T00:00:00Z",
      status: "pass",
      sources: ["fixture source"],
      scenarios: [
        {
          id: `V-${id}`,
          coverage: a.coverage,
          role: "business_user",
          method: "browser-walkthrough",
          prerequisites: ["Fixture ready"],
          expected: "Fixture passes",
          actual: "Fixture passed",
          result: "pass",
          evidence: ["fixture observation"],
        },
      ],
      limitations: [],
    };
  }
  for (const [id, source] of Object.entries(sources)) {
    writeFileSync(join(contentRoot, `${id}.md`), source);
    json(`evidence/${id}.json`, evidence(id));
  }
  return {
    root,
    contentRoot,
    metadataRoot,
    json,
    articles,
    edition,
    sources,
    evidence,
    compile: (extra) =>
      compileDocumentation({
        contentRoot,
        metadataRoot,
        build: { commit, dirty: false, applicationSha256: digest },
        ...options,
        ...extra,
      }),
  };
}

test("one source supplies formal, Help, outlines, search and offline files", (t) => {
  const f = fixture(t);
  const { bundle, files } = f.compile();
  const a = bundle.articles[0];
  assert.match(a.html.formal, /href="\/documentation\/recover#retry"/);
  assert.match(a.html["portal-help"], /href="\/portal\/help\/recover#retry"/);
  assert.match(a.html.standalone, /href="recover.html#retry"/);
  for (const html of Object.values(a.html)) {
    assert.match(html, /Open the fixture/);
    // Any casing, any attribute, any spacing before the name: the compiled
    // page must carry no live script tag at all, only escaped text.
    assert.doesNotMatch(html, /<\s*\/?\s*script/i);
    assert.match(html, /&lt;script&gt;/);
    assert.match(html, /&lt;SCRIPT SRC=x&gt;/);
    assert.match(html, /&lt;ScRiPt &gt;/);
  }
  assert.equal(a.outline[1].id, "before-you-start");
  assert.equal(searchDocumentation(bundle, { query: "PAPER fictional" })[0].id, "submit");
  assert.deepEqual(searchDocumentation(bundle, { query: "paper absent" }), []);
  assert.equal(searchDocumentation(bundle, { destination: "staff-help" }).length, 0);
  // The catalogue orders "Submit a fixture" before "Recover a fixture"; a
  // title sort would reverse both the listing and the adjacent-guide links.
  assert.deepEqual(
    searchDocumentation(bundle).map((a) => a.id),
    ["submit", "recover"],
  );
  assert.doesNotMatch(documentationExcerpt(bundle.articles[0], ""), /^Submit a fixture/);
  assert.match(files.get("index.html"), /section-start.html/);
  const collection = files.get("section-start.html");
  assert.match(collection, /submit.html/);
  assert.ok(collection.indexOf("submit.html") < collection.indexOf("recover.html"));
  assert.match(collection, /<p>A validation fixture/);
  assert.match(files.get("submit.html"), /<span>Next guide<\/span><strong>Recover a fixture</);
  assert.match(files.get("themes.css"), /data-theme="warm"/);
  assert.equal(files.get("inter.woff2").subarray(0, 4).toString(), "wOF2");
  assert.match(files.get("submit.html"), /aria-current="page"/);
  assert.match(files.get("submit.html"), /Open the fixture/);
  assert.doesNotMatch(files.get("search.js"), /\bfetch\s*\(/);
  // Retained copies open in older browsers; URLSearchParams.size is too new for them.
  assert.doesNotMatch(files.get("search.js"), /\.size\b/);
  assert.doesNotMatch(JSON.stringify(bundle), /Fixture author|fixture observation/);
  assert.equal(bundle.report.verified, 2);
});

test("collection filenames cannot replace an article or a redirect", (t) => {
  const f = fixture(t);
  assert.throws(
    () =>
      validateCatalog(
        {
          schemaVersion: 1,
          sections: [{ id: "start", title: "Start here" }],
          articles: [{ ...f.articles[0], id: "section-start" }],
        },
        [],
        [],
      ),
    /article ID collides with a collection page/,
  );
  f.json("redirects.json", {
    schemaVersion: 1,
    redirects: [{ from: "section-start", to: "submit" }],
  });
  assert.throws(() => f.compile(), /redirect collides with a collection page/);
});

test("scoped catalog entries stay absent, and complete publication preserves the denominator", (t) => {
  const f = fixture(t);
  f.articles[1].status = "scoped";
  f.json("articles.json", {
    schemaVersion: 1,
    sections: [{ id: "start", title: "Start here" }],
    articles: f.articles,
  });
  assert.throws(() => f.compile(), /unpublished/i);
  f.articles[0].status = "scoped";
  f.json("articles.json", {
    schemaVersion: 1,
    sections: [{ id: "start", title: "Start here" }],
    articles: f.articles,
  });
  assert.equal(f.compile().bundle.articles.length, 0);
  assert.throws(() => f.compile({ complete: true }), /complete/i);
});

test("drafts require explicit preview and missing dependencies remain visible", (t) => {
  const f = fixture(t);
  f.articles[0].status = "draft";
  f.articles[1].status = "scoped";
  f.json("articles.json", {
    schemaVersion: 1,
    sections: [{ id: "start", title: "Start here" }],
    articles: f.articles,
  });
  assert.equal(f.compile().bundle.articles.length, 0);
  const { bundle } = f.compile({ preview: true });
  assert.equal(bundle.articles[0].unverified, true);
  assert.equal(bundle.warnings.length, 1);
  assert.throws(() => f.compile({ preview: true, complete: true }), /preview/i);
});

for (const [name, markdown, pattern] of [
  ["raw HTML", "# Submit a fixture\n\n<script>alert(1)</script>", /HTML/],
  // The refusal is what keeps unsanitized markup out of a guide, so it has to
  // hold for the casings an author could reach for, not only the usual one.
  ["upper-case raw HTML", "# Submit a fixture\n\n<SCRIPT>alert(1)</SCRIPT>", /HTML/],
  [
    "mixed-case inline raw HTML",
    "# Submit a fixture\n\nText <ImG SrC=x OnErRoR=alert(1)> more.",
    /HTML/,
  ],
  ["unsafe link", "# Submit a fixture\n\n[Open](javascript:alert%281%29)", /URL|link/i],
  ["remote image", "# Submit a fixture\n\n![Picture](https://example.com/x.png)", /image/i],
  ["path escape", "# Submit a fixture\n\n![Picture](../private.png)", /image|path/i],
  ["duplicate anchor", "# Submit a fixture\n\n## Again\n\n## Again", /duplicate/i],
  ["reserved reader anchor", "# Submit a fixture\n\n## Docs missing section", /reserved/i],
  ["heading skip", "# Submit a fixture\n\n### Skip", /heading/i],
  ["title mismatch", "# Another title", /title/i],
  ["missing anchor", "# Submit a fixture\n\n[Recovery](recover.md#absent)", /anchor/i],
  ["MDX", "# Submit a fixture\n\nexport const secret = 4;", /MDX/],
])
  test(`rejects ${name}`, (t) => {
    const f = fixture(t, { preview: true });
    f.articles[0].status = "draft";
    f.json("articles.json", {
      schemaVersion: 1,
      sections: [{ id: "start", title: "Start here" }],
      articles: f.articles,
    });
    writeFileSync(join(f.contentRoot, "submit.md"), markdown);
    assert.throws(() => f.compile(), pattern);
  });

test("rejects asset symlinks", (t) => {
  const f = fixture(t, { preview: true });
  f.articles[0].status = "draft";
  f.json("articles.json", {
    schemaVersion: 1,
    sections: [{ id: "start", title: "Start here" }],
    articles: f.articles,
  });
  mkdirSync(join(f.contentRoot, "assets"));
  writeFileSync(join(f.root, "private.png"), "secret");
  symlinkSync(join(f.root, "private.png"), join(f.contentRoot, "assets", "picture.png"));
  writeFileSync(
    join(f.contentRoot, "submit.md"),
    "# Submit a fixture\n\n![Picture](assets/picture.png)",
  );
  assert.throws(() => f.compile(), /symlink/i);
});

// The component walk approves names; the open decides what is read. These
// pin the second half, because a checker that approves one object and then
// reads another is the whole of the race these readers had to close.
test("an owned read refuses a symlink and reads through its own descriptor", (t) => {
  const root = mkdtempSync(join(tmpdir(), "openlaw-owned-test-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const real = join(root, "real.txt");
  writeFileSync(real, "owned bytes");
  assert.equal(readOwnedFile(real).toString("utf8"), "owned bytes");

  writeFileSync(join(root, "secret.txt"), "elsewhere");
  const link = join(root, "link.txt");
  symlinkSync(join(root, "secret.txt"), link);
  // lstat would also catch this. The point is that the kernel refuses it at
  // open, so nothing between a check and a read can put it back.
  assert.throws(() => readOwnedFile(link, "link.txt"), /symlink forbidden: link\.txt/);

  // A named pipe with no writer. Without the non-blocking open this call
  // never returns, so the assertion is that it answers at all.
  const pipe = join(root, "pipe");
  execFileSync("mkfifo", [pipe]);
  assert.throws(() => readOwnedFile(pipe, "pipe"), /not a file: pipe/);

  assert.throws(() => readOwnedFile(root, "root"), /not a file: root/);
});

test("readOwned refuses a source file replaced by a symlink", (t) => {
  const f = fixture(t);
  const guide = join(f.contentRoot, "submit.md");
  writeFileSync(join(f.root, "outside.md"), "# Submit a fixture\n\nSubstituted.\n");
  rmSync(guide);
  symlinkSync(join(f.root, "outside.md"), guide);
  assert.throws(() => f.compile(), /symlink/i);
});

test("rejects stale, incomplete, and non-independent verification", (t) => {
  const f = fixture(t);
  let e = f.evidence("submit");
  e.contentSha256 = "0".repeat(64);
  f.json("evidence/submit.json", e);
  assert.throws(() => f.compile(), /hash/i);
  e = f.evidence("submit");
  e.walkthroughReviewer = e.author;
  f.json("evidence/submit.json", e);
  assert.throws(() => f.compile(), /independent/i);
  e = f.evidence("submit");
  e.scenarios[0].method = "automated-test";
  f.json("evidence/submit.json", e);
  assert.throws(() => f.compile(), /scenario/i);
  e = f.evidence("submit");
  f.json("evidence/submit.json", e);
  assert.throws(
    () =>
      f.compile({
        build: { commit: "c".repeat(40), dirty: false, applicationSha256: "d".repeat(64) },
      }),
    /compatibility/i,
  );
});

test("verification timestamps reject impossible calendar dates", (t) => {
  const f = fixture(t);
  for (const reviewedAt of [
    "2026-02-30T00:00:00Z",
    "2025-02-29T12:00:00+04:00",
    "2026-04-31T00:00:00Z",
  ]) {
    f.json("edition.json", {
      ...f.edition,
      compatibilityReview: { ...f.edition.compatibilityReview, reviewedAt },
    });
    assert.throws(() => f.compile(), /compatibility/, reviewedAt);
  }
  for (const reviewedAt of ["2024-02-29T23:00:00-04:00", "2026-09-06T00:00:00.123456Z"]) {
    f.json("edition.json", {
      ...f.edition,
      compatibilityReview: { ...f.edition.compatibilityReview, reviewedAt },
    });
    assert.doesNotThrow(() => f.compile(), reviewedAt);
  }
});

test("historical walkthroughs require a current, hash-bound compatibility review", (t) => {
  const f = fixture(t);
  const e = f.evidence("submit");
  e.appCommit = "c".repeat(40);
  f.json("evidence/submit.json", e);
  assert.throws(() => f.compile(), /app build mismatch/);
  const report = { summary: "Fixture source comparison; changed actions were rerun." };
  f.json("evidence/compatibility.json", report);
  const review = {
    fromAppCommit: e.appCommit,
    toAppCommit: commit,
    contentSha256: e.contentSha256,
    applicationSha256: digest,
    reviewer: "Fixture compatibility reviewer",
    reviewerKind: "agent",
    reviewedAt: "2026-09-06T01:00:00Z",
    summary: "Fixture source comparison with referenced affected-action evidence.",
    evidence: [
      {
        path: "evidence/compatibility.json",
        sha256: createHash("sha256").update(JSON.stringify(report)).digest("hex"),
      },
    ],
  };
  e.compatibilityReview = review;
  f.json("evidence/submit.json", e);
  assert.equal(f.compile().bundle.articles.length, 2);
  for (const patch of [
    { fromAppCommit: commit },
    { toAppCommit: "d".repeat(40) },
    { contentSha256: "0".repeat(64) },
    { applicationSha256: "0".repeat(64) },
    { reviewer: "" },
    { reviewerKind: "unknown" },
    { reviewedAt: "2026-09-05T00:00:00Z" },
    { summary: "" },
    { evidence: [] },
    { evidence: [{ path: "../outside.json", sha256: "0".repeat(64) }] },
  ]) {
    f.json("evidence/submit.json", { ...e, compatibilityReview: { ...review, ...patch } });
    assert.throws(() => f.compile(), /compatibility|outside source tree/);
  }
  f.json("evidence/submit.json", {
    ...e,
    compatibilityReview: { ...review, reviewer: ` ${e.author.toUpperCase()} ` },
  });
  assert.throws(() => f.compile(), /independent compatibility review/);
  f.json("evidence/submit.json", e);
  f.json("evidence/compatibility.json", { summary: "Changed after review" });
  assert.throws(() => f.compile(), /compatibility evidence hash/);
  f.json("evidence/compatibility.json", report);
  f.json("edition.json", {
    ...f.edition,
    supportedAppCommit: null,
    compatibilityReview: { ...f.edition.compatibilityReview, testedAppCommit: null },
  });
  f.json("evidence/submit.json", { ...e, compatibilityReview: { ...review, toAppCommit: null } });
  assert.throws(() => f.compile(), /article compatibility/);
  f.json("edition.json", f.edition);
  e.scenarios[0].method = "automated-test";
  f.json("evidence/submit.json", e);
  assert.throws(() => f.compile(), /missing scenario/);
  assert.throws(() => f.compile({ complete: true }), /missing scenario/);
});

test("redirects preserve anchors and reject loops, duplicates, and missing targets", (t) => {
  const f = fixture(t);
  f.json("redirects.json", {
    schemaVersion: 1,
    redirects: [
      { from: "old", to: "submit" },
      { from: "submit#previous", to: "submit#submit" },
    ],
  });
  let { bundle, files } = f.compile();
  assert.equal(
    resolveDocumentationLink(bundle, "old", "#before-you-start"),
    "submit#before-you-start",
  );
  assert.equal(resolveDocumentationLink(bundle, "submit", "#previous"), "submit#submit");
  assert.match(files.get("old.html"), /submit.html/);
  for (const redirects of [
    [
      { from: "a", to: "b" },
      { from: "b", to: "a" },
    ],
    [
      { from: "old", to: "submit" },
      { from: "old", to: "recover" },
    ],
    [{ from: "old", to: "missing" }],
  ]) {
    f.json("redirects.json", { schemaVersion: 1, redirects });
    assert.throws(() => f.compile(), /redirect/i);
  }
});

test("complete publication needs matching final discovery/offline evidence", (t) => {
  const f = fixture(t);
  const { bundle } = f.compile();
  assert.throws(() => f.compile({ complete: true }), /publication.json/);
  f.json("evidence/publication.json", {
    editionId: f.edition.id,
    contentDigest: bundle.edition.contentDigest,
    appCommit: commit,
    status: "pass",
    reviewer: "Fixture reviewer",
    reviewedAt: "2026-09-06T00:00:00Z",
    scenarios: [],
  });
  assert.equal(f.compile({ complete: true }).bundle.report.verified, 2);
  f.json("evidence/publication.json", {
    editionId: f.edition.id,
    contentDigest: "0".repeat(64),
    appCommit: commit,
    status: "pass",
    reviewer: "Fixture reviewer",
    reviewedAt: "2026-09-06T00:00:00Z",
    scenarios: [],
  });
  assert.throws(() => f.compile({ complete: true }), /stale/);
});

test("rejects malformed discovery/scenario metadata and reserved redirect paths", (t) => {
  const f = fixture(t);
  f.articles[0].audiences = ["made-up-role"];
  f.json("articles.json", {
    schemaVersion: 1,
    sections: [{ id: "start", title: "Start here" }],
    articles: f.articles,
  });
  assert.throws(() => f.compile(), /audiences/);
  f.articles[0].audiences = ["business_user"];
  f.json("articles.json", {
    schemaVersion: 1,
    sections: [{ id: "start", title: "Start here" }],
    articles: f.articles,
  });
  f.json("redirects.json", { schemaVersion: 1, redirects: [{ from: "index", to: "submit" }] });
  assert.throws(() => f.compile(), /reserved redirect/);
  f.json("redirects.json", {
    schemaVersion: 1,
    redirects: [{ from: "retired#section", to: "submit#submit" }],
  });
  assert.throws(() => f.compile(), /source page/);
});

test("code examples can contain shell exports without becoming MDX", (t) => {
  const f = fixture(t, { preview: true });
  f.articles[0].status = "draft";
  f.json("articles.json", {
    schemaVersion: 1,
    sections: [{ id: "start", title: "Start here" }],
    articles: f.articles,
  });
  writeFileSync(
    join(f.contentRoot, "submit.md"),
    "# Submit a fixture\n\n```sh\nexport EXAMPLE=fictional\n```\n",
  );
  assert.match(f.compile().bundle.articles[0].html.formal, /export EXAMPLE=fictional/);
});

test("standalone redirects include cross-page anchor moves and remain readable without scripts", (t) => {
  const f = fixture(t);
  f.json("redirects.json", {
    schemaVersion: 1,
    redirects: [{ from: "submit#older-section", to: "recover#retry" }],
  });
  const { files } = f.compile();
  assert.match(files.get("submit.html"), /id="older-section"/);
  assert.match(files.get("submit.html"), /href="recover.html#retry"/);
  assert.match(files.get("redirect.js"), /resolveDocumentationLink/);
});

test("every local link the retained edition writes names a page it contains", (t) => {
  const f = fixture(t);
  // The edition writes redirect targets in three places: the whole-article
  // moved page, the moved-section link inside an article, and the script that
  // follows a fragment. It builds its pages from the formal articles, so a
  // redirect naming an article it left out would dangle.
  f.json("redirects.json", {
    schemaVersion: 1,
    redirects: [
      { from: "old-submit", to: "submit" },
      { from: "submit#older-section", to: "recover#retry" },
    ],
  });
  const { bundle, files } = f.compile();
  assert.match(files.get("old-submit.html"), /href="submit.html"/);
  assert.match(files.get("submit.html"), /href="recover.html#retry"/);
  for (const r of bundle.redirects) {
    const resolved = resolveDocumentationLink(bundle, r.from);
    assert.ok(resolved, `redirect loop: ${r.from}`);
    assert.ok(files.has(`${resolved.split("#")[0]}.html`), `${r.from} leaves the edition`);
  }
  const hrefs = new Set(
    [...files]
      .filter(([name]) => name.endsWith(".html"))
      .flatMap(([, html]) => [...html.matchAll(/href="([a-z\d-]+\.html)(?:#[a-z\d-]+)?"/g)])
      .map((m) => m[1]),
  );
  assert.ok(hrefs.size > 3);
  for (const href of hrefs) assert.ok(files.has(href), `dangling link to ${href}`);
  // Nothing can become a redirect target without a page, because the
  // catalogue refuses an article that leaves the formal destination out.
  f.articles[1].destinations = ["staff-help"];
  f.json("articles.json", {
    schemaVersion: 1,
    sections: [{ id: "start", title: "Start here" }],
    articles: f.articles,
  });
  assert.throws(() => f.compile(), /formal destination required: recover/);
});

test("validation fixtures require an explicit preview", () => {
  assert.throws(() => compileWorkspace({ fixture: true, preview: false }), /preview/i);
});

test("injected build identities require an explicit working-tree declaration", () => {
  const previousCommit = process.env.OPENLAW_BUILD_COMMIT;
  const previousDirty = process.env.OPENLAW_BUILD_DIRTY;
  try {
    process.env.OPENLAW_BUILD_COMMIT = commit;
    delete process.env.OPENLAW_BUILD_DIRTY;
    assert.throws(() => buildIdentity(), /OPENLAW_BUILD_DIRTY/);
    process.env.OPENLAW_BUILD_DIRTY = "unknown";
    assert.throws(() => buildIdentity(), /OPENLAW_BUILD_DIRTY/);
    process.env.OPENLAW_BUILD_DIRTY = "true";
    assert.equal(buildIdentity().dirty, true);
    process.env.OPENLAW_BUILD_DIRTY = "false";
    assert.equal(buildIdentity().dirty, false);
  } finally {
    if (previousCommit === undefined) delete process.env.OPENLAW_BUILD_COMMIT;
    else process.env.OPENLAW_BUILD_COMMIT = previousCommit;
    if (previousDirty === undefined) delete process.env.OPENLAW_BUILD_DIRTY;
    else process.env.OPENLAW_BUILD_DIRTY = previousDirty;
  }
});

test("the application digest ignores generated test and build output", (t) => {
  const root = mkdtempSync(join(tmpdir(), "openlaw-digest-test-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  for (const directory of ["apps/api/src", "packages", "styles"])
    mkdirSync(join(root, directory), { recursive: true });
  for (const file of [
    "package.json",
    "pnpm-lock.yaml",
    "pnpm-workspace.yaml",
    "tsconfig.base.json",
  ])
    writeFileSync(join(root, file), "{}");
  writeFileSync(join(root, "apps/api/src/app.ts"), "export const app = 1;");
  const clean = applicationDigest(root);
  mkdirSync(join(root, "apps/api/coverage"));
  writeFileSync(join(root, "apps/api/coverage/lcov.info"), "TN:");
  writeFileSync(join(root, "apps/api/tsconfig.tsbuildinfo"), "{}");
  writeFileSync(join(root, "apps/api/.env"), "SECRET=1");
  assert.equal(applicationDigest(root), clean);
  writeFileSync(join(root, "apps/api/src/app.ts"), "export const app = 2;");
  assert.notEqual(applicationDigest(root), clean);
});

test("combined Help topics prefer specific matches and retain all-word audience filtering", (t) => {
  const f = fixture(t);
  const { bundle } = f.compile();
  bundle.contexts.push("support");
  bundle.articles.find((a) => a.id === "recover").contexts = ["support"];
  const topics = ["unknown", "portal.submit", "support"];
  assert.deepEqual(
    searchDocumentation(bundle, { topics }).map((a) => a.id),
    ["submit", "recover"],
  );
  assert.deepEqual(
    searchDocumentation(bundle, { topics, query: "fictional paper" }).map((a) => a.id),
    ["submit"],
  );
  assert.deepEqual(searchDocumentation(bundle, { topics, audience: "contributor" }), []);
  assert.deepEqual(searchDocumentation(bundle, { topics, destination: "staff-help" }), []);
});
