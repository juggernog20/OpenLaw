// SPDX-License-Identifier: AGPL-3.0-only

import { defineMessages, type IntlShape } from "react-intl";
import type { EntityChart, EntityOfficer, EntityRecordEnvelope } from "../../lib/entities";
import { statusLabel } from "../../lib/entities";
import { formatFullDate, toMajorUnits } from "../../lib/format";
import { entityStructureChain, layoutEntityChart } from "./entity-chart-layout";

const FIELD_MESSAGES = defineMessages({
  type: { id: "entities.chart.export.field.type", defaultMessage: "Entity type" },
  jurisdiction: { id: "entities.chart.export.field.jurisdiction", defaultMessage: "Jurisdiction" },
  status: { id: "entities.chart.export.field.status", defaultMessage: "Status" },
  formedOn: { id: "entities.chart.export.field.formedOn", defaultMessage: "Formation date" },
  registrationNumber: {
    id: "entities.chart.export.field.registrationNumber",
    defaultMessage: "Registration number",
  },
  taxId: { id: "entities.chart.export.field.taxId", defaultMessage: "Tax ID" },
  registeredAgent: {
    id: "entities.chart.export.field.registeredAgent",
    defaultMessage: "Registered agent",
  },
  registeredAddress: {
    id: "entities.chart.export.field.registeredAddress",
    defaultMessage: "Registered address",
  },
  sharesAuthorized: {
    id: "entities.chart.export.field.sharesAuthorized",
    defaultMessage: "Authorized shares",
  },
  sharesIssued: { id: "entities.chart.export.field.sharesIssued", defaultMessage: "Issued shares" },
  parValue: { id: "entities.chart.export.field.parValue", defaultMessage: "Par value" },
  officers: { id: "entities.record.officers.title", defaultMessage: "Directors & Officers" },
});
export const DEFAULT_EXPORT_FIELDS = ["type", "jurisdiction", "status"];
export interface ExportField {
  id: string;
  label: string;
  custom: boolean;
}
export type ExportRecord = EntityRecordEnvelope & { officers: readonly EntityOfficer[] };
export type ExportRecords = ReadonlyMap<string, ExportRecord>;
export interface ExportText {
  text: string;
  x: number;
  y: number;
  size: number;
  bold?: boolean;
  color: string;
  width: number;
}
export interface ExportCard {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  restricted: boolean;
}
export interface ExportEdge {
  points: Array<{ x: number; y: number }>;
  secondary: boolean;
}
export interface ChartExportModel {
  title: string;
  width: number;
  height: number;
  cards: ExportCard[];
  edges: ExportEdge[];
  texts: ExportText[];
}

export function scopeExportChart(chart: EntityChart, entityId: string): EntityChart {
  if (!entityId) return chart;
  if (!chart.nodes.some((node) => node.id === entityId && !node.restricted))
    return { nodes: [], edges: [] };
  const included = entityStructureChain(chart, entityId);
  return {
    nodes: chart.nodes.filter((node) => included.has(node.id)),
    edges: chart.edges.filter(
      (edge) => included.has(edge.ownerEntityId) && included.has(edge.ownedEntityId),
    ),
  };
}

export function exportFields(intl: IntlShape, records: ExportRecords): ExportField[] {
  const fields: ExportField[] = Object.entries(FIELD_MESSAGES).map(([id, message]) => ({
    id,
    label: intl.formatMessage(message),
    custom: false,
  }));
  const custom = new Map<string, ExportField>();
  for (const record of records.values()) {
    for (const field of record.fields) {
      custom.set(`custom:${field.fieldId}`, {
        id: `custom:${field.fieldId}`,
        label: field.displayName,
        custom: true,
      });
    }
  }
  return [...fields, ...[...custom.values()].sort((a, b) => a.label.localeCompare(b.label))];
}

export function exportFieldValue(
  intl: IntlShape,
  record: ExportRecord,
  id: string,
): string | undefined {
  const entity = record.entity;
  if (id === "officers") {
    const current = record.officers.filter((officer) => officer.resignedOn === null);
    return current.length
      ? current.map((officer) => `${officer.name} (${officer.officerRoleName})`).join("\n")
      : undefined;
  }
  if (id.startsWith("custom:")) {
    const field = record.fields.find((item) => `custom:${item.fieldId}` === id);
    if (!field) return undefined;
    const value = entity.customFields[field.slug];
    if (value === undefined || value === "") return undefined;
    if (Array.isArray(value))
      return value.length ? intl.formatList(value, { type: "conjunction" }) : undefined;
    if (typeof value === "boolean")
      return intl.formatMessage(
        value
          ? { id: "entities.record.fields.yes", defaultMessage: "Yes" }
          : { id: "entities.record.fields.no", defaultMessage: "No" },
      );
    if (typeof value === "number") return intl.formatNumber(value);
    if (field.fieldType === "date") return formatFullDate(value);
    if (field.fieldType === "user")
      return record.customFieldRefs.users.find((user) => user.id === value)?.displayName;
    if (field.fieldType === "entity") {
      const ref = record.customFieldRefs.entities.find((item) => item.id === value);
      return !ref || ref.restricted
        ? intl.formatMessage({
            id: "entities.chart.confidential",
            defaultMessage: "Confidential Entity",
          })
        : ref.legalName;
    }
    return value;
  }
  if (id === "type") return entity.entityTypeName;
  if (id === "status") return statusLabel(intl, entity.status);
  if (id === "formedOn") return entity.formedOn ? formatFullDate(entity.formedOn) : undefined;
  if (id === "parValue") {
    if (entity.parValue === null) return undefined;
    return entity.parValueCurrency
      ? intl.formatNumber(toMajorUnits(entity.parValue, entity.parValueCurrency), {
          style: "currency",
          currency: entity.parValueCurrency,
          currencyDisplay: "code",
        })
      : intl.formatMessage(
          { id: "entities.chart.export.minorUnits", defaultMessage: "{value} minor units" },
          { value: intl.formatNumber(entity.parValue) },
        );
  }
  const value = entity[id as keyof typeof FIELD_MESSAGES & keyof typeof entity];
  if (value === null || value === undefined || value === "") return undefined;
  return typeof value === "number" ? intl.formatNumber(value) : String(value);
}

