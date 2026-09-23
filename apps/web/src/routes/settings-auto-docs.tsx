// SPDX-License-Identifier: AGPL-3.0-only

/** ADO-008: Administrators maintain the acknowledgement policy and default statement. */
import { AutoResizeTextarea } from "../components/auto-resize-textarea";
import { useState } from "react";
import { FormattedMessage, useIntl } from "react-intl";
import { redirect, useLoaderData } from "react-router";
import { api } from "../lib/api";
import { requireUser } from "../lib/session";
import { CONTROL_CLASS, TEXTAREA_CLASS } from "../lib/form-controls";
import { PageTitle } from "../components/page-title";
import { Button } from "../components/ui/button";
import { Label } from "../components/ui/label";

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
  const [frequency, setFrequency] = useState(loaded.acknowledgementFrequency);
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
      .PUT("/api/v1/auto-docs/settings", {
        body: { acknowledgementText: text, acknowledgementFrequency: frequency },
      })
      .catch(() => undefined);
    setBusy(false);
    if (result?.data) {
      setText(result.data.acknowledgementText);
      setFrequency(result.data.acknowledgementFrequency);
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
      <div className="space-y-2 text-muted">
        <p>
          <FormattedMessage
            id="settings.autoDocs.acknowledgementHelp"
            defaultMessage='Choose how often Business Users must acknowledge the "Auto-Doc disclaimer statement" before generating documents.'
          />
        </p>
        <ul className="list-disc space-y-1 ps-5">
          <li>
            <FormattedMessage
              id="settings.autoDocs.acknowledgementHelp.frequency"
              defaultMessage="This frequency applies to all Auto-Docs."
            />
          </li>
          <li>
            <FormattedMessage
              id="settings.autoDocs.acknowledgementHelp.ownText"
              defaultMessage="Each Auto-Doc can use its own text."
            />
          </li>
          <li>
            <FormattedMessage
              id="settings.autoDocs.acknowledgementHelp.newText"
              defaultMessage="Changing the text requires a new acknowledgement."
            />
          </li>
        </ul>
      </div>
      <form
        className="space-y-4"
        onSubmit={(event) => {
          event.preventDefault();
          void save();
        }}
      >
        <div className="space-y-1">
          <Label
            htmlFor="acknowledgement-frequency"
            help={
              <FormattedMessage
                id="settings.autoDocs.acknowledgementScopeHelp"
                defaultMessage="When acknowledgement is required, a person must accept each distinct statement, including any custom text on an Auto-Doc."
              />
            }
          >
            <FormattedMessage
              id="settings.autoDocs.acknowledgementFrequency"
              defaultMessage="Acknowledgement frequency"
            />
          </Label>
          <select
            id="acknowledgement-frequency"
            className={CONTROL_CLASS}
            value={frequency}
            disabled={busy}
            onChange={(event) => {
              const value = event.target.value;
              if (
                value === "none" ||
                value === "every_use" ||
                value === "once_per_auto_doc" ||
                value === "once"
              ) {
                setFrequency(value);
                setSaved(false);
              }
            }}
          >
            {(["none", "every_use", "once_per_auto_doc", "once"] as const).map((frequency) => (
              <option key={frequency} value={frequency}>
                {intl.formatMessage(
                  {
                    id: "settings.autoDocs.acknowledgementFrequencyName",
                    defaultMessage:
                      "{frequency, select, none {No acknowledgement required} every_use {Before every generation} once_per_auto_doc {Once per person for each Auto-Doc} other {Once per person across all Auto-Docs}}",
                  },
                  { frequency },
                )}
              </option>
            ))}
          </select>
        </div>
        <label className="block space-y-1">
          <span>
            <FormattedMessage
              id="settings.autoDocs.defaultAcknowledgementText"
              defaultMessage="Default acknowledgement text"
            />
          </span>
          <AutoResizeTextarea
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
