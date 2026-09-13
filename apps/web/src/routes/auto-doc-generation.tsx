// SPDX-License-Identifier: AGPL-3.0-only

/** ADO-007: confirmation and re-download use the Generation's frozen output. */
import { useEffect } from "react";
import { FormattedMessage, useIntl } from "react-intl";
import {
  Link,
  redirect,
  useLoaderData,
  useRevalidator,
  type LoaderFunctionArgs,
} from "react-router";
import { formatLongDateTime } from "../lib/format";
import { api } from "../lib/api";
import { isMemberPlus } from "../lib/roles";
import { requireUser, useSignOut } from "../lib/session";
import { AppShell } from "../components/shell/app-shell";
import { PageTitle } from "../components/page-title";
import {
  GenerationDownload,
  GenerationPair,
  GenerationState,
} from "../components/auto-docs/generations";

export async function autoDocGenerationLoader({ params }: LoaderFunctionArgs) {
  const user = await requireUser();
  if (!isMemberPlus(user.role)) return redirect("/portal");
  const result = await api.GET("/api/v1/auto-docs/{id}/generations/{generationId}", {
    params: { path: { id: params.id!, generationId: params.generationId! } },
  });
  return {
    user,
    id: params.id!,
    generation: result.data?.generation,
    refusal: result.error?.detail,
  };
}
export function AutoDocGenerationPage() {
  const { user, id, generation, refusal } = useLoaderData<typeof autoDocGenerationLoader>();
  const intl = useIntl();
  const signOut = useSignOut("/auth/login");
  const { revalidate } = useRevalidator();
  useEffect(() => {
    if (generation?.state !== "pending") return;
    const timer = setInterval(() => void revalidate(), 1500);
    return () => clearInterval(timer);
  }, [generation?.state, revalidate]);
  const title = intl.formatMessage({ id: "autoDocs.generation", defaultMessage: "Generation" });
  return (
    <AppShell user={user} onSignOut={() => void signOut()}>
      <PageTitle title={title} />
      <div className="mx-auto w-full max-w-2xl space-y-6">
        <Link className="text-link hover:underline" to={`/auto-docs/${id}`}>
          <FormattedMessage id="autoDocs.backToAutoDoc" defaultMessage="Back to Auto-Doc" />
        </Link>
        <h1 className="text-xl font-semibold">{title}</h1>
        {refusal && (
          <p role="alert" className="text-status-danger-fg">
            {refusal}
          </p>
        )}
        {generation && (
          <section className="space-y-4 rounded-card border border-border-default bg-raised p-6">
            <h2 className="text-lg font-semibold">{generation.autoDocName}</h2>
            <p role="status">
              <GenerationState state={generation.state} />
            </p>
            <p className="text-sm text-muted">
              {generation.person.displayName} ·{" "}
              <time
                dateTime={generation.createdAt}
                title={formatLongDateTime(generation.createdAt)}
              >
                {formatLongDateTime(generation.createdAt)}
              </time>
            </p>
            <p className="text-sm text-muted">
              <GenerationPair generation={generation} />
            </p>
            {generation.failure && (
              <p role="alert" className="text-status-danger-fg">
                {generation.failure.detail}
              </p>
            )}
            <GenerationDownload generation={generation} />
          </section>
        )}
      </div>
    </AppShell>
  );
}
