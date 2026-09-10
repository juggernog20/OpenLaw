// SPDX-License-Identifier: AGPL-3.0-only
/** DES-016: evidence opens above Convert; the underlying dialog stays mounted. */
import { useEffect, useState, type RefObject } from "react";
import { FormattedMessage } from "react-intl";
import type { paths } from "@openlaw/api-client";
import { Dialog, DialogContent, DialogTitle } from "../ui/dialog";
import { Button } from "../ui/button";
import { PdfSurface } from "../documents/doc-panel";
import { readRenditionState, DOCUMENT_DERIVATION_POLL_MS } from "../../lib/documents";

type Citation =
  paths["/api/v1/matters/{number}/conversion-evidence/{slug}"]["get"]["responses"]["200"]["content"]["application/json"]["citations"][number];
export function ConversionSourcePanel({
  citations,
  onClose,
  trigger,
}: Readonly<{
  citations: Citation[];
  onClose: () => void;
  trigger: RefObject<HTMLElement | null>;
}>) {
  const [selected, setSelected] = useState(() =>
    Math.max(
      0,
      citations.findIndex((source) => source.attachment),
    ),
  );
  const citation = citations[selected]!;
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent
        width="wide"
        className="flex h-[85dvh] flex-col overflow-hidden"
        aria-describedby={undefined}
        onEscapeKeyDown={(event) => event.stopPropagation()}
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          trigger.current?.focus({ preventScroll: true });
        }}
      >
        <div className="flex items-center justify-between gap-3">
          <DialogTitle>
            <FormattedMessage id="conversion.sourcePanel" defaultMessage="Source document" />
          </DialogTitle>
          <Button type="button" variant="ghost" onClick={onClose}>
            <FormattedMessage id="docPanel.close" defaultMessage="Close the document" />
          </Button>
        </div>
        {citations.length > 1 && (
          <div className="flex flex-wrap gap-2">
            {citations.map((source, index) => (
              <Button
                key={`${source.sourceId}:${index}`}
                type="button"
                variant={index === selected ? "secondary" : "ghost"}
                onClick={() => setSelected(index)}
              >
                {source.label}
              </Button>
            ))}
          </div>
        )}
        <p className="text-sm font-medium">{citation.label}</p>
        <blockquote className="max-h-24 overflow-auto whitespace-pre-wrap border-l-2 border-border-default pl-2 text-sm">
          {citation.quote}
        </blockquote>
        {citation.attachment ? (
          <>
            <a
              href={citation.attachment.downloadHref}
              download={citation.label}
              className="text-sm text-link hover:underline"
            >
              <FormattedMessage id="docPanel.download" defaultMessage="Download" />
            </a>
            <AttachmentSurface key={`${citation.sourceId}:${selected}`} citation={citation} />
          </>
        ) : (
          <p className="min-h-0 flex-1 overflow-auto whitespace-pre-wrap text-sm">
            {citation.text}
          </p>
        )}
      </DialogContent>
    </Dialog>
  );
}
function AttachmentSurface({ citation }: Readonly<{ citation: Citation }>) {
  const attachment = citation.attachment!;
  const converted =
    attachment.method === "converted" && attachment.documentId && attachment.versionId;
  const [state, setState] = useState(converted ? "pending" : "ready");
  useEffect(() => {
    if (!converted) return;
    let live = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const deadline = Date.now() + 60_000;
    async function poll() {
      const next = await readRenditionState(attachment.documentId!, attachment.versionId!);
      if (!live) return;
      if (Date.now() >= deadline || next === "unreachable") {
        setState("failed");
        return;
      }
      setState(next);
      if (next === "pending") timer = setTimeout(() => void poll(), DOCUMENT_DERIVATION_POLL_MS);
    }
    void poll();
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [converted, attachment.documentId, attachment.versionId]);
  if (state === "pending")
    return (
      <p role="status">
        <FormattedMessage
          id="docPanel.converting"
          defaultMessage="Preparing this document for reading…"
        />
      </p>
    );
  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      {(!attachment.previewHref || attachment.method === "ocr" || state !== "ready") && (
        <p className="mb-2 text-sm text-muted">
          <FormattedMessage
            id="conversion.noLocatedPassage"
            defaultMessage="This source has no searchable passage preview. Read the quoted text and check the original file."
          />
        </p>
      )}
      {attachment.previewHref && state === "ready" ? (
        <PdfSurface
          src={attachment.previewHref}
          filename={citation.label}
          initialFind={citation.quote}
        />
      ) : (
        <p className="overflow-auto whitespace-pre-wrap text-sm">{citation.text}</p>
      )}
    </div>
  );
}
