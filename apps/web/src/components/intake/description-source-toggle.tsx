// SPDX-License-Identifier: AGPL-3.0-only

import { FormattedMessage, useIntl } from "react-intl";
import { Switch } from "../ui/switch";

export function DescriptionSourceToggle({
  requester,
  onChange,
  ai = false,
}: Readonly<{ requester: boolean; onChange: (requester: boolean) => void; ai?: boolean }>) {
  const intl = useIntl();
  return (
    <div className="flex items-center gap-2 text-xs">
      <span className={requester ? "text-muted" : "font-medium text-primary"}>
        {ai ? (
          <FormattedMessage id="description.source.ai" defaultMessage="AI generated" />
        ) : (
          <FormattedMessage id="description.source.current" defaultMessage="Current" />
        )}
      </span>
      <Switch
        checked={requester}
        onCheckedChange={onChange}
        aria-label={intl.formatMessage({
          id: "description.source.showRequester",
          defaultMessage: "Show requester description",
        })}
      />
      <span className={requester ? "font-medium text-primary" : "text-muted"}>
        <FormattedMessage id="description.source.requester" defaultMessage="Requester" />
      </span>
    </div>
  );
}

export function RequesterDescription({ description }: Readonly<{ description: string | null }>) {
  return (
    <p className="max-h-80 overflow-y-auto whitespace-pre-wrap text-base">
      {description || (
        <FormattedMessage
          id="description.source.empty"
          defaultMessage="The requester did not provide a description."
        />
      )}
    </p>
  );
}
