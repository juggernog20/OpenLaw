// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Advisory reachability checks for hosted Clients: HTTPS, an IPv4 record, and a
 * public IPv4 address, with a 30-second cache. The checks warn and never refuse,
 * because a proxy may front the API. See the hosted-Client rule in DD-029.
 */
import { Resolver } from "node:dns/promises";
import { isIPv4, isIPv6 } from "node:net";
import { z } from "zod";

export const Reachability = z.array(
  z.object({
    name: z.enum(["https", "ipv4", "public_ipv4"]),
    passed: z.boolean(),
  }),
);
export type ResolveIpv4 = (host: string) => Promise<string[]>;
const resolver = new Resolver({ timeout: 1500, tries: 1 });
const resolveIpv4: ResolveIpv4 = async (host) => {
  if (isIPv4(host)) return [host];
  if (isIPv6(host)) return [];
  return resolver.resolve4(host);
};
function publicIpv4(address: string): boolean {
  if (!isIPv4(address)) return false;
  const [a = 0, b = 0] = address.split(".").map(Number);
  return !(
    a === 0 ||
    a === 10 ||
    a === 127 ||
    a >= 224 ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 169 && b === 254) ||
    (a === 100 && b >= 64 && b <= 127)
  );
}
/** DNS is advisory: a proxy may expose an address the API cannot resolve. */
export function createReachabilityCheck(baseUrl: string, resolve: ResolveIpv4 = resolveIpv4) {
  const url = new URL(baseUrl);
  let cached: { expires: number; checks: Promise<z.infer<typeof Reachability>> } | undefined;
  return () => {
    if (cached && cached.expires > Date.now()) return cached.checks;
    const checks = (async () => {
      const addresses = await resolve(url.hostname.replace(/^\[|\]$/g, "")).catch(() => []);
      return [
        { name: "https" as const, passed: url.protocol === "https:" },
        { name: "ipv4" as const, passed: addresses.some(isIPv4) },
        {
          name: "public_ipv4" as const,
          passed: addresses.length > 0 && addresses.every(publicIpv4),
        },
      ];
    })();
    cached = { expires: Date.now() + 30_000, checks };
    return checks;
  };
}
