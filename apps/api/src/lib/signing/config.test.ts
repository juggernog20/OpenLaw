// SPDX-License-Identifier: AGPL-3.0-only

/**
 * What the environment is allowed to say about where DocuSign is.
 *
 * The rule this file pins is that a real install says nothing: no
 * deployment sets `DOCUSIGN_BASE_URL`, so the driver a real install
 * builds is the plain one, pointed at DocuSign's own estate by the
 * stored connector's environment. The override exists for the dev/E2E
 * overlay alone, and an operator who mistypes it is stopped rather than
 * quietly connected to DocuSign.
 *
 * The second rule is that it takes two variables to move an install
 * off DocuSign, and that either one alone stops the boot. Every case
 * below that names a host names the flag beside it, because a case that
 * did not would now be testing the refusal rather than the parse.
 */

import { generateKeyPairSync } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import {
  SigningHostConfigError,
  SIGNING_STANDIN_VALUE,
  SIGNING_STANDIN_VARIABLE,
  createDocuSignDriverFactory,
  readDocuSignBaseUrl,
} from "./config.js";
import { createDocuSignProvider } from "./docusign.js";

/** A throwaway RSA key pair, generated per run, so the assertion the
 * driver signs can be built at all. Nothing here reaches a provider. */
const RSA_KEY = generateKeyPairSync("rsa", {
  modulusLength: 2048,
  publicKeyEncoding: { type: "spki", format: "pem" },
  privateKeyEncoding: { type: "pkcs8", format: "pem" },
}).privateKey;

/** What the dev/E2E overlay declares beside the address. */
const DECLARED = { [SIGNING_STANDIN_VARIABLE]: SIGNING_STANDIN_VALUE };

describe("signing host configuration", () => {
  it("names no stand-in when nothing is set", () => {
    expect(readDocuSignBaseUrl({})).toBeUndefined();
  });

  it("treats an empty variable as unset", () => {
    // Under Compose every declared variable exists and is empty when
    // .env leaves it out. Both of them, so a stack that declares the
    // names and fills in neither is an ordinary install.
    expect(
      readDocuSignBaseUrl({ DOCUSIGN_BASE_URL: "  ", [SIGNING_STANDIN_VARIABLE]: " " }),
    ).toBeUndefined();
  });

  it("takes the origin the overlay points signing at", () => {
    expect(
      readDocuSignBaseUrl({ ...DECLARED, DOCUSIGN_BASE_URL: "http://host.docker.internal:8129" }),
    ).toBe("http://host.docker.internal:8129");
  });

  it("refuses a value that is not an absolute http origin", () => {
    for (const value of ["localhost:8129", "ftp://stub.invalid", "/signing"]) {
      expect(() => readDocuSignBaseUrl({ ...DECLARED, DOCUSIGN_BASE_URL: value })).toThrow(
        SigningHostConfigError,
      );
    }
  });

  it("refuses an origin carrying a path, a query, or a fragment", () => {
    // The driver appends DocuSign's own paths, so anything after the
    // authority would be dropped. Refused rather than trimmed: an
    // operator who wrote it meant something by it.
    for (const value of [
      "http://stand-in.invalid:8129/docusign",
      "http://stand-in.invalid:8129/?tenant=2",
      "http://stand-in.invalid:8129/#demo",
    ]) {
      expect(() => readDocuSignBaseUrl({ ...DECLARED, DOCUSIGN_BASE_URL: value })).toThrow(
        SigningHostConfigError,
      );
    }
    // A bare trailing slash is the same origin written out, and is kept.
    expect(
      readDocuSignBaseUrl({ ...DECLARED, DOCUSIGN_BASE_URL: "http://stand-in.invalid:8129/" }),
    ).toBe("http://stand-in.invalid:8129");
  });

  it("refuses credentials in the URL", () => {
    // `URL#origin` would drop them silently, and the driver carries its
    // own credentials. Same dropped-not-honoured rule as a path.
    for (const value of [
      "http://operator:hunter2@stand-in.invalid:8129",
      "http://operator@stand-in.invalid:8129",
    ]) {
      expect(() => readDocuSignBaseUrl({ ...DECLARED, DOCUSIGN_BASE_URL: value })).toThrow(
        SigningHostConfigError,
      );
    }
  });

  describe("the two variables have to agree", () => {
    it("refuses an address with no declaration", () => {
      // The mistake the second variable exists for: one line in the
      // wrong .env, and a real install's paper goes to whatever host it
      // names with a boot warning as the only sign.
      expect(() =>
        readDocuSignBaseUrl({ DOCUSIGN_BASE_URL: "http://stand-in.invalid:8129" }),
      ).toThrow(SigningHostConfigError);
    });

    it("refuses a declaration with no address", () => {
      // The honest reading is that the address was meant to be there
      // and was lost. Ignoring the flag would leave this install
      // dialling DocuSign while its operator believed it could not.
      expect(() => readDocuSignBaseUrl({ ...DECLARED })).toThrow(SigningHostConfigError);
    });

    it("refuses a declaration that says anything else", () => {
      for (const value of ["1", "yes", "on", "false", "standin"]) {
        expect(() =>
          readDocuSignBaseUrl({
            [SIGNING_STANDIN_VARIABLE]: value,
            DOCUSIGN_BASE_URL: "http://stand-in.invalid:8129",
          }),
        ).toThrow(SigningHostConfigError);
      }
    });

    it("reads the declaration whatever case it is written in", () => {
      expect(
        readDocuSignBaseUrl({
          [SIGNING_STANDIN_VARIABLE]: "TRUE",
          DOCUSIGN_BASE_URL: "http://stand-in.invalid:8129",
        }),
      ).toBe("http://stand-in.invalid:8129");
    });
  });

  it("builds the plain driver when no stand-in is named", () => {
    // Identity, not equivalence: an install with no override carries no
    // indirection at all, which is what keeps this switch out of every
    // real deployment.
    expect(createDocuSignDriverFactory()).toBe(createDocuSignProvider);
  });

  it("builds a driver that talks to the stand-in when one is named", async () => {
    // Proved by where it dials rather than by reading the instance: the
    // factory's whole job is the host, and the host is what shows up in
    // the requests. The grant answers, so the account discovery after it
    // is dialled too. Those are the two calls the driver makes on its
    // own before it follows the account's `base_uri` anywhere else.
    const asked: string[] = [];
    vi.stubGlobal("fetch", (input: Parameters<typeof fetch>[0]) => {
      const url = String(input);
      asked.push(url);
      if (url.endsWith("/oauth/token")) {
        return Promise.resolve(
          new Response(JSON.stringify({ access_token: "stand-in-token", expires_in: 3600 }), {
            headers: { "content-type": "application/json" },
          }),
        );
      }
      return Promise.reject(new Error("the stand-in is not listening in this test"));
    });
    try {
      const provider = createDocuSignDriverFactory("http://stand-in.invalid:8129")({
        environment: "demo",
        integrationKey: "key",
        apiUserId: "user",
        privateKey: RSA_KEY,
        webhookSecret: "secret",
      });
      await expect(provider.testConnection()).rejects.toThrow();
    } finally {
      vi.unstubAllGlobals();
    }
    expect(asked).toEqual([
      "http://stand-in.invalid:8129/oauth/token",
      "http://stand-in.invalid:8129/oauth/userinfo",
    ]);
  });
});
