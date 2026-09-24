// SPDX-License-Identifier: AGPL-3.0-only
import { expect, it } from "vitest";
import { mcp } from "@better-auth/mcp";
import { authorizationServerAvailable, mcpResource } from "./oauth.js";

it.each([
  ["https://openlaw.example", true],
  ["https://10.0.0.5:3000", true],
  ["http://localhost:3000", true],
  ["http://127.0.0.1:3000", true],
  ["http://127.255.10.1:3000", true],
  ["http://[::1]:3000", true],
  ["http://app.localhost:3000", false],
  ["http://0.0.0.0:3000", false],
  ["http://10.0.0.5:3000", false],
  ["http://openlaw.example", false],
  ["http://localhost.example", false],
  ["https://user:password@openlaw.example", false],
  ["https://openlaw.example?query", false],
  ["https://openlaw.example#fragment", false],
  ["ftp://localhost", false],
  ["invalid", false],
] as const)("agrees with the pinned plugin resource rule for %s", (baseUrl, available) => {
  expect(authorizationServerAvailable(baseUrl)).toBe(available);
  const factory = () =>
    mcp({ resource: mcpResource(baseUrl), loginPage: "/auth/login", consentPage: "/auth/consent" });
  if (available) expect(factory).not.toThrow();
  else expect(factory).toThrow(TypeError);
});
