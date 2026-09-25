// SPDX-License-Identifier: AGPL-3.0-only
import { z } from "zod";
import { AuditEntrySchema, AuditFilterSchema, queryAuditLog } from "../modules/audit-log/routes.js";
import { ToolCallEntrySchema, queryToolCalls } from "../modules/audit-log/tool-calls.js";
import { organizationSections } from "../modules/settings/read.js";
import { bounded, boundedPage, pageInput, serviceResult } from "./results.js";
import { readTool } from "./workspace.js";
import { ToolError, type ToolDefinition } from "./tool.js";

const auditInput = AuditFilterSchema.extend({
  ...pageInput,
  view: z.enum(["entries", "tool_calls"]).default("entries"),
}).strict();
const entrySchema = AuditEntrySchema.extend({
  actor: AuditEntrySchema.shape.actor.unwrap().extend({ email: z.string().nullable() }).nullable(),
  payloadTruncated: z.literal(true).optional(),
});
const settingsInput = z.strictObject({ section: z.enum(organizationSections).optional() });
export const administrationTools: readonly ToolDefinition[] = [
  {
    ...readTool,
    toolset: "administration",
    businessUser: "off",
    name: "openlaw_audit_log_query",
    title: "Query the audit log",
    description:
      "Administrator only. Read view entries (default) with actorId, action, entityType, from, to and q filters, or tool_calls with from and to. entityType is contract, matter, entity, document, request, user, system, knowledge_item or auto_doc. Dates are inclusive ISO timestamps. Entries retain record reach and reference redaction. Payloads over 8 KiB are omitted with payloadTruncated true. Page with cursor and limit; pass nextCursor with the same filters. This read writes no audit entry.",
    inputSchema: auditInput,
    outputSchema: z.object({
      entries: z.array(z.union([entrySchema, ToolCallEntrySchema])),
      nextCursor: z.string().nullable(),
    }),
    run: async (input, { db, user }) => {
      const { view, cursor, limit, ...filters } = auditInput.parse(input);
      if (
        view === "tool_calls" &&
        [filters.actorId, filters.action, filters.entityType, filters.q].some(
          (value) => value !== undefined,
        )
      )
        throw new ToolError(
          "validation_error",
          "The tool_calls view accepts only from, to, cursor and limit.",
        );
      const result =
        view === "entries"
          ? await queryAuditLog(db, user, filters, { cursor, limit })
          : await queryToolCalls(db, filters, { cursor, limit });
      const entries = result.entries.map((entry) =>
        "payload" in entry && Buffer.byteLength(JSON.stringify(entry.payload)) > 8192
          ? { ...entry, payload: {}, payloadTruncated: true as const }
          : entry,
      );
      const page = boundedPage(entries, limit, (entry) => entry.id, result.nextCursor);
      return bounded({ entries: page.items, nextCursor: page.nextCursor });
    },
  },
  {
    ...readTool,
    toolset: "administration",
    businessUser: "off",
    name: "openlaw_settings_get",
    title: "Read Organization settings",
    description:
      "Administrator only. Omit section to list sections. Read general, branding, notifications, reminder_offsets, currencies, authentication, email, ai_analysis, e_signature, mcp or advanced as the Organization panes read them. Credentials and masked Advanced values are never returned. This Tool cannot change settings.",
    inputSchema: settingsInput,
    outputSchema: z.object({
      sections: z.array(z.enum(organizationSections)).optional(),
      settings: z.record(z.string(), z.unknown()).optional(),
    }),
    run: async (input, { readOrganizationSettings }) => {
      const { section } = settingsInput.parse(input);
      if (!section) return { sections: [...organizationSections] };
      if (!readOrganizationSettings)
        throw new ToolError("unavailable", "Organization settings are unavailable.");
      return serviceResult(async () =>
        bounded({ settings: await readOrganizationSettings(section) }),
      );
    },
  },
];
