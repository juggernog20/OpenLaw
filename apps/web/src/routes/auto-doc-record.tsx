// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The Auto-Doc record (DES-087): a DES-032 record page whose Form
 * section is the builder, the template drawn beside the form that
 * fills it. ADO-002 through ADO-010 say what the page must let a
 * Member+ do; this file routes the four sections and owns the record's
 * own acts (rename, Publish, Unpublish, Archive, Restore).
 */
import { useEffect, useRef, useState } from "react";
import {
  Archive,
  ArchiveRestore,
  ChevronRight,
  FileText,
  Link2,
  MoreHorizontal,
  Send,
  Undo2,
} from "lucide-react";
import { FormattedMessage, useIntl } from "react-intl";
import {
  Link,
  redirect,
  useLoaderData,
  useNavigate,
  useParams,
  type LoaderFunctionArgs,
} from "react-router";
import {
  AUTO_DOC_RECORD_TABS,
  type AutoDocAnswer,
  type AutoDocGeneration,
  type AutoDocOptions,
  type AutoDocReading,
  type AutoDocRecordTab,
} from "../lib/auto-docs";
import { api } from "../lib/api";
import { useFieldCommit } from "../lib/field-commit";
import { isMemberPlus } from "../lib/roles";
import { requireUser, useSignOut } from "../lib/session";
import { previousComparableVersion, type ContractDocument } from "../lib/documents";
import { useActivityApplet } from "../components/activity/activity-applet";
import { RecordApplets } from "../components/shell/record-applets";
import { RecordTabs } from "../components/shell/record-tabs";
import { DocPanel } from "../components/documents/doc-panel";
import { AppShell } from "../components/shell/app-shell";
import { PageTitle } from "../components/page-title";
import { StatusNote } from "../components/status-note";
import { Button } from "../components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "../components/ui/dropdown-menu";
import { Input } from "../components/ui/input";
import { AboutCard, PublicationCard } from "../components/auto-docs/overview";
import { TemplatePane } from "../components/auto-docs/template-pane";
import { FormBuilder, type BuilderSelection } from "../components/auto-docs/form-builder";
import { SettingsCards } from "../components/auto-docs/settings-cards";
import { AutoDocGenerations } from "../components/auto-docs/generations";
import { PublishDialog } from "../components/auto-docs/publish-dialog";
import { UploadDialog } from "../components/auto-docs/upload-dialog";
import { CompareFormsDialog } from "../components/auto-docs/compare-dialog";
import { DeleteAutoDoc } from "../components/auto-docs/delete-auto-doc";
import { RecordNotFoundPage } from "./not-found";

const STATE_PILL: Record<AutoDocAnswer["autoDoc"]["state"], string> = {
  draft: "bg-status-neutral-bg text-status-neutral-fg",
  published: "bg-status-success-bg text-status-success-fg",
  archived: "bg-status-onhold-bg text-status-onhold-fg",
};

async function readReading(record: AutoDocAnswer): Promise<AutoDocReading | null> {
  const version = record.template?.versions[0];
  if (!version) return null;
  const answer = await api
    .GET("/api/v1/auto-docs/{id}/template/{versionId}/reading", {
      params: { path: { id: record.autoDoc.id, versionId: version.id } },
    })
    .catch(() => undefined);
  return answer?.data ?? null;
}

export async function autoDocRecordLoader({ params, request }: LoaderFunctionArgs) {
  const user = await requireUser();
  if (!isMemberPlus(user.role)) return redirect("/portal");
  const id = params.id!;
  // A section the record does not have redirects to the bare address
  // (DES-032 clause 2): the record exists and only the section does not.
  if (params.tab && !(AUTO_DOC_RECORD_TABS as readonly string[]).includes(params.tab))
    return redirect(`/auto-docs/${id}`);
  const [result, options, generations] = await Promise.all([
    api.GET("/api/v1/auto-docs/{id}", { params: { path: { id } } }),
    api.GET("/api/v1/auto-docs/options"),
    api.GET("/api/v1/auto-docs/{id}/generations", { params: { path: { id } } }),
  ]);
  if (result.response.status === 404) return { user, notFound: true as const };
  if (!result.data) throw new Error("The Auto-Doc could not be read.");
  if (!options.data) throw new Error("The Auto-Doc editor options could not be read.");
  if (!generations.data) throw new Error("The Auto-Doc Generations could not be read.");
  const query = new URL(request.url).searchParams;
  const versionId = query.get("version");
  let landing: { document: ContractDocument; versionId: string } | null = null;
  if (query.get("doc") === result.data.template?.id && versionId) {
    const paper = await api
      .GET("/api/v1/auto-docs/{id}/documents", { params: { path: { id } } })
      .catch(() => undefined);
    const document = paper?.data?.documents[0];
    if (document?.versions.some((version) => version.id === versionId))
      landing = { document, versionId };
  }
  return {
    user,
    record: result.data,
    options: options.data,
    generations: generations.data.generations,
    reading: await readReading(result.data),
    landing,
    find: query.get("find"),
  };
}

