// SPDX-License-Identifier: AGPL-3.0-only

import { useEffect, useId, useMemo, useState } from "react";
import { FormattedMessage, useIntl } from "react-intl";
import { Download } from "lucide-react";
import { api } from "../../lib/api";
import type { EntityChart } from "../../lib/entities";
import { CONTROL_CLASS } from "../../lib/form-controls";
import { Button } from "../ui/button";
import { Checkbox } from "../ui/checkbox";
import { Dialog, DialogContent, DialogTitle } from "../ui/dialog";
import {
  createChartExportModel,
  DEFAULT_EXPORT_FIELDS,
  exportFields,
  scopeExportChart,
  type ChartExportModel,
  type ExportRecords,
  type ExportRecord,
  type MeasureText,
} from "./entity-chart-export-model";
import {
  createChartPdf,
  createChartPowerPoint,
  downloadChart,
  loadExportMeasure,
} from "./entity-chart-export-files";

export async function readExportRecords(
  chart: EntityChart,
  signal: AbortSignal,
): Promise<ExportRecords> {
  const pending = chart.nodes.filter((node) => !node.restricted);
  const records = new Map<string, ExportRecord>();
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(4, pending.length) }, async () => {
      while (next < pending.length) {
        signal.throwIfAborted();
        const node = pending[next++]!;
        const [record, officers] = await Promise.all([
          api.GET("/api/v1/entities/{id}", { params: { path: { id: node.id } }, signal }),
          api.GET("/api/v1/entities/{id}/officers", { params: { path: { id: node.id } }, signal }),
        ]);
        if (!record.data || !officers.data) throw new Error("Entity details could not be loaded.");
        records.set(node.id, { ...record.data, officers: officers.data.officers });
      }
    }),
  );
  return records;
}

export function EntityChartExport({
  chart,
  selectedId,
}: Readonly<{ chart: EntityChart; selectedId: string | null }>) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button
        variant="secondary"
        size="sm"
        disabled={chart.nodes.length === 0}
        onClick={() => setOpen(true)}
      >
        <Download size={14} aria-hidden="true" />
        <FormattedMessage id="entities.chart.export.open" defaultMessage="Export chart" />
      </Button>
      {open && (
        <ExportDialog chart={chart} selectedId={selectedId} onClose={() => setOpen(false)} />
      )}
    </>
  );
}

