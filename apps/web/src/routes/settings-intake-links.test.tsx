// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Intake · Deflection links (#356, INT-004) at the route seam: the
 * DES-020 list-editor in its value-list variant on the ST13 anatomy.
 * That covers the two-line label-over-address row, the placement chip,
 * the DES-021 dialog behind Add and behind the row's pencil, keyboard
 * reorder with its announcement, and outright removal. The API
 * behaviors themselves are covered at the HTTP seam in apps/api. These
 * stubs only shape what this UI must react to.
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

/** The three request types a placement may name; the archived one is
 * what keeps the picker's rule honest. */
const REQUEST_TYPES = [
  { id: "r1", displayName: "NDA request", archivedAt: null },
  { id: "r2", displayName: "Contract review", archivedAt: null },
  { id: "r3", displayName: "Vendor onboarding", archivedAt: "2026-08-01T00:00:00.000Z" },
];

/** The three rows ST13 draws: two on the portal home, one on a type. */
const SEEDS = [
  ["l1", "NDA FAQ — when you don't need legal", "https://wiki.acme.com/legal/nda-faq", null],
  ["l2", "Purchasing policy", "https://wiki.acme.com/procurement/policy", null],
  ["l3", "Standard contract templates", "https://wiki.acme.com/legal/templates", "r2"],
] as const;

interface StubLink {
  id: string;
  label: string;
  url: string;
  requestTypeId: string | null;
  displayOrder: number;
}

function seededLinks(): StubLink[] {
  return SEEDS.map(([id, label, url, requestTypeId], index) => ({
    id,
    label,
    url,
    requestTypeId,
    displayOrder: index + 1,
  }));
}

interface LinkCalls {
  creates: unknown[];
  patches: { id: string; body: unknown }[];
  orders: unknown[];
  deletes: string[];
}

function newCalls(): LinkCalls {
  return { creates: [], patches: [], orders: [], deletes: [] };
}

/** Serves the seeded panel and captures the pane's writes. The pane
 * holds its own row state, so the stub never needs to mutate. */
function linksApi(
  calls: LinkCalls,
  rows: StubLink[] = seededLinks(),
  options: { createFails?: string; deleteFails?: string; orderFails?: string } = {},
) {
  const byId = (id: string) => rows.find((row) => row.id === id)!;
  return (call: StubCall): Response | undefined => {
    const path = call.url.pathname;
    if (path === "/api/v1/intake-links" && call.method === "GET") {
      return json(200, { intakeLinks: rows });
    }
    // The chip names the request type the row sits on, and the name
    // lives in that taxonomy.
    if (path === "/api/v1/request-types" && call.method === "GET") {
      return json(200, { requestTypes: REQUEST_TYPES });
    }
    if (path === "/api/v1/intake-links" && call.method === "POST") {
      calls.creates.push(call.body);
      if (options.createFails) return problem(400, options.createFails);
      const body = call.body as { label: string; url: string; requestTypeId: string | null };
      return json(201, {
        intakeLink: {
          id: "l-new",
          label: body.label,
          url: body.url,
          requestTypeId: body.requestTypeId,
          displayOrder: rows.length + 1,
        },
      });
    }
    if (path === "/api/v1/intake-links/order" && call.method === "PUT") {
      calls.orders.push(call.body);
      if (options.orderFails) return problem(409, options.orderFails);
      const { ids } = call.body as { ids: string[] };
      return json(200, {
        intakeLinks: ids.map((id, index) => ({ ...byId(id), displayOrder: index + 1 })),
      });
    }
    const one = /^\/api\/v1\/intake-links\/([^/]+)$/.exec(path);
    if (one && call.method === "PATCH") {
      calls.patches.push({ id: one[1]!, body: call.body });
      return json(200, { intakeLink: { ...byId(one[1]!), ...(call.body as object) } });
    }
    if (one && call.method === "DELETE") {
      calls.deletes.push(one[1]!);
      if (options.deleteFails) return problem(409, options.deleteFails);
      return new Response(null, { status: 204 });
    }
    return undefined;
  };
}

const linkList = () => screen.getByRole("list");

/** One row's placement chip, read as a screen reader hears it. The
 * sr-only "Placement:" prefix and the visible name are two text nodes
 * in one chip, and neither says the whole thing alone. */
const chipOf = (scope: HTMLElement): string =>
  within(scope).getByText("Placement:").parentElement?.textContent?.trim() ?? "";

