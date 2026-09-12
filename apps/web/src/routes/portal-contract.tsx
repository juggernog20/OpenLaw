// SPDX-License-Identifier: AGPL-3.0-only

/** DD-023: Contract facts and business work for the Portal team. */
import { type ReactNode } from "react";
import { Link, redirect, useLoaderData, type LoaderFunctionArgs } from "react-router";
import { FormattedMessage, useIntl } from "react-intl";
import { loadPortalWork } from "../lib/portal-records";
import { PortalRecordWork } from "../components/portal/record-work";
import { api } from "../lib/api";
import { currentUser, useSignOut } from "../lib/session";
import {
  contractReference,
  formatContractValue,
  stageLabel,
  termTypeLabel,
} from "../lib/contracts";
import { formatShortDate } from "../lib/format";
import { PortalRecordShell } from "../components/portal/record-shell";
import { PageTitle } from "../components/page-title";
import { UnverifiedMarker } from "../components/contracts/ai-analysis-card";

export async function portalContractLoader({ params }: LoaderFunctionArgs) {
  const user = await currentUser();
  if (!user) return redirect("/portal/enter");
  const number = Number(params.number);
  if (!Number.isInteger(number) || number < 1) return { user, contract: null };
  const result = await api.GET("/api/v1/portal/contracts/{number}", {
    params: { path: { number } },
  });
  if (result.response.status === 404) return { user, contract: null };
  if (!result.data) throw new Error("This Contract could not be read.");
  return {
    user,
    contract: result.data.contract,
    recordWork: await loadPortalWork("contract", number),
  };
}

export function PortalContractPage() {
  const { user, contract, recordWork } = useLoaderData<typeof portalContractLoader>();
  const intl = useIntl();
  const signOut = useSignOut("/portal/enter");
  const title =
    contract?.title ??
    intl.formatMessage({ id: "portal.contract.notFound", defaultMessage: "Contract not found" });
  const unset = intl.formatMessage({
    id: "portal.contract.notRecorded",
    defaultMessage: "Not recorded",
  });
  const date = (value: string | null) => (value ? formatShortDate(value) : unset);
  const flagged = (slug: string) =>
    contract?.unverifiedFields.some((field) => field === slug) ?? false;
  function fact(label: ReactNode, value: ReactNode, unverified = false) {
    return (
      <div className="flex flex-col gap-1">
        <dt className="text-sm font-medium text-muted">{label}</dt>
        <dd className="flex flex-wrap items-center gap-2 text-base">
          {value}
          {unverified && <UnverifiedMarker />}
        </dd>
      </div>
    );
  }
  return (
    <PortalRecordShell
      key={recordWork?.work.id}
      entityType="contract"
      entityId={recordWork?.work.id}
      number={contract?.number ?? 0}
      viewerId={user.id}
      work={recordWork?.work}
      user={user}
      onSignOut={() => void signOut()}
      recordScope={
        recordWork ? { entityType: "contract", entityId: recordWork.work.id } : undefined
      }
    >
      <PageTitle title={title} />
      <Link to="/portal/contracts" className="text-base text-link">
        <FormattedMessage id="portal.contract.back" defaultMessage="Your Contracts" />
      </Link>
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold">{title}</h1>
        {contract && (
          <p className="text-sm text-muted">{contractReference(intl, contract.number)}</p>
        )}
      </div>
      {!contract ? (
        <p className="text-base text-muted">
          <FormattedMessage
            id="portal.contract.unreachable"
            defaultMessage="This Contract does not exist, or you cannot open it."
          />
        </p>
      ) : (
        <div className="flex min-w-0 flex-col gap-4">
          {contract.unverifiedFields.length > 0 && (
            <p className="rounded-card border border-border-default bg-raised p-4 text-base text-muted">
              <FormattedMessage
                id="portal.contract.unverifiedExplanation"
                defaultMessage="Legal has not yet verified the values marked Unverified. Confirm them with Legal before relying on them."
              />
            </p>
          )}
          {contract.renewalPendingConfirmation && (
            <p className="text-base text-muted">
              <FormattedMessage
                id="portal.contract.renewalPending"
                defaultMessage="Renewal is pending confirmation by Legal."
              />
            </p>
          )}
          <section
            aria-labelledby="portal-overview-heading"
            className="flex flex-col gap-5 rounded-card border border-border-default bg-raised p-5"
          >
            <h2 id="portal-overview-heading" className="text-lg font-semibold">
              <FormattedMessage id="contracts.record.tab.overview" defaultMessage="Overview" />
            </h2>
            <dl className="grid grid-cols-1 gap-5 @sm/record:grid-cols-2">
              {fact(
                <FormattedMessage
                  id="portal.contract.counterparty"
                  defaultMessage="Counterparty"
                />,
                contract.counterparty ?? unset,
                flagged("counterparty"),
              )}
              {fact(
                <FormattedMessage id="portal.contract.stage" defaultMessage="Stage" />,
                stageLabel(intl, contract.stage),
              )}
              {fact(
                <FormattedMessage
                  id="contracts.form.businessOwner"
                  defaultMessage="Business Owner"
                />,
                contract.businessOwner?.displayName ?? unset,
              )}
              {fact(
                <FormattedMessage id="contracts.form.legalOwner" defaultMessage="Legal Owner" />,
                contract.legalOwner?.displayName ?? unset,
              )}
              {fact(
                <FormattedMessage
                  id="contracts.form.owningDepartment"
                  defaultMessage="Owning department"
                />,
                recordWork?.work.owningDepartment ?? unset,
              )}
              {fact(
                <FormattedMessage id="contracts.form.region" defaultMessage="Region" />,
                recordWork?.work.region ?? unset,
              )}
              {fact(
                <FormattedMessage id="portal.contract.termType" defaultMessage="Term type" />,
                termTypeLabel(intl, contract.termType),
                flagged("termType"),
              )}
              {fact(
                <FormattedMessage id="portal.contract.value" defaultMessage="Value" />,
                contract.value ? formatContractValue(intl, contract.value) : unset,
                flagged("value"),
              )}
              {fact(
                <FormattedMessage
                  id="portal.contract.effectiveDate"
                  defaultMessage="Effective date"
                />,
                date(contract.effectiveDate),
                flagged("effectiveDate"),
              )}
              {fact(
                <FormattedMessage id="portal.contract.expiryDate" defaultMessage="Expiry date" />,
                date(contract.expiryDate),
                flagged("expiryDate"),
              )}
              {fact(
                <FormattedMessage
                  id="portal.contract.renewalPeriod"
                  defaultMessage="Renewal period"
                />,
                contract.renewalPeriodMonths === null ? (
                  unset
                ) : (
                  <FormattedMessage
                    id="portal.contract.months"
                    defaultMessage="{count, plural, one {# month} other {# months}}"
                    values={{ count: contract.renewalPeriodMonths }}
                  />
                ),
                flagged("renewalPeriodMonths"),
              )}
              {fact(
                <FormattedMessage
                  id="portal.contract.noticeDeadline"
                  defaultMessage="Notice deadline"
                />,
                date(contract.noticeDeadline),
                flagged("expiryDate") || flagged("noticePeriodDays"),
              )}
            </dl>
          </section>
          {recordWork && (
            <PortalRecordWork module="contract" number={contract.number} {...recordWork} />
          )}
        </div>
      )}
    </PortalRecordShell>
  );
}
