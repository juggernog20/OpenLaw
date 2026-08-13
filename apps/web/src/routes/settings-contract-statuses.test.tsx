// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Contracts · Statuses (#82) at the route seam: the DES-020 list-editor
 * extended with the ST10 stage badges, the creation-time stage picker,
 * the three system-protected rows, and the blocking archive guard — no
 * reassignment, ever (SET-003 structural minimums). The API behaviors
 * themselves are covered at the HTTP seam in apps/api — these stubs
 * only shape what this UI must react to.
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

/** The CTR-001 seeds: id, slug, display name, stage, in display order. */
const SEEDS = [
  ["s1", "draft", "Draft", "draft"],
  ["s2", "internal_review", "Internal review", "review"],
  ["s3", "redlining", "Redlining with counterparty", "review"],
  ["s4", "awaiting_approval", "Awaiting approval", "approval"],
  ["s5", "out_for_signature", "Out for signature", "signature"],
  ["s6", "active", "Active", "active"],
  ["s7", "expired", "Expired", "ended"],
  ["s8", "terminated", "Terminated", "ended"],
] as const;

function seededStatuses(archivedSlugs: string[] = []) {
  return SEEDS.map(([id, slug, displayName, stage], index) => ({
    id,
    slug,
    displayName,
    stage,
    displayOrder: index + 1,
    isSystemDefault: true,
    archivedAt: archivedSlugs.includes(slug) ? "2026-08-10T12:00:00.000Z" : null,
    inUseCount: 0,
  }));
}

interface StatusCalls {
  creates: unknown[];
  renames: { id: string; body: unknown }[];
  orders: unknown[];
  archives: string[];
  restores: string[];
}

function newCalls(): StatusCalls {
  return { creates: [], renames: [], orders: [], archives: [], restores: [] };
}

/** Serves the seeded list and captures the pane's writes — the pane
 * holds its own row state, so the stub never needs to mutate. */
function statusesApi(calls: StatusCalls, rows = seededStatuses()) {
  const byId = (id: string) => rows.find((row) => row.id === id)!;
  return (call: StubCall): Response | undefined => {
    const path = call.url.pathname;
    if (path === "/api/v1/contract-statuses" && call.method === "GET") {
      return json(200, { contractStatuses: rows });
    }
    if (path === "/api/v1/contract-statuses" && call.method === "POST") {
      calls.creates.push(call.body);
      const body = call.body as { displayName: string; stage: string };
      return json(201, {
        contractStatus: {
          id: "s-new",
          slug: "on_hold",
          displayName: body.displayName,
          stage: body.stage,
          displayOrder: rows.length + 1,
          isSystemDefault: false,
          archivedAt: null,
          inUseCount: 0,
        },
      });
    }
    const rename = /^\/api\/v1\/contract-statuses\/([^/]+)$/.exec(path);
    if (rename && call.method === "PATCH") {
      calls.renames.push({ id: rename[1]!, body: call.body });
      const body = call.body as { displayName: string };
      return json(200, {
        contractStatus: { ...byId(rename[1]!), displayName: body.displayName },
      });
    }
    if (path === "/api/v1/contract-statuses/order" && call.method === "PUT") {
      calls.orders.push(call.body);
      const { ids } = call.body as { ids: string[] };
      return json(200, {
        contractStatuses: ids.map((id, index) => ({ ...byId(id), displayOrder: index + 1 })),
      });
    }
    const archive = /^\/api\/v1\/contract-statuses\/([^/]+)\/archive$/.exec(path);
    if (archive && call.method === "POST") {
      calls.archives.push(archive[1]!);
      return json(200, {
        contractStatus: { ...byId(archive[1]!), archivedAt: "2026-08-11T09:00:00.000Z" },
      });
    }
    const restore = /^\/api\/v1\/contract-statuses\/([^/]+)\/restore$/.exec(path);
    if (restore && call.method === "POST") {
      calls.restores.push(restore[1]!);
      return json(200, {
        contractStatus: { ...byId(restore[1]!), archivedAt: null, displayOrder: rows.length + 1 },
      });
    }
    return undefined;
  };
}

const statusList = () => screen.getByRole("list");

/** Matches the stage badge by its full accessible text ("Stage: Draft"),
 * which spans the sr-only prefix and the visible label — no single text
 * node carries it, so the default matcher can't. */
const stageBadge = (text: string) => (_: string, element: Element | null) =>
  element?.textContent === text;

