// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The gate claims a position before the body arrives, so uploads that
 * arrive together never outnumber the slots and queue places. Run with
 * `tsx --test src/server.test.ts`.
 */
import assert from "node:assert/strict";
import { request as httpRequest, type IncomingMessage } from "node:http";
import type { AddressInfo, Socket } from "node:net";
import { once } from "node:events";
import { describe, it } from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import { OperationError } from "./problem.js";
import { ToolGate, createDocEngineServer } from "./server.js";

const tick = (): Promise<void> => new Promise((resolve) => setImmediate(resolve));
const never = new AbortController().signal;

/** Work that holds its slot until the test lets go. */
function hold(gate: ToolGate, signal: AbortSignal = never) {
  const admission = gate.admit();
  let free!: () => void;
  const done = admission.run(
    signal,
    () =>
      new Promise<void>((resolve) => {
        free = resolve;
      }),
  );
  return { admission, done, free: () => free() };
}

describe("ToolGate", () => {
  it("claims a position at admission, before any tool runs", () => {
    const gate = new ToolGate(1, 1);
    const first = gate.admit();
    const second = gate.admit();
    assert.equal(gate.held, 2);
    assert.equal(gate.active, 0);
    assert.equal(gate.full, true);
    assert.throws(
      () => gate.admit(),
      (error: unknown) => {
        assert.ok(error instanceof OperationError);
        assert.equal(error.status, 503);
        assert.equal(error.retryAfterSeconds, 5);
        return true;
      },
    );
    second.release();
    assert.equal(gate.held, 1);
    assert.equal(gate.full, false);
    // A released position is released once, however often it is given back.
    second.release();
    assert.equal(gate.held, 1);
    first.release();
    assert.equal(gate.held, 0);
  });

  it("runs on the claimed position rather than counting it twice", async () => {
    const gate = new ToolGate(1, 1);
    const a = hold(gate);
    await tick();
    assert.equal(gate.active, 1);
    assert.equal(gate.held, 0);
    const b = hold(gate);
    await tick();
    assert.equal(gate.queued, 1);
    assert.equal(gate.held, 0);
    assert.equal(gate.full, true);
    assert.throws(() => gate.admit());
    // Once run, a position cannot be given back under the tool.
    a.admission.release();
    assert.equal(gate.active, 1);
    a.free();
    await a.done;
    await tick();
    assert.equal(gate.active, 1);
    assert.equal(gate.queued, 0);
    b.free();
    await b.done;
    assert.equal(gate.active, 0);
    assert.equal(gate.full, false);
  });

  it("refuses to run a position that was given back", async () => {
    const gate = new ToolGate(1, 0);
    const admission = gate.admit();
    admission.release();
    await assert.rejects(
      admission.run(never, async () => "late"),
      /gave up its position/,
    );
    assert.equal(gate.active, 0);
  });

  it("frees a queued position when its caller goes away", async () => {
    const gate = new ToolGate(1, 1);
    const a = hold(gate);
    await tick();
    const gone = new AbortController();
    const b = hold(gate, gone.signal);
    await tick();
    assert.equal(gate.queued, 1);
    gone.abort();
    await assert.rejects(b.done, /abandoned/);
    assert.equal(gate.queued, 0);
    assert.equal(gate.full, false);
    a.free();
    await a.done;
  });
});

describe("createDocEngineServer", () => {
  it("refuses a second upload before the first has finished arriving", async () => {
    const server = createDocEngineServer({
      operationTimeoutMs: 1000,
      compareTimeoutMs: 1000,
      maxBodyBytes: 1024,
      maxConcurrent: 1,
      maxQueued: 0,
    });
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const { port } = server.address() as AddressInfo;
    const open = (): ReturnType<typeof httpRequest> =>
      httpRequest({ host: "127.0.0.1", port, method: "POST", path: "/extract" });
    try {
      // The first upload sends one byte and then stalls, holding its position.
      const stalled = open();
      // Hanging up below ends this request with "socket hang up", which is the point.
      stalled.on("error", () => undefined);
      stalled.setHeader("content-length", "2");
      stalled.write("a");
      const [socket] = (await once(stalled, "socket")) as [Socket];
      if (socket.connecting) await once(socket, "connect");
      // Loopback is fast, not instant: give the server time to read the headers.
      await delay(50);
      // The second is refused while the first body is still on its way.
      const refused = open();
      const answered = once(refused, "response") as Promise<[IncomingMessage]>;
      refused.end("%PDF");
      const [response] = await answered;
      assert.equal(response.statusCode, 503);
      assert.equal(response.headers["retry-after"], "5");
      response.resume();
      await once(response, "end");
      // The stalled caller hangs up, and its position is given back once
      // the server sees the socket close.
      stalled.destroy();
      await delay(100);
      const admitted = open();
      const later = once(admitted, "response") as Promise<[IncomingMessage]>;
      admitted.end("%PDF");
      const [next] = await later;
      assert.notEqual(next.statusCode, 503);
      next.resume();
      await once(next, "end");
    } finally {
      server.closeAllConnections();
      server.close();
      await once(server, "close");
    }
  });
});
