// SPDX-License-Identifier: AGPL-3.0-only

/**
 * DD-029's selectable Toolsets, shared by API validation
 * and settings pane. Guide is always on and cannot be removed from the ceiling.
 */
export const MCP_TOOLSETS = [
  "workspace",
  "contracts",
  "matters",
  "tasks",
  "requests",
  "comments",
  "documents",
  "auto-docs",
  "entities",
  "knowledge",
  "people",
  "team",
  "administration",
] as const;
/** Team and Administration require an Administrator to opt in. */
export const MCP_DEFAULT_TOOLSET_CEILING = MCP_TOOLSETS.filter(
  (id) => id !== "team" && id !== "administration",
);
export type McpToolset = (typeof MCP_TOOLSETS)[number];

export const API_KEY_PROBLEMS = [
  "urn:openlaw:problem:mcp-disabled",
  "urn:openlaw:problem:api-keys-disabled",
  "urn:openlaw:problem:toolset-outside-ceiling",
  "urn:openlaw:problem:mcp-read-only",
] as const;

export const MCP_OAUTH_UNAVAILABLE_PROBLEM = "urn:openlaw:problem:mcp-oauth-unavailable";
