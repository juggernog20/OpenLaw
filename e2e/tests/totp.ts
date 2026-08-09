// SPDX-License-Identifier: AGPL-3.0-only

/**
 * In-test TOTP (RFC 6238 over RFC 4226, HMAC-SHA1, 30-second step,
 * 6 digits — the parameters better-auth issues in its otpauth URIs).
 * The suite plays the authenticator app: it computes codes from the
 * manual-entry secret the enrolment page shows, so enrolment and
 * challenge are proven end to end without mocking time or crypto.
 */

import { createHmac } from "node:crypto";

const BASE32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

function base32Decode(encoded: string): Buffer {
  let bits = 0;
  let value = 0;
  const bytes: number[] = [];
  for (const char of encoded.toUpperCase().replace(/=+$/, "")) {
    const index = BASE32_ALPHABET.indexOf(char);
    if (index === -1) throw new Error(`Not a base32 character: ${char}`);
    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(bytes);
}

/** The 6-digit TOTP code for `secret` at `at` (defaults to now). */
export function totp(secret: string, at: number = Date.now()): string {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(at / 1000 / 30)));
  const digest = createHmac("sha1", base32Decode(secret)).update(counter).digest();
  const offset = digest[digest.length - 1]! & 0x0f;
  const code = (digest.readUInt32BE(offset) & 0x7fffffff) % 1_000_000;
  return code.toString().padStart(6, "0");
}
