// SPDX-License-Identifier: AGPL-3.0-only

/** ADO-002–004: one template Document and immutable form snapshots. */
import { useState } from "react";
import { FormattedMessage, useIntl } from "react-intl";
import { Link, redirect, useLoaderData, type LoaderFunctionArgs } from "react-router";
import type { paths } from "@openlaw/api-client";
import { autoDocFieldTypes, autoDocUploadAnswer } from "../lib/auto-docs";
import { api } from "../lib/api";
import { CONTROL_CLASS, TEXTAREA_CLASS } from "../lib/form-controls";
import { isMemberPlus } from "../lib/roles";
import { requireUser, useSignOut } from "../lib/session";
import { useActivityApplet } from "../components/activity/activity-applet";
import { RecordApplets } from "../components/shell/record-applets";
import { DocPanel } from "../components/documents/doc-panel";
import { previousComparableVersion, type ContractDocument } from "../lib/documents";
import { AppShell } from "../components/shell/app-shell";
import { PageTitle } from "../components/page-title";
import { Button } from "../components/ui/button";
import { RecordNotFoundPage } from "./not-found";

type Answer =
  paths["/api/v1/auto-docs/{id}"]["get"]["responses"][200]["content"]["application/json"];
type Field = NonNullable<Answer["formVersion"]>["definition"]["fields"][number];
const FIELD_TYPES = autoDocFieldTypes.options;

export async function autoDocRecordLoader({ params, request }: LoaderFunctionArgs) {
  const user = await requireUser();
  if (!isMemberPlus(user.role)) return redirect("/portal");
  const result = await api.GET("/api/v1/auto-docs/{id}", { params: { path: { id: params.id! } } });
  if (result.response.status === 404) return { user, notFound: true as const };
  if (!result.data) throw new Error("The Auto-Doc could not be read.");
  const query = new URL(request.url).searchParams;
  const versionId = query.get("version");
  let landing: { document: ContractDocument; versionId: string } | null = null;
  if (query.get("doc") === result.data.template?.id && versionId) {
    const paper = await api
      .GET("/api/v1/auto-docs/{id}/documents", { params: { path: { id: params.id! } } })
      .catch(() => undefined);
    const document = paper?.data?.documents[0];
    if (document?.versions.some((version) => version.id === versionId))
      landing = { document, versionId };
  }
  return { user, record: result.data, landing, find: query.get("find") };
}

export function AutoDocRecordPage() {
  const loaded = useLoaderData<typeof autoDocRecordLoader>();
  const intl = useIntl();
  if (loaded.notFound)
    return (
      <RecordNotFoundPage
        user={loaded.user}
        title={intl.formatMessage({
          id: "autoDocs.notFound",
          defaultMessage: "Auto-Doc not found",
        })}
        body={
          <FormattedMessage
            id="autoDocs.notFoundBody"
            defaultMessage="This Auto-Doc does not exist, or you cannot open it."
          />
        }
        backTo="/auto-docs"
        backLabel={<FormattedMessage id="nav.autoDocs" defaultMessage="Auto-Docs" />}
      />
    );
  return (
    <AutoDocRecord
      initial={loaded.record}
      user={loaded.user}
      landing={loaded.landing}
      find={loaded.find}
    />
  );
}

