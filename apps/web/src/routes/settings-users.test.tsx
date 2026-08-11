// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Organization · Users (#65) at the route seam: the list with pending
 * invites as rows, the invite dialog, and the invite-row resend/revoke
 * actions (SET-005). The API behaviors themselves are covered at the
 * HTTP seam in apps/api — these stubs only shape what this UI must
 * react to.
 */

import { describe, expect, it } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { json, problem, renderAt, stubApi, type StubCall } from "../testing/helpers";

const ADMIN = {
  id: "u1",
  email: "blair@example.com",
  displayName: "Blair Wentworth",
  role: "administrator",
  theme: "light",
};

const MEMBER = {
  id: "u2",
  email: "casey@example.com",
  displayName: "Casey Counsel",
  role: "legal_team_member",
  theme: "light",
};

const HOUR = 60 * 60 * 1000;

const LISTED = [
  {
    id: "u1",
    email: "blair@example.com",
    displayName: "Blair Wentworth",
    role: "administrator",
    status: "active",
    lastActiveAt: new Date(Date.now() - 3 * HOUR).toISOString(),
  },
  {
    id: "u3",
    email: "dana.ruiz@example.com",
    displayName: "Dana Ruiz",
    role: "legal_team_member",
    status: "invited",
    lastActiveAt: null,
  },
];

interface UsersCalls {
  invitePosts: unknown[];
  resendPosts: string[];
  revokeDeletes: string[];
}

function newCalls(): UsersCalls {
  return { invitePosts: [], resendPosts: [], revokeDeletes: [] };
}

/** Serves a fixed two-row list and captures the pane's writes — the
 * pane holds its own row state, so the stub never needs to mutate. */
function usersApi(calls: UsersCalls) {
  return (call: StubCall) => {
    const path = call.url.pathname;
    if (path === "/api/v1/users" && call.method === "GET") {
      return json(200, { users: LISTED });
    }
    if (path === "/api/v1/auth/invites" && call.method === "POST") {
      calls.invitePosts.push(call.body);
      const body = call.body as { email: string; displayName: string; role: string };
      return json(201, {
        user: {
          id: "u-new",
          email: body.email,
          displayName: body.displayName,
          role: body.role,
          theme: "light",
        },
      });
    }
    const resend = /^\/api\/v1\/auth\/invites\/([^/]+)\/resend$/.exec(path);
    if (resend && call.method === "POST") {
      calls.resendPosts.push(resend[1]!);
      return json(200, { user: LISTED[1] });
    }
    const revoke = /^\/api\/v1\/auth\/invites\/([^/]+)$/.exec(path);
    if (revoke && call.method === "DELETE") {
      calls.revokeDeletes.push(revoke[1]!);
      return new Response(null, { status: 204 });
    }
    return undefined;
  };
}

