// SPDX-License-Identifier: AGPL-3.0-only

/** DES-088's Share classes dialog: list, create, edit, archive (ENT-011). */
import { useState } from "react";
import { FormattedMessage, useIntl } from "react-intl";
import { Archive, Pencil } from "lucide-react";
import { api } from "../../lib/api";
import { currencyFractionDigits, toMajorUnits, toMinorUnits } from "../../lib/format";
import { problem } from "../../lib/problem";
import type { ShareClass, ShareClassBody } from "../../lib/share-register";
import { CurrencySelect } from "../currency-select";
import { NumberInput } from "../number-input";
import { Button } from "../ui/button";
import { Dialog, DialogContent, DialogTitle } from "../ui/dialog";
import { Input } from "../ui/input";
import { Label } from "../ui/label";

type Draft = {
  name: string;
  authorized: string;
  parValue: string;
  parValueCurrency: string;
  votesPerShare: string;
  rights: string;
};

const EMPTY: Draft = {
  name: "",
  authorized: "",
  parValue: "",
  parValueCurrency: "",
  votesPerShare: "1",
  rights: "",
};

function draftOf(shareClass: ShareClass): Draft {
  return {
    name: shareClass.name,
    authorized: shareClass.authorized === null ? "" : String(shareClass.authorized),
    parValue:
      shareClass.parValue === null || !shareClass.parValueCurrency
        ? ""
        : String(toMajorUnits(shareClass.parValue, shareClass.parValueCurrency)),
    parValueCurrency: shareClass.parValueCurrency ?? "",
    votesPerShare: String(shareClass.votesPerShare),
    rights: shareClass.rights ?? "",
  };
}

