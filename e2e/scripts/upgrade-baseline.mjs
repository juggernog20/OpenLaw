// SPDX-License-Identifier: AGPL-3.0-only

/** Resolves one immutable baseline before either half of an upgrade rehearsal starts. */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

export function upgradeBaseline({ cwd, event = {}, eventName, head = "HEAD", explicit } = {}) {
  const git = (...args) => execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
  const commit = (ref) => git("rev-parse", "--verify", "--end-of-options", `${ref}^{commit}`);
  const candidate = commit(head);
  const distinct = (ref) => {
    const sha = commit(ref);
    if (sha === candidate)
      throw new Error(`Upgrade baseline ${ref} is the candidate ${candidate}.`);
    return sha;
  };

  if (explicit) return distinct(explicit);

  const releases = git("tag", "--list", "--sort=-v:refname")
    .split("\n")
    .filter((tag) => /^v\d+\.\d+\.\d+$/.test(tag));
  for (const tag of releases) {
    if (commit(tag) !== candidate) return distinct(tag);
  }

  if (eventName === "pull_request" && event.pull_request?.base?.sha) {
    return distinct(event.pull_request.base.sha);
  }
  if (eventName === "push" && event.before && !/^0+$/.test(event.before)) {
    return distinct(event.before);
  }

  // Manual/local runs have no event base. On dev itself, use its parent
  // instead of turning the rehearsal into a restart of the same image.
  const dev = commit("origin/dev");
  return distinct(dev === candidate ? `${candidate}^1` : dev);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const event = process.env.GITHUB_EVENT_PATH
    ? JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH, "utf8"))
    : {};
  console.log(
    upgradeBaseline({
      event,
      eventName: process.env.GITHUB_EVENT_NAME,
      head: process.env.GITHUB_SHA || "HEAD",
      explicit: process.argv[2],
    }),
  );
}
