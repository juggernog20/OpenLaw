// SPDX-License-Identifier: AGPL-3.0-only
/** Prepares the editable Matter conversion dialog before creation (INT-008). */
import { useEffect, useState, type ComponentProps } from "react";
import { LoaderCircle } from "lucide-react";
import { FormattedMessage } from "react-intl";
import type { paths } from "@openlaw/api-client";
import { api } from "../../lib/api";
import { ConvertDialog } from "./convert-dialog";
import { Dialog, DialogContent, DialogTitle } from "../ui/dialog";
import { Button } from "../ui/button";
export type ConversionDraft =
  paths["/api/v1/requests/{number}/conversion-drafts/{draftId}"]["get"]["responses"]["200"]["content"]["application/json"]["draft"];
export function PreparedConvertDialog({
  enabled,
  ...props
}: ComponentProps<typeof ConvertDialog> & { enabled: boolean }) {
  const [manual, setManual] = useState(false);
  const [draft, setDraft] = useState<ConversionDraft | null>(null);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const preparing =
    enabled && props.initialTargetModule === "matter" && props.matterTypes.length > 0 && !manual;
  const typeId =
    props.request.requestType.targetModule === "matter"
      ? (props.request.requestType.targetTypeId ?? "")
      : "";
  const number = props.request.number;
  useEffect(() => {
    if (!preparing) return;
    const controller = new AbortController();
    const deadline = Date.now() + 180_000;
    let timer: ReturnType<typeof setTimeout> | undefined;
    async function poll(id: string) {
      if (Date.now() > deadline) {
        setFailed(true);
        return;
      }
      const { data } = await api.GET("/api/v1/requests/{number}/conversion-drafts/{draftId}", {
        params: { path: { number, draftId: id } },
        signal: controller.signal,
      });
      if (controller.signal.aborted) return;
      if (!data || data.draft.state === "failed") {
        setFailed(true);
        return;
      }
      if (data.draft.state === "ready") {
        setDraft(data.draft);
        return;
      }
      timer = setTimeout(() => {
        void poll(id).catch(() => {
          if (!controller.signal.aborted) setFailed(true);
        });
      }, 1200);
    }
    void api
      .POST("/api/v1/requests/{number}/conversion-drafts", {
        params: { path: { number } },
        body: { targetModule: "matter", targetTypeId: typeId, retry: attempt > 0 },
        signal: controller.signal,
      })
      .then(async ({ data }) => {
        if (controller.signal.aborted) return;
        if (!data) {
          setFailed(true);
          return;
        }
        await poll(data.draft.id);
      })
      .catch(() => {
        if (!controller.signal.aborted) setFailed(true);
      });
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [preparing, typeId, number, attempt]);
  if (!preparing || props.matterTypes.length === 0 || draft)
    return <ConvertDialog {...props} initialDraft={draft ?? undefined} />;
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) props.onClose();
      }}
    >
      <DialogContent aria-describedby={undefined}>
        <DialogTitle>
          <FormattedMessage id="conversion.draft" defaultMessage="Conversion draft" />
        </DialogTitle>
        <p role="status" className="my-4 flex items-center gap-2">
          {failed ? (
            <FormattedMessage
              id="conversion.failed"
              defaultMessage="Preparation could not finish. Retry or continue manually."
            />
          ) : (
            <>
              <LoaderCircle className="animate-spin" aria-hidden="true" size={16} />
              <FormattedMessage
                id="conversion.gettingMatterReady"
                defaultMessage="Getting matter ready…"
              />
            </>
          )}
        </p>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={props.onClose}>
            <FormattedMessage id="action.cancel" defaultMessage="Cancel" />
          </Button>
          <Button type="button" variant="secondary" onClick={() => setManual(true)}>
            <FormattedMessage id="conversion.manual" defaultMessage="Continue manually" />
          </Button>
          {failed && (
            <Button
              type="button"
              onClick={() => {
                setFailed(false);
                setAttempt((n) => n + 1);
              }}
            >
              <FormattedMessage id="action.retry" defaultMessage="Retry" />
            </Button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
