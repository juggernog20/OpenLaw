// SPDX-License-Identifier: AGPL-3.0-only

/** One browser-owned connection for TECH-009's live prompts. */

import { parseLiveEvent, type LiveEvent } from "@openlaw/shared";

/** `open` fires on the first connection and after every native reconnect. */
export type BrowserLiveEvent = LiveEvent | { kind: "open" };

type Listener = (event: BrowserLiveEvent) => void;

const listeners = new Set<Listener>();
let source: EventSource | null = null;
let owners = 0;
let closeGeneration = 0;

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

function connect() {
  if (source) return;
  source = new EventSource("/api/events");
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
export function retainLiveEvents(): () => void {
  owners += 1;
  closeGeneration += 1;
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
    });
  };
}

/** Subscribes a live surface without opening a second connection. */
export function subscribeLiveEvents(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
