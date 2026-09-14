// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The sub-bar of the pages under an Auto-Doc (DES-087 clause 8): the
 * breadcrumb reads Auto-Docs / the Auto-Doc's name, and the page's own
 * title closes it.
 */
import { ChevronRight, FileText } from "lucide-react";
import { FormattedMessage } from "react-intl";
import { Link } from "react-router";

export function AutoDocSubBar({
  id,
  name,
  title,
}: {
  id: string;
  name: string | null;
  title: string;
}) {
  return (
    <section
      aria-labelledby="page-title"
      className="flex h-(--height-subbar) items-center gap-2 border-b border-(--chrome-subbar-border) bg-canvas px-page-x"
    >
      <Link to="/auto-docs" className="text-link hover:underline">
        <FormattedMessage id="nav.autoDocs" defaultMessage="Auto-Docs" />
      </Link>
      <ChevronRight size={16} aria-hidden="true" className="text-subtle" />
      <FileText size={16} aria-hidden="true" className="shrink-0 text-muted" />
      <Link to={`/auto-docs/${id}`} className="truncate text-link hover:underline">
        {name ?? <FormattedMessage id="autoDocs.backToAutoDoc" defaultMessage="Auto-Doc" />}
      </Link>
      <ChevronRight size={16} aria-hidden="true" className="text-subtle" />
      <h1 id="page-title" className="truncate text-md font-semibold">
        {title}
      </h1>
    </section>
  );
}
