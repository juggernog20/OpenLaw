// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The Entity record's Registrations card: ENT-002's per-jurisdiction
 * rows, added, edited inline, and removed one at a time.
 *
 * `obligations` defaults to empty because the Overview mount has no
 * obligation read of its own. When the caller passes them, each row
 * lists the obligations that point at it (ENT-006) as links to the
 * Entity's Obligations tab, not to an obligation page. An obligation
 * has no page of its own.
 */

import { useId, useState } from "react";
import { Link } from "react-router";
import { FormattedMessage, useIntl, type IntlShape } from "react-intl";
import { Plus, Trash2 } from "lucide-react";
import { api } from "../../lib/api";
import {
  ENTITY_REGISTRATION_STATUSES,
  type EntityObligation,
  type EntityRegistration,
  type EntityRegistrationStatus,
} from "../../lib/entities";
import { formatShortDate } from "../../lib/format";
import { CONTROL_CLASS } from "../../lib/form-controls";
import { problem } from "../../lib/problem";
import { StatusNote, type FieldStatus } from "../status-note";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Label } from "../ui/label";

export function RegistrationsCard({
  entityId,
  initial,
  obligations = [],
  frozen,
}: Readonly<{
  entityId: string;
  initial: readonly EntityRegistration[];
  obligations?: readonly EntityObligation[];
  frozen: boolean;
}>) {
  const intl = useIntl();
  const [registrations, setRegistrations] = useState([...initial]);
  const [adding, setAdding] = useState(false);
  const [jurisdiction, setJurisdiction] = useState("");
  const [registrationNumber, setRegistrationNumber] = useState("");
  const [registeredAgent, setRegisteredAgent] = useState("");
  const [registrationStatus, setRegistrationStatus] = useState<EntityRegistrationStatus>("active");
  const [status, setStatus] = useState<FieldStatus>("idle");
  const [error, setError] = useState<string>();

  async function addRegistration() {
    if (!jurisdiction.trim()) return;
    setStatus("saving");
    const result = await api
      .POST("/api/v1/entities/{id}/registrations", {
        params: { path: { id: entityId } },
        body: {
          jurisdiction: jurisdiction.trim(),
          registrationNumber: registrationNumber.trim() || null,
          registeredAgent: registeredAgent.trim() || null,
          status: registrationStatus,
        },
      })
      .catch(() => undefined);
    if (!result?.data) {
      setStatus("error");
      setError((await problem(result)).detail);
      return;
    }
    setRegistrations((current) => [...current, result.data.registration]);
    setJurisdiction("");
    setRegistrationNumber("");
    setRegisteredAgent("");
    setRegistrationStatus("active");
    setAdding(false);
    setStatus("saved");
  }

  async function updateRegistration(id: string, body: Record<string, unknown>) {
    const result = await api
      .PATCH("/api/v1/entities/{id}/registrations/{childId}", {
        params: { path: { id: entityId, childId: id } },
        body,
      })
      .catch(() => undefined);
    if (!result?.data) {
      setStatus("error");
      setError((await problem(result)).detail);
      return;
    }
    setRegistrations((current) =>
      current.map((row) => (row.id === id ? result.data!.registration : row)),
    );
    setStatus("saved");
  }

  async function removeRegistration(id: string) {
    const result = await api
      .DELETE("/api/v1/entities/{id}/registrations/{childId}", {
        params: { path: { id: entityId, childId: id } },
      })
      .catch(() => undefined);
    if (!result?.response.ok) {
      setStatus("error");
      setError((await problem(result)).detail);
      return;
    }
    setRegistrations((current) => current.filter((row) => row.id !== id));
  }

  const headingId = useId();
  return (
    <section
      aria-labelledby={headingId}
      className="overflow-hidden rounded-card border border-border-default bg-raised"
    >
      <header className="flex min-h-section-header items-center justify-between gap-3 border-b border-border-default bg-section-header px-4 py-2">
        <h2 id={headingId} className="text-base font-semibold">
          <FormattedMessage
            id="entities.record.registrations.title"
            defaultMessage="Registrations"
          />
        </h2>
        <div className="flex items-center gap-3">
          {!adding ? <StatusNote status={status} detail={error} /> : null}
          {!frozen ? (
            <Button size="sm" variant="secondary" onClick={() => setAdding((current) => !current)}>
              <Plus size={16} aria-hidden="true" />
              <FormattedMessage
                id="entities.record.registrations.add"
                defaultMessage="Add registration"
              />
            </Button>
          ) : null}
        </div>
      </header>
      {adding ? (
        <div className="grid grid-cols-1 gap-3 border-b border-border-muted bg-canvas p-4 @2xl/page:grid-cols-4">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="new-registration-jurisdiction">
              <FormattedMessage
                id="entities.record.registrations.jurisdiction"
                defaultMessage="Jurisdiction"
              />
            </Label>
            <Input
              id="new-registration-jurisdiction"
              value={jurisdiction}
              onChange={(event) => setJurisdiction(event.target.value)}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="new-registration-number">
              <FormattedMessage
                id="entities.record.registrations.number"
                defaultMessage="Registration number"
              />
            </Label>
            <Input
              id="new-registration-number"
              value={registrationNumber}
              onChange={(event) => setRegistrationNumber(event.target.value)}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="new-registration-agent">
              <FormattedMessage
                id="entities.record.registrations.agent"
                defaultMessage="Registered agent"
              />
            </Label>
            <Input
              id="new-registration-agent"
              value={registeredAgent}
              onChange={(event) => setRegisteredAgent(event.target.value)}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="new-registration-status">
              <FormattedMessage id="entities.record.registrations.status" defaultMessage="Status" />
            </Label>
            <select
              id="new-registration-status"
              className={CONTROL_CLASS}
              value={registrationStatus}
              onChange={(event) =>
                setRegistrationStatus(event.target.value as EntityRegistrationStatus)
              }
            >
              {ENTITY_REGISTRATION_STATUSES.map((value) => (
                <option key={value} value={value}>
                  {registrationStatusLabel(intl, value)}
                </option>
              ))}
            </select>
          </div>
          <div className="flex items-center gap-2 @2xl/page:col-span-4">
            <Button size="sm" onClick={() => void addRegistration()}>
              <FormattedMessage id="common.add" defaultMessage="Add" />
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setAdding(false)}>
              <FormattedMessage id="action.cancel" defaultMessage="Cancel" />
            </Button>
            <StatusNote status={status} detail={error} />
          </div>
        </div>
      ) : null}
      {registrations.length === 0 ? (
        <p className="p-4 text-base text-muted">
          <FormattedMessage
            id="entities.record.registrations.empty"
            defaultMessage="No additional registrations."
          />
        </p>
      ) : (
        <div className="divide-y divide-border-muted">
          {registrations.map((registration) => (
            <RegistrationRow
              key={registration.id}
              registration={registration}
              entityId={entityId}
              obligations={obligations.filter((row) => row.registration?.id === registration.id)}
              frozen={frozen}
              onUpdate={(body) => void updateRegistration(registration.id, body)}
              onRemove={() => void removeRegistration(registration.id)}
            />
          ))}
        </div>
      )}
    </section>
  );
}

