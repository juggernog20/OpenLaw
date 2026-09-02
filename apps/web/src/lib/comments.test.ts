// SPDX-License-Identifier: AGPL-3.0-only

/** Folding a live re-read window into the thread on screen (M30/4, CMT-002). */

import { describe, expect, it } from "vitest";
import { mergeCommentWindow, type Comment } from "./comments";

function comment(id: string, createdAt: string, body = id): Comment {
  return {
    id,
    entityType: "contract",
    entityId: "c1",
    author: { id: "u1", displayName: "Alex Author", image: null, archived: false },
    body,
    visibility: "working_team",
    mentions: [],
    createdAt,
    editedAt: null,
    deletedAt: null,
    redactedAt: null,
  };
}

const A = comment("c-a", "2026-08-12T09:00:00.000Z");
const B = comment("c-b", "2026-08-12T09:30:00.000Z");
const C = comment("c-c", "2026-08-12T10:00:00.000Z");
const D = comment("c-d", "2026-08-12T11:00:00.000Z");

describe("mergeCommentWindow", () => {
  it("puts rows the shifted last page brought back in thread order", () => {
    // On screen: the newest page as it stood, [B, C]. Then D is posted and
    // the re-read walks back to B; the page that holds B now also holds A.
    const merged = mergeCommentWindow([B, C], [A, B, C, D]);
    expect(merged.map((row) => row.id)).toEqual(["c-a", "c-b", "c-c", "c-d"]);
  });

  it("takes the server's form of a row already on screen", () => {
    const edited = { ...B, body: "The corrected word.", editedAt: "2026-08-12T12:00:00.000Z" };
    const merged = mergeCommentWindow(
      [A, B, C],
      [B, C].map((row) => (row === B ? edited : row)),
    );
    expect(merged.map((row) => row.id)).toEqual(["c-a", "c-b", "c-c"]);
    expect(merged[1]).toEqual(edited);
  });

  it("keeps rows from older pages the window did not reach", () => {
    // The reader paged back to A; the window only came back as far as B.
    const merged = mergeCommentWindow([A, B, C], [B, C, D]);
    expect(merged.map((row) => row.id)).toEqual(["c-a", "c-b", "c-c", "c-d"]);
  });

  it("puts a reply that landed before the re-read answered in its own place", () => {
    // The viewer's own post D was appended while a window without it was
    // in flight, and the window carries C, which was said before D.
    const merged = mergeCommentWindow([A, B, D], [A, B, C]);
    expect(merged.map((row) => row.id)).toEqual(["c-a", "c-b", "c-c", "c-d"]);
  });

  it("breaks a same-instant tie by id, the read route's own tiebreak", () => {
    const instant = "2026-08-12T09:00:00.000Z";
    const merged = mergeCommentWindow(
      [comment("c-2", instant)],
      [comment("c-3", instant), comment("c-1", instant)],
    );
    expect(merged.map((row) => row.id)).toEqual(["c-1", "c-2", "c-3"]);
  });
});
