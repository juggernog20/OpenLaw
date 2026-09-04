/* The words inside the files.
 *
 * Every generated Contract document says the same seven things in the
 * same seven ways, because two readers depend on the phrasing: the text
 * comparison, which is only interesting when two versions differ in a
 * way a person would notice, and the AI stand-in, which extracts the
 * CTR-008 target schema out of the text the way a real provider would.
 *
 * The clause wording is plain rather than authentic. Nobody is meant to
 * sign these.
 */

const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

/** `2026-01-15` as `15 January 2026`, the way the clauses write it. */
export function longDate(iso) {
  const [year, month, day] = iso.split("-").map(Number);
  return `${day} ${MONTHS[month - 1]} ${year}`;
}

/** A money amount as the clauses write it: `USD 125,000`. */
export function money(currency, amount) {
  return `${currency} ${amount.toLocaleString("en-US")}`;
}

/**
 * One Contract's document text, plus the values a reader should be able
 * to pull back out of it.
 *
 * `expected` is what the AI stand-in answers when it is asked to read
 * this text: the same values, in the wire shape CTR-008 uses. Keeping
 * the two side by side is what stops the extraction from being a guess.
 */
export function contractDocument(deal) {
  const {
    title,
    reference,
    ourEntity,
    counterparty,
    effectiveDate,
    expiryDate,
    termType,
    renewalMonths,
    noticeDays,
    value,
    governingLaw,
    jurisdiction,
    liabilityCap,
  } = deal;

  const paragraphs = [
    "",
    // The reference is how a reader of this text finds its way back to
    // the record, and it is deliberately one short unbreakable token: a
    // title long enough to wrap is a title no reader can match on.
    `Our reference: ${reference}`,
    "",
    `This agreement is made between ${ourEntity} and ${counterparty}.`,
    "",
    "1. Term",
    "",
    `1.1 This agreement is effective on ${longDate(effectiveDate)}.`,
  ];

  if (termType === "evergreen") {
    paragraphs.push(
      "1.2 This agreement continues until either party terminates it in accordance with clause 1.3.",
      `1.3 Either party may terminate this agreement by giving ${noticeDays} days written notice.`,
    );
  } else if (termType === "auto_renew") {
    paragraphs.push(
      `1.2 The initial term ends on ${longDate(expiryDate)}.`,
      `1.3 The term renews automatically for successive ${renewalMonths} month periods.`,
      `1.4 Either party may prevent renewal by giving ${noticeDays} days written notice before the end of the then current term.`,
    );
  } else {
    paragraphs.push(
      `1.2 The term ends on ${longDate(expiryDate)}.`,
      "1.3 The term does not renew automatically. Any extension must be agreed in writing.",
      `1.4 Either party may terminate for material breach by giving ${noticeDays} days written notice.`,
    );
  }

  paragraphs.push("", "2. Charges", "");
  if (value) {
    const cadence =
      value.cadence === "annually" ? "annual" : value.cadence === "monthly" ? "monthly" : "total";
    paragraphs.push(
      `2.1 The ${cadence} charge under this agreement is ${money(value.currency, value.amount)}.`,
      "2.2 Charges are invoiced in advance and payable within 30 days of the invoice date.",
      "2.3 Charges exclude value added tax and any equivalent sales tax.",
    );
  } else {
    paragraphs.push(
      "2.1 No charges are payable under this agreement.",
      "2.2 Each party bears its own costs of performing this agreement.",
    );
  }

  paragraphs.push(
    "",
    "3. Confidentiality",
    "",
    "3.1 Each party will keep the other party's confidential information confidential and will use it only for the purpose of this agreement.",
    "3.2 The obligations in clause 3.1 continue for three years after this agreement ends.",
    "3.3 Neither party is required to keep information confidential that is or becomes public through no fault of the receiving party.",
    "",
    "4. Liability",
    "",
    `4.1 Each party's total liability arising out of or in connection with this agreement is limited to ${liabilityCap}.`,
    "4.2 Neither party excludes liability for death or personal injury caused by its negligence, or for fraud.",
    "4.3 Neither party is liable for loss of profit, loss of business or indirect loss.",
    "",
    "5. Data protection",
    "",
    "5.1 Where a party processes personal data on behalf of the other, it does so only on documented instructions.",
    "5.2 The data processing addendum attached to this agreement applies to that processing.",
    "",
    "6. General",
    "",
    "6.1 This agreement is the entire agreement between the parties on its subject matter.",
    "6.2 A variation of this agreement is effective only if it is in writing and signed by both parties.",
    "6.3 Neither party may assign this agreement without the other party's written consent, which will not be unreasonably withheld.",
    `6.4 This agreement is governed by the law of ${governingLaw}.`,
    `6.5 The courts of ${jurisdiction} have exclusive jurisdiction over any dispute arising out of this agreement.`,
    "",
    "Signed for and on behalf of the parties.",
    "",
    ourEntity,
    "Name:",
    "Title:",
    "Date:",
    "",
    counterparty,
    "Name:",
    "Title:",
    "Date:",
  );

  const expected = {
    term_type: {
      value: termType,
      evidence:
        termType === "auto_renew"
          ? `1.3 The term renews automatically for successive ${renewalMonths} month periods.`
          : termType === "evergreen"
            ? "1.2 This agreement continues until either party terminates it in accordance with clause 1.3."
            : "1.3 The term does not renew automatically. Any extension must be agreed in writing.",
    },
    effective_date: {
      value: effectiveDate,
      evidence: `1.1 This agreement is effective on ${longDate(effectiveDate)}.`,
    },
    expiry_date:
      termType === "evergreen"
        ? { value: null, evidence: null }
        : {
            value: expiryDate,
            evidence:
              termType === "auto_renew"
                ? `1.2 The initial term ends on ${longDate(expiryDate)}.`
                : `1.2 The term ends on ${longDate(expiryDate)}.`,
          },
    renewal_period_months:
      termType === "auto_renew"
        ? {
            value: renewalMonths,
            evidence: `1.3 The term renews automatically for successive ${renewalMonths} month periods.`,
          }
        : { value: null, evidence: null },
    notice_period_days: {
      value: noticeDays,
      evidence:
        termType === "auto_renew"
          ? `1.4 Either party may prevent renewal by giving ${noticeDays} days written notice before the end of the then current term.`
          : termType === "evergreen"
            ? `1.3 Either party may terminate this agreement by giving ${noticeDays} days written notice.`
            : `1.4 Either party may terminate for material breach by giving ${noticeDays} days written notice.`,
    },
    value: value
      ? {
          // The wire shape stores minor units, the way the API does.
          value: { amount: value.amount * 100, currency: value.currency, cadence: value.cadence },
          evidence: `2.1 The ${value.cadence === "annually" ? "annual" : value.cadence === "monthly" ? "monthly" : "total"} charge under this agreement is ${money(value.currency, value.amount)}.`,
        }
      : { value: null, evidence: null },
    counterparty: {
      value: counterparty,
      evidence: `This agreement is made between ${ourEntity} and ${counterparty}.`,
    },
  };

  return { title, paragraphs, expected };
}

