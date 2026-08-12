// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Matters · Types (#85) at the route seam: the shared TaxonomyTypesPane
 * on the matter mount — the nine MTR-001 seeds at their own URL with
 * the Matters vocabulary, in-place rename against the matter routes,
 * the inline add row, the locked `other` row, the archive-guard modal,
 * and each row's editor link. The machinery itself is covered by the
 * Contracts reference suite and at the HTTP seam in apps/api — these
 * tests pin the wiring: the matter URL, the matter endpoints, and the
 * matter copy.
 */

import { describe, expect, it } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { json, renderAt, stubApi, type StubCall } from "../testing/helpers";

const ADMIN = {
  id: "u1",
  email: "blair@example.com",
  displayName: "Blair Wentworth",
  role: "administrator",
  theme: "light",
};

const MEMBER = { ...ADMIN, id: "u2", email: "casey@example.com", role: "legal_team_member" };

const SEEDS = [
  ["t1", "employment", "Employment"],
  ["t2", "litigation", "Litigation"],
  ["t3", "regulatory", "Regulatory"],
  ["t4", "commercial", "Commercial"],
  ["t5", "corporate", "Corporate"],
  ["t6", "ip", "IP"],
  ["t7", "privacy", "Privacy"],
  ["t8", "advisory", "Advisory"],
  ["t9", "other", "Other"],
] as const;

function seededTypes() {
  return SEEDS.map(([id, slug, displayName], index) => ({
    id,
    slug,
    displayName,
    displayOrder: index + 1,
    isSystemDefault: true,
    archivedAt: null,
    inUseCount: 0,
  }));
}

interface TypesCalls {
  creates: unknown[];
  renames: { id: string; body: unknown }[];
  archives: { id: string; body: unknown }[];
}

function newCalls(): TypesCalls {
  return { creates: [], renames: [], archives: [] };
}

/** Serves the seeded list and captures the pane's writes — the pane
 * holds its own row state, so the stub never needs to mutate. */
function typesApi(calls: TypesCalls, rows = seededTypes()) {
  const byId = (id: string) => rows.find((row) => row.id === id)!;
  return (call: StubCall): Response | undefined => {
    const path = call.url.pathname;
    if (path === "/api/v1/matter-types" && call.method === "GET") {
      return json(200, { matterTypes: rows });
    }
    if (path === "/api/v1/matter-types" && call.method === "POST") {
      calls.creates.push(call.body);
      const body = call.body as { displayName: string };
      return json(201, {
        matterType: {
          id: "t-new",
          slug: "data_governance",
          displayName: body.displayName,
          displayOrder: rows.length + 1,
          isSystemDefault: false,
          archivedAt: null,
          inUseCount: 0,
        },
      });
    }
    const rename = /^\/api\/v1\/matter-types\/([^/]+)$/.exec(path);
    if (rename && call.method === "PATCH") {
      calls.renames.push({ id: rename[1]!, body: call.body });
      const body = call.body as { displayName: string };
      return json(200, { matterType: { ...byId(rename[1]!), displayName: body.displayName } });
    }
    const archive = /^\/api\/v1\/matter-types\/([^/]+)\/archive$/.exec(path);
    if (archive && call.method === "POST") {
      calls.archives.push({ id: archive[1]!, body: call.body });
      return json(200, {
        matterType: { ...byId(archive[1]!), archivedAt: "2026-08-12T09:00:00.000Z" },
      });
    }
    return undefined;
  };
}

const typeList = () => screen.getByRole("list");

describe("the SET-002 gate on the pane", () => {
  it("hides the Matters rail entry from a Legal Team Member and bounces the URL", async () => {
    stubApi({ signedIn: MEMBER });
    renderAt("/settings/matters/types");
    // The refusal lands on the member's own settings home…
    expect(await screen.findByRole("heading", { name: "Profile" })).toBeInTheDocument();
    // …and the rail never teases the section.
    const rail = screen.getByRole("navigation", { name: "Settings sections" });
    expect(within(rail).queryByText("Matters")).not.toBeInTheDocument();
  });

  it("gives an Administrator the rail entry, marked current on the pane", async () => {
    stubApi({ signedIn: ADMIN, extra: typesApi(newCalls()) });
    renderAt("/settings/matters/types");
    await screen.findByText("Litigation");
    const rail = screen.getByRole("navigation", { name: "Settings sections" });
    expect(within(rail).getByRole("link", { name: "Matters" })).toHaveAttribute(
      "aria-current",
      "page",
    );
  });
});

