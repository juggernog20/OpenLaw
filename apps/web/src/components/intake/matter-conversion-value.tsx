// SPDX-License-Identifier: AGPL-3.0-only
/** Matter value markers backed by Conversion draft provenance (INT-008). The
 * purple frame is the control's own (DES-070); this only adds the evidence. */
import { useIntl } from "react-intl";
import type { ReactNode } from "react";
import { api } from "../../lib/api";
import { problem } from "../../lib/problem";
import { ConversionEvidence } from "./conversion-evidence";
export function MatterConversionValue({
  active,
  number,
  slug,
  children,
  onConfirmed,
}: Readonly<{
  active: boolean;
  number: number;
  slug: string;
  children: ReactNode;
  onConfirmed?: (slug: string) => void;
}>) {
  const intl = useIntl();
  return (
    <div className="min-w-0">
      {children}
      {active && (
        <ConversionEvidence
          number={number}
          slug={slug}
          onConfirm={
            onConfirmed
              ? async () => {
                  try {
                    const result = await api.POST(
                      "/api/v1/matters/{number}/conversion-confirm/{slug}",
                      { params: { path: { number, slug } } },
                    );
                    if (!result.data) return (await problem(result)).detail;
                    onConfirmed(slug);
                    return undefined;
                  } catch {
                    return intl.formatMessage({
                      id: "conversion.confirmFailed",
                      defaultMessage: "Confirmation could not be saved. Try again.",
                    });
                  }
                }
              : undefined
          }
        />
      )}
    </div>
  );
}
