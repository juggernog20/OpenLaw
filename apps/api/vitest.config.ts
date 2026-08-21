// SPDX-License-Identifier: AGPL-3.0-only
/// <reference types="vitest/config" />
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Every suite in this package is an integration test against real
    // containers: a Postgres of its own, and for some suites MinIO,
    // Azurite, or an OIDC mock beside it. Per-suite containers are the
    // deliberate arrangement, so pulling and starting an image is what
    // `beforeAll` spends its time on. Vitest's 10s default is a budget
    // for a hook that only builds objects in memory, and 87 hooks in
    // this package each carried a hand-written `120_000` to escape it.
    // One number here replaces all of them.
    hookTimeout: 120_000,
    // The same number for test bodies, because they are the same kind
    // of work. A case here signs in over HTTP, uploads a document, and
    // waits for the real pg-boss pipeline to finish with it, so the 5s
    // default is as wrong for the body as 10s is for the hook — 111
    // bodies carried their own argument too. Carrying one value on both
    // knobs also gives an explicit timeout in a suite a single meaning:
    // this case needs more than the package does. Only four do — see
    // the `180_000` and `900_000` overrides, each with its reason
    // written beside it.
    testTimeout: 120_000,
  },
});
