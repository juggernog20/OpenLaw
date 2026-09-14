// SPDX-License-Identifier: AGPL-3.0-only

/** ADO-001: the flat Auto-Docs destination belongs to Member+. */
import { useState } from "react";
import { FormattedMessage, useIntl } from "react-intl";
import {
  Form,
  Link,
  redirect,
  useLoaderData,
  useNavigate,
  type LoaderFunctionArgs,
} from "react-router";
import { api } from "../lib/api";
import { autoDocListStates, autoDocAudiences } from "../lib/auto-docs";
import { isMemberPlus } from "../lib/roles";
import { requireUser, useSignOut } from "../lib/session";
import { CONTROL_CLASS, TEXTAREA_CLASS } from "../lib/form-controls";
import { AppShell } from "../components/shell/app-shell";
import { PageTitle } from "../components/page-title";
import { Button } from "../components/ui/button";
import { Dialog, DialogContent, DialogTitle } from "../components/ui/dialog";

export async function autoDocsLoader({ request }: LoaderFunctionArgs) {
  const user = await requireUser();
  if (!isMemberPlus(user.role)) return redirect("/portal");
  const search = new URL(request.url).searchParams;
  const state = autoDocListStates.safeParse(search.get("state"));
  const audience = autoDocAudiences.safeParse(search.get("audience"));
  const filters = {
    q: search.get("q") ?? "",
    state: state.success ? state.data : undefined,
    audience: audience.success ? audience.data : undefined,
    targetContractTypeId: search.get("targetContractTypeId") ?? "",
  };
  const [result, options] = await Promise.all([
    api.GET("/api/v1/auto-docs", {
      params: {
        query: {
          q: filters.q || undefined,
          state: filters.state || undefined,
          audience: filters.audience || undefined,
          targetContractTypeId: filters.targetContractTypeId || undefined,
        },
      },
    }),
    api.GET("/api/v1/auto-docs/options"),
  ]);
  if (!options.data) throw new Error("The Auto-Doc list options could not be read.");
  if (!result.data) throw new Error("Auto-Docs could not be read.");
  return { user, ...result.data, options: options.data, filters };
}

