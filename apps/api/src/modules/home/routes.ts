// SPDX-License-Identifier: AGPL-3.0-only

/** The staff Home state summary (M29). */
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";
import { requireRole } from "../../auth/guards.js";
import { problemResponse } from "../../lib/problem.js";
import { ApprovalsHomeSectionSchema, readApprovalsHomeSection } from "./sections/approvals.js";
import { DatesHomeSectionSchema, readDatesHomeSection } from "./sections/dates.js";
import { InboxHomeSectionSchema, readInboxHomeSection } from "./sections/inbox.js";
import {
  ObligationsHomeSectionSchema,
  readObligationsHomeSection,
} from "./sections/obligations.js";
import { readTasksHomeSection, TasksHomeSectionSchema } from "./sections/tasks.js";

const HomeSectionSchema = z.discriminatedUnion("type", [
  ApprovalsHomeSectionSchema,
  TasksHomeSectionSchema,
  DatesHomeSectionSchema,
  ObligationsHomeSectionSchema,
  InboxHomeSectionSchema,
]);
const HomeEnvelopeSchema = z.object({ sections: z.array(HomeSectionSchema) });

export const homeRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get(
    "/home",
    {
      preHandler: requireRole("administrator", "legal_team_member", "contributor"),
      schema: {
        operationId: "getHome",
        summary:
          "The signed-in staff user's personal Home sections in stable order. " +
          "Zero-total sections are omitted; every present section carries a " +
          "three-row cap and its full eligible total. Record reach is applied " +
          "inside each section query, before totals and caps",
        response: {
          200: HomeEnvelopeSchema,
          401: problemResponse,
          403: problemResponse,
        },
      },
    },
    async (request) => {
      const [approvals, tasks, dates, obligations, inbox] = await Promise.all([
        readApprovalsHomeSection(app.db, request.user),
        readTasksHomeSection(app.db, request.user),
        readDatesHomeSection(app.db, request.user),
        readObligationsHomeSection(app.db, request.user),
        readInboxHomeSection(app.db, request.user),
      ]);
      return {
        sections: [approvals, tasks, dates, obligations, inbox].filter(
          (section) => section !== null,
        ),
      };
    },
  );
};
