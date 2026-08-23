// SPDX-License-Identifier: AGPL-3.0-only

/** The read-only M2 matter hero delivered with the record's birth. */
import { ChevronRight } from "lucide-react";
import type { ReactNode } from "react";
import { FormattedMessage, useIntl, type IntlShape } from "react-intl";
import { Link, redirect, useLoaderData, useNavigate, type LoaderFunctionArgs } from "react-router";
import { api } from "../lib/api";
import { authClient } from "../lib/auth-client";
import { formatFullDate } from "../lib/format";
import { matterReference, matterSeverityLabel } from "../lib/matters";
import { canReadMatters } from "../lib/roles";
import { currentUser, needsSetup } from "../lib/session";
import { PageTitle } from "../components/page-title";
import { AppShell } from "../components/shell/app-shell";

export async function matterRecordLoader({ params }: LoaderFunctionArgs) {
  const user = await currentUser();
  if (!user) return redirect((await needsSetup()) ? "/auth/setup" : "/auth/login");
  if (!canReadMatters(user.role)) return redirect("/");
  const number = Number(params.matterNumber);
  const { data } = await api.GET("/api/v1/matters/{number}", { params: { path: { number } } });
  if (!data) throw new Error("The matter could not be read.");
  return { user, matter: data.matter, fields: data.fields };
}

function notProvided(intl: IntlShape): string {
  return intl.formatMessage({ id: "matters.notProvided", defaultMessage: "Not provided" });
}

function renderValue(
  intl: IntlShape,
  value: string | number | boolean | string[] | undefined,
): string {
  if (value === undefined) return notProvided(intl);
  if (Array.isArray(value))
    return value.length ? intl.formatList(value, { type: "conjunction" }) : notProvided(intl);
  if (typeof value === "boolean")
    return intl.formatMessage(
      { id: "matters.boolean", defaultMessage: "{value, select, true {Yes} other {No}}" },
      { value: String(value) },
    );
  return String(value);
}

export function MatterRecordPage() {
  const { user, matter, fields } = useLoaderData<typeof matterRecordLoader>();
  const intl = useIntl();
  const navigate = useNavigate();
  async function signOut() {
    await authClient.signOut();
    void navigate("/auth/login", { replace: true });
  }
  return (
    <AppShell
      user={user}
      onSignOut={() => void signOut()}
      subbar={
        <section
          aria-labelledby="page-title"
          className="flex h-(--height-subbar) shrink-0 items-center gap-2 border-b border-(--chrome-subbar-border) bg-canvas px-page-x"
        >
          <Link to="/matters" className="text-link hover:underline">
            <FormattedMessage id="matters.title" defaultMessage="Matters" />
          </Link>
          <ChevronRight size={16} aria-hidden="true" className="text-subtle" />
          <span className="text-sm text-muted">{matterReference(intl, matter.number)}</span>
          <h1 id="page-title" className="truncate text-xl font-semibold">
            {matter.title}
          </h1>
          <span className="rounded-pill bg-status-info-bg px-2 py-0.5 text-xs font-medium text-status-info-fg">
            {matter.statusName}
          </span>
        </section>
      }
    >
      <PageTitle
        title={intl.formatMessage(
          { id: "matters.record.pageTitle", defaultMessage: "{reference} · {title}" },
          { reference: matterReference(intl, matter.number), title: matter.title },
        )}
      />
      <article className="max-w-4xl rounded-card border border-border-default bg-raised p-5">
        <header className="mb-5">
          <p className="text-sm font-medium text-muted">{matterReference(intl, matter.number)}</p>
          <h2 className="mt-1 text-2xl font-semibold">{matter.title}</h2>
        </header>
        <dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <Fact
            label={<FormattedMessage id="matters.field.status" defaultMessage="Status" />}
            value={matter.statusName}
          />
          <Fact
            label={<FormattedMessage id="matters.field.type" defaultMessage="Matter type" />}
            value={matter.matterTypeName}
          />
          <Fact
            label={<FormattedMessage id="matters.field.manager" defaultMessage="Matter Manager" />}
            value={
              matter.manager?.displayName ??
              intl.formatMessage({ id: "matters.unassigned", defaultMessage: "Unassigned" })
            }
          />
          <Fact
            label={<FormattedMessage id="matters.field.priority" defaultMessage="Priority" />}
            value={matterSeverityLabel(intl, matter.priority)}
          />
          <Fact
            label={<FormattedMessage id="matters.field.risk" defaultMessage="Risk" />}
            value={
              matter.risk
                ? matterSeverityLabel(intl, matter.risk)
                : intl.formatMessage({ id: "matters.notAssessed", defaultMessage: "Not assessed" })
            }
          />
          <Fact
            label={<FormattedMessage id="matters.field.opened" defaultMessage="Opened" />}
            value={formatFullDate(matter.openedAt)}
          />
        </dl>
        <section className="mt-6 border-t border-border-default pt-5">
          <h3 className="text-sm font-semibold">
            <FormattedMessage id="matters.field.description" defaultMessage="Description" />
          </h3>
          <p className="mt-2 whitespace-pre-wrap text-base text-muted">
            {matter.description || notProvided(intl)}
          </p>
        </section>
        {fields.length > 0 && (
          <section className="mt-6 border-t border-border-default pt-5">
            <h3 className="mb-4 text-sm font-semibold">
              <FormattedMessage id="matters.customFields" defaultMessage="Custom fields" />
            </h3>
            <dl className="grid gap-4 sm:grid-cols-2">
              {fields.map((field) => (
                <Fact
                  key={field.fieldId}
                  label={field.displayName}
                  value={renderValue(intl, matter.customFields[field.slug])}
                />
              ))}
            </dl>
          </section>
        )}
      </article>
    </AppShell>
  );
}

function Fact({ label, value }: { label: ReactNode; value: string }) {
  return (
    <div>
      <dt className="text-xs font-medium text-muted">{label}</dt>
      <dd className="mt-1 text-base">{value}</dd>
    </div>
  );
}
