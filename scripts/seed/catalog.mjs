/* What Helix's legal team is actually working on.
 *
 * The corpus of work: the Contract and Matter titles, the Requests the
 * business sends in, the know-how the team keeps, and the configuration
 * a team this size would have built up. That last part means custom
 * Fields, Matter Templates, approver groups and saved views.
 *
 * Titles are written as a real team writes them, because a list of
 * plausible titles is what makes a list view worth reviewing. Anything
 * with `{cp}` in it takes a Counterparty name.
 */

/**
 * The Contract Types the seed adds to the eight the install ships with,
 * and the title patterns each one draws from.
 *
 * `stageWeights` decides where a Contract of this type is likely to sit,
 * so the pipeline is not evenly spread: NDAs are mostly done, order forms
 * mostly active, and reseller deals mostly still in flight.
 */
export const CONTRACT_KINDS = [
  {
    typeSlug: "nda",
    displayName: "NDA",
    stageWeights: [
      ["draft", 1],
      ["review", 2],
      ["signature", 1],
      ["active", 8],
      ["ended", 3],
    ],
    titles: [
      "Mutual NDA - {cp}",
      "One-way NDA (inbound) - {cp}",
      "Mutual NDA - {cp} - evaluation phase",
      "NDA - {cp} - acquisition diligence",
    ],
    terms: { months: [12, 24, 36], value: null },
  },
  {
    typeSlug: "msa",
    displayName: "MSA",
    stageWeights: [
      ["draft", 1],
      ["review", 3],
      ["approval", 2],
      ["signature", 1],
      ["active", 9],
      ["ended", 2],
    ],
    titles: [
      "Master Services Agreement - {cp}",
      "MSA - {cp} - platform and support",
      "Master Subscription Agreement - {cp}",
    ],
    terms: { months: [24, 36], value: [80000, 900000], cadence: "annually" },
  },
  {
    typeSlug: "sow",
    displayName: "SOW",
    stageWeights: [
      ["draft", 2],
      ["review", 2],
      ["approval", 1],
      ["active", 7],
      ["ended", 4],
    ],
    titles: [
      "SOW 1 - {cp} - implementation",
      "SOW 2 - {cp} - data migration",
      "SOW 3 - {cp} - integration build",
      "SOW - {cp} - managed onboarding",
    ],
    terms: { months: [3, 6, 9, 12], value: [15000, 220000], cadence: "one_time" },
  },
  {
    typeSlug: "sales",
    displayName: "Sales",
    stageWeights: [
      ["draft", 2],
      ["review", 2],
      ["approval", 2],
      ["signature", 2],
      ["active", 12],
      ["ended", 3],
    ],
    titles: [
      "Order Form - {cp} - Helix Platform Enterprise",
      "Order Form - {cp} - Helix Analytics add-on",
      "Order Form - {cp} - seat expansion",
      "Renewal Order Form - {cp}",
    ],
    terms: { months: [12, 24, 36], value: [24000, 1400000], cadence: "annually" },
  },
  {
    typeSlug: "vendor",
    displayName: "Vendor",
    stageWeights: [
      ["draft", 1],
      ["review", 2],
      ["approval", 2],
      ["active", 9],
      ["ended", 3],
    ],
    titles: [
      "{cp} - cloud hosting services agreement",
      "{cp} - observability platform subscription",
      "{cp} - payroll services agreement",
      "{cp} - recruitment services agreement",
      "{cp} - penetration testing engagement",
    ],
    terms: { months: [12, 24], value: [9000, 480000], cadence: "annually" },
  },
  {
    typeSlug: "employment",
    displayName: "Employment",
    stageWeights: [
      ["draft", 1],
      ["review", 1],
      ["signature", 1],
      ["active", 8],
      ["ended", 2],
    ],
    titles: [
      "Employment agreement - {person}",
      "Consultancy agreement - {person}",
      "Settlement agreement - {person}",
      "Secondment letter - {person}",
    ],
    terms: { months: null, value: [60000, 240000], cadence: "annually" },
  },
  {
    typeSlug: "license",
    displayName: "License",
    stageWeights: [
      ["draft", 1],
      ["review", 2],
      ["active", 8],
      ["ended", 2],
    ],
    titles: [
      "{cp} - software licence and support",
      "{cp} - OEM licence agreement",
      "{cp} - trademark licence",
      "{cp} - content licence for documentation",
    ],
    terms: { months: [12, 36, 60], value: [12000, 350000], cadence: "annually" },
  },
  {
    typeSlug: "dpa",
    displayName: "DPA",
    isNew: true,
    stageWeights: [
      ["review", 3],
      ["approval", 1],
      ["active", 10],
      ["ended", 1],
    ],
    titles: [
      "Data Processing Addendum - {cp}",
      "DPA and SCCs - {cp}",
      "Sub-processor addendum - {cp}",
    ],
    terms: { months: null, value: null },
  },
  {
    typeSlug: "reseller",
    displayName: "Reseller",
    isNew: true,
    stageWeights: [
      ["draft", 2],
      ["review", 3],
      ["approval", 2],
      ["signature", 1],
      ["active", 5],
      ["ended", 1],
    ],
    titles: [
      "Reseller Agreement - {cp}",
      "Referral Agreement - {cp}",
      "Distribution Agreement - {cp} - APAC",
    ],
    terms: { months: [12, 24], value: [30000, 600000], cadence: "annually" },
  },
  {
    typeSlug: "lease",
    displayName: "Lease",
    isNew: true,
    stageWeights: [
      ["review", 1],
      ["approval", 1],
      ["active", 6],
      ["ended", 2],
    ],
    titles: ["Office lease - {city}", "Lease surrender - {city}", "Co-working licence - {city}"],
    terms: { months: [36, 60, 120], value: [45000, 780000], cadence: "annually" },
  },
];

