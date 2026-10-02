// SPDX-License-Identifier: AGPL-3.0-only

/** The Portal viewer's own Tasks across the records they reach (MTR-005 addendum, 2026-10-02). */
import { FormattedMessage, useIntl } from "react-intl";
import { redirect, useLoaderData, type LoaderFunctionArgs } from "react-router";
import { currentUserFor, useSignOut } from "../lib/session";
import { readPortalTasks } from "../lib/portal-tasks";
import { PortalShell } from "../components/portal/portal-shell";
import { PortalTasksCard } from "../components/portal/tasks-card";
import { PageTitle } from "../components/page-title";

export async function portalTasksLoader({ request }: LoaderFunctionArgs) {
  const user = await currentUserFor(request);
  if (!user) return redirect("/portal/login");
  const tasks = await readPortalTasks();
  if (!tasks) throw new Error("Your Tasks could not be read.");
  return { user, tasks };
}

export function PortalTasksPage() {
  const { user, tasks } = useLoaderData<typeof portalTasksLoader>();
  const intl = useIntl();
  const signOut = useSignOut("/portal/login");
  return (
    <PortalShell user={user} onSignOut={() => void signOut()}>
      <PageTitle
        title={intl.formatMessage({ id: "portal.tasks.title", defaultMessage: "Your Tasks" })}
      />
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold">
          <FormattedMessage id="portal.tasks.title" defaultMessage="Your Tasks" />
        </h1>
        <p className="text-base text-muted">
          <FormattedMessage
            id="portal.tasks.description"
            defaultMessage="Legal assigned these Tasks to you. Mark a Task done when you finish it."
          />
        </p>
      </div>
      <PortalTasksCard initial={tasks} />
    </PortalShell>
  );
}