/**
 * The counterparty's mark-up of a draft: the same document with three
 * clauses moved, so a comparison has something to show and a reviewer can
 * see at a glance whether the diff reads well.
 */
export function counterpartyRedline(document, { noticeDays, liabilityCap }) {
  const paragraphs = document.paragraphs.map((line) => {
    if (/^1\.4 Either party may prevent renewal/.test(line)) {
      return `1.4 Either party may prevent renewal by giving ${noticeDays} days written notice before the end of the then current term.`;
    }
    if (/^4\.1 Each party's total liability/.test(line)) {
      return `4.1 Each party's total liability arising out of or in connection with this agreement is limited to ${liabilityCap}.`;
    }
    if (/^2\.2 Charges are invoiced in advance/.test(line)) {
      return "2.2 Charges are invoiced in arrears and payable within 60 days of the invoice date.";
    }
    if (/^6\.3 Neither party may assign/.test(line)) {
      return "6.3 Either party may assign this agreement to an affiliate or in connection with a change of control, on written notice.";
    }
    return line;
  });
  paragraphs.push(
    "",
    "Counterparty comments",
    "",
    "We have moved payment to 60 days to match our standard terms, and we need the assignment clause to permit an intra-group transfer.",
  );
  return { ...document, paragraphs };
}

/** The advice note a Matter accumulates. */
export function matterNote(title, author, paragraphs) {
  return {
    title,
    paragraphs: [
      "",
      `Prepared by ${author}.`,
      "",
      "Background",
      "",
      ...paragraphs,
      "",
      "Next steps",
      "",
      "The actions agreed at the last review are recorded as tasks on this matter. This note will be updated when the position changes.",
      "",
      "This note is legal advice and is privileged. Do not forward it outside the legal team without asking first.",
    ],
  };
}

