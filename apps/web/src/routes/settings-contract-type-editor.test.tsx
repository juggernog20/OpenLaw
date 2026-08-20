// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The contract type editor (#84) at the route seam: the ST16 screen —
 * the identity card with DES-017 commit-on-confirm name and description
 * and the immutable slug, and the attached-fields card with the
 * per-attachment required checkbox, detach, arrow-key reorder, and the
 * Attach menu over unattached catalog fields. The API behaviors
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

const NDA = {
  id: "t1",
  slug: "nda",
  displayName: "NDA",
  description: "Mutual or one-way non-disclosure agreements.",
  displayOrder: 1,
  isSystemDefault: true,
  archivedAt: null,
  inUseCount: 0,
};

const GOVERNING_LAW = {
  fieldId: "f1",
  slug: "governing_law",
  displayName: "Governing law",
  fieldType: "text",
  moduleScope: "contract",
  displayOrder: 1,
  isRequired: true,
};

const DEPARTMENT = {
  fieldId: "f2",
  slug: "department",
  displayName: "Department",
  fieldType: "single_select",
  moduleScope: "global",
  displayOrder: 2,
  isRequired: false,
};

/** The live catalog: the two attached fields plus one attachable. */
const CATALOG = [
  {
    id: "f1",
    slug: "governing_law",
    displayName: "Governing law",
    description: null,
    moduleScope: "contract",
    fieldType: "text",
    options: null,
    fieldTag: "legal",
    aiPrompt: null,
    archivedAt: null,
    inUseCount: 1,
  },
  {
    id: "f2",
    slug: "department",
    displayName: "Department",
    description: null,
    moduleScope: "global",
    fieldType: "single_select",
    options: ["Legal", "Sales"],
    fieldTag: "business",
    aiPrompt: null,
    archivedAt: null,
    inUseCount: 1,
  },
  {
    id: "f3",
    slug: "our_position",
    displayName: "Our position",
    description: null,
    moduleScope: "contract",
    fieldType: "single_select",
    options: ["Customer", "Provider"],
    fieldTag: "business",
    aiPrompt: null,
    archivedAt: null,
    inUseCount: 0,
  },
];

interface EditorCalls {
  typePatches: unknown[];
  attaches: unknown[];
  requiredPatches: { fieldId: string; body: unknown }[];
  orders: unknown[];
  detaches: string[];
}

function newCalls(): EditorCalls {
  return { typePatches: [], attaches: [], requiredPatches: [], orders: [], detaches: [] };
}

/** Serves the editor's three loads and captures its writes — the page
 * holds its own row state, so the stub never needs to mutate. */
function editorApi(calls: EditorCalls, attached = [GOVERNING_LAW, DEPARTMENT]) {
  return (call: StubCall): Response | undefined => {
    const path = call.url.pathname;
    if (path === "/api/v1/contract-types" && call.method === "GET") {
      return json(200, { contractTypes: [NDA] });
    }
    if (path === "/api/v1/contract-types/t1" && call.method === "GET") {
      return json(200, { contractType: NDA });
    }
    if (path === "/api/v1/contract-types/t1" && call.method === "PATCH") {
      calls.typePatches.push(call.body);
      const body = call.body as { displayName?: string; description?: string | null };
      return json(200, {
        contractType: {
          ...NDA,
          displayName: body.displayName ?? NDA.displayName,
          description: body.description === undefined ? NDA.description : body.description,
        },
      });
    }
    if (path === "/api/v1/contract-types/t1/fields" && call.method === "GET") {
      return json(200, { attachedFields: attached });
    }
    if (path === "/api/v1/contract-types/t1/fields" && call.method === "POST") {
      calls.attaches.push(call.body);
      const body = call.body as { fieldId: string };
      const field = CATALOG.find((row) => row.id === body.fieldId)!;
      return json(201, {
        attachedField: {
          fieldId: field.id,
          slug: field.slug,
          displayName: field.displayName,
          fieldType: field.fieldType,
          moduleScope: field.moduleScope,
          displayOrder: attached.length + 1,
          isRequired: false,
        },
      });
    }
    if (path === "/api/v1/contract-types/t1/fields/order" && call.method === "PUT") {
      calls.orders.push(call.body);
      const { fieldIds } = call.body as { fieldIds: string[] };
      return json(200, {
        attachedFields: fieldIds.map((fieldId, index) => ({
          ...attached.find((row) => row.fieldId === fieldId)!,
          displayOrder: index + 1,
        })),
      });
    }
    const perField = /^\/api\/v1\/contract-types\/t1\/fields\/([^/]+)$/.exec(path);
    if (perField && call.method === "PATCH") {
      calls.requiredPatches.push({ fieldId: perField[1]!, body: call.body });
      const body = call.body as { isRequired: boolean };
      return json(200, {
        attachedField: {
          ...attached.find((row) => row.fieldId === perField[1])!,
          isRequired: body.isRequired,
        },
      });
    }
    if (perField && call.method === "DELETE") {
      calls.detaches.push(perField[1]!);
      return new Response(null, { status: 204 });
    }
    if (path === "/api/v1/fields" && call.method === "GET") {
      return json(200, { fields: CATALOG });
    }
    return undefined;
  };
}

