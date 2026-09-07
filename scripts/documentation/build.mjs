// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Builds the versioned documentation and its retained export. TECH-026 separates
 * the tested app identity from the current distribution commit.
 */
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { compileDocumentation } from "./compiler.mjs";

export const repository = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

/** The same source bytes are available in a checkout and the Docker build context. */
export function applicationDigest(root = repository) {
  const hash = createHash("sha256");
  function visit(relative) {
    const path = join(root, relative),
      stat = lstatSync(path);
    if (stat.isSymbolicLink()) throw new Error(`Application source symlink: ${relative}`);
    if (stat.isDirectory())
      for (const name of readdirSync(path).sort()) {
        if (["node_modules", "dist", ".turbo", ".git"].includes(name) || name.startsWith(".env"))
          continue;
        visit(`${relative}/${name}`);
      }
    else if (stat.isFile()) {
      const bytes = readFileSync(path);
      hash.update(`${relative}\0${bytes.length}\0`);
      hash.update(bytes);
    }
  }
  for (const path of [
    "apps",
    "packages",
    "styles",
    "package.json",
    "pnpm-lock.yaml",
    "pnpm-workspace.yaml",
    "tsconfig.base.json",
  ])
    visit(path);
  return hash.digest("hex");
}

export function buildIdentity(root = repository) {
  let commit = process.env.OPENLAW_BUILD_COMMIT || null;
  if (commit && !["true", "false"].includes(process.env.OPENLAW_BUILD_DIRTY)) {
    throw new Error(
      "OPENLAW_BUILD_DIRTY must explicitly be true or false with OPENLAW_BUILD_COMMIT.",
    );
  }
  let dirty = process.env.OPENLAW_BUILD_DIRTY === "true";
  if (!commit && existsSync(join(root, ".git"))) {
    commit = execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim();
    dirty = Boolean(
      execFileSync("git", ["status", "--porcelain"], { cwd: root, encoding: "utf8" }).trim(),
    );
  }
  if (commit && !/^[a-f0-9]{40}$/.test(commit))
    throw new Error("OPENLAW_BUILD_COMMIT must be a full source commit.");
  return { commit, dirty, applicationSha256: applicationDigest(root) };
}

export function compileWorkspace({
  preview = process.env.OPENLAW_DOCS_PREVIEW === "true",
  fixture = process.env.OPENLAW_DOCS_FIXTURE === "true",
  complete = false,
} = {}) {
  if (fixture && !preview)
    throw new Error("Validation fixtures require explicit documentation preview.");
  const base = fixture
    ? join(repository, "scripts/documentation/fixtures")
    : join(repository, "docs");
  return compileDocumentation({
    contentRoot: join(base, "user-guides"),
    metadataRoot: join(base, "documentation"),
    build: buildIdentity(),
    preview,
    complete,
  });
}

/** Returns the archive beside the exact files it contains; no runtime archive library. */
export function exportFiles(result) {
  const files = new Map(result.files);
  const temporary = mkdtempSync(join(tmpdir(), "openlaw-documentation-export-"));
  try {
    for (const [path, bytes] of files) {
      const file = join(temporary, path);
      mkdirSync(dirname(file), { recursive: true });
      writeFileSync(file, bytes);
    }
    const archive = execFileSync(
      "tar",
      ["--sort=name", "--mtime=@0", "--owner=0", "--group=0", "--numeric-owner", "-czf", "-", "."],
      { cwd: temporary, maxBuffer: 64 * 1024 * 1024 },
    );
    files.set("openlaw-documentation.tar.gz", archive);
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
  return files;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const args = process.argv.slice(2);
    if (args.some((a) => !["--preview", "--fixture", "--complete", "--export"].includes(a)))
      throw new Error(
        "Usage: node scripts/documentation/build.mjs [--preview] [--fixture] [--complete] [--export]",
      );
    const result = compileWorkspace({
      preview: args.includes("--preview"),
      fixture: args.includes("--fixture"),
      complete: args.includes("--complete"),
    });
    if (args.includes("--export")) {
      const target = join(repository, ".documentation-output");
      rmSync(target, { recursive: true, force: true });
      mkdirSync(target);
      for (const [path, bytes] of exportFiles(result)) {
        const file = join(target, path);
        mkdirSync(dirname(file), { recursive: true });
        writeFileSync(file, bytes);
      }
      console.log(`Export: ${target}`);
    }
    console.log(
      JSON.stringify(
        {
          edition: result.bundle.edition,
          preview: result.bundle.preview,
          ...result.bundle.report,
          warnings: result.bundle.warnings,
        },
        null,
        2,
      ),
    );
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