/** The statutory paper an Entity holds. */
export function entityDocument(title, entity, paragraphs) {
  return {
    title,
    paragraphs: [
      "",
      `${entity.legalName}`,
      `Registered in ${entity.jurisdiction}${entity.registrationNumber ? ` under number ${entity.registrationNumber}` : ""}.`,
      "",
      ...paragraphs,
    ],
  };
}

/** A Knowledge Item's attached file: the item's own body, set as a document. */
export function knowledgeDocument(item) {
  return {
    title: item.title,
    paragraphs: ["", item.body, "", "This document is maintained by the Helix legal team."],
  };
}

/** Wording the seed drops into comments, so threads read like conversations. */
export const COMMENT_LINES = {
  legal_only: [
    "Holding a note here for the file: the counterparty's first position on liability was uncapped, and we did not accept it.",
    "Worth flagging that this is the third deal this quarter where the same clause has come back. We should update the playbook.",
    "I have asked external counsel for a view on the local law point. Costs are within the approved budget.",
    "Privately, I think we can live with the payment terms if they move on the cap. Do not share that with the business yet.",
    "Note for whoever picks this up next: the previous version of this agreement is on the record as a related contract.",
  ],
  working_team: [
    "Draft is with the counterparty. I have asked for comments by the end of next week.",
    "Security review came back clean, so the only open point is the notice period.",
    "I have accepted their change to clause 2.2 and pushed back on clause 6.3. Updated version attached.",
    "Can you confirm the signing entity before this goes out? The order form still names the wrong company.",
    "Finance have approved the value, so this can move to signature once the redline is agreed.",
    "Chasing again. No response since Tuesday.",
  ],
  full_thread: [
    "Thanks for raising this. Picking it up now and I will come back to you by Thursday.",
    "We can use our standard form here, which should be quicker than reviewing theirs.",
    "This is with the counterparty. Nothing needed from you until they come back.",
    "Signed copy is filed against this record. You should have a copy in your inbox as well.",
    "One question before I start: is there a fixed date you need this by, or is next week fine?",
    "All done from our side. Shout if anything changes on the commercial terms.",
  ],
};

/** Replies a Request gets when the legal team resolves it. */
export const RESOLUTION_REPLIES = [
  "Answered directly with the requester. No record needed for this one.",
  "Covered by the existing agreement, so nothing new to put in place. I have pointed them at the clause.",
  "The business decided not to go ahead, so we are closing this without a contract.",
  "Answered in the thread. The short version is yes, with the conditions set out above.",
];

/** Why a Request was declined. */
export const DECLINE_REASONS = [
  "This is a duplicate of an earlier request that is already in progress.",
  "This is a procurement question rather than a legal one. Ravi's team can help.",
  "There is not enough here to act on. Please resubmit with the counterparty's paper attached.",
  "The business has confirmed this deal is not going ahead.",
];