export type MeasureText = (text: string, size: number, bold: boolean) => number;

/** Wrap every value, including long identifiers, without dropping characters. */
export function wrapExportText(
  text: string,
  width: number,
  size: number,
  bold: boolean,
  measure: MeasureText,
): string[] {
  const lines: string[] = [];
  for (const paragraph of text.split(/\r?\n/)) {
    let line = "";
    for (const word of paragraph.split(/\s+/).filter(Boolean)) {
      const candidate = line ? `${line} ${word}` : word;
      if (measure(candidate, size, bold) <= width) {
        line = candidate;
        continue;
      }
      if (line) {
        lines.push(line);
        line = "";
      }
      for (const char of word) {
        if (line && measure(line + char, size, bold) > width) {
          lines.push(line);
          line = "";
        }
        line += char;
      }
    }
    lines.push(line);
  }
  return lines;
}

export function createChartExportModel({
  chart,
  records,
  fields,
  title,
  percentages,
  intl,
  measure,
}: {
  chart: EntityChart;
  records: ExportRecords;
  fields: ExportField[];
  title: string;
  percentages: boolean;
  intl: IntlShape;
  measure: MeasureText;
}): ChartExportModel {
  const nodeWidth = 300;
  const inset = 18;
  const textWidth = nodeWidth - 2 * inset;
  const cardLines = new Map<string, Array<{ text: string; size: number; bold: boolean }>>();
  let nodeHeight = 90;
  for (const node of chart.nodes) {
    if (node.restricted) continue;
    const record = records.get(node.id);
    // Never fall back to a stale name after a failed permission-checked record read.
    if (!record) throw new Error("Entity details are unavailable.");
    const lines = wrapExportText(record.entity.legalName, textWidth, 14, true, measure).map(
      (text) => ({ text, size: 14, bold: true }),
    );
    for (const field of fields) {
      const value = exportFieldValue(intl, record, field.id);
      if (value === undefined) continue;
      lines.push(
        ...wrapExportText(`${field.label}: ${value}`, textWidth, 11, false, measure).map(
          (text) => ({ text, size: 11, bold: false }),
        ),
      );
    }
    cardLines.set(node.id, lines);
    nodeHeight = Math.max(
      nodeHeight,
      inset * 2 + lines.reduce((height, line) => height + line.size * 1.5, 0),
    );
  }
  // Title width follows the final chart rather than the width of one card.
  const layout = layoutEntityChart(chart, { width: nodeWidth, height: nodeHeight });
  const heading = wrapExportText(title, layout.width - 80, 20, true, measure);
  const headerHeight = Math.max(56, heading.length * 30 + 16);
  const model: ChartExportModel = {
    title,
    width: layout.width,
    height: layout.height + headerHeight,
    cards: [],
    edges: [],
    texts: heading.map((text, index) => ({
      text,
      x: 40,
      y: 24 + index * 30,
      size: 20,
      bold: true,
      color: "242424",
      width: layout.width - 80,
    })),
  };
  const positions = new Map(layout.nodes.map((node) => [node.id, node]));
  for (const edge of chart.edges) {
    const owner = positions.get(edge.ownerEntityId);
    const owned = positions.get(edge.ownedEntityId);
    if (!owner || !owned) continue;
    const x1 = owner.x + nodeWidth / 2;
    const y1 = owner.y + nodeHeight + headerHeight;
    const x2 = owned.x + nodeWidth / 2;
    const y2 = owned.y + headerHeight;
    const middle = (y1 + y2) / 2;
    model.edges.push({
      points: [
        { x: x1, y: y1 },
        { x: x1, y: middle },
        { x: x2, y: middle },
        { x: x2, y: y2 },
      ],
      secondary: owned.primaryOwnerId !== owner.id,
    });
    if (percentages)
      model.texts.push({
        text: `${intl.formatNumber(edge.ownershipPercent)}%`,
        x: (x1 + x2) / 2 + 5,
        y: middle - 18,
        size: 10,
        color: "555555",
        width: 80,
      });
  }
  for (const node of layout.nodes) {
    const y = node.y + headerHeight;
    model.cards.push({
      id: node.id,
      x: node.x,
      y,
      width: nodeWidth,
      height: nodeHeight,
      restricted: node.restricted,
    });
    if (node.restricted) {
      const text = intl.formatMessage({
        id: "entities.chart.confidential",
        defaultMessage: "Confidential Entity",
      });
      model.texts.push({
        text,
        x: node.x + inset,
        y: y + nodeHeight / 2 - 9,
        size: 14,
        bold: true,
        color: "A12622",
        width: textWidth,
      });
      continue;
    }
    let lineY = y + inset;
    for (const line of cardLines.get(node.id)!) {
      model.texts.push({
        ...line,
        x: node.x + inset,
        y: lineY,
        color: line.bold ? "242424" : "555555",
        width: textWidth,
      });
      lineY += line.size * 1.5;
    }
  }
  return model;
}
