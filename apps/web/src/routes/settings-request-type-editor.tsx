// SPDX-License-Identifier: AGPL-3.0-only

/** Intake form identity, target turnaround, and attached fields. */

import { useRef, useState } from "react";
import { redirect, useLoaderData, type LoaderFunctionArgs } from "react-router";
import { defineMessages, FormattedMessage, useIntl } from "react-intl";
import { api } from "../lib/api";
import { problem } from "../lib/problem";
import { CONTROL_CLASS } from "../lib/form-controls";
import { requireUser } from "../lib/session";
import { IntakeSettingsTabs } from "../components/intake-settings-tabs";
import { StatusNote, type FieldStatus } from "../components/status-note";
import { Label } from "../components/ui/label";
import {
  TypeEditorScreen,
  type EditorRequiredRule,
  type EditorTypeRow,
  type TypeEditorApi,
  type TypeEditorBasics,
} from "../components/type-editor-screen";

/** The two modules a request type may convert into (INT-002). */
type TargetModule = "matter" | "contract";

export async function settingsRequestTypeEditorLoader({ params }: LoaderFunctionArgs) {
  const user = await requireUser();
  if (user.role !== "administrator") return redirect("/settings/profile");
  const id = params.typeId!;
  const [typeRes, attachedRes, catalogRes] = await Promise.all([
    api.GET("/api/v1/request-types/{id}", { params: { path: { id } } }),
    api.GET("/api/v1/request-types/{id}/fields", { params: { path: { id } } }),
    api.GET("/api/v1/fields", {}),
  ]);
  if (!typeRes.data || !attachedRes.data) {
    throw new Error("The request type could not be read.");
  }
  if (!catalogRes.data) throw new Error("The field catalog could not be read.");
  return {
    requestType: typeRes.data.requestType,
    attachedFields: attachedRes.data.attachedFields,
    catalog: catalogRes.data.fields,
  };
}

/** The INT-002 vocabulary over the shared editor's message slots. */
const MESSAGES = defineMessages({
  allTypes: { id: "settings.requestTypeEditor.allTypes", defaultMessage: "All request types" },
  displayName: { id: "settings.requestTypeEditor.displayName", defaultMessage: "Display name" },
  description: { id: "settings.requestTypeEditor.description", defaultMessage: "Description" },
  slug: { id: "settings.requestTypeEditor.slug", defaultMessage: "Slug" },
  slugNote: {
    id: "settings.requestTypeEditor.slugNote",
    defaultMessage: "Slug is immutable — it keys the portal form, reporting, and the API.",
  },
  // No `inUse`: requests land in M20, so the caption would read
  // "0 requests" on every type — the pane omits it for the same reason.
  attachedFields: {
    id: "settings.requestTypeEditor.formFields",
    defaultMessage: "Form fields",
  },
  fieldColumn: { id: "settings.requestTypeEditor.fieldColumn", defaultMessage: "Field" },
  requiredColumn: { id: "settings.requestTypeEditor.requiredColumn", defaultMessage: "Required" },
  requiredFor: { id: "settings.requestTypeEditor.requiredFor", defaultMessage: "{name} required" },
  requiredLocked: {
    id: "settings.requestTypeEditor.requiredLocked",
    defaultMessage:
      "{name} can be on the form, but it can't be required. A requester picks no person and no entity in the portal.",
  },
  detach: { id: "settings.requestTypeEditor.detach", defaultMessage: "Detach {name}" },
  detached: { id: "settings.requestTypeEditor.detached", defaultMessage: "{name} detached." },
  attach: { id: "settings.requestTypeEditor.attach", defaultMessage: "Attach field" },
  attached: { id: "settings.requestTypeEditor.attached", defaultMessage: "{name} attached." },
  allAttached: {
    id: "settings.requestTypeEditor.allAttached",
    defaultMessage: "Every field this target allows is attached.",
  },
  empty: {
    id: "settings.requestTypeEditor.empty",
    defaultMessage: "No catalog fields are on this form yet.",
  },
  reorder: {
    id: "settings.requestTypeEditor.reorder",
    defaultMessage:
      "Reorder {name}, position {position} of {total}. Use the arrow keys to move it.",
  },
  moved: {
    id: "settings.requestTypeEditor.moved",
    defaultMessage: "{name} moved to position {position} of {total}.",
  },
  globalCaption: {
    id: "settings.requestTypeEditor.globalCaption",
    defaultMessage: "{type} · global",
  },
});

