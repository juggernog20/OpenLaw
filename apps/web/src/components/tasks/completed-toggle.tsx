// SPDX-License-Identifier: AGPL-3.0-only

/** Task list headers share this action label and visibility switch (DES-069). */
import { useId } from "react";
import { defineMessages, useIntl } from "react-intl";
import { Switch } from "../ui/switch";

const labels = defineMessages({
  hide: { id: "tasks.completed.hide", defaultMessage: "Hide completed" },
  show: { id: "tasks.completed.show", defaultMessage: "Show completed" },
});

export function CompletedTasksToggle({
  showCompleted,
  onChange,
  disabled = false,
}: Readonly<{
  showCompleted: boolean;
  onChange: (showCompleted: boolean) => void;
  disabled?: boolean;
}>) {
  const intl = useIntl();
  const id = useId();
  const label = intl.formatMessage(showCompleted ? labels.hide : labels.show);
  return (
    <div className="flex shrink-0 items-center gap-2 text-xs font-medium text-primary">
      <Switch
        id={id}
        checked={showCompleted}
        onCheckedChange={onChange}
        disabled={disabled}
        aria-label={label}
      />
      <label htmlFor={id} className="cursor-pointer">
        {label}
      </label>
    </div>
  );
}