describe("the SET-002 gate on the editor", () => {
  it("bounces a Legal Team Member to their own settings home", async () => {
    stubApi({ signedIn: MEMBER, extra: editorApi(newCalls()) });
    renderAt("/settings/contracts/types/t1");
    expect(await screen.findByRole("heading", { name: "Profile" })).toBeInTheDocument();
  });
});

describe("the identity card (ST16 left)", () => {
  it("renders name, description, the immutable slug, and the usage caption", async () => {
    stubApi({ signedIn: ADMIN, extra: editorApi(newCalls()) });
    renderAt("/settings/contracts/types/t1");

    expect(await screen.findByRole("heading", { name: "NDA" })).toBeInTheDocument();
    expect(screen.getByLabelText("Display name")).toHaveValue("NDA");
    expect(screen.getByLabelText("Description")).toHaveValue(
      "Mutual or one-way non-disclosure agreements.",
    );
    const slug = screen.getByLabelText("Slug");
    expect(slug).toHaveValue("nda");
    expect(slug).toHaveAttribute("readonly");
    expect(
      screen.getByText("Slug is immutable — it keys templates, approval rules, and the API."),
    ).toBeInTheDocument();
    expect(screen.getByText("0 contracts use this type.")).toBeInTheDocument();
  });

  it("commits a rename on Enter (DES-017)", async () => {
    const calls = newCalls();
    stubApi({ signedIn: ADMIN, extra: editorApi(calls) });
    renderAt("/settings/contracts/types/t1");
    const user = userEvent.setup();

    const name = await screen.findByLabelText("Display name");
    await user.clear(name);
    await user.type(name, "Nondisclosure{Enter}");
    await waitFor(() => expect(calls.typePatches).toEqual([{ displayName: "Nondisclosure" }]));
  });

  it("commits a description edit on blur, sending null when cleared", async () => {
    const calls = newCalls();
    stubApi({ signedIn: ADMIN, extra: editorApi(calls) });
    renderAt("/settings/contracts/types/t1");
    const user = userEvent.setup();

    const description = await screen.findByLabelText("Description");
    await user.clear(description);
    await user.tab();
    await waitFor(() => expect(calls.typePatches).toEqual([{ description: null }]));
  });
});

