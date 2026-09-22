// SPDX-License-Identifier: AGPL-3.0-only

/** DD-028 Form editor with whole-tree commits and local Branch validation refusals. */
import { useFormText } from "./messages";
import { useEffect, useMemo, useRef, useState } from "react";
import { GripVertical, Lock, Ellipsis, X, GitBranch, Pencil } from "lucide-react";
import {
  formRowTouchpoint,
  validateForm,
  type Form,
  type FormNode,
  type FormBranch,
  type FormModule,
  type FormRow,
} from "@openlaw/shared";
import type { paths } from "@openlaw/api-client";
import { api } from "../../lib/api";
import { problem } from "../../lib/problem";
import { isFieldRow, type ApiField, type FieldRow } from "../../lib/field-catalog";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Switch } from "../ui/switch";
import { Dialog, DialogContent, DialogTitle } from "../ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "../ui/dropdown-menu";
import { StatusNote, type FieldStatus } from "../status-note";
import { FieldEditorDialog } from "../field-editor-dialog";
import {
  appendNode,
  branchName,
  flatten,
  fieldTypeName,
  isBuiltin,
  isPinned,
  location,
  replaceNode,
  rowName,
} from "./model";
import { referenceOptions } from "./reference-options";
import { Conditions } from "./conditions";
import { IntakePreview } from "./preview";

