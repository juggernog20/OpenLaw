// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The record page's viewer facts, shared with its section cards
 * (TECH-024 rule 7).
 *
 * A record page provides this once around its body. Section cards read
 * it instead of taking the same facts as props: who is looking, their
 * role, whether the record is frozen, and which record this is. Cards
 * take domain props only, so the rows, cursors, and handlers still
 * arrive the ordinary way.
 *
 * The shape is the same for every record kind. A card that is drawn on
 * more than one kind reads `record.kind` rather than taking a prop
 * per page.
 */

import { createContext, useContext } from "react";
import type { Role } from "../lib/roles";

export type RecordKind = "contract" | "matter" | "entity";

/** Which record the page is drawing. */
export interface RecordReference {
  kind: RecordKind;
  id: string;
  /** The human-facing number the seam addresses the record by. */
  number: number;
}

/** Who is looking at the record. */
export interface RecordViewer {
  id: string;
  role: Role;
}

export interface RecordFacts {
  record: RecordReference;
  viewer: RecordViewer;
  /** The record's Owner, or none. Part of the audience on a confidential
   * record, and one of the three actors on a per-document flag. */
  ownerId: string | null;
  /** Whether DD-016's confidential flag is set on the record. */
  confidential: boolean;
  /** Whether the viewer's role may write records at all (Member+). */
  canEdit: boolean;
  /** The record is archived, or the viewer may not write it. Cards draw
   * no write control while this holds. */
  frozen: boolean;
}

export const RecordContext = createContext<RecordFacts | null>(null);

/** The viewer facts of the record page this card is on. Throws when no
 * record page is above the caller, because a card without a record has
 * nothing to draw. */
export function useRecord(): RecordFacts {
  const value = useContext(RecordContext);
  if (!value) throw new Error("useRecord must be used inside a record page's RecordContext.");
  return value;
}
