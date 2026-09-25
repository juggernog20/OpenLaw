// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Shared API key tables and dialogs for DES-092 and SET-014. Metadata reads leave
 * the secret sealed; the mounted owner pane collects one key at a time.
 */

import { useEffect, useRef, useState } from "react";
import { FormattedMessage, defineMessage, defineMessages, useIntl } from "react-intl";
import type { paths } from "@openlaw/api-client";
import type { McpToolset } from "@openlaw/shared";
import { api } from "../lib/api";
import { toolsetLabel } from "../lib/mcp";
import { Scope } from "./mcp-scope";
import { ConnectedClients } from "./connected-clients";
import { SettingsCard } from "./settings-card";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Checkbox } from "./ui/checkbox";
import { Dialog, DialogContent, DialogTitle } from "./ui/dialog";

type State =
  paths["/api/v1/api-key-requests"]["get"]["responses"][200]["content"]["application/json"];
type OAuthGrantRow =
  paths["/api/v1/mcp-settings/oauth-grants"]["get"]["responses"][200]["content"]["application/json"][number];
type KeyRow = State["requests"][number] & { oauthGrant?: boolean; grantedAt?: string };
function asCredential(row: OAuthGrantRow): KeyRow {
  return {
    ...row,
    oauthGrant: true,
    requesterId: row.personId,
    status: "active",
    note: null,
    decisionNote: null,
    decidedAt: row.grantedAt,
    approvedBy: null,
    createdAt: row.grantedAt,
    expiresAt: row.expiresAt,
    lastUsedAt: row.lastUsedAt,
    keyAvailable: false,
  };
}
const EMPTY_GRANTS: OAuthGrantRow[] = [];
type Action = "approve" | "deny" | "cancel" | "revoke";
const actions = defineMessages({
  approve: { id: "apiKeys.approve", defaultMessage: "Approve" },
  deny: { id: "apiKeys.deny", defaultMessage: "Deny" },
  cancel: { id: "apiKeys.cancelRequest", defaultMessage: "Cancel request" },
  revoke: { id: "apiKeys.revoke", defaultMessage: "Revoke" },
});
const readFailed = defineMessage({
  id: "apiKeys.readFailed",
  defaultMessage: "The API key could not be read. Reload to try again.",
});
const statuses = defineMessages({
  pending: { id: "apiKeys.pending", defaultMessage: "Pending approval" },
  active: { id: "apiKeys.active", defaultMessage: "Active" },
  revoked: { id: "apiKeys.revoked", defaultMessage: "Revoked" },
  expired: { id: "apiKeys.expired", defaultMessage: "Expired" },
  denied: { id: "apiKeys.denied", defaultMessage: "Denied" },
  cancelled: { id: "apiKeys.cancelled", defaultMessage: "Cancelled" },
});
export function ApiKeys({
  initial,
  organization = false,
  initialGrants = EMPTY_GRANTS,
}: {
  initial: State;
  organization?: boolean;
  initialGrants?: OAuthGrantRow[];
}) {
  const intl = useIntl();
  const [state, setState] = useState(initial);
  const [grants, setGrants] = useState(initialGrants);
  const [loadedGrants, setLoadedGrants] = useState(initialGrants);
  if (loadedGrants !== initialGrants) {
    setLoadedGrants(initialGrants);
    setGrants(initialGrants);
  }
  const [loadedRequests, setLoadedRequests] = useState(initial.requests);
  if (loadedRequests !== initial.requests) {
    setLoadedRequests(initial.requests);
    setState(initial);
  }
  const [requesting, setRequesting] = useState(false);
  const [ready, setReady] = useState<KeyRow>();
  const [decision, setDecision] = useState<{ row: KeyRow; action: Action }>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [name, setName] = useState("");
  const [toolsets, setToolsets] = useState<McpToolset[]>([]);
  const [scope, setScope] = useState<"read" | "write">();
  const [note, setNote] = useState("");
  const collecting = useRef(false);
  const lock = useRef(false);
  const fail = () =>
    intl.formatMessage({
      id: "apiKeys.failed",
      defaultMessage: "API keys could not be updated. Try again.",
    });
  const date = (value: string | null) =>
    value ? intl.formatDate(value, { dateStyle: "medium" }) : "—";
  const listToolsets = (row: KeyRow) => row.toolsets.map((t) => toolsetLabel(intl, t)).join(", ");
  async function refresh() {
    if (organization) {
      const { data, error } = await api.GET("/api/v1/mcp-settings/api-keys");
      if (!data) throw new Error(error?.detail ?? fail());
      setState((s) => ({ ...s, requests: data }));
      const { data: currentGrants } = await api.GET("/api/v1/mcp-settings/oauth-grants");
      if (!currentGrants) throw new Error(fail());
      setGrants(currentGrants);
    } else {
      const [{ data, error }, { data: currentGrants }] = await Promise.all([
        api.GET("/api/v1/api-key-requests"),
        api.GET("/api/v1/oauth-grants"),
      ]);
      if (!data || !currentGrants) throw new Error(error?.detail ?? fail());
      setState(data);
      setGrants(currentGrants);
    }
  }
  // Only the mounted pane collects secrets. Loaders and revalidation read metadata alone.
  useEffect(() => {
    const row = state.requests.find((r) => r.keyAvailable);
    if (organization || !row || ready || collecting.current) return;
    collecting.current = true;
    void api
      .GET("/api/v1/api-key-requests/{id}", { params: { path: { id: row.id } } })
      .then(({ data, error }) => {
        if (!data) {
          setError(error?.detail ?? intl.formatMessage(readFailed));
          return;
        }
        setState((s) => ({
          ...s,
          requests: s.requests.map((r) => (r.id === data.id ? { ...data, key: undefined } : r)),
        }));
        if (data.key) {
          setReady(data);
        }
      })
      .catch(() => setError(intl.formatMessage(readFailed)))
      .finally(() => {
        collecting.current = false;
      });
  }, [state.requests, organization, ready, intl]);
  async function mutate(work: () => Promise<void>) {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setError(undefined);
    try {
      await work();
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : fail());
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  function requestKey() {
    if (!scope) return;
    void mutate(async () => {
      const { data, error } = await api.POST("/api/v1/api-key-requests", {
        body: { clientName: name, toolsets, scope, ...(note.trim() ? { note: note.trim() } : {}) },
      });
      if (!data) throw new Error(error?.detail ?? fail());
      setRequesting(false);
      if (data.key) {
        setReady(data);
      }
    });
  }
  function decide() {
    if (!decision) return;
    void mutate(async () => {
      const params = { path: { id: decision.row.id } };
      if (decision.row.oauthGrant) {
        const { data, error } = await api.POST("/api/v1/oauth-grants/{id}/revoke", { params });
        if (!data) throw new Error(error?.detail ?? fail());
        setGrants((current) => current.filter((grant) => grant.id !== decision.row.id));
        setDecision(undefined);
        return;
      }
      const result =
        decision.action === "approve"
          ? await api.POST("/api/v1/api-key-requests/{id}/approve", { params, body: { note } })
          : decision.action === "deny"
            ? await api.POST("/api/v1/api-key-requests/{id}/deny", { params, body: { note } })
            : decision.action === "cancel"
              ? await api.POST("/api/v1/api-key-requests/{id}/cancel", { params })
              : await api.POST("/api/v1/api-key-requests/{id}/revoke", { params });
      if (!result.data) throw new Error(result.error?.detail ?? fail());
      setDecision(undefined);
      if (result.data.key) {
        setReady(result.data);
      }
    });
  }
  function actionButton(row: KeyRow, action: Action) {
    return (
      <Button
        key={action}
        variant="secondary"
        disabled={busy}
        onClick={() => {
          setNote("");
          setError(undefined);
          setDecision({ row, action });
        }}
      >
        <FormattedMessage {...actions[action]} />
      </Button>
    );
  }
  function table(rows: KeyRow[], withGrants = false) {
    return (
      <div className="overflow-x-auto">
        <table className="w-full text-start text-base">
          <thead className="bg-section-header text-muted">
            <tr>
              {organization && (
                <th className="p-3 text-start">
                  <FormattedMessage id="apiKeys.owner" defaultMessage="Owner" />
                </th>
              )}
              <th className="p-3 text-start">
                <FormattedMessage id="apiKeys.client" defaultMessage="Client" />
              </th>
              <th className="p-3 text-start">
                <FormattedMessage id="apiKeys.toolsets" defaultMessage="Toolsets" />
              </th>
              <th className="p-3 text-start">
                <FormattedMessage id="apiKeys.scope" defaultMessage="Scope" />
              </th>
              <th className="p-3 text-start">
                <FormattedMessage id="apiKeys.status" defaultMessage="Status" />
              </th>
              {organization && (
                <th className="p-3 text-start">
                  <FormattedMessage id="apiKeys.granted" defaultMessage="Granted" />
                </th>
              )}
              {organization && (
                <th className="p-3 text-start">
                  <FormattedMessage id="apiKeys.lastUsed" defaultMessage="Last used" />
                </th>
              )}
              <th className="p-3 text-start">
                <FormattedMessage id="apiKeys.expires" defaultMessage="Expires" />
              </th>
              <th>
                <span className="sr-only">
                  <FormattedMessage id="apiKeys.actions" defaultMessage="Actions" />
                </span>
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id} className="border-t border-border-default">
                {organization && <td className="p-3">{row.owner}</td>}
                <td className="p-3">
                  {row.clientName}
                  {organization && row.note && <p className="text-sm text-muted">{row.note}</p>}
                </td>
                <td className="p-3">{listToolsets(row)}</td>
                <td className="p-3">
                  <Scope scope={row.scope} />
                </td>
                <td className="p-3">
                  <span
                    className={
                      row.status === "active"
                        ? "rounded-full bg-status-success-bg px-2 py-0.5 text-status-success-fg"
                        : "rounded-full bg-control px-2 py-0.5 text-muted"
                    }
                  >
                    <FormattedMessage {...statuses[row.status]} />
                  </span>
                  {row.decisionNote && (
                    <p className="mt-1 text-sm text-muted">{row.decisionNote}</p>
                  )}
                </td>
                {organization && <td className="p-3">{date(row.grantedAt ?? row.decidedAt)}</td>}
                {organization && <td className="p-3">{date(row.lastUsedAt)}</td>}
                <td className="p-3">{date(row.expiresAt)}</td>
                <td className="p-3">
                  <div className="flex gap-2">
                    {row.status === "pending" ? (
                      organization ? (
                        <>
                          {actionButton(row, "deny")}
                          {actionButton(row, "approve")}
                        </>
                      ) : (
                        actionButton(row, "cancel")
                      )
                    ) : row.status === "active" ? (
                      actionButton(row, "revoke")
                    ) : null}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {!rows.length && (
          <p className="p-4 text-muted">
            {withGrants ? (
              <FormattedMessage
                id="apiKeys.emptyCredentials"
                defaultMessage="No API keys or grants to show."
              />
            ) : (
              <FormattedMessage id="apiKeys.empty" defaultMessage="No API keys to show." />
            )}
          </p>
        )}
      </div>
    );
  }
  const requestAction =
    !organization && state.policy.groupEnabled && state.policy.enabled ? (
      <Button
        onClick={() => {
          setName("");
          setToolsets([]);
          setScope(undefined);
          setNote("");
          setError(undefined);
          setRequesting(true);
        }}
      >
        <FormattedMessage id="apiKeys.request" defaultMessage="Request a key" />
      </Button>
    ) : undefined;
  return (
    <>
      {error && (
        <p role="alert" className="text-status-danger-fg">
          {error}
        </p>
      )}
      {organization ? (
        <>
          <SettingsCard
            title={<FormattedMessage id="apiKeys.pendingTitle" defaultMessage="API key requests" />}
            className="max-w-none"
            flush
            collapsible
          >
            {table(state.requests.filter((r) => r.status === "pending"))}
          </SettingsCard>
          <SettingsCard
            title={
              <FormattedMessage
                id="apiKeys.activeCredentialsTitle"
                defaultMessage="Active keys and grants"
              />
            }
            actions={
              <span className="text-xs text-muted">
                <FormattedMessage
                  id="apiKeys.credentialCounts"
                  defaultMessage="{keys, plural, one {# key} other {# keys}} · {grants, plural, one {# grant} other {# grants}}"
                  values={{
                    keys: state.requests.filter((r) => r.status === "active").length,
                    grants: grants.length,
                  }}
                />
              </span>
            }
            className="max-w-none"
            flush
            collapsible
            defaultOpen={false}
          >
            {table(
              [...state.requests.filter((r) => r.status === "active"), ...grants.map(asCredential)],
              true,
            )}
          </SettingsCard>
        </>
      ) : (
        <SettingsCard
          title={<FormattedMessage id="apiKeys.title" defaultMessage="API keys" />}
          actions={requestAction}
          className="max-w-none"
          flush
        >
          {table(state.requests)}
          <p className="border-t border-border-default p-4 text-sm text-muted">
            <FormattedMessage
              id="apiKeys.lifetime"
              defaultMessage="Keys expire {days} days after approval and are shown once."
              values={{ days: state.policy.apiKeyLifetimeDays }}
            />
          </p>
        </SettingsCard>
      )}
      {!organization && (
        <ConnectedClients
          grants={grants}
          busy={busy}
          onDisconnect={(grant) => {
            setError(undefined);
            setDecision({ row: asCredential(grant), action: "revoke" });
          }}
        />
      )}
      <Dialog
        open={requesting}
        onOpenChange={(open) => {
          if (!busy) setRequesting(open);
        }}
      >
        <DialogContent aria-describedby={undefined} width="xl">
          <DialogTitle>
            <FormattedMessage id="apiKeys.requestTitle" defaultMessage="Request an API key" />
          </DialogTitle>
          <form
            className="mt-4 flex flex-col gap-4"
            onSubmit={(e) => {
              e.preventDefault();
              requestKey();
            }}
          >
            <label className="flex flex-col gap-1">
              <FormattedMessage id="apiKeys.clientName" defaultMessage="Client name" />
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                maxLength={200}
                required
                placeholder={intl.formatMessage({
                  id: "apiKeys.clientNamePlaceholder",
                  defaultMessage: "Claude Code",
                })}
              />
            </label>
            <fieldset>
              <legend className="mb-2 font-medium">
                <FormattedMessage id="apiKeys.toolsets" defaultMessage="Toolsets" />
              </legend>
              <p className="mb-2 text-sm text-muted">
                <FormattedMessage
                  id="apiKeys.nothingSelected"
                  defaultMessage="Nothing is selected for you."
                />
              </p>
              <div className="grid grid-cols-1 gap-3 @sm/dialog:grid-cols-3">
                {state.policy.toolsetCeiling.map((t) => (
                  <label key={t} className="flex items-center gap-2">
                    <Checkbox
                      checked={toolsets.includes(t)}
                      onCheckedChange={(checked) =>
                        setToolsets((current) =>
                          checked ? [...current, t] : current.filter((v) => v !== t),
                        )
                      }
                    />
                    {toolsetLabel(intl, t)}
                  </label>
                ))}
              </div>
            </fieldset>
            <fieldset className="flex flex-col gap-2">
              <legend className="mb-2 font-medium">
                <FormattedMessage id="apiKeys.scope" defaultMessage="Scope" />
              </legend>
              <label>
                <input
                  type="radio"
                  name="scope"
                  checked={scope === "read"}
                  onChange={() => setScope("read")}
                />{" "}
                <FormattedMessage
                  id="apiKeys.readDescription"
                  defaultMessage="Read. Find and read what you can access."
                />
              </label>
              {!state.policy.readOnly && (
                <label>
                  <input
                    type="radio"
                    name="scope"
                    checked={scope === "write"}
                    onChange={() => setScope("write")}
                  />{" "}
                  <FormattedMessage
                    id="apiKeys.writeDescription"
                    defaultMessage="Write. Every change is recorded as you, via this Client."
                  />
                </label>
              )}
            </fieldset>
            <Note value={note} onChange={setNote} />
            <p className="rounded-button bg-control p-3">
              <FormattedMessage
                id="apiKeys.expiryFact"
                defaultMessage="Expires {days} days after approval. The organization sets this lifetime."
                values={{ days: state.policy.apiKeyLifetimeDays }}
              />
            </p>
            {error && (
              <p role="alert" className="text-status-danger-fg">
                {error}
              </p>
            )}
            <div className="flex justify-end gap-2">
              <Button
                type="button"
                variant="secondary"
                disabled={busy}
                onClick={() => setRequesting(false)}
              >
                <FormattedMessage id="common.cancel" defaultMessage="Cancel" />
              </Button>
              <Button type="submit" disabled={busy || !name.trim() || !toolsets.length || !scope}>
                <FormattedMessage id="apiKeys.send" defaultMessage="Send request" />
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
      {ready && <ApiKeyReadyDialog ready={ready} onClose={() => setReady(undefined)} />}
      <Dialog
        open={!!decision}
        onOpenChange={(open) => {
          if (!open && !busy) setDecision(undefined);
        }}
      >
        <DialogContent aria-describedby={undefined}>
          <DialogTitle>
            {decision?.action === "revoke" ? (
              decision.row.oauthGrant ? (
                <FormattedMessage
                  id="apiKeys.revokeGrantTitle"
                  defaultMessage="Revoke OAuth grant"
                />
              ) : (
                <FormattedMessage id="apiKeys.revokeTitle" defaultMessage="Revoke API key" />
              )
            ) : (
              decision && <FormattedMessage {...actions[decision.action]} />
            )}
          </DialogTitle>
          {decision && (
            <div className="mt-4 flex flex-col gap-4">
              <p>{decision.row.clientName}</p>
              {(decision.action === "approve" || decision.action === "deny") && (
                <Note value={note} onChange={setNote} />
              )}
              {decision.action === "revoke" && (
                <p>
                  {decision.row.oauthGrant ? (
                    <FormattedMessage
                      id="apiKeys.revokeGrantWarning"
                      defaultMessage="This Client will lose access immediately. A new consent is needed to connect again."
                    />
                  ) : (
                    <FormattedMessage
                      id="apiKeys.revokeWarning"
                      defaultMessage="This Client will lose access immediately. You will need a new request for another key."
                    />
                  )}
                </p>
              )}
              {error && (
                <p role="alert" className="text-status-danger-fg">
                  {error}
                </p>
              )}
              <div className="flex justify-end gap-2">
                <Button variant="secondary" disabled={busy} onClick={() => setDecision(undefined)}>
                  <FormattedMessage id="common.cancel" defaultMessage="Cancel" />
                </Button>
                <Button disabled={busy} onClick={decide}>
                  <FormattedMessage {...actions[decision.action]} />
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
function Note({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  return (
    <label className="flex flex-col gap-1">
      <FormattedMessage id="apiKeys.note" defaultMessage="Note (Optional)" />
      <textarea
        className="rounded-button border border-border-default bg-raised p-2.5 text-sm text-primary focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-link"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        maxLength={2000}
        rows={3}
      />
    </label>
  );
}

/** Keeps a once-shown key available when approval happens outside the API keys pane. */
export function ApiKeyReadyDialog({ ready, onClose }: { ready: KeyRow; onClose: () => void }) {
  const intl = useIntl();
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string>();
  const date = (value: string | null) =>
    value ? intl.formatDate(value, { dateStyle: "medium" }) : "—";
  const listToolsets = (row: KeyRow) => row.toolsets.map((t) => toolsetLabel(intl, t)).join(", ");
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent
        aria-describedby={undefined}
        // The key shows this once and the server has already cleared its
        // copy, so a click on the overlay must not throw it away. Esc and
        // Done remain the exits.
        onInteractOutside={(event) => event.preventDefault()}
      >
        <DialogTitle>
          <FormattedMessage id="apiKeys.readyTitle" defaultMessage="Your key is ready" />
        </DialogTitle>
        {ready && (
          <div className="mt-4 flex flex-col gap-4">
            <p>
              <FormattedMessage
                id="apiKeys.once"
                defaultMessage="Approved by {name} on {date}. OpenLaw will not show this key again."
                values={{ name: ready.approvedBy, date: date(ready.decidedAt) }}
              />
            </p>
            <div className="flex items-center gap-2 rounded-button bg-control p-3">
              <code className="min-w-0 flex-1 break-all">{ready.key}</code>
              <Button
                variant="secondary"
                onClick={() => {
                  void navigator.clipboard
                    .writeText(ready.key!)
                    .then(() => setCopied(true))
                    .catch(() =>
                      setError(
                        intl.formatMessage({
                          id: "apiKeys.copyFailed",
                          defaultMessage:
                            "Copy failed. Select and copy the key before closing this dialog.",
                        }),
                      ),
                    );
                }}
              >
                {copied ? (
                  <FormattedMessage id="apiKeys.copied" defaultMessage="Copied" />
                ) : (
                  <FormattedMessage id="apiKeys.copy" defaultMessage="Copy" />
                )}
              </Button>
            </div>
            <dl className="grid grid-cols-2 gap-2">
              <dt>
                <FormattedMessage id="apiKeys.client" defaultMessage="Client" />
              </dt>
              <dd>{ready.clientName}</dd>
              <dt>
                <FormattedMessage id="apiKeys.toolsets" defaultMessage="Toolsets" />
              </dt>
              <dd>{listToolsets(ready)}</dd>
              <dt>
                <FormattedMessage id="apiKeys.scope" defaultMessage="Scope" />
              </dt>
              <dd>
                <Scope scope={ready.scope} />
              </dd>
              <dt>
                <FormattedMessage id="apiKeys.expires" defaultMessage="Expires" />
              </dt>
              <dd>{date(ready.expiresAt)}</dd>
            </dl>
            <p className="text-sm text-muted">
              <FormattedMessage
                id="apiKeys.header"
                defaultMessage="Send this key in the x-api-key header."
              />{" "}
              {/* A new tab, so the guide never unmounts the once-shown
                  key. The same tab would close the dialog before the
                  person copied it, and the key cannot be shown again. */}
              <a
                href="/documentation/connect-headless-client"
                target="_blank"
                rel="noreferrer"
                className="text-link underline"
              >
                <FormattedMessage id="apiKeys.guide" defaultMessage="Connect a headless Client" />{" "}
                <span className="sr-only">
                  <FormattedMessage id="apiKeys.newTab" defaultMessage="(opens in a new tab)" />
                </span>
              </a>
            </p>
            {error && (
              <p role="alert" className="text-status-danger-fg">
                {error}
              </p>
            )}
            <Button onClick={onClose}>
              <FormattedMessage id="apiKeys.done" defaultMessage="Done" />
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