/** Where the Lease titles put an office. */
export const OFFICE_CITIES = [
  "London",
  "Amsterdam",
  "Munich",
  "Paris",
  "Dublin",
  "Stockholm",
  "Madrid",
  "Sydney",
  "Singapore",
  "Bengaluru",
  "Tokyo",
  "Toronto",
];

/** Employment Contracts and Matters name people who are not users. */
export const EMPLOYEE_NAMES = [
  "Aisha Rahman",
  "Tobias Lang",
  "Grace Mbeki",
  "Hiroshi Ono",
  "Nora Fitzgerald",
  "Pablo Herrera",
  "Emilia Kowalczyk",
  "Samuel Achebe",
  "Ingrid Bakken",
  "Yusuf Demir",
  "Charlotte Reid",
  "Andrei Popescu",
  "Meera Krishnan",
  "Jonah Feldman",
  "Wei Lin",
  "Sinead Gallagher",
];

/**
 * Matter work, by the Matter Type it belongs to. The three new types are
 * marked; the rest ship with the install.
 */
export const MATTER_KINDS = [
  {
    typeSlug: "employment",
    titles: [
      "Grievance - {person}",
      "Performance dismissal - {person}",
      "Redundancy consultation - Munich engineering",
      "Contractor misclassification review - Spain",
      "Equal pay audit - EMEA",
      "Restrictive covenant advice - {person}",
      "Works council consultation - Helix Software GmbH",
    ],
  },
  {
    typeSlug: "litigation",
    titles: [
      "{cp} - unpaid invoices claim",
      "{cp} - breach of contract dispute",
      "Trademark opposition - HELIX word mark (EU)",
      "{cp} - small claims recovery",
      "Employment tribunal - {person}",
    ],
  },
  {
    typeSlug: "regulatory",
    titles: [
      "UK IR35 status review",
      "EU AI Act readiness assessment",
      "DORA readiness - Helix Software Ireland Limited",
      "Export control classification - Helix Analytics",
      "Sanctions screening policy refresh",
    ],
  },
  {
    typeSlug: "commercial",
    titles: [
      "Renewal strategy - {cp}",
      "Pricing model change - EMEA",
      "Standard terms refresh - order forms",
      "Escalation - {cp} service credits",
      "Reseller programme design - APAC",
    ],
  },
  {
    typeSlug: "corporate",
    titles: [
      "Dissolution - Helix Software Portugal, Unipessoal Lda",
      "Board minutes - Q3 2026",
      "Share option pool increase",
      "Intercompany services agreement refresh",
      "Nimbus Metrics wind-down",
      "Annual return filings - EMEA entities",
    ],
  },
  {
    typeSlug: "ip",
    titles: [
      "Patent filing - adaptive index sharding",
      "Open-source licence review - Helix Core 4.0",
      "Trademark registration - HELIX ANALYTICS (US)",
      "Domain recovery - helix-support.example",
      "Brand guidelines and usage policy",
    ],
  },
  {
    typeSlug: "privacy",
    titles: [
      "DSAR - {person}",
      "Sub-processor onboarding - {cp}",
      "Records of processing refresh - Article 30",
      "Cookie banner remediation",
      "Data retention schedule - support tickets",
      "Transfer impact assessment - {cp}",
    ],
  },
  {
    typeSlug: "advisory",
    titles: [
      "Marketing claims review - autumn campaign",
      "Customer reference programme terms",
      "Beta programme terms of use",
      "Charitable donations policy",
    ],
  },
  {
    typeSlug: "product_counsel",
    displayName: "Product counsel",
    isNew: true,
    titles: [
      "AI feature launch review - Helix Assist",
      "Usage telemetry review - Helix Core 4.0",
      "Age assurance for self-serve signup",
      "Terms of service refresh - self-serve tier",
    ],
  },
  {
    typeSlug: "ma",
    displayName: "M&A",
    isNew: true,
    titles: [
      "Acquisition - {cp} - diligence",
      "Acquisition - {cp} - signing and closing",
      "Post-closing integration - Nimbus Metrics",
    ],
  },
];

