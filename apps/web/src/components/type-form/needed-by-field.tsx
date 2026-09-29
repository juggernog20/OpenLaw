// SPDX-License-Identifier: AGPL-3.0-only

/** The Needed by Row's control (DD-028.3): a date that lands as the
 * "Needed by" key date on the record it creates. The same date picker
 * as the record's other dates, so it reads "Oct 1, 2026" like they do. */
import { useState } from "react";
import { FormattedMessage } from "react-intl";
import { DatePicker } from "../date-picker";
import { Label } from "../ui/label";
import { StatusNote } from "../status-note";

export function NeededByField({
  date,
  frozen,
  onCommit,
}: Readonly<{
  date: string | undefined;
  frozen: boolean;
  onCommit: (date: string) => Promise<string | undefined>;
}>) {
  const [draft, setDraft] = useState(date ?? "");
  const [seed, setSeed] = useState(date);
  const [status, setStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [error, setError] = useState<string>();
  if (seed !== date) {
    setSeed(date);
    setDraft(date ?? "");
  }
  async function commit(next: string) {
    if (status === "saving" || next === (date ?? "")) return;
    setDraft(next);
    setStatus("saving");
    const refusal = await onCommit(next);
    setError(refusal);
    setStatus(refusal ? "error" : "saved");
  }
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor="record-needed-by">
        <FormattedMessage id="typeForm.needed-by" defaultMessage="Needed by" />
      </Label>
      <DatePicker
        id="record-needed-by"
        value={draft}
        disabled={frozen || status === "saving"}
        onChange={(next) => void commit(next)}
        onRevert={() => setDraft(date ?? "")}
      />
      <StatusNote status={status} detail={error} />
    </div>
  );
}
