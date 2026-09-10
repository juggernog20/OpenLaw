// SPDX-License-Identifier: AGPL-3.0-only

/** The dependency-free SVG org chart, with pointer and keyboard navigation. */
import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { Link, useNavigate } from "react-router";
import { FormattedMessage, useIntl } from "react-intl";
import { Maximize2, Minus, Plus, X } from "lucide-react";
import type { EntityChart as EntityChartData } from "../../lib/entities";
import { statusLabel } from "../../lib/entities";
import { Button } from "../ui/button";
import {
  CHART_NODE_HEIGHT,
  CHART_NODE_WIDTH,
  entityChartIncomingOwners,
  entityStructureChain,
  layoutEntityChart,
} from "./entity-chart-layout";

import { fitChart, MAX_CHART_ZOOM, zoomChart, type ChartView } from "./entity-chart-viewport";
import { EntityChartExport } from "./entity-chart-export-dialog";

export function EntityChart({ chart }: Readonly<{ chart: EntityChartData }>) {
  const intl = useIntl();
  const navigate = useNavigate();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const chain = useMemo(
    () =>
      selectedId && chart.nodes.some((node) => node.id === selectedId)
        ? entityStructureChain(chart, selectedId)
        : null,
    [chart, selectedId],
  );
  const instructionsId = useId();
  // Two mounted charts must not share title and description ids, or
  // `aria-labelledby` on the second resolves to the first chart's nodes.
  const titleId = useId();
  const descriptionId = useId();
  const layout = useMemo(() => layoutEntityChart(chart), [chart]);
  const positions = useMemo(() => new Map(layout.nodes.map((node) => [node.id, node])), [layout]);
  const incoming = useMemo(() => entityChartIncomingOwners(chart, positions), [chart, positions]);
  const regionRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const drag = useRef<{ pointerId: number; x: number; y: number } | null>(null);
  const [viewport, setViewport] = useState({ width: 1000, height: 480 });
  const [adjustedView, setView] = useState<ChartView | null>(null);
  const [dragging, setDragging] = useState(false);
  const overview = fitChart(layout, viewport);
  const first = layout.nodes[0];
  const initialView =
    overview.scale >= 0.8
      ? overview
      : {
          scale: 1,
          x: viewport.width / 2 - (first ? first.x + CHART_NODE_WIDTH / 2 : layout.width / 2),
          y: 24 - (first?.y ?? 0),
        };
  const view = adjustedView ?? initialView;
  const viewRef = useRef(view);
  const minZoom = Math.min(0.1, overview.scale);

  useEffect(() => {
    viewRef.current = view;
  }, [view]);
  useEffect(() => {
    const region = regionRef.current;
    if (!region) return;
    const observer = new ResizeObserver(() => {
      const width = region.clientWidth;
      const height = region.clientHeight;
      if (width > 0 && height > 0) setViewport({ width, height });
    });
    observer.observe(region);
    return () => observer.disconnect();
  }, []);

  const fit = () => setView(overview);
  const zoom = useCallback(
    (factor: number, anchor?: { x: number; y: number }) => {
      setView((previous) => {
        const current = previous ?? viewRef.current;
        const scale = Math.min(MAX_CHART_ZOOM, Math.max(minZoom, current.scale * factor));
        return zoomChart(
          current,
          scale,
          anchor ?? { x: viewport.width / 2, y: viewport.height / 2 },
        );
      });
    },
    [minZoom, viewport],
  );

  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      const box = svg.getBoundingClientRect();
      const delta =
        event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? viewport.height : 1);
      zoom(Math.exp(-Math.max(-100, Math.min(100, delta)) * 0.002), {
        x: event.clientX - box.left,
        y: event.clientY - box.top,
      });
    };
    svg.addEventListener("wheel", onWheel, { passive: false });
    return () => svg.removeEventListener("wheel", onWheel);
  }, [zoom, viewport.height]);

  const pan = (x: number, y: number) =>
    setView((previous) => {
      const current = previous ?? viewRef.current;
      return { ...current, x: current.x + x, y: current.y + y };
    });
  const stopDrag = (event: React.PointerEvent<SVGSVGElement>) => {
    if (drag.current?.pointerId !== event.pointerId) return;
    drag.current = null;
    setDragging(false);
    if (event.currentTarget.hasPointerCapture?.(event.pointerId))
      event.currentTarget.releasePointerCapture(event.pointerId);
  };

  return (
    <section className="flex h-full min-h-80 flex-col gap-2">
      <p id={instructionsId} className="sr-only">
        <FormattedMessage
          id="entities.chart.instructions"
          defaultMessage="Use the arrow keys to pan, plus and minus to zoom, and zero to fit the chart. On an entity, press Space to highlight its structure chain or Enter to open it. Press Escape to clear the highlight."
        />
      </p>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted">
          <FormattedMessage
            id="entities.chart.navigationHint"
            defaultMessage="Drag to move · Scroll to zoom · Single click to highlight entity · Double click to open entity"
          />
        </p>
        <div className="flex shrink-0 items-center gap-2">
          <EntityChartExport chart={chart} selectedId={selectedId} />
          {chain && (
            <Button variant="secondary" size="sm" onClick={() => setSelectedId(null)}>
              <X size={14} aria-hidden="true" />
              <FormattedMessage
                id="entities.chart.clearHighlight"
                defaultMessage="Clear highlight"
              />
            </Button>
          )}
          <div className="flex items-center gap-1 rounded-button border border-border-default bg-raised p-0.5">
            <Button
              variant="ghost"
              size="sm"
              aria-label={intl.formatMessage({
                id: "entities.chart.zoomOut",
                defaultMessage: "Zoom out",
              })}
              disabled={view.scale <= minZoom}
              onClick={() => zoom(1 / 1.25)}
            >
              <Minus size={16} aria-hidden="true" />
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="min-w-16 tabular-nums"
              aria-label={intl.formatMessage({
                id: "entities.chart.actualSize",
                defaultMessage: "Reset zoom to 100%",
              })}
              onClick={() =>
                setView(zoomChart(view, 1, { x: viewport.width / 2, y: viewport.height / 2 }))
              }
            >
              {Math.round(view.scale * 100)}%
            </Button>
            <Button
              variant="ghost"
              size="sm"
              aria-label={intl.formatMessage({
                id: "entities.chart.zoomIn",
                defaultMessage: "Zoom in",
              })}
              disabled={view.scale >= MAX_CHART_ZOOM}
              onClick={() => zoom(1.25)}
            >
              <Plus size={16} aria-hidden="true" />
            </Button>
          </div>
          <Button variant="secondary" size="sm" onClick={fit}>
            <Maximize2 size={16} aria-hidden="true" />
            <FormattedMessage id="entities.chart.fit" defaultMessage="Fit to window" />
          </Button>
        </div>
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
        data-zoom={view.scale}
        className="relative min-h-0 flex-1 overflow-hidden rounded-card border border-border-default bg-raised focus-visible:outline-2 focus-visible:outline-link"
        onKeyDown={(event) => {
          const step = event.shiftKey ? 100 : 40;
          if (event.key === "ArrowLeft") pan(-step, 0);
          else if (event.key === "ArrowRight") pan(step, 0);
          else if (event.key === "ArrowUp") pan(0, -step);
          else if (event.key === "ArrowDown") pan(0, step);
          else if (event.key === "+" || event.key === "=") zoom(1.15);
          else if (event.key === "-") zoom(1 / 1.15);
          else if (event.key === "0") fit();
          else if (event.key === "Escape" && chain) setSelectedId(null);
          else return;
          event.preventDefault();
        }}
      >
        <svg
          ref={svgRef}
          width="100%"
          height="100%"
          className={`absolute inset-0 touch-none select-none ${dragging ? "cursor-grabbing" : "cursor-grab"}`}
          aria-labelledby={`${titleId} ${descriptionId}`}
          onPointerDown={(event) => {
            if (event.button !== 0 || (event.target as Element).closest("a")) return;
            setDragging(true);
            drag.current = { pointerId: event.pointerId, x: event.clientX, y: event.clientY };
            event.currentTarget.setPointerCapture?.(event.pointerId);
          }}
          onPointerMove={(event) => {
            if (!drag.current || drag.current.pointerId !== event.pointerId) return;
            const dx = event.clientX - drag.current.x;
            const dy = event.clientY - drag.current.y;
            drag.current = { pointerId: event.pointerId, x: event.clientX, y: event.clientY };
            pan(dx, dy);
          }}
          onPointerUp={stopDrag}
          onPointerCancel={stopDrag}
          onLostPointerCapture={() => {
            drag.current = null;
            setDragging(false);
          }}
        >
          <title id={titleId}>
            {intl.formatMessage({
              id: "entities.chart.title",
              defaultMessage: "Entity ownership chart",
            })}
          </title>
          <desc id={descriptionId}>
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
              const owners = incoming.get(owned.id)!;
              const x2 =
                owned.x + (CHART_NODE_WIDTH * (owners.indexOf(owner.id) + 1)) / (owners.length + 1);
              const y2 = owned.y;
              const middle = (y1 + y2) / 2;
              return (
                <g
                  key={`${owner.id}:${owned.id}`}
                  aria-hidden="true"
                  opacity={chain && (!chain.has(owner.id) || !chain.has(owned.id)) ? 0.15 : 1}
                  className="transition-opacity duration-150 motion-reduce:transition-none"
                >
                  <path
                    d={`M ${x1} ${y1} V ${middle} H ${x2} V ${y2}`}
                    fill="none"
                    stroke={
                      chain?.has(owner.id) && chain.has(owned.id)
                        ? "var(--color-link)"
                        : "var(--color-border-strong)"
                    }
                    strokeWidth={primary ? 2 : 1.5}
                    strokeDasharray={primary ? undefined : "7 6"}
                    data-edge-kind={primary ? "primary" : "secondary"}
                  />
                  <text x={x2 + 5} y={y2 - 14} textAnchor="start" className="fill-muted text-xs">
                    {intl.formatNumber(edge.ownershipPercent)}%
                  </text>
                </g>
              );
            })}
            {layout.nodes.map((node) => (
              <g
                key={node.id}
                data-unconnected={node.unconnected ? "true" : undefined}
                data-highlighted={chain ? String(chain.has(node.id)) : undefined}
                opacity={chain && !chain.has(node.id) ? 0.25 : 1}
                className="transition-opacity duration-150 motion-reduce:transition-none"
                data-restricted={node.restricted ? "true" : undefined}
                aria-label={
                  node.restricted
                    ? intl.formatMessage({
                        id: "entities.chart.confidential",
                        defaultMessage: "Confidential Entity",
                      })
                    : undefined
                }
              >
                {node.restricted ? (
                  <>
                    <rect
                      x={node.x}
                      y={node.y}
                      width={CHART_NODE_WIDTH}
                      height={CHART_NODE_HEIGHT}
                      rx={8}
                      className="fill-badge-count-bg stroke-border-default"
                      strokeWidth={2}
                    />
                    <text
                      x={node.x + CHART_NODE_WIDTH / 2}
                      y={node.y + CHART_NODE_HEIGHT / 2}
                      textAnchor="middle"
                      dominantBaseline="central"
                      className="fill-danger-inline text-sm font-semibold"
                    >
                      <FormattedMessage
                        id="entities.chart.confidential"
                        defaultMessage="Confidential Entity"
                      />
                    </text>
                  </>
                ) : (
                  <Link
                    to={`/entities/${node.id}`}
                    aria-current={selectedId === node.id ? "true" : undefined}
                    onClick={(event) => {
                      if (
                        event.metaKey ||
                        event.ctrlKey ||
                        event.shiftKey ||
                        event.altKey ||
                        event.detail === 0
                      )
                        return;
                      event.preventDefault();
                      setSelectedId(node.id);
                    }}
                    onDoubleClick={(event) => {
                      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
                      event.preventDefault();
                      void navigate(`/entities/${node.id}`);
                    }}
                    onKeyDown={(event) => {
                      if (event.key !== " ") return;
                      event.preventDefault();
                      setSelectedId(node.id);
                    }}
                    aria-label={intl.formatMessage(
                      { id: "entities.chart.open", defaultMessage: "Open {name}" },
                      { name: node.legalName },
                    )}
                    className="group cursor-pointer outline-none"
                    onFocus={(event) => {
                      if (!event.currentTarget.matches(":focus-visible")) return;
                      const left = node.x * view.scale + view.x;
                      const top = node.y * view.scale + view.y;
                      const right = left + CHART_NODE_WIDTH * view.scale;
                      const bottom = top + CHART_NODE_HEIGHT * view.scale;
                      const dx =
                        left < 16
                          ? 16 - left
                          : right > viewport.width - 16
                            ? viewport.width - 16 - right
                            : 0;
                      const dy =
                        top < 16
                          ? 16 - top
                          : bottom > viewport.height - 16
                            ? viewport.height - 16 - bottom
                            : 0;
                      if (dx || dy) pan(dx, dy);
                    }}
                  >
                    <rect
                      x={node.x}
                      y={node.y}
                      width={CHART_NODE_WIDTH}
                      height={CHART_NODE_HEIGHT}
                      rx={8}
                      className={
                        selectedId === node.id
                          ? "fill-canvas stroke-link"
                          : "fill-canvas stroke-border-default group-hover:stroke-link group-focus-visible:stroke-link"
                      }
                      strokeWidth={selectedId === node.id ? 3 : 2}
                    />
                    <title>{node.legalName}</title>
                    <foreignObject
                      x={node.x + 14}
                      y={node.y + 10}
                      width={CHART_NODE_WIDTH - 28}
                      height={CHART_NODE_HEIGHT - 20}
                      className="pointer-events-none"
                    >
                      <div className="flex h-full flex-col gap-0.5">
                        <p className="line-clamp-2 text-sm font-semibold leading-5 text-primary">
                          {node.legalName}
                        </p>
                        <p className="truncate text-xs text-muted">{node.type}</p>
                        <p className="truncate text-xs text-muted">
                          {node.jurisdiction ??
                            intl.formatMessage({
                              id: "entities.chart.noJurisdiction",
                              defaultMessage: "No jurisdiction",
                            })}
                        </p>
                        <p className="mt-auto text-xs font-medium text-primary">
                          {statusLabel(intl, node.status)}
                        </p>
                      </div>
                    </foreignObject>
                  </Link>
                )}
              </g>
            ))}
          </g>
        </svg>
        <button
          type="button"
          aria-label={intl.formatMessage({
            id: "entities.chart.overview",
            defaultMessage: "Chart overview — select an area to move there",
          })}
          className="absolute bottom-3 right-3 hidden overflow-hidden rounded-card border border-border-strong bg-raised shadow-sm focus-visible:outline-2 focus-visible:outline-link @sm/page:block"
          onClick={(event) => {
            const box = event.currentTarget.querySelector("svg")!.getBoundingClientRect();
            const scale = Math.min(box.width / layout.width, box.height / layout.height);
            const px = event.detail === 0 ? box.width / 2 : event.clientX - box.left;
            const py = event.detail === 0 ? box.height / 2 : event.clientY - box.top;
            const x = (px - (box.width - layout.width * scale) / 2) / scale;
            const y = (py - (box.height - layout.height * scale) / 2) / scale;
            setView({
              ...view,
              x: viewport.width / 2 - Math.max(0, Math.min(layout.width, x)) * view.scale,
              y: viewport.height / 2 - Math.max(0, Math.min(layout.height, y)) * view.scale,
            });
          }}
        >
          <svg
            width="180"
            height="100"
            viewBox={`0 0 ${layout.width} ${layout.height}`}
            aria-hidden="true"
          >
            {layout.nodes.map((node) => (
              <rect
                key={node.id}
                x={node.x}
                y={node.y}
                width={CHART_NODE_WIDTH}
                height={CHART_NODE_HEIGHT}
                rx={8}
                className="fill-border-strong"
              />
            ))}
            <rect
              x={-view.x / view.scale}
              y={-view.y / view.scale}
              width={viewport.width / view.scale}
              height={viewport.height / view.scale}
              className="fill-accent/15 stroke-link"
              vectorEffect="non-scaling-stroke"
              strokeWidth={1.5}
            />
          </svg>
        </button>
      </div>
    </section>
  );
}
