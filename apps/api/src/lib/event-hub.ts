// SPDX-License-Identifier: AGPL-3.0-only

/** One Postgres listener and the in-process fan-out for TECH-009. */

import type { Db, PoolClient, UserRole } from "@openlaw/db";
import {
  LIVE_EVENT_CHANNEL,
  parseLiveEvent,
  type LiveEvent,
  type LiveRecordEntityType,
} from "@openlaw/shared";

export const DEFAULT_EVENT_HEARTBEAT_MS = 15_000;

export interface EventConnectionScope {
  userId: string;
  role: UserRole;
  record?: { entityType: LiveRecordEntityType; entityId: string };
}

export interface EventHub {
  readonly heartbeatMs: number;
  start(): Promise<void>;
  stop(): Promise<void>;
  subscribe(scope: EventConnectionScope, send: (event: LiveEvent) => void): () => void;
}

export interface EventHubLog {
  error(fields: Readonly<Record<string, unknown>>, message: string): void;
}

interface Subscriber {
  scope: EventConnectionScope;
  send: (event: LiveEvent) => void;
}

function isMemberPlus(role: UserRole): boolean {
  return role === "administrator" || role === "legal_team_member";
}

function addressedTo(event: LiveEvent, scope: EventConnectionScope): boolean {
  switch (event.kind) {
    case "bell":
      return event.userId === scope.userId;
    case "inbox":
      return isMemberPlus(scope.role);
    case "record":
      return scope.record
        ? scope.record.entityType === event.entityType && scope.record.entityId === event.entityId
        : false;
  }
}

class SubscriberRegistry {
  readonly subscribers = new Set<Subscriber>();

  subscribe(scope: EventConnectionScope, send: (event: LiveEvent) => void): () => void {
    const subscriber = { scope, send };
    this.subscribers.add(subscriber);
    return () => this.subscribers.delete(subscriber);
  }

  fanOut(event: LiveEvent): void {
    for (const subscriber of this.subscribers) {
      if (!addressedTo(event, subscriber.scope)) continue;
      try {
        subscriber.send(event);
      } catch {
        // One broken socket must not stop delivery to the rest. The
        // route also removes it on close; this handles a write that
        // fails before Node reports that close.
        this.subscribers.delete(subscriber);
      }
    }
  }
}

/** Inert listener used by suites that build an app but do not exercise Postgres fan-out. */
export function createTestingEventHub(heartbeatMs = DEFAULT_EVENT_HEARTBEAT_MS): EventHub {
  const registry = new SubscriberRegistry();
  return {
    heartbeatMs,
    start: () => Promise.resolve(),
    stop: () => Promise.resolve(),
    subscribe: (scope, send) => registry.subscribe(scope, send),
  };
}

/**
 * Builds one dedicated LISTEN connection for an API process.
 * A dropped database session reconnects without disturbing open streams.
 */
export function createPostgresEventHub(options: {
  db: Db;
  log: EventHubLog;
  heartbeatMs?: number;
  reconnectMs?: number;
}): EventHub {
  const registry = new SubscriberRegistry();
  const heartbeatMs = options.heartbeatMs ?? DEFAULT_EVENT_HEARTBEAT_MS;
  const reconnectMs = options.reconnectMs ?? 1_000;
  let client: PoolClient | undefined;
  let retry: NodeJS.Timeout | undefined;
  let stopping = true;
  let connecting: Promise<void> | undefined;

  const fanOutPayload = (payload: string | undefined) => {
    if (payload === undefined) return;
    try {
      const event = parseLiveEvent(JSON.parse(payload));
      if (event) registry.fanOut(event);
    } catch (error) {
      options.log.error(
        { error: error instanceof Error ? error.message : String(error) },
        "live event payload could not be read",
      );
    }
  };

  const scheduleReconnect = () => {
    if (stopping || retry) return;
    retry = setTimeout(() => {
      retry = undefined;
      void connect().catch((error: unknown) => {
        options.log.error(
          { error: error instanceof Error ? error.message : String(error) },
          "live event listener could not reconnect",
        );
        scheduleReconnect();
      });
    }, reconnectMs);
    retry.unref();
  };

  const lose = (lost: PoolClient, error?: Error) => {
    if (client !== lost) return;
    client = undefined;
    try {
      lost.release(error ?? true);
    } catch {
      // The pool may already have removed a client that emitted `error`.
    }
    if (error) {
      options.log.error({ error: error.message }, "live event listener lost its connection");
    }
    scheduleReconnect();
  };

  const connect = async (): Promise<void> => {
    if (stopping || client) return;
    if (connecting) return connecting;
    connecting = (async () => {
      const next = await options.db.$client.connect();
      client = next;
      next.on("notification", (message) => {
        if (message.channel === LIVE_EVENT_CHANNEL) fanOutPayload(message.payload);
      });
      next.once("error", (error) => lose(next, error));
      next.once("end", () => lose(next));
      try {
        await next.query(`listen ${LIVE_EVENT_CHANNEL}`);
      } catch (error) {
        lose(next, error as Error);
        throw error;
      }
    })().finally(() => {
      connecting = undefined;
    });
    return connecting;
  };

  return {
    heartbeatMs,
    async start() {
      if (!stopping) return connect();
      stopping = false;
      try {
        await connect();
      } catch (error) {
        stopping = true;
        if (retry) clearTimeout(retry);
        retry = undefined;
        throw error;
      }
    },
    async stop() {
      stopping = true;
      if (retry) clearTimeout(retry);
      retry = undefined;
      await connecting?.catch(() => {});
      const active = client;
      client = undefined;
      if (!active) return;
      try {
        await active.query(`unlisten ${LIVE_EVENT_CHANNEL}`);
      } finally {
        active.release(true);
      }
    },
    subscribe: (scope, send) => registry.subscribe(scope, send),
  };
}
