// SPDX-License-Identifier: AGPL-3.0-only

/** Parent, children, and flat related Matters on the Matter Overview. */
import { useRef, useState } from "react";
import { useRecord } from "../record-context";
import { defineMessage, FormattedMessage, useIntl, type MessageDescriptor } from "react-intl";
import { Link } from "react-router";
import {
  removeMatterParent,
  removeMatterRelation,
  type MatterRelative,
  type MatterRelations,
} from "../../lib/matter-relations";
import { matterReference } from "../../lib/matters";
import { Button } from "../ui/button";
import { RestrictedRecordCell } from "../restricted-record-cell";
import { MatterRelationDialog } from "./relation-dialog";

function RelativeRow({
  relative,
  remove,
}: Readonly<{ relative: MatterRelative; remove?: () => void }>) {
  const intl = useIntl();
  if (relative.restricted) {
    return (
      <li className="py-1">
        <RestrictedRecordCell
          label={{ id: "matters.relations.restricted", defaultMessage: "Restricted Matter" }}
        />
      </li>
    );
  }
  return (
    <li className="flex items-center gap-2 py-1 text-sm">
      <Link className="min-w-0 text-link hover:underline" to={`/matters/${relative.number}`}>
        {matterReference(intl, relative.number)} {relative.title}
      </Link>
      <span className="shrink-0 rounded-pill bg-badge-count-bg px-2 py-0.5 text-xs text-badge-count-fg">
        {relative.statusName}
      </span>
      {remove && (
        <button
          type="button"
          className="ml-auto text-xs text-link hover:underline"
          onClick={remove}
        >
          <FormattedMessage id="matters.relations.remove" defaultMessage="Remove" />
        </button>
      )}
    </li>
  );
}

function Group({
  label,
  rows,
  onRemove,
}: Readonly<{
  label: MessageDescriptor;
  rows: readonly MatterRelative[];
  onRemove?: (row: MatterRelative) => void;
}>) {
  if (rows.length === 0) return null;
  return (
    <div>
      <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-subtle">
        <FormattedMessage {...label} />
      </h3>
      <ul>
        {rows.map((row, index) => (
          <RelativeRow
            key={row.restricted ? `restricted-${index}` : row.number}
            relative={row}
            remove={onRemove && !row.restricted ? () => onRemove(row) : undefined}
          />
        ))}
      </ul>
    </div>
  );
}

export function RelatedMattersCard({
  relations,
  onChanged,
  onCreateChild,
}: Readonly<{
  relations: MatterRelations;
  onChanged: (relations: MatterRelations) => void;
  onCreateChild: () => void;
}>) {
  const { record, frozen } = useRecord();
  const number = record.number;
  const editable = !frozen;
  const [dialog, setDialog] = useState<"parent" | "related" | null>(null);
  const [error, setError] = useState(false);
  const inFlight = useRef(false);
  const empty =
    !relations.parent && relations.children.length === 0 && relations.related.length === 0;

  async function unparent() {
    if (inFlight.current) return;
    inFlight.current = true;
    const result = await removeMatterParent(number);
    inFlight.current = false;
    if (result.data) {
      setError(false);
      onChanged(result.data);
    } else setError(true);
  }

  async function unlink(row: MatterRelative) {
    if (row.restricted || inFlight.current) return;
    inFlight.current = true;
    const result = await removeMatterRelation(number, row.number);
    inFlight.current = false;
    if (result.data) {
      setError(false);
      onChanged(result.data);
    } else setError(true);
  }

  return (
    <section
      aria-labelledby="related-matters-heading"
      className="w-full overflow-hidden rounded-card border border-border-default bg-raised"
    >
      <header className="flex min-h-(--height-section-header) flex-wrap items-center gap-1 border-b border-border-default bg-section-header px-4 py-2">
        <h2 id="related-matters-heading" className="mr-auto text-base font-semibold">
          <FormattedMessage id="matters.relations.section" defaultMessage="Related Matters" />
        </h2>
        {editable && (
          <>
            <Button variant="ghost" size="sm" onClick={onCreateChild}>
              <FormattedMessage id="matters.relations.newChild" defaultMessage="New sub-Matter" />
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setDialog("parent")}>
              {relations.parent ? (
                <FormattedMessage
                  id="matters.relations.changeParent"
                  defaultMessage="Change parent"
                />
              ) : (
                <FormattedMessage id="matters.relations.setParent" defaultMessage="Set parent" />
              )}
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setDialog("related")}>
              <FormattedMessage
                id="matters.relations.addRelated"
                defaultMessage="Add related Matter"
              />
            </Button>
          </>
        )}
      </header>
      <div className="p-4">
        {error && (
          <p role="alert" className="mb-2 text-sm text-status-danger-fg">
            <FormattedMessage
              id="matters.relations.changeError"
              defaultMessage="The Matter relationship could not be changed."
            />
          </p>
        )}
        {empty ? (
          <p className="text-sm text-muted">
            <FormattedMessage id="matters.relations.empty" defaultMessage="No related Matters." />
          </p>
        ) : (
          <div className="flex flex-col gap-4">
            {relations.parent && (
              <Group
                label={defineMessage({ id: "matters.relations.parent", defaultMessage: "Parent" })}
                rows={[relations.parent]}
                onRemove={editable ? () => void unparent() : undefined}
              />
            )}
            <Group
              label={defineMessage({
                id: "matters.relations.children",
                defaultMessage: "Children",
              })}
              rows={relations.children}
            />
            <Group
              label={defineMessage({ id: "matters.relations.related", defaultMessage: "Related" })}
              rows={relations.related}
              onRemove={editable ? (row) => void unlink(row) : undefined}
            />
          </div>
        )}
      </div>
      {dialog && (
        <MatterRelationDialog
          number={number}
          mode={dialog}
          onOpenChange={(open) => !open && setDialog(null)}
          onChanged={(next) => {
            setError(false);
            onChanged(next);
          }}
        />
      )}
    </section>
  );
}
