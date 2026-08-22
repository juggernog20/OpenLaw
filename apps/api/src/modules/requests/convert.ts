// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Convert (INT-002, INT-006, INT-007, DD-018, #420): the disposition
 * that turns an ask into work, with everything the requester typed
 * carried straight through.
 *
 * **Triage confirms the routing; it never classifies it** (DD-018 rule
 * 2). The Administrator bound the target when they configured the
 * request type, so this route reads it rather than taking it: a request
 * type naming a live contract type converts onto that type, and a body
 * naming a different one is refused by name. The **one** choice a
 * triager genuinely makes is the one the form honestly deferred — a
 * module-only target ("Contract review") names no type, so the body
 * must, and the same is true of a target type the taxonomy has since
 * archived, which reads as no type at all (the INT-002 M19/4 addendum).
 *
 * **Re-target is the deliberate exception, and it is the only one**
 * (DD-018 rule 5, INT-006). A Request whose type targets a Matter, or
 * targets nothing, may still be converted into a contract, because a
 * mis-routed ask should cost nothing. It is lossless: the Request
 * survives as the requester's portal shell either way. The matter arm
 * of this door is M22's — `matters` does not exist, so there is nothing
 * to offer and nothing stubbed.
 *
 * **The prefill is the point of the whole milestone** (INT-002). The
 * dialog seeds the title from the summary and sends whatever is in the
 * box at the press; the requester's urgency becomes the contract's
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
 * **The record is born ordinary** (the M16 successor rule's sibling,
 * CTR-015): the C-### sequence gives it its number, it starts on the
 * protected draft seed, and no Owner, no team beyond the creator row,
 * and no Confidential flag is inherited from anywhere. A contract born
 * by conversion is a contract, not a special case. The one thing it
 * carries that an ordinary create does not is the priority, because
 * that is a fact somebody stated rather than an assessment nobody made.
 *
 * **Both records narrate it** (DD-017). `request.converted` on the ask
 * names the C-### it became; `contract.created_from_request` on the
 * record names the R-### it came from. Neither carries free text: the
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
 * converted this" without the C-### is news the loser cannot act on.
 *
 * **What is not here, and lands next.** The paper is not promoted into
 * `documents` (#421) and the thread is not re-parented onto the record
 * (#422). Both hang inside this transaction, beside the create, and
 * both are additive: an attachment stays readable on the Request and
 * the thread stays on the Request's own entity pair until they land.
 */

import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";
import {
  contractTypeFields,
  contractTypes,
  eq,
  requestTypes,
  requests,
  type CustomFieldValue,
} from "@openlaw/db";
import { MAX_CONTRACT_TITLE_LENGTH } from "@openlaw/shared";
import { requireRole } from "../../auth/guards.js";
import { recordActivity, RECORD_ACTIVITY_TIER } from "../../lib/activity.js";
import { CustomFieldsInput, selectAttachedFields } from "../../lib/custom-fields.js";
import { httpError, problemResponse } from "../../lib/problem.js";
import { createContract } from "../contracts/create.js";
import {
  dispositionedResponse,
  dispositionOf,
  NumberParams,
  REQUIRE_TRIAGER,
} from "./disposition.js";
import { liveTargetContractType, StaffRequestSchema } from "./projection.js";

export const requestConvertRoutes: FastifyPluginAsyncZod = async (app) => {
  app.post(
    "/requests/:number/convert",
    {
      preHandler: requireRole(...REQUIRE_TRIAGER),
      schema: {
        operationId: "convertRequest",
        summary:
          "Turn a Request into the contract its request type targets " +
          "(INT-002, DD-018). The third of INT-007's three " +
          "dispositions: it transitions the Request from `new` to " +
          "`converted` under the Request's own row lock, so two triagers " +
          "racing one Request produce one contract. The loser is " +
          "answered 409 with the recorded outcome and the record it " +
          "became. Triage confirms the routing rather than choosing it: " +
          "where the request type names a live contract type, that type " +
          "is the target and a body naming a different one is refused. " +
          "`contractTypeId` is required — and only accepted — where the " +
          "request type names no live contract type: a module-only " +
          "target, a target type the taxonomy has archived (read as no " +
          "type), a Matter target, or no target at all. The last two are " +
          "Re-target, DD-018's lossless exception. The contract is born " +
          "ordinary — the C-### sequence, the draft-stage seed, no " +
          "Owner, no team, no Confidential flag — with the title the " +
          "body carries, which the dialog seeds from the summary and " +
          "leaves editable; the requester's urgency as its priority 1:1 " +
          "(MTR-012; risk is never requester-set); " +
          "and every collected value whose slug the target type attaches " +
          "landed in that field. A collected value the target type does " +
          "not attach does not carry and is not deleted: the Request " +
          "keeps its custom fields whole. Empty hard-required fields " +
          "refuse the conversion by name (CTR-016/MTR-014), so " +
          "`customFields` is where the triager answers them. Appends " +
          "request.converted on the ask and contract.created_from_request " +
          "on the record (DD-017), and raises `requestStatusChanged`. " +
          "Answers the Request as the staff detail reads it. Member+ only",
        tags: ["requests"],
        params: NumberParams,
        // Strict: an unknown key is a client bug, not a silent strip.
        body: z.strictObject({
          /** The contract's title, seeded from the summary by the dialog
           * and editable there. Trimmed and then required, so a box of
           * spaces is the same refusal an empty one is. */
          title: z.string().max(MAX_CONTRACT_TITLE_LENGTH),
          /** The one choice a triager makes, and only where the request
           * type honestly deferred it or points nowhere. */
          contractTypeId: z.string().optional(),
          /** The gaps the form did not collect, keyed by field slug. The
           * carried values are the server's to land and need not be
           * here; a slug the target type does not attach is refused. */
          customFields: CustomFieldsInput.optional(),
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
      // Trimmed here rather than in the schema, because the refusal has
      // to name the field and a schema refusal names a path. A title of
      // spaces is a title nobody wrote. The create callable deliberately
      // validates none of this — validation is the caller's, and this is
      // the second caller.
      const title = request.body.title.trim();
      if (title === "") {
        throw httpError(400, "Name the contract — a conversion is refused without a title.");
      }
      const chosenTypeId = request.body.contractTypeId;
      const answers = request.body.customFields;

      return dispositionOf(app, request.user, request.params.number, async (tx, held) => {
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
            targetContractTypeId: contractTypes.id,
          })
          .from(requests)
          .innerJoin(requestTypes, eq(requests.requestTypeId, requestTypes.id))
          .leftJoin(contractTypes, liveTargetContractType())
          .where(eq(requests.id, held.id))
          .limit(1);
        // Unreachable: the lock read the same row a moment ago and the
        // request type FK is NOT NULL. Loud rather than silent.
        if (!row) throw httpError(500, "The request could not be read for conversion.");

        const contractTypeId = confirmedTarget(row.targetContractTypeId, chosenTypeId);

        // INT-002's carry-through, landed by the server. Every collected
        // value whose slug the target type also attaches, and nothing
        // else — a value with no field to land in stays where it is,
        // readable on the Request, which is the whole of the M19/7
        // addendum's answer. The triager's own answers go on top, so a
        // hard-required gap they filled wins over an absent carry and an
        // edit they made in the dialog wins over the collected value.
        const attached = await selectAttachedFields(tx, contractTypeFields, contractTypeId);
        const carried: Record<string, CustomFieldValue | null> = {};
        for (const field of attached) {
          const value = row.customFields[field.slug];
          if (value !== undefined) carried[field.slug] = value;
        }

        const born = await createContract(tx, {
          actorId: request.user.id,
          title,
          contractTypeId,
          customFields: { ...carried, ...(answers ?? {}) },
          // MTR-012's 1:1 map, and the only assessment a newborn record
          // is given: urgency is what the requester claimed, priority is
          // what legal now holds, and they start equal and diverge
          // afterwards. Risk is not set at all.
          priority: row.urgency,
        });

        await tx
          .update(requests)
          .set({ status: "converted", convertedContractId: born.row.id })
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
          payload: { number: held.number, contractNumber: born.row.number },
        });
        await recordActivity(tx, {
          entityType: "contract",
          entityId: born.row.id,
          actorId: request.user.id,
          action: "contract.created_from_request",
          visibility: RECORD_ACTIVITY_TIER,
          payload: {
            number: born.row.number,
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
      });
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
 */
function confirmedTarget(bound: string | null, chosen: string | undefined): string {
  if (bound === null) {
    if (chosen === undefined || chosen === "") {
      throw httpError(
        400,
        "Pick a contract type — this request type does not name a live one to confirm.",
      );
    }
    return chosen;
  }
  if (chosen !== undefined && chosen !== bound) {
    throw httpError(
      400,
      "This request type already targets a contract type. Triage confirms the routing " +
        "the Administrator bound; it does not choose it.",
    );
  }
  return bound;
}
