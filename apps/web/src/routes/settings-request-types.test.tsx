// SPDX-License-Identifier: AGPL-3.0-only

/** Request type list actions and destination labels at the route seam. */

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

/** Seeded Request types with explicit and module-only destinations. */
const SEEDS = [
  [
    "r1",
    "nda_request",
    "NDA request",
    "Mutual or one-way NDA with a counterparty.",
    "contract",
    "ct-nda",
    4,
  ],
  [
    "r2",
    "contract_review",
    "Contract review",
    "Review of a counterparty contract or redline.",
    "contract",
    null,
    2,
  ],
  [
    "r3",
    "legal_question",
    "Legal question",
    "One-off question — no record is created up front.",
    "matter",
    null,
    0,
  ],
] as const;

/** The two taxonomies a target may name, as their own routes answer. */
const MATTER_TYPES = [
  { id: "mt-lit", displayName: "Litigation", archivedAt: null, isDefault: false },
  { id: "mt-default", displayName: "Default", archivedAt: null, isDefault: true },
];
const CONTRACT_TYPES = [
  { id: "ct-nda", displayName: "NDA", archivedAt: null, isDefault: false },
  { id: "ct-default", displayName: "Default", archivedAt: null, isDefault: true },
];

/** One row as the request-types routes answer it. */
interface StubRow {
  id: string;
  slug: string;
  displayName: string;
  description: string | null;
  displayOrder: number;
  isSystemDefault: boolean;
  archivedAt: string | null;
  inUseCount: number;
  targetModule: "matter" | "contract";
  targetTypeId: string | null;
}

function seededTypes(): StubRow[] {
  return SEEDS.map(
    ([id, slug, displayName, description, targetModule, targetTypeId, formFieldCount], index) => ({
      id,
      slug,
      displayName,
      description,
      displayOrder: index + 1,
      isSystemDefault: true,
      archivedAt: null,
      inUseCount: 0,
      targetModule,
      targetTypeId,
      formFieldCount,
    }),
  );
}

interface TypesCalls {
  creates: unknown[];
  renames: { id: string; body: unknown }[];
  archives: { id: string; body: unknown }[];
  orders: unknown[];
}

function newCalls(): TypesCalls {
  return { creates: [], renames: [], archives: [], orders: [] };
}

/** Serves the seeded list and captures the pane's writes. The pane
 * holds its own row state, so the stub never needs to mutate. */
function typesApi(calls: TypesCalls, rows: StubRow[] = seededTypes()) {
  const byId = (id: string) => rows.find((row) => row.id === id)!;
  return (call: StubCall): Response | undefined => {
    const path = call.url.pathname;
    if (path === "/api/v1/request-types" && call.method === "GET") {
      return json(200, { requestTypes: rows });
    }
    // The Target column names the type the row points at, and the name
    // lives in that type's own taxonomy.
    if (path === "/api/v1/matter-types" && call.method === "GET") {
      return json(200, { matterTypes: MATTER_TYPES });
    }
    if (path === "/api/v1/contract-types" && call.method === "GET") {
      return json(200, { contractTypes: CONTRACT_TYPES });
    }
    if (path === "/api/v1/request-types" && call.method === "POST") {
      calls.creates.push(call.body);
      const body = call.body as { displayName: string };
      return json(201, {
        requestType: {
          id: "r-new",
          slug: "vendor_onboarding",
          displayName: body.displayName,
          description: null,
          displayOrder: rows.length + 1,
          isSystemDefault: false,
          archivedAt: null,
          inUseCount: 0,
          targetModule: "matter",
          targetTypeId: null,
        },
      });
    }
    if (path === "/api/v1/request-types/order" && call.method === "PUT") {
      calls.orders.push(call.body);
      const { ids } = call.body as { ids: string[] };
      return json(200, {
        requestTypes: ids.map((id, index) => ({ ...byId(id), displayOrder: index + 1 })),
      });
    }
    // Destination Form and catalog reads for the editor link.
    if (path.endsWith("/form") && call.method === "GET") return json(200, { form: [] });
    if (path === "/api/v1/fields" && call.method === "GET") {
      return json(200, { fields: [] });
    }
    const rename = /^\/api\/v1\/request-types\/([^/]+)$/.exec(path);
    // The editor's own read, for the row the Edit affordance opens.
    if (rename && call.method === "GET") {
      return json(200, { requestType: byId(rename[1]!) });
    }
    if (rename && call.method === "PATCH") {
      calls.renames.push({ id: rename[1]!, body: call.body });
      const body = call.body as { displayName: string };
      return json(200, { requestType: { ...byId(rename[1]!), displayName: body.displayName } });
    }
    const archive = /^\/api\/v1\/request-types\/([^/]+)\/archive$/.exec(path);
    if (archive && call.method === "POST") {
      calls.archives.push({ id: archive[1]!, body: call.body });
      return json(200, {
        requestType: { ...byId(archive[1]!), archivedAt: "2026-08-19T09:00:00.000Z" },
      });
    }
    return undefined;
  };
}

