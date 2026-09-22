// SPDX-License-Identifier: AGPL-3.0-only

/** INT-002 and DES-011 labels and local attachment controls shared by intake and preview. */
import { useRef, useState } from "react";
import { defineMessage, FormattedMessage, useIntl, type MessageDescriptor } from "react-intl";
import { Upload, X } from "lucide-react";
import { MAX_REQUEST_ATTACHMENTS } from "../../lib/requests";
import { formatFileSize } from "../../lib/format";
import { FileTile, FileTileGrid, TILE_ACTION_CLASS } from "../documents/file-tiles";
import { Button } from "../ui/button";
import { Label } from "../ui/label";
import { DescribedField } from "../described-field";

export function Field({
  htmlFor,
  label,
  required = false,
  description,
  unanswered = false,
  children,
}: Readonly<{
  htmlFor: string;
  label: string;
  required?: boolean;
  description?: string | null;
  unanswered?: boolean;
  children: React.ReactNode;
}>) {
  return (
    <DescribedField
      description={description}
      descriptionId={`${htmlFor}-help`}
      className="flex flex-col gap-1.5"
    >
      <Label htmlFor={htmlFor}>
        {label}
        {required && (
          <>
            <span aria-hidden="true" className="ms-0.5 text-status-danger-fg">
              *
            </span>
            <span className="sr-only">
              <FormattedMessage id="portal.form.requiredMark" defaultMessage="(required)" />
            </span>
          </>
        )}
      </Label>
      {children}
      {unanswered && (
        <p className="text-xs text-status-danger-fg">
          <FormattedMessage
            id="portal.form.fieldRequired"
            defaultMessage="{field} is required."
            values={{ field: label }}
          />
        </p>
      )}
    </DescribedField>
  );
}

/**
 * The Attachments basic: I6's dropzone, the files it has been given, and
 * a way to take one back.
 *
 * The input itself is out of the tab order and out of sight. A keyboard
 * reaches the button beside it, and a second stop on an invisible input
 * is a trap rather than an affordance — the documents composer's rule,
 * applied to the one picker the portal draws. The label still points at
 * the input, so clicking the word opens the picker.
 *
 * Nothing here is marked required and nothing here can refuse: the
 * fourth basic is optional (INT-002), and any file type is accepted
 * because the seam stores whatever a requester is asking Legal about.
 */
export function AttachmentsField({
  files,
  onFiles,
}: Readonly<{ files: readonly File[]; onFiles: (files: readonly File[]) => void }>) {
  const intl = useIntl();
  const picker = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  /** Set when a pick or a drop carried more than there was room for. */
  const [overflowed, setOverflowed] = useState(false);

  function add(chosen: readonly File[]) {
    if (chosen.length === 0) return;
    // The seam refuses a file past the bound, so the picker says so
    // first: a requester who queued thirty files should not learn it
    // ten refusals into a submission. What fits is kept.
    const room = MAX_REQUEST_ATTACHMENTS - files.length;
    setOverflowed(chosen.length > room);
    if (room > 0) onFiles([...files, ...chosen.slice(0, room)]);
  }

  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor="request-attachments">
        <FormattedMessage id="portal.form.attachments" defaultMessage="Attachments" />
      </Label>
      <div
        className={`flex flex-col items-center justify-center gap-2 rounded-card border border-dashed bg-control px-4 py-6 transition-colors duration-150 ${
          over ? "border-link" : "border-border-strong"
        }`}
        onDragOver={(event) => {
          event.preventDefault();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(event) => {
          event.preventDefault();
          setOver(false);
          add([...event.dataTransfer.files]);
        }}
      >
        <input
          ref={picker}
          id="request-attachments"
          type="file"
          multiple
          className="sr-only"
          tabIndex={-1}
          onChange={(event) => {
            add([...(event.target.files ?? [])]);
            // Cleared so picking the same file twice in a row still
            // fires a change — the browser answers nothing otherwise,
            // and a requester who removed a file by mistake could not
            // put it back.
            event.target.value = "";
          }}
        />
        {files.length > 0 && (
          <FileTileGrid className="pb-3">
            {files.map((file, index) => (
              <FileTile
                key={`${String(index)}-${file.name}`}
                filename={file.name}
                caption={formatFileSize(file.size, { locale: intl.locale })}
                action={
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className={TILE_ACTION_CLASS}
                    title={intl.formatMessage(REMOVE_ATTACHMENT, { filename: file.name })}
                    onClick={() => {
                      setOverflowed(false);
                      onFiles(files.filter((_ignored, at) => at !== index));
                    }}
                  >
                    <X aria-hidden="true" className="size-3.5" />
                    <span className="sr-only">
                      <FormattedMessage {...REMOVE_ATTACHMENT} values={{ filename: file.name }} />
                    </span>
                  </Button>
                }
              />
            ))}
          </FileTileGrid>
        )}
        {files.length === 0 && <Upload aria-hidden="true" className="size-5 shrink-0 text-muted" />}
        <p className="max-w-prose text-center text-sm text-muted">
          <FormattedMessage
            id="portal.form.attachmentsHint"
            defaultMessage="Drop up to {max} files related to your request here."
            values={{ max: MAX_REQUEST_ATTACHMENTS }}
          />
        </p>
        <Button type="button" variant="secondary" size="sm" onClick={() => picker.current?.click()}>
          <FormattedMessage id="portal.form.attachmentsBrowse" defaultMessage="Choose files" />
        </Button>
      </div>
      {overflowed && (
        <p role="alert" className="text-xs text-status-danger-fg">
          <FormattedMessage
            id="portal.form.attachmentsTooMany"
            defaultMessage="A request carries at most {max} files."
            values={{ max: MAX_REQUEST_ATTACHMENTS }}
          />
        </p>
      )}
    </div>
  );
}

/** Said once: the row's accessible name and its tooltip are the same
 * sentence, and two spellings would be two controls. */
const REMOVE_ATTACHMENT: MessageDescriptor = defineMessage({
  id: "portal.form.attachmentRemove",
  defaultMessage: "Remove {filename}",
});