describe("the seeded list (MTR-001)", () => {
  it("renders the nine types in display order with matter usage counts", async () => {
    stubApi({ signedIn: ADMIN, extra: typesApi(newCalls()) });
    renderAt("/settings/matters/types");
    await screen.findByText("Employment");
    const items = within(typeList()).getAllByRole("listitem");
    expect(
      items.map((item) => within(item).getByRole("button", { name: /^Rename/ }).textContent),
    ).toEqual([
      "Employment",
      "Litigation",
      "Regulatory",
      "Commercial",
      "Corporate",
      "IP",
      "Privacy",
      "Advisory",
      "Other",
    ]);
    // The Matters vocabulary, not the Contracts one.
    expect(within(items[0]!).getByText("0 matters")).toBeInTheDocument();
    expect(screen.getByText("9 types")).toBeInTheDocument();
  });

  it("locks the Other row: no archive action, a labelled lock instead", async () => {
    stubApi({ signedIn: ADMIN, extra: typesApi(newCalls()) });
    renderAt("/settings/matters/types");
    await screen.findByText("Other");
    const rows = within(typeList()).getAllByRole("listitem");
    const otherRow = rows.at(-1)!;
    expect(within(otherRow).queryByRole("button", { name: /^Archive/ })).not.toBeInTheDocument();
    expect(
      within(otherRow).getByRole("img", {
        name: "Other is system-protected and can't be archived",
      }),
    ).toBeInTheDocument();
    expect(
      within(rows[0]!).getByRole("button", { name: "Archive Employment" }),
    ).toBeInTheDocument();
  });
});

describe("the matter endpoints behind the shared machinery", () => {
  it("renames through PATCH /matter-types/:id", async () => {
    const calls = newCalls();
    stubApi({ signedIn: ADMIN, extra: typesApi(calls) });
    renderAt("/settings/matters/types");
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Rename Advisory" }));
    const input = screen.getByRole("textbox", { name: "Rename Advisory" });
    await user.clear(input);
    await user.type(input, "Quick questions{Enter}");
    await waitFor(() =>
      expect(calls.renames).toEqual([{ id: "t8", body: { displayName: "Quick questions" } }]),
    );
    expect(await screen.findByText("Saved")).toBeInTheDocument();
  });

  it("creates through POST /matter-types and appends the new row", async () => {
    const calls = newCalls();
    stubApi({ signedIn: ADMIN, extra: typesApi(calls) });
    renderAt("/settings/matters/types");
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Add type" }));
    await user.type(
      screen.getByRole("textbox", { name: "New type name" }),
      "Data Governance{Enter}",
    );
    await waitFor(() => expect(calls.creates).toEqual([{ displayName: "Data Governance" }]));
    expect(
      await screen.findByRole("button", { name: "Rename Data Governance" }),
    ).toBeInTheDocument();
    expect(screen.getByText("10 types")).toBeInTheDocument();
  });

  it("archives through the guard modal with the Matters copy", async () => {
    const calls = newCalls();
    stubApi({ signedIn: ADMIN, extra: typesApi(calls) });
    renderAt("/settings/matters/types");
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Archive Privacy" }));

    const dialog = await screen.findByRole("dialog", { name: "Archive Privacy" });
    expect(
      within(dialog).getByText(
        "Privacy is not used by any matters — it can be archived without reassignment.",
      ),
    ).toBeInTheDocument();
    expect(within(dialog).getByRole("combobox", { name: /^Reassign matters to$/ })).toBeDisabled();
    await user.click(within(dialog).getByRole("button", { name: "Archive type" }));
    await waitFor(() => expect(calls.archives).toEqual([{ id: "t7", body: {} }]));
  });

  it("opens a row's editor screen from the row action", async () => {
    stubApi({ signedIn: ADMIN, extra: typesApi(newCalls()) });
    const { router } = renderAt("/settings/matters/types");
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Edit Litigation" }));
    expect(router.state.location.pathname).toBe("/settings/matters/types/t2");
  });
});

describe("the section URL", () => {
  it("forwards /settings/matters to the Types pane", async () => {
    stubApi({ signedIn: ADMIN, extra: typesApi(newCalls()) });
    const { router } = renderAt("/settings/matters");
    await screen.findByText("Employment");
    expect(router.state.location.pathname).toBe("/settings/matters/types");
  });
});