function ExportDialog({
  chart,
  selectedId,
  onClose,
}: Readonly<{ chart: EntityChart; selectedId: string | null; onClose: () => void }>) {
  const intl = useIntl();
  const id = useId();
  const [title, setTitle] = useState(() =>
    intl.formatMessage({
      id: "entities.chart.export.defaultTitle",
      defaultMessage: "Entity structure chart",
    }),
  );
  const [rootId, setRootId] = useState(selectedId ?? "");
  const [selectedFields, setSelectedFields] = useState(new Set(DEFAULT_EXPORT_FIELDS));
  const [percentages, setPercentages] = useState(true);
  const [format, setFormat] = useState<"pdf" | "pptx">("pdf");
  const [loaded, setLoaded] = useState<{
    chart: EntityChart;
    records: ExportRecords;
    measure: MeasureText;
  }>();
  const [failedChart, setFailedChart] = useState<EntityChart>();
  const loadError = failedChart === chart;
  const ready = loaded?.chart === chart;
  const [retry, setRetry] = useState(0);
  const [exportError, setExportError] = useState(false);
  const [busy, setBusy] = useState(false);
  const [previewActualSize, setPreviewActualSize] = useState(false);
  const scopedChart = useMemo(() => scopeExportChart(chart, rootId), [chart, rootId]);

  useEffect(() => {
    const controller = new AbortController();
    void Promise.all([readExportRecords(chart, controller.signal), loadExportMeasure()])
      .then(([records, measure]) => {
        if (!controller.signal.aborted) setLoaded({ chart, records, measure });
      })
      .catch(() => {
        if (!controller.signal.aborted) {
          setFailedChart(chart);
          controller.abort();
        }
      });
    return () => controller.abort();
  }, [chart, retry]);

  const scopedRecords = useMemo(
    () =>
      new Map(
        scopedChart.nodes.flatMap((node) => {
          const record = ready ? loaded?.records.get(node.id) : undefined;
          return record && !node.restricted ? [[node.id, record] as const] : [];
        }),
      ),
    [loaded, scopedChart, ready],
  );
  const fields = useMemo(() => exportFields(intl, scopedRecords), [intl, scopedRecords]);
  const model = useMemo(
    () =>
      ready && loaded && scopedChart.nodes.length > 0
        ? createChartExportModel({
            chart: scopedChart,
            records: scopedRecords,
            fields: fields.filter((field) => selectedFields.has(field.id)),
            title: title.trim(),
            percentages,
            intl,
            measure: loaded.measure,
          })
        : undefined,
    [loaded, scopedChart, scopedRecords, fields, selectedFields, title, percentages, intl, ready],
  );

  async function save() {
    if (!model || busy || !title.trim()) return;
    setBusy(true);
    setExportError(false);
    try {
      const blob =
        format === "pdf" ? await createChartPdf(model) : await createChartPowerPoint(model);
      downloadChart(blob, model.title, format);
      onClose();
    } catch {
      setExportError(true);
      setBusy(false);
    }
  }

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !busy) onClose();
      }}
    >
      <DialogContent width="wide" aria-describedby={`${id}-description`}>
        <DialogTitle>
          <FormattedMessage id="entities.chart.export.open" defaultMessage="Export chart" />
        </DialogTitle>
        <p id={`${id}-description`} className="mt-1 text-sm text-muted">
          <FormattedMessage
            id="entities.chart.export.description"
            defaultMessage="Choose a structure and the fields to show on each entity. The export includes the full selected structure, regardless of pan or zoom."
          />
        </p>
        <fieldset
          disabled={busy}
          className="mt-5 grid min-w-0 gap-5 @2xl/dialog:grid-cols-[18rem_1fr]"
        >
          <div className="flex min-w-0 flex-col gap-4">
            <label className="flex flex-col gap-1 text-sm font-medium">
              <FormattedMessage id="entities.chart.export.title" defaultMessage="Chart title" />
              <input
                className={CONTROL_CLASS}
                value={title}
                maxLength={160}
                onChange={(event) => setTitle(event.target.value)}
              />
            </label>
            <label className="flex flex-col gap-1 text-sm font-medium">
              <FormattedMessage
                id="entities.chart.export.scope"
                defaultMessage="Structure to export"
              />
              <select
                className={CONTROL_CLASS}
                value={rootId}
                onChange={(event) => setRootId(event.target.value)}
              >
                <option value="">
                  {intl.formatMessage({
                    id: "entities.chart.export.currentChart",
                    defaultMessage: "Current chart (all search results)",
                  })}
                </option>
                {chart.nodes
                  .filter((node) => !node.restricted)
                  .map((node) => (
                    <option key={node.id} value={node.id}>
                      {node.legalName}
                    </option>
                  ))}
              </select>
            </label>
            {rootId && (
              <p className="text-xs text-muted">
                <FormattedMessage
                  id="entities.chart.export.chainHint"
                  defaultMessage="Includes this entity, its owners and the entities it owns, through all levels."
                />
              </p>
            )}
            <fieldset className="min-w-0 rounded-card border border-border-default p-3">
              <legend className="px-1 text-sm font-semibold">
                <FormattedMessage
                  id="entities.chart.export.fields"
                  defaultMessage="Entity information"
                />
              </legend>
              <div className="flex max-h-64 flex-col gap-3 overflow-y-auto p-1">
                <label className="flex items-center gap-2 text-sm">
                  <Checkbox checked disabled />
                  <FormattedMessage
                    id="entities.chart.export.legalName"
                    defaultMessage="Legal name (always included)"
                  />
                </label>
                {fields.map((field) => (
                  <label key={field.id} className="flex items-center gap-2 text-sm">
                    <Checkbox
                      checked={selectedFields.has(field.id)}
                      onCheckedChange={(checked) =>
                        setSelectedFields((previous) => {
                          const next = new Set(previous);
                          if (checked === true) next.add(field.id);
                          else next.delete(field.id);
                          return next;
                        })
                      }
                    />
                    <span>
                      {field.label}
                      {field.custom && (
                        <span className="ml-1 text-xs text-muted">
                          (
                          <FormattedMessage
                            id="entities.chart.export.custom"
                            defaultMessage="custom"
                          />
                          )
                        </span>
                      )}
                    </span>
                  </label>
                ))}
              </div>
            </fieldset>
            <p className="text-xs text-muted">
              <FormattedMessage
                id="entities.chart.export.emptyFields"
                defaultMessage="Fields without a recorded value are omitted. Confidential entities keep their placeholder."
              />
            </p>
            <label className="flex items-center gap-2 text-sm">
              <Checkbox
                checked={percentages}
                onCheckedChange={(checked) => setPercentages(checked === true)}
              />
              <FormattedMessage
                id="entities.chart.export.percentages"
                defaultMessage="Ownership percentages"
              />
            </label>
            <label className="flex flex-col gap-1 text-sm font-medium">
              <FormattedMessage id="entities.chart.export.format" defaultMessage="File format" />
              <select
                className={CONTROL_CLASS}
                value={format}
                onChange={(event) => setFormat(event.target.value as "pdf" | "pptx")}
              >
                <option value="pdf">PDF (.pdf)</option>
                <option value="pptx">PowerPoint (.pptx)</option>
              </select>
            </label>
          </div>
          <div className="flex min-w-0 flex-col gap-2">
            <h3 className="text-sm font-semibold">
              <FormattedMessage
                id="entities.chart.export.preview"
                defaultMessage="Export preview"
              />
            </h3>
            {loadError ? (
              <div
                role="alert"
                className="rounded-card border border-border-default p-4 text-sm text-danger-inline"
              >
                <FormattedMessage
                  id="entities.chart.export.loadError"
                  defaultMessage="Entity details could not be loaded. Retry to use the latest records and access permissions."
                />
                <Button
                  variant="secondary"
                  size="sm"
                  className="mt-3"
                  onClick={() => {
                    setFailedChart(undefined);
                    setRetry((value) => value + 1);
                  }}
                >
                  <FormattedMessage id="entities.chart.export.retry" defaultMessage="Retry" />
                </Button>
              </div>
            ) : model ? (
              <>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => setPreviewActualSize((value) => !value)}
                >
                  {previewActualSize ? (
                    <FormattedMessage
                      id="entities.chart.export.fitPreview"
                      defaultMessage="Fit preview"
                    />
                  ) : (
                    <FormattedMessage
                      id="entities.chart.export.actualSizePreview"
                      defaultMessage="Preview at actual size"
                    />
                  )}
                </Button>
                <div className="max-h-96 overflow-auto rounded-card border border-border-default">
                  <ExportPreview
                    model={model}
                    actualSize={previewActualSize}
                    label={intl.formatMessage({
                      id: "entities.chart.export.preview",
                      defaultMessage: "Export preview",
                    })}
                  />
                </div>
                <p className="text-xs text-muted">
                  <FormattedMessage
                    id="entities.chart.export.count"
                    defaultMessage="{count, plural, one {# entity} other {# entities}} · One page or slide sized to the chart"
                    values={{ count: model.cards.length }}
                  />
                </p>
              </>
            ) : (
              <p role="status" className="p-4 text-sm text-muted">
                <FormattedMessage
                  id="entities.chart.export.loading"
                  defaultMessage="Loading entity details…"
                />
              </p>
            )}
          </div>
        </fieldset>
        {exportError && (
          <p role="alert" className="mt-4 text-sm text-danger-inline">
            <FormattedMessage
              id="entities.chart.export.error"
              defaultMessage="The chart could not be exported. Please try again."
            />
          </p>
        )}
        <div className="mt-5 flex justify-end gap-2">
          <Button variant="secondary" disabled={busy} onClick={onClose}>
            <FormattedMessage id="entities.chart.export.cancel" defaultMessage="Cancel" />
          </Button>
          <Button
            disabled={!model || loadError || busy || !title.trim()}
            onClick={() => void save()}
          >
            {busy ? (
              <FormattedMessage id="entities.chart.export.exporting" defaultMessage="Exporting…" />
            ) : (
              <FormattedMessage
                id="entities.chart.export.download"
                defaultMessage="Download chart"
              />
            )}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function ExportPreview({
  model,
  label,
  actualSize,
}: Readonly<{ model: ChartExportModel; label: string; actualSize: boolean }>) {
  return (
    <svg
      role="img"
      aria-label={label}
      viewBox={`0 0 ${model.width} ${model.height}`}
      className={actualSize ? "max-w-none" : "h-96 w-full"}
      width={actualSize ? model.width : undefined}
      height={actualSize ? model.height : undefined}
      xmlns="http://www.w3.org/2000/svg"
    >
      <rect width={model.width} height={model.height} fill="#FFFFFF" />
      {model.edges.map((edge, index) => (
        <polyline
          key={index}
          points={edge.points.map((point) => `${point.x},${point.y}`).join(" ")}
          fill="none"
          stroke="#999999"
          strokeDasharray={edge.secondary ? "5 4" : undefined}
        />
      ))}
      {model.cards.map((card) => (
        <rect
          key={card.id}
          x={card.x}
          y={card.y}
          width={card.width}
          height={card.height}
          rx={6}
          fill={card.restricted ? "#EEEAE4" : "#FFFFFF"}
          stroke="#C9C4BC"
        />
      ))}
      {model.texts.map((line, index) => (
        <text
          key={index}
          x={line.x}
          y={line.y + line.size}
          fontSize={line.size}
          fontWeight={line.bold ? 700 : 400}
          fontFamily="OpenLaw Chart, Arial, sans-serif"
          fill={`#${line.color}`}
        >
          {line.text}
        </text>
      ))}
    </svg>
  );
}
