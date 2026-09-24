// SPDX-License-Identifier: AGPL-3.0-only
import { useRef, useState, type SubmitEvent } from "react";
import { redirect, useLoaderData, useRevalidator } from "react-router";
import { defineMessages, FormattedMessage, useIntl } from "react-intl";
import { api } from "../lib/api";
import { problem } from "../lib/problem";
import { requireUser } from "../lib/session";
import { PageTitle } from "../components/page-title";
import { SettingsCard } from "../components/settings-card";
import { Alert } from "../components/ui/alert";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";

type Section = "instance" | "uploads" | "storage" | "processing";
export const advancedTitles = defineMessages({
  instance: { id: "settings.advanced.instance", defaultMessage: "Instance address" },
  uploads: { id: "settings.advanced.uploads", defaultMessage: "File uploads" },
  storage: { id: "settings.advanced.storage", defaultMessage: "Document storage" },
  processing: { id: "settings.advanced.processing", defaultMessage: "Document processing" },
  status: { id: "settings.advanced.status", defaultMessage: "System status" },
});
const labels = defineMessages({
  BASE_URL: { id: "settings.advanced.baseUrl", defaultMessage: "Application address" },
  MAX_UPLOAD_MB: { id: "settings.advanced.uploadLimit", defaultMessage: "Maximum file size (MiB)" },
  STORAGE_DRIVER: { id: "settings.advanced.driver", defaultMessage: "Store new documents in" },
  STORAGE_PATH: { id: "settings.advanced.localPath", defaultMessage: "Local storage path" },
  S3_BUCKET: { id: "settings.advanced.bucket", defaultMessage: "S3 bucket" },
  S3_ENDPOINT: {
    id: "settings.advanced.s3Endpoint",
    defaultMessage: "S3 endpoint (optional for AWS)",
  },
  S3_REGION: { id: "settings.advanced.region", defaultMessage: "S3 region" },
  S3_FORCE_PATH_STYLE: {
    id: "settings.advanced.pathStyle",
    defaultMessage: "S3 path-style addressing",
  },
  S3_ACCESS_KEY_ID: { id: "settings.advanced.accessKey", defaultMessage: "S3 access key ID" },
  S3_SECRET_ACCESS_KEY: {
    id: "settings.advanced.secretKey",
    defaultMessage: "S3 secret access key",
  },
  AZURE_BLOB_CONTAINER: { id: "settings.advanced.container", defaultMessage: "Azure container" },
  AZURE_BLOB_ACCOUNT: { id: "settings.advanced.account", defaultMessage: "Azure storage account" },
  AZURE_BLOB_ENDPOINT: {
    id: "settings.advanced.azureEndpoint",
    defaultMessage: "Azure endpoint (optional for Azure)",
  },
  AZURE_BLOB_ACCOUNT_KEY: {
    id: "settings.advanced.accountKey",
    defaultMessage: "Azure account key",
  },
  DOC_ENGINE_URL: { id: "settings.advanced.engineUrl", defaultMessage: "Document service address" },
  DOC_ENGINE_TIMEOUT_MS: {
    id: "settings.advanced.timeout",
    defaultMessage: "Processing timeout (milliseconds)",
  },
  DOC_ENGINE_COMPARE_TIMEOUT_MS: {
    id: "settings.advanced.compareTimeout",
    defaultMessage: "Comparison timeout (milliseconds)",
  },
});
const driverOptions = defineMessages({
  local: { id: "settings.advanced.driver.local", defaultMessage: "Local filesystem" },
  s3: { id: "settings.advanced.driver.s3", defaultMessage: "S3-compatible storage" },
  "azure-blob": { id: "settings.advanced.driver.azureBlob", defaultMessage: "Azure Blob Storage" },
});
const descriptions = defineMessages({
  instance: {
    id: "settings.advanced.instanceHelp",
    defaultMessage:
      "The address people use to reach OpenLaw, including from email links. An internal hostname accessible over your LAN or VPN works without public internet access. Configure DNS, HTTPS and your identity provider's callback address to match.",
  },
  uploads: {
    id: "settings.advanced.uploadsHelp",
    defaultMessage:
      "The maximum size of an individual uploaded file. Your reverse proxy may enforce a lower limit.",
  },
  storage: {
    id: "settings.advanced.storageHelp",
    defaultMessage:
      "Choose where new documents are stored. Existing documents stay in their original location. Previously configured locations remain available for reads and require a migration to change. Local paths and volume mounts are managed by the deployment.",
  },
  processing: {
    id: "settings.advanced.processingHelp",
    defaultMessage:
      "Connect to the document service used for conversion, OCR and comparisons. The address must be reachable from both the API and worker. These timeouts control the clients; configure the document service's own limits separately.",
  },
});
export function settingsAdvancedLoader(section: Section) {
  return async () => {
    const user = await requireUser();
    if (user.role !== "administrator") return redirect("/settings/profile");
    const { data } = await api.GET("/api/v1/advanced-settings/{section}", {
      params: { path: { section } },
    });
    if (!data) throw new Error("The advanced settings could not be read.");
    return data;
  };
}
export function SettingsAdvancedPage({ section }: { section: Section }) {
  const loaded = useLoaderData<ReturnType<typeof settingsAdvancedLoader>>();
  return <AdvancedForm key={`${section}:${loaded.version}`} section={section} loaded={loaded} />;
}
type State = Awaited<ReturnType<ReturnType<typeof settingsAdvancedLoader>>>;
function AdvancedForm({ section, loaded }: { section: Section; loaded: Exclude<State, Response> }) {
  const intl = useIntl();
  const [state, setState] = useState(loaded);
  const [values, setValues] = useState(() =>
    Object.fromEntries(loaded.fields.map((field) => [field.key, field.value])),
  );
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tested, setTested] = useState(false);
  const pending = useRef(false);
  const title = intl.formatMessage(advancedTitles[section]);
  async function run(test: boolean) {
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    setError(null);
    setNotice(null);
    const body = {
      version: state.version,
      values: Object.fromEntries(
        state.fields
          .filter((field) => !field.locked)
          .map((field) => [field.key, values[field.key] ?? ""]),
      ),
    };
    try {
      if (test) {
        const result = await api.POST("/api/v1/advanced-settings/{section}/test", {
          params: { path: { section } },
          body,
        });
        if (!result.data) {
          setError(
            (await problem(result)).detail ??
              intl.formatMessage({
                id: "settings.advanced.testFailed",
                defaultMessage: "The connection test failed.",
              }),
          );
          setTested(false);
        } else {
          setTested(true);
          setNotice(
            intl.formatMessage({
              id: "settings.advanced.testPassed",
              defaultMessage: "Connection test passed.",
            }),
          );
        }
      } else {
        const result = await api.PUT("/api/v1/advanced-settings/{section}", {
          params: { path: { section } },
          body,
        });
        if (!result.data)
          setError(
            (await problem(result)).detail ??
              intl.formatMessage({
                id: "settings.advanced.saveFailed",
                defaultMessage: "The settings could not be saved.",
              }),
          );
        else {
          setState(result.data);
          setValues(
            Object.fromEntries(result.data.fields.map((field) => [field.key, field.value])),
          );
          setTested(false);
          setNotice(
            intl.formatMessage({
              id: "settings.advanced.saved",
              defaultMessage: "Settings saved. Restart the API and worker to apply changes.",
            }),
          );
        }
      }
    } catch {
      setError(
        intl.formatMessage({
          id: "settings.advanced.networkError",
          defaultMessage: "The server could not be reached. Try again.",
        }),
      );
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }
  function save(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    void run(false);
  }
  return (
    <>
      <PageTitle title={title} />
      <SettingsCard title={title}>
        <p className="text-sm text-muted">{intl.formatMessage(descriptions[section])}</p>
        {state.restartRequired && (
          <Alert variant="warning">
            <FormattedMessage
              id="settings.advanced.pending"
              defaultMessage="Saved changes are waiting for a restart. The active values below are still in use by this API. Check System status after restarting the API and worker."
            />
          </Alert>
        )}
        {error && <Alert variant="danger">{error}</Alert>}
        {notice && <Alert variant="success">{notice}</Alert>}
        <form onSubmit={save} className="flex flex-col gap-4">
          <fieldset disabled={busy} className="flex min-w-0 flex-col gap-4">
            {state.fields.map((field) => {
              const name = intl.formatMessage(labels[field.key as keyof typeof labels]);
              const id = `advanced-${field.key}`;
              const driver = values.STORAGE_DRIVER;
              if (
                field.key.startsWith("S3_") &&
                driver !== "s3" &&
                !state.fields.some((item) => item.key === "S3_BUCKET" && item.configured)
              )
                return null;
              if (
                field.key.startsWith("AZURE_") &&
                driver !== "azure-blob" &&
                !state.fields.some((item) => item.key === "AZURE_BLOB_CONTAINER" && item.configured)
              )
                return null;
              const options =
                field.key === "STORAGE_DRIVER"
                  ? [
                      ["local", intl.formatMessage(driverOptions.local)],
                      ["s3", intl.formatMessage(driverOptions.s3)],
                      ["azure-blob", intl.formatMessage(driverOptions["azure-blob"])],
                    ]
                  : field.key === "S3_FORCE_PATH_STYLE"
                    ? [
                        ["false", intl.formatMessage({ id: "common.no", defaultMessage: "No" })],
                        ["true", intl.formatMessage({ id: "common.yes", defaultMessage: "Yes" })],
                      ]
                    : null;
              return (
                <div key={field.key} className="flex flex-col gap-1.5">
                  <Label
                    htmlFor={id}
                    help={
                      field.secret && (
                        <>
                          {field.configured ? (
                            <FormattedMessage
                              id="settings.advanced.secretKept"
                              defaultMessage="Credential configured. Leave blank to keep it."
                            />
                          ) : (
                            <FormattedMessage
                              id="settings.advanced.identity"
                              defaultMessage="Leave credentials blank to use the deployment's workload identity or credential chain."
                            />
                          )}
                        </>
                      )
                    }
                  >
                    {name}
                  </Label>
                  {options ? (
                    <select
                      id={id}
                      disabled={field.locked}
                      className="h-8 w-full rounded-button border border-border-default bg-raised px-2 text-sm"
                      value={values[field.key]}
                      onChange={(event) => {
                        setValues({ ...values, [field.key]: event.target.value });
                        setTested(false);
                      }}
                    >
                      {options.map(([value, label]) => (
                        <option key={value} value={value}>
                          {label}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <Input
                      id={id}
                      type={
                        field.secret ? "password" : /(_MS|_MB)$/.test(field.key) ? "number" : "text"
                      }
                      min={1}
                      step={1}
                      autoComplete={field.secret ? "new-password" : "off"}
                      required={[
                        "BASE_URL",
                        "MAX_UPLOAD_MB",
                        "DOC_ENGINE_URL",
                        "DOC_ENGINE_TIMEOUT_MS",
                        "DOC_ENGINE_COMPARE_TIMEOUT_MS",
                      ].includes(field.key)}
                      readOnly={field.locked}
                      value={values[field.key] ?? ""}
                      onChange={(event) => {
                        setValues({ ...values, [field.key]: event.target.value });
                        setTested(false);
                      }}
                    />
                  )}
                  <p className="text-xs text-muted">
                    {field.source === "app" ? (
                      <FormattedMessage
                        id="settings.advanced.sourceApp"
                        defaultMessage="Saved in OpenLaw"
                      />
                    ) : field.source === "deployment" ? (
                      <FormattedMessage
                        id="settings.advanced.sourceDeployment"
                        defaultMessage="Deployment configuration"
                      />
                    ) : (
                      <FormattedMessage
                        id="settings.advanced.sourceDefault"
                        defaultMessage="Default"
                      />
                    )}
                    {field.locked && (
                      <>
                        {" "}
                        ·{" "}
                        <FormattedMessage
                          id="settings.advanced.readOnly"
                          defaultMessage="Read only"
                        />
                      </>
                    )}
                  </p>

                  {!field.secret && field.value !== field.activeValue && (
                    <p className="break-all text-xs text-muted">
                      <FormattedMessage
                        id="settings.advanced.active"
                        defaultMessage="Active: {value}"
                        values={{
                          value:
                            field.activeValue ||
                            intl.formatMessage({
                              id: "settings.advanced.noValue",
                              defaultMessage: "—",
                            }),
                        }}
                      />
                    </p>
                  )}
                </div>
              );
            })}
            {/* A value the deployment sets always wins, so a section whose
                every field is pinned has nothing to save. */}
            {state.fields.every((field) => field.locked) ? (
              <p className="text-sm text-muted">
                <FormattedMessage
                  id="settings.advanced.allLocked"
                  defaultMessage="The deployment configuration sets this value. Change it there, then restart the API and worker."
                />
              </p>
            ) : (
              <>
                <p className="text-sm text-muted">
                  <FormattedMessage
                    id="settings.advanced.restartHelp"
                    defaultMessage="Values saved here replace OpenLaw's defaults. A value set in the deployment configuration is read only here. Changes take effect after both the API and worker restart."
                  />
                </p>
                <div className="flex justify-end gap-2">
                  {(section === "storage" || section === "processing") && (
                    <Button type="button" variant="secondary" onClick={() => void run(true)}>
                      <FormattedMessage
                        id="settings.advanced.test"
                        defaultMessage="Test connection"
                      />
                    </Button>
                  )}
                  <Button type="submit" disabled={section === "storage" && !tested}>
                    <FormattedMessage id="action.save" defaultMessage="Save" />
                  </Button>
                </div>
              </>
            )}
          </fieldset>
        </form>
      </SettingsCard>
    </>
  );
}
export async function settingsSystemStatusLoader() {
  const user = await requireUser();
  if (user.role !== "administrator") return redirect("/settings/profile");
  const { data } = await api.GET("/api/v1/system-status");
  if (!data) throw new Error("System status could not be read.");
  return data;
}
export function SettingsSystemStatusPage() {
  const intl = useIntl();
  const state = useLoaderData<typeof settingsSystemStatusLoader>();
  const revalidator = useRevalidator();
  const title = intl.formatMessage(advancedTitles.status);
  return (
    <>
      <PageTitle title={title} />
      <SettingsCard
        title={title}
        actions={
          <Button
            variant="secondary"
            disabled={revalidator.state !== "idle"}
            onClick={() => void revalidator.revalidate()}
          >
            <FormattedMessage id="settings.advanced.refresh" defaultMessage="Refresh" />
          </Button>
        }
      >
        <p>
          <FormattedMessage id="settings.advanced.database" defaultMessage="Database: available" />
        </p>
        <p>
          <FormattedMessage
            id="settings.advanced.activeStorage"
            defaultMessage="Active storage: {driver}"
            values={{ driver: state.storageDriver }}
          />
        </p>
        <p className="break-all">
          <FormattedMessage
            id="settings.advanced.activeEngine"
            defaultMessage="Document service: {address}"
            values={{ address: state.documentEngine }}
          />
        </p>
        <p className="text-sm text-muted">
          <FormattedMessage
            id="settings.advanced.probes"
            defaultMessage="Use Test connection in Document storage or Document processing to check service access. Process status is based on heartbeats received within the last minute."
          />
        </p>
        {!["api", "worker"].every((role) =>
          state.processes.some((item) => item.role === role && item.online),
        ) && (
          <Alert variant="warning">
            <FormattedMessage
              id="settings.advanced.missing"
              defaultMessage="An API or worker heartbeat is missing. Check that both services are running."
            />
          </Alert>
        )}
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr>
                <th className="p-2">
                  <FormattedMessage id="settings.advanced.process" defaultMessage="Process" />
                </th>
                <th className="p-2">
                  <FormattedMessage id="settings.advanced.health" defaultMessage="Status" />
                </th>
                <th className="p-2">
                  <FormattedMessage
                    id="settings.advanced.configuration"
                    defaultMessage="Configuration"
                  />
                </th>
                <th className="p-2">
                  <FormattedMessage id="settings.advanced.heartbeat" defaultMessage="Last seen" />
                </th>
              </tr>
            </thead>
            <tbody>
              {state.processes.map((row, index) => (
                <tr key={index} className="border-t border-border-default">
                  <td className="p-2">
                    {row.role === "api" ? (
                      <FormattedMessage id="settings.advanced.role.api" defaultMessage="API" />
                    ) : (
                      <FormattedMessage
                        id="settings.advanced.role.worker"
                        defaultMessage="Worker"
                      />
                    )}
                  </td>
                  <td className="p-2">
                    {row.online ? (
                      <FormattedMessage id="settings.advanced.online" defaultMessage="Running" />
                    ) : (
                      <FormattedMessage
                        id="settings.advanced.offline"
                        defaultMessage="No recent heartbeat"
                      />
                    )}
                  </td>
                  <td className="p-2">
                    {row.current ? (
                      <FormattedMessage id="settings.advanced.current" defaultMessage="Current" />
                    ) : (
                      <FormattedMessage
                        id="settings.advanced.restart"
                        defaultMessage="Restart required"
                      />
                    )}
                  </td>
                  <td className="p-2">{intl.formatTime(row.heartbeatAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </SettingsCard>
    </>
  );
}