const typeList = () => screen.getByRole("list");

describe("the SET-002 gate on the pane", () => {
  it("hides the Intake rail entry from a Legal Team Member and bounces the URL", async () => {
    stubApi({ signedIn: MEMBER });
    renderAt("/settings/intake/request-types");
    // The refusal lands on the member's own settings home.
    expect(await screen.findByRole("heading", { name: "Profile" })).toBeInTheDocument();
    // The rail never shows the section.
    const rail = screen.getByRole("navigation", { name: "Settings sections" });
    expect(within(rail).queryByText("Intake")).not.toBeInTheDocument();
  });

  it("gives an Administrator the rail entry, marked current on the pane", async () => {
    stubApi({ signedIn: ADMIN, extra: typesApi(newCalls()) });
    renderAt("/settings/intake/request-types");
    await screen.findByText("NDA request");
    const rail = screen.getByRole("navigation", { name: "Settings sections" });
    expect(within(rail).getByRole("link", { name: "Intake" })).toHaveAttribute(
      "aria-current",
      "page",
    );
  });
});

describe("the Intake section head", () => {
  it("names its tabs strip and marks Request types current", async () => {
    stubApi({ signedIn: ADMIN, extra: typesApi(newCalls()) });
    renderAt("/settings/intake/request-types");
    await screen.findByText("NDA request");
    expect(screen.getByRole("heading", { name: "Intake" })).toBeInTheDocument();
    const tabs = screen.getByRole("navigation", { name: "Intake panes" });
    expect(within(tabs).getByRole("link", { name: "Request types" })).toHaveAttribute(
      "aria-current",
      "page",
    );
  });
});

describe("the seeded list (INT-002)", () => {
  it("renders the three types in display order", async () => {
    stubApi({ signedIn: ADMIN, extra: typesApi(newCalls()) });
    renderAt("/settings/intake/request-types");
    await screen.findByText("NDA request");
    const items = within(typeList()).getAllByRole("listitem");
    expect(
      items.map((item) => within(item).getByRole("button", { name: /^Rename/ }).textContent),
    ).toEqual(["NDA request", "Contract review", "Legal question"]);
    expect(screen.getByText("3 types")).toBeInTheDocument();
  });

  it("draws no in-use caption: requests land in M20, so every count is zero", async () => {
    stubApi({ signedIn: ADMIN, extra: typesApi(newCalls()) });
    renderAt("/settings/intake/request-types");
    await screen.findByText("NDA request");
    expect(screen.queryByText(/^0 requests$/)).not.toBeInTheDocument();
    // The Matters pane's caption is what this mount deliberately drops.
    expect(screen.queryByText(/^0 matters$/)).not.toBeInTheDocument();
  });

  it("locks nothing: a request type named Other archives like any other row", async () => {
    const rows: StubRow[] = [
      ...seededTypes(),
      {
        id: "r4",
        slug: "other",
        displayName: "Other",
        description: null,
        displayOrder: 4,
        isSystemDefault: false,
        archivedAt: null,
        inUseCount: 0,
        targetModule: "matter",
        targetTypeId: null,
      },
    ];
    const calls = newCalls();
    stubApi({ signedIn: ADMIN, extra: typesApi(calls, rows) });
    renderAt("/settings/intake/request-types");
    const user = userEvent.setup();
    await screen.findByText("Other");
    const otherRow = within(typeList()).getAllByRole("listitem").at(-1)!;
    expect(
      within(otherRow).queryByRole("img", { name: /system-protected/ }),
    ).not.toBeInTheDocument();
    // The archive runs to the end: the other mounts refuse this row at
    // the API, and nothing here may inherit that lock.
    await user.click(within(otherRow).getByRole("button", { name: "Archive Other" }));
    const dialog = await screen.findByRole("dialog", { name: "Archive Other" });
    await user.click(within(dialog).getByRole("button", { name: "Archive type" }));
    await waitFor(() => expect(calls.archives).toEqual([{ id: "r4", body: {} }]));
  });

  it("draws each row's description under its name (ST12's two-line row)", async () => {
    stubApi({ signedIn: ADMIN, extra: typesApi(newCalls()) });
    renderAt("/settings/intake/request-types");
    await screen.findByText("NDA request");
    const [first] = within(typeList()).getAllByRole("listitem");
    expect(
      within(first!).getByText("Mutual or one-way NDA with a counterparty."),
    ).toBeInTheDocument();
  });
});