function AutoDocRecord({
  initial,
  user,
  landing,
  find,
}: {
  initial: Answer;
  landing: { document: ContractDocument; versionId: string } | null;
  find: string | null;
  user: Awaited<ReturnType<typeof requireUser>>;
}) {
  const intl = useIntl();
  const signOut = useSignOut("/auth/login");
  const [saved, setSaved] = useState(initial);
  const history = useActivityApplet({ entityType: "auto_doc", entityId: initial.autoDoc.id });
  const [reading, setReading] = useState(landing);
  const [covered, setCovered] = useState(false);
  const openVersion = reading?.document.versions.find(
    (version) => version.id === reading.versionId,
  );
  async function openTemplate(versionId: string) {
    const answer = await api
      .GET("/api/v1/auto-docs/{id}/documents", { params: { path: { id: initial.autoDoc.id } } })
      .catch(() => undefined);
    const document = answer?.data?.documents[0];
    if (document?.versions.some((version) => version.id === versionId))
      setReading({ document, versionId });
    else
      setError(
        intl.formatMessage({
          id: "autoDocs.openFailed",
          defaultMessage: "Could not open this file version. Please try again.",
        }),
      );
  }

  // Stable row keys let Legal edit a slug without losing keyboard focus.
  const drafts = (record: Answer) =>
    (record.formVersion?.definition.fields ?? []).map((field, index) => ({
      ...field,
      key: `saved-${index}`,
      optionText: field.options?.join("\n") ?? "",
    }));
  const [fields, setFields] = useState(() => drafts(initial));
  const [nextKey, setNextKey] = useState(1);
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [notice, setNotice] = useState<string>();
  const archived = saved.autoDoc.state === "archived";
  const comparable = (rows: typeof fields) =>
    rows.map((field) => ({
      slug: field.slug,
      label: field.label,
      help: field.help,
      fieldType: field.fieldType,
      optionText: field.optionText,
      required: field.required,
      placeholder: field.placeholder,
    }));
  const dirty = JSON.stringify(comparable(fields)) !== JSON.stringify(comparable(drafts(saved)));

  const orphaned = fields.filter(
    (field) => field.placeholder && !saved.detection.placeholders.includes(field.slug),
  );
  /** The options textarea is one option per line, so a blank line is typing, not an option. */
  function optionsOf(field: (typeof fields)[number]) {
    if (field.fieldType !== "single_select" && field.fieldType !== "multi_select") return null;
    return field.optionText
      .split("\n")
      .map((option) => option.trim())
      .filter((option) => option.length > 0);
  }
  function update(key: string, patch: Partial<(typeof fields)[number]>) {
    setFields((rows) => rows.map((row) => (row.key === key ? { ...row, ...patch } : row)));
  }
  function moved(index: number, delta: number) {
    setFields((rows) => {
      const next = [...rows];
      [next[index], next[index + delta]] = [next[index + delta]!, next[index]!];
      return next;
    });
  }
  function accept(record: Answer) {
    setSaved(record);
    setFields(drafts(record));
  }
  async function save() {
    // The seam refuses a duplicate slug and an empty or repeated option, but it
    // answers with a problem detail that names no field. Say the rule here.
    const refusal = fields.some((field) => {
      const options = optionsOf(field);
      return options !== null && (options.length === 0 || new Set(options).size !== options.length);
    })
      ? intl.formatMessage({
          id: "autoDocs.optionsRefused",
          defaultMessage: "Give each select field distinct, non-empty options.",
        })
      : new Set(fields.map((field) => field.slug)).size !== fields.length
        ? intl.formatMessage({
            id: "autoDocs.slugsRefused",
            defaultMessage: "Each form field needs a distinct slug.",
          })
        : undefined;
    if (refusal) {
      setNotice(undefined);
      setError(refusal);
      return;
    }
    setBusy(true);
    setError(undefined);
    setNotice(undefined);
    const result = await api
      .POST("/api/v1/auto-docs/{id}/form-versions", {
        params: { path: { id: saved.autoDoc.id } },
        body: {
          fields: fields.map((field) => ({
            slug: field.slug,
            label: field.label,
            help: field.help || null,
            fieldType: field.fieldType,
            required: field.required,
            options: optionsOf(field),
          })),
        },
      })
      .catch(() => undefined);
    setBusy(false);
    if (result?.data) {
      accept(result.data);
      setNotice(intl.formatMessage({ id: "autoDocs.formSaved", defaultMessage: "Form saved." }));
    } else
      setError(
        result?.error?.detail ??
          intl.formatMessage({
            id: "autoDocs.saveFailed",
            defaultMessage: "Could not save the form. Please try again.",
          }),
      );
  }
  async function upload() {
    if (!file || dirty) return;
    setBusy(true);
    setError(undefined);
    setNotice(undefined);
    const body = new FormData();
    body.append("file", file);
    try {
      const response = await fetch(
        `/api/v1/auto-docs/${encodeURIComponent(saved.autoDoc.id)}/template`,
        { method: "POST", credentials: "same-origin", body },
      );
      const result = await response.json();
      if (!response.ok) {
        setError(
          typeof result.detail === "string"
            ? result.detail
            : intl.formatMessage({
                id: "autoDocs.uploadFailed",
                defaultMessage: "Could not upload the template. Please try again.",
              }),
        );
        return;
      }
      const parsed = autoDocUploadAnswer.safeParse(result);
      if (!parsed.success) {
        setError(
          intl.formatMessage({
            id: "autoDocs.invalidUploadReply",
            defaultMessage:
              "The upload response could not be read. Reload this Auto-Doc to check its saved template.",
          }),
        );
        return;
      }
      accept(parsed.data);
      setFile(null);
      setNotice(
        intl.formatMessage({ id: "autoDocs.uploaded", defaultMessage: "Template uploaded." }),
      );
    } catch {
      setError(
        intl.formatMessage({
          id: "autoDocs.uploadFailed",
          defaultMessage: "Could not upload the template. Please try again.",
        }),
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <AppShell
      user={user}
      onSignOut={() => void signOut()}
      flush
      recordScope={{ entityType: "auto_doc", entityId: saved.autoDoc.id }}
    >
      <PageTitle title={saved.autoDoc.name} />
      <RecordApplets
        applets={[history]}
        contentCovered={covered && Boolean(reading)}
        layer={
          reading && openVersion ? (
            <DocPanel
              documentId={reading.document.id}
              title={reading.document.title}
              version={openVersion}
              previousVersion={previousComparableVersion(reading.document, openVersion)}
              initialFind={find}
              onClose={() => setReading(null)}
              onDockedChange={(docked) => setCovered(!docked)}
            />
          ) : undefined
        }
      >
        <div className="mx-auto h-full w-full max-w-5xl space-y-6 overflow-y-auto p-6">
          <Link className="text-link hover:underline" to="/auto-docs">
            <FormattedMessage id="nav.autoDocs" defaultMessage="Auto-Docs" />
          </Link>
          <header>
            <h1 className="text-xl font-semibold">{saved.autoDoc.name}</h1>
            <p className="text-sm text-muted">
              <FormattedMessage
                id="autoDocs.state"
                defaultMessage="{state, select, draft {Draft} published {Published} other {Archived}}"
                values={{ state: saved.autoDoc.state }}
              />
            </p>
            {saved.autoDoc.description && (
              <p className="mt-2 text-muted">{saved.autoDoc.description}</p>
            )}
          </header>
          {error && (
            <p role="alert" className="text-sm text-status-danger-fg">
              {error}
            </p>
          )}
          <p role="status" className="text-sm text-muted">
            {notice}
          </p>
          <section
            aria-labelledby="auto-doc-template-title"
            className="space-y-4 rounded-card border border-border-default bg-raised p-6"
          >
            <h2 id="auto-doc-template-title" className="text-lg font-semibold">
              <FormattedMessage id="autoDocs.template" defaultMessage="Template" />
            </h2>
            <form
              className="flex flex-wrap items-end gap-3"
              onSubmit={(event) => {
                event.preventDefault();
                void upload();
              }}
            >
              <label className="block space-y-1">
                <span>
                  <FormattedMessage id="autoDocs.wordTemplate" defaultMessage="Word template" />
                </span>
                <input
                  key={saved.template?.versions[0]?.id ?? "empty"}
                  disabled={busy || archived}
                  type="file"
                  accept=".docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                  className={CONTROL_CLASS}
                  onChange={(event) => setFile(event.target.files?.[0] ?? null)}
                />
              </label>
              <Button type="submit" disabled={!file || busy || archived || dirty}>
                <FormattedMessage id="autoDocs.uploadTemplate" defaultMessage="Upload template" />
              </Button>
            </form>
            <p className="text-sm text-muted">
              <FormattedMessage
                id="autoDocs.templateHelp"
                defaultMessage="Use double braces for Placeholders, such as {example}. Each upload adds a file version."
                values={{ example: "{{counterparty_name}}" }}
              />
            </p>
            {dirty && (
              <p className="text-sm text-muted">
                <FormattedMessage
                  id="autoDocs.saveBeforeUpload"
                  defaultMessage="Save your form changes before uploading another template."
                />
              </p>
            )}
            <ul className="space-y-2">
              {saved.template?.versions.map((version) => (
                <li key={version.id} className="flex flex-wrap justify-between gap-2 text-sm">
                  <span>
                    <FormattedMessage
                      id="autoDocs.fileVersionLabel"
                      defaultMessage="File version {number} · {filename}"
                      values={{ number: version.versionNumber, filename: version.originalFilename }}
                    />
                  </span>
                  <Button
                    type="button"
                    variant="link"
                    onClick={() => void openTemplate(version.id)}
                  >
                    <FormattedMessage
                      id="autoDocs.openVersion"
                      defaultMessage="Open version {number}"
                      values={{ number: version.versionNumber }}
                    />
                  </Button>
                  <a
                    className="text-link hover:underline"
                    href={`/api/v1/documents/${encodeURIComponent(saved.template!.id)}/versions/${encodeURIComponent(version.id)}/download`}
                  >
                    <FormattedMessage id="autoDocs.download" defaultMessage="Download" />
                  </a>
                </li>
              ))}
            </ul>
          </section>
          <section
            aria-labelledby="auto-doc-form-title"
            className="space-y-4 rounded-card border border-border-default bg-raised p-6"
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 id="auto-doc-form-title" className="text-lg font-semibold">
                <FormattedMessage id="autoDocs.form" defaultMessage="Form" />
              </h2>
              {orphaned.length > 0 && (
                <span className="text-sm font-medium text-status-danger-fg">
                  <FormattedMessage
                    id="autoDocs.orphanCount"
                    defaultMessage="{count, plural, one {# orphaned field} other {# orphaned fields}}"
                    values={{ count: orphaned.length }}
                  />
                </span>
              )}
            </div>
            <form
              className="space-y-4"
              onSubmit={(event) => {
                event.preventDefault();
                void save();
              }}
            >
              {fields.map((field, index) => (
                <fieldset
                  disabled={busy || archived}
                  key={field.key}
                  className={`space-y-3 rounded-card border p-4 ${orphaned.includes(field) ? "border-status-danger-fg" : "border-border-default"}`}
                >
                  <legend className="px-1 font-medium">
                    {field.slug ||
                      intl.formatMessage({ id: "autoDocs.newField", defaultMessage: "New field" })}
                  </legend>
                  {orphaned.includes(field) && (
                    <p className="text-sm text-status-danger-fg">
                      <FormattedMessage
                        id="autoDocs.orphanHelp"
                        defaultMessage="This field no longer has a Placeholder in the template."
                      />
                    </p>
                  )}
                  <div className="grid gap-3 @lg/page:grid-cols-2">
                    <label className="block space-y-1">
                      <span>
                        <FormattedMessage id="autoDocs.fieldSlug" defaultMessage="Slug" />
                      </span>
                      <input
                        required
                        pattern="[a-z][a-z0-9_]*"
                        maxLength={120}
                        className={CONTROL_CLASS}
                        value={field.slug}
                        onChange={(event) => update(field.key, { slug: event.target.value })}
                      />
                    </label>
                    <label className="block space-y-1">
                      <span>
                        <FormattedMessage id="autoDocs.fieldLabel" defaultMessage="Label" />
                      </span>
                      <input
                        required
                        maxLength={200}
                        className={CONTROL_CLASS}
                        value={field.label}
                        onChange={(event) => update(field.key, { label: event.target.value })}
                      />
                    </label>
                    <label className="block space-y-1">
                      <span>
                        <FormattedMessage id="autoDocs.fieldType" defaultMessage="Type" />
                      </span>
                      <select
                        className={CONTROL_CLASS}
                        value={field.fieldType}
                        onChange={(event) =>
                          update(field.key, { fieldType: event.target.value as Field["fieldType"] })
                        }
                      >
                        {FIELD_TYPES.map((type) => (
                          <option key={type} value={type}>
                            {intl.formatMessage(
                              {
                                id: "autoDocs.fieldTypeName",
                                defaultMessage:
                                  "{type, select, text {Text} long_text {Long text} number {Number} currency {Currency} date {Date} boolean {Boolean} single_select {Single select} multi_select {Multi select} other {Entity}}",
                              },
                              { type },
                            )}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="block space-y-1">
                      <span>
                        <FormattedMessage id="autoDocs.fieldHelp" defaultMessage="Help text" />
                      </span>
                      <input
                        maxLength={4000}
                        className={CONTROL_CLASS}
                        value={field.help ?? ""}
                        onChange={(event) => update(field.key, { help: event.target.value })}
                      />
                    </label>
                  </div>
                  {(field.fieldType === "single_select" || field.fieldType === "multi_select") && (
                    <label className="block space-y-1">
                      <span>
                        <FormattedMessage
                          id="autoDocs.fieldOptions"
                          defaultMessage="Options, one per line"
                        />
                      </span>
                      <textarea
                        required
                        className={TEXTAREA_CLASS}
                        value={field.optionText}
                        onChange={(event) => update(field.key, { optionText: event.target.value })}
                      />
                    </label>
                  )}
                  <label className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={field.required}
                      onChange={(event) => update(field.key, { required: event.target.checked })}
                    />
                    <FormattedMessage id="autoDocs.fieldRequired" defaultMessage="Required" />
                  </label>
                  <div className="flex flex-wrap gap-2">
                    <Button
                      type="button"
                      variant="secondary"
                      disabled={index === 0}
                      onClick={() => moved(index, -1)}
                    >
                      <FormattedMessage id="autoDocs.moveUp" defaultMessage="Move up" />
                    </Button>
                    <Button
                      type="button"
                      variant="secondary"
                      disabled={index === fields.length - 1}
                      onClick={() => moved(index, 1)}
                    >
                      <FormattedMessage id="autoDocs.moveDown" defaultMessage="Move down" />
                    </Button>
                    <Button
                      type="button"
                      variant="secondary"
                      onClick={() =>
                        setFields((rows) => rows.filter((row) => row.key !== field.key))
                      }
                    >
                      <FormattedMessage id="autoDocs.removeField" defaultMessage="Remove field" />
                    </Button>
                  </div>
                </fieldset>
              ))}
              <div className="flex gap-2">
                <Button
                  type="button"
                  variant="secondary"
                  disabled={busy || archived}
                  onClick={() => {
                    let number = nextKey;
                    while (fields.some((field) => field.slug === `field_${number}`)) number++;
                    setFields((rows) => [
                      ...rows,
                      {
                        key: `new-${number}`,
                        slug: `field_${number}`,
                        label: intl.formatMessage({
                          id: "autoDocs.newField",
                          defaultMessage: "New field",
                        }),
                        help: null,
                        fieldType: "text",
                        options: null,
                        optionText: "",
                        required: false,
                        displayOrder: rows.length,
                        placeholder: false,
                      },
                    ]);
                    setNextKey(number + 1);
                  }}
                >
                  <FormattedMessage id="autoDocs.addField" defaultMessage="Add field" />
                </Button>
                <Button type="submit" disabled={busy || archived}>
                  <FormattedMessage id="autoDocs.saveForm" defaultMessage="Save form" />
                </Button>
              </div>
            </form>
          </section>
          <section
            aria-labelledby="auto-doc-versions-title"
            className="space-y-3 rounded-card border border-border-default bg-raised p-6"
          >
            <h2 id="auto-doc-versions-title" className="text-lg font-semibold">
              <FormattedMessage id="autoDocs.formVersions" defaultMessage="Form versions" />
            </h2>
            <ul className="space-y-2">
              {saved.formVersions.map((version) => (
                <li key={version.id} className="flex flex-wrap justify-between gap-2 text-sm">
                  <span>
                    <FormattedMessage
                      id="autoDocs.formVersion"
                      defaultMessage="Form version {number}"
                      values={{ number: version.versionNumber }}
                    />
                  </span>
                  <span className="text-muted">
                    <FormattedMessage
                      id="autoDocs.formVersionDetails"
                      defaultMessage="{date, date, medium} · {count, plural, one {# field} other {# fields}}"
                      values={{
                        date: new Date(version.createdAt),
                        count: version.definition.fields.length,
                      }}
                    />
                  </span>
                </li>
              ))}
            </ul>
          </section>
        </div>
      </RecordApplets>
    </AppShell>
  );
}
