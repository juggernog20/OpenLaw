// SPDX-License-Identifier: AGPL-3.0-only
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, test } from "node:test";
import { upgradeBaseline } from "./upgrade-baseline.mjs";

let cwd;
let git;
let first;
let base;
let head;

beforeEach(() => {
  cwd = mkdtempSync(join(tmpdir(), "openlaw-baseline-"));
  git = (...args) => execFileSync("git", args, { cwd, encoding: "utf8", stdio: "pipe" }).trim();
  git("init", "--initial-branch=dev");
  git("config", "user.name", "Baseline test");
  git("config", "user.email", "baseline@example.test");
  git("config", "commit.gpgsign", "false");
  git("commit", "--allow-empty", "-m", "first");
  first = git("rev-parse", "HEAD");
  git("commit", "--allow-empty", "-m", "base");
  base = git("rev-parse", "HEAD");
  git("commit", "--allow-empty", "-m", "candidate");
  head = git("rev-parse", "HEAD");
  git("update-ref", "refs/remotes/origin/dev", head);
});

afterEach(() => rmSync(cwd, { recursive: true, force: true }));

test("a PR uses the recorded base, even when origin/dev has moved", () => {
  assert.equal(
    upgradeBaseline({
      cwd,
      eventName: "pull_request",
      event: { pull_request: { base: { sha: base } } },
    }),
    base,
  );
});

test("a dev push upgrades from its before SHA rather than its new tip", () => {
  assert.equal(upgradeBaseline({ cwd, eventName: "push", event: { before: first } }), first);
});

test("release selection excludes prereleases and malformed version tags", () => {
  git("tag", "v1.0.0", first);
  git("tag", "v1.1.0", base);
  git("tag", "v2.0.0-rc.1", head);
  git("tag", "v3.0.0garbage", head);
  assert.equal(upgradeBaseline({ cwd, eventName: "push", event: { before: first } }), base);
});

test("a release tag on the candidate does not become its own baseline", () => {
  git("tag", "v1.0.0", first);
  git("tag", "v2.0.0", head);
  assert.equal(upgradeBaseline({ cwd }), first);
});

test("a manual run on dev and a new-branch push fall back to the parent", () => {
  assert.equal(upgradeBaseline({ cwd }), base);
  assert.equal(
    upgradeBaseline({ cwd, eventName: "push", event: { before: "0".repeat(40) } }),
    base,
  );
});

test("a force push whose before SHA is gone falls back to the parent", () => {
  const gone = "1".repeat(40);
  assert.equal(upgradeBaseline({ cwd, eventName: "push", event: { before: gone } }), base);
});

test("a local feature branch uses the resolved dev tip", () => {
  git("update-ref", "refs/remotes/origin/dev", first);
  assert.equal(upgradeBaseline({ cwd }), first);
});

test("an explicit local baseline wins over release selection", () => {
  git("tag", "v1.0.0", base);
  assert.equal(upgradeBaseline({ cwd, explicit: first }), first);
});

test("an explicit or event baseline equal to the candidate is refused", () => {
  assert.throws(() => upgradeBaseline({ cwd, explicit: head }), /is the candidate/);
  assert.throws(
    () => upgradeBaseline({ cwd, eventName: "push", event: { before: head } }),
    /is the candidate/,
  );
});
