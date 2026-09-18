// SPDX-License-Identifier: AGPL-3.0-only

/** A counting semaphore. Callers past the bound wait in arrival order. */
export class Semaphore {
  private held = 0;
  private readonly waiting: Array<() => void> = [];

  constructor(private readonly bound: number) {
    if (!Number.isInteger(bound) || bound < 1)
      throw new Error("A semaphore needs a positive whole bound.");
  }

  /** How many callers hold a slot now. */
  get active(): number {
    return this.held;
  }

  /** How many callers wait for a slot now. */
  get queued(): number {
    return this.waiting.length;
  }

  /** Runs `work` once a slot is free and releases the slot when it settles. */
  async run<T>(work: () => Promise<T>): Promise<T> {
    await this.acquire();
    try {
      return await work();
    } finally {
      this.release();
    }
  }

  private acquire(): Promise<void> {
    if (this.held < this.bound) {
      this.held += 1;
      return Promise.resolve();
    }
    return new Promise((resolve) => {
      this.waiting.push(() => {
        this.held += 1;
        resolve();
      });
    });
  }

  private release(): void {
    this.held -= 1;
    const next = this.waiting.shift();
    if (next) next();
  }
}
