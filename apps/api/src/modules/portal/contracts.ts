// SPDX-License-Identifier: AGPL-3.0-only

/** DD-021 exposes selected Contract facts and the current primary Document through
 * eight read operations. Unreachable records answer 404; legal record details stay private. */

import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import type { FastifyReply } from "fastify";
import { z } from "zod";
import {
  alias,
  and,
  contracts,
  contractCounterparties,
  counterparties,
  contractStatuses,
  CONTRACT_STAGES,
  DOCUMENT_VERSION_KINDS,
  TERM_TYPES,
  VALUE_CADENCES,
  desc,
  documents,
  documentVersions,
  documentVersionRenditions,
  eq,
  isNull,
  lt,
  or,
  users,
} from "@openlaw/db";
import { requireAuth, type AuthenticatedUser } from "../../auth/guards.js";
import { portalContractScope } from "../../lib/portal-contract-access.js";
import { contractNamedAudienceScope, NO_CONTRACT } from "../../lib/contract-access.js";
import { httpError, problemResponse } from "../../lib/problem.js";
import { noticeDeadline, renewalPending } from "../../lib/contract-term.js";
import { attachmentDisposition, inlineDisposition } from "../../lib/uploads.js";
import {
  conversionFormatOf,
  previewContentType,
  renderFamilyOf,
  RENDER_FAMILIES,
} from "../../lib/render-family.js";
import { EmailUnreadableError, isEmail, parseStoredEmail } from "../../lib/email/parse.js";
import { EmailSchema } from "../documents/routes.js";

const Params = z.object({ number: z.coerce.number().int().positive() });
const VersionParams = Params.extend({
  documentId: z.string().min(1),
  versionId: z.string().min(1),
});
const AttachmentParams = VersionParams.extend({
  attachmentIndex: z.coerce.number().int().nonnegative(),
});
const Person = z.object({ id: z.string(), displayName: z.string(), image: z.string().nullable() });
const AllowedUnverified = [
  "counterparty",
  "value",
  "effectiveDate",
  "expiryDate",
  "termType",
  "noticePeriodDays",
  "renewalPeriodMonths",
] as const;
const UnverifiedSlugs: Record<(typeof AllowedUnverified)[number], string> = {
  counterparty: "counterparty",
  value: "value",
  effectiveDate: "effective_date",
  expiryDate: "expiry_date",
  termType: "term_type",
  noticePeriodDays: "notice_period_days",
  renewalPeriodMonths: "renewal_period_months",
};
const ContractSchema = z.object({
  number: z.number().int(),
  title: z.string(),
  stage: z.enum(CONTRACT_STAGES),
  counterparty: z.string().nullable(),
  legalOwner: Person.nullable(),
  businessOwner: Person.nullable(),
  termType: z.enum(TERM_TYPES),
  effectiveDate: z.iso.date().nullable(),
  expiryDate: z.iso.date().nullable(),
  renewalPeriodMonths: z.number().int().nullable(),
  noticePeriodDays: z.number().int().nullable(),
  noticeDeadline: z.iso.date().nullable(),
  renewalPendingConfirmation: z.boolean(),
  value: z
    .object({ amount: z.number(), currency: z.string(), cadence: z.enum(VALUE_CADENCES) })
    .nullable(),
  unverifiedFields: z.array(z.enum(AllowedUnverified)),
});
const ReaderVersion = z.object({
  id: z.string(),
  versionNumber: z.number().int(),
  kind: z.enum(DOCUMENT_VERSION_KINDS),
  originalFilename: z.string(),
  mimeType: z.string(),
  renderFamily: z.enum(RENDER_FAMILIES),
  byteSize: z.number(),
});
const PrimaryDocument = z.object({ id: z.string(), title: z.string(), version: ReaderVersion });
const Download = z.any().meta({ type: "string", format: "binary" });
const Rendition = z.object({
  rendition: z.object({
    state: z.enum(["pending", "ready", "failed", "unsupported"]),
    updatedAt: z.iso.datetime().nullable(),
  }),
});
const PAGE_SIZE = 25;
const ACCESS_SUMMARY =
  "DD-021: Administrator, Legal Team Member, Contributor or Business User must be the current Business Owner or an explicit stakeholder. Archived records are excluded; Confidential records require named team membership or Legal Owner. Document reads accept only the current Version of the primary Document. ";
