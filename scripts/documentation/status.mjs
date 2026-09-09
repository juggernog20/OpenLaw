// SPDX-License-Identifier: AGPL-3.0-only
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { buildIdentity, repository } from "./build.mjs";
import {
  ID as ARTICLE_ID,
  compileDocumentation,
  readOwned,
  validateCatalog,
  verifyApplicationCompatibility,
  verifyArticleEvidence,
} from "./compiler.mjs";

const countBy = (values) =>
  values.reduce((counts, value) => ({ ...counts, [value]: (counts[value] ?? 0) + 1 }), {});
const isPath = (value) => typeof value === "string" && value.trim().length > 0;
const retained = (root, scenarios, label) => {
  for (const scenario of scenarios) {
    const references = scenario?.evidence;
    if (!Array.isArray(references) || references.length === 0 || !references.every(isPath))
      throw new Error(`${label} scenario ${scenario?.id} records no usable evidence reference`);
    for (const reference of references) readOwned(root, reference.split("#")[0]);
  }
};
const check = (run) => {
  try {
    run();
    return { pass: true, error: null };
  } catch (error) {
    return { pass: false, error: error.message };
  }
};

/** Reads current evidence without changing catalog states or granting release acceptance. */
export function documentationStatus({ root = repository, build = buildIdentity(root) } = {}) {
  const metadataRoot = join(root, "docs/documentation"),
    contentRoot = join(root, "docs/user-guides"),
    json = (name) => JSON.parse(readOwned(metadataRoot, name).toString("utf8")),
    catalog = json("articles.json"),
    scenarios = json("scenarios.json").scenarios,
    edition = json("edition.json");
  validateCatalog(catalog, scenarios, json("help-contexts.json").bindings);
  const articles = catalog.articles.map((article) => {
    const required = scenarios.filter((s) => s.articles.includes(article.id));
    const requiredRoleMethods = required.reduce(
      (count, s) => count + s.roles.length * s.requiredMethods.length,
      0,
    );
    const evidence = check(() => {
      if (!ARTICLE_ID.test(article.id)) throw new Error("Invalid article ID");
      const record = verifyArticleEvidence(
        article,
        readOwned(contentRoot, `${article.id}.md`),
        metadataRoot,
        edition,
        scenarios,
      );
      retained(root, record.scenarios, "Article");
    });
    return {
      id: article.id,
      priority: article.priority,
      coverage: article.coverage,
      ownerTask: article.ownerTask,
      catalogStatus: article.status,
      requiredRoleMethods,
      ...evidence,
    };
  });
  const coverage = [...new Set(articles.flatMap((a) => a.coverage))].sort().map((id) => {
    const mapped = articles.filter((a) => a.coverage.includes(id));
    return {
      id,
      priority: mapped.some((a) => a.priority === "P0") ? "P0" : "P1",
      articles: mapped.map((a) => a.id),
      articleEvidencePass: mapped.every((a) => a.pass),
      catalogVerifiedOrPublished: mapped.every((a) =>
        ["verified", "published"].includes(a.catalogStatus),
      ),
    };
  });
  const shared = scenarios
    .filter((s) => s.articles.length === 0)
    .map((s) => ({
      id: s.id,
      declaredStatus: s.status,
      requiredRoleMethods: s.roles.length * s.requiredMethods.length,
    }));
  const distributionReview = check(() => verifyApplicationCompatibility(edition, build));
  // TECH-027 lets the owner publish named unverified sources. Nothing else in this
  // report distinguishes an edition that ships nothing from one that ships the whole
  // suite with its verification outstanding, so the decision is reported on its own.
  const developmentPublication = edition.publication
    ? {
        status: edition.publication.status,
        approvedAt: edition.publication.approvedAt,
        sourceCommit: edition.publication.sourceCommit,
        articles: (edition.publication.articles ?? []).map((a) => a.id),
      }
    : null;
  const completePublication = check(() => {
    const incomplete = articles.find((a) => !a.pass);
    if (incomplete) throw new Error(`Article evidence is incomplete: ${incomplete.id}`);
    compileDocumentation({ contentRoot, metadataRoot, build, complete: true });
    const publication = json("evidence/publication.json").scenarios;
    if (!Array.isArray(publication)) throw new Error("Publication scenarios required");
    retained(root, publication, "Publication");
  });
  return {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    editionId: edition.id,
    supportedAppCommit: edition.supportedAppCommit,
    distribution: build,
    counts: {
      articles: articles.length,
      articlesWithValidEvidence: articles.filter((a) => a.pass).length,
      catalogStates: countBy(articles.map((a) => a.catalogStatus)),
      catalogVerifiedOrPublished: articles.filter((a) =>
        ["verified", "published"].includes(a.catalogStatus),
      ).length,
      coverageGroups: coverage.length,
      groupsWithValidArticleEvidence: coverage.filter((c) => c.articleEvidencePass).length,
      requiredArticleRoleMethods: articles.reduce((n, a) => n + a.requiredRoleMethods, 0),
      creditedArticleRoleMethods: articles
        .filter((a) => a.pass)
        .reduce((n, a) => n + a.requiredRoleMethods, 0),
      requiredSharedRoleMethods: shared.reduce((n, s) => n + s.requiredRoleMethods, 0),
    },
    priorities: Object.fromEntries(
      ["P0", "P1"].map((priority) => {
        const rows = coverage.filter((c) => c.priority === priority);
        return [
          priority,
          {
            required: rows.length,
            articleEvidencePass: rows.filter((c) => c.articleEvidencePass).length,
          },
        ];
      }),
    ),
    distributionReview,
    developmentPublication,
    completePublication,
    sharedScenarios: shared,
    articles,
    coverage,
    notes: [
      "Evidence counts use the compiler's article checks and retained local scenario references. Only complete valid articles receive role/method credit.",
      "Evidence validity, catalog state, distribution compatibility and complete publication are separate results. This report runs no reader walkthroughs and changes no status.",
      "Fully verified release publication requires valid retained article evidence and the complete-suite compiler gate. Owner-authorized development publication does not grant evidence credit.",
    ],
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    if (process.argv.length !== 2) throw new Error("Usage: node scripts/documentation/status.mjs");
    console.log(JSON.stringify(documentationStatus(), null, 2));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
