// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The email domains an identity provider serves (TECH-008, multiple
 * providers). The sso plugin stores them as one comma-separated string
 * and resolves a sign-in by the address a person enters, matching a
 * domain exactly or as a parent of it (`hr.acme.example` matches a
 * provider that claims `acme.example`). Two providers whose domains
 * overlap would make that lookup order-dependent, so the registration
 * routes refuse the overlap here before the plugin ever sees it.
 */

/** One DNS label per segment, no scheme, no path, at least one dot. */
const DOMAIN_PATTERN = /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z][a-z0-9-]{0,61}[a-z0-9]?$/;

/** Splits the stored string into normalized domains; never throws. */
export function splitProviderDomains(domain: string): string[] {
  const seen = new Set<string>();
  for (const entry of domain.split(",")) {
    const trimmed = entry.trim().toLowerCase();
    if (trimmed) seen.add(trimmed);
  }
  return [...seen];
}

/**
 * Validates an Administrator's domain entry. Returns the normalized list
 * or the first entry that is not a bare domain, so the caller can name
 * it in the refusal.
 */
export function parseProviderDomains(
  domain: string,
): { ok: true; domains: string[] } | { ok: false; invalid: string } {
  const domains = splitProviderDomains(domain);
  for (const candidate of domains) {
    if (!DOMAIN_PATTERN.test(candidate)) return { ok: false, invalid: candidate };
  }
  if (domains.length === 0) return { ok: false, invalid: domain.trim() };
  return { ok: true, domains };
}

/** True when a sign-in address on `a` could resolve to a provider claiming `b`, or the reverse. */
export function domainsOverlap(a: string, b: string): boolean {
  return a === b || a.endsWith(`.${b}`) || b.endsWith(`.${a}`);
}

/**
 * The first clash between the candidate domains and another provider's,
 * or null when every domain is free. `others` excludes the provider
 * being written, so an update may keep its own domains.
 */
export function findDomainConflict(
  candidates: string[],
  others: { providerId: string; name: string; domain: string }[],
): { domain: string; claimedBy: string; providerId: string; providerName: string } | null {
  for (const candidate of candidates) {
    for (const other of others) {
      for (const claimed of splitProviderDomains(other.domain)) {
        if (domainsOverlap(candidate, claimed)) {
          return {
            domain: candidate,
            claimedBy: claimed,
            providerId: other.providerId,
            providerName: other.name || other.providerId,
          };
        }
      }
    }
  }
  return null;
}
