// SPDX-License-Identifier: AGPL-3.0-only
import { afterAll, beforeAll, expect, it } from "vitest";
import { allowedClients, orgSettings } from "@openlaw/db";
import { startHarness, type TestHarness } from "./testing/harness.js";
let h: TestHarness;
beforeAll(async () => {
  h = await startHarness();
});
afterAll(async () => {
  await h?.stop();
});
it("seeds four enabled Allowed Clients and leaves dynamic registration off", async () => {
  const rows = await h.db.select().from(allowedClients);
  expect(rows).toHaveLength(4);
  for (const [name, metadataUrl] of [
    ["Claude", "https://claude.ai/oauth/mcp-oauth-client-metadata"],
    ["Claude Code", "https://claude.ai/oauth/claude-code-client-metadata"],
    ["ChatGPT", "https://chatgpt.com/oauth/client.json"],
  ])
    expect(rows).toContainEqual(
      expect.objectContaining({
        name,
        metadataUrl,
        kind: "published",
        seeded: true,
        enabled: true,
        clientId: null,
      }),
    );
  expect(rows).toContainEqual(
    expect.objectContaining({
      name: "Microsoft 365 Copilot",
      kind: "registered",
      seeded: true,
      enabled: true,
      clientId: null,
      callbackUrls: [
        "https://teams.microsoft.com/api/platform/v1.0/oAuthRedirect",
        "https://vscode.dev/redirect",
        "",
      ],
    }),
  );
  expect((await h.db.select().from(orgSettings))[0]!.mcpDynamicClientRegistrationEnabled).toBe(
    false,
  );
});
