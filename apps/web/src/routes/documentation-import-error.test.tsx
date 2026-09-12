// SPDX-License-Identifier: AGPL-3.0-only
import { screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { renderAt } from "../testing/helpers";

vi.mock("./help", () => {
  throw new TypeError("Failed to fetch dynamically imported module");
});
vi.mock("../components/documentation/documentation-reader", () => {
  throw new TypeError("Failed to fetch dynamically imported module");
});

it.each(["/help", "/portal/help", "/documentation"])(
  "offers recovery when the module for %s cannot load",
  async (path) => {
    renderAt(path);
    expect(await screen.findByRole("heading", { name: "Something went wrong." })).toBeVisible();
    expect(screen.getByRole("button", { name: "Reload" })).toBeVisible();
    expect(screen.getByRole("link", { name: "Back to Home" })).toHaveAttribute("href", "/");
    expect(screen.queryByText("Unexpected Application Error!")).not.toBeInTheDocument();
  },
);
