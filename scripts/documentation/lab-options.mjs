// SPDX-License-Identifier: AGPL-3.0-only
import { isIP } from "node:net";

/** Non-secret configuration included in the lab's immutable configuration digest. */
export function acceptanceConfiguration(config) {
  const mode = config["signing-preparation"] || "off";
  if (!["off", "live"].includes(mode)) throw new Error("Signing preparation must be off or live.");
  const networks = {};
  const used = new Set();
  for (const [key, name] of [
    ["backend-subnet", "openlaw-backend"],
    ["engine-subnet", "openlaw-doc-engine"],
  ]) {
    const subnet = config[key];
    if (!subnet) continue;
    const [address, prefix] = subnet.split("/");
    if (
      isIP(address) !== 4 ||
      prefix !== "24" ||
      !address.endsWith(".0") ||
      subnet.split("/").length !== 2
    )
      throw new Error("Lab subnets must be IPv4 /24 network addresses.");
    if (used.has(subnet)) throw new Error("Lab subnets must differ.");
    used.add(subnet);
    networks[name] = { ipam: { config: [{ subnet }] } };
  }
  return {
    environment:
      mode === "live"
        ? { SIGNING_PREPARATION_ENABLED: "true", SIGNING_PREPARATION_LIVE_LAB: "true" }
        : {},
    networks,
  };
}
