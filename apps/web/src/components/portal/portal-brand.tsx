// SPDX-License-Identifier: AGPL-3.0-only

import { useState } from "react";
import { Scale } from "lucide-react";
import { FormattedMessage } from "react-intl";
import { useOrganizationBranding } from "../../lib/organization-branding";

export function PortalBrand() {
  const branding = useOrganizationBranding();
  const [failedLogo, setFailedLogo] = useState<string | null>(null);
  const logo = branding?.logo && branding.logo !== failedLogo ? branding.logo : null;
  const name = branding?.name.trim();

  return (
    <span className="flex min-w-0 items-center gap-3">
      <span
        aria-hidden="true"
        className="flex size-8 shrink-0 items-center justify-center rounded-card bg-inverted text-on-inverted"
      >
        {logo ? (
          <img
            src={logo}
            alt=""
            className="size-8 rounded-card object-contain"
            onError={() => setFailedLogo(logo)}
          />
        ) : (
          <Scale size={20} />
        )}
      </span>
      <span className="hidden min-w-0 flex-col sm:flex">
        <span className="flex min-w-0 items-center gap-2 text-base leading-tight font-semibold text-primary">
          <span className="shrink-0">
            <FormattedMessage id="shell.brand" defaultMessage="openlaw" />
          </span>
          {name ? (
            <>
              <span aria-hidden="true" className="text-muted">
                /
              </span>
              <span className="truncate" title={name}>
                {name}
              </span>
            </>
          ) : null}
        </span>
        <span className="truncate text-sm leading-tight text-muted">
          <FormattedMessage id="portal.name" defaultMessage="Legal portal" />
        </span>
      </span>
    </span>
  );
}
