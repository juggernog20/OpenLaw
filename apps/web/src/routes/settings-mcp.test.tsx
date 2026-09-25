// SPDX-License-Identifier: AGPL-3.0-only
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it } from "vitest";
import { json, problem, renderAt, stubApi } from "../testing/helpers";
const ADMIN = {
  id: "admin",
  email: "admin@example.com",
  displayName: "Admin",
  role: "administrator" as const,
};
const initial = {
  allowedClients: [],
  dynamicClientRegistrationEnabled: false,
  enabled: false,
  legalOAuthClientsEnabled: false,
  businessOAuthClientsEnabled: false,
  reachability: null,
  legalApiKeysEnabled: false,
  businessApiKeysEnabled: false,
  toolsetCeiling: [
    "workspace",
    "contracts",
    "matters",
    "tasks",
    "requests",
    "comments",
    "documents",
    "auto-docs",
    "entities",
    "knowledge",
    "people",
    "team",
    "administration",
  ],
  readOnly: false,
  apiKeyLifetimeDays: 90,
  serverAddress: "https://legal.example/mcp",
};
it("puts MCP between Integrations and Advanced and saves each control immediately", async () => {
  let state = { ...initial };
  const writes: unknown[] = [];
  stubApi({
    signedIn: ADMIN,
    extra: (call) => {
      if (call.url.pathname !== "/api/v1/mcp-settings") return;
      if (call.method === "PATCH") {
        writes.push(call.body);
        state = { ...state, ...(call.body as object) };
      }
      return json(200, state);
    },
  });
  const user = userEvent.setup();
  renderAt("/settings/mcp");
  expect(await screen.findByText(initial.serverAddress)).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "Tool calls in the last day" })).toHaveAttribute(
    "href",
    "/settings/audit-log/tool-calls?range=last-day",
  );
  const rail = screen.getByRole("navigation", { name: "Settings sections" });
  const mcp = within(rail).getByRole("link", { name: "MCP" });
  expect(
    within(rail).getByRole("link", { name: "Integrations" }).compareDocumentPosition(mcp) &
      Node.DOCUMENT_POSITION_FOLLOWING,
  ).toBeTruthy();
  expect(
    mcp.compareDocumentPosition(within(rail).getByRole("button", { name: "Advanced" })) &
      Node.DOCUMENT_POSITION_FOLLOWING,
  ).toBeTruthy();
  expect(screen.getAllByText("OAuth Clients")).toHaveLength(2);
  for (const name of ["Enable MCP", "Legal Users API keys", "Business Users API keys"]) {
    const control = screen.getByRole("switch", { name });
    expect(control).not.toBeChecked();
    await user.click(control);
    await waitFor(() => expect(control).toBeChecked());
  }
  const ceiling = screen.getByRole("button", { name: "Toolset ceiling" });
  expect(ceiling).toHaveAttribute("aria-expanded", "false");
  await user.click(ceiling);
  expect(screen.getAllByRole("checkbox")).toHaveLength(13);
  for (const box of screen.getAllByRole("checkbox")) expect(box).toBeChecked();
  await user.click(screen.getByRole("checkbox", { name: "Contracts" }));
  await waitFor(() =>
    expect(screen.getByRole("checkbox", { name: "Contracts" })).not.toBeChecked(),
  );
  await user.click(screen.getByRole("switch", { name: "Read-only" }));
  await waitFor(() => expect(screen.getByRole("switch", { name: "Read-only" })).toBeChecked());
  const lifetime = screen.getByLabelText("API key lifetime (days)");
  expect(lifetime).toHaveValue(90);
  await user.clear(lifetime);
  await user.type(lifetime, "30");
  await user.tab();
  await waitFor(() => expect(writes).toHaveLength(6));
  expect(writes).toEqual([
    { enabled: true },
    { legalApiKeysEnabled: true },
    { businessApiKeysEnabled: true },
    { toolsetCeiling: initial.toolsetCeiling.filter((id) => id !== "contracts") },
    { readOnly: true },
    { apiKeyLifetimeDays: 30 },
  ]);
});
it("refuses a Legal Team Member without reading the settings or showing the MCP entry", async () => {
  const reads: string[] = [];
  stubApi({
    signedIn: { ...ADMIN, role: "legal_team_member" },
    extra: (call) => {
      if (call.url.pathname === "/api/v1/mcp-settings") {
        reads.push(call.method);
        return json(200, initial);
      }
    },
  });
  const { router } = renderAt("/settings/mcp");
  await waitFor(() => expect(router.state.location.pathname).toBe("/settings/profile"));
  expect(reads).toEqual([]);
  expect(screen.queryByRole("link", { name: "MCP" })).not.toBeInTheDocument();
});
it("keeps the saved switch state when a write is refused and names an invalid lifetime", async () => {
  stubApi({
    signedIn: ADMIN,
    extra: (call) => {
      if (call.url.pathname !== "/api/v1/mcp-settings") return;
      return call.method === "PATCH"
        ? problem(403, "Administrator access is required.")
        : json(200, initial);
    },
  });
  const user = userEvent.setup();
  renderAt("/settings/mcp");
  const control = await screen.findByRole("switch", { name: "Enable MCP" });
  await user.click(control);
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "Only an Administrator can change MCP settings. Reload to check your access.",
  );
  expect(control).not.toBeChecked();
  const lifetime = screen.getByLabelText("API key lifetime (days)");
  await user.clear(lifetime);
  await user.type(lifetime, "366");
  await user.tab();
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "API key lifetime must be a whole number from 1 to 365 days.",
  );
});

