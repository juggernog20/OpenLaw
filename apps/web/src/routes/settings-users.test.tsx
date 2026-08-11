// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Organization · Users (#65, #66) at the route seam: the list with
 * pending invites as rows, the invite dialog, the invite-row
 * resend/revoke actions, the in-place role select, session revocation,
 * the guarded archive with its Show-archived filter, and restore
 * (SET-005). The API behaviors themselves are covered at the HTTP seam
 * in apps/api — these stubs only shape what this UI must react to.
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
    id: "u2",
    email: "casey@example.com",
    displayName: "Casey Counsel",
    role: "legal_team_member",
    status: "active",
    lastActiveAt: new Date(Date.now() - 26 * HOUR).toISOString(),
  },
  {
    id: "u3",
    email: "dana.ruiz@example.com",
    displayName: "Dana Ruiz",
    role: "legal_team_member",
    status: "invited",
    lastActiveAt: null,
  },
  {
    id: "u4",
    email: "marcus.webb@example.com",
    displayName: "Marcus Webb",
    role: "contributor",
    status: "archived",
    lastActiveAt: new Date(Date.now() - 40 * 24 * HOUR).toISOString(),
  },
];

interface UsersCalls {
  invitePosts: unknown[];
  resendPosts: string[];
  revokeDeletes: string[];
  rolePatches: { userId: string; role: string }[];
  archivePosts: string[];
  unarchivePosts: string[];
  sessionRevokes: string[];
}

function newCalls(): UsersCalls {
  return {
    invitePosts: [],
    resendPosts: [],
    revokeDeletes: [],
    rolePatches: [],
    archivePosts: [],
    unarchivePosts: [],
    sessionRevokes: [],
  };
}

/** Serves a fixed four-row list and captures the pane's writes — the
 * pane holds its own row state, so the stub never needs to mutate. */
function usersApi(calls: UsersCalls) {
  const byId = (id: string) => LISTED.find((row) => row.id === id)!;
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
      return json(200, { user: byId(resend[1]!) });
    }
    const revoke = /^\/api\/v1\/auth\/invites\/([^/]+)$/.exec(path);
    if (revoke && call.method === "DELETE") {
      calls.revokeDeletes.push(revoke[1]!);
      return new Response(null, { status: 204 });
    }
    const role = /^\/api\/v1\/users\/([^/]+)\/role$/.exec(path);
    if (role && call.method === "PATCH") {
      const body = call.body as { role: string };
      calls.rolePatches.push({ userId: role[1]!, role: body.role });
      return json(200, { user: { ...byId(role[1]!), role: body.role } });
    }
    const archive = /^\/api\/v1\/users\/([^/]+)\/archive$/.exec(path);
    if (archive && call.method === "POST") {
      calls.archivePosts.push(archive[1]!);
      return json(200, { user: { ...byId(archive[1]!), status: "archived" } });
    }
    const unarchive = /^\/api\/v1\/users\/([^/]+)\/unarchive$/.exec(path);
    if (unarchive && call.method === "POST") {
      calls.unarchivePosts.push(unarchive[1]!);
      return json(200, { user: { ...byId(unarchive[1]!), status: "active" } });
    }
    const sessions = /^\/api\/v1\/users\/([^/]+)\/revoke-sessions$/.exec(path);
    if (sessions && call.method === "POST") {
      calls.sessionRevokes.push(sessions[1]!);
      return new Response(null, { status: 204 });
    }
    return undefined;
  };
}

