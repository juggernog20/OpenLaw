/* The contract pipeline (CTR-001 onward).
 *
 * The biggest of the seed's phases, and the one a UX review spends most
 * of its time in. What it is trying to produce is a pipeline that looks
 * like a real one: most contracts active and quiet, a working middle in
 * draft and review, a handful stuck in approval, a few that ended badly.
 *
 * Two kinds of Contract are written, and the difference matters:
 *
 *  - Most are typed in. The term, the value and the dates are set by a
 *    person, so nothing on them is unverified.
 *  - A minority are read. They are created bare, a document is filed, and
 *    the Analysis run fills the term in from the text (CTR-008). Those
 *    carry the Unverified marker until somebody confirms them, which is
 *    the state DES-070 is about and the only way to see it.
 */

import { pool, waitFor } from "./client.mjs";
import { ALL_COUNTERPARTIES, COUNTERPARTIES, CURRENCIES, JURISDICTIONS } from "./data.mjs";
import {
  CONTRACT_KEY_DATES,
  CONTRACT_KINDS,
  CONTRACT_TASKS,
  EMPLOYEE_NAMES,
  OFFICE_CITIES,
} from "./catalog.mjs";
import { COMMENT_LINES, contractDocument, counterpartyRedline } from "./prose.mjs";
import { registerDocument } from "./ai-stub.mjs";
import { customFields } from "./custom-fields.mjs";
import { contributors, memberPlus } from "./people.mjs";
import { documentFile, postComment, uploadDocument, uploadVersion } from "./uploads.mjs";
import { addMonths, daysFromToday, iso } from "./time.mjs";

/** How often each kind of Contract turns up in the pipeline. */
const KIND_WEIGHTS = {
  nda: 22,
  sales: 20,
  msa: 12,
  sow: 12,
  vendor: 14,
  dpa: 9,
  license: 6,
  employment: 6,
  reseller: 5,
  lease: 3,
};

/** Which Counterparty pool a kind draws from. */
const KIND_POOL = {
  vendor: "vendor",
  reseller: "partner",
  employment: null,
  lease: null,
};

const LIABILITY_CAPS = [
  "12 months' fees",
  "24 months' fees",
  "USD 1,000,000",
  "EUR 500,000",
  "the total charges paid in the preceding 12 months",
  "GBP 250,000",
];

function pickCounterparty(kind, random) {
  const pool = KIND_POOL[kind.typeSlug];
  if (pool === null) return null;
  return random.pick(pool ? COUNTERPARTIES[pool] : ALL_COUNTERPARTIES);
}

function buildTitle(kind, random, counterparty) {
  const pattern = random.pick(kind.titles);
  return pattern
    .replace("{cp}", counterparty ?? "Helix")
    .replace("{person}", random.pick(EMPLOYEE_NAMES))
    .replace("{city}", random.pick(OFFICE_CITIES));
}

/**
 * The term the document will state, and therefore what a reader should
 * find in it. Anchored to today so the pipeline never goes stale.
 */
function buildTerm(kind, stage, random) {
  const months = kind.terms.months ? random.pick(kind.terms.months) : null;
  const termType = months
    ? random.weighted([
        ["auto_renew", 5],
        ["fixed", 4],
      ])
    : random.weighted([
        ["evergreen", 3],
        ["fixed", 1],
      ]);

  // Where the contract sits decides where its dates sit. An active one
  // started in the past; one still in review has not started yet.
  const startOffsetDays =
    stage === "active"
      ? -random.int(20, 900)
      : stage === "ended"
        ? -random.int(500, 1600)
        : random.int(5, 60);
  const effectiveDate = daysFromToday(startOffsetDays);
  const expiryDate =
    termType === "evergreen"
      ? null
      : iso(addMonths(new Date(`${effectiveDate}T00:00:00Z`), months ?? random.int(12, 36)));

  const value = kind.terms.value
    ? {
        amount: random.int(kind.terms.value[0], kind.terms.value[1]) * 100,
        currency: random.pick(CURRENCIES),
        cadence: kind.terms.cadence ?? "annually",
      }
    : null;

  return {
    termType,
    effectiveDate,
    expiryDate,
    renewalPeriodMonths: termType === "auto_renew" ? (months ?? 12) : null,
    noticePeriodDays: random.pick([30, 60, 90, 120]),
    value,
  };
}

