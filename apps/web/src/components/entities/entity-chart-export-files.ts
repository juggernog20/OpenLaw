// SPDX-License-Identifier: AGPL-3.0-only

import type { Content, TDocumentDefinitions } from "pdfmake/interfaces";
import type { ChartExportModel, MeasureText } from "./entity-chart-export-model";

/** Load the same font used in the PDF before measuring the export preview. */
export async function loadExportMeasure(): Promise<MeasureText> {
  const { default: vfs } = await import("pdfmake/build/vfs_fonts");
  await Promise.all(
    [false, true].map(async (bold) => {
      const weight = bold ? "700" : "400";
      if (
        [...document.fonts].some(
          (font) =>
            font.family.replaceAll('"', "") === "OpenLaw Chart" &&
            font.weight === weight &&
            font.status === "loaded",
        )
      )
        return;
      const font = new FontFace(
        "OpenLaw Chart",
        `url(data:font/ttf;base64,${vfs[bold ? "Roboto-Medium.ttf" : "Roboto-Regular.ttf"]})`,
        { weight },
      );
      document.fonts.add(await font.load());
    }),
  );
  const context = document.createElement("canvas").getContext("2d");
  if (!context) throw new Error("Text measurement is unavailable.");
  return (text, size, bold) => {
    context.font = `${bold ? "700" : "400"} ${size}px "OpenLaw Chart", Arial, sans-serif`;
    // Leave room for PowerPoint's font substitution and text-box rounding.
    return context.measureText(text).width * 1.08;
  };
}

export async function createChartPdf(model: ChartExportModel): Promise<Blob> {
  const [{ default: pdfMake }, { default: vfs }] = await Promise.all([
    import("pdfmake/build/pdfmake"),
    import("pdfmake/build/vfs_fonts"),
  ]);
  pdfMake.addVirtualFileSystem(vfs);
  // PDF pages allow up to 200 inches. Scale the whole drawing together.
  const scale = Math.min(1, 14400 / Math.max(model.width, model.height));
  const content: Content[] = [
    {
      absolutePosition: { x: 0, y: 0 },
      canvas: [
        ...model.edges.map((edge) => ({
          type: "polyline" as const,
          points: edge.points.map((point) => ({ x: point.x * scale, y: point.y * scale })),
          lineColor: "#999999",
          lineWidth: scale,
          ...(edge.secondary ? { dash: { length: 5 * scale, space: 4 * scale } } : {}),
        })),
        ...model.cards.map((card) => ({
          type: "rect" as const,
          x: card.x * scale,
          y: card.y * scale,
          w: card.width * scale,
          h: card.height * scale,
          r: 6 * scale,
          color: card.restricted ? "#EEEAE4" : "#FFFFFF",
          lineColor: "#C9C4BC",
          lineWidth: scale,
        })),
      ],
    },
    ...model.texts.map((line) => ({
      text: line.text,
      absolutePosition: { x: line.x * scale, y: line.y * scale },
      fontSize: line.size * scale,
      bold: line.bold,
      color: `#${line.color}`,
      noWrap: true,
    })),
  ];
  const definition: TDocumentDefinitions = {
    pageSize: { width: model.width * scale, height: model.height * scale },
    pageMargins: 0,
    defaultStyle: { font: "Roboto" },
    info: { title: model.title, creator: "OpenLaw" },
    content,
  };
  return pdfMake.createPdf(definition).getBlob();
}

export async function createChartPowerPoint(model: ChartExportModel): Promise<Blob> {
  const { default: PptxGenJS } = await import("pptxgenjs");
  const pptx = new PptxGenJS();
  // A custom slide retains the chart's aspect ratio, within PowerPoint's 56-inch limit.
  const scale = Math.min(1, (56 * 72) / Math.max(model.width, model.height));
  const inch = (value: number) => (value * scale) / 72;
  pptx.defineLayout({ name: "STRUCTURE", width: inch(model.width), height: inch(model.height) });
  pptx.layout = "STRUCTURE";
  pptx.title = model.title;
  pptx.author = "OpenLaw";
  pptx.subject = "Entity structure chart";
  const slide = pptx.addSlide();
  slide.background = { color: "FFFFFF" };
  for (const edge of model.edges) {
    for (let i = 1; i < edge.points.length; i++) {
      const from = edge.points[i - 1]!;
      const to = edge.points[i]!;
      if (from.x === to.x && from.y === to.y) continue;
      slide.addShape(pptx.ShapeType.line, {
        x: inch(Math.min(from.x, to.x)),
        y: inch(Math.min(from.y, to.y)),
        w: inch(Math.abs(to.x - from.x)),
        h: inch(Math.abs(to.y - from.y)),
        line: { color: "999999", width: scale, dashType: edge.secondary ? "dash" : "solid" },
      });
    }
  }
  for (const card of model.cards) {
    slide.addShape(pptx.ShapeType.roundRect, {
      x: inch(card.x),
      y: inch(card.y),
      w: inch(card.width),
      h: inch(card.height),
      rectRadius: inch(6),
      line: { color: "C9C4BC", width: scale },
      fill: { color: card.restricted ? "EEEAE4" : "FFFFFF" },
    });
  }
  for (const line of model.texts) {
    slide.addText(line.text, {
      x: inch(line.x),
      y: inch(line.y),
      w: inch(line.width),
      h: inch(line.size * 1.5),
      fontFace: "Roboto",
      fontSize: line.size * scale,
      bold: line.bold,
      color: line.color,
      margin: 0,
      breakLine: false,
      valign: "top",
      paraSpaceAfter: 0,
    });
  }
  const result = await pptx.write({ outputType: "blob", compression: true });
  if (!(result instanceof Blob)) throw new Error("The presentation could not be created.");
  return result;
}

export function downloadChart(blob: Blob, title: string, format: "pdf" | "pptx") {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `${
    title
      .replace(/[<>:"/\\|?*]/g, "-")
      .trim()
      .slice(0, 100) || "entity-structure"
  }.${format}`;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
