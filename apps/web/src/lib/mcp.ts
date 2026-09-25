// SPDX-License-Identifier: AGPL-3.0-only

/**
 * How each DD-029 Toolset reads. Two surfaces name a Toolset in words:
 * the Organization → MCP ceiling checkboxes and the audit log's
 * narration of a ceiling change. One copy keeps them the same.
 */

import { defineMessages, type IntlShape, type MessageDescriptor } from "react-intl";
import type { McpToolset } from "@openlaw/shared";
import { identifierLabel } from "./identifier-label";

export const TOOLSET_MESSAGES: Readonly<Record<McpToolset, MessageDescriptor>> = defineMessages({
  workspace: { id: "mcp.toolset.workspace", defaultMessage: "Workspace" },
  contracts: { id: "mcp.toolset.contracts", defaultMessage: "Contracts" },
  matters: { id: "mcp.toolset.matters", defaultMessage: "Matters" },
  tasks: { id: "mcp.toolset.tasks", defaultMessage: "Tasks" },
  requests: { id: "mcp.toolset.requests", defaultMessage: "Requests" },
  comments: { id: "mcp.toolset.comments", defaultMessage: "Comments" },
  documents: { id: "mcp.toolset.documents", defaultMessage: "Documents" },
  "auto-docs": { id: "mcp.toolset.autoDocs", defaultMessage: "Auto-Docs" },
  entities: { id: "mcp.toolset.entities", defaultMessage: "Entities" },
  knowledge: { id: "mcp.toolset.knowledge", defaultMessage: "Knowledge" },
  people: { id: "mcp.toolset.people", defaultMessage: "People" },
  team: { id: "mcp.toolset.team", defaultMessage: "Team" },
  administration: { id: "mcp.toolset.administration", defaultMessage: "Administration" },
});

/**
 * A Toolset as plain text. The activity log is append-only, so a slug
 * this build no longer has can still sit in a payload; it gets a
 * readable fallback instead of a throw.
 */
export function toolsetLabel(intl: IntlShape, slug: string): string {
  const catalog: Readonly<Partial<Record<string, MessageDescriptor>>> = TOOLSET_MESSAGES;
  const message = catalog[slug];
  return message ? intl.formatMessage(message) : identifierLabel(slug);
}
