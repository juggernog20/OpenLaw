// SPDX-License-Identifier: AGPL-3.0-only

/** DES-073 keeps Help visible in both headers and on the intake pilot pages. */
import { CircleHelp } from "lucide-react";
import { FormattedMessage, useIntl } from "react-intl";
import { Link, useLocation } from "react-router";
import metadata from "virtual:openlaw-help-metadata";
import { HELP_BASE, helpHref, topicsForRoute, type HelpSurface } from "../../lib/help-topics";
import type { DocumentationAudience } from "../../../../../scripts/documentation/reader.mjs";

export function HelpLink({
  surface,
  audience,
  contextual = false,
}: {
  surface: HelpSurface;
  audience?: DocumentationAudience;
  contextual?: boolean;
}) {
  const { pathname } = useLocation();
  const intl = useIntl();
  const topic = topicsForRoute(metadata, pathname, surface)[0];
  const to =
    contextual && topic
      ? `${HELP_BASE[surface]}?topic=${encodeURIComponent(topic)}`
      : helpHref(metadata, pathname, surface, audience);
  return (
    <Link
      to={to}
      aria-label={
        contextual ? undefined : intl.formatMessage({ id: "docs.help", defaultMessage: "Help" })
      }
      className={
        contextual
          ? "inline-flex w-fit items-center gap-1.5 rounded-button text-sm text-link hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-link"
          : "inline-flex min-h-6 shrink-0 items-center justify-center gap-1.5 rounded-button text-sm hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-current"
      }
    >
      <CircleHelp size={20} aria-hidden="true" />
      {contextual ? (
        <FormattedMessage id="docs.helpWithPage" defaultMessage="Help with this page" />
      ) : (
        <span className="hidden @4xl/shell:inline">
          <FormattedMessage id="docs.help" defaultMessage="Help" />
        </span>
      )}
    </Link>
  );
}