export function AutoDocRecordPage() {
  const loaded = useLoaderData<typeof autoDocRecordLoader>();
  const intl = useIntl();
  if (loaded.notFound)
    return (
      <RecordNotFoundPage
        user={loaded.user}
        title={intl.formatMessage({
          id: "autoDocs.notFound",
          defaultMessage: "Auto-Doc not found",
        })}
        body={
          <FormattedMessage
            id="autoDocs.notFoundBody"
            defaultMessage="This Auto-Doc does not exist, or you cannot open it."
          />
        }
        backTo="/auto-docs"
        backLabel={<FormattedMessage id="nav.autoDocs" defaultMessage="Auto-Docs" />}
      />
    );
  return (
    <AutoDocRecord
      key={loaded.record.autoDoc.id}
      initial={loaded.record}
      initialReading={loaded.reading}
      options={loaded.options}
      generations={loaded.generations}
      user={loaded.user}
      landing={loaded.landing}
      find={loaded.find}
    />
  );
}

function AutoDocRecord({
  initial,
  initialReading,
  options,
  generations,
  user,
  landing,
  find,
}: {
  initial: AutoDocAnswer;
  initialReading: AutoDocReading | null;
  options: AutoDocOptions;
  generations: AutoDocGeneration[];
  landing: { document: ContractDocument; versionId: string } | null;
  find: string | null;
  user: Awaited<ReturnType<typeof requireUser>>;
}) {
  const intl = useIntl();
  const navigate = useNavigate();
  const signOut = useSignOut("/auth/login");
  const tab = (useParams().tab ?? "overview") as AutoDocRecordTab;
  const [saved, setSaved] = useState(initial);
  const [reading, setReading] = useState(initialReading);
  const [selection, setSelection] = useState<BuilderSelection>(null);
  const [dialog, setDialog] = useState<"publish" | "upload" | "compare" | null>(null);
  const [reading_, setReadingDoc] = useState(landing);
  const [covered, setCovered] = useState(false);
  const [error, setError] = useState<string>();
  const [actionBusy, setActionBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const commits = useFieldCommit<"name">();
  const [renaming, setRenaming] = useState(false);
  const [nameDraft, setNameDraft] = useState(saved.autoDoc.name);
  const history = useActivityApplet({
    entityType: "auto_doc",
    entityId: initial.autoDoc.id,
    referenceNames: Object.fromEntries(
      options.contractTypes.map((type) => [type.id, type.displayName]),
    ),
  });
  const archived = saved.autoDoc.state === "archived";
  const published = saved.autoDoc.state === "published";

  // The reading follows the newest file version and the newest form
  // version: an upload changes the paragraphs, a form commit changes
  // which Placeholders have a field.
  const readingKey = `${saved.template?.versions[0]?.id ?? ""}:${saved.formVersion?.id ?? ""}`;
  const loadedKey = useRef(readingKey);
  useEffect(() => {
    if (loadedKey.current === readingKey) return;
    loadedKey.current = readingKey;
    let stale = false;
    void readReading(saved).then((next) => {
      if (!stale) setReading(next);
    });
    return () => {
      stale = true;
    };
  }, [readingKey, saved]);

  const openVersion = reading_?.document.versions.find(
    (version) => version.id === reading_.versionId,
  );
  async function openTemplate(versionId: string) {
    const answer = await api
      .GET("/api/v1/auto-docs/{id}/documents", { params: { path: { id: saved.autoDoc.id } } })
      .catch(() => undefined);
    const document = answer?.data?.documents[0];
    if (document?.versions.some((version) => version.id === versionId))
      setReadingDoc({ document, versionId });
    else
      setError(
        intl.formatMessage({
          id: "autoDocs.openFailed",
          defaultMessage: "Could not open this file version. Try again.",
        }),
      );
  }
  async function act(action: "unpublish" | "archive" | "restore") {
    setActionBusy(true);
    setError(undefined);
    const result = await api
      .POST(`/api/v1/auto-docs/{id}/${action}`, {
        params: { path: { id: saved.autoDoc.id } },
        body: {},
      })
      .catch(() => undefined);
    setActionBusy(false);
    if (result?.data) setSaved(result.data);
    else
      setError(
        result?.error?.detail ??
          intl.formatMessage({
            id: "autoDocs.lifecycleFailed",
            defaultMessage: "Could not change this Auto-Doc's state. Try again.",
          }),
      );
  }
  async function copyLink() {
    try {
      await navigator.clipboard.writeText(
        new URL(`/auto-docs/${saved.autoDoc.id}`, window.location.origin).toString(),
      );
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  }
  function commitName() {
    setRenaming(false);
    commits.commitText("name", {
      draft: nameDraft,
      saved: saved.autoDoc.name,
      required: true,
      reset: setNameDraft,
      send: (name) =>
        commits.commit(
          "name",
          () =>
            api.PATCH("/api/v1/auto-docs/{id}", {
              params: { path: { id: saved.autoDoc.id } },
              body: { name },
            }),
          setSaved,
        ),
    });
  }
  function selectFromTemplate(next: BuilderSelection) {
    setSelection(next);
    if (tab !== "form") void navigate(`/auto-docs/${saved.autoDoc.id}/form`);
  }

  const base = `/auto-docs/${saved.autoDoc.id}`;
  return (
    <AppShell
      user={user}
      onSignOut={() => void signOut()}
      flush
      recordScope={{ entityType: "auto_doc", entityId: saved.autoDoc.id }}
      subbar={
        <>
          <section
            aria-labelledby="page-title"
            className="flex h-(--height-subbar) items-center gap-2 border-b border-(--chrome-subbar-border) bg-canvas px-page-x"
          >
            <Link to="/auto-docs" className="text-link hover:underline">
              <FormattedMessage id="nav.autoDocs" defaultMessage="Auto-Docs" />
            </Link>
            <ChevronRight size={16} aria-hidden="true" className="text-subtle" />
            <FileText size={16} aria-hidden="true" className="shrink-0 text-muted" />
            {renaming ? (
              <Input
                id="auto-doc-name"
                autoFocus
                aria-label={intl.formatMessage({ id: "autoDocs.name", defaultMessage: "Name" })}
                className="h-7 w-80 max-w-full"
                maxLength={200}
                value={nameDraft}
                onChange={(event) => setNameDraft(event.target.value)}
                onBlur={commitName}
                onKeyDown={(event) => {
                  if (event.key === "Enter") commitName();
                  if (event.key === "Escape") {
                    setNameDraft(saved.autoDoc.name);
                    setRenaming(false);
                  }
                }}
              />
            ) : (
              <h1 id="page-title" className="truncate text-md font-semibold">
                {archived ? (
                  saved.autoDoc.name
                ) : (
                  <button
                    type="button"
                    onClick={() => {
                      setNameDraft(saved.autoDoc.name);
                      setRenaming(true);
                    }}
                    className="truncate rounded-chip text-start focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-link"
                    title={intl.formatMessage({ id: "autoDocs.rename", defaultMessage: "Rename" })}
                  >
                    {saved.autoDoc.name}
                  </button>
                )}
              </h1>
            )}
            <StatusNote status={commits.status.name ?? "idle"} detail={commits.error.name} />
            <span
              className={`inline-flex shrink-0 rounded-pill px-2 py-0.5 text-xs font-medium ${STATE_PILL[saved.autoDoc.state]}`}
            >
              <FormattedMessage
                id="autoDocs.state"
                defaultMessage="{state, select, draft {Draft} published {Published} other {Archived}}"
                values={{ state: saved.autoDoc.state }}
              />
            </span>
            <div className="ms-auto flex shrink-0 items-center gap-2">
              <StatusNote
                status={actionBusy ? "saving" : error ? "error" : "idle"}
                detail={error}
              />
              {copied && (
                <span role="status" className="text-xs text-muted">
                  <FormattedMessage id="autoDocs.linkCopied" defaultMessage="Link copied" />
                </span>
              )}
              {published ? (
                <Button asChild>
                  <Link to={`${base}/generate`}>
                    <FormattedMessage id="autoDocs.generate" defaultMessage="Generate" />
                  </Link>
                </Button>
              ) : (
                !archived && (
                  <Button
                    disabled={!saved.template?.versions.length || !saved.formVersion}
                    onClick={() => setDialog("publish")}
                  >
                    <FormattedMessage id="autoDocs.publish" defaultMessage="Publish" />
                  </Button>
                )
              )}
              {user.role === "administrator" && (
                <DeleteAutoDoc
                  autoDoc={saved.autoDoc}
                  disabled={actionBusy || commits.status.name === "saving"}
                />
              )}
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    disabled={actionBusy}
                    aria-label={intl.formatMessage({
                      id: "autoDocs.actions",
                      defaultMessage: "Auto-Doc actions",
                    })}
                  >
                    <MoreHorizontal size={16} aria-hidden="true" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem onSelect={() => void copyLink()}>
                    <Link2 size={16} aria-hidden="true" />
                    <FormattedMessage id="autoDocs.copyLink" defaultMessage="Copy link" />
                  </DropdownMenuItem>
                  {published && (
                    <>
                      <DropdownMenuItem onSelect={() => setDialog("publish")}>
                        <Send size={16} aria-hidden="true" />
                        <FormattedMessage
                          id="autoDocs.publishNewPair"
                          defaultMessage="Publish new pair"
                        />
                      </DropdownMenuItem>
                      <DropdownMenuItem onSelect={() => void act("unpublish")}>
                        <Undo2 size={16} aria-hidden="true" />
                        <FormattedMessage id="autoDocs.unpublish" defaultMessage="Unpublish" />
                      </DropdownMenuItem>
                    </>
                  )}
                  {archived ? (
                    <DropdownMenuItem onSelect={() => void act("restore")}>
                      <ArchiveRestore size={16} aria-hidden="true" />
                      <FormattedMessage id="autoDocs.restore" defaultMessage="Restore" />
                    </DropdownMenuItem>
                  ) : (
                    <DropdownMenuItem onSelect={() => void act("archive")}>
                      <Archive size={16} aria-hidden="true" />
                      <FormattedMessage id="autoDocs.archive" defaultMessage="Archive" />
                    </DropdownMenuItem>
                  )}
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </section>
          <RecordTabs
            label={intl.formatMessage({
              id: "autoDocs.sections",
              defaultMessage: "Auto-Doc sections",
            })}
            tabs={[
              {
                to: base,
                end: true,
                label: <FormattedMessage id="autoDocs.tab.overview" defaultMessage="Overview" />,
              },
              {
                to: `${base}/form`,
                label: <FormattedMessage id="autoDocs.tab.form" defaultMessage="Form" />,
                count: saved.orphanedFields.length,
                countLabel: intl.formatMessage(
                  {
                    id: "autoDocs.orphanCount",
                    defaultMessage: "{count, plural, one {# orphaned} other {# orphaned}}",
                  },
                  { count: saved.orphanedFields.length },
                ),
              },
              {
                to: `${base}/settings`,
                label: <FormattedMessage id="autoDocs.tab.settings" defaultMessage="Settings" />,
              },
              {
                to: `${base}/generations`,
                label: (
                  <FormattedMessage id="autoDocs.tab.generations" defaultMessage="Generations" />
                ),
                count: generations.length,
                countLabel: intl.formatMessage(
                  {
                    id: "autoDocs.generationCount",
                    defaultMessage: "{count, plural, one {# Generation} other {# Generations}}",
                  },
                  { count: generations.length },
                ),
              },
            ]}
          />
        </>
      }
    >
      <PageTitle title={saved.autoDoc.name} />
      <RecordApplets
        applets={[history]}
        contentCovered={covered && Boolean(reading_)}
        layer={
          reading_ && openVersion ? (
            <DocPanel
              documentId={reading_.document.id}
              title={reading_.document.title}
              version={openVersion}
              previousVersion={previousComparableVersion(reading_.document, openVersion)}
              initialFind={find}
              onClose={() => setReadingDoc(null)}
              onDockedChange={(docked) => setCovered(!docked)}
            />
          ) : undefined
        }
      >
        <div className="h-full w-full overflow-y-auto px-page-x py-page-y">
          {tab === "overview" && (
            <div className="flex flex-col gap-4">
              <AboutCard record={saved} onSaved={setSaved} />
              <PublicationCard record={saved} onPublish={() => setDialog("publish")} />
            </div>
          )}
          {tab === "form" && (
            <div className="flex flex-wrap items-start gap-4">
              <TemplatePane
                record={saved}
                reading={reading}
                selected={selection}
                onSelectField={(slug) => selectFromTemplate({ kind: "field", slug })}
                onSelectBlock={(name) => selectFromTemplate({ kind: "block", name })}
                onUpload={() => setDialog("upload")}
                onOpenVersion={(versionId) => void openTemplate(versionId)}
              />
              <FormBuilder
                record={saved}
                options={options}
                selected={selection}
                onSelect={setSelection}
                onSaved={setSaved}
                onCompare={() => setDialog("compare")}
              />
            </div>
          )}
          {tab === "settings" && (
            <SettingsCards record={saved} options={options} onSaved={setSaved} />
          )}
          {tab === "generations" && <AutoDocGenerations generations={generations} />}
        </div>
      </RecordApplets>
      {dialog === "publish" && (
        <PublishDialog record={saved} onSaved={setSaved} onClose={() => setDialog(null)} />
      )}
      {dialog === "upload" && (
        <UploadDialog record={saved} onSaved={setSaved} onClose={() => setDialog(null)} />
      )}
      {dialog === "compare" && (
        <CompareFormsDialog record={saved} onClose={() => setDialog(null)} />
      )}
    </AppShell>
  );
}
