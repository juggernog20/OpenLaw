// SPDX-License-Identifier: AGPL-3.0-only
/** Inline source review and per-value confirmation for Conversion drafts (INT-008). */
import { useContext, useEffect, useId, useRef, useState } from "react";
import { LoaderCircle, Sparkles } from "lucide-react";
import { FormattedMessage, useIntl } from "react-intl";
import type { paths } from "@openlaw/api-client";
import { SourceDocumentPanel } from "./source-document-panel";
import { ConversionSourcePanel } from "./conversion-source-panel";
import { EvidenceExplanation, SourceGlyph } from "./evidence-explanation";
import { groupCitations } from "./group-citations";
import { api } from "../../lib/api";
import { Button } from "../ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "../ui/popover";
import { ConfirmUnverified, UnverifiedMarker } from "../contracts/ai-analysis-card";

export function ConversionEvidence({
  number,
  module = "matter",
  showMarker = true,
  draftId,
  runId,
  slug,
  label,
  onConfirm,
}: Readonly<{
  number: number;
  module?: "matter" | "contract";
  showMarker?: boolean;
  draftId?: string;
  runId?: string;
  slug: string;
  /** The value's display name. The panel head names it when known. */
  label?: string;
  onConfirm?: () => Promise<string | undefined>;
}>) {
  const intl = useIntl();
  const headingId = useId();
  const openDocument = useContext(SourceDocumentPanel);
  type Evidence =
    paths["/api/v1/matters/{number}/conversion-evidence/{slug}"]["get"]["responses"]["200"]["content"]["application/json"];
  const [evidence, setEvidence] = useState<Evidence | null>(null);
  const [busy, setBusy] = useState(false);
  const [popover, setPopover] = useState(false);
  const [panel, setPanel] = useState(false);
  const [panelSource, setPanelSource] = useState<string>();
  const trigger = useRef<HTMLButtonElement>(null);
  const currentRead = useRef(0);
  const openedDocument = useRef(false);
  const sourceRead = useRef<AbortController | null>(null);
  useEffect(() => () => sourceRead.current?.abort(), []);
  // Nothing opens until the evidence has answered. Opening the popover
  // first and then swapping it for the reader flashed a card that was
  // never meant to be read; the sparkle carries the wait instead.
  async function read() {
    const token = ++currentRead.current;
    sourceRead.current?.abort();
    const controller = new AbortController();
    sourceRead.current = controller;
    setEvidence(null);
    setBusy(true);
    openedDocument.current = false;
    try {
      const result = runId
        ? await api.GET("/api/v1/contracts/{number}/analysis/{runId}/evidence/{slug}", {
            params: { path: { number, runId, slug } },
            signal: controller.signal,
          })
        : draftId
          ? await api.GET("/api/v1/requests/{number}/conversion-drafts/{draftId}/evidence/{slug}", {
              params: { path: { number, draftId, slug } },
              signal: controller.signal,
            })
          : await api.GET(
              module === "matter"
                ? "/api/v1/matters/{number}/conversion-evidence/{slug}"
                : "/api/v1/contracts/{number}/conversion-evidence/{slug}",
              {
                params: { path: { number, slug } },
                signal: controller.signal,
              },
            );
      if (token !== currentRead.current) return;
      const data = result.data ?? { available: false, citations: [] };
      setEvidence(data);
      if (data.available && data.citations.some((citation) => citation.attachment)) {
        if (!draftId && openDocument) {
          // A saved record with one cited file goes straight to its doc
          // panel (DES-016, #829). More than one source needs the list.
          if (data.citations.length === 1) {
            if (await openCitation(data.citations[0]!)) return;
            if (token !== currentRead.current || controller.signal.aborted) return;
          }
        } else {
          setPanelSource(undefined);
          setPanel(true);
          return;
        }
      }
      setPopover(true);
    } catch {
      if (token !== currentRead.current || controller.signal.aborted) return;
      setEvidence({ available: false, citations: [] });
      setPopover(true);
    } finally {
      if (token === currentRead.current) setBusy(false);
    }
  }
  /** Opens the citation's reader; false when the record's doc panel refused it. */
  async function openCitation(citation: Evidence["citations"][number]) {
    const attachment = citation.attachment;
    const signal = sourceRead.current?.signal;
    if (openDocument && attachment?.documentId && attachment.versionId && trigger.current) {
      if (
        await openDocument({
          module,
          number,
          documentId: attachment.documentId,
          versionId: attachment.versionId,
          quote: citation.quote,
          trigger: trigger.current,
          signal,
        })
      ) {
        if (signal?.aborted) return true;
        openedDocument.current = true;
        setPopover(false);
        return true;
      }
      if (!signal?.aborted) setEvidence({ available: false, citations: [] });
      return false;
    }
    setPanelSource(citation.sourceId);
    setPopover(false);
    setPanel(true);
    return true;
  }
  const title =
    label ??
    intl.formatMessage({ id: "conversion.evidenceTitle", defaultMessage: "Unverified value" });
  return (
    <span className="flex items-center gap-1">
      {showMarker && <UnverifiedMarker />}
      <Popover
        open={popover}
        onOpenChange={(open) => {
          if (open) {
            if (!busy) void read();
            return;
          }
          setPopover(false);
          currentRead.current += 1;
          sourceRead.current?.abort();
        }}
      >
        <PopoverTrigger asChild>
          <Button
            ref={trigger}
            type="button"
            variant="ghost"
            size="icon"
            className="ai-evidence-trigger"
            aria-busy={busy || undefined}
            aria-label={intl.formatMessage({
              id: "conversion.evidence",
              defaultMessage: "View source evidence",
            })}
          >
            {busy ? (
              <LoaderCircle size={16} aria-hidden="true" className="animate-spin" />
            ) : (
              <Sparkles size={16} aria-hidden="true" />
            )}
          </Button>
        </PopoverTrigger>
        {busy && (
          <span role="status" className="sr-only">
            <FormattedMessage id="conversion.evidenceLoading" defaultMessage="Loading source…" />
          </span>
        )}
        <PopoverContent
          onCloseAutoFocus={(event) => {
            if (panel || openedDocument.current) event.preventDefault();
          }}
          align="start"
          collisionPadding={16}
          aria-labelledby={headingId}
          // DES-049's panel shape (DES-070 evidence popover addendum): the
          // shared inset is dropped because the head, body and foot carry
          // their own, and the head's rule has to reach both edges.
          className="flex max-h-(--radix-popover-content-available-height) w-(--width-panel) max-w-(--radix-popover-content-available-width) flex-col p-0"
        >
          <header className="flex h-11 shrink-0 items-center gap-2 border-b border-border-muted px-4">
            <Sparkles size={16} aria-hidden="true" className="shrink-0 text-ai-evidence-fg" />
            <h2 id={headingId} className="truncate text-base font-semibold">
              {title}
            </h2>
          </header>
          <div className="min-h-0 flex-1 overflow-y-auto px-4">
            {!evidence?.available ? (
              <p role="alert" className="py-3 text-sm text-muted">
                <FormattedMessage
                  id="conversion.evidenceUnavailable"
                  defaultMessage="The source is unavailable or has changed."
                />
              </p>
            ) : (
              <div className="py-3">
                <EvidenceExplanation justification={evidence.justification} />
                <p className="mt-3 text-xs font-medium text-muted">
                  <FormattedMessage id="conversion.sources" defaultMessage="Sources" />
                </p>
                <ul className="mt-1 flex flex-col items-start">
                  {groupCitations(evidence.citations).map(({ source: citation }) => (
                    <li key={citation.sourceId} className="max-w-full">
                      <Button
                        type="button"
                        variant="link"
                        size="sm"
                        className="-ms-2 h-auto min-h-7 justify-start whitespace-normal py-1 text-start [overflow-wrap:anywhere]"
                        onClick={() => void openCitation(citation)}
                      >
                        <SourceGlyph file={Boolean(citation.attachment)} />
                        {citation.label}
                      </Button>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
          {onConfirm && evidence?.available && (
            <footer className="flex shrink-0 items-center justify-end border-t border-border-muted px-4 py-2">
              <ConfirmUnverified onConfirm={onConfirm} variant="secondary" />
            </footer>
          )}
        </PopoverContent>
      </Popover>
      {panel && evidence?.available && (
        <ConversionSourcePanel
          title={title}
          citations={evidence.citations}
          justification={evidence.justification}
          initialSourceId={panelSource}
          onConfirm={onConfirm}
          trigger={trigger}
          onClose={() => setPanel(false)}
        />
      )}
      {onConfirm && <ConfirmUnverified onConfirm={onConfirm} />}
    </span>
  );
}
