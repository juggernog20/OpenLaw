// SPDX-License-Identifier: AGPL-3.0-only

/** DES-090 inventory of the destination Form. Only the preview evaluates answers. */
import { useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router";
import { FormattedMessage, useIntl } from "react-intl";
import { Eye } from "lucide-react";
import { formForTouchpoint, type Form, type FormRow } from "@openlaw/shared";
import { api } from "../../lib/api";
import { problem } from "../../lib/problem";
import type { ApiField } from "../../lib/field-catalog";
import { SettingsCard } from "../settings-card";
import { Button } from "../ui/button";
import { branchName, fieldTypeName, flatten, rowName } from "./model";
import { useFormText } from "./messages";
import { IntakePreview } from "./preview";
import { referenceOptions } from "./reference-options";

export function IntakeFormCard({
  module,
  destinationType,
  catalog,
  requestType,
  requestTypeId,
  sharedWith = [],
}: Readonly<{
  module: "contract" | "matter";
  destinationType?: { id: string; displayName: string; isDefault: boolean };
  catalog: readonly ApiField[];
  requestType: { displayName: string; description: string | null };
  requestTypeId?: string;
  /** The other live Request types whose destination resolves to this
   * type. An edit to the Form changes their Portal form too. */
  sharedWith?: readonly string[];
}>) {
  const t = useFormText();
  const intl = useIntl();
  const navigate = useNavigate();
  const [separating, setSeparating] = useState(false);
  const [separateError, setSeparateError] = useState<string | null>(null);

  /** DES-090 point 7 addendum: copy the shared type, point this Request
   * type at the copy, then open the copy's Form tab. */
  async function separate() {
    if (separating || !requestTypeId) return;
    setSeparating(true);
    setSeparateError(null);
    const result = await api
      .POST("/api/v1/request-types/{id}/separate-form", {
        params: { path: { id: requestTypeId } },
      })
      .catch(() => undefined);
    if (result?.data) {
      void navigate(`/settings/${module}s/types/${result.data.type.id}/form`);
      return;
    }
    setSeparateError(
      (await problem(result)).detail ??
        intl.formatMessage({
          id: "settings.requestTypeEditor.separateFormError",
          defaultMessage: "The separate Form could not be created.",
        }),
    );
    setSeparating(false);
  }
  const eye = useRef<HTMLButtonElement>(null);
  const [form, setForm] = useState<Form | null>(null);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [preview, setPreview] = useState(false);
  const [referenceLabels, setReferenceLabels] = useState<
    Record<string, { value: string; label: string }[]>
  >({});
  const typeId = destinationType?.id;
  useEffect(() => {
    let active = true;
    async function read() {
      try {
        if (!typeId) throw new Error("The destination type could not be read.");
        const path =
          module === "contract"
            ? "/api/v1/contract-types/{id}/form"
            : "/api/v1/matter-types/{id}/form";
        const { data } = await api.GET(path, { params: { path: { id: typeId } } });
        if (!data) throw new Error("The Intake form could not be read.");
        if (!active) return;
        setForm(data.form);
        const nodes = flatten(data.form);
        const refs = new Set(
          nodes.flatMap((n) => (n.kind === "branch" ? n.conditions.map((c) => c.rowRef) : [])),
        );
        const rows = nodes.filter((n): n is FormRow => n.kind === "row" && refs.has(n.rowRef));
        const labels = await Promise.all(
          rows.map(
            async (row) => [row.rowRef, await referenceOptions(row).catch(() => null)] as const,
          ),
        );
        if (active)
          setReferenceLabels(
            Object.fromEntries(
              labels.filter(
                (entry): entry is readonly [string, { value: string; label: string }[]] =>
                  entry[1] !== null,
              ),
            ),
          );
      } catch {
        if (active) setFailed(true);
      }
    }
    void read();
    return () => {
      active = false;
    };
  }, [module, typeId, attempt]);

  function attachmentsRow() {
    return (
      <li className="flex min-h-13 items-center justify-between gap-3 border-b border-border-muted px-4 py-2">
        <div className="min-w-0">
          <p className="text-base">{t("Attachments")}</p>
          <p className="text-sm text-muted">
            <FormattedMessage
              id="settings.requestTypeEditor.basicAttachmentsType"
              defaultMessage="Files"
            />
          </p>
        </div>
        <span className="text-sm text-muted">
          <FormattedMessage
            id="settings.requestTypeEditor.optionalFact"
            defaultMessage="Optional"
          />
        </span>
      </li>
    );
  }
  function rows(nodes: Form) {
    return nodes.map((node) =>
      node.kind === "branch" ? (
        <li key={node.id} className="ml-4 border-l-2 border-border-strong">
          <p className="px-4 py-3 text-sm font-medium">
            {branchName(node, form ?? [], catalog, t, referenceLabels)}
          </p>
          <ul>{rows(node.children)}</ul>
        </li>
      ) : (
        <li
          key={node.id}
          className="flex min-h-13 items-center justify-between gap-3 border-b border-border-muted px-4 py-2"
        >
          <div className="min-w-0">
            <p className="text-base font-medium">{rowName(node, catalog, t)}</p>
            <p className="text-sm text-muted">{fieldTypeName(node.fieldType, t)}</p>
          </div>
          <span className="text-sm text-muted">
            {node.isRequired ? (
              <FormattedMessage
                id="settings.requestTypeEditor.requiredFact"
                defaultMessage="Required"
              />
            ) : (
              <FormattedMessage
                id="settings.requestTypeEditor.optionalFact"
                defaultMessage="Optional"
              />
            )}
          </span>
        </li>
      ),
    );
  }
  return (
    <SettingsCard
      title={
        <FormattedMessage id="settings.requestTypeEditor.intakeForm" defaultMessage="Intake form" />
      }
      region
      flush
      actions={
        <div className="flex items-center gap-2">
          <Button
            ref={eye}
            type="button"
            size="icon"
            variant="ghost"
            className="size-7"
            aria-label={t("Preview intake form")}
            disabled={!form}
            onClick={() => setPreview(true)}
          >
            <Eye size={16} aria-hidden="true" />
          </Button>
          {destinationType && (
            <Button asChild variant="secondary" size="sm">
              <Link to={`/settings/${module}s/types/${destinationType.id}/form`}>
                <FormattedMessage
                  id="settings.requestTypeEditor.editForm"
                  defaultMessage="Edit form"
                />
              </Link>
            </Button>
          )}
        </div>
      }
    >
      {destinationType && (
        <div className="flex flex-col items-start gap-2 px-4 py-3">
          <p className="text-sm text-muted">{destinationType.displayName}</p>
          {(sharedWith.length > 0 || destinationType.isDefault) && (
            <p className="text-sm">
              {sharedWith.length > 0 && (
                <FormattedMessage
                  id="settings.requestTypeEditor.sharedForm"
                  defaultMessage="Also used by {names}. Changes here apply to {total, plural, =2 {both} other {all # Request types}}."
                  values={{
                    names: intl.formatList(sharedWith, { type: "conjunction" }),
                    total: sharedWith.length + 1,
                  }}
                />
              )}
              {sharedWith.length > 0 && destinationType.isDefault && " "}
              {destinationType.isDefault && (
                <FormattedMessage
                  id="settings.requestTypeEditor.defaultTypeForm"
                  defaultMessage="This is the {module, select, contract {Contract} other {Matter}} Default type."
                  values={{ module }}
                />
              )}
            </p>
          )}
          {sharedWith.length > 0 && requestTypeId && (
            <Button
              type="button"
              variant="secondary"
              size="sm"
              disabled={separating}
              onClick={() => void separate()}
            >
              <FormattedMessage
                id="settings.requestTypeEditor.separateForm"
                defaultMessage="Use a separate Form"
              />
            </Button>
          )}
          {separateError && (
            <p role="alert" className="text-sm text-status-danger-fg">
              {separateError}
            </p>
          )}
        </div>
      )}
      {failed ? (
        <div className="p-4">
          <p role="alert">
            <FormattedMessage
              id="settings.requestTypeEditor.formReadError"
              defaultMessage="The Intake form could not be read."
            />
          </p>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={() => {
              setFailed(false);
              setAttempt((n) => n + 1);
            }}
          >
            <FormattedMessage id="settings.requestTypeEditor.retryForm" defaultMessage="Retry" />
          </Button>
        </div>
      ) : form ? (
        <ul>
          {rows(formForTouchpoint(form, "intake"))}
          {attachmentsRow()}
        </ul>
      ) : (
        <p role="status" className="p-4 text-sm text-muted">
          <FormattedMessage
            id="settings.requestTypeEditor.formLoading"
            defaultMessage="Loading Intake form…"
          />
        </p>
      )}
      {preview && form && destinationType && (
        <IntakePreview
          form={form}
          catalog={catalog}
          module={module}
          typeId={destinationType.id}
          typeName={destinationType.displayName}
          isDefault={destinationType.isDefault}
          requestType={requestType}
          onClose={() => setPreview(false)}
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            eye.current?.focus();
          }}
        />
      )}
    </SettingsCard>
  );
}