/** Tasks a Matter of any kind might carry. */
export const MATTER_TASKS = [
  "Confirm scope with the business sponsor",
  "Collect the background documents",
  "Draft the first advice note",
  "Review external counsel's mark-up",
  "Circulate for internal comment",
  "Book the follow-up call",
  "Update the risk register",
  "Close out and file the papers",
  "Chase the counterparty for a response",
  "Prepare the board summary",
];

/** Tasks a Contract might carry. */
export const CONTRACT_TASKS = [
  "Send the first draft to the counterparty",
  "Chase the redline",
  "Confirm the liability cap with Finance",
  "Get the security review sign-off",
  "Check the insurance certificate",
  "Confirm the signatory has authority",
  "File the executed copy",
  "Diarise the renewal notice",
  "Confirm the entity on the signature block",
];

/** Key-date labels a Contract carries beyond its own term dates. */
export const CONTRACT_KEY_DATES = [
  "Renewal notice deadline",
  "Price review date",
  "Security review due",
  "First performance milestone",
  "Insurance certificate renewal",
  "Benchmark review",
];

export const MATTER_KEY_DATES = [
  "Tribunal deadline",
  "Regulator response due",
  "Filing deadline",
  "Consultation period ends",
  "Board meeting",
  "External counsel budget review",
];

/**
 * The Requests the business sends in, by Request Type. `urgency` is the
 * weighting the seed draws from, so most Requests are ordinary.
 */
export const REQUEST_KINDS = [
  {
    typeSlug: "nda_request",
    summaries: [
      "NDA for {cp} before the product demo",
      "Mutual NDA with {cp} ahead of a pilot",
      "NDA needed for the {cp} RFP",
      "One-way NDA for an inbound pitch from {cp}",
    ],
    descriptions: [
      "We are meeting {cp} next week and they want to see the roadmap. Standard mutual NDA is fine as far as I know. Their legal contact is on the thread.",
      "{cp} has asked for an NDA before they will share their requirements document. No money involved yet, this is pre-sales.",
      "Procurement at {cp} sent their own NDA template. Happy to use ours instead if that is quicker.",
    ],
  },
  {
    typeSlug: "contract_review",
    summaries: [
      "Review {cp} order form before quarter end",
      "{cp} has redlined our MSA",
      "Vendor terms review - {cp}",
      "{cp} wants their own paper for the renewal",
      "Reseller terms for {cp} - APAC",
    ],
    descriptions: [
      "{cp} came back with a mark-up on clause 8 and clause 12. The deal is forecast to close this quarter, so an early view on what we can accept would help.",
      "This is a renewal on the same terms except the price. They have asked for a longer notice period. Can we take a look?",
      "New vendor for the engineering team. They handle customer data, so I assume we need the DPA as well.",
    ],
  },
  {
    typeSlug: "legal_question",
    summaries: [
      "Can we name {cp} as a reference customer?",
      "Do we need a DPA for an analytics tool?",
      "What can the autumn campaign claim about accuracy?",
      "Is a verbal agreement with {cp} binding?",
      "Can we hire a contractor in Brazil without an entity?",
    ],
    descriptions: [
      "Marketing want to use the logo and a quote in a case study. I cannot find anything in the contract that says whether we can.",
      "The tool only sees aggregate numbers as far as I can tell, but it is a US company. Do we need anything in place before we turn it on?",
      "Quick one, no rush. Happy to talk it through if that is easier than writing it up.",
    ],
  },
  {
    typeSlug: "vendor_onboarding",
    displayName: "Vendor onboarding",
    isNew: true,
    targetModule: "contract",
    summaries: [
      "New vendor - {cp} - security tooling",
      "New vendor - {cp} - translation services",
      "Renew {cp} for another year",
      "New vendor - {cp} - contractor payroll",
    ],
    descriptions: [
      "Budget is approved and the team wants to start next month. They have sent their standard terms; I have attached them.",
      "This replaces the tool we cancelled in March. Same category, cheaper, but they are a smaller company so I do not know how they will handle our terms.",
    ],
  },
  {
    typeSlug: "employment_question",
    displayName: "Employment question",
    isNew: true,
    targetModule: "matter",
    summaries: [
      "Notice period for a resignation in Germany",
      "Can we extend a probation period in France?",
      "Reference request for a former employee",
      "Contractor wants to convert to employee - Poland",
    ],
    descriptions: [
      "The person has handed in their notice and we are not sure what the local rules require. They report into the Munich team.",
      "HR need an answer before the review meeting on Friday. Nothing contentious so far.",
    ],
  },
];

