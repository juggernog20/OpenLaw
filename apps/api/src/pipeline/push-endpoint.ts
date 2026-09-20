// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Where a push may be sent (TECH-034).
 *
 * The subscription route stores whatever HTTPS URL a signed-in person
 * posts, and the worker then connects to it. Without a guard that is a
 * way to make the worker open sockets inside the install's own network.
 * The guard sits at the connection rather than at save time: the host is
 * resolved when the socket opens, every answer that is not a public
 * address is refused, and the socket connects to the address that was
 * checked. A name whose answer changes between a check and the connect
 * gains nothing, because there is no separate check.
 *
 * `net.connect` skips `lookup` for an IP literal, so a literal host is
 * judged before the socket by {@link isRefusedLiteral}.
 */

import dns from "node:dns";
import https from "node:https";
import net from "node:net";

/** The endpoint's host is not a public address. Permanent: the row is pruned. */
export class PushEndpointRefused extends Error {
  constructor(readonly hostname: string) {
    super("The push endpoint is not a public address.");
    this.name = "PushEndpointRefused";
  }
}

const blocked = new net.BlockList();
// IPv4: this host, private, shared (CGNAT), loopback, link-local, IETF
// assignments, documentation, 6to4 relay, benchmarking, multicast, and
// reserved, which holds broadcast.
for (const [address, prefix] of [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["192.88.99.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 4],
  ["240.0.0.0", 4],
] as const) {
  blocked.addSubnet(address, prefix, "ipv4");
}
// IPv6: unspecified, loopback, NAT64's well-known prefix (an embedded
// IPv4 address the list cannot judge), discard, documentation, unique
// local, link-local, multicast. An IPv4-mapped address is judged by the
// IPv4 rules above.
for (const [address, prefix] of [
  ["::", 128],
  ["::1", 128],
  ["64:ff9b::", 96],
  ["100::", 64],
  ["2001:db8::", 32],
  ["fc00::", 7],
  ["fe80::", 10],
  ["ff00::", 8],
] as const) {
  blocked.addSubnet(address, prefix, "ipv6");
}

/** Whether an IP address, v4 or v6, is one a push relay could live on. */
export function isPublicAddress(address: string): boolean {
  const bare = address.replace(/%.*$/, "");
  const family = net.isIP(bare);
  if (family === 0) return false;
  return !blocked.check(bare, family === 6 ? "ipv6" : "ipv4");
}

/** Whether an endpoint names its host as an IP literal that is not public. */
export function isRefusedLiteral(endpoint: string): boolean {
  let hostname: string;
  try {
    hostname = new URL(endpoint).hostname;
  } catch {
    return true;
  }
  const bare = hostname.replace(/^\[|\]$/g, "");
  return net.isIP(bare) !== 0 && !isPublicAddress(bare);
}

export interface ResolvedAddress {
  address: string;
  family: number;
}
/** Answers every address a hostname resolves to. Replaced in tests. */
export type Resolver = (hostname: string) => Promise<ResolvedAddress[]>;

const systemResolver: Resolver = (hostname) => dns.promises.lookup(hostname, { all: true });

type LookupCallback = (
  error: Error | null,
  address?: string | ResolvedAddress[],
  family?: number,
) => void;

/**
 * A `lookup` for `net.connect` that answers only public addresses.
 *
 * The socket connects to what this answers, so the check and the connect
 * are one step. When nothing public is left, the socket fails with
 * {@link PushEndpointRefused}, which the sender treats as permanent.
 */
export function publicOnlyLookup(
  resolve: Resolver = systemResolver,
): (hostname: string, options: unknown, callback: LookupCallback) => void {
  return (hostname, options, callback) => {
    const all =
      typeof options === "object" &&
      options !== null &&
      (options as { all?: boolean }).all === true;
    resolve(hostname).then(
      (answers) => {
        const allowed = answers.filter((answer) => isPublicAddress(answer.address));
        if (allowed.length === 0) {
          callback(new PushEndpointRefused(hostname));
          return;
        }
        if (all) callback(null, allowed);
        else callback(null, allowed[0]!.address, allowed[0]!.family);
      },
      (error: unknown) => callback(error instanceof Error ? error : new Error(String(error))),
    );
  };
}

/** The agent every production push goes through. */
export function createPushAgent(resolve?: Resolver): https.Agent {
  return new https.Agent({
    ca: https.globalAgent.options.ca,
    lookup: publicOnlyLookup(resolve) as unknown as net.LookupFunction,
  });
}
