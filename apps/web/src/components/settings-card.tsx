// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The card chrome every settings pane shares (ST1/ST4 mocks): a Card
 * with the section-header strip on top. One definition, so the header
 * height and pane width stay identical across panes — both dimensions
 * come from the chrome-dimension tokens in globals.css.
 */

import type { ReactNode } from "react";
import { cn } from "../lib/utils";
import { Card } from "./ui/card";

export function SettingsCard({
  title,
  actions,
  flush = false,
  className,
  children,
}: Readonly<{
  title: ReactNode;
  /** Right-aligned header controls (filters, a primary action). */
  actions?: ReactNode;
  /** Edge-to-edge body for content that owns its gutters (tables). */
  flush?: boolean;
  className?: string;
  children: ReactNode;
}>) {
  return (
    <Card className={cn("w-full max-w-(--width-settings-card)", className)}>
      <div
        className={cn(
          "flex h-section-header items-center rounded-t-card border-b border-border-default bg-section-header px-4",
          actions && "justify-between",
        )}
      >
        <h2 className="text-base font-semibold">{title}</h2>
        {actions}
      </div>
      {flush ? children : <div className="flex flex-col gap-4 p-4">{children}</div>}
    </Card>
  );
}