/** The know-how the team keeps (KNW-001). */
export const KNOWLEDGE_ITEMS = [
  {
    folder: "Templates",
    type: "template",
    title: "Mutual NDA - Helix standard form",
    audience: "everyone",
    published: true,
    body: "Our standard mutual NDA. Use this in preference to a counterparty's form. Three-year term, mutual, no assignment. If the counterparty insists on their own paper, send it to the Commercial team rather than signing it.",
  },
  {
    folder: "Templates",
    type: "template",
    title: "One-way NDA - inbound disclosures",
    audience: "everyone",
    published: true,
    body: "Use this when Helix is receiving confidential information and giving none. Anything more complicated is a mutual NDA.",
  },
  {
    folder: "Templates",
    type: "template",
    title: "Order Form - Enterprise",
    audience: "everyone",
    published: true,
    body: "The order form the sales team fills in. The commercial terms sit here; the legal terms sit in the MSA it references. Never edit the boilerplate on an order form.",
  },
  {
    folder: "Templates",
    type: "template",
    title: "Data Processing Addendum - controller to processor",
    audience: "everyone",
    published: true,
    body: "Attach this whenever Helix processes personal data on a customer's behalf. The 2021 standard contractual clauses are annexed. Module Two applies for most deals; check with Privacy before using Module Three.",
  },
  {
    folder: "Templates",
    type: "template",
    title: "Statement of Work - professional services",
    audience: "everyone",
    published: true,
    body: "One SOW per engagement, referencing the MSA. Fixed fee unless Finance has agreed otherwise in writing.",
  },
  {
    folder: "Templates",
    type: "template",
    title: "Settlement agreement - England and Wales",
    audience: "legal_only",
    published: true,
    body: "Requires independent legal advice for the employee and a signed adviser certificate. Do not circulate outside the legal team.",
  },
  {
    folder: "Playbooks",
    type: "playbook",
    title: "Negotiation playbook - limitation of liability",
    audience: "legal_only",
    published: true,
    body: "Preferred position is 12 months' fees, capped and mutual. Fall-back is 24 months' fees for deals above 250,000 in annual value. Anything uncapped needs the General Counsel. Data protection breaches sit outside the cap for both sides.",
  },
  {
    folder: "Playbooks",
    type: "playbook",
    title: "Negotiation playbook - indemnities",
    audience: "legal_only",
    published: true,
    body: "We give an IP infringement indemnity on the Helix platform only. We do not indemnify for customer data or for third-party integrations the customer chose.",
  },
  {
    folder: "Playbooks",
    type: "playbook",
    title: "Negotiation playbook - data protection",
    audience: "legal_only",
    published: true,
    body: "Our DPA, our sub-processor list, 30 days' notice of a change. Audit rights are once a year on reasonable notice, and a completed questionnaire satisfies them.",
  },
  {
    folder: "Playbooks",
    type: "playbook",
    title: "Signature authority matrix",
    audience: "everyone",
    published: true,
    body: "Under 50,000 in annual value: any Director. Between 50,000 and 500,000: the CFO or the General Counsel. Above 500,000: two Directors of the contracting entity.",
  },
  {
    folder: "Guidance",
    type: "article",
    title: "How to ask legal for help",
    audience: "everyone",
    published: true,
    body: "Use the portal. Pick the closest request type, say what you need and by when, and attach whatever the counterparty has sent. If you are not sure which type fits, use Legal question.",
  },
  {
    folder: "Guidance",
    type: "article",
    title: "Contract review turnaround times",
    audience: "everyone",
    published: true,
    body: "NDAs on our form: one working day. NDAs on their form: three working days. Order forms on standard terms: two working days. Anything with a redlined MSA: five working days. Tell us early if a deadline is fixed.",
  },
  {
    folder: "Guidance",
    type: "article",
    title: "When you need a DPA",
    audience: "everyone",
    published: true,
    body: "If a supplier will see customer personal data, you need a DPA before they get access. If they only see Helix employee data, tell People Ops as well. If in doubt, ask.",
  },
  {
    folder: "Guidance",
    type: "article",
    title: "Using customer names in marketing",
    audience: "everyone",
    published: true,
    body: "Check the order form. Most permit a logo on the website but not a case study. A quote from a named person always needs their employer's written agreement.",
  },
  {
    folder: "Guidance",
    type: "article",
    title: "Travelling with a company laptop",
    audience: "everyone",
    published: false,
    body: "Draft. IT and Legal are still agreeing the position for the United States and China.",
  },
  {
    folder: "Precedents",
    type: "precedent",
    title: "Northwind Traders - negotiated MSA (2025)",
    audience: "legal_only",
    published: true,
    body: "A heavily negotiated MSA that landed well. Useful for the liability and audit clauses. Note the carve-out at clause 11.4, which we should not offer as a starting position.",
  },
  {
    folder: "Precedents",
    type: "precedent",
    title: "Woodgrove Bank - regulated customer addendum",
    audience: "legal_only",
    published: true,
    body: "Our first financial services addendum. The exit assistance obligations at clause 6 are the ones to reuse.",
  },
  {
    folder: "Precedents",
    type: "precedent",
    title: "Relecloud - hosting terms with committed spend",
    audience: "legal_only",
    published: true,
    body: "Vendor side. The committed spend true-up mechanism is worth copying for other infrastructure deals.",
  },
  {
    folder: "Precedents",
    type: "precedent",
    title: "Kaito Solutions - APAC reseller",
    audience: "legal_only",
    published: false,
    body: "Draft note. Waiting for the signed version before this is worth publishing.",
  },
  {
    folder: "Corporate",
    type: "article",
    title: "Group structure - summary",
    audience: "legal_only",
    published: true,
    body: "Helix Software Group, Inc. is the ultimate parent. The European companies hang off Helix Software Holdings B.V.; Asia-Pacific hangs off Helix Software Singapore Pte. Ltd. Helix Analytics, Inc. and its subsidiary sit directly under the parent.",
  },
  {
    folder: "Corporate",
    type: "article",
    title: "Annual filing calendar",
    audience: "legal_only",
    published: true,
    body: "The obligations recorded against each Entity drive the reminders. This note explains what each filing is and who prepares it.",
  },
  {
    folder: "Corporate",
    type: "template",
    title: "Board minutes - written resolution",
    audience: "legal_only",
    published: true,
    body: "Use for anything that does not need a meeting. Circulate for signature and file the executed copy against the Entity.",
  },
  {
    folder: "Privacy",
    type: "playbook",
    title: "Responding to a data subject access request",
    audience: "legal_only",
    published: true,
    body: "One month from receipt, extendable by two more for a complex request. Log it as a Matter on the day it arrives. The search covers the ticketing system, mailboxes and the CRM.",
  },
  {
    folder: "Privacy",
    type: "article",
    title: "Sub-processor list and change notice",
    audience: "everyone",
    published: true,
    body: "The published list lives on the website. Any addition needs 30 days' notice to customers, so tell Privacy before the contract is signed, not after.",
  },
  {
    folder: "Privacy",
    type: "template",
    title: "Transfer impact assessment",
    audience: "legal_only",
    published: true,
    body: "Complete one for every transfer outside the EEA and the United Kingdom that relies on the standard contractual clauses.",
  },
];

