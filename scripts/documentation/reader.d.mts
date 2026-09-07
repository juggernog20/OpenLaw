// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Reader metadata shared by the generated bundle and its consumers, per TECH-026.
 */

export type DocumentationAudience =
  "legal_team_member" | "administrator" | "contributor" | "business_user" | "operator";
export type DocumentationDestination = "formal" | "staff-help" | "portal-help";
export interface DocumentationArticle {
  id: string;
  title: string;
  section: string;
  audiences: DocumentationAudience[];
  destinations: DocumentationDestination[];
  contexts: string[];
  outline: { id: string; text: string; depth: number }[];
  html: Record<DocumentationDestination | "standalone", string>;
  text: string;
  unverified: boolean;
  contentSha256: string;
  assets: { path: string; sha256: string }[];
}
export interface DocumentationBundle {
  schemaVersion: number;
  edition: {
    id: string;
    channel: "development" | "release";
    supportedAppVersion: string;
    supportedAppCommit: string | null;
    distributionCommit: string | null;
    workingChanges: boolean;
    publicationTarget: string;
    contentDigest: string;
  };
  preview: boolean;
  sections: { id: string; title: string }[];
  contexts: string[];
  bindings: {
    routes: string[];
    contexts: string[];
    surface: "staff" | "portal" | "both" | "formal";
    pilotEntry: boolean;
  }[];
  redirects: { from: string; to: string }[];
  articles: DocumentationArticle[];
  warnings: string[];
  report: {
    required: number;
    verified: number;
    coverageRequired: number;
    coverageVerified: number;
  };
}
export type HelpMetadata = Pick<DocumentationBundle, "contexts" | "bindings"> & {
  articles: Pick<DocumentationArticle, "audiences" | "destinations" | "contexts">[];
};
export interface DocumentationSearch {
  query?: string;
  destination?: DocumentationDestination;
  audience?: string;
  topic?: string;
  topics?: string[];
}
export function normalizeSearch(value: string): string;
export function searchDocumentation(
  bundle: DocumentationBundle,
  options?: DocumentationSearch,
): DocumentationArticle[];
export function resolveDocumentationLink(
  bundle: DocumentationBundle,
  id: string,
  hash?: string,
): string | null;
export function documentationExcerpt(
  article: Pick<DocumentationArticle, "text">,
  query: string,
  length?: number,
): string;
