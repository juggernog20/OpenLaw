// SPDX-License-Identifier: AGPL-3.0-only

import { FormattedMessage, useIntl } from "react-intl";
import { severityLabel } from "../../lib/contracts";
import { portalContractReader } from "../../lib/portal-contracts";
import type { AttachedField, CustomFieldValue } from "../../lib/custom-fields";
import { documentDownloadHref } from "../../lib/documents";
import { PortalDocumentsSection } from "./documents-section";
import { formatShortDate } from "../../lib/format";
import type { PortalDocuments, PortalRecordModule, PortalWork } from "../../lib/portal-records";

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
  const unset = intl.formatMessage({
    id: "portal.contract.notRecorded",
    defaultMessage: "Not recorded",
  });
  function fieldValue(
    field: AttachedField,
    value: CustomFieldValue | undefined,
    references: PortalWork["references"],
  ) {
    if (value === undefined || value === null || (Array.isArray(value) && value.length === 0))
      return unset;
    if (field.fieldType === "user")
      return references.people.find((person) => person.id === value)?.label ?? unset;
    if (field.fieldType === "entity")
      return references.entities.find((entity) => entity.id === value)?.label ?? unset;
    if (typeof value === "boolean")
      return intl.formatMessage(
        {
          id: "portal.request.booleanValue",
          defaultMessage: "{value, select, true {Yes} other {No}}",
        },
        { value: String(value) },
      );
    if (Array.isArray(value)) return intl.formatList(value);
    if (typeof value === "number") return intl.formatNumber(value);
    if (field.fieldType === "date" && value) return formatShortDate(value);
    return String(value);
  }
  return (
    <>
      <section className={card} aria-labelledby="portal-fields-heading">
        <h2 id="portal-fields-heading" className="text-lg font-semibold">
          <FormattedMessage id="portal.record.fields" defaultMessage="Fields" />
        </h2>
        <dl className="flex flex-col gap-4">
          <div className="flex flex-col gap-1">
            <dt className="text-sm font-medium text-muted">
              <FormattedMessage id="portal.record.description" defaultMessage="Description" />
            </dt>
            <dd className="whitespace-pre-wrap text-base">{work.description || unset}</dd>
          </div>
          {work.fields.map((field) => (
            <div key={field.slug} className="flex flex-col gap-1">
              <dt className="text-sm font-medium text-muted">{field.displayName}</dt>
              <dd className="whitespace-pre-wrap text-base">
                {fieldValue(field, work.customFields[field.slug], work.references)}
              </dd>
            </div>
          ))}
        </dl>
      </section>
      <PortalDocumentsSection module={module} number={number} initial={documents} />
      {work.originalRequests.map((original) => (
        <section className={card} key={original.number}>
          <h2 className="text-lg font-semibold">
            <FormattedMessage
              id="portal.record.originalRequest"
              defaultMessage="Original request"
            />
          </h2>
          <p className="font-medium">{original.title}</p>
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
                const label = fieldValue(
                  field,
                  original.customFields[field.slug],
                  original.references,
                );
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
