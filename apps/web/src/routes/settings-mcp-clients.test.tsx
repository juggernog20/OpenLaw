// SPDX-License-Identifier: AGPL-3.0-only
import { screen, within, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it } from "vitest";
import { json, renderAt, stubApi } from "../testing/helpers";
const ADMIN = {
  id: "admin",
  email: "admin@example.com",
  displayName: "Admin",
  role: "administrator" as const,
};
const published = {
  id: "claude",
  name: "Claude",
  kind: "published",
  enabled: true,
  seeded: true,
  metadataUrl: "https://claude.ai/oauth/mcp-oauth-client-metadata",
  clientId: null,
  callbackUrls: [] as string[],
  secretGeneratedAt: null,
  registeredByClient: false,
  createdBy: null,
  createdAt: "2026-09-25T00:00:00Z",
};
const registered = {
  ...published,
  id: "copilot",
  name: "Microsoft 365 Copilot",
  kind: "registered",
  metadataUrl: null,
  callbackUrls: [
    "https://teams.microsoft.com/api/platform/v1.0/oAuthRedirect",
    "https://vscode.dev/redirect",
    "",
  ],
};
it("renders the card and completes Add, Edit, secret generation, rotation, toggle and delete", async () => {
  type Row = Omit<typeof published, "clientId" | "metadataUrl" | "secretGeneratedAt"> & {
    clientId: string | null;
    metadataUrl: string | null;
    secretGeneratedAt: string | null;
  };
  let clients: Row[] = [published, registered];
  let dynamic = false;
  let secrets = 0;
  const writes: string[] = [];
  stubApi({
    signedIn: ADMIN,
    extra: (call) => {
      const path = call.url.pathname;
      if (path === "/api/v1/mcp-settings") {
        if (call.method === "PATCH") {
          dynamic = (call.body as { dynamicClientRegistrationEnabled: boolean })
            .dynamicClientRegistrationEnabled;
          writes.push("policy");
        }
        return json(200, {
          enabled: true,
          legalApiKeysEnabled: false,
          businessApiKeysEnabled: false,
          legalOAuthClientsEnabled: true,
          businessOAuthClientsEnabled: false,
          reachability: [],
          serverAddress: "https://legal.example/mcp",
          toolsetCeiling: [],
          readOnly: false,
          apiKeyLifetimeDays: 90,
          allowedClients: clients,
          dynamicClientRegistrationEnabled: dynamic,
        });
      }
      const base = "/api/v1/mcp-settings/allowed-clients";
      if (!path.startsWith(base)) return;
      if (call.method === "GET") return json(200, clients);
      writes.push(`${call.method} ${path}`);
      if (path === base) {
        const row: Row = {
          ...registered,
          ...(call.body as object),
          id: "new",
          seeded: false,
          clientId: "client-123",
        };
        clients = [...clients, row];
        return json(201, row);
      }
      const id = path.split("/")[5];
      if (path.endsWith("/secret")) {
        secrets++;
        clients = clients.map((row) =>
          row.id === id
            ? { ...row, clientId: "client-123", secretGeneratedAt: "2026-09-25T00:00:00Z" }
            : row,
        );
        return json(200, { clientId: "client-123", secret: `once-shown-${secrets}` });
      }
      if (call.method === "DELETE") {
        clients = clients.filter((row) => row.id !== id);
        return new Response(null, { status: 204 });
      }
      clients = clients.map((row) => (row.id === id ? { ...row, ...(call.body as object) } : row));
      return json(
        200,
        clients.find((row) => row.id === id),
      );
    },
  });
  const user = userEvent.setup();
  renderAt("/settings/mcp");
  expect(await screen.findByText("Allowed Clients")).toBeInTheDocument();
  expect(screen.getByText(published.metadataUrl)).toBeInTheDocument();
  expect(screen.getByText("Published identity")).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Edit Claude" })).not.toBeInTheDocument();
  await user.click(screen.getByRole("switch", { name: "Enable Claude" }));
  await waitFor(() =>
    expect(screen.getByRole("switch", { name: "Enable Claude" })).not.toBeChecked(),
  );
  await user.click(screen.getByRole("switch", { name: "Dynamic client registration" }));
  await waitFor(() =>
    expect(screen.getByRole("switch", { name: "Dynamic client registration" })).toBeChecked(),
  );
  await user.click(screen.getByRole("button", { name: "Edit Microsoft 365 Copilot" }));
  let dialog = await screen.findByRole("dialog");
  expect(within(dialog).getByLabelText("Callback URL 1")).toHaveAttribute("readonly");
  expect(within(dialog).queryByRole("button", { name: "Delete Client" })).not.toBeInTheDocument();
  await user.click(within(dialog).getByRole("button", { name: "Cancel" }));
  await user.click(screen.getByRole("button", { name: "Add Client" }));
  dialog = await screen.findByRole("dialog");
  await user.type(within(dialog).getByLabelText("Client name"), "My Client");
  await user.type(
    within(dialog).getByLabelText("Callback URL 1"),
    "https://client.example/callback",
  );
  await user.click(within(dialog).getByRole("button", { name: "Save" }));
  expect(await screen.findByText("client-123")).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Generate secret" }));
  dialog = await screen.findByRole("dialog", { name: "Your Client secret is ready" });
  expect(within(dialog).getByText("once-shown-1")).toBeInTheDocument();
  await user.click(within(dialog).getByRole("button", { name: "Done" }));
  expect(screen.queryByText("once-shown-1")).not.toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Edit My Client" }));
  dialog = await screen.findByRole("dialog");
  await user.clear(within(dialog).getByLabelText("Callback URL 1"));
  await user.type(within(dialog).getByLabelText("Callback URL 1"), "https://client.example/new");
  await user.click(within(dialog).getByRole("button", { name: "Save" }));
  await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  expect(clients.find((row) => row.id === "new")?.callbackUrls).toEqual([
    "https://client.example/new",
  ]);
  await user.click(screen.getByRole("button", { name: "Edit My Client" }));
  await user.click(screen.getByRole("button", { name: "Rotate secret" }));
  expect(await screen.findByText("once-shown-2")).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Done" }));
  await user.click(screen.getByRole("button", { name: "Edit My Client" }));
  await user.click(screen.getByRole("button", { name: "Delete Client" }));
  await waitFor(() =>
    expect(screen.queryByRole("button", { name: "Edit My Client" })).not.toBeInTheDocument(),
  );
  expect(writes).toContain("policy");
  expect(secrets).toBe(2);
});

