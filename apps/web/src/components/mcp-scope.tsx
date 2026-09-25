// SPDX-License-Identifier: AGPL-3.0-only
import { FormattedMessage } from "react-intl";

export function Scope({ scope }: { scope: "read" | "write" }) {
  return (
    <span
      className={
        scope === "write"
          ? "rounded-full bg-status-warning-bg px-2 py-0.5 text-status-warning-fg"
          : "rounded-full bg-status-info-bg px-2 py-0.5 text-status-info-fg"
      }
    >
      {scope === "write" ? (
        <FormattedMessage id="apiKeys.write" defaultMessage="Write" />
      ) : (
        <FormattedMessage id="apiKeys.read" defaultMessage="Read" />
      )}
    </span>
  );
}