export function AutoDocsPage() {
  const { user, autoDocs, options, filters } = useLoaderData<typeof autoDocsLoader>();
  const intl = useIntl();
  const signOut = useSignOut("/auth/login");
  const navigate = useNavigate();
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const title = intl.formatMessage({ id: "nav.autoDocs", defaultMessage: "Auto-Docs" });
  return (
    <AppShell user={user} onSignOut={() => void signOut()}>
      <PageTitle title={title} />
      <div className="mx-auto w-full max-w-5xl space-y-6">
        <div className="flex items-center justify-between gap-4">
          <h1 className="text-xl font-semibold">{title}</h1>
          <Button onClick={() => setCreating(true)}>
            <FormattedMessage id="autoDocs.create" defaultMessage="Create Auto-Doc" />
          </Button>
        </div>
        <Form method="get" key={JSON.stringify(filters)} className="flex flex-wrap items-end gap-3">
          <label className="block space-y-1">
            <span>
              <FormattedMessage id="autoDocs.search" defaultMessage="Search Auto-Docs" />
            </span>
            <input name="q" type="search" className={CONTROL_CLASS} defaultValue={filters.q} />
          </label>
          <label className="block space-y-1">
            <span>
              <FormattedMessage id="autoDocs.stateFilter" defaultMessage="State" />
            </span>
            <select name="state" className={CONTROL_CLASS} defaultValue={filters.state}>
              <option value="">
                {intl.formatMessage({
                  id: "autoDocs.liveStates",
                  defaultMessage: "Draft and published",
                })}
              </option>
              <option value="all">
                {intl.formatMessage({ id: "autoDocs.allStates", defaultMessage: "All states" })}
              </option>
              {(["draft", "published", "archived"] as const).map((state) => (
                <option key={state} value={state}>
                  {intl.formatMessage(
                    {
                      id: "autoDocs.state",
                      defaultMessage:
                        "{state, select, draft {Draft} published {Published} other {Archived}}",
                    },
                    { state },
                  )}
                </option>
              ))}
            </select>
          </label>
          <label className="block space-y-1">
            <span>
              <FormattedMessage id="autoDocs.audience" defaultMessage="Audience" />
            </span>
            <select name="audience" className={CONTROL_CLASS} defaultValue={filters.audience}>
              <option value="">
                {intl.formatMessage({
                  id: "autoDocs.allAudiences",
                  defaultMessage: "All audiences",
                })}
              </option>
              {(["legal_only", "selected", "everyone"] as const).map((audience) => (
                <option key={audience} value={audience}>
                  {intl.formatMessage(
                    {
                      id: "autoDocs.audienceName",
                      defaultMessage:
                        "{audience, select, legal_only {Legal only} selected {Selected} other {Everyone}}",
                    },
                    { audience },
                  )}
                </option>
              ))}
            </select>
          </label>
          <label className="block space-y-1">
            <span>
              <FormattedMessage id="autoDocs.targetType" defaultMessage="Target Contract Type" />
            </span>
            <select
              name="targetContractTypeId"
              className={CONTROL_CLASS}
              defaultValue={filters.targetContractTypeId}
            >
              <option value="">
                {intl.formatMessage({
                  id: "autoDocs.allTargetTypes",
                  defaultMessage: "All target Contract Types",
                })}
              </option>
              <option value="none">
                {intl.formatMessage({
                  id: "autoDocs.noTargetType",
                  defaultMessage: "No target Contract Type",
                })}
              </option>
              {options.contractTypes.map((type) => (
                <option key={type.id} value={type.id}>
                  {type.displayName}
                </option>
              ))}
            </select>
          </label>
          <Button type="submit" variant="secondary">
            <FormattedMessage id="autoDocs.applyFilters" defaultMessage="Apply filters" />
          </Button>
        </Form>
        <ul className="divide-y divide-border-default rounded-card border border-border-default bg-raised">
          {autoDocs.map((row) => (
            <li key={row.id} className="flex items-center justify-between gap-4 p-4">
              <div>
                <Link
                  className="font-medium text-link hover:underline"
                  to={`/auto-docs/${encodeURIComponent(row.id)}`}
                >
                  {row.name}
                </Link>
                {row.description && <p className="mt-1 text-sm text-muted">{row.description}</p>}
              </div>
              <span className="text-sm text-muted">
                <FormattedMessage
                  id="autoDocs.state"
                  defaultMessage="{state, select, draft {Draft} published {Published} other {Archived}}"
                  values={{ state: row.state }}
                />
              </span>
            </li>
          ))}
        </ul>
        {!autoDocs.length && (
          <p className="text-muted">
            <FormattedMessage
              id="autoDocs.empty"
              defaultMessage="Create an Auto-Doc to start with a Word template."
            />
          </p>
        )}
      </div>
      <Dialog
        open={creating}
        onOpenChange={(open) => {
          if (!busy) setCreating(open);
        }}
      >
        <DialogContent aria-describedby={undefined}>
          <DialogTitle>
            <FormattedMessage id="autoDocs.create" defaultMessage="Create Auto-Doc" />
          </DialogTitle>
          <form
            className="space-y-4"
            onSubmit={(event) => {
              event.preventDefault();
              setBusy(true);
              setError(undefined);
              void api
                .POST("/api/v1/auto-docs", { body: { name, description: description || null } })
                .catch(() => undefined)
                .then((result) => {
                  setBusy(false);
                  if (result?.data)
                    void navigate(`/auto-docs/${encodeURIComponent(result.data.autoDoc.id)}`);
                  else
                    setError(
                      result?.error?.detail ??
                        intl.formatMessage({
                          id: "autoDocs.createFailed",
                          defaultMessage: "Could not create the Auto-Doc. Please try again.",
                        }),
                    );
                });
            }}
          >
            <label className="block space-y-1">
              <span>
                <FormattedMessage id="autoDocs.name" defaultMessage="Name" />
              </span>
              <input
                autoFocus
                required
                maxLength={200}
                className={CONTROL_CLASS}
                value={name}
                onChange={(event) => setName(event.target.value)}
              />
            </label>
            <label className="block space-y-1">
              <span>
                <FormattedMessage id="autoDocs.description" defaultMessage="Description" />
              </span>
              <textarea
                maxLength={4000}
                className={TEXTAREA_CLASS}
                value={description}
                onChange={(event) => setDescription(event.target.value)}
              />
            </label>
            {error && (
              <p role="alert" className="text-sm text-status-danger-fg">
                {error}
              </p>
            )}
            <Button type="submit" disabled={busy}>
              <FormattedMessage id="autoDocs.createSubmit" defaultMessage="Create" />
            </Button>
          </form>
        </DialogContent>
      </Dialog>
    </AppShell>
  );
}
