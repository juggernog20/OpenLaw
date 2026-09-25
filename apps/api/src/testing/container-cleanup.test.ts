// SPDX-License-Identifier: AGPL-3.0-only
import { fork, spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getContainerRuntimeClient } from "testcontainers";
import { expect, it } from "vitest";

it("rejects disabled cleanup when the API test config loads", () => {
  const result = spawnSync(
    process.execPath,
    [
      "--input-type=module",
      "--eval",
      "await import(process.argv[1]);",
      new URL("../../vitest.config.ts", import.meta.url).href,
    ],
    {
      env: { ...process.env, TESTCONTAINERS_RYUK_DISABLED: "true" },
      encoding: "utf8",
      timeout: 10_000,
    },
  );
  expect(result.error).toBeUndefined();
  expect(result.status).toBe(1);
  expect(result.stderr).toContain("API tests require Testcontainers cleanup.");
});

it("removes the database after its owner is killed without running teardown", async () => {
  const client = await getContainerRuntimeClient();
  const run = randomUUID();
  const temporaryDirectory = await mkdtemp(join(tmpdir(), "openlaw-cleanup-"));
  const child = fork(new URL("./fixtures/container-owner.mjs", import.meta.url), [], {
    execArgv: [],
    env: {
      ...process.env,
      TMPDIR: temporaryDirectory,
      OPENLAW_CLEANUP_TEST_RUN: run,
      // A separate reaper keeps this test from depending on other live workers.
      TESTCONTAINERS_RYUK_TEST_LABEL: "true",
      TESTCONTAINERS_RYUK_RECONNECTION_TIMEOUT: "2s",
    },
    stdio: ["ignore", "ignore", "pipe", "ipc"],
  });
  const exited = new Promise<void>((resolve) => {
    child.once("exit", () => resolve());
    child.once("error", () => resolve());
  });
  let stderr = "";
  child.stderr!.setEncoding("utf8").on("data", (chunk: string) => {
    stderr += chunk;
  });
  let reaperId: string | undefined;
  const errors: unknown[] = [];
  const containerExists = async (id: string) =>
    (await client.container.dockerode.listContainers({ all: true, filters: { id: [id] } })).length >
    0;
  const removeContainer = async (id: string) => {
    if (!(await containerExists(id))) return;
    try {
      await client.container.getById(id).remove({ force: true, v: true });
    } catch (error) {
      // Docker and Podman report concurrent removal differently. Absence is
      // success; keep the original error if the container remains.
      try {
        await expect.poll(() => containerExists(id), { timeout: 10_000 }).toBe(false);
      } catch {
        throw error;
      }
    }
  };
  try {
    const containerId = await new Promise<string>((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error(`Container startup timed out: ${stderr}`)),
        60_000,
      );
      child.on("message", (message: { reaperId?: string; containerId?: string }) => {
        if (message.reaperId) reaperId = message.reaperId;
        if (message.containerId) {
          clearTimeout(timer);
          resolve(message.containerId);
        }
      });
      child.once("error", (error) => {
        clearTimeout(timer);
        reject(error);
      });
      child.once("exit", () => {
        clearTimeout(timer);
        reject(new Error(`Container owner exited before startup: ${stderr}`));
      });
    });
    expect(reaperId).toBeTruthy();
    child.kill("SIGKILL");
    await exited;

    await expect
      .poll(
        async () => {
          const containers = await client.container.dockerode.listContainers({ all: true });
          return containers.some(
            (container) => container.Id === containerId || container.Id === reaperId,
          );
        },
        { timeout: 60_000, interval: 250 },
      )
      .toBe(false);
  } catch (error) {
    errors.push(error);
  } finally {
    if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
    await exited;
    // Remove only this test's resources if cleanup itself is what failed.
    try {
      const remaining = await client.container.dockerode.listContainers({
        all: true,
        filters: { label: [`org.openlaw.cleanup-test=${run}`] },
      });
      for (const id of [
        ...remaining.map((container) => container.Id),
        ...(reaperId ? [reaperId] : []),
      ]) {
        try {
          await removeContainer(id);
        } catch (error) {
          errors.push(error);
        }
      }
    } catch (error) {
      errors.push(error);
    }
    try {
      await rm(temporaryDirectory, { recursive: true, force: true });
    } catch (error) {
      errors.push(error);
    }
  }
  if (errors.length === 1) throw errors[0];
  if (errors.length > 1) {
    throw new AggregateError(errors, "Container cleanup regression failed", { cause: errors[0] });
  }
}, 180_000); // Includes cold image startup and the reaper's removal window.
