// SPDX-License-Identifier: AGPL-3.0-only

/** The dependency-free SVG org chart, with pointer and keyboard navigation. */
import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { Link } from "react-router";
import { FormattedMessage, useIntl } from "react-intl";
import { Maximize2 } from "lucide-react";
import type { EntityChart as EntityChartData } from "../../lib/entities";
import { statusLabel } from "../../lib/entities";
import { Button } from "../ui/button";
import { CHART_NODE_HEIGHT, CHART_NODE_WIDTH, layoutEntityChart } from "./entity-chart-layout";

interface ViewTransform {
  x: number;
  y: number;
  scale: number;
}

export function EntityChart({ chart }: Readonly<{ chart: EntityChartData }>) {
  const intl = useIntl();
  const instructionsId = useId();
  const layout = useMemo(() => layoutEntityChart(chart), [chart]);
  const positions = useMemo(() => new Map(layout.nodes.map((node) => [node.id, node])), [layout]);
  const regionRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const drag = useRef<{ pointerId: number; x: number; y: number } | null>(null);
  const [view, setView] = useState<ViewTransform>({ x: 0, y: 0, scale: 1 });

  // The viewBox already scales the whole layout into the region, so "fit"
  // is the identity transform. Pan and zoom are offsets from that.
  const fit = useCallback(() => setView({ x: 0, y: 0, scale: 1 }), []);

  const zoom = useCallback((factor: number) => {
    setView((current) => ({
      ...current,
      scale: Math.min(2.5, Math.max(0.35, current.scale * factor)),
    }));
  }, []);

  // React registers `wheel` as passive, so an `onWheel` prop cannot stop the
  // page from scrolling. A native non-passive listener can.
  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      zoom(event.deltaY < 0 ? 1.1 : 1 / 1.1);
    };
    svg.addEventListener("wheel", onWheel, { passive: false });
    return () => svg.removeEventListener("wheel", onWheel);
  }, [zoom]);

  return (
    <section className="flex min-h-0 flex-1 flex-col gap-2">
      <p id={instructionsId} className="sr-only">
        <FormattedMessage
          id="entities.chart.instructions"
          defaultMessage="Use the arrow keys to pan, plus and minus to zoom, and zero to fit the chart."
        />
      </p>
      <div className="flex justify-end">
        <Button variant="secondary" size="sm" onClick={fit}>
          <Maximize2 size={16} aria-hidden="true" />
          <FormattedMessage id="entities.chart.fit" defaultMessage="Fit to window" />
        </Button>
      </div>
      <div
        ref={regionRef}
        role="region"
        aria-label={intl.formatMessage({
          id: "entities.chart.label",
          defaultMessage: "Entity ownership chart",
        })}
        aria-describedby={instructionsId}
        tabIndex={0}
        data-pan-x={view.x}
        data-pan-y={view.y}
        className="min-h-120 flex-1 overflow-hidden rounded-card border border-border-default bg-raised focus-visible:outline-2 focus-visible:outline-link"
        onKeyDown={(event) => {
          const step = event.shiftKey ? 100 : 40;
          if (event.key === "ArrowLeft") setView((held) => ({ ...held, x: held.x - step }));
          else if (event.key === "ArrowRight") setView((held) => ({ ...held, x: held.x + step }));
          else if (event.key === "ArrowUp") setView((held) => ({ ...held, y: held.y - step }));
          else if (event.key === "ArrowDown") setView((held) => ({ ...held, y: held.y + step }));
          else if (event.key === "+" || event.key === "=") zoom(1.15);
          else if (event.key === "-") zoom(1 / 1.15);
          else if (event.key === "0") fit();
          else return;
          event.preventDefault();
        }}
      >
        <svg
          ref={svgRef}
          width="100%"
          height="100%"
          viewBox={`0 0 ${layout.width} ${layout.height}`}
          aria-labelledby="entity-chart-title entity-chart-description"
          onPointerDown={(event) => {
            if ((event.target as Element).closest("a")) return;
            drag.current = { pointerId: event.pointerId, x: event.clientX, y: event.clientY };
            event.currentTarget.setPointerCapture?.(event.pointerId);
          }}
          onPointerMove={(event) => {
            if (!drag.current || drag.current.pointerId !== event.pointerId) return;
            const dx = event.clientX - drag.current.x;
            const dy = event.clientY - drag.current.y;
            drag.current = { pointerId: event.pointerId, x: event.clientX, y: event.clientY };
            setView((held) => ({ ...held, x: held.x + dx, y: held.y + dy }));
          }}
          onPointerUp={(event) => {
            if (drag.current?.pointerId === event.pointerId) drag.current = null;
            event.currentTarget.releasePointerCapture?.(event.pointerId);
          }}
        >
          <title id="entity-chart-title">
            {intl.formatMessage({
              id: "entities.chart.title",
              defaultMessage: "Entity ownership chart",
            })}
          </title>
          <desc id="entity-chart-description">
            {intl.formatMessage({
              id: "entities.chart.description",
              defaultMessage:
                "Majority Holdings form the solid tree. Secondary Holdings use dashed lines.",
            })}
          </desc>
          <g transform={`translate(${view.x} ${view.y}) scale(${view.scale})`}>
            {chart.edges.map((edge) => {
              const owner = positions.get(edge.ownerEntityId);
              const owned = positions.get(edge.ownedEntityId);
              if (!owner || !owned) return null;
              const primary = owned.primaryOwnerId === owner.id;
              const x1 = owner.x + CHART_NODE_WIDTH / 2;
              const y1 = owner.y + CHART_NODE_HEIGHT;
              const x2 = owned.x + CHART_NODE_WIDTH / 2;
              const y2 = owned.y;
              const middle = (y1 + y2) / 2;
              return (
                <g key={`${owner.id}:${owned.id}`} aria-hidden="true">
                  <path
                    d={`M ${x1} ${y1} C ${x1} ${middle}, ${x2} ${middle}, ${x2} ${y2}`}
                    fill="none"
                    stroke="var(--color-border-strong)"
                    strokeWidth={primary ? 2 : 1.5}
                    strokeDasharray={primary ? undefined : "7 6"}
                    data-edge-kind={primary ? "primary" : "secondary"}
                  />
                  <text
                    x={(x1 + x2) / 2}
                    y={middle - 5}
                    textAnchor="middle"
                    className="fill-muted text-xs"
                  >
                    {edge.ownershipPercent}%
                  </text>
                </g>
              );
            })}
            {layout.nodes.map((node) => (
              <g
                key={node.id}
                data-unconnected={node.unconnected ? "true" : undefined}
                data-restricted={node.restricted ? "true" : undefined}
                aria-label={
                  node.restricted
                    ? intl.formatMessage({
                        id: "entities.restricted",
                        defaultMessage: "Restricted Entity",
                      })
                    : undefined
                }
              >
                {node.restricted ? (
                  <rect
                    x={node.x}
                    y={node.y}
                    width={CHART_NODE_WIDTH}
                    height={CHART_NODE_HEIGHT}
                    rx={8}
                    className="fill-badge-count-bg stroke-border-default"
                    strokeWidth={2}
                  />
                ) : (
                  <Link
                    to={`/entities/${node.id}`}
                    aria-label={intl.formatMessage(
                      { id: "entities.chart.open", defaultMessage: "Open {name}" },
                      { name: node.legalName },
                    )}
                    className="group outline-none"
                  >
                    <rect
                      x={node.x}
                      y={node.y}
                      width={CHART_NODE_WIDTH}
                      height={CHART_NODE_HEIGHT}
                      rx={8}
                      className="fill-canvas stroke-border-default group-hover:stroke-link group-focus-visible:stroke-link"
                      strokeWidth={2}
                    />
                    <text
                      x={node.x + 14}
                      y={node.y + 25}
                      className="fill-primary text-sm font-semibold"
                    >
                      {node.legalName}
                    </text>
                    <text x={node.x + 14} y={node.y + 49} className="fill-muted text-xs">
                      {node.type}
                    </text>
                    <text x={node.x + 14} y={node.y + 69} className="fill-muted text-xs">
                      {node.jurisdiction ??
                        intl.formatMessage({
                          id: "entities.chart.noJurisdiction",
                          defaultMessage: "No jurisdiction",
                        })}
                    </text>
                    <text
                      x={node.x + 14}
                      y={node.y + 92}
                      className="fill-primary text-xs font-medium"
                    >
                      {statusLabel(intl, node.status)}
                    </text>
                  </Link>
                )}
              </g>
            ))}
          </g>
        </svg>
      </div>
    </section>
  );
}
