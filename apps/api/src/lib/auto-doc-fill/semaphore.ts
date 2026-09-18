// SPDX-License-Identifier: AGPL-3.0-only

/**
 * A counting semaphore with a bounded queue. Callers past the bound wait
 * in arrival order. Callers past the queue cap are refused at once with
 * {@link SemaphoreFullError}, so nobody waits without a limit.
 */

/** Every slot and every queue place is taken. The caller should try again later. */
export class SemaphoreFullError extends Error {
  constructor() {
    super("Every slot and every queue place is taken.");
    this.name = "SemaphoreFullError";
  }
}

/**
 * One place claimed ahead of a run. A caller that has to do work before
 * it runs, and must not be refused after that work, reserves first and
 * hands the reservation to {@link Semaphore.run}. A reservation that is
 * never run is given back with `release`.
 */
export interface SemaphoreReservation {
  /** Gives the place back. A no-op once the place was run or released. */
  release(): void;
}

export class Semaphore {
  private held = 0;
  private reservedPlaces = 0;
  private readonly waiting: Array<() => void> = [];
  private readonly maxQueued: number;

  constructor(
    private readonly bound: number,
    { maxQueued = Number.POSITIVE_INFINITY }: { maxQueued?: number } = {},
  ) {
    if (!Number.isInteger(bound) || bound < 1)
      throw new Error("A semaphore needs a positive whole bound.");
    if (maxQueued !== Number.POSITIVE_INFINITY && (!Number.isInteger(maxQueued) || maxQueued < 0))
      throw new Error("A semaphore queue cap must be a whole number.");
    this.maxQueued = maxQueued;
  }

  /** How many callers hold a slot now. */
  get active(): number {
    return this.held;
  }

  /** How many callers wait for a slot now. */
  get queued(): number {
    return this.waiting.length;
  }

  /** How many places are reserved but not yet run. */
  get reserved(): number {
    return this.reservedPlaces;
  }

  /** Whether a new caller would be refused rather than admitted. */
  get full(): boolean {
    return this.held + this.waiting.length + this.reservedPlaces >= this.bound + this.maxQueued;
  }

  /**
   * Claims one place now for a run that starts later. Throws
   * {@link SemaphoreFullError} when every slot and queue place is taken.
   */
  reserve(): SemaphoreReservation {
    if (this.full) throw new SemaphoreFullError();
    this.reservedPlaces += 1;
    let open = true;
    return {
      release: () => {
        if (!open) return;
        open = false;
        this.reservedPlaces -= 1;
      },
    };
  }

  /**
   * Runs `work` once a slot is free and releases the slot when it
   * settles. With a `reservation` the caller takes the place it claimed;
   * without one it takes a free place or is refused with
   * {@link SemaphoreFullError}.
   */
  async run<T>(work: () => Promise<T>, reservation?: SemaphoreReservation): Promise<T> {
    await this.acquire(reservation);
    try {
      return await work();
    } finally {
      this.release();
    }
  }

  private acquire(reservation?: SemaphoreReservation): Promise<void> {
    // A reservation already counts in `full`, so it converts to a slot
    // or a queue place without a second check. One released before the
    // run counts for nothing and the caller is checked like anyone else.
    const reservedBefore = this.reservedPlaces;
    reservation?.release();
    const claimed = this.reservedPlaces < reservedBefore;
    if (!claimed && this.full) return Promise.reject(new SemaphoreFullError());
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
