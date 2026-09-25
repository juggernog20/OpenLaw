// SPDX-License-Identifier: AGPL-3.0-only

/** DD-029 Toolset choices shared by OAuth consent and API key requests. */
import { MCP_TOOLSETS, type McpToolset } from "@openlaw/shared";
import type { UserRole } from "@openlaw/db";
import { toolRefusal, toolRegister } from "./register.js";

/** The Toolsets a person may choose for consent or an API key request. */
export function selectableToolsets(ceiling: readonly McpToolset[], role: UserRole): McpToolset[] {
  const grant = { role, toolsets: ceiling, scope: "write" as const };
  return MCP_TOOLSETS.filter(
    (id) =>
      ceiling.includes(id) &&
      toolRegister.some((tool) => tool.toolset === id && !toolRefusal(tool, grant)),
  );
}
