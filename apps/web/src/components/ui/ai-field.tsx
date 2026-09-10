// SPDX-License-Identifier: AGPL-3.0-only

import type { ReactNode } from "react";
import { cn } from "../../lib/utils";

export function AiField({
  active,
  children,
  className,
}: Readonly<{ active: boolean; children: ReactNode; className?: string }>) {
  return (
    <div className={cn("ai-field min-w-0", className)} data-ai-generated={active || undefined}>
      {children}
    </div>
  );
}