export function TypeFormBuilder({
  module,
  typeId,
  typeName,
  isDefault = false,
  initialForm,
  catalog: initialCatalog,
}: Readonly<{
  module: FormModule;
  typeId: string;
  typeName: string;
  isDefault?: boolean;
  initialForm: Form;
  catalog: readonly ApiField[];
}>) {
  const t = useFormText();
  const [form, setForm] = useState(initialForm);
  const saved = useRef(initialForm);
  const busyRef = useRef(false);
  const [busy, setBusy] = useState(false);
  const [catalog, setCatalog] = useState(initialCatalog);
  const [notes, setNotes] = useState<Record<string, { status: FieldStatus; detail?: string }>>({});
  const [editing, setEditing] = useState<string | null>(null);
  const [moving, setMoving] = useState<string | null>(null);
  const [fieldEditor, setFieldEditor] = useState<{
    parent: string | null;
    target: FieldRow | null;
  } | null>(null);
  const [created, setCreated] = useState<{ field: FieldRow; parent: string | null } | null>(null);
  const [preview, setPreview] = useState(false);
  const [announcement, setAnnouncement] = useState("");
  const [drop, setDrop] = useState<string | null>(null);
  const dragged = useRef<string | null>(null);
  const restoreFocus = useRef<HTMLElement | null>(null);
  const [referenceLabels, setReferenceLabels] = useState<
    Record<string, { value: string; label: string }[]>
  >({});
  const referencedRows = useMemo(() => {
    const all = flatten(form);
    const refs = new Set(
      all.flatMap((n) => (n.kind === "branch" ? n.conditions.map((c) => c.rowRef) : [])),
    );
    return all
      .filter((n): n is FormRow => n.kind === "row" && refs.has(n.rowRef))
      .map(({ id, rowRef, fieldType }) => ({ id, rowRef, fieldType }));
  }, [form]);
  const currentReferences = useRef(referencedRows);
  useEffect(() => {
    currentReferences.current = referencedRows;
  }, [referencedRows]);
  const referenceKey = referencedRows
    .map((r) => JSON.stringify([r.id, r.rowRef, r.fieldType]))
    .sort()
    .join("\n");
  useEffect(() => {
    let active = true;
    void Promise.all(
      currentReferences.current.map(
        async (row) => [row.rowRef, await referenceOptions(row).catch(() => null)] as const,
      ),
    ).then((pairs) => {
      if (active)
        setReferenceLabels(
          Object.fromEntries(
            pairs.filter(
              (pair): pair is readonly [string, { value: string; label: string }[]] =>
                pair[1] !== null,
            ),
          ),
        );
    });
    return () => {
      active = false;
    };
  }, [referenceKey]);
  const nodes = flatten(form);
  const name = (node: FormNode) =>
    node.kind === "row"
      ? rowName(node, catalog, t)
      : branchName(node, form, catalog, t, referenceLabels);
  const note = (key: string, status: FieldStatus, detail?: string) =>
    setNotes((old) => ({ ...old, [key]: { status, detail } }));
  const status = (key: string) => (
    <span id={`note-${key}`}>
      <StatusNote status={notes[key]?.status ?? "idle"} detail={notes[key]?.detail} />
    </span>
  );
  function refusal(next: Form): string | undefined {
    const incomplete = flatten(next).find(
      (n) =>
        n.kind === "branch" &&
        (!n.conditions.length ||
          n.conditions.some(
            (c) => !c.rowRef || (c.operator !== "is_set" && (c.value === null || c.value === "")),
          )),
    );
    if (incomplete) return t("Complete the Branch condition first");
    const issue = validateForm(next)[0];
    if (issue) {
      const row = nodes.find((n): n is FormRow => n.kind === "row" && n.rowRef === issue.rowRef);
      if (["forward_reference", "self_reference"].includes(issue.code))
        return t("Keep {row} above the Branch that uses it", {
          row: row ? name(row) : (issue.rowRef ?? ""),
        });
      if (issue.code === "unknown_row")
        return t("Used by a Branch condition. Change the condition first");
      return t("Choose a valid value for this condition");
    }
  }
  async function commit(next: Form, key: string, message?: string) {
    if (busyRef.current) return false;
    const reason = refusal(next);
    if (reason) {
      note(key, "error", reason);
      return false;
    }
    if (JSON.stringify(next) === JSON.stringify(saved.current)) return true;
    busyRef.current = true;
    setBusy(true);
    note(key, "saving");
    setForm(next);
    const path =
      module === "contract"
        ? "/api/v1/contract-types/{id}/form"
        : module === "matter"
          ? "/api/v1/matter-types/{id}/form"
          : "/api/v1/entity-types/{id}/form";
    const result = await api
      .PUT(path, { params: { path: { id: typeId } }, body: { form: formPayload(next) } })
      .catch(() => undefined);
    if (result?.data) {
      saved.current = result.data.form;
      setForm(result.data.form);
      note(key, "saved");
      if (message) setAnnouncement(message);
    } else {
      // A condition draft stays in the tree so Retry condition change can send it again
      // and the open Conditions panel still matches what the caption reads. Escape
      // restores the saved Branch. Every other control falls back to the saved tree.
      setForm(key.endsWith("-condition") ? next : saved.current);
      note(key, "error", (await problem(result)).detail);
    }
    busyRef.current = false;
    setBusy(false);
    return !!result?.data;
  }
  function focusGrip(id: string) {
    requestAnimationFrame(() => document.getElementById(`move-${id}`)?.focus());
  }
  async function move(id: string, parentId: string | null, beforeId?: string) {
    const node = nodes.find((n) => n.id === id);
    if (
      !node ||
      isPinned(node) ||
      id === parentId ||
      id === beforeId ||
      (node.kind === "branch" &&
        flatten(node.children).some((n) => n.id === parentId || n.id === beforeId))
    )
      return;
    let next = replaceNode(form, id, []);
    if (beforeId) {
      const target = flatten(next).find((n) => n.id === beforeId);
      if (!target || isPinned(target)) return;
      next = replaceNode(next, beforeId, [node, target]);
    } else next = appendNode(next, parentId, node);
    const destination = location(next, id)!;
    if (
      await commit(
        next,
        `${id}-move`,
        t("{row} moved to position {position} of {count} in {parent}.", {
          row: name(node),
          position: destination.index + 1,
          count: destination.siblings.length,
          parent: destination.parent ? name(destination.parent) : t("root"),
        }),
      )
    )
      focusGrip(id);
  }
  function reorder(id: string, direction: number) {
    if (busyRef.current) return;
    const loc = location(form, id)!;
    const target = loc.siblings[loc.index + direction];
    if (!target || isPinned(target)) return;
    const siblings = [...loc.siblings];
    [siblings[loc.index], siblings[loc.index + direction]] = [target, siblings[loc.index]!];
    const next = loc.parent
      ? replaceNode(form, loc.parent.id, [{ ...loc.parent, children: siblings }])
      : siblings;
    void commit(
      next,
      `${id}-move`,
      t("{row} moved to position {position} of {count} in {parent}.", {
        row: name(siblings[loc.index + direction]!),
        position: loc.index + direction + 1,
        count: siblings.length,
        parent: loc.parent ? name(loc.parent) : t("root"),
      }),
    ).then(() => focusGrip(id));
  }
  function moveOut(node: FormNode) {
    const parent = location(form, node.id)?.parent;
    if (!parent) return;
    const next = replaceNode(replaceNode(form, node.id, []), parent.id, [
      { ...parent, children: replaceNode(parent.children, node.id, []) },
      node,
    ]);
    void commit(next, `${node.id}-move`).then(() => focusGrip(node.id));
  }
  function addBranch(parent: string | null) {
    if (busyRef.current) return;
    restoreFocus.current = document.activeElement as HTMLElement;
    const branch: FormBranch = {
      kind: "branch",
      id: crypto.randomUUID(),
      match: "all",
      conditions: [{ rowRef: "", operator: "equals", value: null }],
      children: [],
    };
    setForm(appendNode(form, parent, branch));
    setEditing(branch.id);
  }
  function cancelBranch(id: string) {
    const previous = flatten(saved.current).find((n) => n.id === id);
    setForm(replaceNode(form, id, previous ? [previous] : []));
    setEditing(null);
    note(`${id}-condition`, "idle");
    if (previous) focusGrip(id);
    else requestAnimationFrame(() => restoreFocus.current?.focus());
  }
  async function attach(field: ApiField, parent: string | null, key: string) {
    const row: FormRow = {
      kind: "row",
      id: field.id,
      rowRef: field.slug,
      fieldType: field.fieldType,
      isRequired: false,
      visibleOnPortal: false,
      ...(module === "entity" ? {} : { onIntakeForm: false }),
    };
    const ok = await commit(
      appendNode(form, parent, row),
      key,
      t("{field} attached.", { field: field.displayName }),
    );
    if (ok && created?.field.id === field.id) setCreated(null);
    return ok;
  }
  function openField(
    parent: string | null,
    target: FieldRow | null = null,
    trigger: HTMLElement | null = document.activeElement as HTMLElement,
  ) {
    restoreFocus.current = trigger;
    setFieldEditor({ parent, target });
  }
  const available = catalog.filter(
    (f) =>
      isFieldRow(f, module) && !f.archivedAt && !f.builtInKey && !nodes.some((n) => n.id === f.id),
  );
  function actions(node: FormNode) {
    const field =
      node.kind === "row"
        ? catalog.find((f): f is FieldRow => f.id === node.id && isFieldRow(f, module))
        : undefined;
    return (
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            aria-label={t("Actions for {row}", { row: name(node) })}
            disabled={busy}
          >
            <Ellipsis size={16} />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent>
          <DropdownMenuItem
            onSelect={() => {
              restoreFocus.current = document.getElementById(`move-${node.id}`);
              setMoving(node.id);
            }}
          >
            {t("Move into")}
          </DropdownMenuItem>
          <DropdownMenuItem
            disabled={!location(form, node.id)?.parent}
            onSelect={() => moveOut(node)}
          >
            {t("Move out")}
            {!location(form, node.id)?.parent && ` · ${t("Already at the root")}`}
          </DropdownMenuItem>
          {field && (
            <DropdownMenuItem
              onSelect={() => openField(null, field, document.getElementById(`move-${node.id}`))}
            >
              {t("Edit Field")}
            </DropdownMenuItem>
          )}
          {node.kind === "branch" && (
            <>
              <DropdownMenuItem onSelect={() => addBranch(node.id)}>
                {t("Add branch inside")}
              </DropdownMenuItem>
              <DropdownMenuItem
                onSelect={() =>
                  void commit(replaceNode(form, node.id, node.children), `${node.id}-move`)
                }
              >
                {t("Remove branch · Keep children here")}
              </DropdownMenuItem>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
    );
  }
  function grip(node: FormNode) {
    return (
      <Button
        id={`move-${node.id}`}
        variant="ghost"
        size="icon"
        aria-label={t("Move {row}", { row: name(node) })}
        aria-describedby={`note-${node.id}-move`}
        draggable={!busy}
        onDragStart={(e) => {
          dragged.current = node.id;
          e.dataTransfer.setData("text/plain", node.id);
        }}
        onDragEnd={() => {
          dragged.current = null;
          setDrop(null);
        }}
        onKeyDown={(e) => {
          if (["ArrowUp", "ArrowDown"].includes(e.key)) {
            e.preventDefault();
            reorder(node.id, e.key === "ArrowUp" ? -1 : 1);
          }
        }}
        onClick={() => {
          restoreFocus.current = document.activeElement as HTMLElement;
          setMoving(node.id);
        }}
      >
        <GripVertical size={16} />
      </Button>
    );
  }
  function switches(
    row: FormRow,
    key: "onIntakeForm" | "isRequired" | "visibleOnPortal",
    label: string,
  ) {
    const control = `${row.id}-${key}`;
    const reason = isPinned(row)
      ? t("Position and switches are fixed")
      : key === "visibleOnPortal" && row.onIntakeForm
        ? t("Turn off On intake form first")
        : key === "isRequired" && row.onIntakeForm && row.fieldType === "user"
          ? t("Required for creation is unavailable for {row} while it is on the intake form", {
              row: name(row),
            })
          : key === "onIntakeForm" && row.fieldType === "user" && row.isRequired
            ? t("Turn off Required for creation first")
            : undefined;
    return (
      <div className="flex min-w-0 flex-col items-start gap-1 @min-[960px]/form:items-center">
        <span className="text-xs @min-[960px]/form:hidden">{label}</span>
        <Switch
          checked={!!row[key]}
          disabled={busy}
          aria-disabled={!!reason || undefined}
          aria-label={`${name(row)}: ${label}`}
          aria-describedby={`${reason ? `reason-${control} ` : ""}note-${control}`}
          onCheckedChange={(checked) => {
            if (reason) return;
            const next = {
              ...row,
              [key]: checked,
              ...(key === "onIntakeForm" && checked ? { visibleOnPortal: true } : {}),
            };
            void commit(replaceNode(form, row.id, [next]), control);
          }}
        />
        {reason && (
          <span id={`reason-${control}`} className="text-xs text-muted">
            {reason}
          </span>
        )}
        {status(control)}
      </div>
    );
  }
  const columns =
    module === "entity"
      ? "@min-[960px]/form:grid-cols-[36px_minmax(240px,1fr)_160px_80px_64px]"
      : "@min-[960px]/form:grid-cols-[36px_minmax(240px,1fr)_160px_160px_144px_80px_64px]";
  function tree(items: Form, depth = 0) {
    return items.map((node) => (
      <div
        key={node.id}
        className={drop === node.id ? "border-t-2 border-accent" : ""}
        onDragOver={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setDrop(node.id);
        }}
        onDrop={(e) => {
          e.preventDefault();
          e.stopPropagation();
          const from = dragged.current;
          setDrop(null);
          if (from) void move(from, location(form, node.id)?.parent?.id ?? null, node.id);
        }}
      >
        {node.kind === "row" ? (
          <div
            role="group"
            aria-label={name(node)}
            className={`grid min-h-13 grid-cols-[36px_1fr] items-start gap-2 border-b border-border-muted px-4 py-2 ${columns}`}
          >
            {isPinned(node) ? (
              <Lock size={16} aria-label={t("Position and switches are fixed")} />
            ) : (
              grip(node)
            )}
            <div style={{ paddingInlineStart: depth * 24 }}>
              <div className="text-base font-medium">{name(node)}</div>
              <div className="text-sm text-muted">
                {isBuiltin(node, module) ? t("Built-in") : fieldTypeName(node.fieldType, t)}
              </div>
              {status(`${node.id}-move`)}
            </div>
            {module !== "entity" && switches(node, "onIntakeForm", t("On intake form"))}
            {switches(node, "isRequired", t("Required for creation"))}
            {module !== "entity" &&
              (isBuiltin(node, module) ? (
                <span className="flex items-center gap-1 text-sm text-muted">
                  <Lock size={16} />
                  {t("Fixed")}
                </span>
              ) : (
                switches(node, "visibleOnPortal", t("Visible on Portal"))
              ))}
            <span className="text-sm text-muted">
              {
                { intake: t("Intake"), creation: t("Creation"), record: t("Record") }[
                  formRowTouchpoint(node)
                ]
              }
            </span>
            <div className="flex flex-wrap">
              {!isPinned(node) && actions(node)}
              {!isBuiltin(node, module) && (
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label={t("Detach {row}", { row: name(node) })}
                  aria-describedby={`note-${node.id}-detach`}
                  disabled={busy}
                  onClick={() => void commit(replaceNode(form, node.id, []), `${node.id}-detach`)}
                >
                  <X size={16} />
                </Button>
              )}
              {status(`${node.id}-detach`)}
            </div>
          </div>
        ) : (
          <div
            className="relative before:pointer-events-none before:absolute before:inset-y-0 before:start-(--branch-indent) before:w-0.5 before:bg-border-default"
            style={{ "--branch-indent": `${24 + depth * 24}px` } as React.CSSProperties}
          >
            <div
              className="flex min-h-11 items-center gap-2 bg-control py-1 pe-3"
              style={{ paddingInlineStart: 36 + depth * 24 }}
            >
              {grip(node)}
              <GitBranch size={16} />
              <span className="flex-1 text-base font-medium">{name(node)}</span>
              <Button
                variant="ghost"
                size="icon"
                aria-label={t("Edit conditions")}
                onClick={() => setEditing(editing === node.id ? null : node.id)}
              >
                <Pencil size={16} />
              </Button>
              {actions(node)}
            </div>
            {status(`${node.id}-move`)}
            {editing === node.id && (
              <Conditions
                key={node.id}
                branch={node}
                rows={nodes
                  .slice(
                    0,
                    nodes.findIndex((n) => n.id === node.id),
                  )
                  .filter((n): n is FormRow => n.kind === "row")}
                catalog={catalog}
                disabled={busy}
                onCancel={() => cancelBranch(node.id)}
                onChange={(branch) => {
                  const next = replaceNode(form, branch.id, [branch]);
                  setForm(next);
                  void commit(next, `${branch.id}-condition`);
                }}
              />
            )}
            {status(`${node.id}-condition`)}
            {notes[`${node.id}-condition`]?.status === "error" && !refusal(form) && (
              <Button
                variant="ghost"
                size="sm"
                disabled={busy}
                onClick={() => void commit(form, `${node.id}-condition`)}
              >
                {t("Retry condition change")}
              </Button>
            )}
            <div
              role="group"
              aria-label={t("Children of {branch}", { branch: name(node) })}
              className="min-h-8"
              onDragOver={(e) => {
                e.preventDefault();
                e.stopPropagation();
                setDrop(`${node.id}-inside`);
              }}
              onDrop={(e) => {
                e.preventDefault();
                e.stopPropagation();
                setDrop(null);
                if (dragged.current) void move(dragged.current, node.id);
              }}
            >
              <div className={drop === `${node.id}-inside` ? "outline-2 outline-accent" : ""}>
                {tree(node.children, depth + 1)}
              </div>
              {footer(node.id)}
            </div>
          </div>
        )}
      </div>
    ));
  }
  function footer(parent: string | null) {
    const key = parent ?? "root";
    return (
      <div className="flex flex-wrap items-start gap-2 p-4">
        <div>
          <AttachMenu
            fields={available}
            disabled={busy}
            label={parent ? t("Add row into branch") : t("Attach Field")}
            onAttach={(f) => void attach(f, parent, `${key}-attach`)}
            onCreate={(trigger) => openField(parent, null, trigger)}
          />
          {status(`${key}-attach`)}
        </div>
        <div>
          <Button variant="secondary" size="sm" disabled={busy} onClick={() => openField(parent)}>
            {t("Create Field")}
          </Button>
          {status(`${key}-create`)}
          {created?.parent === parent && (
            <Button
              variant="ghost"
              size="sm"
              disabled={busy}
              onClick={() => {
                void attach(created.field, parent, `${key}-create`).then((ok) => {
                  if (ok) setCreated(null);
                });
              }}
            >
              {t("Retry attaching {field}", { field: created.field.displayName })}
            </Button>
          )}
        </div>
        <Button variant="secondary" size="sm" disabled={busy} onClick={() => addBranch(parent)}>
          {t("Add branch")}
        </Button>
        {parent === null && module !== "entity" && (
          <Button
            className="ms-auto"
            variant="secondary"
            size="sm"
            disabled={busy || !!refusal(form)}
            onClick={() => {
              restoreFocus.current = document.activeElement as HTMLElement;
              setPreview(true);
            }}
          >
            {t("Preview intake form")}
          </Button>
        )}
      </div>
    );
  }
  return (
    <section
      aria-label={t("Form")}
      className="@container/form min-w-0 rounded-card border border-border-default bg-raised"
    >
      <header className="flex min-h-11 flex-wrap items-center gap-2 border-b border-border-default px-4">
        <h3 className="font-semibold">{t("Form")}</h3>
        <span className="text-sm text-muted">{typeName}</span>
        <span className="ms-auto text-sm text-muted">{t("Changes apply immediately")}</span>
      </header>
      <div
        className={`hidden min-h-10 items-center gap-2 border-b border-border-muted bg-section-header px-4 text-xs font-semibold @min-[960px]/form:grid ${columns}`}
      >
        <span />
        <span>{t("Row")}</span>
        {module !== "entity" && <span>{t("On intake form")}</span>}
        <span>{t("Required for creation")}</span>
        {module !== "entity" && <span>{t("Visible on Portal")}</span>}
        <span>{t("Touchpoint")}</span>
        <span />
      </div>
      <div className="overflow-x-auto">
        {tree(form)}
        {!form.length && <p className="p-4 text-muted">{t("No Fields attached")}</p>}
      </div>
      {footer(null)}
      <p className="sr-only" aria-live="polite">
        {announcement}
      </p>
      {moving && (
        <Dialog
          open
          onOpenChange={(open) => {
            if (!open) setMoving(null);
          }}
        >
          <DialogContent
            aria-describedby={undefined}
            onCloseAutoFocus={(e) => {
              e.preventDefault();
              restoreFocus.current?.focus();
            }}
          >
            <DialogTitle>{t("Move into")}</DialogTitle>
            <div className="mt-4 flex flex-col gap-2">
              {nodes
                .filter(
                  (n): n is FormBranch =>
                    n.kind === "branch" &&
                    n.id !== moving &&
                    !(
                      nodes.find((x) => x.id === moving)?.kind === "branch" &&
                      flatten((nodes.find((x) => x.id === moving) as FormBranch).children).some(
                        (x) => x.id === n.id,
                      )
                    ),
                )
                .map((branch) => {
                  const node = nodes.find((n) => n.id === moving)!;
                  const reason = refusal(
                    appendNode(replaceNode(form, moving, []), branch.id, node),
                  );
                  const parent = location(form, branch.id)?.parent;
                  return (
                    <div key={branch.id} className="flex flex-col gap-1">
                      <Button
                        variant="secondary"
                        disabled={!!reason}
                        aria-describedby={reason ? `destination-${branch.id}` : undefined}
                        onClick={() => {
                          setMoving(null);
                          void move(moving, branch.id);
                        }}
                      >
                        {parent ? `${name(parent)} / ` : ""}
                        {name(branch)}
                      </Button>
                      {reason && (
                        <span
                          id={`destination-${branch.id}`}
                          className="text-xs text-status-danger-fg"
                        >
                          {reason}
                        </span>
                      )}
                    </div>
                  );
                })}
              <Button
                variant="secondary"
                onClick={() => {
                  const node = nodes.find((n) => n.id === moving)!;
                  setMoving(null);
                  moveOut(node);
                }}
                disabled={!location(form, moving)?.parent}
              >
                {t("Move out")}
              </Button>
              <Button variant="ghost" onClick={() => setMoving(null)}>
                {t("Cancel")}
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      )}
      {fieldEditor && (
        <FieldEditorDialog
          target={fieldEditor.target}
          module={module}
          onOpenChange={(open) => {
            if (!open) setFieldEditor(null);
          }}
          onCloseAutoFocus={(e) => {
            e.preventDefault();
            restoreFocus.current?.focus();
          }}
          onRowChanged={(f) => setCatalog((old) => old.map((v) => (v.id === f.id ? f : v)))}
          onCreated={async (f) => {
            setCatalog((old) => [...old, f]);
            if (!(await attach(f, fieldEditor.parent, `${fieldEditor.parent ?? "root"}-create`))) {
              setCreated({ field: f, parent: fieldEditor.parent });
              note(
                `${fieldEditor.parent ?? "root"}-create`,
                "error",
                t("{field} was created but could not be attached. Retry attachment.", {
                  field: f.displayName,
                }),
              );
            }
          }}
        />
      )}
      {preview && (
        <IntakePreview
          form={form}
          typeId={typeId}
          isDefault={isDefault}
          module={module}
          catalog={catalog}
          typeName={typeName}
          onClose={() => setPreview(false)}
          onCloseAutoFocus={(e) => {
            e.preventDefault();
            restoreFocus.current?.focus();
          }}
        />
      )}
    </section>
  );
}

function AttachMenu({
  fields,
  disabled,
  label,
  onAttach,
  onCreate,
}: Readonly<{
  fields: readonly ApiField[];
  disabled: boolean;
  label: string;
  onAttach: (f: ApiField) => void;
  onCreate: (trigger: HTMLButtonElement | null) => void;
}>) {
  const t = useFormText();
  const [search, setSearch] = useState("");
  const input = useRef<HTMLInputElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const matches = fields
    .filter((f) => f.displayName.toLowerCase().includes(search.toLowerCase()))
    .toSorted((a, b) => a.displayName.localeCompare(b.displayName));
  return (
    <DropdownMenu
      onOpenChange={(open) => {
        setSearch("");
        if (open) requestAnimationFrame(() => input.current?.focus());
      }}
    >
      <DropdownMenuTrigger asChild>
        <Button ref={trigger} variant="secondary" size="sm" disabled={disabled}>
          {label}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent>
        <Input
          ref={input}
          aria-label={t("Search fields")}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          onKeyDown={(event) => {
            if (event.key !== "Escape") event.stopPropagation();
            if (event.key === "ArrowDown" || event.key === "ArrowUp") {
              event.preventDefault();
              const menu = event.currentTarget.closest('[role="menu"]');
              const fields = menu?.querySelectorAll<HTMLElement>(
                '[role="menuitem"][data-field-option]',
              );
              const items = fields?.length
                ? fields
                : menu?.querySelectorAll<HTMLElement>('[role="menuitem"]');
              (event.key === "ArrowDown" ? items?.[0] : items?.[items.length - 1])?.focus();
            }
            if (event.key === "Enter") event.preventDefault();
          }}
        />
        {matches.map((f) => (
          <DropdownMenuItem data-field-option key={f.id} onSelect={() => onAttach(f)}>
            <span>{f.displayName}</span>
            <span className="text-sm text-muted">{fieldTypeName(f.fieldType, t)}</span>
          </DropdownMenuItem>
        ))}
        {!matches.length && (
          <p className="px-2 py-1 text-sm text-muted">
            {fields.length ? t("No Fields match") : t("All Fields are attached")}
          </p>
        )}
        <DropdownMenuItem onSelect={() => onCreate(trigger.current)}>
          {t("Create Field")}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

type FormPayload =
  paths["/api/v1/contract-types/{id}/form"]["put"]["requestBody"]["content"]["application/json"]["form"];
function formPayload(form: Form): FormPayload {
  return form.map((node) =>
    node.kind === "row"
      ? { ...node }
      : {
          ...node,
          conditions: node.conditions.map((c) => ({
            ...c,
            value: Array.isArray(c.value)
              ? [...c.value]
              : (c.value as string | number | boolean | null),
          })),
          children: formPayload(node.children),
        },
  );
}
