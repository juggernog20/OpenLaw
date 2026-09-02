// SPDX-License-Identifier: AGPL-3.0-only

import { describe, expect, it } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { paths } from "@openlaw/api-client";
import { json, problem, renderAt, stubApi, type StubCall } from "../testing/helpers";

const ADMIN = {
  id: "u1",
  email: "admin@example.com",
  displayName: "Ada Admin",
  role: "administrator",
  theme: "light",
};
const MEMBER = { ...ADMIN, id: "u2", role: "legal_team_member" };

type AiResponse =
  paths["/api/v1/ai-connector"]["get"]["responses"]["200"]["content"]["application/json"];
type AiSaveRequest =
  paths["/api/v1/ai-connector"]["put"]["requestBody"]["content"]["application/json"];

const PRESETS = [
  {
    preset: "anthropic",
    label: "Anthropic",
    protocol: "anthropic_messages",
    baseUrl: "https://api.anthropic.com/v1",
    defaultModel: "claude-sonnet-5",
    requiresApiKey: true,
    requiresBaseUrl: false,
  },
  {
    preset: "openai",
    label: "OpenAI",
    protocol: "openai_chat_completions",
    baseUrl: "https://api.openai.com/v1",
    defaultModel: "gpt-5.6-luna",
    requiresApiKey: true,
    requiresBaseUrl: false,
  },
  {
    preset: "azure_openai",
    label: "Azure OpenAI",
    protocol: "openai_chat_completions",
    baseUrl: null,
    defaultModel: "gpt-5.6-luna",
    requiresApiKey: true,
    requiresBaseUrl: true,
  },
  {
    preset: "gemini",
    label: "Gemini",
    protocol: "gemini",
    baseUrl: "https://generativelanguage.googleapis.com/v1beta",
    defaultModel: "gemini-3.6-flash",
    requiresApiKey: true,
    requiresBaseUrl: false,
  },
  {
    preset: "openrouter",
    label: "OpenRouter",
    protocol: "openai_chat_completions",
    baseUrl: "https://openrouter.ai/api/v1",
    defaultModel: "~openai/gpt-latest",
    requiresApiKey: true,
    requiresBaseUrl: false,
  },
  {
    preset: "ollama",
    label: "Ollama",
    protocol: "openai_chat_completions",
    baseUrl: "http://localhost:11434/v1",
    defaultModel: "llama3.2",
    requiresApiKey: false,
    requiresBaseUrl: false,
  },
  {
    preset: "custom",
    label: "Custom endpoint",
    protocol: "openai_chat_completions",
    baseUrl: null,
    defaultModel: "",
    requiresApiKey: true,
    requiresBaseUrl: true,
  },
] satisfies AiResponse["presets"];

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isAiSaveRequest(value: unknown): value is AiSaveRequest {
  if (!isRecord(value)) return false;
  const preset = PRESETS.find((option) => option.preset === value.preset);
  return (
    preset !== undefined &&
    typeof value.model === "string" &&
    (value.protocol === undefined || typeof value.protocol === "string") &&
    (value.baseUrl === undefined || typeof value.baseUrl === "string") &&
    (value.apiKey === undefined || typeof value.apiKey === "string")
  );
}

function connector(overrides: Partial<AiResponse["connector"]> = {}): AiResponse["connector"] {
  return {
    configured: true,
    enabled: true,
    preset: "openai",
    protocol: "openai_chat_completions",
    baseUrl: "https://api.openai.com/v1",
    hasApiKey: true,
    model: "gpt-saved",
    disabledAt: null,
    updatedAt: "2026-09-02T12:00:00.000Z",
    ...overrides,
  };
}

function unconfigured(): AiResponse["connector"] {
  return connector({
    configured: false,
    enabled: false,
    preset: null,
    protocol: null,
    baseUrl: null,
    hasApiKey: false,
    model: null,
    updatedAt: null,
  });
}

