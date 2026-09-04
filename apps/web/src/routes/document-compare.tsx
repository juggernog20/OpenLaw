// SPDX-License-Identifier: AGPL-3.0-only

/** The full-page reader for one durable Version comparison (M32/3, DOC-003). */
import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  GitCompareArrows,
  Minus,
  Plus,
  Replace,
  X,
} from "lucide-react";
import { defineMessage, FormattedMessage, useIntl, type IntlShape } from "react-intl";
import { Link, redirect, useLoaderData, useNavigate, type LoaderFunctionArgs } from "react-router";
import {
  DOCUMENT_DERIVATION_POLL_MS,
  documentComparisonPath,
  documentDownloadHref,
  exportDocumentComparison,
  readDocumentComparison,
  requestDocumentComparison,
  type DocumentComparison,
} from "../lib/documents";
import { canReadContracts, isMemberPlus, type Role } from "../lib/roles";
import { requireUser, useSignOut } from "../lib/session";
import { cn } from "../lib/utils";
import { PageTitle } from "../components/page-title";
import { AppShell } from "../components/shell/app-shell";
import { Button } from "../components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "../components/ui/popover";

const MAX_UNANSWERED_POLLS = 3;

/** Declared as descriptors so the i18n extractor sees both ids; a
 * conditional inside `formatMessage` is invisible to it. */
const MOVE_LABEL = {
  previous: defineMessage({ id: "documentCompare.previous", defaultMessage: "Previous change" }),
  next: defineMessage({ id: "documentCompare.next", defaultMessage: "Next change" }),
} as const;

export async function documentCompareLoader({ params, request }: LoaderFunctionArgs) {
  const user = await requireUser();
  if (!canReadContracts(user.role)) return redirect("/");
  const documentId = params.documentId;
  const query = new URL(request.url).searchParams;
  const fromVersionId = query.get("from")?.trim();
  const toVersionId = query.get("to")?.trim();
  if (!documentId || !fromVersionId || !toVersionId) {
    throw new Error("Choose two document versions to compare.");
  }
  const answer = await requestDocumentComparison(documentId, fromVersionId, toVersionId);
  // Knowledge Items have a Member+ record gate. Match that page's
  // Contributor bounce when the polymorphic Document seam says no.
  if (!answer.ok && answer.status === 403) return redirect("/");
  if (!answer.ok) throw new Error(answer.detail ?? "The comparison could not be read.");
  return { user, comparison: answer.comparison };
}

export function DocumentComparePage() {
  const loaded = useLoaderData<typeof documentCompareLoader>();
  return <DocumentCompareScreen key={loaded.comparison.id} />;
}

