// SPDX-License-Identifier: AGPL-3.0-only

/** DES-085: available Auto-Docs, acknowledgement, form, and retained Generation confirmation. */
import { useEffect, useRef, useState } from "react";
import { FormattedMessage, useIntl } from "react-intl";
import {
  Link,
  redirect,
  useLoaderData,
  useNavigate,
  useSearchParams,
  type LoaderFunctionArgs,
} from "react-router";
import { ArrowLeft, ArrowRight, FileText, Files, Search, CircleAlert } from "lucide-react";
import { ManagedTable } from "../components/table/managed-table";
import { builtInLayout, type TableCatalogue } from "../lib/list-views";
import { Input } from "../components/ui/input";
import { SettingsCard } from "../components/settings-card";
import { GenerationStatusPill } from "../components/auto-docs/generations";
import type { paths } from "@openlaw/api-client";
import {
  previousAnswerText,
  previousGenerationForm,
  reconcile,
  toDraft,
  type PreviousAnswer,
} from "../lib/auto-doc-answers";
import { GenerationFiling } from "../components/auto-docs/filings";
import { api } from "../lib/api";
import { currentUserFor, useSignOut } from "../lib/session";
import { formatLongDateTime } from "../lib/format";
import { PortalShell } from "../components/portal/portal-shell";
import { PageTitle } from "../components/page-title";
import { Button } from "../components/ui/button";
import { Label } from "../components/ui/label";
import { FormControl, type Draft } from "../components/auto-docs/form-control";
import {
  GenerationContract,
  GenerationDownload,
  GenerationEmail,
  generationWaiting,
} from "../components/auto-docs/generations";

type FormReply =
  paths["/api/v1/portal/auto-docs/{id}/generate"]["get"]["responses"][200]["content"]["application/json"];
const CARD = "space-y-4 rounded-card border border-border-default bg-raised p-5";

export async function portalAutoDocsLoader({ request }: LoaderFunctionArgs) {
  const user = await currentUserFor(request);
  if (!user) return redirect("/portal/login");
  const [list, history] = await Promise.all([
    api.GET("/api/v1/portal/auto-docs"),
    api.GET("/api/v1/portal/auto-doc-generations"),
  ]);
  if (!list.data || !history.data) throw new Error("Your Auto-Docs could not be read.");
  return { user, autoDocs: list.data.autoDocs, history: history.data };
}
type AvailableAutoDoc =
  paths["/api/v1/portal/auto-docs"]["get"]["responses"][200]["content"]["application/json"]["autoDocs"][number];
type OwnedGeneration =
  paths["/api/v1/portal/auto-doc-generations"]["get"]["responses"][200]["content"]["application/json"]["generations"][number];