describe("the Destination column (INT-002)", () => {
  it("names the destination type or its module Default", async () => {
    stubApi({ signedIn: ADMIN, extra: typesApi(newCalls()) });
    renderAt("/settings/intake/request-types");
    await screen.findByText("NDA request");
    const [nda, review, question] = within(typeList()).getAllByRole("listitem");
    expect(within(nda!).getByText("Contract · NDA")).toBeInTheDocument();
    expect(within(review!).getByText("Contract · Default")).toBeInTheDocument();
    expect(within(question!).getByText("Matter · Default")).toBeInTheDocument();
    expect(screen.getByText("Destination")).toBeInTheDocument();
  });

  it("names a matter type the same way", async () => {
    const rows = seededTypes();
    rows[2] = { ...rows[2]!, targetModule: "matter", targetTypeId: "mt-lit" };
    stubApi({ signedIn: ADMIN, extra: typesApi(newCalls(), rows) });
    renderAt("/settings/intake/request-types");
    await screen.findByText("Legal question");
    expect(screen.getByText("Matter · Litigation")).toBeInTheDocument();
  });

  it("reads a deleted destination type as the module Default", async () => {
    // Deleting a destination type leaves its module and the Default Form.
    const rows = seededTypes();
    rows[0] = { ...rows[0]!, targetTypeId: null };
    stubApi({ signedIn: ADMIN, extra: typesApi(newCalls(), rows) });
    renderAt("/settings/intake/request-types");
    await screen.findByText("NDA request");
    const [nda] = within(typeList()).getAllByRole("listitem");
    expect(within(nda!).getByText("Contract · Default")).toBeInTheDocument();
    expect(within(nda!).queryByText("Contract · NDA")).not.toBeInTheDocument();
  });
});

it("replaces the Form fields count with Destination", async () => {
  stubApi({ signedIn: ADMIN, extra: typesApi(newCalls()) });
  renderAt("/settings/intake/request-types");
  await screen.findByText("NDA request");
  expect(screen.getByText("Destination")).toBeVisible();
  expect(screen.queryByText("Form fields")).not.toBeInTheDocument();
  expect(screen.queryByText(/^[0-9]+ fields?$/)).not.toBeInTheDocument();
  const [nda] = within(typeList()).getAllByRole("listitem");
  expect(within(nda!).getByText("Destination:")).toBeInTheDocument();
});

describe("the per-row editor affordance", () => {
  it("opens the request type's own editor screen", async () => {
    stubApi({ signedIn: ADMIN, extra: typesApi(newCalls()) });
    const { router } = renderAt("/settings/intake/request-types");
    const user = userEvent.setup();
    await screen.findByText("NDA request");
    await user.click(screen.getByRole("button", { name: "Edit NDA request" }));
    // The row's own URL, and the editor's own identity card on it.
    await waitFor(() =>
      expect(router.state.location.pathname).toBe("/settings/intake/request-types/r1"),
    );
    expect(await screen.findByLabelText("Display name")).toHaveValue("NDA request");
  });
});