/**
 * The one field rule that is the portal's (INT-002's M20/11 addendum,
 * #400): a `user` or `entity` field may sit on a request form and may
 * never be required on one. The portal draws both controls empty on
 * purpose — a requester reads neither the staff directory nor the
 * Entity registry (DD-013, DD-016) — so a required one is a question
 * nobody who can reach the form is able to answer.
 *
 * The box is locked here so the rule reads as a rule, rather than as a
 * save that fails. The API refuses the same write, which is the real
 * guard.
 */
const REQUIRED_RULE: EditorRequiredRule = {
  fieldTypes: ["user", "entity"],
  reason: MESSAGES.requiredLocked,
};

/**
 * The four basics (INT-002): what every request form collects, whatever
 * an Administrator configures. Title, Description, and Urgency are
 * required; Attachments are optional. Urgency wears the DES-018
 * severity ramp.
 */
const BASICS = defineMessages({
  caption: {
    id: "settings.requestTypeEditor.basicsCaption",
    defaultMessage: "Basics are always on the form",
  },
  locked: {
    id: "settings.requestTypeEditor.basicLocked",
    defaultMessage: "{name} is always collected and can't be changed.",
  },
  title: { id: "settings.requestTypeEditor.basicTitle", defaultMessage: "Title" },
  titleType: { id: "settings.requestTypeEditor.basicTitleType", defaultMessage: "Text" },
  description: { id: "settings.requestTypeEditor.basicDescription", defaultMessage: "Description" },
  descriptionType: {
    id: "settings.requestTypeEditor.basicDescriptionType",
    defaultMessage: "Long text",
  },
  attachments: {
    id: "settings.requestTypeEditor.basicAttachments",
    defaultMessage: "Attachments",
  },
  attachmentsType: {
    id: "settings.requestTypeEditor.basicAttachmentsType",
    defaultMessage: "Files",
  },
  urgency: { id: "settings.requestTypeEditor.basicUrgency", defaultMessage: "Urgency" },
  urgencyType: {
    id: "settings.requestTypeEditor.basicUrgencyType",
    defaultMessage: "Single select",
  },
});

const BASICS_SLOT: TypeEditorBasics = {
  caption: BASICS.caption,
  locked: BASICS.locked,
  rows: [
    { key: "title", name: BASICS.title, caption: BASICS.titleType, isRequired: true },
    {
      key: "description",
      name: BASICS.description,
      caption: BASICS.descriptionType,
      isRequired: true,
    },
    {
      key: "attachments",
      name: BASICS.attachments,
      caption: BASICS.attachmentsType,
      isRequired: false,
    },
    { key: "urgency", name: BASICS.urgency, caption: BASICS.urgencyType, isRequired: true },
  ],
};

/** The shared editor's API seam over the request-types routes. */
const EDITOR_API: TypeEditorApi = {
  async update(id, body) {
    const result = await api
      .PATCH("/api/v1/request-types/{id}", {
        params: { path: { id } },
        body,
      })
      .catch(() => undefined);
    return { data: result?.data?.requestType, ...(await problem(result)) };
  },
  async attach(id, fieldId) {
    const result = await api
      .POST("/api/v1/request-types/{id}/fields", {
        params: { path: { id } },
        body: { fieldId },
      })
      .catch(() => undefined);
    return { data: result?.data?.attachedField, ...(await problem(result)) };
  },
  async detach(id, fieldId) {
    const result = await api
      .DELETE("/api/v1/request-types/{id}/fields/{fieldId}", {
        params: { path: { id, fieldId } },
      })
      .catch(() => undefined);
    return { ok: result?.response.ok === true, ...(await problem(result)) };
  },
  async setRequired(id, fieldId, isRequired) {
    const result = await api
      .PATCH("/api/v1/request-types/{id}/fields/{fieldId}", {
        params: { path: { id, fieldId } },
        body: { isRequired },
      })
      .catch(() => undefined);
    return { data: result?.data?.attachedField, ...(await problem(result)) };
  },
  async reorder(id, fieldIds) {
    const result = await api
      .PUT("/api/v1/request-types/{id}/fields/order", {
        params: { path: { id } },
        body: { fieldIds },
      })
      .catch(() => undefined);
    return { data: result?.data?.attachedFields, ...(await problem(result)) };
  },
};

/**
 * Which catalog scopes this target allows — the client half of the
 * rule the API refuses on (INT-002). It offers only what would be
 * accepted, so the Attach menu never shows a field the server would
 * turn away.
 */
