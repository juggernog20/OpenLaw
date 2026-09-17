// SPDX-License-Identifier: AGPL-3.0-only

import { useRef, useState, type SubmitEvent as FormSubmitEvent } from "react";
import { redirect, useLoaderData } from "react-router";
import { FormattedMessage, useIntl } from "react-intl";
import { api } from "../lib/api";
import { problem } from "../lib/problem";
import { requireUser } from "../lib/session";
import { PageTitle } from "../components/page-title";
import { SettingsCard } from "../components/settings-card";
import { SmtpSettingsFields, readSmtpSettings } from "../components/smtp-settings-fields";
import { Alert } from "../components/ui/alert";
import { Button } from "../components/ui/button";

export async function settingsEmailLoader() {
  const user = await requireUser();
  if (user.role !== "administrator") return redirect("/settings/profile");
  const { data } = await api.GET("/api/v1/email-settings");
  if (!data) throw new Error("The email settings could not be read.");
  return data;
}

export function SettingsEmailPage() {
  const intl = useIntl();
  const loaded = useLoaderData<typeof settingsEmailLoader>();
  const [state, setState] = useState(loaded);
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const pending = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  async function run(action: () => Promise<void>) {
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await action();
    } catch {
      setError(
        intl.formatMessage({
          id: "settings.email.networkError",
          defaultMessage: "The server could not be reached. Try again.",
        }),
      );
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }
  async function save(event: FormSubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    const body = readSmtpSettings(new FormData(event.currentTarget));
    await run(async () => {
      const result = await api.PUT("/api/v1/email-settings", { body });
      if (result.data) {
        setState(result.data);
        setEditing(false);
        setNotice(
          intl.formatMessage({
            id: "welcome.email.saved",
            defaultMessage: "Relay saved. The next email this instance sends will use it.",
          }),
        );
      } else
        setError(
          (await problem(result)).detail ??
            intl.formatMessage({
              id: "welcome.email.error.save",
              defaultMessage: "The relay could not be saved.",
            }),
        );
    });
  }
  async function test() {
    await run(async () => {
      const result = await api.POST("/api/v1/email-settings/test");
      if (result.data)
        setNotice(
          intl.formatMessage(
            {
              id: "welcome.email.testSent",
              defaultMessage: "Test email sent to {email}. Check your inbox.",
            },
            { email: result.data.to },
          ),
        );
      else
        setError(
          (await problem(result)).detail ??
            intl.formatMessage({
              id: "welcome.email.error.test",
              defaultMessage: "The test email could not be sent.",
            }),
        );
    });
  }
  const title = intl.formatMessage({
    id: "settings.section.email",
    defaultMessage: "Outbound email",
  });
  return (
    <>
      <PageTitle title={title} />
      <SettingsCard title={title}>
        <div className="flex flex-col gap-4">
          {error && <Alert variant="danger">{error}</Alert>}
          {notice && <Alert variant="success">{notice}</Alert>}
          {state.source === "env" && (
            <Alert variant="warning">
              <FormattedMessage
                id="settings.email.environment"
                defaultMessage="Managed by your deployment configuration. Contact your system administrator to change the relay."
              />
            </Alert>
          )}
          {state.fromAddress && (
            <p className="text-sm text-primary">
              <FormattedMessage
                id="settings.email.sender"
                defaultMessage="Sender: {from}"
                values={{ from: state.fromAddress }}
              />
            </p>
          )}
          {state.source === "env" && !state.fromAddress && (
            <Alert variant="danger">
              <FormattedMessage
                id="welcome.email.env.incomplete"
                defaultMessage="The deployment environment sets SMTP_URL but not SMTP_FROM, so mail cannot be sent. Set SMTP_FROM in the environment."
              />
            </Alert>
          )}
          {(state.source === "unset" || editing) && (
            <form onSubmit={(event) => void save(event)} className="flex flex-col gap-4">
              <SmtpSettingsFields disabled={busy} />
              <div className="flex justify-end gap-2">
                {editing && (
                  <Button
                    type="button"
                    variant="ghost"
                    disabled={busy}
                    onClick={() => {
                      setEditing(false);
                      setError(null);
                    }}
                  >
                    <FormattedMessage id="action.cancel" defaultMessage="Cancel" />
                  </Button>
                )}
                <Button type="submit" disabled={busy}>
                  <FormattedMessage id="welcome.email.save" defaultMessage="Save relay" />
                </Button>
              </div>
            </form>
          )}
          {state.source !== "unset" && !editing && (
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                variant="secondary"
                disabled={busy || !state.fromAddress}
                onClick={() => void test()}
              >
                <FormattedMessage id="welcome.email.test" defaultMessage="Send test email" />
              </Button>
              {state.source === "app" && (
                <Button
                  type="button"
                  variant="secondary"
                  disabled={busy}
                  onClick={() => {
                    setEditing(true);
                    setError(null);
                    setNotice(null);
                  }}
                >
                  <FormattedMessage id="welcome.email.replace" defaultMessage="Replace relay" />
                </Button>
              )}
            </div>
          )}
        </div>
      </SettingsCard>
    </>
  );
}
