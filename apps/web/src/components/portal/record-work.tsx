// SPDX-License-Identifier: AGPL-3.0-only

import { useRevalidator } from "react-router";
import { ValueField } from "../contracts/value-field";
import { StatusNote, type FieldStatus } from "../status-note";
import { severityLabel } from "../../lib/contracts";
import { portalContractReader } from "../../lib/portal-contracts";
import type { ContractValue } from "../../lib/contracts";
import { Input } from "../ui/input";
import { useRef, useState } from "react";
import { FormattedMessage, useIntl } from "react-intl";
import { CustomFieldControl } from "../custom-field-control";
import { AutoResizeTextarea } from "../auto-resize-textarea";
import { DocPanel } from "../documents/doc-panel";
import { Button } from "../ui/button";
import {
  commitsOnChange,
  sameDraft,
  toDraft,
  toValue,
  type AttachedField,
  type CustomFieldDraft,
} from "../../lib/custom-fields";
import {
  documentDownloadHref,
  uploadDocumentVersion,
  uploadRecordDocument,
} from "../../lib/documents";
import { formatShortDate } from "../../lib/format";
import { problem } from "../../lib/problem";
import {
  readPortalDocuments,
  savePortalWork,
  type PortalDocuments,
  type PortalRecordModule,
  type PortalWork,
} from "../../lib/portal-records";

const card = "flex flex-col gap-4 rounded-card border border-border-default bg-raised p-5";

export function PortalRecordWork({
  module,
  number,
  work,
  documents,
}: Readonly<{
  module: PortalRecordModule;
  number: number;
  work: PortalWork;
  documents: PortalDocuments;
}>) {
  const intl = useIntl();
  const [description, setDescription] = useState(work.description ?? "");
  const [savedDescription, setSavedDescription] = useState(description);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function saveDescription() {
    if (saving || description === savedDescription) return;
    setSaving(true);
    setError(null);
    const result = await savePortalWork(module, number, { description }).catch(() => undefined);
    if (result?.data) {
      setSavedDescription(result.data.description ?? "");
      setDescription(result.data.description ?? "");
    } else
      setError(
        (await problem(result)).detail ??
          intl.formatMessage({
            id: "portal.record.failed",
            defaultMessage: "The change could not be saved. Try again.",
          }),
      );
    setSaving(false);
  }
  return (
    <>
      <section className={card} aria-labelledby="portal-fields-heading">
        <h2 id="portal-fields-heading" className="text-lg font-semibold">
          <FormattedMessage id="portal.record.fields" defaultMessage="Fields" />
        </h2>
        <div className="flex flex-col gap-2">
          <label htmlFor="portal-description" className="text-base font-medium">
            <FormattedMessage id="portal.record.description" defaultMessage="Description" />
          </label>
          <AutoResizeTextarea
            id="portal-description"
            value={description}
            disabled={saving}
            onChange={(event) => setDescription(event.target.value)}
            onBlur={() => void saveDescription()}
          />
          {error && (
            <p role="alert" className="text-base text-status-danger-fg">
              {error}
            </p>
          )}
          {error && (
            <Button variant="secondary" disabled={saving} onClick={() => void saveDescription()}>
              <FormattedMessage id="portal.record.retrySave" defaultMessage="Retry save" />
            </Button>
          )}
        </div>
        {module === "contract" && <ContractBusinessFields work={work} number={number} />}
        {work.fields.map((field) => (
          <BusinessField
            key={field.slug}
            field={field}
            work={work}
            module={module}
            number={number}
          />
        ))}
      </section>
      <SupportingDocuments module={module} number={number} initial={documents} />
      {work.originalRequests.map((original) => (
        <section className={card} key={original.number}>
          <h2 className="text-lg font-semibold">
            <FormattedMessage
              id="portal.record.originalRequest"
              defaultMessage="Original request"
            />
          </h2>
          <p className="font-medium">{original.summary}</p>
          <p className="text-sm text-muted">
            <FormattedMessage
              id="portal.record.originalMeta"
              defaultMessage="R-{number} · {requester} · Submitted {date}"
              values={{
                number: original.number,
                requester: original.requester,
                date: formatShortDate(original.submittedAt),
              }}
            />
          </p>
          <p className="text-sm text-muted">
            <FormattedMessage
              id="portal.record.originalUrgency"
              defaultMessage="Urgency: {urgency}"
              values={{ urgency: severityLabel(intl, original.urgency) }}
            />
          </p>
          {(original.documents ?? []).length > 0 && (
            <ul className="flex flex-col gap-2">
              {original.documents.map((file, index) => (
                <li key={`${file.filename}:${index}`}>
                  {file.reference ? (
                    <a
                      className="text-link"
                      href={
                        file.reference.primary
                          ? portalContractReader(number).documentDownloadHref(
                              file.reference.documentId,
                              file.reference.versionId,
                            )
                          : documentDownloadHref(
                              file.reference.documentId,
                              file.reference.versionId,
                            )
                      }
                    >
                      {file.filename}
                    </a>
                  ) : (
                    <span>{file.filename}</span>
                  )}
                </li>
              ))}
            </ul>
          )}
          {original.description && <p className="whitespace-pre-wrap">{original.description}</p>}
          <dl className="flex flex-col gap-3">
            {original.fields
              .filter((field) => original.customFields[field.slug] !== undefined)
              .map((field) => {
                const value = original.customFields[field.slug]!;
                const reference =
                  field.fieldType === "user"
                    ? original.references.people.find((person) => person.id === value)
                    : field.fieldType === "entity"
                      ? original.references.entities.find((entity) => entity.id === value)
                      : undefined;
                const label =
                  reference?.label ??
                  (typeof value === "boolean"
                    ? intl.formatMessage(
                        {
                          id: "portal.request.booleanValue",
                          defaultMessage: "{value, select, true {Yes} other {No}}",
                        },
                        { value: String(value) },
                      )
                    : Array.isArray(value)
                      ? intl.formatList(value)
                      : String(value));
                return (
                  <div key={field.slug}>
                    <dt className="text-sm font-medium text-muted">{field.displayName}</dt>
                    <dd className="whitespace-pre-wrap">{label}</dd>
                  </div>
                );
              })}
          </dl>
        </section>
      ))}
    </>
  );
}

