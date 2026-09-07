// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Modal dialog (DES-004: shadcn-shaped, owned source, semantic tokens
 * only). Radix supplies the dialog role, focus trap, Esc dismissal,
 * and focus restoration; only the parts the app uses are kept. The
 * surface matches card chrome: bg-raised with the default border.
 * Full-screen below md, centered overlay card at md and above
 * (DES-012, #46).
 *
 * Modal width is modal chrome, so it follows the viewport (DES-012
 * table, "Modals"). Callers pick a `width` instead of passing
 * `md:max-w-*` in `className`. That keeps the viewport modifier in this
 * file, where lint allows it, and out of content files (#553).
 *
 * The content box is also a named container (`@container/dialog`). A
 * portal moves the dialog outside `@container/page`, so without its own
 * container the body could not use `@sm:` and friends.
 */

import * as React from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { cn } from "../../lib/utils";

const Dialog = DialogPrimitive.Root;
const DialogClose = DialogPrimitive.Close;
const DialogTrigger = DialogPrimitive.Trigger;

const DIALOG_WIDTH = {
  md: "md:max-w-md",
  lg: "md:max-w-lg",
  xl: "md:max-w-xl",
  wide: "md:max-w-5xl",
} as const;

type DialogWidth = keyof typeof DIALOG_WIDTH;

function DialogContent({
  className,
  width = "lg",
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Content> & { width?: DialogWidth }) {
  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/50" />
      <DialogPrimitive.Content
        className={cn(
          "@container/dialog fixed inset-0 z-50 overflow-y-auto bg-raised p-6 text-base text-primary md:inset-auto md:start-1/2 md:top-1/2 md:max-h-[calc(100dvh-4rem)] md:w-[calc(100%-2rem)] md:-translate-x-1/2 md:-translate-y-1/2 md:rounded-card md:border md:border-border-default md:shadow-md",
          DIALOG_WIDTH[width],
          className,
        )}
        {...props}
      />
    </DialogPrimitive.Portal>
  );
}

function DialogTitle({ className, ...props }: React.ComponentProps<typeof DialogPrimitive.Title>) {
  return <DialogPrimitive.Title className={cn("text-lg font-semibold", className)} {...props} />;
}

export { Dialog, DialogClose, DialogContent, DialogTitle, DialogTrigger };
