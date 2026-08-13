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

type CandidatesResponse =
  paths["/api/v1/comments/mention-candidates"]["get"]["responses"]["200"]["content"]["application/json"];

/** One comment as the API answers it. */
export type Comment = ThreadResponse["comments"][number];

/** One person a comment addresses, as a posted comment carries them. */
export type CommentMention = Comment["mentions"][number];

/** One person the @-typeahead offers, with the tiers they hear on this
 * record — the fact the promotion confirmation is computed from. */
export type MentionCandidate = CandidatesResponse["candidates"][number];

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

/**
 * How a mention reads in the body (CMT-007). The comment stays plain
 * text — the `@` and the person's name, exactly as it would be typed —
 * and the queryable list of who was named travels beside it. Nothing in
 * the body is markup, so a body read anywhere else still reads as a
 * sentence.
 */
export function mentionText(displayName: string): string {
  return `@${displayName}`;
}

/**
 * The picked names that begin with this one and run longer.
 *
 * One name can sit inside another — "@Casey" is the first half of
 * "@Casey Contributor" — and display names carry spaces, so no word
 * boundary tells the two apart. Where a longer picked name starts, the
 * text is naming that person and not this one.
 */
function longerNames(token: string, tokens: readonly string[]): string[] {
  return tokens.filter((other) => other.length > token.length && other.startsWith(token));
}

/** Where in the draft this name stands for this person, and not for a
 * longer picked name that starts the same way. */
function ownOccurrences(draft: string, token: string, longer: readonly string[]): number[] {
  const hits: number[] = [];
  for (let from = 0; from <= draft.length;) {
    const at = draft.indexOf(token, from);
    if (at === -1) break;
    if (!longer.some((other) => draft.startsWith(other, at))) hits.push(at);
    from = at + 1;
  }
  return hits;
}

/**
 * Which of the people the author picked are still named in the draft.
 *
 * Picking a name writes it into the box, so deleting it there is how a
 * mention is taken back. This keeps the two from disagreeing: a person
 * the text no longer names is not somebody the comment addresses, and
 * a post never carries a mention with no trace in what it says.
 *
 * Two people with the identical display name are one name in the text,
 * so both stay on the list. That is CMT-007's recorded limit of keeping
 * the body plain.
 */
export function namedInDraft(
  draft: string,
  picked: readonly MentionCandidate[],
): MentionCandidate[] {
  const tokens = picked.map((person) => mentionText(person.displayName));
  return picked.filter((_person, index) => {
    const token = tokens[index]!;
    return ownOccurrences(draft, token, longerNames(token, tokens)).length > 0;
  });
}

/**
 * The draft with every mention of one person taken out of it — what the
 * chip's remove control leaves behind.
 *
 * Each name goes with the space that follows it where there is one, so
 * removing a mention does not leave a gap in the sentence. A longer
 * picked name that starts the same way is left standing: taking back
 * "@Casey" must not cut "@Casey Contributor" in half.
 */
export function withoutMention(
  draft: string,
  person: MentionCandidate,
  picked: readonly MentionCandidate[],
): string {
  const token = mentionText(person.displayName);
  const tokens = picked.map((other) => mentionText(other.displayName));
  const hits = ownOccurrences(draft, token, longerNames(token, tokens));
  let kept = "";
  let from = 0;
  for (const at of hits) {
    if (at < from) continue;
    kept += draft.slice(from, at);
    const after = at + token.length;
    from = draft.startsWith(" ", after) ? after + 1 : after;
  }
  return kept + draft.slice(from);
}

/** Who among the people named cannot hear a comment at this tier. */
export function unreachableAt(
  named: readonly MentionCandidate[],
  tier: CommentTier,
): MentionCandidate[] {
  return named.filter((person) => !person.tiers.includes(tier));
}

/**
 * The narrowest tier that reaches everybody named and that this author
 * may post at, or `null` when no tier does both.
 *
 * `COMMENT_TIERS` is narrowest first, so the first tier that works is
 * the smallest step. Widening the audience is the least the promotion
 * can do; jumping to Full Thread would hand the conversation to a room
 * nobody asked for.
 */
export function narrowestTierFor(
  named: readonly MentionCandidate[],
  allowed: readonly CommentTier[],
): CommentTier | null {
  return (
    COMMENT_TIERS.find(
      (tier) => allowed.includes(tier) && named.every((person) => person.tiers.includes(tier)),
    ) ?? null
  );
}