describe("the SET-002 gate on the pane", () => {
  it("bounces a Legal Team Member off the URL", async () => {
    stubApi({ signedIn: MEMBER });
    renderAt("/settings/contracts/statuses");
    expect(await screen.findByRole("heading", { name: "Profile" })).toBeInTheDocument();
  });
});

describe("the Contracts section tabs", () => {
  it("marks Statuses current and routes back to Types", async () => {
    stubApi({ signedIn: ADMIN, extra: statusesApi(newCalls()) });
    const { router } = renderAt("/settings/contracts/statuses");
    await screen.findByText("Internal review");
    const tabs = screen.getByRole("navigation", { name: "Contracts panes" });
    expect(within(tabs).getByRole("link", { name: "Statuses" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    const user = userEvent.setup();
    await user.click(within(tabs).getByRole("link", { name: "Types" }));
    await waitFor(() => expect(router.state.location.pathname).toBe("/settings/contracts/types"));
  });
});

describe("the seeded list (CTR-001)", () => {
  it("renders the eight statuses in display order, each with its stage badge", async () => {
    stubApi({ signedIn: ADMIN, extra: statusesApi(newCalls()) });
    renderAt("/settings/contracts/statuses");
    await screen.findByText("Internal review");
    const items = within(statusList()).getAllByRole("listitem");
    expect(
      items.map((item) => within(item).getByRole("button", { name: /^Rename/ }).textContent),
    ).toEqual([
      "Draft",
      "Internal review",
      "Redlining with counterparty",
      "Awaiting approval",
      "Out for signature",
      "Active",
      "Expired",
      "Terminated",
    ]);
    // The stage badge sits in the DES-020 qualifier-pill slot.
    const badges = [
      "Draft",
      "Review",
      "Review",
      "Approval",
      "Signature",
      "Active",
      "Ended",
      "Ended",
    ];
    for (const [index, badge] of badges.entries()) {
      // The sr-only "Stage:" prefix is what keeps a Draft/Draft row
      // unambiguous — to a reader and to this query alike.
      expect(
        within(items[index]!).getByText(stageBadge(`Stage: ${badge}`)),
        `row ${index}`,
      ).toBeInTheDocument();
    }
    expect(within(items[0]!).getByText("0 contracts")).toBeInTheDocument();
    expect(screen.getByText("8 statuses")).toBeInTheDocument();
  });

  it("locks Draft, Active, and Expired: no archive action, a labelled lock instead", async () => {
    stubApi({ signedIn: ADMIN, extra: statusesApi(newCalls()) });
    renderAt("/settings/contracts/statuses");
    await screen.findByText("Internal review");
    const items = within(statusList()).getAllByRole("listitem");
    for (const [index, name] of [
      [0, "Draft"],
      [5, "Active"],
      [6, "Expired"],
    ] as const) {
      const row = items[index]!;
      expect(within(row).queryByRole("button", { name: /^Archive/ })).not.toBeInTheDocument();
      expect(
        within(row).getByRole("img", {
          name: `${name} is system-protected and can't be archived`,
        }),
      ).toBeInTheDocument();
    }
    // Unprotected rows keep their archive action.
    expect(
      within(items[7]!).getByRole("button", { name: "Archive Terminated" }),
    ).toBeInTheDocument();
  });
});

describe("in-place rename (DES-017)", () => {
  it("commits the display name only — the stage never rides along", async () => {
    const calls = newCalls();
    stubApi({ signedIn: ADMIN, extra: statusesApi(calls) });
    renderAt("/settings/contracts/statuses");
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Rename Terminated" }));
    const input = screen.getByRole("textbox", { name: "Rename Terminated" });
    await user.clear(input);
    await user.type(input, "Ended early{Enter}");
    await waitFor(() =>
      expect(calls.renames).toEqual([{ id: "s8", body: { displayName: "Ended early" } }]),
    );
    expect(await screen.findByText("Saved")).toBeInTheDocument();
    // The stage badge survives the rename untouched.
    const row = screen.getByRole("button", { name: "Rename Ended early" }).closest("li")!;
    expect(within(row).getByText(stageBadge("Stage: Ended"))).toBeInTheDocument();
  });

  it("reverts on Escape without a request", async () => {
    const calls = newCalls();
    stubApi({ signedIn: ADMIN, extra: statusesApi(calls) });
    renderAt("/settings/contracts/statuses");
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Rename Terminated" }));
    await user.type(screen.getByRole("textbox", { name: "Rename Terminated" }), "X{Escape}");
    expect(screen.getByRole("button", { name: "Rename Terminated" })).toBeInTheDocument();
    expect(calls.renames).toEqual([]);
  });
});

describe("add (the inline draft row, with the stage picked at creation)", () => {
  it("creates on Enter once a name is typed and a stage is picked", async () => {
    const calls = newCalls();
    stubApi({ signedIn: ADMIN, extra: statusesApi(calls) });
    renderAt("/settings/contracts/statuses");
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Add status" }));
    await user.type(screen.getByRole("textbox", { name: "New status name" }), "On hold");
    await user.selectOptions(screen.getByRole("combobox", { name: "New status stage" }), "review");
    await user.type(screen.getByRole("textbox", { name: "New status name" }), "{Enter}");
    await waitFor(() =>
      expect(calls.creates).toEqual([{ displayName: "On hold", stage: "review" }]),
    );
    expect(await screen.findByRole("button", { name: "Rename On hold" })).toBeInTheDocument();
    expect(screen.getByText("9 statuses")).toBeInTheDocument();
  });

  it("refuses to create without a stage, keeping the draft row open", async () => {
    const calls = newCalls();
    stubApi({ signedIn: ADMIN, extra: statusesApi(calls) });
    renderAt("/settings/contracts/statuses");
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Add status" }));
    await user.type(screen.getByRole("textbox", { name: "New status name" }), "On hold{Enter}");
    expect(await screen.findByText("Pick a stage for the new status.")).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "New status name" })).toHaveValue("On hold");
    expect(calls.creates).toEqual([]);
    // Picking a stage answers the refusal, so it clears.
    await user.selectOptions(screen.getByRole("combobox", { name: "New status stage" }), "review");
    expect(screen.queryByText("Pick a stage for the new status.")).not.toBeInTheDocument();
  });

  it("discards on Escape without a request", async () => {
    const calls = newCalls();
    stubApi({ signedIn: ADMIN, extra: statusesApi(calls) });
    renderAt("/settings/contracts/statuses");
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Add status" }));
    await user.type(screen.getByRole("textbox", { name: "New status name" }), "Nope{Escape}");
    expect(screen.queryByRole("textbox", { name: "New status name" })).not.toBeInTheDocument();
    expect(calls.creates).toEqual([]);
  });
});