/** The Knowledge Folder tree the items are filed into (KNW-003). */
export const KNOWLEDGE_FOLDERS = [
  { name: "Templates" },
  { name: "Playbooks" },
  { name: "Precedents" },
  { name: "Guidance" },
  { name: "Corporate" },
  { name: "Privacy" },
];

/**
 * Custom Fields the team has added. `attach` names the Types the Field is
 * put on, by slug; `required` is the subset that must be answered.
 */
export const CUSTOM_FIELDS = [
  {
    displayName: "Business sponsor",
    moduleScope: "contract",
    fieldType: "user",
    fieldTag: "business",
    description: "Who in the business owns this deal.",
    attach: { contract: ["msa", "sales", "sow", "vendor", "reseller"] },
  },
  {
    displayName: "Owning department",
    moduleScope: "contract",
    fieldType: "single_select",
    fieldTag: "business",
    options: ["Sales", "Procurement", "Engineering", "People", "Finance", "Marketing"],
    attach: { contract: ["msa", "sales", "sow", "vendor", "reseller", "license", "lease"] },
    required: { contract: ["vendor"] },
  },
  {
    displayName: "Security review",
    moduleScope: "contract",
    fieldType: "single_select",
    fieldTag: "business",
    options: ["Not required", "Requested", "In progress", "Complete", "Failed"],
    attach: { contract: ["vendor", "reseller", "dpa"] },
  },
  {
    displayName: "Processes personal data",
    moduleScope: "contract",
    fieldType: "boolean",
    fieldTag: "legal",
    attach: { contract: ["msa", "sales", "vendor", "dpa", "reseller"] },
  },
  {
    displayName: "Liability cap",
    moduleScope: "contract",
    fieldType: "text",
    fieldTag: "legal",
    description: "How the cap is expressed in the signed text.",
    aiPrompt:
      'Find the limitation of liability clause and state the cap exactly as the clause expresses it, for example "12 months\' fees" or "USD 500,000".',
    attach: { contract: ["msa", "sales", "sow", "vendor", "license", "reseller"] },
  },
  {
    displayName: "Territories",
    moduleScope: "contract",
    fieldType: "multi_select",
    fieldTag: "business",
    options: ["United Kingdom", "European Union", "United States", "APAC", "LATAM", "Worldwide"],
    attach: { contract: ["license", "reseller", "sales"] },
  },
  {
    displayName: "Deal desk reference",
    moduleScope: "contract",
    fieldType: "text",
    fieldTag: "business",
    attach: { contract: ["sales", "reseller"] },
  },
  {
    displayName: "Signed copy filed on",
    moduleScope: "contract",
    fieldType: "date",
    fieldTag: "legal",
    attach: { contract: ["msa", "sales", "employment", "lease"] },
  },
  {
    displayName: "Business unit",
    moduleScope: "matter",
    fieldType: "single_select",
    fieldTag: "business",
    options: ["Platform", "Analytics", "Sales", "People", "Finance", "Group"],
    attach: { matter: ["employment", "commercial", "corporate", "privacy", "product_counsel"] },
  },
  {
    displayName: "External counsel",
    moduleScope: "matter",
    fieldType: "text",
    fieldTag: "legal",
    attach: { matter: ["litigation", "regulatory", "ip", "ma"] },
  },
  {
    displayName: "Budget approved",
    moduleScope: "matter",
    fieldType: "number",
    fieldTag: "business",
    description: "External spend signed off, in USD.",
    attach: { matter: ["litigation", "regulatory", "ma"] },
  },
  {
    displayName: "Regulator",
    moduleScope: "matter",
    fieldType: "single_select",
    fieldTag: "legal",
    options: ["ICO", "CNIL", "Datatilsynet", "FTC", "EU Commission", "Not applicable"],
    attach: { matter: ["regulatory", "privacy"] },
    required: { matter: ["regulatory"] },
  },
  {
    displayName: "Financial year end",
    moduleScope: "entity",
    fieldType: "text",
    fieldTag: "business",
    attach: { entity: ["corporation", "llc", "branch"] },
  },
  {
    displayName: "Statutory audit required",
    moduleScope: "entity",
    fieldType: "boolean",
    fieldTag: "legal",
    attach: { entity: ["corporation", "llc"] },
  },
  {
    displayName: "Local counsel",
    moduleScope: "entity",
    fieldType: "text",
    fieldTag: "legal",
    attach: { entity: ["corporation", "llc", "branch", "partnership"] },
  },
  {
    displayName: "Region",
    moduleScope: "global",
    fieldType: "single_select",
    fieldTag: "business",
    options: ["EMEA", "Americas", "APAC"],
    attach: {
      contract: ["msa", "sales", "vendor", "reseller"],
      matter: ["commercial", "corporate"],
      entity: ["corporation", "llc"],
    },
  },
];