function BusinessField({
  field,
  work,
  module,
  number,
}: Readonly<{
  field: AttachedField;
  work: PortalWork;
  module: PortalRecordModule;
  number: number;
}>) {
  const intl = useIntl();
  const [draft, setDraft] = useState(() => toDraft(field, work.customFields[field.slug]));
  const [saved, setSaved] = useState(draft);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function save(next: CustomFieldDraft) {
    if (busy || sameDraft(next, saved)) return;
    const parsed = toValue(field, next);
    if ("error" in parsed) {
      setError(
        intl.formatMessage({
          id: "portal.record.invalidNumber",
          defaultMessage: "Enter a number.",
        }),
      );
      return;
    }
    setBusy(true);
    setError(null);
    const result = await savePortalWork(module, number, {
      customFields: { [field.slug]: parsed.value },
    }).catch(() => undefined);
    if (result?.data) {
      const value = toDraft(field, result.data.customFields[field.slug]);
      setSaved(value);
      setDraft(value);
    } else
      setError(
        (await problem(result)).detail ??
          intl.formatMessage({
            id: "portal.record.failed",
            defaultMessage: "The change could not be saved. Try again.",
          }),
      );
    setBusy(false);
  }
  return (
    <div className="flex flex-col gap-2">
      <label htmlFor={`portal-field-${field.slug}`} className="text-base font-medium">
        {field.displayName}
      </label>
      <CustomFieldControl
        id={`portal-field-${field.slug}`}
        field={field}
        draft={draft}
        disabled={busy}
        people={work.references.people}
        entities={work.references.entities}
        onDraft={(next) => {
          setDraft(next);
          if (commitsOnChange(field)) void save(next);
        }}
        onBlur={() => {
          if (!commitsOnChange(field)) void save(draft);
        }}
      />
      {error && (
        <>
          <p role="alert" className="text-base text-status-danger-fg">
            {error}
          </p>
          <Button variant="secondary" disabled={busy} onClick={() => void save(draft)}>
            <FormattedMessage id="portal.record.retrySave" defaultMessage="Retry save" />
          </Button>
        </>
      )}
    </div>
  );
}

