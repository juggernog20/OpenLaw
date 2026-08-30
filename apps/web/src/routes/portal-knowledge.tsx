// SPDX-License-Identifier: AGPL-3.0-only

/** The read-only portal view of one published Everyone Knowledge Item. */
import { Download, ChevronLeft, FileText } from "lucide-react";
import { FormattedMessage, useIntl } from "react-intl";
import { Link, redirect, useLoaderData, type LoaderFunctionArgs } from "react-router";
import { api } from "../lib/api";
import { currentUser, useSignOut } from "../lib/session";
import { KnowledgeMarkdown } from "../components/knowledge/markdown";
import { PageTitle } from "../components/page-title";
import { PortalShell } from "../components/portal/portal-shell";

export async function portalKnowledgeLoader({ params }: LoaderFunctionArgs) {
  const user = await currentUser();
  if (!user) return redirect("/portal/enter");
  const response = await api.GET("/api/v1/portal/knowledge/{id}", {
    params: { path: { id: params.id! } },
  });
  // Draft, Legal Only, archived, and unknown all answer one 404 (KNW-004
  // addendum), and none is a fault a requester can act on. A stale link
  // lands back on the portal home, as a stale request or form link does.
  if (response.response.status === 404) return redirect("/portal");
  if (!response.data) throw new Error("The Knowledge Item could not be read.");
  return { user, item: response.data.knowledgeItem };
}

export function PortalKnowledgePage() {
  const { user, item } = useLoaderData<typeof portalKnowledgeLoader>();
  const intl = useIntl();
  const signOut = useSignOut("/portal/enter");

  return (
    <PortalShell user={user} onSignOut={() => void signOut()}>
      <PageTitle title={item.title} />
      <Link
        to="/portal"
        className="inline-flex items-center gap-1 text-sm text-link hover:underline"
      >
        <ChevronLeft size={16} aria-hidden="true" />
        <FormattedMessage id="portal.knowledge.back" defaultMessage="Your requests" />
      </Link>
      <div className="flex flex-col gap-1.5">
        <h1 className="text-2xl font-semibold">{item.title}</h1>
      </div>
      {item.documents.length > 0 ? (
        <section
          aria-labelledby="portal-knowledge-files"
          className="overflow-hidden rounded-card border border-border-default bg-raised"
        >
          <header className="flex h-section-header items-center border-b border-border-default bg-section-header px-4">
            <h2 id="portal-knowledge-files" className="text-base font-semibold">
              <FormattedMessage id="portal.knowledge.files" defaultMessage="Files" />
            </h2>
          </header>
          <ul className="divide-y divide-border-muted">
            {item.documents.map((document) => (
              <li key={document.id} className="flex min-h-14 items-center gap-3 px-4 py-2.5">
                <FileText size={16} aria-hidden="true" className="shrink-0 text-muted" />
                <span className="min-w-0 flex-1 truncate text-sm font-medium">
                  {document.currentVersion.originalFilename}
                </span>
                <a
                  href={document.currentVersion.downloadUrl}
                  className="inline-flex items-center gap-1.5 rounded-button px-2 py-1.5 text-sm font-medium text-link hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-link"
                  aria-label={intl.formatMessage(
                    {
                      id: "portal.knowledge.downloadNamed",
                      defaultMessage: "Download {filename}",
                    },
                    { filename: document.currentVersion.originalFilename },
                  )}
                >
                  <Download size={16} aria-hidden="true" />
                  <FormattedMessage id="portal.knowledge.download" defaultMessage="Download" />
                </a>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      {item.body ? (
        <section
          aria-labelledby="portal-knowledge-guidance"
          className="overflow-hidden rounded-card border border-border-default bg-raised"
        >
          <header className="flex h-section-header items-center border-b border-border-default bg-section-header px-4">
            <h2 id="portal-knowledge-guidance" className="text-base font-semibold">
              <FormattedMessage id="portal.knowledge.guidance" defaultMessage="Guidance" />
            </h2>
          </header>
          <div className="p-4">
            <KnowledgeMarkdown source={item.body} />
          </div>
        </section>
      ) : null}
    </PortalShell>
  );
}