describe("reorder (DES-020's keyboard path)", () => {
  it("moves a row one position per arrow press and commits the permutation", async () => {
    const calls = newCalls();
    stubApi({ signedIn: ADMIN, extra: statusesApi(calls) });
    renderAt("/settings/contracts/statuses");
    const user = userEvent.setup();
    const grip = await screen.findByRole("button", { name: /^Reorder Draft, position 1 of 8/ });
    grip.focus();
    await user.keyboard("{ArrowDown}");
    await waitFor(() =>
      expect(calls.orders).toEqual([{ ids: ["s2", "s1", "s3", "s4", "s5", "s6", "s7", "s8"] }]),
    );
    const items = within(statusList()).getAllByRole("listitem");
    expect(
      within(items[0]!).getByRole("button", { name: "Rename Internal review" }),
    ).toBeInTheDocument();
    expect(within(items[1]!).getByRole("button", { name: "Rename Draft" })).toBeInTheDocument();
  });
});

describe("the archive guard (SET-003: block, never reassign)", () => {
  it("archives through the modal with no reassignment affordance", async () => {
    const calls = newCalls();
    stubApi({ signedIn: ADMIN, extra: statusesApi(calls) });
    renderAt("/settings/contracts/statuses");
    const user = userEvent.setup();
    // `ended` still holds Expired, so Terminated archives freely.
    await user.click(await screen.findByRole("button", { name: "Archive Terminated" }));

    const dialog = await screen.findByRole("dialog", { name: "Archive Terminated" });
    expect(
      within(dialog).getByText("Terminated is not used by any contracts."),
    ).toBeInTheDocument();
    // Statuses block at structural minimums instead of reassigning:
    // the modal never renders a reassignment select.
    expect(within(dialog).queryByRole("combobox")).not.toBeInTheDocument();
    expect(
      within(dialog).getByText("The change applies immediately and is recorded in the audit log."),
    ).toBeInTheDocument();

    await user.click(within(dialog).getByRole("button", { name: "Archive status" }));
    await waitFor(() => expect(calls.archives).toEqual(["s8"]));
    await waitFor(() =>
      expect(screen.queryByRole("button", { name: "Rename Terminated" })).not.toBeInTheDocument(),
    );
    expect(screen.getByRole("switch", { name: "Show archived" })).toBeInTheDocument();
    expect(screen.getByText("7 statuses")).toBeInTheDocument();
  });

  it("blocks the last unarchived status of a stage with the reason, CTA disabled", async () => {
    const calls = newCalls();
    stubApi({ signedIn: ADMIN, extra: statusesApi(calls) });
    renderAt("/settings/contracts/statuses");
    const user = userEvent.setup();
    // `awaiting_approval` is approval's only status.
    await user.click(await screen.findByRole("button", { name: "Archive Awaiting approval" }));
    const dialog = await screen.findByRole("dialog", { name: "Archive Awaiting approval" });
    expect(
      within(dialog).getByText(
        "Awaiting approval is the last unarchived status in its stage — every stage keeps " +
          "at least one. Add another status to the stage first.",
      ),
    ).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "Archive status" })).toBeDisabled();
    expect(calls.archives).toEqual([]);
  });

  it("shows the server's own refusal sentence in the modal", async () => {
    const calls = newCalls();
    stubApi({
      signedIn: ADMIN,
      extra: (call) => {
        if (/\/archive$/.exec(call.url.pathname) && call.method === "POST") {
          return problem(409, "This contract status is already archived.");
        }
        return statusesApi(calls)(call);
      },
    });
    renderAt("/settings/contracts/statuses");
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Archive Terminated" }));
    const dialog = await screen.findByRole("dialog", { name: "Archive Terminated" });
    await user.click(within(dialog).getByRole("button", { name: "Archive status" }));
    expect(await within(dialog).findByRole("alert")).toHaveTextContent(
      "This contract status is already archived.",
    );
  });

  it("reveals archived rows greyed with a pill and restores them", async () => {
    const calls = newCalls();
    stubApi({ signedIn: ADMIN, extra: statusesApi(calls, seededStatuses(["terminated"])) });
    renderAt("/settings/contracts/statuses");
    const user = userEvent.setup();
    await screen.findByText("Internal review");
    expect(screen.queryByText("Terminated")).not.toBeInTheDocument();

    await user.click(screen.getByRole("switch", { name: "Show archived" }));
    const row = screen.getByText("Terminated").closest("li")!;
    expect(within(row).getByText("Archived")).toBeInTheDocument();

    await user.click(within(row).getByRole("button", { name: "Restore Terminated" }));
    await waitFor(() => expect(calls.restores).toEqual(["s8"]));
    await waitFor(() => {
      const items = within(statusList()).getAllByRole("listitem");
      expect(within(items.at(-1)!).getByText("Terminated")).toBeInTheDocument();
    });
  });
});

