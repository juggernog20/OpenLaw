// SPDX-License-Identifier: AGPL-3.0-only

import type { ExportRecord } from "./entity-chart-export-model";
import { createIntl, createIntlCache } from "react-intl";
import { describe, expect, it } from "vitest";
import type { EntityChart } from "../../lib/entities";
import {
  createChartExportModel,
  exportFields,
  exportFieldValue,
  scopeExportChart,
  wrapExportText,
} from "./entity-chart-export-model";

const intl = createIntl({ locale: "en-US", messages: {} }, createIntlCache());
const measure = (text: string, size: number) => Array.from(text).length * size * 0.6;
function record(id: string, legalName = id): ExportRecord {
  return {
    entity: {
      id,
      legalName,
      entityTypeId: "type",
      entityTypeName: "LLC",
      jurisdiction: "Kenya",
      formedOn: "2020-01-01",
      registrationNumber: null,
      taxId: "PRIVATE-TAX-ID",
      registeredAgent: null,
      registeredAddress: null,
      status: "active",
      sharesAuthorized: 0,
      sharesIssued: null,
      parValue: 123,
      parValueCurrency: "USD",
      customFields: {},
      isConfidential: false,
      archivedAt: null,
      createdAt: "2020-01-01T00:00:00Z",
      updatedAt: "2020-01-01T00:00:00Z",
    },
    officers: [],
    fields: [],
    customFieldRefs: { users: [], entities: [] },
  };
}
const node = (id: string, primaryOwnerId: string | null = null) => ({
  id,
  restricted: false as const,
  legalName: id,
  type: "LLC",
  jurisdiction: "Kenya",
  status: "active" as const,
  primaryOwnerId,
});
const chart: EntityChart = {
  nodes: [
    node("parent"),
    node("child", "parent"),
    node("sibling", "parent"),
    { id: "secret", restricted: true, primaryOwnerId: "child" },
    node("other"),
  ],
  edges: [
    { ownerEntityId: "parent", ownedEntityId: "child", ownershipPercent: 80 },
    { ownerEntityId: "parent", ownedEntityId: "sibling", ownershipPercent: 100 },
    { ownerEntityId: "child", ownedEntityId: "secret", ownershipPercent: 100 },
  ],
};
const records = new Map(
  ["parent", "child", "sibling", "other", "secret"].map((id) => [id, record(id)]),
);

function model(fields: string[], data = records) {
  return createChartExportModel({
    chart,
    records: data,
    fields: exportFields(intl, data).filter((field) => fields.includes(field.id)),
    title: "Structure",
    percentages: true,
    intl,
    measure,
  });
}

