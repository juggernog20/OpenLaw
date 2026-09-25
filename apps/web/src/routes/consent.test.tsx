// SPDX-License-Identifier: AGPL-3.0-only

import { afterEach, expect, it, vi } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { paths } from "@openlaw/api-client";
import { json, problem, renderAt, stubApi, type StubCall } from "../testing/helpers";

type Facts =
  paths["/api/v1/oauth-grants/consent"]["get"]["responses"][200]["content"]["application/json"];
const query =
  "client_id=claude&scope=toolset%3Amatters+write&state=a%2fb&sig=signed%2Bvalue&exp=123&ba_iat=100&ba_param=scope";
const facts: Facts = {
  organizationName: "Acme Inc",
  client: {
    id: "c1",
    name: "Claude",
    kind: "published",
    identityCaption: "https://claude.ai/oauth/metadata",
  },
  person: {
    id: "u1",
    displayName: "Sarah Chen",
    email: "sarah@acme.com",
    role: "legal_team_member",
    image: "/sarah.png",
  },
  toolsets: ["workspace", "contracts", "matters", "tasks", "documents", "people"],
  writeOffered: true,
  refusalReason: null,
};
function setup(
  overrides: Partial<Facts> = {},
  answer?: (call: StubCall) => Response,
  oauthQuery = query,
) {
  const calls: StubCall[] = [];
  stubApi({
    signedIn: facts.person,
    extra: (call) => {
      if (call.url.pathname !== "/api/v1/oauth-grants/consent") return;
      calls.push(call);
      return call.method === "GET"
        ? json(200, { ...facts, ...overrides })
        : (answer?.(call) ?? json(200, { url: "https://client.example/callback?code=approved" }));
    },
  });
  renderAt(`/auth/consent?${oauthQuery}`);
  return calls;
}
afterEach(() => {
  vi.unstubAllGlobals();
});

it("renders MC5 facts and empty choices on its own light canvas", async () => {
  document.documentElement.dataset.theme = "dark";
  const calls = setup();
  const heading = await screen.findByRole("heading", {
    name: "Claude wants to work in OpenLaw as you",
  });
  expect(screen.getByText("openlaw")).toBeVisible();
  expect(screen.getByText("Acme Inc")).toBeVisible();
  expect(screen.getByText("https://claude.ai/oauth/metadata")).toBeVisible();
  expect(screen.getByText("Published identity")).toBeVisible();
  expect(screen.getByText("Allowed Client")).toBeVisible();
  expect(screen.getByText("CL")).toBeVisible();
  expect(screen.getByText("Sarah Chen")).toBeVisible();
  expect(screen.getByText("Legal team member")).toBeVisible();
  expect(screen.getByText("sarah@acme.com")).toBeVisible();
  expect(screen.getByRole("group", { name: "What Claude may use" })).toBeVisible();
  expect(screen.getByRole("group", { name: "How far Claude may go" })).toBeVisible();
  expect(screen.getByText("Nothing is selected for you.")).toBeVisible();
  expect(screen.getByText(/Every change is recorded as you, via Claude/)).toBeVisible();
  expect(screen.getByText("This Client can never see or change what you cannot.")).toBeVisible();
  expect(screen.getByText(/disconnect Claude later from Settings → API keys/)).toBeVisible();
  for (const control of [...screen.getAllByRole("checkbox"), ...screen.getAllByRole("radio")])
    expect(control).not.toBeChecked();
  expect(screen.getByRole("button", { name: "Allow" })).toBeDisabled();
  expect(screen.getByRole("link", { name: "Skip to content" })).toHaveAttribute("href", "#main");
  expect(screen.queryByRole("navigation")).not.toBeInTheDocument();
  expect(screen.queryByRole("banner")).not.toBeInTheDocument();
  expect(screen.queryByRole("complementary")).not.toBeInTheDocument();
  expect(screen.queryByText("Legal Portal")).not.toBeInTheDocument();
  expect(screen.queryByRole("link", { name: /help/i })).not.toBeInTheDocument();
  expect(heading).toBeVisible();
  expect(document.documentElement.dataset.theme).toBe("light");
  expect(document.title).toBe("Client consent · OpenLaw");
  expect(screen.queryByText(/expires|lifetime/i)).not.toBeInTheDocument();
  expect(calls[0]!.url.searchParams.get("oauth_query")).toBe(query);
});

it.each(["read", "write"])(
  "requires both choices, posts %s consent and follows the Client redirect",
  async (scope) => {
    const assign = vi.fn();
    const calls = setup();
    vi.stubGlobal("location", { ...window.location, assign });
    const allow = await screen.findByRole("button", { name: "Allow" });
    await userEvent.click(screen.getByRole("checkbox", { name: "Matters" }));
    expect(allow).toBeDisabled();
    await userEvent.click(
      screen.getByRole("radio", { name: scope === "read" ? "Read only" : "Read and write" }),
    );
    expect(allow).toBeEnabled();
    await userEvent.click(screen.getByRole("checkbox", { name: "Matters" }));
    expect(allow).toBeDisabled();
    await userEvent.click(screen.getByRole("checkbox", { name: "Contracts" }));
    await userEvent.click(allow);
    await waitFor(() =>
      expect(assign).toHaveBeenCalledWith("https://client.example/callback?code=approved"),
    );
    expect(calls.find((c) => c.method === "POST")?.body).toEqual({
      accept: true,
      oauth_query: query,
      toolsets: ["contracts"],
      scope,
    });
  },
);