function RegistrationRow({
  registration,
  entityId,
  obligations,
  frozen,
  onUpdate,
  onRemove,
}: Readonly<{
  registration: EntityRegistration;
  entityId: string;
  obligations: readonly EntityObligation[];
  frozen: boolean;
  onUpdate: (body: Record<string, unknown>) => void;
  onRemove: () => void;
}>) {
  const intl = useIntl();
  const [jurisdiction, setJurisdiction] = useState(registration.jurisdiction);
  const label = (field: string) =>
    intl.formatMessage(
      {
        id: "entities.record.registrations.rowField",
        defaultMessage: "{jurisdiction} {field}",
      },
      { jurisdiction: registration.jurisdiction, field },
    );
  const [number, setNumber] = useState(registration.registrationNumber ?? "");
  const [agent, setAgent] = useState(registration.registeredAgent ?? "");
  return (
    <div className="p-4">
      <div className="grid grid-cols-1 gap-3 @2xl/page:grid-cols-[1.2fr_1fr_1.4fr_1fr_auto]">
        <Input
          aria-label={label(
            intl.formatMessage({
              id: "entities.record.registrations.jurisdiction",
              defaultMessage: "Jurisdiction",
            }),
          )}
          value={jurisdiction}
          disabled={frozen}
          onChange={(event) => setJurisdiction(event.target.value)}
          onBlur={() =>
            jurisdiction.trim() &&
            jurisdiction.trim() !== registration.jurisdiction &&
            onUpdate({ jurisdiction: jurisdiction.trim() })
          }
        />
        <Input
          aria-label={label(
            intl.formatMessage({
              id: "entities.record.registrations.number",
              defaultMessage: "Registration number",
            }),
          )}
          value={number}
          disabled={frozen}
          onChange={(event) => setNumber(event.target.value)}
          onBlur={() =>
            number !== (registration.registrationNumber ?? "") &&
            onUpdate({ registrationNumber: number || null })
          }
        />
        <Input
          aria-label={label(
            intl.formatMessage({
              id: "entities.record.registrations.agent",
              defaultMessage: "Registered agent",
            }),
          )}
          value={agent}
          disabled={frozen}
          onChange={(event) => setAgent(event.target.value)}
          onBlur={() =>
            agent !== (registration.registeredAgent ?? "") &&
            onUpdate({ registeredAgent: agent || null })
          }
        />
        <select
          aria-label={label(
            intl.formatMessage({
              id: "entities.record.registrations.status",
              defaultMessage: "Status",
            }),
          )}
          className={CONTROL_CLASS}
          value={registration.status}
          disabled={frozen}
          onChange={(event) => onUpdate({ status: event.target.value as EntityRegistrationStatus })}
        >
          {ENTITY_REGISTRATION_STATUSES.map((value) => (
            <option key={value} value={value}>
              {registrationStatusLabel(intl, value)}
            </option>
          ))}
        </select>
        {!frozen ? (
          <Button
            size="icon"
            variant="ghost"
            aria-label={intl.formatMessage(
              {
                id: "entities.record.registrations.remove",
                defaultMessage: "Remove {jurisdiction} registration",
              },
              { jurisdiction: registration.jurisdiction },
            )}
            onClick={onRemove}
          >
            <Trash2 size={16} />
          </Button>
        ) : null}
      </div>
      {obligations.length > 0 ? (
        <div className="mt-3 border-t border-border-muted pt-3">
          <p className="text-xs font-medium uppercase tracking-wide text-muted">
            <FormattedMessage
              id="entities.record.registrations.linkedObligations"
              defaultMessage="Linked obligations"
            />
          </p>
          <ul className="mt-1 flex flex-wrap gap-x-4 gap-y-1">
            {obligations.map((obligation) => (
              <li key={obligation.id} className="text-xs text-muted">
                <FormattedMessage
                  id="entities.record.registrations.obligationDue"
                  defaultMessage="<link>{label}</link> due {date}"
                  values={{
                    label: obligation.label,
                    date: formatShortDate(obligation.nextDueOn),
                    link: (chunks) => (
                      <Link
                        className="me-2 text-sm text-link hover:underline"
                        to={`/entities/${entityId}/obligations`}
                      >
                        {chunks}
                      </Link>
                    ),
                  }}
                />
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

function registrationStatusLabel(intl: IntlShape, status: EntityRegistrationStatus) {
  return intl.formatMessage(
    {
      id: "entities.record.registrations.statusLabel",
      defaultMessage:
        "{status, select, active {Active} lapsed {Lapsed} withdrawn {Withdrawn} other {{status}}}",
    },
    { status },
  );
}
