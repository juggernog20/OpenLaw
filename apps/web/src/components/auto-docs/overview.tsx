// SPDX-License-Identifier: AGPL-3.0-only

/** Overview (DES-087 clause 2): the About card and the Publication card. */
import { useState } from "react";
import { FormattedMessage, useIntl } from "react-intl";
import { api } from "../../lib/api";
import { formatFullDate } from "../../lib/format";
import { useFieldCommit } from "../../lib/field-commit";
import { AutoResizeTextarea } from "../auto-resize-textarea";
import type { AutoDocAnswer } from "../../lib/auto-docs";
import { SettingsCard } from "../settings-card";
import { StatusNote } from "../status-note";
import { Button } from "../ui/button";

export function AboutCard({
  record,
  onSaved,
}: {
  record: AutoDocAnswer;
  onSaved: (record: AutoDocAnswer) => void;
}) {
  const commits = useFieldCommit<"description">();
  const saved = record.autoDoc.description ?? "";
  const [draft, setDraft] = useState(saved);
  const archived = record.autoDoc.state === "archived";
  return (
    <SettingsCard region title={<FormattedMessage id="autoDocs.about" defaultMessage="About" />}>
      <div className="flex flex-col gap-1">
        <div className="flex items-center justify-between gap-2">
          <label htmlFor="auto-doc-description" className="text-sm font-medium">
            <FormattedMessage id="autoDocs.description" defaultMessage="Description" />
          </label>
          <StatusNote
            status={commits.status.description ?? "idle"}
            detail={commits.error.description}
          />
        </div>
        <AutoResizeTextarea
          id="auto-doc-description"
          disabled={archived}
          maxLength={4000}
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onBlur={() =>
            commits.commitText("description", {
              draft,
              saved,
              reset: setDraft,
              send: (value) =>
                commits.commit(
                  "description",
                  () =>
                    api.PATCH("/api/v1/auto-docs/{id}", {
                      params: { path: { id: record.autoDoc.id } },
                      body: { description: value || null },
                    }),
                  onSaved,
                ),
            })
          }
          onKeyDown={(event) => {
            if (event.key === "Escape")
              commits.revertText("description", { draft, saved, reset: setDraft, send: () => {} });
          }}
        />
      </div>
    </SettingsCard>
  );
}

export function PublicationCard({
  record,
  onPublish,
}: {
  record: AutoDocAnswer;
  onPublish: () => void;
}) {
  const intl = useIntl();
  const liveFile = record.template?.versions.find(
    (version) => version.id === record.autoDoc.publishedDocumentVersionId,
  );
  const liveForm = record.formVersions.find(
    (version) => version.id === record.autoDoc.publishedFormVersionId,
  );
  const newestFile = record.template?.versions[0];
  const newestForm = record.formVersion;
  const newerFile = liveFile && newestFile && newestFile.versionNumber > liveFile.versionNumber;
  const newerForm = liveForm && newestForm && newestForm.versionNumber > liveForm.versionNumber;
  const archived = record.autoDoc.state === "archived";
  return (
    <SettingsCard
      region
      title={<FormattedMessage id="autoDocs.publication" defaultMessage="Publication" />}
      actions={
        !archived && (newerFile || newerForm || !liveFile) && newestFile && newestForm ? (
          <Button size="sm" onClick={onPublish}>
            <FormattedMessage id="autoDocs.publish" defaultMessage="Publish" />
          </Button>
        ) : undefined
      }
    >
      {liveFile && liveForm && record.autoDoc.publishedAt ? (
        <p className="text-sm">
          <FormattedMessage
            id="autoDocs.liveSince"
            defaultMessage="Live since {date}: file version {file}, form version {form}."
            values={{
              date: formatFullDate(record.autoDoc.publishedAt, { locale: intl.locale }),
              file: liveFile.versionNumber,
              form: liveForm.versionNumber,
            }}
          />
        </p>
      ) : (
        <p className="text-sm text-muted">
          <FormattedMessage
            id="autoDocs.notPublished"
            defaultMessage="{state, select, archived {Archived.} other {Not published.}}"
            values={{ state: record.autoDoc.state }}
          />
        </p>
      )}
      {(newerFile || newerForm) && (
        <p className="text-sm text-status-warning-fg">
          <FormattedMessage
            id="autoDocs.newerThanLive"
            defaultMessage="{both, select, true {File version {file} and form version {form} are newer than the currently published file and form.} file {File version {file} is newer than the currently published file.} other {Form version {form} is newer than the currently published form.}}"
            values={{
              both: newerFile && newerForm ? "true" : newerFile ? "file" : "form",
              file: newestFile?.versionNumber,
              form: newestForm?.versionNumber,
            }}
          />
        </p>
      )}
    </SettingsCard>
  );
}
