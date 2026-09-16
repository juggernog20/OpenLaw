// SPDX-License-Identifier: AGPL-3.0-only

import { describe, expect, it } from "vitest";
import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderAt, stubApi } from "../testing/helpers";

describe("default and custom field settings", () => {
  it.each([
    ["matters", "Matter Manager", "Term type"],
    ["contracts", "Term type", "Matter Manager"],
  ])(
    "shows locked defaults above the custom field editor for %s",
    async (module, included, excluded) => {
      stubApi({
        signedIn: {
          id: "u1",
          email: "admin@example.com",
          displayName: "Admin",
          role: "administrator",
          theme: "light",
        },
      });
      renderAt(`/settings/${module}/fields`);
      const defaults = await screen.findByRole("region", { name: "Default fields" });
      const custom = screen.getByRole("region", { name: "Custom Fields" });
      expect(
        defaults.compareDocumentPosition(custom) & Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy();
      const user = userEvent.setup();
      const toggle = within(defaults).getByRole("button", { name: "Default fields" });
      expect(toggle).toHaveAttribute("aria-expanded", "false");
      expect(within(defaults).queryByText("Title")).not.toBeInTheDocument();
      expect(within(custom).getByRole("button", { name: "Custom Fields" })).toHaveAttribute(
        "aria-expanded",
        "true",
      );
      await user.click(toggle);
      expect(toggle).toHaveAttribute("aria-expanded", "true");
      expect(within(defaults).getByText("Title")).toBeInTheDocument();
      expect(within(defaults).getByText(included)).toBeInTheDocument();
      expect(within(defaults).queryByText(excluded)).not.toBeInTheDocument();
      expect(
        within(defaults).getByRole("img", { name: "Title: built-in field, read-only here" }),
      ).toBeInTheDocument();
      expect(
        within(within(defaults).getByRole("list")).queryByRole("button"),
      ).not.toBeInTheDocument();
      expect(within(defaults).queryByRole("textbox")).not.toBeInTheDocument();
      expect(within(defaults).queryByRole("switch")).not.toBeInTheDocument();
      await user.click(toggle);
      expect(within(defaults).queryByText("Title")).not.toBeInTheDocument();
      await user.click(within(custom).getByRole("button", { name: "Add field" }));
      expect(await screen.findByRole("dialog", { name: "Add field" })).toBeInTheDocument();
    },
  );
});
