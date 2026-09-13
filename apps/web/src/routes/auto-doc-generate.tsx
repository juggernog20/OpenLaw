// SPDX-License-Identifier: AGPL-3.0-only

/** ADO-004 and ADO-007: keep answers beside a refusal until the person reviews the current pair. */
import { useState } from "react";
import { FormattedMessage, useIntl } from "react-intl";
import { Link, redirect, useLoaderData, useNavigate, type LoaderFunctionArgs } from "react-router";
import { api } from "../lib/api";
import type { AutoDocGenerationForm } from "../lib/auto-docs";
import { CONTROL_CLASS, TEXTAREA_CLASS } from "../lib/form-controls";
import { isMemberPlus } from "../lib/roles";
import { requireUser, useSignOut } from "../lib/session";
import { AppShell } from "../components/shell/app-shell";
import { PageTitle } from "../components/page-title";
import { Button } from "../components/ui/button";
import { DatePicker } from "../components/date-picker";

export async function autoDocGenerateLoader({ params }: LoaderFunctionArgs) {
  const user = await requireUser();
  if (!isMemberPlus(user.role)) return redirect("/portal");
  const result = await api.GET("/api/v1/auto-docs/{id}/generate", {
    params: { path: { id: params.id! } },
  });
  return { user, id: params.id!, form: result.data, refusal: result.error?.detail };
}

type Draft = Record<string, string | string[]>;
function FormControl({
  field,
  form,
  draft,
  onChange,
}: {
  field: AutoDocGenerationForm["fields"][number];
  form: AutoDocGenerationForm;
  draft: string | string[];
  onChange: (value: string | string[]) => void;
}) {
  const intl = useIntl();
  const props = {
    id: `answer-${field.slug}`,
    required: field.required,
    "aria-describedby": field.help ? `help-${field.slug}` : undefined,
    className: CONTROL_CLASS,
  };
  if (field.fieldType === "date")
    return (
      <DatePicker
        id={props.id}
        describedBy={props["aria-describedby"]}
        value={String(draft)}
        onChange={onChange}
      />
    );
  if (field.fieldType === "long_text")
    return (
      <textarea
        {...props}
        className={TEXTAREA_CLASS}
        value={String(draft)}
        onChange={(event) => onChange(event.target.value)}
        maxLength={10_000}
      />
    );
  if (field.fieldType === "multi_select")
    return (
      <select
        {...props}
        multiple
        value={Array.isArray(draft) ? draft : []}
        onChange={(event) =>
          onChange([...event.target.selectedOptions].map((option) => option.value))
        }
        className={`${CONTROL_CLASS} h-auto min-h-24`}
      >
        {field.options?.map((option) => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
      </select>
    );
  if (["single_select", "boolean", "entity"].includes(field.fieldType))
    return (
      <select {...props} value={String(draft)} onChange={(event) => onChange(event.target.value)}>
        <option value="">
          {intl.formatMessage({ id: "autoDocs.chooseAnswer", defaultMessage: "Choose an answer" })}
        </option>
        {field.fieldType === "boolean" ? (
          <>
            <option value="true">
              {intl.formatMessage({ id: "common.yes", defaultMessage: "Yes" })}
            </option>
            <option value="false">
              {intl.formatMessage({ id: "common.no", defaultMessage: "No" })}
            </option>
          </>
        ) : field.fieldType === "entity" ? (
          form.entities.map((entity) => (
            <option key={entity.id} value={entity.id}>
              {entity.name}
            </option>
          ))
        ) : (
          field.options?.map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))
        )}
      </select>
    );
  return (
    <input
      {...props}
      type={field.fieldType === "number" || field.fieldType === "currency" ? "number" : "text"}
      step="any"
      maxLength={field.fieldType === "text" ? 500 : undefined}
      value={String(draft)}
      onChange={(event) => onChange(event.target.value)}
    />
  );
}