function SupportingDocuments({
  module,
  number,
  initial,
}: Readonly<{ module: PortalRecordModule; number: number; initial: PortalDocuments }>) {
  const intl = useIntl();
  const [data, setData] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reading, setReading] = useState<PortalDocuments["documents"][number] | null>(null);
  const [covers, setCovers] = useState(true);
  const [target, setTarget] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const trigger = useRef<HTMLButtonElement | null>(null);
  async function upload(file: File) {
    setBusy(true);
    setError(null);
    const draft = { file, kind: "general" as const, note: "" };
    const outcome = await (target
      ? uploadDocumentVersion(target, draft)
      : uploadRecordDocument({ entityType: module, number }, draft));
    if (!outcome.ok)
      setError(
        outcome.detail ??
          intl.formatMessage({
            id: "portal.record.failed",
            defaultMessage: "The change could not be saved. Try again.",
          }),
      );
    else {
      const result = await readPortalDocuments(module, number).catch(() => undefined);
      if (result?.data) setData(result.data);
      else
        setError(
          (await problem(result)).detail ??
            intl.formatMessage({
              id: "portal.record.failed",
              defaultMessage: "The change could not be saved. Try again.",
            }),
        );
    }
    setBusy(false);
  }
  async function more() {
    if (!data.nextCursor || busy) return;
    setBusy(true);
    setError(null);
    const result = await readPortalDocuments(module, number, data.nextCursor).catch(
      () => undefined,
    );
    if (result?.data)
      setData((previous) => ({
        documents: [...previous.documents, ...result.data.documents],
        nextCursor: result.data.nextCursor,
      }));
    else
      setError(
        (await problem(result)).detail ??
          intl.formatMessage({
            id: "portal.record.failed",
            defaultMessage: "The change could not be saved. Try again.",
          }),
      );
    setBusy(false);
  }
  return (
    <div className="@container/record relative flex min-w-0 gap-4">
      <section
        className={`${card} min-w-0 flex-1`}
        aria-labelledby="portal-documents-heading"
        inert={reading !== null && covers}
      >
        <h2 id="portal-documents-heading" className="text-lg font-semibold">
          <FormattedMessage id="portal.record.documents" defaultMessage="Supporting Documents" />
        </h2>
        <input
          ref={input}
          type="file"
          className="hidden"
          aria-label={intl.formatMessage({
            id: "portal.record.upload",
            defaultMessage: "Upload Document",
          })}
          onChange={(event) => {
            const file = event.target.files?.[0];
            event.target.value = "";
            if (file) void upload(file);
          }}
        />
        <Button
          disabled={busy}
          onClick={() => {
            setTarget(null);
            input.current?.click();
          }}
        >
          <FormattedMessage id="portal.record.upload" defaultMessage="Upload Document" />
        </Button>
        {error && (
          <p role="alert" className="text-base text-status-danger-fg">
            {error}
          </p>
        )}
        {data.documents.length === 0 && (
          <p className="text-muted">
            <FormattedMessage
              id="portal.record.noSupporting"
              defaultMessage="No supporting Documents yet."
            />
          </p>
        )}
        <ul className="flex flex-col gap-4">
          {data.documents.map((document) => (
            <li
              key={document.id}
              className="flex flex-col gap-2 border-b border-border-default pb-4"
            >
              <p className="font-medium">{document.title}</p>
              <div className="flex flex-wrap gap-2">
                <Button
                  variant="secondary"
                  onClick={(event) => {
                    trigger.current = event.currentTarget;
                    setReading(document);
                  }}
                >
                  <FormattedMessage
                    id="portal.contract.readDocument"
                    defaultMessage="Read Document"
                  />
                </Button>
                <Button variant="secondary" asChild>
                  <a href={documentDownloadHref(document.id, document.version.id)}>
                    <FormattedMessage id="docPanel.download" defaultMessage="Download" />
                  </a>
                </Button>
                <Button
                  variant="secondary"
                  disabled={busy}
                  onClick={() => {
                    setTarget(document.id);
                    input.current?.click();
                  }}
                >
                  <FormattedMessage id="portal.record.addVersion" defaultMessage="Add version" />
                </Button>
              </div>
            </li>
          ))}
        </ul>
        {data.nextCursor && (
          <Button disabled={busy} variant="secondary" onClick={() => void more()}>
            <FormattedMessage id="portal.record.moreDocuments" defaultMessage="More Documents" />
          </Button>
        )}
      </section>
      {reading && (
        <DocPanel
          documentId={reading.id}
          title={reading.title}
          version={reading.version}
          onDockedChange={(docked) => setCovers(!docked)}
          onClose={() => {
            setReading(null);
            setTimeout(() => trigger.current?.focus(), 0);
          }}
        />
      )}
    </div>
  );
}