describe("the attached-fields card (ST16 right)", () => {
  it("lists attachments in order, typed, with global marked and required state drawn", async () => {
    stubApi({ signedIn: ADMIN, extra: editorApi(newCalls()) });
    renderAt("/settings/contracts/types/t1");

    const rows = within(await screen.findByRole("list")).getAllByRole("listitem");
    expect(within(rows[0]!).getByText("Governing law")).toBeInTheDocument();
    expect(within(rows[0]!).getByText("Text")).toBeInTheDocument();
    expect(within(rows[1]!).getByText("Department")).toBeInTheDocument();
    expect(within(rows[1]!).getByText("Single select · global")).toBeInTheDocument();

    expect(screen.getByRole("checkbox", { name: "Governing law required" })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: "Department required" })).not.toBeChecked();
    expect(
      screen.getByText(
        "Drag to reorder. Required fields are enforced at creation and re-type; " +
          "detaching a field keeps stored values.",
      ),
    ).toBeInTheDocument();
  });

  it("toggles the required flag per attachment", async () => {
    const calls = newCalls();
    stubApi({ signedIn: ADMIN, extra: editorApi(calls) });
    renderAt("/settings/contracts/types/t1");
    const user = userEvent.setup();

    await user.click(await screen.findByRole("checkbox", { name: "Department required" }));
    await waitFor(() =>
      expect(calls.requiredPatches).toEqual([{ fieldId: "f2", body: { isRequired: true } }]),
    );
    expect(screen.getByRole("checkbox", { name: "Department required" })).toBeChecked();
  });

  it("detaches a field, leaving the list without it", async () => {
    const calls = newCalls();
    stubApi({ signedIn: ADMIN, extra: editorApi(calls) });
    renderAt("/settings/contracts/types/t1");
    const user = userEvent.setup();

    await user.click(await screen.findByRole("button", { name: "Detach Governing law" }));
    await waitFor(() => expect(calls.detaches).toEqual(["f1"]));
    expect(screen.queryByText("Governing law")).not.toBeInTheDocument();
  });

  it("moves a row down with the arrow keys and commits the permutation", async () => {
    const calls = newCalls();
    stubApi({ signedIn: ADMIN, extra: editorApi(calls) });
    renderAt("/settings/contracts/types/t1");
    const user = userEvent.setup();

    const grip = await screen.findByRole("button", {
      name: "Reorder Governing law, position 1 of 2. Use the arrow keys to move it.",
    });
    grip.focus();
    await user.keyboard("{ArrowDown}");
    await waitFor(() => expect(calls.orders).toEqual([{ fieldIds: ["f2", "f1"] }]));

    const rows = within(screen.getByRole("list")).getAllByRole("listitem");
    expect(within(rows[0]!).getByText("Department")).toBeInTheDocument();
    expect(within(rows[1]!).getByText("Governing law")).toBeInTheDocument();
  });

  it("attaches from the menu, which offers only unattached catalog fields", async () => {
    const calls = newCalls();
    stubApi({ signedIn: ADMIN, extra: editorApi(calls) });
    renderAt("/settings/contracts/types/t1");
    const user = userEvent.setup();

    await user.click(await screen.findByRole("button", { name: "Attach field" }));
    const menu = await screen.findByRole("menu");
    expect(within(menu).queryByText("Governing law")).not.toBeInTheDocument();
    expect(within(menu).queryByText("Department")).not.toBeInTheDocument();

    await user.click(within(menu).getByText("Our position"));
    await waitFor(() => expect(calls.attaches).toEqual([{ fieldId: "f3" }]));
    const rows = within(screen.getByRole("list")).getAllByRole("listitem");
    expect(within(rows[2]!).getByText("Our position")).toBeInTheDocument();
  });

  it("surfaces the server detail when an attach conflicts, without adding the row", async () => {
    const calls = newCalls();
    const base = editorApi(calls);
    stubApi({
      signedIn: ADMIN,
      extra: (call: StubCall) =>
        call.url.pathname === "/api/v1/contract-types/t1/fields" && call.method === "POST"
          ? problem(409, "Our position is already attached.")
          : base(call),
    });
    renderAt("/settings/contracts/types/t1");
    const user = userEvent.setup();

    await user.click(await screen.findByRole("button", { name: "Attach field" }));
    await user.click(within(await screen.findByRole("menu")).getByText("Our position"));

    expect(await screen.findByText("Our position is already attached.")).toBeInTheDocument();
    expect(within(screen.getByRole("list")).getAllByRole("listitem")).toHaveLength(2);
  });

  it("keeps the order and surfaces the detail when a reorder is refused", async () => {
    const calls = newCalls();
    const base = editorApi(calls);
    stubApi({
      signedIn: ADMIN,
      extra: (call: StubCall) =>
        call.url.pathname === "/api/v1/contract-types/t1/fields/order" && call.method === "PUT"
          ? problem(400, "The order must include every attached field.")
          : base(call),
    });
    renderAt("/settings/contracts/types/t1");
    const user = userEvent.setup();

    const grip = await screen.findByRole("button", {
      name: "Reorder Governing law, position 1 of 2. Use the arrow keys to move it.",
    });
    grip.focus();
    await user.keyboard("{ArrowDown}");

    expect(
      await screen.findByText("The order must include every attached field."),
    ).toBeInTheDocument();
    const rows = within(screen.getByRole("list")).getAllByRole("listitem");
    expect(within(rows[0]!).getByText("Governing law")).toBeInTheDocument();
    // The failed save leaves the grip focusable for a retry (DES-011).
    expect(grip).not.toBeDisabled();
  });
});

