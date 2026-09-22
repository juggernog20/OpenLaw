// SPDX-License-Identifier: AGPL-3.0-only

import { useRef, useState, type ComponentProps } from "react";
import { isReferenceFieldType, type AiAnswerStyle } from "@openlaw/shared";
import { FormattedMessage, useIntl } from "react-intl";
import { api } from "../lib/api";
import { problem as readProblem } from "../lib/problem";
import {
  FIELD_TYPES,
  SELECT_TYPES,
  fieldRow,
  typeLabel,
  type FieldType,
  type ModuleScope,
  type FieldRow,
} from "../lib/field-catalog";
import {
  FieldAnswerStyleSelect,
  type FieldAnswerStyleSelectHandle,
} from "./field-answer-style-select";
import { AutoResizeTextarea } from "./auto-resize-textarea";
import { Button } from "./ui/button";
import { Dialog, DialogContent, DialogTitle } from "./ui/dialog";
import { Input } from "./ui/input";
import { Label } from "./ui/label";

/** The shared form-control look (ST8 normalization, C10 field spec). */
const CONTROL_CLASS =
  "h-8 w-full rounded-button border border-border-default bg-raised px-2 text-sm " +
  "text-primary focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-link";

const TEXTAREA_CLASS =
  "min-h-16 w-full rounded-button border border-border-default bg-raised p-2 text-sm " +
  "text-primary focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-link";

/** What the editor dialog collects; the immutable dimensions only count
 * in create mode. */
interface EditorDraft {
  name: string;
  description: string;
  fieldType: FieldType | "";
  optionsText: string;
  aiPrompt: string;
  aiAnswerStyle: AiAnswerStyle | null;
}

function draftOf(target: FieldRow | null): EditorDraft {
  if (!target) {
    return {
      name: "",
      description: "",
      fieldType: "",
      optionsText: "",
      aiPrompt: "",
      aiAnswerStyle: null,
    };
  }
  return {
    name: target.displayName,
    description: target.description ?? "",
    fieldType: target.fieldType,
    optionsText: (target.options ?? []).join("\n"),
    aiPrompt: target.aiPrompt ?? "",
    aiAnswerStyle: target.aiAnswerStyle ?? null,
  };
}

/** One option per line, trimmed, empties dropped. */
function parseOptions(optionsText: string): string[] {
  return optionsText
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line !== "");
}

