// SPDX-License-Identifier: AGPL-3.0-only

/** The staff Home state summary (M29). */
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";
import { requireRole } from "../../auth/guards.js";
import { problemResponse } from "../../lib/problem.js";
import { ApprovalsHomeSectionSchema, readApprovalsHomeSection } from "./sections/approvals.js";
import {
  DatesHomeSectionSchema,
  PersonalDatesSchema,
  readDatesHomeSection,
  readPersonalDates,
} from "./sections/dates.js";
import { ContractsHomeSectionSchema, readContractsHomeSection } from "./sections/contracts.js";
import { InboxHomeSectionSchema, readInboxHomeSection } from "./sections/inbox.js";
import { MattersHomeSectionSchema, readMattersHomeSection } from "./sections/matters.js";
import {
  ObligationsHomeSectionSchema,
  readObligationsHomeSection,
} from "./sections/obligations.js";
import {
  AssignedTasksPageSchema,
  AssignedTasksCursorSchema,
  readAssignedTasks,
  readTasksHomeSection,
  TasksHomeSectionSchema,
} from "./sections/tasks.js";

const HomeSectionSchema = z.discriminatedUnion("type", [
  ApprovalsHomeSectionSchema,
  TasksHomeSectionSchema,
  DatesHomeSectionSchema,
  ObligationsHomeSectionSchema,
  InboxHomeSectionSchema,
  ContractsHomeSectionSchema,
  MattersHomeSectionSchema,
]);
const HomeEnvelopeSchema = z.object({ sections: z.array(HomeSectionSchema) });

export const homeRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get(
    "/home/dates",
    {
      preHandler: requireRole("administrator", "legal_team_member", "contributor"),
      schema: {
        operationId: "listPersonalDates",
        summary:
          "All dates in a calendar window on active Contracts and Matters the viewer manages or is on the team of",
        querystring: z
          .object({ from: z.iso.date(), to: z.iso.date() })
          .refine(
            ({ from, to }) => from <= to && Date.parse(to) - Date.parse(from) <= 62 * 86400000,
            "Choose a date range of at most 63 days",
          ),
        response: {
          200: PersonalDatesSchema,
          400: problemResponse,
          401: problemResponse,
          403: problemResponse,
        },
      },
    },
    async (request) => readPersonalDates(app.db, request.user, request.query),
  );

  app.get(
    "/home/tasks",
    {
      preHandler: requireRole("administrator", "legal_team_member", "contributor"),
      schema: {
        operationId: "listAssignedTasks",
        summary:
          "Open Tasks assigned to the signed-in user, across reachable active Contracts and Matters",
        querystring: z.object({
          limit: z.coerce.number().int().min(1).max(100).default(50),
          cursor: AssignedTasksCursorSchema.optional(),
        }),
        response: {
          200: AssignedTasksPageSchema,
          400: problemResponse,
          401: problemResponse,
          403: problemResponse,
        },
      },
    },
    async (request) => readAssignedTasks(app.db, request.user, request.query),
  );

  app.get(
    "/home",
    {
      preHandler: requireRole("administrator", "legal_team_member", "contributor"),
      schema: {
        operationId: "getHome",
        summary:
          "The signed-in staff user's personal Home sections in stable order. " +
          "Zero-total sections are omitted; every present section carries a " +
          "four-row cap and its full eligible total. Record reach is applied " +
          "inside each section query, before totals and caps",
        response: {
          200: HomeEnvelopeSchema,
          401: problemResponse,
          403: problemResponse,
        },
      },
    },
    async (request) => {
      const [approvals, tasks, dates, obligations, inbox, contracts, matters] = await Promise.all([
        readApprovalsHomeSection(app.db, request.user),
        readTasksHomeSection(app.db, request.user),
        readDatesHomeSection(app.db, request.user),
        readObligationsHomeSection(app.db, request.user),
        readInboxHomeSection(app.db, request.user),
        readContractsHomeSection(app.db, request.user),
        readMattersHomeSection(app.db, request.user),
      ]);
      return {
        sections: [approvals, tasks, dates, obligations, inbox, contracts, matters].filter(
          (section) => section !== null,
        ),
      };
    },
  );
};
