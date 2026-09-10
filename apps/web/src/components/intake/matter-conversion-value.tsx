// SPDX-License-Identifier: AGPL-3.0-only
/** Matter value markers backed by Conversion draft provenance (INT-008). */
import type { ReactNode } from "react";
import { api } from "../../lib/api";
import { problem } from "../../lib/problem";
import { AiField } from "../ui/ai-field";
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
  return (
    <AiField active={active} className="min-w-0">
      {children}
      {active && (
        <ConversionEvidence
          number={number}
          slug={slug}
          onConfirm={
            onConfirmed
              ? async () => {
                  const result = await api.POST(
                    "/api/v1/matters/{number}/conversion-confirm/{slug}",
                    { params: { path: { number, slug } } },
                  );
                  if (!result.data) return (await problem(result)).detail;
                  onConfirmed(slug);
                  return undefined;
                }
              : undefined
          }
        />
      )}
    </AiField>
  );
}
