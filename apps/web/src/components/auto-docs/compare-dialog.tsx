// SPDX-License-Identifier: AGPL-3.0-only

/** Compare versions (DES-087 clause 3): two form versions and ADO-004's structural change list. */
import { useEffect, useState } from "react";
import { FormattedMessage, useIntl } from "react-intl";
import { api } from "../../lib/api";
import { CONTROL_CLASS } from "../../lib/form-controls";
import type { AutoDocAnswer } from "../../lib/auto-docs";
import { Button } from "../ui/button";
import { Dialog, DialogContent, DialogTitle } from "../ui/dialog";

type Change = { kind: string; name: string; before: string | null; after: string | null };

export function CompareFormsDialog({
  record,
  onClose,
}: {
  record: AutoDocAnswer;
  onClose: () => void;
}) {
  const intl = useIntl();
  const [from, setFrom] = useState(record.formVersions[1]?.id ?? record.formVersions[0]?.id ?? "");
  const [to, setTo] = useState(record.formVersions[0]?.id ?? "");
  const pair = `${from}:${to}`;
  const [answer, setAnswer] = useState<{ pair: string; changes?: Change[]; error?: string }>();
  useEffect(() => {
    if (!from || !to) return;
    let stale = false;
    void api
      .GET("/api/v1/auto-docs/{id}/form-versions/diff", {
        params: { path: { id: record.autoDoc.id }, query: { from, to } },
      })
      .catch(() => undefined)
      .then((result) => {
        if (stale) return;
        setAnswer({
          pair,
          changes: result?.data?.changes,
          error: result?.data
            ? undefined
            : (result?.error?.detail ??
              intl.formatMessage({
                id: "autoDocs.diffFailed",
                defaultMessage: "Could not compare these forms. Try again.",
              })),
        });
      });
    return () => {
      stale = true;
    };
  }, [from, to, pair, record.autoDoc.id, intl]);
  // An answer for another pair is a stale answer: the dialog shows
  // nothing until the current pair's arrives.
  const changes = answer?.pair === pair ? answer.changes : undefined;
  const error = answer?.pair === pair ? answer.error : undefined;
  const versionSelect = (value: string, onChange: (id: string) => void, label: string) => (
    <label className="flex flex-1 flex-col gap-1 text-sm">
      <span className="font-medium">{label}</span>
      <select
        className={CONTROL_CLASS}
        value={value}
        onChange={(event) => onChange(event.target.value)}
      >
        {record.formVersions.map((version) => (
          <option key={version.id} value={version.id}>
            {intl.formatMessage(
              { id: "autoDocs.formVersion", defaultMessage: "Form version {number}" },
              { number: version.versionNumber },
            )}
          </option>
        ))}
      </select>
    </label>
  );
  const none = intl.formatMessage({ id: "autoDocs.noValue", defaultMessage: "None" });
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent aria-describedby={undefined}>
        <DialogTitle>
          <FormattedMessage id="autoDocs.compareVersions" defaultMessage="Compare versions" />
        </DialogTitle>
        <div className="flex flex-col gap-3">
          <div className="flex gap-3">
            {versionSelect(
              from,
              setFrom,
              intl.formatMessage({ id: "autoDocs.formDiffFrom", defaultMessage: "From" }),
            )}
            {versionSelect(
              to,
              setTo,
              intl.formatMessage({ id: "autoDocs.formDiffTo", defaultMessage: "To" }),
            )}
          </div>
          {error && (
            <p role="alert" className="text-sm text-status-danger-fg">
              {error}
            </p>
          )}
          {changes && (
            <div role="status">
              {changes.length ? (
                <ul className="flex flex-col gap-1 text-sm">
                  {changes.map((change, index) => (
                    <li key={index}>
                      <FormattedMessage
                        id="autoDocs.formChange"
                        defaultMessage="{kind, select, added {Added {name}} removed {Removed {name}} retyped {Retyped {name}} relabelled {Relabelled {name}} reordered {Reordered {name}} mapped {Map changed: {name}} rules_changed {Clause rule changed: {name}} other {Field settings changed: {name}}}"
                        values={{ kind: change.kind, name: change.name }}
                      />
                      {["added", "removed", "retyped", "relabelled", "reordered"].includes(
                        change.kind,
                      ) && (
                        <span className="ms-2 text-muted">
                          <FormattedMessage
                            id="autoDocs.changeValues"
                            defaultMessage="{before} → {after}"
                            values={{ before: change.before ?? none, after: change.after ?? none }}
                          />
                        </span>
                      )}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-muted">
                  <FormattedMessage
                    id="autoDocs.noFormChanges"
                    defaultMessage="These form versions have no structural changes."
                  />
                </p>
              )}
            </div>
          )}
          <div className="flex justify-end">
            <Button variant="secondary" onClick={onClose}>
              <FormattedMessage id="common.close" defaultMessage="Close" />
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
