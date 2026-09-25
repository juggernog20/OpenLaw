// SPDX-License-Identifier: AGPL-3.0-only
import { z } from "zod";
import { documents, eq, HAND_SET_DOCUMENT_VERSION_KINDS } from "@openlaw/db";
import {
  listContractDocuments,
  listMatterDocuments,
  listEntityDocuments,
  listKnowledgeItemDocuments,
  listAutoDocDocuments,
  readDocumentVersionText,
  readPortalKnowledgeVersionText,
} from "../modules/documents/service.js";
import { listPortalDocuments } from "../modules/portal/document-service.js";
import { getPortalKnowledge } from "../modules/portal/routes.js";
import { bounded, boundedPage, pageInput, serviceResult } from "./results.js";
import { ToolError, type ToolDefinition } from "./tool.js";
import { readTool } from "./workspace.js";

export const recordOutput = z.record(z.string(), z.unknown());
export const ownerInput = z.object({
  ownerType: z.enum(["contract", "matter", "entity", "knowledge_item", "auto_doc"]),
  number: z.number().int().min(1).optional(),
  id: z.string().uuid().optional(),
});
export const uploadInput = ownerInput.extend({
  documentId: z.string().uuid().optional(),
  filename: z.string().trim().min(1).max(255),
  mimeType: z
    .string()
    .max(200)
    .regex(/^[a-zA-Z0-9!#$&^_.+-]+\/[a-zA-Z0-9!#$&^_.+-]+$/)
    .default("application/octet-stream"),
  kind: z.enum(HAND_SET_DOCUMENT_VERSION_KINDS).optional(),
  note: z.string().trim().max(2000).optional(),
});
const listInput = ownerInput.extend({ ...pageInput, cursor: z.string().min(1).max(64).optional() });
const textInput = z.object({
  documentId: z.string().uuid(),
  versionId: z.string().uuid(),
  cursor: z.string().max(128).optional(),
});
export function requireOwner(input: z.infer<typeof ownerInput>) {
  if (
    input.ownerType === "contract" || input.ownerType === "matter"
      ? !input.number || input.id !== undefined
      : !input.id || input.number !== undefined
  )
    throw new ToolError(
      "invalid_arguments",
      "Supply number for a Contract or Matter, or id for an Entity, Knowledge Item or Auto-Doc.",
    );
}
export const documentTools: readonly ToolDefinition[] = [
  {
    ...readTool,
    toolset: "documents",
    name: "openlaw_documents_list",
    title: "List Documents on a record",
    description:
      "Read Documents and their Versions on one record. ownerType is contract, matter, entity, knowledge_item or auto_doc. Supply number for contract or matter; id for other kinds. Business Users read Portal Documents. Continue with nextCursor and unchanged arguments.",
    inputSchema: listInput,
    outputSchema: z.object({ documents: z.array(recordOutput), nextCursor: z.string().nullable() }),
    run: async (input, { db, user }) =>
      serviceResult(async () => {
        const args = listInput.parse(input);
        requireOwner(args);
        let result;
        if (user.role === "business_user") {
          if (args.ownerType === "contract" || args.ownerType === "matter")
            result = await listPortalDocuments(db, user, args.ownerType, args.number!, {
              cursor: args.cursor,
            });
          else if (args.ownerType === "knowledge_item") {
            const all = (await getPortalKnowledge(db, user, args.id!)).knowledgeItem.documents;
            const index = args.cursor ? all.findIndex((d) => d.id === args.cursor) : -1;
            result = {
              documents: args.cursor && index < 0 ? [] : all.slice(index + 1),
              nextCursor: null,
            };
          } else throw new ToolError("forbidden", "These Documents require a Legal Team Member.");
        } else
          switch (args.ownerType) {
            case "contract":
              result = await listContractDocuments(db, user, args.number!, { cursor: args.cursor });
              break;
            case "matter":
              result = await listMatterDocuments(db, user, args.number!, { cursor: args.cursor });
              break;
            case "entity":
              result = await listEntityDocuments(db, user, args.id!, { cursor: args.cursor });
              break;
            case "knowledge_item":
              result = await listKnowledgeItemDocuments(db, user, args.id!, {
                cursor: args.cursor,
              });
              break;
            case "auto_doc":
              result = await listAutoDocDocuments(db, user, args.id!, { cursor: args.cursor });
              break;
          }
        const page = boundedPage<Record<string, unknown> & { id: string }>(
          result.documents,
          args.limit,
          (d) => d.id,
          result.nextCursor,
        );
        return bounded({ documents: page.items, nextCursor: page.nextCursor });
      }),
  },
  {
    ...readTool,
    toolset: "documents",
    name: "openlaw_document_read",
    title: "Read a Version's extracted text",
    description:
      "Read the stored extracted text of one Document Version. A pending, failed or unsupported text state has no readable text. Continue with nextCursor and the same documentId and versionId. Portal Knowledge permits only its current published Version.",
    inputSchema: textInput,
    outputSchema: z.object({
      text: z.object({
        state: z.string(),
        source: z.string().nullable(),
        text: z.string().nullable(),
        updatedAt: z.string().nullable(),
      }),
      nextCursor: z.string().nullable(),
    }),
    run: async (input, { db, user }) =>
      serviceResult(async () => {
        const args = textInput.parse(input);
        const [document] = await db
          .select({ knowledgeItemId: documents.knowledgeItemId })
          .from(documents)
          .where(eq(documents.id, args.documentId));
        const result =
          user.role === "business_user" && document?.knowledgeItemId
            ? await readPortalKnowledgeVersionText(db, user, args)
            : await readDocumentVersionText(db, user, args);
        const prefix = `${args.versionId}:`;
        const raw = args.cursor?.startsWith(prefix) ? args.cursor.slice(prefix.length) : undefined;
        const offset = raw === undefined ? 0 : Number(raw);
        if (
          args.cursor &&
          (raw === undefined ||
            !/^\d+$/.test(raw) ||
            !Number.isSafeInteger(offset) ||
            offset > (result.text.text?.length ?? 0))
        )
          throw new ToolError(
            "invalid_cursor",
            "This text cursor does not belong to this Version.",
          );
        const text = result.text.text;
        // Keep JSON escaping and both MCP result representations inside the byte budget.
        let end = Math.min(offset + 4000, text?.length ?? 0);
        if (text && end < text.length && /[\uD800-\uDBFF]/.test(text[end - 1]!)) end--;
        return bounded({
          text: { ...result.text, text: text === null ? null : text.slice(offset, end) },
          nextCursor: text && end < text.length ? `${prefix}${end}` : null,
        });
      }),
  },
  {
    ...readTool,
    kind: "write",
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      openWorldHint: false,
      idempotentHint: false,
    },
    toolset: "documents",
    name: "openlaw_document_upload",
    title: "Prepare a Document upload",
    description:
      "Get a signed uploadUrl, headers and pending versionId. PUT the file bytes to that URL within ten minutes. No Version exists until upload succeeds. ownerType is contract, matter, entity, knowledge_item or auto_doc; supply number for contract or matter, id otherwise. Add documentId to append a Version. Auto-Doc permits append only. kind is general, draft_ours, draft_theirs, redline_theirs, redline_ours, executed or amendment. Matter, Entity and Auto-Doc use general. Existing designations do not move on append.",
    inputSchema: uploadInput,
    outputSchema: z.object({
      uploadUrl: z.string(),
      headers: z.record(z.string(), z.string()),
      versionId: z.string(),
      documentId: z.string(),
      expiresAt: z.string(),
      maxUploadBytes: z.number().int(),
    }),
    run: async (input, context) =>
      serviceResult(async () => {
        const args = uploadInput.parse(input);
        requireOwner(args);
        if (!context.prepareDocumentUpload)
          throw new ToolError("unavailable", "Document uploads are unavailable.");
        return context.prepareDocumentUpload(args, context);
      }),
  },
];
