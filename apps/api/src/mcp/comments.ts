// SPDX-License-Identifier: AGPL-3.0-only
import { z } from "zod";
import {
  CommentListQuery,
  CommentSchema,
  EntityRefQuery,
  RecordIdSchema,
  VisibilitySchema,
  listComments,
} from "../modules/comments/service.js";
import { CommentBodySchema, postThreadComment } from "../modules/comments/post.js";
import { reachedThread } from "../modules/comments/audience.js";
import { bounded, boundedPage, pageInput, serviceResult } from "./results.js";
import { readTool, writeTool } from "./workspace.js";
import { ToolError, type ToolDefinition } from "./tool.js";

const listInput = CommentListQuery.extend({ limit: pageInput.limit }).strict();
const postInput = EntityRefQuery.extend({
  body: CommentBodySchema,
  visibility: VisibilitySchema.optional(),
  mentions: z.array(RecordIdSchema).max(20).optional(),
}).strict();
const targetDescription =
  "entityType is contract, matter, request, contract_task or matter_task; entityId is the record id. Tiers are legal_only (Legal Only), working_team (Working Team) and full_thread (Full Thread).";
export const commentTools: readonly ToolDefinition[] = [
  {
    ...readTool,
    toolset: "comments",
    name: "openlaw_comments_list",
    title: "Read comments",
    description: `Read comments only at the tiers you may read. ${targetDescription} Optional visibility narrows to one permitted tier. The newest page is returned oldest first; nextCursor walks backwards to older comments. Business Users read Full Thread only.`,
    inputSchema: listInput,
    outputSchema: z.object({ comments: z.array(CommentSchema), nextCursor: z.string().nullable() }),
    run: async (input, { db, user }) =>
      serviceResult(async () => {
        const query = listInput.parse(input);
        if (query.visibility) {
          const audience = await reachedThread(db, user, query);
          if (!audience.tiers.includes(query.visibility))
            throw new ToolError("forbidden", "You cannot read comments at that visibility tier.");
        }
        const result = await listComments(db, user, query);
        // Trim from the oldest end, preserving the service's backwards cursor.
        const page = boundedPage(
          [...result.comments].reverse(),
          query.limit,
          (row) => row.id,
          result.nextCursor,
        );
        return bounded({ comments: page.items.reverse(), nextCursor: page.nextCursor });
      }),
  },
  {
    ...writeTool,
    businessUser: "on",
    toolset: "comments",
    name: "openlaw_comment_post",
    title: "Post a comment",
    description: `Post a plain-text comment on a reachable thread. ${targetDescription} Omit visibility to use the most restrictive tier you may use on this record. Business Users post at Full Thread only. Optional mentions names up to 20 user ids; each must reach the thread and chosen tier. A mention never widens the tier automatically. Each call posts a new comment.`,
    inputSchema: postInput,
    outputSchema: z.object({ comment: CommentSchema }),
    run: async (input, { user, notifier }) =>
      serviceResult(async () => ({
        comment: await postThreadComment(notifier, user, postInput.parse(input)),
      })),
  },
];
