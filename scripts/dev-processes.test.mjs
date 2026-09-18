// SPDX-License-Identifier: AGPL-3.0-only
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import process from "node:process";
import { setTimeout as delay } from "node:timers/promises";
import { URL } from "node:url";
import test from "node:test";

const helper = new URL("./dev-processes.mjs", import.meta.url).pathname;

function alive(pid) {
  try {
    const stat = readFileSync(`/proc/${pid}/stat`, "utf8");
    return stat.slice(stat.lastIndexOf(")") + 2)[0] !== "Z";
  } catch {
    return false;
  }
}

async function until(predicate) {
  const deadline = Date.now() + 12000;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error("Timed out waiting for dev process fixture");
    await delay(25);
  }
}

function launch(t, command, args, options = {}) {
  const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"], ...options });
  let output = "";
  child.stdout.on("data", (chunk) => {
    output += chunk;
  });
  child.stderr.on("data", (chunk) => {
    output += chunk;
  });
  const exited = once(child, "exit");
  t.after(() => {
    if (alive(child.pid)) child.kill("SIGKILL");
    for (const match of output.matchAll(/READY (\d+)/g)) {
      const pid = Number(match[1]);
      if (alive(pid)) process.kill(pid, "SIGKILL");
    }
  });
  return { child, exited, output: () => output };
}

async function loop(t, instance, { stubborn = false, exitParent = false } = {}) {
  const grandchild = `
    ${stubborn ? 'process.on("SIGTERM", () => {});' : ""}
    require("node:net").createServer().listen(0, "127.0.0.1", () => {
      console.log("READY " + process.pid);
      if (process.send) process.send("ready");
    });
  `;
  const parent = `
    const child = require("node:child_process").spawn(process.execPath,
      ["-e", ${JSON.stringify(grandchild)}],
      { detached: true, stdio: ["ignore", "inherit", "inherit", "ipc"] });
    console.log("READY " + process.pid);
    child.on("message", () => {
      ${exitParent ? "process.exit(0);" : "setInterval(() => {}, 1000);"}
    });
  `;
  const running = launch(t, process.execPath, [
    helper,
    "run",
    instance,
    process.execPath,
    "-e",
    parent,
  ]);
  await until(() => [...running.output().matchAll(/READY (\d+)/g)].length === 2);
  running.pids = [...running.output().matchAll(/READY (\d+)/g)].map((match) => Number(match[1]));
  return running;
}

for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"]) {
  test(`${signal} cleans up children in separate process groups`, { timeout: 20000 }, async (t) => {
    const running = await loop(t, `test-${randomUUID()}`);
    running.child.kill(signal);
    const [code] = await running.exited;
    assert.equal(code, { SIGINT: 130, SIGTERM: 143, SIGHUP: 129 }[signal]);
    assert.ok(running.pids.every((pid) => !alive(pid)));
  });
}

test("normal launcher exit cleans up detached descendants", { timeout: 20000 }, async (t) => {
  const running = await loop(t, `test-${randomUUID()}`, { exitParent: true });
  assert.equal((await running.exited)[0], 0);
  assert.ok(running.pids.every((pid) => !alive(pid)));
});

test(
  "stop recovers orphaned children, escalates, and leaves other instances alone",
  { timeout: 20000 },
  async (t) => {
    const instance = `test-${randomUUID()}`;
    const target = await loop(t, instance, { stubborn: true });
    const other = await loop(t, `test-${randomUUID()}`);
    const unrelated = launch(t, process.execPath, [
      "-e",
      'require("node:net").createServer().listen(0)',
    ]);
    target.child.kill("SIGKILL");
    await target.exited;
    process.kill(target.pids[0], "SIGKILL");
    await until(() => !alive(target.pids[0]));
    const stop = launch(t, process.execPath, [helper, "stop", instance]);
    assert.equal((await stop.exited)[0], 0, stop.output());
    assert.ok(target.pids.every((pid) => !alive(pid)));
    assert.ok(other.pids.every(alive));
    assert.ok(alive(unrelated.child.pid));
    const again = launch(t, process.execPath, [helper, "stop", instance]);
    assert.equal((await again.exited)[0], 0, again.output());
    other.child.kill("SIGTERM");
    await other.exited;
  },
);