describe("custom chart exports", () => {
  it("exports the chosen chain with ancestors and descendants, excluding siblings and unrelated entities", () => {
    const scoped = scopeExportChart(chart, "child");
    expect(scoped.nodes.map((item) => item.id)).toEqual(["parent", "child", "secret"]);
    expect(scoped.edges).toHaveLength(2);
    expect(scopeExportChart(chart, "")).toBe(chart);
    expect(scopeExportChart(chart, "missing").nodes).toEqual([]);
  });

  it("includes only selected fields and never uses restricted entity records", () => {
    const output = model(["jurisdiction"]);
    const text = output.texts.map((line) => line.text).join(" ");
    expect(text).toContain("Jurisdiction: Kenya");
    expect(text).not.toContain("PRIVATE-TAX-ID");
    expect(text).not.toContain("secret");
    expect(text).toContain("Confidential Entity");
    expect(output.texts.find((line) => line.text === "Confidential Entity")?.color).toBe("A12622");
    expect(output.cards).toHaveLength(chart.nodes.length);
    expect(output.edges).toHaveLength(chart.edges.length);
  });

  it("wraps long names and field values and grows cards without losing content", () => {
    const data = new Map(records);
    const child = record("child", "Long company name ".repeat(12).trim());
    child.entity.registeredAddress = "Office address ".repeat(40).trim();
    data.set("child", child);
    const output = model(["registeredAddress"], data);
    expect(output.cards[0]!.height).toBeGreaterThan(model([]).cards[0]!.height);
    const card = output.cards.find((item) => item.id === "child")!;
    const text = output.texts.filter(
      (line) => line.x === card.x + 18 && line.y >= card.y && line.y < card.y + card.height,
    );
    expect(text.map((line) => line.text).join(" ")).toBe(
      `${child.entity.legalName} Registered address: ${child.entity.registeredAddress}`,
    );
    for (const line of text)
      expect(line.y + line.size * 1.5).toBeLessThanOrEqual(card.y + card.height);
    expect(wrapExportText("ABCDEFGHIJKLMNOP", 20, 10, false, measure).join("")).toBe(
      "ABCDEFGHIJKLMNOP",
    );
  });

  it("formats zero and currency amounts and refuses missing readable records", () => {
    expect(exportFieldValue(intl, record("child"), "sharesAuthorized")).toBe("0");
    expect(exportFieldValue(intl, record("child"), "parValue")).toMatch(/USD\s*1\.23/);
    expect(() => model([], new Map())).toThrow("Entity details are unavailable");
  });

  it("omits percentages when deselected", () => {
    const output = createChartExportModel({
      chart,
      records,
      fields: [],
      title: "Structure",
      percentages: false,
      intl,
      measure,
    });
    expect(output.texts.some((line) => line.text.endsWith("%"))).toBe(false);
    expect(output.edges).toHaveLength(3);
  });

  it("includes current directors and officers with their roles only when selected", () => {
    const item = record("child");
    const current = {
      id: "officer",
      entityId: "child",
      name: "Dana Director",
      officerRoleId: "director",
      officerRoleName: "Director",
      appointedOn: null,
      resignedOn: null,
      user: null,
      createdAt: "2020-01-01T00:00:00Z",
      updatedAt: "2020-01-01T00:00:00Z",
    };
    item.officers = [
      current,
      { ...current, id: "former", name: "Former Director", resignedOn: "2024-01-01" },
    ];
    const data = new Map(records).set("child", item);
    expect(
      model([], data)
        .texts.map((line) => line.text)
        .join(" "),
    ).not.toContain("Dana Director");
    const text = model(["officers"], data)
      .texts.map((line) => line.text)
      .join(" ");
    expect(text).toContain("Directors & Officers: Dana Director (Director)");
    expect(text).not.toContain("Former Director");
  });

  it("offers attached custom fields and resolves references without exposing restricted names or IDs", () => {
    const item = record("child");
    const base = {
      description: null,
      fieldTag: "legal" as const,
      options: null,
      displayOrder: 1,
      isRequired: false,
    };
    item.fields = [
      {
        ...base,
        fieldId: "ref",
        slug: "related",
        displayName: "Related entity",
        fieldType: "entity",
      },
      {
        ...base,
        fieldId: "person",
        slug: "counsel",
        displayName: "Local counsel",
        fieldType: "user",
      },
      {
        ...base,
        fieldId: "flag",
        slug: "audit",
        displayName: "Audit required",
        fieldType: "boolean",
      },
    ];
    item.entity.customFields = {
      related: "private-reference",
      counsel: "user-1",
      audit: false,
      detached: "SHOULD-NOT-EXPORT",
    };
    item.customFieldRefs = {
      entities: [{ id: "private-reference", restricted: true }],
      users: [{ id: "user-1", displayName: "Nadia Counsel", archived: false }],
    };
    const data = new Map(records).set("child", item);
    const options = exportFields(intl, data);
    expect(options.filter((field) => field.custom).map((field) => field.label)).toEqual([
      "Audit required",
      "Local counsel",
      "Related entity",
    ]);
    const output = model(["custom:ref", "custom:person", "custom:flag"], data);
    const text = output.texts.map((line) => line.text).join(" ");
    expect(text).toContain("Related entity: Confidential Entity");
    expect(text).toContain("Local counsel: Nadia Counsel");
    expect(text).toContain("Audit required: No");
    expect(text).not.toMatch(/private-reference|user-1|SHOULD-NOT-EXPORT/);
  });
});