function DocumentCompareScreen() {
  const loaded = useLoaderData<typeof documentCompareLoader>();
  const [comparison, setComparison] = useState(loaded.comparison);
  const [pollFailure, setPollFailure] = useState<string | null>(null);
  const signOut = useSignOut("/auth/login");
  const intl = useIntl();

  useEffect(() => {
    if (comparison.state !== "pending") return;
    let live = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let unanswered = 0;
    const ask = async () => {
      const answer = await readDocumentComparison(comparison.documentId, comparison.id);
      if (!live) return;
      if (answer === "unreachable") {
        unanswered += 1;
        if (unanswered >= MAX_UNANSWERED_POLLS) {
          setPollFailure(
            intl.formatMessage({
              id: "documentCompare.pollFailed",
              defaultMessage: "The comparison status could not be read. Try opening it again.",
            }),
          );
        } else {
          timer = setTimeout(() => void ask(), DOCUMENT_DERIVATION_POLL_MS);
        }
        return;
      }
      unanswered = 0;
      setComparison(answer);
      if (answer.state === "pending") {
        timer = setTimeout(() => void ask(), DOCUMENT_DERIVATION_POLL_MS);
      }
    };
    timer = setTimeout(() => void ask(), DOCUMENT_DERIVATION_POLL_MS);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [comparison, intl]);

  const closeHref = ownerDocumentsPath(comparison);
  return (
    <AppShell
      user={loaded.user}
      onSignOut={() => void signOut()}
      flush
      subbar={
        <CompareSubbar comparison={comparison} closeHref={closeHref} userRole={loaded.user.role} />
      }
    >
      <PageTitle
        title={intl.formatMessage(
          { id: "documentCompare.pageTitle", defaultMessage: "Compare · {title}" },
          { title: comparison.document.title },
        )}
      />
      <div className="flex min-h-0 flex-1 p-6 @4xl/page:px-8">
        <ComparisonBody comparison={comparison} pollFailure={pollFailure} />
      </div>
    </AppShell>
  );
}

function ownerDocumentsPath(comparison: DocumentComparison): string {
  const owner = comparison.document.owner;
  switch (owner.kind) {
    case "contract":
      return `/contracts/${String(owner.number)}/documents`;
    case "matter":
      return `/matters/${String(owner.number)}/documents`;
    case "entity":
      return `/entities/${encodeURIComponent(owner.id)}/documents`;
    case "knowledge_item":
      return `/knowledge/${encodeURIComponent(owner.id)}`;
  }
}

function CompareSubbar({
  comparison,
  closeHref,
  userRole,
}: Readonly<{ comparison: DocumentComparison; closeHref: string; userRole: Role }>) {
  const intl = useIntl();
  const [exportedVersionId, setExportedVersionId] = useState(comparison.exportedVersionId);
  const [exporting, setExporting] = useState(false);
  const [exportFailure, setExportFailure] = useState<string | null>(null);
  const exportRedline = async () => {
    if (exporting) return;
    setExporting(true);
    setExportFailure(null);
    const answer = await exportDocumentComparison(comparison.documentId, comparison.id);
    setExporting(false);
    if (answer.ok) setExportedVersionId(answer.version.id);
    else {
      setExportFailure(
        answer.detail ??
          intl.formatMessage({
            id: "documentCompare.exportFailed",
            defaultMessage: "The redline could not be exported.",
          }),
      );
    }
  };
  return (
    <section
      aria-label={intl.formatMessage(
        { id: "documentCompare.header", defaultMessage: "Compare {title}" },
        { title: comparison.document.title },
      )}
      className="grid h-16 shrink-0 grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-4 border-b border-border-default bg-raised px-6 @4xl/shell:px-8"
    >
      <nav
        aria-label={intl.formatMessage({ id: "breadcrumb.label", defaultMessage: "Breadcrumb" })}
      >
        <ol className="flex min-w-0 items-center gap-1.5 text-sm text-muted">
          <li>
            <Link to="/documents" className="hover:text-primary hover:underline">
              <FormattedMessage id="nav.documents" defaultMessage="Documents" />
            </Link>
          </li>
          <li aria-hidden="true">/</li>
          <li className="min-w-0">
            <Link to={closeHref} className="block truncate hover:text-primary hover:underline">
              {comparison.document.owner.title}
            </Link>
          </li>
          <li aria-hidden="true">/</li>
          <li className="font-medium text-primary" aria-current="page">
            <FormattedMessage id="documentCompare.title" defaultMessage="Compare" />
          </li>
        </ol>
      </nav>
      <VersionPairControl comparison={comparison} />
      <div className="flex items-center justify-end gap-3">
        {comparison.document.archivedAt === null && comparison.mode === "text" ? (
          <p className="text-sm text-muted">
            <FormattedMessage
              id="documentCompare.exportNeedsWord"
              defaultMessage="Export needs two Word files."
            />
          </p>
        ) : comparison.document.archivedAt === null &&
          comparison.state === "ready" &&
          isMemberPlus(userRole) ? (
          exportedVersionId ? (
            <Button asChild>
              <Link to={ownerDocumentVersionPath(comparison, exportedVersionId)}>
                <FormattedMessage id="documentCompare.openRedline" defaultMessage="Open redline" />
              </Link>
            </Button>
          ) : (
            <Button type="button" disabled={exporting} onClick={() => void exportRedline()}>
              <FormattedMessage
                id="documentCompare.exportTrackChanges"
                defaultMessage="Export track changes"
              />
            </Button>
          )
        ) : null}
        {exportFailure && (
          <span role="alert" className="max-w-64 text-sm text-status-danger-fg">
            {exportFailure}
          </span>
        )}
        <Link
          to={closeHref}
          aria-label={intl.formatMessage({
            id: "documentCompare.close",
            defaultMessage: "Close comparison",
          })}
          className="flex size-8 items-center justify-center rounded-button text-muted hover:bg-control hover:text-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-link"
        >
          <X size={18} aria-hidden="true" />
        </Link>
      </div>
    </section>
  );
}

function ownerDocumentVersionPath(comparison: DocumentComparison, versionId: string): string {
  const query = new URLSearchParams({ doc: comparison.documentId, version: versionId });
  return `${ownerDocumentsPath(comparison)}?${query.toString()}`;
}

function VersionPairControl({ comparison }: Readonly<{ comparison: DocumentComparison }>) {
  const intl = useIntl();
  const navigate = useNavigate();
  const handSet = comparison.document.versions.filter(
    (version) => version.kind !== "generated_redline",
  );
  const older = comparison.fromVersion;
  const newer = comparison.toVersion;
  const versionLabel = (versionNumber: number) =>
    intl.formatMessage(
      { id: "documents.versionNumber", defaultMessage: "v{number}" },
      { number: versionNumber },
    );
  const openPair = (from: string, to: string) =>
    void navigate(documentComparisonPath(comparison.documentId, from, to));
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="flex items-center gap-1.5 rounded-pill border border-border-default bg-control px-3 py-1.5 text-sm font-semibold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-link"
        >
          <span>
            <FormattedMessage
              id="documentCompare.versionPair"
              defaultMessage="v{from} → v{to}"
              values={{ from: older.versionNumber, to: newer.versionNumber }}
            />
          </span>
          <ChevronDown size={14} aria-hidden="true" className="text-muted" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="center" className="w-72">
        <div className="grid grid-cols-[1fr_auto_1fr] items-end gap-2">
          <label className="flex min-w-0 flex-col gap-1 text-xs font-medium text-muted">
            <FormattedMessage id="documentCompare.older" defaultMessage="Older" />
            <select
              value={older.id}
              className="min-h-8 rounded-button border border-border-default bg-control px-2 text-base text-primary"
              onChange={(event) => openPair(event.target.value, newer.id)}
            >
              {handSet
                .filter((version) => version.versionNumber < newer.versionNumber)
                .map((version) => (
                  <option key={version.id} value={version.id}>
                    {versionLabel(version.versionNumber)}
                  </option>
                ))}
            </select>
          </label>
          <span aria-hidden="true" className="pb-1.5 text-muted">
            →
          </span>
          <label className="flex min-w-0 flex-col gap-1 text-xs font-medium text-muted">
            <FormattedMessage id="documentCompare.newer" defaultMessage="Newer" />
            <select
              value={newer.id}
              className="min-h-8 rounded-button border border-border-default bg-control px-2 text-base text-primary"
              onChange={(event) => openPair(older.id, event.target.value)}
            >
              {handSet
                .filter((version) => version.versionNumber > older.versionNumber)
                .map((version) => (
                  <option key={version.id} value={version.id}>
                    {versionLabel(version.versionNumber)}
                  </option>
                ))}
            </select>
          </label>
        </div>
      </PopoverContent>
    </Popover>
  );
}

