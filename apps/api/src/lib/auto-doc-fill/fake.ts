// SPDX-License-Identifier: AGPL-3.0-only

/** Route tests download a deterministic record of the fill input; fixtures check Word fidelity. */
import PizZip from "pizzip";
import { fakeComparisonDocx } from "../doc-engine/fake.js";
import { AutoDocFillBusyError, type AutoDocFillEngine } from "./engine.js";
import { screenFillTemplate } from "./render.js";

export interface FakeAutoDocFillEngine extends AutoDocFillEngine {
  /** Thrown by every fill while set. */
  failure: Error | null;
  /** While true, every admission is refused as if every slot and queue place were taken. */
  busy: boolean;
}
export function createFakeAutoDocFillEngine(): FakeAutoDocFillEngine {
  return {
    failure: null,
    busy: false,
    async fill(input) {
      if (this.failure) throw this.failure;
      // The same screen the worker runs, so a route test sees a refused
      // template end as the Generation's failure detail.
      screenFillTemplate(input.template);
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
    admit() {
      if (this.busy) throw new AutoDocFillBusyError();
      return { fill: (input) => this.fill(input), release: () => undefined };
    },
  };
}
