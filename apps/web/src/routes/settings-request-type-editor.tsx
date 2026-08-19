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
 * The right card — the form definition — arrives with #355. Until then
 * the screen is the left card alone, which is what `attachments`
 * being optional is for.
 */

import { useState } from "react";
import { redirect, useLoaderData, type LoaderFunctionArgs } from "react-router";
import { defineMessages, FormattedMessage, useIntl } from "react-intl";
import { TriangleAlert } from "lucide-react";
import { api } from "../lib/api";
import { problemDetail } from "../lib/messages";
import { CONTROL_CLASS } from "../lib/form-controls";
import { currentUser, needsSetup } from "../lib/session";
import { IntakeSettingsTabs } from "../components/intake-settings-tabs";
import { StatusNote, type FieldStatus } from "../components/status-note";
import { Label } from "../components/ui/label";
import {
  TypeEditorScreen,
  type EditorTypeRow,
  type TypeEditorIdentityApi,
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
  const user = await currentUser();
  if (!user) return redirect((await needsSetup()) ? "/auth/setup" : "/auth/login");
  if (user.role !== "administrator") return redirect("/settings/profile");
  const id = params.typeId!;
  const [typeRes, matterRes, contractRes] = await Promise.all([
    api.GET("/api/v1/request-types/{id}", { params: { path: { id } } }),
    // Archived rows ride along so a target archived after it was picked
    // still reads as itself; the picker filters them out.
    api.GET("/api/v1/matter-types", { params: { query: { includeArchived: "true" } } }),
    api.GET("/api/v1/contract-types", { params: { query: { includeArchived: "true" } } }),
  ]);
  if (!typeRes.data || !matterRes.data || !contractRes.data) {
    throw new Error("The request type could not be read.");
  }
  return {
    requestType: typeRes.data.requestType,
    matterTypes: matterRes.data.matterTypes,
    contractTypes: contractRes.data.contractTypes,
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
});

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

/** The shared editor's identity seam over the request-types routes. */
const EDITOR_API: TypeEditorIdentityApi = {
  async update(id, body) {
    const { data, error } = await api.PATCH("/api/v1/request-types/{id}", {
      params: { path: { id } },
      body,
    });
    return { data: data?.requestType, detail: problemDetail(error) };
  },
};

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
  matterTypes,
  contractTypes,
}: Readonly<{
  typeId: string;
  initial: Target;
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
    const previous = target;
    setTarget(next);
    setStatus("saving");
    setError(undefined);
    const { data, error: problem } = await api
      .PATCH("/api/v1/request-types/{id}", {
        params: { path: { id: typeId } },
        body: { targetModule: next.module, targetTypeId: next.typeId },
      })
      .catch(() => ({ data: undefined, error: undefined }));
    if (data) {
      setTarget({
        module: data.requestType.targetModule ?? null,
        typeId: data.requestType.targetTypeId,
      });
      setStatus("saved");
    } else {
      // A refusal leaves the row as it was, so the control goes back to
      // what the server still holds rather than showing a pick that
      // never landed.
      setTarget(previous);
      setStatus("error");
      setError(problemDetail(problem) ?? intl.formatMessage(TARGET.error));
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
  const { requestType, matterTypes, contractTypes } =
    useLoaderData<typeof settingsRequestTypeEditorLoader>();
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
          initial={{
            module: requestType.targetModule ?? null,
            typeId: requestType.targetTypeId,
          }}
          matterTypes={matterTypes}
          contractTypes={contractTypes}
        />
      }
    />
  );
}
