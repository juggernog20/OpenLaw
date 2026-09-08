// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Reads a file through the descriptor its own checks ran against.
 *
 * Checking a path with `lstat` and then reading the same path is two
 * lookups, and what the second one finds need not be what the first one
 * approved. Every caller here hashes the bytes into an identity: the
 * application digest an edition records, the source snapshot a lab is
 * pinned to, the guide text an evidence record is bound to. A path
 * swapped between the check and the read would move an identity that is
 * supposed to describe what was checked.
 *
 * One open closes that gap. `O_NOFOLLOW` makes the kernel refuse a
 * symlink at the final component, and `fstat` describes the object the
 * descriptor holds rather than the name it came from, so the bytes
 * returned are the bytes that passed the type check.
 *
 * This adds to the callers' own checks; it does not replace them. The
 * path containment and per-component symlink walks still run, because
 * `O_NOFOLLOW` says nothing about the directories on the way down.
 */

import { closeSync, constants, fstatSync, openSync, readFileSync } from "node:fs";

// Every platform this runs on has the flag. It is read defensively so a
// port cannot silently turn the open into a following one, and the
// caller's own symlink check stays the guard if it ever is absent.
const NO_FOLLOW = constants.O_NOFOLLOW ?? 0;

/**
 * The bytes of one regular file, or an Error naming the reason. `label`
 * is what the caller calls the file in its own messages.
 */
export function readOwnedFile(path, label = path) {
  let descriptor;
  try {
    descriptor = openSync(path, constants.O_RDONLY | NO_FOLLOW);
  } catch (error) {
    // What the kernel answers when O_NOFOLLOW meets a symlink.
    if (error?.code === "ELOOP") throw new Error(`symlink forbidden: ${label}`, { cause: error });
    throw error;
  }
  try {
    if (!fstatSync(descriptor).isFile()) throw new Error(`not a file: ${label}`);
    return readFileSync(descriptor);
  } finally {
    closeSync(descriptor);
  }
}