function ComparisonBody({
  comparison,
  pollFailure,
}: Readonly<{ comparison: DocumentComparison; pollFailure: string | null }>) {
  if (pollFailure) return <FailedCard comparison={comparison} reason={pollFailure} />;
  if (comparison.state === "pending") {
    return (
      <StateCard icon={<GitCompareArrows size={24} aria-hidden="true" />} status>
        <h1 className="text-lg font-semibold">
          <FormattedMessage
            id="documentCompare.preparing.title"
            defaultMessage="Preparing comparison"
          />
        </h1>
        <p className="text-base text-muted">
          <FormattedMessage
            id="documentCompare.preparing.body"
            defaultMessage="Comparing both versions. This page will update when it is ready."
          />
        </p>
      </StateCard>
    );
  }
  if (comparison.state === "failed") {
    return <FailedCard comparison={comparison} reason={comparison.failure ?? undefined} />;
  }
  if (!comparison.changeModel || comparison.changeModel.changes.length === 0) {
    return (
      <StateCard icon={<GitCompareArrows size={24} aria-hidden="true" />}>
        <h1 className="text-lg font-semibold">
          <FormattedMessage id="documentCompare.noChanges.title" defaultMessage="No changes" />
        </h1>
        <p className="text-base text-muted">
          <FormattedMessage
            id="documentCompare.noChanges.body"
            defaultMessage="These versions contain the same text."
          />
        </p>
      </StateCard>
    );
  }
  return <ReadyComparison comparison={comparison} />;
}

function StateCard({
  icon,
  status = false,
  children,
}: Readonly<{ icon: ReactNode; status?: boolean; children: ReactNode }>) {
  return (
    <section
      role={status ? "status" : undefined}
      className="m-auto flex max-w-md flex-col items-center gap-3 rounded-card border border-border-default bg-raised px-8 py-10 text-center"
    >
      <span className="text-muted">{icon}</span>
      {children}
    </section>
  );
}

