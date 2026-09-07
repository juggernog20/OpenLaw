// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The contract's stage pipeline (CTR-001, grill-plan row D.8), drawn as
 * `S2 StagePipe` in the contracts mocks: the six fixed stages in
 * canonical order, on the record's sub-bar beside the status pill.
 *
 * The pill and the pipeline are one datum at two zooms. The pill takes
 * the status label, which any Administrator may rename; the pipeline
 * takes the fixed stage that label maps to, which nobody can. So the
 * two often read the same word and sometimes do not, and neither is
 * redundant.
 *
 * **It renders position, never progress.** Transitions are
 * unrestricted (CTR-001) — deals collapse and redlines reopen after
 * approval — so a stage may move backwards, and the marker simply
 * moves back with it. The check on every stage before the marker means
 * "behind the current position", not "achieved": it is recomputed from
 * the current stage on every render, and a regression takes those
 * checks away again.
 *
 * Three states, and none of them is carried by colour alone (DES-011):
 * a stage behind the marker takes a check glyph and full-strength text,
 * the current stage takes the DES-005 pill its stage family names, and
 * a stage ahead of the marker takes muted plain text. The current item
 * carries `aria-current="step"`; the ones behind it say "done" in a
 * screen-reader-only word, which the check glyph says visually.
 *
 * The strip scrolls sideways rather than wrapping when its slot is too
 * narrow for six stages — a chevron at a line break reads as a broken
 * sequence — so it is focusable, which is what makes that scroll
 * reachable from the keyboard. Where it sits and when its row wraps is
 * the record's business, not the strip's; DES-034 has both.
 *
 * **One item of the six is pressable, and it is the one the contract is
 * on** (DES-053). Given `move`, the current stage's pill becomes the
 * menu trigger that changes the status: the act starts where the reader
 * is already looking, and the other five stages stay what they always
 * were. The menu offers **statuses**, not stages — a status is what
 * commits and two of them may share one stage (CTR-001) — so the
 * trigger is labelled with a stage and the list under it is not.
 *
 * Without `move` the strip is exactly the reading it has always been.
 * That is what a read-only viewer and an archived record get: no
 * trigger, no chevron, nothing disabled to work out (CTR-021).
 */

import { useIntl } from "react-intl";
import {
  CONTRACT_STAGES,
  STAGE_PILL,
  stageLabel,
  type ContractStage,
  type ContractStatusOption,
} from "../lib/contracts";
import { StatusProgression } from "./status-progression";

/** What the strip needs to become the move control. Absent for anyone
 * who may not move this contract. */
export interface StageMove {
  /** Every status the record may hold, in the order the seam answers
   * them — including the saved one when it has since been archived. */
  statuses: readonly ContractStatusOption[];
  /** The status the record holds now, which is the row that reads as
   * checked. It is not the stage: the stage is derived from it. */
  statusId: string;
  /** A status commit is in flight. The trigger stands down until it
   * lands, so a second pick cannot arrive behind the first and raise a
   * soft gate about a status nobody is moving to any more. */
  busy: boolean;
  onPick: (statusId: string) => void;
}

export function StagePipeline({
  stage,
  move,
  className,
}: Readonly<{
  /** The contract's derived stage, as the seam answers it. The marker
   * follows this and nothing else — never the status label. */
  stage: ContractStage;
  move?: StageMove;
  className?: string;
}>) {
  const intl = useIntl();
  return (
    <StatusProgression
      steps={CONTRACT_STAGES.map((step) => ({
        id: step,
        label: stageLabel(intl, step),
        className: STAGE_PILL[step],
      }))}
      currentId={stage}
      label={intl.formatMessage({ id: "contracts.stage.pipeline", defaultMessage: "Stage" })}
      className={className}
      {...(move
        ? {
            move: {
              statusId: move.statusId,
              busy: move.busy,
              label: intl.formatMessage(
                { id: "contracts.stage.move", defaultMessage: "{stage} — move contract" },
                { stage: stageLabel(intl, stage) },
              ),
              statuses: move.statuses.map((status) => ({
                id: status.id,
                label: status.displayName,
                detail: stageLabel(intl, status.stage),
              })),
              onPick: move.onPick,
            },
          }
        : {})}
    />
  );
}
