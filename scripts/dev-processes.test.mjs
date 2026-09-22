// SPDX-License-Identifier: AGPL-3.0-only
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { createServer } from "node:net";
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

test("fresh starts and shutdowns select the same container connection", async (t) => {
  const root = mkdtempSync(path.join(tmpdir(), "openlaw-engine-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  for (const directory of ["scripts", "bin", "node_modules", "podman"]) {
    mkdirSync(path.join(root, directory));
  }
  copyFileSync(helper, path.join(root, "scripts/dev-processes.mjs"));
  copyFileSync(new URL("./dev-hot.sh", import.meta.url), path.join(root, "scripts/dev-hot.sh"));
  writeFileSync(path.join(root, ".env"), "SETUP_TOKEN=fixture\n");
  writeFileSync(path.join(root, "bin/ss"), "#!/bin/sh\nexit 0\n", { mode: 0o755 });
  // Stop at compose up so the test exercises fresh cleanup without starting apps.
  writeFileSync(
    path.join(root, "bin/docker"),
    `#!/bin/sh
printf '%s|%s|%s\\n' "$DOCKER_HOST" "$DOCKER_CONTEXT" "$*" >> "$DOCKER_LOG"
case " $* " in *" up "*) exit 37 ;; esac
`,
    { mode: 0o755 },
  );
  const socket = path.join(root, "podman/podman.sock");
  const server = createServer();
  server.listen(socket);
  await once(server, "listening");
  t.after(() => server.close());
  const env = {
    ...process.env,
    PATH: `${root}/bin:${process.env.PATH}`,
    XDG_RUNTIME_DIR: root,
    DOCKER_LOG: `${root}/docker.log`,
    COMPOSE_PROJECT_NAME: `test-${randomUUID()}`,
    STORAGE_PATH: `${root}/storage`,
  };
  delete env.OPENLAW_DEV_RUN;
  delete env.DOCKER_HOST;
  delete env.DOCKER_CONTEXT;
  for (const [overrides, expected] of [
    [{}, `unix://${socket}|`],
    [{ DOCKER_HOST: "unix:///explicit.sock" }, "unix:///explicit.sock|"],
    [{ DOCKER_CONTEXT: "chosen-context" }, "|chosen-context"],
    [{ XDG_RUNTIME_DIR: `${root}/missing` }, "|"],
  ]) {
    writeFileSync(env.DOCKER_LOG, "");
    const fresh = launch(t, "bash", [`${root}/scripts/dev-hot.sh`, "--fresh"], {
      env: { ...env, ...overrides },
    });
    assert.equal((await fresh.exited)[0], 37, fresh.output());
    const down = launch(t, "bash", [`${root}/scripts/dev-hot.sh`, "--down"], {
      env: { ...env, ...overrides },
    });
    assert.equal((await down.exited)[0], 0, down.output());
    const lines = readFileSync(env.DOCKER_LOG, "utf8").trim().split("\n");
    assert.equal(lines.length, 3);
    assert.ok(lines.every((line) => line.startsWith(`${expected}|compose `)));
    assert.match(lines[0], / down -v$/);
    assert.match(lines[1], / up -d postgres doc-engine mailpit$/);
    assert.match(lines[2], / stop postgres doc-engine mailpit$/);
  }
});

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

test(
  "worktrees share data with separate ports and independent shutdown",
  { timeout: 20000 },
  async (t) => {
    const fixture = mkdtempSync(path.join(tmpdir(), "openlaw-shared-"));
    t.after(() => rmSync(fixture, { recursive: true, force: true }));
    const main = path.join(fixture, "main");
    const branches = [path.join(fixture, "a"), path.join(fixture, "b")];
    mkdirSync(path.join(fixture, "bin"));
    for (const root of [main, ...branches]) {
      mkdirSync(path.join(root, "scripts"), { recursive: true });
      mkdirSync(path.join(root, "node_modules"));
      copyFileSync(helper, path.join(root, "scripts/dev-processes.mjs"));
      copyFileSync(new URL("./dev-hot.sh", import.meta.url), path.join(root, "scripts/dev-hot.sh"));
      writeFileSync(path.join(root, "scripts/dev-smtp.mjs"), 'console.log("mailpit");');
      writeFileSync(path.join(root, ".env"), "SETUP_TOKEN=fixture\n");
    }
    writeFileSync(
      path.join(fixture, "bin/git"),
      '#!/bin/sh\nprintf "worktree %s\\n" "$MAIN_CHECKOUT"\n',
      { mode: 0o755 },
    );
    writeFileSync(
      path.join(fixture, "bin/docker"),
      `#!/usr/bin/env node
const { appendFileSync } = require("node:fs");
appendFileSync(process.env.DOCKER_LOG, JSON.stringify({
  project: process.env.COMPOSE_PROJECT_NAME,
  args: process.argv.slice(2),
  ports: [process.env.POSTGRES_PORT, process.env.DOC_ENGINE_PORT, process.env.MAILPIT_PORT, process.env.MAILPIT_SMTP_PORT],
}) + "\\n");
`,
      { mode: 0o755 },
    );
    writeFileSync(
      path.join(fixture, "bin/ss"),
      `#!/bin/sh
file="$FIXTURE_ROOT/ss-$OPENLAW_DEV_RUN"
count=0
if [ -f "$file" ]; then read -r count < "$file"; fi
count=$((count + 1))
echo "$count" > "$file"
if [ "$count" -gt 2 ]; then echo LISTEN; fi
`,
      { mode: 0o755 },
    );
    writeFileSync(
      path.join(fixture, "bin/pnpm"),
      `#!/usr/bin/env node
const keys = ["OPENLAW_DEV_INSTANCE", "COMPOSE_PROJECT_NAME", "PORT", "WEB_PORT", "DEV_API_ORIGIN", "BASE_URL", "DATABASE_URL", "DOC_ENGINE_URL", "SMTP_URL", "STORAGE_PATH"];
console.log("SNAPSHOT " + JSON.stringify({ args: process.argv.slice(2), env: Object.fromEntries(keys.map(key => [key, process.env[key]])) }));
console.log("READY " + process.pid);
setInterval(() => {}, 1000);
`,
      { mode: 0o755 },
    );
    const env = {
      ...process.env,
      PATH: `${fixture}/bin:${process.env.PATH}`,
      MAIN_CHECKOUT: main,
      FIXTURE_ROOT: fixture,
      DOCKER_LOG: `${fixture}/docker.log`,
      COMPOSE_PROJECT_NAME: `test-${randomUUID()}`,
    };
    for (const key of [
      "OPENLAW_DEV_RUN",
      "STORAGE_PATH",
      "PORT",
      "WEB_PORT",
      "POSTGRES_PORT",
      "DOC_ENGINE_PORT",
      "MAILPIT_PORT",
      "MAILPIT_SMTP_PORT",
      "DATABASE_URL",
      "DOC_ENGINE_URL",
      "DEV_API_ORIGIN",
      "BASE_URL",
      "SMTP_URL",
    ])
      delete env[key];
    const commands = [
      [main, []],
      [branches[0], ["--worktree", "--offset", "12"]],
      [branches[1], ["--worktree", "--offset", "13"]],
    ];
    const running = [];
    for (const [root, args] of commands) {
      const child = launch(t, "bash", [`${root}/scripts/dev-hot.sh`, ...args], { env });
      running.push(child);
      const expected = root === main ? 2 : 1;
      await until(() => [...child.output().matchAll(/READY (\d+)/g)].length === expected);
    }
    const snapshots = running.map((child) => JSON.parse(child.output().match(/SNAPSHOT (.+)/)[1]));
    assert.equal(new Set(snapshots.map((s) => s.env.OPENLAW_DEV_INSTANCE)).size, 3);
    for (const [index, snapshot] of snapshots.entries()) {
      const offset = [0, 12, 13][index];
      assert.equal(snapshot.env.COMPOSE_PROJECT_NAME, env.COMPOSE_PROJECT_NAME);
      assert.equal(snapshot.env.PORT, String(3000 + offset));
      assert.equal(snapshot.env.WEB_PORT, String(5173 + offset));
      assert.equal(snapshot.env.DEV_API_ORIGIN, `http://localhost:${3000 + offset}`);
      assert.equal(snapshot.env.BASE_URL, snapshot.env.DEV_API_ORIGIN);
      assert.equal(snapshot.env.DATABASE_URL, "postgres://openlaw:openlaw@127.0.0.1:55432/openlaw");
      assert.equal(snapshot.env.DOC_ENGINE_URL, "http://127.0.0.1:8080");
      assert.equal(snapshot.env.SMTP_URL, "smtp://127.0.0.1:1025");
      assert.equal(snapshot.env.STORAGE_PATH, `${main}/.storage`);
    }
    for (const child of running.slice(1)) {
      assert.doesNotMatch(child.output(), /SNAPSHOT .*@openlaw\/worker/);
      assert.doesNotMatch(child.output(), /seeding once/);
    }
    const dockerCalls = readFileSync(env.DOCKER_LOG, "utf8")
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    assert.ok(dockerCalls.every((call) => call.project === env.COMPOSE_PROJECT_NAME));
    const starts = dockerCalls.filter((call) => call.args.includes("up"));
    assert.equal(starts.length, 3);
    assert.ok(starts.slice(1).every((call) => call.args.includes("--no-recreate")));
    assert.ok(
      starts.every(
        (call) => JSON.stringify(call.ports) === JSON.stringify(["55432", "8080", "8025", "1025"]),
      ),
    );

    const dockerBeforeStop = readFileSync(env.DOCKER_LOG, "utf8");
    const down = launch(t, "bash", [`${branches[0]}/scripts/dev-hot.sh`, "--down", "--worktree"], {
      env,
    });
    assert.equal((await down.exited)[0], 0, down.output());
    await running[1].exited;
    assert.equal(readFileSync(env.DOCKER_LOG, "utf8"), dockerBeforeStop);
    for (const child of [running[0], running[2]]) {
      assert.ok(
        [...child.output().matchAll(/READY (\d+)/g)].every((match) => alive(Number(match[1]))),
      );
      child.child.kill("SIGTERM");
      await child.exited;
    }
  },
);

test("shared worktree mode rejects seeding and resets before setup", async (t) => {
  const root = mkdtempSync(path.join(tmpdir(), "openlaw-shared-invalid-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(path.join(root, "scripts"));
  copyFileSync(new URL("./dev-hot.sh", import.meta.url), path.join(root, "scripts/dev-hot.sh"));
  for (const flag of ["--isolated", "--fresh", "--seed"]) {
    const command = launch(t, "bash", [`${root}/scripts/dev-hot.sh`, "--worktree", flag]);
    assert.equal((await command.exited)[0], 1, command.output());
    assert.match(command.output(), /--worktree shares existing data/);
  }
});
