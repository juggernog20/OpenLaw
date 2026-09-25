// SPDX-License-Identifier: AGPL-3.0-only
/** Each MCP stream gets one scoped subscription on the process's shared LISTEN feed. */
import { InMemoryServerEventBus, type ServerEventBus } from "@modelcontextprotocol/server";
import { contracts, matters, requests, eq } from "@openlaw/db";
import { z } from "zod";
import type { FastifyRequest } from "fastify";
import type { LiveEvent } from "@openlaw/shared";
import type { EventConnectionScope, EventHub } from "../lib/event-hub.js";
import { reachedRecord } from "../modules/events/routes.js";
import { authenticateMcp } from "./auth.js";
import { resolveResource } from "./resources.js";
import { toolRefusal, type ToolContext, type ToolDefinition } from "./register.js";

type RecordScope = NonNullable<EventConnectionScope["record"]>[number];

async function subscribedRecord(
  request: FastifyRequest,
  context: ToolContext,
  resource: NonNullable<ReturnType<typeof resolveResource>>,
): Promise<RecordScope | null> {
  const { definition, address } = resource;
  if ("prefix" in definition) {
    const match = new RegExp(`^(?:${definition.prefix}-)?([1-9][0-9]*)$`).exec(address ?? "");
    if (!match || !Number.isSafeInteger(Number(match[1])) || Number(match[1]) > 2_147_483_647)
      return null;
    const table =
      definition.name === "contracts"
        ? contracts
        : definition.name === "matters"
          ? matters
          : requests;
    const [record] = await context.db
      .select({ id: table.id })
      .from(table)
      .where(eq(table.number, Number(match[1])))
      .limit(1);
    if (!record) return null;
    const kind =
      definition.name === "contracts"
        ? "contract"
        : definition.name === "matters"
          ? "matter"
          : "request";
    return reachedRecord(request.server, context.user, kind, record.id);
  }
  if (
    (definition.name === "entities" || definition.name === "knowledge") &&
    z.uuid().safeParse(address).success
  )
    return reachedRecord(
      request.server,
      context.user,
      definition.name === "entities" ? "entity" : "knowledge_item",
      address!,
    );
  return null;
}

export interface ChangeFeedView {
  bus: ServerEventBus;
  readonly closed: boolean;
  release(): void;
}

/** The hub owns fan-out and capacity; this wrapper only creates credential-scoped views. */
export function createMcpChangeFeed(hub: EventHub) {
  return {
    async open(
      request: FastifyRequest,
      context: ToolContext,
      tools: readonly ToolDefinition[],
      addresses: readonly string[],
      end: () => void,
    ): Promise<ChangeFeedView> {
      const records: (RecordScope & { uri: string; tool: ToolDefinition })[] = [];
      let inbox: ToolDefinition | undefined;
      for (const uri of new Set(addresses)) {
        const resource = resolveResource(tools, uri);
        if (!resource || toolRefusal(resource.tool, context.grant)) continue;
        if (uri === "openlaw://inbox") {
          if (context.user.role === "administrator" || context.user.role === "legal_team_member")
            inbox = resource.tool;
          continue;
        }
        const record = await subscribedRecord(request, context, resource);
        if (record) records.push({ ...record, uri, tool: resource.tool });
      }
      // A policy change can narrow the grant while the stream stays open. The latest re-read wins.
      let grant = context.grant;
      const bus = new InMemoryServerEventBus();
      let closed = false;
      let unsubscribe = () => {};
      const release = () => {
        if (closed) return;
        closed = true;
        clearInterval(heartbeat);
        unsubscribe();
      };
      const close = () => {
        release();
        end();
      };
      let checking: Promise<void> | undefined;
      const revalidate = () => {
        if (closed) return Promise.resolve();
        checking ??= authenticateMcp(request)
          .then((current) => {
            // A role change moves the Inbox and record tiers, so the Client must open a new stream.
            if (
              current.credentialId !== context.credentialId ||
              current.user.id !== context.user.id ||
              current.user.role !== context.user.role
            )
              close();
            else grant = current.grant;
          })
          .catch(() => close())
          .finally(() => {
            checking = undefined;
          });
        return checking;
      };
      const receive = (event: LiveEvent) => {
        if (closed) return;
        if (event.kind === "mcp") {
          if (event.credentialIds?.includes(context.credentialId)) {
            close();
            return;
          }
          // Another credential's revocation changes nothing this stream can see.
          if (event.change === "revocation") return;
          void revalidate().then(() => {
            if (closed) return;
            bus.publish({ kind: "tools_list_changed" });
            bus.publish({ kind: "prompts_list_changed" });
            bus.publish({ kind: "resources_list_changed" });
          });
        } else if (event.kind === "inbox" && inbox && !toolRefusal(inbox, grant)) {
          bus.publish({ kind: "resource_updated", uri: "openlaw://inbox" });
        } else if (event.kind === "record") {
          for (const record of records)
            if (
              record.entityType === event.entityType &&
              record.entityId === event.entityId &&
              record.tiers.includes(event.visibility) &&
              !toolRefusal(record.tool, grant)
            )
              bus.publish({ kind: "resource_updated", uri: record.uri });
        }
      };
      unsubscribe = hub.subscribe(
        { userId: context.user.id, role: context.user.role, record: records, mcp: true },
        receive,
        close,
      );
      const heartbeat = setInterval(() => {
        void revalidate();
      }, hub.heartbeatMs);
      heartbeat.unref();
      return {
        bus,
        get closed() {
          return closed;
        },
        release,
      };
    },
  };
}
