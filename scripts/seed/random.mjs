/* Deterministic randomness for the demo seed.
 *
 * Every run with the same seed must produce the same instance. Two
 * reviews of the same screen a week apart should differ because the
 * screen changed, not because the data did. `Math.random` cannot give
 * that, so the whole seed draws from one small generator.
 */

/** mulberry32: small, fast, and good enough for picking names. */
export function createRandom(seed = 0x0e57ec7) {
  let state = seed >>> 0;
  const next = () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

  /** A float in [min, max). */
  const float = (min, max) => min + next() * (max - min);

  /** An integer in [min, max], both ends included. */
  const int = (min, max) => Math.floor(float(min, max + 1));

  /** One item from `list`. */
  const pick = (list) => list[int(0, list.length - 1)];

  /** `count` distinct items from `list`, or the whole list if it is shorter. */
  const sample = (list, count) => {
    const pool = [...list];
    const taken = [];
    while (taken.length < count && pool.length > 0)
      taken.push(...pool.splice(int(0, pool.length - 1), 1));
    return taken;
  };

  /** True with probability `chance` (0 to 1). */
  const chance = (probability) => next() < probability;

  /** A weighted pick: `[[item, weight], ...]`. */
  const weighted = (pairs) => {
    const total = pairs.reduce((sum, [, weight]) => sum + weight, 0);
    let roll = float(0, total);
    for (const [item, weight] of pairs) {
      roll -= weight;
      if (roll <= 0) return item;
    }
    return pairs[pairs.length - 1][0];
  };

  /** A copy of `list` in a shuffled order. */
  const shuffle = (list) => sample(list, list.length);

  return { next, float, int, pick, sample, chance, weighted, shuffle };
}
