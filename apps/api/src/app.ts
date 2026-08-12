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

import { sep } from "node:path";
import Fastify, { type FastifyError, type FastifyServerOptions } from "fastify";
import { pingDb, type Db } from "@openlaw/db";
import fastifyStatic from "@fastify/static";
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
import { HttpError, PROBLEM_CONTENT_TYPE, type Problem } from "./lib/problem.js";
import type { MailerResolver } from "./lib/mailer.js";
import { metaRoutes } from "./modules/meta/routes.js";
import { authRoutes } from "./modules/auth/routes.js";
import { contractStatusesRoutes } from "./modules/contract-statuses/routes.js";
import { contractTypesRoutes } from "./modules/contract-types/routes.js";
import { attachedFieldsRoutes } from "./modules/contract-types/attached-fields.js";
import { fieldsRoutes } from "./modules/fields/routes.js";
import { onboardingRoutes } from "./modules/onboarding/routes.js";
import { orgRoutes } from "./modules/org/routes.js";
import { usersRoutes } from "./modules/users/routes.js";
import { emailSettingsRoutes } from "./modules/email-settings/routes.js";
import { authHandler } from "./auth/handler.js";
import { createAuth, type Auth, type AuthConfig } from "./auth/instance.js";
import type { AuthenticatedSession, AuthenticatedUser } from "./auth/guards.js";

export interface AppDeps {
  db: Db;
  config: AuthConfig;
  /**
   * Mail is resolved per send (#37: env-else-database), so a wizard save
   * takes effect on the next send with no restart. Env-pinned deployments
   * inject a resolver that always answers with the same fixed mailer.
   */
  resolveMailer: MailerResolver;
  /**
   * Directory of the built SPA (TECH-017: the app serves the web bundle
   * same-origin). Unset — e.g. API-only development — leaves every
   * non-API path a JSON 404.
   */
  webDist?: string;
}

declare module "fastify" {
  interface FastifyInstance {
    db: Db;
    auth: Auth;
    resolveMailer: MailerResolver;
  }
}

export async function buildApp(deps: AppDeps, opts: FastifyServerOptions = {}) {
  const app = Fastify(opts).withTypeProvider<ZodTypeProvider>();
  app.decorate("db", deps.db);
  app.decorate("resolveMailer", deps.resolveMailer);
  app.decorate("auth", createAuth(deps.db, deps.config, deps.resolveMailer, app.log));
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
  // Readiness = the DB answers a query in bounded time. The race caps
  // the probe when the host is unreachable-but-not-refusing, where pg
  // would otherwise wait on its own (much longer) connect timeout.
  app.get("/readyz", { schema: { hide: true } }, async (_request, reply) => {
    // pingDb bounds the query itself; the race additionally bounds the
    // response when the pool is still waiting for a connection. Whichever
    // side loses settles later, unobserved — both get handlers up front
    // so neither becomes an unhandled rejection.
    let timer: NodeJS.Timeout | undefined;
    const probe = pingDb(deps.db, 2000);
    probe.catch(() => {});
    const timeout = new Promise((_resolve, reject) => {
      timer = setTimeout(() => reject(new Error("readiness probe timed out")), 2000);
      timer.unref();
    });
    timeout.catch(() => {});
    try {
      await Promise.race([probe, timeout]);
      return { status: "ok" };
    } catch {
      return reply.status(503).send({ status: "unavailable" });
    } finally {
      clearTimeout(timer);
    }
  });

  if (deps.webDist) {
    // TECH-017: the built SPA is served same-origin by this process.
    // Hashed build artifacts cache forever; everything else (the shell,
    // favicons) revalidates so a new image shows up on reload.
    await app.register(fastifyStatic, {
      root: deps.webDist,
      cacheControl: false,
      setHeaders: (reply, filePath) => {
        void reply.header(
          "cache-control",
          filePath.includes(`${sep}assets${sep}`)
            ? "public, max-age=31536000, immutable"
            : "no-cache",
        );
      },
    });
  }

  // Error/404 handlers are installed before route plugins register:
  // encapsulated contexts snapshot their parent, so handlers added
  // afterwards would never apply inside the modules.
  app.setNotFoundHandler((request, reply) => {
    // SPA fallback: a GET for a non-API path is a client-side route —
    // the shell owns it. API paths and writes stay JSON 404s. Match on
    // the pathname alone so a query string can't disguise an API path.
    const pathname = request.url.split("?", 1)[0] ?? request.url;
    if (
      deps.webDist &&
      (request.method === "GET" || request.method === "HEAD") &&
      !(pathname === "/api" || pathname.startsWith("/api/"))
    ) {
      void reply.sendFile("index.html");
      return;
    }
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
    // 5xx messages are scrubbed — an unexpected error's text can leak
    // internals — unless an HttpError opted its client-authored message
    // in (the 502 test-send reasons). The title stays a stable status
    // summary either way; the authored copy rides in `detail` only.
    const expose = status < 500 || (error instanceof HttpError && error.expose);
    const problem: Problem = {
      type: "about:blank",
      title:
        status < 500 ? error.message : status === 502 ? "Bad gateway" : "Internal server error",
      status,
      detail: expose ? error.message : undefined,
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
  await app.register(onboardingRoutes, { prefix: "/api/v1" });
  await app.register(orgRoutes, { prefix: "/api/v1" });
  await app.register(usersRoutes, { prefix: "/api/v1" });
  await app.register(emailSettingsRoutes, { prefix: "/api/v1" });
  await app.register(contractTypesRoutes, { prefix: "/api/v1" });
  await app.register(attachedFieldsRoutes, { prefix: "/api/v1" });
  await app.register(contractStatusesRoutes, { prefix: "/api/v1" });
  await app.register(fieldsRoutes, { prefix: "/api/v1" });

  return app;
}