it("offers only read, still unselected, when the organization is read-only", async () => {
  setup({ writeOffered: false });
  expect(await screen.findByRole("radio", { name: "Read only" })).not.toBeChecked();
  expect(screen.queryByRole("radio", { name: "Read and write" })).not.toBeInTheDocument();
  expect(screen.queryByText(/Every change/)).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Allow" })).toBeDisabled();
});

it("shows a Business User and only the Toolsets returned for that person", async () => {
  setup({
    person: { ...facts.person, role: "business_user", image: null },
    toolsets: ["contracts", "documents"],
    client: { ...facts.client!, kind: "registered", identityCaption: "client-123" },
  });
  expect(await screen.findByText("Business user")).toBeVisible();
  expect(screen.getByText("Registered client")).toBeVisible();
  expect(screen.getByText("client-123")).toBeVisible();
  expect(screen.getByText("SC")).toBeVisible();
  expect(screen.getAllByRole("checkbox")).toHaveLength(2);
  expect(screen.queryByRole("checkbox", { name: "Tasks" })).not.toBeInTheDocument();
  expect(screen.getByText(/disconnect Claude later from Portal settings → API keys/)).toBeVisible();
});

it.each([
  ["mcp_disabled", "MCP is off for this organization."],
  ["group_disabled", "OAuth Clients are off for your account type."],
  ["client_unlisted", "This Client is not on the organization's Allowed Clients list."],
  ["client_disabled", "This Client is off in the organization's Allowed Clients list."],
] as const)("shows %s with Deny alone", async (refusalReason, sentence) => {
  const assign = vi.fn();
  const calls = setup({
    refusalReason,
    client: refusalReason === "client_unlisted" ? null : facts.client,
    toolsets: [],
  });
  vi.stubGlobal("location", { ...window.location, assign });
  expect(await screen.findByText(sentence)).toBeVisible();
  expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
  expect(screen.queryByRole("radio")).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Allow" })).not.toBeInTheDocument();
  await userEvent.click(screen.getByRole("button", { name: "Deny" }));
  await waitFor(() => expect(assign).toHaveBeenCalled());
  expect(calls.find((c) => c.method === "POST")?.body).toEqual({
    accept: false,
    oauth_query: query,
  });
});

it("lets a person deny an allowed Client without any choices", async () => {
  const assign = vi.fn();
  const calls = setup();
  vi.stubGlobal("location", { ...window.location, assign });
  await userEvent.click(await screen.findByRole("button", { name: "Deny" }));
  await waitFor(() => expect(assign).toHaveBeenCalled());
  expect(calls.find((c) => c.method === "POST")?.body).toEqual({
    accept: false,
    oauth_query: query,
  });
});

it.each(["expired", "altered"])(
  "renders the facts refusal for an %s query without choices or actions",
  async (condition) => {
    const refusedQuery =
      condition === "expired"
        ? query.replace("exp=123", "exp=1")
        : query.replace("client_id=claude", "client_id=altered");
    const calls = setup(
      { refusalReason: "expired_query", client: null, toolsets: [], writeOffered: false },
      undefined,
      refusedQuery,
    );
    expect(
      await screen.findByText(
        "This consent request has expired or changed. Start again from your Client.",
      ),
    ).toBeVisible();
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
    expect(screen.queryByRole("radio")).not.toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    expect(calls[0]!.url.searchParams.get("oauth_query")).toBe(refusedQuery);
  },
);

it("shows an answer failure and lets the person try again", async () => {
  setup({}, () => problem(503, "Consent is temporarily unavailable."));
  await userEvent.click(await screen.findByRole("button", { name: "Deny" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("Consent is temporarily unavailable.");
  expect(screen.getByRole("button", { name: "Deny" })).toBeEnabled();
});

it("removes choices and actions when the signed query expires before the answer", async () => {
  let expired = false;
  stubApi({
    signedIn: facts.person,
    extra: (call) => {
      if (call.url.pathname !== "/api/v1/oauth-grants/consent") return;
      if (call.method === "POST") {
        expired = true;
        return problem(
          400,
          "This consent request has expired or changed. Start again from your Client.",
        );
      }
      return json(
        200,
        expired
          ? {
              ...facts,
              client: null,
              refusalReason: "expired_query",
              toolsets: [],
              writeOffered: false,
            }
          : facts,
      );
    },
  });
  renderAt(`/auth/consent?${query}`);
  await userEvent.click(await screen.findByRole("checkbox", { name: "Matters" }));
  await userEvent.click(screen.getByRole("radio", { name: "Read only" }));
  await userEvent.click(screen.getByRole("button", { name: "Allow" }));
  expect(
    await screen.findByText(
      "This consent request has expired or changed. Start again from your Client.",
    ),
  ).toBeVisible();
  expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
  expect(screen.queryByRole("radio")).not.toBeInTheDocument();
  expect(screen.queryByRole("button")).not.toBeInTheDocument();
});

it("returns a missing session to sign-in with its query", async () => {
  stubApi({
    extra: (call) =>
      call.url.pathname === "/api/v1/oauth-grants/consent"
        ? problem(401, "Authentication required.")
        : undefined,
  });
  const { router } = renderAt(`/auth/consent?${query}`);
  expect(await screen.findByLabelText("Password")).toBeVisible();
  expect(router.state.location.pathname + router.state.location.search).toBe(
    `/auth/login?${query}`,
  );
});
