// SPDX-License-Identifier: AGPL-3.0-only

/**
 * TECH-035 stateless /mcp mount. Only a verified credential reaches the factory,
 * which creates one server for that caller and protocol era per request.
 * The route is outside the session origin check and hidden from OpenAPI, and so
 * is the /mcp/uploads PUT that completes a T27 upload under its signed URL.
 */

import {
  createMcpHandler,
  McpServer,
  SUPPORTED_PROTOCOL_VERSIONS,
  type Tool,
} from "@modelcontextprotocol/server";
import { toNodeHandler } from "@modelcontextprotocol/node";
import type { FastifyPluginAsync } from "fastify";
import { OPENLAW_VERSION } from "@openlaw/shared";
import { loggable } from "../logging.js";
import { HttpError } from "../lib/problem.js";
import { organizationSettingsReader } from "../modules/settings/read.js";
import type { ResolveIpv4 } from "../modules/mcp-settings/reachability.js";
import type { Environment, AdvancedRuntime } from "../modules/advanced-settings/config.js";
import { authenticateMcp, mcpChallenge } from "./auth.js";
import { generateForTool } from "./auto-docs.js";
import { callTool } from "./calls.js";
import { listResources, readResource, resolveResource } from "./resources.js";
import { getPrompt, listPrompts, promptResource } from "./prompts.js";
import { documentUploadIssuer, documentUploadRoutes } from "./uploads.js";
import {
  instructions,
  toolInputJsonSchema,
  toolOutputJsonSchema,
  toolRefusal,
  toolRegister,
  type ToolDefinition,
  type ToolContext,
} from "./register.js";

declare module "fastify" {
  interface FastifyRequest {
    mcpContext: ToolContext | null;
  }
}

