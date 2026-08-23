// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The matter type editor (#85) at the route seam: the shared
 * TypeEditorScreen on the matter mount — the identity card and the
 * attachment card against the matter routes, with the MTR-011 scope
 * rule shaping the Attach menu: matter-scoped and global fields. The
 * machinery itself is covered by the Contracts reference suite and at
 * the HTTP seam in apps/api — these tests pin the wiring: the matter
 * URL, the matter endpoints, the catalog filter, and the matter copy.
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

const EMPLOYMENT = {
  id: "t1",
  slug: "employment",
  displayName: "Employment",
  description: "Terminations, severance, harassment investigations, non-competes.",
  displayOrder: 1,
  isSystemDefault: true,
  archivedAt: null,
  inUseCount: 0,
};

const DEPARTMENT = {
  fieldId: "f2",
  slug: "department",
  displayName: "Department",
  fieldType: "single_select",
  moduleScope: "global",
  displayOrder: 1,
  isRequired: false,
};

/** The live catalog: one attached global field, one attachable matter
 * field, and one contract-scoped field the menu must never offer. */
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
    inUseCount: 0,
  },
  {
    id: "f2",
    slug: "department",
    displayName: "Department",
    description: null,
    moduleScope: "matter",
    fieldType: "single_select",
    options: ["Legal", "Sales"],
    fieldTag: "business",
    aiPrompt: null,
    archivedAt: null,
    inUseCount: 1,
  },
  {
    id: "f3",
    slug: "budget_owner",
    displayName: "Budget owner",
    description: null,
    moduleScope: "global",
    fieldType: "user",
    options: null,
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
  detaches: string[];
}

function newCalls(): EditorCalls {
  return { typePatches: [], attaches: [], requiredPatches: [], detaches: [] };
}

/** Serves the editor's three loads and captures its writes — the page
 * holds its own row state, so the stub never needs to mutate. */
function editorApi(calls: EditorCalls, attached = [DEPARTMENT]) {
  return (call: StubCall): Response | undefined => {
    const path = call.url.pathname;
    if (path === "/api/v1/matter-types" && call.method === "GET") {
      return json(200, { matterTypes: [EMPLOYMENT] });
    }
    if (path === "/api/v1/matter-types/t1" && call.method === "GET") {
      return json(200, { matterType: EMPLOYMENT });
    }
    if (path === "/api/v1/matter-types/t1" && call.method === "PATCH") {
      calls.typePatches.push(call.body);
      const body = call.body as { displayName?: string; description?: string | null };
      return json(200, {
        matterType: {
          ...EMPLOYMENT,
          displayName: body.displayName ?? EMPLOYMENT.displayName,
          description: body.description === undefined ? EMPLOYMENT.description : body.description,
        },
      });
    }
    if (path === "/api/v1/matter-types/t1/fields" && call.method === "GET") {
      return json(200, { attachedFields: attached });
    }
    if (path === "/api/v1/matter-types/t1/fields" && call.method === "POST") {
      calls.attaches.push(call.body);
      const body = call.body as { fieldId: string };
      const field = CATALOG.find((candidate) => candidate.id === body.fieldId)!;
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
    const perField = /^\/api\/v1\/matter-types\/t1\/fields\/([^/]+)$/.exec(path);
    if (perField && call.method === "PATCH") {
      calls.requiredPatches.push({ fieldId: perField[1]!, body: call.body });
      const row = attached.find((candidate) => candidate.fieldId === perField[1])!;
      const body = call.body as { isRequired: boolean };
      return json(200, { attachedField: { ...row, isRequired: body.isRequired } });
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

describe("the editor screen on the matter mount", () => {
  it("renders the identity card with the matter usage caption and the immutable slug", async () => {
    stubApi({ signedIn: ADMIN, extra: editorApi(newCalls()) });
    renderAt("/settings/matters/types/t1");
    expect(await screen.findByRole("textbox", { name: "Display name" })).toHaveValue("Employment");
    expect(screen.getByRole("textbox", { name: "Slug" })).toHaveAttribute("readonly");
    // The Matters vocabulary, not the Contracts one.
    expect(screen.getByText("0 matters use this type.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "All types" })).toHaveAttribute(
      "href",
      "/settings/matters/types",
    );
  });

  it("commits a description edit through PATCH /matter-types/:id", async () => {
    const calls = newCalls();
    stubApi({ signedIn: ADMIN, extra: editorApi(calls) });
    renderAt("/settings/matters/types/t1");
    const user = userEvent.setup();
    const input = await screen.findByRole("textbox", { name: "Description" });
    await user.clear(input);
    await user.type(input, "People matters.{Enter}");
    await waitFor(() => expect(calls.typePatches).toEqual([{ description: "People matters." }]));
  });
});

describe("the MTR-011 scope rule in the Attach menu", () => {
  it("offers unattached matter/global fields — contract-scoped fields never show", async () => {
    stubApi({ signedIn: ADMIN, extra: editorApi(newCalls()) });
    renderAt("/settings/matters/types/t1");
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Attach field" }));
    const menu = await screen.findByRole("menu");
    expect(within(menu).getByText("Budget owner")).toBeInTheDocument();
    // Department is already attached; Governing law is contract-scoped.
    expect(within(menu).queryByText("Department")).not.toBeInTheDocument();
    expect(within(menu).queryByText("Governing law")).not.toBeInTheDocument();
  });

  it("attaches through POST /matter-types/:id/fields and appends the row", async () => {
    const calls = newCalls();
    stubApi({ signedIn: ADMIN, extra: editorApi(calls) });
    renderAt("/settings/matters/types/t1");
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Attach field" }));
    await user.click(await screen.findByRole("menuitem", { name: /Budget owner/ }));
    await waitFor(() => expect(calls.attaches).toEqual([{ fieldId: "f3" }]));
    expect(await screen.findByText("Budget owner")).toBeInTheDocument();
    // Everything attachable is now attached.
    expect(screen.getByText("Every eligible field is attached.")).toBeInTheDocument();
  });
});

describe("the per-attachment required flag and detach", () => {
  it("toggles required through PATCH /matter-types/:id/fields/:fieldId", async () => {
    const calls = newCalls();
    stubApi({ signedIn: ADMIN, extra: editorApi(calls) });
    renderAt("/settings/matters/types/t1");
    const user = userEvent.setup();
    await user.click(await screen.findByRole("checkbox", { name: "Department required" }));
    await waitFor(() =>
      expect(calls.requiredPatches).toEqual([{ fieldId: "f2", body: { isRequired: true } }]),
    );
    expect(await screen.findByRole("checkbox", { name: "Department required" })).toBeChecked();
  });

  it("detaches through DELETE /matter-types/:id/fields/:fieldId and keeps the catalog row", async () => {
    const calls = newCalls();
    stubApi({ signedIn: ADMIN, extra: editorApi(calls) });
    renderAt("/settings/matters/types/t1");
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Detach Department" }));
    await waitFor(() => expect(calls.detaches).toEqual(["f2"]));
    expect(screen.getByText("No fields are attached to this type.")).toBeInTheDocument();
    // Detached, not deleted: the field returns to the Attach menu.
    await user.click(screen.getByRole("button", { name: "Attach field" }));
    expect(within(await screen.findByRole("menu")).getByText("Department")).toBeInTheDocument();
  });
});
