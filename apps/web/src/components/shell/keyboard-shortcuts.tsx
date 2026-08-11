// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The `?` cheat-sheet from DES-010: a pure rendering of KEY_MAP, so
 * the listed shortcuts cannot drift from the registered handlers.
 * Copy follows the DES-015 register — terse, sentence case.
 */

import { X } from "lucide-react";
import { FormattedMessage, useIntl } from "react-intl";
import { KEY_MAP } from "../../lib/keyboard";
import { Dialog, DialogClose, DialogContent, DialogTitle } from "../ui/dialog";

export function KeyboardShortcutsDialog({
  open,
  onOpenChange,
}: Readonly<{
  open: boolean;
  onOpenChange: (open: boolean) => void;
}>) {
  const intl = useIntl();
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {/* No prose description: the list is the content. */}
      <DialogContent aria-describedby={undefined}>
        <DialogTitle>
          <FormattedMessage id="keys.title" defaultMessage="Keyboard shortcuts" />
        </DialogTitle>
        <DialogClose
          aria-label={intl.formatMessage({ id: "dialog.close", defaultMessage: "Close" })}
          className="absolute end-4 top-4 rounded-chip p-1 text-muted hover:text-primary"
        >
          <X size={16} aria-hidden="true" />
        </DialogClose>
        {KEY_MAP.map((section) => (
          <section key={section.title.id} className="mt-4">
            <h3 className="text-sm font-semibold text-muted">
              {intl.formatMessage(section.title)}
            </h3>
            <dl className="mt-1">
              {section.bindings.map((binding) => (
                <div
                  key={binding.description.id}
                  className="flex items-center justify-between gap-4 py-1.5"
                >
                  <dt>{intl.formatMessage(binding.description)}</dt>
                  <dd className="flex shrink-0 gap-1">
                    {binding.keys.map((key) => (
                      <kbd
                        key={key}
                        className="flex h-5 min-w-6 items-center justify-center rounded-chip border border-border-default px-1 text-xs font-semibold text-muted"
                      >
                        {key}
                      </kbd>
                    ))}
                  </dd>
                </div>
              ))}
            </dl>
          </section>
        ))}
      </DialogContent>
    </Dialog>
  );
}
