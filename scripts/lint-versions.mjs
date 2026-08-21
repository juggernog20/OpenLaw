/* OpenLaw — one version, checked (#391).
 *
 * The product's version is written down ten times: once in the root
 * `package.json`, once in each of the eight workspace members', and once
 * more as `OPENLAW_VERSION` in `packages/shared/src/index.ts` — the
 * constant `GET /api/v1/meta` answers and the OpenAPI document carries.
 * Nothing kept them in step, so a release bump that missed one would
 * ship an install that reports a version it is not. The root manifest is
 * the source of truth, so this checks the other nine against it.
 *
 * Generating the constant instead was the other option and was declined.
 * `@openlaw/shared` is bundled into the browser, so the value has to be
 * a literal in the source rather than a file read at runtime, and its
 * tsconfig has `rootDir: "src"`, so importing the package's own
 * `package.json` would move the whole build's output layout. What is
 * left is a generated file that is committed — and a committed
 * generated file needs a CI check that it is current, which is this
 * check plus a build step. So: keep the literal, and make the drift
 * loud.
 *
 * The root `package.json` is the source of truth. Every other place
 * quotes it.
 *
 * Runs standalone (`pnpm lint:versions`) and inside `pnpm check`.
 */

import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));

/** Where the constant lives, and the shape it is declared in. */
const sharedIndex = join("packages", "shared", "src", "index.ts");
const constantPattern = /^export const OPENLAW_VERSION = "([^"]*)";$/m;

function fail(lines) {
  console.error("versions: the product version is not written the same way everywhere");
  for (const line of lines) console.error(`  ${line}`);
  console.error("The root package.json is the source of truth — bring the rest to it.");
  process.exit(1);
}

function readJson(relativePath) {
  return JSON.parse(readFileSync(join(repoRoot, relativePath), "utf8"));
}

/**
 * The workspace members, read from `pnpm-workspace.yaml` rather than
 * listed here, so a package added later is checked without anybody
 * remembering to. The file is a short fixed-shape list, so it is parsed
 * line by line rather than by pulling in a YAML dependency for it; a
 * shape this does not understand is a failure, never a silent skip.
 */
function workspaceMembers() {
  const text = readFileSync(join(repoRoot, "pnpm-workspace.yaml"), "utf8");
  const block = /^packages:\n((?:[ \t]+-[^\n]*\n)+)/m.exec(text);
  if (!block) fail(['pnpm-workspace.yaml has no "packages:" list this script can read']);
  const patterns = [...block[1].matchAll(/^[ \t]+-[ \t]*"?([^"\n]+?)"?[ \t]*$/gm)].map(
    (match) => match[1],
  );
  if (patterns.length === 0) fail(["pnpm-workspace.yaml lists no packages"]);

  const members = [];
  for (const pattern of patterns) {
    if (!pattern.includes("*")) {
      members.push(pattern);
      continue;
    }
    // Only the one glob shape the file uses. Anything else would need a
    // matcher, and guessing wrong would quietly check fewer packages
    // than the workspace has.
    const parent = /^([^*]+)\/\*$/.exec(pattern);
    if (!parent) fail([`pnpm-workspace.yaml pattern ${pattern} is not "<dir>/*" — teach me it`]);
    for (const entry of readdirSync(join(repoRoot, parent[1]), { withFileTypes: true })) {
      if (entry.isDirectory()) members.push(`${parent[1]}/${entry.name}`);
    }
  }
  return members.sort();
}

const expected = readJson("package.json").version;
if (typeof expected !== "string" || expected.length === 0) {
  fail(['the root package.json has no "version"']);
}

const wrong = [];

for (const member of workspaceMembers()) {
  const manifest = `${member}/package.json`;
  const found = readJson(manifest).version;
  if (found !== expected) {
    wrong.push(`${manifest} says ${JSON.stringify(found)}, not ${JSON.stringify(expected)}`);
  }
}

const constant = constantPattern.exec(readFileSync(join(repoRoot, sharedIndex), "utf8"));
if (!constant) {
  wrong.push(
    `${sharedIndex} has no \`export const OPENLAW_VERSION = "…";\` line — ` +
      "the meta route reads it, so it has to be there in that shape",
  );
} else if (constant[1] !== expected) {
  wrong.push(
    `${sharedIndex} declares OPENLAW_VERSION as ${JSON.stringify(constant[1])}, ` +
      `not ${JSON.stringify(expected)}`,
  );
}

if (wrong.length > 0) fail(wrong);

console.log(`versions: every package.json and OPENLAW_VERSION say ${expected} (#391)`);
