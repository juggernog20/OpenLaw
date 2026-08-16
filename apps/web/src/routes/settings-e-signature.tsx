// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Organization · Integrations · E-signature (#245), the first pane of
 * the Integrations section (SET-007, superseding CTR-013's placement
 * sentence).
 *
 * It follows the Authentication pane's credential anatomy (TECH-008):
 * one form, write-only secret fields that keep on blank and rotate on
 * paste, a save that applies immediately (SET-003), and a test
 * affordance that answers in place. Two things are its own — the
 * webhook URL the Administrator pastes into DocuSign Connect, shown
 * read-only, and the Connect secret being required rather than
 * optional, because the webhook is this install's first unauthenticated
 * inbound write path.
 *
 * The API's 403 is the real refusal behind the loader's SET-002 bounce.
 */

import {
  useEffect,
  useRef,
  useState,
  type ReactNode,
  type SubmitEvent as FormSubmitEvent,
} from "react";
import { redirect, useLoaderData } from "react-router";
import { FormattedMessage, useIntl } from "react-intl";
import type { paths } from "@openlaw/api-client";
import { api } from "../lib/api";
import { formatShortDate } from "../lib/format";
import { problemDetail } from "../lib/messages";
import { currentUser, needsSetup } from "../lib/session";
import { PageTitle } from "../components/page-title";
import { SettingsCard } from "../components/settings-card";
import { StatusNote, type FieldStatus } from "../components/status-note";
import { Button } from "../components/ui/button";
import { Dialog, DialogContent, DialogTitle } from "../components/ui/dialog";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";
import { Switch } from "../components/ui/switch";

/** The one adapter v1 ships (CTR-013). */
const PROVIDER = "docusign" as const;

type Connector =
  paths["/api/v1/signing-connectors/{provider}"]["get"]["responses"]["200"]["content"]["application/json"]["connector"];

/**
 * The three things on this pane that report separately.
 *
 * `lifecycle` covers the switch and the remove together, because they
 * write the same row and only one of them is ever in flight.
 */
type Field = "connector" | "test" | "lifecycle";

export async function settingsESignatureLoader() {
  const user = await currentUser();
  if (!user) return redirect((await needsSetup()) ? "/auth/setup" : "/auth/login");
  if (user.role !== "administrator") return redirect("/settings/profile");
  const connector = await api.GET("/api/v1/signing-connectors/{provider}", {
    params: { path: { provider: PROVIDER } },
  });
  if (!connector.data) throw new Error("The e-signature connector could not be read.");
  return { connector: connector.data.connector };
}

/** The Integrations section index forwards to its first pane. */
export function settingsIntegrationsIndexLoader() {
  return redirect("/settings/integrations/e-signature");
}

function FormField(props: Readonly<{ id: string; label: ReactNode; children: ReactNode }>) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={props.id}>{props.label}</Label>
      {props.children}
    </div>
  );
}

