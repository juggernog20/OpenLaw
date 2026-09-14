// SPDX-License-Identifier: AGPL-3.0-only

/** DES-085: available Auto-Docs, acknowledgement, form, and retained Generation confirmation. */
import { useEffect, useRef, useState } from "react";
import { FormattedMessage, useIntl } from "react-intl";
import { Link, redirect, useLoaderData, useNavigate, type LoaderFunctionArgs } from "react-router";
import type { paths } from "@openlaw/api-client";
import { api } from "../lib/api";
import { currentUserFor, useSignOut } from "../lib/session";
import { formatLongDateTime } from "../lib/format";
import { PortalShell } from "../components/portal/portal-shell";
import { PageTitle } from "../components/page-title";
import { Button } from "../components/ui/button";
import { FormControl, type Draft } from "../components/auto-docs/form-control";
import {
  GenerationContract,
  GenerationDownload,
  GenerationEmail,
  GenerationState,
  generationWaiting,
} from "../components/auto-docs/generations";

type FormReply =
  paths["/api/v1/portal/auto-docs/{id}/generate"]["get"]["responses"][200]["content"]["application/json"];
type Form = NonNullable<FormReply["form"]>;
const CARD = "space-y-4 rounded-card border border-border-default bg-raised p-6";

export async function portalAutoDocsLoader({ request }: LoaderFunctionArgs) {
  const user = await currentUserFor(request);
  if (!user) return redirect("/portal/enter");
  const [list, history] = await Promise.all([
    api.GET("/api/v1/portal/auto-docs"),
    api.GET("/api/v1/portal/auto-doc-generations"),
  ]);
  if (!list.data || !history.data) throw new Error("Your Auto-Docs could not be read.");
  return { user, autoDocs: list.data.autoDocs, history: history.data };
}
export function PortalAutoDocsPage() {
  const { user, autoDocs, history } = useLoaderData<typeof portalAutoDocsLoader>();
  const [generations, setGenerations] = useState(history.generations);
  const [cursor, setCursor] = useState(history.nextCursor);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const intl = useIntl();
  const signOut = useSignOut("/portal/enter");
  const title = intl.formatMessage({
    id: "portal.navigation.autoDocs",
    defaultMessage: "Auto-Docs",
  });
  async function more() {
    if (!cursor || busy) return;
    setBusy(true);
    const result = await api
      .GET("/api/v1/portal/auto-doc-generations", { params: { query: { before: cursor } } })
      .catch(() => undefined);
    setBusy(false);
    if (result?.data) {
      setGenerations((current) => [
        ...current,
        ...result.data.generations.filter(
          (row) => !current.some((previous) => previous.id === row.id),
        ),
      ]);
      setCursor(result.data.nextCursor);
      setError(undefined);
    } else
      setError(
        result?.error?.detail ??
          intl.formatMessage({
            id: "portal.autoDocs.historyFailed",
            defaultMessage: "Could not read more Generations. Try again.",
          }),
      );
  }
  return (
    <PortalShell user={user} onSignOut={() => void signOut()}>
      <PageTitle title={title} />
      <div className="mx-auto w-full max-w-3xl space-y-6">
        <h1 className="text-xl font-semibold">{title}</h1>
        <p className="text-muted">
          <FormattedMessage
            id="portal.autoDocs.intro"
            defaultMessage="Generate documents using the words approved by Legal."
          />
        </p>
        <section aria-labelledby="available-auto-docs" className="space-y-3">
          <h2 id="available-auto-docs" className="text-lg font-semibold">
            <FormattedMessage id="portal.autoDocs.available" defaultMessage="Available Auto-Docs" />
          </h2>
          {!autoDocs.length && (
            <p className="text-muted">
              <FormattedMessage
                id="portal.autoDocs.empty"
                defaultMessage="No Auto-Docs are available to you yet."
              />
            </p>
          )}
          {autoDocs.map((row) => (
            <article key={row.id} className={CARD}>
              <h3 className="font-semibold">{row.name}</h3>
              {row.description && (
                <p className="whitespace-pre-wrap text-muted">{row.description}</p>
              )}
              {row.availability.ready ? (
                <Link
                  className="text-link hover:underline"
                  to={`/portal/auto-docs/${row.id}/generate`}
                >
                  <FormattedMessage
                    id="autoDocs.generateNamed"
                    defaultMessage="Generate {name}"
                    values={{ name: row.name }}
                  />
                </Link>
              ) : (
                <p>{row.availability.message}</p>
              )}
            </article>
          ))}
        </section>
        <section aria-labelledby="your-generations" className="space-y-3">
          <h2 id="your-generations" className="text-lg font-semibold">
            <FormattedMessage id="portal.autoDocs.history" defaultMessage="Your Generations" />
          </h2>
          {!generations.length && (
            <p className="text-muted">
              <FormattedMessage
                id="portal.autoDocs.historyEmpty"
                defaultMessage="Your generated documents will appear here."
              />
            </p>
          )}
          <ul className="divide-y divide-border-default">
            {generations.map((row) => (
              <li key={row.id} className="py-3">
                <Link
                  className="text-link hover:underline"
                  to={`/portal/auto-docs/${row.autoDocId}/generations/${row.id}`}
                >
                  {row.autoDocName} ·{" "}
                  <time dateTime={row.createdAt}>{formatLongDateTime(row.createdAt)}</time>
                </Link>
                <p className="text-sm text-muted">
                  <GenerationState state={row.state} />
                </p>
              </li>
            ))}
          </ul>
          {error && (
            <p role="alert" className="text-status-danger-fg">
              {error}
            </p>
          )}
          {cursor && (
            <Button variant="secondary" disabled={busy} onClick={() => void more()}>
              <FormattedMessage id="common.showMore" defaultMessage="Show more" />
            </Button>
          )}
        </section>
      </div>
    </PortalShell>
  );
}

