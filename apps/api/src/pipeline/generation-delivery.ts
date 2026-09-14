// SPDX-License-Identifier: AGPL-3.0-only

/** ADO-007: a Generation is a derivation input, followed by one recorded email outcome. */
import { Readable } from "node:stream";
import { buffer } from "node:stream/consumers";
import { uuidv7 } from "uuidv7";
import {
  autoDocGenerations,
  autoDocs,
  users,
  orgSettings,
  and,
  or,
  eq,
  gt,
  lt,
  isNull,
  isNotNull,
  asc,
} from "@openlaw/db";
import { fulfilRequestedFiling } from "../modules/auto-docs/filings.js";
import { createNotifier } from "../lib/notifications/notifier.js";
import { renderGenerationMail } from "../lib/notifications/generation-template.js";
import type { MailerResolver, MailMessage } from "../lib/mailer.js";
import { isTerminalFailure, reasonOf, withBlob, type DerivationDeps } from "./derivations.js";
import { boundedQueueAsk, type JobQueue } from "./jobs.js";

export interface GenerationDeliveryDeps extends DerivationDeps {
  resolveMailer: MailerResolver;
  baseUrl: string;
  jobs?: JobQueue;
}
export interface GenerationDeliveryAttempt {
  generationId: string;
  attempt: number;
  retryCount: number;
  retryLimit: number;
}
const MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
async function forget(deps: DerivationDeps, fileRef: string) {
  try {
    await deps.storage.delete(fileRef);
  } catch (error) {
    deps.log.warn(
      { fileRef, reason: reasonOf(error) },
      "Could not remove an unreferenced Generation PDF",
    );
  }
}

export async function handleGenerationDelivery(
  deps: GenerationDeliveryDeps,
  job: GenerationDeliveryAttempt,
): Promise<void> {
  const current = and(
    eq(autoDocGenerations.id, job.generationId),
    eq(autoDocGenerations.attempt, job.attempt),
  );
  const [generation] = await deps.db.select().from(autoDocGenerations).where(current);
  if (!generation || generation.state === "failed" || !generation.docxFileRef) return;
  let stage: "pdf" | "email" = "pdf";
  try {
    if (generation.formats !== "docx" && !generation.pdfFileRef) {
      let fileRef: string | undefined;
      try {
        await withBlob(deps, generation.docxFileRef, async (word) => {
          const pdf = await deps.docEngine.convertToPdf(word, "docx");
          try {
            await deps.db.transaction(async (tx) => {
              const [held] = await tx.select().from(autoDocGenerations)
                .where(and(current, eq(autoDocGenerations.state, "pending")))
                .for("update");
              if (!held || held.pdfFileRef) return;
              fileRef = await deps.storage.put(
                `auto-doc-generations/${generation.id}/${uuidv7()}.pdf`, Readable.from(pdf),
              );
              await tx.update(autoDocGenerations)
                .set({ pdfFileRef: fileRef, state: "ready", updatedAt: new Date() }).where(current);
            });
          } finally {
            pdf.destroy();
          }
        });
      } catch (error) {
        if (fileRef) await forget(deps, fileRef);
        throw error;
      }
    }
    if (deps.jobs)
      await fulfilRequestedFiling(
        {
          ...deps,
          jobs: deps.jobs,
          notifier: createNotifier({ db: deps.db, jobs: deps.jobs, log: deps.log }),
        },
        deps.log,
        generation.id,
      );
    stage = "email";
    // The row lock serializes duplicate wake-ups through the bounded SMTP send.
    // A recorded send is never repeated by another worker or by the recovery sweep.
    await deps.db.transaction(async (tx) => {
      const [ready] = await tx.select().from(autoDocGenerations).where(current).for("update");
      if (!ready || ready.state !== "ready" || ready.emailState !== "pending") return;
      const [person] = await tx.select().from(users).where(eq(users.id, ready.generatedBy));
      const [autoDoc] = await tx
        .select({ name: autoDocs.name })
        .from(autoDocs)
        .where(eq(autoDocs.id, ready.autoDocId));
      const [organization] = await tx.select({ name: orgSettings.name }).from(orgSettings).limit(1);
      if (!person || person.archivedAt) {
        const failure = {
          code: "recipient_archived",
          detail: "Email was not sent because the person is no longer active.",
        };
        await tx
          .update(autoDocGenerations)
          .set({
            state: "failed",
            failure,
            emailState: "failed",
            emailFailure: failure,
            updatedAt: new Date(),
          })
          .where(current);
        return;
      }
      const { mailer } = await deps.resolveMailer();
      if (!mailer.configured) {
        await tx
          .update(autoDocGenerations)
          .set({
            emailState: "unconfigured",
            emailFailure: {
              code: "unconfigured",
              detail: "Email was not sent because SMTP is not configured. The downloads are ready.",
            },
            updatedAt: new Date(),
          })
          .where(current);
        deps.log.error(
          { generationId: ready.id, reason: "unconfigured" },
          "Generation email is unconfigured; the downloads remain ready",
        );
        return;
      }
      const attachments: NonNullable<MailMessage["attachments"]> = [];
      if (ready.formats !== "pdf")
        attachments.push({
          filename: `${autoDoc!.name}.docx`,
          contentType: MIME,
          content: await withBlob(deps, ready.docxFileRef!, buffer),
        });
      if (ready.formats !== "docx")
        attachments.push({
          filename: `${autoDoc!.name}.pdf`,
          contentType: "application/pdf",
          content: await withBlob(deps, ready.pdfFileRef!, buffer),
        });
      await mailer.send(
        renderGenerationMail({
          to: person.email,
          personName: person.displayName,
          autoDocName: autoDoc!.name,
          organizationName: organization?.name ?? "",
          coverNote: ready.coverNote,
          baseUrl: deps.baseUrl,
          autoDocId: ready.autoDocId,
          generationId: ready.id,
          attachments,
        }),
      );
      await tx
        .update(autoDocGenerations)
        .set({ emailState: "sent", emailSentAt: new Date(), updatedAt: new Date() })
        .where(current);
    });
  } catch (error) {
    const smtpCode =
      typeof error === "object" && error !== null && "responseCode" in error
        ? error.responseCode
        : undefined;
    const terminal =
      isTerminalFailure(error) ||
      (stage === "email" && typeof smtpCode === "number" && smtpCode >= 500 && smtpCode < 600);
    if (terminal || job.retryCount >= job.retryLimit) {
      const failure =
        stage === "pdf"
          ? { code: "pdf_failed", detail: "The PDF could not be produced. Retry this Generation." }
          : { code: "email_failed", detail: "Email could not be sent. Retry this Generation." };
      await deps.db
        .update(autoDocGenerations)
        .set({
          state: "failed",
          failure,
          ...(stage === "email" ? { emailState: "failed" as const, emailFailure: failure } : {}),
          updatedAt: new Date(),
        })
        .where(
          and(
            current,
            stage === "pdf"
              ? and(eq(autoDocGenerations.state, "pending"), isNull(autoDocGenerations.pdfFileRef))
              : and(
                  eq(autoDocGenerations.state, "ready"),
                  eq(autoDocGenerations.emailState, "pending"),
                ),
          ),
        );
      deps.log.error(
        { generationId: job.generationId, stage, reason: reasonOf(error) },
        "Generation delivery failed",
      );
    }
    if (!terminal) throw error;
  }
}

