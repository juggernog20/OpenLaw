// SPDX-License-Identifier: AGPL-3.0-only

import { FormattedMessage } from "react-intl";

export function AiKeyStatus({ inUse }: Readonly<{ inUse: boolean }>) {
  return (
    <span
      role="status"
      className="rounded-pill bg-status-success-bg px-2 py-0.5 text-xs font-medium text-status-success-fg"
    >
      {inUse ? (
        <FormattedMessage id="settings.aiAnalysis.keyInUse" defaultMessage="Key in use" />
      ) : (
        <FormattedMessage id="settings.aiAnalysis.keySaved" defaultMessage="Key saved" />
      )}
    </span>
  );
}
