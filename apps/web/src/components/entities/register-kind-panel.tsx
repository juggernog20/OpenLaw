// SPDX-License-Identifier: AGPL-3.0-only
import { useState } from "react";
import { Link, useRevalidator } from "react-router";
import { FormattedMessage, useIntl } from "react-intl";
import { api } from "../../lib/api";
import { problem } from "../../lib/problem";
import type { EntityRecordRow, EntityRow } from "../../lib/entities";
import {
  REGISTER_KINDS,
  registerKindLabels,
  registerKindDescriptions,
  type RegisterKind,
} from "../../lib/register-kind";
import { CONTROL_CLASS } from "../../lib/form-controls";
import { Button } from "../ui/button";
import { Dialog, DialogContent, DialogTitle } from "../ui/dialog";
import { Label } from "../ui/label";

export function RegisterKindPanel({
  entity,
  candidates,
  onSaved,
}: {
  entity: EntityRecordRow;
  candidates: EntityRow[];
  onSaved: (entity: EntityRecordRow) => void;
}) {
  const intl = useIntl();
  const revalidator = useRevalidator();
  const [dialog, setDialog] = useState<"kind" | "head" | null>(null);
  const [kind, setKind] = useState<RegisterKind>(entity.registerKind);
  const [head, setHead] = useState(entity.headOfficeEntityId ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const frozen = entity.archivedAt !== null;
  const reason = intl.formatMessage({
    id: "entities.registerKind.lockReason",
    defaultMessage: "The register kind cannot change while a register holds data.",
  });
  const office = candidates.find((e) => e.id === entity.headOfficeEntityId);
  async function save(body: { registerKind?: RegisterKind; headOfficeEntityId?: string | null }) {
    if (busy) return;
    setBusy(true);
    setError(null);
    const result = await api
      .PATCH("/api/v1/entities/{id}", { params: { path: { id: entity.id } }, body })
      .catch(() => undefined);
    setBusy(false);
    if (!result?.data) {
      setError(
        (await problem(result)).detail ??
          intl.formatMessage({
            id: "entities.registerKind.saveError",
            defaultMessage: "The Entity could not be updated.",
          }),
      );
      return;
    }
    onSaved(result.data.entity);
    setDialog(null);
    void revalidator.revalidate();
  }
  function open(next: "kind" | "head") {
    setKind(entity.registerKind);
    setHead(entity.headOfficeEntityId ?? "");
    setError(null);
    setDialog(next);
  }
  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-3 text-muted">
        <p>
          {entity.registerKindSource === "entity" ? (
            <FormattedMessage
              id="entities.registerKind.fromEntity"
              defaultMessage="{kind} · set on this Entity"
              values={{ kind: intl.formatMessage(registerKindLabels[entity.registerKind]) }}
            />
          ) : (
            <FormattedMessage
              id="entities.registerKind.fromType"
              defaultMessage="{kind} · from the type {type}"
              values={{
                kind: intl.formatMessage(registerKindLabels[entity.registerKind]),
                type: entity.entityTypeName,
              }}
            />
          )}
        </p>
        <span title={entity.registerKindLocked ? reason : undefined}>
          <Button
            variant="secondary"
            disabled={frozen || entity.registerKindLocked}
            aria-describedby={entity.registerKindLocked ? "register-kind-lock" : undefined}
            onClick={() => open("kind")}
          >
            <FormattedMessage id="entities.registerKind.change" defaultMessage="Change register" />
          </Button>
        </span>
        {entity.registerKindLocked ? (
          <span id="register-kind-lock" className="sr-only">
            {reason}
          </span>
        ) : null}
      </div>
      {entity.registerKind === "none" ? (
        <section className="overflow-hidden rounded-card border border-border-default bg-raised">
          <header className="flex h-section-header items-center justify-between border-b border-border-default bg-section-header px-4">
            <h2 className="text-base font-semibold">
              <FormattedMessage id="entities.headOffice.title" defaultMessage="Head office" />
            </h2>
            <Button variant="secondary" disabled={frozen || busy} onClick={() => open("head")}>
              <FormattedMessage
                id="entities.headOffice.change"
                defaultMessage="Change head office"
              />
            </Button>
          </header>
          <div className="flex items-center justify-between gap-3 p-4">
            {office ? (
              <Link className="text-link hover:underline" to={`/entities/${office.id}`}>
                {office.legalName}
              </Link>
            ) : entity.headOfficeEntityId ? (
              <FormattedMessage
                id="entities.headOffice.unavailable"
                defaultMessage="Head office unavailable"
              />
            ) : (
              <p className="text-muted">
                <FormattedMessage
                  id="entities.headOffice.empty"
                  defaultMessage="This branch has no head office recorded."
                />
              </p>
            )}
            {entity.headOfficeEntityId ? (
              <Button
                variant="secondary"
                disabled={frozen || busy}
                onClick={() => void save({ headOfficeEntityId: null })}
              >
                <FormattedMessage
                  id="entities.headOffice.clear"
                  defaultMessage="Clear head office"
                />
              </Button>
            ) : null}
          </div>
        </section>
      ) : null}
      {error && !dialog ? (
        <p role="alert" className="text-status-danger-fg">
          {error}
        </p>
      ) : null}
      <Dialog
        open={dialog !== null}
        onOpenChange={(open) => {
          if (!open && !busy) setDialog(null);
        }}
      >
        <DialogContent>
          <DialogTitle>
            {dialog === "kind" ? (
              <FormattedMessage
                id="entities.registerKind.change"
                defaultMessage="Change register"
              />
            ) : (
              <FormattedMessage
                id="entities.headOffice.change"
                defaultMessage="Change head office"
              />
            )}
          </DialogTitle>
          {dialog === "kind" ? (
            <>
              <fieldset className="flex flex-col gap-3" disabled={busy}>
                <legend className="sr-only">
                  <FormattedMessage id="entities.registerKind.field" defaultMessage="Register" />
                </legend>
                {REGISTER_KINDS.map((value) => (
                  <label key={value} className="flex items-start gap-3">
                    <input
                      type="radio"
                      name="register-kind"
                      value={value}
                      checked={kind === value}
                      onChange={() => setKind(value)}
                    />
                    <span>
                      <span className="block font-medium">
                        {intl.formatMessage(registerKindLabels[value])}
                      </span>
                      <span className="block text-muted">
                        {intl.formatMessage(registerKindDescriptions[value])}
                      </span>
                    </span>
                  </label>
                ))}
              </fieldset>
              <p className="text-muted">{reason}</p>
            </>
          ) : (
            <div className="flex flex-col gap-2">
              <Label htmlFor="head-office">
                <FormattedMessage id="entities.headOffice.title" defaultMessage="Head office" />
              </Label>
              <select
                id="head-office"
                className={CONTROL_CLASS}
                value={head}
                disabled={busy}
                onChange={(e) => setHead(e.target.value)}
              >
                <option value="">
                  {intl.formatMessage({
                    id: "entities.headOffice.noOffice",
                    defaultMessage: "No head office",
                  })}
                </option>
                {head && !candidates.some((e) => e.id === head && !e.archivedAt) ? (
                  <option value={head} disabled>
                    {intl.formatMessage({
                      id: "entities.headOffice.unavailable",
                      defaultMessage: "Head office unavailable",
                    })}
                  </option>
                ) : null}
                {candidates
                  .filter((e) => e.id !== entity.id && !e.archivedAt)
                  .map((e) => (
                    <option key={e.id} value={e.id}>
                      {e.legalName}
                    </option>
                  ))}
              </select>
            </div>
          )}
          {error ? (
            <p role="alert" className="text-status-danger-fg">
              {error}
            </p>
          ) : null}
          <div className="flex justify-end gap-2">
            <Button variant="secondary" disabled={busy} onClick={() => setDialog(null)}>
              <FormattedMessage id="common.cancel" defaultMessage="Cancel" />
            </Button>
            <Button
              disabled={busy}
              onClick={() =>
                void save(
                  dialog === "kind" ? { registerKind: kind } : { headOfficeEntityId: head || null },
                )
              }
            >
              <FormattedMessage id="common.save" defaultMessage="Save" />
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
