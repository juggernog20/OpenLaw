/* Intake: what the business sends in, and what triage does with it
 * (INT-001 to INT-007).
 *
 * Requests are the one thing the seed cannot author as the legal team.
 * The Requester is the session, never a body field, so each Request is
 * submitted by the Business User whose name is on it, through the same
 * portal route a person uses.
 *
 * All four dispositions are represented, because the Inbox is only worth
 * reviewing when it has work in it and history behind it: some still
 * waiting, some converted into a Contract or a Matter, some answered
 * without a record, some sent back.
 */

import { pool } from "./client.mjs";
import { ALL_COUNTERPARTIES } from "./data.mjs";
import { REQUEST_KINDS } from "./catalog.mjs";
import { customFields } from "./custom-fields.mjs";
import { businessUsers, memberPlus } from "./people.mjs";
import { COMMENT_LINES, DECLINE_REASONS, matterNote, RESOLUTION_REPLIES } from "./prose.mjs";
import { postComment, uploadRequestAttachment } from "./uploads.mjs";
import { daysFromToday } from "./time.mjs";

/** What triage did with a Request, and how often. */
const OUTCOMES = [
  ["new", 5],
  ["converted", 6],
  ["resolved", 4],
  ["declined", 2],
];

export function planRequests(context) {
  const { random, scale } = context;
  const plans = [];
  for (let index = 0; index < scale.requests; index++) {
    const kind = random.pick(REQUEST_KINDS);
    const counterparty = random.pick(ALL_COUNTERPARTIES);
    plans.push({
      kind,
      counterparty,
      summary: random.pick(kind.summaries).replace("{cp}", counterparty),
      description: random.pick(kind.descriptions).replaceAll("{cp}", counterparty),
      urgency: random.weighted([
        ["low", 3],
        ["medium", 7],
        ["high", 3],
        ["critical", 1],
      ]),
      outcome: random.weighted(OUTCOMES),
      hasAttachment: random.chance(0.4),
      hasThread: random.chance(0.5),
    });
  }
  return plans;
}

/** The values a Request Type's attached Fields collect. */
function customFieldsFor(plan, fields, attached, random) {
  const slug = plan.kind.typeSlug;
  const collector = customFields(fields, attached, "request", slug);
  const set = (name, value) => collector.set(name, value);
  if (["nda_request", "contract_review", "vendor_onboarding"].includes(slug)) {
    set("Counterparty name", plan.counterparty);
    if (random.chance(0.7)) set("Needed by", daysFromToday(random.int(2, 40)));
  }
  if (["contract_review", "vendor_onboarding"].includes(slug) && random.chance(0.7)) {
    set("Deal value (USD)", random.int(5, 900) * 1000);
  }
  if (slug === "vendor_onboarding") set("Will they see personal data?", random.chance(0.5));
  if (slug === "employment_question") {
    set(
      "Country",
      random.pick(["United Kingdom", "Germany", "France", "Netherlands", "Spain", "Poland"]),
    );
  }
  return collector.values;
}

/**
 * What happens to a record in the hour after it is converted.
 *
 * The triager keeps it or hands it to a colleague, names the other side,
 * and moves it off the status it was born on. None of that is special to
 * conversion; it is just the first edit any record gets, and without it
 * the newest page of every list is a wall of untouched drafts.
 */
async function workTheRecord(made, triager, plan, random, taxonomy, log) {
  const session = triager.session;
  try {
    if (made.module === "contract") {
      const at = `/api/v1/contracts/${made.number}`;
      await session.request("POST", `${at}/counterparties`, {
        json: { name: plan.counterparty },
        expect: [409, 422],
      });
      const stage = random.weighted([
        ["draft", 3],
        ["review", 5],
        ["approval", 2],
      ]);
      const status = random.pick(
        taxonomy.contractStatuses.rows.filter((row) => row.stage === stage && !row.archivedAt),
      );
      await session.request("PATCH", at, {
        json: {
          managerId: triager.id,
          priority: plan.urgency === "critical" ? "critical" : plan.urgency,
          ...(status ? { statusId: status.id } : {}),
        },
        expect: [400, 409, 422],
      });
      return;
    }
    const at = `/api/v1/matters/${made.number}`;
    const status = random.pick(
      taxonomy.matterStatuses.rows.filter((row) => row.category === "open" && !row.archivedAt),
    );
    await session.request("PATCH", at, {
      json: {
        managerId: triager.id,
        priority: plan.urgency === "critical" ? "critical" : plan.urgency,
        ...(status ? { statusId: status.id } : {}),
      },
      expect: [400, 409, 422],
    });
  } catch (error) {
    // A record that refuses the first edit is worth saying out loud, but
    // it is not worth stopping a seed over.
    log(`  could not work ${made.module} ${made.number}: ${error.message}`);
  }
}