it("keeps the switch and names the failed operation when a toggle is refused", async () => {
  stubApi({
    signedIn: ADMIN,
    extra: (call) => {
      const path = call.url.pathname;
      if (path === "/api/v1/mcp-settings")
        return json(200, {
          enabled: true,
          legalApiKeysEnabled: false,
          businessApiKeysEnabled: false,
          legalOAuthClientsEnabled: true,
          businessOAuthClientsEnabled: false,
          reachability: [],
          serverAddress: "https://legal.example/mcp",
          toolsetCeiling: [],
          readOnly: false,
          apiKeyLifetimeDays: 90,
          allowedClients: [published],
          dynamicClientRegistrationEnabled: false,
          authorizationServerAvailable: true,
        });
      if (path === "/api/v1/mcp-settings/allowed-clients") return json(200, [published]);
      if (path === "/api/v1/mcp-settings/allowed-clients/claude" && call.method === "PATCH")
        return json(500, { title: "Allowed Client was not updated." });
      return undefined;
    },
  });
  const user = userEvent.setup();
  renderAt("/settings/mcp");
  await user.click(await screen.findByRole("switch", { name: "Enable Claude" }));
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "The Client could not be turned on or off. Try again.",
  );
  expect(screen.getByRole("switch", { name: "Enable Claude" })).toBeChecked();
});
