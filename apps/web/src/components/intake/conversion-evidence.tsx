// SPDX-License-Identifier: AGPL-3.0-only
/** Inline source review and per-value confirmation for Conversion drafts (INT-008). */
import { useState } from "react";
import { Sparkles } from "lucide-react";
import { FormattedMessage, useIntl } from "react-intl";
import { api } from "../../lib/api";
import { Button } from "../ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "../ui/popover";
import { ConfirmUnverified, UnverifiedMarker } from "../contracts/ai-analysis-card";

export function ConversionEvidence({
  number,
  draftId,
  slug,
  onConfirm,
}: Readonly<{
  number: number;
  draftId?: string;
  slug: string;
  onConfirm?: () => Promise<string | undefined>;
}>) {
  const intl = useIntl();
  const [evidence, setEvidence] = useState<{
    available: boolean;
    citations: { label: string; text: string; quote: string; sourceId: string }[];
  } | null>(null);
  async function read() {
    setEvidence(null);
    try {
      const result = draftId
        ? await api.GET("/api/v1/requests/{number}/conversion-drafts/{draftId}/evidence/{slug}", {
            params: { path: { number, draftId, slug } },
          })
        : await api.GET("/api/v1/matters/{number}/conversion-evidence/{slug}", {
            params: { path: { number, slug } },
          });
      setEvidence(result.data ?? { available: false, citations: [] });
    } catch {
      setEvidence({ available: false, citations: [] });
    }
  }
  return (
    <span className="flex items-center gap-1">
      <UnverifiedMarker />
      <Popover
        onOpenChange={(open) => {
          if (open) void read();
        }}
      >
        <PopoverTrigger asChild>
          <Button
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
        <PopoverContent className="max-h-96 w-96 overflow-auto" align="start">
          {!evidence ? (
            <p role="status">
              <FormattedMessage id="conversion.evidenceLoading" defaultMessage="Loading source…" />
            </p>
          ) : !evidence.available ? (
            <p>
              <FormattedMessage
                id="conversion.evidenceUnavailable"
                defaultMessage="The source is unavailable or has changed."
              />
            </p>
          ) : (
            evidence.citations.map((citation, index) => (
              <section key={`${citation.sourceId}:${index}`} className="mb-3">
                <p className="text-xs font-medium">{citation.label}</p>
                <blockquote className="my-2 border-l-2 border-border-default pl-2 text-sm">
                  {citation.quote}
                </blockquote>
                <p className="whitespace-pre-wrap text-sm text-muted">{citation.text}</p>
              </section>
            ))
          )}
        </PopoverContent>
      </Popover>
      {onConfirm && <ConfirmUnverified onConfirm={onConfirm} />}
    </span>
  );
}
