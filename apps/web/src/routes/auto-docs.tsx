// SPDX-License-Identifier: AGPL-3.0-only

/** ADO-001: the flat Auto-Docs destination belongs to Member+. */
import { AutoResizeTextarea } from "../components/auto-resize-textarea";
import { useState } from "react";
import { FormattedMessage, useIntl } from "react-intl";
import {
  Form,
  redirect,
  useLoaderData,
  useNavigate,
  useNavigation,
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
import { ManagedTable } from "../components/table/managed-table";
import { ColumnMenu } from "../components/table/column-menu";
import {
  AUTO_DOCS_CATALOGUE,
  autoDocTableRows,
  sortAutoDocs,
} from "../components/auto-docs/auto-docs-columns";
import { builtInLayout } from "../lib/list-views";
import { Input } from "../components/ui/input";
import { RecordFilterBar, type RecordFilter } from "../components/table/record-filter-bar";
import { filterQuery } from "../lib/record-filters";
import { Dialog, DialogContent, DialogTitle } from "../components/ui/dialog";

const FILTER_KEYS = ["state", "audience", "targetContractTypeId"] as const;

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
  const navigation = useNavigation();
  const [layout, setLayout] = useState(() => builtInLayout(AUTO_DOCS_CATALOGUE));
  const rows = sortAutoDocs(autoDocTableRows(autoDocs, options), layout.sort, intl.locale);
  const narrowed = !!(
    filters.q ||
    filters.state ||
    filters.audience ||
    filters.targetContractTypeId
  );
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const title = intl.formatMessage({ id: "nav.autoDocs", defaultMessage: "Auto-Docs" });
  const filterValues = {
    state: filters.state ?? "",
    audience: filters.audience ?? "",
    targetContractTypeId: filters.targetContractTypeId,
  };
  const definitions: RecordFilter[] = [
    {
      key: "state",
      label: intl.formatMessage({ id: "autoDocs.stateFilter", defaultMessage: "State" }),
      kind: "choices",
      multiple: false,
      choices: [
        {
          id: "",
          displayName: intl.formatMessage({
            id: "autoDocs.liveStates",
            defaultMessage: "Draft and published",
          }),
        },
        {
          id: "all",
          displayName: intl.formatMessage({
            id: "autoDocs.allStates",
            defaultMessage: "All states",
          }),
        },
        ...(["draft", "published", "archived"] as const).map((state) => ({
          id: state,
          displayName: intl.formatMessage(
            {
              id: "autoDocs.state",
              defaultMessage:
                "{state, select, draft {Draft} published {Published} other {Archived}}",
            },
            { state },
          ),
        })),
      ],
    },
    {
      key: "audience",
      label: intl.formatMessage({ id: "autoDocs.audience", defaultMessage: "Audience" }),
      kind: "choices",
      multiple: false,
      choices: (["legal_only", "selected", "everyone"] as const).map((audience) => ({
        id: audience,
        displayName: intl.formatMessage(
          {
            id: "autoDocs.audienceName",
            defaultMessage:
              "{audience, select, legal_only {Legal only} selected {Selected} other {Everyone}}",
          },
          { audience },
        ),
      })),
    },
    {
      key: "targetContractTypeId",
      label: intl.formatMessage({
        id: "autoDocs.targetType",
        defaultMessage: "Target Contract Type",
      }),
      kind: "choices",
      multiple: false,
      choices: [
        {
          id: "none",
          displayName: intl.formatMessage({
            id: "autoDocs.noTargetType",
            defaultMessage: "No target Contract Type",
          }),
        },
        ...options.contractTypes,
      ],
    },
  ];
  return (
    <AppShell user={user} onSignOut={() => void signOut()}>
      <PageTitle title={title} />
      <div className="w-full space-y-6">
        <h1 className="text-xl font-semibold">{title}</h1>
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex min-w-0 flex-1 basis-80 flex-wrap items-center gap-3">
            <Form method="get" className="flex min-w-0 max-w-full items-end gap-2">
              <Input
                key={filters.q}
                name="q"
                type="search"
                defaultValue={filters.q}
                aria-label={intl.formatMessage({
                  id: "autoDocs.search",
                  defaultMessage: "Search Auto-Docs",
                })}
              />
              {FILTER_KEYS.map((key) => (
                <input key={key} type="hidden" name={key} value={filterValues[key]} />
              ))}
              <Button
                type="submit"
                variant="secondary"
                size="sm"
                disabled={navigation.state !== "idle"}
              >
                <FormattedMessage id="common.search" defaultMessage="Search" />
              </Button>
            </Form>
            <RecordFilterBar
              definitions={definitions}
              values={filterValues}
              busy={navigation.state !== "idle"}
              error={null}
              onChange={(values) => {
                const search = new URLSearchParams(filterQuery(values, FILTER_KEYS));
                if (filters.q) search.set("q", filters.q);
                void navigate({ search: search.toString() }, { preventScrollReset: true });
              }}
            />
          </div>
          <div className="ms-auto flex shrink-0 items-center gap-2">
            <ColumnMenu
              catalogue={AUTO_DOCS_CATALOGUE}
              layout={layout}
              onLayoutChange={setLayout}
            />
            <Button onClick={() => setCreating(true)}>
              <FormattedMessage id="autoDocs.create" defaultMessage="Create Auto-Doc" />
            </Button>
          </div>
        </div>
        {rows.length ? (
          <ManagedTable
            catalogue={AUTO_DOCS_CATALOGUE}
            layout={layout}
            rows={rows}
            rowKey={(row) => row.id}
            onLayoutChange={setLayout}
            onRowActivate={(row) => void navigate(`/auto-docs/${encodeURIComponent(row.id)}`)}
            foot={
              <span className="text-sm text-muted">
                <FormattedMessage
                  id="autoDocs.listCount"
                  defaultMessage="{count, plural, one {# Auto-Doc} other {# Auto-Docs}}"
                  values={{ count: rows.length }}
                />
              </span>
            }
          />
        ) : (
          <div className="rounded-card border border-border-default bg-raised p-8 text-center text-muted">
            {narrowed ? (
              <>
                <p className="font-medium text-primary">
                  <FormattedMessage
                    id="autoDocs.empty.filtered.title"
                    defaultMessage="No Auto-Docs match your search and filters"
                  />
                </p>
                <p className="mt-2">
                  <FormattedMessage
                    id="autoDocs.empty.filtered.body"
                    defaultMessage="Try another search or clear a filter to widen the list."
                  />
                </p>
              </>
            ) : (
              <FormattedMessage
                id="autoDocs.empty"
                defaultMessage="Create an Auto-Doc to start with a Word template."
              />
            )}
          </div>
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
              <AutoResizeTextarea
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
