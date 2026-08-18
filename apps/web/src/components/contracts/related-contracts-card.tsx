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
 *
 * **M17/4 adds actions.** When `editable` is true the card offers "Add
 * link", "Set parent", and per-row removal buttons for links and the
 * parent. A restricted relative's row never offers actions, because no
 * one manages a link into or out of a record they cannot see.
 *
 * **The record owns the relations, not this card.** The breadcrumb draws
 * the same parent chain, so a copy held here would leave the two
 * surfaces saying different things the moment somebody unlinked (#312).
 * Every write answers the whole surface; the card hands that answer up
 * and redraws from what comes back down.
 */

import { memo, useCallback, useRef, useState } from "react";
import { Link } from "react-router";
import { defineMessages, FormattedMessage, useIntl, type MessageDescriptor } from "react-intl";
import { Button } from "../ui/button";
import { contractReference, STAGE_PILL } from "../../lib/contracts";
import {
  removeRelation,
  removeParent,
  type ContractRelations,
  type RelationEntry,
  type ContractLink,
  type RelationType,
  type LinkDirection,
} from "../../lib/relations";
import { LinkDialog } from "./link-dialog";

// ---------------------------------------------------------------------------
// Labels — every heading the card can draw. Declared through
// `defineMessages` so `formatjs extract` sees them: a descriptor built
// inline where it is rendered would be invisible to the extractor, and
// the next i18n-drift run would drop these ids from the catalog.
// ---------------------------------------------------------------------------

const LABELS = defineMessages({
  parent: { id: "contracts.relations.parent", defaultMessage: "Parent" },
  children: { id: "contracts.relations.children", defaultMessage: "Children" },
  renews: { id: "contracts.relations.renewsLabel", defaultMessage: "Renews" },
  renewedBy: { id: "contracts.relations.renewedByLabel", defaultMessage: "Renewed by" },
  amends: { id: "contracts.relations.amendsLabel", defaultMessage: "Amends" },
  amendedBy: { id: "contracts.relations.amendedByLabel", defaultMessage: "Amended by" },
  related: { id: "contracts.relations.relatedLabel", defaultMessage: "Related" },
  addLink: { id: "contracts.relations.addLink", defaultMessage: "Add link" },
  addParent: { id: "contracts.relations.addParent", defaultMessage: "Set parent" },
  removeLink: { id: "contracts.relations.removeLink", defaultMessage: "Remove link" },
  removeParent: { id: "contracts.relations.removeParent", defaultMessage: "Remove parent" },
  unlinkError: {
    id: "contracts.relations.unlinkError",
    defaultMessage: "Could not unlink these contracts.",
  },
  unparentError: {
    id: "contracts.relations.unparentError",
    defaultMessage: "Could not remove the parent.",
  },
});

/** Every combination of link type and direction the API may answer. */
const LINK_LABELS: Record<RelationType, Record<LinkDirection, MessageDescriptor>> = {
  renews: { outgoing: LABELS.renews, incoming: LABELS.renewedBy },
  amends: { outgoing: LABELS.amends, incoming: LABELS.amendedBy },
  related: { outgoing: LABELS.related, incoming: LABELS.related },
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Groups links by their display label (relation type + direction). */
function groupLinks(
  links: readonly ContractLink[],
): Map<string, { label: MessageDescriptor; entries: ContractLink[] }> {
  const groups = new Map<string, { label: MessageDescriptor; entries: ContractLink[] }>();
  for (const link of links) {
    // An unknown relation type reads as a plain relation rather than
    // taking the card down: the API is append-only, and a row a later
    // build writes still has to render.
    const label = LINK_LABELS[link.relationType]?.[link.direction] ?? LINK_LABELS.related.outgoing;
    const key = String(label.id);
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

function RelationRow({
  entry,
  onRemove,
  removeLabel,
}: Readonly<{
  entry: RelationEntry;
  onRemove?: () => void;
  removeLabel?: MessageDescriptor;
}>) {
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
      {onRemove && removeLabel && (
        <button
          type="button"
          className="ml-auto text-xs text-link hover:underline"
          onClick={onRemove}
        >
          <FormattedMessage {...removeLabel} />
        </button>
      )}
    </li>
  );
}

function Subsection({
  label,
  entries,
  onRemove,
  removeLabel,
}: Readonly<{
  label: MessageDescriptor;
  entries: readonly RelationEntry[];
  onRemove?: (entry: RelationEntry) => void;
  removeLabel?: MessageDescriptor;
}>) {
  return (
    <div>
      <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-subtle">
        <FormattedMessage {...label} />
      </h3>
      <ul>
        {entries.map((entry, i) => (
          <RelationRow
            key={entry.restricted ? `restricted-${i}` : entry.number}
            entry={entry}
            onRemove={onRemove && !entry.restricted ? () => onRemove(entry) : undefined}
            removeLabel={removeLabel}
          />
        ))}
      </ul>
    </div>
  );
}

function LinkSubsection({
  label,
  links,
  onRemove,
}: Readonly<{
  label: MessageDescriptor;
  links: readonly ContractLink[];
  onRemove?: (link: ContractLink) => void;
}>) {
  return (
    <div>
      <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-subtle">
        <FormattedMessage {...label} />
      </h3>
      <ul>
        {links.map((link, i) => (
          <RelationRow
            key={link.contract.restricted ? `restricted-${i}` : link.contract.number}
            entry={link.contract}
            onRemove={onRemove && !link.contract.restricted ? () => onRemove(link) : undefined}
            removeLabel={LABELS.removeLink}
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
  contractNumber,
  contractIsConfidential,
  relations,
  editable,
  onRelationsChanged,
}: Readonly<{
  contractNumber: number;
  contractIsConfidential: boolean;
  relations: ContractRelations;
  /** Whether the viewer is Member+ and the card should offer actions. */
  editable: boolean;
  /** Fires with the whole surface every write answers. The record holds
   * it, because the breadcrumb draws the parent chain too (#312). Must
   * be stable across renders, or the `memo` above buys nothing. */
  onRelationsChanged: (next: ContractRelations) => void;
}>) {
  const intl = useIntl();
  const [dialog, setDialog] = useState<"link" | "parent" | null>(null);
  const [error, setError] = useState<string | null>(null);
  /** One relation write at a time. A ref, not state: two clicks in one
   * tick read the same pre-render state value and both would pass. */
  const inFlight = useRef(false);

  const hasParent = relations.parentChain.length > 0;
  const hasChildren = relations.children.length > 0;
  const hasLinks = relations.links.length > 0;
  const empty = !hasParent && !hasChildren && !hasLinks;

  const grouped = hasLinks ? groupLinks(relations.links) : null;

  const handleRelationsChanged = useCallback(
    (next: ContractRelations) => {
      onRelationsChanged(next);
      setError(null);
    },
    [onRelationsChanged],
  );

  const handleUnlink = useCallback(
    async (link: ContractLink) => {
      if (link.contract.restricted) return;
      if (inFlight.current) return;
      inFlight.current = true;
      try {
        const result = await removeRelation(
          contractNumber,
          link.contract.number,
          link.relationType,
        );
        if (result.ok) {
          handleRelationsChanged(result.relations);
        } else {
          setError(intl.formatMessage(LABELS.unlinkError));
        }
      } finally {
        inFlight.current = false;
      }
    },
    [contractNumber, intl, handleRelationsChanged],
  );

  const handleUnparent = useCallback(async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    try {
      const result = await removeParent(contractNumber);
      if (result.ok) {
        handleRelationsChanged(result.relations);
      } else {
        setError(intl.formatMessage(LABELS.unparentError));
      }
    } finally {
      inFlight.current = false;
    }
  }, [contractNumber, intl, handleRelationsChanged]);

  return (
    <>
      <section
        aria-labelledby="related-contracts-heading"
        className="w-full overflow-hidden rounded-card border border-border-default bg-raised"
      >
        <header className="flex h-section-header items-center rounded-t-card border-b border-border-default bg-section-header px-4">
          <h2 id="related-contracts-heading" className="text-base font-semibold">
            <FormattedMessage id="contracts.relations.section" defaultMessage="Related contracts" />
          </h2>
          {editable && (
            <div className="ml-auto flex gap-1">
              {!hasParent && (
                <Button variant="ghost" size="sm" onClick={() => setDialog("parent")}>
                  <FormattedMessage {...LABELS.addParent} />
                </Button>
              )}
              <Button variant="ghost" size="sm" onClick={() => setDialog("link")}>
                <FormattedMessage {...LABELS.addLink} />
              </Button>
            </div>
          )}
        </header>
        <div className="p-4">
          {error && (
            <p role="alert" className="mb-2 text-xs text-status-danger-fg">
              {error}
            </p>
          )}
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
                <div>
                  <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-subtle">
                    <FormattedMessage {...LABELS.parent} />
                  </h3>
                  <ul>
                    {relations.parentChain.map((entry, i) => {
                      // The chain is root-first, so the immediate parent
                      // is the last entry — and only the immediate
                      // parent can be removed (DES-045).
                      const isImmediate = i === relations.parentChain.length - 1;
                      const canRemove = editable && isImmediate && !entry.restricted;
                      return (
                        <RelationRow
                          key={entry.restricted ? `restricted-${i}` : entry.number}
                          entry={entry}
                          onRemove={canRemove ? () => void handleUnparent() : undefined}
                          removeLabel={LABELS.removeParent}
                        />
                      );
                    })}
                  </ul>
                </div>
              )}
              {hasChildren && <Subsection label={LABELS.children} entries={relations.children} />}
              {grouped &&
                Array.from(grouped.values()).map(({ label, entries }) => (
                  <LinkSubsection
                    key={String(label.id)}
                    label={label}
                    links={entries}
                    onRemove={editable ? (link) => void handleUnlink(link) : undefined}
                  />
                ))}
            </div>
          )}
        </div>
      </section>

      {dialog && (
        <LinkDialog
          contractNumber={contractNumber}
          contractIsConfidential={contractIsConfidential}
          mode={dialog}
          onClose={() => setDialog(null)}
          onRelationsChanged={handleRelationsChanged}
        />
      )}
    </>
  );
});
