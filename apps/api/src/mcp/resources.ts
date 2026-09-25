// SPDX-License-Identifier: AGPL-3.0-only
/**
 * DD-029 resource addresses reuse the matching Tool's grant, reach and result.
 * TECH-035 puts each read through one call reservation without recording its address.
 */
import { z } from "zod";
import type { Resource, ResourceTemplateType } from "@modelcontextprotocol/server";
import { documentVersions, eq } from "@openlaw/db";
import { NO_DOCUMENT } from "../modules/documents/service.js";
import type { Environment } from "../modules/advanced-settings/config.js";
import { recordCall, runTool } from "./calls.js";
import {
  toolRefusal,
  ToolError,
  type Grant,
  type ToolContext,
  type ToolDefinition,
} from "./register.js";
import { bounded } from "./results.js";

/** Order here is the public list order. Each resource inherits its Tool's grant and audience. */
const definitions = [
  {
    name: "contracts",
    path: "contracts/{number}",
    title: "Contract",
    tool: "openlaw_contract_get",
    field: "contract",
    prefix: "C",
  },
  {
    name: "matters",
    path: "matters/{number}",
    title: "Matter",
    tool: "openlaw_matter_get",
    field: "matter",
    prefix: "M",
  },
  {
    name: "requests",
    path: "requests/{number}",
    title: "Request",
    tool: "openlaw_request_get",
    field: "request",
    prefix: "R",
  },
  {
    name: "entities",
    path: "entities/{id}",
    title: "Entity",
    tool: "openlaw_entity_get",
    field: "entity",
  },
  {
    name: "knowledge",
    path: "knowledge/{id}",
    title: "Knowledge Item",
    tool: "openlaw_knowledge_get",
    field: "knowledgeItem",
  },
  {
    name: "document-versions",
    path: "document-versions/{versionId}",
    title: "Document Version text",
    tool: "openlaw_document_read",
  },
  { name: "inbox", path: "inbox", title: "Inbox", tool: "openlaw_requests_list" },
  { name: "tasks", path: "tasks/mine", title: "My Tasks", tool: "openlaw_tasks_list" },
  {
    name: "vocabulary",
    path: "vocabulary",
    title: "OpenLaw vocabulary",
    tool: "openlaw_vocabulary",
  },
] as const;
type Definition = (typeof definitions)[number];
/** The Tool results these fields come from are already schema-checked; this names what is read. */
const recordLabel = z.looseObject({
  number: z.number().optional(),
  title: z.string().nullish(),
  legalName: z.string().nullish(),
  name: z.string().nullish(),
});
const versionPage = z.looseObject({
  text: z.looseObject({ text: z.string().nullable(), state: z.string() }),
  nextCursor: z.string().nullable(),
});

/** The get Tools behind the five record templates, in list order. */
export function recordResourceTools(tools: readonly ToolDefinition[]) {
  return definitions
    .filter((definition) => "field" in definition)
    .map((definition) => tools.find((tool) => tool.name === definition.tool))
    .filter((tool): tool is ToolDefinition => tool !== undefined);
}
const mimeType = (definition: Definition) =>
  definition.name === "document-versions" ? "text/plain" : "application/json";

export function listResources(
  tools: readonly ToolDefinition[],
  grant: Grant,
  templates: true,
): ResourceTemplateType[];
export function listResources(
  tools: readonly ToolDefinition[],
  grant: Grant,
  templates: false,
): Resource[];
export function listResources(
  tools: readonly ToolDefinition[],
  grant: Grant,
  templates: boolean,
): (Resource | ResourceTemplateType)[] {
  return definitions
    .filter((definition) => {
      const tool = tools.find((tool) => tool.name === definition.tool);
      return definition.path.includes("{") === templates && tool && !toolRefusal(tool, grant);
    })
    .map((definition) => ({
      name: definition.name,
      title: definition.title,
      mimeType: mimeType(definition),
      ...(templates
        ? { uriTemplate: `openlaw://${definition.path}` }
        : { uri: `openlaw://${definition.path}` }),
    }));
}