function FailedCard({
  comparison,
  reason,
}: Readonly<{ comparison: DocumentComparison; reason?: string }>) {
  return (
    <StateCard icon={<GitCompareArrows size={24} aria-hidden="true" />}>
      <h1 className="text-lg font-semibold">
        <FormattedMessage id="documentCompare.failed.title" defaultMessage="Comparison failed" />
      </h1>
      <p className="text-base text-muted">
        {reason ?? (
          <FormattedMessage
            id="documentCompare.failed.body"
            defaultMessage="These versions could not be compared."
          />
        )}
      </p>
      <div className="flex flex-wrap justify-center gap-2">
        {[comparison.fromVersion, comparison.toVersion].map((version) => (
          <a
            key={version.id}
            href={documentDownloadHref(comparison.documentId, version.id)}
            download={version.originalFilename}
            className="rounded-button border border-border-default bg-control px-3 py-1.5 text-base font-semibold hover:bg-section-header focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-link"
          >
            <FormattedMessage
              id="documentCompare.downloadOperand"
              defaultMessage="Download {filename}"
              values={{ filename: version.originalFilename }}
            />
          </a>
        ))}
      </div>
    </StateCard>
  );
}

const CHANGE_STYLE = {
  inserted: {
    icon: Plus,
    pair: "bg-status-success-bg text-status-success-fg",
  },
  deleted: {
    icon: Minus,
    pair: "bg-status-danger-bg text-status-danger-fg",
  },
  replaced: {
    icon: Replace,
    pair: "bg-status-warning-bg text-status-warning-fg",
  },
} as const;

