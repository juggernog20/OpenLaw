// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The comment vocabulary shared by every surface that draws a thread:
 * the row shape the API answers, DD-016's three audience tiers, and the
 * copy that names each tier and the audience it means.
 *
 * Nothing here names contracts. The thread is one machinery across
 * matters, contracts, documents, and requests (CMT-001), keyed by an
 * entity reference; only the entity vocabulary the API accepts narrows
 * it to contracts today.
 */

import { defineMessage, type IntlShape, type MessageDescriptor } from "react-intl";
import type { paths } from "@openlaw/api-client";
import { isMemberPlus, type Role } from "./roles";

type ThreadResponse =
  paths["/api/v1/comments"]["get"]["responses"]["200"]["content"]["application/json"];

/** One comment as the API answers it. */
export type Comment = ThreadResponse["comments"][number];

/** DD-016's audience tier, as stored and as posted. */
export type CommentTier = Comment["visibility"];

/** The record a thread hangs off — the reference the panel is keyed by. */
export type CommentEntityType = Comment["entityType"];

/** The three tiers, narrowest first — the order the composer draws them
 * in, so widening the audience is a move to the right. */
export const COMMENT_TIERS = ["legal_only", "working_team", "full_thread"] as const;

/** What a Contributor may say, and hear (DD-016): the working group's
 * conversation and the requester's, never the lawyers'. */
const CONTRIBUTOR_TIERS: readonly CommentTier[] = ["working_team", "full_thread"];

/** A Business User is in one room and gets no chooser at all: everything
 * they say is Full Thread by definition (DD-016). No surface offers this
 * yet — the portal thread is M19–M21 — but the rule is the role's, not
 * the surface's, so it is answered here rather than assumed away. */
const REQUESTER_TIERS: readonly CommentTier[] = ["full_thread"];

/**
 * The audience each tier names, and the label it wears. The labels are
 * the audience, not an abstraction of it — DD-016 rejected "Privileged"
 * for exactly that reason. The audience line renders under the composer
 * so nobody learns who could read a comment after posting it (CMT-003).
 */
const TIER_COPY: Record<CommentTier, { label: MessageDescriptor; audience: MessageDescriptor }> = {
  legal_only: {
    label: defineMessage({ id: "comments.tier.legalOnly", defaultMessage: "Legal only" }),
    audience: defineMessage({
      id: "comments.audience.legalOnly",
      defaultMessage: "Visible to Administrators and Legal Team Members.",
    }),
  },
  working_team: {
    label: defineMessage({ id: "comments.tier.workingTeam", defaultMessage: "Working team" }),
    audience: defineMessage({
      id: "comments.audience.workingTeam",
      defaultMessage: "Visible to the legal team and Contributors on this record.",
    }),
  },
  full_thread: {
    label: defineMessage({ id: "comments.tier.fullThread", defaultMessage: "Full thread" }),
    audience: defineMessage({
      id: "comments.audience.fullThread",
      defaultMessage: "Visible to everyone on this record, including the requester.",
    }),
  },
};

export function tierLabel(intl: IntlShape, tier: CommentTier): string {
  return intl.formatMessage(TIER_COPY[tier].label);
}

export function tierAudience(intl: IntlShape, tier: CommentTier): string {
  return intl.formatMessage(TIER_COPY[tier].audience);
}

/**
 * The segments this viewer's composer offers — one per room they are in,
 * and no others. A Contributor gets two: the Legal Only segment is
 * absent, not disabled, the same convention the nav and the settings
 * rail follow. A Business User gets one. The API's own refusal is the
 * real gate; this keeps the composer from offering a room nobody would
 * let them into.
 */
export function composerTiers(role: Role): readonly CommentTier[] {
  if (isMemberPlus(role)) return COMMENT_TIERS;
  return role === "contributor" ? CONTRIBUTOR_TIERS : REQUESTER_TIERS;
}

/**
 * What a record page's composer opens on (DD-016): the working group,
 * so the common case needs no decision. The request thread opens on
 * Full Thread instead, and that composer lands with the portal.
 */
export const RECORD_DEFAULT_TIER: CommentTier = "working_team";
