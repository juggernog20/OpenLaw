// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Per-page sub-bar, from the sub frame of final-themes.pen: 64px strip
 * on the canvas surface with the page-x gutter, page title (the page's
 * h1) with an optional summary line leading, page actions trailing.
 * Below md the bar simplifies to title plus primary action (DES-012,
 * #46): the summary line and secondary actions wait for md.
 */

import type { ReactNode } from "react";

export function PageSubBar({
  title,
  subtitle,
  primaryAction,
  actions,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  /** The page's one main action; stays visible below md. */
  primaryAction?: ReactNode;
  /** Secondary actions; hidden below md. */
  actions?: ReactNode;
}) {
  return (
    <div className="flex h-(--height-subbar) shrink-0 items-center justify-between gap-4 border-b border-(--chrome-subbar-border) bg-canvas px-page-x">
      <div className="flex min-w-0 flex-col gap-0.5">
        <h1 className="truncate text-xl font-semibold">{title}</h1>
        {subtitle ? (
          <p className="hidden truncate text-base text-muted md:block">{subtitle}</p>
        ) : null}
      </div>
      {primaryAction || actions ? (
        <div className="flex shrink-0 items-center gap-2">
          {actions ? <div className="hidden items-center gap-2 md:flex">{actions}</div> : null}
          {primaryAction}
        </div>
      ) : null}
    </div>
  );
}
