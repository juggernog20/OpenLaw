// SPDX-License-Identifier: AGPL-3.0-only
import { useState } from "react";
import { FormattedMessage, useIntl } from "react-intl";
import { api } from "../../lib/api";
import { problem } from "../../lib/problem";
import {
  PARTNERSHIP_BASES,
  basisMessages,
  type PartnershipRegister,
} from "../../lib/partnership-register";
import { Button } from "../ui/button";
import { Dialog, DialogContent, DialogTitle } from "../ui/dialog";

export function PartnershipBasisDialog({
  entityId,
  basis,
  onClose,
  onSaved,
}: Readonly<{
  entityId: string;
  basis: PartnershipRegister["basis"];
  onClose: () => void;
  onSaved: () => void;
}>) {
  const intl = useIntl();
  const [value, setValue] = useState(basis);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function save() {
    if (busy) return;
    setBusy(true);
    setError(null);
    const result = await api
      .PATCH("/api/v1/entities/{id}", {
        params: { path: { id: entityId } },
        body: { partnershipBasis: value },
      })
      .catch(() => undefined);
    setBusy(false);
    if (!result?.response.ok)
      setError(
        (await problem(result)).detail ??
          intl.formatMessage({
            id: "entities.partnership.basis.error",
            defaultMessage: "The ownership basis could not be changed.",
          }),
      );
    else onSaved();
  }
  return (
    <Dialog open onOpenChange={(open) => !open && !busy && onClose()}>
      <DialogContent aria-describedby={undefined} className="max-w-lg">
        <DialogTitle>
          <FormattedMessage id="entities.partnership.changeBasis" defaultMessage="Change basis" />
        </DialogTitle>
        <form
          className="mt-4 flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            void save();
          }}
        >
          <fieldset disabled={busy} className="flex flex-col gap-3">
            <legend className="mb-3 text-sm text-muted">
              <FormattedMessage
                id="entities.partnership.basis.hint"
                defaultMessage="The ownership basis sets each Partner's percentage in the register and the ownership chart."
              />
            </legend>
            {PARTNERSHIP_BASES.map((b) => (
              <label key={b} className="flex items-center gap-3 text-sm">
                <input
                  type="radio"
                  name="partnership-basis"
                  value={b}
                  checked={value === b}
                  onChange={() => setValue(b)}
                />
                {intl.formatMessage(basisMessages[b])}
              </label>
            ))}
          </fieldset>
          {error ? (
            <p role="alert" className="text-sm text-status-danger-fg">
              {error}
            </p>
          ) : null}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="secondary" disabled={busy} onClick={onClose}>
              <FormattedMessage id="common.cancel" defaultMessage="Cancel" />
            </Button>
            <Button type="submit" disabled={busy}>
              <FormattedMessage id="common.save" defaultMessage="Save" />
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
