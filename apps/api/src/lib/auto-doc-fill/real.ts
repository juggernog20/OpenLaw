// SPDX-License-Identifier: AGPL-3.0-only

/** TECH-028: a worker thread lets the request stop a CPU-bound fill on time. */
import { Worker } from "node:worker_threads";
import {
  AutoDocFillBusyError,
  AutoDocFillError,
  type AutoDocFillAdmission,
  type AutoDocFillEngine,
  type AutoDocFillInput,
} from "./engine.js";
import { Semaphore, SemaphoreFullError, type SemaphoreReservation } from "./semaphore.js";

const BOOTSTRAP = `
const { parentPort, workerData } = require("node:worker_threads");
(async () => {
  if (workerData.tsxUrl) {
    const { register } = await import(workerData.tsxUrl);
    register();
  }
  const { renderAutoDoc } = await import(workerData.moduleUrl);
  const output = renderAutoDoc({ ...workerData.input, template: Buffer.from(workerData.input.template) });
  parentPort.postMessage({ output });
})().catch(error => parentPort.postMessage({ error: error.message }));
`;

/**
 * How many fills one process runs at once. Each fill is a worker thread
 * with its own 256 MB heap and a full inflate of the template, so the
 * bound is what keeps a burst of Portal Generations from taking the
 * host's memory. Fills past the bound wait in arrival order.
 */
export const MAX_CONCURRENT_FILLS = 2;

/**
 * How many fills one process lets wait for a slot. The fill timeout
 * starts only once a slot is held, so without this cap a burst would
 * hold an open request per waiting fill with no bound on the wait. A
 * fill past the cap is refused at once with {@link AutoDocFillBusyError}.
 */
export const MAX_QUEUED_FILLS = 16;

export function createAutoDocFillEngine({
  timeoutMs = 10_000,
  maxConcurrentFills = MAX_CONCURRENT_FILLS,
  maxQueuedFills = MAX_QUEUED_FILLS,
}: {
  timeoutMs?: number;
  maxConcurrentFills?: number;
  maxQueuedFills?: number;
} = {}): AutoDocFillEngine {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0)
    throw new Error("A fill needs a positive timeout.");
  const source = import.meta.url.endsWith(".ts");
  const moduleUrl = new URL(source ? "./render.ts" : "./render.js", import.meta.url).href;
  // Source runs use the same loader as API development. Compiled deployments do not load tsx.
  const tsxUrl = source ? import.meta.resolve("tsx/esm/api") : undefined;
  const slots = new Semaphore(maxConcurrentFills, { maxQueued: maxQueuedFills });
  const busy = (error: unknown): never => {
    throw error instanceof SemaphoreFullError ? new AutoDocFillBusyError() : error;
  };
  const fill = (input: AutoDocFillInput, place?: SemaphoreReservation) =>
    slots.run(() => fillInWorker(input), place).catch(busy);
  return {
    fill: (input) => fill(input),
    admit(): AutoDocFillAdmission {
      let place: SemaphoreReservation;
      try {
        place = slots.reserve();
      } catch (error) {
        return busy(error);
      }
      return { fill: (input) => fill(input, place), release: () => place.release() };
    },
  };

  function fillInWorker(input: AutoDocFillInput): Promise<Buffer> {
    return new Promise<Buffer>((resolve, reject) => {
      const worker = new Worker(BOOTSTRAP, {
        eval: true,
        workerData: { input, moduleUrl, tsxUrl },
        execArgv: [],
        resourceLimits: { maxOldGenerationSizeMb: 256 },
      });
      let settled = false;
      const finish = (error?: Error, output?: Buffer) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        void worker.terminate().then(() => {
          if (error) reject(error);
          else resolve(output!);
        }, reject);
      };
      const timer = setTimeout(
        () => finish(new AutoDocFillError("The Word fill timed out. Try again.")),
        timeoutMs,
      );
      worker.once("message", (message: { output?: Uint8Array; error?: string }) => {
        if (message.output) finish(undefined, Buffer.from(message.output));
        else finish(new AutoDocFillError(message.error ?? "The Word file could not be filled."));
      });
      worker.once("error", (error: unknown) =>
        finish(
          new AutoDocFillError(error instanceof Error ? error.message : "The Word fill failed."),
        ),
      );
      worker.once("exit", () =>
        finish(new AutoDocFillError("The Word fill stopped before it produced a file.")),
      );
    });
  }
}
