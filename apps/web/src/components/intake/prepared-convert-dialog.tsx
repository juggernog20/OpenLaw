// SPDX-License-Identifier: AGPL-3.0-only
/** Prepares the editable conversion dialog before creation (INT-008). */
import { useEffect, useState, type ComponentProps } from "react";
import { LoaderCircle } from "lucide-react";
import { FormattedMessage, useIntl } from "react-intl";
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
  const [started, setStarted] = useState(() => Date.now());
  const [now, setNow] = useState(started);
  const intl = useIntl();
  const preparing =
    enabled &&
    (props.initialTargetModule === "matter" ? props.matterTypes : props.contractTypes).length > 0 &&
    !manual;
  const number = props.request.number;
  useEffect(() => {
    if (!preparing) return;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    // Bound the entire wait, including a request that never settles.
    const expire = () => {
      controller.abort();
      clearTimeout(timer);
      setFailed(true);
    };
    let deadlineTimer = setTimeout(expire, 180_000);
    let progressAt: string | undefined;
    function receive(next: ConversionDraft | undefined) {
      if (controller.signal.aborted) return true;
      if (!next || next.state === "failed") {
        clearTimeout(deadlineTimer);
        setFailed(true);
        return true;
      }
      if (next.state === "ready") {
        clearTimeout(deadlineTimer);
        setDraft(next);
        return true;
      }
      if (next.progressAt && next.progressAt !== progressAt) {
        progressAt = next.progressAt;
        clearTimeout(deadlineTimer);
        deadlineTimer = setTimeout(expire, 180_000);
      }
      return false;
    }
    async function poll(id: string) {
      const { data } = await api.GET("/api/v1/requests/{number}/conversion-drafts/{draftId}", {
        params: { path: { number, draftId: id } },
        signal: controller.signal,
      });
      if (receive(data?.draft)) return;
      timer = setTimeout(() => {
        void poll(id).catch(() => {
          clearTimeout(deadlineTimer);
          if (!controller.signal.aborted) setFailed(true);
        });
      }, 1200);
    }
    void api
      .POST("/api/v1/requests/{number}/conversion-drafts", {
        params: { path: { number } },
        body: {
          targetModule: props.initialTargetModule ?? "contract",
          targetTypeId: "",
          retry: attempt > 0,
        },
        signal: controller.signal,
      })
      .then(async ({ data }) => {
        if (receive(data?.draft)) return;
        if (data) await poll(data.draft.id);
      })
      .catch(() => {
        clearTimeout(deadlineTimer);
        if (!controller.signal.aborted) setFailed(true);
      });
    return () => {
      controller.abort();
      clearTimeout(timer);
      clearTimeout(deadlineTimer);
    };
  }, [preparing, number, attempt, props.initialTargetModule]);
  // A wait with a clock on it is not a hang. One provider call can run
  // past two minutes on a long attachment, and the spinner alone read as
  // stuck, so the dialog counts the seconds it has been working.
  useEffect(() => {
    if (!preparing || failed) return;
    const tick = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(tick);
  }, [preparing, failed, attempt]);
  if (!preparing || draft) return <ConvertDialog {...props} initialDraft={draft ?? undefined} />;
  const elapsed = Math.max(0, Math.floor((now - started) / 1000));
  const minutes = Math.floor(elapsed / 60);
  const duration = [
    minutes > 0
      ? intl.formatNumber(minutes, { style: "unit", unit: "minute", unitDisplay: "long" })
      : null,
    intl.formatNumber(elapsed % 60, { style: "unit", unit: "second", unitDisplay: "long" }),
  ]
    .filter(Boolean)
    .join(" ");
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) props.onClose();
      }}
    >
      <DialogContent width="3xl" aria-describedby={undefined}>
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
                id="conversion.gettingReady"
                defaultMessage="Getting {module, select, matter {matter} other {contract}} ready…"
                values={{ module: props.initialTargetModule }}
              />
            </>
          )}
        </p>
        {!failed && (
          <p className="mb-4 text-sm text-muted">
            <FormattedMessage
              id="conversion.preparingHint"
              defaultMessage="The provider reads the Request and its attachments. A long attachment can take a few minutes."
            />{" "}
            <FormattedMessage
              id="conversion.preparingElapsed"
              defaultMessage="Working for {duration}."
              values={{ duration }}
            />
          </p>
        )}
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
                setStarted(Date.now());
                setNow(Date.now());
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
