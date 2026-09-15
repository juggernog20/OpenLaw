// SPDX-License-Identifier: AGPL-3.0-only

/** Edits Auto-Doc title patterns and inserts variables from the form (ADO-005). */

import { useRef, useState, type KeyboardEventHandler } from "react";
import { Zap } from "lucide-react";
import { FormattedMessage, useIntl } from "react-intl";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "../ui/dropdown-menu";

export function TitlePatternInput({
  id,
  value,
  fields,
  onChange,
  onBlur,
  onKeyDown,
}: {
  id: string;
  value: string;
  fields: readonly { slug: string; label: string }[];
  onChange: (value: string) => void;
  onBlur: () => void;
  onKeyDown: KeyboardEventHandler<HTMLInputElement>;
}) {
  const intl = useIntl();
  const input = useRef<HTMLInputElement>(null);
  const [selection, setSelection] = useState<{ start: number; end: number } | null>(null);
  const [open, setOpen] = useState(false);
  const menuOpen = useRef(false);
  const start = Math.min(selection?.start ?? value.length, value.length);
  const end = Math.min(selection?.end ?? value.length, value.length);

  return (
    <div
      className="relative"
      onBlur={(event) => {
        if (!menuOpen.current && !event.currentTarget.contains(event.relatedTarget)) onBlur();
      }}
    >
      <Input
        ref={input}
        id={id}
        className="pe-9"
        maxLength={2000}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        onSelect={(event) => {
          setSelection({
            start: event.currentTarget.selectionStart ?? value.length,
            end: event.currentTarget.selectionEnd ?? value.length,
          });
        }}
        onKeyDown={onKeyDown}
      />
      <DropdownMenu
        open={open}
        onOpenChange={(next) => {
          menuOpen.current = next;
          setOpen(next);
        }}
      >
        <DropdownMenuTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="absolute end-1 top-1"
            aria-label={intl.formatMessage({
              id: "autoDocs.insertTitleVariable",
              defaultMessage: "Insert title variable",
            })}
          >
            <Zap size={16} aria-hidden="true" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="end"
          className="max-h-64 overflow-y-auto"
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            input.current?.focus();
            if (selection) input.current?.setSelectionRange(selection.start, selection.end);
          }}
        >
          {fields.length ? (
            fields.map((field) => {
              const token = `{{${field.slug}}}`;
              return (
                <DropdownMenuItem
                  key={field.slug}
                  disabled={value.length - (end - start) + token.length > 2000}
                  onSelect={() => {
                    onChange(value.slice(0, start) + token + value.slice(end));
                    setSelection({ start: start + token.length, end: start + token.length });
                  }}
                >
                  {field.label}
                </DropdownMenuItem>
              );
            })
          ) : (
            <DropdownMenuItem disabled>
              <FormattedMessage
                id="autoDocs.noTitleVariables"
                defaultMessage="Add form fields to make variables available."
              />
            </DropdownMenuItem>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
