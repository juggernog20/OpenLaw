// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Contracts · Approver groups (#231) at the route seam: the plain
 * DES-020 list-editor anatomy with the two DES-021 stretches this pane
 * takes — an unordered list (no reorder grip) and a dialog that creates
 * and edits, because a group carries a name, a description, and a member
 * list. The row's meta caption is the member count; the archive guard
 * neither reassigns nor blocks. The API behaviors themselves are covered
 * at the HTTP seam in apps/api — these stubs only shape what this UI
 * must react to.
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

const MEMBER = { ...ADMIN, id: "u2", email: "casey@example.com", role: "legal_team_member" };

/** The people the picker reads: two Member+, one Contributor, one
 * archived Legal team member. */
const USERS = [
  { id: "u1", email: "blair@example.com", displayName: "Blair Wentworth", role: "administrator" },
  {
    id: "u2",
    email: "casey@example.com",
    displayName: "Casey Counsel",
    role: "legal_team_member",
  },
  {
    id: "u3",
    email: "robin@example.com",
    displayName: "Robin Procurement",
    role: "contributor",
  },
  { id: "u4", email: "sam@example.com", displayName: "Sam Gone", role: "legal_team_member" },
].map((user) => ({
  ...user,
  status: user.id === "u4" ? "archived" : "active",
  lastActiveAt: null,
}));

interface StubMember {
  id: string;
  displayName: string;
  email: string;
}

interface StubGroup {
  id: string;
  name: string;
  description: string | null;
  archivedAt: string | null;
  members: StubMember[];
  memberCount: number;
}

function group(
  id: string,
  name: string,
  members: StubMember[],
  overrides: Partial<StubGroup> = {},
): StubGroup {
  return {
    id,
    name,
    description: null,
    archivedAt: null,
    members,
    memberCount: members.length,
    ...overrides,
  };
}

const BLAIR = { id: "u1", displayName: "Blair Wentworth", email: "blair@example.com" };
const CASEY = { id: "u2", displayName: "Casey Counsel", email: "casey@example.com" };

function seededGroups(archivedIds: string[] = []): StubGroup[] {
  return [
    group("g1", "Commercial sign-off", [BLAIR, CASEY], {
      description: "GC plus CFO on every commercial paper.",
    }),
    group("g2", "Data protection", [CASEY]),
    group("g3", "Empty for now", []),
  ].map((row) =>
    archivedIds.includes(row.id) ? { ...row, archivedAt: "2026-08-14T12:00:00.000Z" } : row,
  );
}

interface GroupCalls {
  creates: unknown[];
  patches: { id: string; body: unknown }[];
  members: { id: string; body: unknown }[];
  archives: string[];
  restores: string[];
}

function newCalls(): GroupCalls {
  return { creates: [], patches: [], members: [], archives: [], restores: [] };
}

/** Serves the seeded groups and the user list, and captures the pane's
 * writes — the pane holds its own row state, so the stub never mutates. */
function groupsApi(calls: GroupCalls, rows = seededGroups()) {
  const byId = (id: string) => rows.find((row) => row.id === id)!;
  return (call: StubCall): Response | undefined => {
    const path = call.url.pathname;
    if (path === "/api/v1/users" && call.method === "GET") {
      return json(200, { users: USERS });
    }
    if (path === "/api/v1/approver-groups" && call.method === "GET") {
      return json(200, { approverGroups: rows });
    }
    if (path === "/api/v1/approver-groups" && call.method === "POST") {
      calls.creates.push(call.body);
      const body = call.body as { name: string; description?: string; memberIds?: string[] };
      const members = (body.memberIds ?? []).map((id) =>
        [BLAIR, CASEY].find((person) => person.id === id)!,
      );
      return json(201, {
        approverGroup: group("g-new", body.name, members, {
          description: body.description ?? null,
        }),
      });
    }
    const patch = /^\/api\/v1\/approver-groups\/([^/]+)$/.exec(path);
    if (patch && call.method === "PATCH") {
      calls.patches.push({ id: patch[1]!, body: call.body });
      return json(200, { approverGroup: { ...byId(patch[1]!), ...(call.body as object) } });
    }
    const setMembers = /^\/api\/v1\/approver-groups\/([^/]+)\/members$/.exec(path);
    if (setMembers && call.method === "PUT") {
      calls.members.push({ id: setMembers[1]!, body: call.body });
      const body = call.body as { memberIds: string[] };
      const members = body.memberIds.map((id) =>
        [BLAIR, CASEY].find((person) => person.id === id)!,
      );
      return json(200, {
        approverGroup: { ...byId(setMembers[1]!), members, memberCount: members.length },
      });
    }
    const archive = /^\/api\/v1\/approver-groups\/([^/]+)\/archive$/.exec(path);
    if (archive && call.method === "POST") {
      calls.archives.push(archive[1]!);
      return json(200, {
        approverGroup: { ...byId(archive[1]!), archivedAt: "2026-08-15T09:00:00.000Z" },
      });
    }
    const restore = /^\/api\/v1\/approver-groups\/([^/]+)\/restore$/.exec(path);
    if (restore && call.method === "POST") {
      calls.restores.push(restore[1]!);
      return json(200, { approverGroup: { ...byId(restore[1]!), archivedAt: null } });
    }
    return undefined;
  };
}