export function SettingsESignaturePage() {
  const loaded = useLoaderData<typeof settingsESignatureLoader>();
  const intl = useIntl();

  const [connector, setConnector] = useState<Connector>(loaded.connector);
  const [environment, setEnvironment] = useState(connector.environment ?? "demo");
  const [integrationKey, setIntegrationKey] = useState(connector.integrationKey ?? "");
  const [apiUserId, setApiUserId] = useState(connector.apiUserId ?? "");
  // Both secrets are write-only and start blank: an empty field means
  // "keep the stored one", which is the only thing the pane can mean —
  // it never received them.
  const [privateKey, setPrivateKey] = useState("");
  const [webhookSecret, setWebhookSecret] = useState("");
  const [copied, setCopied] = useState(false);
  // "Copied" is a confirmation, not a state the button stays in. The
  // handle is kept so a second copy replaces the first timer and an
  // unmount clears it rather than setting state on a gone component.
  const copiedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (copiedTimer.current) clearTimeout(copiedTimer.current);
    },
    [],
  );

  const [status, setStatus] = useState<Record<Field, FieldStatus>>({
    connector: "idle",
    test: "idle",
    lifecycle: "idle",
  });
  const [detail, setDetail] = useState<Record<Field, string | undefined>>({
    connector: undefined,
    test: undefined,
    lifecycle: undefined,
  });
  const [account, setAccount] = useState<string | null>(null);
  /** Whether the remove confirmation is open. Removing takes both
   * secrets with it, so it is never one click. */
  const [confirmingRemove, setConfirmingRemove] = useState(false);

  /**
   * Whether each write is already out.
   *
   * Refs, not `status`: `status` is state, and state has not
   * re-rendered while the click that set it is still on the stack, so
   * two submits in one tick would both pass a check on it. The buttons
   * below are disabled from `status` as well — that is what the reader
   * sees — and these are what actually stop the second write. A saved
   * connector twice over is one act with two audit entries.
   */
  const saving = useRef(false);
  const testing = useRef(false);
  /** The switch and the remove share one guard: both rewrite the same
   * row, and neither may go out while the other is in flight. */
  const changingLifecycle = useRef(false);

  function note(field: Field, value: FieldStatus, message?: string) {
    setStatus((current) => ({ ...current, [field]: value }));
    setDetail((current) => ({ ...current, [field]: message }));
  }

  async function saveConnector(event: FormSubmitEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (saving.current) return;
    saving.current = true;
    note("connector", "saving");
    // A test result describes the credentials that were stored when it
    // ran; a save can replace them, so the old answer must not linger.
    setAccount(null);
    note("test", "idle");
    try {
      const { data, error } = await api.PUT("/api/v1/signing-connectors/{provider}", {
        params: { path: { provider: PROVIDER } },
        body: {
          environment,
          integrationKey,
          apiUserId,
          // Blank is omitted rather than sent: the API reads both the
          // same way, and not sending is the honest wire shape for
          // "this pane has nothing to say about that secret".
          ...(privateKey === "" ? {} : { privateKey }),
          ...(webhookSecret === "" ? {} : { webhookSecret }),
        },
      });
      if (!data) {
        note("connector", "error", problemDetail(error));
        return;
      }
      setConnector(data.connector);
      setPrivateKey("");
      setWebhookSecret("");
      note("connector", "saved");
    } catch {
      note("connector", "error");
    } finally {
      saving.current = false;
    }
  }

  async function testConnection(): Promise<void> {
    if (testing.current) return;
    testing.current = true;
    note("test", "saving");
    setAccount(null);
    try {
      const { data, error } = await api.POST("/api/v1/signing-connectors/{provider}/test", {
        params: { path: { provider: PROVIDER } },
      });
      if (!data) {
        note("test", "error", problemDetail(error));
        return;
      }
      setAccount(data.accountName);
      note("test", "saved");
    } catch {
      note("test", "error");
    } finally {
      testing.current = false;
    }
  }

  /**
   * Turns the connector off, or back on.
   *
   * Off is not a destructive act — the credentials stay and the switch
   * comes back — so it commits on the click with no confirmation, the
   * way every other switch in Settings does.
   */
  async function setEnabled(next: boolean): Promise<void> {
    if (changingLifecycle.current) return;
    changingLifecycle.current = true;
    note("lifecycle", "saving");
    // A test result describes a connector that was answering. Turning
    // it off makes that answer stale, so it goes with the switch.
    setAccount(null);
    note("test", "idle");
    try {
      const { data, error } = await api.POST(
        next
          ? "/api/v1/signing-connectors/{provider}/enable"
          : "/api/v1/signing-connectors/{provider}/disable",
        { params: { path: { provider: PROVIDER } } },
      );
      if (!data) {
        note("lifecycle", "error", problemDetail(error));
        return;
      }
      setConnector(data.connector);
      note("lifecycle", "saved");
    } catch {
      note("lifecycle", "error");
    } finally {
      changingLifecycle.current = false;
    }
  }

  /**
   * Takes the connector out.
   *
   * The API refuses while any envelope is still out and says how many,
   * so the pane reports that refusal rather than pre-empting it: the
   * count it would have to draw is a fact only the seam holds, and one
   * it can hold correctly under a lock.
   *
   * **The dialog closes either way**, which is the whole reason the
   * refusal is worth anything. The refusal is drawn by the pane's own
   * status note, and that note sits behind the dialog overlay — so a
   * dialog left open on a refusal shows the Administrator nothing at
   * all, on the one path this control exists to handle.
   */
  async function removeConnector(): Promise<void> {
    if (changingLifecycle.current) return;
    changingLifecycle.current = true;
    note("lifecycle", "saving");
    setAccount(null);
    note("test", "idle");
    try {
      const { data, error } = await api.DELETE("/api/v1/signing-connectors/{provider}", {
        params: { path: { provider: PROVIDER } },
      });
      if (!data) {
        note("lifecycle", "error", problemDetail(error));
        return;
      }
      setConnector(data.connector);
      // Back to a blank form, because this install is back to having
      // no connector — leaving the old key in the boxes would invite
      // saving it again by reflex.
      setEnvironment("demo");
      setIntegrationKey("");
      setApiUserId("");
      setPrivateKey("");
      setWebhookSecret("");
      note("connector", "idle");
      note("lifecycle", "saved");
    } catch {
      note("lifecycle", "error");
    } finally {
      changingLifecycle.current = false;
      // In `finally`, so the refusal path and the thrown path close it
      // too. See the note above: the reason is drawn behind the overlay.
      setConfirmingRemove(false);
    }
  }

  async function copyWebhookUrl(): Promise<void> {
    if (copiedTimer.current) clearTimeout(copiedTimer.current);
    try {
      await navigator.clipboard.writeText(connector.webhookUrl);
      setCopied(true);
      copiedTimer.current = setTimeout(() => setCopied(false), 2000);
    } catch {
      // A browser that refuses the clipboard leaves the field on
      // screen to select by hand — there is nothing to report.
      setCopied(false);
    }
  }

  return (
    <>
      <PageTitle
        title={intl.formatMessage({
          id: "settings.eSignature.title",
          defaultMessage: "E-signature",
        })}
      />
      <SettingsCard
        title={<FormattedMessage id="settings.eSignature.docusign" defaultMessage="DocuSign" />}
      >
        <p className="text-sm text-muted">
          <FormattedMessage
            id="settings.eSignature.intro"
            defaultMessage="Connect your DocuSign account so contracts are sent for signature from their records. Without a connector, the manual path still works: upload the executed PDF and pin it by hand."
          />
        </p>
        <form className="flex flex-col gap-3" onSubmit={(event) => void saveConnector(event)}>
          <FormField
            id="ds-environment"
            label={
              <FormattedMessage id="settings.eSignature.environment" defaultMessage="Environment" />
            }
          >
            <select
              id="ds-environment"
              value={environment}
              onChange={(event) => setEnvironment(event.target.value as "demo" | "production")}
              className="h-8 w-80 max-w-full rounded-button border border-border-default bg-raised px-2 text-sm text-primary focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-link"
            >
              <option value="demo">
                {intl.formatMessage({
                  id: "settings.eSignature.environment.demo",
                  defaultMessage: "Demo",
                })}
              </option>
              <option value="production">
                {intl.formatMessage({
                  id: "settings.eSignature.environment.production",
                  defaultMessage: "Production",
                })}
              </option>
            </select>
          </FormField>
          <FormField
            id="ds-integration-key"
            label={
              <FormattedMessage
                id="settings.eSignature.integrationKey"
                defaultMessage="Integration key"
              />
            }
          >
            <Input
              id="ds-integration-key"
              className="w-80"
              required
              value={integrationKey}
              onChange={(event) => setIntegrationKey(event.target.value)}
            />
          </FormField>
          <FormField
            id="ds-user-id"
            label={<FormattedMessage id="settings.eSignature.userId" defaultMessage="User ID" />}
          >
            <Input
              id="ds-user-id"
              className="w-80"
              required
              value={apiUserId}
              onChange={(event) => setApiUserId(event.target.value)}
            />
            <p className="text-xs text-muted">
              <FormattedMessage
                id="settings.eSignature.userId.hint"
                defaultMessage="The DocuSign user envelopes are sent as. Grant that user consent to the integration once, from the DocuSign console."
              />
            </p>
          </FormField>
          <FormField
            id="ds-private-key"
            label={
              <FormattedMessage
                id="settings.eSignature.privateKey"
                defaultMessage="RSA private key"
              />
            }
          >
            <textarea
              id="ds-private-key"
              rows={4}
              required={!connector.hasPrivateKey}
              value={privateKey}
              onChange={(event) => setPrivateKey(event.target.value)}
              placeholder={intl.formatMessage({
                id: "settings.eSignature.privateKey.placeholder",
                defaultMessage: "-----BEGIN RSA PRIVATE KEY-----",
              })}
              className="w-80 rounded-button border border-border-default bg-raised px-2.5 py-1.5 text-sm text-primary placeholder:text-muted focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-link"
            />
            {connector.hasPrivateKey && (
              <p className="text-xs text-muted">
                <FormattedMessage
                  id="settings.eSignature.secret.hint"
                  defaultMessage="Leave blank to keep the current value. Paste a new one to rotate."
                />
              </p>
            )}
          </FormField>
          <FormField
            id="ds-webhook-secret"
            label={
              <FormattedMessage
                id="settings.eSignature.webhookSecret"
                defaultMessage="Connect HMAC secret"
              />
            }
          >
            <Input
              id="ds-webhook-secret"
              className="w-80"
              type="password"
              required={!connector.hasWebhookSecret}
              value={webhookSecret}
              onChange={(event) => setWebhookSecret(event.target.value)}
              placeholder={intl.formatMessage({
                id: "settings.eSignature.secretPlaceholder",
                // A visual mask, not copy — but it still rides the
                // catalog so a locale can swap the glyph.
                defaultMessage: "••••••••••••••••",
              })}
            />
            <p className="text-xs text-muted">
              {connector.hasWebhookSecret ? (
                <FormattedMessage
                  id="settings.eSignature.secret.hint"
                  defaultMessage="Leave blank to keep the current value. Paste a new one to rotate."
                />
              ) : (
                <FormattedMessage
                  id="settings.eSignature.webhookSecret.hint"
                  defaultMessage="Required. OpenLaw checks it on every delivery, so nothing unsigned can change a record."
                />
              )}
            </p>
          </FormField>
          <div className="flex items-center gap-2">
            <Button
              type="submit"
              variant="secondary"
              size="sm"
              disabled={status.connector === "saving"}
            >
              <FormattedMessage id="settings.eSignature.save" defaultMessage="Save connector" />
            </Button>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              disabled={!connector.configured || status.test === "saving"}
              onClick={() => void testConnection()}
            >
              <FormattedMessage id="settings.eSignature.test" defaultMessage="Test connection" />
            </Button>
            <StatusNote status={status.connector} detail={detail.connector} />
          </div>
          <p aria-live="polite" className="text-sm">
            {status.test === "saving" && (
              <span className="text-muted">
                <FormattedMessage
                  id="settings.eSignature.testing"
                  defaultMessage="Testing the connection…"
                />
              </span>
            )}
            {status.test === "saved" && account !== null && (
              <span className="text-status-success-fg">
                <FormattedMessage
                  id="settings.eSignature.connected"
                  defaultMessage="Connected to {account}."
                  values={{ account }}
                />
              </span>
            )}
            {status.test === "error" && (
              <span className="text-status-danger-fg">
                {detail.test ?? (
                  <FormattedMessage
                    id="settings.eSignature.testFailed"
                    defaultMessage="The connection test failed. Check the credentials and try again."
                  />
                )}
              </span>
            )}
          </p>
        </form>

        <div className="flex flex-col gap-1.5 border-t border-border-default pt-4">
          <Label htmlFor="ds-webhook-url">
            <FormattedMessage id="settings.eSignature.webhookUrl" defaultMessage="Webhook URL" />
          </Label>
          <div className="flex gap-2">
            <Input id="ds-webhook-url" className="w-80" readOnly value={connector.webhookUrl} />
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={() => void copyWebhookUrl()}
            >
              {copied ? (
                <FormattedMessage id="action.copied" defaultMessage="Copied" />
              ) : (
                <FormattedMessage id="action.copy" defaultMessage="Copy" />
              )}
            </Button>
          </div>
          <p className="text-xs text-muted">
            <FormattedMessage
              id="settings.eSignature.webhookUrl.hint"
              defaultMessage="Paste this into a DocuSign Connect configuration so envelope status reaches this install."
            />
          </p>
        </div>

        {/* The connector's own lifecycle. Drawn only on a configured
            install, the DES-035 absence rule: there is nothing to turn
            off or take out until there is a connector. */}
        {connector.configured && (
          <div className="flex flex-col gap-4 border-t border-border-default pt-4">
            <div className="flex items-start gap-3">
              <Switch
                id="ds-enabled"
                checked={connector.enabled}
                disabled={status.lifecycle === "saving"}
                onCheckedChange={(next) => void setEnabled(next)}
                aria-labelledby="ds-enabled-label"
                aria-describedby="ds-enabled-hint"
              />
              <div className="flex flex-col gap-1">
                <Label id="ds-enabled-label" htmlFor="ds-enabled">
                  <FormattedMessage
                    id="settings.eSignature.enabled"
                    defaultMessage="Send for signature from records"
                  />
                </Label>
                <p id="ds-enabled-hint" className="text-xs text-muted">
                  {/* Branching on the timestamp rather than on the
                      flag: the two say the same thing, and this one
                      carries the date the copy needs. */}
                  {connector.disabledAt === null ? (
                    <FormattedMessage
                      id="settings.eSignature.enabled.on"
                      defaultMessage="Turn this off to go back to the manual path without losing the credentials. Records stop offering the send, and rounds already out stand still until you turn it back on."
                    />
                  ) : (
                    <FormattedMessage
                      id="settings.eSignature.enabled.off"
                      defaultMessage="Off since {when}. Records show the manual path, and rounds already out stand still until you turn this back on."
                      values={{ when: formatShortDate(connector.disabledAt) }}
                    />
                  )}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Button
                type="button"
                variant="secondary"
                size="sm"
                disabled={status.lifecycle === "saving"}
                onClick={() => setConfirmingRemove(true)}
              >
                <FormattedMessage
                  id="settings.eSignature.remove"
                  defaultMessage="Remove connector"
                />
              </Button>
              <StatusNote status={status.lifecycle} detail={detail.lifecycle} />
            </div>
          </div>
        )}
      </SettingsCard>
      {confirmingRemove && (
        <RemoveConnectorDialog
          busy={status.lifecycle === "saving"}
          onClose={() => setConfirmingRemove(false)}
          onConfirm={() => void removeConnector()}
        />
      )}
    </>
  );
}

