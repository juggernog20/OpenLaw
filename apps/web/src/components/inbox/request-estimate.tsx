// SPDX-License-Identifier: AGPL-3.0-only

/** INT-003: triage confirms a suggestion or selects its own return estimate. */
import { useLayoutEffect, useRef, useState } from "react";
import { FormattedMessage } from "react-intl";
import { api } from "../../lib/api";
import { formatFullDate } from "../../lib/format";
import { problem } from "../../lib/problem";
import type { StaffRequest } from "../../lib/requests";
import { DatePicker } from "../date-picker";
import { Label } from "../ui/label";
import { Button } from "../ui/button";
import { StatusNote, type FieldStatus } from "../status-note";

export type EstimatedRequest = Pick<
  StaffRequest,
  "number" | "status" | "expectedBy" | "suggestedExpectedBy"
>;

function estimateVersion(request: EstimatedRequest) {
  const editable = request.status === "new" || request.status === "converted";
  return `${request.number}|${request.expectedBy ?? ""}|${String(editable)}`;
}

export function RequestEstimate({
  request,
  onSaved,
}: Readonly<{ request: EstimatedRequest; onSaved: (saved: StaffRequest) => void }>) {
  const [status, setStatus] = useState<FieldStatus>("idle");
  const [error, setError] = useState<string | null>(null);
  // What the picker shows, which is the saved date until triage picks
  // another one. A refused pick stays in the box rather than snapping
  // back to the saved date, so the pick can be retried and Escape is
  // what puts it back (DES-048).
  const [draft, setDraft] = useState(request.expectedBy ?? "");
  const pending = useRef(false);
  const editable = request.status === "new" || request.status === "converted";
  // The Request as the last render saw it. A draft outlives a refusal,
  // but it must not outlive the record it was a draft of: a colleague
  // saving another date, or closing the Request, is the saved answer
  // and the box has to show it. Adjusted during render rather than in
  // an effect, so no frame draws the stale date.
  const seen = estimateVersion(request);
  const [accepted, setAccepted] = useState<string | null>(null);
  const generation = useRef(0);
  useLayoutEffect(() => {
    // A refreshed record or unmount makes every outstanding answer obsolete.
    return () => {
      generation.current += 1;
      pending.current = false;
    };
  }, [seen]);
  const [lastSeen, setLastSeen] = useState(seen);
  if (lastSeen !== seen) {
    setLastSeen(seen);
    setDraft(request.expectedBy ?? "");
    setStatus(accepted === seen ? "saved" : "idle");
    setAccepted(null);
    setError(null);
  }
  async function save(expectedBy: string | null) {
    if (pending.current) return;
    pending.current = true;
    const started = generation.current;
    setAccepted(null);
    setDraft(expectedBy ?? "");
    setStatus("saving");
    setError(null);
    const result = await api
      .PATCH("/api/v1/requests/{number}/expected-by", {
        params: { path: { number: request.number } },
        body: { expectedBy },
      })
      .catch(() => undefined);
    if (started !== generation.current) return;
    if (result?.data) {
      setAccepted(estimateVersion(result.data.request));
      onSaved(result.data.request);
      setStatus("saved");
    } else {
      const failure = await problem(result);
      if (started !== generation.current) return;
      setError(failure.detail ?? null);
      setStatus("error");
    }
    pending.current = false;
  }
  return (
    <div className="flex flex-col gap-2 rounded-card border border-border-default bg-raised p-4">
      <Label htmlFor="request-expected-by">
        <FormattedMessage id="requests.expectedBack" defaultMessage="Expected back (estimate)" />
      </Label>
      <div className="flex flex-wrap items-center gap-2">
        <DatePicker
          id="request-expected-by"
          value={draft}
          disabled={!editable || status === "saving"}
          onChange={(next) => void save(next || null)}
          onRevert={() => {
            setDraft(request.expectedBy ?? "");
            setStatus("idle");
            setError(null);
          }}
        />
        {editable && request.expectedBy && (
          <Button
            variant="ghost"
            size="sm"
            disabled={status === "saving"}
            onClick={() => void save(null)}
          >
            <FormattedMessage id="requests.clearEstimate" defaultMessage="Clear estimate" />
          </Button>
        )}
        {editable && !request.expectedBy && request.suggestedExpectedBy && (
          <Button
            variant="secondary"
            size="sm"
            disabled={status === "saving"}
            onClick={() => void save(request.suggestedExpectedBy)}
          >
            <FormattedMessage
              id="requests.useSuggestedEstimate"
              defaultMessage="Use suggested date: {date}"
              values={{ date: formatFullDate(request.suggestedExpectedBy) }}
            />
          </Button>
        )}
        <StatusNote status={status} detail={error} />
      </div>
      <p className="text-xs text-muted">
        <FormattedMessage
          id="requests.estimateHint"
          defaultMessage="An estimate from Legal, separate from the requester's Needed by date. Suggested dates use the request type's calendar-day turnaround from submission."
        />
      </p>
    </div>
  );
}