/**
 * A term whose expiry lands close enough to today that the renewal and
 * notice surfaces have something to show. Applied to a slice of the
 * active contracts, because a dashboard with no deadlines on it is a
 * dashboard nobody can review.
 */
function pullExpiryForward(term, random) {
  if (!term.expiryDate) return term;
  const daysOut = random.weighted([
    [random.int(-40, -3), 2],
    [random.int(1, 30), 4],
    [random.int(31, 90), 4],
  ]);
  const expiryDate = daysFromToday(daysOut);
  return {
    ...term,
    expiryDate,
    effectiveDate: iso(
      addMonths(new Date(`${expiryDate}T00:00:00Z`), -(term.renewalPeriodMonths ?? 12)),
    ),
  };
}

/** Plans the whole pipeline before a single call is made. */
export function planContracts(context) {
  const { random, scale } = context;
  const weighted = CONTRACT_KINDS.map((kind) => [kind, KIND_WEIGHTS[kind.typeSlug] ?? 4]);
  const plans = [];

  for (let index = 0; index < scale.contracts; index++) {
    const kind = random.weighted(weighted);
    const stage = random.weighted(kind.stageWeights);
    const counterparty = pickCounterparty(kind, random);
    let term = buildTerm(kind, stage, random);
    if (stage === "active" && random.chance(0.32)) term = pullExpiryForward(term, random);

    plans.push({
      kind,
      stage,
      counterparty,
      title: buildTitle(kind, random, counterparty),
      term,
      priority: random.weighted([
        ["low", 3],
        ["medium", 8],
        ["high", 4],
        ["critical", 1],
      ]),
      risk: random.weighted([
        ["low", 6],
        ["medium", 6],
        ["high", 2],
        ["critical", 1],
        [null, 2],
      ]),
      governingLaw: random.pick(JURISDICTIONS),
      liabilityCap: random.pick(LIABILITY_CAPS),
      isConfidential: random.chance(0.07),
      // Read rather than typed: created bare so the Analysis run is the
      // thing that fills the term in.
      aiRead: stage !== "draft" && random.chance(0.17),
      hasDocuments: stage === "draft" ? random.chance(0.5) : random.chance(0.82),
      hasRedline: random.chance(0.3),
      // A Word pair is what the comparison export needs, and a Word file
      // is also the slowest thing the seed asks the doc engine for: every
      // one is a LibreOffice conversion before its text can be read. So
      // only some of the redlined deals are on Word paper, and the rest
      // exchange PDFs, which counterparties do too.
      wordPair: random.chance(0.15),
      hasTasks: random.chance(0.45),
      hasKeyDates: random.chance(0.35),
      hasComments: random.chance(0.55),
      archived: random.chance(0.04),
    });
  }
  return plans;
}

/** The status row a plan's stage should land on. */
function statusFor(stage, taxonomy, random) {
  const candidates = taxonomy.contractStatuses.rows.filter(
    (status) => status.stage === stage && !status.archivedAt,
  );
  return random.pick(candidates) ?? taxonomy.contractStatuses.rows[0];
}

/** The custom values a Contract of this kind carries, filtered to the
 * Fields its Type actually collects. */