export function ShareClassesDialog({
  entityId,
  classes,
  frozen,
  onOpenChange,
  onChanged,
}: Readonly<{
  entityId: string;
  classes: readonly ShareClass[];
  frozen: boolean;
  onOpenChange: (open: boolean) => void;
  /** The register changed on the server; the tab re-reads it. */
  onChanged: () => void;
}>) {
  const intl = useIntl();
  const [editing, setEditing] = useState<ShareClass | "new" | null>(
    classes.length === 0 ? "new" : null,
  );
  const [draft, setDraft] = useState<Draft>(EMPTY);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const live = classes.filter((row) => row.archivedAt === null);

  function start(target: ShareClass | "new") {
    setEditing(target);
    setDraft(target === "new" ? EMPTY : draftOf(target));
    setError(null);
  }

  function body(): ShareClassBody | null {
    const name = draft.name.trim();
    if (!name) {
      setError(
        intl.formatMessage({
          id: "entities.register.classes.nameRequired",
          defaultMessage: "Give the class a name.",
        }),
      );
      return null;
    }
    const whole = (value: string) => {
      const trimmed = value.trim();
      if (!trimmed) return null;
      if (!/^\d+$/.test(trimmed)) return undefined;
      return Number(trimmed);
    };
    const authorized = whole(draft.authorized);
    if (authorized === undefined) {
      setError(
        intl.formatMessage({
          id: "entities.register.wholeNumber",
          defaultMessage: "Enter a whole number of zero or more.",
        }),
      );
      return null;
    }
    let parValue: number | null = null;
    if (draft.parValue.trim()) {
      if (!draft.parValueCurrency) {
        setError(
          intl.formatMessage({
            id: "entities.register.classes.currencyRequired",
            defaultMessage: "Pick the par value's currency.",
          }),
        );
        return null;
      }
      const amount = Number(draft.parValue);
      const digits = currencyFractionDigits(draft.parValueCurrency);
      const fraction = draft.parValue.split(".")[1]?.replace(/0+$/, "").length ?? 0;
      if (!/^\d+(?:\.\d*)?$/.test(draft.parValue.trim()) || fraction > digits) {
        setError(
          intl.formatMessage(
            {
              id: "entities.record.shareCapital.invalidAmount",
              defaultMessage: "Enter a non-negative amount with up to {digits} decimal places.",
            },
            { digits },
          ),
        );
        return null;
      }
      parValue = toMinorUnits(amount, draft.parValueCurrency);
    }
    const votes = Number(draft.votesPerShare);
    if (!draft.votesPerShare.trim() || !Number.isFinite(votes) || votes < 0) {
      setError(
        intl.formatMessage({
          id: "entities.register.classes.votesInvalid",
          defaultMessage: "Votes per share must be zero or more.",
        }),
      );
      return null;
    }
    return {
      name,
      authorized,
      parValue,
      parValueCurrency: parValue === null ? null : draft.parValueCurrency,
      votesPerShare: votes,
      rights: draft.rights.trim() || null,
    };
  }

  async function save() {
    const payload = body();
    if (!payload || editing === null) return;
    setBusy(true);
    setError(null);
    const result =
      editing === "new"
        ? await api
            .POST("/api/v1/entities/{id}/share-classes", {
              params: { path: { id: entityId } },
              body: payload,
            })
            .catch(() => undefined)
        : await api
            .PATCH("/api/v1/entities/{id}/share-classes/{classId}", {
              params: { path: { id: entityId, classId: editing.id } },
              body: payload,
            })
            .catch(() => undefined);
    setBusy(false);
    if (!result?.data) {
      setError(
        (await problem(result)).detail ??
          intl.formatMessage({
            id: "entities.register.classes.saveError",
            defaultMessage: "The share class could not be saved.",
          }),
      );
      return;
    }
    setEditing(null);
    onChanged();
  }

  async function archive(shareClass: ShareClass) {
    setBusy(true);
    setError(null);
    const result = await api
      .DELETE("/api/v1/entities/{id}/share-classes/{classId}", {
        params: { path: { id: entityId, classId: shareClass.id } },
      })
      .catch(() => undefined);
    setBusy(false);
    if (!result?.response.ok) {
      setError(
        (await problem(result)).detail ??
          intl.formatMessage({
            id: "entities.register.classes.archiveError",
            defaultMessage: "The share class could not be archived.",
          }),
      );
      return;
    }
    onChanged();
  }

  const set = <K extends keyof Draft>(key: K, value: Draft[K]) =>
    setDraft((current) => ({ ...current, [key]: value }));

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent aria-describedby={undefined} className="max-w-xl">
        <DialogTitle>
          <FormattedMessage id="entities.register.classes.title" defaultMessage="Share classes" />
        </DialogTitle>
        <div className="mt-4 flex flex-col gap-4">
          {live.length > 0 && (
            <ul className="divide-y divide-border-default rounded-card border border-border-default">
              {live.map((shareClass) => (
                <li key={shareClass.id} className="flex items-center gap-3 px-3 py-2">
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium">{shareClass.name}</p>
                    <p className="text-xs text-muted">
                      <FormattedMessage
                        id="entities.register.classes.summary"
                        defaultMessage="{authorized} authorized · {votes} {votes, plural, one {vote} other {votes}} per share · {entries} {entries, plural, one {entry} other {entries}}"
                        values={{
                          authorized:
                            shareClass.authorized === null
                              ? intl.formatMessage({
                                  id: "entities.register.classes.noAuthorized",
                                  defaultMessage: "no cap",
                                })
                              : intl.formatNumber(shareClass.authorized),
                          votes: shareClass.votesPerShare,
                          entries: shareClass.entryCount,
                        }}
                      />
                    </p>
                  </div>
                  <Button
                    variant="ghost"
                    size="icon"
                    disabled={frozen || busy}
                    aria-label={intl.formatMessage(
                      { id: "entities.register.classes.edit", defaultMessage: "Edit {name}" },
                      { name: shareClass.name },
                    )}
                    onClick={() => start(shareClass)}
                  >
                    <Pencil size={16} aria-hidden="true" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    disabled={frozen || busy || shareClass.entryCount > 0}
                    title={
                      shareClass.entryCount > 0
                        ? intl.formatMessage({
                            id: "entities.register.classes.inUse",
                            defaultMessage: "This class has register entries.",
                          })
                        : undefined
                    }
                    aria-label={intl.formatMessage(
                      { id: "entities.register.classes.archive", defaultMessage: "Archive {name}" },
                      { name: shareClass.name },
                    )}
                    onClick={() => void archive(shareClass)}
                  >
                    <Archive size={16} aria-hidden="true" />
                  </Button>
                </li>
              ))}
            </ul>
          )}
          {editing === null ? (
            <div>
              <Button variant="secondary" disabled={frozen} onClick={() => start("new")}>
                <FormattedMessage
                  id="entities.register.classes.new"
                  defaultMessage="New share class"
                />
              </Button>
            </div>
          ) : (
            <form
              className="flex flex-col gap-3 rounded-card border border-border-default bg-section-header p-3"
              onSubmit={(event) => {
                event.preventDefault();
                void save();
              }}
            >
              <p className="text-sm font-semibold">
                {editing === "new" ? (
                  <FormattedMessage
                    id="entities.register.classes.new"
                    defaultMessage="New share class"
                  />
                ) : (
                  <FormattedMessage
                    id="entities.register.classes.editing"
                    defaultMessage="Edit {name}"
                    values={{ name: editing.name }}
                  />
                )}
              </p>
              <fieldset disabled={busy || frozen} className="contents">
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="share-class-name" required>
                    <FormattedMessage id="entities.register.classes.name" defaultMessage="Name" />
                  </Label>
                  <Input
                    id="share-class-name"
                    autoFocus
                    maxLength={100}
                    value={draft.name}
                    onChange={(event) => set("name", event.target.value)}
                  />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor="share-class-authorized">
                      <FormattedMessage
                        id="entities.register.classes.authorized"
                        defaultMessage="Authorized shares"
                      />
                    </Label>
                    <NumberInput
                      id="share-class-authorized"
                      inputMode="numeric"
                      value={draft.authorized}
                      onValueChange={(value) => set("authorized", value)}
                    />
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor="share-class-votes">
                      <FormattedMessage
                        id="entities.register.classes.votes"
                        defaultMessage="Votes per share"
                      />
                    </Label>
                    <NumberInput
                      id="share-class-votes"
                      inputMode="decimal"
                      value={draft.votesPerShare}
                      onValueChange={(value) => set("votesPerShare", value)}
                    />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor="share-class-par">
                      <FormattedMessage
                        id="entities.register.classes.parValue"
                        defaultMessage="Par value"
                      />
                    </Label>
                    <NumberInput
                      id="share-class-par"
                      inputMode="decimal"
                      value={draft.parValue}
                      onValueChange={(value) => set("parValue", value)}
                    />
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor="share-class-currency">
                      <FormattedMessage
                        id="entities.register.classes.currency"
                        defaultMessage="Currency"
                      />
                    </Label>
                    <CurrencySelect
                      id="share-class-currency"
                      value={draft.parValueCurrency}
                      onValueChange={(code) => set("parValueCurrency", code)}
                    />
                  </div>
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="share-class-rights">
                    <FormattedMessage
                      id="entities.register.classes.rights"
                      defaultMessage="Rights summary"
                    />
                  </Label>
                  <Input
                    id="share-class-rights"
                    maxLength={500}
                    placeholder={intl.formatMessage({
                      id: "entities.register.classes.rightsHint",
                      defaultMessage: "1 vote per share · converts 1:1 · 1× non-participating",
                    })}
                    value={draft.rights}
                    onChange={(event) => set("rights", event.target.value)}
                  />
                </div>
              </fieldset>
              {error ? (
                <p role="alert" className="text-sm text-status-danger-fg">
                  {error}
                </p>
              ) : null}
              <div className="flex justify-end gap-2">
                <Button
                  type="button"
                  variant="secondary"
                  disabled={busy}
                  onClick={() => (live.length === 0 ? onOpenChange(false) : setEditing(null))}
                >
                  <FormattedMessage id="common.cancel" defaultMessage="Cancel" />
                </Button>
                <Button type="submit" disabled={busy || frozen}>
                  <FormattedMessage id="common.save" defaultMessage="Save" />
                </Button>
              </div>
            </form>
          )}
          {error && editing === null ? (
            <p role="alert" className="text-sm text-status-danger-fg">
              {error}
            </p>
          ) : null}
        </div>
      </DialogContent>
    </Dialog>
  );
}
