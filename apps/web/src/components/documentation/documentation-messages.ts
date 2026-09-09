// SPDX-License-Identifier: AGPL-3.0-only
/** ICU labels for Documentation and both Help shells (DES-013, DES-074). */
import { defineMessages } from "react-intl";

export const M = defineMessages({
  intro: { id: "docs.intro", defaultMessage: "Find the guide you need." },
  introBody: {
    id: "docs.introBody",
    defaultMessage: "Practical guides for your legal work, your team, and your workspace.",
  },
  helpBody: {
    id: "docs.helpBody",
    defaultMessage: "Find the steps you need, then get back to your work.",
  },
  browse: { id: "docs.browse", defaultMessage: "Browse guides" },
  collections: { id: "docs.collections", defaultMessage: "Explore the guides" },
  collectionBody: {
    id: "docs.collectionBody",
    defaultMessage: "Choose a topic to find the right place to start.",
  },
  guideNavigation: { id: "docs.guideNavigation", defaultMessage: "Guide navigation" },
  overview: { id: "docs.overview", defaultMessage: "Overview" },
  breadcrumb: { id: "docs.breadcrumb", defaultMessage: "Breadcrumb" },
  count: { id: "docs.count", defaultMessage: "{count, plural, one {# guide} other {# guides}}" },
  resultCount: {
    id: "docs.resultCount",
    defaultMessage: "{count, plural, one {# result} other {# results}}",
  },
  clear: { id: "docs.clear", defaultMessage: "Clear filters" },
  previous: { id: "docs.previous", defaultMessage: "Previous guide" },
  next: { id: "docs.next", defaultMessage: "Next guide" },
  articleNavigation: { id: "docs.articleNavigation", defaultMessage: "Article navigation" },
  writtenFor: { id: "docs.writtenFor", defaultMessage: "For {roles}" },
  openApp: { id: "docs.openApp", defaultMessage: "Open app" },
  theme: { id: "docs.theme", defaultMessage: "Documentation theme" },
  light: { id: "docs.theme.light", defaultMessage: "Light" },
  warm: { id: "docs.theme.warm", defaultMessage: "Warm" },
  dark: { id: "docs.theme.dark", defaultMessage: "Dark" },
  startDescription: {
    id: "docs.collection.start",
    defaultMessage: "Find your way around, sign in, and make OpenLaw yours.",
  },
  portalDescription: {
    id: "docs.collection.portal",
    defaultMessage: "Ask Legal for help and follow your Requests.",
  },
  workingDescription: {
    id: "docs.collection.working",
    defaultMessage: "Share context, collaborate, and keep work moving.",
  },
  contractsDescription: {
    id: "docs.collection.contracts",
    defaultMessage: "Take a Contract from first draft to signature and renewal.",
  },
  mattersDescription: {
    id: "docs.collection.matters",
    defaultMessage: "Organize legal work, people, Tasks, and Key dates.",
  },
  documentsDescription: {
    id: "docs.collection.documents",
    defaultMessage: "Find, organize, and work with your team's Documents.",
  },
  entitiesDescription: {
    id: "docs.collection.entities",
    defaultMessage: "Keep corporate records and Obligations in order.",
  },
  knowledgeDescription: {
    id: "docs.collection.knowledge",
    defaultMessage: "Build and share the team's practical know-how.",
  },
  administrationDescription: {
    id: "docs.collection.administration",
    defaultMessage: "Set up your workspace, people, and connected services.",
  },
  operationsDescription: {
    id: "docs.collection.operations",
    defaultMessage: "Deploy, maintain, and recover your OpenLaw instance.",
  },
  referenceDescription: {
    id: "docs.collection.reference",
    defaultMessage: "Look up a term or find a way through a problem.",
  },

  editionIdentity: { id: "docs.editionIdentity", defaultMessage: "{id} ({channel})" },
  supportedIdentity: { id: "docs.supportedIdentity", defaultMessage: "{version} / {commit}" },
  distributionIdentity: { id: "docs.distributionIdentity", defaultMessage: "{commit} ({state})" },
  development: { id: "docs.channel.development", defaultMessage: "Development" },
  release: { id: "docs.channel.release", defaultMessage: "Release" },
  title: { id: "docs.title", defaultMessage: "Documentation" },
  search: { id: "docs.search", defaultMessage: "Search documentation" },
  searchButton: { id: "docs.searchButton", defaultMessage: "Search" },
  audience: { id: "docs.audience", defaultMessage: "Audience" },
  allReaders: { id: "docs.allReaders", defaultMessage: "All readers" },
  all: { id: "docs.all", defaultMessage: "All documentation" },
  help: { id: "docs.help", defaultMessage: "Help" },
  forAudience: { id: "docs.forAudience", defaultMessage: "Guides for {audience}" },
  outsideAudience: {
    id: "docs.outsideAudience",
    defaultMessage:
      "This article is available in the full documentation. Check its audience and prerequisites before following the instructions.",
  },
  outline: { id: "docs.outline", defaultMessage: "On this page" },
  edition: { id: "docs.edition", defaultMessage: "Edition details" },
  unavailable: { id: "docs.unavailable", defaultMessage: "Article unavailable" },
  unavailableBody: {
    id: "docs.unavailableBody",
    defaultMessage:
      "This article is not available in the bundled edition. Search the available guides or return to the index.",
  },
  wrongEdition: {
    id: "docs.wrongEdition",
    defaultMessage:
      "The requested edition is not bundled with this instance. Open the current index or use your retained copy of that edition.",
  },
  preview: {
    id: "docs.preview",
    defaultMessage: "Development preview: draft and validation content is unverified.",
  },
  unverified: { id: "docs.unverified", defaultMessage: "Unverified article" },
  empty: {
    id: "docs.empty",
    defaultMessage: "No verified articles are available in this edition yet.",
  },
  noMatches: {
    id: "docs.noMatches",
    defaultMessage: "No matching articles. Try another word or return to the full index.",
  },
  missingSection: {
    id: "docs.missingSection",
    defaultMessage:
      "The requested section is unavailable. Use the page outline to find the current instructions.",
  },
  formal: { id: "docs.formal", defaultMessage: "Read this article in the full documentation" },
  download: { id: "docs.download", defaultMessage: "Download standalone edition" },
  standalone: { id: "docs.standalone", defaultMessage: "Open standalone edition" },
  retention: {
    id: "docs.retention",
    defaultMessage:
      "Keep an extracted copy outside this instance to read it when the app is unavailable.",
  },
  supported: { id: "docs.supported", defaultMessage: "Supported app" },
  distribution: { id: "docs.distribution", defaultMessage: "Distribution commit" },
  digest: { id: "docs.digest", defaultMessage: "Content digest" },
  target: { id: "docs.target", defaultMessage: "Publication target" },
  notVerified: { id: "docs.notVerified", defaultMessage: "Not yet verified" },
  notRecorded: { id: "docs.notRecorded", defaultMessage: "Not recorded" },
  dirty: { id: "docs.dirty", defaultMessage: "Working changes" },
  notice: { id: "docs.notice", defaultMessage: "Preview build notices" },
  admin: { id: "docs.role.admin", defaultMessage: "Administrator" },
  member: { id: "docs.role.member", defaultMessage: "Legal Team Member" },
  contributor: { id: "docs.role.contributor", defaultMessage: "Contributor" },
  business: { id: "docs.role.business", defaultMessage: "Business User" },
  operator: { id: "docs.role.operator", defaultMessage: "Deployment operator" },
});
export const ROLES = {
  administrator: M.admin,
  legal_team_member: M.member,
  contributor: M.contributor,
  business_user: M.business,
  operator: M.operator,
};
export const DESCRIPTIONS = {
  start: M.startDescription,
  portal: M.portalDescription,
  "working-with-legal": M.workingDescription,
  contracts: M.contractsDescription,
  matters: M.mattersDescription,
  documents: M.documentsDescription,
  entities: M.entitiesDescription,
  knowledge: M.knowledgeDescription,
  administration: M.administrationDescription,
  operations: M.operationsDescription,
  reference: M.referenceDescription,
};
