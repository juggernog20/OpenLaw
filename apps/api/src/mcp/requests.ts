// SPDX-License-Identifier: AGPL-3.0-only
import { z } from "zod";
import type { Db } from "@openlaw/db";
import {
  assignRequest,
  AssignRequestBody,
  listMyRequests,
  submitRequest,
  SubmitRequestBody,
} from "../modules/requests/service.js";
import { listRequests } from "../modules/requests/list.js";
import { readMyRequest, readRequest } from "../modules/requests/read.js";
import {
  StaffRequestSchema,
  RequestAttachmentSchema,
  RequestCustomFieldRefsSchema,
  StaffRequestCustomFieldRefsSchema,
} from "../modules/requests/projection.js";
import { MyRequestSchema, MyRequestRowSchema, RequestSchema } from "../modules/requests/routes.js";
import { InboxRowSchema } from "../modules/requests/inbox.js";
import { AttachedCustomFieldSchema } from "../lib/custom-fields.js";
import { readIntakeForm } from "../lib/intake-form.js";
import { HttpError } from "../lib/problem.js";
import { creationAnswerParser } from "./answers.js";
import { bounded, boundedPage, pageInput, serviceResult } from "./results.js";
import { readTool, writeTool } from "./workspace.js";
import { ToolError, type ToolDefinition } from "./tool.js";

const numberInput = z.strictObject({ number: z.number().int().min(1) });
const listInput = z.strictObject({
  ...pageInput,
  cursor: z.string().min(1).max(64).optional(),
  includeTriaged: z.boolean().default(false),
});
const submitInput = z.strictObject({
  requestTypeId: z.string().min(1).max(64),
  answers: z.record(z.string(), z.unknown()),
});
const parseAnswers = creationAnswerParser({
  typeRowRef: "request_type",
  typeLabel: "Request type",
  typeArgument: "requestTypeId",
  answerNames: {
    title: "title",
    description: "description",
    department: "departmentId",
    urgency: "urgency",
    counterparties: "counterparties",
  },
  schema: SubmitRequestBody.omit({ requestTypeId: true }),
});
const assignInput = AssignRequestBody.extend(numberInput.shape);
/**
 * The Form Tool lists Department as a basic, and a Matter-bound Form may
 * carry the builtin department Row as well. The agent keys one answer;
 * the Portal fills both the Request column and the Row from its own two
 * controls, so the Tool fills both from the one answer. The service
 * re-reads the Form under its lock; this read only shapes the answer.
 */
