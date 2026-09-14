// SPDX-License-Identifier: AGPL-3.0-only

/** DES-086: shared Filing choices and history in both shells. */
import { useEffect, useId, useState } from "react";
import { FormattedMessage, useIntl } from "react-intl";
import { Link, useRevalidator } from "react-router";
import type { paths } from "@openlaw/api-client";
import type { AutoDocGeneration } from "../../lib/auto-docs";
import { api } from "../../lib/api";
import { CONTROL_CLASS } from "../../lib/form-controls";
import { formatLongDateTime } from "../../lib/format";
import { Button } from "../ui/button";
import { Dialog, DialogClose, DialogContent, DialogTitle, DialogTrigger } from "../ui/dialog";

type Input =
  paths["/api/v1/auto-docs/{id}/generations/{generationId}/filings"]["post"]["requestBody"]["content"]["application/json"];
export type FilingDestination = Input["destination"];
type Options =
  paths["/api/v1/auto-docs/filing-options"]["get"]["responses"][200]["content"]["application/json"];
type Filing =
  paths["/api/v1/auto-docs/{id}/generations/{generationId}/filings"]["get"]["responses"][200]["content"]["application/json"]["filings"][number];
function TargetName({
  target,
}: {
  target: { kind: "matter" | "contract"; number: number; title: string };
}) {
  return (
    <FormattedMessage
      id="autoDocs.filingTarget"
      defaultMessage="{kind, select, matter {Matter} other {Contract}} #{number}: {title}"
      values={target}
    />
  );
}
export function FilingPicker({
  portal = false,
  allowNew = false,
  onChange,
  disabled = false,
}: {
  portal?: boolean;
  allowNew?: boolean;
  onChange: (value: FilingDestination | null) => void;
  disabled?: boolean;
}) {
  const id = useId();
  const intl = useIntl();
  const [search, setSearch] = useState("");
  const [selection, setSelection] = useState("");
  const [options, setOptions] = useState<Options>();
  const [error, setError] = useState(false);
  useEffect(() => {
    let current = true;
    const timer = setTimeout(
      () => {
        void api
          .GET(
            portal ? "/api/v1/portal/auto-docs/filing-options" : "/api/v1/auto-docs/filing-options",
            {
              params: { query: search ? { search } : {} },
            },
          )
          .then((result) => {
            if (current) {
              setOptions(result.data);
              setError(!result.data);
            }
          })
          .catch(() => {
            if (current) setError(true);
          });
      },
      search ? 200 : 0,
    );
    return () => {
      current = false;
      clearTimeout(timer);
    };
  }, [portal, search]);
  return (
    <div className="space-y-3">
      <label className="block space-y-1" htmlFor={`${id}-search`}>
        <span>
          <FormattedMessage
            id="autoDocs.searchFilingDestinations"
            defaultMessage="Search Matters and Contracts"
          />
        </span>
        <input
          id={`${id}-search`}
          className={CONTROL_CLASS}
          value={search}
          disabled={disabled}
          onChange={(event) => {
            setSearch(event.target.value);
            setSelection("");
            onChange(null);
          }}
        />
      </label>
      {error && (
        <p role="alert" className="text-status-danger-fg">
          <FormattedMessage
            id="autoDocs.filingOptionsFailed"
            defaultMessage="Could not read Filing destinations. Change the search to try again."
          />
        </p>
      )}
      <label className="block space-y-1" htmlFor={`${id}-destination`}>
        <span>
          <FormattedMessage id="autoDocs.filingDestination" defaultMessage="Filing destination" />
        </span>
        <select
          id={`${id}-destination`}
          className={CONTROL_CLASS}
          value={selection}
          disabled={disabled || !options}
          onChange={(event) => {
            const selected = event.target.value;
            setSelection(selected);
            const [kind, number] = selected.split(":");
            onChange(
              kind === "contract" || kind === "matter" ? { kind, number: Number(number) } : null,
            );
          }}
        >
          <option value="">
            {intl.formatMessage({
              id: "autoDocs.chooseFilingDestination",
              defaultMessage: "Choose a destination",
            })}
          </option>
          {options?.destinations.map((target) => (
            <option
              key={`${target.kind}:${target.number}`}
              value={`${target.kind}:${target.number}`}
            >
              <TargetName target={target} />
            </option>
          ))}
          {allowNew && !portal && (
            <option value="new_contract">
              {intl.formatMessage({
                id: "autoDocs.fileNewContract",
                defaultMessage: "New Contract",
              })}
            </option>
          )}
        </select>
      </label>
      {selection === "new_contract" && (
        <label className="block space-y-1" htmlFor={`${id}-type`}>
          <span>
            <FormattedMessage id="autoDocs.filingContractType" defaultMessage="Contract Type" />
          </span>
          <select
            id={`${id}-type`}
            className={CONTROL_CLASS}
            disabled={disabled}
            defaultValue=""
            onChange={(event) =>
              onChange(
                event.target.value
                  ? { kind: "new_contract", contractTypeId: event.target.value }
                  : null,
              )
            }
          >
            <option value="">
              {intl.formatMessage({
                id: "autoDocs.chooseFilingType",
                defaultMessage: "Choose a Contract Type",
              })}
            </option>
            {options?.contractTypes.map((type) => (
              <option key={type.id} value={type.id}>
                {type.name}
              </option>
            ))}
          </select>
        </label>
      )}
    </div>
  );
}
function FilingHistory({ filings, portal }: { filings: Filing[]; portal: boolean }) {
  if (!filings.length) return null;
  return (
    <div className="space-y-2">
      <h3 className="font-semibold">
        <FormattedMessage id="autoDocs.filings" defaultMessage="Filings" />
      </h3>
      <ul className="space-y-2">
        {filings.map((filing) => (
          <li key={filing.id} className="text-sm">
            {filing.target ? (
              <Link
                className="text-link hover:underline"
                to={`/${portal ? "portal/" : ""}${filing.target.kind}s/${filing.target.number}`}
              >
                <TargetName target={filing.target} />
              </Link>
            ) : (
              <FormattedMessage
                id="autoDocs.filingUnavailable"
                defaultMessage="Destination no longer available to you"
              />
            )}
            <p className="text-muted">
              <time dateTime={filing.createdAt}>{formatLongDateTime(filing.createdAt)}</time> ·{" "}
              <FormattedMessage
                id="autoDocs.outputFormat"
                defaultMessage="{format, select, pdf {PDF} other {Word}}"
                values={{ format: filing.format }}
              />
            </p>
            {filing.target && !filing.documentId && (
              <p>
                <FormattedMessage
                  id="autoDocs.filedDocumentDeleted"
                  defaultMessage="The filed Document was deleted."
                />
              </p>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
export function GenerationFiling({
  generation,
  portal = false,
  showHistory = false,
}: {
  generation: AutoDocGeneration;
  portal?: boolean;
  showHistory?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [destination, setDestination] = useState<FilingDestination | null>(null);
  const [format, setFormat] = useState<"docx" | "pdf">(
    generation.formats === "pdf" ? "pdf" : "docx",
  );
  const [filings, setFilings] = useState<Filing[]>([]);
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const intl = useIntl();
  const { revalidate } = useRevalidator();
  const path = portal
    ? "/api/v1/portal/auto-docs/{id}/generations/{generationId}/filings"
    : "/api/v1/auto-docs/{id}/generations/{generationId}/filings";
  useEffect(() => {
    if (!showHistory && !open) return;
    let current = true;
    void api
      .GET(path, { params: { path: { id: generation.autoDocId, generationId: generation.id } } })
      .then((result) => {
        if (current && result.data) setFilings(result.data.filings);
        else if (current && open)
          setError(
            result.error?.detail ??
              intl.formatMessage({
                id: "autoDocs.filingHistoryFailed",
                defaultMessage: "Could not read Filings. Close and reopen File to try again.",
              }),
          );
      })
      .catch(() => {
        if (current && open)
          setError(
            intl.formatMessage({
              id: "autoDocs.filingHistoryFailed",
              defaultMessage: "Could not read Filings. Close and reopen File to try again.",
            }),
          );
      });
    return () => {
      current = false;
    };
  }, [open, showHistory, path, generation.autoDocId, generation.id, generation.updatedAt, intl]);
  const ready = format === "pdf" ? generation.hasPdf : generation.hasDocx;
  async function file() {
    if (!destination || busy || !ready) return;
    setBusy(true);
    setError(undefined);
    const result = await api
      .POST(path, {
        params: { path: { id: generation.autoDocId, generationId: generation.id } },
        body: { destination, format },
      })
      .catch(() => undefined);
    setBusy(false);
    if (result?.data) {
      setFilings((rows) => [result.data.filing, ...rows]);
      setOpen(false);
      setDestination(null);
      await revalidate();
    } else
      setError(
        result?.error?.detail ??
          intl.formatMessage({
            id: "autoDocs.filingFailed",
            defaultMessage: "Could not File this Generation. Try again.",
          }),
      );
  }
  return (
    <div className="space-y-3">
      {generation.filingPending && (
        <p role="status">
          <FormattedMessage
            id="autoDocs.filingPreparing"
            defaultMessage="Filing is preparing. The Document will appear on your chosen record."
          />
        </p>
      )}
      {generation.filingFailure && (
        <p role="alert" className="text-status-danger-fg">
          {generation.filingFailure.detail}
        </p>
      )}
      <Dialog
        open={open}
        onOpenChange={(next) => {
          if (!busy) {
            setOpen(next);
            setError(undefined);
            if (!next) setDestination(null);
          }
        }}
      >
        <DialogTrigger asChild>
          <Button
            variant="secondary"
            disabled={generation.filingPending || (!generation.hasDocx && !generation.hasPdf)}
          >
            <FormattedMessage id="autoDocs.file" defaultMessage="File" />
          </Button>
        </DialogTrigger>
        <DialogContent aria-describedby={undefined} className="space-y-4">
          <DialogTitle>
            <FormattedMessage
              id="autoDocs.fileNamed"
              defaultMessage="File {name}"
              values={{ name: generation.autoDocName }}
            />
          </DialogTitle>
          <p>
            <FormattedMessage
              id="autoDocs.filingCopy"
              defaultMessage="Filing creates a new Document. This Generation keeps its original output."
            />
          </p>
          <FilingPicker
            portal={portal}
            allowNew={!portal}
            onChange={setDestination}
            disabled={busy}
          />
          <label className="block space-y-1">
            <span>
              <FormattedMessage id="autoDocs.filingFormat" defaultMessage="File format" />
            </span>
            <select
              className={CONTROL_CLASS}
              value={format}
              disabled={busy}
              onChange={(event) => setFormat(event.target.value as "docx" | "pdf")}
            >
              {generation.formats !== "pdf" && (
                <option value="docx">
                  {intl.formatMessage({ id: "autoDocs.formatWord", defaultMessage: "Word" })}
                </option>
              )}
              {generation.formats !== "docx" && (
                <option value="pdf">
                  {intl.formatMessage({ id: "autoDocs.formatPdf", defaultMessage: "PDF" })}
                </option>
              )}
            </select>
          </label>
          {!ready && (
            <p role="status">
              <FormattedMessage
                id="autoDocs.filingOutputPending"
                defaultMessage="This format is still preparing. File it when it is ready."
              />
            </p>
          )}
          {error && (
            <p role="alert" className="text-status-danger-fg">
              {error}
            </p>
          )}
          <FilingHistory filings={filings} portal={portal} />
          <div className="flex justify-end gap-2">
            <DialogClose asChild>
              <Button variant="secondary" disabled={busy}>
                <FormattedMessage id="common.cancel" defaultMessage="Cancel" />
              </Button>
            </DialogClose>
            <Button
              disabled={!destination || busy || !ready || generation.filingPending}
              onClick={() => void file()}
            >
              <FormattedMessage id="autoDocs.file" defaultMessage="File" />
            </Button>
          </div>
        </DialogContent>
      </Dialog>
      {(showHistory || filings.length > 0) && <FilingHistory filings={filings} portal={portal} />}
    </div>
  );
}