describe("the SET-003 in-use block with live counts (#113)", () => {
  /** Terminated carries a real contract count — the guard is armed. */
  function statusesInUse() {
    return seededStatuses().map((row) =>
      row.slug === "terminated" ? { ...row, inUseCount: 5 } : row,
    );
  }

  it("shows the live usage count on the row", async () => {
    stubApi({ signedIn: ADMIN, extra: statusesApi(newCalls(), statusesInUse()) });
    renderAt("/settings/contracts/statuses");
    await screen.findByText("Terminated");
    const rows = within(statusList()).getAllByRole("listitem");
    const terminatedRow = rows.find((row) => within(row).queryByText("Terminated"))!;
    expect(within(terminatedRow).getByText("5 contracts")).toBeInTheDocument();
  });

  it("blocks an in-use status with the count, CTA disabled and no reassignment", async () => {
    const calls = newCalls();
    stubApi({ signedIn: ADMIN, extra: statusesApi(calls, statusesInUse()) });
    renderAt("/settings/contracts/statuses");
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Archive Terminated" }));

    const dialog = await screen.findByRole("dialog", { name: "Archive Terminated" });
    expect(
      within(dialog).getByText(
        "Terminated is the status of 5 contracts. Move them to another status first.",
      ),
    ).toBeInTheDocument();
    // Statuses never reassign (CTR-020) — no select, even in use.
    expect(within(dialog).queryByRole("combobox")).not.toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "Archive status" })).toBeDisabled();
    expect(calls.archives).toEqual([]);
  });
});