describe("the way in from the Types pane", () => {
  it("opens a row's editor from its edit action", async () => {
    stubApi({ signedIn: ADMIN, extra: editorApi(newCalls()) });
    renderAt("/settings/contracts/types");
    const user = userEvent.setup();

    await user.click(await screen.findByRole("button", { name: "Edit NDA" }));
    expect(await screen.findByLabelText("Slug")).toHaveValue("nda");
  });
});

describe("moving between two types on the same route (#372)", () => {
  /** A second type, so the route can change :typeId without unmounting. */
  const MSA = {
    id: "t2",
    slug: "msa",
    displayName: "MSA",
    description: "Master services agreements.",
    displayOrder: 2,
    isSystemDefault: false,
    archivedAt: null,
    inUseCount: 0,
  };

  const OUR_POSITION = {
    fieldId: "f3",
    slug: "our_position",
    displayName: "Our position",
    fieldType: "single_select",
    moduleScope: "contract",
    displayOrder: 1,
    isRequired: false,
  };

  /** Serves both types' reads; each has its own name and its own field. */
  function twoTypes(calls: EditorCalls) {
    return (call: StubCall): Response | undefined => {
      const path = call.url.pathname;
      if (path === "/api/v1/contract-types/t2" && call.method === "GET") {
        return json(200, { contractType: MSA });
      }
      if (path === "/api/v1/contract-types/t2/fields" && call.method === "GET") {
        return json(200, { attachedFields: [OUR_POSITION] });
      }
      const perField = /^\/api\/v1\/contract-types\/t2\/fields\/([^/]+)$/.exec(path);
      if (perField && call.method === "DELETE") {
        calls.detaches.push(`t2:${perField[1]!}`);
        return new Response(null, { status: 204 });
      }
      return editorApi(calls)(call);
    };
  }

  it("shows the second type's identity and fields, not the first's", async () => {
    stubApi({ signedIn: ADMIN, extra: twoTypes(newCalls()) });
    const { router } = renderAt("/settings/contracts/types/t1");
    expect(await screen.findByRole("heading", { name: "NDA" })).toBeInTheDocument();

    await router.navigate("/settings/contracts/types/t2");

    expect(await screen.findByRole("heading", { name: "MSA" })).toBeInTheDocument();
    expect(screen.getByLabelText("Slug")).toHaveValue("msa");
    expect(screen.getByText("Our position")).toBeInTheDocument();
    expect(screen.queryByText("Governing law")).not.toBeInTheDocument();
  });

  it("addresses the type in the URL when a field is detached after Back", async () => {
    const calls = newCalls();
    stubApi({ signedIn: ADMIN, extra: twoTypes(calls) });
    const { router } = renderAt("/settings/contracts/types/t1");
    expect(await screen.findByRole("heading", { name: "NDA" })).toBeInTheDocument();
    await router.navigate("/settings/contracts/types/t2");
    expect(await screen.findByRole("heading", { name: "MSA" })).toBeInTheDocument();

    // Back to the first type — the route does not remount on its own.
    await router.navigate(-1);
    expect(await screen.findByRole("heading", { name: "NDA" })).toBeInTheDocument();

    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Detach Governing law" }));

    await waitFor(() => expect(calls.detaches).toEqual(["f1"]));
  });
});
