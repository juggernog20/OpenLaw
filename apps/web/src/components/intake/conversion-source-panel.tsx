// SPDX-License-Identifier: AGPL-3.0-only
/** DES-016: evidence opens above Convert; the underlying dialog stays mounted. */
import { useEffect, useState, type RefObject } from "react";
import { Sparkles } from "lucide-react";
import { FormattedMessage } from "react-intl";
import { Dialog, DialogContent, DialogTitle } from "../ui/dialog";
import { Button } from "../ui/button";
import { PdfSurface } from "../documents/doc-panel";
import { readRenditionState, DOCUMENT_DERIVATION_POLL_MS } from "../../lib/documents";
import { groupCitations, type Citation } from "./group-citations";
import { EvidenceExplanation, SourceGlyph } from "./evidence-explanation";
import { ConfirmUnverified } from "../contracts/ai-analysis-card";

export function ConversionSourcePanel({
  title,
  citations,
  justification,
  initialSourceId,
  onConfirm,
  onClose,
  trigger,
}: Readonly<{
  /** The value's name; the head of the reader and of the popover say the same thing. */
  title: string;
  citations: Citation[];
  justification?: string;
  /** The source the reader asked for; otherwise the first file, else the first source. */
  initialSourceId?: string;
  onConfirm?: () => Promise<string | undefined>;
  onClose: () => void;
  trigger: RefObject<HTMLElement | null>;
}>) {
  const sources = groupCitations(citations);
  const [selected, setSelected] = useState(() => {
    const asked = sources.findIndex(({ source }) => source.sourceId === initialSourceId);
    if (asked >= 0) return asked;
    return Math.max(
      0,
      sources.findIndex(({ source }) => source.attachment),
    );
  });
  const [passage, setPassage] = useState(0);
  const group = sources[selected] ?? sources[0]!;
  const citation = group.passages[passage] ?? group.passages[0]!;
  const file = citation.attachment;
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent
        width="wide"
        className="flex h-[85dvh] flex-col overflow-hidden p-0"
        aria-describedby={undefined}
        onEscapeKeyDown={(event) => event.stopPropagation()}
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          trigger.current?.focus({ preventScroll: true });
        }}
      >
        {/* The evidence popover, carried into the reader (DES-070 evidence
            reader addendum): the same head, then the "why" as one band, then
            one toolbar row for sources, passages and download. The document
            gets everything below, so a file source never has to flash a
            popover on its way here. */}
        <header className="flex h-11 shrink-0 items-center gap-2 border-b border-border-muted px-4">
          <Sparkles size={16} aria-hidden="true" className="shrink-0 text-ai-evidence-fg" />
          <DialogTitle className="min-w-0 flex-1 truncate text-base">{title}</DialogTitle>
          <Button type="button" variant="ghost" size="sm" onClick={onClose}>
            <FormattedMessage id="docPanel.close" defaultMessage="Close the document" />
          </Button>
        </header>
        <div className="flex shrink-0 items-start gap-4 border-b border-border-muted bg-canvas px-4 py-3">
          <div className="min-w-0 flex-1">
            <EvidenceExplanation justification={justification} />
          </div>
          {onConfirm && <ConfirmUnverified onConfirm={onConfirm} variant="secondary" />}
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-border-muted px-4 py-2">
          {sources.length > 1 ? (
            <ul className="flex flex-wrap items-center gap-1">
              {sources.map(({ source }, index) => (
                <li key={source.sourceId}>
                  <Button
                    type="button"
                    variant={index === selected ? "secondary" : "ghost"}
                    size="sm"
                    aria-pressed={index === selected}
                    className="h-auto min-h-7 whitespace-normal py-1 text-start [overflow-wrap:anywhere]"
                    onClick={() => {
                      setSelected(index);
                      setPassage(0);
                    }}
                  >
                    <SourceGlyph file={Boolean(source.attachment)} />
                    {source.label}
                  </Button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="flex min-w-0 items-center gap-2 text-sm font-medium [overflow-wrap:anywhere]">
              <SourceGlyph file={Boolean(group.source.attachment)} />
              {group.source.label}
            </p>
          )}
          {file && (
            <span className="ms-auto flex flex-wrap items-center gap-2">
              {group.passages.length > 1 && (
                <>
                  <span role="status" className="text-sm text-muted">
                    <FormattedMessage
                      id="conversion.passageCount"
                      defaultMessage="Passage {current} of {total}"
                      values={{ current: passage + 1, total: group.passages.length }}
                    />
                  </span>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    disabled={passage === 0}
                    onClick={() => setPassage(passage - 1)}
                  >
                    <FormattedMessage
                      id="conversion.previousPassage"
                      defaultMessage="Previous passage"
                    />
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    disabled={passage === group.passages.length - 1}
                    onClick={() => setPassage(passage + 1)}
                  >
                    <FormattedMessage id="conversion.nextPassage" defaultMessage="Next passage" />
                  </Button>
                </>
              )}
              <a
                href={file.downloadHref}
                download={citation.label}
                className="text-sm text-link hover:underline"
              >
                <FormattedMessage id="docPanel.download" defaultMessage="Download" />
              </a>
            </span>
          )}
        </div>
        <div className="flex min-h-0 flex-1 flex-col px-4 py-3">
          {file ? (
            <AttachmentSurface key={group.source.sourceId} citation={citation} />
          ) : (
            <div className="min-h-0 flex-1 overflow-auto whitespace-pre-wrap text-sm">
              {group.passages.map((quote) => (
                <blockquote className="mb-3" key={quote.quote}>
                  {quote.quote}
                </blockquote>
              ))}
            </div>
          )}
        </div>
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
      // `unreachable` is a dropped connection, not an answer about the
      // file, so it waits out the same bound a running conversion does.
      // Giving up on the first one would tell the reader this source has
      // no passage preview when the rendition is sitting there ready.
      if (next === "unreachable" || next === "pending") {
        if (Date.now() >= deadline) setState("failed");
        else timer = setTimeout(() => void poll(), DOCUMENT_DERIVATION_POLL_MS);
        return;
      }
      setState(next);
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
            defaultMessage="This source has no searchable passage preview. Read the source text and check the original file."
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