const NO_DOCUMENT = "No primary Document Version exists at this address.";

export const portalContractRoutes: FastifyPluginAsyncZod = async (app) => {
  const businessOwner = alias(users, "portal_business_owner");
  const select = () =>
    app.db
      .select({
        row: contracts,
        stage: contractStatuses.stage,
        counterparty: counterparties.name,
        legalOwner: { id: users.id, displayName: users.displayName, image: users.image },
        businessOwner: {
          id: businessOwner.id,
          displayName: businessOwner.displayName,
          image: businessOwner.image,
        },
      })
      .from(contracts)
      .innerJoin(contractStatuses, eq(contracts.statusId, contractStatuses.id))
      .leftJoin(users, eq(contracts.managerId, users.id))
      .leftJoin(businessOwner, eq(contracts.businessOwnerId, businessOwner.id))
      .leftJoin(
        contractCounterparties,
        and(
          eq(contractCounterparties.contractId, contracts.id),
          eq(contractCounterparties.isPrimary, true),
        ),
      )
      .leftJoin(counterparties, eq(contractCounterparties.counterpartyId, counterparties.id));
  type Selected = Awaited<ReturnType<typeof select>>[number];
  function project({ row, stage, counterparty, legalOwner, businessOwner }: Selected) {
    return {
      number: row.number,
      title: row.title,
      stage,
      counterparty,
      legalOwner,
      businessOwner,
      termType: row.termType,
      effectiveDate: row.effectiveDate,
      expiryDate: row.expiryDate,
      renewalPeriodMonths: row.renewalPeriodMonths,
      noticePeriodDays: row.noticePeriodDays,
      noticeDeadline: noticeDeadline(row.expiryDate, row.noticePeriodDays),
      renewalPendingConfirmation: renewalPending(row),
      value:
        row.valueAmount !== null && row.valueCurrency !== null && row.valueCadence !== null
          ? { amount: row.valueAmount, currency: row.valueCurrency, cadence: row.valueCadence }
          : null,
      unverifiedFields: AllowedUnverified.filter(
        (slug) => row.aiUnverified?.[UnverifiedSlugs[slug]],
      ),
    };
  }

  function primaryVersions(user: AuthenticatedUser, number: number) {
    return app.db
      .select({ documentId: documents.id, title: documents.title, version: documentVersions })
      .from(documentVersions)
      .innerJoin(documents, eq(documentVersions.documentId, documents.id))
      .innerJoin(
        contracts,
        and(eq(documents.contractId, contracts.id), eq(contracts.primaryDocumentId, documents.id)),
      )
      .where(
        and(
          eq(contracts.number, number),
          portalContractScope(app.db, user),
          isNull(documents.archivedAt),
          or(eq(documents.isConfidential, false), contractNamedAudienceScope(app.db, user)),
        ),
      )
      .orderBy(desc(documentVersions.versionNumber))
      .limit(1);
  }
  async function version(user: AuthenticatedUser, params: z.infer<typeof VersionParams>) {
    const [current] = await primaryVersions(user, params.number);
    if (
      !current ||
      current.documentId !== params.documentId ||
      current.version.id !== params.versionId
    ) {
      throw httpError(404, NO_DOCUMENT);
    }
    return current.version;
  }
  function readerVersion(row: typeof documentVersions.$inferSelect) {
    return {
      id: row.id,
      versionNumber: row.versionNumber,
      kind: row.kind,
      originalFilename: row.originalFilename,
      mimeType: row.mimeType,
      renderFamily: renderFamilyOf(row.mimeType, row.originalFilename),
      byteSize: row.byteSize,
    };
  }
  function privateRead(reply: FastifyReply) {
    return reply.header("cache-control", "private, no-store");
  }

  app.get(
    "/portal/contracts",
    {
      preHandler: requireAuth,
      schema: {
        operationId: "listPortalContracts",
        summary: ACCESS_SUMMARY + "List eligible Contracts.",
        tags: ["portal"],
        querystring: z.object({ cursor: z.coerce.number().int().positive().optional() }),
        response: {
          200: z.object({
            contracts: z.array(ContractSchema),
            nextCursor: z.number().int().positive().nullable(),
          }),
          default: problemResponse,
        },
      },
    },
    async (request, reply) => {
      privateRead(reply);
      const rows = await select()
        .where(
          and(
            portalContractScope(app.db, request.user),
            request.query.cursor ? lt(contracts.number, request.query.cursor) : undefined,
          ),
        )
        .orderBy(desc(contracts.number))
        .limit(PAGE_SIZE + 1);
      const page = rows.slice(0, PAGE_SIZE);
      return {
        contracts: page.map(project),
        nextCursor: rows.length > PAGE_SIZE ? page.at(-1)!.row.number : null,
      };
    },
  );
  app.get(
    "/portal/contracts/:number",
    {
      preHandler: requireAuth,
      schema: {
        operationId: "readPortalContract",
        summary: ACCESS_SUMMARY + "Read selected Contract facts.",
        tags: ["portal"],
        params: Params,
        response: {
          200: z.object({
            contract: ContractSchema.extend({ primaryDocument: PrimaryDocument.nullable() }),
          }),
          default: problemResponse,
        },
      },
    },
    async (request, reply) => {
      privateRead(reply);
      const [record] = await select()
        .where(
          and(
            eq(contracts.number, request.params.number),
            portalContractScope(app.db, request.user),
          ),
        )
        .limit(1);
      if (!record) throw httpError(404, NO_CONTRACT);
      const [document] = await primaryVersions(request.user, request.params.number);
      return {
        contract: {
          ...project(record),
          primaryDocument: document
            ? {
                id: document.documentId,
                title: document.title,
                version: readerVersion(document.version),
              }
            : null,
        },
      };
    },
  );

  app.get(
    "/portal/contracts/:number/documents/:documentId/versions/:versionId/download",
    {
      preHandler: requireAuth,
      schema: {
        operationId: "downloadPortalContractVersion",
        summary: ACCESS_SUMMARY,
        tags: ["portal"],
        params: VersionParams,
        response: { 200: Download, default: problemResponse },
      },
    },
    async (request, reply) => {
      const row = await version(request.user, request.params);
      return privateRead(reply)
        .header("content-type", row.mimeType)
        .header("content-length", String(row.byteSize))
        .header("content-disposition", attachmentDisposition(row.originalFilename))
        .header("x-content-type-options", "nosniff")
        .send(await app.storage.get(row.fileRef));
    },
  );
  app.get(
    "/portal/contracts/:number/documents/:documentId/versions/:versionId/preview",
    {
      preHandler: requireAuth,
      schema: {
        operationId: "previewPortalContractVersion",
        summary: ACCESS_SUMMARY,
        tags: ["portal"],
        params: VersionParams,
        response: { 200: Download, default: problemResponse },
      },
    },
    async (request, reply) => {
      const row = await version(request.user, request.params);
      let fileRef = row.fileRef;
      let byteSize = row.byteSize;
      let filename = row.originalFilename;
      let contentType = previewContentType(row.mimeType, filename);
      if (conversionFormatOf(row.mimeType, filename)) {
        const [rendition] = await app.db
          .select()
          .from(documentVersionRenditions)
          .where(eq(documentVersionRenditions.versionId, row.id));
        if (!rendition || rendition.state === "pending")
          throw httpError(409, "The preview is still being prepared.");
        if (rendition.state !== "ready" || !rendition.fileRef || rendition.byteSize === null)
          throw httpError(415, "This preview is unavailable. Download the Document instead.");
        fileRef = rendition.fileRef;
        byteSize = rendition.byteSize;
        filename += ".pdf";
        contentType = "application/pdf";
      }
      if (!contentType)
        throw httpError(415, "This file type has no in-app preview. Download it instead.");
      return privateRead(reply)
        .header("content-type", contentType)
        .header("content-length", String(byteSize))
        .header("content-disposition", inlineDisposition(filename))
        .header("x-content-type-options", "nosniff")
        .header("content-security-policy", "default-src 'none'; sandbox")
        .send(await app.storage.get(fileRef));
    },
  );
  app.get(
    "/portal/contracts/:number/documents/:documentId/versions/:versionId/rendition",
    {
      preHandler: requireAuth,
      schema: {
        operationId: "readPortalContractRendition",
        summary: ACCESS_SUMMARY,
        tags: ["portal"],
        params: VersionParams,
        response: { 200: Rendition, default: problemResponse },
      },
    },
    async (request, reply) => {
      const row = await version(request.user, request.params);
      privateRead(reply);
      if (!conversionFormatOf(row.mimeType, row.originalFilename))
        return { rendition: { state: "unsupported" as const, updatedAt: null } };
      const [rendition] = await app.db
        .select({
          state: documentVersionRenditions.state,
          updatedAt: documentVersionRenditions.updatedAt,
        })
        .from(documentVersionRenditions)
        .where(eq(documentVersionRenditions.versionId, row.id));
      return {
        rendition: {
          state: rendition?.state ?? ("pending" as const),
          updatedAt: rendition?.updatedAt.toISOString() ?? null,
        },
      };
    },
  );

  async function email(user: AuthenticatedUser, params: z.infer<typeof VersionParams>) {
    const row = await version(user, params);
    if (!isEmail(row.mimeType, row.originalFilename))
      throw httpError(415, "This file is not an email.");
    const stream = await app.storage.get(row.fileRef);
    try {
      return await parseStoredEmail(stream, row.mimeType, row.originalFilename);
    } catch (error) {
      if (error instanceof EmailUnreadableError)
        throw httpError(422, "This email could not be read. Download it instead.");
      throw error;
    } finally {
      // As the staff reader closes one: a parse that refused part way
      // leaves the stream open, and a close that fails must not replace
      // the answer above — tidying up is never the news.
      try {
        stream.destroy();
      } catch (error) {
        app.log.warn({ err: error, versionId: params.versionId }, "could not close an email");
      }
    }
  }
  app.get(
    "/portal/contracts/:number/documents/:documentId/versions/:versionId/email",
    {
      preHandler: requireAuth,
      schema: {
        operationId: "readPortalContractEmail",
        summary: ACCESS_SUMMARY,
        tags: ["portal"],
        params: VersionParams,
        response: { 200: z.object({ email: EmailSchema }), default: problemResponse },
      },
    },
    async (request, reply) => {
      const parsed = await email(request.user, request.params);
      privateRead(reply);
      return {
        email: {
          ...parsed,
          attachments: parsed.attachments.map((attachment) => ({
            index: attachment.index,
            filename: attachment.filename,
            mimeType: attachment.mimeType,
            byteSize: attachment.byteSize,
            isInline: attachment.isInline,
            renderFamily: renderFamilyOf(attachment.mimeType, attachment.filename),
          })),
        },
      };
    },
  );
  for (const mode of ["download", "preview"] as const) {
    app.get(
      `/portal/contracts/:number/documents/:documentId/versions/:versionId/attachments/:attachmentIndex/${mode}`,
      {
        preHandler: requireAuth,
        schema: {
          summary: ACCESS_SUMMARY,
          operationId:
            mode === "download"
              ? "downloadPortalContractEmailAttachment"
              : "previewPortalContractEmailAttachment",
          tags: ["portal"],
          params: AttachmentParams,
          response: { 200: Download, default: problemResponse },
        },
      },
      async (request, reply) => {
        const parsed = await email(request.user, request.params);
        const attachment = parsed.attachments[request.params.attachmentIndex];
        if (!attachment) throw httpError(404, "No attachment exists at that position.");
        if (attachment.content === null)
          throw httpError(422, "This attachment could not be read. Download the email instead.");
        const contentType =
          mode === "preview"
            ? previewContentType(attachment.mimeType, attachment.filename)
            : "application/octet-stream";
        if (!contentType)
          throw httpError(415, "This attachment has no in-app preview. Download it instead.");
        privateRead(reply)
          .header("content-type", contentType)
          .header("content-length", String(attachment.byteSize))
          .header(
            "content-disposition",
            mode === "preview"
              ? inlineDisposition(attachment.filename)
              : attachmentDisposition(attachment.filename),
          )
          .header("x-content-type-options", "nosniff");
        if (mode === "preview")
          reply.header("content-security-policy", "default-src 'none'; sandbox");
        return reply.send(attachment.content);
      },
    );
  }
};