/** The Fields a Request Type collects beyond the four fixed basics. */
export const REQUEST_FIELDS = [
  {
    displayName: "Counterparty name",
    moduleScope: "global",
    fieldType: "text",
    fieldTag: "business",
    attach: { request: ["nda_request", "contract_review", "vendor_onboarding"] },
    required: { request: ["nda_request", "vendor_onboarding"] },
  },
  {
    displayName: "Needed by",
    moduleScope: "global",
    fieldType: "date",
    fieldTag: "business",
    attach: { request: ["nda_request", "contract_review", "vendor_onboarding"] },
  },
  {
    displayName: "Deal value (USD)",
    moduleScope: "global",
    fieldType: "number",
    fieldTag: "business",
    attach: { request: ["contract_review", "vendor_onboarding"] },
  },
  {
    displayName: "Will they see personal data?",
    moduleScope: "global",
    fieldType: "boolean",
    fieldTag: "legal",
    attach: { request: ["vendor_onboarding"] },
  },
  {
    displayName: "Country",
    moduleScope: "global",
    fieldType: "single_select",
    fieldTag: "business",
    options: [
      "United Kingdom",
      "Germany",
      "France",
      "Netherlands",
      "Spain",
      "Poland",
      "United States",
      "Australia",
      "Singapore",
      "India",
    ],
    attach: { request: ["employment_question"] },
    required: { request: ["employment_question"] },
  },
];

