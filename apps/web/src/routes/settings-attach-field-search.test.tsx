// SPDX-License-Identifier: AGPL-3.0-only

import { describe, expect, it } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { json, renderAt, stubApi } from "../testing/helpers";

describe.each([
  ["contract", "contracts"],
  ["matter", "matters"],
  ["request", "intake/request"],
  ["entity", "entities"],
] as const)("%s Attach field search", (module, section) => {
  function setup() {
    const attaches: unknown[] = [];
    const attachLabel = module === "request" ? "Attach field" : "Attach Field";
    const path = `/api/v1/${module}-types/t1`;
    const fields = ["Zebra notes", "beta notes", "Alpha notes"].map((displayName, i) => ({
      id: `f${i}`,
      slug: `field_${i}`,
      displayName,
      moduleScope: module === "request" ? "contract" : module,
      fieldType: "text",
      description: null,
      options: null,
      fieldTag: "business",
      aiPrompt: null,
      archivedAt: null,
      inUseCount: 0,
    }));
    stubApi({
      signedIn: {
        id: "u1",
        email: "admin@example.com",
        displayName: "Admin",
        role: "administrator",
        theme: "light",
      },
      extra: (call) => {
        if (call.method === "GET") {
          if (call.url.pathname === path)
            return json(200, {
              [`${module}Type`]: {
                id: "t1",
                slug: "test",
                displayName: "Test type",
                description: null,
                archivedAt: null,
                inUseCount: 0,
                isSystemDefault: false,
                displayOrder: 1,
                targetModule: null,
                targetTypeId: null,
                turnaroundDays: null,
              },
            });
          if (call.url.pathname === `${path}/form`) return json(200, { form: [] });
          if (call.url.pathname === `${path}/fields`) return json(200, { attachedFields: [] });
          if (call.url.pathname === "/api/v1/fields") return json(200, { fields });
          if (call.url.pathname === `${path}/people`) return json(200, { people: [] });
          if (call.url.pathname === "/api/v1/users") return json(200, { users: [] });
        }
        if (call.url.pathname === `${path}/form` && call.method === "PUT") {
          const body = call.body as { form: { id: string }[] };
          attaches.push({ fieldId: body.form.at(-1)!.id });
          return json(200, call.body);
        }
        if (call.url.pathname === `${path}/fields` && call.method === "POST") {
          attaches.push(call.body);
          const field = fields.find((f) => f.id === (call.body as { fieldId: string }).fieldId)!;
          return json(201, {
            attachedField: { ...field, fieldId: field.id, displayOrder: 1, isRequired: false },
          });
        }
        return undefined;
      },
    });
    renderAt(
      `/settings/${section}${module === "request" ? "-types" : "/types"}/t1${module === "request" ? "" : "/form"}`,
    );
    return { user: userEvent.setup(), attaches, attachLabel };
  }

  it("sorts alphabetically and filters by name without menu typeahead stealing typed spaces", async () => {
    const { user, attaches, attachLabel } = setup();
    await user.click(await screen.findByRole("button", { name: attachLabel }));
    const menu = await screen.findByRole("menu");
    const search = within(menu).getByRole("textbox", { name: "Search fields" });
    await waitFor(() => expect(search).toHaveFocus());
    expect([...menu.querySelectorAll("[data-field-option]")].map((e) => e.textContent)).toEqual([
      "Alpha notesText",
      "beta notesText",
      "Zebra notesText",
    ]);
    await user.type(search, "BETA NOTES");
    expect(search).toHaveFocus();
    expect(within(menu).queryByText("Alpha notes")).not.toBeInTheDocument();
    expect(within(menu).getByText("beta notes")).toBeInTheDocument();
    await user.keyboard("{ArrowDown}{Enter}");
    await waitFor(() => expect(attaches).toEqual([{ fieldId: "f1" }]));
    await waitFor(() => expect(screen.queryByRole("menu")).not.toBeInTheDocument());
    await user.click(screen.getByRole("button", { name: attachLabel }));
    expect(screen.getByRole("textbox", { name: "Search fields" })).toHaveValue("");
    expect(within(screen.getByRole("menu")).queryByText("beta notes")).not.toBeInTheDocument();
  });

  it("shows no results, keeps creation available, and closes with Escape", async () => {
    const { user, attaches, attachLabel } = setup();
    await user.click(await screen.findByRole("button", { name: attachLabel }));
    const search = await screen.findByRole("textbox", { name: "Search fields" });
    await waitFor(() => expect(search).toHaveFocus());
    await user.type(search, "unmatched field");
    expect(
      screen.getByText(module === "request" ? "No matching fields." : "No Fields match"),
    ).toBeInTheDocument();
    if (module === "contract" || module === "matter") {
      expect(screen.getByRole("menuitem", { name: "Create Field" })).toBeInTheDocument();
    }
    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("menu")).not.toBeInTheDocument());
    expect(screen.getByRole("button", { name: attachLabel })).toHaveFocus();
    expect(attaches).toHaveLength(0);
  });
});
