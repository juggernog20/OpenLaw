// SPDX-License-Identifier: AGPL-3.0-only

/**
 * OpenLaw API application factory (TECH-003: Fastify + REST/OpenAPI,
 * TECH-016: Zod as the single schema source).
 *
 * All routes live under /api/v1. The OpenAPI 3.1 document is generated
 * from the route schemas — never hand-written — and served at
 * /api/openapi.json with interactive docs at /api/docs. Errors use
 * RFC 9457 problem details.
 */

import Fastify, { type FastifyError, type FastifyServerOptions } from "fastify";
import type { Db } from "@openlaw/db";
import fastifySwagger from "@fastify/swagger";
import scalarApiReference from "@scalar/fastify-api-reference";
import {
  hasZodFastifySchemaValidationErrors,
  isResponseSerializationError,
  jsonSchemaTransform,
  jsonSchemaTransformObject,
  serializerCompiler,
  validatorCompiler,
  type ZodTypeProvider,
} from "fastify-type-provider-zod";
import { OPENLAW_VERSION } from "@openlaw/shared";
import { PROBLEM_CONTENT_TYPE, type Problem } from "./lib/problem.js";
import type { Mailer } from "./lib/mailer.js";
import { metaRoutes } from "./modules/meta/routes.js";
import { authRoutes } from "./modules/auth/routes.js";
import { authHandler } from "./auth/handler.js";
import { createAuth, type Auth, type AuthConfig } from "./auth/instance.js";
import type { AuthenticatedSession, AuthenticatedUser } from "./auth/guards.js";

export interface AppDeps {
  db: Db;
  config: AuthConfig;
  mailer: Mailer;
}

declare module "fastify" {
  interface FastifyInstance {
    db: Db;
    auth: Auth;
    mailer: Mailer;
  }
}

export async function buildApp(deps: AppDeps, opts: FastifyServerOptions = {}) {
  const app = Fastify(opts).withTypeProvider<ZodTypeProvider>();
  app.decorate("db", deps.db);
  app.decorate("mailer", deps.mailer);
  app.decorate("auth", createAuth(deps.db, deps.config, deps.mailer));
  // Shape hints for V8; guards assign the real values per request.
  app.decorateRequest("user", undefined as unknown as AuthenticatedUser);
  app.decorateRequest("session", undefined as unknown as AuthenticatedSession);

  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);

  await app.register(fastifySwagger, {
    openapi: {
      openapi: "3.1.0",
      info: {
        title: "OpenLaw API",
        description: "REST API for OpenLaw. Also the third-party integration surface (TECH-003).",
        version: OPENLAW_VERSION,
        license: { name: "AGPL-3.0-only", identifier: "AGPL-3.0-only" },
      },
      servers: [{ url: "/" }],
    },
    transform: jsonSchemaTransform,
    transformObject: jsonSchemaTransformObject,
  });

  await app.register(scalarApiReference, { routePrefix: "/api/docs" });

  app.get("/api/openapi.json", { schema: { hide: true } }, async () => app.swagger());

  // Infra endpoints (TECH-014) — not part of the API surface, hidden
  // from the OpenAPI document.
  app.get("/healthz", { schema: { hide: true } }, async () => ({
    status: "ok",
  }));
  // readyz gains real DB/queue checks when those dependencies exist.
  app.get("/readyz", { schema: { hide: true } }, async () => ({
    status: "ok",
  }));

  // Error/404 handlers are installed before route plugins register:
  // encapsulated contexts snapshot their parent, so handlers added
  // afterwards would never apply inside the modules.
  app.setNotFoundHandler((request, reply) => {
    const problem: Problem = {
      type: "about:blank",
      title: "Not found",
      status: 404,
      detail: `Route ${request.method} ${request.url} does not exist.`,
      instance: request.url,
    };
    void reply
      .status(404)
      .header("content-type", PROBLEM_CONTENT_TYPE)
      .send(JSON.stringify(problem));
  });

  app.setErrorHandler((error: FastifyError, request, reply) => {
    if (hasZodFastifySchemaValidationErrors(error)) {
      const problem: Problem = {
        type: "about:blank",
        title: "Request validation failed",
        status: 400,
        detail: "One or more request fields are invalid.",
        instance: request.url,
        errors: error.validation.map((issue) => ({
          path: issue.instancePath.replace(/^\//, "").replaceAll("/", "."),
          message: issue.message ?? "Invalid value.",
        })),
      };
      return reply
        .status(400)
        .header("content-type", PROBLEM_CONTENT_TYPE)
        .send(JSON.stringify(problem));
    }

    if (isResponseSerializationError(error)) {
      request.log.error(error, "response serialization failed");
      const problem: Problem = {
        type: "about:blank",
        title: "Internal server error",
        status: 500,
        detail: "The response did not match its schema.",
        instance: request.url,
      };
      return reply
        .status(500)
        .header("content-type", PROBLEM_CONTENT_TYPE)
        .send(JSON.stringify(problem));
    }

    const status = error.statusCode && error.statusCode >= 400 ? error.statusCode : 500;
    if (status >= 500) request.log.error(error, "request failed");
    const problem: Problem = {
      type: "about:blank",
      title: status >= 500 ? "Internal server error" : error.message,
      status,
      detail: status >= 500 ? undefined : error.message,
      instance: request.url,
    };
    return reply
      .status(status)
      .header("content-type", PROBLEM_CONTENT_TYPE)
      .send(JSON.stringify(problem));
  });

  await app.register(authHandler);
  await app.register(metaRoutes, { prefix: "/api/v1" });
  await app.register(authRoutes, { prefix: "/api/v1" });

  return app;
}
