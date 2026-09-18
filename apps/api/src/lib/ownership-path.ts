// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The ownership graph walk ENT-003 Holdings and ENT-011 register entries
 * share: is there a path from `start` down to `target`, following
 * owner-to-owned edges? A write that would add the edge target → start
 * on top of such a path closes a loop, and both writers refuse it.
 */
export function ownershipPath(
  rows: readonly { ownerEntityId: string; ownedEntityId: string }[],
  start: string,
  target: string,
): string[] | null {
  const children = new Map<string, string[]>();
  for (const row of rows) {
    const held = children.get(row.ownerEntityId) ?? [];
    held.push(row.ownedEntityId);
    children.set(row.ownerEntityId, held);
  }
  const queue: string[][] = [[start]];
  const seen = new Set([start]);
  while (queue.length > 0) {
    const path = queue.shift()!;
    const last = path.at(-1)!;
    if (last === target) return path;
    for (const child of children.get(last) ?? []) {
      if (!seen.has(child)) {
        seen.add(child);
        queue.push([...path, child]);
      }
    }
  }
  return null;
}