const libraryColumns: TableCatalogue<AvailableAutoDoc> = {
  flexColumnKey: "description",
  defaultColumnKeys: ["name", "description", "formats", "generate"],
  columns: [
    {
      key: "name",
      header: <FormattedMessage id="portal.autoDocs.template" defaultMessage="Template" />,
      label: (intl) =>
        intl.formatMessage({ id: "portal.autoDocs.template", defaultMessage: "Template" }),
      defaultWidth: 280,
      minWidth: 200,
      render: (row) => (
        <span className="flex items-center gap-2.5">
          <FileText size={16} className="shrink-0 text-muted" aria-hidden="true" />
          <span className="font-medium">{row.name}</span>
        </span>
      ),
    },
    {
      key: "description",
      header: <FormattedMessage id="portal.autoDocs.description" defaultMessage="Description" />,
      label: (intl) =>
        intl.formatMessage({ id: "portal.autoDocs.description", defaultMessage: "Description" }),
      defaultWidth: 420,
      minWidth: 220,
      render: (row) => (
        <span className="text-muted">
          {row.availability.ready ? (
            row.description || (
              <FormattedMessage id="portal.autoDocs.noDescription" defaultMessage="—" />
            )
          ) : (
            <span className="inline-flex items-center gap-2 text-status-warning-fg">
              <CircleAlert size={14} className="shrink-0" aria-hidden="true" />
              {row.availability.message}
            </span>
          )}
        </span>
      ),
    },
    {
      key: "formats",
      header: <FormattedMessage id="portal.autoDocs.format" defaultMessage="Format" />,
      label: (intl) =>
        intl.formatMessage({ id: "portal.autoDocs.format", defaultMessage: "Format" }),
      defaultWidth: 140,
      minWidth: 100,
      render: (row) => (
        <span className="text-sm text-muted">
          {row.formats === "both" ? (
            <FormattedMessage id="autoDocs.formatBoth" defaultMessage="Word · PDF" />
          ) : row.formats === "pdf" ? (
            <FormattedMessage id="autoDocs.formatPdf" defaultMessage="PDF" />
          ) : (
            <FormattedMessage id="autoDocs.formatWord" defaultMessage="Word" />
          )}
        </span>
      ),
    },
    {
      key: "generate",
      header: (
        <span className="sr-only">
          <FormattedMessage id="autoDocs.generate" defaultMessage="Generate" />
        </span>
      ),
      label: (intl) => intl.formatMessage({ id: "autoDocs.generate", defaultMessage: "Generate" }),
      defaultWidth: 150,
      minWidth: 140,
      align: "end",
      render: (row, intl) =>
        row.availability.ready ? (
          <Button asChild size="sm" variant="secondary">
            <Link
              aria-label={intl.formatMessage(
                { id: "autoDocs.generateNamed", defaultMessage: "Generate {name}" },
                { name: row.name },
              )}
              to={`/portal/auto-docs/${row.id}/generate`}
            >
              <FormattedMessage id="autoDocs.generate" defaultMessage="Generate" />
              <ArrowRight size={14} aria-hidden="true" />
            </Link>
          </Button>
        ) : (
          <span className="text-xs text-muted">
            <FormattedMessage id="portal.autoDocs.unavailable" defaultMessage="Unavailable" />
          </span>
        ),
    },
  ],
};
const historyColumns: TableCatalogue<OwnedGeneration> = {
  flexColumnKey: "name",
  defaultColumnKeys: ["name", "createdAt", "state", "downloads"],
  columns: [
    {
      key: "name",
      header: <FormattedMessage id="portal.autoDocs.document" defaultMessage="Document" />,
      label: (intl) =>
        intl.formatMessage({ id: "portal.autoDocs.document", defaultMessage: "Document" }),
      defaultWidth: 360,
      minWidth: 240,
      render: (row) => (
        <Link
          className="flex items-center gap-2.5 font-medium text-link"
          to={`/portal/auto-docs/${row.autoDocId}/generations/${row.id}`}
        >
          <FileText size={16} className="shrink-0 text-muted" aria-hidden="true" />
          {row.autoDocName}
        </Link>
      ),
    },
    {
      key: "createdAt",
      header: <FormattedMessage id="portal.autoDocs.created" defaultMessage="Created" />,
      label: (intl) =>
        intl.formatMessage({ id: "portal.autoDocs.created", defaultMessage: "Created" }),
      defaultWidth: 240,
      minWidth: 190,
      render: (row) => (
        <time className="text-muted" dateTime={row.createdAt}>
          {formatLongDateTime(row.createdAt)}
        </time>
      ),
    },
    {
      key: "state",
      header: <FormattedMessage id="portal.autoDocs.status" defaultMessage="Status" />,
      label: (intl) =>
        intl.formatMessage({ id: "portal.autoDocs.status", defaultMessage: "Status" }),
      defaultWidth: 120,
      minWidth: 100,
      render: (row) => <GenerationStatusPill state={row.state} />,
    },
    {
      key: "downloads",
      header: <FormattedMessage id="portal.autoDocs.downloads" defaultMessage="Downloads" />,
      label: (intl) =>
        intl.formatMessage({ id: "portal.autoDocs.downloads", defaultMessage: "Downloads" }),
      defaultWidth: 240,
      minWidth: 220,
      render: (row) => <GenerationDownload generation={row} portal />,
    },
  ],
};

