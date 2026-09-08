// SPDX-License-Identifier: AGPL-3.0-only
import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { createHash } from "node:crypto";
import { documentationStatus } from "./status.mjs";
import { compileDocumentation } from "./compiler.mjs";

const commit = "a".repeat(40);
const digest = "b".repeat(64);
function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), "openlaw-docs-status-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const put = (path, value) => {
    const file = join(root, path);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, typeof value === "string" ? value : JSON.stringify(value));
  };
  const articles = ["account", "provider"].map((id, i) => ({
    id,
    title: id,
    section: "start",
    kind: "how-to",
    coverage: [i ? "C42" : "C01"],
    ownerTask: "DOC-001",
    audiences: ["administrator"],
    destinations: ["formal", "staff-help"],
    priority: "P0",
    contexts: ["start"],
    status: "review",
  }));
  const scenarios = articles.map((a, i) => ({
    id: `V-${a.id}`,
    articles: [a.id],
    coverage: a.coverage,
    roles: a.audiences,
    requiredMethods: i ? ["browser-walkthrough", "live-provider-check"] : ["browser-walkthrough"],
    status: "not-run",
  }));
  scenarios.push({
    id: "V-HELP",
    articles: [],
    coverage: ["C01"],
    roles: ["anonymous"],
    requiredMethods: ["browser-walkthrough"],
    status: "blocked",
  });
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
      reviewer: "Fixture source reviewer",
      reviewedAt: "2026-09-06T00:00:00Z",
      summary: "Test fixture only",
    },
  };
  const metadata = "docs/documentation/";
  put(metadata + "articles.json", {
    schemaVersion: 1,
    sections: [{ id: "start", title: "Start" }],
    articles,
  });
  put(metadata + "scenarios.json", { schemaVersion: 1, scenarios });
  put(metadata + "edition.json", edition);
  put(metadata + "redirects.json", { schemaVersion: 1, redirects: [] });
  put(metadata + "help-contexts.json", {
    schemaVersion: 1,
    bindings: [{ routes: ["*"], contexts: ["start"], surface: "both", pilotEntry: false }],
  });
  put(metadata + "proof.txt", "Unit fixture only; not a product walkthrough.");
  const evidence = {};
  for (const a of articles) {
    const source = `# ${a.title}\n\nTest fixture only.\n`;
    put(`docs/user-guides/${a.id}.md`, source);
    evidence[a.id] = {
      articleId: a.id,
      contentSha256: createHash("sha256").update(source).digest("hex"),
      appCommit: commit,
      buildId: "fixture",
      environment: "fixture",
      author: "Fixture author",
      technicalReviewer: "Fixture technical reviewer",
      walkthroughReviewer: "Fixture independent reader",
      reviewerKind: "agent",
      verifiedAt: "2026-09-06T00:00:00Z",
      status: "pass",
      sources: [metadata + "proof.txt"],
      scenarios: [
        {
          id: `V-${a.id}`,
          coverage: a.coverage,
          role: "administrator",
          method: "browser-walkthrough",
          result: "pass",
          expected: "Fixture expected",
          actual: "Fixture observed",
          evidence: [metadata + "proof.txt"],
        },
      ],
    };
    put(metadata + `evidence/${a.id}.json`, evidence[a.id]);
  }
  return {
    root,
    put,
    articles,
    scenarios,
    evidence,
    metadata,
    status: (build = {}) =>
      documentationStatus({
        root,
        build: { commit, applicationSha256: digest, dirty: false, ...build },
      }),
  };
}

test("provider browser evidence cannot satisfy the live-provider denominator", (t) => {
  const f = fixture(t),
    result = f.status();
  assert.equal(result.counts.articles, 2);
  assert.equal(result.counts.articlesWithValidEvidence, 1);
  assert.equal(result.counts.coverageGroups, 2);
  assert.equal(result.counts.groupsWithValidArticleEvidence, 1);
  assert.equal(result.counts.requiredArticleRoleMethods, 3);
  assert.equal(result.counts.creditedArticleRoleMethods, 1);
  assert.equal(result.counts.requiredSharedRoleMethods, 1);
  assert.equal(result.completePublication.pass, false);
  assert.match(result.articles.find((a) => a.id === "provider").error, /live-provider-check/);
});

