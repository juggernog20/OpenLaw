// SPDX-License-Identifier: AGPL-3.0-only
import { useState } from "react";
import { FormattedMessage } from "react-intl";
import { Input } from "../ui/input";
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
  async function commit() {
    if (status === "saving" || draft === (date ?? "")) return;
    setStatus("saving");
    const refusal = await onCommit(draft);
    setError(refusal);
    setStatus(refusal ? "error" : "saved");
  }
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor="record-needed-by">
        <FormattedMessage id="typeForm.needed-by" defaultMessage="Needed by" />
      </Label>
      <Input
        id="record-needed-by"
        type="date"
        value={draft}
        disabled={frozen || status === "saving"}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={() => void commit()}
        onKeyDown={(event) => {
          if (event.key === "Enter") void commit();
          if (event.key === "Escape") setDraft(date ?? "");
        }}
      />
      <StatusNote status={status} detail={error} />
    </div>
  );
}
