// SPDX-License-Identifier: AGPL-3.0-only
/** Inline source review and per-value confirmation for Conversion drafts (INT-008). */
import { useContext, useEffect, useRef, useState } from "react";
import { Sparkles } from "lucide-react";
import { FormattedMessage, useIntl } from "react-intl";
import type { paths } from "@openlaw/api-client";
import { SourceDocumentPanel } from "./source-document-panel";
import { ConversionSourcePanel } from "./conversion-source-panel";
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
  onConfirm,
}: Readonly<{
  number: number;
  module?: "matter" | "contract";
  showMarker?: boolean;
  draftId?: string;
  runId?: string;
  slug: string;
  onConfirm?: () => Promise<string | undefined>;
}>) {
  const intl = useIntl();
  const openDocument = useContext(SourceDocumentPanel);
  type Evidence =
    paths["/api/v1/matters/{number}/conversion-evidence/{slug}"]["get"]["responses"]["200"]["content"]["application/json"];
  const [evidence, setEvidence] = useState<Evidence | null>(null);
  const [popover, setPopover] = useState(false);
  const [panel, setPanel] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const currentRead = useRef(0);
  const openedDocument = useRef(false);
  const sourceRead = useRef<AbortController | null>(null);
  useEffect(() => () => sourceRead.current?.abort(), []);
  async function read() {
    const token = ++currentRead.current;
    sourceRead.current?.abort();
    const controller = new AbortController();
    sourceRead.current = controller;
    setEvidence(null);
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
      setEvidence(result.data ?? { available: false, citations: [] });
      if (result.data?.available && result.data.citations.some((citation) => citation.attachment)) {
        if (!draftId && openDocument) {
          if (result.data.citations.length === 1) await openCitation(result.data.citations[0]!);
        } else {
          setPopover(false);
          setPanel(true);
        }
      }
    } catch {
      if (token !== currentRead.current || controller.signal.aborted) return;
      setEvidence({ available: false, citations: [] });
    }
  }
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
        if (signal?.aborted) return;
        openedDocument.current = true;
        setPopover(false);
        return;
      }
      if (!signal?.aborted) setEvidence({ available: false, citations: [] });
      return;
    }
    setPopover(false);
    setPanel(true);
  }
  return (
    <span className="flex items-center gap-1">
      {showMarker && <UnverifiedMarker />}
      <Popover
        open={popover}
        onOpenChange={(open) => {
          setPopover(open);
          if (open) void read();
          else {
            currentRead.current += 1;
            sourceRead.current?.abort();
          }
        }}
      >
        <PopoverTrigger asChild>
          <Button
            ref={trigger}
            type="button"
            variant="ghost"
            size="icon"
            className="ai-evidence-trigger"
            aria-label={intl.formatMessage({
              id: "conversion.evidence",
              defaultMessage: "View source evidence",
            })}
          >
            <Sparkles size={16} aria-hidden="true" />
          </Button>
        </PopoverTrigger>
        <PopoverContent
          onCloseAutoFocus={(event) => {
            if (panel || openedDocument.current) event.preventDefault();
          }}
          className="max-h-96 w-96 overflow-auto"
          align="start"
        >
          {!evidence ? (
            <p role="status">
              <FormattedMessage id="conversion.evidenceLoading" defaultMessage="Loading source…" />
            </p>
          ) : !evidence.available ? (
            <p role="alert">
              <FormattedMessage
                id="conversion.evidenceUnavailable"
                defaultMessage="The source is unavailable or has changed."
              />
            </p>
          ) : (
            evidence.citations.map((citation, index) => (
              <section key={`${citation.sourceId}:${index}`} className="mb-3">
                <p className="text-xs font-medium">{citation.label}</p>
                {citation.attachment && (
                  <Button
                    type="button"
                    variant="link"
                    size="sm"
                    onClick={() => void openCitation(citation)}
                  >
                    <FormattedMessage
                      id="conversion.openSource"
                      defaultMessage="Open source document"
                    />
                  </Button>
                )}
                <blockquote className="my-2 border-l-2 border-border-default pl-2 text-sm">
                  {citation.quote}
                </blockquote>
                <p className="whitespace-pre-wrap text-sm text-muted">{citation.text}</p>
              </section>
            ))
          )}
        </PopoverContent>
      </Popover>
      {panel && evidence?.available && (
        <ConversionSourcePanel
          citations={evidence.citations}
          trigger={trigger}
          onClose={() => setPanel(false)}
        />
      )}
      {onConfirm && <ConfirmUnverified onConfirm={onConfirm} />}
    </span>
  );
}
