// SPDX-License-Identifier: AGPL-3.0-only
/** Inline source review and per-value confirmation for Conversion drafts (INT-008). */
import { useRef, useState } from "react";
import { Sparkles } from "lucide-react";
import { FormattedMessage, useIntl } from "react-intl";
import type { paths } from "@openlaw/api-client";
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
  slug,
  onConfirm,
}: Readonly<{
  number: number;
  module?: "matter" | "contract";
  showMarker?: boolean;
  draftId?: string;
  slug: string;
  onConfirm?: () => Promise<string | undefined>;
}>) {
  const intl = useIntl();
  type Evidence =
    paths["/api/v1/matters/{number}/conversion-evidence/{slug}"]["get"]["responses"]["200"]["content"]["application/json"];
  const [evidence, setEvidence] = useState<Evidence | null>(null);
  const [popover, setPopover] = useState(false);
  const [panel, setPanel] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const currentRead = useRef(0);
  async function read() {
    const token = ++currentRead.current;
    setEvidence(null);
    try {
      const result = draftId
        ? await api.GET("/api/v1/requests/{number}/conversion-drafts/{draftId}/evidence/{slug}", {
            params: { path: { number, draftId, slug } },
          })
        : await api.GET(
            module === "matter"
              ? "/api/v1/matters/{number}/conversion-evidence/{slug}"
              : "/api/v1/contracts/{number}/conversion-evidence/{slug}",
            {
              params: { path: { number, slug } },
            },
          );
      if (token !== currentRead.current) return;
      setEvidence(result.data ?? { available: false, citations: [] });
      if (result.data?.available && result.data.citations.some((citation) => citation.attachment)) {
        setPopover(false);
        setPanel(true);
      }
    } catch {
      setEvidence({ available: false, citations: [] });
    }
  }
  return (
    <span className="flex items-center gap-1">
      {showMarker && <UnverifiedMarker />}
      <Popover
        open={popover}
        onOpenChange={(open) => {
          setPopover(open);
          if (open) void read();
          else currentRead.current += 1;
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
            if (panel) event.preventDefault();
          }}
          className="max-h-96 w-96 overflow-auto"
          align="start"
        >
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
