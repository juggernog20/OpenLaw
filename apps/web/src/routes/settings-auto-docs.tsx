// SPDX-License-Identifier: AGPL-3.0-only

/** ADO-008: Administrators maintain the default acknowledgement statement. */
import { useState } from "react";
import { FormattedMessage, useIntl } from "react-intl";
import { redirect, useLoaderData } from "react-router";
import { api } from "../lib/api";
import { requireUser } from "../lib/session";
import { TEXTAREA_CLASS } from "../lib/form-controls";
import { PageTitle } from "../components/page-title";
import { Button } from "../components/ui/button";

export async function settingsAutoDocsLoader() {
  const user = await requireUser();
  if (user.role !== "administrator") return redirect("/settings/profile");
  const result = await api.GET("/api/v1/auto-docs/settings");
  if (!result.data) throw new Error("Auto-Docs settings could not be read.");
  return result.data;
}
export function SettingsAutoDocsPage() {
  const loaded = useLoaderData<typeof settingsAutoDocsLoader>();
  const [text, setText] = useState(loaded.acknowledgementText);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string>();
  const intl = useIntl();
  const title = intl.formatMessage({
    id: "portal.navigation.autoDocs",
    defaultMessage: "Auto-Docs",
  });
  async function save() {
    if (busy) return;
    setBusy(true);
    setSaved(false);
    setError(undefined);
    const result = await api
      .PUT("/api/v1/auto-docs/settings", { body: { acknowledgementText: text } })
      .catch(() => undefined);
    setBusy(false);
    if (result?.data) {
      setText(result.data.acknowledgementText);
      setSaved(true);
    } else
      setError(
        result?.error?.detail ??
          intl.formatMessage({
            id: "autoDocs.settingsFailed",
            defaultMessage: "Could not save these settings. Try again.",
          }),
      );
  }
  return (
    <div className="max-w-2xl space-y-6">
      <PageTitle title={title} />
      <h1 className="text-xl font-semibold">{title}</h1>
      <p className="text-muted">
        <FormattedMessage
          id="settings.autoDocs.acknowledgementHelp"
          defaultMessage="This is the default statement Business Users acknowledge before generating an Auto-Doc. Each Auto-Doc can use its own text and frequency. Editing the text requires a new acknowledgement."
        />
      </p>
      <form
        className="space-y-4"
        onSubmit={(event) => {
          event.preventDefault();
          void save();
        }}
      >
        <label className="block space-y-1">
          <span>
            <FormattedMessage
              id="settings.autoDocs.defaultAcknowledgementText"
              defaultMessage="Default acknowledgement text"
            />
          </span>
          <textarea
            className={TEXTAREA_CLASS}
            required
            maxLength={10_000}
            value={text}
            disabled={busy}
            onChange={(event) => {
              setText(event.target.value);
              setSaved(false);
            }}
          />
        </label>
        {error && (
          <p role="alert" className="text-status-danger-fg">
            {error}
          </p>
        )}
        {saved && (
          <p role="status">
            <FormattedMessage id="autoDocs.settingsSaved" defaultMessage="Settings saved." />
          </p>
        )}
        <Button type="submit" disabled={busy || !text.trim()}>
          <FormattedMessage id="autoDocs.saveSettings" defaultMessage="Save settings" />
        </Button>
      </form>
    </div>
  );
}
