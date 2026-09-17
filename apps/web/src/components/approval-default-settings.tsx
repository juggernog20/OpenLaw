// SPDX-License-Identifier: AGPL-3.0-only

import { useEffect, useState } from "react";
import { FormattedMessage, useIntl } from "react-intl";
import { api } from "../lib/api";
import { problem } from "../lib/problem";
import { CONTROL_CLASS } from "../lib/form-controls";
import { SettingsCard } from "./settings-card";
import { Label } from "./ui/label";

export function ApprovalOverridePolicy() {
  const intl = useIntl();
  const [allowed, setAllowed] = useState<boolean>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const failure = intl.formatMessage({
    id: "settings.approvalPolicy.failed",
    defaultMessage: "The approval setting could not be saved or loaded. Please try again.",
  });
  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const result = await api.GET("/api/v1/org/approval-policy");
        if (!active) return;
        if (result.data) setAllowed(result.data.allowLegalApproverGroupOverride);
        else setError(failure);
      } catch {
        if (active) setError(failure);
      }
    })();
    return () => {
      active = false;
    };
  }, [failure]);
  async function save(value: boolean) {
    setBusy(true);
    setError(undefined);
    const result = await api
      .PUT("/api/v1/org/approval-policy", { body: { allowLegalApproverGroupOverride: value } })
      .catch(() => undefined);
    if (result?.data) setAllowed(result.data.allowLegalApproverGroupOverride);
    else setError((await problem(result)).detail ?? failure);
    setBusy(false);
  }
  return (
    <SettingsCard
      title={
        <FormattedMessage
          id="settings.approvalPolicy.title"
          defaultMessage="Approval permissions"
        />
      }
    >
      <Label htmlFor="approver-group-override">
        <FormattedMessage
          id="settings.approvalPolicy.label"
          defaultMessage="Who can override a default approver group?"
        />
      </Label>
      <select
        id="approver-group-override"
        className={CONTROL_CLASS}
        value={allowed === undefined ? "" : String(allowed)}
        disabled={busy || allowed === undefined}
        onChange={(event) => void save(event.target.value === "true")}
      >
        {allowed === undefined && (
          <option value="">
            {intl.formatMessage({
              id: "settings.approvalPolicy.loading",
              defaultMessage: "Loading…",
            })}
          </option>
        )}
        <option value="true">
          {intl.formatMessage({
            id: "settings.approvalPolicy.legal",
            defaultMessage: "Legal team members and administrators",
          })}
        </option>
        <option value="false">
          {intl.formatMessage({
            id: "settings.approvalPolicy.admin",
            defaultMessage: "Administrators only",
          })}
        </option>
      </select>
      {error && (
        <p role="alert" className="text-sm text-status-danger-fg">
          {error}
        </p>
      )}
    </SettingsCard>
  );
}

export function ContractTypeApprovalDefault({
  typeId,
  archived,
}: Readonly<{ typeId: string; archived: boolean }>) {
  const intl = useIntl();
  const [groupId, setGroupId] = useState<string>();
  const [groups, setGroups] = useState<{ id: string; name: string; archivedAt: string | null }[]>(
    [],
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const failure = intl.formatMessage({
    id: "settings.approvalDefault.failed",
    defaultMessage: "The default approver group could not be saved or loaded. Please try again.",
  });
  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const [setting, options] = await Promise.all([
          api.GET("/api/v1/contract-types/{id}/approval-default", {
            params: { path: { id: typeId } },
          }),
          api.GET("/api/v1/approver-groups", { params: { query: { includeArchived: "true" } } }),
        ]);
        if (!active) return;
        if (setting.data && options.data) {
          setGroupId(setting.data.groupId ?? "");
          setGroups(options.data.approverGroups);
        } else setError(failure);
      } catch {
        if (active) setError(failure);
      }
    })();
    return () => {
      active = false;
    };
  }, [typeId, failure]);
  async function save(value: string) {
    setBusy(true);
    setError(undefined);
    const result = await api
      .PUT("/api/v1/contract-types/{id}/approval-default", {
        params: { path: { id: typeId } },
        body: { groupId: value || null },
      })
      .catch(() => undefined);
    if (result?.data) setGroupId(result.data.groupId ?? "");
    else setError((await problem(result)).detail ?? failure);
    setBusy(false);
  }
  return (
    <SettingsCard
      title={
        <FormattedMessage
          id="settings.approvalDefault.title"
          defaultMessage="Default approver group"
        />
      }
    >
      <Label htmlFor="type-approver-group">
        <FormattedMessage id="settings.approvalDefault.label" defaultMessage="Approver group" />
      </Label>
      <select
        id="type-approver-group"
        className={CONTROL_CLASS}
        value={groupId ?? ""}
        disabled={busy || archived || groupId === undefined}
        onChange={(event) => void save(event.target.value)}
      >
        <option value="">
          {intl.formatMessage({
            id: "settings.approvalDefault.none",
            defaultMessage: "No default group",
          })}
        </option>
        {groups
          .filter((group) => !group.archivedAt || group.id === groupId)
          .map((group) => (
            <option key={group.id} value={group.id} disabled={!!group.archivedAt}>
              {group.archivedAt
                ? intl.formatMessage(
                    {
                      id: "settings.approvalDefault.archived",
                      defaultMessage: "{name} (archived)",
                    },
                    { name: group.name },
                  )
                : group.name}
            </option>
          ))}
      </select>
      <p className="text-sm text-muted">
        <FormattedMessage
          id="settings.approvalDefault.help"
          defaultMessage="Applies to new Contracts of this type. Approval starts only when someone requests it."
        />
      </p>
      {error && (
        <p role="alert" className="text-sm text-status-danger-fg">
          {error}
        </p>
      )}
    </SettingsCard>
  );
}