describe("the request endpoints behind the shared machinery", () => {
  it("renames through PATCH /request-types/:id", async () => {
    const calls = newCalls();
    stubApi({ signedIn: ADMIN, extra: typesApi(calls) });
    renderAt("/settings/intake/request-types");
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Rename Legal question" }));
    const input = screen.getByRole("textbox", { name: "Rename Legal question" });
    await user.clear(input);
    await user.type(input, "Quick question{Enter}");
    await waitFor(() =>
      expect(calls.renames).toEqual([{ id: "r3", body: { displayName: "Quick question" } }]),
    );
    expect(await screen.findByText("Saved")).toBeInTheDocument();
  });

  it("creates through POST /request-types and appends the new row", async () => {
    const calls = newCalls();
    stubApi({ signedIn: ADMIN, extra: typesApi(calls) });
    renderAt("/settings/intake/request-types");
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Add request type" }));
    await user.type(
      screen.getByRole("textbox", { name: "New request type name" }),
      "Vendor onboarding{Enter}",
    );
    await waitFor(() => expect(calls.creates).toEqual([{ displayName: "Vendor onboarding" }]));
    expect(
      await screen.findByRole("button", { name: "Rename Vendor onboarding" }),
    ).toBeInTheDocument();
    expect(screen.getByText("4 types")).toBeInTheDocument();
  });

  it("reorders from the grip with the arrow keys and announces the landing", async () => {
    const calls = newCalls();
    stubApi({ signedIn: ADMIN, extra: typesApi(calls) });
    renderAt("/settings/intake/request-types");
    const user = userEvent.setup();
    await user.click(
      await screen.findByRole("button", {
        name: "Reorder NDA request, position 1 of 3. Use the arrow keys to move it.",
      }),
    );
    await user.keyboard("{ArrowDown}");
    await waitFor(() => expect(calls.orders).toEqual([{ ids: ["r2", "r1", "r3"] }]));
    expect(await screen.findByText("NDA request moved to position 2 of 3.")).toBeInTheDocument();
  });

  it("archives through the guard modal with the Intake copy", async () => {
    const calls = newCalls();
    stubApi({ signedIn: ADMIN, extra: typesApi(calls) });
    renderAt("/settings/intake/request-types");
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Archive Contract review" }));

    const dialog = await screen.findByRole("dialog", { name: "Archive Contract review" });
    expect(
      within(dialog).getByText(
        "Contract review is not used by any requests — it can be archived without reassignment.",
      ),
    ).toBeInTheDocument();
    expect(within(dialog).getByRole("combobox", { name: /^Reassign requests to$/ })).toBeDisabled();
    await user.click(within(dialog).getByRole("button", { name: "Archive type" }));
    await waitFor(() => expect(calls.archives).toEqual([{ id: "r2", body: {} }]));
  });
});

describe("the section URL", () => {
  it("forwards /settings/intake to the Request types pane", async () => {
    stubApi({ signedIn: ADMIN, extra: typesApi(newCalls()) });
    const { router } = renderAt("/settings/intake");
    await screen.findByText("NDA request");
    expect(router.state.location.pathname).toBe("/settings/intake/request-types");
  });
});

it("requires a reassignment for a Request type used by Requests", async () => {
  const calls = newCalls();
  const rows = seededTypes().map((row) => (row.id === "r2" ? { ...row, inUseCount: 3 } : row));
  stubApi({ signedIn: ADMIN, extra: typesApi(calls, rows) });
  renderAt("/settings/intake/request-types");
  const user = userEvent.setup();
  await user.click(await screen.findByRole("button", { name: "Archive Contract review" }));
  const dialog = await screen.findByRole("dialog", { name: "Archive Contract review" });
  expect(dialog).toHaveTextContent("3 requests");
  const replacement = within(dialog).getByRole("combobox", { name: "Reassign 3 requests to" });
  expect(replacement).toBeEnabled();
  await user.selectOptions(replacement, "r1");
  await user.click(within(dialog).getByRole("button", { name: "Archive type" }));
  await waitFor(() => expect(calls.archives).toEqual([{ id: "r2", body: { reassignToId: "r1" } }]));
});
