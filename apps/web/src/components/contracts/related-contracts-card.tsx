// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The "Related contracts" card on the contract record's Overview section
 * (M17/2, CTR-015): the parent chain, the children, and the typed links
 * this contract carries.
 *
 * **The card draws what it was handed.** No writes, no dialogs, no
 * fetch of its own — the loader read the relations surface and the card
 * renders them. Each reachable entry is a link to the related record;
 * each restricted entry is a muted placeholder that says only "Restricted
 * contract" (DD-014).
 */

import { memo } from "react";
import { Link } from "react-router";
import { FormattedMessage, useIntl } from "react-intl";
import { contractReference, STAGE_PILL } from "../../lib/contracts";
import type {
  ContractRelations,
  RelationEntry,
  ContractLink,
  RelationType,
  LinkDirection,
} from "../../lib/relations";

// ---------------------------------------------------------------------------
// Direction labels — every combination the API may answer.
// ---------------------------------------------------------------------------

const LINK_LABELS: Record<
  RelationType,
  Record<LinkDirection, { id: string; defaultMessage: string }>
> = {
  renews: {
    outgoing: { id: "contracts.relations.renewsLabel", defaultMessage: "Renews" },
    incoming: { id: "contracts.relations.renewedByLabel", defaultMessage: "Renewed by" },
  },
  amends: {
    outgoing: { id: "contracts.relations.amendsLabel", defaultMessage: "Amends" },
    incoming: { id: "contracts.relations.amendedByLabel", defaultMessage: "Amended by" },
  },
  related: {
    outgoing: { id: "contracts.relations.relatedLabel", defaultMessage: "Related" },
    incoming: { id: "contracts.relations.relatedLabel", defaultMessage: "Related" },
  },
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Groups links by their display label (relation type + direction). */
function groupLinks(links: readonly ContractLink[]): Map<string, { label: { id: string; defaultMessage: string }; entries: ContractLink[] }> {
  const groups = new Map<string, { label: { id: string; defaultMessage: string }; entries: ContractLink[] }>();
  for (const link of links) {
    const label = LINK_LABELS[link.relationType][link.direction];
    const key = label.id;
    const group = groups.get(key);
    if (group) {
      group.entries.push(link);
    } else {
      groups.set(key, { label, entries: [link] });
    }
  }
  return groups;
}

// ---------------------------------------------------------------------------
// Entry renderers
// ---------------------------------------------------------------------------

function RelationRow({ entry }: Readonly<{ entry: RelationEntry }>) {
  const intl = useIntl();
  if (entry.restricted) {
    return (
      <li className="py-1 text-sm text-muted">
        <FormattedMessage
          id="contracts.relations.restricted"
          defaultMessage="Restricted contract"
        />
      </li>
    );
  }
  const ref = contractReference(intl, entry.number);
  return (
    <li className="flex items-center gap-2 py-1 text-sm">
      <Link
        to={`/contracts/${entry.number}`}
        className="text-link hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-link"
      >
        {ref} {entry.title}
      </Link>
      <span
        className={`inline-flex shrink-0 rounded-pill px-2 py-0.5 text-xs font-medium ${STAGE_PILL[entry.stage]}`}
      >
        {entry.statusName}
      </span>
    </li>
  );
}

function Subsection({
  label,
  entries,
}: Readonly<{ label: { id: string; defaultMessage: string }; entries: readonly RelationEntry[] }>) {
  return (
    <div>
      <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-subtle">
        <FormattedMessage id={label.id} defaultMessage={label.defaultMessage} />
      </h3>
      <ul>
        {entries.map((entry, i) => (
          <RelationRow key={entry.restricted ? `restricted-${i}` : entry.number} entry={entry} />
        ))}
      </ul>
    </div>
  );
}

function LinkSubsection({
  label,
  links,
}: Readonly<{ label: { id: string; defaultMessage: string }; links: readonly ContractLink[] }>) {
  return (
    <div>
      <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-subtle">
        <FormattedMessage id={label.id} defaultMessage={label.defaultMessage} />
      </h3>
      <ul>
        {links.map((link, i) => (
          <RelationRow
            key={link.contract.restricted ? `restricted-${i}` : link.contract.number}
            entry={link.contract}
          />
        ))}
      </ul>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Card
// ---------------------------------------------------------------------------

export const RelatedContractsCard = memo(function RelatedContractsCard({
  relations,
}: Readonly<{ relations: ContractRelations | null }>) {
  const hasParent = relations !== null && relations.parentChain.length > 0;
  const hasChildren = relations !== null && relations.children.length > 0;
  const hasLinks = relations !== null && relations.links.length > 0;
  const empty = !hasParent && !hasChildren && !hasLinks;

  const grouped = hasLinks ? groupLinks(relations.links) : null;

  return (
    <section
      aria-labelledby="related-contracts-heading"
      className="w-full overflow-hidden rounded-card border border-border-default bg-raised"
    >
      <header className="flex h-section-header items-center rounded-t-card border-b border-border-default bg-section-header px-4">
        <h2 id="related-contracts-heading" className="text-base font-semibold">
          <FormattedMessage
            id="contracts.relations.section"
            defaultMessage="Related contracts"
          />
        </h2>
      </header>
      <div className="p-4">
        {empty ? (
          <p className="text-sm text-muted">
            <FormattedMessage
              id="contracts.relations.empty"
              defaultMessage="No related contracts."
            />
          </p>
        ) : (
          <div className="flex flex-col gap-4">
            {hasParent && (
              <Subsection
                label={{ id: "contracts.relations.parent", defaultMessage: "Parent" }}
                entries={relations.parentChain}
              />
            )}
            {hasChildren && (
              <Subsection
                label={{ id: "contracts.relations.children", defaultMessage: "Children" }}
                entries={relations.children}
              />
            )}
            {grouped &&
              Array.from(grouped.values()).map(({ label, entries }) => (
                <LinkSubsection key={label.id} label={label} links={entries} />
              ))}
          </div>
        )}
      </div>
    </section>
  );
});