it("shows the localized route error when MCP settings cannot load", async () => {
  stubApi({
    signedIn: ADMIN,
    extra: (call) => {
      if (call.url.pathname === "/api/v1/mcp-settings")
        return problem(500, "Internal failure detail");
    },
  });
  renderAt("/settings/mcp");
  expect(
    await screen.findByText("The page could not load. Reload to try again."),
  ).toBeInTheDocument();
  expect(screen.queryByText("MCP settings could not be read.")).not.toBeInTheDocument();
  expect(screen.queryByText("Internal failure detail")).not.toBeInTheDocument();
});

it.each([true, false])(
  "shows the address pill only with OAuth Clients enabled (reachable=%s)",
  async (passed) => {
    let state = { ...initial, reachability: null as null | { name: string; passed: boolean }[] };
    stubApi({
      signedIn: ADMIN,
      extra: (call) => {
        if (call.url.pathname !== "/api/v1/mcp-settings") return;
        if (call.method === "PATCH") {
          state = { ...state, ...(call.body as object) };
          state.reachability =
            state.legalOAuthClientsEnabled || state.businessOAuthClientsEnabled
              ? [
                  { name: "https", passed },
                  { name: "ipv4", passed },
                  { name: "public_ipv4", passed },
                ]
              : null;
        }
        return json(200, state);
      },
    });
    const user = userEvent.setup();
    renderAt("/settings/mcp");
    const legal = await screen.findByRole("switch", { name: "Legal Users OAuth Clients" });
    const business = screen.getByRole("switch", { name: "Business Users OAuth Clients" });
    expect(legal).not.toBeChecked();
    expect(business).not.toBeChecked();
    expect(screen.queryByText(/Reachable|Not reachable/)).not.toBeInTheDocument();
    expect(screen.getAllByRole("link", { name: "publicly reachable" })[0]).toHaveAttribute(
      "href",
      "/help/deployment-configuration#publicly-reachable",
    );
    await user.click(legal);
    const pill = await screen.findByText(passed ? "Reachable" : /Not reachable/);
    expect(pill.parentElement).toHaveTextContent(initial.serverAddress);
    if (!passed)
      expect(pill).toHaveTextContent(
        "Not reachable · HTTPS scheme, IPv4 record, Public IPv4 address",
      );
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    await user.click(business);
    await waitFor(() => expect(business).toBeChecked());
    await user.click(legal);
    await waitFor(() => expect(legal).not.toBeChecked());
    expect(pill).toBeInTheDocument();
    await user.click(business);
    await waitFor(() => expect(pill).not.toBeInTheDocument());
  },
);
it("keeps refused OAuth toggles off and shows the scheme failure beside the address", async () => {
  stubApi({
    signedIn: ADMIN,
    extra: (call) => {
      if (call.url.pathname !== "/api/v1/mcp-settings") return;
      return call.method === "PATCH"
        ? json(400, {
            type: "urn:openlaw:problem:mcp-oauth-unavailable",
            status: 400,
            title: "BASE_URL scheme http:",
            reachability: [
              { name: "https", passed: false },
              { name: "ipv4", passed: true },
              { name: "public_ipv4", passed: true },
            ],
          })
        : json(200, initial);
    },
  });
  renderAt("/settings/mcp");
  const control = await screen.findByRole("switch", { name: "Legal Users OAuth Clients" });
  await userEvent.setup().click(control);
  expect(await screen.findByText("Not reachable · HTTPS scheme")).toBeInTheDocument();
  expect(control).not.toBeChecked();
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
});

it("lists grants beside keys, counts each kind, and revokes a grant", async () => {
  let grants = [
    {
      id: "grant-1",
      personId: "owner-1",
      owner: "Legal Member",
      clientName: "Connected Client",
      toolsets: ["contracts", "documents"],
      scope: "read",
      grantedAt: "2026-09-01T00:00:00.000Z",
      expiresAt: "2026-12-01T00:00:00.000Z",
      lastUsedAt: "2026-09-02T00:00:00.000Z",
    },
  ];
  const writes: string[] = [];
  stubApi({
    signedIn: ADMIN,
    extra: (call) => {
      if (call.url.pathname === "/api/v1/mcp-settings") return json(200, initial);
      if (call.url.pathname === "/api/v1/mcp-settings/oauth-grants") return json(200, grants);
      if (call.url.pathname === "/api/v1/oauth-grants/grant-1/revoke" && call.method === "POST") {
        writes.push(call.url.pathname);
        grants = [];
        return json(200, { revoked: true });
      }
    },
  });
  const user = userEvent.setup();
  renderAt("/settings/mcp");
  const header = await screen.findByRole("button", { name: "Active keys and grants" });
  expect(header).toHaveAttribute("aria-expanded", "false");
  expect(screen.getByText("0 keys · 1 grant")).toBeInTheDocument();
  await user.click(header);
  const row = screen.getByText("Connected Client").closest("tr")!;
  expect(within(row).getByText("Legal Member")).toBeInTheDocument();
  expect(within(row).getByText("Contracts, Documents")).toBeInTheDocument();
  expect(within(row).getByText("Read")).toBeInTheDocument();
  expect(within(row).getByText(/Dec 1, 2026/)).toBeInTheDocument();
  expect(
    within(row.closest("table")!).getByRole("columnheader", { name: "Granted" }),
  ).toBeInTheDocument();
  await user.click(within(row).getByRole("button", { name: "Revoke" }));
  await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Revoke" }));
  await waitFor(() => expect(writes).toHaveLength(1));
  await waitFor(() => expect(screen.queryByText("Connected Client")).not.toBeInTheDocument());
  expect(screen.getByText("0 keys · 0 grants")).toBeInTheDocument();
});
