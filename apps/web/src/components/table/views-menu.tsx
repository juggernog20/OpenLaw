// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The saved-views control (DES-046 clause 6, DD-019).
 *
 * A labelled ghost button in the page sub-bar, naming the active view or
 * "Default view", opening a menu of this person's views and the acts on
 * them.
 *
 * **Saving is an act, and the button says when there is one to make**
 * (DD-019 clause 5). Dragging a column changes the list and nothing on the
 * server; when the layout on screen differs from what the active view
 * stores, the trigger carries a "Modified" line and the menu grows a Save.
 * That is what keeps a curated view safe from a fiddle.
 *
 * **Views are private** (clause 1), so nothing here asks who may see one.
 * The menu is one person's list, and its only refusals are a name they
 * already used and the ceiling on how many they keep.
 */

import { useState } from "react";
import { FormattedMessage, useIntl } from "react-intl";
import { ChevronDown } from "lucide-react";
import { MAX_LIST_VIEW_NAME_LENGTH } from "@openlaw/shared";
import type { SavedView } from "../../lib/list-views";
import { problemDetail } from "../../lib/messages";
import { Button } from "../ui/button";
import { Dialog, DialogContent, DialogTitle } from "../ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "../ui/dropdown-menu";
import { Input } from "../ui/input";
import { Label } from "../ui/label";

/** Which small dialog is open, if any. */
type Prompt = { kind: "saveAs" | "rename" } | { kind: "delete"; view: SavedView } | null;

