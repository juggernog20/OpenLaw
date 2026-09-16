// SPDX-License-Identifier: AGPL-3.0-only

import type { ReactNode } from "react";
import { FormattedMessage } from "react-intl";
import { Button } from "./ui/button";

/** Shared creation controls for settings lists. Drafts only save on submission. */
export function InlineAddForm({
  children,
  saving,
  canSave,
  onSave,
  onCancel,
  saveLabel,
}: Readonly<{
  children: ReactNode;
  saving: boolean;
  canSave: boolean;
  onSave: () => void;
  onCancel: () => void;
  saveLabel?: ReactNode;
}>) {
  return (
    <form
      className="w-full"
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        if (!saving && canSave) onSave();
      }}
      onKeyDown={(event) => {
        if (event.key === "Escape" && !saving) {
          event.preventDefault();
          onCancel();
        }
      }}
    >
      <fieldset disabled={saving} className="flex min-w-0 flex-wrap items-center gap-2">
        {children}
        <div className="ms-auto flex shrink-0 items-center gap-2">
          <Button type="submit" size="sm" disabled={!canSave || saving}>
            {saveLabel ?? <FormattedMessage id="action.save" defaultMessage="Save" />}
          </Button>
          <Button type="button" variant="secondary" size="sm" onClick={onCancel}>
            <FormattedMessage id="action.cancel" defaultMessage="Cancel" />
          </Button>
        </div>
      </fieldset>
    </form>
  );
}
