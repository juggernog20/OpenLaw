// SPDX-License-Identifier: AGPL-3.0-only

/** ADO-004 and ADO-010: publish a Live pair, compare versions, and maintain settings. */
import { useState } from "react";
import { FormattedMessage, useIntl } from "react-intl";
import { Link } from "react-router";
import { api } from "../../lib/api";
import { CONTROL_CLASS } from "../../lib/form-controls";
import { documentComparisonPath } from "../../lib/documents";
import type { AutoDocAnswer, AutoDocOptions } from "../../lib/auto-docs";
import { Button } from "../ui/button";

const CARD = "space-y-4 rounded-card border border-border-default bg-raised p-6";

export function PublicationCard({
  record,
  dirty,
  onSaved,
}: {
  record: AutoDocAnswer;
  dirty: boolean;
  onSaved: (record: AutoDocAnswer) => void;
}) {
  const intl = useIntl();
  const [fileId, setFileId] = useState(record.template?.versions[0]?.id ?? "");
  const [formId, setFormId] = useState(record.formVersion?.id ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const archived = record.autoDoc.state === "archived";
  const liveFile = record.template?.versions.find(
    (version) => version.id === record.autoDoc.publishedDocumentVersionId,
  );
  const liveForm = record.formVersions.find(
    (version) => version.id === record.autoDoc.publishedFormVersionId,
  );
  async function act(action: "publish" | "unpublish" | "archive" | "restore") {
    setBusy(true);
    setError(undefined);
    const params = { path: { id: record.autoDoc.id } };
    const result = await (
      action === "publish"
        ? api.POST("/api/v1/auto-docs/{id}/publish", {
            params,
            body: { documentVersionId: fileId, formVersionId: formId },
          })
        : api.POST(`/api/v1/auto-docs/{id}/${action}`, { params, body: {} })
    ).catch(() => undefined);
    setBusy(false);
    if (result?.data) onSaved(result.data);
    else
      setError(
        result?.error?.detail ??
          intl.formatMessage({
            id: "autoDocs.lifecycleFailed",
            defaultMessage: "Could not change this Auto-Doc's state. Try again.",
          }),
      );
  }
  return (
    <section aria-labelledby="auto-doc-publication-title" className={CARD}>
      <h2 id="auto-doc-publication-title" className="text-lg font-semibold">
        <FormattedMessage id="autoDocs.publication" defaultMessage="Publication" />
      </h2>
      {liveFile && liveForm ? (
        <p className="text-sm">
          <FormattedMessage
            id="autoDocs.livePair"
            defaultMessage="Live: file version {file} and form version {form}."
            values={{ file: liveFile.versionNumber, form: liveForm.versionNumber }}
          />
        </p>
      ) : (
        <p className="text-sm text-muted">
          <FormattedMessage
            id="autoDocs.noLivePair"
            defaultMessage="No file and form pair is published."
          />
        </p>
      )}
      {!archived && (
        <>
          <p className="text-sm text-muted">
            <FormattedMessage
              id="autoDocs.publishHelp"
              defaultMessage="Choose the file and saved form to publish together. Later edits leave this pair unchanged until you publish again."
            />
          </p>
          <div className="grid gap-3 @lg/page:grid-cols-2">
            <label className="block space-y-1">
              <span>
                <FormattedMessage
                  id="autoDocs.fileToPublish"
                  defaultMessage="File version to publish"
                />
              </span>
              <select
                className={CONTROL_CLASS}
                disabled={busy}
                value={fileId}
                onChange={(event) => setFileId(event.target.value)}
              >
                <option value="">
                  {intl.formatMessage({
                    id: "autoDocs.chooseVersion",
                    defaultMessage: "Choose a version",
                  })}
                </option>
                {record.template?.versions.map((version) => (
                  <option key={version.id} value={version.id}>
                    {intl.formatMessage(
                      { id: "autoDocs.fileVersionNumber", defaultMessage: "File version {number}" },
                      { number: version.versionNumber },
                    )}
                  </option>
                ))}
              </select>
            </label>
            <label className="block space-y-1">
              <span>
                <FormattedMessage
                  id="autoDocs.formToPublish"
                  defaultMessage="Form version to publish"
                />
              </span>
              <select
                className={CONTROL_CLASS}
                disabled={busy}
                value={formId}
                onChange={(event) => setFormId(event.target.value)}
              >
                <option value="">
                  {intl.formatMessage({
                    id: "autoDocs.chooseVersion",
                    defaultMessage: "Choose a version",
                  })}
                </option>
                {record.formVersions.map((version) => (
                  <option key={version.id} value={version.id}>
                    {intl.formatMessage(
                      { id: "autoDocs.formVersion", defaultMessage: "Form version {number}" },
                      { number: version.versionNumber },
                    )}
                  </option>
                ))}
              </select>
            </label>
          </div>
          {dirty && (
            <p className="text-sm text-muted">
              <FormattedMessage
                id="autoDocs.saveBeforePublish"
                defaultMessage="Save your form changes before publishing."
              />
            </p>
          )}
        </>
      )}
      {error && (
        <p role="alert" className="text-sm text-status-danger-fg">
          {error}
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        {!archived && (
          <Button
            disabled={
              busy ||
              dirty ||
              !fileId ||
              !formId ||
              (fileId === record.autoDoc.publishedDocumentVersionId &&
                formId === record.autoDoc.publishedFormVersionId)
            }
            onClick={() => void act("publish")}
          >
            <FormattedMessage id="autoDocs.publish" defaultMessage="Publish" />
          </Button>
        )}
        {record.autoDoc.state === "published" && (
          <Button variant="secondary" disabled={busy} onClick={() => void act("unpublish")}>
            <FormattedMessage id="autoDocs.unpublish" defaultMessage="Unpublish" />
          </Button>
        )}
        {archived ? (
          <Button disabled={busy} onClick={() => void act("restore")}>
            <FormattedMessage id="autoDocs.restore" defaultMessage="Restore" />
          </Button>
        ) : (
          <Button variant="secondary" disabled={busy} onClick={() => void act("archive")}>
            <FormattedMessage id="autoDocs.archive" defaultMessage="Archive" />
          </Button>
        )}
      </div>
    </section>
  );
}

export function AutoDocSettings({
  record,
  options,
  onSaved,
}: {
  record: AutoDocAnswer;
  options: AutoDocOptions;
  onSaved: (record: AutoDocAnswer) => void;
}) {
  const intl = useIntl();
  const [audience, setAudience] = useState(record.autoDoc.audience);
  const [target, setTarget] = useState(record.autoDoc.targetContractTypeId ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [notice, setNotice] = useState(false);
  return (
    <section aria-labelledby="auto-doc-settings-title" className={CARD}>
      <h2 id="auto-doc-settings-title" className="text-lg font-semibold">
        <FormattedMessage id="autoDocs.settings" defaultMessage="Settings" />
      </h2>
      <form
        className="space-y-4"
        onSubmit={(event) => {
          event.preventDefault();
          setBusy(true);
          setError(undefined);
          setNotice(false);
          void api
            .PATCH("/api/v1/auto-docs/{id}", {
              params: { path: { id: record.autoDoc.id } },
              body: { audience, targetContractTypeId: target || null },
            })
            .catch(() => undefined)
            .then((result) => {
              setBusy(false);
              if (result?.data) {
                onSaved(result.data);
                setNotice(true);
              } else
                setError(
                  result?.error?.detail ??
                    intl.formatMessage({
                      id: "autoDocs.settingsFailed",
                      defaultMessage: "Could not save these settings. Try again.",
                    }),
                );
            });
        }}
      >
        <fieldset
          disabled={busy || record.autoDoc.state === "archived"}
          className="grid gap-3 @lg/page:grid-cols-2"
        >
          <label className="block space-y-1">
            <span>
              <FormattedMessage id="autoDocs.audience" defaultMessage="Audience" />
            </span>
            <select
              className={CONTROL_CLASS}
              value={audience}
              onChange={(event) => setAudience(event.target.value as typeof audience)}
            >
              {(["legal_only", "selected", "everyone"] as const).map((value) => (
                <option key={value} value={value}>
                  {intl.formatMessage(
                    {
                      id: "autoDocs.audienceName",
                      defaultMessage:
                        "{audience, select, legal_only {Legal only} selected {Selected} other {Everyone}}",
                    },
                    { audience: value },
                  )}
                </option>
              ))}
            </select>
          </label>
          <label className="block space-y-1">
            <span>
              <FormattedMessage id="autoDocs.targetType" defaultMessage="Target Contract Type" />
            </span>
            <select
              className={CONTROL_CLASS}
              value={target}
              onChange={(event) => setTarget(event.target.value)}
            >
              <option value="">
                {intl.formatMessage({
                  id: "autoDocs.noTargetType",
                  defaultMessage: "No target Contract Type",
                })}
              </option>
              {target && !options.contractTypes.some((type) => type.id === target) && (
                <option value={target}>
                  {intl.formatMessage({
                    id: "autoDocs.archivedTargetType",
                    defaultMessage: "Archived Contract Type",
                  })}
                </option>
              )}
              {options.contractTypes.map((type) => (
                <option key={type.id} value={type.id}>
                  {type.displayName}
                </option>
              ))}
            </select>
          </label>
        </fieldset>
        {error && (
          <p role="alert" className="text-sm text-status-danger-fg">
            {error}
          </p>
        )}
        {notice && (
          <p role="status" className="text-sm text-muted">
            <FormattedMessage id="autoDocs.settingsSaved" defaultMessage="Settings saved." />
          </p>
        )}
        <Button type="submit" disabled={busy || record.autoDoc.state === "archived"}>
          <FormattedMessage id="autoDocs.saveSettings" defaultMessage="Save settings" />
        </Button>
      </form>
    </section>
  );
}

export function AutoDocVersionDiff({ record }: { record: AutoDocAnswer }) {
  const intl = useIntl();
  const [from, setFrom] = useState(record.formVersions[1]?.id ?? record.formVersions[0]?.id ?? "");
  const [to, setTo] = useState(record.formVersions[0]?.id ?? "");
  const [fileFrom, setFileFrom] = useState(record.template?.versions[1]?.id ?? "");
  const [fileTo, setFileTo] = useState(record.template?.versions[0]?.id ?? "");
  const [changes, setChanges] =
    useState<Array<{ kind: string; name: string; before: string | null; after: string | null }>>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  return (
    <section aria-labelledby="auto-doc-diff-title" className={CARD}>
      <h2 id="auto-doc-diff-title" className="text-lg font-semibold">
        <FormattedMessage id="autoDocs.versionDiffs" defaultMessage="Version comparisons" />
      </h2>
      <form
        className="space-y-3"
        onSubmit={(event) => {
          event.preventDefault();
          setBusy(true);
          setError(undefined);
          void api
            .GET("/api/v1/auto-docs/{id}/form-versions/diff", {
              params: { path: { id: record.autoDoc.id }, query: { from, to } },
            })
            .catch(() => undefined)
            .then((result) => {
              setBusy(false);
              if (result?.data) setChanges(result.data.changes);
              else
                setError(
                  result?.error?.detail ??
                    intl.formatMessage({
                      id: "autoDocs.diffFailed",
                      defaultMessage: "Could not compare these forms. Try again.",
                    }),
                );
            });
        }}
      >
        <div className="grid gap-3 @lg/page:grid-cols-2">
          <label className="block space-y-1">
            <span>
              <FormattedMessage id="autoDocs.formDiffFrom" defaultMessage="Compare form from" />
            </span>
            <select
              className={CONTROL_CLASS}
              value={from}
              onChange={(event) => {
                setFrom(event.target.value);
                setChanges(undefined);
              }}
            >
              {record.formVersions.map((version) => (
                <option key={version.id} value={version.id}>
                  {intl.formatMessage(
                    { id: "autoDocs.formVersion", defaultMessage: "Form version {number}" },
                    { number: version.versionNumber },
                  )}
                </option>
              ))}
            </select>
          </label>
          <label className="block space-y-1">
            <span>
              <FormattedMessage id="autoDocs.formDiffTo" defaultMessage="Compare form to" />
            </span>
            <select
              className={CONTROL_CLASS}
              value={to}
              onChange={(event) => {
                setTo(event.target.value);
                setChanges(undefined);
              }}
            >
              {record.formVersions.map((version) => (
                <option key={version.id} value={version.id}>
                  {intl.formatMessage(
                    { id: "autoDocs.formVersion", defaultMessage: "Form version {number}" },
                    { number: version.versionNumber },
                  )}
                </option>
              ))}
            </select>
          </label>
        </div>
        <Button type="submit" variant="secondary" disabled={busy || !from || !to}>
          <FormattedMessage id="autoDocs.compareForms" defaultMessage="Compare forms" />
        </Button>
      </form>
      {error && (
        <p role="alert" className="text-sm text-status-danger-fg">
          {error}
        </p>
      )}
      {changes && (
        <div role="status">
          <ul className="space-y-2 text-sm">
            {changes.map((change, index) => (
              <li key={index}>
                <FormattedMessage
                  id="autoDocs.formChange"
                  defaultMessage="{kind, select, added {Added {name}} removed {Removed {name}} retyped {Retyped {name}} relabelled {Relabelled {name}} reordered {Reordered {name}} mapped {Map changed: {name}} rules_changed {Clause rule changed: {name}} other {Field settings changed: {name}}}"
                  values={{ kind: change.kind, name: change.name }}
                />
                {["added", "removed", "retyped", "relabelled", "reordered"].includes(
                  change.kind,
                ) && (
                  <span className="ml-2 text-muted">
                    <FormattedMessage
                      id="autoDocs.changeValues"
                      defaultMessage="{before} → {after}"
                      values={{
                        before:
                          change.before ??
                          intl.formatMessage({ id: "autoDocs.noValue", defaultMessage: "None" }),
                        after:
                          change.after ??
                          intl.formatMessage({ id: "autoDocs.noValue", defaultMessage: "None" }),
                      }}
                    />
                  </span>
                )}
              </li>
            ))}
          </ul>
          {!changes.length && (
            <p className="text-sm text-muted">
              <FormattedMessage
                id="autoDocs.noFormChanges"
                defaultMessage="These form versions have no structural changes."
              />
            </p>
          )}
        </div>
      )}
      {!!record.template && record.template.versions.length > 1 && (
        <div className="space-y-3">
          <div className="grid gap-3 @lg/page:grid-cols-2">
            <label className="block space-y-1">
              <span>
                <FormattedMessage id="autoDocs.fileDiffFrom" defaultMessage="Compare file from" />
              </span>
              <select
                className={CONTROL_CLASS}
                value={fileFrom}
                onChange={(event) => setFileFrom(event.target.value)}
              >
                {record.template.versions.map((version) => (
                  <option key={version.id} value={version.id}>
                    {intl.formatMessage(
                      { id: "autoDocs.fileVersionNumber", defaultMessage: "File version {number}" },
                      { number: version.versionNumber },
                    )}
                  </option>
                ))}
              </select>
            </label>
            <label className="block space-y-1">
              <span>
                <FormattedMessage id="autoDocs.fileDiffTo" defaultMessage="Compare file to" />
              </span>
              <select
                className={CONTROL_CLASS}
                value={fileTo}
                onChange={(event) => setFileTo(event.target.value)}
              >
                {record.template.versions.map((version) => (
                  <option key={version.id} value={version.id}>
                    {intl.formatMessage(
                      { id: "autoDocs.fileVersionNumber", defaultMessage: "File version {number}" },
                      { number: version.versionNumber },
                    )}
                  </option>
                ))}
              </select>
            </label>
          </div>
          {fileFrom && fileTo && fileFrom !== fileTo && (
            <Link
              className="text-link hover:underline"
              to={documentComparisonPath(record.template.id, fileFrom, fileTo)}
            >
              <FormattedMessage id="autoDocs.compareFiles" defaultMessage="Compare files" />
            </Link>
          )}
        </div>
      )}
    </section>
  );
}
