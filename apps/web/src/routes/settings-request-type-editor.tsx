// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The request type editor (#85), the ST14 frame of settings.pen on the
 * shared TypeEditorScreen machinery — this file owns the INT-002
 * vocabulary, the API adapter over the request-types routes, and the
 * one control that is intake's own: the target. The DES-022 behavior
 * lives in the shared component, which is the point: the Intake editor
 * is configuration, not a copy of the Matters one. The loader is the
 * client half of SET-002's gate; the API's 403 is the real refusal.
 *
 * **The target is one select over three states.** No target; the Matter
 * module, then each live matter type; the Contract module, then each
 * live contract type. On the wire it is two values — the module and the
 * optional type id — and the help line under the select says what
 * conversion will do with whichever state is chosen. The change applies
 * on pick (SET-003) and is audit-logged like every other edit.
 *
 * **The picker offers live types only, and never lies about the
 * current one.** A target whose type has since been archived stays
 * selected, is marked as archived in the list, and is flagged under the
 * help line — the row still says what it says, and the Administrator
 * decides whether to re-point it. A target whose type is hard-deleted
 * never reaches here: the FK demotes the row to the module alone.
 *
 * **The right card is the form definition** (#355). It opens with the
 * four basics — Summary, Description, Attachments, and Urgency — as
 * locked rows stating what every request form collects (INT-002), and
 * below them the catalog fields the Administrator attached. Which
 * fields the Attach menu offers follows the target, the same rule the
 * API refuses on: contract-scoped and global under Contract,
 * matter-scoped and global under Matter, global only with no target.
 * So the target lives here rather than inside the select — changing it
 * changes what the menu offers, on the pick, with no reload.
 *
 * **One row type takes no required box.** A `user` or `entity` field
 * may sit on a request form but may never be required on one: the
 * portal offers a requester no rows for either, so a required one could
 * never be answered (#400). The card draws that box locked and says
 * why, and the API refuses the write behind it.
 */

import { useState } from "react";
import { redirect, useLoaderData, type LoaderFunctionArgs } from "react-router";
import { defineMessages, FormattedMessage, useIntl } from "react-intl";
import { TriangleAlert } from "lucide-react";
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

/** One row of a target taxonomy, as the picker needs it. */
interface TargetTypeRow {
  id: string;
  displayName: string;
  archivedAt: string | null;
}

/** The target as the row carries it, and as one PATCH writes it. */
interface Target {
  module: TargetModule | null;
  typeId: string | null;
}

export async function settingsRequestTypeEditorLoader({ params }: LoaderFunctionArgs) {
  const user = await requireUser();
  if (user.role !== "administrator") return redirect("/settings/profile");
  const id = params.typeId!;
  const [typeRes, matterRes, contractRes, attachedRes, catalogRes] = await Promise.all([
    api.GET("/api/v1/request-types/{id}", { params: { path: { id } } }),
    // Archived rows ride along so a target archived after it was picked
    // still reads as itself; the picker filters them out.
    api.GET("/api/v1/matter-types", { params: { query: { includeArchived: "true" } } }),
    api.GET("/api/v1/contract-types", { params: { query: { includeArchived: "true" } } }),
    api.GET("/api/v1/request-types/{id}/fields", { params: { path: { id } } }),
    // The whole live catalog: which of it may attach follows the target,
    // and the target changes without a reload.
    api.GET("/api/v1/fields", {}),
  ]);
  if (!typeRes.data || !matterRes.data || !contractRes.data || !attachedRes.data) {
    throw new Error("The request type could not be read.");
  }
  if (!catalogRes.data) throw new Error("The field catalog could not be read.");
  return {
    requestType: typeRes.data.requestType,
    matterTypes: matterRes.data.matterTypes,
    contractTypes: contractRes.data.contractTypes,
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
  help: {
    id: "settings.requestTypeEditor.help",
    defaultMessage:
      "Drag to reorder. Which fields you can attach follows the target; detaching a field keeps its catalog definition. A user or entity field can be on the form but can't be required — the portal offers a requester no rows to pick.",
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
 * an Administrator configures. Summary, Description, and Urgency are
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
  summary: { id: "settings.requestTypeEditor.basicSummary", defaultMessage: "Summary" },
  summaryType: { id: "settings.requestTypeEditor.basicSummaryType", defaultMessage: "Text" },
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
    defaultMessage: "Low · medium · high · critical",
  },
});

const BASICS_SLOT: TypeEditorBasics = {
  caption: BASICS.caption,
  locked: BASICS.locked,
  rows: [
    { key: "summary", name: BASICS.summary, caption: BASICS.summaryType, isRequired: true },
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

/** The target control's own vocabulary. */
const TARGET = defineMessages({
  label: { id: "settings.requestTypeEditor.target", defaultMessage: "Target" },
  none: { id: "settings.requestTypeEditor.targetNone", defaultMessage: "No target" },
  matterGroup: { id: "settings.requestTypeEditor.targetMatterGroup", defaultMessage: "Matter" },
  matterModule: { id: "settings.requestTypeEditor.targetMatterModule", defaultMessage: "Matter" },
  contractGroup: {
    id: "settings.requestTypeEditor.targetContractGroup",
    defaultMessage: "Contract",
  },
  contractModule: {
    id: "settings.requestTypeEditor.targetContractModule",
    defaultMessage: "Contract",
  },
  archivedOption: {
    id: "settings.requestTypeEditor.targetArchivedOption",
    defaultMessage: "{name} (archived)",
  },
  help: {
    id: "settings.requestTypeEditor.targetHelp",
    defaultMessage:
      "{state, select, " +
      "matter {Converting a request of this type creates a matter; the reviewer " +
      "picks the matter type at conversion.} " +
      "matterType {Converting a request of this type creates a matter of the {name} type.} " +
      "contract {Converting a request of this type creates a contract; the reviewer " +
      "picks the contract type at conversion.} " +
      "contractType {Converting a request of this type creates a contract of the {name} type.} " +
      "other {Converting a request of this type creates no record. It is answered " +
      "in the thread and resolved there.}}",
  },
  archivedFlag: {
    id: "settings.requestTypeEditor.targetArchivedFlag",
    defaultMessage:
      "{name} is archived. Requests of this type convert with no type until you pick a live one.",
  },
  error: {
    id: "settings.requestTypeEditor.targetError",
    defaultMessage: "The target could not be saved.",
  },
});

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

/** The select's value for one target — `""`, `matter`, `contract:<id>`. */
function targetValue(target: Target): string {
  if (target.module === null) return "";
  return target.typeId === null ? target.module : `${target.module}:${target.typeId}`;
}

/** The target one select value names. */
function parseTarget(value: string): Target {
  if (value === "") return { module: null, typeId: null };
  const [module, typeId] = value.split(":");
  return { module: module as TargetModule, typeId: typeId ?? null };
}

/** Which arm of the help line a target reads. */
function helpState(target: Target): string {
  if (target.module === null) return "none";
  return target.typeId === null ? target.module : `${target.module}Type`;
}

/**
 * ST14's Target select: one control, three states, its help line, and
 * the archived-target flag. It writes the mount's own columns, so it
 * owns its own save rather than riding the shared identity PATCH.
 */
function TargetControl({
  typeId,
  initial,
  onTargetSaved,
  matterTypes,
  contractTypes,
}: Readonly<{
  typeId: string;
  initial: Target;
  /**
   * The saved target, handed up so the other card's Attach menu can
   * scope itself by it.
   *
   * **Only what the server accepted goes up.** The select moves on the
   * pick, because a control that lags its own click is a broken
   * control — but the menu is scoped by the persisted target, so it
   * can never offer a field the API would refuse under a target the
   * API does not yet hold.
   */
  onTargetSaved: (saved: Target) => void;
  matterTypes: TargetTypeRow[];
  contractTypes: TargetTypeRow[];
}>) {
  const intl = useIntl();
  const [target, setTarget] = useState<Target>(initial);
  const [status, setStatus] = useState<FieldStatus>("idle");
  const [error, setError] = useState<string | undefined>(undefined);

  const typesFor = (module: TargetModule) => (module === "matter" ? matterTypes : contractTypes);
  const named = target.module === null ? null : typesFor(target.module);
  const current = named?.find((row) => row.id === target.typeId) ?? null;

  /** Live types, plus the current one when it has since been archived —
   * a picker that dropped it would show a value the row does not hold. */
  function options(module: TargetModule): TargetTypeRow[] {
    return typesFor(module).filter(
      (row) => row.archivedAt === null || (module === target.module && row.id === target.typeId),
    );
  }

  function optionLabel(row: TargetTypeRow): string {
    return row.archivedAt === null
      ? row.displayName
      : intl.formatMessage(TARGET.archivedOption, { name: row.displayName });
  }

  async function commit(next: Target) {
    // One target write at a time. The select below is disabled while a
    // save is in flight; this is the second lock, because a pick that
    // arrived anyway would take the in-flight target as its rollback
    // value and a refusal would restore a target the server never held.
    if (status === "saving") return;
    const previous = target;
    setTarget(next);
    setStatus("saving");
    setError(undefined);
    const result = await api
      .PATCH("/api/v1/request-types/{id}", {
        params: { path: { id: typeId } },
        body: { targetModule: next.module, targetTypeId: next.typeId },
      })
      .catch(() => undefined);
    if (result?.data) {
      const saved: Target = {
        module: result.data.requestType.targetModule ?? null,
        typeId: result.data.requestType.targetTypeId,
      };
      setTarget(saved);
      onTargetSaved(saved);
      setStatus("saved");
    } else {
      // A refusal leaves the row as it was, so the control goes back to
      // what the server still holds rather than showing a pick that
      // never landed.
      setTarget(previous);
      setStatus("error");
      const failure = await problem(result);
      setError(failure.detail ?? intl.formatMessage(TARGET.error));
    }
  }

  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor="request-type-target">
        <FormattedMessage {...TARGET.label} />
      </Label>
      <div className="flex items-center gap-2">
        <select
          id="request-type-target"
          className={`${CONTROL_CLASS} w-80`}
          value={targetValue(target)}
          // Shut while the write is in flight, so a second pick cannot
          // land on top of one the server has not answered yet.
          disabled={status === "saving"}
          aria-describedby={
            // The archived flag is part of what the control means, so a
            // reader hears it with the control rather than after it.
            current?.archivedAt
              ? "request-type-target-help request-type-target-archived"
              : "request-type-target-help"
          }
          onChange={(event) => void commit(parseTarget(event.target.value))}
        >
          <option value="">{intl.formatMessage(TARGET.none)}</option>
          <optgroup label={intl.formatMessage(TARGET.matterGroup)}>
            <option value="matter">{intl.formatMessage(TARGET.matterModule)}</option>
            {options("matter").map((row) => (
              <option key={row.id} value={`matter:${row.id}`}>
                {optionLabel(row)}
              </option>
            ))}
          </optgroup>
          <optgroup label={intl.formatMessage(TARGET.contractGroup)}>
            <option value="contract">{intl.formatMessage(TARGET.contractModule)}</option>
            {options("contract").map((row) => (
              <option key={row.id} value={`contract:${row.id}`}>
                {optionLabel(row)}
              </option>
            ))}
          </optgroup>
        </select>
        <StatusNote status={status} detail={error} />
      </div>
      <p id="request-type-target-help" className="text-xs text-muted">
        <FormattedMessage
          {...TARGET.help}
          values={{ state: helpState(target), name: current?.displayName ?? "" }}
        />
      </p>
      {current?.archivedAt && (
        <p
          id="request-type-target-archived"
          className="flex items-start gap-1.5 text-xs text-status-warning-fg"
        >
          <TriangleAlert size={16} aria-hidden="true" className="mt-0.5 shrink-0" />
          <FormattedMessage {...TARGET.archivedFlag} values={{ name: current.displayName }} />
        </p>
      )}
    </div>
  );
}

export function SettingsRequestTypeEditorPage() {
  const { requestType, matterTypes, contractTypes, attachedFields, catalog } =
    useLoaderData<typeof settingsRequestTypeEditorLoader>();
  // The **saved** target lives on the screen because both cards read
  // it: the select on the left writes it, and the Attach menu on the
  // right is scoped by it. It moves only when the server has taken the
  // change, so the menu never offers a field the API would refuse.
  const [target, setTarget] = useState<Target>({
    module: requestType.targetModule ?? null,
    typeId: requestType.targetTypeId,
  });
  const scopes = attachableScopes(target.module);
  // The shared screen reads identity; the target is this mount's own.
  const identity: EditorTypeRow = requestType;
  return (
    <TypeEditorScreen
      initialType={identity}
      tabs={<IntakeSettingsTabs />}
      backPath="/settings/intake/request-types"
      api={EDITOR_API}
      messages={MESSAGES}
      identityExtra={
        <TargetControl
          typeId={requestType.id}
          initial={target}
          onTargetSaved={setTarget}
          matterTypes={matterTypes}
          contractTypes={contractTypes}
        />
      }
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
