// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Per-page sub-bar, from the sub frame of final-themes.pen: 64px strip
 * on the canvas surface with the page-x gutter, page title (the page's
 * h1) with an optional summary line leading, page actions trailing.
 */

import type { ReactNode } from "react";

export function PageSubBar({
  title,
  subtitle,
  actions,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className="flex h-(--height-subbar) shrink-0 items-center justify-between gap-4 border-b border-(--chrome-subbar-border) bg-canvas px-page-x">
      <div className="flex min-w-0 flex-col gap-0.5">
        <h1 className="text-xl font-semibold">{title}</h1>
        {subtitle ? <p className="truncate text-base text-muted">{subtitle}</p> : null}
      </div>
      {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
    </div>
  );
}
