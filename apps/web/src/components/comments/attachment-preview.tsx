// SPDX-License-Identifier: AGPL-3.0-only

import { lazy, Suspense, useEffect, useState } from "react";
import { Download, X } from "lucide-react";
import { FormattedMessage, useIntl } from "react-intl";
import { Button } from "../ui/button";
import { Dialog, DialogContent, DialogTitle } from "../ui/dialog";

const PdfPreview = lazy(async () => ({
  default: (await import("../documents/pdf-preview")).PdfPreview,
}));
type Preview = { url: string; type: string } | { unavailable: true };

export function AttachmentPreview({
  filename,
  href,
  onClose,
  onFile,
  fileLabel,
}: Readonly<{
  filename: string;
  href: string;
  onClose: () => void;
  onFile?: () => void;
  fileLabel?: string;
}>) {
  const intl = useIntl();
  const [preview, setPreview] = useState<Preview | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    let objectUrl: string | undefined;
    void fetch(`${href}&preview=true`, { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error("Preview unavailable");
        const blob = await response.blob();
        if (controller.signal.aborted) return;
        if (blob.type !== "application/pdf" && !blob.type.startsWith("image/"))
          throw new Error("Preview unavailable");
        objectUrl = URL.createObjectURL(blob);
        setPreview({ url: objectUrl, type: blob.type });
      })
      .catch(() => {
        if (!controller.signal.aborted) setPreview({ unavailable: true });
      });
    return () => {
      controller.abort();
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [href]);
  const loading = (
    <p role="status" className="p-6 text-sm text-muted">
      <FormattedMessage id="comments.preview.loading" defaultMessage="Opening attachment…" />
    </p>
  );
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        width="wide"
        aria-describedby={undefined}
        className="flex h-[85dvh] min-h-0 flex-col overflow-hidden p-0"
      >
        <header className="flex shrink-0 items-center justify-between gap-4 border-b border-border-default p-4">
          <DialogTitle className="truncate text-base">{filename}</DialogTitle>
          <Button
            variant="ghost"
            size="sm"
            onClick={onClose}
            aria-label={intl.formatMessage({
              id: "comments.preview.close",
              defaultMessage: "Close attachment preview",
            })}
          >
            <X size={16} aria-hidden="true" />
          </Button>
        </header>
        <div className="flex min-h-0 flex-1 flex-col bg-canvas">
          {preview === null ? (
            loading
          ) : "unavailable" in preview ? (
            <p role="status" className="p-6 text-sm text-muted">
              <FormattedMessage
                id="comments.preview.unavailable"
                defaultMessage="Preview unavailable. You can download the original file."
              />
            </p>
          ) : preview.type === "application/pdf" ? (
            <Suspense fallback={loading}>
              <PdfPreview src={preview.url} filename={filename} allowFind />
            </Suspense>
          ) : (
            <div className="min-h-0 flex-1 overflow-auto p-4">
              <img
                src={preview.url}
                alt={filename}
                className="mx-auto max-w-full"
                onError={() => setPreview({ unavailable: true })}
              />
            </div>
          )}
        </div>
        <footer className="flex shrink-0 justify-end gap-2 border-t border-border-default p-4">
          <Button variant="secondary" asChild>
            <a href={href} download={filename}>
              <Download size={16} aria-hidden="true" />
              <FormattedMessage id="comments.preview.download" defaultMessage="Download" />
            </a>
          </Button>
          {onFile && <Button onClick={onFile}>{fileLabel}</Button>}
        </footer>
      </DialogContent>
    </Dialog>
  );
}
