// SPDX-License-Identifier: AGPL-3.0-only

/** Request type facts and the destination Intake form (INT-002, DD-028). */

import { useRef, useState } from "react";
import { redirect, useLoaderData, type LoaderFunctionArgs } from "react-router";
import { defineMessages, FormattedMessage, useIntl } from "react-intl";
import { IntakeFormCard } from "../components/type-form/intake-card";
import { api } from "../lib/api";
import { problem } from "../lib/problem";
import { CONTROL_CLASS } from "../lib/form-controls";
import { requireUser } from "../lib/session";
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

export async function settingsRequestTypeEditorLoader({ params }: LoaderFunctionArgs) {
  const user = await requireUser();
  if (user.role !== "administrator") return redirect("/settings/profile");
  const id = params.typeId!;
  const [typeRes, catalogRes, matterRes, contractRes] = await Promise.all([
    api.GET("/api/v1/request-types/{id}", { params: { path: { id } } }),
    api.GET("/api/v1/fields", {}),
    api.GET("/api/v1/matter-types", { params: { query: { includeArchived: "true" } } }),
    api.GET("/api/v1/contract-types", { params: { query: { includeArchived: "true" } } }),
  ]);
  if (!typeRes.data) {
    throw new Error("The request type could not be read.");
  }
  if (!catalogRes.data) throw new Error("The field catalog could not be read.");
  if (!matterRes.data || !contractRes.data)
    throw new Error("The destination types could not be read.");
  return {
    requestType: typeRes.data.requestType,
    catalog: catalogRes.data.fields,
    matterTypes: matterRes.data.matterTypes,
    contractTypes: contractRes.data.contractTypes,
  };
}

/** The INT-002 vocabulary over the shared editor's message slots. */
const MESSAGES = defineMessages({
  allTypes: { id: "settings.requestTypeEditor.allTypes", defaultMessage: "All request types" },
  displayName: { id: "settings.requestTypeEditor.displayName", defaultMessage: "Display name" },
  description: { id: "settings.requestTypeEditor.description", defaultMessage: "Description" },
});

type Destination = { targetModule: TargetModule; targetTypeId: string | null };
type DestinationType = {
  id: string;
  displayName: string;
  archivedAt: string | null;
  isDefault: boolean;
};

