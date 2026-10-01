// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { stubApi, renderAt, json, problem } from "../testing/helpers";
import { setupForm } from "../testing/type-form";

describe("the entity type editor", () => {
  it("keeps identity on Details and opens the routed Form tab", async () => {
    const { user } = setupForm("entity");
    await user.click(await screen.findByRole("link", { name: "Details" }));
    expect(await screen.findByLabelText("Display name")).toHaveValue("Test type");
    expect(screen.queryByLabelText("Slug")).not.toBeInTheDocument();
    expect(screen.getByText("0 entities use this type.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "All types" })).toHaveAttribute(
      "href",
      "/settings/entities/types",
    );
    expect(screen.queryByRole("heading", { name: "Form" })).not.toBeInTheDocument();
    await user.click(screen.getByRole("link", { name: "Form" }));
    expect(await screen.findByRole("heading", { name: "Form" })).toBeInTheDocument();
  });
  it("commits identity on Enter and description on blur", async () => {
    const { user, patches } = setupForm("entity");
    await user.click(await screen.findByRole("link", { name: "Details" }));
    const name = await screen.findByLabelText("Display name");
    await user.clear(name);
    await user.type(name, "Updated type{Enter}");
    await waitFor(() => expect(patches).toContainEqual({ displayName: "Updated type" }));
    await user.type(screen.getByLabelText("Description"), "Updated description");
    await user.tab();
    await waitFor(() => expect(patches).toContainEqual({ description: "Updated description" }));
  });
  it("writes Required for creation and detaches through the whole Form", async () => {
    const { user, writes } = setupForm("entity");
    await user.click(
      await screen.findByRole("switch", { name: "Business justification: Required for creation" }),
    );
    await waitFor(() => expect(writes.at(-1)?.at(-1)).toMatchObject({ isRequired: true }));
    await user.click(screen.getByRole("button", { name: "Detach Business justification" }));
    await waitFor(() => expect(writes.at(-1)?.some((n) => n.id === "f1")).toBe(false));
    await user.click(screen.getByRole("button", { name: "Attach Field" }));
    expect(
      await screen.findByRole("menuitem", { name: /Business justification/ }),
    ).toBeInTheDocument();
  });
});

it("saves the type's Register through the taxonomy extras", async () => {
  const { user, patches } = setupForm("entity");
  await user.click(await screen.findByRole("link", { name: "Details" }));
  const select = await screen.findByRole("combobox", { name: "Register" });
  await user.selectOptions(select, "partnership");
  await waitFor(() => expect(patches).toContainEqual({ registerKind: "partnership" }));
  expect(select).toHaveValue("partnership");
});

it("shows the refused Entity count inline and keeps the saved Register", async () => {
  stubApi({
    signedIn: {
      id: "admin",
      email: "admin@example.com",
      displayName: "Admin",
      role: "administrator",
    },
    extra: (call) => {
      if (call.url.pathname === "/api/v1/entity-types/t1")
        return call.method === "PATCH"
          ? problem(
              409,
              "2 Entities hold register data. Their effective register kind cannot change.",
            )
          : json(200, {
              entityType: {
                id: "t1",
                slug: "test",
                displayName: "Test",
                description: null,
                archivedAt: null,
                inUseCount: 2,
                registerKind: "shares",
              },
            });
      if (call.url.pathname === "/api/v1/entity-types/t1/form") return json(200, { form: [] });
      if (call.url.pathname === "/api/v1/fields") return json(200, { fields: [] });
      return undefined;
    },
  });
  renderAt("/settings/entities/types/t1");
  const user = userEvent.setup();
  const select = await screen.findByRole("combobox", { name: "Register" });
  await user.selectOptions(select, "none");
  expect(await screen.findByRole("alert")).toHaveTextContent("2 Entities hold register data.");
  expect(select).toHaveValue("shares");
});
