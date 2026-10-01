// SPDX-License-Identifier: AGPL-3.0-only
import { FormattedMessage } from "react-intl";
import type { EntityRow } from "../../lib/entities";
import type { TrustParty } from "../../lib/trust-register";
import { cn } from "../../lib/utils";
import { RestrictedRecordCell } from "../restricted-record-cell";

export function RegisterPartyCell({
  party,
  candidates,
}: Readonly<{ party: TrustParty; candidates: EntityRow[] }>) {
  if (party.restricted)
    return (
      <RestrictedRecordCell
        label={{ id: "entities.restricted", defaultMessage: "Restricted Entity" }}
      />
    );
  const jurisdiction =
    party.kind === "entity" ? candidates.find((c) => c.id === party.entityId)?.jurisdiction : null;
  return (
    <div className="flex items-center gap-2.5">
      <span
        aria-hidden="true"
        className={cn(
          "grid size-7 shrink-0 place-items-center text-xs font-semibold",
          party.kind === "entity"
            ? "rounded-button bg-badge-count-bg text-badge-count-fg"
            : "rounded-avatar bg-avatar-bg text-avatar-fg",
        )}
      >
        {party.name
          .split(/\s+/)
          .slice(0, 2)
          .map((w) => w[0] ?? "")
          .join("")
          .toUpperCase()}
      </span>
      <div>
        <p className="font-medium">{party.name}</p>
        <p className="text-xs text-muted">
          {party.kind === "entity" ? (
            jurisdiction ? (
              <FormattedMessage
                id="entities.trust.entityJurisdiction"
                defaultMessage="Entity · {jurisdiction}"
                values={{ jurisdiction }}
              />
            ) : (
              <FormattedMessage id="entities.register.holder.entity" defaultMessage="Entity" />
            )
          ) : party.kind === "class" ? (
            <FormattedMessage id="entities.trust.class" defaultMessage="Class" />
          ) : (
            <FormattedMessage id="entities.ownership.individual" defaultMessage="Individual" />
          )}
        </p>
      </div>
    </div>
  );
}
