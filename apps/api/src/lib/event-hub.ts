// SPDX-License-Identifier: AGPL-3.0-only

/** One Postgres listener and the in-process fan-out for TECH-009. */

import type { Db, PoolClient, UserRole } from "@openlaw/db";
import {
  LIVE_EVENT_CHANNEL,
  parseLiveEvent,
  type LiveEvent,
  type LiveEventVisibility,
  type LiveRecordEntityType,
} from "@openlaw/shared";

export const DEFAULT_EVENT_HEARTBEAT_MS = 15_000;

/**
 * How many streams one person may hold open at once. A browser opens one
 * per tab that shows a live surface; five covers a busy day and stops a
 * script from holding hundreds. Past it the oldest stream is closed.
 */
export const DEFAULT_MAX_SUBSCRIPTIONS_PER_USER = 5;

/**
 * How many streams one API process may hold open in total. Past it a
 * new stream is refused, never an old one closed: a crowd of new users
 * must not be able to cut everyone else off.
 */
export const DEFAULT_MAX_SUBSCRIPTIONS = 500;

/** The process cap is reached. The route answers 503 with Retry-After. */
export class EventHubFullError extends Error {
  constructor() {
    super("This process has no room for another live event stream.");
    this.name = "EventHubFullError";
  }
}

export interface EventHubLimits {
  maxPerUser?: number;
  maxTotal?: number;
}

export interface EventConnectionScope {
  userId: string;
  role: UserRole;
  record?: {
    entityType: LiveRecordEntityType;
    entityId: string;
    tiers: readonly LiveEventVisibility[];
  };
}

export interface EventHub {
  readonly heartbeatMs: number;
  start(): Promise<void>;
  stop(): Promise<void>;
  /**
   * Registers one open stream. `close` is called when the hub drops the
   * stream itself, which happens when its owner opens more than the
   * per-user cap. Throws {@link EventHubFullError} at the process cap.
   */
  subscribe(
    scope: EventConnectionScope,
    send: (event: LiveEvent) => void,
    close?: () => void,
  ): () => void;
}

export interface EventHubLog {
  error(fields: Readonly<Record<string, unknown>>, message: string): void;
}

interface Subscriber {
  scope: EventConnectionScope;
  send: (event: LiveEvent) => void;
  close?: () => void;
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
        ? scope.record.entityType === event.entityType &&
            scope.record.entityId === event.entityId &&
            scope.record.tiers.includes(event.visibility)
        : false;
  }
}

class SubscriberRegistry {
  // A Set iterates in insertion order, so the first match for a user is
  // that user's oldest stream.
  readonly subscribers = new Set<Subscriber>();
  private readonly maxPerUser: number;
  private readonly maxTotal: number;

  constructor(limits: EventHubLimits = {}) {
    this.maxPerUser = limits.maxPerUser ?? DEFAULT_MAX_SUBSCRIPTIONS_PER_USER;
    this.maxTotal = limits.maxTotal ?? DEFAULT_MAX_SUBSCRIPTIONS;
  }

  subscribe(
    scope: EventConnectionScope,
    send: (event: LiveEvent) => void,
    close?: () => void,
  ): () => void {
    const mine = [...this.subscribers].filter((other) => other.scope.userId === scope.userId);
    while (mine.length >= this.maxPerUser) {
      this.drop(mine.shift()!);
    }
    if (this.subscribers.size >= this.maxTotal) throw new EventHubFullError();
    const subscriber: Subscriber = { scope, send, close };
    this.subscribers.add(subscriber);
    return () => this.subscribers.delete(subscriber);
  }

  /** Forgets a stream and tells its route to end the response. */
  private drop(subscriber: Subscriber): void {
    this.subscribers.delete(subscriber);
    try {
      subscriber.close?.();
    } catch {
      // The socket may already be gone. The stream is out of the set
      // either way, which is what the cap is about.
    }
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
export function createTestingEventHub(
  heartbeatMs = DEFAULT_EVENT_HEARTBEAT_MS,
  limits?: EventHubLimits,
): EventHub & { fanOut(event: LiveEvent): void; readonly size: number } {
  const registry = new SubscriberRegistry(limits);
  return {
    heartbeatMs,
    start: () => Promise.resolve(),
    stop: () => Promise.resolve(),
    subscribe: (scope, send, close) => registry.subscribe(scope, send, close),
    fanOut: (event) => registry.fanOut(event),
    get size() {
      return registry.subscribers.size;
    },
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
  limits?: EventHubLimits;
}): EventHub {
  const registry = new SubscriberRegistry(options.limits);
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
        await next.query(`listen ${next.escapeIdentifier(LIVE_EVENT_CHANNEL)}`);
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
        await active.query(`unlisten ${active.escapeIdentifier(LIVE_EVENT_CHANNEL)}`);
      } catch {
        // The session may have died between the last health event and
        // this call. `release(true)` below destroys it either way, and
        // a failed courtesy UNLISTEN must not fail `app.close()`.
      } finally {
        active.release(true);
      }
    },
    subscribe: (scope, send, close) => registry.subscribe(scope, send, close),
  };
}
