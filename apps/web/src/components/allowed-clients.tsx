// SPDX-License-Identifier: AGPL-3.0-only
import { useRef, useState } from "react";
import { FormattedMessage, useIntl } from "react-intl";
import { Bot } from "lucide-react";
import type { paths } from "@openlaw/api-client";
import { api } from "../lib/api";
import { SettingsCard } from "./settings-card";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Switch } from "./ui/switch";
import { Dialog, DialogContent, DialogTitle } from "./ui/dialog";

type Client =
  paths["/api/v1/mcp-settings/allowed-clients"]["get"]["responses"][200]["content"]["application/json"][number];
export function AllowedClients({
  initial,
  dynamicEnabled,
  policyBusy,
  onDynamicChange,
}: {
  initial: Client[];
  dynamicEnabled: boolean;
  policyBusy: boolean;
  onDynamicChange: (enabled: boolean) => void;
}) {
  const intl = useIntl();
  const [clients, setClients] = useState(initial);
  const [editing, setEditing] = useState<Client | "new">();
  const [name, setName] = useState("");
  const [callbacks, setCallbacks] = useState<string[]>([""]);
  const [busy, setBusy] = useState(false);
  const saving = useRef(false);
  const [error, setError] = useState<string>();
  const [ready, setReady] = useState<{ name: string; clientId: string; secret: string }>();
  const [copied, setCopied] = useState(false);
  async function run(work: () => Promise<void>) {
    if (saving.current) return;
    saving.current = true;
    setBusy(true);
    setError(undefined);
    try {
      await work();
    } catch {
      setError(
        intl.formatMessage({
          id: "allowedClients.failed",
          defaultMessage: "The Client could not be saved. Check the callback URLs and try again.",
        }),
      );
    } finally {
      saving.current = false;
      setBusy(false);
    }
  }
  function edit(client: Client | "new") {
    setError(undefined);
    setEditing(client);
    setName(client === "new" ? "" : client.name);
    setCallbacks(client === "new" ? [""] : [...client.callbackUrls]);
  }
  async function refresh() {
    const result = await api.GET("/api/v1/mcp-settings/allowed-clients");
    if (!result.data) throw new Error("read failed");
    setClients(result.data);
  }
  async function save() {
    const body = {
      name,
      callbackUrls: callbacks
        .map((value) => value.trim())
        .filter((value, index) => value || (editing !== "new" && editing?.seeded && index === 2)),
    };
    if (editing === "new") {
      const result = await api.POST("/api/v1/mcp-settings/allowed-clients", { body });
      if (!result.data) throw new Error("create failed");
      setClients((rows) => [...rows, result.data!]);
      setEditing(result.data);
    } else if (editing) {
      const result = await api.PATCH("/api/v1/mcp-settings/allowed-clients/{id}", {
        params: { path: { id: editing.id } },
        body,
      });
      if (!result.data) throw new Error("update failed");
      setClients((rows) => rows.map((row) => (row.id === editing.id ? result.data! : row)));
      setEditing(undefined);
    }
  }
  const caption = (client: Client) =>
    client.kind === "published"
      ? client.metadataUrl
      : client.registeredByClient
        ? intl.formatMessage({
            id: "allowedClients.selfRegistered",
            defaultMessage: "Registered by the Client",
          })
        : client.secretGeneratedAt
          ? intl.formatMessage(
              { id: "allowedClients.secretDate", defaultMessage: "Secret generated {date}" },
              { date: intl.formatDate(client.secretGeneratedAt, { dateStyle: "medium" }) },
            )
          : intl.formatMessage({
              id: "allowedClients.noSecret",
              defaultMessage: "No secret generated",
            });
  return (
    <>
      <SettingsCard
        title={<FormattedMessage id="allowedClients.title" defaultMessage="Allowed Clients" />}
        collapsible
        actions={
          <Button variant="secondary" disabled={busy} onClick={() => edit("new")}>
            <FormattedMessage id="allowedClients.add" defaultMessage="Add Client" />
          </Button>
        }
      >
        <div className="divide-y divide-border-default">
          {clients.map((client) => (
            <div key={client.id} className="flex flex-wrap items-center gap-3 py-3">
              <div className="flex size-9 shrink-0 items-center justify-center rounded-button bg-control text-muted">
                <Bot size={16} aria-hidden="true" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 font-medium">
                  {client.name}
                  <span className="rounded-full bg-control px-2 py-0.5 text-xs text-muted">
                    {client.kind === "published" ? (
                      <FormattedMessage
                        id="allowedClients.published"
                        defaultMessage="Published identity"
                      />
                    ) : (
                      <FormattedMessage
                        id="allowedClients.registered"
                        defaultMessage="Registered client"
                      />
                    )}
                  </span>
                </div>
                <div className="text-sm break-words text-muted">{caption(client)}</div>
              </div>
              <Switch
                checked={client.enabled}
                disabled={busy}
                aria-label={intl.formatMessage(
                  { id: "allowedClients.enable", defaultMessage: "Enable {client}" },
                  { client: client.name },
                )}
                onCheckedChange={(enabled) =>
                  void run(async () => {
                    const result = await api.PATCH("/api/v1/mcp-settings/allowed-clients/{id}", {
                      params: { path: { id: client.id } },
                      body: { enabled },
                    });
                    if (!result.data) throw new Error("toggle failed");
                    setClients((rows) =>
                      rows.map((row) => (row.id === client.id ? result.data! : row)),
                    );
                  })
                }
              />
              {client.kind === "registered" && (
                <Button
                  variant="secondary"
                  disabled={busy}
                  aria-label={intl.formatMessage(
                    { id: "allowedClients.editNamed", defaultMessage: "Edit {client}" },
                    { client: client.name },
                  )}
                  onClick={() => edit(client)}
                >
                  <FormattedMessage id="allowedClients.edit" defaultMessage="Edit" />
                </Button>
              )}
            </div>
          ))}
          <div className="flex items-center gap-3 py-3">
            <div className="flex-1">
              <label htmlFor="dynamic-client-registration" className="font-medium">
                <FormattedMessage
                  id="allowedClients.dynamic"
                  defaultMessage="Dynamic client registration"
                />
              </label>
              <p className="text-sm text-muted">
                <FormattedMessage
                  id="allowedClients.dynamicHelp"
                  defaultMessage="The protocol deprecates dynamic client registration. A registered Client does not need it."
                />
              </p>
            </div>
            <Switch
              id="dynamic-client-registration"
              checked={dynamicEnabled}
              disabled={policyBusy}
              onCheckedChange={onDynamicChange}
            />
          </div>
        </div>
        {error && !editing && !ready && (
          <p role="alert" className="text-status-danger-fg">
            {error}
          </p>
        )}
      </SettingsCard>
      <Dialog
        open={!!editing}
        onOpenChange={(open) => {
          if (!open && !busy) setEditing(undefined);
        }}
      >
        <DialogContent aria-describedby={undefined}>
          <DialogTitle>
            {editing === "new" ? (
              <FormattedMessage id="allowedClients.add" defaultMessage="Add Client" />
            ) : (
              <FormattedMessage id="allowedClients.editTitle" defaultMessage="Edit Client" />
            )}
          </DialogTitle>
          <form
            className="mt-4 flex flex-col gap-4"
            onSubmit={(event) => {
              event.preventDefault();
              void run(save);
            }}
          >
            <label>
              <FormattedMessage id="allowedClients.name" defaultMessage="Client name" />
              <Input
                required
                maxLength={200}
                value={name}
                disabled={busy}
                onChange={(event) => setName(event.target.value)}
              />
            </label>
            {editing && editing !== "new" && (
              <div>
                <FormattedMessage id="allowedClients.clientId" defaultMessage="Client id" />
                <code className="block break-all rounded-button bg-control p-3">
                  {editing.clientId ??
                    intl.formatMessage({
                      id: "allowedClients.notGenerated",
                      defaultMessage: "Generate a secret to create the client id.",
                    })}
                </code>
              </div>
            )}
            <fieldset className="flex flex-col gap-2" disabled={busy}>
              <legend>
                <FormattedMessage id="allowedClients.callbacks" defaultMessage="Callback URLs" />
              </legend>
              {callbacks.map((value, index) => (
                <Input
                  key={index}
                  type="url"
                  aria-label={intl.formatMessage(
                    { id: "allowedClients.callback", defaultMessage: "Callback URL {number}" },
                    { number: index + 1 },
                  )}
                  value={value}
                  readOnly={editing !== "new" && !!editing?.seeded && index < 2}
                  onChange={(event) =>
                    setCallbacks((rows) =>
                      rows.map((row, i) => (i === index ? event.target.value : row)),
                    )
                  }
                />
              ))}
              <Button
                type="button"
                variant="secondary"
                onClick={() => setCallbacks((rows) => [...rows, ""])}
              >
                <FormattedMessage
                  id="allowedClients.addCallback"
                  defaultMessage="Add callback URL"
                />
              </Button>
            </fieldset>
            {editing && editing !== "new" && (
              <Button
                type="button"
                variant="secondary"
                disabled={busy}
                onClick={() =>
                  void run(async () => {
                    const result = await api.POST(
                      "/api/v1/mcp-settings/allowed-clients/{id}/secret",
                      { params: { path: { id: editing.id } } },
                    );
                    if (!result.data) throw new Error("secret failed");
                    setReady({ name: editing.name, ...result.data });
                    setCopied(false);
                    setEditing(undefined);
                    await refresh();
                  })
                }
              >
                {editing.secretGeneratedAt ? (
                  <FormattedMessage id="allowedClients.rotate" defaultMessage="Rotate secret" />
                ) : (
                  <FormattedMessage id="allowedClients.generate" defaultMessage="Generate secret" />
                )}
              </Button>
            )}
            {editing && editing !== "new" && !editing.seeded && (
              <Button
                type="button"
                variant="secondary"
                disabled={busy}
                onClick={() =>
                  void run(async () => {
                    const result = await api.DELETE("/api/v1/mcp-settings/allowed-clients/{id}", {
                      params: { path: { id: editing.id } },
                    });
                    if (!result.response.ok) throw new Error("delete failed");
                    setClients((rows) => rows.filter((row) => row.id !== editing.id));
                    setEditing(undefined);
                  })
                }
              >
                <FormattedMessage id="allowedClients.delete" defaultMessage="Delete Client" />
              </Button>
            )}
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
                onClick={() => setEditing(undefined)}
              >
                <FormattedMessage id="allowedClients.cancel" defaultMessage="Cancel" />
              </Button>
              <Button type="submit" disabled={busy}>
                <FormattedMessage id="allowedClients.save" defaultMessage="Save" />
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
      <Dialog
        open={!!ready}
        onOpenChange={(open) => {
          if (!open) setReady(undefined);
        }}
      >
        <DialogContent
          aria-describedby={undefined}
          onInteractOutside={(event) => event.preventDefault()}
        >
          <DialogTitle>
            <FormattedMessage
              id="allowedClients.ready"
              defaultMessage="Your Client secret is ready"
            />
          </DialogTitle>
          {ready && (
            <div className="mt-4 flex flex-col gap-4">
              <p>
                <FormattedMessage
                  id="allowedClients.once"
                  defaultMessage="OpenLaw will not show this secret again. Rotation invalidates the old secret at once and leaves grants in place."
                />
              </p>
              <div className="flex items-center gap-2 rounded-button bg-control p-3">
                <code className="min-w-0 flex-1 break-all">{ready.secret}</code>
                <Button
                  variant="secondary"
                  onClick={() =>
                    void navigator.clipboard
                      .writeText(ready.secret)
                      .then(() => setCopied(true))
                      .catch(() =>
                        setError(
                          intl.formatMessage({
                            id: "allowedClients.copyFailed",
                            defaultMessage:
                              "Copy failed. Select and copy the secret before closing this dialog.",
                          }),
                        ),
                      )
                  }
                >
                  {copied ? (
                    <FormattedMessage id="allowedClients.copied" defaultMessage="Copied" />
                  ) : (
                    <FormattedMessage id="allowedClients.copy" defaultMessage="Copy" />
                  )}
                </Button>
              </div>
              <dl className="grid grid-cols-2 gap-2">
                <dt>
                  <FormattedMessage id="allowedClients.name" defaultMessage="Client name" />
                </dt>
                <dd>{ready.name}</dd>
                <dt>
                  <FormattedMessage id="allowedClients.clientId" defaultMessage="Client id" />
                </dt>
                <dd className="break-all font-mono">{ready.clientId}</dd>
              </dl>
              {error && (
                <p role="alert" className="text-status-danger-fg">
                  {error}
                </p>
              )}
              <Button className="self-end" onClick={() => setReady(undefined)}>
                <FormattedMessage id="allowedClients.done" defaultMessage="Done" />
              </Button>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
