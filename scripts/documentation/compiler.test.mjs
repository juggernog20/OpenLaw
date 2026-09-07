// SPDX-License-Identifier: AGPL-3.0-only
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { test } from "node:test";
import { applicationDigest, buildIdentity, compileWorkspace } from "./build.mjs";
import { compileDocumentation } from "./compiler.mjs";
import { searchDocumentation, resolveDocumentationLink } from "./reader.mjs";

const commit = "a".repeat(40);
const digest = "b".repeat(64);
const text =
  "# Submit a fixture\n\nA validation fixture, not product instructions.\n\n## Before you start\n\nUse fictional paper.\n\n## Submit\n\n1. Open the fixture.\n2. Review the result.\n\n[Recovery](recover.md#retry)\n\n```sh\nprintf '<script>literal</script>'\n```\n";
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
    assert.doesNotMatch(html, /<script>/);
    assert.match(html, /&lt;script&gt;/);
  }
  assert.equal(a.outline[1].id, "before-you-start");
  assert.equal(searchDocumentation(bundle, { query: "PAPER fictional" })[0].id, "submit");
  assert.deepEqual(searchDocumentation(bundle, { query: "paper absent" }), []);
  assert.equal(searchDocumentation(bundle, { destination: "staff-help" }).length, 0);
  assert.match(files.get("index.html"), /submit.html/);
  assert.match(files.get("submit.html"), /Open the fixture/);
  assert.doesNotMatch(files.get("search.js"), /\bfetch\s*\(/);
  // Retained copies open in older browsers; URLSearchParams.size is too new for them.
  assert.doesNotMatch(files.get("search.js"), /\.size\b/);
  assert.doesNotMatch(JSON.stringify(bundle), /Fixture author|fixture observation/);
  assert.equal(bundle.report.verified, 2);
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
