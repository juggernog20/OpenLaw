// SPDX-License-Identifier: AGPL-3.0-only

import { Link, redirect, useLoaderData, type LoaderFunctionArgs } from "react-router";
import { FormattedMessage, useIntl } from "react-intl";
import { api } from "../lib/api";
import { currentUser, useSignOut } from "../lib/session";
import { matterReference } from "../lib/matters";
import { loadPortalWork } from "../lib/portal-records";
import { PortalShell } from "../components/portal/portal-shell";
import { PortalRecordWork } from "../components/portal/record-work";
import { PageTitle } from "../components/page-title";

export async function portalMatterLoader({ params }: LoaderFunctionArgs) {
  const user = await currentUser();
  if (!user) return redirect("/portal/enter");
  const number = Number(params.number);
  if (!Number.isSafeInteger(number) || number < 1) return { user, matter: null };
  const result = await api.GET("/api/v1/portal/matters/{number}", { params: { path: { number } } });
  if (result.response.status === 404) return { user, matter: null };
  if (!result.data) throw new Error("This Matter could not be read.");
  return { user, matter: result.data.matter, recordWork: await loadPortalWork("matter", number) };
}

export function PortalMatterPage() {
  const { user, matter, recordWork } = useLoaderData<typeof portalMatterLoader>();
  const intl = useIntl();
  const signOut = useSignOut("/portal/enter");
  const title =
    matter?.title ??
    intl.formatMessage({ id: "portal.matter.notFound", defaultMessage: "Matter not found" });
  const unset = intl.formatMessage({
    id: "portal.contract.notRecorded",
    defaultMessage: "Not recorded",
  });
  return (
    <PortalShell
      user={user}
      onSignOut={() => void signOut()}
      recordScope={recordWork ? { entityType: "matter", entityId: recordWork.work.id } : undefined}
    >
      <PageTitle title={title} />
      <Link className="text-base text-link" to="/portal/matters">
        <FormattedMessage id="portal.matters.title" defaultMessage="Your Matters" />
      </Link>
      <h1 className="text-2xl font-semibold">{title}</h1>
      {!matter || !recordWork ? (
        <p className="text-base text-muted">
          <FormattedMessage
            id="portal.matter.unreachable"
            defaultMessage="This Matter does not exist, or you cannot open it."
          />
        </p>
      ) : (
        <>
          <p className="text-sm text-muted">{matterReference(intl, matter.number)}</p>
          <dl className="grid grid-cols-1 gap-5 rounded-card border border-border-default bg-raised p-5 @sm:grid-cols-2">
            <div>
              <dt className="text-sm font-medium text-muted">
                <FormattedMessage id="portal.matter.type" defaultMessage="Matter Type" />
              </dt>
              <dd>{matter.type}</dd>
            </div>
            <div>
              <dt className="text-sm font-medium text-muted">
                <FormattedMessage id="portal.matter.status" defaultMessage="Status" />
              </dt>
              <dd>{matter.status}</dd>
            </div>
            <div>
              <dt className="text-sm font-medium text-muted">
                <FormattedMessage id="portal.matter.manager" defaultMessage="Matter Manager" />
              </dt>
              <dd>{matter.manager?.displayName ?? unset}</dd>
            </div>
            <div>
              <dt className="text-sm font-medium text-muted">
                <FormattedMessage
                  id="contracts.form.businessOwner"
                  defaultMessage="Business Owner"
                />
              </dt>
              <dd>{matter.businessOwner?.displayName ?? unset}</dd>
            </div>
          </dl>
          <PortalRecordWork
            module="matter"
            number={matter.number}
            viewerId={user.id}
            {...recordWork}
          />
        </>
      )}
    </PortalShell>
  );
}