export function FieldEditorDialog({
  target,
  module: initialModule,
  allowModuleSelection = false,
  onOpenChange,
  onRowChanged,
  onCreated,
  onCloseAutoFocus,
}: Readonly<{
  /** The field being edited, or null for create mode. */
  target: FieldRow | null;
  module: ModuleScope;
  /** Intake forms without a destination can collect Contract or Matter fields. */
  allowModuleSelection?: boolean;
  onOpenChange: (open: boolean) => void;
  /** The saved field after a successful edit. */
  onRowChanged: (row: FieldRow) => void;
  onCreated: (row: FieldRow) => void | Promise<void>;
  onCloseAutoFocus?: ComponentProps<typeof DialogContent>["onCloseAutoFocus"];
}>) {
  const intl = useIntl();
  const answerStyleSelect = useRef<FieldAnswerStyleSelectHandle>(null);
  const [module, setModule] = useState(initialModule);
  const [draft, setDraft] = useState<EditorDraft>(() => draftOf(target));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isSelect = draft.fieldType !== "" && SELECT_TYPES.has(draft.fieldType);
  // The prompt rides on contract-scoped fields only (CTR-008/CTR-016), and
  // never on a user or Entity Field: Analysis cannot pick a row id (#959).
  const promptable = module === "contract" && !isReferenceFieldType(draft.fieldType);

  const styleable =
    module === "contract" && (draft.fieldType === "text" || draft.fieldType === "long_text");

  const set = <K extends keyof EditorDraft>(key: K, value: EditorDraft[K]) =>
    setDraft((current) => ({ ...current, [key]: value }));

  function refuse(message: string) {
    setError(message);
    setBusy(false);
  }

  async function create() {
    const options = parseOptions(draft.optionsText);
    const result = await api
      .POST("/api/v1/fields", {
        body: {
          displayName: draft.name.trim(),
          description: draft.description.trim() || undefined,
          moduleScope: module,
          fieldType: draft.fieldType as FieldType,
          options: isSelect ? options : undefined,
          aiPrompt: promptable && draft.aiPrompt.trim() ? draft.aiPrompt.trim() : undefined,
          aiAnswerStyle: styleable ? (draft.aiAnswerStyle ?? undefined) : undefined,
        },
      })
      .catch(() => undefined);
    const { data } = result ?? {};
    if (!data) {
      refuse(
        (await readProblem(result)).detail ??
          intl.formatMessage({
            id: "settings.contractFields.createError",
            defaultMessage: "The field could not be created.",
          }),
      );
      return false;
    }
    await onCreated(fieldRow(data.field, module));
    return true;
  }

  async function edit(existing: FieldRow) {
    const body: Record<string, unknown> = {};
    const name = draft.name.trim();
    if (name !== existing.displayName) body.displayName = name;
    const description = draft.description.trim();
    if (description !== (existing.description ?? "")) body.description = description || null;
    if (isSelect) {
      const options = parseOptions(draft.optionsText);
      if (options.join("\n") !== (existing.options ?? []).join("\n")) body.options = options;
    }
    if (promptable) {
      const aiPrompt = draft.aiPrompt.trim();
      if (aiPrompt !== (existing.aiPrompt ?? "")) body.aiPrompt = aiPrompt || null;
    }
    if (styleable && draft.aiAnswerStyle !== (existing.aiAnswerStyle ?? null)) {
      body.aiAnswerStyle = draft.aiAnswerStyle;
    }
    if (Object.keys(body).length === 0) return true;

    const result = await api
      .PATCH("/api/v1/fields/{id}", { params: { path: { id: existing.id } }, body })
      .catch(() => undefined);
    const { data } = result ?? {};
    if (!data) {
      refuse(
        (await readProblem(result)).detail ??
          intl.formatMessage({
            id: "settings.contractFields.editError",
            defaultMessage: "The field could not be saved.",
          }),
      );
      return false;
    }
    onRowChanged(fieldRow(data.field, module));
    return true;
  }

  async function submit() {
    if (busy) return;
    setError(null);
    if (draft.name.trim() === "") {
      refuse(
        intl.formatMessage({
          id: "settings.contractFields.nameMissing",
          defaultMessage: "Name the field.",
        }),
      );
      return;
    }
    if (target === null && draft.fieldType === "") {
      refuse(
        intl.formatMessage({
          id: "settings.contractFields.typeMissing",
          defaultMessage: "Pick a type for the new field.",
        }),
      );
      return;
    }
    if (isSelect && parseOptions(draft.optionsText).length === 0) {
      refuse(
        intl.formatMessage({
          id: "settings.contractFields.optionsMissing",
          defaultMessage: "Add at least one option, one per line.",
        }),
      );
      return;
    }
    setBusy(true);
    try {
      const done = target === null ? await create() : await edit(target);
      if (done) onOpenChange(false);
    } catch {
      setError(
        intl.formatMessage({
          id: "settings.contractFields.invalidResponse",
          defaultMessage: "The server returned a field outside this catalog.",
        }),
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!busy) onOpenChange(open);
      }}
    >
      <DialogContent
        aria-describedby={undefined}
        onCloseAutoFocus={onCloseAutoFocus}
        onEscapeKeyDown={(event) => {
          if (answerStyleSelect.current?.dismissTooltip()) event.preventDefault();
        }}
      >
        <DialogTitle>
          {target === null ? (
            <FormattedMessage id="settings.contractFields.addTitle" defaultMessage="Add field" />
          ) : (
            <FormattedMessage
              id="settings.contractFields.editTitle"
              defaultMessage="Edit {name}"
              values={{ name: target.displayName }}
            />
          )}
        </DialogTitle>
        <form
          className="mt-4 flex flex-col gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
        >
          {target === null && allowModuleSelection && (
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="field-module">
                <FormattedMessage
                  id="settings.fields.catalogLabel"
                  defaultMessage="Field catalog"
                />
              </Label>
              <select
                id="field-module"
                className={CONTROL_CLASS}
                value={module}
                disabled={busy}
                onChange={(event) => setModule(event.target.value as ModuleScope)}
              >
                <option value="contract">
                  {intl.formatMessage({
                    id: "settings.fields.contractCatalog",
                    defaultMessage: "Contract fields",
                  })}
                </option>
                <option value="matter">
                  {intl.formatMessage({
                    id: "settings.fields.matterCatalog",
                    defaultMessage: "Matter fields",
                  })}
                </option>
              </select>
            </div>
          )}
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="field-name">
              <FormattedMessage id="settings.contractFields.nameLabel" defaultMessage="Name" />
            </Label>
            <Input
              id="field-name"
              autoFocus
              value={draft.name}
              onChange={(event) => set("name", event.target.value)}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="field-description">
              <FormattedMessage
                id="settings.contractFields.descriptionLabel"
                defaultMessage="Description"
              />
            </Label>
            <Input
              id="field-description"
              value={draft.description}
              onChange={(event) => set("description", event.target.value)}
            />
            <p className="text-xs text-muted">
              <FormattedMessage
                id="settings.contractFields.descriptionHelp"
                defaultMessage="Shown as help text wherever the field renders."
              />
            </p>
          </div>
          <div className="flex gap-3">
            <div className="flex flex-1 flex-col gap-1.5">
              <Label htmlFor="field-type">
                <FormattedMessage id="settings.contractFields.typeColumn" defaultMessage="Type" />
              </Label>
              {target === null ? (
                <select
                  id="field-type"
                  value={draft.fieldType}
                  className={CONTROL_CLASS}
                  onChange={(event) => {
                    const fieldType = event.target.value as FieldType | "";
                    setDraft((current) => ({
                      ...current,
                      fieldType,
                      aiAnswerStyle:
                        fieldType === "long_text" ||
                        (fieldType === "text" && current.aiAnswerStyle !== "full_clause")
                          ? current.aiAnswerStyle
                          : null,
                    }));
                    // Picking a type answers the pick-a-type refusal.
                    if (event.target.value !== "") setError(null);
                  }}
                >
                  <option value="">
                    {intl.formatMessage({
                      id: "settings.contractFields.typePlaceholder",
                      defaultMessage: "Type…",
                    })}
                  </option>
                  {FIELD_TYPES.map((fieldType) => (
                    <option key={fieldType} value={fieldType}>
                      {typeLabel(intl, fieldType)}
                    </option>
                  ))}
                </select>
              ) : (
                <>
                  <span className="flex h-8 items-center text-sm text-primary">
                    {typeLabel(intl, target.fieldType)}
                  </span>
                  <p className="text-xs text-muted">
                    <FormattedMessage
                      id="settings.contractFields.typeImmutable"
                      defaultMessage="The field type is immutable after creation."
                    />
                  </p>
                </>
              )}
            </div>
          </div>
          {isSelect && (
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="field-options">
                <FormattedMessage
                  id="settings.contractFields.optionsLabel"
                  defaultMessage="Options"
                />
              </Label>
              <AutoResizeTextarea
                id="field-options"
                value={draft.optionsText}
                className={TEXTAREA_CLASS}
                onChange={(event) => set("optionsText", event.target.value)}
              />
              <p className="text-xs text-muted">
                <FormattedMessage
                  id="settings.contractFields.optionsHelp"
                  defaultMessage="One option per line, in display order."
                />
              </p>
            </div>
          )}
          {promptable && (
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="field-ai-prompt">
                <FormattedMessage
                  id="settings.contractFields.aiPromptLabel"
                  defaultMessage="AI prompt"
                />
              </Label>
              <AutoResizeTextarea
                id="field-ai-prompt"
                aria-describedby="field-ai-prompt-help"
                placeholder={intl.formatMessage({
                  id: "settings.contractFields.aiPromptExample",
                  defaultMessage:
                    "Example: Extract the notice period, in days, required to terminate without cause. Exclude notice periods for breach.",
                })}
                value={draft.aiPrompt}
                className={TEXTAREA_CLASS}
                onChange={(event) => set("aiPrompt", event.target.value)}
              />
              <p id="field-ai-prompt-help" className="text-xs text-muted">
                <FormattedMessage
                  id="settings.contractFields.aiPromptHelp"
                  defaultMessage="Describe what AI should extract for this field, including any distinctions it should make. Leave blank to exclude this field from Contract analysis."
                />
              </p>
            </div>
          )}
          {styleable && (
            <FieldAnswerStyleSelect
              ref={answerStyleSelect}
              value={draft.aiAnswerStyle}
              onChange={(value) => set("aiAnswerStyle", value)}
              shortText={draft.fieldType === "text"}
              disabled={busy}
              className={CONTROL_CLASS}
            />
          )}
          {error && (
            <p role="alert" className="text-xs text-status-danger-fg">
              {error}
            </p>
          )}
          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="secondary"
              disabled={busy}
              onClick={() => onOpenChange(false)}
            >
              <FormattedMessage id="action.cancel" defaultMessage="Cancel" />
            </Button>
            <Button type="submit" disabled={busy}>
              {target === null ? (
                <FormattedMessage
                  id="settings.contractFields.createSubmit"
                  defaultMessage="Add field"
                />
              ) : (
                <FormattedMessage id="settings.contractFields.editSubmit" defaultMessage="Save" />
              )}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
