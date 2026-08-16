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
 */

import { useIntl } from "react-intl";
import { Check, ChevronRight } from "lucide-react";
import { CONTRACT_STAGES, STAGE_PILL, stageLabel, type ContractStage } from "../lib/contracts";
import { cn } from "../lib/utils";

export function StagePipeline({
  stage,
  className,
}: Readonly<{
  /** The contract's derived stage, as the seam answers it. The marker
   * follows this and nothing else — never the status label. */
  stage: ContractStage;
  className?: string;
}>) {
  const intl = useIntl();
  /** Where the marker sits. A stage the seam answers that this build
   * does not know would give -1, which marks nothing and leaves all six
   * ahead of the marker — a truthful "not placed" rather than a crash. */
  const position = CONTRACT_STAGES.indexOf(stage);

  return (
    <ol
      aria-label={intl.formatMessage({
        id: "contracts.stage.pipeline",
        defaultMessage: "Stage",
      })}
      // A scroll container is only usable by keyboard when it can hold
      // focus (WCAG 2.2 SC 2.1.1). The list is named, so the stop
      // announces itself rather than landing on an anonymous box.
      tabIndex={0}
      className={cn(
        // On a narrow slot it claims no width of its own, so it shares
        // its line with whatever else is on it and scrolls inside what
        // is left — a strip that pushed the record's actions onto a
        // line of their own would cost a phone a third row of chrome.
        // On a wide slot it keeps its full width instead, so a long
        // title truncates before six stages start sliding out of view.
        "flex min-w-0 max-w-full grow basis-0 items-center gap-1.5 overflow-x-auto rounded-card",
        "border border-border-default bg-control px-3 py-1.5",
        "@5xl/shell:grow-0 @5xl/shell:basis-auto @5xl/shell:shrink-0",
        "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-link",
        className,
      )}
    >
      {CONTRACT_STAGES.map((step, index) => {
        const behind = position >= 0 && index < position;
        const current = index === position;
        return (
          <li
            key={step}
            aria-current={current ? "step" : undefined}
            className="flex shrink-0 items-center gap-1.5"
          >
            {/* The separator belongs to the pair it sits between, so it
                rides with the second of the two rather than standing as
                a list item of its own.

                12px, not DES-008's 16: both glyphs here are interior to
                a compact metadata strip set in 11px text, which is the
                carve-out the checkbox indicator already takes and which
                DES-034 records for this strip. A 16px glyph beside
                11px text reads as the larger of the two. */}
            {index > 0 && (
              <ChevronRight size={12} aria-hidden="true" className="shrink-0 text-border-default" />
            )}
            {current ? (
              // The same pill the sub-bar's status wears, in the same
              // stage family (DES-005) — so the two agree on sight.
              <span
                className={cn("rounded-pill px-2 py-0.5 text-xs font-medium", STAGE_PILL[step])}
              >
                {stageLabel(intl, step)}
              </span>
            ) : (
              <span
                className={cn(
                  "flex items-center gap-1 text-xs",
                  behind ? "text-primary" : "text-muted",
                )}
              >
                {behind && (
                  <Check size={12} aria-hidden="true" className="shrink-0 text-status-success-fg" />
                )}
                {stageLabel(intl, step)}
                {behind && (
                  <>
                    {/* The separator between the name and the state
                        word, so a screen reader says "Draft done" and
                        not "Draftdone". It collapses on screen: this is
                        a flex row, and trailing whitespace in one has
                        nothing to hold it open. */}{" "}
                    <span className="sr-only">
                      {intl.formatMessage({
                        id: "contracts.stage.done",
                        defaultMessage: "done",
                      })}
                    </span>
                  </>
                )}
              </span>
            )}
          </li>
        );
      })}
    </ol>
  );
}