function DestinationControl({
  typeId,
  value,
  onSaved,
  matterTypes,
  contractTypes,
}: Readonly<{
  typeId: string;
  value: Destination;
  onSaved: (value: Destination) => void;
  matterTypes: DestinationType[];
  contractTypes: DestinationType[];
}>) {
  const intl = useIntl();
  const pending = useRef(false);
  const [status, setStatus] = useState<FieldStatus>("idle");
  const [error, setError] = useState<string | null>(null);
  const types = value.targetModule === "contract" ? contractTypes : matterTypes;
  const selected = types.find((type) => type.id === value.targetTypeId);
  // Migration 0157 wrote the Default type's id onto module-only rows, so
  // a saved Default id and a null id are the same destination (DD-028.7).
  // The picker shows one "Default" choice for both.
  const savedTypeId = selected?.isDefault ? null : value.targetTypeId;
  async function save(next: Destination) {
    if (
      pending.current ||
      (next.targetModule === value.targetModule && next.targetTypeId === savedTypeId)
    )
      return;
    pending.current = true;
    setStatus("saving");
    setError(null);
    const result = await api
      .PATCH("/api/v1/request-types/{id}", {
        params: { path: { id: typeId } },
        body: next,
      })
      .catch(() => undefined);
    if (result?.data) {
      onSaved(result.data.requestType);
      setStatus("saved");
    } else {
      setError((await problem(result)).detail ?? null);
      setStatus("error");
    }
    pending.current = false;
  }
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="request-type-destination">
          <FormattedMessage
            id="settings.requestTypeEditor.destination"
            defaultMessage="Default destination"
          />
        </Label>
        <select
          id="request-type-destination"
          className={CONTROL_CLASS}
          value={value.targetModule}
          required
          aria-disabled={status === "saving"}
          aria-describedby="request-type-destination-help"
          onChange={(event) => {
            const targetModule = event.currentTarget.value;
            if (targetModule !== "contract" && targetModule !== "matter") return;
            void save({ targetModule, targetTypeId: null });
          }}
        >
          <option value="contract">
            {intl.formatMessage({
              id: "settings.requestTypeEditor.destinationContract",
              defaultMessage: "Contract",
            })}
          </option>
          <option value="matter">
            {intl.formatMessage({
              id: "settings.requestTypeEditor.destinationMatter",
              defaultMessage: "Matter",
            })}
          </option>
        </select>
        <p id="request-type-destination-help" className="text-xs text-muted">
          <FormattedMessage
            id="settings.requestTypeEditor.destinationHelp"
            defaultMessage="Suggests where Legal converts this request. Legal can choose a different destination during triage."
          />
        </p>
      </div>
      {value.targetModule && (
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="request-type-destination-type">
            <FormattedMessage
              id="settings.requestTypeEditor.destinationType"
              defaultMessage="{module, select, contract {Default contract type} other {Default matter type}}"
              values={{ module: value.targetModule }}
            />
          </Label>
          <select
            id="request-type-destination-type"
            className={CONTROL_CLASS}
            value={savedTypeId ?? ""}
            aria-disabled={status === "saving"}
            onChange={(event) =>
              void save({
                targetModule: value.targetModule,
                targetTypeId: event.target.value || null,
              })
            }
          >
            <option value="">
              {intl.formatMessage({
                id: "settings.requestTypeEditor.defaultType",
                defaultMessage: "Default",
              })}
            </option>
            {value.targetTypeId && (!selected || selected.archivedAt) && (
              <option value={value.targetTypeId} disabled>
                {intl.formatMessage(
                  {
                    id: "settings.requestTypeEditor.unavailableDestination",
                    defaultMessage: "{name} (unavailable)",
                  },
                  {
                    name:
                      selected?.displayName ??
                      intl.formatMessage({
                        id: "settings.requestTypeEditor.previousDestination",
                        defaultMessage: "Previous selection",
                      }),
                  },
                )}
              </option>
            )}
            {types
              .filter((type) => !type.archivedAt && !type.isDefault)
              .map((type) => (
                <option key={type.id} value={type.id}>
                  {type.displayName}
                </option>
              ))}
          </select>
        </div>
      )}
      <StatusNote status={status} detail={error} />
    </div>
  );
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
  const { requestType, catalog, matterTypes, contractTypes } =
    useLoaderData<typeof settingsRequestTypeEditorLoader>();
  const [destination, setDestination] = useState<Destination>({
    targetModule: requestType.targetModule,
    targetTypeId: requestType.targetTypeId,
  });
  const [identity, setIdentity] = useState<EditorTypeRow>(requestType);
  const types = destination.targetModule === "contract" ? contractTypes : matterTypes;
  const destinationType = destination.targetTypeId
    ? types.find((type) => type.id === destination.targetTypeId)
    : types.find((type) => type.isDefault);
  const editorApi: TypeEditorIdentityApi = {
    async update(id, body) {
      const result = await api
        .PATCH("/api/v1/request-types/{id}", {
          params: { path: { id } },
          body,
        })
        .catch(() => undefined);
      if (result?.data) setIdentity(result.data.requestType);
      return { data: result?.data?.requestType, ...(await problem(result)) };
    },
  };
  return (
    <TypeEditorScreen
      initialType={identity}
      tabs={<IntakeSettingsTabs />}
      backPath="/settings/intake/request-types"
      api={editorApi}
      messages={MESSAGES}
      identityExtra={
        <>
          <DestinationControl
            typeId={requestType.id}
            value={destination}
            onSaved={setDestination}
            matterTypes={matterTypes}
            contractTypes={contractTypes}
          />
          <TurnaroundControl
            key={requestType.id}
            typeId={requestType.id}
            initial={requestType.turnaroundDays ?? null}
          />
        </>
      }
      rightCard={
        <IntakeFormCard
          key={`${destination.targetModule}:${destinationType?.id}`}
          module={destination.targetModule}
          destinationType={destinationType}
          catalog={catalog}
          requestType={identity}
        />
      }
    />
  );
}