describe("the Users pane (#65)", () => {
  it("bounces a non-Administrator to their settings home", async () => {
    stubApi({ signedIn: MEMBER });
    renderAt("/settings/users");

    // Landed on Profile, the settings home for everyone (#67).
    expect(await screen.findByLabelText("Full name")).toBeVisible();
    const rail = screen.getByRole("navigation", { name: "Settings sections" });
    expect(within(rail).queryByRole("link", { name: "Users" })).not.toBeInTheDocument();
  });

  it("lists every user with role, status, and last-active; the invite is a row", async () => {
    stubApi({ signedIn: ADMIN, extra: usersApi(newCalls()) });
    renderAt("/settings/users");

    const blairRow = (await screen.findByText("blair@example.com")).closest("tr")!;
    expect(within(blairRow).getByText("Administrator")).toBeVisible();
    expect(within(blairRow).getByText("Active")).toBeVisible();
    expect(within(blairRow).getByText("3h ago")).toBeVisible();

    // The pending invite renders as a row, not a fire-and-forget: its
    // status pill, its em-dash last-active, and its two actions.
    const danaRow = screen.getByText("dana.ruiz@example.com").closest("tr")!;
    expect(within(danaRow).getByText("Invited")).toBeVisible();
    expect(within(danaRow).getByText("—")).toBeVisible();
    expect(
      within(danaRow).getByRole("button", { name: "Resend the invite to dana.ruiz@example.com" }),
    ).toBeVisible();
    expect(
      within(danaRow).getByRole("button", { name: "Revoke the invite to dana.ruiz@example.com" }),
    ).toBeVisible();

    // Active rows carry no invite actions.
    expect(within(blairRow).queryByRole("button")).not.toBeInTheDocument();
    expect(screen.getByText("2 users")).toBeVisible();
  });

  it("invites a user from the dialog and the new row appears as Invited", async () => {
    const user = userEvent.setup();
    const calls = newCalls();
    stubApi({ signedIn: ADMIN, extra: usersApi(calls) });
    renderAt("/settings/users");

    await user.click(await screen.findByRole("button", { name: "Invite user" }));
    const dialog = await screen.findByRole("dialog", { name: "Invite user" });
    await user.type(within(dialog).getByLabelText("Display name"), "Noor Haddad");
    await user.type(within(dialog).getByLabelText("Email"), "noor@example.com");
    await user.click(within(dialog).getByRole("button", { name: "Contributor" }));
    await user.click(within(dialog).getByRole("button", { name: "Send invite" }));

    await waitFor(() =>
      expect(calls.invitePosts).toEqual([
        { email: "noor@example.com", displayName: "Noor Haddad", role: "contributor" },
      ]),
    );
    const noorRow = (await screen.findByText("noor@example.com")).closest("tr")!;
    expect(within(noorRow).getByText("Invited")).toBeVisible();
    expect(screen.getByText("3 users")).toBeVisible();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("keeps the dialog open with the API's refusal when the invite fails", async () => {
    const user = userEvent.setup();
    const happy = usersApi(newCalls());
    stubApi({
      signedIn: ADMIN,
      extra: (call) => {
        if (call.url.pathname === "/api/v1/auth/invites" && call.method === "POST") {
          return problem(409, "This user already exists with a different role.");
        }
        return happy(call);
      },
    });
    renderAt("/settings/users");

    await user.click(await screen.findByRole("button", { name: "Invite user" }));
    const dialog = await screen.findByRole("dialog", { name: "Invite user" });
    await user.type(within(dialog).getByLabelText("Display name"), "Dana Ruiz");
    await user.type(within(dialog).getByLabelText("Email"), "dana.ruiz@example.com");
    await user.click(within(dialog).getByRole("button", { name: "Send invite" }));

    expect(
      await within(dialog).findByText("This user already exists with a different role."),
    ).toBeVisible();
    expect(screen.getByRole("dialog", { name: "Invite user" })).toBeInTheDocument();
  });

  it("resends an invite from its row and reports the DES-017 micro-state", async () => {
    const user = userEvent.setup();
    const calls = newCalls();
    stubApi({ signedIn: ADMIN, extra: usersApi(calls) });
    renderAt("/settings/users");

    await user.click(
      await screen.findByRole("button", { name: "Resend the invite to dana.ruiz@example.com" }),
    );

    await waitFor(() => expect(calls.resendPosts).toEqual(["u3"]));
    expect(await screen.findByText("Saved")).toBeVisible();
  });

  it("shows the error micro-state when a resend fails", async () => {
    const user = userEvent.setup();
    const happy = usersApi(newCalls());
    stubApi({
      signedIn: ADMIN,
      extra: (call) => {
        if (call.url.pathname.endsWith("/resend")) {
          return problem(500, "The database is unavailable.");
        }
        return happy(call);
      },
    });
    renderAt("/settings/users");

    await user.click(
      await screen.findByRole("button", { name: "Resend the invite to dana.ruiz@example.com" }),
    );

    expect(await screen.findByText("The change could not be saved. Try again.")).toBeVisible();
    expect(screen.getByText("dana.ruiz@example.com")).toBeVisible();
  });

  it("revokes an invite from its row and the row disappears", async () => {
    const user = userEvent.setup();
    const calls = newCalls();
    stubApi({ signedIn: ADMIN, extra: usersApi(calls) });
    renderAt("/settings/users");

    await user.click(
      await screen.findByRole("button", { name: "Revoke the invite to dana.ruiz@example.com" }),
    );

    await waitFor(() => expect(calls.revokeDeletes).toEqual(["u3"]));
    await waitFor(() =>
      expect(screen.queryByText("dana.ruiz@example.com")).not.toBeInTheDocument(),
    );
    expect(screen.getByText("1 user")).toBeVisible();
  });

  it("shows the error micro-state and keeps the row when a revoke fails", async () => {
    const user = userEvent.setup();
    const happy = usersApi(newCalls());
    stubApi({
      signedIn: ADMIN,
      extra: (call) => {
        if (call.method === "DELETE") return problem(500, "The database is unavailable.");
        return happy(call);
      },
    });
    renderAt("/settings/users");

    await user.click(
      await screen.findByRole("button", { name: "Revoke the invite to dana.ruiz@example.com" }),
    );

    expect(await screen.findByText("The change could not be saved. Try again.")).toBeVisible();
    expect(screen.getByText("dana.ruiz@example.com")).toBeVisible();
  });
});
