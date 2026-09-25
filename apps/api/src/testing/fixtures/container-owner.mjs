// SPDX-License-Identifier: AGPL-3.0-only
import process from "node:process";
import { setInterval } from "node:timers";
import { PostgreSqlContainer } from "@testcontainers/postgresql";
import { getContainerRuntimeClient, getReaper } from "testcontainers";

const client = await getContainerRuntimeClient();
const list = client.container.list.bind(client.container);
// Existing suites may share a reaper. This child needs its own real helper so
// their open connections cannot postpone cleanup after this child is killed.
client.container.list = async () =>
  (await list()).filter((container) => container.Labels["org.testcontainers.ryuk"] !== "true");
const reaper = await getReaper(client);
client.container.list = list;
const helper = await client.container.inspect(client.container.getById(reaper.containerId));
if (helper.Config.Labels.TESTCONTAINERS_RYUK_TEST_LABEL !== "true") {
  throw new Error("Cleanup regression must use a private Ryuk helper");
}
process.send({ reaperId: reaper.containerId });

const container = await new PostgreSqlContainer("postgres:16-alpine")
  .withLabels({ "org.openlaw.cleanup-test": process.env.OPENLAW_CLEANUP_TEST_RUN })
  .start();
process.send({ containerId: container.getId() });

// The parent kills this process to test cleanup without an afterAll hook.
setInterval(() => {}, 1000);
