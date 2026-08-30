// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The paper a Request carries (INT-002, DOC-008): the files a requester
 * attached to their ask, and nothing more.
 *
 * Lightweight on purpose. A Request is not a document owner. Every
 * `documents` row belongs to a Matter, a Contract, an Entity, or a
 * knowledge item (DOC-008). So an attachment is a stored blob and the
 * name it arrived under. It has no version chain, no folder, no
 * confidentiality flag, and no metadata to edit. Conversion (M21) is
 * what promotes one into `documents`, under the record the Request
 * became.
 *
 * Five columns and a stamp, exactly as SCHEMA.md records them. There
 * is no declared media type and no byte count here, because nothing on
 * this side of conversion reads either. The download answers
 * `application/octet-stream` rather than echoing a client's declaration,
 * which is the rule an email attachment's download already follows
 * (DOC-004). A promotion that needs those facts reads them off the blob.
 *
 * `file_ref` is the storage seam's `<driver>:<key>` reference (DOC-012).
 * The key is minted from the attachment's own id and never from the
 * filename, so no name a person chose can shape a storage key.
 */

import { index, pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { users } from "./auth.js";
import { uuidPk } from "./helpers.js";
import { requests } from "./requests.js";

export const requestAttachments = pgTable(
  "request_attachments",
  {
    id: uuidPk(),
    /** The ask the paper travels with. Cascade: an attachment is part
     * of its Request and has no meaning without one, the rule
     * `request_type_fields` follows one table up. The cascade takes the
     * row and not the blob, because no database cascade reaches a
     * storage driver. So whichever milestone builds a Request hard
     * delete owes the read-then-delete pass `documents` makes (DOC-010,
     * DOC-012). */
    requestId: text("request_id")
      .notNull()
      .references(() => requests.id, { onDelete: "cascade" }),
    /** Where the bytes live (DOC-012): `<driver>:<key>`. */
    fileRef: text("file_ref").notNull(),
    /** The name the file arrived under, and the name a download offers
     * it back as. Stored as the uploader's machine spelled it. */
    filename: text("filename").notNull(),
    /** Who attached it. The Requester on the portal. A column of its
     * own because the Request's own `requester_id` answers a different
     * question: who asked, not who put this file here. */
    uploadedBy: text("uploaded_by")
      .notNull()
      .references(() => users.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    // The one read there is: every attachment on one Request, in the
    // order they were attached.
    index("request_attachments_request_idx").on(table.requestId, table.createdAt),
  ],
);

export type RequestAttachment = typeof requestAttachments.$inferSelect;
