// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The /contracts/:number record page (M8), through the real route table
 * with the standard fetch stub: Member+ lands on the record at its
 * number-based address, edits a field in place (DES-017 — blur commits
 * one PATCH, Escape commits none), sets the Owner, status, priority,
 * and risk from their selects, works the Team card, archives the record
 * (every input freezes, the sub-bar action flips), and restores it. The
 * activity bar mounts with the applet set that exists before M9.
 * Contributors are bounced home; unauthenticated visitors land on login.
 */

import { describe, expect, it } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { json, problem, renderAt, stubApi, type StubCall } from "../testing/helpers";

const MEMBER = {
  id: "u2",
  email: "member@example.com",
  displayName: "Nadia Counsel",
  role: "legal_team_member",
};
const CONTRIBUTOR = {
  id: "u3",
  email: "contributor@example.com",
  displayName: "Casey Contributor",
  role: "contributor",
};

/** The people the pickers offer. A Contributor is offered for the team
 * (external counsel, MTR-006) but never for the Owner. */
const PEOPLE = [
  {
    id: "u1",
    displayName: "Ada Admin",
    image: null,
    archived: false,
    role: "administrator",
  },
  {
    id: "u3",
    displayName: "Casey Contributor",
    image: null,
    archived: false,
    role: "contributor",
  },
  {
    id: "u2",
    displayName: "Nadia Counsel",
    image: null,
    archived: false,
    role: "legal_team_member",
  },
];

const OPTIONS = {
  contractTypes: [
    { id: "t-nda", slug: "nda", displayName: "NDA" },
    { id: "t-msa", slug: "msa", displayName: "MSA" },
  ],
  contractStatuses: [
    { id: "s-draft", slug: "draft", displayName: "Draft", stage: "draft" },
    { id: "s-redlining", slug: "redlining", displayName: "Redlining", stage: "review" },
    { id: "s-active", slug: "active", displayName: "Active", stage: "active" },
  ],
  users: PEOPLE,
};

/** One person as a row on the record renders them. */
function person(id: string, role?: string) {
  const found = PEOPLE.find((entry) => entry.id === id)!;
  const shape = {
    id: found.id,
    displayName: found.displayName,
    image: found.image,
    archived: found.archived,
  };
  return role === undefined ? shape : { ...shape, role };
}

function contractRow(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: "c1",
    number: 42,
    title: "Acme master services agreement",
    contractTypeId: "t-msa",
    contractTypeName: "MSA",
    statusId: "s-draft",
    statusName: "Draft",
    stage: "draft",
    // Unassigned until someone takes it (CTR-004).
    manager: null,
    priority: "medium",
    risk: null,
    description: "Three-year platform engagement.",
    archivedAt: null,
    createdAt: "2026-08-01T00:00:00.000Z",
    updatedAt: "2026-08-01T00:00:00.000Z",
    ...overrides,
  };
}

/** The record loader's two reads plus the mutations under test. The
 * record is stateful: mutations answer with the row they produce, and
 * later GETs answer the latest row. */