describe("the Users pane (#65)", () => {
  it("bounces a non-Administrator to their settings home", async () => {
    stubApi({ signedIn: MEMBER });
    renderAt("/settings/users");

    expect(await screen.findByRole("radio", { name: "Light" })).toBeChecked();
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
    // status pill, its em-dash last-active, and its two actions. Its
    // role is plain text — invites never edit roles (SET-005).
    const danaRow = screen.getByText("dana.ruiz@example.com").closest("tr")!;
    expect(within(danaRow).getByText("Invited")).toBeVisible();
    expect(within(danaRow).getByText("—")).toBeVisible();
    expect(
      within(danaRow).getByRole("button", { name: "Resend the invite to dana.ruiz@example.com" }),
    ).toBeVisible();
    expect(
      within(danaRow).getByRole("button", { name: "Revoke the invite to dana.ruiz@example.com" }),
    ).toBeVisible();
    expect(
      within(danaRow).queryByRole("button", {
        name: /change the role of dana\.ruiz@example\.com/i,
      }),
    ).not.toBeInTheDocument();

    // An active row carries the role select plus the #66 actions…
    const caseyRow = screen.getByText("casey@example.com").closest("tr")!;
    expect(
      within(caseyRow).getByRole("button", {
        name: "Legal team member — change the role of casey@example.com",
      }),
    ).toBeVisible();
    expect(
      within(caseyRow).getByRole("button", { name: "Revoke all sessions of casey@example.com" }),
    ).toBeVisible();
    expect(
      within(caseyRow).getByRole("button", { name: "Archive casey@example.com" }),
    ).toBeVisible();

    // …but your own row offers only the role select: self-archive is
    // refused and your own sessions belong to Profile.
    expect(
      within(blairRow).getByRole("button", { name: /change the role of blair@example\.com/i }),
    ).toBeVisible();
    expect(
      within(blairRow).queryByRole("button", { name: "Archive blair@example.com" }),
    ).not.toBeInTheDocument();
    expect(
      within(blairRow).queryByRole("button", {
        name: "Revoke all sessions of blair@example.com",
      }),
    ).not.toBeInTheDocument();

    // Archived users hide behind the filter, and the count skips them.
    expect(screen.queryByText("marcus.webb@example.com")).not.toBeInTheDocument();
    expect(screen.getByText("3 users")).toBeVisible();
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
    expect(screen.getByText("4 users")).toBeVisible();
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
    expect(screen.getByText("2 users")).toBeVisible();
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

  it("changes a role in place from the row's select (#66)", async () => {
    const user = userEvent.setup();
    const calls = newCalls();
    stubApi({ signedIn: ADMIN, extra: usersApi(calls) });
    renderAt("/settings/users");

    await user.click(
      await screen.findByRole("button", { name: /change the role of casey@example\.com/i }),
    );
    const menu = await screen.findByRole("menu");
    await user.click(within(menu).getByRole("menuitemradio", { name: "Contributor" }));

    await waitFor(() => expect(calls.rolePatches).toEqual([{ userId: "u2", role: "contributor" }]));
    expect(await screen.findByText("Saved")).toBeVisible();
    const caseyRow = screen.getByText("casey@example.com").closest("tr")!;
    expect(within(caseyRow).getByText("Contributor")).toBeVisible();
  });

  it("shows the API's own refusal when a role edit hits the floor (#66)", async () => {
    const user = userEvent.setup();
    const happy = usersApi(newCalls());
    stubApi({
      signedIn: ADMIN,
      extra: (call) => {
        if (call.url.pathname.endsWith("/role")) {
          return problem(409, "You cannot demote the last Administrator.");
        }
        return happy(call);
      },
    });
    renderAt("/settings/users");

    await user.click(
      await screen.findByRole("button", { name: /change the role of blair@example\.com/i }),
    );
    const menu = await screen.findByRole("menu");
    await user.click(within(menu).getByRole("menuitemradio", { name: "Contributor" }));

    // The floor's reason, verbatim — not the generic error line.
    expect(await screen.findByText("You cannot demote the last Administrator.")).toBeVisible();
    const blairRow = screen.getByText("blair@example.com").closest("tr")!;
    expect(within(blairRow).getByText("Administrator")).toBeVisible();
  });

  it("archives from the row; the row moves behind the Show-archived filter (#66)", async () => {
    const user = userEvent.setup();
    const calls = newCalls();
    stubApi({ signedIn: ADMIN, extra: usersApi(calls) });
    renderAt("/settings/users");

    await user.click(await screen.findByRole("button", { name: "Archive casey@example.com" }));

    await waitFor(() => expect(calls.archivePosts).toEqual(["u2"]));
    await waitFor(() => expect(screen.queryByText("casey@example.com")).not.toBeInTheDocument());
    expect(screen.getByText("2 users")).toBeVisible();

    // Behind the filter: the row is still there, greyed, with restore.
    await user.click(screen.getByRole("switch", { name: "Show archived" }));
    const caseyRow = (await screen.findByText("casey@example.com")).closest("tr")!;
    expect(within(caseyRow).getByText("Archived")).toBeVisible();
    expect(
      within(caseyRow).getByRole("button", { name: "Restore casey@example.com" }),
    ).toBeVisible();
    expect(screen.getByText("4 users")).toBeVisible();
  });

  it("hides archived users by default and reveals them greyed on toggle (#66)", async () => {
    const user = userEvent.setup();
    stubApi({ signedIn: ADMIN, extra: usersApi(newCalls()) });
    renderAt("/settings/users");

    await screen.findByText("blair@example.com");
    expect(screen.queryByText("marcus.webb@example.com")).not.toBeInTheDocument();

    await user.click(screen.getByRole("switch", { name: "Show archived" }));
    const marcusRow = (await screen.findByText("marcus.webb@example.com")).closest("tr")!;
    expect(within(marcusRow).getByText("Archived")).toBeVisible();
    // The reusable inactive treatment: the identity cell is greyed out.
    expect(within(marcusRow).getByText("Marcus Webb").closest("div.opacity-50")).not.toBeNull();
    // No role select and no archive/revoke actions on an archived row.
    expect(
      within(marcusRow).queryByRole("button", {
        name: /change the role of marcus\.webb@example\.com/i,
      }),
    ).not.toBeInTheDocument();
    expect(
      within(marcusRow).getByRole("button", { name: "Restore marcus.webb@example.com" }),
    ).toBeVisible();
    expect(screen.getByText("4 users")).toBeVisible();
  });

  it("restores an archived user from their row (#66)", async () => {
    const user = userEvent.setup();
    const calls = newCalls();
    stubApi({ signedIn: ADMIN, extra: usersApi(calls) });
    renderAt("/settings/users");

    await screen.findByText("blair@example.com");
    await user.click(screen.getByRole("switch", { name: "Show archived" }));
    await user.click(
      await screen.findByRole("button", { name: "Restore marcus.webb@example.com" }),
    );

    await waitFor(() => expect(calls.unarchivePosts).toEqual(["u4"]));
    const marcusRow = screen.getByText("marcus.webb@example.com").closest("tr")!;
    expect(await within(marcusRow).findByText("Active")).toBeVisible();
    expect(
      within(marcusRow).getByRole("button", { name: "Archive marcus.webb@example.com" }),
    ).toBeVisible();
  });

  it("revokes a user's sessions from their row (#66)", async () => {
    const user = userEvent.setup();
    const calls = newCalls();
    stubApi({ signedIn: ADMIN, extra: usersApi(calls) });
    renderAt("/settings/users");

    await user.click(
      await screen.findByRole("button", { name: "Revoke all sessions of casey@example.com" }),
    );

    await waitFor(() => expect(calls.sessionRevokes).toEqual(["u2"]));
    expect(await screen.findByText("Saved")).toBeVisible();
    // Revocation is not archival: the row stays exactly where it is.
    expect(screen.getByText("casey@example.com")).toBeVisible();
  });

  it("keeps the row and shows the error micro-state when an archive fails (#66)", async () => {
    const user = userEvent.setup();
    const happy = usersApi(newCalls());
    stubApi({
      signedIn: ADMIN,
      extra: (call) => {
        if (call.url.pathname.endsWith("/archive")) {
          return problem(500, "The database is unavailable.");
        }
        return happy(call);
      },
    });
    renderAt("/settings/users");

    await user.click(await screen.findByRole("button", { name: "Archive casey@example.com" }));

    expect(await screen.findByText("The database is unavailable.")).toBeVisible();
    expect(screen.getByText("casey@example.com")).toBeVisible();
  });
});
