// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Button (DES-004: shadcn-shaped, owned source, semantic tokens only).
 * Focus ring follows Primer's convention — 2px outline in the link blue
 * (Primer's accent), offset 2 — recorded here per DES-004's "tactical,
 * in component code" note. Hover states use brightness filters instead
 * of extra color tokens; transitions stay ≤200ms per DES-003.
 */

import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "../../lib/utils";

// 13px text throughout and a semibold CTA, matching every button in the
// contracts.pen / final-themes.pen mocks (32px tall, 12px inset, r6).
const buttonVariants = cva(
  "inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-button text-base transition-[filter,background-color] duration-150 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-link disabled:pointer-events-none disabled:opacity-50",
  {
    variants: {
      variant: {
        primary:
          "bg-cta-primary font-semibold text-on-cta hover:brightness-95 active:brightness-90",
        secondary:
          "border border-border-default bg-control font-medium text-primary hover:brightness-95 active:brightness-90",
        ghost: "font-medium text-primary hover:bg-control",
        link: "font-medium text-link underline-offset-4 hover:underline",
      },
      size: {
        default: "h-8 px-3",
        sm: "h-7 px-2",
      },
    },
    defaultVariants: {
      variant: "primary",
      size: "default",
    },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

export function Button({ className, variant, size, asChild = false, ...props }: ButtonProps) {
  const Comp = asChild ? Slot : "button";
  return <Comp className={cn(buttonVariants({ variant, size }), className)} {...props} />;
}

export { buttonVariants };