function customFieldsFor(plan, fields, attached, random, people) {
  const collector = customFields(fields, attached, "contract", plan.kind.typeSlug);
  const set = (name, value) => collector.set(name, value);
  set(
    "Owning department",
    random.pick(["Sales", "Procurement", "Engineering", "People", "Finance", "Marketing"]),
  );
  set("Security review", random.pick(["Not required", "Requested", "In progress", "Complete"]));
  set("Processes personal data", random.chance(0.45));
  set("Liability cap", plan.liabilityCap);
  set(
    "Territories",
    random.sample(["United Kingdom", "European Union", "United States", "APAC"], random.int(1, 3)),
  );
  set("Deal desk reference", `DD-${random.int(1000, 9999)}`);
  set("Region", random.pick(["EMEA", "Americas", "APAC"]));
  if (random.chance(0.6)) set("Business sponsor", random.pick(people).id);
  if (plan.stage === "active" && random.chance(0.5)) {
    set("Signed copy filed on", daysFromToday(-random.int(1, 300)));
  }
  set("Governing law", plan.governingLaw);
  return collector.values;
}

/** The document text a Contract is drafted from, and what it says. */
function draftFor(plan, reference, ourEntity, fields) {
  const document = contractDocument({
    title: plan.title,
    reference,
    ourEntity: ourEntity.legalName,
    counterparty: plan.counterparty ?? "the individual named above",
    effectiveDate: plan.term.effectiveDate,
    expiryDate: plan.term.expiryDate ?? daysFromToday(365),
    termType: plan.term.termType,
    renewalMonths: plan.term.renewalPeriodMonths ?? 12,
    noticeDays: plan.term.noticePeriodDays,
    value: plan.term.value
      ? { ...plan.term.value, amount: Math.round(plan.term.value.amount / 100) }
      : null,
    governingLaw: plan.governingLaw,
    jurisdiction: plan.governingLaw,
    liabilityCap: plan.liabilityCap,
  });

  // The seeded extraction Fields are targets too, once their Type
  // collects them, so the stand-in has to be able to answer for them.
  const answers = { ...document.expected };
  answers.governing_law = {
    value: plan.governingLaw,
    evidence: `6.4 This agreement is governed by the law of ${plan.governingLaw}.`,
  };
  answers.jurisdiction = {
    value: plan.governingLaw,
    evidence: `6.5 The courts of ${plan.governingLaw} have exclusive jurisdiction over any dispute arising out of this agreement.`,
  };
  answers.our_position = {
    value: "Provider",
    evidence: `This agreement is made between ${ourEntity.legalName} and ${plan.counterparty ?? "the counterparty"}.`,
  };
  const cap = fields.byName.get("Liability cap");
  if (cap) {
    answers[cap.slug] = {
      value: plan.liabilityCap,
      evidence: `4.1 Each party's total liability arising out of or in connection with this agreement is limited to ${plan.liabilityCap}.`,
    };
  }
  return { document, answers };
}

