// SPDX-License-Identifier: AGPL-3.0-only

import { describe, expect, it } from "vitest";
import {
  isPublicAddress,
  isRefusedLiteral,
  publicOnlyLookup,
  PushEndpointRefused,
} from "./push-endpoint.js";

describe("isPublicAddress", () => {
  it.each([
    "127.0.0.1",
    "10.1.2.3",
    "172.16.0.9",
    "172.31.255.255",
    "192.168.1.1",
    "169.254.169.254",
    "100.64.0.1",
    "0.0.0.0",
    "224.0.0.1",
    "255.255.255.255",
    "::1",
    "::",
    "fc00::1",
    "fd12::1",
    "fe80::1",
    "fe80::1%eth0",
    "ff02::1",
    "::ffff:10.0.0.1",
    "::ffff:127.0.0.1",
    "64:ff9b::a00:1",
    "2001:db8::1",
  ])("refuses %s", (address) => {
    expect(isPublicAddress(address)).toBe(false);
  });
  it.each(["8.8.8.8", "172.32.0.1", "142.250.72.46", "2606:4700::1111", "::ffff:8.8.8.8"])(
    "allows %s",
    (address) => {
      expect(isPublicAddress(address)).toBe(true);
    },
  );
  it("refuses what is not an address", () => {
    expect(isPublicAddress("push.example")).toBe(false);
  });
});

describe("isRefusedLiteral", () => {
  it.each([
    "https://127.0.0.1:8443/send/abc",
    "https://10.0.0.5/send",
    "https://[::1]/send",
    "https://[fe80::1]/send",
    "not a url",
  ])("refuses %s", (endpoint) => {
    expect(isRefusedLiteral(endpoint)).toBe(true);
  });
  it.each([
    "https://fcm.googleapis.com/fcm/send/abc",
    "https://updates.push.services.mozilla.com/wpush/v2/abc",
    "https://8.8.8.8/send",
    "https://[2606:4700::1111]/send",
  ])("passes %s to the connection guard", (endpoint) => {
    expect(isRefusedLiteral(endpoint)).toBe(false);
  });
});

describe("publicOnlyLookup", () => {
  const answering =
    (...answers: { address: string; family: number }[]) =>
    () =>
      Promise.resolve(answers);
  const lookup = (resolver: Parameters<typeof publicOnlyLookup>[0], options: unknown) =>
    new Promise<unknown[]>((resolve) => {
      publicOnlyLookup(resolver)("push.example", options, (...args) => resolve(args));
    });

  it("answers the first public address for a single lookup", async () => {
    const [error, address, family] = await lookup(
      answering({ address: "10.0.0.1", family: 4 }, { address: "142.250.72.46", family: 4 }),
      { family: 0 },
    );
    expect(error).toBeNull();
    expect(address).toBe("142.250.72.46");
    expect(family).toBe(4);
  });

  it("answers only the public addresses when every address is asked for", async () => {
    const [error, addresses] = await lookup(
      answering(
        { address: "::1", family: 6 },
        { address: "2606:4700::1111", family: 6 },
        { address: "127.0.0.1", family: 4 },
        { address: "8.8.8.8", family: 4 },
      ),
      { all: true },
    );
    expect(error).toBeNull();
    expect(addresses).toEqual([
      { address: "2606:4700::1111", family: 6 },
      { address: "8.8.8.8", family: 4 },
    ]);
  });

  it("refuses a name that resolves only to private addresses", async () => {
    const [error] = await lookup(
      answering({ address: "10.0.0.1", family: 4 }, { address: "fd00::1", family: 6 }),
      { all: true },
    );
    expect(error).toBeInstanceOf(PushEndpointRefused);
    expect((error as PushEndpointRefused).hostname).toBe("push.example");
  });

  it("passes a resolver failure through", async () => {
    const [error] = await lookup(() => Promise.reject(new Error("ENOTFOUND")), { all: true });
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toBe("ENOTFOUND");
  });
});