/** Matter Templates (MTR-009), with the tasks and key dates each carries. */
export const MATTER_TEMPLATES = [
  {
    name: "Employment grievance",
    matterTypeSlug: "employment",
    description: "The standard route for a formal grievance, from receipt to outcome letter.",
    defaultPriority: "high",
    defaultRisk: "medium",
    titlePrefix: "Grievance - ",
    tasks: [
      {
        title: "Acknowledge the grievance in writing",
        dueOffsetDays: 2,
        assigneeRole: "matter_manager",
      },
      { title: "Appoint the investigating manager", dueOffsetDays: 5, assigneeRole: "none" },
      { title: "Hold the grievance hearing", dueOffsetDays: 14, assigneeRole: "none" },
      { title: "Issue the outcome letter", dueOffsetDays: 21, assigneeRole: "matter_manager" },
      { title: "Confirm whether an appeal was lodged", dueOffsetDays: 28, assigneeRole: "none" },
    ],
    keyDates: [
      { label: "Acknowledgement due", offsetDays: 2, note: null },
      { label: "Hearing", offsetDays: 14, note: "Two working days' notice to the employee." },
      { label: "Outcome due", offsetDays: 21, note: null },
    ],
  },
  {
    name: "Data subject access request",
    matterTypeSlug: "privacy",
    description: "One month to respond, extendable by two for a complex request.",
    defaultPriority: "high",
    defaultRisk: "high",
    titlePrefix: "DSAR - ",
    tasks: [
      {
        title: "Verify the requester's identity",
        dueOffsetDays: 3,
        assigneeRole: "matter_manager",
      },
      { title: "Run the search across systems", dueOffsetDays: 10, assigneeRole: "none" },
      { title: "Review and redact third-party data", dueOffsetDays: 20, assigneeRole: "none" },
      { title: "Send the response pack", dueOffsetDays: 28, assigneeRole: "matter_manager" },
    ],
    keyDates: [
      { label: "Statutory response deadline", offsetDays: 30, note: "One month from receipt." },
      {
        label: "Extension decision point",
        offsetDays: 21,
        note: "Decide whether the request is complex.",
      },
    ],
  },
  {
    name: "Trademark filing",
    matterTypeSlug: "ip",
    description: "From clearance search to registration certificate.",
    defaultPriority: "medium",
    defaultRisk: "low",
    titlePrefix: "Trademark - ",
    tasks: [
      {
        title: "Commission the clearance search",
        dueOffsetDays: 7,
        assigneeRole: "matter_manager",
      },
      { title: "Agree the classes with the business", dueOffsetDays: 14, assigneeRole: "none" },
      { title: "File the application", dueOffsetDays: 21, assigneeRole: "matter_manager" },
      { title: "Diarise the opposition period", dueOffsetDays: 30, assigneeRole: "none" },
    ],
    keyDates: [
      { label: "Filing date", offsetDays: 21, note: null },
      { label: "Opposition period ends", offsetDays: 120, note: null },
    ],
  },
  {
    name: "Entity dissolution",
    matterTypeSlug: "corporate",
    description: "Winding up a dormant company in the group.",
    defaultPriority: "low",
    defaultRisk: "medium",
    titlePrefix: "Dissolution - ",
    tasks: [
      {
        title: "Confirm the company is dormant and solvent",
        dueOffsetDays: 14,
        assigneeRole: "matter_manager",
      },
      { title: "Settle intercompany balances", dueOffsetDays: 30, assigneeRole: "none" },
      { title: "Pass the board resolution", dueOffsetDays: 45, assigneeRole: "none" },
      {
        title: "File the strike-off application",
        dueOffsetDays: 60,
        assigneeRole: "matter_manager",
      },
      { title: "Close the bank accounts", dueOffsetDays: 75, assigneeRole: "none" },
    ],
    keyDates: [
      { label: "Board resolution", offsetDays: 45, note: null },
      { label: "Strike-off filed", offsetDays: 60, note: null },
      {
        label: "Expected dissolution",
        offsetDays: 150,
        note: "Three months after the notice is published.",
      },
    ],
  },
  {
    name: "Vendor onboarding review",
    matterTypeSlug: "commercial",
    description: "The review a new supplier goes through before the contract is signed.",
    defaultPriority: "medium",
    defaultRisk: "medium",
    titlePrefix: "Vendor review - ",
    tasks: [
      { title: "Collect the security questionnaire", dueOffsetDays: 5, assigneeRole: "none" },
      { title: "Check whether a DPA is needed", dueOffsetDays: 7, assigneeRole: "matter_manager" },
      { title: "Confirm the budget with Finance", dueOffsetDays: 10, assigneeRole: "none" },
    ],
    keyDates: [{ label: "Target start date", offsetDays: 30, note: null }],
  },
];

/** Approver groups (CTR-011), by the titles of the people on them. */
export const APPROVER_GROUPS = [
  {
    name: "Finance sign-off",
    description: "Anything above 250,000 in annual value, and every multi-year commitment.",
    members: ["Ines Duarte", "Daniel Okafor"],
  },
  {
    name: "Security review",
    description: "Vendors who will hold customer data or connect to production.",
    members: ["Priya Raman", "Nadia Haddad"],
  },
  {
    name: "Executive committee",
    description:
      "Uncapped liability, exclusivity, and anything that changes the standard order form.",
    members: ["Blair Wentworth", "Daniel Okafor"],
  },
  {
    name: "Privacy review",
    description: "New sub-processors and any transfer outside the EEA.",
    members: ["Priya Raman"],
  },
];

