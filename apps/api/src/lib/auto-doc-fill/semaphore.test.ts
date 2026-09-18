// SPDX-License-Identifier: AGPL-3.0-only

/** The fill bound admits callers in arrival order and frees a slot on failure. */
import { expect, it } from "vitest";
import { Semaphore } from "./semaphore.js";

const tick = () => new Promise<void>((resolve) => setImmediate(resolve));

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
});
