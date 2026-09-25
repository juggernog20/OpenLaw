// SPDX-License-Identifier: AGPL-3.0-only
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { paths } from "@openlaw/api-client";
import { expect, it } from "vitest";
import { json, renderAt, stubApi } from "../testing/helpers";

type Grant =
  paths["/api/v1/oauth-grants"]["get"]["responses"][200]["content"]["application/json"][number];
const grant: Grant = {
  id: "grant-1",
  personId: "person",
  owner: "Person",
  clientName: "Claude",
  toolsets: ["contracts", "matters"],
  scope: "write",
  grantedAt: "2026-09-20T00:00:00Z",
  expiresAt: "2026-12-20T00:00:00Z",
  lastUsedAt: "2026-09-24T00:00:00Z",
};
const policy = {
  enabled: false,
  groupEnabled: false,
  toolsetCeiling: [],
  readOnly: true,
  apiKeyLifetimeDays: 90,
};
for (const [path, role] of [
  ["/settings/api-keys", "legal_team_member"],
  ["/portal/settings/api-keys", "business_user"],
] as const) {
  function setup(grants = [grant], failure = false) {
    const posts: string[] = [];
    stubApi({
      signedIn: { id: "person", email: "person@example.com", displayName: "Person", role },
      extra: (call) => {
        if (call.url.pathname === "/api/v1/api-key-requests")
          return json(200, { policy, requests: [] });
        if (call.url.pathname === "/api/v1/oauth-grants") return json(200, grants);
        if (call.url.pathname === "/api/v1/oauth-grants/grant-1/revoke" && call.method === "POST") {
          posts.push(call.url.pathname);
          if (failure) return json(500, { detail: "Disconnect failed. Try again." });
          grants = grants.filter((row) => row.id !== "grant-1");
          return json(200, { revoked: true });
        }
      },
    });
    return posts;
  }
  it(`shows Connected Clients and confirms Disconnect on ${path}`, async () => {
    const posts = setup([
      grant,
      { ...grant, id: "grant-2", clientName: "Cursor Agent", scope: "read", lastUsedAt: null },
    ]);
    const user = userEvent.setup();
    renderAt(path);
    const card = await screen.findByRole("region", { name: "Connected Clients" });
    const rows = within(card).getAllByRole("listitem");
    expect(within(rows[0]!).getByText("Claude")).toBeInTheDocument();
    expect(within(rows[0]!).getByText("CL")).toHaveAttribute("aria-hidden", "true");
    expect(within(rows[1]!).getByText("CA")).toHaveAttribute("aria-hidden", "true");
    expect(within(rows[0]!).getByText("Contracts, Matters")).toBeInTheDocument();
    expect(within(rows[0]!).getByText("Write")).toHaveClass("bg-status-warning-bg");
    expect(within(rows[0]!).getByText(/Granted Sep 20, 2026/)).toBeInTheDocument();
    expect(within(rows[0]!).getByText(/Last used Sep 24, 2026/)).toBeInTheDocument();
    expect(within(rows[1]!).getByText("Read")).toHaveClass("bg-status-info-bg");
    expect(within(rows[1]!).getByText(/Last used.*Never/)).toBeInTheDocument();
    expect(
      within(rows[1]!).getByRole("button", { name: "Disconnect Cursor Agent" }),
    ).toHaveTextContent("Disconnect");
    await user.click(within(rows[0]!).getByRole("button", { name: "Disconnect Claude" }));
    let dialog = screen.getByRole("dialog", { name: "Revoke OAuth grant" });
    expect(within(dialog).getByText(/lose access immediately/)).toBeInTheDocument();
    expect(posts).toEqual([]);
    await user.click(within(dialog).getByRole("button", { name: "Cancel" }));
    expect(posts).toEqual([]);
    expect(within(card).getByText("Claude")).toBeInTheDocument();
    await user.click(within(rows[0]!).getByRole("button", { name: "Disconnect Claude" }));
    dialog = screen.getByRole("dialog", { name: "Revoke OAuth grant" });
    await user.click(within(dialog).getByRole("button", { name: "Revoke" }));
    await waitFor(() => expect(within(card).queryByText("Claude")).not.toBeInTheDocument());
    expect(within(card).getByText("Cursor Agent")).toBeInTheDocument();
    expect(posts).toEqual(["/api/v1/oauth-grants/grant-1/revoke"]);
  });
  it(`shows where to connect in the empty card on ${path}`, async () => {
    setup([]);
    renderAt(path);
    const card = await screen.findByRole("region", { name: "Connected Clients" });
    expect(within(card).getByText("No Client is connected.")).toBeInTheDocument();
    expect(within(card).getByText(/asks to connect from inside the Client/)).toBeInTheDocument();
    expect(within(card).queryByRole("button", { name: /^Disconnect/ })).not.toBeInTheDocument();
  });
  it(`removes the last Client and keeps the empty card after reloading on ${path}`, async () => {
    setup();
    const user = userEvent.setup();
    const { router } = renderAt(path);
    const card = await screen.findByRole("region", { name: "Connected Clients" });
    await user.click(within(card).getByRole("button", { name: "Disconnect Claude" }));
    await user.click(
      within(screen.getByRole("dialog", { name: "Revoke OAuth grant" })).getByRole("button", {
        name: "Revoke",
      }),
    );
    await within(card).findByText("No Client is connected.");
    await router.revalidate();
    expect(within(card).getByText("No Client is connected.")).toBeInTheDocument();
    expect(within(card).queryByText("Claude")).not.toBeInTheDocument();
  });
  it(`keeps the Client and shows a failed Disconnect on ${path}`, async () => {
    setup([grant], true);
    const user = userEvent.setup();
    renderAt(path);
    const card = await screen.findByRole("region", { name: "Connected Clients" });
    await user.click(within(card).getByRole("button", { name: "Disconnect Claude" }));
    const dialog = screen.getByRole("dialog", { name: "Revoke OAuth grant" });
    await user.click(within(dialog).getByRole("button", { name: "Revoke" }));
    expect(await within(dialog).findByRole("alert")).toHaveTextContent(
      "Disconnect failed. Try again.",
    );
    expect(within(card).getByText("Claude")).toBeInTheDocument();
  });
}