/** The pane's own row list — the editor dialog draws a second list. */
const groupList = () => screen.getAllByRole("list")[0]!;

describe("the SET-002 gate on the pane", () => {
  it("bounces a Legal Team Member off the URL", async () => {
    stubApi({ signedIn: MEMBER });
    renderAt("/settings/contracts/approver-groups");
    expect(await screen.findByRole("heading", { name: "Profile" })).toBeInTheDocument();
  });
});

describe("the Contracts section tabs", () => {
  it("marks Approver groups current alongside the three earlier panes", async () => {
    stubApi({ signedIn: ADMIN, extra: groupsApi(newCalls()) });
    renderAt("/settings/contracts/approver-groups");
    await screen.findByRole("button", { name: "Rename Commercial sign-off" });
    const tabs = screen.getByRole("navigation", { name: "Contracts panes" });
    expect(within(tabs).getByRole("link", { name: "Approver groups" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    for (const name of ["Types", "Statuses", "Fields"]) {
      expect(within(tabs).getByRole("link", { name })).toBeInTheDocument();
    }
  });
});

describe("the list (DES-020 rows with a member count)", () => {
  it("renders each group with its member count and no reorder grip", async () => {
    stubApi({ signedIn: ADMIN, extra: groupsApi(newCalls()) });
    renderAt("/settings/contracts/approver-groups");
    await screen.findByRole("button", { name: "Rename Commercial sign-off" });

    const items = within(groupList()).getAllByRole("listitem");
    expect(
      items.map((item) => within(item).getByRole("button", { name: /^Rename/ }).textContent),
    ).toEqual(["Commercial sign-off", "Data protection", "Empty for now"]);
    expect(within(items[0]!).getByText("2 members")).toBeInTheDocument();
    expect(within(items[1]!).getByText("1 member")).toBeInTheDocument();
    expect(within(items[2]!).getByText("0 members")).toBeInTheDocument();

    expect(screen.getByText("3 groups")).toBeInTheDocument();
    // The list is unordered (DES-021): no grips.
    expect(screen.queryByRole("button", { name: /^Reorder/ })).not.toBeInTheDocument();
    expect(
      screen.getByText(/Only Administrators and Legal team members can be group members\./),
    ).toBeInTheDocument();
  });
});

describe("in-place rename (DES-017)", () => {
  it("commits the name only", async () => {
    const calls = newCalls();
    stubApi({ signedIn: ADMIN, extra: groupsApi(calls) });
    renderAt("/settings/contracts/approver-groups");
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Rename Data protection" }));
    const input = screen.getByRole("textbox", { name: "Rename Data protection" });
    await user.clear(input);
    await user.type(input, "Privacy sign-off{Enter}");
    await waitFor(() =>
      expect(calls.patches).toEqual([{ id: "g2", body: { name: "Privacy sign-off" } }]),
    );
    expect(await screen.findByText("Saved")).toBeInTheDocument();
  });
});

describe("create (the group-editor dialog)", () => {
  it("creates a group with a description and its starting members", async () => {
    const calls = newCalls();
    stubApi({ signedIn: ADMIN, extra: groupsApi(calls) });
    renderAt("/settings/contracts/approver-groups");
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Add group" }));

    const dialog = await screen.findByRole("dialog", { name: "Add approver group" });
    await user.type(within(dialog).getByRole("textbox", { name: "Name" }), "Finance sign-off");
    await user.type(
      within(dialog).getByRole("textbox", { name: "Description" }),
      "Anything over budget.",
    );
    await user.click(within(dialog).getByRole("checkbox", { name: /Casey Counsel/ }));
    await user.click(within(dialog).getByRole("button", { name: "Add group" }));

    await waitFor(() =>
      expect(calls.creates).toEqual([
        {
          name: "Finance sign-off",
          description: "Anything over budget.",
          memberIds: ["u2"],
        },
      ]),
    );
    expect(
      await screen.findByRole("button", { name: "Rename Finance sign-off" }),
    ).toBeInTheDocument();
    expect(screen.getByText("4 groups")).toBeInTheDocument();
    // The new row lands where a reload would put it: the API answers in
    // name order, so Finance follows Empty for now.
    expect(
      within(groupList())
        .getAllByRole("listitem")
        .map((item) => within(item).getByRole("button", { name: /^Rename/ }).textContent),
    ).toEqual(["Commercial sign-off", "Data protection", "Empty for now", "Finance sign-off"]);
  });

  it("offers Member+ people only, and refuses a nameless group", async () => {
    const calls = newCalls();
    stubApi({ signedIn: ADMIN, extra: groupsApi(calls) });
    renderAt("/settings/contracts/approver-groups");
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Add group" }));
    const dialog = await screen.findByRole("dialog", { name: "Add approver group" });

    expect(within(dialog).getByRole("checkbox", { name: /Blair Wentworth/ })).toBeInTheDocument();
    expect(within(dialog).getByRole("checkbox", { name: /Casey Counsel/ })).toBeInTheDocument();
    // A Contributor never approves; an archived person never appears.
    expect(
      within(dialog).queryByRole("checkbox", { name: /Robin Procurement/ }),
    ).not.toBeInTheDocument();
    expect(within(dialog).queryByRole("checkbox", { name: /Sam Gone/ })).not.toBeInTheDocument();

    await user.click(within(dialog).getByRole("button", { name: "Add group" }));
    expect(await within(dialog).findByRole("alert")).toHaveTextContent("Name the group.");
    expect(calls.creates).toEqual([]);
  });
});

describe("edit (name, description, and the member list)", () => {
  it("patches the identity and puts the members in one save", async () => {
    const calls = newCalls();
    stubApi({ signedIn: ADMIN, extra: groupsApi(calls) });
    renderAt("/settings/contracts/approver-groups");
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Edit Commercial sign-off" }));

    const dialog = await screen.findByRole("dialog", { name: "Edit Commercial sign-off" });
    expect(within(dialog).getByRole("textbox", { name: "Description" })).toHaveValue(
      "GC plus CFO on every commercial paper.",
    );
    // The current members arrive checked.
    expect(within(dialog).getByRole("checkbox", { name: /Blair Wentworth/ })).toBeChecked();
    expect(within(dialog).getByRole("checkbox", { name: /Casey Counsel/ })).toBeChecked();

    await user.clear(within(dialog).getByRole("textbox", { name: "Description" }));
    await user.type(
      within(dialog).getByRole("textbox", { name: "Description" }),
      "GC only, for now.",
    );
    await user.click(within(dialog).getByRole("checkbox", { name: /Casey Counsel/ }));
    await user.click(within(dialog).getByRole("button", { name: "Save" }));

    await waitFor(() =>
      expect(calls.patches).toEqual([{ id: "g1", body: { description: "GC only, for now." } }]),
    );
    expect(calls.members).toEqual([{ id: "g1", body: { memberIds: ["u1"] } }]);
    // The row's meta caption follows the new list.
    const row = screen.getByRole("button", { name: "Rename Commercial sign-off" }).closest("li")!;
    await waitFor(() => expect(within(row).getByText("1 member")).toBeInTheDocument());
  });

  it("writes nothing when the dialog is saved unchanged", async () => {
    const calls = newCalls();
    stubApi({ signedIn: ADMIN, extra: groupsApi(calls) });
    renderAt("/settings/contracts/approver-groups");
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Edit Data protection" }));
    const dialog = await screen.findByRole("dialog", { name: "Edit Data protection" });
    await user.click(within(dialog).getByRole("button", { name: "Save" }));
    await waitFor(() =>
      expect(
        screen.queryByRole("dialog", { name: "Edit Data protection" }),
      ).not.toBeInTheDocument(),
    );
    expect(calls.patches).toEqual([]);
    expect(calls.members).toEqual([]);
  });

  it("keeps a member who can no longer approve, flagged rather than dropped", async () => {
    const calls = newCalls();
    const rows = seededGroups().map((row) =>
      row.id === "g2"
        ? group("g2", "Data protection", [
            CASEY,
            { id: "u4", displayName: "Sam Gone", email: "sam@example.com" },
          ])
        : row,
    );
    stubApi({ signedIn: ADMIN, extra: groupsApi(calls, rows) });
    renderAt("/settings/contracts/approver-groups");
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Edit Data protection" }));
    const dialog = await screen.findByRole("dialog", { name: "Edit Data protection" });
    expect(within(dialog).getByRole("checkbox", { name: /Sam Gone/ })).toBeChecked();
    expect(within(dialog).getByText("Can no longer approve")).toBeInTheDocument();
  });

  it("surfaces the server's membership refusal in the dialog", async () => {
    const calls = newCalls();
    stubApi({
      signedIn: ADMIN,
      extra: (call) => {
        if (/\/members$/.exec(call.url.pathname) && call.method === "PUT") {
          return problem(422, "Sam Gone is archived and can't be a group member.");
        }
        return groupsApi(calls)(call);
      },
    });
    renderAt("/settings/contracts/approver-groups");
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Edit Empty for now" }));
    const dialog = await screen.findByRole("dialog", { name: "Edit Empty for now" });
    await user.click(within(dialog).getByRole("checkbox", { name: /Casey Counsel/ }));
    await user.click(within(dialog).getByRole("button", { name: "Save" }));
    expect(await within(dialog).findByRole("alert")).toHaveTextContent(
      "Sam Gone is archived and can't be a group member.",
    );
  });
});

describe("the archive guard (snapshot, never reassignment)", () => {
  it("archives through a modal that offers no reassignment", async () => {
    const calls = newCalls();
    stubApi({ signedIn: ADMIN, extra: groupsApi(calls) });
    renderAt("/settings/contracts/approver-groups");
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Archive Commercial sign-off" }));

    const dialog = await screen.findByRole("dialog", { name: "Archive Commercial sign-off" });
    expect(
      within(dialog).getByText(
        "Commercial sign-off leaves the apply picker. Its 2 members are kept, and " +
          "approvals already requested from the group are untouched.",
      ),
    ).toBeInTheDocument();
    expect(within(dialog).queryByRole("combobox")).not.toBeInTheDocument();
    expect(
      within(dialog).getByText("The change applies immediately and is recorded in the audit log."),
    ).toBeInTheDocument();

    await user.click(within(dialog).getByRole("button", { name: "Archive group" }));
    await waitFor(() => expect(calls.archives).toEqual(["g1"]));
    await waitFor(() =>
      expect(
        screen.queryByRole("button", { name: "Rename Commercial sign-off" }),
      ).not.toBeInTheDocument(),
    );
    expect(screen.getByText("2 groups")).toBeInTheDocument();
  });

  it("states the empty case without a count", async () => {
    stubApi({ signedIn: ADMIN, extra: groupsApi(newCalls()) });
    renderAt("/settings/contracts/approver-groups");
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Archive Empty for now" }));
    const dialog = await screen.findByRole("dialog", { name: "Archive Empty for now" });
    expect(
      within(dialog).getByText(
        "Empty for now leaves the apply picker. It has no members, and it can be restored.",
      ),
    ).toBeInTheDocument();
  });

  it("reveals archived rows greyed with a pill and restores them", async () => {
    const calls = newCalls();
    stubApi({ signedIn: ADMIN, extra: groupsApi(calls, seededGroups(["g2"])) });
    renderAt("/settings/contracts/approver-groups");
    const user = userEvent.setup();
    await screen.findByRole("button", { name: "Rename Commercial sign-off" });
    expect(screen.queryByText("Data protection")).not.toBeInTheDocument();

    await user.click(screen.getByRole("switch", { name: "Show archived" }));
    const row = screen.getByText("Data protection").closest("li")!;
    expect(within(row).getByText("Archived")).toBeInTheDocument();
    // Archived rows offer restore only — no edit.
    expect(within(row).queryByRole("button", { name: /^Edit/ })).not.toBeInTheDocument();

    await user.click(within(row).getByRole("button", { name: "Restore Data protection" }));
    await waitFor(() => expect(calls.restores).toEqual(["g2"]));
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Rename Data protection" })).toBeInTheDocument(),
    );
  });
});
