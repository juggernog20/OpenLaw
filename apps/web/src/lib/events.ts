// SPDX-License-Identifier: AGPL-3.0-only

/** One browser-owned connection for TECH-009's live prompts, re-scoped per record. */

import { useEffect } from "react";
import { parseLiveEvent, type LiveEvent, type LiveRecordEntityType } from "@openlaw/shared";

/** `open` fires on the first connection and after every native reconnect. */
export type BrowserLiveEvent = LiveEvent | { kind: "open" };

type Listener = (event: BrowserLiveEvent) => void;

const listeners = new Set<Listener>();
let source: EventSource | null = null;
let owners = 0;
let closeGeneration = 0;
let recordScope: LiveEventRecordScope | undefined;

/** The record one authenticated shell currently has open. */
export interface LiveEventRecordScope {
  entityType: LiveRecordEntityType;
  entityId: string;
}

function dispatch(event: BrowserLiveEvent) {
  for (const listener of listeners) listener(event);
}

function receive(message: MessageEvent<string>) {
  let decoded: unknown;
  try {
    decoded = JSON.parse(message.data);
  } catch {
    return;
  }
  const event = parseLiveEvent(decoded);
  if (event) dispatch(event);
}

function sameScope(
  left: LiveEventRecordScope | undefined,
  right: LiveEventRecordScope | undefined,
) {
  return left?.entityType === right?.entityType && left?.entityId === right?.entityId;
}

function eventUrl() {
  if (!recordScope) return "/api/events";
  const query = new URLSearchParams({
    entityType: recordScope.entityType,
    entityId: recordScope.entityId,
  });
  return `/api/events?${query}`;
}

function connect() {
  if (source) return;
  source = new EventSource(eventUrl());
  source.addEventListener("open", () => dispatch({ kind: "open" }));
  source.addEventListener("bell", receive as EventListener);
  source.addEventListener("record", receive as EventListener);
  source.addEventListener("inbox", receive as EventListener);
}

/**
 * Keeps the tab's connection open while an authenticated shell exists.
 *
 * Route changes replace one shell component with another in the same
 * task. The deferred close lets the new owner retain the existing native
 * connection, and still closes it when navigation really leaves the
 * signed-in app.
 */
export function retainLiveEvents(scope?: LiveEventRecordScope): () => void {
  owners += 1;
  closeGeneration += 1;
  if (!sameScope(recordScope, scope)) {
    source?.close();
    source = null;
    recordScope = scope;
  }
  connect();
  let retained = true;
  return () => {
    if (!retained) return;
    retained = false;
    owners -= 1;
    const mine = ++closeGeneration;
    queueMicrotask(() => {
      if (owners !== 0 || mine !== closeGeneration) return;
      source?.close();
      source = null;
      recordScope = undefined;
    });
  };
}

/**
 * Holds the tab's connection for as long as the calling shell is mounted.
 *
 * The effect depends on the scope's primitives, not the object: a shell
 * passing an inline literal must not tear the connection down and reopen
 * it on every render. Both authenticated shells call this, so that rule
 * is kept once.
 */
export function useRetainedLiveEvents(scope?: LiveEventRecordScope): void {
  const entityType = scope?.entityType;
  const entityId = scope?.entityId;
  useEffect(
    () => retainLiveEvents(entityType && entityId ? { entityType, entityId } : undefined),
    [entityType, entityId],
  );
}

/** Subscribes a live surface without opening a second connection. */
export function subscribeLiveEvents(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
