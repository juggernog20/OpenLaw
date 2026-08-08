// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Meta module — instance metadata. Also the reference route proving the
 * schema → validation → OpenAPI → generated-client chain end to end.
 */

import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";
import { OPENLAW_VERSION } from "@openlaw/shared";
import { problemResponse } from "../../lib/problem.js";

const MetaSchema = z
  .object({
    name: z.literal("OpenLaw"),
    version: z.string(),
  })
  .describe("Instance metadata");

z.globalRegistry.add(MetaSchema, { id: "Meta" });

export const metaRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get(
    "/meta",
    {
      schema: {
        operationId: "getMeta",
        tags: ["meta"],
        summary: "Instance metadata",
        response: { 200: MetaSchema, default: problemResponse },
      },
    },
    async () => ({ name: "OpenLaw" as const, version: OPENLAW_VERSION }),
  );
};
