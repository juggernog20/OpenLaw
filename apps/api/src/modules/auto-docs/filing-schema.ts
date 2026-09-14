// SPDX-License-Identifier: AGPL-3.0-only

/** ADO-005: Filing request and response shapes. The generation form chooses existing records; its Auto-Doc settings govern automatic Contract creation. */
import { z } from "zod";
export const ExistingFilingDestination = z
  .object({
    kind: z.enum(["matter", "contract"]),
    number: z.number().int().positive(),
  })
  .strict();
export const FilingInput = z
  .object({
    destination: z.union([
      ExistingFilingDestination,
      z
        .object({
          kind: z.literal("new_contract"),
          contractTypeId: z.string().min(1),
          businessOwnerId: z.string().min(1).nullable().optional(),
        })
        .strict(),
    ]),
    format: z.enum(["docx", "pdf"]).optional(),
  })
  .strict();
export const GenerationFilingInput = z
  .object({
    destination: ExistingFilingDestination,
    format: z.enum(["docx", "pdf"]).optional(),
  })
  .strict();
export const FilingTarget = z.object({
  kind: z.enum(["contract", "matter"]),
  number: z.number().int(),
  title: z.string(),
});
export const FilingRow = z.object({
  id: z.string(),
  generationId: z.string(),
  documentId: z.string().nullable(),
  format: z.enum(["docx", "pdf"]),
  target: FilingTarget.nullable(),
  createdContract: z.boolean(),
  filedBy: z.string(),
  createdAt: z.iso.datetime(),
});