function recordApi(
  initial: Record<string, unknown>,
  initialTeam: Record<string, unknown>[] = [person("u1", "creator")],
) {
  let row = initial;
  let team = initialTeam;
  const patches: unknown[] = [];
  const posts: string[] = [];
  const teamCalls: string[] = [];
  const statusById = new Map(OPTIONS.contractStatuses.map((status) => [status.id, status]));
  const handler = (call: StubCall): Response | undefined => {
    if (call.url.pathname === "/api/v1/contracts/options" && call.method === "GET") {
      return json(200, OPTIONS);
    }
    if (call.url.pathname === "/api/v1/contracts/42" && call.method === "GET") {
      return json(200, { contract: row, team });
    }
    if (call.url.pathname === "/api/v1/contracts/42" && call.method === "PATCH") {
      patches.push(call.body);
      const body = call.body as Record<string, unknown>;
      const status = typeof body.statusId === "string" ? statusById.get(body.statusId) : undefined;
      const owner =
        "managerId" in body
          ? {
              manager: typeof body.managerId === "string" ? person(body.managerId) : null,
            }
          : {};
      row = {
        ...row,
        ...body,
        ...owner,
        ...(status ? { statusName: status.displayName, stage: status.stage } : {}),
      };
      // The stored FK never rides the row back — the joined person does.
      delete (row as Record<string, unknown>).managerId;
      return json(200, { contract: row });
    }
    if (call.url.pathname === "/api/v1/contracts/42/team" && call.method === "POST") {
      const body = call.body as { userId: string; role: string };
      teamCalls.push(`add ${body.userId} ${body.role}`);
      team = [...team, { ...person(body.userId), role: body.role }];
      return json(201, { team });
    }
    const removal = /^\/api\/v1\/contracts\/42\/team\/([^/]+)\/([^/]+)$/.exec(call.url.pathname);
    if (removal && call.method === "DELETE") {
      const [, userId, role] = removal;
      teamCalls.push(`remove ${userId} ${role}`);
      team = team.filter((member) => !(member.id === userId && member.role === role));
      return json(200, { team });
    }
    if (call.url.pathname === "/api/v1/contracts/42/archive" && call.method === "POST") {
      posts.push("archive");
      row = { ...row, archivedAt: "2026-08-12T00:00:00.000Z" };
      return json(200, { contract: row });
    }
    if (call.url.pathname === "/api/v1/contracts/42/restore" && call.method === "POST") {
      posts.push("restore");
      row = { ...row, archivedAt: null };
      return json(200, { contract: row });
    }
    return undefined;
  };
  return { handler, patches, posts, teamCalls };
}