function ReadyComparison({ comparison }: Readonly<{ comparison: DocumentComparison }>) {
  const model = comparison.changeModel!;
  const intl = useIntl();
  const [current, setCurrent] = useState(0);
  const paragraphRefs = useRef(new Map<number, HTMLElement>());
  const changes = model.changes;

  const moveTo = (index: number) => {
    const normalized = (index + changes.length) % changes.length;
    setCurrent(normalized);
    paragraphRefs.current.get(changes[normalized]!.paragraphIndex)?.scrollIntoView({
      behavior: "smooth",
      block: "center",
    });
  };

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-6 @4xl/page:flex-row">
      <aside
        aria-labelledby="document-compare-changes"
        className="flex max-h-72 w-full shrink-0 flex-col overflow-hidden rounded-card border border-border-default bg-raised @4xl/page:max-h-none @4xl/page:w-80"
      >
        <header className="flex h-11 shrink-0 items-center justify-between border-b border-border-default bg-section-header px-3.5">
          <div className="flex items-center gap-2">
            <h1 id="document-compare-changes" className="text-base font-semibold">
              <FormattedMessage id="documentCompare.changes" defaultMessage="Changes" />
            </h1>
            <span
              aria-label={intl.formatMessage(
                {
                  id: "documentCompare.changeCount",
                  defaultMessage: "{count, plural, one {# change} other {# changes}}",
                },
                { count: comparison.changeCount ?? changes.length },
              )}
              className="rounded-chip bg-badge-count-bg px-1.5 py-px text-xs font-medium text-badge-count-fg"
            >
              {comparison.changeCount ?? changes.length}
            </span>
          </div>
          <div className="flex items-center gap-1">
            <ChangeMoveButton direction="previous" onPress={() => moveTo(current - 1)} />
            <ChangeMoveButton direction="next" onPress={() => moveTo(current + 1)} />
          </div>
        </header>
        <div className="min-h-0 overflow-y-auto">
          {changes.map((change, index) => {
            const style = CHANGE_STYLE[change.kind];
            const Icon = style.icon;
            const kind = changeKindLabel(intl, change.kind);
            return (
              <button
                key={change.id}
                type="button"
                aria-current={index === current ? "true" : undefined}
                aria-label={intl.formatMessage(
                  { id: "documentCompare.changeName", defaultMessage: "{ref}, {kind}" },
                  { ref: change.ref, kind },
                )}
                onClick={() => moveTo(index)}
                className={cn(
                  "flex w-full gap-2.5 border-b border-border-muted px-3.5 py-2.5 text-start hover:bg-canvas focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-link",
                  index === current && "bg-control",
                )}
              >
                <span
                  className={cn(
                    "mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-button",
                    style.pair,
                  )}
                >
                  <Icon size={12} aria-hidden="true" />
                </span>
                <span className="min-w-0">
                  <span className="block text-xs font-semibold text-muted">{change.ref}</span>
                  <span className="mt-0.5 block text-sm text-primary">{change.excerpt}</span>
                </span>
              </button>
            );
          })}
        </div>
      </aside>
      <section
        aria-label={intl.formatMessage({
          id: "documentCompare.documentRegion",
          defaultMessage: "Compared document",
        })}
        className="flex min-h-(--height-compare-card) min-w-0 flex-1 flex-col overflow-hidden rounded-card border border-border-default bg-raised"
      >
        <header className="flex min-h-10 shrink-0 items-center gap-2 border-b border-border-default bg-section-header px-3 text-sm text-muted">
          <span className="min-w-0 truncate">{comparison.fromVersion.originalFilename}</span>
          <span aria-hidden="true">→</span>
          <span className="min-w-0 truncate">{comparison.toVersion.originalFilename}</span>
        </header>
        {comparison.mode === "text" && (
          <p className="shrink-0 border-b border-border-muted px-4 py-2 text-sm text-muted">
            <FormattedMessage
              id="documentCompare.textMode"
              defaultMessage="This comparison was built from extracted text, so formatting is not shown."
            />
          </p>
        )}
        <div className="min-h-0 flex-1 overflow-auto bg-canvas p-4 @4xl/page:p-6">
          <article className="mx-auto min-h-full w-full max-w-(--width-compare-page) bg-raised px-8 py-10 font-serif text-base leading-(--leading-compare-document) text-primary shadow-sm @2xl/page:px-compare-page-x @2xl/page:py-11">
            {model.paragraphs.map((paragraph) => {
              const selected = changes[current]?.paragraphIndex === paragraph.index;
              const Tag = paragraph.style === "heading" ? "h2" : "p";
              return (
                <Tag
                  key={paragraph.index}
                  ref={(node) => {
                    if (node) paragraphRefs.current.set(paragraph.index, node);
                    else paragraphRefs.current.delete(paragraph.index);
                  }}
                  data-paragraph-index={paragraph.index}
                  className={cn(
                    "mb-3.5 border-s-2 border-transparent ps-3",
                    paragraph.style === "heading" && "font-bold",
                    selected && "border-accent",
                  )}
                >
                  {paragraph.label && <span className="me-1 font-bold">{paragraph.label}</span>}
                  {paragraph.runs.map((run, index) => (
                    <ChangedRun key={index} change={run.change}>
                      {run.text}
                    </ChangedRun>
                  ))}
                </Tag>
              );
            })}
          </article>
        </div>
      </section>
    </div>
  );
}

function ChangeMoveButton({
  direction,
  onPress,
}: Readonly<{ direction: "previous" | "next"; onPress: () => void }>) {
  const intl = useIntl();
  const label = intl.formatMessage(MOVE_LABEL[direction]);
  const Icon = direction === "previous" ? ChevronLeft : ChevronRight;
  return (
    <button
      type="button"
      onClick={onPress}
      aria-label={label}
      className="flex size-7 items-center justify-center rounded-button text-muted hover:bg-control hover:text-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-link"
    >
      <Icon size={16} aria-hidden="true" />
    </button>
  );
}

function changeKindLabel(intl: IntlShape, kind: "inserted" | "deleted" | "replaced"): string {
  return intl.formatMessage(
    {
      id: "documentCompare.changeKind",
      defaultMessage:
        "{kind, select, inserted {Inserted} deleted {Deleted} replaced {Replaced} other {Changed}}",
    },
    { kind },
  );
}

function ChangedRun({
  change,
  children,
}: Readonly<{
  change: "unchanged" | "inserted" | "deleted";
  children: string;
}>) {
  if (change === "unchanged") return children;
  return (
    <span
      className={
        change === "inserted"
          ? "text-status-success-fg underline"
          : "text-status-danger-fg line-through"
      }
    >
      <span className="sr-only">
        {change === "inserted" ? (
          <FormattedMessage id="documentCompare.inserted" defaultMessage="Inserted:" />
        ) : (
          <FormattedMessage id="documentCompare.deleted" defaultMessage="Deleted:" />
        )}{" "}
      </span>
      {children}
    </span>
  );
}
