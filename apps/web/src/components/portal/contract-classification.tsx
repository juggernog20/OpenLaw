// SPDX-License-Identifier: AGPL-3.0-only

import { useState } from "react";
import { FormattedMessage, useIntl } from "react-intl";
import { MAX_CONTRACT_CLASSIFICATION_LENGTH } from "@openlaw/shared";
import { savePortalWork, type PortalWork } from "../../lib/portal-records";
import { problem } from "../../lib/problem";
import { Input } from "../ui/input";
import { Button } from "../ui/button";

export function PortalContractClassification({
  number,
  work,
}: Readonly<{ number: number; work: PortalWork }>) {
  return (
    <div className="grid grid-cols-1 gap-5 @sm/record:grid-cols-2">
      {(["owningDepartment", "region"] as const).map((name) => (
        <ClassificationInput key={name} name={name} number={number} initial={work[name] ?? ""} />
      ))}
    </div>
  );
}

function ClassificationInput({
  name,
  number,
  initial,
}: Readonly<{
  name: "owningDepartment" | "region";
  number: number;
  initial: string;
}>) {
  const intl = useIntl();
  const [draft, setDraft] = useState(initial);
  const [saved, setSaved] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function save() {
    if (busy) return;
    if (draft.trim() === saved) {
      setDraft(saved);
      return;
    }
    setBusy(true);
    setError(null);
    const result = await savePortalWork("contract", number, { [name]: draft.trim() || null }).catch(
      () => undefined,
    );
    if (result?.data) {
      const next = result.data[name] ?? "";
      setDraft(next);
      setSaved(next);
    } else {
      setError(
        (await problem(result)).detail ??
          intl.formatMessage({
            id: "portal.record.failed",
            defaultMessage: "The change could not be saved. Try again.",
          }),
      );
    }
    setBusy(false);
  }
  return (
    <div className="flex flex-col gap-2">
      <label htmlFor={`portal-${name}`} className="text-sm font-medium text-muted">
        {name === "owningDepartment" ? (
          <FormattedMessage
            id="contracts.form.owningDepartment"
            defaultMessage="Owning department"
          />
        ) : (
          <FormattedMessage id="contracts.form.region" defaultMessage="Region" />
        )}
      </label>
      <Input
        id={`portal-${name}`}
        value={draft}
        maxLength={MAX_CONTRACT_CLASSIFICATION_LENGTH}
        disabled={busy}
        aria-invalid={Boolean(error)}
        aria-describedby={error ? `portal-${name}-error` : undefined}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={() => void save()}
        onKeyDown={(event) => {
          if (event.key === "Enter") void save();
          if (event.key === "Escape") {
            setDraft(saved);
            setError(null);
          }
        }}
      />
      {error && (
        <p id={`portal-${name}-error`} role="alert" className="text-base text-status-danger-fg">
          {error}
        </p>
      )}
      {error && (
        <Button variant="secondary" disabled={busy} onClick={() => void save()}>
          <FormattedMessage id="portal.record.retrySave" defaultMessage="Retry save" />
        </Button>
      )}
    </div>
  );
}