export async function seedContracts(admin, context, log) {
  const { random, taxonomy, people, fields, attached, entities, plans, analysisEnabled } = context;
  const staff = memberPlus(people);
  const helpers = contributors(people);
  const entityRows = [...entities.values()].filter((row) => row.definition.status === "active");
  const contracts = [];

  await pool(plans, 4, async (plan, index) => {
    const owner = random.pick(staff);
    const author = owner.session;
    const ourEntity = random.pick(entityRows);
    const type = taxonomy.contractTypes.bySlug.get(plan.kind.typeSlug);
    if (!type) return;

    // The custom values go on the create, not on the edit that follows:
    // a Type with a required Field refuses a record that arrives without
    // it, which is the same thing the new-contract form enforces.
    const { body: made } = await author.post("/api/v1/contracts", {
      title: plan.title,
      contractTypeId: type.id,
      isConfidential: plan.isConfidential,
      customFields: customFieldsFor(plan, fields, attached, random, staff),
    });
    const contract = made.contract;
    const at = `/api/v1/contracts/${contract.number}`;

    if (plan.counterparty) {
      // The first party added is the primary already, so there is nothing
      // to promote. A minority of deals carry a second name on the paper,
      // which is what makes the primary distinction worth drawing.
      await author.post(`${at}/counterparties`, { name: plan.counterparty });
      if (random.chance(0.12)) {
        await author.post(`${at}/counterparties`, {
          name: random.pick(ALL_COUNTERPARTIES.filter((name) => name !== plan.counterparty)),
        });
      }
    }

    // A read contract is left bare on purpose: the Analysis run is what
    // fills the term in, and it only writes where nothing is set.
    await author.patch(at, {
      managerId: owner.id,
      entityId: ourEntity.id,
      priority: plan.priority,
      risk: plan.risk,
      ...(plan.aiRead
        ? {}
        : {
            termType: plan.term.termType,
            effectiveDate: plan.term.effectiveDate,
            expiryDate: plan.term.expiryDate,
            renewalPeriodMonths: plan.term.renewalPeriodMonths,
            noticePeriodDays: plan.term.noticePeriodDays,
            value: plan.term.value,
          }),
    });

    // The working team. A Contributor on one deal in six is what makes
    // the reach rules visible (DD-015). The team is remembered because a
    // confidential Contract is reachable by nobody else (DD-016), so the
    // people who comment on it and approve it have to come from here.
    const team = [owner];
    for (const member of random.sample(
      staff.filter((person) => person.id !== owner.id),
      random.int(1, 3),
    )) {
      const role = random.weighted([
        ["member", 4],
        ["watcher", 2],
      ]);
      await author.post(`${at}/team`, { userId: member.id, role });
      team.push(member);
    }
    if (random.chance(0.16) && helpers.length > 0) {
      const helper = random.pick(helpers);
      await author.post(`${at}/team`, { userId: helper.id, role: "contributor" });
    }

    contracts.push({
      ...contract,
      plan,
      owner,
      ourEntity,
      author,
      at,
      team,
      // The reference the document text carries and the signature
      // request quotes, so both can be traced back to this record.
      reference: `HX-C${String(contract.number).padStart(5, "0")}`,
    });
    if ((index + 1) % 25 === 0) log(`  ${index + 1} of ${plans.length} contracts created`);
  });
  log(`${contracts.length} contracts created`);

  // Paper. Uploaded before the status moves, because a document filed
  // against a signed contract is the odd case rather than the normal one.
  let documents = 0;
  await pool(
    contracts.filter((contract) => contract.plan.hasDocuments),
    3,
    async (contract) => {
      const { plan, author, at, ourEntity, reference } = contract;
      const { document, answers } = draftFor(plan, reference, ourEntity, fields);
      // The stand-in is taught the text before the file exists, so the
      // automatic run cannot outrun the registration. It is keyed on the
      // reference rather than the title: a title wraps when the file is
      // converted, and half a title matches nothing.
      registerDocument(reference, answers);

      const folderPath = random.chance(0.35)
        ? random.pick(["Drafts", "Signed", "Correspondence"])
        : undefined;
      // The export only has a tracked-changes file to write when both
      // sides of the pair are Word files (DOC-003), so the Word pairs are
      // drafted in Word and everything else in PDF.
      const wordPair = plan.hasRedline && plan.wordPair;
      const filed = await uploadDocument(author, `${at}/documents`, document, {
        kind: "draft_ours",
        note: "First draft on our paper.",
        folderPath,
        format: wordPair ? "docx" : "pdf",
      });
      documents += 1;
      contract.documentId = filed?.id;

      if (plan.hasRedline && filed) {
        const redline = counterpartyRedline(document, {
          noticeDays: 60,
          liabilityCap: "the total charges paid in the preceding 12 months",
        });
        await uploadVersion(author, filed.id, redline, {
          kind: "redline_theirs",
          note: "Their mark-up. Payment terms and assignment moved.",
          format: wordPair ? "docx" : "pdf",
        });
        documents += 1;
      }

      if (["active", "ended"].includes(plan.stage) && filed && random.chance(0.6)) {
        await uploadVersion(author, filed.id, document, {
          kind: "executed",
          note: "Countersigned copy received.",
        });
        documents += 1;
      }
    },
  );
  log(`${documents} contract documents filed`);

  // The runs the uploads triggered.
  //
  // Filing a document on a Contract queues an automatic run, so this
  // happens on far more records than the bare ones: an Analysis writes
  // wherever the Contract holds nothing, which on a typed-in Contract
  // means the extraction Fields rather than the term. The result is that
  // most of the pipeline ends up carrying unverified values, and an
  // instance where half the records wear the marker says nothing about
  // what the marker means. So they are confirmed on most and left on a
  // minority, which is the picture a team a few months into using this
  // would actually have.
  const documented = contracts.filter((contract) => contract.documentId);
  if (analysisEnabled && documented.length > 0) {
    log(`waiting for ${documented.length} analysis runs`);
    let carrying = 0;
    let confirmed = 0;
    let unsettled = 0;
    await pool(documented, 4, async (contract) => {
      let record;
      try {
        record = await waitFor(
          `analysis on contract ${contract.number}`,
          async () => {
            const { body } = await contract.author.get(contract.at);
            const state = body.analysis?.latestRun?.state;
            return state && state !== "pending" ? body : null;
          },
          { timeoutMs: 180_000, everyMs: 2000 },
        );
      } catch {
        unsettled += 1;
        return;
      }
      if (Object.keys(record.contract?.aiUnverified ?? {}).length === 0) return;
      carrying += 1;
      // The bare ones are the point of the exercise, so they are the ones
      // most likely to be left showing their working.
      const confirms = contract.plan.aiRead ? random.chance(0.55) : random.chance(0.88);
      if (!confirms) return;
      await contract.author.request("POST", `${contract.at}/analysis/confirm-all`, {
        expect: [200, 204, 400, 404, 409],
      });
      confirmed += 1;
    });
    log(
      `  ${carrying} carried unverified values, ${confirmed} confirmed, ` +
        `${carrying - confirmed} left unverified` +
        (unsettled > 0 ? `, ${unsettled} runs did not settle` : ""),
    );
  }

  // Approvals, then the status move they gate (CTR-011, CTR-012).
  let approvals = 0;
  let overrides = 0;
  await pool(contracts, 4, async (contract) => {
    const { plan, author, at } = contract;
    const needsApproval = ["approval", "signature", "active", "ended"].includes(plan.stage);
    let unresolved = false;
    const approvers =
      needsApproval && random.chance(0.55)
        ? random.sample(
            contract.team.filter((person) => person.id !== contract.owner.id),
            random.int(1, 2),
          )
        : [];
    // A Contract whose team is the owner alone has nobody to ask, and
    // that is not a reason to leave it in draft: the status move below
    // has to happen either way.
    if (approvers.length > 0) {
      const { body } = await author.post(`${at}/approvals`, {
        approverIds: approvers.map((person) => person.id),
      });
      approvals += approvers.length;
      for (const [position, approval] of (body.approvals ?? []).entries()) {
        const approver = approvers[position];
        if (!approver) continue;
        // A contract still in approval is meant to have somebody waiting
        // on it; anything further along was signed off first.
        if (plan.stage === "approval" && random.chance(0.7)) {
          unresolved = true;
          continue;
        }
        const decision = random.chance(0.9) ? "approved" : "rejected";
        if (decision === "rejected") unresolved = true;
        await approver.session.post(`/api/v1/approvals/${approval.id}/decision`, {
          decision,
          note:
            decision === "approved"
              ? random.pick([
                  "Fine on the commercial terms.",
                  "Approved. Cap is within policy.",
                  "No objection from Finance.",
                ])
              : "The liability position is outside policy. Please renegotiate the cap.",
        });
      }
    }

    if (plan.stage === "draft") return;
    const status = statusFor(plan.stage, taxonomy, random);
    const crossesApproval = ["signature", "active", "ended"].includes(plan.stage);
    const payload = { statusId: status.id };
    if (unresolved && crossesApproval) {
      payload.overrideSoftGate = true;
      overrides += 1;
    }
    await author.request("PATCH", at, { json: payload, expect: [200, 409] });
  });
  log(`${approvals} approvals requested, ${overrides} soft-gate overrides`);

  // Confirmed renewal rolls (CTR-006, CTR-007).
  //
  // An auto-renewing Contract whose expiry has passed reads as "renewal
  // pending confirmation" on its own, because that is a predicate over
  // its dates rather than a status. Several of the active ones are in
  // that state by construction. Rolling some of them forward is what
  // gives the renewal history something to read back, and leaving the
  // rest is what keeps the pending state on the screen.
  let rolled = 0;
  for (const contract of contracts.filter((row) => row.plan.stage === "active")) {
    const { body } = await contract.author.get(contract.at);
    if (!body.contract?.renewalPendingConfirmation) continue;
    if (!random.chance(0.5)) continue;
    const { status } = await contract.author.request("POST", `${contract.at}/renewal`, {
      json: {
        fromExpiry: body.contract.expiryDate,
        toExpiry: body.contract.proposedRenewalExpiry,
      },
      expect: [200, 409, 422],
    });
    if (status < 300) rolled += 1;
  }
  log(`${rolled} renewals confirmed`);

  // Tasks, deadlines, and the conversation.
  let tasks = 0;
  let keyDates = 0;
  let comments = 0;
  await pool(contracts, 4, async (contract) => {
    const { plan, author, at } = contract;

    if (plan.hasTasks) {
      for (const title of random.sample(CONTRACT_TASKS, random.int(1, 4))) {
        const { body } = await author.post(`${at}/tasks`, {
          title,
          assigneeId: random.chance(0.7) ? random.pick(contract.team).id : null,
          dueDate: random.chance(0.75) ? daysFromToday(random.int(-14, 60)) : null,
        });
        tasks += 1;
        const made = (body.tasks ?? []).find((task) => task.title === title);
        if (made && random.chance(0.4)) await author.post(`/api/v1/tasks/${made.id}/toggle`);
      }
    }

    if (plan.hasKeyDates) {
      for (const label of random.sample(CONTRACT_KEY_DATES, random.int(1, 2))) {
        await author.post(`${at}/key-dates`, {
          label,
          date: daysFromToday(random.int(-20, 240)),
          note: random.chance(0.4) ? "Diarised with the deal owner." : null,
        });
        keyDates += 1;
      }
    }

    if (plan.hasComments) {
      const speakers = random.sample(contract.team, random.int(1, 3));
      for (const speaker of speakers) {
        const visibility = random.weighted([
          ["working_team", 5],
          ["legal_only", 3],
          ["full_thread", 2],
        ]);
        const mentions =
          random.chance(0.3) && speakers.length > 1
            ? [random.pick(speakers.filter((person) => person.id !== speaker.id))?.id].filter(
                Boolean,
              )
            : [];
        // One comment in eight carries a file, which is how paper
        // arrives after a Contract is under way (CMT-011).
        const files =
          random.chance(0.12) && visibility !== "legal_only"
            ? [
                documentFile(
                  {
                    title: `${plan.title} - counterparty note`,
                    paragraphs: [
                      "",
                      "Sent through by the counterparty with their comments on the draft.",
                      "",
                      "They have asked us to confirm the signing entity before the next round.",
                    ],
                  },
                  "pdf",
                ),
              ]
            : [];
        await postComment(
          speaker.session,
          {
            entityType: "contract",
            entityId: contract.id,
            body: random.pick(COMMENT_LINES[visibility]),
            visibility,
            mentions,
          },
          files,
        );
        comments += 1;
      }
    }
  });
  log(`${tasks} contract tasks, ${keyDates} key dates, ${comments} comments`);

  // Families: amendments and renewals, so the relations panel and the
  // renewal chain have something in them (CTR-015, CTR-016).
  // Only between records everybody can reach: a confidential Contract is
  // absent to somebody who is not on it, so a relation drawn from the
  // outside answers 404 rather than refusing on the merits.
  const open = contracts.filter((contract) => !contract.plan.isConfidential);
  const active = open.filter((contract) => contract.plan.stage === "active");
  let relations = 0;
  for (const parent of random.sample(active, Math.min(24, active.length))) {
    const child = random.pick(open.filter((row) => row.number !== parent.number));
    if (!child) continue;
    const { status } = await parent.author.request("POST", `${parent.at}/relations`, {
      json: {
        relatedContractNumber: child.number,
        relationType: random.pick(["related", "amends", "renews"]),
      },
      expect: [200, 201, 404, 409, 422],
    });
    if (status < 300) relations += 1;
  }
  log(`${relations} contract relations`);

  // Archived contracts, last, so they were live for everything above.
  let archived = 0;
  for (const contract of contracts.filter((row) => row.plan.archived)) {
    await contract.author.request("POST", `${contract.at}/archive`, { expect: [200, 204, 409] });
    archived += 1;
  }
  log(`${archived} contracts archived`);

  return contracts;
}

