// SPDX-License-Identifier: AGPL-3.0-only

/** The read-only portal view of one published Everyone Knowledge Item
 * (KNW-004): primary Document first, body last, no edit affordance. */
import { BookOpen, Download, FileText } from "lucide-react";
import { FormattedMessage, useIntl } from "react-intl";
import { redirect, useLoaderData, type LoaderFunctionArgs } from "react-router";
import { api } from "../lib/api";
import { currentUser, useSignOut } from "../lib/session";
import { KnowledgeMarkdown } from "../components/knowledge/markdown";
import { PageTitle } from "../components/page-title";
import { PortalBackLink } from "../components/portal/back-link";
import { PortalShell } from "../components/portal/portal-shell";
import { Button } from "../components/ui/button";

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
      <PortalBackLink>
        <FormattedMessage id="portal.knowledge.back" defaultMessage="Your requests" />
      </PortalBackLink>
      <div className="flex flex-col gap-2">
        <p className="flex items-center gap-1.5 text-sm font-medium text-muted">
          <BookOpen aria-hidden="true" className="size-4 shrink-0" />
          <FormattedMessage id="portal.knowledge.kicker" defaultMessage="From Legal" />
        </p>
        <h1 className="text-2xl font-semibold">{item.title}</h1>
      </div>
      {/* A reading page, so the cards stop at the settings card's width
          rather than running the whole portal column: guidance is prose,
          and prose past 45rem is a line the eye loses on the way back. */}
      <div className="flex w-full max-w-(--width-settings-card) flex-col gap-section-gap">
        {item.documents.length > 0 ? (
          <section
            aria-labelledby="portal-knowledge-files"
            className="overflow-hidden rounded-card border border-border-default bg-raised"
          >
            <header className="flex h-section-header items-center border-b border-border-default bg-section-header px-4">
              <h2 id="portal-knowledge-files" className="text-base font-semibold">
                <FormattedMessage id="portal.knowledge.files" defaultMessage="Documents" />
              </h2>
            </header>
            <ul className="divide-y divide-border-muted">
              {item.documents.map((document) => (
                <li key={document.id} className="flex items-center gap-3 px-4 py-3">
                  <span
                    aria-hidden="true"
                    className="flex size-8 shrink-0 items-center justify-center rounded-button bg-control text-muted"
                  >
                    <FileText size={16} />
                  </span>
                  <span className="min-w-0 flex-1 truncate text-base font-medium">
                    {document.currentVersion.originalFilename}
                  </span>
                  <Button asChild variant="secondary" size="sm">
                    <a
                      href={document.currentVersion.downloadUrl}
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
                  </Button>
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
            <div className="p-6 text-md">
              <KnowledgeMarkdown source={item.body} />
            </div>
          </section>
        ) : null}
      </div>
    </PortalShell>
  );
}