export async function portalAutoDocGenerateLoader({ request, params }: LoaderFunctionArgs) {
  const user = await currentUserFor(request);
  if (!user) return redirect("/portal/enter");
  const result = await api.GET("/api/v1/portal/auto-docs/{id}/generate", {
    params: { path: { id: params.id! } },
  });
  const previousId = new URL(request.url).searchParams.get("from");
  const previous = previousId
    ? await api.GET("/api/v1/portal/auto-docs/{id}/generations/{generationId}", {
        params: { path: { id: params.id!, generationId: previousId } },
      })
    : undefined;
  return {
    user,
    id: params.id!,
    data: result.data,
    refusal: result.error?.detail,
    answers: previous?.data?.generation.answers,
  };
}
function toDraft(answers: Record<string, unknown> | undefined): Draft {
  return Object.fromEntries(
    Object.entries(answers ?? {}).map(([slug, value]) => [
      slug,
      Array.isArray(value) ? value.map(String) : String(value ?? ""),
    ]),
  );
}
export function PortalAutoDocGeneratePage() {
  const loaded = useLoaderData<typeof portalAutoDocGenerateLoader>();
  // Each Auto-Doc owns its draft, even when navigation reuses this route component.
  return <PortalAutoDocForm key={loaded.id} loaded={loaded} />;
}
function PortalAutoDocForm({
  loaded,
}: {
  loaded: Exclude<Awaited<ReturnType<typeof portalAutoDocGenerateLoader>>, Response>;
}) {
  const [data, setData] = useState(loaded.data);
  const [draft, setDraft] = useState<Draft>(() => toDraft(loaded.answers));
  const [lastForm, setLastForm] = useState<Form | null>(loaded.data?.form ?? null);
  const [previousAnswers, setPreviousAnswers] = useState<Array<{ label: string; value: string }>>(
    [],
  );
  const [acknowledgementId, setAcknowledgementId] = useState<string>();
  const [checked, setChecked] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(loaded.refusal);
  const heading = useRef<HTMLHeadingElement>(null);
  const navigate = useNavigate();
  const intl = useIntl();
  const signOut = useSignOut("/portal/enter");
  const needsAck = data?.availability.ready && data.acknowledgement.required;
  const title = needsAck
    ? intl.formatMessage({
        id: "portal.autoDocs.beforeGenerate",
        defaultMessage: "Before you generate",
      })
    : data
      ? intl.formatMessage(
          { id: "autoDocs.generateNamed", defaultMessage: "Generate {name}" },
          { name: data.autoDoc.name },
        )
      : intl.formatMessage({ id: "autoDocs.generate", defaultMessage: "Generate" });
  useEffect(() => {
    heading.current?.focus();
  }, [needsAck]);
  const failed = () =>
    intl.formatMessage({
      id: "autoDocs.generationFailedRequest",
      defaultMessage: "Could not generate this document. Your answers are kept here. Try again.",
    });
  function receive(next: FormReply) {
    setData(next);
    setChecked(false);
    if (!next.form) return;
    const current = next.form;
    const retained = { ...draft };
    const previous: typeof previousAnswers = [];
    for (const [slug, value] of Object.entries(draft)) {
      const old = lastForm?.fields.find((field) => field.slug === slug);
      const field = current.fields.find((field) => field.slug === slug);
      const choices = Array.isArray(value) ? value : [value];
      const compatible =
        field &&
        (!old || old.fieldType === field.fieldType) &&
        (!["single_select", "multi_select"].includes(field.fieldType) ||
          choices.every((choice) => !choice || field.options?.includes(choice))) &&
        (field.fieldType !== "entity" ||
          !value ||
          current.entities.some((entity) => entity.id === value));
      if (compatible) continue;
      delete retained[slug];
      if (old && choices.some(Boolean))
        previous.push({
          label: old.label,
          value:
            old.fieldType === "entity"
              ? (lastForm?.entities.find((entity) => entity.id === value)?.name ?? String(value))
              : choices.join(", "),
        });
    }
    setDraft(retained);
    if (previous.length) setPreviousAnswers((saved) => [...saved, ...previous]);
    setLastForm(current);
  }
  async function refresh(id = acknowledgementId) {
    setBusy(true);
    const result = await api
      .GET("/api/v1/portal/auto-docs/{id}/generate", {
        params: { path: { id: loaded.id }, query: { acknowledgementId: id } },
      })
      .catch(() => undefined);
    setBusy(false);
    if (result?.data) {
      receive(result.data);
      setError(undefined);
    } else setError(result?.error?.detail ?? failed());
  }
  async function acknowledge() {
    if (!checked || !data || busy) return;
    setBusy(true);
    const result = await api
      .POST("/api/v1/portal/auto-docs/{id}/acknowledgements", {
        params: { path: { id: loaded.id } },
        body: { textHash: data.acknowledgement.textHash },
      })
      .catch(() => undefined);
    setBusy(false);
    if (result?.data) {
      const id = result.data.acknowledgementId ?? undefined;
      setAcknowledgementId(id);
      await refresh(id);
    } else setError(result?.error?.detail ?? failed());
  }
  async function submit() {
    if (!data?.form || busy || needsAck) return;
    const fields = data.form.fields;
    const missing = fields.find(
      (field) =>
        field.required &&
        (!Object.hasOwn(draft, field.slug) ||
          draft[field.slug] === "" ||
          (Array.isArray(draft[field.slug]) && draft[field.slug]!.length === 0)),
    );
    if (missing) {
      setError(
        intl.formatMessage(
          { id: "autoDocs.fillAnswerFirst", defaultMessage: 'Fill "{label}" first.' },
          { label: missing.label },
        ),
      );
      return;
    }
    setBusy(true);
    setError(undefined);
    const answers = Object.fromEntries(
      fields.map((field) => {
        const raw = draft[field.slug] ?? "";
        return [
          field.slug,
          raw === ""
            ? null
            : ["number", "currency"].includes(field.fieldType)
              ? Number(raw)
              : field.fieldType === "boolean"
                ? raw === "true"
                : raw,
        ];
      }),
    );
    const result = await api
      .POST("/api/v1/portal/auto-docs/{id}/generations", {
        params: { path: { id: loaded.id } },
        body: { ...data.form.pair, answers, ...(acknowledgementId ? { acknowledgementId } : {}) },
      })
      .catch(() => undefined);
    setBusy(false);
    if (result?.data)
      void navigate(`/portal/auto-docs/${loaded.id}/generations/${result.data.generation.id}`);
    else setError(result?.error?.detail ?? failed());
  }
  return (
    <PortalShell user={loaded.user} onSignOut={() => void signOut()}>
      <PageTitle title={title} />
      <div className="mx-auto w-full max-w-2xl space-y-6">
        <Link className="text-link hover:underline" to="/portal/auto-docs">
          <FormattedMessage id="portal.autoDocs.back" defaultMessage="Back to Auto-Docs" />
        </Link>
        <h1 ref={heading} tabIndex={-1} className="text-xl font-semibold focus:outline-none">
          {title}
        </h1>
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
        {data && !data.availability.ready && <p role="status">{data.availability.message}</p>}
        {needsAck && data && (
          <section className={CARD} aria-label={data.autoDoc.name}>
            <h2 className="text-lg font-semibold">{data.autoDoc.name}</h2>
            <p className="whitespace-pre-wrap">{data.acknowledgement.text}</p>
            <label className="flex items-start gap-3">
              <input
                type="checkbox"
                className="mt-1 size-4 accent-accent"
                checked={checked}
                disabled={busy}
                onChange={(event) => setChecked(event.target.checked)}
              />
              <span>
                <FormattedMessage
                  id="portal.autoDocs.acknowledgeStatement"
                  defaultMessage="I acknowledge this statement."
                />
              </span>
            </label>
            <Button disabled={!checked || busy} onClick={() => void acknowledge()}>
              <FormattedMessage
                id="portal.autoDocs.acknowledgeContinue"
                defaultMessage="Acknowledge and continue"
              />
            </Button>
          </section>
        )}
        {data?.form && (
          <form
            className={CARD}
            onSubmit={(event) => {
              event.preventDefault();
              void submit();
            }}
          >
            {data.autoDoc.description && (
              <p className="whitespace-pre-wrap text-muted">{data.autoDoc.description}</p>
            )}
            <fieldset disabled={busy} className="space-y-4">
              {data.form.fields.map((field) => (
                <div key={field.slug} className="space-y-1">
                  <label htmlFor={`answer-${field.slug}`} className="block font-medium">
                    {field.label}
                    {field.required && <span aria-hidden="true"> *</span>}
                  </label>
                  <FormControl
                    field={field}
                    form={data.form!}
                    draft={draft[field.slug] ?? (field.fieldType === "multi_select" ? [] : "")}
                    onChange={(value) =>
                      setDraft((current) => ({ ...current, [field.slug]: value }))
                    }
                  />
                  {field.help && (
                    <p id={`help-${field.slug}`} className="text-sm text-muted">
                      {field.help}
                    </p>
                  )}
                </div>
              ))}
            </fieldset>
            <Button type="submit" disabled={busy}>
              <FormattedMessage id="autoDocs.generate" defaultMessage="Generate" />
            </Button>
          </form>
        )}
        {!!previousAnswers.length && (
          <section className={CARD}>
            <h2 className="font-semibold">
              <FormattedMessage id="autoDocs.previousAnswers" defaultMessage="Previous answers" />
            </h2>
            <dl>
              {previousAnswers.map((answer, index) => (
                <div key={index}>
                  <dt>{answer.label}</dt>
                  <dd className="whitespace-pre-wrap text-muted">{answer.value}</dd>
                </div>
              ))}
            </dl>
          </section>
        )}
      </div>
    </PortalShell>
  );
}

