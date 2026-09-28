// SPDX-License-Identifier: AGPL-3.0-only
// DOC-032: shows that the strict build fails only on owner-gated publication
// decisions. Each run copies docs/ to a temporary directory, applies one
// hypothetical owner decision to that copy, and compiles it. Nothing in the
// repository changes, and no approval is recorded.
//
// Run from the repository root:
//   node docs/documentation/batches/DOC-032/owner-options.mjs
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { cpSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const repo = process.cwd();
const { compileDocumentation } = await import(join(repo, "scripts/documentation/compiler.mjs"));
const { buildIdentity } = await import(join(repo, "scripts/documentation/build.mjs"));
const build = { ...buildIdentity(repo), dirty: false };
const sha = (path) => createHash("sha256").update(readFileSync(path)).digest("hex");
const VENDOR = ["connect-chatgpt", "connect-microsoft-365-copilot"];
const BLOCKED = ["electronic-signing", "configure-signing", "connect-claude"];
const APPROVED_SOURCE = "c0ce728ca319af3d7fada3e19a5d07b27a015577";

function run(label, mutate) {
  const copy = join(tmpdir(), "openlaw-owner-options");
  rmSync(copy, { recursive: true, force: true });
  cpSync(join(repo, "docs"), copy, { recursive: true });
  const editionPath = join(copy, "documentation/edition.json");
  const edition = JSON.parse(readFileSync(editionPath, "utf8"));
  mutate(edition, copy);
  writeFileSync(editionPath, JSON.stringify(edition));
  try {
    const { bundle } = compileDocumentation({
      contentRoot: join(copy, "user-guides"),
      metadataRoot: join(copy, "documentation"),
      build,
    });
    console.log(`${label}: OK ${JSON.stringify(bundle.report)}`);
  } catch (error) {
    console.log(`${label}: FAIL ${error.message}`);
  } finally {
    rmSync(copy, { recursive: true, force: true });
  }
}

const reapproveVendor = (edition, copy) => {
  for (const entry of edition.publication.articles)
    entry.contentSha256 = sha(join(copy, "user-guides", `${entry.id}.md`));
};
const revertVendor = (edition, copy) => {
  for (const id of VENDOR)
    writeFileSync(
      join(copy, "user-guides", `${id}.md`),
      execFileSync("git", ["-C", repo, "show", `${APPROVED_SOURCE}:docs/user-guides/${id}.md`]),
    );
};
const publishBlocked = (edition, copy) => {
  for (const id of BLOCKED)
    edition.publication.articles.push({
      id,
      contentSha256: sha(join(copy, "user-guides", `${id}.md`)),
    });
};

run("As committed", () => {});
run("Re-approve the two vendor guides only", reapproveVendor);
run("Publish the three blocked guides only", publishBlocked);
run("Re-approve the vendor guides and publish the three blocked guides", (e, c) => {
  reapproveVendor(e, c);
  publishBlocked(e, c);
});
run("Revert the vendor guides to the approved bytes and publish the three", (e, c) => {
  revertVendor(e, c);
  publishBlocked(e, c);
});
