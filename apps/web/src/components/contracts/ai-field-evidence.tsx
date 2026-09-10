// SPDX-License-Identifier: AGPL-3.0-only

/**
 * DES-070 evidence lookup and DES-016 doc panel handoff. Once the panel opens,
 * it owns focus and restores the sparkle on close, so the popover must not
 * pull focus back while the reader opens.
 */

import { Sparkles } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { FormattedMessage, useIntl } from "react-intl";
import { api } from "../../lib/api";
import { Button } from "../ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "../ui/popover";

export function AiFieldEvidence({
  field,
  slug,
  contractNumber,
  runId,
  onOpen,
}: Readonly<{
  field: string;
  slug: string;
  contractNumber: number;
  runId: string;
  onOpen: (
    documentId: string,
    versionId: string,
    quote: string,
    trigger: HTMLButtonElement,
    signal: AbortSignal,
  ) => Promise<boolean>;
}>) {
  const intl = useIntl();
  const trigger = useRef<HTMLButtonElement>(null);
  const openedCitation = useRef(false);
  const request = useRef<AbortController | null>(null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [missingQuote, setMissingQuote] = useState(false);

  useEffect(() => () => request.current?.abort(), []);

  async function showCitation() {
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    setBusy(true);
    setMissingQuote(false);
    openedCitation.current = false;
    try {
      const { data } = await api.GET("/api/v1/contracts/{number}/analysis/{runId}", {
        params: { path: { number: contractNumber, runId } },
        signal: controller.signal,
      });
      if (!data || controller.signal.aborted) return;
      const quote = data.run.outcome?.results
        ?.find((result) => result.slug === slug)
        ?.evidence?.trim();
      if (!quote || !data.run.versionId) {
        setMissingQuote(true);
        return;
      }
      if (
        !trigger.current ||
        !(await onOpen(
          data.documentId,
          data.run.versionId,
          quote,
          trigger.current,
          controller.signal,
        ))
      )
        return;
      if (controller.signal.aborted) return;
      openedCitation.current = true;
      setOpen(false);
    } catch {
      // The error stays beside the field; the record remains usable.
    } finally {
      if (!controller.signal.aborted) setBusy(false);
    }
  }

  const label = intl.formatMessage(
    { id: "contracts.analysis.viewEvidence", defaultMessage: "View AI evidence for {field}" },
    { field },
  );
  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) void showCitation();
        else request.current?.abort();
      }}
    >
      <PopoverTrigger asChild>
        <Button
          ref={trigger}
          type="button"
          variant="ghost"
          size="icon"
          className="ai-evidence-trigger shrink-0"
          aria-label={label}
          title={label}
          aria-busy={busy}
        >
          <Sparkles size={16} aria-hidden="true" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        onCloseAutoFocus={(event) => {
          if (openedCitation.current) event.preventDefault();
        }}
        align="end"
        collisionPadding={16}
        aria-label={label}
        className="w-80 max-w-[calc(100vw-2rem)] p-3"
      >
        {busy ? (
          <p role="status" className="text-sm text-muted">
            <FormattedMessage
              id="contracts.analysis.loadingEvidence"
              defaultMessage="Opening cited passage…"
            />
          </p>
        ) : (
          <div className="space-y-2">
            <p role="alert" className="text-sm text-muted">
              {missingQuote ? (
                <FormattedMessage
                  id="contracts.analysis.noSavedEvidence"
                  defaultMessage="No source quote was saved for this field."
                />
              ) : (
                <FormattedMessage
                  id="contracts.analysis.evidenceUnavailable"
                  defaultMessage="Source evidence is unavailable. The Document Version may have been removed or you may not have access."
                />
              )}
            </p>
            {!missingQuote && (
              <Button type="button" variant="link" size="sm" onClick={() => void showCitation()}>
                <FormattedMessage
                  id="contracts.analysis.retryEvidence"
                  defaultMessage="Try again"
                />
              </Button>
            )}
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}
