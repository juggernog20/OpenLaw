// SPDX-License-Identifier: AGPL-3.0-only

/** Head-office selection for Entities that keep no register (ENT-013). */

import { useState } from "react";
import { Link, useRevalidator } from "react-router";
import { FormattedMessage, useIntl } from "react-intl";
import { api } from "../../lib/api";
import { problem } from "../../lib/problem";
import type { EntityRecordRow, EntityRow } from "../../lib/entities";
import { CONTROL_CLASS } from "../../lib/form-controls";
import { Button } from "../ui/button";
import { Dialog, DialogContent, DialogTitle } from "../ui/dialog";
import { Label } from "../ui/label";

export function HeadOfficePanel({
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
  const [dialog, setDialog] = useState(false);
  const [head, setHead] = useState(entity.headOfficeEntityId ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const frozen = entity.archivedAt !== null;
  const office = candidates.find((e) => e.id === entity.headOfficeEntityId);
  async function save(body: { headOfficeEntityId: string | null }) {
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
    setDialog(false);
    void revalidator.revalidate();
  }
  function open() {
    setHead(entity.headOfficeEntityId ?? "");
    setError(null);
    setDialog(true);
  }
  function close() {
    if (busy) return;
    setDialog(false);
    setError(null);
  }
  if (entity.registerKind !== "none") return null;
  return (
    <>
      <section className="overflow-hidden rounded-card border border-border-default bg-raised">
        <header className="flex h-section-header items-center justify-between border-b border-border-default bg-section-header px-4">
          <h2 className="text-base font-semibold">
            <FormattedMessage id="entities.headOffice.title" defaultMessage="Head office" />
          </h2>
          <Button variant="secondary" disabled={frozen || busy} onClick={open}>
            <FormattedMessage id="entities.headOffice.change" defaultMessage="Change head office" />
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
              <FormattedMessage id="entities.headOffice.clear" defaultMessage="Clear head office" />
            </Button>
          ) : null}
        </div>
      </section>
      {error && !dialog ? (
        <p role="alert" className="text-status-danger-fg">
          {error}
        </p>
      ) : null}
      <Dialog
        open={dialog}
        onOpenChange={(open) => {
          if (!open) close();
        }}
      >
        <DialogContent>
          <DialogTitle>
            <FormattedMessage id="entities.headOffice.change" defaultMessage="Change head office" />
          </DialogTitle>
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
          {error ? (
            <p role="alert" className="text-status-danger-fg">
              {error}
            </p>
          ) : null}
          <div className="flex justify-end gap-2">
            <Button variant="secondary" disabled={busy} onClick={close}>
              <FormattedMessage id="common.cancel" defaultMessage="Cancel" />
            </Button>
            <Button disabled={busy} onClick={() => void save({ headOfficeEntityId: head || null })}>
              <FormattedMessage id="common.save" defaultMessage="Save" />
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