export function mcpRoutes(
  active: Environment,
  tools: readonly ToolDefinition[] = toolRegister,
  uploadConfig?: { baseUrl: string; secret: string },
  settingsRuntime: AdvancedRuntime = { baseline: {}, active },
  resolveIpv4?: ResolveIpv4,
): FastifyPluginAsync {
  return async (app) => {
    const readSettings = organizationSettingsReader(app, settingsRuntime, resolveIpv4);
    app.decorateRequest("mcpContext", null);
    if (uploadConfig) await app.register(documentUploadRoutes(uploadConfig.secret));
    app.route({
      method: ["POST", "GET", "DELETE"],
      url: "/mcp",
      schema: { hide: true },
      onRequest: async (request, reply) => {
        request.mcpContext = await authenticateMcp(request).catch(async (error: unknown) => {
          if (error instanceof HttpError && error.statusCode === 401)
            reply.header("WWW-Authenticate", await mcpChallenge(app));
          throw error;
        });
      },
      handler: async (request, reply) => {
        const context = request.mcpContext!;
        context.readOrganizationSettings = readSettings;
        context.generateAutoDoc = (id, submission) =>
          generateForTool(app, request.log, context.user, id, submission, context.baseUrl);
        if (uploadConfig) context.prepareDocumentUpload = documentUploadIssuer(app, uploadConfig);
        const body = request.body as
          | {
              jsonrpc?: string;
              id?: string | number;
              method?: string;
              params?: { name?: string; arguments?: unknown; uri?: string };
            }
          | undefined;
        if (
          context.user.via?.kind === "oauth_client" &&
          (body?.method === "tools/call" ||
            body?.method === "resources/read" ||
            body?.method === "prompts/get") &&
          body.jsonrpc === "2.0" &&
          body.id !== undefined
        ) {
          const resource =
            body.method === "resources/read" && typeof body.params?.uri === "string"
              ? resolveResource(tools, body.params.uri)
              : body.method === "prompts/get" && typeof body.params?.name === "string"
                ? promptResource(tools, body.params.name, body.params.arguments)
                : undefined;
          const tool =
            body.method === "tools/call"
              ? tools.find((t) => t.name === body.params?.name)
              : resource?.tool;
          if (tool && toolRefusal(tool, context.grant)) {
            const required = [
              ...(tool.toolset === "guide" ? [] : [`toolset:${tool.toolset}`]),
              ...(tool.kind === "read" ? [] : ["write"]),
            ];
            const metadata = new URL("/.well-known/oauth-protected-resource", app.baseUrl).href;
            reply.header(
              "WWW-Authenticate",
              `Bearer error="insufficient_scope" scope="${required.join(" ")}" resource_metadata="${metadata}"`,
            );
            const result =
              body.method === "resources/read"
                ? await readResource(tools, body.params!.uri!, context, request.id, active)
                : body.method === "prompts/get"
                  ? await getPrompt(
                      tools,
                      body.params!.name!,
                      body.params?.arguments,
                      context,
                      request.id,
                      active,
                    )
                  : await callTool(
                      tools,
                      tool.name,
                      body.params?.arguments,
                      context,
                      request.id,
                      active,
                    );
            return reply.code(403).send({ jsonrpc: "2.0", id: body.id, result });
          }
        }
        const authInfo = {
          token: context.credentialId,
          clientId: context.credentialId,
          scopes: [...context.grant.toolsets, context.grant.scope],
        };
        const handler = createMcpHandler(
          ({ era, authInfo: verified }) => {
            if (verified !== authInfo) throw new Error("Verified MCP authentication is required.");
            const server = new McpServer(
              { name: "OpenLaw", version: OPENLAW_VERSION },
              {
                supportedProtocolVersions: SUPPORTED_PROTOCOL_VERSIONS.filter((v) =>
                  era === "modern" ? v >= "2026-07-28" : v < "2026-07-28",
                ),
                instructions,
                capabilities: {
                  tools: { listChanged: true },
                  resources: { listChanged: true, subscribe: true },
                  prompts: { listChanged: true },
                },
                cacheHints: {
                  "tools/list": { ttlMs: 300_000, cacheScope: "private" },
                  "resources/templates/list": { ttlMs: 300_000, cacheScope: "private" },
                  "resources/list": { ttlMs: 0 },
                  "resources/read": { ttlMs: 0 },
                  "prompts/list": { ttlMs: 300_000, cacheScope: "private" },
                },
              },
            );
            server.server.setRequestHandler("tools/list", async (call) => {
              const visible = tools.filter((tool) => !toolRefusal(tool, context.grant));
              const cursor = call.params?.cursor;
              const boundary = cursor ? visible.findIndex((tool) => tool.name === cursor) : -1;
              if (cursor && boundary < 0) return { tools: [] };
              const page: Tool[] = [];
              let hasMore = false;
              for (const tool of visible.slice(boundary + 1)) {
                const listed: Tool = {
                  name: tool.name,
                  title: tool.title,
                  description: tool.description,
                  annotations: tool.annotations,
                  inputSchema: toolInputJsonSchema(tool) as Tool["inputSchema"],
                  outputSchema: toolOutputJsonSchema(tool) as Tool["outputSchema"],
                };
                if (Buffer.byteLength(JSON.stringify({ tools: [...page, listed] })) > 60_000) {
                  if (!page.length)
                    throw new Error("One Tool definition exceeds the list byte budget.");
                  hasMore = true;
                  break;
                }
                page.push(listed);
              }
              return { tools: page, ...(hasMore ? { nextCursor: page.at(-1)!.name } : {}) };
            });
            server.server.setRequestHandler("resources/templates/list", async () => ({
              resourceTemplates: listResources(tools, context.grant, true),
            }));
            server.server.setRequestHandler("resources/list", async () => ({
              resources: listResources(tools, context.grant, false),
            }));
            server.server.setRequestHandler("prompts/list", async () => ({
              prompts: listPrompts(context.grant),
            }));
            server.server.setRequestHandler("prompts/get", async (call) => {
              try {
                return await getPrompt(
                  tools,
                  call.params.name,
                  call.params.arguments,
                  context,
                  request.id,
                  active,
                );
              } catch (error) {
                request.log.error(
                  { credentialId: context.credentialId, error: loggable(error) },
                  "MCP prompt get ledger failed.",
                );
                return {
                  messages: [],
                  isError: true,
                  content: [
                    { type: "text", text: "internal_error: The prompt get could not be recorded." },
                  ],
                };
              }
            });
            server.server.setRequestHandler("resources/read", async (call) => {
              try {
                return await readResource(tools, call.params.uri, context, request.id, active);
              } catch (error) {
                request.log.error(
                  { credentialId: context.credentialId, error: loggable(error) },
                  "MCP resource read ledger failed.",
                );
                return {
                  contents: [],
                  isError: true,
                  content: [
                    {
                      type: "text",
                      text: "internal_error: The resource read could not be recorded.",
                    },
                  ],
                };
              }
            });
            // Dispatch before schema validation so refused and invalid calls also enter the ledger.
            server.server.setRequestHandler("tools/call", async (call) => {
              try {
                return await callTool(
                  tools,
                  call.params.name,
                  call.params.arguments,
                  context,
                  request.id,
                  active,
                );
              } catch (error) {
                request.log.error(
                  { credentialId: context.credentialId, error: loggable(error) },
                  "MCP Tool call ledger failed.",
                );
                return {
                  isError: true,
                  content: [
                    { type: "text", text: "internal_error: The Tool call could not be recorded." },
                  ],
                };
              }
            });
            return server;
          },
          { legacy: "stateless" },
        );
        reply.hijack();
        try {
          await toNodeHandler({
            fetch: (req, options) => handler.fetch(req, { ...options, authInfo }),
          })(request.raw, reply.raw, request.body);
        } finally {
          await handler.close();
        }
      },
    });
  };
}