/** Match only literal addresses; queries, fragments and extra path segments are not arguments. */
export function resolveResource(tools: readonly ToolDefinition[], uri: string) {
  for (const definition of definitions) {
    const template = definition.path.includes("{");
    const path = template
      ? definition.path.slice(0, definition.path.indexOf("{"))
      : definition.path;
    const prefix = `openlaw://${path}`;
    if (template ? !uri.startsWith(prefix) : uri !== prefix) continue;
    const address = template ? uri.slice(prefix.length) : undefined;
    const tool = tools.find((tool) => tool.name === definition.tool);
    if (tool) return { definition, tool, address };
  }
}

export async function readResource(
  tools: readonly ToolDefinition[],
  uri: string,
  context: ToolContext,
  requestId: string,
  active: Environment,
) {
  const matched = resolveResource(tools, uri);
  const result = await recordCall(
    context,
    `resource:${matched?.definition.name ?? "unknown"}`,
    requestId,
    active,
    () => resourceContent(tools, uri, context),
  );
  return "contents" in result ? result : { ...result, contents: [] };
}

/** Read under the current grant without reserving another call for an embedded resource. */
export async function resourceContent(
  tools: readonly ToolDefinition[],
  uri: string,
  context: ToolContext,
  inboxLimit?: number,
) {
  const matched = resolveResource(tools, uri);
  if (!matched)
    throw new ToolError("not_found", "This resource address is not in the OpenLaw register.");
  const { definition, tool, address } = matched;
  const refusal = toolRefusal(tool, context.grant);
  if (refusal) throw refusal;
  let args: Record<string, unknown> =
    definition.name === "inbox" && inboxLimit !== undefined ? { limit: inboxLimit } : {};
  if ("prefix" in definition) {
    const match = new RegExp(`^(?:${definition.prefix}-)?([1-9][0-9]*)$`).exec(address ?? "");
    if (!match || !Number.isSafeInteger(Number(match[1])))
      throw new ToolError("invalid_arguments", "Supply the record number in the resource address.");
    args = { number: Number(match[1]) };
  } else if (address !== undefined) {
    if (!z.string().uuid().safeParse(address).success)
      throw new ToolError("invalid_arguments", "Supply a valid id in the resource address.");
    args = { id: address };
  }
  if (definition.name === "document-versions") {
    // The address names only the Version. T26 still performs every Document reach check.
    const [version] = await context.db
      .select({ documentId: documentVersions.documentId })
      .from(documentVersions)
      .where(eq(documentVersions.id, address!));
    if (!version) throw new ToolError("not_found", NO_DOCUMENT);
    args = { documentId: version.documentId, versionId: address };
  }
  const content = await runTool(tool, args, context);
  let title: string = definition.title;
  let text = JSON.stringify(content);
  if ("field" in definition) {
    const record = recordLabel.parse(content[definition.field]);
    const label = record.title ?? record.legalName ?? record.name;
    title =
      "prefix" in definition ? `${definition.prefix}-${record.number}: ${label}` : String(label);
  }
  if (definition.name === "document-versions") {
    const page = versionPage.parse(content);
    const continuation = page.nextCursor
      ? `\n\nContinue with T26 openlaw_document_read: ${JSON.stringify({ ...args, cursor: page.nextCursor })}`
      : "";
    text = bounded(
      (page.text.text ?? `Text state: ${page.text.state}. No extracted text is available.`) +
        continuation,
    );
  }
  return {
    contents: [{ uri, _meta: { title }, mimeType: mimeType(definition), text }],
  };
}

/** Expand the short record form, then use the resource reader's template resolution. */
export function resolveRecordResource(tools: readonly ToolDefinition[], record: string) {
  const kinds: Record<string, string> = {
    contract: "contracts",
    matter: "matters",
    request: "requests",
    entity: "entities",
    knowledge: "knowledge",
  };
  const input = record.trim();
  const short = /^(contract|matter|request|entity|knowledge)\s+(\S+)$/i.exec(input);
  const uri = short ? `openlaw://${kinds[short[1]!.toLowerCase()]}/${short[2]}` : input;
  const matched = resolveResource(tools, uri);
  return matched && "field" in matched.definition ? { ...matched, uri } : undefined;
}
