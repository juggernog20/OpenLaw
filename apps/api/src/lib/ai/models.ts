// SPDX-License-Identifier: AGPL-3.0-only

/**
 * TECH-012 model discovery for pending AI connector settings. Each protocol
 * returns model IDs and display names for the Settings selector.
 */

import type { AiPreset, AiProtocol } from "@openlaw/db";
import { readUpTo } from "./http.js";
import { AiConfigError, AiResponseError, AiTimeoutError, AiUnavailableError } from "./provider.js";

export interface AiModelOption {
  id: string;
  label: string;
}

interface ModelConfig {
  preset: AiPreset;
  protocol: AiProtocol;
  baseUrl: string;
  apiKey: string | null;
}

const MAX_PAGES = 10;
const MAX_MODELS = 5_000;
const MAX_PAGE_BYTES = 5_000_000;

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function invalid(): never {
  throw new AiResponseError("The provider returned an invalid model list.");
}

function modelUrl(config: ModelConfig): URL {
  const url = new URL(config.baseUrl);
  url.hash = "";
  // Custom endpoints can name the inference operation rather than its API root.
  url.pathname = url.pathname
    .replace(/\/$/, "")
    .replace(/\/(chat\/completions|messages|models\/[^/]+:generateContent)$/, "");
  if (!url.pathname.endsWith("/models")) url.pathname += "/models";
  return url;
}

async function getPage(
  url: URL,
  headers: Record<string, string>,
  signal: AbortSignal,
): Promise<unknown> {
  try {
    const response = await fetch(url, { method: "GET", headers, signal, redirect: "error" });
    if (!response.ok) {
      await response.body?.cancel();
      throw new AiConfigError(
        `The provider refused model discovery with HTTP ${String(response.status)}.`,
      );
    }
    const reply = await readUpTo(response, MAX_PAGE_BYTES);
    if (!reply || reply.truncated) invalid();
    try {
      return JSON.parse(reply.raw) as unknown;
    } catch {
      invalid();
    }
  } catch (error) {
    if (signal.aborted || (error instanceof DOMException && error.name === "TimeoutError")) {
      throw new AiTimeoutError("The provider did not return its models in time.");
    }
    if (error instanceof AiConfigError || error instanceof AiResponseError) throw error;
    // Provider errors and transport causes can contain the URL or an echoed key.
    throw new AiUnavailableError("The provider model list could not be reached or read.");
  }
}

/** Listing never probes a model or changes the connector. All pages share one deadline. */
export async function listAiModels(
  config: ModelConfig,
): Promise<{ models: AiModelOption[]; truncated: boolean }> {
  if (config.preset === "azure_openai")
    throw new AiConfigError("Enter the Azure deployment name manually.");
  const url = modelUrl(config);
  const headers: Record<string, string> = { accept: "application/json" };
  const key = config.apiKey;
  if (config.protocol === "anthropic_messages") {
    headers["anthropic-version"] = "2023-06-01";
    if (key) headers["x-api-key"] = key;
    url.searchParams.set("limit", "1000");
  } else if (config.protocol === "gemini") {
    if (key) headers["x-goog-api-key"] = key;
    url.searchParams.set("pageSize", "1000");
  } else if (key) {
    headers.authorization = `Bearer ${key}`;
  }
  const signal = AbortSignal.timeout(30_000);
  const found = new Map<string, AiModelOption>();
  const cursors = new Set<string>();
  let truncated = false;
  for (let page = 0; page < MAX_PAGES; page++) {
    const body = await getPage(new URL(url), headers, signal);
    if (!record(body)) invalid();
    const entries = config.protocol === "gemini" ? (body.models ?? []) : body.data;
    if (
      !Array.isArray(entries) ||
      (config.protocol === "gemini" &&
        !("models" in body) &&
        Object.keys(body).some((key) => key !== "nextPageToken"))
    )
      invalid();
    for (const entry of entries) {
      if (!record(entry)) invalid();
      if (
        config.protocol === "gemini" &&
        (!Array.isArray(entry.supportedGenerationMethods) ||
          !entry.supportedGenerationMethods.includes("generateContent"))
      )
        continue;
      if (config.preset === "openrouter" && record(entry.architecture)) {
        const { input_modalities: input, output_modalities: output } = entry.architecture;
        if (
          (Array.isArray(input) && !input.includes("text")) ||
          (Array.isArray(output) && !output.includes("text"))
        )
          continue;
      }
      const rawId = config.protocol === "gemini" ? entry.name : entry.id;
      if (typeof rawId !== "string" || !rawId.trim() || rawId.length > 300) invalid();
      const id = config.protocol === "gemini" ? rawId.replace(/^models\//, "") : rawId;
      if (!id || id.trim() !== id) invalid();
      const name = entry.display_name ?? entry.displayName ?? entry.name;
      const label = typeof name === "string" && name.trim() ? name.trim().slice(0, 300) : id;
      if (!found.has(id) && found.size >= MAX_MODELS) {
        truncated = true;
        break;
      }
      found.set(id, { id, label });
    }
    if (truncated) break;
    const cursor =
      config.protocol === "gemini"
        ? body.nextPageToken
        : body.has_more === true
          ? body.last_id
          : undefined;
    if (cursor === undefined || cursor === "") {
      if (body.has_more === true) invalid();
      break;
    }
    if (typeof cursor !== "string" || cursor.length > 2_000) invalid();
    if (cursors.has(cursor) || page === MAX_PAGES - 1) {
      truncated = true;
      break;
    }
    cursors.add(cursor);
    // Treat cursors as query values, never as provider-controlled next URLs.
    url.searchParams.set(config.protocol === "gemini" ? "pageToken" : "after_id", cursor);
  }
  return {
    models: [...found.values()].sort(
      (a, b) => a.label.localeCompare(b.label) || a.id.localeCompare(b.id),
    ),
    truncated,
  };
}
