// SPDX-License-Identifier: AGPL-3.0-only

/** Route tests download a deterministic record of the fill input; fixtures check Word fidelity. */
import PizZip from "pizzip";
import { fakeComparisonDocx } from "../doc-engine/fake.js";
import type { AutoDocFillEngine } from "./engine.js";

export interface FakeAutoDocFillEngine extends AutoDocFillEngine {
  failure: Error | null;
}
export function createFakeAutoDocFillEngine(): FakeAutoDocFillEngine {
  return {
    failure: null,
    async fill(input) {
      if (this.failure) throw this.failure;
      const marker = JSON.stringify({
        answers: input.answers,
        displayValues: input.displayValues ?? {},
      })
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;");
      const zip = new PizZip(fakeComparisonDocx());
      zip.file(
        "word/document.xml",
        `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>${marker}</w:t></w:r></w:p></w:body></w:document>`,
      );
      return zip.generate({ type: "nodebuffer" });
    },
  };
}
