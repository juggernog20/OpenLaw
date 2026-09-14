// SPDX-License-Identifier: AGPL-3.0-only

/** ADO-005: copy allowed output into recorded Filings; a saved Filing id makes deferred delivery idempotent. */
import { createHash } from "node:crypto";
import { Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { uuidv7 } from "uuidv7";
import {
  and,
  eq,
  desc,
  sql,
  autoDocs,
  autoDocGenerations,
  autoDocFormVersions,
  autoDocFilings,
  contracts,
  matters,
  users,
  type Executor,
  type Transaction,
  type AutoDocGeneration,
} from "@openlaw/db";
import type { z } from "zod";
import type { AuthenticatedUser } from "../../auth/guards.js";
import type { AppDeps } from "../../app.js";
import { recordActivity } from "../../lib/activity.js";
import { reachedContract, contractTeamScope } from "../../lib/contract-access.js";
import { reachedMatter, matterTeamScope } from "../../lib/matter-access.js";
import { portalRecordScope } from "../../lib/portal-record-access.js";
import { HttpError, httpError } from "../../lib/problem.js";
import { withStoredBlobs } from "../../lib/uploads.js";
import {
  requestDerivations,
  versionStorageKey,
  type AppendedVersion,
} from "../../lib/document-versions.js";
import type { PipelineLogger } from "../../pipeline/logger.js";
import { FilingInput, ExistingFilingDestination } from "./filing-schema.js";
import { lockPortalPerson, readPortalAutoDoc } from "./portal-policy.js";
import { prepareContractDestination } from "./contract-destination.js";
import { createGeneratedContract } from "./create-contract.js";
import { addGeneratedDocument } from "./filed-document.js";

type FilingDeps = Pick<AppDeps, "db" | "storage" | "notifier" | "jobs">;
export function filingFormat(formats: AutoDocGeneration["formats"], format?: "docx" | "pdf") {
  const chosen = format ?? (formats === "pdf" ? "pdf" : "docx");
  if (formats !== "both" && formats !== chosen)
    throw httpError(403, "This format is not allowed for this Generation.");
  return chosen;
}
export async function filingSource(
  db: Executor,
  user: AuthenticatedUser,
  autoDocId: string,
  generationId: string,
  portal: boolean,
  lock = false,
) {
  if (portal) await readPortalAutoDoc(db, user, autoDocId, false, lock);
  const [generation] = await db
    .select()
    .from(autoDocGenerations)
    .where(
      and(
        eq(autoDocGenerations.id, generationId),
        eq(autoDocGenerations.autoDocId, autoDocId),
        portal ? eq(autoDocGenerations.generatedBy, user.id) : undefined,
      ),
    );
  if (!generation) throw httpError(404, "This Generation is not available to you.");
  return generation;
}
export async function reachedFilingDestination(
  tx: Transaction,
  user: AuthenticatedUser,
  destination: z.infer<typeof ExistingFilingDestination>,
  portal: boolean,
) {
  const row =
    destination.kind === "contract"
      ? await reachedContract(tx, user, destination.number, { lock: true })
      : await reachedMatter(tx, user, destination.number, { lock: true });
  if (!row) throw httpError(404, "This Filing destination is not available to you.");
  if (portal) {
    const table = destination.kind === "contract" ? contracts : matters;
    const [held] = await tx
      .select({ id: table.id })
      .from(table)
      .where(and(eq(table.id, row.id), portalRecordScope(tx, user, destination.kind)));
    if (!held) throw httpError(404, "This Filing destination is not available to you.");
  }
  if (row.archivedAt) throw httpError(409, "Restore this record before Filing to it.");
  return row;
}
export async function listFilings(
  db: Executor,
  user: AuthenticatedUser,
  generationId: string,
  portal: boolean,
) {
  const rows = await db
    .select({
      filing: autoDocFilings,
      contract: { number: contracts.number, title: contracts.title },
      matter: { number: matters.number, title: matters.title },
    })
    .from(autoDocFilings)
    .leftJoin(
      contracts,
      and(
        eq(contracts.id, autoDocFilings.contractId),
        portal ? portalRecordScope(db, user, "contract") : contractTeamScope(db, user),
      ),
    )
    .leftJoin(
      matters,
      and(
        eq(matters.id, autoDocFilings.matterId),
        portal ? portalRecordScope(db, user, "matter") : matterTeamScope(db, user),
      ),
    )
    .where(eq(autoDocFilings.generationId, generationId))
    .orderBy(desc(autoDocFilings.createdAt), desc(autoDocFilings.id));
  return rows.map(({ filing, contract, matter }) => ({
    id: filing.id,
    generationId,
    documentId: contract || matter ? filing.documentId : null,
    format: filing.format,
    createdContract: filing.createdContract,
    filedBy: filing.filedBy,
    createdAt: filing.createdAt.toISOString(),
    target: contract
      ? { kind: "contract" as const, ...contract }
      : matter
        ? { kind: "matter" as const, ...matter }
        : null,
  }));
}

/** The Generation lock protects the source blob against retry for the whole copy. */
export async function fileGeneration(
  deps: FilingDeps,
  log: PipelineLogger,
  user: AuthenticatedUser,
  autoDocId: string,
  generationId: string,
  input: z.infer<typeof FilingInput>,
  portal: boolean,
  requestedId?: string,
) {
  const stored: string[] = [];
  let version: AppendedVersion | undefined;
  const filingId = requestedId ?? uuidv7();
  await withStoredBlobs(deps.storage, log, stored, () =>
    deps.notifier.notifying(async (tx) => {
      await lockPortalPerson(tx, user);
      await filingSource(tx, user, autoDocId, generationId, portal, true);
      const [generation] = await tx
        .select()
        .from(autoDocGenerations)
        .where(eq(autoDocGenerations.id, generationId))
        .for("update");
      const [existing] = await tx
        .select({ id: autoDocFilings.id })
        .from(autoDocFilings)
        .where(eq(autoDocFilings.id, filingId));
      if (existing) return;
      if (requestedId && generation!.requestedFiling?.id !== requestedId) return;
      if (!requestedId && generation!.requestedFiling && !generation!.filingFailure)
        throw httpError(409, "This Generation already has a Filing in progress.");
      const format = filingFormat(generation!.formats, input.format);
      const source = format === "docx" ? generation!.docxFileRef : generation!.pdfFileRef;
      if (!source)
        throw httpError(409, "This output is still being prepared. File it when it is ready.");
      const [autoDoc] = await tx
        .select()
        .from(autoDocs)
        .where(eq(autoDocs.id, autoDocId))
        .for("share");
      const destination = input.destination;
      if (destination.kind === "new_contract" && (portal || user.role === "business_user"))
        throw httpError(403, "Only a Member can File to a new Contract from the app.");
      const target =
        destination.kind === "new_contract"
          ? null
          : await reachedFilingDestination(tx, user, destination, portal);
      let facts = null;
      if (destination.kind === "new_contract") {
        const [form] = await tx
          .select()
          .from(autoDocFormVersions)
          .where(eq(autoDocFormVersions.id, generation!.formVersionId));
        facts = await prepareContractDestination(
          tx,
          user,
          { ...autoDoc!, targetContractTypeId: destination.contractTypeId },
          form!.definition,
          generation!.answers,
          generation!.displayValues,
          destination.businessOwnerId,
        );
      }
      const documentId = uuidv7();
      const versionId = uuidv7();
      const hash = createHash("sha256");
      let byteSize = 0;
      const counting = new Transform({
        transform(chunk: Buffer, _encoding, callback) {
          byteSize += chunk.length;
          hash.update(chunk);
          callback(null, chunk);
        },
      });
      const stream = await deps.storage.get(source);
      const copy = deps.storage
        .put(versionStorageKey(documentId, versionId), counting)
        .catch((error: unknown) => {
          counting.destroy(error instanceof Error ? error : new Error("The Filing copy failed."));
          throw error;
        });
      const transfer = pipeline(stream, counting);
      const results = await Promise.allSettled([copy, transfer]);
      if (results[0].status === "fulfilled") stored.push(results[0].value);
      for (const result of results) if (result.status === "rejected") throw result.reason;
      const fileRef = (results[0] as PromiseFulfilledResult<string>).value;
      version = {
        documentId,
        versionId,
        versionNumber: 1,
        fileRef,
        kind: "draft_ours",
        source: "generated",
        generatedFromGenerationId: generationId,
        comparedFromVersionId: null,
        comparedToVersionId: null,
        note: null,
        originalFilename: `${autoDoc!.name}.${format}`,
        mimeType:
          format === "pdf"
            ? "application/pdf"
            : "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        byteSize,
        checksumSha256: hash.digest("hex"),
        createdBy: user.id,
      };
      let contractId: string | null = destination.kind === "contract" ? target!.id : null;
      let targetNumber = target?.number;
      let targetTitle = target?.title;
      if (facts) {
        const born = await createGeneratedContract(tx, deps.notifier, generation!, version, {
          facts,
          actorId: user.id,
        });
        contractId = born.createdContractId;
        const [row] = await tx.select().from(contracts).where(eq(contracts.id, contractId));
        targetNumber = row!.number;
        targetTitle = row!.title;
      } else {
        await addGeneratedDocument(tx, deps.notifier, {
          target: { kind: destination.kind as "matter" | "contract", id: target!.id },
          version,
          title: autoDoc!.name,
          actor: user,
          takePrimary:
            destination.kind === "contract" &&
            "primaryDocumentId" in target! &&
            target!.primaryDocumentId === null &&
            user.role !== "business_user",
        });
      }
      await tx.insert(autoDocFilings).values({
        id: filingId,
        generationId,
        documentId,
        contractId,
        matterId: destination.kind === "matter" ? target!.id : null,
        createdContract: destination.kind === "new_contract",
        format,
        filedBy: user.id,
      });
      await tx
        .update(autoDocGenerations)
        .set({ requestedFiling: null, filingFailure: null, updatedAt: new Date() })
        .where(eq(autoDocGenerations.id, generationId));
      await recordActivity(tx, {
        entityType: "auto_doc",
        entityId: autoDocId,
        actorId: user.id,
        action: "auto_doc.filed",
        visibility: "legal_only",
        payload: {
          name: autoDoc!.name,
          generationId,
          filingId,
          documentId,
          targetKind: destination.kind === "matter" ? "matter" : "contract",
          targetNumber: targetNumber!,
          targetTitle: targetTitle!,
        },
      });
    }),
  );
  if (version) await requestDerivations(deps.jobs, log, version);
  return (
    (await listFilings(deps.db, user, generationId, portal)).find((row) => row.id === filingId) ??
    null
  );
}

/** A saved destination outlives the HTTP request, including PDF conversion and worker restarts. */
export async function fulfilRequestedFiling(
  deps: FilingDeps,
  log: PipelineLogger,
  generationId: string,
) {
  const [generation] = await deps.db
    .select()
    .from(autoDocGenerations)
    .where(eq(autoDocGenerations.id, generationId));
  const request = generation?.requestedFiling;
  if (!generation || !request || generation.filingFailure) return;
  if (!(request.format === "pdf" ? generation.pdfFileRef : generation.docxFileRef)) return;
  try {
    const [user] = await deps.db.select().from(users).where(eq(users.id, generation.generatedBy));
    if (!user || user.archivedAt || user.role === "business_user")
      throw httpError(403, "Your access has changed. Choose a Filing destination again.");
    await fileGeneration(
      deps,
      log,
      user,
      generation.autoDocId,
      generationId,
      request,
      false,
      request.id,
    );
  } catch (error) {
    log.warn({ err: error, generationId }, "The requested Filing could not be completed");
    await deps.db
      .update(autoDocGenerations)
      .set({
        filingFailure: {
          code: "filing_failed",
          detail:
            error instanceof HttpError && error.statusCode < 500
              ? error.message
              : "Filing failed. Choose a destination to try again.",
        },
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(autoDocGenerations.id, generationId),
          eq(autoDocGenerations.attempt, generation.attempt),
          sql`${autoDocGenerations.requestedFiling}->>'id' = ${request.id}`,
        ),
      );
  }
}
