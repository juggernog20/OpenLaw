// SPDX-License-Identifier: AGPL-3.0-only
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it } from "vitest";
import { json, renderAt, stubApi } from "../testing/helpers";
const policy = {
  enabled: true,
  groupEnabled: true,
  toolsetCeiling: ["contracts", "tasks", "team", "administration"],
  toolsets: ["contracts", "tasks"],
  readOnly: true,
  apiKeyLifetimeDays: 90,
};
const row = {
  id: "request-1",
  requesterId: "person",
  owner: "Person",
  clientName: "Research script",
  toolsets: ["contracts"],
  scope: "read",
  note: null,
  status: "active",
  decisionNote: null,
  decidedAt: "2026-09-24T00:00:00Z",
  approvedBy: "Admin",
  createdAt: "2026-09-24T00:00:00Z",
  expiresAt: "2026-12-23T00:00:00Z",
  lastUsedAt: null,
  keyAvailable: false,
};
for (const [path, role] of [
  ["/settings/api-keys", "legal_team_member"],
  ["/portal/settings/api-keys", "business_user"],
] as const) {
  it(`requests a key with empty choices on ${path}`, async () => {
    let sent: unknown;
    stubApi({
      signedIn: { id: "person", email: "person@example.com", displayName: "Person", role },
      extra: (call) => {
        if (call.url.pathname === "/api/v1/api-key-requests") {
          if (call.method === "POST") {
            sent = call.body;
            return json(201, { ...row, status: "pending" });
          }
          return json(200, { policy, requests: [] });
        }
      },
    });
    renderAt(path);
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Request a key" }));
    const dialog = screen.getByRole("dialog", { name: "Request an API key" });
    expect(
      within(dialog)
        .getAllByRole("checkbox")
        .every((c) => c.getAttribute("data-state") === "unchecked"),
    ).toBe(true);
    expect(within(dialog).getByRole("radio", { name: /Read/ })).not.toBeChecked();
    expect(within(dialog).queryByRole("radio", { name: /Write/ })).not.toBeInTheDocument();
    expect(within(dialog).queryByRole("checkbox", { name: "Matters" })).not.toBeInTheDocument();
    expect(within(dialog).queryByRole("checkbox", { name: "Team" })).not.toBeInTheDocument();
    expect(
      within(dialog).queryByRole("checkbox", { name: "Administration" }),
    ).not.toBeInTheDocument();
    await user.type(
      within(dialog).getByRole("textbox", { name: "Client name" }),
      "Research script",
    );
    await user.click(within(dialog).getByRole("checkbox", { name: "Contracts" }));
    await user.click(within(dialog).getByRole("radio", { name: /Read/ }));
    await user.click(within(dialog).getByRole("button", { name: "Send request" }));
    await waitFor(() =>
      expect(sent).toMatchObject({
        clientName: "Research script",
        toolsets: ["contracts"],
        scope: "read",
      }),
    );
  });
  it(`explains an empty Toolset choice on ${path}`, async () => {
    stubApi({
      signedIn: { id: "person", email: "person@example.com", displayName: "Person", role },
      extra: (call) =>
        call.url.pathname === "/api/v1/api-key-requests"
          ? json(200, { policy: { ...policy, toolsets: [] }, requests: [] })
          : undefined,
    });
    renderAt(path);
    expect(
      await screen.findByText(
        "No Toolsets are available for your account. Ask an Administrator to enable a Toolset you can use.",
      ),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Request a key" })).not.toBeInTheDocument();
    expect(screen.queryByRole("dialog", { name: "Request an API key" })).not.toBeInTheDocument();
  });
  it(`hides the request action when the group is off on ${path}`, async () => {
    stubApi({
      signedIn: { id: "person", email: "person@example.com", displayName: "Person", role },
      extra: (call) =>
        call.url.pathname === "/api/v1/api-key-requests"
          ? json(200, { policy: { ...policy, groupEnabled: false }, requests: [row] })
          : undefined,
    });
    renderAt(path);
    await screen.findByText("Research script");
    expect(screen.queryByRole("button", { name: "Request a key" })).not.toBeInTheDocument();
  });
}
it("keeps the once-shown key through an outside click and leaves on Esc", async () => {
  stubApi({
    signedIn: {
      id: "person",
      email: "person@example.com",
      displayName: "Person",
      role: "legal_team_member",
    },
    extra: (call) => {
      if (call.url.pathname === "/api/v1/api-key-requests")
        return json(200, { policy, requests: [{ ...row, keyAvailable: true }] });
      if (call.url.pathname.endsWith("/request-1")) return json(200, { ...row, key: "ol_stays" });
    },
  });
  // Radix sets `pointer-events: none` on the body behind a modal, which
  // user-event refuses to click through; the check is off so the click
  // reaches the overlay the way a real pointer does.
  const user = userEvent.setup({ pointerEventsCheck: 0 });
  renderAt("/settings/api-keys");
  const ready = await screen.findByRole("dialog", { name: "Your key is ready" });
  await user.click(document.body);
  expect(within(ready).getByText("ol_stays")).toBeInTheDocument();
  await user.keyboard("{Escape}");
  await waitFor(() =>
    expect(screen.queryByRole("dialog", { name: "Your key is ready" })).not.toBeInTheDocument(),
  );
});
it("collects an approved key once, copies it and confirms revocation", async () => {
  let collected = 0;
  let revoked = false;
  stubApi({
    signedIn: {
      id: "person",
      email: "person@example.com",
      displayName: "Person",
      role: "legal_team_member",
    },
    extra: (call) => {
      if (call.url.pathname === "/api/v1/api-key-requests")
        return json(200, {
          policy,
          requests: [{ ...row, status: revoked ? "revoked" : "active", keyAvailable: !collected }],
        });
      if (call.url.pathname.endsWith("/request-1/revoke")) {
        revoked = true;
        return json(200, { ...row, status: "revoked" });
      }
      if (call.url.pathname.endsWith("/request-1")) {
        collected++;
        return json(200, { ...row, key: "ol_once_only" });
      }
    },
  });
  const user = userEvent.setup();
  renderAt("/settings/api-keys");
  const ready = await screen.findByRole("dialog", { name: "Your key is ready" });
  expect(within(ready).getByText(/will not show/)).toBeInTheDocument();
  const guide = within(ready).getByRole("link", {
    name: "Connect a headless Client (opens in a new tab)",
  });
  expect(guide).toHaveAttribute("href", "/documentation/connect-headless-client");
  expect(guide).toHaveAttribute("target", "_blank");
  expect(within(ready).getByText("ol_once_only")).toBeInTheDocument();
  await user.click(within(ready).getByRole("button", { name: "Copy" }));
  expect(await navigator.clipboard.readText()).toBe("ol_once_only");
  await user.click(within(ready).getByRole("button", { name: "Done" }));
  await user.click(screen.getByRole("button", { name: "Revoke" }));
  await user.click(
    within(screen.getByRole("dialog", { name: "Revoke API key" })).getByRole("button", {
      name: "Revoke",
    }),
  );
  await waitFor(() => expect(revoked).toBe(true));
  expect(collected).toBe(1);
});
it("lets an Administrator approve and deny with an optional note on the MCP pane", async () => {
  const posted: unknown[] = [];
  stubApi({
    signedIn: {
      id: "admin",
      email: "admin@example.com",
      displayName: "Admin",
      role: "administrator",
    },
    extra: (call) => {
      if (call.url.pathname === "/api/v1/mcp-settings")
        return json(200, {
          enabled: true,
          legalApiKeysEnabled: true,
          businessApiKeysEnabled: true,
          toolsetCeiling: ["contracts"],
          readOnly: false,
          apiKeyLifetimeDays: 90,
          serverAddress: "https://legal.test/mcp",
          allowedClients: [],
          dynamicClientRegistrationEnabled: false,
        });
      if (call.url.pathname === "/api/v1/mcp-settings/api-keys")
        return json(200, [{ ...row, status: "pending", note: "For research" }]);
      if (call.url.pathname.endsWith("/approve") || call.url.pathname.endsWith("/deny")) {
        posted.push(call.body);
        return json(200, row);
      }
    },
  });
  renderAt("/settings/mcp");
  const user = userEvent.setup();
  await user.click(await screen.findByRole("button", { name: "Approve" }));
  const approve = screen.getByRole("dialog", { name: "Approve" });
  await user.type(
    within(approve).getByRole("textbox", { name: "Note (Optional)" }),
    "Use read access",
  );
  await user.click(within(approve).getByRole("button", { name: "Approve" }));
  await waitFor(() => expect(posted).toEqual([{ note: "Use read access" }]));
  await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  await user.click(screen.getByRole("button", { name: "Deny" }));
  await user.click(
    within(screen.getByRole("dialog", { name: "Deny" })).getByRole("button", { name: "Deny" }),
  );
  await waitFor(() => expect(posted).toHaveLength(2));
});

it("collects an approval when the open pane reloads its data", async () => {
  let approved = false;
  let reads = 0;
  stubApi({
    signedIn: {
      id: "person",
      email: "person@example.com",
      displayName: "Person",
      role: "legal_team_member",
    },
    extra: (call) => {
      if (call.url.pathname === "/api/v1/api-key-requests")
        return json(200, {
          policy,
          requests: [
            { ...row, status: approved ? "active" : "pending", keyAvailable: approved && !reads },
          ],
        });
      if (call.url.pathname.endsWith("/request-1")) {
        reads++;
        return json(200, { ...row, key: "ol_reload_once" });
      }
    },
  });
  const { router } = renderAt("/settings/api-keys");
  await screen.findByText("Pending approval");
  approved = true;
  await router.revalidate();
  await screen.findByRole("dialog", { name: "Your key is ready" });
  expect(reads).toBe(1);
  await router.revalidate();
  expect(screen.getByText("ol_reload_once")).toBeInTheDocument();
  expect(reads).toBe(1);
});
