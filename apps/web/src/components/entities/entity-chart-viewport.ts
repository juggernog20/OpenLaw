// SPDX-License-Identifier: AGPL-3.0-only

export interface ChartView {
  x: number;
  y: number;
  scale: number;
}

export interface ChartSize {
  width: number;
  height: number;
}

export const MAX_CHART_ZOOM = 3;

export function fitChart(content: ChartSize, viewport: ChartSize): ChartView {
  const scale = Math.min(
    1,
    Math.max(1, viewport.width - 48) / content.width,
    Math.max(1, viewport.height - 48) / content.height,
  );
  return {
    scale,
    x: (viewport.width - content.width * scale) / 2,
    y: (viewport.height - content.height * scale) / 2,
  };
}

/** Keep the point beneath the pointer fixed while changing the absolute scale. */
export function zoomChart(
  view: ChartView,
  scale: number,
  anchor: { x: number; y: number },
): ChartView {
  const ratio = scale / view.scale;
  return {
    scale,
    x: anchor.x - (anchor.x - view.x) * ratio,
    y: anchor.y - (anchor.y - view.y) * ratio,
  };
}
