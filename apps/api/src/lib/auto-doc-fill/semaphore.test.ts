// SPDX-License-Identifier: AGPL-3.0-only

/** The fill bound admits callers in arrival order, caps the queue, and frees a slot on failure. */
import { expect, it } from "vitest";
import { Semaphore, SemaphoreFullError } from "./semaphore.js";

const tick = () => new Promise<void>((resolve) => setImmediate(resolve));
/** Work that holds its slot until the test lets go. */
function holder(slots: Semaphore, reservation?: Parameters<Semaphore["run"]>[1]) {
  let free!: () => void;
  const done = slots.run(
    () =>
      new Promise<void>((resolve) => {
        free = resolve;
      }),
    reservation,
  );
  return { done, free: () => free() };
}

it("runs at most the bound at once and admits waiters in arrival order", async () => {
  const slots = new Semaphore(2);
  const started: string[] = [];
  const release: Record<string, () => void> = {};
  const hold = (name: string) =>
    slots.run(
      () =>
        new Promise<string>((resolve) => {
          started.push(name);
          release[name] = () => resolve(name);
        }),
    );
  const a = hold("a");
  const b = hold("b");
  const c = hold("c");
  const d = hold("d");
  await tick();
  expect(started).toEqual(["a", "b"]);
  expect(slots.active).toBe(2);
  expect(slots.queued).toBe(2);
  release.b!();
  await b;
  await tick();
  expect(started).toEqual(["a", "b", "c"]);
  release.a!();
  release.c!();
  await Promise.all([a, c]);
  await tick();
  expect(started).toEqual(["a", "b", "c", "d"]);
  release.d!();
  await d;
  expect(slots.active).toBe(0);
  expect(slots.queued).toBe(0);
});

it("frees the slot when the work throws", async () => {
  const slots = new Semaphore(1);
  await expect(slots.run(() => Promise.reject(new Error("boom")))).rejects.toThrow("boom");
  expect(slots.active).toBe(0);
  await expect(slots.run(async () => "next")).resolves.toBe("next");
});

it("refuses a bound that admits nobody", () => {
  expect(() => new Semaphore(0)).toThrow();
  expect(() => new Semaphore(1, { maxQueued: -1 })).toThrow();
  expect(() => new Semaphore(1, { maxQueued: 1.5 })).toThrow();
});

it("refuses a caller at once when every slot and queue place is taken", async () => {
  const slots = new Semaphore(1, { maxQueued: 1 });
  const a = holder(slots);
  const b = holder(slots);
  await tick();
  expect(slots.active).toBe(1);
  expect(slots.queued).toBe(1);
  expect(slots.full).toBe(true);
  await expect(slots.run(async () => "c")).rejects.toBeInstanceOf(SemaphoreFullError);
  expect(slots.queued).toBe(1);
  a.free();
  await a.done;
  await tick();
  expect(slots.active).toBe(1);
  expect(slots.queued).toBe(0);
  expect(slots.full).toBe(false);
  const d = holder(slots);
  await tick();
  expect(slots.queued).toBe(1);
  b.free();
  await b.done;
  await tick();
  d.free();
  await d.done;
  expect(slots.active).toBe(0);
});

it("holds a reserved place until it is run or released", async () => {
  const slots = new Semaphore(1, { maxQueued: 0 });
  const place = slots.reserve();
  expect(slots.reserved).toBe(1);
  expect(slots.full).toBe(true);
  expect(() => slots.reserve()).toThrow(SemaphoreFullError);
  await expect(slots.run(async () => "uninvited")).rejects.toBeInstanceOf(SemaphoreFullError);
  await expect(slots.run(async () => "reserved", place)).resolves.toBe("reserved");
  expect(slots.reserved).toBe(0);
  expect(slots.active).toBe(0);
  // Once run, the reservation is spent: another release changes nothing.
  place.release();
  expect(slots.reserved).toBe(0);
  const given = slots.reserve();
  given.release();
  given.release();
  expect(slots.reserved).toBe(0);
  expect(slots.full).toBe(false);
});

it("checks a released reservation like any other caller", async () => {
  const slots = new Semaphore(1, { maxQueued: 0 });
  const place = slots.reserve();
  place.release();
  const a = holder(slots);
  await tick();
  await expect(slots.run(async () => "late", place)).rejects.toBeInstanceOf(SemaphoreFullError);
  a.free();
  await a.done;
});

it("lets a reserved place wait in the queue when the slots are busy", async () => {
  const slots = new Semaphore(1, { maxQueued: 1 });
  const a = holder(slots);
  await tick();
  const place = slots.reserve();
  expect(slots.full).toBe(true);
  const b = holder(slots, place);
  await tick();
  expect(slots.reserved).toBe(0);
  expect(slots.queued).toBe(1);
  expect(slots.full).toBe(true);
  a.free();
  await a.done;
  await tick();
  expect(slots.active).toBe(1);
  b.free();
  await b.done;
  expect(slots.active).toBe(0);
});