export function PortalAutoDocsPage() {
  const { user, autoDocs, history } = useLoaderData<typeof portalAutoDocsLoader>();
  const [generations, setGenerations] = useState(history.generations);
  const [cursor, setCursor] = useState(history.nextCursor);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [params, setParams] = useSearchParams();
  const view = params.get("view") === "history" ? "history" : "library";
  const query = params.get("q") ?? "";
  const [libraryLayout, setLibraryLayout] = useState(() => builtInLayout(libraryColumns));
  const [historyLayout, setHistoryLayout] = useState(() => builtInLayout(historyColumns));
  const intl = useIntl();
  const signOut = useSignOut("/portal/login");
  const title = intl.formatMessage({
    id: "portal.navigation.autoDocs",
    defaultMessage: "Auto-Docs",
  });
  const library = autoDocs
    .filter((row) =>
      `${row.name} ${row.description ?? ""}`
        .toLocaleLowerCase(intl.locale)
        .includes(query.toLocaleLowerCase(intl.locale)),
    )
    .sort((a, b) => a.name.localeCompare(b.name, intl.locale));
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
    <PortalShell wide user={user} onSignOut={() => void signOut()}>
      <PageTitle title={title} />
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold">{title}</h1>
        <p className="text-base text-muted">
          <FormattedMessage
            id="portal.autoDocs.libraryIntro"
            defaultMessage="Create documents from Legal's approved templates, then find and download your finished documents here."
          />
        </p>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-4">
        <nav
          aria-label={title}
          className="flex gap-1 rounded-button border border-border-default bg-control p-1"
        >
          <Link
            className={`flex items-center gap-2 rounded-button px-3 py-1.5 text-sm font-medium ${view === "library" ? "bg-raised text-primary shadow-sm" : "text-muted hover:text-primary"}`}
            aria-current={view === "library" ? "page" : undefined}
            to="/portal/auto-docs"
          >
            <Files size={14} aria-hidden="true" />
            <FormattedMessage id="portal.autoDocs.library" defaultMessage="Template library" />
            <span className="text-xs text-muted">{autoDocs.length}</span>
          </Link>
          <Link
            className={`flex items-center gap-2 rounded-button px-3 py-1.5 text-sm font-medium ${view === "history" ? "bg-raised text-primary shadow-sm" : "text-muted hover:text-primary"}`}
            aria-current={view === "history" ? "page" : undefined}
            to="/portal/auto-docs?view=history"
          >
            <FileText size={14} aria-hidden="true" />
            <FormattedMessage id="portal.autoDocs.yourDocuments" defaultMessage="Your documents" />
          </Link>
        </nav>
        {view === "library" && (
          <form
            role="search"
            className="flex w-full items-center gap-2 @sm/page:w-auto"
            onSubmit={(event) => {
              event.preventDefault();
              const value = String(new FormData(event.currentTarget).get("q") ?? "").trim();
              setParams(value ? { q: value } : {});
            }}
          >
            <div className="relative min-w-0 flex-1">
              <Search
                size={16}
                className="absolute start-2.5 top-1/2 -translate-y-1/2 text-muted"
                aria-hidden="true"
              />
              <Input
                key={query}
                name="q"
                type="search"
                defaultValue={query}
                className="w-full ps-8 @sm/page:w-72"
                aria-label={intl.formatMessage({
                  id: "portal.autoDocs.searchTemplates",
                  defaultMessage: "Search templates",
                })}
                placeholder={intl.formatMessage({
                  id: "portal.autoDocs.searchTemplates",
                  defaultMessage: "Search templates",
                })}
              />
            </div>
            <Button type="submit" variant="secondary">
              <FormattedMessage id="common.search" defaultMessage="Search" />
            </Button>
          </form>
        )}
      </div>
      {view === "library" ? (
        library.length ? (
          <ManagedTable
            catalogue={libraryColumns}
            layout={libraryLayout}
            onLayoutChange={setLibraryLayout}
            rows={library}
            rowKey={(row) => row.id}
          />
        ) : (
          <div className="flex flex-col items-center gap-3 rounded-card border border-border-default bg-raised px-6 py-16 text-center">
            <Files size={32} strokeWidth={1.5} className="text-muted" aria-hidden="true" />
            <h2 className="text-lg font-semibold">
              {query ? (
                <FormattedMessage
                  id="portal.autoDocs.noMatches"
                  defaultMessage="No matching templates"
                />
              ) : (
                <FormattedMessage
                  id="portal.autoDocs.emptyTitle"
                  defaultMessage="Your template library is on its way"
                />
              )}
            </h2>
            <p className="max-w-sm text-base text-muted">
              {query ? (
                <FormattedMessage
                  id="portal.autoDocs.trySearch"
                  defaultMessage="Try a different template name or description."
                />
              ) : (
                <FormattedMessage
                  id="portal.autoDocs.empty"
                  defaultMessage="No Auto-Docs are available to you yet."
                />
              )}
            </p>
          </div>
        )
      ) : generations.length ? (
        <ManagedTable
          catalogue={historyColumns}
          layout={historyLayout}
          onLayoutChange={setHistoryLayout}
          rows={generations}
          rowKey={(row) => row.id}
          foot={
            cursor ? (
              <Button variant="secondary" disabled={busy} onClick={() => void more()}>
                <FormattedMessage id="common.showMore" defaultMessage="Show more" />
              </Button>
            ) : undefined
          }
        />
      ) : (
        <div className="flex flex-col items-center gap-3 rounded-card border border-border-default bg-raised px-6 py-16 text-center">
          <FileText size={32} strokeWidth={1.5} className="text-muted" aria-hidden="true" />
          <h2 className="text-lg font-semibold">
            <FormattedMessage
              id="portal.autoDocs.noDocuments"
              defaultMessage="No documents generated yet"
            />
          </h2>
          <p className="max-w-sm text-base text-muted">
            <FormattedMessage
              id="portal.autoDocs.historyEmpty"
              defaultMessage="Your generated documents will appear here."
            />
          </p>
          <Button asChild variant="secondary">
            <Link to="/portal/auto-docs">
              <FormattedMessage
                id="portal.autoDocs.browseTemplates"
                defaultMessage="Browse templates"
              />
              <ArrowRight size={14} aria-hidden="true" />
            </Link>
          </Button>
        </div>
      )}
      {error && (
        <p role="alert" className="text-sm text-status-danger-fg">
          {error}
        </p>
      )}
    </PortalShell>
  );
}

