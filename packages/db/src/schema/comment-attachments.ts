// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The paper carried by a comment (CMT-011).
 *
 * An attachment is part of what the comment said, not a Document: it is
 * one immutable stored blob and the name it arrived under. The comment's
 * visibility is therefore its only audience rule. Filing is M21A/3's act;
 * its two nullable references land now so that filing can mark the row
 * without changing this table later.
 */

import { index, pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { users } from "./auth.js";
import { comments } from "./comments.js";
import { documents, documentVersions } from "./documents.js";
import { uuidPk } from "./helpers.js";

export const commentAttachments = pgTable(
  "comment_attachments",
  {
    id: uuidPk(),
    commentId: text("comment_id")
      .notNull()
      .references(() => comments.id, { onDelete: "cascade" }),
    /** The storage seam's `<driver>:<key>` reference (DOC-012). */
    fileRef: text("file_ref").notNull(),
    /** Preserved exactly for the download's arriving filename. */
    filename: text("filename").notNull(),
    uploadedBy: text("uploaded_by")
      .notNull()
      .references(() => users.id),
    /** M21A/3: the Document this attachment was filed as, if any. */
    filedDocumentId: text("filed_document_id").references(() => documents.id, {
      onDelete: "set null",
    }),
    /** M21A/3: the exact version the filing produced, if any. */
    filedVersionId: text("filed_version_id").references(() => documentVersions.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("comment_attachments_comment_idx").on(table.commentId, table.createdAt, table.id),
  ],
);

export type CommentAttachment = typeof commentAttachments.$inferSelect;
