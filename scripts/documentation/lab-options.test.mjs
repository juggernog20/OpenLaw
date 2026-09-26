// SPDX-License-Identifier: AGPL-3.0-only
import { test } from "node:test";
import assert from "node:assert/strict";
import { acceptanceConfiguration } from "./lab-options.mjs";

test("ordinary labs keep preparation disabled and Docker allocates their networks", () => {
  assert.deepEqual(acceptanceConfiguration({}), { environment: {}, networks: {} });
});

test("live acceptance uses real provider hosts and explicit independent subnets", () => {
  const result = acceptanceConfiguration({
    "signing-preparation": "live",
    "backend-subnet": "10.218.10.0/24",
    "engine-subnet": "10.218.11.0/24",
  });
  assert.deepEqual(result.environment, {
    SIGNING_PREPARATION_ENABLED: "true",
    SIGNING_PREPARATION_LIVE_LAB: "true",
  });
  assert.equal(result.networks["openlaw-backend"].ipam.config[0].subnet, "10.218.10.0/24");
  assert.equal(result.networks["openlaw-doc-engine"].ipam.config[0].subnet, "10.218.11.0/24");
});

test("refuses invalid acceptance mode and overlapping or invalid subnets", () => {
  for (const config of [
    { "signing-preparation": "standin" },
    { "backend-subnet": "10.218.999.0/24" },
    { "backend-subnet": "10.218.10.1/24" },
    { "backend-subnet": "10.218.10.0/24", "engine-subnet": "10.218.10.0/24" },
  ])
    assert.throws(() => acceptanceConfiguration(config));
});
