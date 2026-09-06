// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The way back to the portal home, drawn the same way on every portal
 * page that is not the home: the request detail, the form, the
 * notification settings, and a Knowledge article.
 *
 * One component rather than four copies of one class string. Every
 * portal page below the home is one step deep, and the step back should
 * look the same wherever a requester takes it.
 */

import { ChevronLeft } from "lucide-react";
import { Link } from "react-router";
import type { ReactNode } from "react";

export function PortalBackLink({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <Link
      to="/portal"
      className="-ms-1.5 inline-flex w-fit min-h-6 items-center gap-1 rounded-button ps-1 pe-2 text-sm font-medium text-muted transition-colors duration-150 hover:bg-control hover:text-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-link"
    >
      <ChevronLeft aria-hidden="true" className="size-4 shrink-0" />
      {children}
    </Link>
  );
}
