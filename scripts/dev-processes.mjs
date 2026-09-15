// SPDX-License-Identifier: AGPL-3.0-only
import { spawn } from "node:child_process";
import console from "node:console";
import { randomUUID } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import process from "node:process";
import { setTimeout as delay } from "node:timers/promises";

function identity(pid) {
  try {
    const stat = readFileSync(`/proc/${pid}/stat`, "utf8");
    const fields = stat.slice(stat.lastIndexOf(")") + 2).split(" ");
    return fields[0] === "Z" ? null : fields[19];
  } catch {
    return null;
  }
}

function matchingProcesses(key, value) {
  const matches = [];
  for (const entry of readdirSync("/proc")) {
    if (!/^\d+$/.test(entry) || Number(entry) === process.pid) continue;
    const pid = Number(entry);
    const started = identity(pid);
    if (!started) continue;
    try {
      const environment = readFileSync(`/proc/${pid}/environ`, "utf8").split("\0");
      if (environment.includes(`${key}=${value}`)) matches.push({ pid, started });
    } catch (error) {
      // Other users' environments are private; a process may also exit mid-scan.
      if (!["ENOENT", "ESRCH", "EACCES", "EPERM"].includes(error.code)) throw error;
    }
  }
  return matches;
}

function signalProcess({ pid, started }, signal) {
  // A PID alone can point to a different process by the time cleanup runs.
  if (identity(pid) !== started) return;
  try {
    process.kill(pid, signal);
  } catch (error) {
    if (error.code !== "ESRCH") throw error;
  }
}

async function stop(key, value) {
  const deadline = Date.now() + 5000;
  const signalled = new Set();
  while (true) {
    const matches = matchingProcesses(key, value);
    if (!matches.length) return;
    const force = Date.now() >= deadline;
    for (const target of matches) {
      const id = `${target.pid}:${target.started}`;
      if (force || !signalled.has(id)) {
        signalProcess(target, force ? "SIGKILL" : "SIGTERM");
        signalled.add(id);
      }
    }
    if (Date.now() >= deadline + 2000) {
      throw new Error(`Could not stop dev processes: ${matches.map(({ pid }) => pid).join(", ")}`);
    }
    // Rescan to catch children created while their parents were shutting down.
    await delay(100);
  }
}

async function run(instance, command, args) {
  const runId = randomUUID();
  const child = spawn(command, args, {
    stdio: "inherit",
    env: { ...process.env, OPENLAW_DEV_INSTANCE: instance, OPENLAW_DEV_RUN: runId },
  });
  let finishing;
  function finish(code) {
    finishing ??= stop("OPENLAW_DEV_RUN", runId).then(
      () => {
        process.exitCode = code;
      },
      (error) => {
        console.error(error.message);
        process.exitCode = 1;
      },
    );
    return finishing;
  }
  process.on("SIGINT", () => {
    void finish(130);
  });
  process.on("SIGTERM", () => {
    void finish(143);
  });
  process.on("SIGHUP", () => {
    void finish(129);
  });
  child.on("error", (error) => {
    console.error(error.message);
    void finish(1);
  });
  child.on("exit", (code, signal) => {
    void finish(code ?? (signal === "SIGINT" ? 130 : 143));
  });
}

try {
  if (process.platform !== "linux") throw new Error("Dev process cleanup requires Linux /proc.");
  const [action, instance, command, ...args] = process.argv.slice(2);
  if (!instance || !["run", "stop"].includes(action) || (action === "run" && !command)) {
    throw new Error(
      "Usage: dev-processes.mjs run <instance> <command> [args...] | stop <instance>",
    );
  }
  if (action === "stop") {
    await stop("OPENLAW_DEV_INSTANCE", instance);
    console.log(`==> host dev loop stopped: ${instance}`);
  } else {
    await run(instance, command, args);
  }
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