test(
  "stop/down work before setup and select the same Compose instance as startup",
  { timeout: 20000 },
  async (t) => {
    const root = mkdtempSync(path.join(tmpdir(), "openlaw-stop-"));
    t.after(() => rmSync(root, { recursive: true, force: true }));
    mkdirSync(path.join(root, "scripts"));
    mkdirSync(path.join(root, "bin"));
    writeFileSync(
      path.join(root, "scripts/dev-processes.mjs"),
      'console.log("==> host dev loop stopped: " + process.argv[3]);',
    );
    copyFileSync(new URL("./dev-hot.sh", import.meta.url), path.join(root, "scripts/dev-hot.sh"));
    writeFileSync(
      path.join(root, "bin/docker"),
      '#!/bin/sh\nprintf "%s\\n" "$COMPOSE_PROJECT_NAME" "$@" > "$DOCKER_LOG"\n',
      { mode: 0o755 },
    );
    const env = {
      ...process.env,
      PATH: `${root}/bin:${process.env.PATH}`,
      DOCKER_LOG: `${root}/docker.log`,
    };
    delete env.COMPOSE_PROJECT_NAME;
    delete env.OPENLAW_DEV_RUN;
    for (const args of [["--stop"], ["--down", "--isolated", "--offset", "12"], ["--down"]]) {
      const command = launch(t, "bash", [`${root}/scripts/dev-hot.sh`, ...args], { env });
      assert.equal((await command.exited)[0], 0, command.output());
      if (args[0] === "--stop") {
        assert.match(command.output(), /stopped: openlaw\n/);
      } else {
        const expected = args.includes("--isolated")
          ? `openlaw-${path.basename(root).toLowerCase()}`
          : "openlaw";
        assert.equal(
          readFileSync(env.DOCKER_LOG, "utf8"),
          `${expected}\ncompose\n-f\ncompose.yml\n-f\ncompose.dev.yml\n-f\ncompose.hostdev.yml\nstop\npostgres\ndoc-engine\nmailpit\n`,
        );
      }
    }
    const custom = launch(t, "bash", [`${root}/scripts/dev-hot.sh`, "--down"], {
      env: { ...env, COMPOSE_PROJECT_NAME: "custom-dev-project" },
    });
    assert.equal((await custom.exited)[0], 0, custom.output());
    assert.match(readFileSync(env.DOCKER_LOG, "utf8"), /^custom-dev-project\n/);
  },
);

test(
  "dev:hot tracks the app watchers and seed for a stop from another terminal",
  { timeout: 20000 },
  async (t) => {
    const root = mkdtempSync(path.join(tmpdir(), "openlaw-loop-"));
    t.after(() => rmSync(root, { recursive: true, force: true }));
    for (const directory of ["scripts/seed", "bin", "node_modules"]) {
      mkdirSync(path.join(root, directory), { recursive: true });
    }
    copyFileSync(helper, path.join(root, "scripts/dev-processes.mjs"));
    copyFileSync(new URL("./dev-hot.sh", import.meta.url), path.join(root, "scripts/dev-hot.sh"));
    copyFileSync(
      new URL("./dev-smtp.mjs", import.meta.url),
      path.join(root, "scripts/dev-smtp.mjs"),
    );
    writeFileSync(path.join(root, ".env"), "");
    const watcher = 'console.log("READY " + process.pid); setInterval(() => {}, 1000);';
    writeFileSync(path.join(root, "scripts/seed/index.mjs"), watcher);
    writeFileSync(path.join(root, "bin/pnpm"), `#!/usr/bin/env node\n${watcher}`, { mode: 0o755 });
    writeFileSync(path.join(root, "bin/docker"), "#!/bin/sh\nexit 0\n", { mode: 0o755 });
    writeFileSync(
      path.join(root, "bin/ss"),
      `#!/bin/sh
count=0
if [ -f "$SS_COUNT" ]; then read -r count < "$SS_COUNT"; fi
count=$((count + 1))
echo "$count" > "$SS_COUNT"
if [ "$count" -gt 2 ]; then echo LISTEN; fi
`,
      { mode: 0o755 },
    );
    const env = {
      ...process.env,
      PATH: `${root}/bin:${process.env.PATH}`,
      COMPOSE_PROJECT_NAME: `test-${randomUUID()}`,
      SS_COUNT: `${root}/ss-count`,
      STORAGE_PATH: `${root}/storage`,
    };
    delete env.OPENLAW_DEV_RUN;
    const running = launch(t, "bash", [`${root}/scripts/dev-hot.sh`, "--seed"], { env });
    await until(() => [...running.output().matchAll(/READY (\d+)/g)].length === 3);
    const pids = [...running.output().matchAll(/READY (\d+)/g)].map((match) => Number(match[1]));
    const stopping = launch(t, "bash", [`${root}/scripts/dev-hot.sh`, "--stop"], { env });
    assert.equal((await stopping.exited)[0], 0, stopping.output());
    await running.exited;
    assert.ok(pids.every((pid) => !alive(pid)));
  },
);
