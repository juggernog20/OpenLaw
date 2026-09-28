// SPDX-License-Identifier: AGPL-3.0-only
// DOC-032 contracts: start the e2e signing stand-in (e2e/tests/docusign.ts at the pinned
// commit) inside the owned lab's backend network. up.sh bundles this file with esbuild into
// /tmp, because the stand-in is TypeScript with parameter properties that Node cannot strip.
// The stand-in never talks to a real provider. Its integration key and Connect secret are
// fictional values that only this stand-in accepts.
import { SigningStub } from "../../../../../../e2e/tests/docusign.ts";

const stub = await SigningStub.start({
  integrationKey: "doc032-contracts-standin-integration-key",
  webhookSecret: "doc032-contracts-standin-connect-secret",
  port: 8129,
});
console.log(`DOC-032 contracts signing stand-in listening on ${stub.port}`);
