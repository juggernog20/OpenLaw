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
import { MCP_TOOLSETS } from "@openlaw/shared";

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
    const grant = { role, toolsets: ["guide", ...MCP_TOOLSETS], scope: "write" as const };
    const defaults = toolRegister.filter(
      (t) => (role === "business_user" ? t.businessUser : t.legalUser) !== "off",
    );
    expect(defaults.filter((t) => !toolRefusal(t, grant))).toHaveLength(5);
  },
);