export function AutoDocGeneratePage() {
  const loaded = useLoaderData<typeof autoDocGenerateLoader>();
  const [form, setForm] = useState(loaded.form);
  const [draft, setDraft] = useState<Draft>({});
  const [previousAnswers, setPreviousAnswers] = useState<{ label: string; value: string }[]>([]);
  const [error, setError] = useState(loaded.refusal);
  const [busy, setBusy] = useState(false);
  const intl = useIntl();
  const navigate = useNavigate();
  const signOut = useSignOut("/auth/login");
  const title = form
    ? intl.formatMessage(
        { id: "autoDocs.generateNamed", defaultMessage: "Generate {name}" },
        { name: form.autoDoc.name },
      )
    : intl.formatMessage({ id: "autoDocs.generate", defaultMessage: "Generate" });
  const failed = () =>
    intl.formatMessage({
      id: "autoDocs.generationFailedRequest",
      defaultMessage: "Could not generate this document. Your answers are kept here. Try again.",
    });
  async function submit() {
    if (!form || busy) return;
    const missingDate = form.fields.find(
      (field) =>
        field.fieldType === "date" &&
        field.required &&
        (!Object.hasOwn(draft, field.slug) || !draft[field.slug]),
    );
    if (missingDate) {
      setError(
        intl.formatMessage(
          { id: "autoDocs.fillAnswerFirst", defaultMessage: 'Fill "{label}" first.' },
          { label: missingDate.label },
        ),
      );
      return;
    }
    setBusy(true);
    setError(undefined);
    const answers = Object.fromEntries(
      form.fields.map((field) => {
        const raw = Object.hasOwn(draft, field.slug) ? (draft[field.slug] ?? "") : "";
        const value =
          raw === ""
            ? null
            : field.fieldType === "number" || field.fieldType === "currency"
              ? Number(raw)
              : field.fieldType === "boolean"
                ? raw === "true"
                : raw;
        return [field.slug, value];
      }),
    );
    const result = await api
      .POST("/api/v1/auto-docs/{id}/generations", {
        params: { path: { id: loaded.id } },
        body: { ...form.pair, answers },
      })
      .catch(() => undefined);
    setBusy(false);
    if (result?.data)
      void navigate(`/auto-docs/${loaded.id}/generations/${result.data.generation.id}`);
    else setError(result?.error?.detail ?? failed());
  }
  async function refresh() {
    setBusy(true);
    const result = await api
      .GET("/api/v1/auto-docs/{id}/generate", { params: { path: { id: loaded.id } } })
      .catch(() => undefined);
    setBusy(false);
    if (result?.data) {
      const current = result.data;
      const retained = { ...draft };
      const previous: typeof previousAnswers = [];
      for (const field of form?.fields ?? []) {
        if (!Object.hasOwn(draft, field.slug)) continue;
        const value = draft[field.slug]!;
        const next = current.fields.find((candidate) => candidate.slug === field.slug);
        const choices = Array.isArray(value) ? value : [value];
        const compatible =
          next?.fieldType === field.fieldType &&
          (!["single_select", "multi_select"].includes(next.fieldType) ||
            choices.every((choice) => !choice || next.options?.includes(choice))) &&
          (next.fieldType !== "entity" ||
            !value ||
            current.entities.some((entity) => entity.id === value));
        if (compatible) continue;
        delete retained[field.slug];
        if (value === "" || (Array.isArray(value) && value.length === 0)) continue;
        const display =
          field.fieldType === "entity"
            ? (form?.entities.find((entity) => entity.id === value)?.name ?? String(value))
            : field.fieldType === "boolean"
              ? intl.formatMessage(
                  value === "true"
                    ? { id: "common.yes", defaultMessage: "Yes" }
                    : { id: "common.no", defaultMessage: "No" },
                )
              : choices.join(", ");
        previous.push({ label: field.label, value: display });
      }
      setDraft(retained);
      setPreviousAnswers((answers) => [...answers, ...previous]);
      setForm(result.data);
      setError(undefined);
    } else setError(result?.error?.detail ?? failed());
  }
  return (
    <AppShell user={loaded.user} onSignOut={() => void signOut()}>
      <PageTitle title={title} />
      <div className="mx-auto w-full max-w-2xl space-y-6">
        <Link className="text-link hover:underline" to={`/auto-docs/${loaded.id}`}>
          <FormattedMessage id="autoDocs.backToAutoDoc" defaultMessage="Back to Auto-Doc" />
        </Link>
        <h1 className="text-xl font-semibold">{title}</h1>
        {form?.autoDoc.description && <p className="text-muted">{form.autoDoc.description}</p>}
        {error && (
          <div className="space-y-3">
            <p role="alert" className="text-status-danger-fg">
              {error}
            </p>
            <Button variant="secondary" disabled={busy} onClick={() => void refresh()}>
              <FormattedMessage
                id="autoDocs.reviewCurrentForm"
                defaultMessage="Review current form"
              />
            </Button>
          </div>
        )}
        {previousAnswers.length > 0 && (
          <section
            aria-labelledby="previous-answers-title"
            className="space-y-3 rounded-card border border-border-default bg-raised p-4"
          >
            <h2 id="previous-answers-title" className="font-semibold">
              <FormattedMessage id="autoDocs.previousAnswers" defaultMessage="Previous answers" />
            </h2>
            <p className="text-sm text-muted">
              <FormattedMessage
                id="autoDocs.previousAnswersHelp"
                defaultMessage="These answers no longer fit the current form. They are kept here so you can copy them into the new fields."
              />
            </p>
            <dl className="space-y-3 text-sm">
              {previousAnswers.map((answer, index) => (
                <div key={index}>
                  <dt className="font-medium">{answer.label}</dt>
                  <dd className="whitespace-pre-wrap break-words">{answer.value}</dd>
                </div>
              ))}
            </dl>
          </section>
        )}
        {form && (
          <form
            onSubmit={(event) => {
              event.preventDefault();
              void submit();
            }}
          >
            <fieldset disabled={busy} className="space-y-5">
              <legend className="sr-only">
                <FormattedMessage id="autoDocs.answers" defaultMessage="Answers" />
              </legend>
              {form.fields.map((field) => (
                <div className="space-y-1.5" key={field.slug}>
                  <label htmlFor={`answer-${field.slug}`} className="block text-sm font-medium">
                    {field.label}
                  </label>
                  {field.help && (
                    <p id={`help-${field.slug}`} className="text-sm text-muted">
                      {field.help}
                    </p>
                  )}
                  <FormControl
                    field={field}
                    form={form}
                    draft={Object.hasOwn(draft, field.slug) ? draft[field.slug]! : ""}
                    onChange={(value) =>
                      setDraft((current) => ({ ...current, [field.slug]: value }))
                    }
                  />
                  {field.required && (
                    <p className="text-xs text-muted">
                      <FormattedMessage id="autoDocs.answerRequired" defaultMessage="Required" />
                    </p>
                  )}
                </div>
              ))}
              <Button type="submit" disabled={busy}>
                <FormattedMessage id="autoDocs.generate" defaultMessage="Generate" />
              </Button>
              {busy && (
                <p role="status" className="text-sm text-muted">
                  <FormattedMessage
                    id="autoDocs.generating"
                    defaultMessage="Generating your document…"
                  />
                </p>
              )}
            </fieldset>
          </form>
        )}
      </div>
    </AppShell>
  );
}