function ContractBusinessFields({ work, number }: Readonly<{ work: PortalWork; number: number }>) {
  const intl = useIntl();
  const revalidator = useRevalidator();
  const [value, setValue] = useState(work.value ?? null);
  const [date, setDate] = useState(work.effectiveDate ?? "");
  const [savedDate, setSavedDate] = useState(date);
  const [status, setStatus] = useState<FieldStatus>("idle");
  const [dateStatus, setDateStatus] = useState<FieldStatus>("idle");
  const [error, setError] = useState<string | undefined>();
  const [dateError, setDateError] = useState<string | undefined>();
  async function save(key: "value" | "effectiveDate", next: ContractValue | string | null) {
    const note = key === "value" ? setStatus : setDateStatus;
    const fail = key === "value" ? setError : setDateError;
    note("saving");
    fail(undefined);
    const body =
      key === "value"
        ? { value: next as ContractValue | null }
        : { effectiveDate: next as string | null };
    const result = await savePortalWork("contract", number, body).catch(() => undefined);
    if (!result?.data) {
      note("error");
      fail(
        (await problem(result)).detail ??
          intl.formatMessage({
            id: "portal.record.failed",
            defaultMessage: "The change could not be saved. Try again.",
          }),
      );
      return;
    }
    if (key === "value") setValue(result.data.value ?? null);
    else {
      setDate(result.data.effectiveDate ?? "");
      setSavedDate(result.data.effectiveDate ?? "");
    }
    note("saved");
    void revalidator.revalidate();
  }
  return (
    <>
      <ValueField
        value={value}
        frozen={status === "saving"}
        status={status}
        error={error}
        onStatus={(next, detail) => {
          setStatus(next);
          setError(detail);
        }}
        onCommit={(next) => void save("value", next)}
      />
      <div className="flex flex-col gap-2">
        <label htmlFor="portal-effective-date" className="font-medium">
          <FormattedMessage id="portal.contract.effectiveDate" defaultMessage="Effective date" />
        </label>
        <Input
          id="portal-effective-date"
          type="date"
          value={date}
          disabled={dateStatus === "saving"}
          onChange={(event) => setDate(event.target.value)}
          onBlur={() => {
            if (date !== savedDate) void save("effectiveDate", date || null);
          }}
        />
        <StatusNote status={dateStatus} detail={dateError} />
      </div>
    </>
  );
}