/**
 * The confirmation on taking the connector out.
 *
 * A dialog rather than a second click on the same button, because this
 * is the one control on the pane that destroys something: both secrets
 * go with the row, and re-connecting means asking DocuSign for them
 * again. The button says what it does rather than "OK".
 *
 * It names the switch, because the switch is what most people who reach
 * this button actually want — the reversible way to stop sending.
 */
function RemoveConnectorDialog({
  busy,
  onClose,
  onConfirm,
}: Readonly<{ busy: boolean; onClose: () => void; onConfirm: () => void }>) {
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent aria-describedby={undefined}>
        <DialogTitle>
          <FormattedMessage
            id="settings.eSignature.removeTitle"
            defaultMessage="Remove the DocuSign connector"
          />
        </DialogTitle>
        <div className="mt-4 flex flex-col gap-4">
          <p className="text-sm text-muted">
            <FormattedMessage
              id="settings.eSignature.removeBody"
              defaultMessage="The RSA key and the Connect secret are deleted with the connector. Reconnecting means pasting both again. Records go back to the manual path."
            />
          </p>
          <p className="text-sm text-muted">
            <FormattedMessage
              id="settings.eSignature.removeAlternative"
              defaultMessage="To stop sending and keep the credentials, turn the connector off instead."
            />
          </p>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="secondary" onClick={onClose}>
              <FormattedMessage id="action.cancel" defaultMessage="Cancel" />
            </Button>
            <Button type="button" variant="danger" disabled={busy} onClick={onConfirm}>
              <FormattedMessage id="settings.eSignature.remove" defaultMessage="Remove connector" />
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
