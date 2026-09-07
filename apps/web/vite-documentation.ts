// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Serves the virtual reader bundle and writes the standalone edition from the same
 * compilation. TECH-026 keeps parsing and sanitization in the build process.
 */
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import type { Plugin, ViteDevServer } from "vite";
import {
  compileWorkspace,
  exportFiles,
  repository,
  type Compilation,
} from "../../scripts/documentation/build.mjs";

const ID = "virtual:openlaw-documentation";
const RESOLVED = `\0${ID}`;
const HELP_ID = "virtual:openlaw-help-metadata";
const HELP_RESOLVED = `\0${HELP_ID}`;
const PREFIX = "/documentation-export/";

export function documentation(): Plugin {
  let compilation: Compilation;
  let files: Map<string, string | Uint8Array> | undefined;
  let failure: Error | undefined;
  function compile() {
    try {
      compilation = compileWorkspace();
      files = undefined;
      failure = undefined;
    } catch (error) {
      failure = error instanceof Error ? error : new Error(String(error));
      throw failure;
    }
  }
  function source(path: string) {
    return ["docs/user-guides", "docs/documentation", "scripts/documentation"].some((dir) =>
      path.startsWith(resolve(repository, dir) + "/"),
    );
  }
  function invalidate(server: ViteDevServer, path: string) {
    if (!source(path)) return;
    try {
      compile();
      for (const id of [RESOLVED, HELP_RESOLVED]) {
        const module = server.moduleGraph.getModuleById(id);
        if (module) server.moduleGraph.invalidateModule(module);
      }
      server.ws.send({ type: "full-reload", path: "*" });
    } catch (error) {
      server.ws.send({ type: "error", err: { message: String(error), stack: "" } });
    }
  }
  return {
    name: "openlaw:documentation",
    buildStart() {
      compile();
    },
    resolveId(id) {
      if (id === ID) return RESOLVED;
      if (id === HELP_ID) return HELP_RESOLVED;
    },
    load(id) {
      if (id !== RESOLVED && id !== HELP_RESOLVED) return;
      if (failure) throw failure;
      const bundle = compilation.bundle;
      const value =
        id === HELP_RESOLVED
          ? {
              contexts: bundle.contexts,
              bindings: bundle.bindings,
              articles: bundle.articles.map(({ audiences, destinations, contexts }) => ({
                audiences,
                destinations,
                contexts,
              })),
            }
          : bundle;
      return `export default ${JSON.stringify(value).replaceAll("<", "\\u003c")};`;
    },
    configureServer(server) {
      server.watcher.add([
        join(repository, "docs/user-guides"),
        join(repository, "docs/documentation"),
        join(repository, "scripts/documentation"),
      ]);
      const changed = (path: string) => invalidate(server, path);
      server.watcher.on("add", changed).on("change", changed).on("unlink", changed);
      server.httpServer?.once("close", () =>
        server.watcher.off("add", changed).off("change", changed).off("unlink", changed),
      );
      server.middlewares.use((request, response, next) => {
        const raw = (request.url ?? "").split("?")[0]!;
        if (!raw.startsWith(PREFIX)) {
          next();
          return;
        }
        if (failure) {
          response.statusCode = 503;
          response.end("Documentation build failed. Check the development build output.");
          return;
        }
        const path = raw.slice(PREFIX.length) || "index.html";
        files ??= exportFiles(compilation);
        const bytes = files.get(path);
        if (!bytes) {
          response.statusCode = 404;
          response.end("Documentation file unavailable.");
          return;
        }
        const type = path.endsWith(".html")
          ? "text/html; charset=utf-8"
          : path.endsWith(".js")
            ? "text/javascript; charset=utf-8"
            : path.endsWith(".css")
              ? "text/css; charset=utf-8"
              : path.endsWith(".png")
                ? "image/png"
                : /\.jpe?g$/.test(path)
                  ? "image/jpeg"
                  : path.endsWith(".webp")
                    ? "image/webp"
                    : path.endsWith(".gif")
                      ? "image/gif"
                      : "application/gzip";
        response.setHeader("Content-Type", type);
        response.setHeader("X-Content-Type-Options", "nosniff");
        response.end(bytes);
      });
    },
    async writeBundle(options) {
      if (!options.dir) return;
      for (const [name, bytes] of exportFiles(compilation)) {
        const file = join(options.dir, "documentation-export", name);
        await mkdir(dirname(file), { recursive: true });
        await writeFile(file, bytes);
      }
    },
  };
}
