// SPDX-License-Identifier: AGPL-3.0-only

import { useMemo, useRef, useState, type ReactNode } from "react";
import { Link, redirect, useLoaderData, type LoaderFunctionArgs } from "react-router";
import { FormattedMessage, useIntl } from "react-intl";
import { api } from "../lib/api";
import { currentUser, useSignOut } from "../lib/session";
import {
  contractReference,
  formatContractValue,
  stageLabel,
  termTypeLabel,
} from "../lib/contracts";
import { formatShortDate } from "../lib/format";
import { portalContractReader } from "../lib/portal-contracts";
import { PortalShell } from "../components/portal/portal-shell";
import { PageTitle } from "../components/page-title";
import { Button } from "../components/ui/button";
import { DocPanel } from "../components/documents/doc-panel";
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
  return { user, contract: result.data.contract };
}

export function PortalContractPage() {
  const { user, contract } = useLoaderData<typeof portalContractLoader>();
  const intl = useIntl();
  const signOut = useSignOut("/portal/enter");
  const [reading, setReading] = useState(false);
  const [covers, setCovers] = useState(true);
  const readButton = useRef<HTMLButtonElement>(null);
  const reader = useMemo(() => portalContractReader(contract?.number ?? 0), [contract?.number]);
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
    <PortalShell user={user} onSignOut={() => void signOut()}>
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
        <div className="@container/record relative flex min-h-144 gap-4">
          <div className="flex min-w-0 flex-1 flex-col gap-4" inert={reading && covers}>
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
            <dl className="grid grid-cols-1 gap-5 rounded-card border border-border-default bg-raised p-5 @sm/record:grid-cols-2">
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
            {contract.primaryDocument ? (
              <section className="rounded-card border border-border-default bg-raised p-5">
                <h2 className="text-base font-semibold">
                  <FormattedMessage
                    id="portal.contract.primaryDocument"
                    defaultMessage="Primary Document"
                  />
                </h2>
                <p className="my-3 text-base">{contract.primaryDocument.title}</p>
                <div className="flex gap-3">
                  <Button ref={readButton} onClick={() => setReading(true)}>
                    <FormattedMessage
                      id="portal.contract.readDocument"
                      defaultMessage="Read Document"
                    />
                  </Button>
                  <Button asChild variant="secondary">
                    <a
                      href={reader.documentDownloadHref(
                        contract.primaryDocument.id,
                        contract.primaryDocument.version.id,
                      )}
                    >
                      <FormattedMessage id="docPanel.download" defaultMessage="Download" />
                    </a>
                  </Button>
                </div>
              </section>
            ) : (
              <p className="text-base text-muted">
                <FormattedMessage
                  id="portal.contract.noDocument"
                  defaultMessage="No primary Document is available to you."
                />
              </p>
            )}
          </div>
          {reading && contract.primaryDocument && (
            <DocPanel
              documentId={contract.primaryDocument.id}
              title={contract.primaryDocument.title}
              version={contract.primaryDocument.version}
              source={reader}
              onDockedChange={(docked) => setCovers(!docked)}
              onClose={() => {
                setReading(false);
                setTimeout(() => readButton.current?.focus(), 0);
              }}
            />
          )}
        </div>
      )}
    </PortalShell>
  );
}