/**
 * Compares the two most recent Versions of a Contract's primary document
 * (DOC-003), on the records that have two.
 *
 * A Comparison is computed once and kept, so seeding one is the only way
 * the compare surfaces have anything to open. The text pair is enough:
 * both operands come from the same generator, and the redline moves three
 * clauses, which is a diff a person can read at a glance.
 */
export async function seedComparisons(contracts, random, log) {
  // The Word pairs first, because those are the ones whose comparison can
  // also be exported; the PDF pairs still compare, they just have no
  // tracked-changes file to write.
  // Archived contracts are out: a comparison export appends a version,
  // and an archived record takes no new paper.
  const withRedlines = contracts.filter(
    (contract) => contract.plan.hasRedline && contract.documentId && !contract.plan.archived,
  );
  const ranked = [
    ...withRedlines.filter((contract) => contract.plan.wordPair),
    ...random.shuffle(withRedlines.filter((contract) => !contract.plan.wordPair)),
  ];
  const chosen = ranked.slice(0, 24);
  let made = 0;
  let exported = 0;

  await pool(chosen, 3, async (contract) => {
    const { body } = await contract.author.get(`${contract.at}/documents`);
    const document = (body.documents ?? []).find((row) => row.id === contract.documentId);
    const versions = document?.versions ?? [];
    if (versions.length < 2) return;
    // Our draft against their mark-up, which is the pair a reviewer
    // actually asks for. It is also the only pair that can be exported:
    // both halves are Word files, and an executed PDF appended later is
    // not something anybody wants a redline of.
    const ordered = [...versions].sort((a, b) => a.versionNumber - b.versionNumber);
    const from = ordered[0];
    const to = ordered[1];
    if (!from || !to) return;

    const { status, body: answer } = await contract.author.request(
      "POST",
      `/api/v1/documents/${contract.documentId}/comparisons`,
      { json: { fromVersionId: from.id, toVersionId: to.id }, expect: [200, 202, 409, 422] },
    );
    if (status >= 300) return;
    made += 1;

    // Every Word pair is exported, which appends a generated redline to
    // the chain and is the other half of what the feature does. Only a
    // Word pair can be: a text comparison has no tracked-changes file to
    // write. There are few enough of them that leaving it to chance
    // reliably produced none. The export also needs the comparison to be
    // computed, and a queued one answers 202, so wait for it first.
    const comparisonId = answer?.comparison?.id;
    if (!comparisonId || answer.comparison.mode !== "word") return;
    const at = `/api/v1/documents/${contract.documentId}/comparisons/${comparisonId}`;
    let ready = answer.comparison.state === "ready";
    if (!ready) {
      try {
        ready =
          (await waitFor(
            `comparison on contract ${contract.number}`,
            async () => {
              const { body: read } = await contract.author.get(at);
              const state = read.comparison?.state;
              return state === "pending" ? null : state;
            },
            { timeoutMs: 60_000, everyMs: 1000 },
          )) === "ready";
      } catch {
        ready = false;
      }
    }
    if (!ready) return;
    const { status: exportStatus } = await contract.author.request("POST", `${at}/export`, {
      expect: [200, 201, 202, 409, 422],
    });
    if (exportStatus < 300) exported += 1;
  });
  log(`${made} comparisons, ${exported} exported as generated redlines`);
}
