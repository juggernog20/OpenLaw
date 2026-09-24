// SPDX-License-Identifier: AGPL-3.0-only
import { documentUploadIssuer, documentUploadRoutes } from "./uploads.js";

/**
 * TECH-035 stateless /mcp mount. Only a verified credential reaches the factory,
 * which creates one server for that caller and protocol era per request.
 * The route is outside the session origin check and hidden from OpenAPI.
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
import type { Environment } from "../modules/advanced-settings/config.js";
import { authenticateKey } from "./auth.js";
import { callTool } from "./calls.js";
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
): FastifyPluginAsync {
  return async (app) => {
    app.decorateRequest("mcpContext", null);
    if (uploadConfig) await app.register(documentUploadRoutes(uploadConfig.secret));
    app.route({
      method: ["POST", "GET", "DELETE"],
      url: "/mcp",
      schema: { hide: true },
      onRequest: async (request, reply) => {
        request.mcpContext = await authenticateKey(request).catch((error: unknown) => {
          if (error instanceof HttpError && error.statusCode === 401)
            reply.header("WWW-Authenticate", "Bearer");
          throw error;
        });
      },
      handler: async (request, reply) => {
        const context = request.mcpContext!;
        if (uploadConfig) context.prepareDocumentUpload = documentUploadIssuer(app, uploadConfig);
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
                capabilities: { tools: {} },
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
