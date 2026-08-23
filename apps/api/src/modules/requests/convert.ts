// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Convert (INT-002, INT-006, INT-007, DD-018, #420): the disposition
 * that turns an ask into work, with everything the requester typed
 * carried straight through.
 *
 * **Triage confirms the routing; it never classifies it** (DD-018 rule
 * 2). The Administrator bound the target when they configured the
 * request type, so this route reads it rather than taking it: a request
 * type naming a live type converts onto that type, and a body naming a
 * different type in the same module is refused by name. The **one** choice a
 * triager genuinely makes is the one the form honestly deferred — a
 * module-only target ("Contract review") names no type, so the body
 * must, and the same is true of a target type the taxonomy has since
 * archived, which reads as no type at all (the INT-002 M19/4 addendum).
 *
 * **Re-target is the deliberate exception, and it is the only one**
 * (DD-018 rule 5, INT-006). Either configured module can be switched to
 * the other by naming that module's type, because a mis-routed ask
 * should cost nothing. The Request survives as the portal shell.
 *
 * **The prefill is the point of the whole milestone** (INT-002). The
 * dialog seeds the title from the summary and sends whatever is in the
 * box at the press; the requester's urgency becomes the record's
 * priority 1:1 (MTR-012 — `risk` is legal's and is never born); and
 * every collected value whose slug the target type also attaches lands
 * in that field. Nothing is re-keyed, and the server
 * lands the values rather than trusting a client to send them back:
 * carry-through is a rule, and a rule a browser holds is not a rule.
 *
 * **Values are copied, never moved** (the INT-002 M19/7 addendum's
 * bill, paid here). A collected value whose slug the target type does
 * not attach has nowhere to land, so it does not land — and nothing is
 * deleted for it. The Request keeps its `custom_fields` whole and goes
 * on rendering every one of them on both details. The dialog is what
 * names the values that will not carry, before anybody presses.
 *
 * **The record is born ordinary** through its module's create callable:
 * its own sequence, default open state, no manager, no team beyond the
 * creator row, and no Confidential flag inherited from anywhere. The one thing it
 * carries that an ordinary create does not is the priority, because
 * that is a fact somebody stated rather than an assessment nobody made.
 *
 * **Both records narrate it** (DD-017). `request.converted` on the ask
 * names the permanent reference it became; the module's
 * `created_from_request` entry names the R-### it came from. Neither carries free text: the
 * two numbers are the two names, and the log is append-only.
 *
 * **`requestStatusChanged` is raised, not a conversion event of its
 * own** — Resolve's shape rather than Decline's (the M20/8 rule). The
 * requester hears "In progress", which is the whole of what a
 * conversion means to them (the INT-003 M21/6 vocabulary).
 *
 * The lock, the `new` guard, the race refusal, and the envelope read
 * are all `disposition.ts`'s. The 409 gained one extension member for
 * this outcome — the record the winner made — because "somebody
 * converted this" without the permanent reference is news the loser cannot act on.
 *
 * **The paper follows onto either record** (#421, M22/9). Every attachment on
 * a converted Request becomes one document at version 1, filed at the record root,
 * inside this same transaction. It is a copy: the attachment rows and
 * their blobs stay where they are, so the requester's portal detail goes
 * on listing and downloading the paper they submitted. The rules of the
 * promotion itself are `promote-paper.ts`'s; what this route owns is
 * that it happens here, between the create and the status write, so a
 * conversion that refuses anywhere leaves neither a record nor a
 * document nor a blob nobody points at.
 *
 * **The thread follows onto either record too** (#422, M22/9). Every comment on
 * a converted Request re-parents with its DD-016 tier intact, inside this
 * same transaction, and each reader's place in the conversation moves
 * with it. It is a move rather than a copy — that is the whole of
 * CMT-001's promise, that legal answers in exactly one place from then
 * on — and what makes the Request stop being a comment target is the
 * back-link this route writes on the line after. The rules of the move
 * are `move-thread.ts`'s; what this route owns is that it happens here,
 * beside the create and the promotion, so a conversion that refuses
 * anywhere leaves the conversation exactly where the requester left it.
 */

import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";
import {
  contractTypeFields,
  contractTypes,
  eq,
  matterTypeFields,
  matterTypes,
  requestTypes,
  requests,
  type CustomFieldValue,
} from "@openlaw/db";
import { MAX_CONTRACT_TITLE_LENGTH, MAX_MATTER_TITLE_LENGTH } from "@openlaw/shared";
import { requireRole } from "../../auth/guards.js";
import { recordActivity, RECORD_ACTIVITY_TIER } from "../../lib/activity.js";
import { CustomFieldsInput, selectAttachedFields } from "../../lib/custom-fields.js";
import { httpError, problemResponse } from "../../lib/problem.js";
import { createContract } from "../contracts/create.js";
import { createMatter } from "../matters/create.js";
import {
  dispositionedResponse,
  dispositionOf,
  NumberParams,
  REQUIRE_TRIAGER,
} from "./disposition.js";
import { moveThread } from "./move-thread.js";
import { withPromotedPaper } from "./promote-paper.js";
import { liveTargetContractType, liveTargetMatterType, StaffRequestSchema } from "./projection.js";
import type { ConversionRecordReference } from "./record-reference.js";

export const requestConvertRoutes: FastifyPluginAsyncZod = async (app) => {
  app.post(
    "/requests/:number/convert",
    {
      preHandler: requireRole(...REQUIRE_TRIAGER),
      schema: {
        operationId: "convertRequest",
        summary:
          "Turn a Request into the contract or matter its request type targets " +
          "(INT-002, DD-018, M22/9). The Request row is locked so racing " +
          "triagers produce one record; the loser receives 409 with the " +
          "reachable converted record's module and permanent number. Triage " +
          "confirms a live bound type, supplies a type for a module-only or " +
          "archived target, or explicitly Re-targets by naming the other " +
          "module's type. A body may name a contract type or a matter type, " +
          "never both. The record is born through its ordinary create callable " +
          "with the title seeded from the Request summary, urgency carried to " +
          "priority, risk unset, no manager, one creator row, and no confidential " +
          "flag. Matching collected values carry server-side; values with no " +
          "field remain on the Request; missing required fields and dead " +
          "references are refused by name and can be answered in customFields. " +
          "Both records narrate the conversion and requestStatusChanged raises " +
          "the Requester's In progress notification. Attachments become ordinary " +
          "root documents and the tiered thread moves onto either target while " +
          "the Request remains the Requester's window. Member+ only",
        tags: ["requests"],
        params: NumberParams,
        // Strict: an unknown key is a client bug, not a silent strip.
        body: z
          .strictObject({
            /** The record's title, seeded from the summary by the dialog
             * and editable there. Its target-aware bound is checked after
             * the locked Request has resolved the conversion module. */
            title: z.string(),
            /** The one choice a triager makes, and only where the request
             * type honestly deferred it or points nowhere.
             *
             * Absent or a real id, never the empty string: a blank choice
             * is no choice, and letting one through would have the route
             * refuse it as a *different* type from the bound one, telling
             * the caller they classified when they picked nothing. */
            contractTypeId: z.string().min(1).optional(),
            /** The matter sibling of contractTypeId. Supplying this on a
             * contract target is the explicit Re-target direction. */
            matterTypeId: z.string().min(1).optional(),
            /** The gaps the form did not collect, keyed by field slug. The
             * carried values are the server's to land and need not be
             * here; a slug the target type does not attach is refused. */
            customFields: CustomFieldsInput.optional(),
          })
          .refine((body) => !(body.contractTypeId && body.matterTypeId), {
            message: "Name either a contract type or a matter type, never both.",
          }),
        response: {
          200: z.object({ request: StaffRequestSchema }),
          409: dispositionedResponse(
            "There is no unnamed 409 on this route — an archived Request answers 404, " +
              "and a missing title, a contradicted target, or an unfilled hard-required " +
              "field answers 400.",
          ),
          default: problemResponse,
        },
      },
    },
    async (request) => {
      // Trimmed here rather than in the schema. The target-aware refusal
      // happens after the locked Request resolves which record is being
      // made; the create callable deliberately validates none of this.
      const title = request.body.title.trim();
      const chosenTypeId = request.body.contractTypeId;
      const chosenMatterTypeId = request.body.matterTypeId;
      const answers = request.body.customFields;

      // The promotion's wrapper sits **outside** the transaction and the
      // disposition alike, because what it owns happens on either side
      // of the commit: the blobs it copied are taken away when the act
      // refuses, and the rounds it appended are asked for their
      // derivations once the act has committed (DOC-012, DOC-004).
      return withPromotedPaper(
        {
          storage: app.storage,
          notifier: app.notifier,
          jobs: app.jobs,
          log: request.log,
        },
        (promote) =>
          dispositionOf(app, request.user, request.params.number, async (tx, held) => {
            // Read inside the transaction, after the lock: the urgency and
            // the collected values this conversion carries have to be the
            // ones the row held when it was held. The target type rides
            // along through the live join, so an archived one arrives as
            // NULL — "conversion reads an archived target type as no type",
            // said by the join rather than by a branch after it. The summary
            // is not read: it seeded the dialog's title box, and what the
            // record is born with is whatever is in that box at the press.
            const [row] = await tx
              .select({
                urgency: requests.urgency,
                customFields: requests.customFields,
                targetModule: requestTypes.targetModule,
                targetContractTypeId: contractTypes.id,
                targetMatterTypeId: matterTypes.id,
              })
              .from(requests)
              .innerJoin(requestTypes, eq(requests.requestTypeId, requestTypes.id))
              .leftJoin(contractTypes, liveTargetContractType())
              .leftJoin(matterTypes, liveTargetMatterType())
              .where(eq(requests.id, held.id))
              .limit(1);
            // Unreachable: the lock read the same row a moment ago and the
            // request type FK is NOT NULL. Loud rather than silent.
            if (!row) throw httpError(500, "The request could not be read for conversion.");

            const target = confirmedTarget(
              {
                module:
                  row.targetModule === "contract" || row.targetModule === "matter"
                    ? row.targetModule
                    : null,
                contractTypeId: row.targetContractTypeId,
                matterTypeId: row.targetMatterTypeId,
              },
              { contractTypeId: chosenTypeId, matterTypeId: chosenMatterTypeId },
            );

            const targetName = target.module === "contract" ? "contract" : "matter";
            if (title === "") {
              throw httpError(
                400,
                `Name the ${targetName} — a conversion is refused without a title.`,
              );
            }
            const titleLimit =
              target.module === "contract" ? MAX_CONTRACT_TITLE_LENGTH : MAX_MATTER_TITLE_LENGTH;
            if (title.length > titleLimit) {
              throw httpError(
                400,
                `Keep the ${targetName}'s title to ${titleLimit} characters or fewer.`,
              );
            }

            // INT-002's carry-through, landed by the server. Every collected
            // value whose slug the target type also attaches, and nothing
            // else — a value with no field to land in stays where it is,
            // readable on the Request, which is the whole of the M19/7
            // addendum's answer. The triager's own answers go on top, so a
            // hard-required gap they filled wins over an absent carry and an
            // edit they made in the dialog wins over the collected value.
            const attached = await selectAttachedFields(
              tx,
              target.module === "contract" ? contractTypeFields : matterTypeFields,
              target.typeId,
            );
            const carried: Record<string, CustomFieldValue | null> = {};
            for (const field of attached) {
              const value = row.customFields[field.slug];
              if (value !== undefined) carried[field.slug] = value;
            }

            const customFields = { ...carried, ...(answers ?? {}) };
            const born =
              target.module === "contract"
                ? await createContract(tx, {
                    actorId: request.user.id,
                    title,
                    contractTypeId: target.typeId,
                    customFields,
                    priority: row.urgency,
                  })
                : await createMatter(tx, {
                    actorId: request.user.id,
                    // The dialog seeds this from the summary. The held
                    // summary remains available for the M22 audit trail;
                    // the editable title follows the existing conversion
                    // contract and the I8 matter modal.
                    title,
                    matterTypeId: target.typeId,
                    customFields,
                    priority: row.urgency,
                    risk: null,
                    managerId: null,
                    isConfidential: false,
                  });
            const record = {
              module: target.module,
              id: born.row.id,
              number: born.row.number,
            } satisfies ConversionRecordReference;

            // INT-002's paper, promoted a file at a time onto the record
            // (#421). Copies rather than moves: the attachment rows and
            // their blobs stay, so the requester's portal detail goes on
            // listing and downloading what they submitted. A Request
            // that carried nothing promotes nothing, and says nothing
            // about having promoted nothing.
            await promote(tx, {
              requestId: held.id,
              target: {
                record,
                primaryDocumentId:
                  record.module === "contract" && "primaryDocumentId" in born.row
                    ? born.row.primaryDocumentId
                    : null,
              },
              actorId: request.user.id,
              actorName: request.user.displayName,
            });

            // CMT-001's thread, moved onto the record beside the paper
            // (#422). Tiers are preserved because the write does not
            // touch them, and each reader's place in the conversation
            // travels with the rows. The rules of the move are
            // `move-thread.ts`'s; what this route owns is that it
            // happens here, inside the transaction that made the record
            // — a conversion that refuses anywhere leaves the
            // conversation exactly where the requester left it.
            await moveThread(tx, {
              requestId: held.id,
              requestNumber: held.number,
              target: record,
              actorId: request.user.id,
            });

            await tx
              .update(requests)
              .set(
                record.module === "contract"
                  ? { status: "converted", convertedContractId: record.id, convertedMatterId: null }
                  : {
                      status: "converted",
                      convertedContractId: null,
                      convertedMatterId: record.id,
                    },
              )
              .where(eq(requests.id, held.id));

            // DD-017 on both records, in the transaction that made them one
            // act. The ask says what it became and the record says where it
            // came from, each by the other's permanent reference, so the
            // trail reads correctly however either is later renamed.
            await recordActivity(tx, {
              entityType: "request",
              entityId: held.id,
              actorId: request.user.id,
              action: "request.converted",
              visibility: RECORD_ACTIVITY_TIER,
              payload:
                record.module === "contract"
                  ? { number: held.number, contractNumber: record.number }
                  : { number: held.number, matterNumber: record.number },
            });
            await recordActivity(tx, {
              entityType: record.module,
              entityId: record.id,
              actorId: request.user.id,
              action:
                record.module === "contract"
                  ? "contract.created_from_request"
                  : "matter.created_from_request",
              visibility: RECORD_ACTIVITY_TIER,
              payload: {
                number: record.number,
                title: born.row.title,
                requestNumber: held.number,
              },
            });

            // Resolve's shape rather than Decline's: the closure is the
            // whole news, and the requester's word for it is "In progress".
            // The audience, the actor exclusion, the preferences, and the
            // after-commit wake-up are all the seam's.
            await app.notifier.requestStatusChanged(tx, {
              requestId: held.id,
              actorId: request.user.id,
              actorName: request.user.displayName,
              from: "new",
              to: "converted",
            });
          }),
      );
    },
  );
};

/**
 * DD-018 rule 2 as one function: the target the Administrator bound
 * wins, and the triager only chooses where there is nothing to confirm.
 *
 * `bound` is the request type's target contract type **read live**, so
 * an archived one arrives here as `null` and the triager is asked for a
 * live one — INT-002's rule that conversion never writes a type the
 * taxonomy has retired. `null` also covers the module-only target, the
 * Matter target, and no target at all; the last two are Re-target, and
 * they are refused only when nothing was chosen.
 *
 * A body that repeats the bound type is accepted, because a client
 * echoing what it was shown has agreed rather than classified. A body
 * that names a different one is refused, because that is the act DD-018
 * takes away from triage.
 *
 * The empty string never reaches here: the schema requires at least one
 * character, so a blank choice is refused as a malformed body rather
 * than read as a type that differs from the bound one.
 */
type ConversionTarget =
  { module: "contract"; typeId: string } | { module: "matter"; typeId: string };

function confirmedTarget(
  bound: {
    module: "contract" | "matter" | null;
    contractTypeId: string | null;
    matterTypeId: string | null;
  },
  chosen: { contractTypeId?: string; matterTypeId?: string },
): ConversionTarget {
  if (chosen.contractTypeId !== undefined) {
    if (
      bound.module === "contract" &&
      bound.contractTypeId !== null &&
      chosen.contractTypeId !== bound.contractTypeId
    ) {
      throw httpError(
        400,
        "This request type already targets a contract type. Triage confirms the routing " +
          "the Administrator bound; it does not choose it.",
      );
    }
    return { module: "contract", typeId: chosen.contractTypeId };
  }
  if (chosen.matterTypeId !== undefined) {
    if (
      bound.module === "matter" &&
      bound.matterTypeId !== null &&
      chosen.matterTypeId !== bound.matterTypeId
    ) {
      throw httpError(
        400,
        "This request type already targets a matter type. Triage confirms the routing " +
          "the Administrator bound; it does not choose it.",
      );
    }
    return { module: "matter", typeId: chosen.matterTypeId };
  }
  if (bound.module === "contract" && bound.contractTypeId !== null) {
    return { module: "contract", typeId: bound.contractTypeId };
  }
  if (bound.module === "matter" && bound.matterTypeId !== null) {
    return { module: "matter", typeId: bound.matterTypeId };
  }
  if (bound.module === "matter") {
    throw httpError(
      400,
      "Pick a matter type — this request type does not name a live one to confirm.",
    );
  }
  throw httpError(
    400,
    "Pick a contract type — this request type does not name a live one to confirm.",
  );
}