/** Saved list views (DD-019). `owner` names whose menu they appear in. */
export const LIST_VIEWS = [
  {
    owner: "Blair Wentworth",
    surface: "contracts",
    name: "Renewals and expiries",
    isDefault: false,
    config: {
      columns: [
        { key: "reference", width: 92 },
        { key: "title", width: 320 },
        { key: "counterparty", width: 200 },
        { key: "expiryDate", width: 120 },
        { key: "noticeDeadline", width: 130 },
        { key: "daysRemaining", width: 110 },
        { key: "owner", width: 150 },
      ],
      flexKey: "title",
      sort: { key: "expiryDate", dir: "asc" },
      filters: { includeEnded: true },
    },
  },
  {
    owner: "Blair Wentworth",
    surface: "contracts",
    name: "High value, in flight",
    isDefault: false,
    config: {
      columns: [
        { key: "reference", width: 92 },
        { key: "title", width: 300 },
        { key: "status", width: 150 },
        { key: "value", width: 140 },
        { key: "risk", width: 100 },
        { key: "owner", width: 150 },
        { key: "updatedAt", width: 130 },
      ],
      flexKey: "title",
      sort: { key: "updatedAt", dir: "desc" },
      filters: {},
    },
  },
  {
    owner: "Nadia Haddad",
    surface: "contracts",
    name: "My commercial desk",
    isDefault: true,
    config: {
      columns: [
        { key: "reference", width: 92 },
        { key: "title", width: 340 },
        { key: "counterparty", width: 210 },
        { key: "type", width: 110 },
        { key: "status", width: 160 },
        { key: "priority", width: 110 },
      ],
      flexKey: "title",
      sort: { key: "status", dir: "asc" },
      filters: {},
    },
  },
  {
    owner: "Ines Duarte",
    surface: "contracts",
    name: "Everything, including ended",
    isDefault: false,
    config: {
      columns: [
        { key: "reference", width: 92 },
        { key: "title", width: 300 },
        { key: "type", width: 110 },
        { key: "status", width: 160 },
        { key: "entity", width: 220 },
        { key: "effectiveDate", width: 120 },
        { key: "expiryDate", width: 120 },
      ],
      flexKey: "title",
      sort: { key: "number", dir: "desc" },
      filters: { includeEnded: true, includeArchived: true },
    },
  },
  {
    owner: "Blair Wentworth",
    surface: "matters",
    name: "Team workload",
    isDefault: false,
    config: {
      columns: [
        { key: "reference", width: 92 },
        { key: "title", width: 340 },
        { key: "manager", width: 160 },
        { key: "status", width: 140 },
        { key: "priority", width: 110 },
        { key: "nextDeadline", width: 130 },
      ],
      flexKey: "title",
      sort: { key: "nextDeadline", dir: "asc" },
      filters: {},
    },
  },
  {
    owner: "Priya Raman",
    surface: "matters",
    name: "Privacy queue",
    isDefault: true,
    config: {
      columns: [
        { key: "reference", width: 92 },
        { key: "title", width: 360 },
        { key: "status", width: 140 },
        { key: "risk", width: 100 },
        { key: "nextDeadline", width: 130 },
      ],
      flexKey: "title",
      sort: { key: "nextDeadline", dir: "asc" },
      filters: { incomplete: true },
    },
  },
  {
    owner: "Blair Wentworth",
    surface: "entities",
    name: "Filing watch",
    isDefault: false,
    config: {
      columns: [
        { key: "legalName", width: 300 },
        { key: "jurisdiction", width: 200 },
        { key: "status", width: 110 },
        { key: "nextObligation", width: 160 },
      ],
      flexKey: "legalName",
      sort: { key: "nextObligation", dir: "asc" },
      filters: {},
    },
  },
  {
    owner: "Tom Iwu",
    surface: "documents",
    name: "Recently filed",
    isDefault: false,
    config: {
      columns: [
        { key: "title", width: 340 },
        { key: "owner", width: 220 },
        { key: "kind", width: 130 },
        { key: "versions", width: 90 },
        { key: "uploaded", width: 140 },
      ],
      flexKey: "title",
      sort: { key: "uploaded", dir: "desc" },
      filters: {},
    },
  },
];

/** The links the portal shows beside the request form (INT-006). */
export const INTAKE_LINKS = [
  { label: "How to ask legal for help", knowledgeTitle: "How to ask legal for help" },
  { label: "Contract review turnaround times", knowledgeTitle: "Contract review turnaround times" },
  { label: "When you need a DPA", knowledgeTitle: "When you need a DPA" },
  {
    label: "Using customer names in marketing",
    knowledgeTitle: "Using customer names in marketing",
  },
  { label: "Helix intranet - Legal", url: "https://intranet.helix.example/legal" },
];

/** The obligations recorded against Entities (ENT-004). */
export const ENTITY_OBLIGATIONS = [
  { label: "Annual return", recurrenceMonths: 12 },
  { label: "Statutory accounts filing", recurrenceMonths: 12 },
  { label: "Confirmation statement", recurrenceMonths: 12 },
  { label: "Beneficial ownership register update", recurrenceMonths: 12 },
  { label: "Corporate income tax return", recurrenceMonths: 12 },
  { label: "VAT registration review", recurrenceMonths: 6 },
  { label: "Registered agent renewal", recurrenceMonths: 12 },
  { label: "Board meeting - minutes filed", recurrenceMonths: 3 },
];
