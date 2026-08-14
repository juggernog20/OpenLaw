# syntax=docker/dockerfile:1
# SPDX-License-Identifier: AGPL-3.0-only
#
# The OpenLaw doc-engine sidecar (TECH-010): headless LibreOffice for
# DOCX/PPTX → PDF display conversion, OCRmyPDF/Tesseract for image-only
# PDFs, poppler for a PDF's native text layer, and the thin HTTP wrapper
# in front of them. Build from the repo root:
#
#   docker build -f services/doc-engine/Dockerfile -t openlaw-doc-engine .
#
# Every tool here is AGPL-compatible OSS, which is what keeps the free
# install path free (TECH-010).

# Debian trixie, not the bookworm the application image is built on. The
# base is chosen for the LibreOffice it carries: bookworm ships 7.4,
# which exports Word comments as PDF annotations only, while trixie ships
# 25.2, which can render them in the page margin where a reader sees
# them. TECH-010 flags conversion fidelity as the risk to validate early,
# so the sidecar takes the newer engine.
FROM node:24-trixie-slim AS build
RUN npm install --global pnpm@10.30.3
WORKDIR /app

# Every workspace manifest, because a pnpm workspace install reads them
# all — then only this project's dependencies are fetched.
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY apps/worker/package.json apps/worker/
COPY packages/api-client/package.json packages/api-client/
COPY packages/db/package.json packages/db/
COPY packages/shared/package.json packages/shared/
COPY services/doc-engine/package.json services/doc-engine/
COPY e2e/package.json e2e/
RUN --mount=type=cache,id=pnpm-store,target=/root/.local/share/pnpm/store \
    pnpm install --frozen-lockfile --filter @openlaw/doc-engine...
COPY tsconfig.base.json ./
COPY services/doc-engine services/doc-engine
RUN pnpm --filter @openlaw/doc-engine build

# --- Runtime ---
FROM node:24-trixie-slim
ENV NODE_ENV=production

# `--no-install-recommends` keeps the image to the tools the three
# operations actually run. Two font packages are deliberate, not
# incidental: a conversion with no fonts installed renders boxes, and
# the Liberation family is metric-compatible with the Microsoft core
# fonts, so a Word document breaks its lines where Word broke them.
RUN apt-get update \
    && apt-get install --yes --no-install-recommends \
        fonts-dejavu-core \
        fonts-liberation2 \
        libreoffice-impress \
        libreoffice-writer \
        ocrmypdf \
        poppler-utils \
        tesseract-ocr-eng \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
# The wrapper has no runtime dependencies of its own, so the built
# JavaScript is the whole application layer — no node_modules to copy.
COPY --from=build /app/services/doc-engine/dist ./dist

# LibreOffice and OCRmyPDF both want somewhere to write. Every operation
# already works under a temporary directory it removes afterwards; HOME
# points there too, so nothing in the image needs a writable home and
# the container can run unprivileged.
ENV HOME=/tmp
USER node
EXPOSE 8080
CMD ["node", "dist/index.js"]