export async function portalAutoDocGenerationLoader({ request, params }: LoaderFunctionArgs) {
  const user = await currentUserFor(request);
  if (!user) return redirect("/portal/enter");
  const result = await api.GET("/api/v1/portal/auto-docs/{id}/generations/{generationId}", {
    params: { path: { id: params.id!, generationId: params.generationId! } },
  });
  return {
    user,
    id: params.id!,
    generationId: params.generationId!,
    data: result.data,
    refusal: result.error?.detail,
  };
}
export function PortalAutoDocGenerationPage() {
  const loaded = useLoaderData<typeof portalAutoDocGenerationLoader>();
  return <PortalGeneration key={loaded.generationId} loaded={loaded} />;
}
function PortalGeneration({
  loaded,
}: {
  loaded: Exclude<Awaited<ReturnType<typeof portalAutoDocGenerationLoader>>, Response>;
}) {
  const [data, setData] = useState(loaded.data);
  const [error, setError] = useState(loaded.refusal);
  const [busy, setBusy] = useState(false);
  const intl = useIntl();
  const signOut = useSignOut("/portal/enter");
  const title = intl.formatMessage({
    id: "portal.autoDocs.confirmation",
    defaultMessage: "Your generated document",
  });
  const waiting = data ? generationWaiting(data.generation) : false;
  useEffect(() => {
    if (!waiting || error) return;
    let cancelled = false;
    const timer = setTimeout(() => {
      void api
        .GET("/api/v1/portal/auto-docs/{id}/generations/{generationId}", {
          params: { path: { id: loaded.id, generationId: loaded.generationId } },
        })
        .catch(() => undefined)
        .then((result) => {
          if (cancelled) return;
          if (result?.data) setData(result.data);
          else {
            if (result?.response.status === 403 || result?.response.status === 404)
              setData(undefined);
            setError(
              result?.error?.detail ??
                intl.formatMessage({
                  id: "portal.autoDocs.statusFailed",
                  defaultMessage: "Could not refresh the document status. Try again.",
                }),
            );
          }
        });
    }, 1500);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [waiting, data, error, loaded.id, loaded.generationId, intl]);
  async function retry() {
    setBusy(true);
    const result = await api
      .GET("/api/v1/portal/auto-docs/{id}/generations/{generationId}", {
        params: { path: { id: loaded.id, generationId: loaded.generationId } },
      })
      .catch(() => undefined);
    setBusy(false);
    if (result?.data) {
      setData(result.data);
      setError(undefined);
    } else
      setError(
        result?.error?.detail ??
          intl.formatMessage({
            id: "portal.autoDocs.statusFailed",
            defaultMessage: "Could not refresh the document status. Try again.",
          }),
      );
  }
  return (
    <PortalShell user={loaded.user} onSignOut={() => void signOut()}>
      <PageTitle title={title} />
      <div className="mx-auto w-full max-w-2xl space-y-6">
        <Link className="text-link hover:underline" to="/portal/auto-docs">
          <FormattedMessage id="portal.autoDocs.back" defaultMessage="Back to Auto-Docs" />
        </Link>
        <h1 className="text-xl font-semibold">{title}</h1>
        {error && (
          <div className="space-y-3">
            <p role="alert" className="text-status-danger-fg">
              {error}
            </p>
            <Button disabled={busy} variant="secondary" onClick={() => void retry()}>
              <FormattedMessage id="common.tryAgain" defaultMessage="Try again" />
            </Button>
          </div>
        )}
        {data && (
          <section className={CARD}>
            <h2 className="text-lg font-semibold">{data.generation.autoDocName}</h2>
            <p role="status">
              <GenerationState state={data.generation.state} />
            </p>
            {data.generation.failure && (
              <p role="alert" className="text-status-danger-fg">
                {data.generation.failure.detail}
              </p>
            )}
            <GenerationContract generation={data.generation} portal />
            <GenerationDownload generation={data.generation} portal />
            <GenerationEmail generation={data.generation} />
            {data.canGenerate && (
              <Link
                className="text-link hover:underline"
                to={`/portal/auto-docs/${loaded.id}/generate?from=${data.generation.id}`}
              >
                <FormattedMessage id="autoDocs.generateAgain" defaultMessage="Generate again" />
              </Link>
            )}
          </section>
        )}
      </div>
    </PortalShell>
  );
}
