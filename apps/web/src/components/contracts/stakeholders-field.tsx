// SPDX-License-Identifier: AGPL-3.0-only

/** Member+ maintains explicit Contract stakeholders here (DD-021), independently
 * of Business Owner assignment. Both grant Portal access subject to Confidential rules. */

import { useEffect, useState } from "react";
import { FormattedMessage, useIntl } from "react-intl";
import type { paths } from "@openlaw/api-client";
import { api } from "../../lib/api";
import { Button } from "../ui/button";
import { Label } from "../ui/label";
import { CONTROL_CLASS } from "../../lib/form-controls";

type Stakeholder =
  paths["/api/v1/contracts/{number}/stakeholders"]["get"]["responses"]["200"]["content"]["application/json"]["stakeholders"][number];

export function StakeholdersField({
  number,
  people,
  frozen,
}: {
  number: number;
  people: readonly { id: string; displayName: string }[];
  frozen: boolean;
}) {
  const intl = useIntl();
  const [stakeholders, setStakeholders] = useState<Stakeholder[] | null>(null);
  const [candidate, setCandidate] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const readError = intl.formatMessage({
    id: "contracts.stakeholders.readError",
    defaultMessage: "Stakeholders could not be read.",
  });
  const writeError = intl.formatMessage({
    id: "contracts.stakeholders.writeError",
    defaultMessage: "Stakeholders could not be updated.",
  });
  useEffect(() => {
    let current = true;
    void api
      .GET("/api/v1/contracts/{number}/stakeholders", { params: { path: { number } } })
      .then(({ data }) => {
        if (!current) return;
        if (data) {
          setStakeholders(data.stakeholders);
          setError(null);
        } else setError(readError);
      })
      .catch(() => {
        if (current) setError(readError);
      });
    return () => {
      current = false;
    };
  }, [number, attempt, readError]);
  async function add() {
    setPending(true);
    setError(null);
    try {
      const { data, error } = await api.POST("/api/v1/contracts/{number}/stakeholders", {
        params: { path: { number } },
        body: { userId: candidate },
      });
      if (!data) setError(error?.detail ?? writeError);
      else {
        setStakeholders(data.stakeholders);
        setCandidate("");
      }
    } catch {
      setError(writeError);
    } finally {
      setPending(false);
    }
  }
  async function remove(userId: string) {
    setPending(true);
    setError(null);
    try {
      const { data, error } = await api.DELETE("/api/v1/contracts/{number}/stakeholders/{userId}", {
        params: { path: { number, userId } },
      });
      if (!data) setError(error?.detail ?? writeError);
      else setStakeholders(data.stakeholders);
    } catch {
      setError(writeError);
    } finally {
      setPending(false);
    }
  }
  return (
    <section
      aria-labelledby="contract-stakeholders-title"
      className="flex flex-col gap-3 @2xl/page:col-span-2"
    >
      <h3 id="contract-stakeholders-title" className="text-base font-semibold">
        <FormattedMessage id="contracts.stakeholders.title" defaultMessage="Stakeholders" />
      </h3>
      <p className="text-sm text-muted">
        <FormattedMessage
          id="contracts.stakeholders.explanation"
          defaultMessage="The Business Owner and stakeholders can read this Contract in the Portal. Confidential Contracts also require team membership. Stakeholder access continues when the Business Owner changes."
        />
      </p>
      {stakeholders && stakeholders.length > 0 ? (
        <ul className="flex flex-col gap-2">
          {stakeholders.map((person) => (
            <li key={person.id} className="flex items-center justify-between gap-3">
              <span className="text-base">
                {person.displayName}
                {person.archived && (
                  <span className="text-sm text-muted">
                    {" "}
                    <FormattedMessage
                      id="contracts.stakeholders.archived"
                      defaultMessage="(archived)"
                    />
                  </span>
                )}
              </span>
              {!frozen && (
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={pending}
                  onClick={() => void remove(person.id)}
                  aria-label={intl.formatMessage(
                    {
                      id: "contracts.stakeholders.removeNamed",
                      defaultMessage: "Remove {name} as stakeholder",
                    },
                    { name: person.displayName },
                  )}
                >
                  <FormattedMessage id="contracts.stakeholders.remove" defaultMessage="Remove" />
                </Button>
              )}
            </li>
          ))}
        </ul>
      ) : (
        stakeholders && (
          <p className="text-sm text-muted">
            <FormattedMessage
              id="contracts.stakeholders.empty"
              defaultMessage="No additional stakeholders."
            />
          </p>
        )
      )}
      {!frozen && stakeholders && (
        <div className="flex flex-wrap items-end gap-2">
          <div className="flex min-w-48 flex-1 flex-col gap-1.5">
            <Label htmlFor="contract-stakeholder">
              <FormattedMessage
                id="contracts.stakeholders.person"
                defaultMessage="Add stakeholder"
              />
            </Label>
            <select
              id="contract-stakeholder"
              className={CONTROL_CLASS}
              value={candidate}
              disabled={pending}
              onChange={(event) => setCandidate(event.target.value)}
            >
              <option value="">
                {intl.formatMessage({
                  id: "contracts.stakeholders.choose",
                  defaultMessage: "Choose a person",
                })}
              </option>
              {people
                .filter((person) => !stakeholders.some((held) => held.id === person.id))
                .map((person) => (
                  <option key={person.id} value={person.id}>
                    {person.displayName}
                  </option>
                ))}
            </select>
          </div>
          <Button variant="secondary" disabled={pending || !candidate} onClick={() => void add()}>
            <FormattedMessage id="contracts.stakeholders.add" defaultMessage="Add" />
          </Button>
        </div>
      )}
      {error && (
        <div className="flex items-center gap-2">
          <p role="alert" className="text-sm text-status-danger-fg">
            {error}
          </p>
          {!stakeholders && (
            <Button
              variant="secondary"
              size="sm"
              onClick={() => {
                setError(null);
                setAttempt((value) => value + 1);
              }}
            >
              <FormattedMessage id="contracts.stakeholders.retry" defaultMessage="Retry" />
            </Button>
          )}
        </div>
      )}
    </section>
  );
}