function connectorApi(
  options: { connector?: AiResponse["connector"]; test?: globalThis.Response } = {},
  saves: unknown[] = [],
) {
  let stored = options.connector ?? connector();
  return (call: StubCall) => {
    if (call.url.pathname === "/api/v1/ai-connector") {
      if (call.method === "PUT") {
        saves.push(call.body);
        if (!isAiSaveRequest(call.body)) throw new Error("Unexpected AI connector save body");
        const body = call.body;
        const option = PRESETS.find((candidate) => candidate.preset === body.preset)!;
        stored = connector({
          preset: option.preset,
          protocol: body.protocol ?? option.protocol,
          baseUrl: body.baseUrl ?? option.baseUrl,
          model: body.model,
          hasApiKey: stored.hasApiKey || body.apiKey !== undefined,
          enabled: stored.enabled,
          disabledAt: stored.disabledAt,
        });
      }
      return json(200, { connector: stored, presets: PRESETS });
    }
    if (call.url.pathname === "/api/v1/ai-connector/test" && call.method === "POST") {
      return options.test ?? json(200, { ok: true });
    }
    return undefined;
  };
}

async function openProvider(user: ReturnType<typeof userEvent.setup>) {
  await user.click(await screen.findByRole("button", { name: "Provider", expanded: false }));
}

describe("the AI analysis connector pane (#662)", () => {
  it("bounces a non-Administrator to their settings home", async () => {
    stubApi({ signedIn: MEMBER });
    renderAt("/settings/integrations/ai-analysis");
    expect(await screen.findByLabelText("Full name")).toBeVisible();
    expect(screen.queryByRole("link", { name: "Integrations" })).not.toBeInTheDocument();
  });

  it("shows AI analysis as the Integrations section's second pane", async () => {
    stubApi({ signedIn: ADMIN, extra: connectorApi() });
    renderAt("/settings/integrations/ai-analysis");
    const tabs = await screen.findByRole("navigation", { name: "Integration panes" });
    expect(
      within(tabs)
        .getAllByRole("link")
        .map((link) => link.textContent),
    ).toEqual(["E-signature", "AI analysis"]);
    expect(within(tabs).getByRole("link", { name: "AI analysis" })).toHaveAttribute(
      "aria-current",
      "page",
    );
  });

  it("switches presets, prefills models, and shows custom-only fields", async () => {
    const user = userEvent.setup();
    stubApi({ signedIn: ADMIN, extra: connectorApi({ connector: unconfigured() }) });
    renderAt("/settings/integrations/ai-analysis");
    await openProvider(user);
    expect(screen.getByLabelText("Model")).toHaveValue("claude-sonnet-5");
    expect(screen.queryByLabelText("Protocol")).not.toBeInTheDocument();

    await user.selectOptions(screen.getByLabelText("Provider"), "custom");
    expect(screen.getByLabelText("Protocol")).toHaveValue("openai_chat_completions");
    expect(screen.getByLabelText("Base URL")).toBeVisible();
    expect(screen.getByLabelText("Model")).toHaveValue("");

    await user.selectOptions(screen.getByLabelText("Provider"), "gemini");
    expect(screen.queryByLabelText("Protocol")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Base URL")).not.toBeInTheDocument();
    expect(screen.getByLabelText("Model")).toHaveValue("gemini-3.6-flash");
  });

  it("keeps the stored key write-only and omits blank on save", async () => {
    const user = userEvent.setup();
    const saves: unknown[] = [];
    stubApi({ signedIn: ADMIN, extra: connectorApi({}, saves) });
    renderAt("/settings/integrations/ai-analysis");
    await openProvider(user);
    expect(screen.getByLabelText("API key")).toHaveValue("");
    expect(screen.getByText(/Leave blank to keep the current key/)).toBeVisible();
    await user.clear(screen.getByLabelText("Model"));
    await user.type(screen.getByLabelText("Model"), "gpt-updated");
    await user.click(screen.getByRole("button", { name: "Save connector" }));
    await waitFor(() => expect(saves).toHaveLength(1));
    expect(saves[0]).toEqual({ preset: "openai", model: "gpt-updated" });
  });

  it("prints a successful connection test in place", async () => {
    const user = userEvent.setup();
    stubApi({ signedIn: ADMIN, extra: connectorApi() });
    renderAt("/settings/integrations/ai-analysis");
    await openProvider(user);
    await user.click(screen.getByRole("button", { name: "Test connection" }));
    expect(await screen.findByText("Connection successful.")).toBeVisible();
  });

  it("prints the provider's failure reason in place", async () => {
    const user = userEvent.setup();
    stubApi({
      signedIn: ADMIN,
      extra: connectorApi({
        test: problem(502, "The connection test failed. The provider rejected the API key."),
      }),
    });
    renderAt("/settings/integrations/ai-analysis");
    await openProvider(user);
    await user.click(screen.getByRole("button", { name: "Test connection" }));
    expect(await screen.findByText(/provider rejected the API key/)).toBeVisible();
  });
});
