// SPDX-License-Identifier: AGPL-3.0-only
import { expect, it } from "vitest";
import { z } from "zod";
import {
  toolRegister,
  instructions,
  toolRefusal,
  toolInputJsonSchema,
  toolOutputJsonSchema,
} from "./register.js";
import { MCP_TOOLSETS, MCP_DEFAULT_TOOLSET_CEILING } from "@openlaw/shared";

function inspectSchema(value: unknown, description: string) {
  if (!value || typeof value !== "object") return;
  const node = value as Record<string, unknown>;
  expect(node).not.toHaveProperty("$ref");
  expect(Array.isArray(node.type)).toBe(false);
  if (node.type === "integer") expect(node).not.toHaveProperty("exclusiveMinimum");
  if (Array.isArray(node.enum)) {
    for (const item of node.enum) {
      expect(typeof item).toBe("string");
      expect(description).toContain(item);
    }
  }
  for (const child of Object.values(node)) inspectSchema(child, description);
}
it("keeps every Tool within the client schema and annotation rules", () => {
  expect(new Set(toolRegister.map((t) => t.name)).size).toBe(toolRegister.length);
  for (const tool of toolRegister) {
    expect(tool.name).toMatch(/^[a-zA-Z0-9_-]+$/);
    expect(["guide", ...MCP_TOOLSETS]).toContain(tool.toolset);
    expect(["always", "on", "off"]).toContain(tool.legalUser);
    expect(["always", "on", "off"]).toContain(tool.businessUser);
    expect(tool.name.length).toBeGreaterThan(0);
    expect(tool.name.length).toBeLessThanOrEqual(64);
    expect(tool.description.length).toBeGreaterThan(0);
    expect(tool.description.length).toBeLessThanOrEqual(2048);
    expect(tool.title.length).toBeGreaterThan(0);
    for (const hint of [
      "readOnlyHint",
      "destructiveHint",
      "openWorldHint",
      "idempotentHint",
    ] as const)
      expect(typeof tool.annotations[hint]).toBe("boolean");
    expect(tool.annotations.openWorldHint).toBe(false);
    expect(tool.annotations.readOnlyHint).toBe(tool.kind === "read");
    expect(tool.annotations.destructiveHint).toBe(tool.kind === "destr");
    inspectSchema(toolInputJsonSchema(tool), tool.description);
    expect(toolOutputJsonSchema(tool).type).toBe("object");
    inspectSchema(toolOutputJsonSchema(tool), JSON.stringify(toolOutputJsonSchema(tool)));
  }
  expect(instructions.length).toBeLessThanOrEqual(512);
  expect(instructions).toContain("OpenLaw");
  expect(instructions).toContain("openlaw_whoami");
});
it("serves the input form, so a defaulted argument stays optional for the Client", () => {
  const paged = z.object({ limit: z.number().int().default(20), q: z.string().optional() });
  const tool = { ...toolRegister[0]!, inputSchema: paged, outputSchema: paged };
  expect(toolInputJsonSchema(tool)).not.toHaveProperty("required");
  expect(toolInputJsonSchema(tool)).not.toHaveProperty("additionalProperties");
  expect(toolOutputJsonSchema(tool).required).toEqual(["limit"]);
});
it.each(["administrator", "legal_team_member", "business_user"] as const)(
  "pins the current default count for %s",
  (role) => {
    const grant = {
      role,
      toolsets: ["guide", ...MCP_DEFAULT_TOOLSET_CEILING],
      scope: "write" as const,
    };
    const defaults = toolRegister;
    expect(defaults.filter((t) => !toolRefusal(t, grant))).toHaveLength(
      role === "business_user" ? 24 : 37,
    );
  },
);
it("expresses nullable types and positive integer bounds for Client schemas", () => {
  const shape = z.object({ amount: z.number().int().positive().nullable() });
  const tool = { ...toolRegister[0]!, inputSchema: shape, outputSchema: shape };
  for (const schema of [toolInputJsonSchema(tool), toolOutputJsonSchema(tool)]) {
    expect(JSON.stringify(schema)).not.toContain("exclusiveMinimum");
    expect(JSON.stringify(schema)).toContain('"minimum":1');
    expect(JSON.stringify(schema)).toContain('"anyOf"');
  }
});

it.each(MCP_TOOLSETS)("refuses an off audience in %s", (toolset) => {
  for (const role of ["administrator", "legal_team_member", "business_user"] as const) {
    const tool = {
      ...toolRegister[0]!,
      toolset,
      legalUser: "off" as const,
      businessUser: "off" as const,
    };
    expect(toolRefusal(tool, { role, toolsets: [...MCP_TOOLSETS], scope: "write" })?.code).toBe(
      "tool_outside_grant",
    );
  }
});
it("keeps Administration exclusive to Administrators even with an on audience", () => {
  const tool = { ...toolRegister[0]!, toolset: "administration" as const };
  for (const role of ["legal_team_member", "business_user"] as const)
    expect(toolRefusal(tool, { role, toolsets: [...MCP_TOOLSETS], scope: "write" })?.code).toBe(
      "tool_outside_grant",
    );
  expect(
    toolRefusal(tool, { role: "administrator", toolsets: [...MCP_TOOLSETS], scope: "write" }),
  ).toBeUndefined();
});

it.each(["legal_team_member", "business_user"] as const)(
  "lists the Team Tools only for Legal Users with Team enabled: %s",
  (role) => {
    const grant = {
      role,
      toolsets: [...MCP_DEFAULT_TOOLSET_CEILING, "team"],
      scope: "write" as const,
    };
    expect(toolRegister.filter((tool) => !toolRefusal(tool, grant))).toHaveLength(
      role === "business_user" ? 24 : 39,
    );
    for (const name of ["openlaw_team_add", "openlaw_team_remove"]) {
      const tool = toolRegister.find((entry) => entry.name === name)!;
      expect(tool).toMatchObject({
        toolset: "team",
        legalUser: "on",
        businessUser: "off",
        kind: name.endsWith("remove") ? "destr" : "write",
        annotations: {
          readOnlyHint: false,
          destructiveHint: name.endsWith("remove"),
          idempotentHint: false,
        },
      });
      expect(toolRefusal(tool, { ...grant, toolsets: [] })?.code).toBe("tool_outside_grant");
    }
  },
);

it.each(["administrator", "legal_team_member"] as const)(
  "lists Administration only for an Administrator with Team and Administration enabled: %s",
  (role) => {
    const grant = { role, toolsets: [...MCP_TOOLSETS], scope: "write" as const };
    expect(toolRegister.filter((tool) => !toolRefusal(tool, grant))).toHaveLength(
      role === "administrator" ? 41 : 39,
    );
    for (const name of ["openlaw_audit_log_query", "openlaw_settings_get"]) {
      const tool = toolRegister.find((entry) => entry.name === name)!;
      expect(tool).toMatchObject({
        toolset: "administration",
        kind: "read",
        legalUser: "on",
        businessUser: "off",
        annotations: { readOnlyHint: true, openWorldHint: false },
      });
      expect(toolRefusal(tool, { ...grant, toolsets: [] })?.code).toBe("tool_outside_grant");
    }
  },
);