function attachableScopes(module: TargetModule | null): readonly string[] {
  if (module === null) return ["global"];
  return [module, "global"];
}

/** INT-003 publishes a business-day suggestion, never a change to existing estimates. */
function TurnaroundControl({
  typeId,
  initial,
}: Readonly<{ typeId: string; initial: number | null }>) {
  const intl = useIntl();
  const [saved, setSaved] = useState(initial);
  const [draft, setDraft] = useState(initial === null ? "" : String(initial));
  const [status, setStatus] = useState<FieldStatus>("idle");
  const [error, setError] = useState<string | null>(null);
  const pending = useRef(false);
  async function commit() {
    if (pending.current) return;
    const turnaroundDays = draft.trim() === "" ? null : Number(draft);
    if (
      turnaroundDays !== null &&
      (!Number.isInteger(turnaroundDays) || turnaroundDays < 0 || turnaroundDays > 36500)
    ) {
      setStatus("error");
      setError(
        intl.formatMessage({
          id: "settings.requestTypeEditor.turnaroundInvalid",
          defaultMessage: "Enter a whole number from 0 to 36,500 business days, or leave it blank.",
        }),
      );
      return;
    }
    if (turnaroundDays === saved) return;
    pending.current = true;
    setStatus("saving");
    setError(null);
    const result = await api
      .PATCH("/api/v1/request-types/{id}", {
        params: { path: { id: typeId } },
        body: { turnaroundDays },
      })
      .catch(() => undefined);
    if (result?.data) {
      const next = result.data.requestType.turnaroundDays;
      setSaved(next);
      setDraft(next === null ? "" : String(next));
      setStatus("saved");
    } else {
      setStatus("error");
      setError((await problem(result)).detail ?? null);
    }
    pending.current = false;
  }
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor="request-type-turnaround">
        <FormattedMessage
          id="settings.requestTypeEditor.turnaround"
          defaultMessage="Target turnaround (business days)"
        />
      </Label>
      <input
        id="request-type-turnaround"
        type="number"
        min="0"
        max="36500"
        step="1"
        className={CONTROL_CLASS}
        value={draft}
        // Held still rather than disabled: a browser takes focus off a
        // control it disables, so committing with Enter would throw the
        // keyboard out of the box it was typing in. `readOnly` refuses
        // the edit and keeps the caret; `pending` refuses the second
        // commit.
        readOnly={status === "saving"}
        onChange={(event) => {
          setDraft(event.target.value);
          // The refusal was about the text that is now gone. Left
          // standing over the new text it reads as a lie about it.
          if (status === "error") {
            setStatus("idle");
            setError(null);
          }
        }}
        onBlur={() => void commit()}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            void commit();
          }
          // Escape reached nothing while the box was disabled, and it
          // reaches nothing while a save is in flight now: reverting the
          // text under a write that is about to answer would show the
          // old number as though it had been kept.
          if (event.key === "Escape" && !pending.current) {
            setDraft(saved === null ? "" : String(saved));
            setStatus("idle");
            setError(null);
          }
        }}
        aria-describedby="request-type-turnaround-help"
      />
      <p id="request-type-turnaround-help" className="text-xs text-muted">
        <FormattedMessage
          id="settings.requestTypeEditor.turnaroundHint"
          defaultMessage="Counts Monday–Friday from submission in the organization’s timezone, without excluding public holidays, for Legal to confirm. Blank means no suggestion; saved Request estimates stay unchanged."
        />
      </p>
      <StatusNote status={status} detail={error} />
    </div>
  );
}

export function SettingsRequestTypeEditorPage() {
  const { requestType, attachedFields, catalog } =
    useLoaderData<typeof settingsRequestTypeEditorLoader>();
  const scopes = attachableScopes(requestType.targetModule ?? null);
  const identity: EditorTypeRow = requestType;
  return (
    <TypeEditorScreen
      initialType={identity}
      tabs={<IntakeSettingsTabs />}
      backPath="/settings/intake/request-types"
      api={EDITOR_API}
      messages={MESSAGES}
      identityExtra={
        <TurnaroundControl
          key={requestType.id}
          typeId={requestType.id}
          initial={requestType.turnaroundDays ?? null}
        />
      }
      showSlug={false}
      attachments={{
        initialAttached: attachedFields,
        catalog: catalog.filter((field) => scopes.includes(field.moduleScope)),
        api: EDITOR_API,
        messages: MESSAGES,
        basics: BASICS_SLOT,
        requiredRule: REQUIRED_RULE,
      }}
    />
  );
}
