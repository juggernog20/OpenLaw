// SPDX-License-Identifier: AGPL-3.0-only
import { strict as assert } from "node:assert";
import { test } from "node:test";
import { assertMcpRows } from "./upgrade-mcp.mjs";

const before = {
  org_settings: [
    {
      id: "org",
      name: "Keep",
      updated_at: "2026-09-25",
      mcp_toolset_ceiling: ["team", "contracts", "administration", "matters"],
    },
  ],
  api_keys: '[{"id":"key","key":"hash","metadata":"{\\"toolsets\\":[\\"team\\"]}"}]',
  api_key_requests: '[{"id":"request","toolsets":["team","administration"]}]',
  oauth_grants: '[{"id":"grant","toolsets":["team","administration"]}]',
  allowed_clients: '[{"id":"client","enabled":false}]',
};
const upgraded = () => ({
  ...structuredClone(before),
  org_settings: before.org_settings.map((row) => ({
    ...row,
    mcp_toolset_ceiling: ["contracts", "matters"],
  })),
});

test("only Team and Administration leave each Organization ceiling", () => {
  assert.doesNotThrow(() => assertMcpRows(before, upgraded(), true));
  assert.doesNotThrow(() => assertMcpRows(before, structuredClone(before), false));
  const multiple = {
    ...before,
    org_settings: [...before.org_settings, { id: "second", mcp_toolset_ceiling: [] }],
  };
  assert.doesNotThrow(() =>
    assertMcpRows(
      multiple,
      {
        ...upgraded(),
        org_settings: [...upgraded().org_settings, { id: "second", mcp_toolset_ceiling: [] }],
      },
      true,
    ),
  );
});

for (const field of ["api_keys", "api_key_requests", "oauth_grants", "allowed_clients"]) {
  test(`a changed or missing ${field} row fails byte equality`, () => {
    assert.throws(
      () => assertMcpRows(before, { ...upgraded(), [field]: "[]" }, true),
      new RegExp(field),
    );
    assert.throws(
      () => assertMcpRows(before, { ...upgraded(), [field]: before[field] + " " }, true),
      new RegExp(field),
    );
  });
}
test("other settings, ceiling order, extra removals and a skipped migration fail", () => {
  for (const [patch, column] of [
    [{ name: "Changed" }, "name"],
    [{ updated_at: "2026-09-26" }, "updated_at"],
    [{ mcp_toolset_ceiling: ["matters", "contracts"] }, "mcp_toolset_ceiling"],
    [{ mcp_toolset_ceiling: ["contracts"] }, "mcp_toolset_ceiling"],
    [{ mcp_toolset_ceiling: before.org_settings[0].mcp_toolset_ceiling }, "mcp_toolset_ceiling"],
  ]) {
    const after = upgraded();
    Object.assign(after.org_settings[0], patch);
    assert.throws(
      () => assertMcpRows(before, after, true),
      new RegExp(`org_settings.*row org column ${column}$`),
    );
  }
});

test("the failure names the row and column, never the stored value", () => {
  const changed = '[{"id":"key","key":"other-hash","metadata":"{\\"toolsets\\":[\\"team\\"]}"}]';
  assert.throws(
    () => assertMcpRows(before, { ...upgraded(), api_keys: changed }, true),
    (error) =>
      /api_keys.*row key column key$/.test(error.message) && !error.message.includes("hash"),
  );
  const added = '[{"id":"grant","toolsets":["team","administration"],"note":null}]';
  assert.throws(
    () => assertMcpRows(before, { ...upgraded(), oauth_grants: added }, true),
    /oauth_grants.*row grant column note \(added\)$/,
  );
  assert.throws(
    () => assertMcpRows(before, { ...upgraded(), allowed_clients: "[]" }, true),
    /allowed_clients.*1 rows before the upgrade, 0 after$/,
  );
  const dropped = upgraded();
  delete dropped.api_key_requests;
  assert.throws(
    () => assertMcpRows(before, dropped, true),
    /api_key_requests.*the table is missing after the upgrade$/,
  );
});
