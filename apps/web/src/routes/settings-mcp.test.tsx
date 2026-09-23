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
  enabled: false,
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
  expect(screen.queryByText("OAuth Clients")).not.toBeInTheDocument();
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
