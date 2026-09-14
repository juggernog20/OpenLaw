// SPDX-License-Identifier: AGPL-3.0-only

/** ADO-012: Administrator erasure uses the app's typed delete confirmation. */
import { useId, useState } from "react";
import { FormattedMessage, useIntl } from "react-intl";
import { useNavigate } from "react-router";
import { api } from "../../lib/api";
import { Button } from "../ui/button";
import { Dialog, DialogContent, DialogTitle, DialogTrigger } from "../ui/dialog";
import { Input } from "../ui/input";
import { Label } from "../ui/label";

export function DeleteAutoDoc({ autoDoc, disabled }: {
  autoDoc: { id: string; name: string };
  disabled: boolean;
}) {
  const intl = useIntl();
  const navigate = useNavigate();
  const id = useId();
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const matches = typed.trim().toLowerCase() === "delete";
  function changeOpen(next: boolean) {
    if (busy) return;
    setTyped("");
    setError(null);
    setOpen(next);
  }
  async function submit() {
    if (!matches || busy) return;
    setBusy(true);
    setError(null);
    const fallback = intl.formatMessage({ id: "autoDocs.delete.failed", defaultMessage: "Could not delete this Auto-Doc. Please try again." });
    try {
      const result = await api.DELETE("/api/v1/auto-docs/{id}", {
        params: { path: { id: autoDoc.id } },
        body: { confirm: "delete", confirmName: autoDoc.name },
      });
      if (!result.response.ok) {
        setError(result.error?.detail ?? fallback);
        return;
      }
      await navigate("/auto-docs");
    } catch {
      setError(fallback);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Dialog open={open} onOpenChange={changeOpen}>
      <DialogTrigger asChild>
        <Button variant="danger" disabled={disabled}>
          <FormattedMessage id="autoDocs.delete.action" defaultMessage="Delete Auto-Doc" />
        </Button>
      </DialogTrigger>
      <DialogContent aria-describedby={`${id}-description`}>
        <DialogTitle><FormattedMessage id="autoDocs.delete.title" defaultMessage="Delete this Auto-Doc?" /></DialogTitle>
        <div id={`${id}-description`} className="mt-4 space-y-3">
          <p><FormattedMessage id="autoDocs.delete.body" defaultMessage="{name}, its template versions, forms, saved Generation answers, and output files will be permanently deleted. You cannot undo this." values={{ name: autoDoc.name }} /></p>
          <p><FormattedMessage id="autoDocs.delete.retained" defaultMessage="Created Contracts and Filed Documents remain on their own records. Delete those Documents separately if their copies must also be erased. The audit history is retained." /></p>
        </div>
        <form className="mt-4 flex flex-col gap-1.5" onSubmit={event => { event.preventDefault(); void submit(); }}>
          <Label htmlFor={`${id}-confirm`}><FormattedMessage id="documents.delete.confirmLabel" defaultMessage='Type "delete" to confirm' /></Label>
          <Input id={`${id}-confirm`} autoFocus autoComplete="off" disabled={busy} value={typed} onChange={event => { setTyped(event.target.value); setError(null); }} />
          {error && <p role="alert" className="mt-2.5 text-xs text-status-danger-fg">{error}</p>}
          <div className="mt-4 flex justify-end gap-2">
            <Button type="button" variant="secondary" disabled={busy} onClick={() => changeOpen(false)}><FormattedMessage id="action.cancel" defaultMessage="Cancel" /></Button>
            <Button type="submit" variant="danger" disabled={!matches || busy} aria-label={intl.formatMessage({ id: "autoDocs.delete.confirmAction", defaultMessage: "Delete {name}" }, { name: autoDoc.name })}>
              <FormattedMessage id="action.delete" defaultMessage="Delete" />
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
