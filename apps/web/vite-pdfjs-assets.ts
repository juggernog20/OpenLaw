// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Serves pdf.js's own asset folders from this app's origin, at
 * `/pdfjs/`.
 *
 * pdf.js does not carry everything it needs inside its bundle. Four
 * folders are fetched at run time and only when a document asks for
 * them: the character maps a CJK PDF needs, the metrics for the standard
 * fourteen fonts a PDF may reference without embedding, the WebAssembly
 * image decoders, and the colour profiles. The library's default is to
 * fetch them from a CDN, which DD-001 rules out — a fresh self-hosted
 * install must render a contract with no network beyond its own origin.
 *
 * So they are served from here. There is no import that reaches them:
 * each folder is hundreds of small files, addressed by name at run time,
 * which is a shape a bundler cannot follow. In development the
 * middleware below reads them out of the installed package; in a build
 * they are copied into the output beside the app.
 *
 * The folders total a few megabytes and none of it is fetched unless a
 * document asks for it, so nothing here is paid for by a record page
 * that shows no PDF.
 */

import { createReadStream } from "node:fs";
import { cp, stat } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join, normalize, resolve, sep } from "node:path";
import type { Plugin } from "vite";

/** The folders pdf.js fetches by name, and the only ones served. */
const ASSET_FOLDERS = ["cmaps", "standard_fonts", "wasm", "iccs"] as const;

/** The one path prefix they are reachable under, matching the URLs
 * `pdf-preview.tsx` builds. */
const PREFIX = "/pdfjs/";

export function pdfjsAssets(): Plugin {
  // Resolved from this app's own resolution, so a hoisted or a nested
  // install both answer the same way.
  const packageRoot = dirname(createRequire(import.meta.url).resolve("pdfjs-dist/package.json"));

  return {
    name: "openlaw:pdfjs-assets",

    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        const file = assetPath(packageRoot, request.url);
        if (!file) {
          next();
          return;
        }
        void stat(file).then(
          (found) => {
            if (!found.isFile()) {
              next();
              return;
            }
            // The one type that has to be right. pdf.js instantiates its
            // image decoders with `WebAssembly.instantiateStreaming`,
            // which refuses anything not served as `application/wasm`
            // and drops the library onto its slower fallback — quietly,
            // in development only, which is the worst place to lose it.
            if (file.endsWith(".wasm")) response.setHeader("content-type", "application/wasm");
            const bytes = createReadStream(file);
            bytes.on("error", () => {
              // The answer has already begun, so there is no status left
              // to send and `next()` would write a second one. Cutting
              // the connection is what tells the browser the asset did
              // not arrive whole.
              response.destroy();
            });
            bytes.pipe(response);
          },
          () => next(),
        );
      });
    },

    async writeBundle(options) {
      const out = options.dir;
      if (!out) return;
      for (const folder of ASSET_FOLDERS) {
        await cp(join(packageRoot, folder), join(out, "pdfjs", folder), { recursive: true });
      }
    },
  };
}

/**
 * The file one request asks for, or `undefined` when it is not one of
 * ours.
 *
 * The path is normalized and then required to still sit inside the
 * package's own folder, so a request carrying `..` cannot reach out of
 * it. That matters even in development: this middleware runs beside the
 * developer's whole filesystem.
 */
function assetPath(packageRoot: string, url: string | undefined): string | undefined {
  if (!url?.startsWith(PREFIX)) return undefined;
  const requested = decodeURIComponent(url.slice(PREFIX.length).split("?")[0] ?? "");
  const folder = requested.split("/")[0] ?? "";
  if (!(ASSET_FOLDERS as readonly string[]).includes(folder)) return undefined;

  const file = resolve(packageRoot, normalize(requested));
  return file.startsWith(packageRoot + sep) ? file : undefined;
}
