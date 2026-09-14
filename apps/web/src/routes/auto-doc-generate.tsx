// SPDX-License-Identifier: AGPL-3.0-only

/** ADO-004 and ADO-007: keep answers beside a refusal until the person reviews the current pair. */
import { useState } from "react";
import { FormattedMessage, useIntl } from "react-intl";
import { redirect, useLoaderData, useNavigate, type LoaderFunctionArgs } from "react-router";
import {
  previousAnswerText,
  previousGenerationForm,
  reconcile,
  toDraft,
} from "../lib/auto-doc-answers";
import { FilingPicker, type FilingDestination } from "../components/auto-docs/filings";
import { api } from "../lib/api";
import { CONTROL_CLASS } from "../lib/form-controls";
import { isMemberPlus } from "../lib/roles";
import { requireUser, useSignOut } from "../lib/session";
import { AppShell } from "../components/shell/app-shell";
import { PageTitle } from "../components/page-title";
import { Button } from "../components/ui/button";
import { FormControl, type Draft } from "../components/auto-docs/form-control";
import { AutoDocSubBar } from "../components/auto-docs/sub-bar";

export async function autoDocGenerateLoader({ params, request }: LoaderFunctionArgs) {
  const user = await requireUser();
  if (!isMemberPlus(user.role)) return redirect("/portal");
  const result = await api.GET("/api/v1/auto-docs/{id}/generate", {
    params: { path: { id: params.id! } },
  });
  const from = new URL(request.url).searchParams.get("from");
  const previous = from
    ? await api.GET("/api/v1/auto-docs/{id}/generations/{generationId}", {
        params: { path: { id: params.id!, generationId: from } },
      })
    : undefined;
  return {
    user,
    id: params.id!,
    form: result.data,
    refusal: result.error?.detail,
    previous: previous?.data?.generation,
  };
}

export function AutoDocGeneratePage() {
  const loaded = useLoaderData<typeof autoDocGenerateLoader>();
  const [form, setForm] = useState(loaded.form);
  const [businessOwnerId, setBusinessOwnerId] = useState("");
  const [initial] = useState(() =>
    loaded.form
      ? reconcile(
          toDraft(loaded.previous?.answers),
          previousGenerationForm(loaded.previous),
          loaded.form,
        )
      : { retained: {}, dropped: [] },
  );
  const [draft, setDraft] = useState<Draft>(initial.retained);
  const [previousAnswers, setPreviousAnswers] = useState(initial.dropped);
  const [error, setError] = useState(loaded.refusal);
  const [busy, setBusy] = useState(false);
  const [chooseFiling, setChooseFiling] = useState(false);
  const [destination, setDestination] = useState<FilingDestination | null>(null);
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
    if (!form || busy || (chooseFiling && !destination)) return;
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
        body: {
          ...form.pair,
          answers,
          ...(chooseFiling && destination && destination.kind !== "new_contract"
            ? { filing: { destination } }
            : {}),
          ...(form.autoDoc.targetContractTypeId
            ? { businessOwnerId: businessOwnerId || null }
            : {}),
        },
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
      const { retained, dropped: previous } = reconcile(draft, form ?? null, current);
      setDraft(retained);
      setPreviousAnswers((answers) => [...answers, ...previous]);
      if (!current.businessOwners.some((person) => person.id === businessOwnerId))
        setBusinessOwnerId("");
      setForm(result.data);
      setError(undefined);
    } else setError(result?.error?.detail ?? failed());
  }
  return (
    <AppShell
      user={loaded.user}
      onSignOut={() => void signOut()}
      subbar={
        <AutoDocSubBar
          id={loaded.id}
          name={form?.autoDoc.name ?? null}
          title={intl.formatMessage({ id: "autoDocs.generate", defaultMessage: "Generate" })}
        />
      }
    >
      <PageTitle title={title} />
      <div className="mx-auto w-full max-w-2xl space-y-6">
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
                  <dd className="whitespace-pre-wrap break-words">
                    {previousAnswerText(intl, answer)}
                  </dd>
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
              {form.autoDoc.targetContractTypeId && (
                <label className="block space-y-1.5">
                  <span className="text-sm font-medium">
                    <FormattedMessage
                      id="contracts.businessOwner"
                      defaultMessage="Business Owner"
                    />
                  </span>
                  <select
                    className={CONTROL_CLASS}
                    value={businessOwnerId}
                    onChange={(event) => setBusinessOwnerId(event.target.value)}
                  >
                    <option value="">
                      {intl.formatMessage({
                        id: "autoDocs.noBusinessOwner",
                        defaultMessage: "Leave unassigned",
                      })}
                    </option>
                    {form.businessOwners.map((person) => (
                      <option key={person.id} value={person.id}>
                        {person.name}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={chooseFiling}
                  disabled={busy}
                  onChange={(event) => {
                    setChooseFiling(event.target.checked);
                    setDestination(null);
                  }}
                />
                <FormattedMessage id="autoDocs.fileOnGenerate" defaultMessage="File to a record" />
              </label>
              {chooseFiling && <FilingPicker onChange={setDestination} disabled={busy} />}
              <Button type="submit" disabled={busy || (chooseFiling && !destination)}>
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
