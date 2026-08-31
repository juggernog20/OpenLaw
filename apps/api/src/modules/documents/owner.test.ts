// SPDX-License-Identifier: AGPL-3.0-only

import { contracts, documents, matters } from "@openlaw/db";
import { resolveDocumentOwner } from "@openlaw/shared";
import { describe, expect, it } from "vitest";
import { parseDocumentOwnerReference } from "./owner.js";

describe("resolveDocumentOwner", () => {
  it("names the one owner a document has", () => {
    expect(
      resolveDocumentOwner({ contract: "c1", matter: null, entity: null, knowledge_item: null }),
    ).toEqual({
      kind: "contract",
      value: "c1",
    });
    expect(
      resolveDocumentOwner({
        contract: undefined,
        matter: "m1",
        entity: null,
        knowledge_item: null,
      }),
    ).toEqual({
      kind: "matter",
      value: "m1",
    });
  });

  it("refuses a row with no owner or more than one", () => {
    expect(() =>
      resolveDocumentOwner({ contract: null, matter: null, entity: null, knowledge_item: null }),
    ).toThrow(/exactly one owning record/);
    expect(() =>
      resolveDocumentOwner({
        contract: "c1",
        matter: "m1",
        entity: null,
        knowledge_item: null,
      }),
    ).toThrow(/exactly one owning record/);
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

  it("reads anything that is not a numbered reference as an Entity id", () => {
    const entity = parseDocumentOwnerReference("019c6ec6-1cb4-7f25-a000-100000000001");
    expect(entity.owner.kind).toBe("entity");
    expect(entity.id).toBe("019c6ec6-1cb4-7f25-a000-100000000001");
    // An id that merely starts with an owner letter is still an id.
    expect(parseDocumentOwnerReference("Cabinet").owner.kind).toBe("entity");
    expect(parseDocumentOwnerReference("M-").owner.kind).toBe("entity");
  });

  it("uses the owner hint for an opaque Knowledge item id", () => {
    const item = parseDocumentOwnerReference("knowledge-1", "knowledge_item");
    expect(item.owner.kind).toBe("knowledge_item");
    expect(item.id).toBe("knowledge-1");
  });
});
