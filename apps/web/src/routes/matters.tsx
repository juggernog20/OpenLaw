// SPDX-License-Identifier: AGPL-3.0-only

/** The Matters destination: reachable work, plus the M8 creation path for Member+. */
import { useState } from "react";
import { BriefcaseBusiness, Plus } from "lucide-react";
import { FormattedMessage, useIntl } from "react-intl";
import { Link, redirect, useLoaderData, useNavigate } from "react-router";
import { api } from "../lib/api";
import { authClient } from "../lib/auth-client";
import { matterPath, matterReference, type MatterRow } from "../lib/matters";
import { canReadMatters, isMemberPlus } from "../lib/roles";
import { currentUser, needsSetup } from "../lib/session";
import { CreateMatterDialog } from "../components/matters/create-matter-dialog";
import { PageTitle } from "../components/page-title";
import { AppShell } from "../components/shell/app-shell";
import { PageSubBar } from "../components/shell/page-subbar";
import { Button } from "../components/ui/button";

export async function mattersLoader() {
  const user = await currentUser();
  if (!user) return redirect((await needsSetup()) ? "/auth/setup" : "/auth/login");
  if (!canReadMatters(user.role)) return redirect("/");
  const canCreate = isMemberPlus(user.role);
  const [list, options, entities] = await Promise.all([
    api.GET("/api/v1/matters"),
    canCreate ? api.GET("/api/v1/matters/options") : undefined,
    canCreate ? api.GET("/api/v1/entities") : undefined,
  ]);
  if (!list.data || (canCreate && (!options?.data || !entities?.data))) {
    throw new Error("The matter list could not be read.");
  }
  return {
    user,
    canCreate,
    matters: list.data.matters,
    matterTypes: options?.data?.matterTypes ?? [],
    users: options?.data?.users ?? [],
    entities: entities?.data?.entities ?? [],
  };
}

export function MattersPage() {
  const loaded = useLoaderData<typeof mattersLoader>();
  const intl = useIntl();
  const navigate = useNavigate();
  const [rows] = useState<MatterRow[]>(loaded.matters);
  const [createOpen, setCreateOpen] = useState(false);
  async function signOut() {
    await authClient.signOut();
    void navigate("/auth/login", { replace: true });
  }
  const createButton = loaded.canCreate ? (
    <Button onClick={() => setCreateOpen(true)}>
      <Plus size={16} aria-hidden="true" />
      <FormattedMessage id="matters.new" defaultMessage="New matter" />
    </Button>
  ) : undefined;

  return (
    <AppShell
      user={loaded.user}
      onSignOut={() => void signOut()}
      subbar={
        <PageSubBar
          title={<FormattedMessage id="matters.title" defaultMessage="Matters" />}
          subtitle={
            <FormattedMessage
              id="matters.count"
              defaultMessage="{count, plural, one {# matter} other {# matters}}"
              values={{ count: rows.length }}
            />
          }
          primaryAction={createButton}
        />
      }
    >
      <PageTitle title={intl.formatMessage({ id: "matters.title", defaultMessage: "Matters" })} />
      {rows.length === 0 ? (
        <div className="flex flex-col items-center gap-4 rounded-card border border-border-default bg-raised px-6 py-16 text-center">
          <BriefcaseBusiness size={24} aria-hidden="true" className="text-subtle" />
          <div>
            <h2 className="text-md font-semibold">
              <FormattedMessage id="matters.empty.title" defaultMessage="No matters yet" />
            </h2>
            <p className="mt-1 max-w-md text-base text-muted">
              <FormattedMessage
                id="matters.empty.body"
                defaultMessage="Matters organize legal work that is not centered on a contract."
              />
            </p>
          </div>
          {createButton}
        </div>
      ) : (
        <div className="overflow-x-auto rounded-card border border-border-default bg-raised">
          <table className="w-full">
            <thead>
              <tr className="bg-section-header text-sm text-muted">
                <th className="px-4 py-2 text-start font-medium">
                  <FormattedMessage id="matters.column.reference" defaultMessage="Matter" />
                </th>
                <th className="px-4 py-2 text-start font-medium">
                  <FormattedMessage id="matters.column.title" defaultMessage="Title" />
                </th>
                <th className="px-4 py-2 text-start font-medium">
                  <FormattedMessage id="matters.column.status" defaultMessage="Status" />
                </th>
                <th className="px-4 py-2 text-start font-medium">
                  <FormattedMessage id="matters.column.manager" defaultMessage="Manager" />
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id} className="border-t border-border-default">
                  <td className="px-4 py-3">
                    <Link className="text-link hover:underline" to={matterPath(row.number)}>
                      {matterReference(intl, row.number)}
                    </Link>
                  </td>
                  <td className="px-4 py-3">{row.title}</td>
                  <td className="px-4 py-3">{row.statusName}</td>
                  <td className="px-4 py-3">
                    {row.manager?.displayName ??
                      intl.formatMessage({
                        id: "matters.unassigned",
                        defaultMessage: "Unassigned",
                      })}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {createOpen && (
        <CreateMatterDialog
          matterTypes={loaded.matterTypes}
          users={loaded.users}
          entities={loaded.entities.map((entity) => ({ id: entity.id, label: entity.legalName }))}
          onOpenChange={setCreateOpen}
          onCreated={(matter) => void navigate(matterPath(matter.number))}
        />
      )}
    </AppShell>
  );
}