/** Pending rows recover a lost queue ask; an abandoned in-request fill becomes retryable. */
export async function sweepGenerationDeliveries(
  deps: Pick<DerivationDeps, "db" | "log">,
  jobs: JobQueue,
  signal?: AbortSignal,
) {
  if (signal?.aborted) return;
  await deps.db
    .update(autoDocGenerations)
    .set({
      state: "failed",
      failure: {
        code: "fill_interrupted",
        detail: "The Word fill was interrupted. Retry this Generation.",
      },
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(autoDocGenerations.state, "pending"),
        isNull(autoDocGenerations.docxFileRef),
        lt(autoDocGenerations.updatedAt, new Date(Date.now() - 5 * 60_000)),
      ),
    );
  let after: string | undefined;
  let refusals = 0;
  for (;;) {
    if (signal?.aborted) return;
    const rows = await deps.db
      .select({ id: autoDocGenerations.id, attempt: autoDocGenerations.attempt })
      .from(autoDocGenerations)
      .where(
        and(
          isNotNull(autoDocGenerations.docxFileRef),
          or(
            eq(autoDocGenerations.state, "pending"),
            and(
              eq(autoDocGenerations.state, "ready"),
              or(
                eq(autoDocGenerations.emailState, "pending"),
                and(
                  isNotNull(autoDocGenerations.requestedFiling),
                  isNull(autoDocGenerations.filingFailure),
                ),
              ),
            ),
          ),
          after ? gt(autoDocGenerations.id, after) : undefined,
        ),
      )
      .orderBy(asc(autoDocGenerations.id))
      .limit(500);
    if (!rows.length) return;
    for (const row of rows) {
      if (signal?.aborted) return;
      try {
        await boundedQueueAsk(jobs.requestGenerationDelivery(row.id, row.attempt));
        refusals = 0;
      } catch (error) {
        deps.log.warn(
          { generationId: row.id, reason: reasonOf(error) },
          "Generation delivery remains owed",
        );
        if (++refusals >= 5) return;
      }
    }
    after = rows.at(-1)!.id;
    if (rows.length < 500) return;
  }
}