async function withDepartmentRow(
  db: Db,
  requestTypeId: string,
  body: ReturnType<typeof parseAnswers>,
) {
  if (!body.departmentId || body.customFields?.department !== undefined) return body;
  try {
    const { fields } = await readIntakeForm(db, requestTypeId);
    if (!fields.some((field) => field.builtInKey === "department")) return body;
  } catch (error) {
    // The service names the refusal for a missing or archived type.
    if (error instanceof HttpError) return body;
    throw error;
  }
  return { ...body, customFields: { ...body.customFields, department: body.departmentId } };
}
const detailOutput = z.object({
  request: z.union([StaffRequestSchema, MyRequestSchema]),
  fields: z.array(AttachedCustomFieldSchema),
  customFieldRefs: z.union([StaffRequestCustomFieldRefsSchema, RequestCustomFieldRefsSchema]),
  attachments: z.array(RequestAttachmentSchema),
  conversion: z.object({ at: z.iso.datetime(), by: z.string().nullable() }).nullable().optional(),
  redirectTo: z
    .object({ module: z.enum(["contract", "matter"]), number: z.number().int() })
    .nullable()
    .optional(),
  recordArchived: z.boolean().optional(),
});
export const requestTools: readonly ToolDefinition[] = [
  {
    ...readTool,
    toolset: "requests",
    name: "openlaw_requests_list",
    title: "List Requests",
    description:
      "Read the Inbox for a Legal User, ordered by urgency then age, or your own unconverted Requests as a Business User, newest first. includeTriaged widens the Legal User Inbox to finished Requests. Continue with nextCursor and the same options. Archived Requests are excluded.",
    inputSchema: listInput,
    outputSchema: z.object({
      requests: z.array(z.union([InboxRowSchema, MyRequestRowSchema])),
      total: z.number().int().optional(),
      nextCursor: z.string().nullable(),
    }),
    run: async (input, { db, user }) =>
      serviceResult(async () => {
        const { cursor, limit, includeTriaged } = listInput.parse(input);
        if (user.role === "business_user") {
          if (includeTriaged)
            throw new ToolError(
              "forbidden",
              "includeTriaged is only available for the Legal User Inbox.",
            );
          const result = await listMyRequests(db, user);
          const start = cursor ? result.requests.findIndex((row) => row.id === cursor) + 1 : 0;
          if (cursor && start === 0)
            throw new ToolError("validation_error", "That Request cursor is not in your Requests.");
          const page = boundedPage(result.requests.slice(start), limit, (row) => row.id);
          return bounded({ requests: page.items, nextCursor: page.nextCursor });
        }
        const result = await listRequests(db, user, {
          cursor,
          includeTriaged: includeTriaged ? "true" : "false",
        });
        const page = boundedPage(result.requests, limit, (row) => row.id, result.nextCursor);
        return bounded({ requests: page.items, nextCursor: page.nextCursor, total: result.total });
      }),
  },
  {
    ...readTool,
    toolset: "requests",
    name: "openlaw_request_get",
    title: "Read a Request",
    description:
      "Read the original Request submission by number, with its Form answers, current Row labels and attachments. Legal Users read triage details. Business Users read their own Requests under the Portal rules; a converted Request requires current access to its destination.",
    inputSchema: numberInput,
    outputSchema: detailOutput,
    run: async (input, { db, user }) =>
      serviceResult(async () =>
        bounded(
          await (user.role === "business_user" ? readMyRequest : readRequest)(
            db,
            user,
            numberInput.parse(input).number,
          ),
        ),
      ),
  },
  {
    ...writeTool,
    legalUser: "off",
    businessUser: "on",
    toolset: "requests",
    name: "openlaw_request_submit",
    title: "Submit a Request",
    description:
      "Business Users submit through the Request type Form. Read openlaw_form_get with kind request first and ask the person for missing answers. Supply requestTypeId and answers keyed by Form rowRef or Field slug. Basics are title, department (Department id; it also answers a Department Row on the Form) and urgency (low, medium, high, critical). Counterparties take a list of {counterpartyId} or {name}. Uses Portal Required, Branch, live-reference and quota validation. Attachments are uploaded through the Portal separately. Each call creates a new Request.",
    inputSchema: submitInput,
    outputSchema: z.object({ request: RequestSchema }),
    run: async (input, { db, user, notifier }) =>
      serviceResult(async () => {
        const { requestTypeId, answers } = submitInput.parse(input);
        const body = await withDepartmentRow(
          db,
          requestTypeId,
          parseAnswers(answers, requestTypeId),
        );
        return submitRequest(db, user, { requestTypeId, ...body }, notifier);
      }),
  },
  {
    ...writeTool,
    toolset: "requests",
    name: "openlaw_request_assign",
    title: "Assign a Request",
    description:
      "Assign an open Request by number to an active Legal Team Member or Administrator using assigneeId from openlaw_people_list. Null clears the assignment. Legal Users only. A triaged Request refuses changes. Assignment, activity and notifications commit together.",
    annotations: { ...writeTool.annotations, idempotentHint: true },
    inputSchema: assignInput,
    outputSchema: z.object({ request: StaffRequestSchema }),
    run: async (input, { db, user, notifier }) =>
      serviceResult(async () => {
        const { number, ...body } = assignInput.parse(input);
        return assignRequest(db, user, number, body, notifier);
      }),
  },
];
