// SPDX-License-Identifier: AGPL-3.0-only

/** Entity type Fields attachments at the shared editor route seam. */
import { describe, expect, it } from "vitest";
import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { json, renderAt, stubApi, type StubCall } from "../testing/helpers";

const ADMIN = {
  id: "u1",
  email: "admin@example.com",
  displayName: "Admin",
  role: "administrator",
  theme: "light",
};
const CORPORATION = {
  id: "t1",
  slug: "corporation",
  displayName: "Corporation",
  description: null,
  displayOrder: 1,
  isSystemDefault: true,
  archivedAt: null,
  inUseCount: 3,
};
const FIELDS = [
  {
    id: "f1",
    slug: "lei",
    displayName: "LEI",
    description: null,
    moduleScope: "entity",
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
    moduleScope: "global",
    fieldType: "text",
    options: null,
    fieldTag: "business",
    aiPrompt: null,
    archivedAt: null,
    inUseCount: 0,
  },
  {
    id: "f3",
    slug: "term",
    displayName: "Term",
    description: null,
    moduleScope: "contract",
    fieldType: "text",
    options: null,
    fieldTag: "legal",
    aiPrompt: null,
    archivedAt: null,
    inUseCount: 0,
  },
];

/** LEI already sits on the type, so the attach menu must not offer it. */
const ATTACHED_LEI = {
  fieldId: "f1",
  slug: "lei",
  displayName: "LEI",
  fieldType: "text",
  moduleScope: "entity",
  displayOrder: 1,
  isRequired: false,
};

function editorApi(call: StubCall): Response | undefined {
  const path = call.url.pathname;
  if (path === "/api/v1/entity-types/t1" && call.method === "GET") {
    return json(200, { entityType: CORPORATION });
  }
  if (path === "/api/v1/entity-types/t1/fields" && call.method === "GET") {
    return json(200, { attachedFields: [ATTACHED_LEI] });
  }
  if (path === "/api/v1/fields" && call.method === "GET") {
    return json(200, { fields: FIELDS });
  }
  return undefined;
}

describe("the Entity type editor", () => {
  it("loads the shared screen and offers only unattached Entity/global Fields", async () => {
    stubApi({ signedIn: ADMIN, extra: editorApi });
    renderAt("/settings/entities/types/t1");
    expect(await screen.findByRole("textbox", { name: "Display name" })).toHaveValue("Corporation");
    expect(screen.getByText("3 entities use this type.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "All types" })).toHaveAttribute(
      "href",
      "/settings/entities/types",
    );
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Attach field" }));
    const menu = await screen.findByRole("menu");
    // Department is unattached and global, so it is the one offer. LEI is
    // already attached; Term belongs to Contracts.
    expect(within(menu).getByText("Department")).toBeInTheDocument();
    expect(within(menu).queryByText("LEI")).not.toBeInTheDocument();
    expect(within(menu).queryByText("Term")).not.toBeInTheDocument();
  });
});
