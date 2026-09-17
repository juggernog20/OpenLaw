// SPDX-License-Identifier: AGPL-3.0-only
import { useEffect, useState } from "react";
import { useLocation } from "react-router";
import { api } from "./api";

export const ORGANIZATION_BRANDING_CHANGED = "openlaw:organization-branding-changed";
export function useOrganizationBranding() {
  const [branding, setBranding] = useState<{ name: string; logo: string | null } | null>(null);
  const location = useLocation();
  useEffect(() => {
    let controller: AbortController | undefined;
    const refresh = () => {
      controller?.abort();
      const request = new AbortController();
      controller = request;
      void api.GET("/api/v1/org/branding", { signal: request.signal }).then(
        ({ data }) => {
          if (!request.signal.aborted && data) setBranding(data);
        },
        () => {
          /* Branding failures must not interrupt navigation. */
        },
      );
    };
    refresh();
    window.addEventListener(ORGANIZATION_BRANDING_CHANGED, refresh);
    return () => {
      controller?.abort();
      window.removeEventListener(ORGANIZATION_BRANDING_CHANGED, refresh);
    };
  }, [location.key]);
  return branding;
}