export function ViewsMenu({
  views,
  activeView,
  modified,
  onSelect,
  onSave,
  onSaveAs,
  onRename,
  onSetDefault,
  onDelete,
  onReset,
  busy,
}: Readonly<{
  views: readonly SavedView[];
  /** The view the list is reading, or null for the built-in layout. */
  activeView: SavedView | null;
  /** The layout on screen differs from what the active view stores. */
  modified: boolean;
  onSelect: (view: SavedView | null) => void;
  onSave: () => Promise<void>;
  onSaveAs: (name: string) => Promise<void>;
  onRename: (name: string) => Promise<void>;
  onSetDefault: () => Promise<void>;
  onDelete: (view: SavedView) => Promise<void>;
  /** Back to the built-in layout, without touching any saved view. */
  onReset: () => void;
  busy: boolean;
}>) {
  const intl = useIntl();
  const [prompt, setPrompt] = useState<Prompt>(null);
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [working, setWorking] = useState(false);

  const label =
    activeView?.name ?? intl.formatMessage({ id: "views.builtIn", defaultMessage: "Default view" });

  /** Run one act, keeping its refusal on the dialog that asked for it —
   * a name already in use is answered where the name was typed. */
  async function run(act: () => Promise<void>, close: boolean) {
    setError(null);
    setWorking(true);
    try {
      await act();
      if (close) setPrompt(null);
    } catch (caught) {
      setError(
        problemDetail(caught) ??
          intl.formatMessage({
            id: "views.error",
            defaultMessage: "The view could not be saved. Try again.",
          }),
      );
    } finally {
      setWorking(false);
    }
  }

  function open(kind: "saveAs" | "rename") {
    setError(null);
    setName(
      kind === "rename"
        ? (activeView?.name ?? "")
        : // A fork starts from the name it forked, because that is what
          // the reader was looking at when they decided to keep it.
          intl.formatMessage(
            { id: "views.copyOf", defaultMessage: "{name} copy" },
            { name: label },
          ),
    );
    setPrompt({ kind });
  }

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" className="h-8 gap-1.5">
            <span className="flex flex-col items-start leading-tight">
              <span className="truncate">{label}</span>
              {modified && (
                <span className="text-xs font-normal text-muted">
                  <FormattedMessage id="views.modified" defaultMessage="Modified" />
                </span>
              )}
            </span>
            <ChevronDown size={16} aria-hidden="true" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="min-w-56">
          <DropdownMenuLabel className="text-sm font-medium text-muted">
            <FormattedMessage id="views.label" defaultMessage="Views" />
          </DropdownMenuLabel>
          <DropdownMenuRadioGroup
            value={activeView?.id ?? ""}
            onValueChange={(value) => onSelect(views.find((view) => view.id === value) ?? null)}
          >
            <DropdownMenuRadioItem value="">
              <FormattedMessage id="views.builtIn" defaultMessage="Default view" />
            </DropdownMenuRadioItem>
            {views.map((view) => (
              <DropdownMenuRadioItem key={view.id} value={view.id}>
                <span className="truncate">{view.name}</span>
                {view.isDefault && (
                  <span className="ms-auto shrink-0 text-xs text-muted">
                    <FormattedMessage id="views.defaultMarker" defaultMessage="Opens here" />
                  </span>
                )}
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
          <DropdownMenuSeparator />
          {/* Save appears only when there is a change to save (DD-019
              clause 5): a Save that would write what is already stored is
              a button that does nothing. */}
          {activeView && modified && (
            <DropdownMenuItem disabled={busy} onSelect={() => void run(onSave, false)}>
              <FormattedMessage id="views.save" defaultMessage="Save" />
            </DropdownMenuItem>
          )}
          <DropdownMenuItem disabled={busy} onSelect={() => open("saveAs")}>
            <FormattedMessage id="views.saveAs" defaultMessage="Save as…" />
          </DropdownMenuItem>
          {activeView && (
            <>
              <DropdownMenuItem disabled={busy} onSelect={() => open("rename")}>
                <FormattedMessage id="views.rename" defaultMessage="Rename…" />
              </DropdownMenuItem>
              {!activeView.isDefault && (
                <DropdownMenuItem disabled={busy} onSelect={() => void run(onSetDefault, false)}>
                  <FormattedMessage id="views.setDefault" defaultMessage="Set as default" />
                </DropdownMenuItem>
              )}
              <DropdownMenuItem
                disabled={busy}
                onSelect={() => {
                  setError(null);
                  setPrompt({ kind: "delete", view: activeView });
                }}
              >
                <FormattedMessage id="views.delete" defaultMessage="Delete…" />
              </DropdownMenuItem>
            </>
          )}
          {modified && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={() => onReset()}>
                <FormattedMessage id="views.discard" defaultMessage="Discard unsaved changes" />
              </DropdownMenuItem>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      {prompt?.kind === "saveAs" || prompt?.kind === "rename" ? (
        <NameDialog
          kind={prompt.kind}
          name={name}
          error={error}
          busy={working}
          onNameChange={setName}
          onClose={() => setPrompt(null)}
          onConfirm={() =>
            void run(
              () => (prompt.kind === "rename" ? onRename(name.trim()) : onSaveAs(name.trim())),
              true,
            )
          }
        />
      ) : null}

      {prompt?.kind === "delete" ? (
        <Dialog open onOpenChange={(next) => !next && setPrompt(null)}>
          <DialogContent aria-describedby={undefined} width="md">
            <DialogTitle>
              <FormattedMessage id="views.delete.title" defaultMessage="Delete this view?" />
            </DialogTitle>
            <p className="mt-2 text-base text-muted">
              <FormattedMessage
                id="views.delete.body"
                defaultMessage="{name} is removed. The contracts in it are not touched."
                values={{ name: prompt.view.name }}
              />
            </p>
            {error && (
              <p role="alert" className="mt-3 text-sm text-status-danger-fg">
                {error}
              </p>
            )}
            <div className="mt-6 flex justify-end gap-2">
              <Button variant="secondary" onClick={() => setPrompt(null)}>
                <FormattedMessage id="action.cancel" defaultMessage="Cancel" />
              </Button>
              <Button
                variant="danger"
                disabled={working}
                onClick={() => void run(() => onDelete(prompt.view), true)}
              >
                <FormattedMessage id="action.delete" defaultMessage="Delete" />
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      ) : null}
    </>
  );
}

/** Save as and Rename ask the same question, so they are one dialog with
 * two titles and two verbs. */
function NameDialog({
  kind,
  name,
  error,
  busy,
  onNameChange,
  onClose,
  onConfirm,
}: Readonly<{
  kind: "saveAs" | "rename";
  name: string;
  error: string | null;
  busy: boolean;
  onNameChange: (next: string) => void;
  onClose: () => void;
  onConfirm: () => void;
}>) {
  return (
    <Dialog open onOpenChange={(next) => !next && onClose()}>
      <DialogContent aria-describedby={undefined} width="md">
        <DialogTitle>
          {kind === "rename" ? (
            <FormattedMessage id="views.rename.title" defaultMessage="Rename this view" />
          ) : (
            <FormattedMessage id="views.saveAs.title" defaultMessage="Save this view" />
          )}
        </DialogTitle>
        <form
          className="mt-4 flex flex-col gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            onConfirm();
          }}
        >
          <Label htmlFor="view-name">
            <FormattedMessage id="views.name" defaultMessage="Name" />
          </Label>
          <Input
            id="view-name"
            value={name}
            maxLength={MAX_LIST_VIEW_NAME_LENGTH}
            autoFocus
            onChange={(event) => onNameChange(event.target.value)}
          />
          {error && (
            <p role="alert" className="text-sm text-status-danger-fg">
              {error}
            </p>
          )}
          <div className="mt-4 flex justify-end gap-2">
            <Button type="button" variant="secondary" onClick={onClose}>
              <FormattedMessage id="action.cancel" defaultMessage="Cancel" />
            </Button>
            <Button type="submit" disabled={busy || name.trim() === ""}>
              {kind === "rename" ? (
                <FormattedMessage id="action.rename" defaultMessage="Rename" />
              ) : (
                <FormattedMessage id="action.save" defaultMessage="Save" />
              )}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
