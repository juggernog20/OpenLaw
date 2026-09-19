// SPDX-License-Identifier: AGPL-3.0-only
/** Prepares the editable conversion dialog before creation (INT-008). */
import { useEffect, useRef, useState, type ComponentProps } from "react";
import { LoaderCircle } from "lucide-react";
import { FormattedMessage, useIntl } from "react-intl";
import type { paths } from "@openlaw/api-client";
import { api } from "../../lib/api";
import { ConvertDialog } from "./convert-dialog";
import { Dialog, DialogContent, DialogTitle } from "../ui/dialog";
import { Button } from "../ui/button";
export type ConversionDraft =
  paths["/api/v1/requests/{number}/conversion-drafts/{draftId}"]["get"]["responses"]["200"]["content"]["application/json"]["draft"];

/**
 * Tells the API the actor has stopped watching a pending draft, so its
 * finish reaches the bell (INT-008). Fired as the dialog unmounts, which
 * is every way of leaving: Close, Esc, the overlay, or another page.
 * `keepalive` lets it outlive a tab that is closing. The answer is not
 * awaited: nothing on this side depends on it, and preparation carries
 * on in the worker either way.
 */
export function noticeWhenFinished(number: number, draftId: string) {
  void api
    .POST("/api/v1/requests/{number}/conversion-drafts/{draftId}/notice", {
      params: { path: { number, draftId } },
      keepalive: true,
    })
    .catch(() => {});
}
export function PreparedConvertDialog({
  enabled,
  ...props
}: ComponentProps<typeof ConvertDialog> & { enabled: boolean }) {
  const [manual, setManual] = useState(false);
  const [draft, setDraft] = useState<ConversionDraft | null>(null);
  const [failed, setFailed] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [started, setStarted] = useState(() => Date.now());
  const [now, setNow] = useState(started);
  const intl = useIntl();
  const preparing =
    enabled &&
    (props.initialTargetModule === "matter" ? props.matterTypes : props.contractTypes).length > 0 &&
    !manual;
  const number = props.request.number;
  /** The draft still being waited on, if any. Set while a read answers
   * `pending`, cleared once it settles or the person continues manually,
   * and read once, on unmount, to ask for the finished notice. */
  const pendingDraft = useRef<string | null>(null);
  useEffect(
    () => () => {
      if (pendingDraft.current) noticeWhenFinished(number, pendingDraft.current);
    },
    [number],
  );
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
        if (next?.state === "failed") pendingDraft.current = null;
        setFailure(next?.failure ?? null);
        setFailed(true);
        return true;
      }
      if (next.state === "ready") {
        clearTimeout(deadlineTimer);
        pendingDraft.current = null;
        setDraft(next);
        return true;
      }
      pendingDraft.current = next.id;
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
            (failure ?? (
              <FormattedMessage
                id="conversion.failed"
                defaultMessage="Preparation could not finish. Retry or continue manually."
              />
            ))
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
          <>
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
            {/* Leaving is safe, and the dialog says so: preparation runs
                in the worker, and closing this only changes who is told
                when it finishes (INT-008). */}
            <p className="mb-4 text-sm text-muted">
              <FormattedMessage
                id="conversion.preparingLeave"
                defaultMessage="You can close this and keep working. Preparation continues, and a notification tells you when the draft is ready."
              />
            </p>
          </>
        )}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={props.onClose}>
            {failed ? (
              <FormattedMessage id="action.cancel" defaultMessage="Cancel" />
            ) : (
              <FormattedMessage id="action.close" defaultMessage="Close" />
            )}
          </Button>
          <Button
            type="button"
            variant="secondary"
            onClick={() => {
              // Their choice, not a wait: nothing to be told about.
              pendingDraft.current = null;
              setManual(true);
            }}
          >
            <FormattedMessage id="conversion.manual" defaultMessage="Continue manually" />
          </Button>
          {failed && (
            <Button
              type="button"
              onClick={() => {
                setStarted(Date.now());
                setNow(Date.now());
                setFailed(false);
                setFailure(null);
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