export async function seedRequests(admin, context, log) {
  const { random, taxonomy, people, fields, attached, templates, plans } = context;
  const requesters = businessUsers(people);
  const triagers = memberPlus(people);
  const submitted = [];

  await pool(plans, 3, async (plan, index) => {
    const requester = random.pick(requesters);
    const type = taxonomy.requestTypes.bySlug.get(plan.kind.typeSlug);
    if (!type) return;

    const { body } = await requester.session.post("/api/v1/requests", {
      requestTypeId: type.id,
      summary: plan.summary,
      description: plan.description,
      urgency: plan.urgency,
      customFields: customFieldsFor(plan, fields, attached, random),
    });
    const request = body.request;

    if (plan.hasAttachment) {
      await uploadRequestAttachment(
        requester.session,
        request.number,
        matterNote(`${plan.counterparty} - papers sent with the request`, requester.displayName, [
          "This is what the counterparty sent us. Forwarding it as it arrived.",
          "",
          "There is a second document about pricing that I can send if it helps.",
        ]),
      );
    }

    submitted.push({ ...request, plan, requester });
    if ((index + 1) % 20 === 0) log(`  ${index + 1} of ${plans.length} requests submitted`);
  });
  log(`${submitted.length} requests submitted`);

  // The thread. A Request's conversation is the requester's only window
  // into what is happening, so it is worth having on more than a few.
  let comments = 0;
  await pool(
    submitted.filter((request) => request.plan.hasThread),
    3,
    async (request) => {
      const triager = random.pick(triagers);
      await postComment(triager.session, {
        entityType: "request",
        entityId: request.id,
        body: random.pick(COMMENT_LINES.full_thread),
        visibility: "full_thread",
        mentions: [],
      });
      comments += 1;
      if (random.chance(0.45)) {
        await postComment(request.requester.session, {
          entityType: "request",
          entityId: request.id,
          body: random.pick([
            "Thanks, that works. Nothing needed from me until then.",
            "One correction: the counterparty is the parent company, not the subsidiary.",
            "The deadline moved to the end of the month, so no rush.",
          ]),
          visibility: "full_thread",
          mentions: [],
        });
        comments += 1;
      }
      if (random.chance(0.3)) {
        await postComment(triager.session, {
          entityType: "request",
          entityId: request.id,
          body: random.pick(COMMENT_LINES.legal_only),
          visibility: "legal_only",
          mentions: [],
        });
        comments += 1;
      }
    },
  );
  log(`${comments} request comments`);

  // Triage. One outcome each, by whichever legal member picked it up.
  const outcomes = { converted: 0, resolved: 0, declined: 0, new: 0 };
  await pool(submitted, 3, async (request) => {
    const { plan } = request;
    if (plan.outcome === "new") {
      outcomes.new += 1;
      return;
    }
    const triager = random.pick(triagers);
    const at = `/api/v1/requests/${request.number}`;

    if (plan.outcome === "declined") {
      await triager.session.request("POST", `${at}/decline`, {
        json: { reason: random.pick(DECLINE_REASONS) },
        expect: [200, 409],
      });
      outcomes.declined += 1;
      return;
    }
    if (plan.outcome === "resolved") {
      await triager.session.request("POST", `${at}/resolve`, {
        json: { reply: random.pick(RESOLUTION_REPLIES) },
        expect: [200, 409],
      });
      outcomes.resolved += 1;
      return;
    }

    // Conversion. Which module a Request becomes is the Type's business.
    // A Type already bound to a target is converted with nothing chosen:
    // naming a different type is refused, and naming the same one is
    // noise. Only an unbound Type leaves the choice to the triager.
    const typeRow = taxonomy.requestTypes.bySlug.get(plan.kind.typeSlug);
    const payload = { title: plan.summary.slice(0, 180) };
    const module = typeRow?.targetModule ?? "matter";
    let targetTypeId = typeRow?.targetTypeId ?? null;
    if (!targetTypeId) {
      const type =
        module === "contract"
          ? (taxonomy.contractTypes.bySlug.get("msa") ?? taxonomy.contractTypes.rows[0])
          : (taxonomy.matterTypes.bySlug.get("advisory") ?? taxonomy.matterTypes.rows[0]);
      targetTypeId = type.id;
      if (module === "contract") payload.contractTypeId = type.id;
      else payload.matterTypeId = type.id;
    }
    if (module === "matter") {
      const template = templates.find((row) => row.matterTypeId === targetTypeId);
      if (template && random.chance(0.4)) payload.templateId = template.id;
    }
    // The record a conversion makes is a record like any other, so a
    // required Field on its Type has to be answered here too.
    const targetSlug = (
      module === "contract" ? taxonomy.contractTypes : taxonomy.matterTypes
    ).rows.find((row) => row.id === targetTypeId)?.slug;
    if (targetSlug) {
      const values = customFields(fields, attached, module, targetSlug);
      values.set(
        "Owning department",
        random.pick(["Sales", "Procurement", "Engineering", "People", "Finance", "Marketing"]),
      );
      values.set(
        "Business unit",
        random.pick(["Platform", "Analytics", "Sales", "People", "Group"]),
      );
      values.set("Regulator", "Not applicable");
      values.set("Region", random.pick(["EMEA", "Americas", "APAC"]));
      if (Object.keys(values.values).length > 0) payload.customFields = values.values;
    }
    const { status, body } = await triager.session.request("POST", `${at}/convert`, {
      json: payload,
      expect: [200, 201, 409, 422],
    });
    if (status >= 300) return;
    outcomes.converted += 1;

    // Then the triager picks it up, which is the whole point of
    // converting: a Contract that came out of a Request and was never
    // touched again is a row nobody would recognise, and a list whose
    // newest page is nothing but those reads as an empty instance.
    const made = body.request?.convertedRecord;
    if (made) await workTheRecord(made, triager, plan, random, taxonomy, log);
  });
  log(
    `triage: ${outcomes.converted} converted, ${outcomes.resolved} resolved, ` +
      `${outcomes.declined} declined, ${outcomes.new} still in the inbox`,
  );

  return submitted;
}
