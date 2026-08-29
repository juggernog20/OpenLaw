// SPDX-License-Identifier: AGPL-3.0-only

import { contracts, documents, matters } from "@openlaw/db";
import { resolveDocumentOwner } from "@openlaw/shared";
import { describe, expect, it } from "vitest";
import { parseDocumentOwnerReference } from "./owner.js";

describe("resolveDocumentOwner", () => {
  it("names the one owner a document has", () => {
    expect(resolveDocumentOwner({ contract: "c1", matter: null })).toEqual({
      kind: "contract",
      value: "c1",
    });
    expect(resolveDocumentOwner({ contract: undefined, matter: "m1" })).toEqual({
      kind: "matter",
      value: "m1",
    });
  });

  it("refuses a row with no owner or more than one", () => {
    expect(() => resolveDocumentOwner({ contract: null, matter: null })).toThrow(
      /exactly one owning record/,
    );
    expect(() => resolveDocumentOwner({ contract: "c1", matter: "m1" })).toThrow(
      /exactly one owning record/,
    );
  });
});

describe("parseDocumentOwnerReference", () => {
  it("maps each prefix to its owner columns", () => {
    const contract = parseDocumentOwnerReference("C-42");
    expect(contract.number).toBe(42);
    expect(contract.owner.kind).toBe("contract");
    expect(contract.owner.documentOwnerId).toBe(documents.contractId);
    expect(contract.owner.recordId).toBe(contracts.id);

    const matter = parseDocumentOwnerReference("M-7");
    expect(matter.number).toBe(7);
    expect(matter.owner.kind).toBe("matter");
    expect(matter.owner.documentOwnerId).toBe(documents.matterId);
    expect(matter.owner.recordId).toBe(matters.id);
  });

  it("rejects a prefix no owner claims", () => {
    expect(() => parseDocumentOwnerReference("X-1")).toThrow(/names no Document owner/);
  });
});