describe("the /contracts/:number record page", () => {
  it("shows a Legal Team Member the record at its number-based address", async () => {
    stubApi({ signedIn: MEMBER, extra: recordApi(contractRow()).handler });
    renderAt("/contracts/42");

    expect(
      await screen.findByRole("heading", { level: 1, name: "Acme master services agreement" }),
    ).toBeInTheDocument();
    // The sub-bar carries the breadcrumb, the reference, and the status
    // pill (the nav also links to Contracts, and the status select's
    // options carry the same labels).
    const subbar = screen.getByRole("region", { name: "Acme master services agreement" });
    expect(within(subbar).getByRole("link", { name: "Contracts" })).toHaveAttribute(
      "href",
      "/contracts",
    );
    expect(within(subbar).getByText("C-42")).toBeInTheDocument();
    expect(within(subbar).getByText("Draft")).toBeInTheDocument();

    expect(screen.getByLabelText("Title")).toHaveValue("Acme master services agreement");
    expect(screen.getByLabelText("Status")).toHaveValue("s-draft");
    expect(screen.getByLabelText("Priority")).toHaveValue("medium");
    // Risk stays empty until legal assesses it (CTR-005).
    expect(screen.getByLabelText("Risk")).toHaveValue("");
    expect(screen.getByLabelText("Description")).toHaveValue("Three-year platform engagement.");
    // The type is shown, not editable here — re-typing re-checks the
    // type's required fields, which lands with the field work.
    expect(screen.getByText("MSA")).toBeInTheDocument();
  });

  it("mounts the activity bar with the applet set that exists before M9", async () => {
    stubApi({ signedIn: MEMBER, extra: recordApi(contractRow()).handler });
    renderAt("/contracts/42");

    const bar = await screen.findByRole("toolbar", { name: "Applets" });
    expect(within(bar).getByRole("link", { name: "Contract settings" })).toHaveAttribute(
      "href",
      "/settings/contracts",
    );
  });

  it("commits an edited field on blur as one PATCH (DES-017) and notes Saved", async () => {
    const api = recordApi(contractRow());
    stubApi({ signedIn: MEMBER, extra: api.handler });
    renderAt("/contracts/42");
    const user = userEvent.setup();

    const title = await screen.findByLabelText("Title");
    await user.clear(title);
    await user.type(title, "Acme MSA");
    await user.tab();

    await waitFor(() => expect(screen.getByText("Saved")).toBeInTheDocument());
    expect(api.patches).toEqual([{ title: "Acme MSA" }]);
    // The heading follows the committed title.
    expect(screen.getByRole("heading", { level: 1, name: "Acme MSA" })).toBeInTheDocument();
  });

  it("reverts an in-progress edit on Escape without a PATCH", async () => {
    const api = recordApi(contractRow());
    stubApi({ signedIn: MEMBER, extra: api.handler });
    renderAt("/contracts/42");
    const user = userEvent.setup();

    const description = await screen.findByLabelText("Description");
    await user.clear(description);
    await user.type(description, "wrong context");
    await user.keyboard("{Escape}");

    expect(description).toHaveValue("Three-year platform engagement.");
    await user.tab();
    expect(api.patches).toEqual([]);
  });

  it("changes the status to any other status, and the pill follows the new label", async () => {
    const api = recordApi(contractRow());
    stubApi({ signedIn: MEMBER, extra: api.handler });
    renderAt("/contracts/42");
    const user = userEvent.setup();

    await user.selectOptions(await screen.findByLabelText("Status"), "s-active");
    await waitFor(() => expect(api.patches).toEqual([{ statusId: "s-active" }]));
    const subbar = screen.getByRole("region", { name: "Acme master services agreement" });
    expect(within(subbar).getByText("Active")).toBeInTheDocument();

    // Backwards too — deals collapse and reopen (CTR-001).
    await user.selectOptions(screen.getByLabelText("Status"), "s-redlining");
    await waitFor(() =>
      expect(api.patches).toEqual([{ statusId: "s-active" }, { statusId: "s-redlining" }]),
    );
  });

  it("sets priority and risk from the shared severity ramp, and clears risk again", async () => {
    const api = recordApi(contractRow());
    stubApi({ signedIn: MEMBER, extra: api.handler });
    renderAt("/contracts/42");
    const user = userEvent.setup();

    await user.selectOptions(await screen.findByLabelText("Priority"), "critical");
    await waitFor(() => expect(api.patches).toEqual([{ priority: "critical" }]));

    await user.selectOptions(screen.getByLabelText("Risk"), "high");
    await waitFor(() => expect(api.patches).toEqual([{ priority: "critical" }, { risk: "high" }]));

    // Back to not-yet-assessed, which is a null, not a level.
    await user.selectOptions(screen.getByLabelText("Risk"), "");
    await waitFor(() =>
      expect(api.patches).toEqual([{ priority: "critical" }, { risk: "high" }, { risk: null }]),
    );
  });

  it("sets the Owner from the picker and clears it back to unassigned", async () => {
    const api = recordApi(contractRow());
    stubApi({ signedIn: MEMBER, extra: api.handler });
    renderAt("/contracts/42");
    const user = userEvent.setup();

    const owner = await screen.findByLabelText("Owner");
    expect(owner).toHaveValue("");
    await user.selectOptions(owner, "u2");
    await waitFor(() => expect(api.patches).toEqual([{ managerId: "u2" }]));
    // The roster follows: the Owner heads the Team card.
    const team = screen.getByRole("region", { name: "Team" });
    expect(within(team).getByText("Nadia Counsel")).toBeInTheDocument();
    expect(within(team).getByText("Owner")).toBeInTheDocument();

    await user.selectOptions(owner, "");
    await waitFor(() => expect(api.patches).toEqual([{ managerId: "u2" }, { managerId: null }]));
  });

  it("offers only Member+ people as the Owner — a Contributor cannot run a contract", async () => {
    stubApi({ signedIn: MEMBER, extra: recordApi(contractRow()).handler });
    renderAt("/contracts/42");

    const owner = (await screen.findByLabelText("Owner")) as HTMLSelectElement;
    expect([...owner.options].map((option) => option.textContent)).toEqual([
      "Unassigned",
      "Ada Admin",
      "Nadia Counsel",
    ]);
  });

  it("keeps a saved Owner the picker no longer offers selectable as themselves", async () => {
    const departed = {
      id: "u9",
      displayName: "Gone Counsel",
      image: null,
      archived: true,
    };
    stubApi({
      signedIn: MEMBER,
      extra: recordApi(contractRow({ manager: departed })).handler,
    });
    renderAt("/contracts/42");

    const owner = await screen.findByLabelText("Owner");
    expect(owner).toHaveValue("u9");
    expect(
      within(owner as HTMLElement).getByRole("option", { name: "Gone Counsel" }),
    ).toBeInTheDocument();
  });

  it("shows the API's refusal beside the field when a commit fails", async () => {
    stubApi({
      signedIn: MEMBER,
      extra: (call) => {
        if (call.url.pathname === "/api/v1/contracts/options" && call.method === "GET") {
          return json(200, OPTIONS);
        }
        if (call.url.pathname === "/api/v1/contracts/42" && call.method === "GET") {
          return json(200, { contract: contractRow(), team: [person("u1", "creator")] });
        }
        if (call.url.pathname === "/api/v1/contracts/42" && call.method === "PATCH") {
          return problem(400, "The status must be a live contract status.");
        }
        return undefined;
      },
    });
    renderAt("/contracts/42");
    const user = userEvent.setup();

    await user.selectOptions(await screen.findByLabelText("Status"), "s-active");
    expect(
      await screen.findByText("The status must be a live contract status."),
    ).toBeInTheDocument();
    // The select still shows the saved truth — nothing was adopted.
    expect(screen.getByLabelText("Status")).toHaveValue("s-draft");
  });

  it("keeps a saved status the picker no longer offers selectable as itself", async () => {
    const api = recordApi(contractRow({ statusId: "s-archived", statusName: "Superseded" }));
    stubApi({ signedIn: MEMBER, extra: api.handler });
    renderAt("/contracts/42");

    const select = await screen.findByLabelText("Status");
    expect(select).toHaveValue("s-archived");
    expect(
      within(select as HTMLElement).getByRole("option", { name: "Superseded" }),
    ).toBeInTheDocument();
  });

  it("lists the contract team, and names who made the record", async () => {
    stubApi({ signedIn: MEMBER, extra: recordApi(contractRow()).handler });
    renderAt("/contracts/42");

    const team = await screen.findByRole("region", { name: "Team" });
    expect(within(team).getByText("Ada Admin")).toBeInTheDocument();
    expect(within(team).getByText("Creator")).toBeInTheDocument();
    // Provenance is not membership: the creator has no remove control.
    expect(
      within(team).queryByRole("button", { name: /Take Ada Admin off the team/ }),
    ).not.toBeInTheDocument();
  });

  it("adds a team member through the dialog and takes one off again", async () => {
    const api = recordApi(contractRow());
    stubApi({ signedIn: MEMBER, extra: api.handler });
    renderAt("/contracts/42");
    const user = userEvent.setup();

    await user.click(await screen.findByRole("button", { name: "Add team member" }));
    await user.selectOptions(screen.getByLabelText("Person"), "u3");
    await user.selectOptions(screen.getByLabelText("Role"), "contributor");
    await user.click(screen.getByRole("button", { name: "Add" }));

    await waitFor(() => expect(api.teamCalls).toEqual(["add u3 contributor"]));
    const team = screen.getByRole("region", { name: "Team" });
    expect(within(team).getByText("Casey Contributor")).toBeInTheDocument();
    expect(within(team).getByText("Contributor")).toBeInTheDocument();

    await user.click(
      within(team).getByRole("button", {
        name: "Take Casey Contributor off the team as Contributor",
      }),
    );
    await waitFor(() =>
      expect(api.teamCalls).toEqual(["add u3 contributor", "remove u3 contributor"]),
    );
    expect(within(team).queryByText("Casey Contributor")).not.toBeInTheDocument();
  });

  it("keys a removal to the role, so a second role on the same person stands", async () => {
    const api = recordApi(contractRow(), [
      person("u1", "creator"),
      person("u2", "member"),
      person("u2", "watcher"),
    ]);
    stubApi({ signedIn: MEMBER, extra: api.handler });
    renderAt("/contracts/42");
    const user = userEvent.setup();

    const team = await screen.findByRole("region", { name: "Team" });
    await user.click(
      within(team).getByRole("button", { name: "Take Nadia Counsel off the team as Watcher" }),
    );
    await waitFor(() => expect(api.teamCalls).toEqual(["remove u2 watcher"]));
    expect(within(team).getByText("Member")).toBeInTheDocument();
    expect(within(team).queryByText("Watcher")).not.toBeInTheDocument();
  });

  it("shows the API's refusal when a team change is turned down", async () => {
    stubApi({
      signedIn: MEMBER,
      extra: (call) => {
        if (call.url.pathname === "/api/v1/contracts/options" && call.method === "GET") {
          return json(200, OPTIONS);
        }
        if (call.url.pathname === "/api/v1/contracts/42" && call.method === "GET") {
          return json(200, { contract: contractRow(), team: [person("u1", "creator")] });
        }
        if (call.url.pathname === "/api/v1/contracts/42/team" && call.method === "POST") {
          return problem(409, "This person already holds that role.");
        }
        return undefined;
      },
    });
    renderAt("/contracts/42");
    const user = userEvent.setup();

    await user.click(await screen.findByRole("button", { name: "Add team member" }));
    await user.selectOptions(screen.getByLabelText("Person"), "u2");
    await user.click(screen.getByRole("button", { name: "Add" }));
    expect(await screen.findByText("This person already holds that role.")).toBeInTheDocument();
  });

  it("archives the record — every input freezes and the action flips — then restores it", async () => {
    const api = recordApi(contractRow(), [person("u1", "creator"), person("u2", "member")]);
    stubApi({ signedIn: MEMBER, extra: api.handler });
    renderAt("/contracts/42");
    const user = userEvent.setup();

    await user.click(await screen.findByRole("button", { name: "Archive" }));
    await waitFor(() => expect(api.posts).toEqual(["archive"]));
    expect(screen.getByText(/This contract is archived/)).toBeInTheDocument();
    for (const label of ["Title", "Owner", "Status", "Priority", "Risk", "Description"]) {
      expect(screen.getByLabelText(label)).toBeDisabled();
    }
    // The team freezes with everything else.
    expect(screen.getByRole("button", { name: "Add team member" })).toBeDisabled();
    expect(
      screen.queryByRole("button", { name: /Take Nadia Counsel off the team/ }),
    ).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Restore" }));
    await waitFor(() => expect(api.posts).toEqual(["archive", "restore"]));
    expect(screen.queryByText(/This contract is archived/)).not.toBeInTheDocument();
    expect(screen.getByLabelText("Title")).toBeEnabled();
    expect(screen.getByRole("button", { name: "Archive" })).toBeInTheDocument();
  });

  it("bounces a Contributor home", async () => {
    stubApi({ signedIn: CONTRIBUTOR });
    renderAt("/contracts/42");
    expect(await screen.findByRole("heading", { level: 1, name: "Home" })).toBeInTheDocument();
  });

  it("sends an unauthenticated visitor to login", async () => {
    stubApi({ signedIn: null, needsSetup: false });
    renderAt("/contracts/42");
    expect(await screen.findByRole("heading", { name: "Sign in" })).toBeInTheDocument();
  });
});