test("a changed guide or missing retained observation stops evidence credit", (t) => {
  const f = fixture(t);
  f.put("docs/user-guides/account.md", "# account\n\nChanged instructions.\n");
  assert.equal(f.status().counts.articlesWithValidEvidence, 0);
  assert.match(f.status().articles[0].error, /hash/);
  f.put("docs/user-guides/account.md", "# account\n\nTest fixture only.\n");
  rmSync(join(f.root, f.metadata + "proof.txt"));
  assert.equal(f.status().counts.articlesWithValidEvidence, 0);
  assert.match(f.status().articles[0].error, /missing file/);
});

test("a coverage group requires every mapped article and every required role", (t) => {
  const f = fixture(t);
  f.articles[1].coverage = ["C01"];
  f.scenarios[1].coverage = ["C01"];
  f.put(f.metadata + "articles.json", {
    schemaVersion: 1,
    sections: [{ id: "start", title: "Start" }],
    articles: f.articles,
  });
  f.put(f.metadata + "scenarios.json", { schemaVersion: 1, scenarios: f.scenarios });
  assert.equal(f.status().counts.groupsWithValidArticleEvidence, 0);
  f.scenarios[0].roles.push("contributor");
  f.put(f.metadata + "scenarios.json", { schemaVersion: 1, scenarios: f.scenarios });
  assert.match(f.status().articles[0].error, /contributor/);
});

test("current article evidence does not imply current distribution or publication", (t) => {
  const f = fixture(t),
    result = f.status({ applicationSha256: "c".repeat(64) });
  assert.equal(result.counts.articlesWithValidEvidence, 1);
  assert.equal(result.distributionReview.pass, false);
  assert.equal(result.counts.catalogVerifiedOrPublished, 0);
  assert.equal(result.completePublication.pass, false);
});

test("malformed requirements cannot shrink the role/method denominator", (t) => {
  const f = fixture(t);
  f.scenarios[1].requiredMethods = [];
  f.put(f.metadata + "scenarios.json", { schemaVersion: 1, scenarios: f.scenarios });
  assert.throws(() => f.status(), /scenario methods required/);
});

test("publication needs the matching complete-edition record and retained shared observations", (t) => {
  const f = fixture(t);
  f.evidence.provider.scenarios.push({
    ...f.evidence.provider.scenarios[0],
    method: "live-provider-check",
  });
  f.put(f.metadata + "evidence/provider.json", f.evidence.provider);
  for (const a of f.articles) a.status = "verified";
  f.put(f.metadata + "articles.json", {
    schemaVersion: 1,
    sections: [{ id: "start", title: "Start" }],
    articles: f.articles,
  });
  assert.equal(f.status().counts.articlesWithValidEvidence, 2);
  assert.match(f.status().completePublication.error, /publication.json/);
  const compiled = compileDocumentation({
    contentRoot: join(f.root, "docs/user-guides"),
    metadataRoot: join(f.root, f.metadata),
    build: { commit, applicationSha256: digest, dirty: false },
  });
  f.put(f.metadata + "publication-proof.txt", "Fixture shared observation, not product evidence.");
  f.put(f.metadata + "evidence/publication.json", {
    editionId: "fixture",
    contentDigest: compiled.bundle.edition.contentDigest,
    appCommit: commit,
    status: "pass",
    reviewer: "Fixture independent reader",
    reviewedAt: "2026-09-06T00:00:00Z",
    scenarios: [
      {
        id: "V-HELP",
        role: "anonymous",
        method: "browser-walkthrough",
        result: "pass",
        actual: "Fixture checked",
        evidence: [f.metadata + "publication-proof.txt"],
      },
    ],
  });
  assert.equal(f.status().completePublication.pass, true);
  const record = JSON.parse(readFileSync(join(f.root, f.metadata + "evidence/publication.json")));
  for (const broken of [undefined, [], "publication-proof.txt", [""]]) {
    f.put(f.metadata + "evidence/publication.json", {
      ...record,
      scenarios: [...record.scenarios, { id: "V-NOTE", evidence: broken }],
    });
    assert.match(f.status().completePublication.error, /V-NOTE records no usable/, String(broken));
  }
  f.put(f.metadata + "evidence/publication.json", record);
  rmSync(join(f.root, f.metadata + "publication-proof.txt"));
  assert.equal(f.status().completePublication.pass, false);
  assert.match(f.status().completePublication.error, /missing file/);
});
