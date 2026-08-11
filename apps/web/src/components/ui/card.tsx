// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Card (DES-004: shadcn-shaped, owned source). Border-only elevation —
 * DES-003 rules out shadows; bg-raised is the card surface tier.
 */

import * as React from "react";
import { cn } from "../../lib/utils";

export function Card({ className, ...props }: Readonly<React.HTMLAttributes<HTMLDivElement>>) {
  return (
    <div
      className={cn("rounded-card border border-border-default bg-raised", className)}
      {...props}
    />
  );
}

export function CardHeader({
  className,
  ...props
}: Readonly<React.HTMLAttributes<HTMLDivElement>>) {
  return <div className={cn("flex flex-col gap-1 p-6 pb-0", className)} {...props} />;
}

export function CardTitle({
  className,
  children,
  ...props
}: Readonly<React.HTMLAttributes<HTMLHeadingElement> & { children: React.ReactNode }>) {
  return (
    <h1 className={cn("text-xl font-semibold", className)} {...props}>
      {children}
    </h1>
  );
}

export function CardDescription({
  className,
  ...props
}: Readonly<React.HTMLAttributes<HTMLParagraphElement>>) {
  return <p className={cn("text-md text-muted", className)} {...props} />;
}

export function CardContent({
  className,
  ...props
}: Readonly<React.HTMLAttributes<HTMLDivElement>>) {
  return <div className={cn("p-6", className)} {...props} />;
}

export function CardFooter({
  className,
  ...props
}: Readonly<React.HTMLAttributes<HTMLDivElement>>) {
  return <div className={cn("flex items-center p-6 pt-0", className)} {...props} />;
}
