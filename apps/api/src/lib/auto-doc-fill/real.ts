// SPDX-License-Identifier: AGPL-3.0-only

/** TECH-028: a worker thread lets the request stop a CPU-bound fill on time. */
import { Worker } from "node:worker_threads";
import { AutoDocFillError, type AutoDocFillEngine, type AutoDocFillInput } from "./engine.js";
import { Semaphore } from "./semaphore.js";

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

export function createAutoDocFillEngine({
  timeoutMs = 10_000,
  maxConcurrentFills = MAX_CONCURRENT_FILLS,
}: { timeoutMs?: number; maxConcurrentFills?: number } = {}): AutoDocFillEngine {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0)
    throw new Error("A fill needs a positive timeout.");
  const source = import.meta.url.endsWith(".ts");
  const moduleUrl = new URL(source ? "./render.ts" : "./render.js", import.meta.url).href;
  // Source runs use the same loader as API development. Compiled deployments do not load tsx.
  const tsxUrl = source ? import.meta.resolve("tsx/esm/api") : undefined;
  const slots = new Semaphore(maxConcurrentFills);
  return {
    fill(input) {
      return slots.run(() => fillInWorker(input));
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