export async function portalAutoDocGenerateLoader({ request, params }: LoaderFunctionArgs) {
  const user = await currentUserFor(request);
  if (!user) return redirect("/portal/login");
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
    previous: previous?.data?.generation,
  };
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
  const [initial] = useState(() => {
    const saved = toDraft(loaded.previous?.answers);
    return loaded.data?.form
      ? reconcile(saved, previousGenerationForm(loaded.previous), loaded.data.form)
      : { retained: saved, dropped: [] as PreviousAnswer[] };
  });
  const [draft, setDraft] = useState<Draft>(initial.retained);
  const [lastForm, setLastForm] = useState<ReturnType<typeof previousGenerationForm>>(
    loaded.data?.form ?? previousGenerationForm(loaded.previous),
  );
  const [previousAnswers, setPreviousAnswers] = useState<PreviousAnswer[]>(initial.dropped);
  const [acknowledgementId, setAcknowledgementId] = useState<string>();
  const [checked, setChecked] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(loaded.refusal);
  const heading = useRef<HTMLHeadingElement>(null);
  const navigate = useNavigate();
  const intl = useIntl();
  const signOut = useSignOut("/portal/login");
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
    const { retained, dropped } = reconcile(draft, lastForm, next.form);
    setDraft(retained);
    if (dropped.length) setPreviousAnswers((saved) => [...saved, ...dropped]);
    setLastForm(next.form);
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
        <Link
          className="flex w-fit items-center gap-1.5 text-sm font-medium text-muted hover:text-primary"
          to="/portal/auto-docs"
        >
          <ArrowLeft size={16} aria-hidden="true" />
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
                  <Label
                    htmlFor={`answer-${field.slug}`}
                    help={field.help}
                    helpId={`help-${field.slug}`}
                  >
                    {field.label}
                    {field.required && <span aria-hidden="true"> *</span>}
                  </Label>
                  <FormControl
                    field={field}
                    form={data.form!}
                    draft={draft[field.slug] ?? (field.fieldType === "multi_select" ? [] : "")}
                    onChange={(value) =>
                      setDraft((current) => ({ ...current, [field.slug]: value }))
                    }
                  />
                </div>
              ))}
            </fieldset>
            <div className="flex justify-end border-t border-border-default pt-4">
              <Button type="submit" disabled={busy}>
                <FormattedMessage id="autoDocs.generate" defaultMessage="Generate" />
                <ArrowRight size={14} aria-hidden="true" />
              </Button>
            </div>
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
                  <dd className="whitespace-pre-wrap text-muted">
                    {previousAnswerText(intl, answer)}
                  </dd>
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
  if (!user) return redirect("/portal/login");
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
  const signOut = useSignOut("/portal/login");
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
        <Link
          className="flex w-fit items-center gap-1.5 text-sm font-medium text-muted hover:text-primary"
          to="/portal/auto-docs"
        >
          <ArrowLeft size={16} aria-hidden="true" />
          <FormattedMessage id="portal.autoDocs.back" defaultMessage="Back to Auto-Docs" />
        </Link>
        <h1 className="text-2xl font-semibold">{title}</h1>
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
          <SettingsCard
            title={
              <span className="flex items-center gap-2">
                <FileText size={16} aria-hidden="true" />
                {data.generation.autoDocName}
              </span>
            }
          >
            <p role="status">
              <GenerationStatusPill state={data.generation.state} />
            </p>
            {data.generation.failure && (
              <p role="alert" className="text-status-danger-fg">
                {data.generation.failure.detail}
              </p>
            )}
            <GenerationContract generation={data.generation} portal />
            <GenerationDownload generation={data.generation} portal />
            <GenerationEmail generation={data.generation} />
            <GenerationFiling generation={data.generation} portal showHistory />
            {data.canGenerate && (
              <Link
                className="text-link hover:underline"
                to={`/portal/auto-docs/${loaded.id}/generate?from=${data.generation.id}`}
              >
                <FormattedMessage id="autoDocs.generateAgain" defaultMessage="Generate again" />
              </Link>
            )}
          </SettingsCard>
        )}
      </div>
    </PortalShell>
  );
}
