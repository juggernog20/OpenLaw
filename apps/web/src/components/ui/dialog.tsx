// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Modal dialog (DES-004: shadcn-shaped, owned source, semantic tokens
 * only). Radix supplies the dialog role, focus trap, Esc dismissal,
 * and focus restoration; only the parts the app uses are kept. The
 * surface matches card chrome: bg-raised with the default border.
 * Full-screen below md, centered overlay card at md and above
 * (DES-012, #46).
 */

import * as React from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { cn } from "../../lib/utils";

const Dialog = DialogPrimitive.Root;
const DialogClose = DialogPrimitive.Close;

function DialogContent({
  className,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Content>) {
  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/50" />
      <DialogPrimitive.Content
        className={cn(
          "fixed inset-0 z-50 overflow-y-auto bg-raised p-6 text-base text-primary md:inset-auto md:start-1/2 md:top-1/2 md:max-h-[calc(100dvh-4rem)] md:w-[calc(100%-2rem)] md:max-w-lg md:-translate-x-1/2 md:-translate-y-1/2 md:rounded-card md:border md:border-border-default md:shadow-md",
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

export { Dialog, DialogClose, DialogContent, DialogTitle };