describe("the SET-002 gate on the pane", () => {
  it("bounces a Legal Team Member off the URL", async () => {
    stubApi({ signedIn: MEMBER });
    renderAt("/settings/intake/links");
    expect(await screen.findByRole("heading", { name: "Profile" })).toBeInTheDocument();
  });
});

describe("the Intake section tabs", () => {
  it("marks Deflection links current and routes back to Request types", async () => {
    stubApi({ signedIn: ADMIN, extra: linksApi(newCalls()) });
    const { router } = renderAt("/settings/intake/links");
    await screen.findByText("Purchasing policy");
    const tabs = screen.getByRole("navigation", { name: "Intake panes" });
    expect(within(tabs).getByRole("link", { name: "Deflection links" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    const user = userEvent.setup();
    await user.click(within(tabs).getByRole("link", { name: "Request types" }));
    await waitFor(() =>
      expect(router.state.location.pathname).toBe("/settings/intake/request-types"),
    );
  });
});

describe("the panel (ST13)", () => {
  it("renders each row as its label over the scheme-less address", async () => {
    stubApi({ signedIn: ADMIN, extra: linksApi(newCalls()) });
    renderAt("/settings/intake/links");
    await screen.findByText("Purchasing policy");
    const items = within(linkList()).getAllByRole("listitem");
    expect(items).toHaveLength(3);
    // The host is followed by its path separator, so the pattern matches
    // the host itself rather than anything that merely starts with it.
    expect(items.map((item) => within(item).getByText(/^wiki\.acme\.com\//).textContent)).toEqual([
      "wiki.acme.com/legal/nda-faq",
      "wiki.acme.com/procurement/policy",
      "wiki.acme.com/legal/templates",
    ]);
    // The scheme is machinery, and the row drops it. Only the row does.
    expect(screen.queryByText(/https:\/\//)).not.toBeInTheDocument();
    expect(screen.getByText("3 links")).toBeInTheDocument();
  });

  it("names each row's placement in its chip", async () => {
    stubApi({ signedIn: ADMIN, extra: linksApi(newCalls()) });
    renderAt("/settings/intake/links");
    await screen.findByText("Purchasing policy");
    const items = within(linkList()).getAllByRole("listitem");
    expect(items.map((item) => chipOf(item))).toEqual([
      "Placement: Portal home",
      "Placement: Portal home",
      "Placement: Contract review",
    ]);
  });

  it("removes a link outright — no archive, no guard modal", async () => {
    const calls = newCalls();
    stubApi({ signedIn: ADMIN, extra: linksApi(calls) });
    renderAt("/settings/intake/links");
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Remove Purchasing policy" }));
    await waitFor(() => expect(calls.deletes).toEqual(["l2"]));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    await waitFor(() => expect(screen.queryByText("Purchasing policy")).not.toBeInTheDocument());
    expect(screen.getByText("2 links")).toBeInTheDocument();
    // A value list archives nothing, so there is nothing to reveal.
    expect(screen.queryByRole("switch", { name: "Show archived" })).not.toBeInTheDocument();
  });

  it("keeps a refused removal's row, with the API's own refusal beside it", async () => {
    const calls = newCalls();
    stubApi({
      signedIn: ADMIN,
      extra: linksApi(calls, seededLinks(), {
        deleteFails: "No deflection link exists with this id.",
      }),
    });
    renderAt("/settings/intake/links");
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Remove Purchasing policy" }));
    await waitFor(() => expect(calls.deletes).toEqual(["l2"]));
    // The 204 never came, so the row stays and says why.
    expect(await screen.findByText("No deflection link exists with this id.")).toBeInTheDocument();
    expect(screen.getByText("Purchasing policy")).toBeInTheDocument();
    expect(screen.getByText("3 links")).toBeInTheDocument();
  });

  it("reorders from the grip with the arrow keys and announces the landing", async () => {
    const calls = newCalls();
    stubApi({ signedIn: ADMIN, extra: linksApi(calls) });
    renderAt("/settings/intake/links");
    const user = userEvent.setup();
    await user.click(
      await screen.findByRole("button", {
        name: "Reorder Purchasing policy, position 2 of 3. Use the arrow keys to move it.",
      }),
    );
    await user.keyboard("{ArrowUp}");
    await waitFor(() => expect(calls.orders).toEqual([{ ids: ["l2", "l1", "l3"] }]));
    expect(
      await screen.findByText("Purchasing policy moved to position 1 of 3."),
    ).toBeInTheDocument();
  });

  it("puts back the confirmed order when the reorder is refused", async () => {
    const calls = newCalls();
    stubApi({
      signedIn: ADMIN,
      extra: linksApi(calls, seededLinks(), {
        orderFails: "The list moved under you. Reload and try again.",
      }),
    });
    renderAt("/settings/intake/links");
    const user = userEvent.setup();
    await user.click(
      await screen.findByRole("button", {
        name: "Reorder Purchasing policy, position 2 of 3. Use the arrow keys to move it.",
      }),
    );
    await user.keyboard("{ArrowUp}");
    await waitFor(() => expect(calls.orders).toEqual([{ ids: ["l2", "l1", "l3"] }]));

    // SET-003 immediate apply draws the move at once, so the refusal has
    // to undo it: the rows go back to the order the server still holds,
    // and the pane says why rather than leaving a move that never landed.
    expect(
      await screen.findByText("The list moved under you. Reload and try again."),
    ).toBeInTheDocument();
    await waitFor(() =>
      expect(
        within(linkList())
          .getAllByRole("listitem")
          .map((item) => within(item).getByText(/^wiki\.acme\.com\//).textContent),
      ).toEqual([
        "wiki.acme.com/legal/nda-faq",
        "wiki.acme.com/procurement/policy",
        "wiki.acme.com/legal/templates",
      ]),
    );
  });
});

describe("the DES-021 dialog behind Add", () => {
  it("adds a link on the portal home", async () => {
    const calls = newCalls();
    stubApi({ signedIn: ADMIN, extra: linksApi(calls) });
    renderAt("/settings/intake/links");
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Add link" }));

    const dialog = await screen.findByRole("dialog", { name: "Add link" });
    await user.type(within(dialog).getByLabelText("Label"), "Signature guide");
    await user.type(within(dialog).getByLabelText("Address"), "https://wiki.acme.com/sign");
    await user.click(within(dialog).getByRole("button", { name: "Add link" }));

    await waitFor(() =>
      expect(calls.creates).toEqual([
        {
          label: "Signature guide",
          url: "https://wiki.acme.com/sign",
          // The portal home is the null placement (INT-004).
          requestTypeId: null,
        },
      ]),
    );
    expect(await screen.findByText("wiki.acme.com/sign")).toBeInTheDocument();
    expect(screen.getByText("4 links")).toBeInTheDocument();
  });

  it("adds a link on a live request type, and offers no archived one", async () => {
    const calls = newCalls();
    stubApi({ signedIn: ADMIN, extra: linksApi(calls) });
    renderAt("/settings/intake/links");
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Add link" }));

    const dialog = await screen.findByRole("dialog", { name: "Add link" });
    const placement = within(dialog).getByLabelText("Placement");
    expect(
      within(placement)
        .getAllByRole("option")
        .map((option) => option.textContent),
    ).toEqual(["Portal home", "NDA request", "Contract review"]);

    await user.type(within(dialog).getByLabelText("Label"), "NDA templates");
    await user.type(within(dialog).getByLabelText("Address"), "https://wiki.acme.com/nda");
    await user.selectOptions(placement, "r1");
    await user.click(within(dialog).getByRole("button", { name: "Add link" }));

    await waitFor(() =>
      expect(calls.creates).toEqual([
        { label: "NDA templates", url: "https://wiki.acme.com/nda", requestTypeId: "r1" },
      ]),
    );
    const rows = within(linkList()).getAllByRole("listitem");
    expect(chipOf(rows.at(-1)!)).toBe("Placement: NDA request");
  });

  it("refuses a malformed or non-http(s) address before it reaches the API", async () => {
    const calls = newCalls();
    stubApi({ signedIn: ADMIN, extra: linksApi(calls) });
    renderAt("/settings/intake/links");
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Add link" }));

    const dialog = await screen.findByRole("dialog", { name: "Add link" });
    await user.type(within(dialog).getByLabelText("Label"), "Bad");
    await user.type(within(dialog).getByLabelText("Address"), "wiki.acme.com/legal");
    await user.click(within(dialog).getByRole("button", { name: "Add link" }));

    expect(await within(dialog).findByRole("alert")).toHaveTextContent(
      "Enter a full web address that starts with http:// or https://.",
    );
    expect(calls.creates).toEqual([]);
  });

  it("names the link before it will save one", async () => {
    const calls = newCalls();
    stubApi({ signedIn: ADMIN, extra: linksApi(calls) });
    renderAt("/settings/intake/links");
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Add link" }));

    const dialog = await screen.findByRole("dialog", { name: "Add link" });
    await user.type(within(dialog).getByLabelText("Address"), "https://wiki.acme.com/x");
    await user.click(within(dialog).getByRole("button", { name: "Add link" }));

    expect(await within(dialog).findByRole("alert")).toHaveTextContent("Name the link.");
    expect(calls.creates).toEqual([]);
  });

  it("shows the API's own refusal when the server turns the link down", async () => {
    const calls = newCalls();
    stubApi({
      signedIn: ADMIN,
      extra: linksApi(calls, seededLinks(), {
        createFails: "Enter a full web address that starts with http:// or https://.",
      }),
    });
    renderAt("/settings/intake/links");
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Add link" }));

    const dialog = await screen.findByRole("dialog", { name: "Add link" });
    await user.type(within(dialog).getByLabelText("Label"), "Refused");
    await user.type(within(dialog).getByLabelText("Address"), "https://wiki.acme.com/refused");
    await user.click(within(dialog).getByRole("button", { name: "Add link" }));

    expect(await within(dialog).findByRole("alert")).toHaveTextContent(
      "Enter a full web address that starts with http:// or https://.",
    );
    expect(screen.getByText("3 links")).toBeInTheDocument();
  });
});

describe("the DES-021 dialog behind a row's pencil", () => {
  it("edits the label and the address in place", async () => {
    const calls = newCalls();
    stubApi({ signedIn: ADMIN, extra: linksApi(calls) });
    renderAt("/settings/intake/links");
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Edit Purchasing policy" }));

    const dialog = await screen.findByRole("dialog", { name: "Edit Purchasing policy" });
    const label = within(dialog).getByLabelText("Label");
    await user.clear(label);
    await user.type(label, "Procurement policy");
    await user.click(within(dialog).getByRole("button", { name: "Save" }));

    await waitFor(() =>
      expect(calls.patches).toEqual([{ id: "l2", body: { label: "Procurement policy" } }]),
    );
    expect(await screen.findByText("Procurement policy")).toBeInTheDocument();
  });

  it("moves a link from a request type to the portal home", async () => {
    const calls = newCalls();
    stubApi({ signedIn: ADMIN, extra: linksApi(calls) });
    renderAt("/settings/intake/links");
    const user = userEvent.setup();
    await user.click(
      await screen.findByRole("button", { name: "Edit Standard contract templates" }),
    );

    const dialog = await screen.findByRole("dialog", { name: "Edit Standard contract templates" });
    await user.selectOptions(within(dialog).getByLabelText("Placement"), "");
    await user.click(within(dialog).getByRole("button", { name: "Save" }));

    await waitFor(() =>
      expect(calls.patches).toEqual([{ id: "l3", body: { requestTypeId: null } }]),
    );
    const items = within(linkList()).getAllByRole("listitem");
    expect(chipOf(items[2]!)).toBe("Placement: Portal home");
  });

  it("keeps an archived placement on offer for the row that already sits on it", async () => {
    const rows = seededLinks();
    rows[2] = { ...rows[2]!, requestTypeId: "r3" };
    stubApi({ signedIn: ADMIN, extra: linksApi(newCalls(), rows) });
    renderAt("/settings/intake/links");
    const user = userEvent.setup();
    // The chip reads the archived type by name. A placement picked
    // before the type was archived still has to read as itself.
    await screen.findByText("Standard contract templates");
    expect(chipOf(within(linkList()).getAllByRole("listitem")[2]!)).toBe(
      "Placement: Vendor onboarding",
    );

    await user.click(screen.getByRole("button", { name: "Edit Standard contract templates" }));
    const dialog = await screen.findByRole("dialog", { name: "Edit Standard contract templates" });
    expect(
      within(within(dialog).getByLabelText("Placement"))
        .getAllByRole("option")
        .map((option) => option.textContent),
    ).toEqual(["Portal home", "NDA request", "Contract review", "Vendor onboarding (archived)"]);
  });

  it("closes without a request when nothing was changed", async () => {
    const calls = newCalls();
    stubApi({ signedIn: ADMIN, extra: linksApi(calls) });
    renderAt("/settings/intake/links");
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Edit Purchasing policy" }));
    const dialog = await screen.findByRole("dialog", { name: "Edit Purchasing policy" });
    await user.click(within(dialog).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(calls.patches).toEqual([]);
  });
});
