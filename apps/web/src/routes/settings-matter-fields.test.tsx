// SPDX-License-Identifier: AGPL-3.0-only

/** Matters · Fields at the shared catalog route seam (CTR-016/M22). */
import { describe, expect, it } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { json, renderAt, stubApi, type StubCall } from "../testing/helpers";

const ADMIN = {
  id: "u1",
  email: "admin@example.com",
  displayName: "Admin",
  role: "administrator",
  theme: "light",
};

const baseField = {
  description: null,
  fieldType: "text",
  options: null,
  fieldTag: "business",
  aiPrompt: null,
  archivedAt: null,
  inUseCount: 0,
};

describe("the Matters Fields pane", () => {
  it("shows matter and global fields, excludes contract fields, and creates at matter scope", async () => {
    const creates: unknown[] = [];
    const fields = [
      {
        ...baseField,
        id: "f1",
        slug: "department",
        displayName: "Department",
        moduleScope: "matter",
      },
      { ...baseField, id: "f2", slug: "region", displayName: "Region", moduleScope: "global" },
      { ...baseField, id: "f3", slug: "term", displayName: "Term", moduleScope: "contract" },
    ];
    const api = (call: StubCall): Response | undefined => {
      if (call.url.pathname === "/api/v1/fields" && call.method === "GET") {
        return json(200, { fields });
      }
      if (call.url.pathname === "/api/v1/fields" && call.method === "POST") {
        creates.push(call.body);
        const body = call.body as Record<string, unknown>;
        return json(201, {
          field: {
            ...baseField,
            id: "f4",
            slug: "business_unit",
            displayName: body.displayName,
            moduleScope: body.moduleScope,
            fieldType: body.fieldType,
            fieldTag: body.fieldTag,
          },
        });
      }
      return undefined;
    };
    stubApi({ signedIn: ADMIN, extra: api });
    renderAt("/settings/matters/fields");
    await screen.findByRole("button", { name: "Rename Department" });

    expect(screen.getByRole("button", { name: "Rename Region" })).toBeInTheDocument();
    expect(screen.queryByText("Term")).not.toBeInTheDocument();
    expect(screen.getByText("Matter and global fields")).toBeInTheDocument();
    const tabs = screen.getByRole("navigation", { name: "Matters panes" });
    expect(within(tabs).getByRole("link", { name: "Fields" })).toHaveAttribute(
      "aria-current",
      "page",
    );

    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Add field" }));
    const dialog = await screen.findByRole("dialog", { name: "Add field" });
    expect(within(dialog).getByRole("combobox", { name: "Scope" })).toHaveValue("matter");
    expect(within(dialog).queryByRole("textbox", { name: "AI prompt" })).not.toBeInTheDocument();
    await user.type(within(dialog).getByRole("textbox", { name: "Name" }), "Business unit");
    await user.selectOptions(within(dialog).getByRole("combobox", { name: "Type" }), "text");
    await user.click(within(dialog).getByRole("button", { name: "Add field" }));
    await waitFor(() =>
      expect(creates).toEqual([
        {
          displayName: "Business unit",
          moduleScope: "matter",
          fieldType: "text",
          fieldTag: "business",
        },
      ]),
    );
  });
});
