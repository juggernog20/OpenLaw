// SPDX-License-Identifier: AGPL-3.0-only

import { createContext, useContext, useState, type ComponentPropsWithoutRef } from "react";
import { CircleHelp } from "lucide-react";
import { useIntl } from "react-intl";
import { Button } from "./ui/button";
import { Label } from "./ui/label";
import { Tooltip } from "./ui/tooltip";

const DescriptionContext = createContext<{
  descriptionId: string;
  text: string;
} | null>(null);

/** Keeps the saved description available to the input and its label's tooltip. */
export function DescribedField({
  description,
  descriptionId,
  children,
  ...props
}: Readonly<
  ComponentPropsWithoutRef<"div"> & {
    description?: string | null;
    descriptionId: string;
  }
>) {
  return (
    <DescriptionContext.Provider
      value={description?.trim() ? { descriptionId, text: description } : null}
    >
      <div {...props}>
        {children}
        {description && (
          <span id={descriptionId} className="sr-only">
            {description}
          </span>
        )}
      </div>
    </DescriptionContext.Provider>
  );
}

export function DescribedFieldLabel({
  fieldName,
  ...props
}: Readonly<ComponentPropsWithoutRef<typeof Label> & { fieldName: string }>) {
  const description = useContext(DescriptionContext);
  const intl = useIntl();
  const [open, setOpen] = useState(false);
  if (!description) return <Label {...props} />;
  return (
    <div className="flex items-center gap-1">
      <Label {...props} />
      <Tooltip
        content={description.text}
        className="whitespace-pre-wrap break-words"
        open={open}
        onOpenChange={setOpen}
      >
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="-my-1 shrink-0 cursor-help text-muted"
          aria-label={intl.formatMessage(
            { id: "fields.descriptionFor", defaultMessage: "Show description for {field}" },
            { field: fieldName },
          )}
          aria-describedby={description.descriptionId}
          onClick={(event) => {
            event.preventDefault();
            setOpen(true);
          }}
        >
          <CircleHelp size={16} aria-hidden="true" />
        </Button>
      </Tooltip>
    </div>
  );
}
